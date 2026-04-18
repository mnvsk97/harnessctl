import { createHash } from "node:crypto";

/**
 * Deterministic 12-char hash of an absolute cwd path, used to namespace
 * per-project state under ~/.harnessctl/{sessions,projects}/{hash}/.
 *
 * The hash is SHA-256 truncated — cryptographic strength is not required
 * (no secrets depend on it); we just want stability, short strings, and
 * negligible collision odds.
 */
export function cwdHash(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 12);
}
