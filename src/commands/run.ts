import { createInterface } from "node:readline";
import { loadConfig, loadAgentConfig, resolveEnv, isKnownAgent } from "../config.ts";
import { getAdapter, checkAuth, listAdapterNames } from "../adapters/registry.ts";
import { invoke } from "../invoke.ts";
import { saveSession, loadSession, loadLastSession } from "../session.ts";
import { writeRunLog } from "../log.ts";
import type { InvokeIntent, AgentConfig } from "../adapters/types.ts";

export interface RunOptions {
  agent?: string;
  resume?: boolean;
  prompt: string;
  extraArgs: string[];
  pipedInput?: string;
}

/** Prompt user with a yes/no question on the terminal. Works cross-platform. */
function askConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    let input: NodeJS.ReadableStream;
    if (process.stdin.isTTY) {
      input = process.stdin;
    } else {
      // When stdin is piped, open the controlling terminal directly.
      // /dev/tty on macOS/Linux, CON on Windows.
      const ttyPath = process.platform === "win32" ? "CON" : "/dev/tty";
      try {
        input = require("node:fs").createReadStream(ttyPath);
      } catch {
        // No terminal available (e.g. CI, headless) — decline fallback silently
        console.error(`\x1b[2m[harnessctl] no terminal available, skipping fallback prompt\x1b[0m`);
        resolve(false);
        return;
      }
    }

    const rl = createInterface({ input, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase().startsWith("y"));
    });
  });
}

/** Run a single agent invocation. Returns the exit code. */
async function invokeAgent(
  agentName: string,
  agentConfig: AgentConfig,
  opts: RunOptions,
  cwd: string,
): Promise<{ exitCode: number; summary: string }> {
  const adapter = getAdapter(agentName, agentConfig);

  // Pre-flight auth check
  const auth = checkAuth(adapter);
  if (!auth.ok) {
    console.error(`\x1b[31m[harnessctl] ${agentName}: ${auth.message}\x1b[0m`);
    console.error(`\x1b[2m[harnessctl] tip: run "harnessctl doctor" for detailed diagnostics\x1b[0m`);
    return { exitCode: 1, summary: "" };
  }
  console.error(`\x1b[2m[harnessctl] ${agentName}: ${auth.message}\x1b[0m`);

  let prompt = opts.prompt;

  // Prepend piped stdin if present
  if (opts.pipedInput) {
    prompt = `${opts.pipedInput}\n\n${prompt}`;
  }

  let resumeId: string | undefined;

  if (opts.resume) {
    const agentSession = loadSession(cwd, agentName);
    if (agentSession?.sessionId) {
      resumeId = agentSession.sessionId;
    } else {
      const lastSession = loadLastSession(cwd);
      if (lastSession && lastSession.agent !== agentName && lastSession.summary) {
        prompt = `Previous context from ${lastSession.agent}:\n${lastSession.summary}\n\n${prompt}`;
      }
    }
  }

  const env = resolveEnv(agentConfig.env ?? {});
  const intent: InvokeIntent = {
    prompt,
    model: agentConfig.model,
    resumeId,
    cwd,
    extraArgs: [...(agentConfig.extra_args ?? []), ...opts.extraArgs],
    env,
  };

  console.error(`\x1b[2m[harnessctl] agent=${agentName} cwd=${cwd}\x1b[0m`);

  let result = await invoke(adapter, intent, agentConfig);

  // Auto-retry fresh if resume failed (Paperclip's pattern)
  if (resumeId && result.exitCode !== 0) {
    console.error(`\x1b[2m[harnessctl] resume failed, retrying fresh...\x1b[0m`);
    intent.resumeId = undefined;
    result = await invoke(adapter, intent, agentConfig);
  }

  // Save session
  saveSession(cwd, agentName, result.sessionId, result.summary);

  // Write run log
  writeRunLog(agentName, opts.prompt, cwd, result);

  // Print summary
  if (result.cost != null || result.tokens) {
    const parts: string[] = [];
    if (result.tokens) parts.push(`tokens: ${result.tokens.input}in/${result.tokens.output}out`);
    if (result.cost != null) parts.push(`cost: $${result.cost.toFixed(4)}`);
    parts.push(`duration: ${result.duration.toFixed(1)}s`);
    console.error(`\x1b[2m[harnessctl] ${parts.join(" | ")}\x1b[0m`);
  }

  return { exitCode: result.exitCode ?? 1, summary: result.summary };
}

export async function runCommand(opts: RunOptions): Promise<number> {
  const globalConfig = loadConfig();
  const agentName = opts.agent ?? globalConfig.default_agent;

  if (!isKnownAgent(agentName, listAdapterNames())) {
    const known = listAdapterNames();
    console.error(`\x1b[31m[harnessctl] unknown agent: "${agentName}"\x1b[0m`);
    console.error(`\x1b[2m[harnessctl] available agents: ${known.join(", ")}\x1b[0m`);
    console.error(`\x1b[2m[harnessctl] tip: add a config at ~/.harnessctl/agents/${agentName}.yaml or use --agent <name>\x1b[0m`);
    return 1;
  }

  const agentConfig = loadAgentConfig(agentName);
  const cwd = process.cwd();

  try {
    const { exitCode, summary } = await invokeAgent(agentName, agentConfig, opts, cwd);

    // Success — no fallback needed
    if (exitCode === 0) return 0;

    // Agent failed — check for configured fallback
    const fallbackName = agentConfig.fallback;
    if (!fallbackName) return exitCode;

    console.error("");
    console.error(`\x1b[33m[harnessctl] ${agentName} failed (exit ${exitCode})\x1b[0m`);
    console.error(`\x1b[36m[harnessctl] fallback configured → ${fallbackName}\x1b[0m`);

    const shouldFallback = await askConfirm(
      `[harnessctl] Hand off to ${fallbackName}? (y/n) `,
    );

    if (!shouldFallback) {
      console.error(`\x1b[2m[harnessctl] fallback declined\x1b[0m`);
      return exitCode;
    }

    // Build fallback prompt — carry context from failed agent
    const fallbackConfig = loadAgentConfig(fallbackName);
    const fallbackPrompt = summary
      ? `Previous context from ${agentName}:\n${summary}\n\n${opts.prompt}`
      : opts.prompt;

    console.error(`\x1b[2m[harnessctl] handing off to ${fallbackName}...\x1b[0m`);

    const fallbackOpts: RunOptions = {
      ...opts,
      agent: fallbackName,
      prompt: fallbackPrompt,
      resume: false, // fresh start on fallback agent
    };

    const fallbackResult = await invokeAgent(fallbackName, fallbackConfig, fallbackOpts, cwd);

    // Check for chained fallback (fallback's fallback)
    if (fallbackResult.exitCode !== 0) {
      const chainedFallback = fallbackConfig.fallback;
      if (chainedFallback && chainedFallback !== agentName) {
        console.error("");
        console.error(`\x1b[33m[harnessctl] ${fallbackName} also failed (exit ${fallbackResult.exitCode})\x1b[0m`);
        console.error(`\x1b[36m[harnessctl] chained fallback configured → ${chainedFallback}\x1b[0m`);

        const shouldChain = await askConfirm(
          `[harnessctl] Hand off to ${chainedFallback}? (y/n) `,
        );

        if (shouldChain) {
          const chainedConfig = loadAgentConfig(chainedFallback);
          const chainedPrompt = fallbackResult.summary
            ? `Previous context from ${fallbackName}:\n${fallbackResult.summary}\n\n${opts.prompt}`
            : opts.prompt;

          console.error(`\x1b[2m[harnessctl] handing off to ${chainedFallback}...\x1b[0m`);

          const chainedResult = await invokeAgent(
            chainedFallback,
            chainedConfig,
            { ...opts, agent: chainedFallback, prompt: chainedPrompt, resume: false },
            cwd,
          );
          return chainedResult.exitCode;
        }
      }
    }

    return fallbackResult.exitCode;
  } catch (err: any) {
    console.error(`\x1b[31m[harnessctl] ${err.message}\x1b[0m`);

    // Even on crash, try fallback if configured
    const fallbackName = agentConfig.fallback;
    if (fallbackName) {
      console.error(`\x1b[36m[harnessctl] fallback configured → ${fallbackName}\x1b[0m`);
      const shouldFallback = await askConfirm(
        `[harnessctl] Hand off to ${fallbackName}? (y/n) `,
      );
      if (shouldFallback) {
        const fallbackConfig = loadAgentConfig(fallbackName);
        console.error(`\x1b[2m[harnessctl] handing off to ${fallbackName}...\x1b[0m`);
        const fallbackResult = await invokeAgent(
          fallbackName,
          fallbackConfig,
          { ...opts, agent: fallbackName, resume: false },
          cwd,
        );
        return fallbackResult.exitCode;
      }
    }

    return 1;
  }
}
