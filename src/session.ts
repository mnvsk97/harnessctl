import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SESSIONS_DIR } from "./config.ts";
import { cwdHash } from "./lib/cwdHash.ts";

export interface SessionData {
  agent: string;
  sessionId?: string;
  summary: string;
  timestamp: string;
}

function sessionDir(cwd: string): string {
  const dir = join(SESSIONS_DIR, cwdHash(cwd));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveSession(cwd: string, agent: string, sessionId?: string, summary?: string): void {
  const dir = sessionDir(cwd);
  const data: SessionData = {
    agent,
    sessionId,
    summary: summary ?? "",
    timestamp: new Date().toISOString(),
  };
  // Save per-agent session
  writeFileSync(join(dir, `${agent}.json`), JSON.stringify(data, null, 2));
  // Save as "last" for handoff
  writeFileSync(join(dir, "last.json"), JSON.stringify(data, null, 2));
}

export function loadSession(cwd: string, agent: string): SessionData | null {
  const path = join(sessionDir(cwd), `${agent}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function loadLastSession(cwd: string): SessionData | null {
  const path = join(sessionDir(cwd), "last.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}
