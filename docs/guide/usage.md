# Usage

## Running prompts

The core command is `run`:

```bash
harnessctl run "fix the auth bug in login.py"
harnessctl run --agent codex "refactor the database layer"
```

The prompt is sent to the agent via stdin. Output streams live to your terminal.

## Choosing an agent

```bash
# Use default agent (set in config)
harnessctl run "prompt"

# Override for this run
harnessctl run --agent codex "prompt"
harnessctl run -a opencode "prompt"
```

## Resuming sessions

```bash
# Resume with the same agent
harnessctl run --resume "now add tests for that"
harnessctl run -r "continue with error handling"
```

Session IDs are stored per agent per working directory. When you resume, the adapter passes the session ID to the agent CLI (e.g. `claude --resume <id>`).

## Cross-agent handoff

When you resume but switch agents, harnessctl prepends the previous agent's summary to the new prompt:

```bash
# First run with claude
harnessctl run --agent claude "fix the auth bug"

# Hand off to codex — claude's summary is included as context
harnessctl run --resume --agent codex "now add tests"
```

The new agent sees:

```
Previous context from claude:
<summary of last run>

now add tests
```

## Piping context

```bash
cat error.log | harnessctl run "fix this error"
git diff | harnessctl run "review this diff"
cat src/auth.py | harnessctl run "find the bug"
```

Piped input is prepended to the prompt.

## Passthrough flags

Everything after `--` is passed directly to the agent CLI:

```bash
harnessctl run --agent claude "fix" -- --max-turns 5 --add-dir ./docs
harnessctl run --agent codex "fix" -- --model o3
```

## Flag support per agent

Not all agents support all flags. harnessctl warns when you use a flag an agent doesn't support:

```
[harnessctl] warning: --resume is not supported by codex, ignoring
```

Current flag support:

| Flag | Claude | Codex | OpenCode |
|---|---|---|---|
| `--model` | `--model` | `--model` | `--model` |
| `--resume` | `--resume <id>` | not supported | not supported |
