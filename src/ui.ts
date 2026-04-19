/**
 * Minimal terminal UI helpers — zero dependencies.
 * Uses Unicode box-drawing characters + ANSI escape codes.
 */

import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";

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

/** Strip ANSI escape codes for length calculation. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Draw a full-width dim line: ─────────── */
export function rule(): void {
  console.error(c.dim("─".repeat(termWidth())));
}

/** Draw a top bar: ┌ title │ item │ item ────── */
export function header(title: string, items?: string[]): void {
  const w = termWidth();
  const content = items ? `${title} ${c.dim("│")} ${items.join(c.dim(" │ "))}` : title;
  const plainLen = stripAnsi(content).length;
  const pad = Math.max(0, w - plainLen - 4);
  console.error(`${c.dim("┌")} ${content} ${c.dim("─".repeat(pad))}`);
}

/** Draw a bottom bar: └ item │ item ──────── */
export function footer(items?: string[]): void {
  const w = termWidth();
  if (items && items.length > 0) {
    const content = items.join(c.dim(" │ "));
    const plainLen = stripAnsi(content).length;
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

/* ── Live spinner ─────────────────────────────────────── */

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private text: string;

  constructor(text: string) {
    this.text = text;
  }

  start(): void {
    if (this.timer || !process.stderr.isTTY) return;
    this.timer = setInterval(() => {
      const f = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
      process.stderr.write(`\r${c.cyan(f)} ${c.dim(this.text)}`);
      this.frame++;
    }, 80);
  }

  update(text: string): void {
    this.text = text;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      if (process.stderr.isTTY) process.stderr.write("\r\x1b[K"); // clear line
    }
  }
}

/** Prompt user with a yes/no question on the terminal. Works even when stdin is piped. */
export function askConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    let input: NodeJS.ReadableStream;
    if (process.stdin.isTTY) {
      input = process.stdin;
    } else {
      const ttyPath = process.platform === "win32" ? "CON" : "/dev/tty";
      try {
        input = createReadStream(ttyPath);
      } catch {
        console.error(c.dim("[harnessctl] no terminal available, skipping prompt"));
        resolve(false);
        return;
      }
    }

    const rl = createInterface({ input, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase().startsWith("y"));
    });
  });
}
