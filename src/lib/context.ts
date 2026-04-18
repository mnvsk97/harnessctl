import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { PROJECTS_DIR } from "../config.ts";
import { cwdHash } from "./cwdHash.ts";

function projectDir(cwd: string): string {
  const dir = join(PROJECTS_DIR, cwdHash(cwd));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function contextPath(cwd: string): string {
  return join(projectDir(cwd), "context.md");
}

/** Read the project-scoped context file, or return empty string if absent. */
export function getContext(cwd: string): string {
  const p = contextPath(cwd);
  if (!existsSync(p)) return "";
  try { return readFileSync(p, "utf-8"); } catch { return ""; }
}

/** Write (overwrite) the project-scoped context file. */
export function setContext(cwd: string, text: string): void {
  writeFileSync(contextPath(cwd), text.endsWith("\n") ? text : text + "\n");
}

/** Remove the project-scoped context file. No-op if absent. */
export function clearContext(cwd: string): void {
  const p = contextPath(cwd);
  if (existsSync(p)) {
    try { unlinkSync(p); } catch { /* best-effort */ }
  }
}

/** Absolute path to the context file for a given cwd (may or may not exist). */
export function contextFilePath(cwd: string): string {
  return contextPath(cwd);
}
