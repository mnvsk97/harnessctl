import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunLog } from "../log.ts";

export interface AgentStats {
  agent: string;
  total: number;
  successRate: number;
  avgCost: number | null;
  avgTokens: number | null;
  avgDuration: number;
}

export function computeStats(runsDir: string): Map<string, AgentStats> {
  let files: string[];
  try {
    files = readdirSync(runsDir).filter((f) => f.endsWith(".json"));
  } catch {
    return new Map();
  }

  const grouped = new Map<
    string,
    { successes: number; costs: number[]; tokens: number[]; durations: number[] }
  >();

  for (const file of files) {
    let log: RunLog;
    try {
      log = JSON.parse(readFileSync(join(runsDir, file), "utf-8"));
    } catch {
      continue;
    }

    const agent = log.agent;
    if (!agent) continue;

    if (!grouped.has(agent)) {
      grouped.set(agent, { successes: 0, costs: [], tokens: [], durations: [] });
    }

    const entry = grouped.get(agent)!;

    if (log.result.exitCode === 0) entry.successes++;

    if (log.result.cost != null) entry.costs.push(log.result.cost);

    if (log.result.tokens != null) {
      entry.tokens.push(log.result.tokens.input + log.result.tokens.output);
    }

    entry.durations.push(log.result.duration);
  }

  const stats = new Map<string, AgentStats>();

  for (const [agent, entry] of grouped) {
    const total = entry.durations.length;
    stats.set(agent, {
      agent,
      total,
      successRate: total > 0 ? (entry.successes / total) * 100 : 0,
      avgCost: entry.costs.length > 0
        ? entry.costs.reduce((a, b) => a + b, 0) / entry.costs.length
        : null,
      avgTokens: entry.tokens.length > 0
        ? entry.tokens.reduce((a, b) => a + b, 0) / entry.tokens.length
        : null,
      avgDuration: total > 0
        ? entry.durations.reduce((a, b) => a + b, 0) / total
        : 0,
    });
  }

  return stats;
}
