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
  tokens?: { input: number; output: number; cacheWrite?: number; cacheRead?: number };
  duration: number;
}

type ArgMapper = (value: string) => string[];

type ArgMap = Record<string, ArgMapper>;

export interface AuthCheckResult {
  ok: boolean;
  method?: string;   // e.g. "oauth", "api_key", "third_party"
  provider?: string; // e.g. "bedrock", "openai", "anthropic"
  message: string;   // human-readable status
}

export interface Adapter {
  name: string;
  /** Base command and fixed args for headless invocation */
  base: { cmd: string; args: string[] };
  /** Declarative mapping: harnessctl flag -> agent CLI args */
  argMap: ArgMap;
  /** Parse captured output into structured result */
  parseOutput(stdout: string, stderr: string): Partial<RunResult>;
  /**
   * Optional post-run enrichment: read agent-written files (session JSONL,
   * SQLite DB, etc.) to fill in data not available from stdout — e.g. cache
   * token counts (Claude), token totals (Codex), session ID + cost (OpenCode).
   * Called after the process exits; must never throw.
   * startedAt is Date.now() captured just before spawn — use it to correlate
   * agent-written files to this specific invocation.
   */
  postRun?(cwd: string, result: RunResult, startedAt: number): Promise<Partial<RunResult>>;
  /** Command to check if the agent is installed */
  healthCheck(): { cmd: string; args: string[] };
  /** Check if authentication is configured and valid */
  authCheck(): { cmd: string; args: string[]; parse: (stdout: string, stderr: string, exitCode: number | null) => AuthCheckResult };
}

export interface AgentConfig {
  adapter?: string;
  cmd?: string;
  args?: string[];
  model_arg?: string;
  resume_arg?: string;
  healthcheck?: {
    cmd?: string;
    args?: string[];
  };
  model?: string;
  env?: Record<string, string>;
  timeout?: number;
  extra_args?: string[];
  /** Agent to fall back to when this agent fails (e.g. out of credits/tokens) */
  fallback?: string;
}
