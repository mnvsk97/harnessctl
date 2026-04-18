import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import type { Adapter, AuthCheckResult, RunResult, Turn } from "./types.ts";
import { defaultDetectExitReason } from "./_shared.ts";

export const cursorAdapter: Adapter = {
  name: "cursor",

  base: {
    cmd: "agent",
    args: ["-p", "--force", "--output-format", "stream-json"],
  },

  argMap: {
    model:  (val) => ["-m", val],
    resume: (val) => ["--resume", val],
  },

  memoryFile: ".cursorrules",
  contextWindow: 200_000,

  detectExitReason: defaultDetectExitReason,

  parseOutput(stdout: string, _stderr: string): Partial<RunResult> {
    const result: Partial<RunResult> = {};
    const lines = stdout.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === "result" && !event.is_error) {
          result.summary = event.result ?? "";
          if (event.session_id) result.sessionId = event.session_id;
          if (event.cost_usd != null) result.cost = event.cost_usd;
          if (event.usage) {
            result.tokens = {
              input: event.usage.input_tokens ?? 0,
              output: event.usage.output_tokens ?? 0,
            };
          }
        }
      } catch {
        // non-JSON line — part of streamed text output
      }
    }

    if (!result.summary) {
      for (let i = lines.length - 1; i >= 0; i--) {
        try { JSON.parse(lines[i]); continue; } catch { /* plain text */ }
        result.summary = lines[i].trim();
        break;
      }
    }

    return result;
  },

  async postRun(_cwd: string, result: RunResult, _startedAt: number): Promise<Partial<RunResult>> {
    if (!result.sessionId) return {};
    // cursor-agent stores session logs under ~/.cursor-agent/sessions/
    const sessionsDir = `${homedir()}/.cursor-agent/sessions`;
    let entries: ReturnType<typeof readdirSync>;
    try { entries = readdirSync(sessionsDir, { withFileTypes: true }); } catch { return {}; }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionPath = `${sessionsDir}/${entry.name}/${result.sessionId}.jsonl`;
      let content: string;
      try { content = readFileSync(sessionPath, "utf8"); } catch { continue; }

      let totalInput = 0;
      let totalOutput = 0;
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const u = msg.usage ?? msg.message?.usage;
          if (u) {
            totalInput += u.input_tokens ?? u.prompt_tokens ?? 0;
            totalOutput += u.output_tokens ?? u.completion_tokens ?? 0;
          }
        } catch { /* skip malformed lines */ }
      }

      if ((totalInput > 0 || totalOutput > 0) && !result.tokens) {
        return { tokens: { input: totalInput, output: totalOutput } };
      }
      return {};
    }
    return {};
  },

  async extractTranscript(_cwd: string, sessionId: string | undefined, startedAt: number): Promise<Turn[]> {
    if (!sessionId) return [];
    const sessionsDir = `${homedir()}/.cursor-agent/sessions`;
    let entries: ReturnType<typeof readdirSync>;
    try { entries = readdirSync(sessionsDir, { withFileTypes: true }); } catch { return []; }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionPath = `${sessionsDir}/${entry.name}/${sessionId}.jsonl`;
      let content: string;
      try { content = readFileSync(sessionPath, "utf8"); } catch { continue; }

      // Verify the file was written during this run
      try {
        const mtime = statSync(sessionPath).mtimeMs;
        if (mtime < startedAt) continue;
      } catch { continue; }

      const turns: Turn[] = [];
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const role = msg.message?.role ?? msg.role;
          const text = msg.message?.content ?? msg.content;
          if ((role === "user" || role === "assistant") && typeof text === "string" && text.trim()) {
            turns.push({ role, content: text });
          }
        } catch { /* skip malformed lines */ }
      }
      return turns;
    }
    return [];
  },

  async discoverSession(_cwd: string, startedAt: number): Promise<{ sessionId?: string; summary?: string }> {
    const sessionsDir = `${homedir()}/.cursor-agent/sessions`;
    let entries: ReturnType<typeof readdirSync>;
    try { entries = readdirSync(sessionsDir, { withFileTypes: true }); } catch { return {}; }

    let best: { sessionId: string; mtime: number } | null = null;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let files: string[];
      try { files = readdirSync(`${sessionsDir}/${entry.name}`); } catch { continue; }
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const full = `${sessionsDir}/${entry.name}/${file}`;
        try {
          const mtime = statSync(full).mtimeMs;
          if (mtime >= startedAt && (!best || mtime > best.mtime)) {
            best = { sessionId: file.replace(/\.jsonl$/, ""), mtime };
          }
        } catch { continue; }
      }
    }
    return best ? { sessionId: best.sessionId } : {};
  },

  listModels() {
    return { cmd: "agent", args: ["models"] };
  },

  healthCheck() {
    return { cmd: "agent", args: ["--version"] };
  },

  authCheck() {
    return {
      cmd: "agent",
      args: ["status"],
      parse(stdout: string, stderr: string, exitCode: number | null): AuthCheckResult {
        const output = (stdout + stderr).toLowerCase();
        if (exitCode !== 0) {
          return { ok: false, message: "not logged in — run: agent login, or set CURSOR_API_KEY" };
        }
        if (output.includes("not logged in") || output.includes("unauthenticated")) {
          return { ok: false, message: "not logged in — run: agent login, or set CURSOR_API_KEY" };
        }
        return { ok: true, message: "authenticated" };
      },
    };
  },
};
