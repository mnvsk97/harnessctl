# harnessctl

Universal CLI wrapper for coding agents (Claude Code, Codex, OpenCode, Gemini, Cursor).

## Stack
- Bun + TypeScript, no build step during dev (`bun run src/cli.ts`)
- Single dependency: `yaml` for YAML parsing
- Single binary via `bun build --compile`

## Commands
```
bun run src/cli.ts setup
bun run src/cli.ts run [--agent <n>] [--resume] [--stream] [--template <n>] [--budget <usd>] <prompt> [-- <extra-args>...]
bun run src/cli.ts shell [--agent <n>] [-- <extra-args>...]
bun run src/cli.ts handoff <run-id> --agent <name> [--resume|--fork] [--budget <usd>] <prompt>
bun run src/cli.ts compare <prompt> [--agents <a,b,...>]
bun run src/cli.ts replay <run-id>
bun run src/cli.ts context get|set|edit|clear|sync|path
bun run src/cli.ts list
bun run src/cli.ts models --agent <name>
bun run src/cli.ts stats [--cost]
bun run src/cli.ts logs [--agent <name>] [--limit N]
bun run src/cli.ts doctor [--mcp]
bun run src/cli.ts config get|set|set-fallback|get-fallback|remove-fallback
```

## Architecture
- `src/cli.ts` — entrypoint, arg parsing, command dispatch
- `src/config.ts` — load/save `~/.harnessctl/config.yaml`, first-run init (also creates `projects/`, `templates/`, `sessions/`)
- `src/invoke.ts` — spawn subprocess, pipe stdin, tee stdout, capture result, classify exit reason
- `src/session.ts` — HarnessSession records grouping runs across agents per cwd; supports concurrent sessions
- `src/log.ts` — run logs as JSON to `~/.harnessctl/runs/` (includes `model`, `extraArgs`, `exitReason`, `harnessSessionId`, `parentRunId`)
- `src/adapters/` — per-agent adapters; each declares `memoryFile`, `contextWindow`, `detectExitReason`, optional `extractTranscript`, `discoverSession`
- `src/adapters/_shared.ts` — `defaultDetectExitReason` regex table (rate_limit, token_limit, auth_error)
- `src/lib/handoff.ts` — writes handoff context files to `<cwd>/.harnessctl/handoffs/`, builds lean handoff prompts, git diff helpers, `.gitignore` management
- `src/lib/transcript.ts` — `formatTranscript` for turn rendering + `buildTranscriptBlock` for failover/handoff transcript extraction
- `src/lib/` — also: `cwdHash`, `context`, `memory` (native memory-file sync), `templates`, `budget`, `stats`
- `src/commands/` — setup, run, shell, handoff, compare, replay, context, list, models, stats, logs, doctor, config

## Key decisions
- Adapter code owns invocation flags; YAML is for user preferences only
- HarnessSession groups runs across agents; each run/shell creates a session with a short ID (8-char UUID prefix)
- `handoff <run-id>` writes a context file at `.harnessctl/handoffs/<run-id>.md` and gives the target agent a lean prompt (summary + changed files + pointer), not a full transcript dump
- Shell mode uses `stdio: "inherit"` but recovers session data after exit via `adapter.discoverSession()` scanning agent logs
- Output is tee'd: streamed live AND captured for parsing (headless `run` only)
- Pre-flight auth check runs before every `run` — each adapter implements `authCheck()` using a lightweight CLI command
- `auto_failover: true` + `fallback:` in an agent's YAML — silent handoff on rate/token/auth limits; generic errors still prompt
- Project context at `~/.harnessctl/projects/<cwdHash>/context.md` is prepended to the prompt AND mirrored into each agent's native memory file (CLAUDE.md, AGENTS.md, GEMINI.md) between `<!-- harnessctl:begin/end -->` sentinels
- The logged `prompt` field stores the raw user prompt only — template, context, and transcript are NOT written to logs to keep them compact
- `.harnessctl/` in project directories is auto-added to `.gitignore`
