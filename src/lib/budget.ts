import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RUNS_DIR } from "../config.ts";
import type { RunLog } from "../log.ts";

let cache: { key: string; spend: Map<string, number> } | null = null;

/**
 * Sum today's USD spend across run logs. When `agent` is given, filter to that
 * agent only; otherwise return the total. Memoized per process.
 */
export function todaySpend(agent?: string): number {
  const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (!cache || cache.key !== todayKey) {
    cache = { key: todayKey, spend: computeSpendForDate(todayKey) };
  }
  if (agent) return cache.spend.get(agent) ?? 0;
  let total = 0;
  for (const v of cache.spend.values()) total += v;
  return total;
}

function computeSpendForDate(date: string): Map<string, number> {
  const out = new Map<string, number>();
  let files: string[];
  try { files = readdirSync(RUNS_DIR); } catch { return out; }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const log = JSON.parse(readFileSync(join(RUNS_DIR, f), "utf-8")) as RunLog;
      if (!log.timestamp?.startsWith(date)) continue;
      const cost = log.result?.cost ?? 0;
      if (!cost) continue;
      out.set(log.agent, (out.get(log.agent) ?? 0) + cost);
    } catch { /* skip */ }
  }
  return out;
}
