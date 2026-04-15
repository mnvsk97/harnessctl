import { describe, expect, test } from "bun:test";
import { buildCommand, getAdapter } from "./registry.ts";

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
