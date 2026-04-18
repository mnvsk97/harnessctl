import { spawnSync } from "node:child_process";
import { loadAgentConfig, loadConfig, CONFIG_PATH } from "../config.ts";
import { getAdapter, checkAuth } from "../adapters/registry.ts";
import { readFileSync } from "node:fs";
import { header, footer, separator, c } from "../ui.ts";
import YAML from "yaml";
import type { Adapter } from "../adapters/types.ts";

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

/** Probe each configured agent for MCP servers. Best-effort per agent. */
function mcpCheck(): void {
  const agents = getConfiguredAgents();
  header(c.bold("harnessctl doctor --mcp"));
  separator();
  let any = false;
  for (const name of agents) {
    const config = loadAgentConfig(name);
    let cmd: string;
    try { cmd = getAdapter(name, config).base.cmd; } catch { continue; }
    const r = spawnSync(cmd, ["mcp", "list"], { timeout: 5000, stdio: "pipe" });
    const combined = (r.stdout?.toString() ?? "") + (r.stderr?.toString() ?? "");
    if (r.error || r.status !== 0) {
      console.error(`  ${c.dim("·")} ${c.bold(name)} — ${c.dim("no mcp support / not configured")}`);
      continue;
    }
    any = true;
    const lines = combined.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      console.error(`  ${c.green("✓")} ${c.bold(name)} — ${c.dim("no MCP servers configured")}`);
    } else {
      console.error(`  ${c.green("✓")} ${c.bold(name)}`);
      for (const line of lines.slice(0, 20)) console.error(`      ${c.dim(line)}`);
    }
  }
  separator();
  footer([any ? `${c.green("✓")} mcp probe complete` : `${c.yellow("⚠")} no agent reported MCP support`]);
}

export function doctorCommand(argv: string[] = []): void {
  if (argv.includes("--mcp")) {
    mcpCheck();
    return;
  }
  const globalConfig = loadConfig();

  header(c.bold("harnessctl doctor"), [`default: ${globalConfig.default_agent}`]);
  separator();

  if (!hasRunSetup()) {
    console.error(`  ${c.yellow("⚠")} setup not complete — run ${c.bold("harnessctl setup")} to configure`);
    separator();
  }

  const agents = getConfiguredAgents();
  let allOk = true;

  for (const name of agents) {
    const config = loadAgentConfig(name);
    let adapter: Adapter;
    try {
      adapter = getAdapter(name, config);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ${c.red("✗")} ${c.bold(name)} — ${message}`);
      allOk = false;
      continue;
    }
    const health = adapter.healthCheck();
    const role = name === globalConfig.default_agent ? c.dim("default") : c.dim("fallback");

    const check = spawnSync(health.cmd, health.args, { timeout: 5000, stdio: "pipe" });

    if (check.status === 0) {
      const version = check.stdout?.toString().trim().split("\n")[0] ?? "";
      const auth = checkAuth(adapter);
      const fallback = config.fallback ? ` ${c.dim("→")} ${config.fallback}` : "";

      if (auth.ok) {
        console.error(`  ${c.green("✓")} ${c.bold(name)} ${c.dim(version)} — ${auth.message}${fallback} ${role}`);
      } else {
        console.error(`  ${c.yellow("⚠")} ${c.bold(name)} ${c.dim(version)} — ${c.red(auth.message)}${fallback} ${role}`);
        allOk = false;
      }
    } else if (check.error) {
      const err = check.error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        console.error(`  ${c.red("✗")} ${c.bold(name)} — not installed ${role}`);
      } else if (err.code === "ETIMEDOUT") {
        console.error(`  ${c.red("✗")} ${c.bold(name)} — timed out ${role}`);
      } else {
        console.error(`  ${c.red("✗")} ${c.bold(name)} — ${err.message} ${role}`);
      }
      allOk = false;
    } else {
      console.error(`  ${c.red("✗")} ${c.bold(name)} — error (exit ${check.status}) ${role}`);
      allOk = false;
    }
  }

  separator();
  if (allOk) {
    footer([`${c.green("✓")} all configured agents healthy`]);
  } else {
    footer([`${c.yellow("⚠")} some agents need attention`]);
  }
}
