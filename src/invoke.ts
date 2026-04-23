import { spawn } from "node:child_process";
import type { Adapter, AgentConfig, InvokeIntent, RunResult } from "./adapters/types.ts";
import { buildCommand } from "./adapters/registry.ts";
import { defaultDetectExitReason } from "./adapters/_shared.ts";
import { Spinner } from "./ui.ts";

const DEFAULT_TIMEOUT_SECONDS = 300;
const KILL_GRACE_PERIOD_MS = 5000;

/**
 * Extract human-readable text from a JSON stream line (Claude stream-json or Codex --json).
 * Returns the text to display, or empty string if the line should be suppressed.
 */
function extractDisplayText(jsonLine: string): string {
  try {
    const ev = JSON.parse(jsonLine);

    // Claude: assistant text messages
    if (ev.type === "assistant" && ev.message?.content) {
      const parts = Array.isArray(ev.message.content) ? ev.message.content : [ev.message.content];
      const texts: string[] = [];
      for (const p of parts) {
        if (typeof p === "string") texts.push(p);
        else if (p?.type === "text" && typeof p.text === "string") texts.push(p.text);
      }
      if (texts.length) return texts.join("") + "\n";
    }

    // Codex --json: agent messages
    if (ev.type === "item.completed" && ev.item?.type === "agent_message" && ev.item.text) {
      return ev.item.text + "\n";
    }

    return "";
  } catch {
    // Not JSON — pass through as-is (plain text output from non-JSON agents)
    return jsonLine;
  }
}

/**
 * Extract a short status hint from a JSON stream line for the spinner.
 * Returns a brief description of what the agent is doing, or undefined to keep current text.
 */
function extractStatusHint(jsonLine: string): string | undefined {
  try {
    const ev = JSON.parse(jsonLine);

    // Claude: assistant content (tool_use, text)
    if (ev.type === "assistant" && ev.message?.content) {
      const parts = Array.isArray(ev.message.content) ? ev.message.content : [];
      for (const p of parts) {
        if (p?.type === "tool_use" && p.name) return `using ${p.name}...`;
        if (p?.type === "text" && typeof p.text === "string") {
          const preview = p.text.slice(0, 60).replace(/\n/g, " ").trim();
          if (preview) return preview + (p.text.length > 60 ? "..." : "");
        }
      }
    }
    if (ev.type === "result") return "done";

    // Codex --json: agent commentary
    if (ev.type === "item.completed" && ev.item?.type === "agent_message") {
      const msg = ev.item.text ?? "";
      const preview = msg.slice(0, 60).replace(/\n/g, " ").trim();
      if (preview) return preview + (msg.length > 60 ? "..." : "");
    }

    // Codex --json: command execution
    if (ev.type === "item.started" && ev.item?.type === "command_execution") {
      const cmd = ev.item.command ?? "";
      // Strip shell wrapper to show the actual command
      const inner = cmd.replace(/^\/bin\/\w+\s+-lc\s+/, "").replace(/^["']|["']$/g, "");
      return inner ? `running: ${inner.slice(0, 50)}` : "running command...";
    }

    // Codex --json: file changes
    if (ev.type === "item.started" && ev.item?.type === "file_change") {
      const changes = ev.item.changes ?? [];
      if (changes.length > 0) {
        const path = changes[0].path?.split("/").pop() ?? "";
        return path ? `editing: ${path}` : "applying changes...";
      }
      return "applying changes...";
    }

    // Codex --json: turn complete
    if (ev.type === "turn.completed") return "done";
  } catch { /* not JSON */ }
  return undefined;
}

/**
 * Determine if an agent uses structured JSON output that needs filtering.
 * Claude uses --output-format stream-json; Codex uses --json.
 */
function usesJsonOutput(adapter: Adapter): boolean {
  return adapter.base.args.includes("stream-json") || adapter.base.args.includes("--json");
}

export interface InvokeOptions {
  /** When true, stream assistant output live. When false (default), show spinner + final result only. */
  stream?: boolean;
}

export function invoke(
  adapter: Adapter,
  intent: InvokeIntent,
  agentConfig: AgentConfig,
  opts: InvokeOptions = {},
): Promise<RunResult> {
  const { cmd, args, stdin: stdinData, warnings } = buildCommand(adapter, intent);

  // Surface warnings for unsupported flags
  for (const w of warnings) {
    console.error(`[harnessctl] warning: ${w}`);
  }

  const timeout = agentConfig.timeout ?? DEFAULT_TIMEOUT_SECONDS;
  const start = Date.now();
  const isJsonAgent = usesJsonOutput(adapter);
  const streamMode = opts.stream === true;

  // Quiet mode: show a spinner while the agent works
  const spinner = (!streamMode && process.stderr.isTTY)
    ? new Spinner(`${adapter.name} is working...`)
    : null;

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: intent.cwd,
      env: { ...process.env, ...intent.env },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });

    spinner?.start();

    let stdoutBuf = "";
    let stderrBuf = "";
    let stdoutLineBuf = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutBuf += text;

      if (isJsonAgent) {
        // Buffer partial lines, then process complete JSON lines
        stdoutLineBuf += text;
        const lines = stdoutLineBuf.split("\n");
        stdoutLineBuf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          if (streamMode) {
            const display = extractDisplayText(line);
            if (display) process.stdout.write(display);
          } else {
            // Update spinner with status hints
            const hint = extractStatusHint(line);
            if (hint && spinner) spinner.update(hint);
          }
        }
      } else if (streamMode) {
        process.stdout.write(text);
      }
      // quiet + non-JSON agent: buffer silently, spinner keeps spinning
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuf += text;
      if (streamMode) process.stderr.write(text);
    });

    // Write prompt to stdin then close
    if (stdinData) {
      child.stdin.write(stdinData);
    }
    child.stdin.end();

    // Timeout handling
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, KILL_GRACE_PERIOD_MS);
    }, timeout * 1000);

    child.on("close", async (code) => {
      clearTimeout(timer);
      spinner?.stop();

      // Flush any remaining buffered stdout
      if (isJsonAgent && streamMode && stdoutLineBuf.trim()) {
        const display = extractDisplayText(stdoutLineBuf);
        if (display) process.stdout.write(display);
      }

      const duration = (Date.now() - start) / 1000;
      const parsed = adapter.parseOutput(stdoutBuf, stderrBuf);
      const base: RunResult = {
        exitCode: code,
        summary: parsed.summary ?? "",
        sessionId: parsed.sessionId,
        cost: parsed.cost,
        tokens: parsed.tokens,
        duration,
      };
      if (adapter.postRun) {
        try {
          const enriched = await adapter.postRun(intent.cwd, base, start);
          if (enriched.sessionId != null) base.sessionId = enriched.sessionId;
          if (enriched.cost != null) base.cost = enriched.cost;
          if (enriched.tokens != null) base.tokens = enriched.tokens;
          if (enriched.summary != null) base.summary = enriched.summary;
        } catch {
          // postRun is best-effort; never fail the run
        }
      }
      // Classify the outcome for auto-failover decisions. Never throws.
      try {
        const detect = adapter.detectExitReason ?? defaultDetectExitReason;
        base.exitReason = detect(stdoutBuf, stderrBuf, code);
      } catch {
        base.exitReason = code === 0 ? "success" : "error";
      }

      // In quiet mode, print the final result summary
      if (!streamMode && base.summary) {
        process.stdout.write(base.summary + "\n");
      }

      resolve(base);
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      spinner?.stop();
      if (err.code === "ENOENT") {
        reject(new Error(
          `"${cmd}" not found. Is ${adapter.name} installed and in your PATH?\n` +
          `  Run "harnessctl doctor" to check agent health.`,
        ));
      } else if (err.code === "EACCES") {
        reject(new Error(
          `Permission denied running "${cmd}". Check file permissions.\n` +
          `  Try: chmod +x $(which ${cmd})`,
        ));
      } else {
        reject(new Error(`Failed to start ${cmd}: ${err.message}`));
      }
    });
  });
}
