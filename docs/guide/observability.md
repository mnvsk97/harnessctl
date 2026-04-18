# Observability

::: tip
Both `run` and `shell` modes create run logs and session records. Shell mode recovers session data from agent logs after exit.
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
  "timestamp": "2026-04-15T10:00:00.000Z",
  "harnessSessionId": "a3f8c012",
  "parentRunId": "1713200000000-codex"
}
```

The `harnessSessionId` links runs in the same handoff chain. The `parentRunId` points to the run this was handed off from (if any). Use `harnessctl logs` to see run IDs, session IDs, and handoff chains.

## Handoff context files

Each run writes a handoff context file at `<project>/.harnessctl/handoffs/<run-id>.md` containing the task, summary, changed files, and full transcript. These are gitignored and used by `harnessctl handoff` to provide context to the target agent.

## Inline stats

After each run, harnessctl prints stats and identifiers to stderr:

```
┌ harnessctl │ claude │ authenticated │ ~/dev/project
────────────────────────────────────────────────────
... agent output streams here ...
────────────────────────────────────────────────────
└ ✓ claude │ tokens: 1500in/800out │ cost: $0.0342 │ duration: 12.3s
  run: 1713200000000-claude  session: a3f8c012
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
