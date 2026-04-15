import { spawn } from "node:child_process";
import { loadConfig, loadAgentConfig, resolveEnv, isKnownAgent } from "../config.ts";
import { getAdapter, checkAuth, listAdapterNames } from "../adapters/registry.ts";

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
    console.error(`\x1b[31m[harnessctl] unknown agent: "${agentName}"\x1b[0m`);
    console.error(`\x1b[2m[harnessctl] available agents: ${known.join(", ")}\x1b[0m`);
    return 1;
  }

  const agentConfig = loadAgentConfig(agentName);
  const adapter = getAdapter(agentName, agentConfig);

  // Pre-flight auth check
  const auth = checkAuth(adapter);
  if (!auth.ok) {
    console.error(`\x1b[31m[harnessctl] ${agentName}: ${auth.message}\x1b[0m`);
    console.error(`\x1b[2m[harnessctl] tip: run "harnessctl doctor" for detailed diagnostics\x1b[0m`);
    return 1;
  }
  console.error(`\x1b[2m[harnessctl] ${agentName}: ${auth.message}\x1b[0m`);

  const base = interactiveBase[agentName];
  if (!base) {
    console.error(`\x1b[31m[harnessctl] shell mode not supported for "${agentName}"\x1b[0m`);
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

  console.error(`\x1b[2m[harnessctl] launching ${agentName} interactively...\x1b[0m`);

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
        console.error(`\x1b[31m[harnessctl] "${base.cmd}" not found in PATH\x1b[0m`);
        console.error(`\x1b[2m[harnessctl] tip: run "harnessctl doctor" to check agent health\x1b[0m`);
      } else {
        console.error(`\x1b[31m[harnessctl] failed to start ${base.cmd}: ${err.message}\x1b[0m`);
      }
      resolve(1);
    });
  });
}
