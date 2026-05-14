import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter, AuthCheckResult, RunResult } from "./types.ts";
import { defaultDetectExitReason } from "./_shared.ts";

const CREDENTIAL_KEYS = [
  "DEEPAGENTS_CLI_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "DEEPAGENTS_CLI_ANTHROPIC_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPAGENTS_CLI_GOOGLE_API_KEY",
  "GOOGLE_API_KEY",
  "DEEPAGENTS_CLI_GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT",
];

function credentialKeys(): string[] {
  const keys = [...CREDENTIAL_KEYS];
  const configuredKey = configuredApiKeyEnv();
  if (configuredKey && !keys.includes(configuredKey)) keys.push(configuredKey);
  return keys;
}

function homeDir(): string {
  return process.env.HOME || homedir();
}

function configuredApiKeyEnv(): string | undefined {
  const configPath = join(homeDir(), ".deepagents", "config.toml");
  if (!existsSync(configPath)) return undefined;

  let content: string;
  try {
    content = readFileSync(configPath, "utf8");
  } catch {
    return undefined;
  }

  const match = content.match(/^\s*api_key_env\s*=\s*["']([^"']+)["']/m);
  return match?.[1]?.trim() || undefined;
}

function findThreadId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = findThreadId(item);
      if (id) return id;
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["thread_id", "threadId", "id"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }

  for (const key of ["data", "threads", "items", "results"]) {
    const id = findThreadId(record[key]);
    if (id) return id;
  }

  return undefined;
}

function discoverLatestThread(): string | undefined {
  const result = spawnSync("deepagents", ["threads", "list", "--limit", "1", "--sort", "updated", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10000,
  });
  if (result.status !== 0 || !result.stdout.trim()) return undefined;

  try {
    return findThreadId(JSON.parse(result.stdout));
  } catch {
    return undefined;
  }
}

function hasEnvFileCredentialIn(envPath: string): string | undefined {
  if (!existsSync(envPath)) return undefined;

  let content: string;
  try {
    content = readFileSync(envPath, "utf8");
  } catch {
    return undefined;
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (credentialKeys().includes(key) && value.length > 0) {
      return key;
    }
  }
  return undefined;
}

function hasEnvFileCredential(): string | undefined {
  const envPaths = [
    join(process.cwd(), ".env"),
    join(process.cwd(), ".harnessctl", ".env"),
    join(homeDir(), ".deepagents", ".env"),
    join(homeDir(), ".harnessctl", ".env"),
  ];

  for (const envPath of envPaths) {
    const key = hasEnvFileCredentialIn(envPath);
    if (key) return `${envPath}:${key}`;
  }

  return undefined;
}

function hasStoredCredential(): string | undefined {
  const authPath = join(homeDir(), ".deepagents", ".state", "auth.json");
  if (!existsSync(authPath)) return undefined;

  try {
    const parsed = JSON.parse(readFileSync(authPath, "utf8"));
    if (!parsed || typeof parsed !== "object") return undefined;
    if ((parsed as { version?: unknown }).version !== 1) return undefined;
    const credentials = (parsed as { credentials?: unknown }).credentials;
    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) return undefined;

    for (const [provider, entry] of Object.entries(credentials as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      if (record.type === "api_key" && typeof record.key === "string" && record.key.trim()) {
        return `${authPath}:${provider}`;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function sessionsDbPath(): string | undefined {
  const path = `${homeDir()}/.deepagents/.state/sessions.db`;
  try {
    return statSync(path).size > 0 ? path : undefined;
  } catch {
    return undefined;
  }
}

export const deepagentsAdapter: Adapter = {
  name: "deepagents",

  base: {
    cmd: "deepagents",
    args: [
      "--stdin",
      "--auto-approve",
      "--shell-allow-list",
      "recommended",
      "--quiet",
      "--no-stream",
    ],
  },

  argMap: {
    model: (val) => ["--model", val],
    resume: (val) => ["--resume", val],
  },

  memoryFile: ".deepagents/AGENTS.md",
  contextWindow: 200_000,

  detectExitReason: defaultDetectExitReason,

  parseOutput(stdout: string, stderr: string): Partial<RunResult> {
    const result: Partial<RunResult> = {};
    const output = stdout.trim() || stderr.trim();
    const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        const threadId = findThreadId(event);
        if (threadId && !result.sessionId) result.sessionId = threadId;
        const summary = event.result ?? event.message ?? event.output ?? event.response;
        if (typeof summary === "string" && summary.trim()) result.summary = summary.trim();
      } catch {
        // DeepAgents quiet mode emits plain text. Keep JSON parsing best-effort
        // for management-command style output and future machine output.
      }
    }

    if (!result.summary && lines.length > 0) {
      result.summary = lines.at(-1);
    }

    return result;
  },

  async postRun(_cwd: string, result: RunResult, _startedAt: number): Promise<Partial<RunResult>> {
    if (result.sessionId) return {};
    const sessionId = discoverLatestThread();
    return sessionId ? { sessionId } : {};
  },

  async discoverSession(_cwd: string, _startedAt: number): Promise<{ sessionId?: string; summary?: string }> {
    return { sessionId: discoverLatestThread(), summary: "(interactive shell)" };
  },

  async sessionFilePath(_cwd: string, _sessionId: string | undefined, _startedAt: number): Promise<string | undefined> {
    return sessionsDbPath();
  },

  listModels() {
    return {
      static: [
        "gpt-5.5",
        "openai:gpt-5.5",
        "anthropic:claude-opus-4-7",
        "anthropic:claude-sonnet-4-6",
        "google_genai:gemini-3.1-pro-preview",
      ],
    };
  },

  healthCheck() {
    return { cmd: "deepagents", args: ["--version"] };
  },

  authCheck() {
    return {
      cmd: "deepagents",
      args: ["--version"],
      parse(_stdout: string, _stderr: string, exitCode: number | null): AuthCheckResult {
        if (exitCode !== 0) {
          return { ok: false, message: "deepagents not found — install with: curl -LsSf https://langch.in/gh-da-cli | bash" };
        }

        const configured = credentialKeys().find((key) => process.env[key]);
        if (configured) {
          return { ok: true, method: "api_key", message: `authenticated (${configured})` };
        }

        const envFileKey = hasEnvFileCredential();
        if (envFileKey) {
          return { ok: true, method: "api_key", message: `authenticated (${envFileKey})` };
        }

        const storedCredential = hasStoredCredential();
        if (storedCredential) {
          return { ok: true, method: "api_key", message: `authenticated (${storedCredential})` };
        }

        return {
          ok: false,
          message: "no DeepAgents provider credentials — set them with DeepAgents /auth, or set the api_key_env from ~/.deepagents/config.toml, OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, GOOGLE_CLOUD_PROJECT, or the DEEPAGENTS_CLI_* variant in your shell, project .env, ~/.deepagents/.env, ~/.harnessctl/.env, project .harnessctl/.env, or ~/.harnessctl/agents/deepagents.yaml env",
        };
      },
    };
  },
};
