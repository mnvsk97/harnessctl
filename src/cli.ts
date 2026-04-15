#!/usr/bin/env bun
import { ensureInit } from "./config.ts";
import { runCommand } from "./commands/run.ts";
import { listCommand } from "./commands/list.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { configCommand } from "./commands/config.ts";

const USAGE = `harnessctl — universal coding agent CLI

Usage:
  harnessctl run [--agent <name>] [--resume] <prompt> [-- <extra-args>...]
  harnessctl list
  harnessctl doctor
  harnessctl config get [key]
  harnessctl config set <key> <value>

Options:
  --agent <name>   Agent to use (default: from config)
  --resume         Resume last session (or handoff if agent changed)

Examples:
  harnessctl run "fix the auth bug"
  harnessctl run --agent codex "fix the auth bug"
  harnessctl run --resume "now add tests for that"
  harnessctl run --agent claude "fix this" -- --max-turns 5
  cat error.log | harnessctl run "fix this"
  harnessctl config set default claude
`;

async function main() {
  ensureInit();

  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  const command = argv[0];

  switch (command) {
    case "run": {
      const args = argv.slice(1);
      let agent: string | undefined;
      let resume = false;
      const extraArgs: string[] = [];
      const promptParts: string[] = [];
      let pastSeparator = false;

      for (let i = 0; i < args.length; i++) {
        if (pastSeparator) {
          extraArgs.push(args[i]);
          continue;
        }
        if (args[i] === "--") {
          pastSeparator = true;
          continue;
        }
        if (args[i] === "--agent" || args[i] === "-a") {
          agent = args[++i];
          continue;
        }
        if (args[i] === "--resume" || args[i] === "-r") {
          resume = true;
          continue;
        }
        promptParts.push(args[i]);
      }

      const prompt = promptParts.join(" ");
      if (!prompt) {
        console.error("Error: prompt is required. Usage: harnessctl run <prompt>");
        process.exit(1);
      }

      // Check for piped stdin
      let pipedInput: string | undefined;
      if (!process.stdin.isTTY) {
        pipedInput = await readStdin();
      }

      const exitCode = await runCommand({ agent, resume, prompt, extraArgs, pipedInput });
      process.exit(exitCode);
    }

    case "list":
      listCommand();
      break;

    case "doctor":
      doctorCommand();
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

main();
