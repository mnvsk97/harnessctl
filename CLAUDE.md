# harnessctl

Universal CLI wrapper for coding agents (Claude Code, Codex, OpenCode, Gemini, Cursor).

## Stack
- Bun + TypeScript, no build step during dev (`bun run src/cli.ts`)
- Single dependency: `yaml` for YAML parsing
- Single binary via `bun build --compile`

## Commands
```
bun run src/cli.ts setup
bun run src/cli.ts run [--agent <n>] [--resume] [--template <n>] [--budget <usd>] <prompt> [-- <extra-args>...]
bun run src/cli.ts shell [--agent <n>] [-- <extra-args>...]
bun run src/cli.ts compare <prompt> [--agents <a,b,...>]
bun run src/cli.ts replay <run-id>
bun run src/cli.ts context get|set|edit|clear|sync|path
bun run src/cli.ts list
bun run src/cli.ts stats [--cost]
bun run src/cli.ts logs
bun run src/cli.ts doctor [--mcp]
bun run src/cli.ts config get|set|set-fallback|get-fallback|remove-fallback
```

## Architecture
- `src/cli.ts` — entrypoint, arg parsing, command dispatch
- `src/config.ts` — load/save `~/.harnessctl/config.yaml`, first-run init (also creates `projects/` and `templates/`)
- `src/invoke.ts` — spawn subprocess, pipe stdin, tee stdout, capture result, classify exit reason
- `src/session.ts` — session IDs + summaries per agent per cwd
- `src/log.ts` — run logs as JSON to `~/.harnessctl/runs/` (includes `model`, `extraArgs`, `exitReason`)
- `src/adapters/` — per-agent adapters; each declares `memoryFile`, `contextWindow`, `detectExitReason`, optional `extractTranscript`
- `src/adapters/_shared.ts` — `defaultDetectExitReason` regex table (rate_limit, token_limit, auth_error)
- `src/lib/` — `cwdHash`, `context`, `memory` (native memory-file sync), `templates`, `budget`, `transcript`, `stats`
- `src/commands/` — setup, run, shell, compare, replay, context, list, stats, logs, doctor, config

## Key decisions
- Adapter code owns invocation flags; YAML is for user preferences only
- Sessions are per-agent per-cwd; handoff prepends summary (or full transcript on auto-failover) to new prompt
- Output is tee'd: streamed live AND captured for parsing (headless `run` only; `shell` uses `stdio: "inherit"`)
- Pre-flight auth check runs before every `run` — each adapter implements `authCheck()` using a lightweight CLI command
- `auto_failover: true` + `fallback:` in an agent's YAML → silent handoff on rate/token/auth limits; generic errors still prompt
- Project context at `~/.harnessctl/projects/<cwdHash>/context.md` is prepended to the prompt AND mirrored into each agent's native memory file (CLAUDE.md, AGENTS.md, GEMINI.md) between `<!-- harnessctl:begin/end -->` sentinels
- The logged `prompt` field stores the raw user prompt only — template, context, and transcript are NOT written to logs to keep them compact
