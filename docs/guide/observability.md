# Observability

::: tip
Observability features (run logs, inline stats) apply to `harnessctl run` only. `harnessctl shell` hands the terminal to the agent directly — no output capture or logging.
:::

## Run logs

Every `run` invocation is logged as a JSON file in `~/.harnessctl/runs/`:

```
~/.harnessctl/runs/
  1713200000000-claude.json
  1713200100000-codex.json
```

Each log file contains:

```json
{
  "agent": "claude",
  "prompt": "fix the auth bug",
  "cwd": "/home/user/project",
  "result": {
    "exitCode": 0,
    "summary": "Fixed the authentication bug in login.py...",
    "sessionId": "abc123",
    "cost": 0.0342,
    "tokens": { "input": 1500, "output": 800 },
    "duration": 12.3
  },
  "timestamp": "2026-04-15T10:00:00.000Z"
}
```

## Inline stats

After each run, harnessctl prints stats to stderr:

```
[harnessctl] agent=claude cwd=/home/user/project
... agent output streams here ...
[harnessctl] tokens: 1500in/800out | cost: $0.0342 | duration: 12.3s
```

## Health checks

```bash
harnessctl doctor
```

Output:

```
harnessctl doctor

Config: default_agent=claude

  claude: ✓ 2.1.92 (Claude Code)
  codex: ✓ codex-cli 0.120.0
  opencode: ✗ not installed (opencode not found in PATH)

Some agents are missing or unhealthy.
```

## Listing agents

```bash
harnessctl list
```

Output:

```
Available agents:

  claude (default)  ✓ installed
    model: claude-sonnet-4-6
  codex  ✓ installed
    model: o4-mini
  opencode  ✗ not found
    model: default
```
