/**
 * harnessctl SDK — programmatic API for Node/Bun/Deno
 *
 * Import from this module to invoke agents without shelling out.
 *
 * @example
 *   import { run, compare, getStats } from "harnessctl/sdk";
 *
 *   const result = await run("fix the auth bug", { agent: "claude" });
 *   console.log(result.summary, result.cost, result.duration);
 *
 *   const results = await compare("fix the auth bug", { agents: ["claude", "codex"] });
 *   for (const [agent, r] of results) console.log(agent, r.exitCode);
 *
 *   const stats = getStats();
 *   for (const [agent, s] of stats) console.log(agent, s.successRate);
 */

import { loadConfig, loadAgentConfig, resolveEnv, ensureInit, RUNS_DIR } from "../src/config.ts";
import { getAdapter } from "../src/adapters/registry.ts";
import { invoke } from "../src/invoke.ts";
import { saveSession, loadSession, loadLastSession } from "../src/session.ts";
import { writeRunLog } from "../src/log.ts";
import { computeStats } from "../src/lib/stats.ts";
import type { InvokeIntent } from "../src/adapters/types.ts";

// ── Re-export public types ────────────────────────────────────────────────────

export type { RunResult } from "../src/adapters/types.ts";
export type { AgentStats } from "../src/lib/stats.ts";

// ── SDK option types ──────────────────────────────────────────────────────────

export interface RunSDKOptions {
  /** Agent to use. Defaults to the value in ~/.harnessctl/config.yaml. */
  agent?: string;
  /** Model override passed to the adapter's argMap. */
  model?: string;
  /** Resume the last session for this agent + cwd, or hand off context. */
  resume?: boolean;
  /** Extra args appended verbatim to the agent CLI invocation. */
  extraArgs?: string[];
  /** Additional environment variables merged into the subprocess env. */
  env?: Record<string, string>;
  /** Working directory for the agent. Defaults to process.cwd(). */
  cwd?: string;
}

export interface CompareSDKOptions {
  /** Agents to run in parallel. Defaults to all known built-in agents. */
  agents?: string[];
  /** Extra args passed to every agent invocation. */
  extraArgs?: string[];
  /** Additional environment variables merged into every subprocess env. */
  env?: Record<string, string>;
  /** Working directory for all agents. Defaults to process.cwd(). */
  cwd?: string;
}

// ── run() ─────────────────────────────────────────────────────────────────────

/**
 * Invoke a single agent headlessly and return the structured result.
 *
 * Unlike the CLI, this function does NOT print headers/footers — it is
 * designed for programmatic use where the caller owns the output.
 */
export async function run(
  prompt: string,
  opts: RunSDKOptions = {},
): Promise<import("../src/adapters/types.ts").RunResult> {
  ensureInit();

  const globalConfig = loadConfig();
  const agentName = opts.agent ?? globalConfig.default_agent;
  const agentConfig = loadAgentConfig(agentName);
  const adapter = getAdapter(agentName, agentConfig);
  const cwd = opts.cwd ?? process.cwd();

  let resolvedPrompt = prompt;
  let resumeId: string | undefined;

  if (opts.resume) {
    const agentSession = loadSession(cwd, agentName);
    if (agentSession?.sessionId) {
      resumeId = agentSession.sessionId;
    } else {
      // Cross-agent handoff: prepend summary from last session
      const lastSession = loadLastSession(cwd);
      if (lastSession && lastSession.agent !== agentName && lastSession.summary) {
        resolvedPrompt = `Previous context from ${lastSession.agent}:\n${lastSession.summary}\n\n${prompt}`;
      }
    }
  }

  // Merge env: agent config → caller-supplied
  const baseEnv = resolveEnv(agentConfig.env ?? {});
  const mergedEnv: Record<string, string> = { ...baseEnv, ...(opts.env ?? {}) };

  const intent: InvokeIntent = {
    prompt: resolvedPrompt,
    model: opts.model ?? agentConfig.model,
    resumeId,
    cwd,
    extraArgs: [...(agentConfig.extra_args ?? []), ...(opts.extraArgs ?? [])],
    env: mergedEnv,
  };

  const result = await invoke(adapter, intent, agentConfig);

  // Persist session + run log (same as the CLI)
  saveSession(cwd, agentName, result.sessionId, result.summary);
  writeRunLog(agentName, prompt, cwd, result);

  return result;
}

// ── compare() ─────────────────────────────────────────────────────────────────

/**
 * Run the same prompt against multiple agents in parallel and return a map of
 * agent name → RunResult.
 *
 * Agents that fail to start or return a non-zero exit code are still included
 * in the map; inspect `result.exitCode` to detect failures.
 */
export async function compare(
  prompt: string,
  opts: CompareSDKOptions = {},
): Promise<Map<string, import("../src/adapters/types.ts").RunResult>> {
  ensureInit();

  // Default to all configured built-in agents when none are specified
  const { listAdapterNames } = await import("../src/adapters/registry.ts");
  const agents = opts.agents ?? listAdapterNames();

  const entries = await Promise.all(
    agents.map(async (agent) => {
      try {
        const result = await run(prompt, {
          agent,
          extraArgs: opts.extraArgs,
          env: opts.env,
          cwd: opts.cwd,
        });
        return [agent, result] as const;
      } catch (err: any) {
        // Return a synthetic failure result so the map always has every agent
        const failure: import("../src/adapters/types.ts").RunResult = {
          exitCode: 1,
          summary: err?.message ?? "agent invocation failed",
          duration: 0,
        };
        return [agent, failure] as const;
      }
    }),
  );

  return new Map(entries);
}

// ── getStats() ────────────────────────────────────────────────────────────────

/**
 * Read all run logs from ~/.harnessctl/runs/ and return aggregate stats per
 * agent (success rate, average cost, average token count, average duration).
 *
 * Returns an empty Map when no runs have been recorded yet.
 */
export function getStats(): Map<string, import("../src/lib/stats.ts").AgentStats> {
  ensureInit();
  return computeStats(RUNS_DIR);
}
