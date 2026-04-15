import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import YAML from "yaml";
import type { AgentConfig } from "./adapters/types.ts";

const HOME = homedir();
export const HARNESS_DIR = join(HOME, ".harnessctl");
export const CONFIG_PATH = join(HARNESS_DIR, "config.yaml");
export const AGENTS_DIR = join(HARNESS_DIR, "agents");
export const SESSIONS_DIR = join(HARNESS_DIR, "sessions");
export const RUNS_DIR = join(HARNESS_DIR, "runs");

export interface GlobalConfig {
  default_agent: string;
  on_exhaustion?: "handoff" | "end";
}

const DEFAULT_CONFIG: GlobalConfig = {
  default_agent: "claude",
  on_exhaustion: "handoff",
};

const DEFAULT_AGENTS: Record<string, AgentConfig> = {
  claude: {
    env: {},
    timeout: 300,
    extra_args: [],
  },
  codex: {
    env: {},
    timeout: 300,
    extra_args: [],
  },
  opencode: {
    env: {},
    timeout: 300,
    extra_args: [],
  },
};

export function ensureInit(): void {
  try {
    for (const dir of [HARNESS_DIR, AGENTS_DIR, SESSIONS_DIR, RUNS_DIR]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    if (!existsSync(CONFIG_PATH)) {
      writeFileSync(CONFIG_PATH, YAML.stringify(DEFAULT_CONFIG));
    }
    for (const [name, config] of Object.entries(DEFAULT_AGENTS)) {
      const path = join(AGENTS_DIR, `${name}.yaml`);
      if (!existsSync(path)) {
        writeFileSync(path, YAML.stringify(config));
      }
    }
  } catch (err: any) {
    console.error(`\x1b[31m[harnessctl] failed to initialize config directory (~/.harnessctl): ${err.message}\x1b[0m`);
    console.error(`\x1b[2m[harnessctl] tip: check that your home directory is writable\x1b[0m`);
    process.exit(1);
  }
}

export function loadConfig(): GlobalConfig {
  ensureInit();
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return { ...DEFAULT_CONFIG, ...YAML.parse(raw) };
  } catch (err: any) {
    console.error(`\x1b[31m[harnessctl] failed to load config (${CONFIG_PATH}): ${err.message}\x1b[0m`);
    console.error(`\x1b[2m[harnessctl] tip: check YAML syntax or delete the file to reset\x1b[0m`);
    process.exit(1);
  }
}

export function saveConfig(config: GlobalConfig): void {
  ensureInit();
  writeFileSync(CONFIG_PATH, YAML.stringify(config));
}

export function loadAgentConfig(agent: string): AgentConfig {
  const path = join(AGENTS_DIR, `${agent}.yaml`);
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    return YAML.parse(raw) ?? {};
  } catch (err: any) {
    console.error(`\x1b[31m[harnessctl] failed to parse agent config (${path}): ${err.message}\x1b[0m`);
    console.error(`\x1b[2m[harnessctl] tip: check YAML syntax or delete the file to reset\x1b[0m`);
    process.exit(1);
  }
}

export function saveAgentConfig(agent: string, config: AgentConfig): void {
  ensureInit();
  const path = join(AGENTS_DIR, `${agent}.yaml`);
  writeFileSync(path, YAML.stringify(config));
}

export function isKnownAgent(name: string, adapterNames: string[]): boolean {
  return adapterNames.includes(name) || existsSync(join(AGENTS_DIR, `${name}.yaml`));
}

export function resolveEnv(env: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
  }
  return resolved;
}
