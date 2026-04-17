import { homedir } from "node:os";
import type { Adapter, AuthCheckResult, RunResult } from "./types.ts";

export const opencodeAdapter: Adapter = {
  name: "opencode",

  base: {
    cmd: "opencode",
    args: ["--pipe"],
  },

  argMap: {
    model: (val) => ["--model", val],
    // opencode has no session resume — intentionally absent
  },

  parseOutput(stdout: string, _stderr: string): Partial<RunResult> {
    const result: Partial<RunResult> = {};
    const lines = stdout.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === "result" || event.type === "done") {
          result.summary = event.message ?? event.result ?? "";
          if (event.usage) {
            result.tokens = {
              input: event.usage.input_tokens ?? 0,
              output: event.usage.output_tokens ?? 0,
            };
          }
        }
      } catch {
        // plain text
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

  async postRun(_cwd: string, result: RunResult): Promise<Partial<RunResult>> {
    const dbPath = `${homedir()}/.local/share/opencode/opencode.db`;
    try {
      const { Database } = await import("bun:sqlite");
      const db = new Database(dbPath, { readonly: true });
      try {
        type SessionRow = {
          id: string;
          cost: number | null;
          prompt_tokens: number;
          completion_tokens: number;
        };
        const row = db.prepare<SessionRow, []>(
          "SELECT id, cost, prompt_tokens, completion_tokens FROM sessions ORDER BY updated_at DESC LIMIT 1",
        ).get();
        if (!row) return {};

        const enriched: Partial<RunResult> = {};
        if (!result.sessionId && row.id) enriched.sessionId = row.id;
        if (row.cost != null) enriched.cost = row.cost;
        if (row.prompt_tokens > 0 || row.completion_tokens > 0) {
          enriched.tokens = { input: row.prompt_tokens, output: row.completion_tokens };
        }
        return enriched;
      } finally {
        db.close();
      }
    } catch { return {}; }
  },

  healthCheck() {
    return { cmd: "opencode", args: ["--version"] };
  },

  authCheck() {
    return {
      cmd: "opencode",
      args: ["auth", "list"],
      parse(stdout: string, stderr: string, exitCode: number | null): AuthCheckResult {
        const output = stdout + stderr;
        // Check for credentials in the output
        const hasCredentials = /\d+ credentials/.test(output);
        const credCount = output.match(/(\d+) credentials/)?.[1];
        const hasEnvVars = /\d+ environment variables/.test(output);
        const envCount = output.match(/(\d+) environment variables/)?.[1];

        const credsOk = credCount && parseInt(credCount) > 0;
        const envsOk = envCount && parseInt(envCount) > 0;

        if (exitCode === 0 && (credsOk || envsOk)) {
          const parts: string[] = [];
          if (credsOk) parts.push(`${credCount} credentials`);
          if (envsOk) parts.push(`${envCount} env vars`);
          return {
            ok: true,
            message: `authenticated (${parts.join(", ")})`,
          };
        }
        return { ok: false, message: "no credentials found — run: opencode auth login" };
      },
    };
  },
};
