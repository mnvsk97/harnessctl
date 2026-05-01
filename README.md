# harnessctl

**One CLI for all your coding agents**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/harnessctl)](https://www.npmjs.com/package/harnessctl)

---

Routers started at the API level: distribute workloads across pods, keep sessions sticky, classify requests, and send traffic to the right place.

Then LLM routers showed up. If you were building an app, you could switch between models based on complexity, intent, cost, latency, time to first token, or whatever else mattered for that request. The point was simple: get the best model for the job without rewriting your app every time the model landscape changed.

The natural next step is routing between agent harnesses.

An agent harness is the full coding-agent runtime around the model: the CLI, tools, memory, prompting style, session format, approvals, repo context, and all the small choices that shape how the agent actually works. Claude Code, Codex, OpenCode, Cursor CLI, and Gemini CLI are not interchangeable wrappers around the same thing. They behave differently, and those differences matter.

harnessctl is an attempt to make switching between harnesses easy. Use Codex for one task, Claude Code for another, compare Gemini against Cursor, or hand off midway when one harness has the feature or behavior you need.

```bash
npm install -g harnessctl
harnessctl setup
```

## Why switch harnesses?

- Distribute cost and spend across providers instead of piling everything onto one tool.
- Constantly compare what works best for your actual workflow. There is no one-harness-fits-all answer. The best choice depends on how you prompt, how you manage memory, how your repo is structured, and what kind of app you are building.
- Pick based on evidence, not whatever tweet says "Codex is the best now" this week.
- Use the best part of each harness. Maybe one has better session resume, another has better repo edits, another has a feature you need halfway through a session.
- Keep moving when a harness hits auth issues, rate limits, missing features, or just starts doing the wrong thing.

## What it does

```bash
# run any agent
harnessctl run "fix the auth bug"
harnessctl run --agent codex "refactor the database layer"

# interactive shell
harnessctl shell --agent claude

# multi-agent pipeline
harnessctl pipeline "build auth module" --plan codex --build claude --test codex

# hand off between agents
harnessctl handoff RUN_ID --agent codex "now write tests"

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
harnessctl run --fastest "quick fix"                 # pick by speed history
harnessctl run --name auth-refactor "fix auth"       # named session
harnessctl run --template code-review "src/auth.ts"  # reusable prompt templates
harnessctl run --budget 2.00 "refactor payments"     # daily spend cap
cat error.log | harnessctl run "fix this"            # pipe context in
harnessctl run --agent claude "fix" -- --max-turns 5 # passthrough flags

harnessctl stats --cost         # cost dashboard
harnessctl logs                 # run history with session chains
harnessctl replay RUN_ID        # re-run a past invocation
harnessctl doctor               # health check all agents
harnessctl context set "Go 1.22, postgres"  # project context (synced to CLAUDE.md, AGENTS.md, etc.)
```

## Install

```bash
npm install -g harnessctl
# or
brew install mnvsk97/tap/harnessctl
```

Other methods:

```bash
# shell script
curl -fsSL https://raw.githubusercontent.com/mnvsk97/harnessctl/main/install/install.sh | bash

# from source
git clone https://github.com/mnvsk97/harnessctl.git
cd harnessctl && bun install
bun run src/cli.ts run "hello"
```

## Tests

```bash
bun test                                 # unit tests
bun run typecheck                        # TypeScript check
bash test/sim-headless-failover.sh       # headless auto-failover (14 tests)
bash test/sim-fallback.sh                # shell fallback with expect (10 tests)
```

## License

[MIT](LICENSE)
