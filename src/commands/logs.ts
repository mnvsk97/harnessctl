import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { RUNS_DIR } from "../config.ts";
import type { RunLog } from "../log.ts";
import { c, separator } from "../ui.ts";

function readAllLogs(): { file: string; log: RunLog }[] {
  if (!existsSync(RUNS_DIR)) return [];
  const entries: { file: string; log: RunLog }[] = [];
  for (const file of readdirSync(RUNS_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = readFileSync(join(RUNS_DIR, file), "utf-8");
      entries.push({ file, log: JSON.parse(raw) as RunLog });
    } catch {
    }
  }
  return entries;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function logsCommand(args: string[]): void {
  let agentFilter: string | undefined;
  let limit = 20;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent" && args[i + 1]) {
      agentFilter = args[++i];
    } else if (args[i] === "--limit" && args[i + 1]) {
      const n = parseInt(args[++i], 10);
      if (!isNaN(n) && n > 0) limit = n;
    }
  }

  let entries = readAllLogs();

  entries.sort((a, b) => b.file.localeCompare(a.file));

  if (agentFilter) {
    entries = entries.filter((e) => e.log.agent === agentFilter);
  }

  entries = entries.slice(0, limit);

  if (entries.length === 0) {
    console.log("No runs logged yet.");
    return;
  }

  for (const { log } of entries) {
    const ts = c.dim(formatTimestamp(log.timestamp));
    const agent = c.cyan(log.agent.padEnd(10));
    const status = log.result.exitCode === 0 ? c.green("✓") : c.red("✗");
    const cost = log.result.cost !== undefined ? `$${log.result.cost.toFixed(4)}` : "—";
    const duration = `${log.result.duration.toFixed(1)}s`;
    const prompt = c.dim(`"${truncate(log.prompt, 50)}"`);
    console.log(`${ts}  ${agent}  ${status}  ${cost.padStart(8)}  ${duration.padStart(6)}  ${prompt}`);
  }

  separator();
}
