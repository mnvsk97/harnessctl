import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import type { Adapter, AuthCheckResult, RunResult, Turn } from "./types.ts";
import { defaultDetectExitReason } from "./_shared.ts";

/** Find the newest rollout-*.jsonl under ~/.codex/sessions/ modified after ts. */
function findNewestRollout(sinceMs: number): string | null {
  const base = `${homedir()}/.codex/sessions`;
  let best: { path: string; mtime: number } | null = null;
  const walk = (dir: string) => {
    let entries: ReturnType<typeof readdirSync>;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(full);
      else if (e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) {
        try {
          const mtime = statSync(full).mtimeMs;
          if (!best || mtime > best.mtime) best = { path: full, mtime };
        } catch {}
      }
    }
  };
  walk(base);
  if (!best || best.mtime < sinceMs) return null;
  return best.path;
}

export const codexAdapter: Adapter = {
  name: "codex",

  base: {
    cmd: "codex",
    args: ["exec", "-", "--full-auto"],
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
    try { content = readFileSync(path, "utf8"); } catch { return []; }
    const turns: Turn[] = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        const payload = ev.event_msg?.payload ?? ev.payload ?? ev;
        const role = payload?.role ?? ev.role;
        const text = payload?.text ?? payload?.message ?? payload?.content;
        if ((role === "user" || role === "assistant") && typeof text === "string" && text.trim()) {
          turns.push({ role, content: text });
        }
      } catch {}
    }
    return turns;
  },

  parseOutput(stdout: string, _stderr: string): Partial<RunResult> {
    const result: Partial<RunResult> = {};
    const lines = stdout.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === "completed" || event.type === "result") {
          result.summary = event.message ?? event.result ?? "";
          if (event.usage) {
            result.tokens = {
              input: event.usage.input_tokens ?? 0,
              output: event.usage.output_tokens ?? 0,
            };
          }
        }
      } catch {
        // plain text output
      }
    }

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

    const walkDir = (dir: string) => {
      let entries: ReturnType<typeof readdirSync>;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          walkDir(full);
        } else if (entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
          try {
            const mtime = statSync(full).mtimeMs;
            if (!newest || mtime > newest.mtime) newest = { path: full, mtime };
          } catch {}
        }
      }
    };
    walkDir(sessionsBase);
    // Reject files that predate this run — they belong to a previous invocation
    if (!newest || newest.mtime < startedAt) return {};

    let content: string;
    try { content = readFileSync(newest.path, "utf8"); } catch { return {}; }

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
      } catch {}
    }

    if (lastTokens && (lastTokens.input > 0 || lastTokens.output > 0)) {
      // Only override if stdout didn't already give us token data
      if (!result.tokens) return { tokens: lastTokens };
    }
    return {};
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
