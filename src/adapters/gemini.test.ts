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
  test("extracts summary from JSON result event", () => {
    const stdout = JSON.stringify({ type: "result", result: "All tests pass." });
    const out = geminiAdapter.parseOutput(stdout, "");
    expect(out.summary).toBe("All tests pass.");
  });

  test("extracts summary from JSON done event", () => {
    const stdout = JSON.stringify({ type: "done", message: "Done." });
    const out = geminiAdapter.parseOutput(stdout, "");
    expect(out.summary).toBe("Done.");
  });

  test("extracts summary from JSON response event", () => {
    const stdout = JSON.stringify({ type: "response", text: "Here is the answer." });
    const out = geminiAdapter.parseOutput(stdout, "");
    expect(out.summary).toBe("Here is the answer.");
  });

  test("falls back to last plain-text line when no JSON event matches", () => {
    const stdout = "Thinking...\nWorking on it...\nDone, files updated.";
    const out = geminiAdapter.parseOutput(stdout, "");
    expect(out.summary).toBe("Done, files updated.");
  });

  test("skips JSON lines when scanning for plain-text fallback", () => {
    const stdout = [
      "Some streamed text",
      JSON.stringify({ type: "tool_use", tool: "bash" }),
      "Final plain line",
      JSON.stringify({ type: "tool_end" }),
    ].join("\n");
    const out = geminiAdapter.parseOutput(stdout, "");
    expect(out.summary).toBe("Final plain line");
  });

  test("parses token usage from result event (usage field)", () => {
    const stdout = JSON.stringify({
      type: "result",
      result: "ok",
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const out = geminiAdapter.parseOutput(stdout, "");
    expect(out.tokens).toEqual({ input: 100, output: 50 });
  });

  test("parses token usage from usageMetadata (Gemini API style)", () => {
    const stdout = JSON.stringify({
      type: "result",
      result: "ok",
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 80 },
    });
    const out = geminiAdapter.parseOutput(stdout, "");
    expect(out.tokens).toEqual({ input: 200, output: 80 });
  });

  test("returns empty summary for empty output", () => {
    const out = geminiAdapter.parseOutput("", "");
    expect(out.summary).toBeUndefined();
  });

  test("handles multi-line output with result event mid-stream", () => {
    const stdout = [
      "Planning...",
      JSON.stringify({ type: "result", result: "Refactor complete." }),
      "",
    ].join("\n");
    const out = geminiAdapter.parseOutput(stdout, "");
    expect(out.summary).toBe("Refactor complete.");
  });
});

// ── authCheck.parse ───────────────────────────────────────

describe("gemini authCheck.parse", () => {
  const { parse } = geminiAdapter.authCheck();

  let savedApiKey: string | undefined;

  beforeEach(() => {
    savedApiKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    if (savedApiKey !== undefined) {
      process.env.GEMINI_API_KEY = savedApiKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
  });

  test("ok when exit 0 and output contains 'logged in'", () => {
    const result = parse("You are logged in as user@example.com", "", 0);
    expect(result.ok).toBe(true);
    expect(result.method).toBe("oauth");
    expect(result.message).toContain("authenticated");
  });

  test("ok when exit 0 and output contains 'authenticated'", () => {
    const result = parse("authenticated via google account", "", 0);
    expect(result.ok).toBe(true);
    expect(result.method).toBe("oauth");
  });

  test("ok when exit 0 and output contains 'api key'", () => {
    const result = parse("using api key for authentication", "", 0);
    expect(result.ok).toBe(true);
    expect(result.method).toBe("api_key");
  });

  test("ok when exit 0 with no recognized keyword", () => {
    const result = parse("status: ok", "", 0);
    expect(result.ok).toBe(true);
    expect(result.method).toBeUndefined();
  });

  test("falls back to GEMINI_API_KEY when exit non-zero", () => {
    process.env.GEMINI_API_KEY = "AIza-test-key";
    const result = parse("", "", 1);
    expect(result.ok).toBe(true);
    expect(result.method).toBe("api_key");
    expect(result.message).toContain("GEMINI_API_KEY");
  });

  test("not ok when exit non-zero and no GEMINI_API_KEY", () => {
    const result = parse("", "", 1);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("gemini auth login");
  });

  test("not ok when exit null and no GEMINI_API_KEY", () => {
    const result = parse("", "", null);
    expect(result.ok).toBe(false);
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
    const mapped = geminiAdapter.argMap.model("gemini-2.5-pro");
    expect(mapped).toEqual(["--model", "gemini-2.5-pro"]);
  });

  test("resume flag is not supported", () => {
    expect(geminiAdapter.argMap.resume).toBeUndefined();
  });
});

// ── command building ──────────────────────────────────────

describe("gemini command building", () => {
  test("base command is gemini --yolo", () => {
    const built = buildArgs({ prompt: "refactor this" });
    expect(built.cmd).toBe("gemini");
    expect(built.args).toContain("--yolo");
  });

  test("model flag is appended when provided", () => {
    const built = buildArgs({ prompt: "go", model: "gemini-2.0-flash" });
    expect(built.args).toEqual(["--yolo", "--model", "gemini-2.0-flash"]);
  });

  test("resume emits a warning (not supported)", () => {
    const built = buildArgs({ prompt: "go", resumeId: "sess-abc" });
    expect(built.warnings).toHaveLength(1);
    expect(built.warnings[0]).toContain("--resume");
    expect(built.args).not.toContain("sess-abc");
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
