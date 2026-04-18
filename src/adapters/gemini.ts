import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import type { Adapter, AuthCheckResult, RunResult, Turn } from "./types.ts";
import { defaultDetectExitReason } from "./_shared.ts";

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

  memoryFile: "GEMINI.md",
  contextWindow: 1_000_000,

  detectExitReason: defaultDetectExitReason,

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
      } catch { /* non-JSON line in stream output */ }
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

  async postRun(_cwd: string, result: RunResult, startedAt: number): Promise<Partial<RunResult>> {
    if (!result.sessionId) return {};
    // Gemini CLI stores session logs under ~/.gemini/sessions/
    const sessionsDir = `${homedir()}/.gemini/sessions`;
    let entries: ReturnType<typeof readdirSync>;
    try { entries = readdirSync(sessionsDir, { withFileTypes: true }); } catch { return {}; }

    for (const entry of entries) {
      const sessionPath = entry.isDirectory()
        ? `${sessionsDir}/${entry.name}/${result.sessionId}.jsonl`
        : entry.name === `${result.sessionId}.jsonl`
          ? `${sessionsDir}/${entry.name}`
          : null;
      if (!sessionPath) continue;

      let content: string;
      try { content = readFileSync(sessionPath, "utf8"); } catch { continue; }

      let totalInput = 0;
      let totalOutput = 0;
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const u = msg.usage ?? msg.stats;
          if (u) {
            totalInput += u.input_tokens ?? u.prompt_tokens ?? 0;
            totalOutput += u.output_tokens ?? u.completion_tokens ?? 0;
          }
        } catch { /* skip malformed lines */ }
      }

      if ((totalInput > 0 || totalOutput > 0) && !result.tokens) {
        return { tokens: { input: totalInput, output: totalOutput } };
      }
      return {};
    }
    return {};
  },

  async extractTranscript(_cwd: string, sessionId: string | undefined, startedAt: number): Promise<Turn[]> {
    if (!sessionId) return [];
    const sessionsDir = `${homedir()}/.gemini/sessions`;
    let entries: ReturnType<typeof readdirSync>;
    try { entries = readdirSync(sessionsDir, { withFileTypes: true }); } catch { return []; }

    for (const entry of entries) {
      const sessionPath = entry.isDirectory()
        ? `${sessionsDir}/${entry.name}/${sessionId}.jsonl`
        : entry.name === `${sessionId}.jsonl`
          ? `${sessionsDir}/${entry.name}`
          : null;
      if (!sessionPath) continue;

      let content: string;
      try { content = readFileSync(sessionPath, "utf8"); } catch { continue; }

      // Verify the file was written during this run
      try {
        const mtime = statSync(sessionPath).mtimeMs;
        if (mtime < startedAt) continue;
      } catch { continue; }

      const turns: Turn[] = [];
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const role = msg.role ?? msg.message?.role;
          const text = msg.content ?? msg.message?.content ?? msg.text;
          if ((role === "user" || role === "assistant") && typeof text === "string" && text.trim()) {
            turns.push({ role, content: text });
          }
        } catch { /* skip malformed lines */ }
      }
      return turns;
    }
    return [];
  },

  async discoverSession(_cwd: string, startedAt: number): Promise<{ sessionId?: string; summary?: string }> {
    const sessionsDir = `${homedir()}/.gemini/sessions`;
    let entries: ReturnType<typeof readdirSync>;
    try { entries = readdirSync(sessionsDir, { withFileTypes: true }); } catch { return {}; }

    let best: { sessionId: string; mtime: number } | null = null;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        let files: string[];
        try { files = readdirSync(`${sessionsDir}/${entry.name}`); } catch { continue; }
        for (const file of files) {
          if (!file.endsWith(".jsonl")) continue;
          const full = `${sessionsDir}/${entry.name}/${file}`;
          try {
            const mtime = statSync(full).mtimeMs;
            if (mtime >= startedAt && (!best || mtime > best.mtime)) {
              best = { sessionId: file.replace(/\.jsonl$/, ""), mtime };
            }
          } catch { continue; }
        }
      } else if (entry.name.endsWith(".jsonl")) {
        const full = `${sessionsDir}/${entry.name}`;
        try {
          const mtime = statSync(full).mtimeMs;
          if (mtime >= startedAt && (!best || mtime > best.mtime)) {
            best = { sessionId: entry.name.replace(/\.jsonl$/, ""), mtime };
          }
        } catch { continue; }
      }
    }
    return best ? { sessionId: best.sessionId } : {};
  },

  listModels() {
    return {
      static: [
        "gemini-3-pro-preview",
        "gemini-3-flash-preview",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
      ],
    };
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
