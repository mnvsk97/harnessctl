import { describe, test, expect, mock, beforeEach } from "bun:test";
import { EventEmitter } from "node:events";

// ── Mocks ────────────────────────────────────────────────

/** Tracks which agents were "spawned" and what their exit codes were. */
const spawnLog: { cmd: string; args: string[] }[] = [];
let nextExitCodes: number[] = []; // stack of exit codes for sequential spawns

/** Tracks askConfirm calls and pre-programmed answers. */
let confirmAnswers: boolean[] = [];
let confirmQuestions: string[] = [];

/** Per-agent config overrides. */
let agentConfigs: Record<string, any> = {};

/** Per-agent auth results. */
let authResults: Record<string, { ok: boolean; message: string }> = {};

// Mock child_process.spawn — returns a fake ChildProcess that emits "close"
mock.module("node:child_process", () => ({
  spawn: (cmd: string, args: string[], _opts: any) => {
    spawnLog.push({ cmd, args });
    const child = new EventEmitter();
    const exitCode = nextExitCodes.shift() ?? 0;
    // Emit close on next tick so the promise handler is attached first
    setTimeout(() => child.emit("close", exitCode), 5);
    return child;
  },
  spawnSync: () => ({ status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") }),
}));

// Mock config — return controlled agent configs
mock.module("../config.ts", () => ({
  loadConfig: () => ({ default_agent: "codex" }),
  loadAgentConfig: (name: string) => agentConfigs[name] ?? {},
  resolveEnv: (env: Record<string, string>) => env,
  isKnownAgent: (name: string) => ["claude", "codex", "opencode", "cursor"].includes(name),
  HARNESS_DIR: "/tmp/harnessctl-test",
  AGENTS_DIR: "/tmp/harnessctl-test/agents",
  SESSIONS_DIR: "/tmp/harnessctl-test/sessions",
  RUNS_DIR: "/tmp/harnessctl-test/runs",
  ensureInit: () => {},
}));

// Mock session, log, and handoff modules
mock.module("../session.ts", () => ({
  createSession: () => ({ id: "test1234", cwdHash: "abc", createdAt: new Date().toISOString(), runs: [] }),
  addRun: () => {},
  loadSession: () => null,
  loadLatestSession: () => null,
  findSessionByRunId: () => null,
  latestRunForAgent: () => undefined,
}));
mock.module("../log.ts", () => ({
  writeRunLog: () => "1713364500000-codex",
}));
mock.module("../lib/handoff.ts", () => ({
  writeHandoffFile: () => {},
  getHeadSha: () => undefined,
  getChangedFiles: () => [],
  ensureGitignore: () => {},
}));

// Mock registry — return minimal adapters, controlled auth
mock.module("../adapters/registry.ts", () => ({
  getAdapter: (name: string) => ({
    name,
    base: { cmd: name, args: [] },
    argMap: { model: (v: string) => ["--model", v] },
  }),
  checkAuth: (adapter: any) =>
    authResults[adapter.name] ?? { ok: true, message: "authenticated" },
  listAdapterNames: () => ["claude", "codex", "opencode"],
}));

// Mock UI — capture output, control askConfirm responses
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
  askConfirm: (question: string) => {
    confirmQuestions.push(question);
    return Promise.resolve(confirmAnswers.shift() ?? false);
  },
}));

// Now import the module under test (after mocks are set up)
const { shellCommand } = await import("./shell.ts");

// ── Helpers ──────────────────────────────────────────────

beforeEach(() => {
  spawnLog.length = 0;
  nextExitCodes = [];
  confirmAnswers = [];
  confirmQuestions = [];
  agentConfigs = {};
  authResults = {};
});

// ── Tests ────────────────────────────────────────────────

describe("shell fallback on exit code", () => {
  test("exit 0 — no fallback offered", async () => {
    agentConfigs.codex = { fallback: "claude" };
    nextExitCodes = [0];

    const code = await shellCommand({ extraArgs: [] });

    expect(code).toBe(0);
    expect(spawnLog).toHaveLength(1);
    expect(spawnLog[0].cmd).toBe("codex");
    expect(confirmQuestions).toHaveLength(0);
  });

  test("exit 1 + no fallback configured — returns exit code", async () => {
    agentConfigs.codex = {}; // no fallback
    nextExitCodes = [1];

    const code = await shellCommand({ extraArgs: [] });

    expect(code).toBe(1);
    expect(spawnLog).toHaveLength(1);
    expect(confirmQuestions).toHaveLength(0);
  });

  test("exit 1 + fallback configured + user accepts — launches fallback", async () => {
    agentConfigs.codex = { fallback: "claude" };
    agentConfigs.claude = {};
    nextExitCodes = [1, 0]; // codex fails, claude succeeds
    confirmAnswers = [true];

    const code = await shellCommand({ extraArgs: [] });

    expect(code).toBe(0);
    expect(spawnLog).toHaveLength(2);
    expect(spawnLog[0].cmd).toBe("codex");
    expect(spawnLog[1].cmd).toBe("claude");
    expect(confirmQuestions).toHaveLength(1);
    expect(confirmQuestions[0]).toContain("claude");
  });

  test("exit 1 + fallback configured + user declines — returns original exit code", async () => {
    agentConfigs.codex = { fallback: "claude" };
    nextExitCodes = [1];
    confirmAnswers = [false];

    const code = await shellCommand({ extraArgs: [] });

    expect(code).toBe(1);
    expect(spawnLog).toHaveLength(1); // only codex spawned
    expect(confirmQuestions).toHaveLength(1);
  });

  test("chained fallback — codex → claude → opencode", async () => {
    agentConfigs.codex = { fallback: "claude" };
    agentConfigs.claude = { fallback: "opencode" };
    agentConfigs.opencode = {};
    nextExitCodes = [1, 1, 0]; // codex fails, claude fails, opencode succeeds
    confirmAnswers = [true, true];

    const code = await shellCommand({ extraArgs: [] });

    expect(code).toBe(0);
    expect(spawnLog).toHaveLength(3);
    expect(spawnLog[0].cmd).toBe("codex");
    expect(spawnLog[1].cmd).toBe("claude");
    expect(spawnLog[2].cmd).toBe("opencode");
    expect(confirmQuestions).toHaveLength(2);
  });

  test("chained fallback — user declines second handoff", async () => {
    agentConfigs.codex = { fallback: "claude" };
    agentConfigs.claude = { fallback: "opencode" };
    nextExitCodes = [1, 1]; // both fail
    confirmAnswers = [true, false]; // accept first, decline second

    const code = await shellCommand({ extraArgs: [] });

    expect(code).toBe(1); // claude's exit code
    expect(spawnLog).toHaveLength(2);
    expect(confirmQuestions).toHaveLength(2);
  });

  test("no circular fallback — codex → claude → codex is blocked", async () => {
    agentConfigs.codex = { fallback: "claude" };
    agentConfigs.claude = { fallback: "codex" }; // circular!
    nextExitCodes = [1, 1]; // both fail
    confirmAnswers = [true];

    const code = await shellCommand({ extraArgs: [] });

    expect(code).toBe(1);
    expect(spawnLog).toHaveLength(2); // codex, claude — no third spawn
    expect(confirmQuestions).toHaveLength(1); // no chained prompt
  });
});

describe("shell fallback on auth failure", () => {
  test("auth fails + fallback configured + user accepts — launches fallback", async () => {
    agentConfigs.codex = { fallback: "claude" };
    agentConfigs.claude = {};
    authResults.codex = { ok: false, message: "not logged in" };
    // claude auth is ok (default)
    nextExitCodes = [0]; // claude succeeds
    confirmAnswers = [true];

    const code = await shellCommand({ extraArgs: [] });

    expect(code).toBe(0);
    expect(spawnLog).toHaveLength(1);
    expect(spawnLog[0].cmd).toBe("claude"); // went straight to fallback
    expect(confirmQuestions).toHaveLength(1);
    expect(confirmQuestions[0]).toContain("auth failed");
  });

  test("auth fails + fallback configured + user declines — returns 1", async () => {
    agentConfigs.codex = { fallback: "claude" };
    authResults.codex = { ok: false, message: "not logged in" };
    confirmAnswers = [false];

    const code = await shellCommand({ extraArgs: [] });

    expect(code).toBe(1);
    expect(spawnLog).toHaveLength(0); // nothing spawned
  });

  test("auth fails + no fallback — returns 1", async () => {
    agentConfigs.codex = {};
    authResults.codex = { ok: false, message: "not logged in" };

    const code = await shellCommand({ extraArgs: [] });

    expect(code).toBe(1);
    expect(spawnLog).toHaveLength(0);
    expect(confirmQuestions).toHaveLength(0);
  });

  test("auth fails + fallback also fails auth — returns 1", async () => {
    agentConfigs.codex = { fallback: "claude" };
    agentConfigs.claude = {};
    authResults.codex = { ok: false, message: "not logged in" };
    authResults.claude = { ok: false, message: "expired token" };
    confirmAnswers = [true];

    const code = await shellCommand({ extraArgs: [] });

    expect(code).toBe(1);
    expect(spawnLog).toHaveLength(0); // nothing spawned — both auths failed
  });
});

describe("shell -- extra args forwarding", () => {
  test("extra args passed through to agent", async () => {
    agentConfigs.codex = {};
    nextExitCodes = [0];

    await shellCommand({ extraArgs: ["--verbose", "--debug"] });

    expect(spawnLog[0].args).toContain("--verbose");
    expect(spawnLog[0].args).toContain("--debug");
  });

  test("extra args forwarded to fallback agent too", async () => {
    agentConfigs.codex = { fallback: "claude" };
    agentConfigs.claude = {};
    nextExitCodes = [1, 0];
    confirmAnswers = [true];

    await shellCommand({ extraArgs: ["--verbose"] });

    expect(spawnLog[1].args).toContain("--verbose");
  });
});
