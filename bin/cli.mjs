#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, "..", "src", "cli.ts");

function tryRun(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: "inherit", env: process.env });
    return true;
  } catch (err) {
    // If the process ran but exited non-zero, forward the exit code
    if (err.status != null) process.exit(err.status);
    // If the command wasn't found, return false to try next
    return false;
  }
}

const argv = process.argv.slice(2);

// Try bun first (native TS support, fastest)
if (!tryRun("bun", ["run", entry, ...argv])) {
  const nodeVersion = parseInt(process.versions.node, 10);
  if (nodeVersion >= 22) {
    // Node 22+ can strip/transform TypeScript natively
    tryRun("node", [
      "--experimental-strip-types",
      "--experimental-transform-types",
      "--no-warnings",
      entry,
      ...argv,
    ]);
  } else {
    console.error(
      "harnessctl requires Bun (any version) or Node.js >= 22.\n" +
        "Install Bun: curl -fsSL https://bun.sh/install | bash\n" +
        "Or upgrade Node: https://nodejs.org"
    );
    process.exit(1);
  }
}
