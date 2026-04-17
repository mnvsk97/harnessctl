import type { Adapter, AuthCheckResult, RunResult } from "./types.ts";

export const geminiAdapter: Adapter = {
  name: "gemini",

  base: {
    cmd: "gemini",
    // --output-format stream-json: emit newline-delimited JSON events for reliable parsing
    // --yolo: auto-approve all tool calls (headless safe equivalent of --dangerously-skip-permissions)
    args: ["--output-format", "stream-json", "--yolo"],
  },

  argMap: {
    model:  (val) => ["--model", val],
    resume: (val) => ["--resume", val],
  },

  parseOutput(stdout: string, _stderr: string): Partial<RunResult> {
    const result: Partial<RunResult> = {};
    const lines = stdout.split("\n").filter(Boolean);
    const assistantChunks: string[] = [];

    for (const line of lines) {
      try {
        const event = JSON.parse(line);

        // INIT event carries the session ID
        if (event.type === "init" && event.session_id) {
          result.sessionId = event.session_id;
        }

        // MESSAGE events with role "assistant" are streamed response deltas
        if (event.type === "message" && event.role === "assistant" && event.content) {
          assistantChunks.push(event.content);
        }

        // RESULT event carries final status and token stats
        if (event.type === "result" && event.stats) {
          const s = event.stats;
          result.tokens = {
            input: s.input_tokens ?? 0,
            output: s.output_tokens ?? 0,
          };
        }
      } catch {
        // non-JSON line — part of streamed text output
      }
    }

    if (assistantChunks.length > 0) {
      result.summary = assistantChunks.join("").trim();
    }

    // Fallback: last non-JSON line (e.g. when not using stream-json format)
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
      args: ["--version"],
      parse(stdout: string, stderr: string, exitCode: number | null): AuthCheckResult {
        // gemini has no auth status subcommand; presence of GEMINI_API_KEY or
        // an OAuth session in ~/.gemini/settings.json is checked at startup.
        // We verify the binary runs and trust the env/settings for actual auth.
        if (exitCode === 0) {
          if (process.env.GEMINI_API_KEY) {
            return { ok: true, method: "api_key", message: "authenticated (GEMINI_API_KEY)" };
          }
          if (process.env.GOOGLE_GENAI_USE_VERTEXAI) {
            return { ok: true, method: "vertex_ai", message: "authenticated (Vertex AI)" };
          }
          // Binary is present; OAuth session may be configured in ~/.gemini/settings.json
          return { ok: true, message: "installed (run gemini to authenticate if needed)" };
        }
        return { ok: false, message: "gemini not found — run: npm install -g @google/gemini-cli" };
      },
    };
  },
};
