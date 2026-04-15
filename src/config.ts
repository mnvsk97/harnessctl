import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import YAML from "yaml";
import type { AgentConfig } from "./adapters/types.js";

const HOME = homedir();
export const HARNESS_DIR = join(HOME, ".harnessctl");
export const CONFIG_PATH = join(HARNESS_DIR, "config.yaml");
export const AGENTS_DIR = join(HARNESS_DIR, "agents");
export const SESSIONS_DIR = join(HARNESS_DIR, "sessions");
export const RUNS_DIR = join(HARNESS_DIR, "runs");

export interface GlobalConfig {
  default_agent: string;
}

const DEFAULT_CONFIG: GlobalConfig = {
  default_agent: "claude",
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
}

export function loadConfig(): GlobalConfig {
  ensureInit();
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  return { ...DEFAULT_CONFIG, ...YAML.parse(raw) };
}

export function saveConfig(config: GlobalConfig): void {
  ensureInit();
  writeFileSync(CONFIG_PATH, YAML.stringify(config));
}

export function loadAgentConfig(agent: string): AgentConfig {
  const path = join(AGENTS_DIR, `${agent}.yaml`);
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8");
  return YAML.parse(raw) ?? {};
}

export function resolveEnv(env: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
  }
  return resolved;
}
