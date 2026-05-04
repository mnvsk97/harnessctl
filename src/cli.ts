#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { ensureInit } from "./config.ts";
import { runCommand } from "./commands/run.ts";
import { listCommand } from "./commands/list.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { configCommand } from "./commands/config.ts";
import { shellCommand } from "./commands/shell.ts";
import { setupCommand } from "./commands/setup.ts";
import { statsCommand } from "./commands/stats.ts";
import { logsCommand } from "./commands/logs.ts";
import { compareCommand } from "./commands/compare.ts";
import { contextCommand } from "./commands/context.ts";
import { replayCommand } from "./commands/replay.ts";
import { modelsCommand } from "./commands/models.ts";
import { handoffCommand } from "./commands/handoff.ts";
import { pipelineCommand, parsePipelineArgs } from "./commands/pipeline.ts";

declare const HARNESSCTL_VERSION: string | undefined;

function resolveVersion(): string {
  if (typeof HARNESSCTL_VERSION === "string" && HARNESSCTL_VERSION.length > 0) {
    return HARNESSCTL_VERSION;
  }

  try {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as { version?: unknown };
    if (typeof packageJson.version === "string") return packageJson.version;
  } catch {
    // Ignore and fall through to a stable placeholder for unusual packaged runtimes.
  }

  return "unknown";
}

const VERSION = resolveVersion();

const USAGE = `harnessctl — universal coding agent CLI

Usage:
  harnessctl --version
  harnessctl setup
  harnessctl run [--agent <name>] [--resume [<session-id>]] [--stream] [--cheapest] [--fastest]
                 [--template <name>] [--budget <usd>] [--name <label>]
                 <prompt> [-- <extra-args>...]
  harnessctl shell [--agent <name>] [--name <label>] [-- <extra-args>...]
  harnessctl pipeline <prompt> [--plan <agent>] [--build <agent>] [--review <agent>]
                     [--test <agent>] [--step <agent:instruction>]...
                     [--preset <name>] [--name <label>] [--stream] [--budget <usd>]
  harnessctl compare <prompt> [--agents <a,b,...>] [--judge <agent>] [-- <extra-args>...]
  harnessctl handoff <run-id> --agent <name> [--resume|--fork]
                     [--budget <usd>] [--name <label>] <prompt>
  harnessctl replay <run-id>
  harnessctl context get|set|edit|clear|sync|path
  harnessctl list
  harnessctl stats [--cost]
  harnessctl logs [--agent <name>] [--limit N]
  harnessctl doctor [--mcp]
  harnessctl models --agent <name>
  harnessctl config get|set|set-fallback|get-fallback|remove-fallback ...

Options:
  --version, -v      Print harnessctl version
  --agent <name>      Agent to use (default: from config)
  --resume [<id>]     Resume last session, or a specific one by ID/name
  --cheapest          Pick the agent with lowest avg cost from run history
  --fastest           Pick the agent with lowest avg duration from run history
  --template <name>   Wrap prompt in a template from ~/.harnessctl/templates/
  --budget <usd>      Abort if today's spend for this agent would exceed $N
  --name <label>      Name the session (e.g. "auth-refactor") for easy reference
  --stream, -s        Stream live output instead of showing spinner + result
  --cost              (stats)  Show per-agent daily spend with sparkline
  --mcp               (doctor) List MCP servers configured in each agent

Auto-failover:
  Set \`auto_failover: true\` in ~/.harnessctl/agents/<agent>.yaml and point
  \`fallback:\` at another agent. When the primary hits a rate/token/auth limit,
  harnessctl silently hands off with the full conversation transcript.

Examples:
  harnessctl run "fix the auth bug"
  harnessctl compare "fix the auth bug" --agents codex,claude --judge claude
  harnessctl handoff 1713364500000-claude --agent codex "add tests for that"
  harnessctl run --agent codex --resume "add tests for that"
  harnessctl run --template code-review "src/auth.ts"
  harnessctl run --budget 2.00 "refactor the payment module"
  harnessctl context set "Go 1.22, postgres, follow existing patterns"
  harnessctl replay 1713364500000-claude
  harnessctl stats --cost
  harnessctl doctor --mcp
  cat error.log | harnessctl run "explain this"
`;

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  if (argv[0] === "--version" || argv[0] === "-v" || argv[0] === "version") {
    console.log(VERSION);
    process.exit(0);
  }

  ensureInit();

  const command = argv[0];

  switch (command) {
    case "run": {
      const args = argv.slice(1);
      let agent: string | undefined;
      let resume: boolean | string = false;
      let cheapest = false;
      let fastest = false;
      let stream = false;
      let template: string | undefined;
      let budget: number | undefined;
      let name: string | undefined;
      const extraArgs: string[] = [];
      const promptParts: string[] = [];
      let pastSeparator = false;

      for (let i = 0; i < args.length; i++) {
        if (pastSeparator) { extraArgs.push(args[i]); continue; }
        if (args[i] === "--") { pastSeparator = true; continue; }
        if (args[i] === "--agent" || args[i] === "-a") {
          if (i + 1 >= args.length) { console.error("Error: --agent requires a value"); process.exit(1); }
          agent = args[++i]; continue;
        }
        if (args[i] === "--resume" || args[i] === "-r") {
          const next = args[i + 1];
          if (next && !next.startsWith("-")) { resume = next; i++; } else { resume = true; }
          continue;
        }
        if (args[i] === "--stream" || args[i] === "-s") { stream = true; continue; }
        if (args[i] === "--cheapest") { cheapest = true; continue; }
        if (args[i] === "--fastest") { fastest = true; continue; }
        if (args[i] === "--template" || args[i] === "-t") {
          if (i + 1 >= args.length) { console.error("Error: --template requires a value"); process.exit(1); }
          template = args[++i]; continue;
        }
        if (args[i] === "--name") {
          if (i + 1 >= args.length) { console.error("Error: --name requires a value"); process.exit(1); }
          name = args[++i]; continue;
        }
        if (args[i] === "--budget" || args[i] === "-b") {
          if (i + 1 >= args.length) { console.error("Error: --budget requires a value"); process.exit(1); }
          const v = parseFloat(args[++i]);
          if (!Number.isFinite(v) || v <= 0) { console.error("Error: --budget must be a positive number (e.g. --budget 2.00)"); process.exit(1); }
          budget = v;
          continue;
        }
        promptParts.push(args[i]);
      }

      const prompt = promptParts.join(" ");
      if (!prompt) {
        console.error("Error: prompt is required. Usage: harnessctl run <prompt>");
        process.exit(1);
      }

      let pipedInput: string | undefined;
      if (!process.stdin.isTTY) pipedInput = await readStdin();

      const exitCode = await runCommand({
        agent, resume, cheapest, fastest, stream, prompt, extraArgs, pipedInput, template, budget, name,
      });
      process.exit(exitCode);
    }

    case "shell": {
      const shellArgs = argv.slice(1);
      let shellAgent: string | undefined;
      let shellName: string | undefined;
      const shellExtraArgs: string[] = [];
      let shellPastSep = false;

      for (let i = 0; i < shellArgs.length; i++) {
        if (shellPastSep) { shellExtraArgs.push(shellArgs[i]); continue; }
        if (shellArgs[i] === "--") { shellPastSep = true; continue; }
        if (shellArgs[i] === "--agent" || shellArgs[i] === "-a") {
          if (i + 1 >= shellArgs.length) { console.error("Error: --agent requires a value"); process.exit(1); }
          shellAgent = shellArgs[++i]; continue;
        }
        if (shellArgs[i] === "--name") {
          if (i + 1 >= shellArgs.length) { console.error("Error: --name requires a value"); process.exit(1); }
          shellName = shellArgs[++i]; continue;
        }
      }

      const shellExitCode = await shellCommand({ agent: shellAgent, extraArgs: shellExtraArgs, name: shellName });
      process.exit(shellExitCode);
    }

    case "pipeline": {
      const pipeOpts = parsePipelineArgs(argv.slice(1));
      if (!pipeOpts) process.exit(1);
      const pipeExitCode = await pipelineCommand(pipeOpts);
      process.exit(pipeExitCode);
    }

    case "compare": {
      const compareArgs = argv.slice(1);
      const promptParts: string[] = [];
      let compareAgents: string[] | undefined;
      let judge: string | undefined;
      const extraArgs: string[] = [];
      let pastSep = false;

      for (let i = 0; i < compareArgs.length; i++) {
        if (pastSep) { extraArgs.push(compareArgs[i]); continue; }
        if (compareArgs[i] === "--") { pastSep = true; continue; }
        if (compareArgs[i] === "--agents" && compareArgs[i + 1]) {
          compareAgents = compareArgs[++i].split(",").map((s) => s.trim()).filter(Boolean);
          continue;
        }
        if (compareArgs[i] === "--judge" && compareArgs[i + 1]) {
          judge = compareArgs[++i];
          continue;
        }
        promptParts.push(compareArgs[i]);
      }

      const prompt = promptParts.join(" ");
      if (!prompt) {
        console.error("Error: prompt is required. Usage: harnessctl compare <prompt>");
        process.exit(1);
      }

      let pipedInput: string | undefined;
      if (!process.stdin.isTTY) pipedInput = await readStdin();

      const exitCode = await compareCommand({ prompt, agents: compareAgents, judge, extraArgs, pipedInput });
      process.exit(exitCode);
    }

    case "handoff": {
      const exitCode = await handoffCommand(argv.slice(1));
      process.exit(exitCode);
    }

    case "context":
      process.exit(contextCommand(argv.slice(1)));

    case "replay":
      process.exit(await replayCommand(argv.slice(1)));

    case "stats":
      statsCommand(argv.slice(1));
      break;

    case "logs":
      logsCommand(argv.slice(1));
      break;

    case "list":
      listCommand();
      break;

    case "doctor":
      doctorCommand(argv.slice(1));
      break;

    case "setup":
      await setupCommand();
      break;

    case "models":
      modelsCommand(argv.slice(1));
      break;

    case "config":
      configCommand(argv.slice(1));
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.log(USAGE);
      process.exit(1);
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

main().catch((err) => {
  console.error(`[harnessctl] unexpected error: ${err.message}`);
  process.exit(1);
});
