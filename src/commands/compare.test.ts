import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { InvokeIntent, RunResult } from "../adapters/types.ts";

const loggedRuns: unknown[][] = [];
const invokeCalls: Array<{ agent: string; intent: InvokeIntent; opts: unknown }> = [];
let runCounter = 0;
let testCwd = "";
const originalCwd = process.cwd();

mock.module("../config.ts", () => ({
  loadAgentConfig: () => ({}),
  resolveEnv: (env: Record<string, string>) => env,
}));

mock.module("../adapters/registry.ts", () => ({
  getAdapter: (name: string) => ({
    name,
    parseOutput: () => ({}),
  }),
  checkAuth: () => ({ ok: true, message: "authenticated" }),
  listAdapterNames: () => ["codex", "claude"],
}));

mock.module("../invoke.ts", () => ({
  invoke: async (adapter: { name: string }, intent: InvokeIntent, _config: unknown, opts: unknown): Promise<RunResult> => {
    invokeCalls.push({ agent: adapter.name, intent, opts });
    const isJudge = intent.prompt.startsWith("You are judging a harnessctl compare run.");
    return {
      exitCode: 0,
      summary: isJudge ? "Winner: codex. Claude was clearer. Improve labels." : `${adapter.name} answer`,
      duration: adapter.name === "codex" ? 1.2 : 2.3,
      tokens: { input: 10, output: 5 },
      exitReason: "success",
    };
  },
}));

mock.module("../log.ts", () => ({
  writeRunLog: (...args: unknown[]) => {
    loggedRuns.push(args);
    const agent = String(args[0]);
    runCounter++;
    return `${runCounter}-${agent}`;
  },
}));

mock.module("../lib/handoff.ts", () => ({
  ensureGitignore: () => {},
  writeHandoffFile: () => {},
  getHeadSha: () => undefined,
  getChangedFiles: () => [],
  buildHandoffPrompt: () => "",
}));

mock.module("../ui.ts", () => ({
  separator: () => {},
  c: {
    dim: (s: string) => s,
    bold: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
  },
}));

const { compareCommand } = await import("./compare.ts");

beforeEach(() => {
  loggedRuns.length = 0;
  invokeCalls.length = 0;
  runCounter = 0;
  testCwd = mkdtempSync(join(tmpdir(), "harnessctl-compare-test-"));
  process.chdir(testCwd);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (testCwd) rmSync(testCwd, { recursive: true, force: true });
});

describe("compareCommand", () => {
  test("suppresses unlabeled invoke summaries and writes a compare report with run IDs", async () => {
    const code = await compareCommand({
      prompt: "review this",
      agents: ["codex", "claude"],
      extraArgs: [],
    });

    expect(code).toBe(0);
    expect(invokeCalls).toHaveLength(2);
    expect(invokeCalls.every((call) => (call.opts as { printSummary?: boolean }).printSummary === false)).toBe(true);
    expect(loggedRuns).toHaveLength(2);

    const reportPath = join(testCwd, ".harnessctl", "compare");
    const reportFile = Bun.spawnSync(["find", reportPath, "-type", "f"]).stdout.toString().trim();
    const report = readFileSync(reportFile, "utf8");

    expect(report).toContain("### codex");
    expect(report).toContain("Run ID: 1-codex");
    expect(report).toContain("codex answer");
    expect(report).toContain("### claude");
    expect(report).toContain("Run ID: 2-claude");
  });

  test("runs an optional judge and appends the verdict to the report", async () => {
    const code = await compareCommand({
      prompt: "review this",
      agents: ["codex", "claude"],
      judge: "claude",
      extraArgs: [],
    });

    expect(code).toBe(0);
    expect(invokeCalls).toHaveLength(3);
    expect(invokeCalls[2].intent.prompt).toContain("Agent outputs:");
    expect(invokeCalls[2].intent.prompt).toContain("## codex");
    expect(loggedRuns).toHaveLength(3);

    const reportPath = join(testCwd, ".harnessctl", "compare");
    const reportFile = Bun.spawnSync(["find", reportPath, "-type", "f"]).stdout.toString().trim();
    const report = readFileSync(reportFile, "utf8");

    expect(report).toContain("## Judge");
    expect(report).toContain("Winner: codex");
    expect(report).toContain("Run ID: 3-claude");
  });
});
