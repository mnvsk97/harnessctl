import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RUNS_DIR } from "../config.ts";
import { computeStats } from "../lib/stats.ts";
import { c, separator } from "../ui.ts";
import type { RunLog } from "../log.ts";

export { computeStats } from "../lib/stats.ts";
export type { AgentStats } from "../lib/stats.ts";

const SPARK = "▁▂▃▄▅▆▇█";

function sparkline(values: number[]): string {
  const max = Math.max(0, ...values);
  if (max === 0) return SPARK[0].repeat(values.length);
  return values.map((v) => SPARK[Math.min(SPARK.length - 1, Math.round((v / max) * (SPARK.length - 1)))]).join("");
}

/** Last-N-days cost per agent, ordered oldest → newest. */
function costByAgentDay(days: number): Map<string, { days: string[]; costs: number[] }> {
  const todayUTC = new Date();
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(todayUTC);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  const idx = new Map(dates.map((d, i) => [d, i]));
  const out = new Map<string, { days: string[]; costs: number[] }>();

  let files: string[];
  try { files = readdirSync(RUNS_DIR); } catch { files = []; }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    let log: RunLog;
    try { log = JSON.parse(readFileSync(join(RUNS_DIR, f), "utf-8")); } catch { continue; }
    const cost = log.result?.cost;
    if (!cost) continue;
    const date = log.timestamp?.slice(0, 10);
    const i = date ? idx.get(date) : undefined;
    if (i == null) continue;
    if (!out.has(log.agent)) out.set(log.agent, { days: dates, costs: new Array(days).fill(0) });
    out.get(log.agent)!.costs[i] += cost;
  }
  return out;
}

function costView(): void {
  const days = 14;
  const data = costByAgentDay(days);
  if (data.size === 0) {
    console.log("No cost data yet. Run some prompts first.");
    return;
  }
  const COL = { agent: 12, today: 10, week: 10, total: 10, spark: days + 2 };
  const pad  = (s: string, n: number) => s.padEnd(n);
  const padL = (s: string, n: number) => s.padStart(n);

  console.log(
    pad(c.bold("agent"), COL.agent) +
    padL(c.bold("today"), COL.today) +
    padL(c.bold("7d"), COL.week) +
    padL(c.bold("14d"), COL.total) +
    "  " + c.bold(`last ${days}d`),
  );
  console.log(c.dim("─".repeat(COL.agent + COL.today + COL.week + COL.total + 2 + days)));

  const sorted = [...data.entries()].sort(([, a], [, b]) => sum(b.costs) - sum(a.costs));
  for (const [agent, { costs }] of sorted) {
    const today = costs[costs.length - 1];
    const week = sum(costs.slice(-7));
    const total = sum(costs);
    console.log(
      pad(agent, COL.agent) +
      padL(`$${today.toFixed(4)}`, COL.today) +
      padL(`$${week.toFixed(4)}`, COL.week) +
      padL(`$${total.toFixed(4)}`, COL.total) +
      "  " + sparkline(costs),
    );
  }
  separator();
}

function sum(xs: number[]): number { let t = 0; for (const x of xs) t += x; return t; }

export function statsCommand(argv: string[] = []): void {
  if (argv.includes("--cost") || argv.includes("-c")) {
    costView();
    return;
  }

  const stats = computeStats(RUNS_DIR);
  if (stats.size === 0) {
    console.log("No runs logged yet. Run `harnessctl run` to get started.");
    return;
  }

  const COL = { agent: 12, runs: 6, success: 9, avgCost: 11, avgTokens: 12, avgDuration: 13 };
  const pad  = (s: string, n: number) => s.padEnd(n);
  const padL = (s: string, n: number) => s.padStart(n);

  console.log(
    pad(c.bold("agent"), COL.agent) +
    padL(c.bold("runs"), COL.runs) +
    padL(c.bold("success"), COL.success) +
    padL(c.bold("avg cost"), COL.avgCost) +
    padL(c.bold("avg tokens"), COL.avgTokens) +
    padL(c.bold("avg duration"), COL.avgDuration),
  );
  console.log(c.dim("─".repeat(COL.agent + COL.runs + COL.success + COL.avgCost + COL.avgTokens + COL.avgDuration)));

  for (const [agent, s] of [...stats.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const successRate = `${s.successRate.toFixed(0)}%`;
    const avgCost = s.avgCost != null ? `$${s.avgCost.toFixed(4)}` : "—";
    const avgTokens = s.avgTokens != null ? String(Math.round(s.avgTokens)) : "—";
    const avgDuration = `${s.avgDuration.toFixed(1)}s`;

    console.log(
      pad(agent, COL.agent) +
      padL(String(s.total), COL.runs) +
      padL(successRate, COL.success) +
      padL(avgCost, COL.avgCost) +
      padL(avgTokens, COL.avgTokens) +
      padL(avgDuration, COL.avgDuration),
    );
  }

  separator();
}
