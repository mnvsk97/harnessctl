import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncMemory } from "./memory.ts";

describe("syncMemory", () => {
  test("creates nested native memory files such as DeepAgents project AGENTS.md", () => {
    const cwd = mkdtempSync(`${tmpdir()}/harnessctl-memory-`);
    try {
      const touched = syncMemory(cwd, "Project uses Bun and TypeScript.");
      const deepagentsMemory = join(cwd, ".deepagents", "AGENTS.md");

      expect(touched).toContain(".deepagents/AGENTS.md");
      expect(existsSync(deepagentsMemory)).toBe(true);
      expect(readFileSync(deepagentsMemory, "utf8")).toContain("Project uses Bun and TypeScript.");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
