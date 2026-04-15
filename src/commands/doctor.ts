import { existsSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";
import { AGENTS_DIR, loadAgentConfig, loadConfig } from "../config.ts";
import { getAdapter, listAdapterNames } from "../adapters/registry.ts";

export function doctorCommand(): void {
  const globalConfig = loadConfig();
  console.log("harnessctl doctor\n");
  console.log(`Config: default_agent=${globalConfig.default_agent}\n`);

  const names = new Set(listAdapterNames());
  if (existsSync(AGENTS_DIR)) {
    for (const file of readdirSync(AGENTS_DIR)) {
      if (file.endsWith(".yaml")) {
        names.add(basename(file, ".yaml"));
      }
    }
  }

  let allOk = true;

  for (const name of [...names].sort()) {
    const config = loadAgentConfig(name);
    const adapter = getAdapter(name, config);
    const health = adapter.healthCheck();

    process.stdout.write(`  ${name}: `);
    const check = spawnSync(health.cmd, health.args, { timeout: 5000, stdio: "pipe" });

    if (check.status === 0) {
      const version = check.stdout?.toString().trim().split("\n")[0] ?? "";
      console.log(`\x1b[32m✓\x1b[0m ${version}`);
    } else if (check.error) {
      console.log(`\x1b[31m✗ not installed\x1b[0m (${health.cmd} not found in PATH)`);
      allOk = false;
    } else {
      console.log(`\x1b[31m✗ error\x1b[0m (exit code ${check.status})`);
      allOk = false;
    }
  }

  console.log();
  if (allOk) {
    console.log("All agents healthy.");
  } else {
    console.log("Some agents are missing or unhealthy.");
  }
}
