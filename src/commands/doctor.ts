import { spawnSync } from "node:child_process";
import { loadAgentConfig, loadConfig, CONFIG_PATH } from "../config.ts";
import { getAdapter, checkAuth } from "../adapters/registry.ts";
import { readFileSync } from "node:fs";
import YAML from "yaml";

/** Check if user has run `harnessctl setup`. */
function hasRunSetup(): boolean {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const config = YAML.parse(raw);
    return config?.setup_done === true;
  } catch {
    return false;
  }
}

/** Collect the configured agent chain: default agent + fallback agents. */
function getConfiguredAgents(): string[] {
  const globalConfig = loadConfig();
  const agents: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = globalConfig.default_agent;

  while (current && !seen.has(current)) {
    seen.add(current);
    agents.push(current);
    const config = loadAgentConfig(current);
    current = config.fallback;
  }

  return agents;
}

export function doctorCommand(): void {
  const globalConfig = loadConfig();
  console.log("harnessctl doctor\n");

  if (!hasRunSetup()) {
    console.log("\x1b[33m⚠ Setup not complete.\x1b[0m Run \x1b[1mharnessctl setup\x1b[0m to configure your agents.\n");
  }

  console.log(`Config: default_agent=${globalConfig.default_agent}\n`);

  const agents = getConfiguredAgents();
  let allOk = true;

  for (const name of agents) {
    const config = loadAgentConfig(name);
    const adapter = getAdapter(name, config);
    const health = adapter.healthCheck();
    const role = name === globalConfig.default_agent ? "default" : "fallback";

    process.stdout.write(`  ${name} (${role}): `);
    const check = spawnSync(health.cmd, health.args, { timeout: 5000, stdio: "pipe" });

    if (check.status === 0) {
      const version = check.stdout?.toString().trim().split("\n")[0] ?? "";
      const auth = checkAuth(adapter);
      const fallback = config.fallback ? ` | fallback: ${config.fallback}` : "";

      if (auth.ok) {
        console.log(`\x1b[32m✓\x1b[0m ${version} | auth: \x1b[32m✓\x1b[0m ${auth.message}${fallback}`);
      } else {
        // Installed but auth failed — yellow warning, not green
        console.log(`\x1b[33m⚠\x1b[0m ${version} | auth: \x1b[31m✗\x1b[0m ${auth.message}${fallback}`);
        allOk = false;
      }
    } else if (check.error) {
      const err = check.error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        console.log(`\x1b[31m✗ not installed\x1b[0m ("${health.cmd}" not found in PATH)`);
      } else if (err.code === "ETIMEDOUT") {
        console.log(`\x1b[31m✗ timed out\x1b[0m (health check took too long)`);
      } else {
        console.log(`\x1b[31m✗ error\x1b[0m (${err.message})`);
      }
      allOk = false;
    } else {
      console.log(`\x1b[31m✗ error\x1b[0m (exit code ${check.status})`);
      allOk = false;
    }
  }

  console.log();
  if (allOk) {
    console.log("All configured agents healthy.");
  } else {
    console.log("Some configured agents have issues.");
    console.log("  Install missing agents or run their login commands to fix auth issues.");
  }
}
