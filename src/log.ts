import { writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RUNS_DIR, ensureInit } from "./config.ts";
import type { RunResult } from "./adapters/types.ts";

export interface RunLog {
  agent: string;
  prompt: string;
  cwd: string;
  result: RunResult;
  timestamp: string;
  /** Model override used for this run, if any. Optional for back-compat. */
  model?: string;
  /** Passthrough extra args given after `--`. Optional for back-compat. */
  extraArgs?: string[];
}

export function writeRunLog(
  agent: string,
  prompt: string,
  cwd: string,
  result: RunResult,
  extras?: { model?: string; extraArgs?: string[] },
): string {
  ensureInit();
  const log: RunLog = {
    agent,
    prompt,
    cwd,
    result,
    timestamp: new Date().toISOString(),
    ...(extras?.model ? { model: extras.model } : {}),
    ...(extras?.extraArgs && extras.extraArgs.length ? { extraArgs: extras.extraArgs } : {}),
  };
  const filename = `${Date.now()}-${agent}.json`;
  const path = join(RUNS_DIR, filename);
  writeFileSync(path, JSON.stringify(log, null, 2));
  return filename.replace(/\.json$/, "");
}

/**
 * Load a run log by id (filename prefix or full filename).
 * The id is the part before `.json` — e.g. "1713364500000-claude".
 */
export function loadRunLog(id: string): RunLog | null {
  ensureInit();
  const target = id.endsWith(".json") ? id : `${id}.json`;
  let files: string[];
  try { files = readdirSync(RUNS_DIR); } catch { return null; }
  // Exact match first, else prefix match (handy for short timestamp prefixes).
  const match = files.find((f) => f === target)
    ?? files.find((f) => f.startsWith(id));
  if (!match) return null;
  try {
    return JSON.parse(readFileSync(join(RUNS_DIR, match), "utf-8")) as RunLog;
  } catch { return null; }
}
