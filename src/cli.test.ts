import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cliPath = new URL("./cli.ts", import.meta.url).pathname;
const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as { version: string };
const tempHomes: string[] = [];

afterEach(() => {
  for (const dir of tempHomes.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function runCli(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "harnessctl-cli-"));
  tempHomes.push(home);

  return runCliWithHome(args, home);
}

async function runCliWithHome(args: string[], home: string) {
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", cliPath, ...args],
    env: { ...Bun.env, HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

function writeRunFixture(home: string, runId: string, prompt: string, agent = "codex") {
  const runsDir = join(home, ".harnessctl", "runs");
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(runsDir, `${runId}.json`), JSON.stringify({
    agent,
    prompt,
    cwd: "/tmp/example",
    result: {
      exitCode: 0,
      summary: "done",
      duration: 1.2,
      exitReason: "success",
    },
    timestamp: "2026-05-07T12:00:00.000Z",
  }, null, 2));
}

describe("cli version", () => {
  test("prints package version for --version", async () => {
    const result = await runCli(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
    expect(result.stderr).toBe("");
  });

  test("prints package version for -v", async () => {
    const result = await runCli(["-v"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
    expect(result.stderr).toBe("");
  });

  test("prints package version for version command", async () => {
    const result = await runCli(["version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
    expect(result.stderr).toBe("");
  });
});

describe("cli logs", () => {
  test("filters logs to a specific run ID", async () => {
    const home = mkdtempSync(join(tmpdir(), "harnessctl-cli-"));
    tempHomes.push(home);
    writeRunFixture(home, "1778171521246-codex", "selected prompt", "codex");
    writeRunFixture(home, "1778171521247-claude", "other prompt", "claude");

    const result = await runCliWithHome(["logs", "--run-id", "1778171521246-codex"], home);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1778171521246-codex");
    expect(result.stdout).toContain("selected prompt");
    expect(result.stdout).not.toContain("1778171521247-claude");
    expect(result.stdout).not.toContain("other prompt");
  });
});
