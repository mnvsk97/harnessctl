<div align="center">

# harnessctl

**One CLI for all your coding agents**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/harnessctl)](https://www.npmjs.com/package/harnessctl)

</div>

---

Stop juggling CLIs. harnessctl wraps Claude Code, Codex, Gemini, Cursor, OpenCode -- or anything with a CLI -- behind one interface. If an agent hits a rate limit mid-task, harnessctl hands off to the next one with the conversation intact.

```bash
npm install -g harnessctl
harnessctl setup
```

## What it does

```bash
# run any agent
harnessctl run "fix the auth bug"
harnessctl run --agent codex "refactor the database layer"

# interactive shell
harnessctl shell --agent claude

# hand off between agents
harnessctl handoff <run-id> --agent codex "now write tests"

# compare agents side by side
harnessctl compare "fix the bug" --agents claude,codex
```

## Auto-failover

Agent hits a rate limit? harnessctl silently picks up with the fallback. No prompt, no lost context.

```yaml
# ~/.harnessctl/agents/claude.yaml
fallback: codex
auto_failover: true
failover_transfer: transcript   # full conversation, or "summary"
```

```
⚠ claude hit rate_limit (auto-failover → codex)
  handing off to codex...
┌ harnessctl │ codex │ authenticated
  ... codex continues with full context ...
└ ✓ codex │ duration: 14.2s
```

Supports chained fallback (claude → codex → gemini), cycle detection, and configurable transfer modes.

## Cross-agent handoff

Every run prints a run ID. Use it to hand off to another agent:

```bash
harnessctl run --agent codex "refactor auth module"
# → run: 1713364500000-codex  session: a3f8c012

harnessctl handoff 1713364500000-codex --agent claude "review and add tests"
# → run: 1713364600000-claude  session: a3f8c012  ← same session
```

The target agent gets a lean prompt -- summary, changed files, and a pointer to the context file. Not a transcript dump.

## Supported agents

| Agent | Resume | Transcript | Failover |
|---|---|---|---|
| Claude Code | native session resume | full transcript | full |
| Codex | -- | full transcript | full |
| Gemini | native session resume | full transcript | summary |
| Cursor | native session resume | full transcript | summary |
| OpenCode | -- | -- | summary |
| Custom (YAML) | configurable | -- | summary |

## More features

```bash
harnessctl run --resume "continue where you left off"
harnessctl run --cheapest "simple task"              # pick by cost history
harnessctl run --template code-review "src/auth.ts"  # reusable prompt templates
harnessctl run --budget 2.00 "refactor payments"     # daily spend cap
cat error.log | harnessctl run "fix this"            # pipe context in
harnessctl run --agent claude "fix" -- --max-turns 5 # passthrough flags

harnessctl stats --cost         # cost dashboard
harnessctl logs                 # run history with session chains
harnessctl replay <run-id>      # re-run a past invocation
harnessctl doctor               # health check all agents
harnessctl context set "Go 1.22, postgres"  # project context (synced to CLAUDE.md, AGENTS.md, etc.)
```

## Install

```bash
npm install -g harnessctl
# or
brew install mnvsk97/tap/harnessctl
```

<details>
<summary>Other methods</summary>

```bash
# shell script
curl -fsSL https://raw.githubusercontent.com/mnvsk97/harnessctl/main/install/install.sh | bash

# from source
git clone https://github.com/mnvsk97/harnessctl.git
cd harnessctl && bun install
bun run src/cli.ts run "hello"
```

</details>

## Tests

```bash
bun test                                 # unit tests
bash test/sim-headless-failover.sh       # headless auto-failover (14 tests)
bash test/sim-fallback.sh                # shell fallback with expect (10 tests)
```

## License

[MIT](LICENSE)
