export interface InvokeIntent {
  prompt: string;
  model?: string;
  resumeId?: string;
  cwd: string;
  extraArgs: string[];
  env: Record<string, string>;
}

export interface RunResult {
  exitCode: number | null;
  summary: string;
  sessionId?: string;
  cost?: number;
  tokens?: { input: number; output: number };
  duration: number;
}

/**
 * Maps a harnessctl flag to agent CLI args.
 * Returns the arg array to append, or null to skip (unsupported).
 */
export type ArgMapper = (value: string) => string[];

/**
 * Declares which harnessctl flags an adapter supports and how they translate.
 * Keys are harnessctl flag names (model, resume).
 * Values are the translation function.
 */
export type ArgMap = Record<string, ArgMapper>;

export interface Adapter {
  name: string;
  /** Base command and fixed args for headless invocation */
  base: { cmd: string; args: string[] };
  /** How the prompt is delivered — written to stdin */
  stdinMode: "prompt";
  /** Declarative mapping: harnessctl flag -> agent CLI args */
  argMap: ArgMap;
  /** Parse captured output into structured result */
  parseOutput(stdout: string, stderr: string): Partial<RunResult>;
  /** Command to check if the agent is installed */
  healthCheck(): { cmd: string; args: string[] };
}

export interface AgentConfig {
  adapter?: string;
  model?: string;
  env?: Record<string, string>;
  timeout?: number;
  extra_args?: string[];
  // Generic adapter fields
  command?: string;
  args?: string[];
  stdin_mode?: string;
  output_format?: string;
  health_check?: string;
  arg_map?: Record<string, string>;
}
