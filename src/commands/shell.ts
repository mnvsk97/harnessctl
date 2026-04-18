import { spawn } from "node:child_process";
import { loadConfig, loadAgentConfig, resolveEnv, isKnownAgent } from "../config.ts";
import { getAdapter, checkAuth, listAdapterNames } from "../adapters/registry.ts";
import { createSession, addRun } from "../session.ts";
import type { HarnessSessionRun } from "../session.ts";
import { writeRunLog } from "../log.ts";
import { writeHandoffFile, getHeadSha, getChangedFiles, ensureGitignore } from "../lib/handoff.ts";
import { header, separator, c, askConfirm } from "../ui.ts";

export interface ShellOptions {
  agent?: string;
  extraArgs: string[];
}

/**
 * Interactive command map: agent name -> bare command + args for REPL mode.
 * These strip all headless/pipe flags so the agent owns the terminal.
 */
const interactiveBase: Record<string, { cmd: string; args: string[] }> = {
  claude:   { cmd: "claude", args: [] },
  codex:    { cmd: "codex", args: [] },
  opencode: { cmd: "opencode", args: [] },
  gemini:   { cmd: "gemini", args: [] },
  cursor:   { cmd: "cursor-agent", args: [] },
};

/** Launch an interactive shell for a single agent. Returns the exit code. */
function launchShell(
  agentName: string,
  env: Record<string, string>,
  args: string[],
): Promise<number> {
  const base = interactiveBase[agentName];
  return new Promise((resolve) => {
    const child = spawn(base.cmd, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: "inherit",
    });

    child.on("close", (code) => {
      resolve(code ?? 0);
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        console.error(`${c.red("✗")} "${base.cmd}" not found in PATH`);
        console.error(c.dim(`  tip: run "harnessctl doctor" to check agent health`));
      } else {
        console.error(`${c.red("✗")} failed to start ${base.cmd}: ${err.message}`);
      }
      resolve(1);
    });
  });
}

/** Build the args array for an agent shell. */
function buildShellArgs(agentName: string, agentConfig: ReturnType<typeof loadAgentConfig>, extraArgs: string[]): string[] {
  const adapter = getAdapter(agentName, agentConfig);
  const base = interactiveBase[agentName];
  const args = [...base.args];

  if (agentConfig.model && adapter.argMap.model) {
    args.push(...adapter.argMap.model(agentConfig.model));
  }

  args.push(...(agentConfig.extra_args ?? []), ...extraArgs);
  return args;
}

/** Post-shell: discover session from agent logs, save session + run log + handoff file. */
async function trackShellSession(
  agentName: string,
  agentConfig: ReturnType<typeof loadAgentConfig>,
  cwd: string,
  startedAt: number,
  exitCode: number,
  preCommitSha?: string,
): Promise<void> {
  const adapter = getAdapter(agentName, agentConfig);
  const duration = (Date.now() - startedAt) / 1000;

  // Discover native session ID from agent's on-disk logs
  let agentSessionId: string | undefined;
  let discoverSummary: string | undefined;
  try {
    if (adapter.discoverSession) {
      const disc = await adapter.discoverSession(cwd, startedAt);
      agentSessionId = disc.sessionId;
      discoverSummary = disc.summary;
    }
  } catch { /* best effort */ }

  // Extract transcript if possible
  let turns: import("../adapters/types.ts").Turn[] = [];
  try {
    if (adapter.extractTranscript) {
      turns = await adapter.extractTranscript(cwd, agentSessionId, startedAt);
    }
  } catch { /* best effort */ }

  // Build summary from transcript or discovery
  let summary = discoverSummary ?? "";
  if (!summary && turns.length > 0) {
    const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant");
    if (lastAssistant) summary = lastAssistant.content.slice(0, 200);
  }
  if (!summary) summary = "(interactive shell)";

  // Create harness session
  const session = createSession(cwd);
  const result = { exitCode, summary, sessionId: agentSessionId, duration, exitReason: exitCode === 0 ? "success" as const : "error" as const };

  const runId = writeRunLog(agentName, "(interactive shell)", cwd, result, {
    harnessSessionId: session.id,
  });

  const changedFiles = getChangedFiles(cwd, preCommitSha);
  const sessionRun: HarnessSessionRun = {
    runId,
    agent: agentName,
    agentSessionId,
    summary,
    timestamp: new Date().toISOString(),
    preCommitSha,
  };
  addRun(cwd, session.id, sessionRun);

  ensureGitignore(cwd);
  writeHandoffFile(cwd, {
    runId,
    agent: agentName,
    sessionId: agentSessionId,
    prompt: "(interactive shell)",
    summary,
    duration,
    timestamp: sessionRun.timestamp,
    changedFiles,
    turns,
  });

  console.error(c.dim(`  run: ${runId}  session: ${session.id}`));
}

export async function shellCommand(opts: ShellOptions): Promise<number> {
  const globalConfig = loadConfig();
  const agentName = opts.agent ?? globalConfig.default_agent;

  if (!isKnownAgent(agentName, listAdapterNames())) {
    const known = listAdapterNames();
    console.error(`${c.red("✗")} unknown agent: "${agentName}"`);
    console.error(c.dim(`  available: ${known.join(", ")}`));
    return 1;
  }

  const agentConfig = loadAgentConfig(agentName);
  const adapter = getAdapter(agentName, agentConfig);

  // Pre-flight auth check
  const auth = checkAuth(adapter);
  if (!auth.ok) {
    console.error(`${c.red("✗")} ${agentName}: ${auth.message}`);
    console.error(c.dim(`  tip: run "harnessctl doctor" for diagnostics`));

    // Auth failed — offer fallback if configured
    const fallbackName = agentConfig.fallback;
    if (fallbackName && isKnownAgent(fallbackName, listAdapterNames()) && interactiveBase[fallbackName]) {
      separator();
      console.error(`${c.cyan("→")} fallback available: ${c.bold(fallbackName)}`);

      const shouldFallback = await askConfirm(
        `[harnessctl] ${agentName} auth failed. Launch ${fallbackName} instead? (y/n) `,
      );

      if (shouldFallback) {
        return shellCommand({ ...opts, agent: fallbackName });
      }
    }

    return 1;
  }

  if (!interactiveBase[agentName]) {
    console.error(`${c.red("✗")} shell mode not supported for "${agentName}"`);
    return 1;
  }

  const args = buildShellArgs(agentName, agentConfig, opts.extraArgs);
  const env = resolveEnv(agentConfig.env ?? {});

  header(c.bold("harnessctl shell"), [agentName, auth.message]);
  separator();

  const cwd = process.cwd();
  const preCommitSha = getHeadSha(cwd);
  const startedAt = Date.now();

  const exitCode = await launchShell(agentName, env, args);

  // Post-shell session tracking: discover session from agent logs
  await trackShellSession(agentName, agentConfig, cwd, startedAt, exitCode, preCommitSha);

  // Agent exited cleanly — done
  if (exitCode === 0) return 0;

  // Agent failed — check for configured fallback
  const fallbackName = agentConfig.fallback;
  if (!fallbackName) return exitCode;

  if (!isKnownAgent(fallbackName, listAdapterNames()) || !interactiveBase[fallbackName]) {
    console.error(c.dim(`  fallback "${fallbackName}" is not available for shell mode`));
    return exitCode;
  }

  separator();
  console.error(`${c.yellow("⚠")} ${agentName} exited with code ${exitCode}`);
  console.error(`${c.cyan("→")} fallback available: ${c.bold(fallbackName)}`);

  const shouldFallback = await askConfirm(
    `[harnessctl] Hand off to ${fallbackName}? (y/n) `,
  );

  if (!shouldFallback) {
    console.error(c.dim("  fallback declined"));
    return exitCode;
  }

  // Launch fallback agent shell
  const fallbackConfig = loadAgentConfig(fallbackName);
  const fallbackAdapter = getAdapter(fallbackName, fallbackConfig);

  const fallbackAuth = checkAuth(fallbackAdapter);
  if (!fallbackAuth.ok) {
    console.error(`${c.red("✗")} ${fallbackName}: ${fallbackAuth.message}`);
    console.error(c.dim(`  tip: run "harnessctl doctor" for diagnostics`));
    return 1;
  }

  const fallbackArgs = buildShellArgs(fallbackName, fallbackConfig, opts.extraArgs);
  const fallbackEnv = resolveEnv(fallbackConfig.env ?? {});

  console.error(c.dim(`  handing off to ${fallbackName}...`));
  separator();
  header(c.bold("harnessctl shell"), [fallbackName, fallbackAuth.message, c.yellow("fallback")]);
  separator();

  const fallbackExitCode = await launchShell(fallbackName, fallbackEnv, fallbackArgs);

  // Check for chained fallback (fallback's fallback)
  if (fallbackExitCode !== 0) {
    const chainedName = fallbackConfig.fallback;
    if (chainedName && chainedName !== agentName && isKnownAgent(chainedName, listAdapterNames()) && interactiveBase[chainedName]) {
      separator();
      console.error(`${c.yellow("⚠")} ${fallbackName} also exited with code ${fallbackExitCode}`);
      console.error(`${c.cyan("→")} chained fallback: ${c.bold(chainedName)}`);

      const shouldChain = await askConfirm(
        `[harnessctl] Hand off to ${chainedName}? (y/n) `,
      );

      if (shouldChain) {
        const chainedConfig = loadAgentConfig(chainedName);
        const chainedAdapter = getAdapter(chainedName, chainedConfig);
        const chainedAuth = checkAuth(chainedAdapter);
        if (!chainedAuth.ok) {
          console.error(`${c.red("✗")} ${chainedName}: ${chainedAuth.message}`);
          return 1;
        }

        const chainedArgs = buildShellArgs(chainedName, chainedConfig, opts.extraArgs);
        const chainedEnv = resolveEnv(chainedConfig.env ?? {});

        console.error(c.dim(`  handing off to ${chainedName}...`));
        separator();
        header(c.bold("harnessctl shell"), [chainedName, chainedAuth.message, c.yellow("fallback")]);
        separator();

        return launchShell(chainedName, chainedEnv, chainedArgs);
      }
    }
  }

  return fallbackExitCode;
}
