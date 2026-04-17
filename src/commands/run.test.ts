import { describe, test, expect, mock, beforeEach } from "bun:test";

let invokeResults: any[] = [];
const invokeCalls: any[] = [];
const savedSessions: any[] = [];
const loggedRuns: any[] = [];

mock.module("../config.ts", () => ({
  loadConfig: () => ({ default_agent: "claude" }),
  loadAgentConfig: () => ({}),
  resolveEnv: (env: Record<string, string>) => env,
  isKnownAgent: (name: string) => ["claude", "codex", "opencode", "cursor"].includes(name),
  RUNS_DIR: "/tmp/harnessctl-test/runs",
}));

mock.module("../adapters/registry.ts", () => ({
  getAdapter: () => ({
    name: "claude",
    parseOutput: () => ({}),
  }),
  checkAuth: () => ({ ok: true, message: "authenticated" }),
  listAdapterNames: () => ["claude"],
}));

mock.module("../invoke.ts", () => ({
  invoke: async (_adapter: any, intent: any) => {
    invokeCalls.push(intent);
    return invokeResults.shift() ?? { exitCode: 0, summary: "", duration: 0.1 };
  },
}));

mock.module("../session.ts", () => ({
  saveSession: (...args: any[]) => savedSessions.push(args),
  loadSession: () => ({ sessionId: "sess-123" }),
  loadLastSession: () => null,
}));

mock.module("../log.ts", () => ({
  writeRunLog: (...args: any[]) => loggedRuns.push(args),
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
  savedSessions.length = 0;
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
