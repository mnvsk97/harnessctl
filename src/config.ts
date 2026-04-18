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
export const PROJECTS_DIR = join(HARNESS_DIR, "projects");
export const TEMPLATES_DIR = join(HARNESS_DIR, "templates");


export interface GlobalConfig {
  default_agent: string;
  setup_done?: boolean;
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
  gemini: {
    env: {},
    timeout: 300,
    extra_args: [],
  },
  cursor: {
    env: {},
    timeout: 300,
    extra_args: [],
  },
};

/**
 * Parse a .env file and merge its values into process.env.
 * Supports KEY=VALUE, KEY="VALUE", KEY='VALUE', comments (#), and blank lines.
 * Does NOT override variables already set in the environment.
 */
function loadDotenv(filePath: string): void {
  if (!existsSync(filePath)) return;
  let content: string;
  try { content = readFileSync(filePath, "utf-8"); } catch { return; }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Don't override existing env vars
    if (process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

export function ensureInit(): void {
  try {
    for (const dir of [HARNESS_DIR, AGENTS_DIR, SESSIONS_DIR, RUNS_DIR, PROJECTS_DIR, TEMPLATES_DIR]) {
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[harnessctl] failed to initialize config directory (~/.harnessctl): ${message}`);
    console.error("[harnessctl] tip: check that your home directory is writable");
    process.exit(1);
  }

  // Load .env files (project-level takes priority over global)
  loadDotenv(join(process.cwd(), ".harnessctl", ".env"));
  loadDotenv(join(HARNESS_DIR, ".env"));
}

function loadProjectConfig(): Partial<GlobalConfig> | null {
  const projectConfigPath = join(process.cwd(), ".harnessctl", "config.yaml");
  if (!existsSync(projectConfigPath)) return null;
  try {
    const raw = readFileSync(projectConfigPath, "utf-8");
    return YAML.parse(raw) ?? null;
  } catch {
    return null;
  }
}

export function loadConfig(): GlobalConfig {
  ensureInit();
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const userConfig: GlobalConfig = { ...DEFAULT_CONFIG, ...YAML.parse(raw) };
    const projectConfig = loadProjectConfig();
    return projectConfig ? { ...userConfig, ...projectConfig } : userConfig;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[harnessctl] failed to load config (${CONFIG_PATH}): ${message}`);
    console.error("[harnessctl] tip: check YAML syntax or delete the file to reset");
    process.exit(1);
  }
}

export function saveConfig(config: GlobalConfig): void {
  ensureInit();
  writeFileSync(CONFIG_PATH, YAML.stringify(config));
}

export function loadAgentConfig(agent: string): AgentConfig {
  const path = join(AGENTS_DIR, `${agent}.yaml`);
  let userConfig: AgentConfig = {};
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf-8");
      userConfig = YAML.parse(raw) ?? {};
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[harnessctl] failed to parse agent config (${path}): ${message}`);
      console.error("[harnessctl] tip: check YAML syntax or delete the file to reset");
      process.exit(1);
    }
  }

  const projectPath = join(process.cwd(), ".harnessctl", "agents", `${agent}.yaml`);
  if (!existsSync(projectPath)) return userConfig;
  try {
    const raw = readFileSync(projectPath, "utf-8");
    const projectConfig: AgentConfig = YAML.parse(raw) ?? {};
    return {
      ...userConfig,
      ...projectConfig,
      extra_args: [
        ...(userConfig.extra_args ?? []),
        ...(projectConfig.extra_args ?? []),
      ],
      env: { ...(userConfig.env ?? {}), ...(projectConfig.env ?? {}) },
    };
  } catch {
    return userConfig;
  }
}

export function saveAgentConfig(agent: string, config: AgentConfig): void {
  ensureInit();
  const path = join(AGENTS_DIR, `${agent}.yaml`);
  writeFileSync(path, YAML.stringify(config));
}

export function isKnownAgent(name: string, adapterNames: string[]): boolean {
  if (adapterNames.includes(name)) return true;

  const path = join(AGENTS_DIR, `${name}.yaml`);
  if (!existsSync(path)) return false;

  try {
    const raw = readFileSync(path, "utf-8");
    const config = YAML.parse(raw) ?? {};
    return typeof config.cmd === "string" && config.cmd.length > 0;
  } catch {
    return false;
  }
}

export function resolveEnv(env: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
  }
  return resolved;
}
