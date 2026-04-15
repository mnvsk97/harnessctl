import type { Adapter, RunResult } from "./types.ts";

export const codexAdapter: Adapter = {
  name: "codex",

  base: {
    cmd: "codex",
    args: ["exec", "-", "--full-auto"],
  },

  stdinMode: "prompt",

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

  healthCheck() {
    return { cmd: "codex", args: ["--version"] };
  },
};
