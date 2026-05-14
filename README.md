# harnessctl

**One command for Claude Code, Codex, DeepAgents, Gemini, Cursor, OpenCode, and custom coding agents.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/harnessctl)](https://www.npmjs.com/package/harnessctl)

`harnessctl` is a small CLI that lets you run, compare, hand off, and fail over between coding-agent CLIs without changing how you work.

Use it when one agent is better at planning, another is better at editing, and a third is available when the first one hits a rate limit.

## Install

```bash
npm install -g harnessctl
harnessctl setup
```

Or use Homebrew:

```bash
brew install mnvsk97/tap/harnessctl
```

Other options:

```bash
# Linux / macOS binary installer
curl -fsSL https://raw.githubusercontent.com/mnvsk97/harnessctl/main/install/install.sh | bash

# From source
git clone https://github.com/mnvsk97/harnessctl.git
cd harnessctl
bun install
bun run src/cli.ts --help
```

## Quick Start

```bash
# Run the default agent
harnessctl run "fix the auth bug"

# Pick an agent
harnessctl run --agent codex "refactor the database layer"
harnessctl run --agent deepagents "run the tests and fix failures"

# Open an interactive agent shell
harnessctl shell --agent claude

# Check configured agents
harnessctl doctor
```

## Core Workflows

### Hand Off Between Agents

Every run gets a run ID. Use it to continue with another agent.

```bash
harnessctl run --agent codex "refactor auth"
# run: 1713364500000-codex

harnessctl handoff 1713364500000-codex --agent claude "review and add tests"
```

The next agent gets a compact handoff: original task, summary, changed files, and a pointer to the full context file under `.harnessctl/handoffs/`.

### Compare Agents

Run the same prompt across agents and optionally ask a judge agent to pick the best result.

```bash
harnessctl compare "fix this bug" --agents codex,claude
harnessctl compare "fix this bug" --agents codex,claude --judge claude
```

### Run Pipelines

Chain agents through different stages of a task.

```bash
harnessctl pipeline "build auth module" --plan codex --build claude --test codex
```

### Fail Over Automatically

Configure a fallback agent for rate limits, token limits, or auth failures.

```yaml
# ~/.harnessctl/agents/claude.yaml
fallback: codex
auto_failover: true
failover_transfer: transcript
```

When Claude fails for a limit/auth reason, `harnessctl` hands the task to Codex with context.

## Useful Commands

```bash
harnessctl list                         # installed/configured agents
harnessctl doctor                       # health checks
harnessctl models --agent codex         # known models for an agent

harnessctl logs                         # recent run history
harnessctl logs --run-id RUN_ID         # one run only
harnessctl replay RUN_ID                # rerun a previous prompt
harnessctl stats --cost                 # spend summary

harnessctl run "continue" --resume      # resume latest harness session
harnessctl run --name auth-fix "fix"    # name a session
harnessctl run --template review "src"  # use a prompt template
harnessctl run --budget 2.00 "task"     # daily spend guardrail

harnessctl context set "Node 22, postgres, follow existing patterns"
harnessctl context sync
```

## Supported Agents

| Agent | Native resume | Transcript handoff | Failover |
| --- | --- | --- | --- |
| Claude Code | yes | full | full |
| Codex | no | full | full |
| DeepAgents | yes | summary + session DB pointer | summary |
| Gemini | yes | full | summary |
| Cursor | yes | full | summary |
| OpenCode | no | no | summary |
| Custom YAML | configurable | no | summary |

Custom agents live in `~/.harnessctl/agents/<name>.yaml`.

### DeepAgents

DeepAgents support uses the CLI's non-interactive stdin mode, so it behaves like the other headless harnessctl adapters:

```bash
harnessctl run --agent deepagents "fix the failing tests"
harnessctl run --agent deepagents "continue that change" --resume
harnessctl run --agent deepagents -- --agent backend-dev
```

The adapter invokes `deepagents --stdin --auto-approve --shell-allow-list recommended --quiet --no-stream`. To pass DeepAgents-specific flags, put them after `--` or in `~/.harnessctl/agents/deepagents.yaml` under `extra_args`. Project context syncs to DeepAgents' native `.deepagents/AGENTS.md` file.

Before running DeepAgents through harnessctl, configure provider credentials with DeepAgents' `/auth` flow, or set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_CLOUD_PROJECT`, or the matching `DEEPAGENTS_CLI_*` variant in your shell, project `.env`, `~/.deepagents/.env`, `~/.harnessctl/.env`, project `.harnessctl/.env`, or `~/.harnessctl/agents/deepagents.yaml` under `env`.

## Configuration

First run creates:

```text
~/.harnessctl/
  config.yaml
  agents/
  runs/
  sessions/
  templates/
  pipelines/
```

Common settings:

```bash
harnessctl config set default codex
harnessctl config set-fallback claude codex --auto
harnessctl config get
```

## Development

```bash
bun install
bun run src/cli.ts --help
bun test
bun run typecheck
bun run bundle
bash test/sim-headless-failover.sh
bash test/sim-fallback.sh
bash test/sim-deepagents.sh
bash test/real-deepagents-smoke.sh
```

`test/real-deepagents-smoke.sh` uses configured DeepAgents provider credentials when available. If no credential is configured, it runs the installed DeepAgents CLI with a temporary local `class_path` chat model so the harnessctl subprocess path is still exercised end to end without external secrets.

## Docs

More detailed guides live in [`docs/guide`](docs/guide/), and example notebooks live in [`docs/examples/notebooks`](docs/examples/notebooks/).

## License

[MIT](LICENSE)
