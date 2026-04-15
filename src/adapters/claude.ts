import type { Adapter, AuthCheckResult, RunResult } from "./types.ts";

export const claudeAdapter: Adapter = {
  name: "claude",

  base: {
    cmd: "claude",
    args: ["--print", "-", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"],
  },

  argMap: {
    model:  (val) => ["--model", val],
    resume: (val) => ["--resume", val],
  },

  parseOutput(stdout: string, _stderr: string): Partial<RunResult> {
    const result: Partial<RunResult> = {};
    const lines = stdout.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === "result") {
          result.summary = event.result ?? "";
          result.sessionId = event.session_id;
          if (event.cost_usd != null) result.cost = event.cost_usd;
          if (event.usage) {
            result.tokens = {
              input: event.usage.input_tokens ?? 0,
              output: event.usage.output_tokens ?? 0,
            };
          }
        }
      } catch {
        // non-JSON line, part of streamed text output
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
    return { cmd: "claude", args: ["--version"] };
  },

  authCheck() {
    return {
      cmd: "claude",
      args: ["auth", "status"],
      parse(stdout: string, _stderr: string, exitCode: number | null): AuthCheckResult {
        try {
          const data = JSON.parse(stdout.trim());
          if (data.loggedIn) {
            const parts = [data.authMethod, data.apiProvider].filter(Boolean);
            return {
              ok: true,
              method: data.authMethod,
              provider: data.apiProvider,
              message: `authenticated${parts.length ? ` (${parts.join(", ")})` : ""}`,
            };
          }
          return { ok: false, message: "not logged in — run: claude auth login" };
        } catch {
          if (exitCode === 0) {
            return { ok: true, message: "authenticated" };
          }
          return { ok: false, message: "auth check failed — run: claude auth login" };
        }
      },
    };
  },
};
