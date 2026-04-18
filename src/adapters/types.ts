export interface InvokeIntent {
  prompt: string;
  model?: string;
  resumeId?: string;
  cwd: string;
  extraArgs: string[];
  env: Record<string, string>;
}

/**
 * Classification of why a run ended. Drives auto-failover decisions.
 * - success: exit 0 and no known limit/error signal
 * - rate_limit: quota / 429 / "usage limit reached"
 * - token_limit: prompt or context window exhausted
 * - auth_error: not logged in / invalid API key
 * - error: any other non-zero exit (likely a bug, not a limit)
 */
export type ExitReason =
  | "success"
  | "rate_limit"
  | "token_limit"
  | "auth_error"
  | "error";

export interface RunResult {
  exitCode: number | null;
  summary: string;
  sessionId?: string;
  cost?: number;
  tokens?: { input: number; output: number; cacheWrite?: number; cacheRead?: number };
  duration: number;
  /** Set by invoke() after parseOutput, from adapter.detectExitReason or the shared default. */
  exitReason?: ExitReason;
}

/** A single turn from an agent's session transcript, used for cross-agent failover. */
export interface Turn {
  role: "user" | "assistant";
  content: string;
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
  /**
   * Path (relative to cwd) of the agent's native project-memory file, if any.
   * Used by the memory-sync feature to inject harnessctl-managed context
   * between `<!-- harnessctl:begin -->` / `<!-- harnessctl:end -->` sentinels.
   * Examples: "CLAUDE.md", "AGENTS.md", "GEMINI.md".
   */
  memoryFile?: string;
  /**
   * Approximate usable context window in tokens. Used to budget the transcript
   * transfer on failover (we target ~40% of this). Optional; falls back to 100k.
   */
  contextWindow?: number;
  /** Parse captured output into structured result */
  parseOutput(stdout: string, stderr: string): Partial<RunResult>;
  /**
   * Optional: classify the run outcome from captured output + exit code.
   * If omitted, invoke() uses defaultDetectExitReason from _shared.ts.
   * Must never throw.
   */
  detectExitReason?(stdout: string, stderr: string, exitCode: number | null): ExitReason;
  /**
   * Optional post-run enrichment: read agent-written files (session JSONL,
   * SQLite DB, etc.) to fill in data not available from stdout — e.g. cache
   * token counts (Claude), token totals (Codex), session ID + cost (OpenCode).
   * Called after the process exits; must never throw.
   * startedAt is Date.now() captured just before spawn — use it to correlate
   * agent-written files to this specific invocation.
   */
  postRun?(cwd: string, result: RunResult, startedAt: number): Promise<Partial<RunResult>>;
  /**
   * Optional: extract the conversation transcript for this run from the
   * agent's on-disk session files. Used to pass full context to a fallback
   * agent when auto-failover fires. Must never throw; return [] on any error.
   */
  extractTranscript?(cwd: string, sessionId: string | undefined, startedAt: number): Promise<Turn[]>;
  /**
   * Optional: recover the native session ID (and optionally a summary) from
   * the agent's on-disk logs after an interactive shell session. Used when
   * harnessctl cannot capture output (stdio: "inherit"). Must never throw.
   */
  discoverSession?(cwd: string, startedAt: number): Promise<{ sessionId?: string; summary?: string }>;
  /** Command to check if the agent is installed */
  healthCheck(): { cmd: string; args: string[] };
  /** Check if authentication is configured and valid */
  authCheck(): { cmd: string; args: string[]; parse: (stdout: string, stderr: string, exitCode: number | null) => AuthCheckResult };
  /**
   * Optional: list available models for this agent.
   * Returns a command to run, or a static list of known model names.
   */
  listModels?(): { cmd: string; args: string[] } | { static: string[] };
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
  /**
   * When true, on exit reasons rate_limit / token_limit / auth_error, skip
   * the confirm prompt and silently hand off to the fallback agent. Other
   * failures still prompt. Default: false (opt-in).
   */
  auto_failover?: boolean;
  /**
   * What to carry across to the fallback agent on auto-failover.
   * - "summary":    one-line summary only (current behavior)
   * - "transcript": extract full conversation from the failed agent's
   *                 session file, format it, and prepend. Default: "transcript".
   */
  failover_transfer?: "summary" | "transcript";
  /** Daily spend ceiling in USD, enforced by the --budget / budget preflight. */
  budget_daily?: number;
}
