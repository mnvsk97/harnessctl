import { loadRunLog } from "../log.ts";
import { findSessionByRunId, createSession, addRun } from "../session.ts";
import type { HarnessSessionRun } from "../session.ts";
import { getAdapter, listAdapterNames } from "../adapters/registry.ts";
import { loadAgentConfig, isKnownAgent } from "../config.ts";
import { buildHandoffPrompt, getChangedFiles } from "../lib/handoff.ts";
import { runCommand, type RunOptions } from "./run.ts";
import { c, askConfirm } from "../ui.ts";

function usage(): void {
  console.error(`Usage: harnessctl handoff <run-id> --agent <name> [--resume|--fork] [--budget <usd>] <prompt>`);
  console.error(c.dim(`  tip: run "harnessctl logs" to see available run IDs`));
}

export async function handoffCommand(argv: string[]): Promise<number> {
  if (argv.length === 0) { usage(); return 1; }

  // Parse args
  let runId: string | undefined;
  let targetAgent: string | undefined;
  let forceResume = false;
  let forceFork = false;
  let budget: number | undefined;
  const promptParts: string[] = [];
  const extraArgs: string[] = [];
  let seenSeparator = false;

  for (let i = 0; i < argv.length; i++) {
    if (seenSeparator) { extraArgs.push(argv[i]); continue; }
    if (argv[i] === "--") { seenSeparator = true; continue; }
    if (argv[i] === "--agent" && i + 1 < argv.length) { targetAgent = argv[++i]; continue; }
    if (argv[i] === "--resume") { forceResume = true; continue; }
    if (argv[i] === "--fork") { forceFork = true; continue; }
    if (argv[i] === "--budget" && i + 1 < argv.length) { budget = parseFloat(argv[++i]); continue; }
    if (!runId) { runId = argv[i]; continue; }
    promptParts.push(argv[i]);
  }

  if (!runId) {
    console.error(`${c.red("✗")} missing run ID`);
    usage();
    return 1;
  }

  if (!targetAgent) {
    console.error(`${c.red("✗")} --agent is required for handoff`);
    usage();
    return 1;
  }

  const userPrompt = promptParts.join(" ");
  if (!userPrompt) {
    console.error(`${c.red("✗")} missing prompt — tell the next agent what to do`);
    usage();
    return 1;
  }

  const knownAgents = listAdapterNames();
  if (!isKnownAgent(targetAgent, knownAgents)) {
    console.error(`${c.red("✗")} unknown agent: "${targetAgent}"`);
    console.error(c.dim(`  available: ${knownAgents.join(", ")}`));
    return 1;
  }

  // Load source run
  const sourceLog = loadRunLog(runId);
  if (!sourceLog) {
    console.error(`${c.red("✗")} run "${runId}" not found`);
    console.error(c.dim(`  tip: run "harnessctl logs" to see available run IDs`));
    return 1;
  }

  const cwd = process.cwd();

  // Find or create harness session
  let session = findSessionByRunId(cwd, runId);
  if (!session) {
    // Retroactive session for old runs that predate the session system
    session = createSession(cwd);
    const retroRun: HarnessSessionRun = {
      runId,
      agent: sourceLog.agent,
      agentSessionId: sourceLog.result.sessionId,
      summary: sourceLog.result.summary ?? "",
      timestamp: sourceLog.timestamp,
    };
    addRun(cwd, session.id, retroRun);
  }

  const sourceAgent = sourceLog.agent;
  const sameAgent = sourceAgent === targetAgent;

  // Same-agent handoff: resume vs fork
  let shouldResume = false;
  if (sameAgent) {
    const adapter = getAdapter(targetAgent, loadAgentConfig(targetAgent));
    const hasResume = !!adapter.argMap.resume;

    if (!hasResume) {
      if (forceResume) {
        console.error(c.yellow(`⚠ ${targetAgent} doesn't support session resume, forking with transcript`));
      }
      shouldResume = false;
    } else if (forceResume) {
      shouldResume = true;
    } else if (forceFork) {
      shouldResume = false;
    } else if (process.stdin.isTTY) {
      // Interactive prompt
      console.error(`${c.cyan("→")} "${runId}" was a ${sourceAgent} session.`);
      shouldResume = await askConfirm(`  [r]esume same session or [f]ork with transcript? (r/f) `);
    }
  }

  // Build the prompt for the target agent
  let finalPrompt: string;

  if (shouldResume) {
    // Same-agent resume: just pass the user's new prompt, native --resume handles context
    finalPrompt = userPrompt;
  } else {
    // Fork or cross-agent: build lean handoff prompt with pointer to context file
    const sourceRun = session.runs.find((r) => r.runId === runId);
    const changedFiles = getChangedFiles(cwd, sourceRun?.preCommitSha);

    finalPrompt = buildHandoffPrompt(
      runId,
      sourceAgent,
      sourceLog.prompt,
      sourceLog.result.summary ?? "",
      changedFiles,
      userPrompt,
    );
  }

  // Build run options
  const runOpts: RunOptions = {
    agent: targetAgent,
    resume: shouldResume,
    prompt: finalPrompt,
    extraArgs,
    harnessSessionId: session.id,
    parentRunId: runId,
    ...(budget != null ? { budget } : {}),
  };

  return runCommand(runOpts);
}
