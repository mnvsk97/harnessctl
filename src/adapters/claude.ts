import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { Adapter, AuthCheckResult, ExitReason, RunResult, Turn } from "./types.ts";
import { defaultDetectExitReason } from "./_shared.ts";

/** Pull plain text from Claude's content field (string | Array<{type,text}>). */
function extractText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (!Array.isArray(raw)) return "";
  return raw
    .map((c: any) => {
      if (typeof c === "string") return c;
      if (c?.type === "text" && typeof c.text === "string") return c.text;
      if (c?.type === "tool_use") return `[tool: ${c.name ?? "?"}]`;
      if (c?.type === "tool_result") return `[tool_result]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

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

  memoryFile: "CLAUDE.md",
  contextWindow: 200_000,

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
      } catch { /* non-JSON */ }
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

  detectExitReason(stdout: string, stderr: string, exitCode: number | null): ExitReason {
    // Claude stream-json can exit 0 yet signal an error inside a result event.
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === "result" && ev.is_error) {
          const sub = (ev.subtype ?? "").toString();
          if (/rate|quota|limit|usage/i.test(sub)) return "rate_limit";
          if (/context|token|max_turns/i.test(sub)) return "token_limit";
        }
      } catch {}
    }
    return defaultDetectExitReason(stdout, stderr, exitCode);
  },

  async extractTranscript(_cwd: string, sessionId: string | undefined, _startedAt: number): Promise<Turn[]> {
    if (!sessionId) return [];
    const projectsDir = `${homedir()}/.claude/projects`;
    let projectDirs: string[];
    try {
      projectDirs = readdirSync(projectsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => d.name);
    } catch { return []; }

    for (const dir of projectDirs) {
      const path = `${projectsDir}/${dir}/${sessionId}.jsonl`;
      let content: string;
      try { content = readFileSync(path, "utf8"); } catch { continue; }

      const turns: Turn[] = [];
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const role = msg.message?.role ?? msg.role;
          const raw = msg.message?.content ?? msg.content;
          if (role !== "user" && role !== "assistant") continue;
          const text = extractText(raw);
          if (text) turns.push({ role, content: text });
        } catch {}
      }
      return turns;
    }
    return [];
  },

  async postRun(_cwd: string, result: RunResult, _startedAt: number): Promise<Partial<RunResult>> {
    if (!result.sessionId) return {};
    const projectsDir = `${homedir()}/.claude/projects`;
    let projectDirs: string[];
    try {
      projectDirs = readdirSync(projectsDir, { withFileTypes: true })
        .filter(d => d.isDirectory()).map(d => d.name);
    } catch { return {}; }

    for (const dir of projectDirs) {
      const sessionPath = `${projectsDir}/${dir}/${result.sessionId}.jsonl`;
      let content: string;
      try { content = readFileSync(sessionPath, "utf8"); } catch { continue; }

      let cacheWrite = 0;
      let cacheRead = 0;
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
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
      return {};
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
          if (exitCode === 0) return { ok: true, message: "authenticated" };
          return { ok: false, message: "auth check failed — run: claude auth login" };
        }
      },
    };
  },
};
