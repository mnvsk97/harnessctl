import { spawnSync } from "node:child_process";
import { getContext, setContext, clearContext, contextFilePath } from "../lib/context.ts";
import { syncMemory, clearMemory } from "../lib/memory.ts";
import { c } from "../ui.ts";

const USAGE = `harnessctl context — manage project context (CLAUDE.md / AGENTS.md / GEMINI.md)

Usage:
  harnessctl context get
  harnessctl context set <text...>
  harnessctl context edit
  harnessctl context clear
  harnessctl context sync          # re-sync current context into all agent memory files
  harnessctl context path          # print path to the canonical context file

The canonical file lives at ~/.harnessctl/projects/<cwdHash>/context.md.
Setting it also syncs a <!-- harnessctl:begin/end --> block into each agent's
native memory file in the current directory (CLAUDE.md, AGENTS.md, GEMINI.md).
`;

export function contextCommand(argv: string[]): number {
  const cwd = process.cwd();
  const sub = argv[0];
  if (!sub || sub === "--help" || sub === "-h") {
    console.log(USAGE);
    return 0;
  }

  switch (sub) {
    case "get": {
      const ctx = getContext(cwd);
      if (!ctx.trim()) {
        console.error(c.dim("(no context set for this project)"));
        return 1;
      }
      process.stdout.write(ctx);
      if (!ctx.endsWith("\n")) process.stdout.write("\n");
      return 0;
    }
    case "path": {
      console.log(contextFilePath(cwd));
      return 0;
    }
    case "set": {
      const text = argv.slice(1).join(" ").trim();
      if (!text) {
        console.error("error: provide context text. Usage: harnessctl context set <text...>");
        return 1;
      }
      setContext(cwd, text);
      const touched = syncMemory(cwd, text);
      console.error(`${c.green("✓")} context saved`);
      if (touched.length) console.error(c.dim(`  synced: ${touched.join(", ")}`));
      return 0;
    }
    case "edit": {
      const editor = process.env.EDITOR || "vi";
      const path = contextFilePath(cwd);
      if (!getContext(cwd)) setContext(cwd, "# Project context\n\n");
      const r = spawnSync(editor, [path], { stdio: "inherit" });
      if (r.status !== 0) return r.status ?? 1;
      const ctx = getContext(cwd);
      const touched = syncMemory(cwd, ctx);
      console.error(`${c.green("✓")} context saved`);
      if (touched.length) console.error(c.dim(`  synced: ${touched.join(", ")}`));
      return 0;
    }
    case "clear": {
      clearContext(cwd);
      const touched = clearMemory(cwd);
      console.error(`${c.green("✓")} context cleared`);
      if (touched.length) console.error(c.dim(`  removed managed block from: ${touched.join(", ")}`));
      return 0;
    }
    case "sync": {
      const ctx = getContext(cwd);
      if (!ctx.trim()) {
        console.error(c.dim("(no context set — nothing to sync)"));
        return 1;
      }
      const touched = syncMemory(cwd, ctx);
      console.error(`${c.green("✓")} synced to: ${touched.length ? touched.join(", ") : "(no agent memory files touched)"}`);
      return 0;
    }
    default:
      console.error(`unknown subcommand: ${sub}`);
      console.log(USAGE);
      return 1;
  }
}
