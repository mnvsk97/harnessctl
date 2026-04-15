import { createInterface } from "node:readline";
import { loadConfig, saveConfig, loadAgentConfig, saveAgentConfig } from "../config.ts";
import { listAdapterNames } from "../adapters/registry.ts";

const AGENTS = listAdapterNames();

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function ask(
  rl: ReturnType<typeof createInterface>,
  question: string,
  options: string[],
  defaultOption?: string,
): Promise<string> {
  const optStr = options
    .map((o) => (o === defaultOption ? `\x1b[1m${o}\x1b[0m` : o))
    .join(" / ");
  const hint = defaultOption ? ` (default: ${defaultOption})` : "";

  while (true) {
    const answer = (await prompt(rl, `${question} [${optStr}]${hint}: `)).trim().toLowerCase();
    if (!answer && defaultOption) return defaultOption;
    if (options.includes(answer)) return answer;
    console.log(`  Please choose one of: ${options.join(", ")}`);
  }
}

export async function setupCommand(): Promise<void> {
  const config = loadConfig();

  console.log("\x1b[1mharnessctl setup\x1b[0m\n");
  console.log("Let's configure your coding agent preferences.\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    // 1. Default agent
    const defaultAgent = await ask(
      rl,
      "Which agent do you want as your default?",
      AGENTS,
      config.default_agent || "claude",
    );
    config.default_agent = defaultAgent;

    // 2. Fallback agent
    const fallbackOptions = AGENTS.filter((a) => a !== defaultAgent);
    const fallbackAnswer = await ask(
      rl,
      "Fallback agent if the primary is unavailable?",
      [...fallbackOptions, "none"],
      "none",
    );

    const agentConfig = loadAgentConfig(defaultAgent);
    if (fallbackAnswer === "none") {
      delete agentConfig.fallback;
    } else {
      agentConfig.fallback = fallbackAnswer;
    }
    saveAgentConfig(defaultAgent, agentConfig);

    // 3. On token exhaustion
    const onExhaustion = await ask(
      rl,
      "When an agent runs out of tokens?",
      ["handoff", "end"],
      config.on_exhaustion || "handoff",
    );
    config.on_exhaustion = onExhaustion as "handoff" | "end";

    // Save
    saveConfig(config);

    console.log("\n\x1b[32m✓ Setup complete!\x1b[0m\n");
    console.log(`  default agent:     ${config.default_agent}`);
    console.log(`  fallback agent:    ${fallbackAnswer === "none" ? "none" : fallbackAnswer}`);
    console.log(`  on token exhaust:  ${config.on_exhaustion}`);
    console.log(`\nRun \x1b[2mharnessctl doctor\x1b[0m to verify your agents are installed and authenticated.`);
  } finally {
    rl.close();
  }
}
