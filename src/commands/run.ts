import { homedir } from "node:os";
import { loadConfig, loadAgentConfig, resolveEnv, isKnownAgent, RUNS_DIR } from "../config.ts";
import { getAdapter, checkAuth, listAdapterNames } from "../adapters/registry.ts";
import { invoke } from "../invoke.ts";
import { saveSession, loadSession, loadLastSession } from "../session.ts";
import { writeRunLog } from "../log.ts";
import { header, footer, separator, rule, c, askConfirm } from "../ui.ts";
import { computeStats } from "../lib/stats.ts";
import type { InvokeIntent, AgentConfig } from "../adapters/types.ts";

export interface RunOptions {
  agent?: string;
  resume?: boolean;
  cheapest?: boolean;
  fastest?: boolean;
  prompt: string;
  extraArgs: string[];
  pipedInput?: string;
}

function pickBestAgent(by: "cost" | "speed", knownAgents: string[]): string | undefined {
  const stats = computeStats(RUNS_DIR);
  let best: string | undefined;
  let bestVal = Infinity;
  for (const [agent, s] of stats) {
    if (!knownAgents.includes(agent)) continue;
    // For speed: only consider agents with at least one successful run to avoid
    // biasing toward agents that fail fast.
    const val = by === "cost" ? (s.avgCost ?? Infinity) : (s.avgSuccessDuration ?? Infinity);
    if (val < bestVal) { bestVal = val; best = agent; }
  }
  return best;
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
    header(c.red("harnessctl"));
    console.error(`  ${c.red("✗")} ${agentName}: ${auth.message}`);
    console.error(`  ${c.dim("tip: run \"harnessctl doctor\" for detailed diagnostics")}`);
    footer();
    return { exitCode: 1, summary: "" };
  }

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

  const cwdShort = cwd.replace(homedir(), "~");
  header(c.bold("harnessctl"), [agentName, auth.message, cwdShort]);
  rule();

  const result = await invoke(adapter, intent, agentConfig);

  // Save session
  saveSession(cwd, agentName, result.sessionId, result.summary);

  // Write run log
  writeRunLog(agentName, opts.prompt, cwd, result);

  // Print result footer
  rule();
  const stats: string[] = [];
  if (result.tokens) stats.push(`tokens: ${result.tokens.input}in/${result.tokens.output}out`);
  if (result.cost != null) stats.push(`cost: $${result.cost.toFixed(4)}`);
  stats.push(`duration: ${result.duration.toFixed(1)}s`);
  const icon = result.exitCode === 0 ? c.green("✓") : c.red("✗");
  footer([`${icon} ${agentName}`, ...stats]);

  return { exitCode: result.exitCode ?? 1, summary: result.summary };
}

export async function runCommand(opts: RunOptions): Promise<number> {
  const globalConfig = loadConfig();
  const knownAgents = listAdapterNames();
  let agentName = opts.agent ?? globalConfig.default_agent;

  if (!opts.agent) {
    if (opts.cheapest) {
      agentName = pickBestAgent("cost", knownAgents) ?? agentName;
      console.error(c.dim(`  selected cheapest agent: ${agentName}`));
    } else if (opts.fastest) {
      agentName = pickBestAgent("speed", knownAgents) ?? agentName;
      console.error(c.dim(`  selected fastest agent: ${agentName}`));
    }
  }

  if (!isKnownAgent(agentName, knownAgents)) {
    console.error(`${c.red("✗")} unknown agent: "${agentName}"`);
    console.error(c.dim(`  available: ${knownAgents.join(", ")}`));
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

    separator();
    console.error(`${c.yellow("⚠")} ${agentName} failed (exit ${exitCode})`);
    console.error(`${c.cyan("→")} fallback: ${fallbackName}`);

    const shouldFallback = await askConfirm(
      `[harnessctl] Hand off to ${fallbackName}? (y/n) `,
    );

    if (!shouldFallback) {
      console.error(c.dim("  fallback declined"));
      return exitCode;
    }

    // Build fallback prompt — carry context from failed agent
    const fallbackConfig = loadAgentConfig(fallbackName);
    const fallbackPrompt = summary
      ? `Previous context from ${agentName}:\n${summary}\n\n${opts.prompt}`
      : opts.prompt;

    console.error(c.dim(`  handing off to ${fallbackName}...`));

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
        separator();
        console.error(`${c.yellow("⚠")} ${fallbackName} also failed (exit ${fallbackResult.exitCode})`);
        console.error(`${c.cyan("→")} chained fallback: ${chainedFallback}`);

        const shouldChain = await askConfirm(
          `[harnessctl] Hand off to ${chainedFallback}? (y/n) `,
        );

        if (shouldChain) {
          const chainedConfig = loadAgentConfig(chainedFallback);
          const chainedPrompt = fallbackResult.summary
            ? `Previous context from ${fallbackName}:\n${fallbackResult.summary}\n\n${opts.prompt}`
            : opts.prompt;

          console.error(c.dim(`  handing off to ${chainedFallback}...`));

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
    console.error(`${c.red("✗")} ${err.message}`);

    // Even on crash, try fallback if configured
    const fallbackName = agentConfig.fallback;
    if (fallbackName) {
      console.error(`${c.cyan("→")} fallback: ${fallbackName}`);
      const shouldFallback = await askConfirm(
        `[harnessctl] Hand off to ${fallbackName}? (y/n) `,
      );
      if (shouldFallback) {
        const fallbackConfig = loadAgentConfig(fallbackName);
        console.error(c.dim(`  handing off to ${fallbackName}...`));
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
