import { spawnSync } from "node:child_process";
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

  async postRun(_cwd: string, result: RunResult, startedAt: number): Promise<Partial<RunResult>> {
    const dbPath = `${homedir()}/.local/share/opencode/opencode.db`;
    try {
      // Filter to sessions updated after this run started. OpenCode may store
      // updated_at as Unix milliseconds (JS) or seconds; handle both by
      // matching either scale. Modern Unix seconds are ~1.7e9, so values
      // >= 2e9 are milliseconds.
      const startMs = startedAt;
      const startSec = Math.floor(startedAt / 1000);
      const sql =
        "SELECT id, cost, prompt_tokens, completion_tokens FROM sessions " +
        `WHERE (updated_at >= ${startMs}) ` +
        `   OR (updated_at >= ${startSec} AND updated_at < 2000000000) ` +
        "ORDER BY updated_at DESC LIMIT 1";

      const proc = spawnSync("sqlite3", [dbPath, "-json", sql], { encoding: "utf8" });
      if (proc.status !== 0 || !proc.stdout?.trim()) return {};

      const rows: Array<{ id: string; cost: string | null; prompt_tokens: string; completion_tokens: string }> =
        JSON.parse(proc.stdout.trim());
      if (!Array.isArray(rows) || rows.length === 0) return {};
      const row = rows[0];

      const enriched: Partial<RunResult> = {};
      if (!result.sessionId && row.id) enriched.sessionId = row.id;
      const cost = row.cost != null ? Number(row.cost) : null;
      if (cost != null && !Number.isNaN(cost)) enriched.cost = cost;
      const inputTok = Number(row.prompt_tokens);
      const outputTok = Number(row.completion_tokens);
      if (inputTok > 0 || outputTok > 0) enriched.tokens = { input: inputTok, output: outputTok };
      return enriched;
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
