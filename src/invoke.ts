import { spawn } from "node:child_process";
import type { Adapter, AgentConfig, InvokeIntent, RunResult } from "./adapters/types.ts";
import { buildCommand } from "./adapters/registry.ts";
import { defaultDetectExitReason } from "./adapters/_shared.ts";

const DEFAULT_TIMEOUT_SECONDS = 300;
const KILL_GRACE_PERIOD_MS = 5000;

export function invoke(
  adapter: Adapter,
  intent: InvokeIntent,
  agentConfig: AgentConfig,
): Promise<RunResult> {
  const { cmd, args, stdin: stdinData, warnings } = buildCommand(adapter, intent);

  // Surface warnings for unsupported flags
  for (const w of warnings) {
    console.error(`[harnessctl] warning: ${w}`);
  }

  const timeout = agentConfig.timeout ?? DEFAULT_TIMEOUT_SECONDS;
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: intent.cwd,
      env: { ...process.env, ...intent.env },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });

    let stdoutBuf = "";
    let stderrBuf = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutBuf += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuf += text;
      process.stderr.write(text);
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
      resolve(base);
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
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
