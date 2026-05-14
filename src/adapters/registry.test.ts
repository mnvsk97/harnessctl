import { describe, expect, test } from "bun:test";
import { buildCommand, checkAuth, getAdapter } from "./registry.ts";
import type { Adapter } from "./types.ts";

describe("generic adapter", () => {
  test("builds a custom adapter from YAML config", () => {
    const adapter = getAdapter("myagent", {
      cmd: "myagent",
      args: ["--headless"],
      model_arg: "--model",
      resume_arg: "--session",
    });

    const built = buildCommand(adapter, {
      prompt: "fix it",
      model: "fast-model",
      resumeId: "sess-123",
      cwd: "/tmp/project",
      extraArgs: ["--verbose"],
      env: {},
    });

    expect(built.cmd).toBe("myagent");
    expect(built.args).toEqual([
      "--headless",
      "--model",
      "fast-model",
      "--session",
      "sess-123",
      "--verbose",
    ]);
    expect(built.stdin).toBe("fix it");
  });

  test("rejects custom agents without a command", () => {
    expect(() => getAdapter("broken", {})).toThrow(/missing required field "cmd"|Custom agents require a "cmd" field/);
  });
});

describe("built-in adapters", () => {
  test("includes deepagents as a first-class adapter", () => {
    const adapter = getAdapter("deepagents", {});
    expect(adapter.name).toBe("deepagents");
    expect(adapter.base.cmd).toBe("deepagents");
  });
});

describe("checkAuth", () => {
  test("passes resolved agent env to the auth check command", () => {
    const adapter: Adapter = {
      name: "envtest",
      base: { cmd: "envtest", args: [] },
      argMap: {},
      parseOutput: () => ({}),
      healthCheck: () => ({ cmd: "sh", args: ["-c", "true"] }),
      authCheck: () => ({
        cmd: "sh",
        args: ["-c", "test \"$DEEPAGENTS_CLI_OPENAI_API_KEY\" = sk-test"],
        parse: (_stdout, _stderr, exitCode) => ({
          ok: exitCode === 0,
          message: exitCode === 0 ? "authenticated" : "missing",
        }),
      }),
    };

    const previous = process.env.DEEPAGENTS_CLI_OPENAI_API_KEY;
    delete process.env.DEEPAGENTS_CLI_OPENAI_API_KEY;
    try {
      expect(checkAuth(adapter, { DEEPAGENTS_CLI_OPENAI_API_KEY: "sk-test" }).ok).toBe(true);
      expect(process.env.DEEPAGENTS_CLI_OPENAI_API_KEY).toBeUndefined();
    } finally {
      if (previous !== undefined) process.env.DEEPAGENTS_CLI_OPENAI_API_KEY = previous;
    }
  });
});
