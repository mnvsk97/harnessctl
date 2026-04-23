import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import type { Adapter, AuthCheckResult, RunResult, Turn } from "./types.ts";
import { defaultDetectExitReason } from "./_shared.ts";

const MAX_WALK_DEPTH = 5;

/** Find the newest rollout-*.jsonl under ~/.codex/sessions/ modified after ts. */
function findNewestRollout(sinceMs: number): string | null {
  const base = `${homedir()}/.codex/sessions`;
  let best: { path: string; mtime: number } | null = null;
  const walk = (dir: string, depth: number) => {
    if (depth > MAX_WALK_DEPTH) return;
    let entries: ReturnType<typeof readdirSync>;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) {
        try {
          const mtime = statSync(full).mtimeMs;
          if (!best || mtime > best.mtime) best = { path: full, mtime };
        } catch { /* skip unreadable files */ }
      }
    }
  };
  walk(base, 0);
  if (!best || best.mtime < sinceMs) return null;
  return best.path;
}

export const codexAdapter: Adapter = {
  name: "codex",

  base: {
    cmd: "codex",
    args: ["exec", "-", "--full-auto", "--json"],
  },

  argMap: {
    model: (val) => ["--model", val],
    // codex has no session resume — intentionally absent
  },

  memoryFile: "AGENTS.md",
  contextWindow: 128_000,

  detectExitReason: defaultDetectExitReason,

  async extractTranscript(_cwd: string, _sessionId: string | undefined, startedAt: number): Promise<Turn[]> {
    const path = findNewestRollout(startedAt);
    if (!path) return [];
    let content: string;
    try { content = readFileSync(path, "utf8"); } catch { return []; /* rollout file unreadable */ }
    const turns: Turn[] = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);

        // User messages: only from event_msg with type "user_message" (actual user input)
        if (ev.type === "event_msg" && ev.payload?.type === "user_message" && ev.payload.message) {
          turns.push({ role: "user", content: ev.payload.message });
          continue;
        }

        // Assistant messages: only final answers and commentary (skip tool calls, reasoning, system)
        if (ev.type === "event_msg" && ev.payload?.type === "agent_message" && ev.payload.message) {
          turns.push({ role: "assistant", content: ev.payload.message });
          continue;
        }

        // Also capture assistant output_text from response_item messages
        if (ev.type === "response_item" && ev.payload?.role === "assistant" && ev.payload?.content) {
          const parts = Array.isArray(ev.payload.content) ? ev.payload.content : [];
          for (const p of parts) {
            if (p?.type === "output_text" && typeof p.text === "string" && p.text.trim()) {
              turns.push({ role: "assistant", content: p.text });
            }
          }
        }
      } catch { /* skip malformed JSONL line */ }
    }
    return turns;
  },

  parseOutput(stdout: string, _stderr: string): Partial<RunResult> {
    const result: Partial<RunResult> = {};
    const lines = stdout.split("\n").filter(Boolean);

    // --json output uses: thread.started, turn.started, item.completed, turn.completed
    let lastAgentMessage = "";

    for (const line of lines) {
      try {
        const ev = JSON.parse(line);

        // Session/thread ID
        if (ev.type === "thread.started" && ev.thread_id) {
          result.sessionId = ev.thread_id;
        }

        // Agent messages — keep the last one as the summary
        if (ev.type === "item.completed" && ev.item?.type === "agent_message" && ev.item.text) {
          lastAgentMessage = ev.item.text;
        }

        // Token usage from turn.completed
        if (ev.type === "turn.completed" && ev.usage) {
          result.tokens = {
            input: ev.usage.input_tokens ?? 0,
            output: ev.usage.output_tokens ?? 0,
            cacheRead: ev.usage.cached_input_tokens || undefined,
          };
        }

        // Fallback: rollout-style events (task_complete, legacy completed/result)
        if (ev.type === "event_msg" && ev.payload?.type === "task_complete") {
          lastAgentMessage = ev.payload.last_agent_message ?? lastAgentMessage;
        }
        if (!lastAgentMessage && (ev.type === "completed" || ev.type === "result")) {
          lastAgentMessage = ev.message ?? ev.result ?? "";
        }
      } catch { /* non-JSON line */ }
    }

    if (lastAgentMessage) result.summary = lastAgentMessage;

    // Final fallback: last non-JSON line
    if (!result.summary) {
      for (let i = lines.length - 1; i >= 0; i--) {
        try { JSON.parse(lines[i]); continue; } catch {}
        result.summary = lines[i].trim();
        break;
      }
    }

    return result;
  },

  async postRun(_cwd: string, result: RunResult, startedAt: number): Promise<Partial<RunResult>> {
    // Find the most recently modified rollout-*.jsonl under ~/.codex/sessions/
    // that was written during this run to avoid picking up a concurrent session.
    const sessionsBase = `${homedir()}/.codex/sessions`;
    let newest: { path: string; mtime: number } | null = null;

    const walkDir = (dir: string, depth: number) => {
      if (depth > MAX_WALK_DEPTH) return;
      let entries: ReturnType<typeof readdirSync>;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          walkDir(full, depth + 1);
        } else if (entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
          try {
            const mtime = statSync(full).mtimeMs;
            if (!newest || mtime > newest.mtime) newest = { path: full, mtime };
          } catch { /* skip unreadable files */ }
        }
      }
    };
    walkDir(sessionsBase, 0);
    // Reject files that predate this run — they belong to a previous invocation
    if (!newest || newest.mtime < startedAt) return {};

    let content: string;
    try { content = readFileSync(newest.path, "utf8"); } catch { return {}; /* rollout file unreadable */ }

    // The last token_count event holds cumulative totals for the session
    let lastTokens: { input: number; output: number } | null = null;
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const payload = event.event_msg?.payload ?? event.payload;
        if (payload?.type === "token_count") {
          lastTokens = {
            input:  payload.input_tokens  ?? payload.input  ?? 0,
            output: payload.output_tokens ?? payload.output ?? 0,
          };
        }
      } catch { /* skip malformed JSONL line */ }
    }

    if (lastTokens && (lastTokens.input > 0 || lastTokens.output > 0)) {
      // Only override if stdout didn't already give us token data
      if (!result.tokens) return { tokens: lastTokens };
    }
    return {};
  },

  async sessionFilePath(_cwd: string, _sessionId: string | undefined, startedAt: number): Promise<string | undefined> {
    return findNewestRollout(startedAt) ?? undefined;
  },

  async discoverSession(_cwd: string, startedAt: number): Promise<{ sessionId?: string; summary?: string }> {
    const path = findNewestRollout(startedAt);
    // Codex has no native session ID; return the rollout path as a reference
    return path ? { summary: `(codex rollout: ${path})` } : {};
  },

  listModels() {
    return {
      static: [
        "gpt-5.4              → flagship model",
        "gpt-5.4-mini         → fast/efficient mini",
        "gpt-5.3-codex        → specialized coding model",
        "gpt-5.3-codex-spark  → near-instant text-only coding",
        "o3",
        "o4-mini",
      ],
    };
  },

  healthCheck() {
    return { cmd: "codex", args: ["--version"] };
  },

  authCheck() {
    return {
      cmd: "codex",
      args: ["login", "status"],
      parse(stdout: string, stderr: string, exitCode: number | null): AuthCheckResult {
        const output = (stdout + stderr).toLowerCase();
        if (exitCode === 0 && output.includes("logged in")) {
          const method = output.includes("chatgpt") ? "ChatGPT" :
                         output.includes("api key") ? "API key" : undefined;
          return {
            ok: true,
            method: method?.toLowerCase(),
            message: `authenticated${method ? ` (${method})` : ""}`,
          };
        }
        return { ok: false, message: "not logged in — run: codex login" };
      },
    };
  },
};
