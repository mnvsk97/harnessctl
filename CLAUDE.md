# harnessctl

Universal CLI wrapper for coding agents (Claude Code, Codex, OpenCode).

## Stack
- Bun + TypeScript, no build step during dev (`bun run src/cli.ts`)
- Single dependency: `yaml` for YAML parsing
- Single binary via `bun build --compile`

## Commands
```
bun run src/cli.ts run [--agent <name>] [--resume] <prompt> [-- <extra-args>...]
bun run src/cli.ts list
bun run src/cli.ts doctor
bun run src/cli.ts config get|set
```

## Architecture
- `src/cli.ts` — entrypoint, arg parsing, command dispatch
- `src/config.ts` — load/save `~/.harnessctl/config.yaml`, first-run init
- `src/invoke.ts` — spawn subprocess, pipe stdin, tee stdout, capture result
- `src/session.ts` — session IDs + summaries per agent per cwd
- `src/log.ts` — run logs as JSON to `~/.harnessctl/runs/`
- `src/adapters/` — per-agent adapters (claude, codex, opencode, generic)
- `src/commands/` — run, list, doctor, config

## Key decisions
- Adapter code owns invocation flags; YAML is for user preferences only
- Generic adapter reads full invocation from YAML as escape hatch
- Sessions are per-agent per-cwd; handoff prepends summary to new prompt
- Output is tee'd: streamed live AND captured for parsing
- Pre-flight auth check runs before every `run` — each adapter implements `authCheck()` using a lightweight CLI command (e.g. `claude auth status`, `codex login status`, `opencode auth list`)
