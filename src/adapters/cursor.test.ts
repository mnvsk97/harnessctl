import { describe, test, expect } from "bun:test";
import { cursorAdapter } from "./cursor.ts";

describe("cursor adapter – parseOutput", () => {
  test("extracts summary and sessionId from result event", () => {
    const stdout = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Fixed the null pointer bug.",
      session_id: "sess-abc-123",
      duration_ms: 4200,
    });
    const out = cursorAdapter.parseOutput(stdout, "");
    expect(out.summary).toBe("Fixed the null pointer bug.");
    expect(out.sessionId).toBe("sess-abc-123");
  });

  test("ignores result events where is_error is true", () => {
    const stdout = JSON.stringify({
      type: "result",
      is_error: true,
      result: "Something went wrong",
      session_id: "sess-err",
    });
    const out = cursorAdapter.parseOutput(stdout, "");
    expect(out.summary).toBeUndefined();
    expect(out.sessionId).toBeUndefined();
  });

  test("falls back to last plain-text line when no result event", () => {
    const stdout = "Thinking...\nDone, applied 3 changes.";
    const out = cursorAdapter.parseOutput(stdout, "");
    expect(out.summary).toBe("Done, applied 3 changes.");
  });

  test("handles mixed JSON and plain-text lines", () => {
    const lines = [
      JSON.stringify({ type: "system_init" }),
      "Progress: 50%",
      JSON.stringify({ type: "result", is_error: false, result: "All done.", session_id: "s1" }),
    ];
    const out = cursorAdapter.parseOutput(lines.join("\n"), "");
    expect(out.summary).toBe("All done.");
    expect(out.sessionId).toBe("s1");
  });

  test("returns empty result on empty output", () => {
    const out = cursorAdapter.parseOutput("", "");
    expect(out.summary).toBeUndefined();
  });
});

describe("cursor adapter – authCheck", () => {
  const { parse } = cursorAdapter.authCheck();

  test("reports authenticated when exit 0 and no negative keywords", () => {
    const result = parse("Logged in as user@example.com\n", "", 0);
    expect(result.ok).toBe(true);
    expect(result.message).toBe("authenticated");
  });

  test("reports authenticated for generic exit-0 response", () => {
    const result = parse("Status: ok", "", 0);
    expect(result.ok).toBe(true);
  });

  test("reports failure on non-zero exit", () => {
    const result = parse("", "error: unauthenticated", 1);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("agent login");
  });

  test("reports failure when output contains 'not logged in'", () => {
    const result = parse("Not logged in", "", 0);
    expect(result.ok).toBe(false);
  });
});

describe("cursor adapter – base and argMap", () => {
  test("base command is agent with headless flags", () => {
    expect(cursorAdapter.base.cmd).toBe("agent");
    expect(cursorAdapter.base.args).toContain("-p");
    expect(cursorAdapter.base.args).toContain("--force");
    expect(cursorAdapter.base.args).toContain("--output-format");
    expect(cursorAdapter.base.args).toContain("stream-json");
  });

  test("argMap maps model to -m flag", () => {
    const args = cursorAdapter.argMap.model!("claude-4");
    expect(args).toEqual(["-m", "claude-4"]);
  });

  test("argMap maps resume to --resume flag", () => {
    const args = cursorAdapter.argMap.resume!("sess-xyz");
    expect(args).toEqual(["--resume", "sess-xyz"]);
  });

  test("healthCheck uses agent --version", () => {
    const hc = cursorAdapter.healthCheck();
    expect(hc.cmd).toBe("agent");
    expect(hc.args).toContain("--version");
  });
});
