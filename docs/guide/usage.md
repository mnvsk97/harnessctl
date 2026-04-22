# Usage

harnessctl has two modes: **headless** (`run`) for one-shot prompts with output capture, and **interactive** (`shell`) for launching an agent's native REPL.

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

## Explicit handoff

Every `run` and `shell` prints a **run ID** and **session ID** after completion. Use the run ID to hand off to another agent with full context:

```bash
# First run with codex
harnessctl run --agent codex "refactor the auth module"
# → run: 1713364500000-codex  session: a3f8c012

# Hand off to claude — targets this specific run
harnessctl handoff 1713364500000-codex --agent claude "review and add tests"
```

The target agent receives a lean prompt — summary, changed files, and a pointer to `.harnessctl/handoffs/<run-id>.md` — not a full transcript dump. The agent reads the context file on demand.

### Same-agent handoff: resume vs fork

When handing off to the same agent, you can resume the native session or fork:

```bash
# Resume: continue the same native session
harnessctl handoff <run-id> --agent claude --resume "keep going"

# Fork: new session, but with context from the previous run
harnessctl handoff <run-id> --agent claude --fork "try differently"
```

If neither `--resume` nor `--fork` is specified and the terminal is interactive, harnessctl prompts you to choose.

### Shell mode handoff

Shell sessions are also tracked. After an interactive shell exits, harnessctl scans the agent's native logs to recover the session ID and transcript:

```bash
harnessctl shell --agent codex
# (work interactively, then exit)
# → run: 1713365000000-codex  session: b7e2d901

# Hand off to claude
harnessctl handoff 1713365000000-codex --agent claude "review what codex did"
```

### Cross-agent handoff (legacy)

`--resume` with a different agent still works as a lightweight alternative — it prepends the last run's summary to the new prompt:

```bash
harnessctl run --resume --agent codex "now add tests"
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

## Interactive shell

Launch an agent's native interactive REPL:

```bash
harnessctl shell                          # default agent
harnessctl shell --agent codex            # pick agent
harnessctl shell -a opencode              # shorthand
harnessctl shell -- --verbose             # passthrough flags
```

This hands your terminal directly to the agent (`stdio: "inherit"`). harnessctl handles agent selection, config resolution, model flags, and pre-flight auth checks before launching. The agent owns the full terminal — you get its native TUI/REPL experience.

After the shell exits, harnessctl recovers the session from the agent's native logs and prints a run ID — so you can hand off from shell sessions using `harnessctl handoff`.

## Comparing agents

Run the same prompt across multiple agents in parallel and compare the results:

```bash
# Compare all installed agents
harnessctl compare "write a function to parse ISO 8601 dates"

# Compare specific agents
harnessctl compare "fix the auth bug" --agents codex,claude

# Pipe context in
cat error.log | harnessctl compare "diagnose this error" --agents claude,codex,gemini
```

Each agent runs in parallel. When all finish, harnessctl prints a summary table:

```
── compare results ─────────────────────────────────
  ✓  codex     12.3s   $0.0045   1823 tokens
     extracted auth middleware into separate module…
  ✓  claude     8.1s   $0.0032   1204 tokens
     refactored auth into middleware, added tests…
  ✗  gemini    45.2s   —         —
     rate limited after initial analysis…
```

Each run is logged individually, so you can hand off from any of them:

```bash
harnessctl handoff 1713364500000-codex --agent claude "review codex's approach and improve it"
```

This is useful for benchmarking agents on your actual codebase, or for getting a second opinion on a tricky task.

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
