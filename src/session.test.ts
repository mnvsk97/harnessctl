import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Use a temp directory to isolate filesystem tests
const TEST_DIR = join(tmpdir(), `harnessctl-session-test-${Date.now()}`);
const SESSIONS_DIR = join(TEST_DIR, "sessions");

// We test validateSessionName as a pure function (no mocks needed)
import { validateSessionName } from "./session.ts";

describe("validateSessionName", () => {
  test("accepts lowercase alphanumeric names", () => {
    expect(validateSessionName("auth")).toBe(true);
    expect(validateSessionName("my-feature")).toBe(true);
    expect(validateSessionName("fix-123")).toBe(true);
    expect(validateSessionName("a")).toBe(true);
  });

  test("accepts names with underscores", () => {
    expect(validateSessionName("auth_refactor")).toBe(true);
    expect(validateSessionName("my_long_feature_name")).toBe(true);
  });

  test("accepts names with mixed hyphens and underscores", () => {
    expect(validateSessionName("auth-refactor_v2")).toBe(true);
  });

  test("rejects uppercase", () => {
    expect(validateSessionName("Auth")).toBe(false);
    expect(validateSessionName("MY-FEATURE")).toBe(false);
  });

  test("rejects spaces", () => {
    expect(validateSessionName("my feature")).toBe(false);
  });

  test("rejects special characters", () => {
    expect(validateSessionName("my.feature")).toBe(false);
    expect(validateSessionName("feat!")).toBe(false);
    expect(validateSessionName("a@b")).toBe(false);
  });

  test("rejects leading/trailing hyphens or underscores", () => {
    expect(validateSessionName("-start")).toBe(false);
    expect(validateSessionName("_start")).toBe(false);
    expect(validateSessionName("end-")).toBe(false);
    expect(validateSessionName("end_")).toBe(false);
  });

  test("rejects empty string", () => {
    expect(validateSessionName("")).toBe(false);
  });

  test("rejects names longer than 64 chars", () => {
    const longName = "a" + "b".repeat(63) + "c"; // 65 chars
    expect(validateSessionName(longName)).toBe(false);
  });

  test("accepts exactly 64-char names", () => {
    const name64 = "a" + "b".repeat(62) + "c"; // 64 chars
    expect(validateSessionName(name64)).toBe(true);
  });
});
