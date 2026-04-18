import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SESSIONS_DIR } from "./config.ts";
import { cwdHash } from "./lib/cwdHash.ts";

/* ── Types ─────────────────────────────────────────────── */

export interface HarnessSessionRun {
  runId: string;
  agent: string;
  agentSessionId?: string;
  summary: string;
  timestamp: string;
  parentRunId?: string;
  preCommitSha?: string;
}

export interface HarnessSession {
  id: string;
  cwdHash: string;
  createdAt: string;
  runs: HarnessSessionRun[];
}

/* ── Helpers ───────────────────────────────────────────── */

function sessionsDir(cwd: string): string {
  const dir = join(SESSIONS_DIR, cwdHash(cwd));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const LATEST = "_latest.json";

function writeLatest(dir: string, id: string): void {
  writeFileSync(join(dir, LATEST), JSON.stringify({ id }));
}

/* ── Public API ────────────────────────────────────────── */

export function generateSessionId(): string {
  return randomUUID().slice(0, 8);
}

/** Create a new harness session with an empty runs list. */
export function createSession(cwd: string): HarnessSession {
  const dir = sessionsDir(cwd);
  const id = generateSessionId();
  const session: HarnessSession = {
    id,
    cwdHash: cwdHash(cwd),
    createdAt: new Date().toISOString(),
    runs: [],
  };
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(session, null, 2));
  writeLatest(dir, id);
  return session;
}

/** Append a run to an existing session. */
export function addRun(cwd: string, sessionId: string, run: HarnessSessionRun): void {
  const dir = sessionsDir(cwd);
  const path = join(dir, `${sessionId}.json`);
  if (!existsSync(path)) return;
  const session: HarnessSession = JSON.parse(readFileSync(path, "utf-8"));
  session.runs.push(run);
  writeFileSync(path, JSON.stringify(session, null, 2));
  writeLatest(dir, sessionId);
}

/** Load a session by its harness session ID. */
export function loadSession(cwd: string, sessionId: string): HarnessSession | null {
  const path = join(sessionsDir(cwd), `${sessionId}.json`);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
}

/** Load whichever session was most recently updated. */
export function loadLatestSession(cwd: string): HarnessSession | null {
  const dir = sessionsDir(cwd);
  const latestPath = join(dir, LATEST);
  if (!existsSync(latestPath)) return null;
  try {
    const { id } = JSON.parse(readFileSync(latestPath, "utf-8"));
    return loadSession(cwd, id);
  } catch { return null; }
}

/** Scan all session files in this cwd to find the one containing a given runId. */
export function findSessionByRunId(cwd: string, runId: string): HarnessSession | null {
  const dir = sessionsDir(cwd);
  let files: string[];
  try { files = readdirSync(dir); } catch { return null; }
  for (const file of files) {
    if (file === LATEST || !file.endsWith(".json")) continue;
    try {
      const session: HarnessSession = JSON.parse(readFileSync(join(dir, file), "utf-8"));
      if (session.runs?.some((r) => r.runId === runId)) return session;
    } catch { /* skip malformed */ }
  }
  return null;
}

/** Find the most recent run for a given agent within a session. */
export function latestRunForAgent(session: HarnessSession, agent: string): HarnessSessionRun | undefined {
  for (let i = session.runs.length - 1; i >= 0; i--) {
    if (session.runs[i].agent === agent) return session.runs[i];
  }
  return undefined;
}
