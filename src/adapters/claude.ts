import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
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

  async postRun(_cwd: string, result: RunResult): Promise<Partial<RunResult>> {
    if (!result.sessionId) return {};
    const projectsDir = `${homedir()}/.claude/projects`;
    let projectDirs: string[];
    try {
      projectDirs = readdirSync(projectsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    } catch { return {}; }

    for (const dir of projectDirs) {
      const sessionPath = `${projectsDir}/${dir}/${result.sessionId}.jsonl`;
      let content: string;
      try { content = readFileSync(sessionPath, "utf8"); } catch { continue; }

      // Sum cache tokens across all assistant turns
      let cacheWrite = 0;
      let cacheRead = 0;
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          // Usage lives at msg.message.usage (API response wrapper) or msg.usage
          const u = msg.message?.usage ?? msg.usage;
          if (u) {
            cacheWrite += u.cache_creation_input_tokens ?? 0;
            cacheRead  += u.cache_read_input_tokens ?? 0;
          }
        } catch {}
      }

      if (cacheWrite > 0 || cacheRead > 0) {
        return {
          tokens: {
            input:  result.tokens?.input  ?? 0,
            output: result.tokens?.output ?? 0,
            cacheWrite,
            cacheRead,
          },
        };
      }
      return {}; // found the file but no cache tokens — done
    }
    return {};
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
