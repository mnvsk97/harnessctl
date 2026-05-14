# Adapters

Adapters are the translation layer between harnessctl and agent CLIs. Each adapter knows how to invoke an agent in headless mode and parse its output.

## Built-in adapters

### Claude Code

```
claude --print - --output-format stream-json --verbose --dangerously-skip-permissions
```

- Output: stream-json (one JSON object per line)
- Extracts: session ID, cost, token usage, summary
- Supports: `model`, `resume`

### Codex

```
codex exec - --full-auto --json
```

- Output: JSONL events
- Extracts: token usage, summary
- Supports: `model`

### DeepAgents

```
deepagents --stdin --auto-approve --shell-allow-list recommended --quiet --no-stream
```

- Output: plain text in quiet mode, with best-effort JSON parsing for future machine output
- Extracts: summary, thread ID from `deepagents threads list --json`, native session DB pointer
- Supports: `model`, `resume`
- Memory: project context syncs to `.deepagents/AGENTS.md`
- Notes: DeepAgents-specific flags such as `--agent backend-dev` can be passed after harnessctl's `--` separator or configured in `~/.harnessctl/agents/deepagents.yaml`
- Auth: use DeepAgents' `/auth` flow, or set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_CLOUD_PROJECT`, a custom `api_key_env` from `~/.deepagents/config.toml`, or the matching `DEEPAGENTS_CLI_*` variant in your shell, project `.env`, `~/.deepagents/.env`, `~/.harnessctl/.env`, project `.harnessctl/.env`, or `~/.harnessctl/agents/deepagents.yaml` under `env`
- OpenAI-compatible gateways: configure `base_url`, `api_key_env`, and `use_responses_api = false` under `[models.providers.openai]` in `~/.deepagents/config.toml`; harnessctl will use DeepAgents' default model without extra CLI flags

### OpenCode

```
opencode --pipe
```

- Output: JSON events or plain text
- Extracts: token usage, summary
- Supports: `model`

### Gemini

```
gemini --output-format stream-json --yolo
```

- Output: stream-json (newline-delimited JSON events)
- Extracts: session ID, token usage, summary
- Supports: `model`, `resume`

### Cursor

```
agent -p --force --output-format stream-json
```

- Output: stream-json (newline-delimited JSON events)
- Extracts: session ID, cost, token usage, summary
- Supports: `model`, `resume`

## Arg mapping

Each adapter declares an `argMap` — a mapping from harnessctl flags to agent CLI flags:

```typescript
// Claude adapter
argMap: {
  model:  (val) => ["--model", val],
  resume: (val) => ["--resume", val],
}

// Codex adapter
argMap: {
  model:  (val) => ["--model", val],
  // no resume support
}
```

When a flag is used that the adapter doesn't support, harnessctl warns instead of silently dropping it.

## Writing a new adapter

Create `src/adapters/<agent>.ts`:

```typescript
import type { Adapter, RunResult } from "./types.js";

export const myAgentAdapter: Adapter = {
  name: "myagent",

  base: {
    cmd: "myagent",
    args: ["--headless", "--json"],
  },

  stdinMode: "prompt",

  argMap: {
    model:  (val) => ["--model", val],
    resume: (val) => ["--session", val],
  },

  parseOutput(stdout, stderr) {
    // Parse agent-specific output format
    return { summary: "..." };
  },

  healthCheck() {
    return { cmd: "myagent", args: ["--version"] };
  },
};
```

Then register it in `src/adapters/registry.ts`.
