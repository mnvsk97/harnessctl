import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
