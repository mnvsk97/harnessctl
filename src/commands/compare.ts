import { loadAgentConfig, resolveEnv } from "../config.ts";
import { getAdapter, checkAuth, listAdapterNames } from "../adapters/registry.ts";
import { invoke } from "../invoke.ts";
import { writeRunLog } from "../log.ts";
import { separator, c } from "../ui.ts";
import { ensureGitignore } from "../lib/handoff.ts";
import type { InvokeIntent } from "../adapters/types.ts";
import type { RunResult } from "../adapters/types.ts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface CompareOptions {
  prompt: string;
  extraArgs: string[];
  agents?: string[];
  pipedInput?: string;
  judge?: string;
}

interface AgentOutcome {
  agent: string;
  result: RunResult | null;
  error: string | null;
  runId?: string;
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

function writeCompareReport(
  cwd: string,
  compareId: string,
  prompt: string,
  outcomes: AgentOutcome[],
  judgeOutcome?: AgentOutcome,
): string {
  const dir = join(cwd, ".harnessctl", "compare");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  ensureGitignore(cwd);

  const lines: string[] = [
    `# Compare: ${compareId}`,
    "",
    "## Prompt",
    prompt,
    "",
    "## Results",
    "",
  ];

  for (const outcome of outcomes) {
    lines.push(`### ${outcome.agent}`);
    if (outcome.runId) lines.push(`Run ID: ${outcome.runId}`);
    if (outcome.error || !outcome.result) {
      lines.push("Status: failed");
      lines.push(`Error: ${outcome.error ?? "unknown error"}`);
    } else {
      const r = outcome.result;
      lines.push(`Status: ${r.exitCode === 0 ? "success" : "failed"}`);
      lines.push(`Duration: ${r.duration.toFixed(1)}s`);
      if (r.tokens) lines.push(`Tokens: ${r.tokens.input + r.tokens.output}`);
      if (r.cost != null) lines.push(`Cost: $${r.cost.toFixed(4)}`);
      if (r.errorDetail) lines.push(`Error detail: ${r.errorDetail}`);
      lines.push("");
      lines.push(r.summary || "(no summary)");
    }
    lines.push("");
  }

  if (judgeOutcome) {
    lines.push("## Judge", "");
    lines.push(`Agent: ${judgeOutcome.agent}`);
    if (judgeOutcome.runId) lines.push(`Run ID: ${judgeOutcome.runId}`);
    if (judgeOutcome.result) {
      lines.push(`Status: ${judgeOutcome.result.exitCode === 0 ? "success" : "failed"}`);
      lines.push("");
      lines.push(judgeOutcome.result.summary || "(no summary)");
    } else {
      lines.push("Status: failed");
      lines.push(`Error: ${judgeOutcome.error ?? "unknown error"}`);
    }
    lines.push("");
  }

  const path = join(dir, `${compareId}.md`);
  writeFileSync(path, lines.join("\n"));
  return path;
}

function buildJudgePrompt(prompt: string, outcomes: AgentOutcome[]): string {
  const lines: string[] = [
    "You are judging a harnessctl compare run.",
    "",
    "Original prompt:",
    prompt,
    "",
    "Agent outputs:",
    "",
  ];
  for (const outcome of outcomes) {
    lines.push(`## ${outcome.agent}`);
    if (outcome.runId) lines.push(`Run ID: ${outcome.runId}`);
    if (outcome.error || !outcome.result) {
      lines.push(`Failed: ${outcome.error ?? "unknown error"}`);
    } else {
      lines.push(outcome.result.summary || "(no summary)");
    }
    lines.push("");
  }
  lines.push("Return a concise judgment with: winner, what each did well, and one concrete harnessctl improvement.");
  return lines.join("\n");
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(c.dim(`  skipping ${agentName}: ${message}`));
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
        const result = await invoke(adapterRef, intent, agentConfigRef, { printSummary: false });
        const runId = writeRunLog(agent, opts.prompt, cwd, result);
        return { agent, result, error: null, runId };
      } catch (err) {
        return { agent, result: null, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  separator();
  console.error(c.dim("── compare outputs " + "─".repeat(41)));
  separator();

  for (const outcome of outcomes) {
    console.error(`${c.bold(outcome.agent)}${outcome.runId ? c.dim(` (${outcome.runId})`) : ""}`);
    if (outcome.error || outcome.result === null) {
      console.error(`${c.red("✗")} ${outcome.error ?? "unknown error"}`);
    } else if (outcome.result.summary) {
      console.error(outcome.result.summary);
    } else {
      console.error(c.dim("(no summary)"));
    }
    separator();
  }

  let judgeOutcome: AgentOutcome | undefined;
  if (opts.judge) {
    const judgeConfig = loadAgentConfig(opts.judge);
    const judgeAdapter = getAdapter(opts.judge, judgeConfig);
    const auth = checkAuth(judgeAdapter);
    if (!auth.ok) {
      judgeOutcome = { agent: opts.judge, result: null, error: auth.message };
    } else {
      const judgeIntent: InvokeIntent = {
        prompt: buildJudgePrompt(opts.prompt, outcomes),
        model: judgeConfig.model,
        cwd,
        extraArgs: [...(judgeConfig.extra_args ?? []), ...opts.extraArgs],
        env: resolveEnv(judgeConfig.env ?? {}),
      };
      try {
        const result = await invoke(judgeAdapter, judgeIntent, judgeConfig, { printSummary: false });
        const runId = writeRunLog(opts.judge, `Judge compare: ${opts.prompt}`, cwd, result);
        judgeOutcome = { agent: opts.judge, result, error: null, runId };
        console.error(`${c.bold("judge")} ${c.dim(`${opts.judge}${runId ? ` (${runId})` : ""}`)}`);
        console.error(result.summary || c.dim("(no summary)"));
        separator();
      } catch (err) {
        judgeOutcome = { agent: opts.judge, result: null, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  separator();
  console.error(c.dim("── compare results " + "─".repeat(41)));
  separator();

  for (const outcome of outcomes) {
    const { agent, result, error } = outcome;
    const nameCol = agent.padEnd(8);

    if (error || result === null) {
      const msg = error ?? "unknown error";
      const durationStr = "—";
      console.error(`  ${c.red("✗")}  ${nameCol}  ${durationStr}  ${c.dim(outcome.runId ?? "no-run-id")}`);
      console.error(`    ${c.dim(truncateSummary(msg))}`);
    } else {
      const icon = result.exitCode === 0 ? c.green("✓") : c.red("✗");
      const durationStr = `${result.duration.toFixed(1)}s`.padEnd(6);
      const costStr = formatCost(result.cost).padEnd(9);
      const tokensStr = formatTokens(result.tokens);
      console.error(`  ${icon}  ${nameCol}  ${durationStr}  ${costStr}  ${tokensStr}  ${c.dim(outcome.runId ?? "no-run-id")}`);
      if (result.summary) {
        console.error(`    ${c.dim(truncateSummary(result.summary, 120))}`);
      }
      if (result.errorDetail) {
        console.error(`    ${c.dim(`error: ${truncateSummary(result.errorDetail, 120)}`)}`);
      }
    }

    separator();
  }

  const compareId = `${Date.now()}-compare`;
  const reportPath = writeCompareReport(cwd, compareId, opts.prompt, outcomes, judgeOutcome);
  console.error(c.dim(`  report: ${reportPath}`));

  const anySuccess = outcomes.some(
    (o) => o.result !== null && o.result.exitCode === 0,
  );
  return anySuccess ? 0 : 1;
}
