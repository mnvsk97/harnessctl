import type { Turn, AgentConfig, RunResult } from "../adapters/types.ts";
import { getAdapter } from "../adapters/registry.ts";

/** Rough ~4 chars/token heuristic, good enough for cross-provider budgeting. */
const tokens = (s: string) => Math.ceil(s.length / 4);

/**
 * Format turns as a compact markdown block suitable for prepending to a
 * fallback agent's prompt. Drops oldest turns first when over budget.
 */
export function formatTranscript(
  turns: Turn[],
  opts: { maxTokens?: number; fromAgent?: string } = {},
): string {
  if (turns.length === 0) return "";
  const maxTokens = opts.maxTokens ?? 40_000;
  const fromAgent = opts.fromAgent ?? "previous agent";

  const render = (t: Turn) => `**${t.role === "user" ? "User" : "Assistant"}:** ${t.content}`;
  const pieces = turns.map(render);

  // Drop from the front until we fit.
  let total = pieces.reduce((s, p) => s + tokens(p), 0);
  let start = 0;
  while (total > maxTokens && start < pieces.length - 1) {
    total -= tokens(pieces[start]);
    start++;
  }
  const kept = pieces.slice(start);
  const truncated = start > 0 ? " (truncated to fit context)" : "";
  return `## Previous conversation with ${fromAgent}${truncated}\n\n${kept.join("\n\n")}\n`;
}

/** Extract & format a transcript from a failed/source agent for the next agent. */
export async function buildTranscriptBlock(
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
