import { loadAgentConfig, resolveEnv } from "../config.ts";
import { getAdapter, checkAuth, listAdapterNames } from "../adapters/registry.ts";
import { invoke } from "../invoke.ts";
import { writeRunLog } from "../log.ts";
import { separator, rule, c } from "../ui.ts";
import type { InvokeIntent } from "../adapters/types.ts";
import type { RunResult } from "../adapters/types.ts";

export interface CompareOptions {
  prompt: string;
  extraArgs: string[];
  agents?: string[];
  pipedInput?: string;
}

interface AgentOutcome {
  agent: string;
  result: RunResult | null;
  error: string | null;
}

function formatCost(cost: number | undefined): string {
  if (cost == null) return "—";
  return `$${cost.toFixed(4)}`;
}

function formatTokens(tokens: { input: number; output: number } | undefined): string {
  if (tokens == null) return "—";
  return `${tokens.input + tokens.output} tokens`;
}

function truncateSummary(summary: string, maxLen = 60): string {
  const first = summary.split("\n")[0].trim();
  return first.length > maxLen ? first.slice(0, maxLen - 1) + "…" : first;
}

export async function compareCommand(opts: CompareOptions): Promise<number> {
  const agentNames = opts.agents && opts.agents.length > 0
    ? opts.agents
    : listAdapterNames();

  const cwd = process.cwd();

  const prompt = opts.pipedInput
    ? `${opts.pipedInput}\n\n${opts.prompt}`
    : opts.prompt;

  type AgentTask = {
    agent: string;
    intent: InvokeIntent;
    adapterRef: ReturnType<typeof getAdapter>;
    agentConfigRef: ReturnType<typeof loadAgentConfig>;
  };

  const validTasks: AgentTask[] = [];

  for (const agentName of agentNames) {
    const agentConfig = loadAgentConfig(agentName);
    let adapter: ReturnType<typeof getAdapter>;
    try {
      adapter = getAdapter(agentName, agentConfig);
    } catch (err: any) {
      console.error(c.dim(`  skipping ${agentName}: ${err.message}`));
      continue;
    }

    const auth = checkAuth(adapter);
    if (!auth.ok) {
      console.error(c.dim(`  skipping ${agentName}: ${auth.message}`));
      continue;
    }

    const intent: InvokeIntent = {
      prompt,
      model: agentConfig.model,
      cwd,
      extraArgs: [...(agentConfig.extra_args ?? []), ...opts.extraArgs],
      env: resolveEnv(agentConfig.env ?? {}),
    };

    validTasks.push({ agent: agentName, intent, adapterRef: adapter, agentConfigRef: agentConfig });
  }

  if (validTasks.length === 0) {
    console.error(`${c.red("✗")} no agents available for comparison`);
    return 1;
  }

  const outcomes: AgentOutcome[] = await Promise.all(
    validTasks.map(async ({ agent, intent, adapterRef, agentConfigRef }) => {
      try {
        const result = await invoke(adapterRef, intent, agentConfigRef);
        writeRunLog(agent, opts.prompt, cwd, result);
        return { agent, result, error: null };
      } catch (err: any) {
        return { agent, result: null, error: err.message ?? String(err) };
      }
    }),
  );

  separator();
  console.error(c.dim("── compare results " + "─".repeat(41)));
  separator();

  for (const outcome of outcomes) {
    const { agent, result, error } = outcome;
    const nameCol = agent.padEnd(8);

    if (error || result === null) {
      const msg = error ?? "unknown error";
      const durationStr = "—";
      console.error(`  ${c.red("✗")}  ${nameCol}  ${durationStr}`);
      console.error(`    ${c.dim(truncateSummary(msg))}`);
    } else {
      const icon = result.exitCode === 0 ? c.green("✓") : c.red("✗");
      const durationStr = `${result.duration.toFixed(1)}s`.padEnd(6);
      const costStr = formatCost(result.cost).padEnd(9);
      const tokensStr = formatTokens(result.tokens);
      console.error(`  ${icon}  ${nameCol}  ${durationStr}  ${costStr}  ${tokensStr}`);
      if (result.summary) {
        console.error(`    ${c.dim(truncateSummary(result.summary))}`);
      }
    }

    separator();
  }

  const anySuccess = outcomes.some(
    (o) => o.result !== null && o.result.exitCode === 0,
  );
  return anySuccess ? 0 : 1;
}
