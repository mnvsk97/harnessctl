import type { Adapter, AuthCheckResult, RunResult } from "./types.ts";

export const geminiAdapter: Adapter = {
  name: "gemini",

  base: {
    cmd: "gemini",
    args: ["--yolo"],
  },

  argMap: {
    model: (val) => ["--model", val],
    // gemini CLI has no session resume — intentionally absent
  },

  parseOutput(stdout: string, _stderr: string): Partial<RunResult> {
    const result: Partial<RunResult> = {};
    const lines = stdout.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === "result" || event.type === "done" || event.type === "response") {
          result.summary = event.message ?? event.result ?? event.text ?? "";
          if (event.usage || event.usageMetadata) {
            const u = event.usage ?? event.usageMetadata;
            result.tokens = {
              input: u.input_tokens ?? u.promptTokenCount ?? 0,
              output: u.output_tokens ?? u.candidatesTokenCount ?? 0,
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

  healthCheck() {
    return { cmd: "gemini", args: ["--version"] };
  },

  authCheck() {
    return {
      cmd: "gemini",
      args: ["auth", "status"],
      parse(stdout: string, stderr: string, exitCode: number | null): AuthCheckResult {
        const output = (stdout + stderr).toLowerCase();

        if (exitCode === 0) {
          const hasOAuth = output.includes("logged in") || output.includes("authenticated") || output.includes("account");
          const hasApiKey = output.includes("api key") || output.includes("gemini_api_key");
          const method = hasOAuth ? "oauth" : hasApiKey ? "api_key" : undefined;
          return {
            ok: true,
            method,
            message: `authenticated${method ? ` (${method})` : ""}`,
          };
        }

        // Fall back to checking GEMINI_API_KEY env var
        if (process.env.GEMINI_API_KEY) {
          return { ok: true, method: "api_key", message: "authenticated (GEMINI_API_KEY)" };
        }

        return { ok: false, message: "not authenticated — run: gemini auth login or set GEMINI_API_KEY" };
      },
    };
  },
};
