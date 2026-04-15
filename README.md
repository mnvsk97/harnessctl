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

Requires [Bun](https://bun.sh).

```bash
# From source
git clone https://github.com/mnvsk97/harnessctl.git
cd harnessctl
bun install

# Run directly
bun run src/cli.ts run "hello"

# Or build a single binary
bun build --compile src/cli.ts --outfile harnessctl
./harnessctl run "hello"
```

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

### Option 1: Generic adapter (YAML only)

Create `~/.harnessctl/agents/myagent.yaml`:

```yaml
adapter: generic
command: myagent
args: [--headless, --json]
stdin_mode: prompt
health_check: myagent --version
arg_map:
  model: "--model"
```

Then: `harnessctl run --agent myagent "hello"`

### Option 2: Dedicated adapter

Create `src/adapters/myagent.ts` implementing the `Adapter` interface, register it in `src/adapters/registry.ts`. Dedicated adapters can parse structured output (cost, tokens, session IDs).

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

## Not in scope

- Smart routing / auto-pick agent
- Parallel execution (same task, multiple agents)
- Cost optimization (`--cheapest` / `--fastest`)
- Project-level config (`.harnessctl/` in repo)

These may come later. harnessctl is plumbing first.

## License

MIT
