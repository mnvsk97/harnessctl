import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { RUNS_DIR, ensureInit } from "./config.js";
import type { RunResult } from "./adapters/types.js";

export interface RunLog {
  agent: string;
  prompt: string;
  cwd: string;
  result: RunResult;
  timestamp: string;
}

export function writeRunLog(agent: string, prompt: string, cwd: string, result: RunResult): void {
  ensureInit();
  const log: RunLog = {
    agent,
    prompt,
    cwd,
    result,
    timestamp: new Date().toISOString(),
  };
  const filename = `${Date.now()}-${agent}.json`;
  writeFileSync(join(RUNS_DIR, filename), JSON.stringify(log, null, 2));
}
