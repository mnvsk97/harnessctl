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

# Verify
bun test
bun run typecheck
bun run bundle

# Build binary
bun build --compile src/cli.ts --outfile harnessctl
```

## Adding a new agent adapter

1. Create `src/adapters/<agent>.ts` implementing the `Adapter` interface
2. Define `base` (command + fixed args), `argMap` (flag translations), `parseOutput`, and `healthCheck`
3. Register it in `src/adapters/registry.ts`
4. Add a default YAML config in `src/config.ts` `DEFAULT_AGENTS`

Look at `src/adapters/codex.ts` or `src/adapters/opencode.ts` as compact references.

### Adapter checklist

- [ ] `base.cmd` and `base.args` invoke the agent in headless/non-interactive mode
- [ ] `argMap` declares which harnessctl flags the agent supports and how they translate
- [ ] `parseOutput` extracts summary, session ID, cost, and token usage from output
- [ ] `detectExitReason` is added only if the shared detector is not enough
- [ ] `healthCheck` and `authCheck` are cheap, non-interactive commands
- [ ] Tests cover parsing and flag mapping for the adapter

## Project structure

```
src/
  cli.ts           # entrypoint
  config.ts        # config loading
  invoke.ts        # subprocess execution (headless run)
  session.ts       # session management
  log.ts           # run logging
  adapters/        # per-agent translation layer
  commands/        # CLI commands (run, shell, list, doctor, config, pipeline)
```

## Guidelines

- Keep it minimal. harnessctl is plumbing, not a platform.
- Runtime dependencies should stay near zero; prefer Node built-ins.
- Adapters should be self-contained and boring.
- Test with the actual agent CLI before submitting.

## Reporting issues

Open an issue on GitHub with:
- Which agent and version
- The command you ran
- What you expected vs what happened
