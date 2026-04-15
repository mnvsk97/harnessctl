# Getting Started

## Prerequisites

At least one coding agent CLI installed (`claude`, `codex`, or `opencode`).

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

### Shell script (Linux / macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/mnvsk97/harnessctl/main/install/install.sh | bash
```

Downloads the latest compiled binary to `/usr/local/bin`. Override with `HARNESSCTL_INSTALL_DIR`:

```bash
HARNESSCTL_INSTALL_DIR=~/.local/bin curl -fsSL https://raw.githubusercontent.com/mnvsk97/harnessctl/main/install/install.sh | bash
```

### PowerShell (Windows)

```powershell
irm https://raw.githubusercontent.com/mnvsk97/harnessctl/main/install/install.ps1 | iex
```

Downloads the latest binary to `~\.harnessctl\bin` and adds it to your PATH.

### From source

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/mnvsk97/harnessctl.git
cd harnessctl
bun install
bun run src/cli.ts --help
```

Build a single binary:

```bash
bun build --compile src/cli.ts --outfile harnessctl
./harnessctl --help
```

## Quick start

```bash
# Run with default agent (claude)
harnessctl run "fix the auth bug"

# Run with a specific agent
harnessctl run --agent codex "fix the auth bug"

# Check what's installed
harnessctl doctor
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
    claude.yaml        # env, timeout
    codex.yaml
    opencode.yaml
  sessions/
  runs/
```
