import { spawn } from "node:child_process";
import { loadConfig, loadAgentConfig, resolveEnv, isKnownAgent } from "../config.ts";
import { getAdapter, checkAuth, listAdapterNames } from "../adapters/registry.ts";
import { header, separator, c } from "../ui.ts";

export interface ShellOptions {
  agent?: string;
  extraArgs: string[];
}

/**
 * Interactive command map: agent name -> bare command + args for REPL mode.
 * These strip all headless/pipe flags so the agent owns the terminal.
 */
const interactiveBase: Record<string, { cmd: string; args: string[] }> = {
  claude:   { cmd: "claude", args: [] },
  codex:    { cmd: "codex", args: [] },
  opencode: { cmd: "opencode", args: [] },
};

export async function shellCommand(opts: ShellOptions): Promise<number> {
  const globalConfig = loadConfig();
  const agentName = opts.agent ?? globalConfig.default_agent;

  if (!isKnownAgent(agentName, listAdapterNames())) {
    const known = listAdapterNames();
    console.error(`${c.red("✗")} unknown agent: "${agentName}"`);
    console.error(c.dim(`  available: ${known.join(", ")}`));
    return 1;
  }

  const agentConfig = loadAgentConfig(agentName);
  const adapter = getAdapter(agentName, agentConfig);

  // Pre-flight auth check
  const auth = checkAuth(adapter);
  if (!auth.ok) {
    console.error(`${c.red("✗")} ${agentName}: ${auth.message}`);
    console.error(c.dim(`  tip: run "harnessctl doctor" for diagnostics`));
    return 1;
  }

  const base = interactiveBase[agentName];
  if (!base) {
    console.error(`${c.red("✗")} shell mode not supported for "${agentName}"`);
    return 1;
  }

  const args = [...base.args];

  // Map model flag if configured
  if (agentConfig.model && adapter.argMap.model) {
    args.push(...adapter.argMap.model(agentConfig.model));
  }

  // Append extra args from config + CLI
  args.push(...(agentConfig.extra_args ?? []), ...opts.extraArgs);

  const env = resolveEnv(agentConfig.env ?? {});

  header(c.bold("harnessctl shell"), [agentName, auth.message]);
  separator();

  return new Promise((resolve) => {
    const child = spawn(base.cmd, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: "inherit",
    });

    child.on("close", (code) => {
      resolve(code ?? 0);
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        console.error(`${c.red("✗")} "${base.cmd}" not found in PATH`);
        console.error(c.dim(`  tip: run "harnessctl doctor" to check agent health`));
      } else {
        console.error(`${c.red("✗")} failed to start ${base.cmd}: ${err.message}`);
      }
      resolve(1);
    });
  });
}
