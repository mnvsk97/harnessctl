import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { buildCommand } from "./registry.ts";
import { deepagentsAdapter } from "./deepagents.ts";

describe("deepagents adapter", () => {
  test("uses non-interactive stdin mode with auto-approval and safe shell defaults", () => {
    const built = buildCommand(deepagentsAdapter, {
      prompt: "fix the failing tests",
      cwd: "/tmp/project",
      extraArgs: [],
      env: {},
    });

    expect(built.cmd).toBe("deepagents");
    expect(built.args).toEqual([
      "--stdin",
      "--auto-approve",
      "--shell-allow-list",
      "recommended",
      "--quiet",
      "--no-stream",
    ]);
    expect(built.stdin).toBe("fix the failing tests");
  });

  test("maps harness model and resume flags to DeepAgents flags", () => {
    const built = buildCommand(deepagentsAdapter, {
      prompt: "continue",
      model: "anthropic:claude-sonnet-4-6",
      resumeId: "thread-123",
      cwd: "/tmp/project",
      extraArgs: ["--agent", "backend-dev"],
      env: {},
    });

    expect(built.args).toContain("--model");
    expect(built.args).toContain("anthropic:claude-sonnet-4-6");
    expect(built.args).toContain("--resume");
    expect(built.args).toContain("thread-123");
    expect(built.args.slice(-2)).toEqual(["--agent", "backend-dev"]);
    expect(built.warnings).toHaveLength(0);
  });

  test("parses quiet plain-text output as the final summary", () => {
    const result = deepagentsAdapter.parseOutput("Thinking...\nDone, updated README.\n", "");
    expect(result.summary).toBe("Done, updated README.");
  });

  test("parses JSON summary and session id when present", () => {
    const result = deepagentsAdapter.parseOutput(
      JSON.stringify({
        type: "result",
        thread_id: "thread-abc",
        result: "Patched the bug.",
      }),
      "",
    );
    expect(result.summary).toBe("Patched the bug.");
    expect(result.sessionId).toBe("thread-abc");
  });

  test("health check runs deepagents --version", () => {
    expect(deepagentsAdapter.healthCheck()).toEqual({ cmd: "deepagents", args: ["--version"] });
  });
});

describe("deepagents authCheck", () => {
  const { parse } = deepagentsAdapter.authCheck();
  let savedOpenAI: string | undefined;
  let savedScopedOpenAI: string | undefined;
  let savedTrueFoundry: string | undefined;
  let savedHome: string | undefined;
  let tempHome: string;

  beforeEach(() => {
    savedOpenAI = process.env.OPENAI_API_KEY;
    savedScopedOpenAI = process.env.DEEPAGENTS_CLI_OPENAI_API_KEY;
    savedTrueFoundry = process.env.TRUEFOUNDRY_API_KEY;
    savedHome = process.env.HOME;
    tempHome = mkdtempSync(`${tmpdir()}/harnessctl-deepagents-auth-`);
    process.env.HOME = tempHome;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPAGENTS_CLI_OPENAI_API_KEY;
    delete process.env.TRUEFOUNDRY_API_KEY;
  });

  afterEach(() => {
    if (savedOpenAI !== undefined) process.env.OPENAI_API_KEY = savedOpenAI;
    else delete process.env.OPENAI_API_KEY;
    if (savedScopedOpenAI !== undefined) process.env.DEEPAGENTS_CLI_OPENAI_API_KEY = savedScopedOpenAI;
    else delete process.env.DEEPAGENTS_CLI_OPENAI_API_KEY;
    if (savedTrueFoundry !== undefined) process.env.TRUEFOUNDRY_API_KEY = savedTrueFoundry;
    else delete process.env.TRUEFOUNDRY_API_KEY;
    if (savedHome !== undefined) process.env.HOME = savedHome;
    else delete process.env.HOME;
    rmSync(tempHome, { recursive: true, force: true });
  });

  test("rejects installed CLI when no provider credentials are configured", () => {
    const result = parse("deepagents 1.2.3", "", 0);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no DeepAgents provider credentials");
  });

  test("reports scoped API key when present", () => {
    process.env.DEEPAGENTS_CLI_OPENAI_API_KEY = "sk-test";
    const result = parse("deepagents 1.2.3", "", 0);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("DEEPAGENTS_CLI_OPENAI_API_KEY");
  });

  test("reports provider key from ~/.deepagents/.env when present", () => {
    mkdirSync(`${tempHome}/.deepagents`, { recursive: true });
    writeFileSync(`${tempHome}/.deepagents/.env`, "ANTHROPIC_API_KEY=sk-ant-test\n");

    const result = parse("deepagents 1.2.3", "", 0);
    expect(result.ok).toBe(true);
    expect(result.message).toContain(".deepagents/.env:ANTHROPIC_API_KEY");
  });

  test("reports custom api_key_env from ~/.deepagents/config.toml and ~/.deepagents/.env", () => {
    mkdirSync(`${tempHome}/.deepagents`, { recursive: true });
    writeFileSync(`${tempHome}/.deepagents/config.toml`, [
      "[models.providers.openai]",
      "api_key_env = \"TRUEFOUNDRY_API_KEY\"",
      "",
    ].join("\n"));
    writeFileSync(`${tempHome}/.deepagents/.env`, "TRUEFOUNDRY_API_KEY=tfy-test\n");

    const result = parse("deepagents 1.2.3", "", 0);
    expect(result.ok).toBe(true);
    expect(result.message).toContain(".deepagents/.env:TRUEFOUNDRY_API_KEY");
  });

  test("reports provider key from project .env when present", () => {
    const savedCwd = process.cwd();
    const tempProject = mkdtempSync(`${tmpdir()}/harnessctl-deepagents-project-`);
    writeFileSync(`${tempProject}/.env`, "OPENAI_API_KEY=sk-project-test\n");

    try {
      process.chdir(tempProject);
      const result = parse("deepagents 1.2.3", "", 0);
      expect(result.ok).toBe(true);
      expect(result.message).toContain(".env:OPENAI_API_KEY");
    } finally {
      process.chdir(savedCwd);
      rmSync(tempProject, { recursive: true, force: true });
    }
  });

  test("does not treat an empty DeepAgents state auth store as provider credentials", () => {
    mkdirSync(`${tempHome}/.deepagents/.state`, { recursive: true });
    writeFileSync(`${tempHome}/.deepagents/.state/auth.json`, "{\"version\":1,\"credentials\":{}}");

    const result = parse("deepagents 1.2.3", "", 0);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no DeepAgents provider credentials");
  });

  test("reports provider key from DeepAgents stored auth without exposing the key", () => {
    mkdirSync(`${tempHome}/.deepagents/.state`, { recursive: true });
    writeFileSync(
      `${tempHome}/.deepagents/.state/auth.json`,
      JSON.stringify({
        version: 1,
        credentials: {
          openai: { type: "api_key", key: "sk-stored-secret", added_at: "2026-05-14T00:00:00Z" },
        },
      }),
    );

    const result = parse("deepagents 1.2.3", "", 0);
    expect(result.ok).toBe(true);
    expect(result.message).toContain(".deepagents/.state/auth.json:openai");
    expect(result.message).not.toContain("sk-stored-secret");
  });

  test("reports missing binary on non-zero version check", () => {
    const result = parse("", "command not found", 1);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("https://langch.in/gh-da-cli");
  });
});

describe("deepagents session file", () => {
  test("returns undefined when no DeepAgents sessions DB exists under HOME", async () => {
    const savedHome = process.env.HOME;
    process.env.HOME = "/tmp/harnessctl-missing-deepagents-home";
    try {
      const path = await deepagentsAdapter.sessionFilePath?.("/tmp/project", "thread-1", Date.now());
      expect(path).toBeUndefined();
    } finally {
      if (savedHome !== undefined) process.env.HOME = savedHome;
      else delete process.env.HOME;
    }
  });

  test("returns undefined when DeepAgents sessions DB is empty", async () => {
    const savedHome = process.env.HOME;
    const tempHome = mkdtempSync(`${tmpdir()}/harnessctl-deepagents-session-`);
    process.env.HOME = tempHome;
    mkdirSync(`${tempHome}/.deepagents/.state`, { recursive: true });
    writeFileSync(`${tempHome}/.deepagents/.state/sessions.db`, "");
    try {
      const path = await deepagentsAdapter.sessionFilePath?.("/tmp/project", "thread-1", Date.now());
      expect(path).toBeUndefined();
    } finally {
      if (savedHome !== undefined) process.env.HOME = savedHome;
      else delete process.env.HOME;
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  test("returns DeepAgents sessions DB path when present and non-empty", async () => {
    const savedHome = process.env.HOME;
    const tempHome = mkdtempSync(`${tmpdir()}/harnessctl-deepagents-session-`);
    process.env.HOME = tempHome;
    mkdirSync(`${tempHome}/.deepagents/.state`, { recursive: true });
    const sessionDb = `${tempHome}/.deepagents/.state/sessions.db`;
    writeFileSync(sessionDb, "sqlite placeholder");
    try {
      const path = await deepagentsAdapter.sessionFilePath?.("/tmp/project", "thread-1", Date.now());
      expect(path).toBe(sessionDb);
    } finally {
      if (savedHome !== undefined) process.env.HOME = savedHome;
      else delete process.env.HOME;
      rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
