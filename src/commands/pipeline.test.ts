import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { RunResult, InvokeIntent } from "../adapters/types.ts";

let invokeResults: Partial<RunResult>[] = [];
const invokeCalls: InvokeIntent[] = [];
const loggedRuns: unknown[][] = [];

mock.module("../config.ts", () => ({
  loadConfig: () => ({ default_agent: "claude" }),
  loadAgentConfig: () => ({}),
  resolveEnv: (env: Record<string, string>) => env,
  isKnownAgent: (name: string) => ["claude", "codex", "opencode"].includes(name),
  RUNS_DIR: "/tmp/harnessctl-test/runs",
  SESSIONS_DIR: "/tmp/harnessctl-test/sessions",
  PROJECTS_DIR: "/tmp/harnessctl-test/projects",
  TEMPLATES_DIR: "/tmp/harnessctl-test/templates",
  PIPELINES_DIR: "/tmp/harnessctl-test/pipelines",
  ensureInit: () => {},
}));

mock.module("../lib/context.ts", () => ({ getContext: () => "" }));
mock.module("../lib/templates.ts", () => ({
  loadTemplate: () => null,
  interpolate: (tpl: string) => tpl,
}));
mock.module("../lib/budget.ts", () => ({ todaySpend: () => 0 }));
mock.module("../lib/handoff.ts", () => ({
  writeHandoffFile: () => {},
  getHeadSha: () => undefined,
  getChangedFiles: () => ["src/foo.ts"],
  ensureGitignore: () => {},
  buildHandoffPrompt: (_runId: string, _agent: string, _task: string, summary: string) =>
    `## Handoff\nSummary: ${summary}`,
}));
mock.module("../lib/transcript.ts", () => ({ formatTranscript: () => "", buildTranscriptBlock: async () => "" }));

mock.module("../adapters/registry.ts", () => ({
  getAdapter: () => ({
    name: "claude",
    parseOutput: () => ({}),
  }),
  checkAuth: () => ({ ok: true, message: "authenticated" }),
  listAdapterNames: () => ["claude", "codex", "opencode"],
}));

mock.module("../invoke.ts", () => ({
  invoke: async (_adapter: unknown, intent: InvokeIntent) => {
    invokeCalls.push(intent);
    return invokeResults.shift() ?? { exitCode: 0, summary: "done", duration: 0.1 };
  },
}));

let sessionRunCount = 0;
mock.module("../session.ts", () => ({
  createSession: (_cwd: string, name?: string) => ({
    id: "pipe1234", name, cwdHash: "abc", createdAt: new Date().toISOString(), runs: [],
  }),
  addRun: () => { sessionRunCount++; },
  loadSession: () => ({
    id: "pipe1234", cwdHash: "abc", createdAt: new Date().toISOString(),
    runs: [{ runId: "r1", agent: "codex", agentSessionId: "sess-1", summary: "planned it", timestamp: "", preCommitSha: "abc123" }],
  }),
  loadLatestSession: () => null,
  findSessionByRunId: () => null,
  latestRunForAgent: () => undefined,
  resolveSessionRef: () => null,
  validateSessionName: (name: string) => /^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$/.test(name) || /^[a-z0-9]$/.test(name),
  loadSessionByName: () => null,
}));

mock.module("../log.ts", () => ({
  writeRunLog: (...args: unknown[]) => { loggedRuns.push(args); return `${Date.now()}-claude`; },
}));

mock.module("../lib/stats.ts", () => ({
  computeStats: () => new Map(),
}));

mock.module("../ui.ts", () => ({
  header: () => {},
  footer: () => {},
  separator: () => {},
  rule: () => {},
  c: {
    dim: (s: string) => s,
    bold: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
    cyan: (s: string) => s,
  },
  askConfirm: async () => false,
}));

const { parsePipelineArgs, pipelineCommand } = await import("./pipeline.ts");

beforeEach(() => {
  invokeResults = [];
  invokeCalls.length = 0;
  loggedRuns.length = 0;
  sessionRunCount = 0;
});

// ── parsePipelineArgs ────────────────────────────────────

describe("parsePipelineArgs", () => {
  test("parses role flags in correct order", () => {
    const opts = parsePipelineArgs(["--build", "claude", "--plan", "codex", "implement auth"]);
    expect(opts).not.toBeNull();
    expect(opts!.stages).toHaveLength(2);
    // plan comes before build regardless of flag order
    expect(opts!.stages[0].role).toBe("plan");
    expect(opts!.stages[0].agent).toBe("codex");
    expect(opts!.stages[1].role).toBe("build");
    expect(opts!.stages[1].agent).toBe("claude");
    expect(opts!.prompt).toBe("implement auth");
  });

  test("parses --step flags", () => {
    const opts = parsePipelineArgs(["--step", "codex:plan the API", "--step", "claude:implement it", "my task"]);
    expect(opts).not.toBeNull();
    expect(opts!.stages).toHaveLength(2);
    expect(opts!.stages[0].agent).toBe("codex");
    expect(opts!.stages[0].instruction).toBe("plan the API");
    expect(opts!.stages[1].agent).toBe("claude");
    expect(opts!.stages[1].instruction).toBe("implement it");
  });

  test("parses --name, --stream, --budget", () => {
    const opts = parsePipelineArgs(["--plan", "codex", "--name", "auth-refactor", "--stream", "--budget", "5", "do the thing"]);
    expect(opts).not.toBeNull();
    expect(opts!.name).toBe("auth-refactor");
    expect(opts!.stream).toBe(true);
    expect(opts!.budget).toBe(5);
  });

  test("rejects mixing role flags and --step", () => {
    const opts = parsePipelineArgs(["--plan", "codex", "--step", "claude:build", "task"]);
    expect(opts).toBeNull();
  });

  test("rejects missing prompt", () => {
    const opts = parsePipelineArgs(["--plan", "codex"]);
    expect(opts).toBeNull();
  });

  test("rejects no stages", () => {
    const opts = parsePipelineArgs(["just a prompt"]);
    expect(opts).toBeNull();
  });

  test("passes extra args after --", () => {
    const opts = parsePipelineArgs(["--plan", "codex", "task", "--", "--verbose"]);
    expect(opts).not.toBeNull();
    expect(opts!.extraArgs).toEqual(["--verbose"]);
  });

  test("all four role flags in correct order", () => {
    const opts = parsePipelineArgs([
      "--test", "opencode", "--review", "claude", "--build", "codex", "--plan", "codex", "full pipeline",
    ]);
    expect(opts).not.toBeNull();
    expect(opts!.stages.map((s: any) => s.role)).toEqual(["plan", "build", "review", "test"]);
  });
});

// ── pipelineCommand ──────────────────────────────────────

describe("pipelineCommand", () => {
  test("runs two stages sequentially and returns 0 on success", async () => {
    invokeResults = [
      { exitCode: 0, summary: "plan complete", duration: 1.0 },
      { exitCode: 0, summary: "build complete", duration: 2.0 },
    ];

    const code = await pipelineCommand({
      prompt: "implement auth",
      stages: [
        { agent: "codex", instruction: "Create a plan.", role: "plan" },
        { agent: "claude", instruction: "Implement the plan.", role: "build" },
      ],
      extraArgs: [],
    });

    expect(code).toBe(0);
    expect(invokeCalls).toHaveLength(2);
    // First stage prompt includes the instruction + task
    expect(invokeCalls[0].prompt).toContain("Create a plan.");
    expect(invokeCalls[0].prompt).toContain("implement auth");
  });

  test("stops pipeline on first stage failure", async () => {
    invokeResults = [
      { exitCode: 1, summary: "failed", duration: 0.5 },
    ];

    const code = await pipelineCommand({
      prompt: "implement auth",
      stages: [
        { agent: "codex", instruction: "Plan.", role: "plan" },
        { agent: "claude", instruction: "Build.", role: "build" },
      ],
      extraArgs: [],
    });

    expect(code).toBe(1);
    // Only one stage invoked — second was skipped
    expect(invokeCalls).toHaveLength(1);
  });

  test("rejects unknown agent", async () => {
    const code = await pipelineCommand({
      prompt: "do it",
      stages: [{ agent: "unknown-agent", instruction: "go" }],
      extraArgs: [],
    });

    expect(code).toBe(1);
    expect(invokeCalls).toHaveLength(0);
  });

  test("rejects empty stages", async () => {
    const code = await pipelineCommand({
      prompt: "do it",
      stages: [],
      extraArgs: [],
    });

    expect(code).toBe(1);
    expect(invokeCalls).toHaveLength(0);
  });

  test("rejects invalid session name", async () => {
    const code = await pipelineCommand({
      prompt: "do it",
      stages: [{ agent: "codex", instruction: "plan" }],
      name: "INVALID NAME!",
      extraArgs: [],
    });

    expect(code).toBe(1);
    expect(invokeCalls).toHaveLength(0);
  });

  test("second stage gets handoff context from first", async () => {
    invokeResults = [
      { exitCode: 0, summary: "planned it", duration: 1.0 },
      { exitCode: 0, summary: "built it", duration: 2.0 },
    ];

    const code = await pipelineCommand({
      prompt: "auth feature",
      stages: [
        { agent: "codex", instruction: "Plan.", role: "plan" },
        { agent: "claude", instruction: "Build based on the plan.", role: "build" },
      ],
      extraArgs: [],
    });

    expect(code).toBe(0);
    expect(invokeCalls).toHaveLength(2);
    // Second stage prompt includes handoff context and role instruction
    expect(invokeCalls[1].prompt).toContain("Handoff");
    expect(invokeCalls[1].prompt).toContain("Build based on the plan.");
    expect(invokeCalls[1].prompt).toContain("auth feature");
  });

  test("passes session name through to runCommand", async () => {
    invokeResults = [
      { exitCode: 0, summary: "done", duration: 0.5 },
    ];

    const code = await pipelineCommand({
      prompt: "task",
      stages: [{ agent: "codex", instruction: "do it" }],
      name: "my-pipeline",
      extraArgs: [],
    });

    expect(code).toBe(0);
    // Check that the logged run includes the session name
    expect(loggedRuns.length).toBeGreaterThanOrEqual(1);
    const extras = loggedRuns[0][4] as Record<string, unknown>;
    expect(extras.harnessSessionName).toBe("my-pipeline");
  });
});
