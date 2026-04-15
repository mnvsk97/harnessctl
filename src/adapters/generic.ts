import type { Adapter, AgentConfig, AuthCheckResult, RunResult } from "./types.ts";

export function createGenericAdapter(name: string, config: AgentConfig): Adapter {
  const command = config.command ?? name;
  const baseArgs = config.args ?? [];
  const healthCheckCmd = config.health_check ?? `${command} --version`;

  // Build argMap from YAML's arg_map (e.g. { model: "--llm" })
  const yamlArgMap = config.arg_map ?? {};
  const argMap: Record<string, (val: string) => string[]> = {};
  for (const [key, flag] of Object.entries(yamlArgMap)) {
    argMap[key] = (val) => [flag, val];
  }

  return {
    name,

    base: { cmd: command, args: baseArgs },

    stdinMode: "prompt",

    argMap,

    parseOutput(stdout: string, _stderr: string): Partial<RunResult> {
      const lines = stdout.split("\n").filter(Boolean);
      const summary = lines[lines.length - 1]?.trim() ?? "";
      return { summary };
    },

    healthCheck() {
      const parts = healthCheckCmd.split(/\s+/);
      return { cmd: parts[0], args: parts.slice(1) };
    },

    authCheck() {
      // Generic adapters skip auth check — always pass
      return {
        cmd: "true",
        args: [],
        parse(_stdout: string, _stderr: string, _exitCode: number | null): AuthCheckResult {
          return { ok: true, message: "skipped (generic adapter)" };
        },
      };
    },
  };
}
