# Contributing to harnessctl

Thanks for your interest in contributing.

## Development

```bash
# Clone and install
git clone https://github.com/mnvsk97/harnessctl.git
cd harnessctl
bun install

# Run from source
bun run src/cli.ts run "hello"

# Build binary
bun build --compile src/cli.ts --outfile harnessctl
```

## Adding a new agent adapter

1. Create `src/adapters/<agent>.ts` implementing the `Adapter` interface
2. Define `base` (command + fixed args), `argMap` (flag translations), `parseOutput`, and `healthCheck`
3. Register it in `src/adapters/registry.ts`
4. Add a default YAML config in `src/config.ts` `DEFAULT_AGENTS`

Look at `src/adapters/claude.ts` as a reference — it's about 50 lines.

### Adapter checklist

- [ ] `base.cmd` and `base.args` invoke the agent in headless/non-interactive mode
- [ ] `argMap` declares which harnessctl flags the agent supports and how they translate
- [ ] `parseOutput` extracts summary, session ID, cost, and token usage from output
- [ ] `healthCheck` returns a command that verifies the agent is installed

## Project structure

```
src/
  cli.ts           # entrypoint
  config.ts        # config loading
  invoke.ts        # subprocess execution
  session.ts       # session management
  log.ts           # run logging
  adapters/        # per-agent translation layer
  commands/        # CLI commands
```

## Guidelines

- Keep it minimal. harnessctl is plumbing, not a platform.
- No new dependencies unless absolutely necessary.
- Adapters should be self-contained (~40-60 lines).
- Test with the actual agent CLI before submitting.

## Reporting issues

Open an issue on GitHub with:
- Which agent and version
- The command you ran
- What you expected vs what happened
