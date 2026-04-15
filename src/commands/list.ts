import { existsSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";
import { AGENTS_DIR, loadAgentConfig, loadConfig } from "../config.ts";
import { getAdapter, listAdapterNames } from "../adapters/registry.ts";
import type { Adapter } from "../adapters/types.ts";

export function listCommand(): void {
  const globalConfig = loadConfig();
  const defaultAgent = globalConfig.default_agent;

  // Collect agent names: builtins + any extra YAMLs
  const names = new Set(listAdapterNames());
  if (existsSync(AGENTS_DIR)) {
    for (const file of readdirSync(AGENTS_DIR)) {
      if (file.endsWith(".yaml")) {
        names.add(basename(file, ".yaml"));
      }
    }
  }

  console.log("Available agents:\n");

  for (const name of [...names].sort()) {
    const config = loadAgentConfig(name);
    let adapter: Adapter;
    try {
      adapter = getAdapter(name, config);
    } catch (err: any) {
      console.log(`  ${name}  \x1b[31m✗ invalid config\x1b[0m`);
      console.log(`    ${err.message}`);
      continue;
    }
    const health = adapter.healthCheck();

    // Check if installed
    const check = spawnSync(health.cmd, health.args, { timeout: 5000, stdio: "pipe" });
    const installed = check.status === 0;
    const status = installed ? "\x1b[32m✓ installed\x1b[0m" : "\x1b[31m✗ not found\x1b[0m";
    const isDefault = name === defaultAgent ? " \x1b[33m(default)\x1b[0m" : "";

    console.log(`  ${name}${isDefault}  ${status}`);
    if (config.model) {
      console.log(`    model: ${config.model}`);
    }
  }

  console.log();
}
