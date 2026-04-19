import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/* ── Handoff context file ──────────────────────────────── */

export interface HandoffData {
  runId: string;
  agent: string;
  sessionId?: string;
  prompt: string;
  summary: string;
  duration: number;
  timestamp: string;
  changedFiles: string[];
  /** Path to the agent's native session file (JSONL, SQLite, etc.) */
  sessionFile?: string;
}

const HANDOFF_DIR = ".harnessctl/handoffs";

/** Write a handoff context file to {cwd}/.harnessctl/handoffs/{runId}.md */
export function writeHandoffFile(cwd: string, data: HandoffData): void {
  const dir = join(cwd, HANDOFF_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const lines: string[] = [
    `# Handoff: ${data.runId}`,
    "",
    `Agent: ${data.agent}`,
    ...(data.sessionId ? [`Session ID: ${data.sessionId}`] : []),
    `Started: ${data.timestamp}`,
    `Duration: ${data.duration.toFixed(1)}s`,
    "",
    "## Task",
    data.prompt,
    "",
    "## Summary",
    data.summary || "(no summary available)",
    "",
  ];

  if (data.changedFiles.length > 0) {
    lines.push("## Files Changed");
    for (const f of data.changedFiles) lines.push(`- ${f}`);
    lines.push("");
  }

  // Point to the session file — let the receiving agent decide what to read
  if (data.sessionFile) {
    lines.push("## Session File");
    lines.push(data.sessionFile);
    lines.push("");
  }

  writeFileSync(join(dir, `${data.runId}.md`), lines.join("\n"));
}

/* ── Lean handoff prompt ───────────────────────────────── */

/** Build a lean prompt block for the target agent (summary + pointer, not full transcript). */
export function buildHandoffPrompt(
  runId: string,
  agent: string,
  prompt: string,
  summary: string,
  changedFiles: string[],
  userPrompt: string,
): string {
  const lines: string[] = [
    `## Handoff from ${agent} (run ${runId})`,
    "",
    `Task: ${prompt}`,
    `Summary: ${summary || "(no summary)"}`,
  ];

  if (changedFiles.length > 0) {
    lines.push(`Files changed: ${changedFiles.join(", ")}`);
  }

  lines.push(`Full context: ${HANDOFF_DIR}/${runId}.md`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(userPrompt);

  return lines.join("\n");
}

/* ── Git helpers ───────────────────────────────────────── */

/** Get the current git HEAD SHA, or undefined if not a git repo. */
export function getHeadSha(cwd: string): string | undefined {
  try {
    const proc = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
    if (proc.status === 0 && proc.stdout.trim()) return proc.stdout.trim();
  } catch { /* not a git repo */ }
  return undefined;
}

/** Get files changed between a commit SHA and current HEAD. */
export function getChangedFiles(cwd: string, preCommitSha?: string): string[] {
  if (!preCommitSha) return [];
  try {
    const proc = spawnSync("git", ["diff", "--name-only", preCommitSha, "HEAD"], { cwd, encoding: "utf8" });
    if (proc.status === 0 && proc.stdout.trim()) {
      return proc.stdout.trim().split("\n").filter(Boolean);
    }
  } catch { /* git not available */ }
  return [];
}

/* ── .gitignore management ─────────────────────────────── */

const GITIGNORE_ENTRY = ".harnessctl/";

/** Ensure .harnessctl/ is in the project's .gitignore. */
export function ensureGitignore(cwd: string): void {
  const gitignorePath = join(cwd, ".gitignore");
  try {
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, "utf-8");
      if (content.includes(GITIGNORE_ENTRY)) return;
      // Append with a newline guard
      const nl = content.endsWith("\n") ? "" : "\n";
      appendFileSync(gitignorePath, `${nl}${GITIGNORE_ENTRY}\n`);
    } else {
      writeFileSync(gitignorePath, `${GITIGNORE_ENTRY}\n`);
    }
  } catch { /* ignore — not critical */ }
}
