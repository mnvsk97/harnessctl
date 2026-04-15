import { loadConfig, saveConfig } from "../config.ts";

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

  printUsage();
}

function printUsage() {
  console.log("Usage:");
  console.log("  harnessctl config get [key]       Show config values");
  console.log("  harnessctl config set <key> <value>  Set a config value");
  console.log("\nKeys: default_agent (or 'default')");
}
