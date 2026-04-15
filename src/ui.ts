/**
 * Minimal terminal UI helpers — zero dependencies.
 * Uses Unicode box-drawing characters + ANSI escape codes.
 */

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

export const c = {
  dim: (s: string) => `${DIM}${s}${RESET}`,
  bold: (s: string) => `${BOLD}${s}${RESET}`,
  green: (s: string) => `${GREEN}${s}${RESET}`,
  red: (s: string) => `${RED}${s}${RESET}`,
  yellow: (s: string) => `${YELLOW}${s}${RESET}`,
  cyan: (s: string) => `${CYAN}${s}${RESET}`,
};

/** Get terminal width, fallback to 60. */
function termWidth(): number {
  return process.stderr.columns ?? 60;
}

/** Draw a top bar: ┌ title ────────────── */
export function header(title: string, items?: string[]): void {
  const w = termWidth();
  const content = items ? `${title} ${c.dim("│")} ${items.join(c.dim(" │ "))}` : title;
  // Strip ANSI for length calculation
  const plainLen = content.replace(/\x1b\[[0-9;]*m/g, "").length;
  const pad = Math.max(0, w - plainLen - 4);
  console.error(`${c.dim("┌")} ${content} ${c.dim("─".repeat(pad))}`);
}

/** Draw a bottom bar: └──────────────────── */
export function footer(items?: string[]): void {
  const w = termWidth();
  if (items && items.length > 0) {
    const content = items.join(c.dim(" │ "));
    const plainLen = content.replace(/\x1b\[[0-9;]*m/g, "").length;
    const pad = Math.max(0, w - plainLen - 4);
    console.error(`${c.dim("└")} ${content} ${c.dim("─".repeat(pad))}`);
  } else {
    console.error(c.dim("└" + "─".repeat(w - 1)));
  }
}

/** Print a blank separator line. */
export function separator(): void {
  console.error("");
}
