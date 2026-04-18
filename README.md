<div align="center">

# harnessctl

**One CLI for all your coding agents**

Same commands, same logs, same handoff. Pick any agent underneath.

*Research preview -- expect rough edges.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/harnessctl)](https://www.npmjs.com/package/harnessctl)
[![npm downloads](https://img.shields.io/npm/dm/harnessctl)](https://www.npmjs.com/package/harnessctl)

</div>

---

If you use more than one coding agent, you're juggling CLIs. Different flags, different output, different session formats. harnessctl wraps all of them behind one interface.

It works with Claude Code, Codex, Gemini, Cursor, OpenCode, or anything you can point a YAML config at. If an agent hits a rate limit mid-task, harnessctl hands off to the next one with the conversation intact. You can also hand off manually by run ID -- and that works from interactive shell sessions too.

> [!NOTE]
> harnessctl is plumbing, not a platform. No model routing, no orchestration, no agent framework. Just a front door.

---

## Quickstart

```bash
npm install -g harnessctl        # or: brew install mnvsk97/tap/harnessctl

harnessctl run "fix the auth bug"
harnessctl run --agent codex "refactor the database layer"
harnessctl shell --agent claude
```

> [!TIP]
> Run `harnessctl setup` after installing to pick your default agent and check that everything is working.

---

## Handing off between agents

Every run prints a run ID and session ID. You use the run ID to hand off to another agent:

```bash
# codex does the initial work
harnessctl run --agent codex "refactor the auth module"
# -> run: 1713364500000-codex  session: a3f8c012

# hand that specific run off to claude
harnessctl handoff 1713364500000-codex --agent claude "review the refactor and add tests"
# -> run: 1713364600000-claude  session: a3f8c012  <- same session

# same-agent handoff: pick up where you left off, or start fresh with context
harnessctl handoff <run-id> --agent claude --resume "keep going"
harnessctl handoff <run-id> --agent claude --fork "try a different approach"
```

The target agent doesn't get the entire conversation dumped into its prompt. Instead it gets a short summary, the list of changed files, and a pointer to `.harnessctl/handoffs/<run-id>.md` where the full transcript lives. The agent can read that file if it needs more detail.

This works from interactive shell sessions too. After a shell exits, harnessctl reads the agent's native logs to recover the session.

### What happens during a handoff

```
Terminal 1                              Terminal 2
---------                              ---------
$ harnessctl run --agent codex          $ harnessctl run --agent codex
  "refactor auth"                         "fix CSS bug"
     |                                       |
     v                                       v
  session: a3f8c012                       session: f9b21e44
  run: 1713..500-codex                    run: 1713..510-codex
     |                                       |
     |  .harnessctl/handoffs/                | (separate session,
     |  1713..500-codex.md                   |  not affected)
     |  +---------------------+              |
     |  | Task: refactor auth |              v
     |  | Summary: ...        |           (done)
     |  | Files changed: ...  |
     |  | Conversation: ...   |
     |  +---------------------+
     |
     v
$ harnessctl handoff 1713..500-codex --agent claude "add tests"
     |
     v  what claude sees:
  +--------------------------------------+
  | Handoff from codex                   |
  | Task: refactor auth                  |
  | Summary: extracted middleware...     |
  | Files changed: src/auth/middleware.ts|
  | Full context: .harnessctl/handoffs/  |
  |               1713..500-codex.md     |
  | ------------------------------------ |
  | add tests                            |
  +--------------------------------------+
     |
     v
  session: a3f8c012  <- same session
  run: 1713..600-claude  <- linked to parent
```

A few things worth noting:
- The handoff prompt is short on purpose. Summary + pointer. The agent reads the full file only if it needs to.
- Two runs in the same repo get separate sessions. Handoff by run ID always targets the right one.
- `.harnessctl/` gets added to `.gitignore` automatically.

---

## Supported agents

| Agent | CLI | Resume | Transcript extraction | Session discovery |
|---|---|---|---|---|
| Claude Code | `claude` | `--resume <id>` | from JSONL files | by file mtime |
| Codex | `codex` | -- | from rollout files | by file mtime |
| Gemini | `gemini` | `--resume <id>` | from JSONL files | by file mtime |
| Cursor | `cursor-agent` | `--resume <id>` | from JSONL files | by file mtime |
| OpenCode | `opencode` | -- | -- | from SQLite DB |
| Custom | configurable | via YAML `resume_arg` | -- | -- |

---

## Usage

```bash
# run a prompt
harnessctl run "fix the auth bug in login.py"
harnessctl run --agent codex "fix the auth bug"
harnessctl run --cheapest "simple refactor"           # cheapest agent by history
harnessctl run --fastest "urgent fix"                  # fastest agent by history

# resume last session
harnessctl run --resume "now add tests for that"

# pipe context in
cat error.log | harnessctl run "fix this error"
git diff | harnessctl run "review this"

# pass flags straight to the agent CLI
harnessctl run --agent claude "fix" -- --max-turns 5 --add-dir ./docs

# interactive shell
harnessctl shell                    # default agent
harnessctl shell --agent codex      # pick agent

# project context (mirrored to CLAUDE.md, AGENTS.md, GEMINI.md)
harnessctl context set "Go 1.22, postgres, follow existing patterns"
harnessctl context edit

# templates, budget, replay
harnessctl run --template code-review "src/auth.ts"
harnessctl run --budget 2.00 "refactor payments"
harnessctl stats --cost
harnessctl replay <run-id>

# health checks
harnessctl doctor
harnessctl doctor --mcp
harnessctl list
```

---

## Auto-failover

If an agent hits a rate limit, runs out of context, or fails auth, harnessctl can silently hand off to another agent with the full conversation attached.

```yaml
# ~/.harnessctl/agents/claude.yaml
fallback: codex
auto_failover: true
failover_transfer: "transcript"   # or "summary" for just a one-liner
```

Set up fallback chains from the CLI:

```bash
harnessctl config set-fallback codex claude      # codex fails -> claude
harnessctl config set-fallback claude opencode   # claude fails -> opencode
```

Circular chains are detected and blocked.

---

## Install

```bash
# npm
npm install -g harnessctl

# homebrew
brew install mnvsk97/tap/harnessctl
```

Works with Bun (any version) or Node.js >= 22.

<details>
<summary>Shell script (Linux / macOS)</summary>

```bash
curl -fsSL https://raw.githubusercontent.com/mnvsk97/harnessctl/main/install/install.sh | bash
```

</details>

<details>
<summary>PowerShell (Windows)</summary>

```powershell
irm https://raw.githubusercontent.com/mnvsk97/harnessctl/main/install/install.ps1 | iex
```

</details>

<details>
<summary>From source</summary>

```bash
git clone https://github.com/mnvsk97/harnessctl.git
cd harnessctl && bun install
bun run src/cli.ts run "hello"

# or build a single binary
bun build --compile src/cli.ts --outfile harnessctl
```

</details>

---

## How it works

```
CLI args + YAML config -> InvokeIntent -> Adapter.argMap -> subprocess -> stdout -> Adapter.parseOutput -> RunResult
```

There are three layers of customization:

1. Adapter (code) -- headless flags, output format, how to parse results
2. YAML config (persistent) -- model, env vars, timeout, extra args per agent
3. `--` passthrough (one-off) -- flags for this specific run, passed straight to the agent

### Sessions

Each `run` or `shell` creates a harness session that groups related runs together. Multiple sessions can exist in the same repo at the same time.

When you resume, harnessctl looks up the agent's native session ID from the harness session and passes it through. When you hand off, it writes a context file and gives the new agent a pointer. After a shell exits, it scans agent logs to recover the session.

### Where state lives

```
~/.harnessctl/
  config.yaml              # default agent, settings
  agents/                  # per-agent YAML configs
  sessions/                # harness sessions, grouped by working directory
    <cwd-hash>/
      <session-id>.json    # runs list with agent session IDs
      _latest.json         # points to the most recent session
  runs/                    # one JSON file per run
    <timestamp>.json

<your-project>/
  .harnessctl/
    handoffs/              # context files for handoff (gitignored)
      <run-id>.md
```

---

## Adding an agent

Write an adapter (about 50 lines of TypeScript):

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

Register it in `src/adapters/registry.ts` and add default config in `src/config.ts`. The [adapters guide](docs/guide/adapters.md) has the full walkthrough.

---

## Architecture

```
src/
  cli.ts                  # arg parsing, command dispatch
  config.ts               # config loading, first-run init
  invoke.ts               # spawns agent subprocess, captures output
  session.ts              # harness sessions
  log.ts                  # run logs

  adapters/
    types.ts              # Adapter interface, InvokeIntent, RunResult
    claude.ts, codex.ts, gemini.ts, cursor.ts, opencode.ts
    registry.ts           # adapter lookup, command building

  commands/
    run.ts                # headless runs
    shell.ts              # interactive REPL, session recovery
    handoff.ts            # cross-agent handoff by run ID
    compare.ts, replay.ts, stats.ts, logs.ts, doctor.ts, ...

  lib/
    handoff.ts            # writes handoff context files, git diffing
    transcript.ts         # formats and extracts transcripts
    budget.ts, context.ts, templates.ts, stats.ts, ...
```

---

## Tests

```bash
bun test                        # unit tests
bash test/sim-fallback.sh       # simulated failover with fake agents
```

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get started.

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

For security issues, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
