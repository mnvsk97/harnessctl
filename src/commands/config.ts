import { loadConfig, saveConfig, loadAgentConfig, saveAgentConfig } from "../config.ts";

export function configCommand(args: string[]): void {
  if (args.length === 0) {
    printUsage();
    return;
  }

  const sub = args[0];

  if (sub === "get") {
    const key = args[1];
    const config = loadConfig();
    if (!key) {
      // Print all
      for (const [k, v] of Object.entries(config)) {
        console.log(`${k}=${v}`);
      }
    } else if (key in config) {
      console.log(config[key as keyof typeof config]);
    } else {
      console.error(`Unknown config key: ${key}`);
      process.exit(1);
    }
    return;
  }

  if (sub === "set") {
    const key = args[1];
    const value = args[2];
    if (!key || value === undefined) {
      console.error("Usage: harnessctl config set <key> <value>");
      process.exit(1);
    }

    const config = loadConfig();
    if (key === "default" || key === "default_agent") {
      config.default_agent = value;
      saveConfig(config);
      console.log(`default_agent=${value}`);
    } else {
      console.error(`Unknown config key: ${key}`);
      process.exit(1);
    }
    return;
  }

  if (sub === "set-fallback") {
    const agent = args[1];
    const fallback = args[2];
    if (!agent || !fallback) {
      console.error("Usage: harnessctl config set-fallback <agent> <fallback-agent>");
      process.exit(1);
    }
    if (agent === fallback) {
      console.error("[harnessctl] agent cannot fall back to itself");
      process.exit(1);
    }
    const agentConfig = loadAgentConfig(agent);
    agentConfig.fallback = fallback;
    saveAgentConfig(agent, agentConfig);
    console.log(`${agent}: fallback=${fallback}`);
    return;
  }

  if (sub === "get-fallback") {
    const agent = args[1];
    if (!agent) {
      console.error("Usage: harnessctl config get-fallback <agent>");
      process.exit(1);
    }
    const agentConfig = loadAgentConfig(agent);
    if (agentConfig.fallback) {
      console.log(`${agent}: fallback=${agentConfig.fallback}`);
    } else {
      console.log(`${agent}: no fallback configured`);
    }
    return;
  }

  if (sub === "remove-fallback") {
    const agent = args[1];
    if (!agent) {
      console.error("Usage: harnessctl config remove-fallback <agent>");
      process.exit(1);
    }
    const agentConfig = loadAgentConfig(agent);
    delete agentConfig.fallback;
    saveAgentConfig(agent, agentConfig);
    console.log(`${agent}: fallback removed`);
    return;
  }

  printUsage();
}

function printUsage() {
  console.log("Usage:");
  console.log("  harnessctl config get [key]                         Show config values");
  console.log("  harnessctl config set <key> <value>                 Set a config value");
  console.log("  harnessctl config set-fallback <agent> <fallback>   Set fallback agent");
  console.log("  harnessctl config get-fallback <agent>              Show fallback for agent");
  console.log("  harnessctl config remove-fallback <agent>           Remove fallback");
  console.log("\nKeys: default_agent (or 'default')");
  console.log("\nExamples:");
  console.log("  harnessctl config set-fallback codex claude    # if codex fails, offer claude");
  console.log("  harnessctl config set-fallback claude opencode # if claude fails, offer opencode");
}
