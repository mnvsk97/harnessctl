import type { Adapter, AuthCheckResult, RunResult } from "./types.ts";
import { defaultDetectExitReason } from "./_shared.ts";

export const cursorAdapter: Adapter = {
  name: "cursor",

  base: {
    cmd: "cursor-agent",
    args: ["-p", "--force", "--output-format", "stream-json"],
  },

  argMap: {
    model:  (val) => ["-m", val],
    resume: (val) => ["--resume", val],
  },

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
        }
      } catch {
        // plain text line
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

  healthCheck() {
    return { cmd: "cursor-agent", args: ["--version"] };
  },

  authCheck() {
    return {
      cmd: "cursor-agent",
      args: ["status"],
      parse(stdout: string, stderr: string, exitCode: number | null): AuthCheckResult {
        const output = (stdout + stderr).toLowerCase();
        if (exitCode !== 0) {
          return { ok: false, message: "not logged in — run: cursor-agent login" };
        }
        if (output.includes("not logged in") || output.includes("unauthenticated")) {
          return { ok: false, message: "not logged in — run: cursor-agent login" };
        }
        return { ok: true, message: "authenticated" };
      },
    };
  },
};
