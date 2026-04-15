import { spawn } from "node:child_process";
import type { Adapter, AgentConfig, InvokeIntent, RunResult } from "./adapters/types.ts";
import { buildCommand } from "./adapters/registry.ts";

export function invoke(
  adapter: Adapter,
  intent: InvokeIntent,
  agentConfig: AgentConfig,
): Promise<RunResult> {
  const { cmd, args, stdin: stdinData, warnings } = buildCommand(adapter, intent);

  // Surface warnings for unsupported flags
  for (const w of warnings) {
    console.error(`\x1b[33m[harnessctl] warning: ${w}\x1b[0m`);
  }

  const timeout = agentConfig.timeout ?? 300;
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
      }, 5000);
    }, timeout * 1000);

    child.on("close", (code) => {
      clearTimeout(timer);
      const duration = (Date.now() - start) / 1000;
      const parsed = adapter.parseOutput(stdoutBuf, stderrBuf);
      resolve({
        exitCode: code,
        summary: parsed.summary ?? "",
        sessionId: parsed.sessionId,
        cost: parsed.cost,
        tokens: parsed.tokens,
        duration,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn ${cmd}: ${err.message}`));
    });
  });
}
