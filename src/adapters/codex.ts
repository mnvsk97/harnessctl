import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import type { Adapter, AuthCheckResult, RunResult } from "./types.ts";

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
