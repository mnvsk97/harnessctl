import type { Adapter, AgentConfig, InvokeIntent } from "./types.ts";
import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";
import { opencodeAdapter } from "./opencode.ts";
import { createGenericAdapter } from "./generic.ts";

const builtinAdapters: Record<string, Adapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
};

export function getAdapter(name: string, config: AgentConfig): Adapter {
  if (config.adapter === "generic") {
    return createGenericAdapter(name, config);
  }
  return builtinAdapters[name] ?? createGenericAdapter(name, config);
}

export function listAdapterNames(): string[] {
  return Object.keys(builtinAdapters);
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
