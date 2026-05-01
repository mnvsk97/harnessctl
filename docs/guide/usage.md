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

# Auto-select by history
harnessctl run --cheapest "simple task"    # lowest avg cost
harnessctl run --fastest "quick fix"       # lowest avg duration
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

## Named sessions

Give sessions human-readable names for easy reference:

```bash
harnessctl run --name auth-refactor "fix the auth module"
harnessctl shell --name debugging --agent claude
harnessctl pipeline "build feature" --plan codex --build claude --name feature-x
```

Names must be lowercase alphanumeric with hyphens or underscores, max 64 characters. Named sessions can be referenced later by name instead of ID.

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

# Ask one agent to judge the comparison
harnessctl compare "fix the auth bug" --agents codex,claude --judge claude

# Pipe context in
cat error.log | harnessctl compare "diagnose this error" --agents claude,codex,gemini
```

Each agent runs in parallel. When all finish, harnessctl labels the full outputs, prints a summary table, and writes a Markdown report:

```
── compare outputs ─────────────────────────────────────────
codex (1713364500000-codex)
...

claude (1713364505000-claude)
...

── compare results ─────────────────────────────────
  ✓  codex     12.3s   $0.0045   1823 tokens  1713364500000-codex
     extracted auth middleware into separate module…
  ✓  claude     8.1s   $0.0032   1204 tokens  1713364505000-claude
     refactored auth into middleware, added tests…
  ✗  gemini    45.2s   —         —            1713364510000-gemini
     rate limited after initial analysis…
  report: .harnessctl/compare/1713364515000-compare.md
```

Each run is logged individually, so you can hand off from any run ID:

```bash
harnessctl handoff 1713364500000-codex --agent claude "review codex's approach and improve it"
```

This is useful for benchmarking agents on your actual codebase, getting a second opinion on a tricky task, or creating a judgeable report without copying terminal output around.

## Pipelines

Chain multiple agents in sequence, each handling a different stage of a task:

```bash
# Role flags: plan, build, review, test (executed in that order)
harnessctl pipeline "build auth module" --plan codex --build claude
harnessctl pipeline "add search" --plan codex --build claude --review codex --test claude

# Custom steps with per-step instructions
harnessctl pipeline "refactor payments" \
  --step codex:"plan the API changes" \
  --step claude:"implement the plan"

# Reusable presets from ~/.harnessctl/pipelines/
harnessctl pipeline "build feature X" --preset plan-build-test
```

Each stage runs sequentially. After the first stage, each subsequent agent receives a handoff prompt with the summary, changed files, and context from the previous stage. All stages share a single harness session.

### Role flags

Role flags assign a predefined instruction to each stage:

| Flag | Instruction |
|---|---|
| `--plan <agent>` | Create a detailed implementation plan (no code) |
| `--build <agent>` | Implement based on the previous stage's plan |
| `--review <agent>` | Review for bugs, edge cases, improvements |
| `--test <agent>` | Write comprehensive tests |

Roles always execute in the order: plan, build, review, test — regardless of flag order on the command line.

### Presets

Save pipeline configurations as YAML in `~/.harnessctl/pipelines/`:

```yaml
# ~/.harnessctl/pipelines/plan-build-test.yaml
stages:
  - role: plan
    agent: codex
  - role: build
    agent: claude
  - role: test
    agent: codex
```

### Pipeline options

```bash
harnessctl pipeline "prompt" --name my-pipeline   # named session
harnessctl pipeline "prompt" --stream              # stream live output
harnessctl pipeline "prompt" --budget 5.00         # daily spend cap
```

If any stage fails (non-zero exit), the pipeline stops and prints a summary of completed stages.

## Flag support per agent

Not all agents support all flags. harnessctl warns when you use a flag an agent doesn't support:

```
[harnessctl] warning: --resume is not supported by codex, ignoring
```

Current flag support:

| Flag | Claude | Codex | OpenCode | Gemini | Cursor |
|---|---|---|---|---|---|
| `--model` | `--model` | `--model` | `--model` | `--model` | `-m` |
| `--resume` | `--resume <id>` | -- | -- | `--resume <id>` | `--resume <id>` |
