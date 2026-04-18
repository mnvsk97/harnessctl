import { homedir } from "node:os";
import { loadConfig, loadAgentConfig, resolveEnv, isKnownAgent, RUNS_DIR } from "../config.ts";
import { getAdapter, checkAuth, listAdapterNames } from "../adapters/registry.ts";
import { invoke } from "../invoke.ts";
import { saveSession, loadSession, loadLastSession } from "../session.ts";
import { writeRunLog } from "../log.ts";
import { header, footer, separator, rule, c, askConfirm } from "../ui.ts";
import { computeStats } from "../lib/stats.ts";
import { getContext } from "../lib/context.ts";
import { loadTemplate, interpolate } from "../lib/templates.ts";
import { todaySpend } from "../lib/budget.ts";
import { formatTranscript } from "../lib/transcript.ts";
import type { InvokeIntent, AgentConfig, ExitReason, Turn, RunResult } from "../adapters/types.ts";

export interface RunOptions {
  agent?: string;
  resume?: boolean;
  cheapest?: boolean;
  fastest?: boolean;
  prompt: string;
  extraArgs: string[];
  pipedInput?: string;
  /** Named template under ~/.harnessctl/templates/ to wrap the prompt in. */
  template?: string;
  /** Per-run budget cap in USD for today across this agent. */
  budget?: number;
}

function pickBestAgent(by: "cost" | "speed", knownAgents: string[]): string | undefined {
  const stats = computeStats(RUNS_DIR);
  let best: string | undefined;
  let bestVal = Infinity;
  for (const [agent, s] of stats) {
    if (!knownAgents.includes(agent)) continue;
    const val = by === "cost" ? (s.avgCost ?? Infinity) : (s.avgSuccessDuration ?? Infinity);
    if (val < bestVal) { bestVal = val; best = agent; }
  }
  return best;
}

/** Build the final prompt string sent to the subprocess: template → context → transcript → piped → user prompt. */
function buildPrompt(
  userPrompt: string,
  opts: RunOptions,
  cwd: string,
  transcriptBlock: string,
): string {
  let body = userPrompt;

  // 1) Template wraps the user's prompt as {{ARGS}}.
  if (opts.template) {
    const tpl = loadTemplate(opts.template);
    if (tpl) {
      body = interpolate(tpl, userPrompt);
    } else {
      console.error(c.yellow(`⚠ template "${opts.template}" not found in ~/.harnessctl/templates/, using raw prompt`));
    }
  }

  // 2) Prepend piped stdin (file contents, error log, etc.).
  if (opts.pipedInput) body = `${opts.pipedInput}\n\n${body}`;

  // 3) Prepend previous-agent transcript (only set during auto-failover handoff).
  if (transcriptBlock) body = `${transcriptBlock}\n${body}`;

  // 4) Prepend project context (the persistent "about this codebase" file).
  const ctx = getContext(cwd);
  if (ctx.trim()) {
    body = `# Project context\n${ctx.trim()}\n\n${body}`;
  }

  return body;
}

/** Build a terminal RunResult for preflight failures (auth/budget). */
function failResult(reason: ExitReason): RunResult {
  return { exitCode: 1, summary: "", duration: 0, exitReason: reason };
}

/** Invoke a single agent. Returns the full RunResult for fallback decisions. */
async function invokeAgent(
  agentName: string,
  agentConfig: AgentConfig,
  opts: RunOptions,
  cwd: string,
  transcriptBlock: string,
): Promise<RunResult> {
  const adapter = getAdapter(agentName, agentConfig);

  // Pre-flight auth check
  const auth = checkAuth(adapter);
  if (!auth.ok) {
    header(c.red("harnessctl"));
    console.error(`  ${c.red("✗")} ${agentName}: ${auth.message}`);
    console.error(`  ${c.dim("tip: run \"harnessctl doctor\" for detailed diagnostics")}`);
    footer();
    return failResult("auth_error");
  }

  // Budget preflight (opts.budget overrides agentConfig.budget_daily)
  const budget = opts.budget ?? agentConfig.budget_daily;
  if (budget != null && budget > 0) {
    const spent = todaySpend(agentName);
    if (spent >= budget) {
      console.error(`${c.red("✗")} ${agentName}: daily budget $${budget.toFixed(2)} reached ($${spent.toFixed(4)} spent today)`);
      return failResult("error");
    }
    if (spent > 0.8 * budget) {
      console.error(c.yellow(`⚠ ${agentName}: $${spent.toFixed(4)} of $${budget.toFixed(2)} daily budget used`));
    }
  }

  // Session resume (same agent only)
  let resumeId: string | undefined;
  if (opts.resume) {
    const agentSession = loadSession(cwd, agentName);
    if (agentSession?.sessionId) resumeId = agentSession.sessionId;
  }

  const prompt = buildPrompt(opts.prompt, opts, cwd, transcriptBlock);

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

  // Write run log (with raw user prompt, not the augmented one)
  writeRunLog(agentName, opts.prompt, cwd, result, {
    model: agentConfig.model,
    extraArgs: opts.extraArgs,
  });

  // Result footer
  rule();
  const stats: string[] = [];
  if (result.tokens) {
    let tok = `tokens: ${result.tokens.input}in/${result.tokens.output}out`;
    if (result.tokens.cacheWrite) tok += `/${result.tokens.cacheWrite}cw`;
    if (result.tokens.cacheRead)  tok += `/${result.tokens.cacheRead}cr`;
    stats.push(tok);
  }
  if (result.cost != null) stats.push(`cost: $${result.cost.toFixed(4)}`);
  stats.push(`duration: ${result.duration.toFixed(1)}s`);
  if (result.exitReason && result.exitReason !== "success") stats.push(`reason: ${result.exitReason}`);
  const icon = result.exitCode === 0 && result.exitReason !== "rate_limit" && result.exitReason !== "token_limit"
    ? c.green("✓") : c.red("✗");
  footer([`${icon} ${agentName}`, ...stats]);

  // Ensure exitReason is always set (defensive — invoke() already sets it).
  if (!result.exitReason) result.exitReason = result.exitCode === 0 ? "success" : "error";
  return result;
}

/** True if the reason justifies a silent automatic handoff. */
function isLimitReason(r: ExitReason): boolean {
  return r === "rate_limit" || r === "token_limit" || r === "auth_error";
}

/** Extract & format a transcript from the failed agent for the next agent. */
async function buildTranscriptBlock(
  failedAgentName: string,
  failedAgentConfig: AgentConfig,
  failedResult: RunResult,
  nextAgentName: string,
  nextAgentConfig: AgentConfig,
  cwd: string,
  startedAt: number,
): Promise<string> {
  const summaryBlock = failedResult.summary
    ? `Previous context from ${failedAgentName}:\n${failedResult.summary}\n`
    : "";
  const mode = failedAgentConfig.failover_transfer ?? "transcript";
  if (mode === "summary") return summaryBlock;
  try {
    const adapter = getAdapter(failedAgentName, failedAgentConfig);
    if (!adapter.extractTranscript) return summaryBlock;
    const turns: Turn[] = await adapter.extractTranscript(cwd, failedResult.sessionId, startedAt);
    if (!turns.length) return summaryBlock;
    const nextAdapter = getAdapter(nextAgentName, nextAgentConfig);
    const maxTokens = Math.floor((nextAdapter.contextWindow ?? 100_000) * 0.4);
    return formatTranscript(turns, { maxTokens, fromAgent: failedAgentName });
  } catch {
    return summaryBlock;
  }
}

/**
 * Run `agentName`, and on failure optionally hand off to its fallback chain.
 * Silently auto-failovers on limit/auth reasons when `auto_failover: true`;
 * for other failures, prompts the user as before.
 */
async function runWithFallback(
  agentName: string,
  opts: RunOptions,
  cwd: string,
  transcriptBlock: string,
  visited: Set<string>,
): Promise<number> {
  if (visited.has(agentName)) {
    console.error(c.yellow(`⚠ fallback cycle detected at "${agentName}", stopping`));
    return 1;
  }
  visited.add(agentName);

  const agentConfig = loadAgentConfig(agentName);
  const result = await invokeAgent(agentName, agentConfig, opts, cwd, transcriptBlock);
  const exitCode = result.exitCode ?? 1;
  const exitReason = result.exitReason ?? "error";

  if (exitReason === "success" && exitCode === 0) return 0;

  const fallbackName = agentConfig.fallback;
  if (!fallbackName) return exitCode;

  separator();
  const auto = agentConfig.auto_failover === true && isLimitReason(exitReason);
  if (auto) {
    console.error(`${c.yellow("⚠")} ${agentName} hit ${exitReason} (auto-failover → ${fallbackName})`);
  } else {
    console.error(`${c.yellow("⚠")} ${agentName} failed (${exitReason}, exit ${exitCode})`);
    console.error(`${c.cyan("→")} fallback: ${fallbackName}`);
    const ok = await askConfirm(`[harnessctl] Hand off to ${fallbackName}? (y/n) `);
    if (!ok) {
      console.error(c.dim("  fallback declined"));
      return exitCode;
    }
  }

  // Build transcript block for the next agent
  const fallbackConfig = loadAgentConfig(fallbackName);
  const nextTranscript = await buildTranscriptBlock(
    agentName,
    agentConfig,
    result,
    fallbackName,
    fallbackConfig,
    cwd,
    Date.now() - Math.max(1, Math.floor(result.duration * 1000)),
  );

  console.error(c.dim(`  handing off to ${fallbackName}...`));
  const nextOpts: RunOptions = { ...opts, agent: fallbackName, resume: false };
  return runWithFallback(fallbackName, nextOpts, cwd, nextTranscript, visited);
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

  // Honor handoff from last session (only when user asked --resume and it's a different agent).
  let initialTranscript = "";
  if (opts.resume) {
    const agentSession = loadSession(process.cwd(), agentName);
    if (!agentSession?.sessionId) {
      const last = loadLastSession(process.cwd());
      if (last && last.agent !== agentName && last.summary) {
        initialTranscript = `Previous context from ${last.agent}:\n${last.summary}\n`;
      }
    }
  }

  const cwd = process.cwd();
  try {
    return await runWithFallback(agentName, opts, cwd, initialTranscript, new Set());
  } catch (err: any) {
    console.error(`${c.red("✗")} ${err.message}`);
    return 1;
  }
}
