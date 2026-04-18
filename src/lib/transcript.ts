import type { Turn } from "../adapters/types.ts";

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
