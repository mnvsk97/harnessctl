# Configuration

## Global config

```bash
harnessctl config get                    # show all
harnessctl config get default_agent      # show one key
harnessctl config set default claude     # set default agent
```

Config lives at `~/.harnessctl/config.yaml`:

```yaml
default_agent: claude
```

## Agent config

Each agent has a YAML file at `~/.harnessctl/agents/<name>.yaml`:

```yaml
# ~/.harnessctl/agents/claude.yaml
model: claude-sonnet-4-6
env:
  ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
timeout: 300
extra_args: []
```

Custom agents can also define their own command directly in YAML:

```yaml
# ~/.harnessctl/agents/myagent.yaml
cmd: myagent
args: ["--headless", "--json"]
model_arg: --model
resume_arg: --session
healthcheck:
  args: ["--version"]
timeout: 300
extra_args: []
```

### Fields

| Field | Type | Description |
|---|---|---|
| `model` | string | Model to use (passed via adapter's argMap) |
| `cmd` | string | Command to launch for a custom non-built-in agent |
| `args` | list | Base args always passed to a custom agent |
| `model_arg` | string | Flag name used to pass `model` to a custom agent |
| `resume_arg` | string | Flag name used to pass resume/session IDs to a custom agent |
| `healthcheck` | map | Optional override for install check command/args |
| `env` | map | Environment variables. `${VAR}` syntax resolves from your shell env |
| `timeout` | number | Seconds before SIGTERM (default: 300) |
| `extra_args` | list | Args appended to every invocation of this agent |
| `fallback` | string | Agent to hand off to on failure (e.g. `codex`) |
| `auto_failover` | boolean | Silent handoff on rate/token/auth limits (default: false) |
| `failover_transfer` | string | What to carry to fallback: `"transcript"` or `"summary"` (default: transcript) |
| `budget_daily` | number | Daily spend ceiling in USD |

### Auto-failover example

```yaml
# ~/.harnessctl/agents/claude.yaml
model: claude-sonnet-4-6
fallback: codex
auto_failover: true
failover_transfer: transcript
```

When Claude hits a rate limit, token limit, or auth error, harnessctl silently hands off to Codex with the full conversation attached. Generic errors still prompt. Set up chains from the CLI:

```bash
harnessctl config set-fallback claude codex
harnessctl config set-fallback codex opencode
```

### What goes in YAML vs adapter code

- **YAML** — user preferences: model, env, timeout, extra args
- **Adapter code** — invocation mechanics: headless flags, output format, stdin mode

For built-ins (`claude`, `codex`, `opencode`), the adapter still owns invocation mechanics. For custom agents, YAML provides those mechanics through `cmd` and `args`.

You never put `--print` or `--output-format` in YAML. That's the adapter's job.

## Environment variables

Env vars in agent YAML support `${VAR}` expansion:

```yaml
env:
  ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
  OPENAI_API_KEY: ${OPENAI_API_KEY}
```

These are resolved at runtime from your shell environment and passed to the agent subprocess.
