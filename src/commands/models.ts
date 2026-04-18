import { spawnSync } from "node:child_process";
import { loadAgentConfig } from "../config.ts";
import { getAdapter, listAdapterNames } from "../adapters/registry.ts";

export function modelsCommand(argv: string[]): void {
  let agent: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--agent" || argv[i] === "-a") {
      agent = argv[++i];
    }
  }

  if (!agent) {
    console.error("Error: --agent is required. Usage: harnessctl models --agent <name>");
    console.error(`  Available agents: ${listAdapterNames().join(", ")}`);
    process.exit(1);
  }

  const config = loadAgentConfig(agent);
  const adapter = getAdapter(agent, config);

  if (!adapter.listModels) {
    console.log(`${agent}: model listing not supported`);
    return;
  }

  const spec = adapter.listModels();

  if ("static" in spec) {
    console.log(`\nAvailable models for ${agent}:\n`);
    for (const m of spec.static) {
      console.log(`  ${m}`);
    }
    console.log();
    return;
  }

  // Dynamic: run the CLI command
  const result = spawnSync(spec.cmd, spec.args, {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15000,
  });

  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      console.error(`Error: "${spec.cmd}" not found. Is ${agent} installed?`);
    } else {
      console.error(`Error listing models: ${err.message}`);
    }
    process.exit(1);
  }

  const stdout = result.stdout?.toString() ?? "";
  const stderr = result.stderr?.toString() ?? "";
  const output = (stdout + stderr).trim();

  if (!output) {
    console.log(`${agent}: no models returned (check authentication)`);
    return;
  }

  console.log(`\nAvailable models for ${agent}:\n`);
  console.log(output);
  console.log();
}
