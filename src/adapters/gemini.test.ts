import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { geminiAdapter } from "./gemini.ts";
import type { InvokeIntent } from "./types.ts";

/** Minimal replica of registry.buildCommand for test purposes. */
function buildArgs(intent: Partial<InvokeIntent> & { prompt: string }) {
  const args = [...geminiAdapter.base.args];
  const warnings: string[] = [];
  for (const [flag, value] of [["model", intent.model], ["resume", intent.resumeId]] as const) {
    if (value === undefined) continue;
    const mapper = geminiAdapter.argMap[flag];
    if (mapper) args.push(...mapper(value));
    else warnings.push(`--${flag} is not supported by ${geminiAdapter.name}, ignoring`);
  }
  args.push(...(intent.extraArgs ?? []));
  return { cmd: geminiAdapter.base.cmd, args, stdin: intent.prompt, warnings };
}

// ── parseOutput ───────────────────────────────────────────

describe("gemini parseOutput", () => {
  test("concatenates assistant message deltas into summary", () => {
    const lines = [
      JSON.stringify({ type: "init", session_id: "sess-abc", model: "gemini-2.5-flash" }),
      JSON.stringify({ type: "message", role: "user", content: "fix the bug" }),
      JSON.stringify({ type: "message", role: "assistant", content: "I'll fix ", delta: true }),
      JSON.stringify({ type: "message", role: "assistant", content: "the bug now.", delta: true }),
      JSON.stringify({ type: "result", status: "success", stats: { input_tokens: 50, output_tokens: 20 } }),
    ].join("\n");

    const out = geminiAdapter.parseOutput(lines, "");
    expect(out.summary).toBe("I'll fix the bug now.");
    expect(out.sessionId).toBe("sess-abc");
    expect(out.tokens).toEqual({ input: 50, output: 20 });
  });

  test("extracts session_id from init event", () => {
    const stdout = JSON.stringify({ type: "init", session_id: "my-session-id", model: "gemini-2.5-pro" });
    const out = geminiAdapter.parseOutput(stdout, "");
    expect(out.sessionId).toBe("my-session-id");
  });

  test("extracts token counts from result stats", () => {
    const lines = [
      JSON.stringify({ type: "message", role: "assistant", content: "done", delta: true }),
      JSON.stringify({ type: "result", status: "success", stats: { input_tokens: 100, output_tokens: 40, total_tokens: 140 } }),
    ].join("\n");
    const out = geminiAdapter.parseOutput(lines, "");
    expect(out.tokens).toEqual({ input: 100, output: 40 });
  });

  test("ignores user message content", () => {
    const lines = [
      JSON.stringify({ type: "message", role: "user", content: "this is the prompt" }),
      JSON.stringify({ type: "message", role: "assistant", content: "response text", delta: true }),
    ].join("\n");
    const out = geminiAdapter.parseOutput(lines, "");
    expect(out.summary).toBe("response text");
  });

  test("ignores tool_use and tool_result events", () => {
    const lines = [
      JSON.stringify({ type: "tool_use", tool: "shell", input: "ls" }),
      JSON.stringify({ type: "tool_result", output: "file1.txt" }),
      JSON.stringify({ type: "message", role: "assistant", content: "Done.", delta: true }),
    ].join("\n");
    const out = geminiAdapter.parseOutput(lines, "");
    expect(out.summary).toBe("Done.");
  });

  test("falls back to last plain-text line when no assistant messages", () => {
    const stdout = "Thinking...\nWorking on it...\nDone, files updated.";
    const out = geminiAdapter.parseOutput(stdout, "");
    expect(out.summary).toBe("Done, files updated.");
  });

  test("falls back to last non-JSON line when no assistant messages in mixed output", () => {
    const lines = [
      "Some streamed text",
      JSON.stringify({ type: "tool_use", tool: "bash" }),
      "Final plain line",
      JSON.stringify({ type: "result", status: "success", stats: { input_tokens: 10, output_tokens: 5 } }),
    ].join("\n");
    const out = geminiAdapter.parseOutput(lines, "");
    expect(out.summary).toBe("Final plain line");
  });

  test("returns no summary for empty output", () => {
    const out = geminiAdapter.parseOutput("", "");
    expect(out.summary).toBeUndefined();
  });

  test("error result event does not set summary", () => {
    const lines = [
      JSON.stringify({ type: "result", status: "error", error: { type: "AuthError", message: "no key" }, stats: { input_tokens: 0, output_tokens: 0 } }),
    ].join("\n");
    const out = geminiAdapter.parseOutput(lines, "");
    // summary should be undefined (no assistant content)
    expect(out.summary).toBeUndefined();
    // tokens should still be parsed
    expect(out.tokens).toEqual({ input: 0, output: 0 });
  });
});

// ── authCheck ─────────────────────────────────────────────

describe("gemini authCheck", () => {
  const { parse } = geminiAdapter.authCheck();

  let savedApiKey: string | undefined;
  let savedVertexAI: string | undefined;

  beforeEach(() => {
    savedApiKey = process.env.GEMINI_API_KEY;
    savedVertexAI = process.env.GOOGLE_GENAI_USE_VERTEXAI;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENAI_USE_VERTEXAI;
  });

  afterEach(() => {
    if (savedApiKey !== undefined) process.env.GEMINI_API_KEY = savedApiKey;
    else delete process.env.GEMINI_API_KEY;
    if (savedVertexAI !== undefined) process.env.GOOGLE_GENAI_USE_VERTEXAI = savedVertexAI;
    else delete process.env.GOOGLE_GENAI_USE_VERTEXAI;
  });

  test("ok with GEMINI_API_KEY set", () => {
    process.env.GEMINI_API_KEY = "AIza-test-key";
    const result = parse("gemini 1.0.0", "", 0);
    expect(result.ok).toBe(true);
    expect(result.method).toBe("api_key");
    expect(result.message).toContain("GEMINI_API_KEY");
  });

  test("ok with GOOGLE_GENAI_USE_VERTEXAI set", () => {
    process.env.GOOGLE_GENAI_USE_VERTEXAI = "1";
    const result = parse("gemini 1.0.0", "", 0);
    expect(result.ok).toBe(true);
    expect(result.method).toBe("vertex_ai");
  });

  test("ok when binary runs (OAuth may be in settings.json)", () => {
    const result = parse("gemini 1.0.0", "", 0);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("installed");
  });

  test("not ok when binary not found (exit non-zero)", () => {
    const result = parse("", "command not found", 1);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("npm install");
  });

  test("authCheck cmd is --version (no auth status subcommand)", () => {
    const check = geminiAdapter.authCheck();
    expect(check.cmd).toBe("gemini");
    expect(check.args).toEqual(["--version"]);
  });
});

// ── healthCheck ───────────────────────────────────────────

describe("gemini healthCheck", () => {
  test("runs gemini --version", () => {
    const check = geminiAdapter.healthCheck();
    expect(check.cmd).toBe("gemini");
    expect(check.args).toEqual(["--version"]);
  });
});

// ── argMap ────────────────────────────────────────────────

describe("gemini argMap", () => {
  test("model flag maps to --model <value>", () => {
    expect(geminiAdapter.argMap.model("gemini-2.5-pro")).toEqual(["--model", "gemini-2.5-pro"]);
  });

  test("resume flag maps to --resume <value>", () => {
    expect(geminiAdapter.argMap.resume("latest")).toEqual(["--resume", "latest"]);
  });

  test("resume flag supports session index", () => {
    expect(geminiAdapter.argMap.resume("5")).toEqual(["--resume", "5"]);
  });
});

// ── command building ──────────────────────────────────────

describe("gemini command building", () => {
  test("base args include --output-format stream-json and --yolo", () => {
    const built = buildArgs({ prompt: "do the thing" });
    expect(built.cmd).toBe("gemini");
    expect(built.args).toContain("--output-format");
    expect(built.args).toContain("stream-json");
    expect(built.args).toContain("--yolo");
  });

  test("--output-format stream-json comes before --yolo", () => {
    const built = buildArgs({ prompt: "go" });
    const fmtIdx = built.args.indexOf("--output-format");
    const yoloIdx = built.args.indexOf("--yolo");
    expect(fmtIdx).toBeLessThan(yoloIdx);
  });

  test("model flag is appended when provided", () => {
    const built = buildArgs({ prompt: "go", model: "gemini-2.0-flash" });
    expect(built.args).toContain("--model");
    expect(built.args).toContain("gemini-2.0-flash");
  });

  test("resume flag is appended when provided", () => {
    const built = buildArgs({ prompt: "go", resumeId: "latest" });
    expect(built.args).toContain("--resume");
    expect(built.args).toContain("latest");
    expect(built.warnings).toHaveLength(0);
  });

  test("extra args are appended at the end", () => {
    const built = buildArgs({ prompt: "go", extraArgs: ["--sandbox"] });
    expect(built.args.at(-1)).toBe("--sandbox");
  });

  test("stdin is set to the prompt", () => {
    const built = buildArgs({ prompt: "fix bugs" });
    expect(built.stdin).toBe("fix bugs");
  });
});
