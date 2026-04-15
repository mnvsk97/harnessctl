# Getting Started

## Prerequisites

- [Bun](https://bun.sh) runtime
- At least one coding agent CLI installed (`claude`, `codex`, or `opencode`)

## Install

```bash
git clone https://github.com/mnvsk97/harnessctl.git
cd harnessctl
bun install
```

## Quick start

```bash
# Run with default agent (claude)
bun run src/cli.ts run "fix the auth bug"

# Run with a specific agent
bun run src/cli.ts run --agent codex "fix the auth bug"

# Check what's installed
bun run src/cli.ts doctor
```

## Build a binary

```bash
bun build --compile src/cli.ts --outfile harnessctl
./harnessctl run "hello"
```

## Set your default agent

```bash
harnessctl config set default claude
```

## First run

On first run, harnessctl creates `~/.harnessctl/` with default configs:

```
~/.harnessctl/
  config.yaml          # default_agent: claude
  agents/
    claude.yaml        # model, env, timeout
    codex.yaml
    opencode.yaml
  sessions/
  runs/
```
