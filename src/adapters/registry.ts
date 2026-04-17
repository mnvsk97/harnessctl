import type { Adapter, AgentConfig, AuthCheckResult, InvokeIntent } from "./types.ts";
import { spawnSync } from "node:child_process";
import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";
import { opencodeAdapter } from "./opencode.ts";
import { geminiAdapter } from "./gemini.ts";

const builtinAdapters: Record<string, Adapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
  gemini: geminiAdapter,
};

function createGenericAdapter(name: string, config: AgentConfig): Adapter {
  if (!config.cmd) {
    throw new Error(
      `Custom agent "${name}" is missing required field "cmd" in ~/.harnessctl/agents/${name}.yaml`,
    );
  }

  const cmd = config.cmd;
  const modelArg = config.model_arg;
  const resumeArg = config.resume_arg;
  const healthcheck = config.healthcheck;

  return {
    name,
    base: {
      cmd,
      args: config.args ?? [],
    },
    stdinMode: "prompt",
    argMap: {
      ...(modelArg ? { model: (val: string) => [modelArg, val] } : {}),
      ...(resumeArg ? { resume: (val: string) => [resumeArg, val] } : {}),
    },
    parseOutput(stdout: string, stderr: string) {
      const output = stdout.trim() || stderr.trim();
      const lines = output.split("\n").filter(Boolean);
      return {
        summary: lines.at(-1) ?? "",
      };
    },
    healthCheck() {
      return {
        cmd: healthcheck?.cmd ?? cmd,
        args: healthcheck?.args ?? ["--version"],
      };
    },
    authCheck() {
      return {
        cmd: healthcheck?.cmd ?? cmd,
        args: healthcheck?.args ?? ["--version"],
        parse(_stdout: string, _stderr: string, exitCode: number | null): AuthCheckResult {
          if (exitCode !== null) {
            return { ok: true, message: "auth check skipped" };
          }
          return { ok: false, message: `failed to start ${name}` };
        },
      };
    },
  };
}

export function getAdapter(name: string, config: AgentConfig): Adapter {
  const adapter = builtinAdapters[name];
  if (adapter) {
    return adapter;
  }

  if (config.cmd) {
    return createGenericAdapter(name, config);
  }

  throw new Error(
    `Unknown agent "${name}". Supported built-ins: ${Object.keys(builtinAdapters).join(", ")}. ` +
    `Custom agents require a "cmd" field in ~/.harnessctl/agents/${name}.yaml`,
  );
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
