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
codex exec - --full-auto
```

- Output: JSONL events
- Extracts: token usage, summary
- Supports: `model`

### OpenCode

```
opencode --pipe
```

- Output: JSON events or plain text
- Extracts: token usage, summary
- Supports: `model`

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

## Generic adapter

For agents without a built-in adapter, create a YAML config with `adapter: generic`:

```yaml
# ~/.harnessctl/agents/gemini.yaml
adapter: generic
command: gemini
args: [--headless, --json]
stdin_mode: prompt
health_check: gemini --version
arg_map:
  model: "--model"
```

### Generic adapter fields

| Field | Description |
|---|---|
| `command` | The CLI binary name |
| `args` | Fixed args for headless invocation |
| `stdin_mode` | Set to `prompt` to send the prompt via stdin |
| `health_check` | Command to verify installation |
| `arg_map` | Maps harnessctl flags to agent flags (e.g. `model: "--llm"`) |

## Writing a dedicated adapter

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
