# harnessctl

Universal CLI wrapper for coding agents. One command, any agent.

```
harnessctl run "fix the auth bug"                          # default agent
harnessctl run --agent codex "fix the auth bug"            # pick agent
harnessctl run --resume "now add tests"                    # resume session
harnessctl run --agent claude "fix" -- --max-turns 5       # passthrough flags
cat error.log | harnessctl run "fix this"                  # pipe context
```

## Why

Every coding agent ships its own CLI with different flags, output formats, and session models. If you use more than one, you're juggling CLIs. harnessctl normalizes the experience — same command, same output shape, same logging — regardless of which agent runs underneath.

**harnessctl is plumbing, not a platform.** It's not a model router, orchestrator, or agent framework. It's a universal front door to coding agent CLIs.

## Supported agents

| Agent | CLI | Status |
|---|---|---|
| Claude Code | `claude` | Built-in adapter |
| Codex | `codex` | Built-in adapter |
| OpenCode | `opencode` | Built-in adapter |
| Any CLI agent | configurable | Generic adapter (YAML) |

## Install

### npm

```bash
npm install -g harnessctl
```

Works with Bun (any version) or Node.js >= 22.

### Homebrew

```bash
brew install mnvsk97/tap/harnessctl
```

<details>
<summary><strong>Shell script (Linux / macOS)</strong></summary>

```bash
curl -fsSL https://raw.githubusercontent.com/mnvsk97/harnessctl/main/install/install.sh | bash
```

Downloads the latest compiled binary to `/usr/local/bin`. Set `HARNESSCTL_INSTALL_DIR` to change the location.

</details>

<details>
<summary><strong>PowerShell (Windows)</strong></summary>

```powershell
irm https://raw.githubusercontent.com/mnvsk97/harnessctl/main/install/install.ps1 | iex
```

Downloads the latest binary to `~\.harnessctl\bin` and adds it to your PATH.

</details>

<details>
<summary><strong>From source</strong></summary>

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/mnvsk97/harnessctl.git
cd harnessctl
bun install

# Run directly
bun run src/cli.ts run "hello"

# Or build a single binary
bun build --compile src/cli.ts --outfile harnessctl
./harnessctl run "hello"
```

</details>

## Usage

### Run a prompt

```bash
harnessctl run "fix the auth bug in login.py"
harnessctl run --agent codex "fix the auth bug in login.py"
```

### Resume a session

```bash
# Resume with the same agent
harnessctl run --resume "now add tests for that"

# Resume but switch agent (handoff — previous context is prepended)
harnessctl run --resume --agent claude "now add tests for that"
```

### Pipe context

```bash
cat error.log | harnessctl run "fix this error"
git diff | harnessctl run "review this"
```

### Passthrough agent-specific flags

Everything after `--` is passed directly to the agent CLI:

```bash
harnessctl run --agent claude "fix the bug" -- --max-turns 5 --add-dir ./docs
```

### Check agents

```bash
harnessctl list       # show available agents + install status
harnessctl doctor     # health check all agents (version, auth)
```

### Configure

```bash
harnessctl config set default claude    # set default agent
harnessctl config get                   # show all config
```

## How it works

```
CLI args + YAML config → InvokeIntent → Adapter.argMap → subprocess → stdout → Adapter.parseOutput → RunResult
```

Three layers of customization:

1. **Adapter** (code) — headless flags, output format, stdin mode. Ships with harnessctl.
2. **YAML config** (persistent) — model, env vars, timeout, extra args. User sets once in `~/.harnessctl/agents/<name>.yaml`.
3. **`--` passthrough** (ephemeral) — one-off agent-specific flags for this run.

### Arg mapping

Each adapter declares which harnessctl flags it supports and how they translate:

```typescript
// Claude — supports model + resume
argMap: {
  model:  (val) => ["--model", val],
  resume: (val) => ["--resume", val],
}

// Codex — no session resume
argMap: {
  model:  (val) => ["--model", val],
}
```

Unsupported flags produce a warning instead of silent failure:

```
[harnessctl] warning: --resume is not supported by codex, ignoring
```

### Session & handoff

- **Same agent resume:** Session ID is stored per agent per working directory. Passed to the adapter on `--resume`.
- **Cross-agent handoff:** Sessions don't transfer. The previous agent's summary is prepended to the new prompt as context.

### State directory

```
~/.harnessctl/
  config.yaml              # default agent, global settings
  agents/                  # per-agent YAML configs
    claude.yaml
    codex.yaml
    opencode.yaml
  sessions/                # session state per agent per cwd
    <cwd-hash>/
      claude.json
      last.json
  runs/                    # chronological run logs
    <timestamp>.json       # { agent, prompt, result, cost, tokens, duration }
```

## Adding a new agent

### Option 1: Generic adapter (YAML only, no code)

For any agent that has a CLI with headless/pipe mode. Create `~/.harnessctl/agents/gemini.yaml`:

```yaml
adapter: generic
command: gemini
args: [--headless, --json]
stdin_mode: prompt
health_check: gemini --version
arg_map:
  model: "--model"
  resume: "--continue-session"
```

That's it. `harnessctl run --agent gemini "hello"` works immediately.

The `arg_map` is the key part — it tells harnessctl how to translate its flags to this agent's flags. If the agent calls its model flag `--llm` instead of `--model`, just change the mapping:

```yaml
arg_map:
  model: "--llm"
```

### Option 2: Dedicated adapter (code, ~50 lines)

When you need structured output parsing (cost, tokens, session IDs), write a dedicated adapter.

**Step 1.** Create `src/adapters/myagent.ts`:

```typescript
import type { Adapter, RunResult } from "./types.js";

export const myAgentAdapter: Adapter = {
  name: "myagent",

  // How to invoke in headless mode
  base: {
    cmd: "myagent",
    args: ["--headless", "--json"],
  },

  stdinMode: "prompt",

  // harnessctl flag -> agent CLI flag translation
  argMap: {
    model:  (val) => ["--model", val],
    resume: (val) => ["--session", val],   // or omit if unsupported
  },

  // Parse agent's stdout into structured result
  parseOutput(stdout, _stderr) {
    const result: Partial<RunResult> = {};
    // ... parse agent-specific format for summary, sessionId, cost, tokens
    return result;
  },

  healthCheck() {
    return { cmd: "myagent", args: ["--version"] };
  },
};
```

**Step 2.** Register in `src/adapters/registry.ts`:

```typescript
import { myAgentAdapter } from "./myagent.js";

const builtinAdapters: Record<string, Adapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
  myagent: myAgentAdapter,  // add here
};
```

**Step 3.** Add default YAML in `src/config.ts` `DEFAULT_AGENTS`:

```typescript
myagent: {
  model: "default",
  env: {},
  timeout: 300,
  extra_args: [],
},
```

### What goes where

| Concern | Where it lives | Example |
|---|---|---|
| Headless invocation flags | Adapter `base.args` | `["--print", "-", "--output-format", "stream-json"]` |
| Flag name translation | Adapter `argMap` | `model: (val) => ["--model", val]` |
| Output parsing | Adapter `parseOutput` | Extract cost, tokens, session ID from JSON |
| User preferences | YAML `~/.harnessctl/agents/` | `model: claude-sonnet-4-6` |
| One-off flags | CLI `-- <flags>` | `-- --max-turns 5` |

## Agent YAML config

User preferences live in `~/.harnessctl/agents/<name>.yaml`:

```yaml
model: claude-sonnet-4-6
env:
  ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
timeout: 300
extra_args: []
```

Invocation flags (`--print`, `--output-format`) live in adapter code, not YAML.

## Architecture

```
src/
  cli.ts                  # entrypoint, arg parsing, command dispatch
  config.ts               # load/save ~/.harnessctl/config.yaml, first-run init
  invoke.ts               # spawn subprocess, pipe stdin, tee stdout
  session.ts              # session state per agent per cwd
  log.ts                  # run logs as JSON

  adapters/
    types.ts              # Adapter interface, InvokeIntent, RunResult, ArgMap
    claude.ts             # Claude Code adapter
    codex.ts              # Codex adapter
    opencode.ts           # OpenCode adapter
    generic.ts            # Generic adapter (reads invocation from YAML)
    registry.ts           # adapter lookup + shared buildCommand

  commands/
    run.ts                # run command
    list.ts               # list agents
    doctor.ts             # health checks
    config.ts             # get/set config
```

## Roadmap

### Coming soon

- **Python SDK** — `pip install harnessctl`. Invoke agents programmatically from Python scripts, notebooks, and CI pipelines. Same adapter model, same arg mapping.
- **TypeScript SDK** — `npm install harnessctl`. Import and invoke agents from Node/Bun/Deno. Full type safety over `InvokeIntent` and `RunResult`.
- **GitHub Actions workflow** — ready-made YAML for running harnessctl in CI. Pick an agent per job, get structured logs as artifacts, fail on non-zero exit.

### Planned

- `harnessctl stats` — aggregate run logs, compare cost/speed/quality across agents
- Project-level config (`.harnessctl/` in repo) for team-shared agent preferences
- `--cheapest` / `--fastest` flags for cost- or latency-optimized agent selection
- Parallel execution — send the same task to multiple agents, compare results

### Not in scope

harnessctl is plumbing, not a platform. These are explicitly out:

- Model routing (that's [OpenCode](https://github.com/opencode-ai/opencode))
- Agent orchestration (that's [Paperclip](https://github.com/nichochar/paperclip))
- Agent frameworks (LangChain, CrewAI, etc.)

## License

MIT
