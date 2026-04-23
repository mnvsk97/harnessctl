import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { RunResult, InvokeIntent } from "../adapters/types.ts";

let invokeResults: Partial<RunResult>[] = [];
const invokeCalls: InvokeIntent[] = [];
const loggedRuns: unknown[][] = [];

mock.module("../config.ts", () => ({
  loadConfig: () => ({ default_agent: "claude" }),
  loadAgentConfig: () => ({}),
  resolveEnv: (env: Record<string, string>) => env,
  isKnownAgent: (name: string) => ["claude", "codex", "opencode", "cursor"].includes(name),
  RUNS_DIR: "/tmp/harnessctl-test/runs",
  SESSIONS_DIR: "/tmp/harnessctl-test/sessions",
  PROJECTS_DIR: "/tmp/harnessctl-test/projects",
  TEMPLATES_DIR: "/tmp/harnessctl-test/templates",
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
  getChangedFiles: () => [],
  ensureGitignore: () => {},
  buildHandoffPrompt: () => "",
}));
mock.module("../lib/transcript.ts", () => ({ formatTranscript: () => "", buildTranscriptBlock: async () => "" }));

mock.module("../adapters/registry.ts", () => ({
  getAdapter: () => ({
    name: "claude",
    parseOutput: () => ({}),
  }),
  checkAuth: () => ({ ok: true, message: "authenticated" }),
  listAdapterNames: () => ["claude"],
}));

mock.module("../invoke.ts", () => ({
  invoke: async (_adapter: unknown, intent: InvokeIntent) => {
    invokeCalls.push(intent);
    return invokeResults.shift() ?? { exitCode: 0, summary: "", duration: 0.1 };
  },
}));

mock.module("../session.ts", () => ({
  createSession: () => ({ id: "test1234", cwdHash: "abc", createdAt: new Date().toISOString(), runs: [] }),
  addRun: () => {},
  loadSession: () => ({
    id: "test1234", cwdHash: "abc", createdAt: new Date().toISOString(),
    runs: [{ runId: "r1", agent: "claude", agentSessionId: "sess-123", summary: "", timestamp: "" }],
  }),
  loadLatestSession: () => ({
    id: "test1234", cwdHash: "abc", createdAt: new Date().toISOString(),
    runs: [{ runId: "r1", agent: "claude", agentSessionId: "sess-123", summary: "", timestamp: "" }],
  }),
  latestRunForAgent: () => ({ runId: "r1", agent: "claude", agentSessionId: "sess-123", summary: "", timestamp: "" }),
  findSessionByRunId: () => null,
  resolveSessionRef: () => null,
  validateSessionName: () => true,
}));

mock.module("../log.ts", () => ({
  writeRunLog: (...args: unknown[]) => { loggedRuns.push(args); return "1713364500000-claude"; },
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

const { runCommand } = await import("./run.ts");

beforeEach(() => {
  invokeResults = [];
  invokeCalls.length = 0;
  loggedRuns.length = 0;
});

describe("run --resume", () => {
  test("does not auto-retry fresh after a failed resumed invocation", async () => {
    invokeResults = [
      { exitCode: 1, summary: "partial output", duration: 0.2 },
    ];

    const code = await runCommand({
      prompt: "fix the bug",
      resume: true,
      extraArgs: [],
    });

    expect(code).toBe(1);
    expect(invokeCalls).toHaveLength(1);
    expect(invokeCalls[0].resumeId).toBe("sess-123");
  });
});
