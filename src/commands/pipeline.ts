import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { PIPELINES_DIR, isKnownAgent } from "../config.ts";
import { listAdapterNames } from "../adapters/registry.ts";
import { createSession, loadSession, validateSessionName } from "../session.ts";
import { buildHandoffPrompt, getChangedFiles } from "../lib/handoff.ts";
import { runCommand, type RunOptions } from "./run.ts";
import { c, rule, header, footer, separator } from "../ui.ts";

/* ── Types ─────────────────────────────────────────────── */

export interface PipelineStage {
  agent: string;
  instruction: string;
  role?: string;
}

export interface PipelineOptions {
  prompt: string;
  stages: PipelineStage[];
  name?: string;
  stream?: boolean;
  budget?: number;
  extraArgs: string[];
}

/* ── Role instruction map ──────────────────────────────── */

const ROLE_INSTRUCTIONS: Record<string, string> = {
  plan:   "Create a detailed implementation plan for the following task. Do NOT write any code — only produce a plan.",
  build:  "Implement the following based on the plan from the previous stage.",
  review: "Review the implementation for bugs, edge cases, and improvements.",
  test:   "Write comprehensive tests for the implementation.",
};

/** Fixed execution order for role flags. */
const ROLE_ORDER = ["plan", "build", "review", "test"];

/* ── Preset loading ────────────────────────────────────── */

export function loadPreset(name: string): PipelineStage[] | null {
  const path = join(PIPELINES_DIR, `${name}.yaml`);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = YAML.parse(raw);
    if (!parsed?.stages || !Array.isArray(parsed.stages)) return null;
    return parsed.stages.map((s: Record<string, string>) => ({
      agent: s.agent,
      instruction: s.instruction ?? ROLE_INSTRUCTIONS[s.role] ?? s.role ?? "",
      role: s.role,
    }));
  } catch { return null; }
}

/* ── Pipeline execution ────────────────────────────────── */

export async function pipelineCommand(opts: PipelineOptions): Promise<number> {
  const knownAgents = listAdapterNames();

  // Validate session name
  if (opts.name && !validateSessionName(opts.name)) {
    console.error(`${c.red("✗")} invalid session name: "${opts.name}"`);
    console.error(c.dim("  names must be lowercase alphanumeric with hyphens/underscores, max 64 chars"));
    return 1;
  }

  // Validate stages
  if (opts.stages.length === 0) {
    console.error(`${c.red("✗")} pipeline needs at least one stage`);
    console.error(c.dim("  use --plan <agent>, --build <agent>, or --step <agent>:<instruction>"));
    return 1;
  }

  for (const stage of opts.stages) {
    if (!isKnownAgent(stage.agent, knownAgents)) {
      console.error(`${c.red("✗")} unknown agent: "${stage.agent}"`);
      console.error(c.dim(`  available: ${knownAgents.join(", ")}`));
      return 1;
    }
  }

  const cwd = process.cwd();

  // Create a named session for the entire pipeline
  const session = createSession(cwd, opts.name);
  const pipelineStart = Date.now();

  header(c.bold("pipeline"), [
    `${opts.stages.length} stages`,
    opts.stages.map((s) => s.agent).join(" → "),
    ...(opts.name ? [c.cyan(opts.name)] : []),
  ]);
  rule();

  const results: { agent: string; role?: string; exitCode: number; duration: number }[] = [];

  for (let i = 0; i < opts.stages.length; i++) {
    const stage = opts.stages[i];
    const stageLabel = stage.role ?? `step ${i + 1}`;
    const stageNum = `[${i + 1}/${opts.stages.length}]`;

    separator();
    console.error(`${c.cyan("→")} ${stageNum} ${c.bold(stage.agent)}:${stageLabel}`);

    let prompt: string;
    const stageStart = Date.now();

    if (i === 0) {
      // First stage: user prompt + stage instruction
      prompt = stage.instruction
        ? `${stage.instruction}\n\nTask: ${opts.prompt}`
        : opts.prompt;
    } else {
      // Subsequent stages: build handoff from previous run
      const reloaded = loadSession(cwd, session.id);
      const prevRun = reloaded?.runs[reloaded.runs.length - 1];

      if (!prevRun) {
        console.error(`${c.red("✗")} could not find previous stage's run in session`);
        return 1;
      }

      const changedFiles = getChangedFiles(cwd, prevRun.preCommitSha);
      const handoff = buildHandoffPrompt(
        prevRun.runId,
        prevRun.agent,
        opts.prompt,
        prevRun.summary,
        changedFiles,
        "",
      );

      prompt = stage.instruction
        ? `${handoff}\nOriginal task: ${opts.prompt}\n\nYour role in this pipeline: ${stage.instruction}`
        : `${handoff}\n${opts.prompt}`;
    }

    // Link to previous run via session
    let parentRunId: string | undefined;
    if (i > 0) {
      const reloaded = loadSession(cwd, session.id);
      const prevRun = reloaded?.runs[reloaded.runs.length - 1];
      if (prevRun) parentRunId = prevRun.runId;
    }

    const runOpts: RunOptions = {
      agent: stage.agent,
      prompt,
      extraArgs: opts.extraArgs,
      harnessSessionId: session.id,
      parentRunId,
      stream: opts.stream,
      budget: opts.budget,
      name: opts.name,
    };

    const exitCode = await runCommand(runOpts);
    const duration = (Date.now() - stageStart) / 1000;

    results.push({ agent: stage.agent, role: stage.role, exitCode, duration });

    if (exitCode !== 0) {
      separator();
      console.error(`${c.red("✗")} pipeline stopped at stage ${stageNum} (${stage.agent}:${stageLabel})`);
      printPipelineSummary(results, pipelineStart, opts.name);
      return exitCode;
    }
  }

  separator();
  printPipelineSummary(results, pipelineStart, opts.name);
  return 0;
}

function printPipelineSummary(
  results: { agent: string; role?: string; exitCode: number; duration: number }[],
  startTime: number,
  name?: string,
): void {
  const totalDuration = (Date.now() - startTime) / 1000;

  console.error(c.bold("Pipeline summary:"));
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const icon = r.exitCode === 0 ? c.green("✓") : c.red("✗");
    const label = r.role ?? `step ${i + 1}`;
    console.error(`  ${icon} ${r.agent}:${label} ${c.dim(`(${r.duration.toFixed(1)}s)`)}`);
  }

  const stats = [`total: ${totalDuration.toFixed(1)}s`];
  if (name) stats.push(c.cyan(name));
  footer(stats);
}

/* ── CLI arg parsing ───────────────────────────────────── */

export function parsePipelineArgs(argv: string[]): PipelineOptions | null {
  let name: string | undefined;
  let stream = false;
  let budget: number | undefined;
  let preset: string | undefined;
  const roleStages: { role: string; agent: string }[] = [];
  const stepStages: { agent: string; instruction: string }[] = [];
  const promptParts: string[] = [];
  const extraArgs: string[] = [];
  let pastSeparator = false;

  for (let i = 0; i < argv.length; i++) {
    if (pastSeparator) { extraArgs.push(argv[i]); continue; }
    if (argv[i] === "--") { pastSeparator = true; continue; }

    // Role flags
    if (argv[i] === "--plan" && i + 1 < argv.length) { roleStages.push({ role: "plan", agent: argv[++i] }); continue; }
    if (argv[i] === "--build" && i + 1 < argv.length) { roleStages.push({ role: "build", agent: argv[++i] }); continue; }
    if (argv[i] === "--review" && i + 1 < argv.length) { roleStages.push({ role: "review", agent: argv[++i] }); continue; }
    if (argv[i] === "--test" && i + 1 < argv.length) { roleStages.push({ role: "test", agent: argv[++i] }); continue; }

    // Custom step
    if (argv[i] === "--step" && i + 1 < argv.length) {
      const spec = argv[++i];
      const colonIdx = spec.indexOf(":");
      if (colonIdx === -1) {
        console.error(`${c.red("✗")} --step requires format agent:instruction (e.g. --step codex:"plan the API")`);
        return null;
      }
      stepStages.push({ agent: spec.slice(0, colonIdx), instruction: spec.slice(colonIdx + 1) });
      continue;
    }

    // Other flags
    if (argv[i] === "--preset" && i + 1 < argv.length) { preset = argv[++i]; continue; }
    if (argv[i] === "--name" && i + 1 < argv.length) { name = argv[++i]; continue; }
    if (argv[i] === "--stream" || argv[i] === "-s") { stream = true; continue; }
    if (argv[i] === "--budget" || argv[i] === "-b") {
      if (i + 1 >= argv.length) { console.error("Error: --budget requires a value"); return null; }
      const v = parseFloat(argv[++i]);
      if (!Number.isFinite(v) || v <= 0) { console.error("Error: --budget must be a positive number"); return null; }
      budget = v;
      continue;
    }

    promptParts.push(argv[i]);
  }

  // Validate mutual exclusivity
  const hasRoles = roleStages.length > 0;
  const hasSteps = stepStages.length > 0;
  const hasPreset = !!preset;

  if ((hasRoles && hasSteps) || (hasRoles && hasPreset) || (hasSteps && hasPreset)) {
    console.error(`${c.red("✗")} use only one of: role flags (--plan/--build/--review/--test), --step, or --preset`);
    return null;
  }

  // Build stages
  let stages: PipelineStage[];

  if (hasPreset) {
    const loaded = loadPreset(preset!);
    if (!loaded) {
      console.error(`${c.red("✗")} preset "${preset}" not found in ~/.harnessctl/pipelines/`);
      return null;
    }
    stages = loaded;
  } else if (hasRoles) {
    // Sort by fixed role order
    stages = roleStages
      .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
      .map((r) => ({
        agent: r.agent,
        instruction: ROLE_INSTRUCTIONS[r.role] ?? "",
        role: r.role,
      }));
  } else if (hasSteps) {
    stages = stepStages.map((s) => ({
      agent: s.agent,
      instruction: s.instruction,
    }));
  } else {
    console.error(`${c.red("✗")} pipeline needs stages — use --plan/--build, --step, or --preset`);
    return null;
  }

  const prompt = promptParts.join(" ");
  if (!prompt) {
    console.error(`${c.red("✗")} prompt is required`);
    return null;
  }

  return { prompt, stages, name, stream, budget, extraArgs };
}
