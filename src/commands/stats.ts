import { RUNS_DIR } from "../config.ts";
import { computeStats } from "../lib/stats.ts";
import { c, separator } from "../ui.ts";

export { computeStats } from "../lib/stats.ts";
export type { AgentStats } from "../lib/stats.ts";

export function statsCommand(): void {
  const stats = computeStats(RUNS_DIR);

  if (stats.size === 0) {
    console.log("No runs logged yet. Run `harnessctl run` to get started.");
    return;
  }

  const COL = { agent: 12, runs: 6, success: 9, avgCost: 11, avgTokens: 12, avgDuration: 13 };
  const pad  = (s: string, n: number) => s.padEnd(n);
  const padL = (s: string, n: number) => s.padStart(n);

  const headerRow =
    pad(c.bold("agent"), COL.agent) +
    padL(c.bold("runs"), COL.runs) +
    padL(c.bold("success"), COL.success) +
    padL(c.bold("avg cost"), COL.avgCost) +
    padL(c.bold("avg tokens"), COL.avgTokens) +
    padL(c.bold("avg duration"), COL.avgDuration);

  console.log(headerRow);
  console.log(c.dim("─".repeat(COL.agent + COL.runs + COL.success + COL.avgCost + COL.avgTokens + COL.avgDuration)));

  for (const [agent, s] of [...stats.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const successRate = `${s.successRate.toFixed(0)}%`;
    const avgCost = s.avgCost != null ? `$${s.avgCost.toFixed(4)}` : "—";
    const avgTokens = s.avgTokens != null ? String(Math.round(s.avgTokens)) : "—";
    const avgDuration = `${s.avgDuration.toFixed(1)}s`;

    const row =
      pad(agent, COL.agent) +
      padL(String(s.total), COL.runs) +
      padL(successRate, COL.success) +
      padL(avgCost, COL.avgCost) +
      padL(avgTokens, COL.avgTokens) +
      padL(avgDuration, COL.avgDuration);
    console.log(row);
  }

  separator();
}
