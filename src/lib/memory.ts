import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listAdapterNames, getAdapter } from "../adapters/registry.ts";
import { loadAgentConfig } from "../config.ts";

const BEGIN = "<!-- harnessctl:begin -->";
const END = "<!-- harnessctl:end -->";

/**
 * Replace (or insert) the harnessctl-managed block inside a native memory
 * file. If the sentinels exist, their content is rewritten; otherwise a new
 * block is appended to the end of the file.
 *
 * Any content the user wrote outside the sentinels is preserved verbatim.
 */
export function injectManagedBlock(existing: string, content: string): string {
  const block = `${BEGIN}\n${content.trim()}\n${END}`;
  if (existing.includes(BEGIN) && existing.includes(END)) {
    const re = new RegExp(`${escape(BEGIN)}[\\s\\S]*?${escape(END)}`);
    return existing.replace(re, block);
  }
  const sep = existing.length && !existing.endsWith("\n") ? "\n\n" : existing.length ? "\n" : "";
  return existing + sep + block + "\n";
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove a harnessctl-managed block from a file, preserving everything else.
 */
export function stripManagedBlock(existing: string): string {
  if (!existing.includes(BEGIN) || !existing.includes(END)) return existing;
  const re = new RegExp(`${escape(BEGIN)}[\\s\\S]*?${escape(END)}\\n?`, "g");
  return existing.replace(re, "").replace(/\n{3,}/g, "\n\n");
}

/**
 * Walk every known agent adapter. For each one that declares a `memoryFile`,
 * read the file at cwd/memoryFile (if any), inject/update the managed block
 * with `content`, and write it back.
 *
 * Best-effort: per-adapter failures are logged but never throw.
 */
export function syncMemory(cwd: string, content: string): string[] {
  const touched: string[] = [];
  for (const name of listAdapterNames()) {
    try {
      const adapter = getAdapter(name, loadAgentConfig(name));
      if (!adapter.memoryFile) continue;
      const path = join(cwd, adapter.memoryFile);
      const existing = existsSync(path) ? readFileSync(path, "utf-8") : "";
      const next = injectManagedBlock(existing, content);
      if (next !== existing) {
        writeFileSync(path, next);
        touched.push(adapter.memoryFile);
      }
    } catch {
      // best-effort per-agent; keep going
    }
  }
  return touched;
}

/** Remove the managed block from every adapter's memory file. */
export function clearMemory(cwd: string): string[] {
  const touched: string[] = [];
  for (const name of listAdapterNames()) {
    try {
      const adapter = getAdapter(name, loadAgentConfig(name));
      if (!adapter.memoryFile) continue;
      const path = join(cwd, adapter.memoryFile);
      if (!existsSync(path)) continue;
      const existing = readFileSync(path, "utf-8");
      const next = stripManagedBlock(existing);
      if (next !== existing) {
        writeFileSync(path, next);
        touched.push(adapter.memoryFile);
      }
    } catch { /* best-effort */ }
  }
  return touched;
}
