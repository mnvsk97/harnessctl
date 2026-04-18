import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATES_DIR } from "../config.ts";

/** Read a template by name from ~/.harnessctl/templates/{name}.md, or null. */
export function loadTemplate(name: string): string | null {
  const path = join(TEMPLATES_DIR, `${name}.md`);
  if (!existsSync(path)) return null;
  try { return readFileSync(path, "utf-8"); } catch { return null; }
}

/** Replace `{{ARGS}}` (the only reserved token) with user-supplied text. */
export function interpolate(template: string, args: string): string {
  return template.replace(/\{\{ARGS\}\}/g, args);
}
