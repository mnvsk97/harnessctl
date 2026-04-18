<div align="center">

# harnessctl

**The universal CLI for coding agents**

One command, any agent. Same interface, same logs, same handoff — regardless of which agent runs underneath.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/harnessctl)](https://www.npmjs.com/package/harnessctl)
[![npm downloads](https://img.shields.io/npm/dm/harnessctl)](https://www.npmjs.com/package/harnessctl)

</div>

---

## What's included

- **Run any agent** — Claude Code, Codex, Gemini, Cursor, OpenCode, or any CLI agent via YAML config
- **Explicit handoff** — hand off a session to another agent by run ID, with full context
- **Auto-failover** — rate limit or token overflow? silently hands off to a fallback agent with the full conversation
- **Session tracking** — every run and shell session gets a unique ID, even concurrent ones in the same repo
- **Shell recovery** — interactive shell sessions are tracked too, with session recovery from agent logs after exit
- **Project context** — one preamble, mirrored into every agent's native memory file (CLAUDE.md, AGENTS.md, GEMINI.md)
- **Budget guardrails** — per-agent daily spend caps with 80% warning threshold
- **Observability** — structured run logs, cost dashboard, replay, health checks

> [!NOTE]
> harnessctl is plumbing, not a platform. It's not a model router, orchestrator, or agent framework. It's a universal front door to coding agent CLIs.

---

## Quickstart

```bash
# Install
npm install -g harnessctl        # or: brew install mnvsk97/tap/harnessctl

# Run
harnessctl run "fix the auth bug"
harnessctl run --agent codex "refactor the database layer"

# Interactive shell
harnessctl shell --agent claude
```

> [!TIP]
> Run `harnessctl setup` after installing to configure your default agent and verify all agents are healthy.

---

## Handoff between agents

Every run prints a **run ID** and **session ID**. Use the run ID to hand off to another agent with full context:

```bash
# First run with codex
harnessctl run --agent codex "refactor the auth module"
# → run: 1713364500000-codex  session: a3f8c012

# Hand off to claude — lean prompt with pointer to full context file
harnessctl handoff 1713364500000-codex --agent claude "review the refactor and add tests"
# → run: 1713364600000-claude  session: a3f8c012  ← same session

# Same-agent: resume native session or fork with context
harnessctl handoff <run-id> --agent claude --resume "keep going"
harnessctl handoff <run-id> --agent claude --fork "try differently"
```

The target agent gets a lean handoff prompt — summary, changed files, and a pointer to `.harnessctl/handoffs/<run-id>.md`. The agent reads the full context on demand, keeping its context window clean.

Shell sessions work too — after an interactive shell exits, harnessctl recovers the session from agent logs.

### How handoff works

```
Terminal 1                              Terminal 2
─────────                              ─────────
$ harnessctl run --agent codex          $ harnessctl run --agent codex
  "refactor auth"                         "fix CSS bug"
     │                                       │
     ▼                                       ▼
  session: a3f8c012                       session: f9b21e44
  run: 1713..500-codex                    run: 1713..510-codex
     │                                       │
     │  ┌─────────────────────────┐          │ (separate session,
     └──│  .harnessctl/handoffs/  │          │  untouched)
        │  1713..500-codex.md     │          │
        │  ┌───────────────────┐  │          ▼
        │  │ Task: refactor    │  │       (done)
        │  │ Summary: ...      │  │
        │  │ Files changed: ...│  │
        │  │ Conversation: ... │  │
        │  └───────────────────┘  │
        └────────────┬────────────┘
                     │
                     ▼
$ harnessctl handoff 1713..500-codex --agent claude "add tests"
     │
     ▼  Claude receives:
  ┌──────────────────────────────────────┐
  │ ## Handoff from codex                │
  │ Task: refactor auth                  │
  │ Summary: extracted middleware...     │
  │ Files changed: src/auth/middleware.ts│
  │ Full context: .harnessctl/handoffs/  │
  │               1713..500-codex.md     │
  │ ─────────────────────────────────── │
  │ add tests                            │
  └──────────────────────────────────────┘
     │
     ▼
  session: a3f8c012  ← same session!
  run: 1713..600-claude  ← linked to parent
```

**Key design decisions:**
- The handoff prompt is **lean** — summary + pointer to context file. The agent reads the full transcript only if it needs more detail.
- Concurrent runs get **separate sessions** — no clobbering. Handoff by run ID is always unambiguous.
- `.harnessctl/` is auto-added to `.gitignore`.

---

## Supported agents

| Agent | CLI | Resume | Transcript | Session discovery |
|---|---|---|---|---|
| Claude Code | `claude` | `--resume <id>` | from JSONL | by session file mtime |
| Codex | `codex` | — | from rollout files | by rollout file mtime |
| Gemini | `gemini` | `--resume <id>` | from JSONL | by session file mtime |
| Cursor | `cursor-agent` | `--resume <id>` | from JSONL | by session file mtime |
| OpenCode | `opencode` | — | — | from SQLite DB |
| Any CLI agent | configurable | via YAML `resume_arg` | — | — |

---

## Usage

### Run a prompt

```bash
harnessctl run "fix the auth bug in login.py"
harnessctl run --agent codex "fix the auth bug"
harnessctl run --cheapest "simple refactor"           # pick cheapest agent from history
harnessctl run --fastest "urgent fix"                  # pick fastest agent from history
```

### Resume a session

```bash
harnessctl run --resume "now add tests for that"
```

### Pipe context

```bash
cat error.log | harnessctl run "fix this error"
git diff | harnessctl run "review this"
```

### Passthrough agent-specific flags

```bash
harnessctl run --agent claude "fix" -- --max-turns 5 --add-dir ./docs
```

### Interactive shell

```bash
harnessctl shell                    # default agent
harnessctl shell --agent codex      # pick agent
harnessctl shell -- --verbose       # passthrough flags
```

After the shell exits, harnessctl recovers the session and prints a run ID — so handoff works from shell sessions too.

### Project context

```bash
harnessctl context set "Go 1.22, postgres, follow existing patterns"
harnessctl context edit                 # opens $EDITOR
harnessctl context sync                 # re-sync to native memory files
```

### Templates, budget, replay

```bash
harnessctl run --template code-review "src/auth.ts"   # prompt templates
harnessctl run --budget 2.00 "refactor payments"       # daily spend cap
harnessctl stats --cost                                # cost dashboard
harnessctl replay <run-id>                             # re-run a previous invocation
```

### Health checks

```bash
harnessctl doctor         # version + auth status for all agents
harnessctl doctor --mcp   # MCP server config across agents
harnessctl list           # available agents + install status
```

---

## Auto-failover

When an agent hits a rate limit, token overflow, or auth error, harnessctl can silently hand off to a fallback with the full conversation.

```yaml
# ~/.harnessctl/agents/claude.yaml
fallback: codex
auto_failover: true
failover_transfer: "transcript"   # or "summary" for one-line only
```

Configure fallback chains:

```bash
harnessctl config set-fallback codex claude      # codex fails → claude
harnessctl config set-fallback claude opencode   # claude fails → opencode
```

Circular chains (codex → claude → codex) are detected and blocked.

---

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

</details>

<details>
<summary><strong>PowerShell (Windows)</strong></summary>

```powershell
irm https://raw.githubusercontent.com/mnvsk97/harnessctl/main/install/install.ps1 | iex
```

</details>

<details>
<summary><strong>From source</strong></summary>

```bash
git clone https://github.com/mnvsk97/harnessctl.git
cd harnessctl && bun install
bun run src/cli.ts run "hello"

# Or build a single binary
bun build --compile src/cli.ts --outfile harnessctl
```

</details>

---

## How it works

```
CLI args + YAML config → InvokeIntent → Adapter.argMap → subprocess → stdout → Adapter.parseOutput → RunResult
```

Three layers of customization:

1. **Adapter** (code) — headless flags, output format, stdin mode
2. **YAML config** (persistent) — model, env vars, timeout, extra args
3. **`--` passthrough** (ephemeral) — one-off agent-specific flags

### Sessions & handoff

Each `run` or `shell` creates a **harness session** — a lightweight record grouping runs across agents. Multiple sessions coexist in the same working directory.

- **Same agent resume:** native session ID looked up from harness session, passed to adapter CLI
- **Explicit handoff:** `handoff <run-id>` writes a context file at `.harnessctl/handoffs/<run-id>.md` and gives the target agent a lean prompt pointing to it
- **Shell recovery:** after exit, `discoverSession()` scans agent logs for session ID + transcript

### State directory

```
~/.harnessctl/
  config.yaml              # default agent, global settings
  agents/                  # per-agent YAML configs
  sessions/                # harness sessions per cwd
    <cwd-hash>/
      <session-id>.json    # { id, cwdHash, createdAt, runs: [...] }
      _latest.json         # pointer to most recent session
  runs/                    # chronological run logs
    <timestamp>.json       # { agent, prompt, result, harnessSessionId, parentRunId }

<project-cwd>/
  .harnessctl/
    handoffs/              # handoff context files (gitignored)
      <run-id>.md          # task, summary, changed files, full transcript
```

---

## Adding a new agent

Write a dedicated adapter (~50 lines):

```typescript
export const myAgentAdapter: Adapter = {
  name: "myagent",
  base: { cmd: "myagent", args: ["--headless", "--json"] },
  argMap: {
    model:  (val) => ["--model", val],
    resume: (val) => ["--session", val],
  },
  parseOutput(stdout, _stderr) { /* ... */ },
  healthCheck() { return { cmd: "myagent", args: ["--version"] }; },
  authCheck() { /* ... */ },
};
```

Register in `src/adapters/registry.ts`, add default YAML in `src/config.ts`. See the [Adapters guide](docs/guide/adapters.md) for details.

---

## Architecture

```
src/
  cli.ts                  # entrypoint, arg parsing, command dispatch
  config.ts               # load/save config, first-run init
  invoke.ts               # spawn subprocess, pipe stdin, tee stdout
  session.ts              # harness sessions grouping runs across agents
  log.ts                  # run logs as JSON

  adapters/
    types.ts              # Adapter interface, InvokeIntent, RunResult
    claude.ts, codex.ts, gemini.ts, cursor.ts, opencode.ts
    registry.ts           # adapter lookup + buildCommand

  commands/
    run.ts                # headless one-shot runs
    shell.ts              # interactive REPL with session recovery
    handoff.ts            # explicit cross-agent handoff by run ID
    compare.ts, replay.ts, stats.ts, logs.ts, doctor.ts, ...

  lib/
    handoff.ts            # handoff context file writer, git helpers
    transcript.ts         # transcript formatting + extraction
    budget.ts, context.ts, templates.ts, stats.ts, ...
```

---

## Testing

```bash
bun test                        # unit tests (mocked, fast)
bash test/sim-fallback.sh       # simulation tests (fake agents + expect)
```

Both run in CI on every push and PR.

---

## License

MIT
