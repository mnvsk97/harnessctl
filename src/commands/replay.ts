import { loadRunLog } from "../log.ts";
import { runCommand } from "./run.ts";
import { c } from "../ui.ts";

/**
 * Re-run a past run by its id (timestamp-agent prefix of the log filename).
 * Uses the original agent, prompt, model, and passthrough args.
 */
export async function replayCommand(argv: string[]): Promise<number> {
  const id = argv[0];
  if (!id || id === "--help" || id === "-h") {
    console.log("Usage: harnessctl replay <run-id>\n\nFind ids with: harnessctl logs");
    return id ? 0 : 1;
  }
  const log = loadRunLog(id);
  if (!log) {
    console.error(`${c.red("✗")} no run found with id "${id}"`);
    console.error(c.dim("  tip: run `harnessctl logs` to list recent run ids"));
    return 1;
  }
  console.error(c.dim(`replaying ${log.agent} @ ${log.timestamp}`));
  return runCommand({
    agent: log.agent,
    prompt: log.prompt,
    extraArgs: log.extraArgs ?? [],
  });
}
