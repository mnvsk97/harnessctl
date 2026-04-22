import type { ExitReason } from "./types.ts";

/**
 * Classify a run from its captured output + exit code.
 *
 * Adapter-agnostic default. Each adapter may override via `detectExitReason`
 * if it has structured error signals (e.g. Claude's stream-json result.subtype).
 *
 * Priority:
 *   1. rate_limit   — quota / 429 / "usage limit reached"
 *   2. token_limit  — context window / prompt-too-long
 *   3. auth_error   — not logged in / invalid api key
 *   4. success      — exit 0 with no error signals above
 *   5. error        — anything else non-zero
 *
 * Order matters: a 429 body can sometimes mention "auth" in noise, so we check
 * rate_limit first. Token-window and auth only match on their specific signals.
 */
export function defaultDetectExitReason(
  stdout: string,
  stderr: string,
  exitCode: number | null,
): ExitReason {
  // Trust a clean exit code — the agent completed successfully. Regex checks
  // below can false-positive on transcript/context text injected by harnessctl
  // (e.g. a failover transcript mentioning "rate limit"). Agents that can exit 0
  // with an error (e.g. Claude stream-json) have their own detectExitReason.
  if (exitCode === 0) return "success";

  const haystack = `${stdout}\n${stderr}`;

  // Rate-limit / quota exhaustion. Matches Anthropic / OpenAI / Google / generic.
  if (
    /\b429\b|rate[ _-]?limit|too many requests|quota exceeded|usage limit reached|insufficient[ _-]?quota|out of credits|credit balance/i
      .test(haystack)
  ) {
    return "rate_limit";
  }

  // Context / token limit exhaustion.
  if (
    /context[ _-]?(length|window)|maximum[ _-]?context|prompt[ _-]?too[ _-]?long|token[ _-]?limit|max[ _-]?tokens?[ _-]?exceeded|input[ _-]?too[ _-]?long/i
      .test(haystack)
  ) {
    return "token_limit";
  }

  // Auth / unauthorized.
  if (
    /\b401\b|\b403\b|unauthoriz|invalid[ _-]?api[ _-]?key|not logged in|authentication[ _-]?failed|auth(entication)?[ _-]?error|login required|please sign in/i
      .test(haystack)
  ) {
    return "auth_error";
  }

  return "error";
}
