import type { Adapter, AgentConfig, AuthCheckResult, InvokeIntent } from "./types.ts";
import { spawnSync } from "node:child_process";
import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";
import { opencodeAdapter } from "./opencode.ts";
const builtinAdapters: Record<string, Adapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
};

export function getAdapter(name: string, _config: AgentConfig): Adapter {
  const adapter = builtinAdapters[name];
  if (!adapter) {
    throw new Error(
      `Unknown agent "${name}". Supported agents: ${Object.keys(builtinAdapters).join(", ")}`,
    );
  }
  return adapter;
}

export function listAdapterNames(): string[] {
  return Object.keys(builtinAdapters);
}

/**
 * Run the adapter's auth check and return the result.
 */
export function checkAuth(adapter: Adapter): AuthCheckResult {
  const check = adapter.authCheck();
  const result = spawnSync(check.cmd, check.args, {
    timeout: 10000,
    stdio: "pipe",
  });

  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return {
        ok: false,
        message: `${adapter.name} not installed — "${check.cmd}" not found in PATH`,
      };
    }
    return { ok: false, message: `auth check failed: ${err.message}` };
  }

  return check.parse(
    result.stdout?.toString() ?? "",
    result.stderr?.toString() ?? "",
    result.status,
  );
}

/**
 * Builds the full command from an adapter + intent using the adapter's argMap.
 * This is the single place where harnessctl flags are translated to agent CLI args.
 * Returns warnings for flags the adapter doesn't support.
 */
export function buildCommand(
  adapter: Adapter,
  intent: InvokeIntent,
): { cmd: string; args: string[]; stdin: string; warnings: string[] } {
  const args = [...adapter.base.args];
  const warnings: string[] = [];

  // Map harnessctl flags -> agent flags via argMap
  const flagsToMap: [string, string | undefined][] = [
    ["model", intent.model],
    ["resume", intent.resumeId],
  ];

  for (const [flag, value] of flagsToMap) {
    if (value === undefined) continue;
    const mapper = adapter.argMap[flag];
    if (mapper) {
      args.push(...mapper(value));
    } else {
      warnings.push(`--${flag} is not supported by ${adapter.name}, ignoring`);
    }
  }

  // Append passthrough args
  args.push(...intent.extraArgs);

  return {
    cmd: adapter.base.cmd,
    args,
    stdin: intent.prompt,
    warnings,
  };
}
