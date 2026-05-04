# harnessctl

Universal CLI wrapper for coding agents: Claude Code, Codex, OpenCode, Gemini,
and Cursor.

## Stack

- Bun and TypeScript.
- Development entry point: `bun run src/cli.ts`.
- Build output: single binary produced with `bun build --compile`.
- Keep runtime dependencies close to zero. Prefer Node/Bun built-ins and small
  local helpers.

## Common Commands

```bash
bun install
bun run src/cli.ts --help
bun test
bun run typecheck
bun run bundle
bash test/sim-headless-failover.sh
bash test/sim-fallback.sh
```

## Architecture

- `src/cli.ts`: entrypoint, argument parsing, command dispatch.
- `src/config.ts`: global and project config loading, first-run init.
- `src/invoke.ts`: subprocess execution, output capture, exit classification.
- `src/session.ts`: run/session grouping across agents.
- `src/log.ts`: run logs under `~/.harnessctl/runs/`.
- `src/adapters/`: per-agent invocation, parsing, health checks.
- `src/commands/`: CLI subcommands.
- `src/lib/`: shared helpers for context, memory, handoff, templates, budget,
  stats, and transcripts.

## Project Rules

- Adapter-specific behavior belongs in `src/adapters/`; shared behavior belongs
  in `src/lib/`.
- Keep command modules focused on CLI behavior and orchestration.
- Add tests near the behavior you change. The existing Bun tests are the default
  style.
- Preserve the logged raw user prompt behavior: logs should stay compact and not
  include expanded context or full transcript text unless the feature explicitly
  requires it.
- Do not commit generated build output from `dist/`, compiled `harnessctl`
  binaries, local `.harnessctl/` state, or `node_modules/`.
- For Symphony-managed work, follow `WORKFLOW.md` and keep the Linear
  `## Symphony Workpad` comment current.

## Validation Guidance

- TypeScript or CLI behavior changes: run `bun test` and `bun run typecheck`.
- Packaging, install, or entrypoint changes: also run `bun run bundle`.
- Fallback, handoff, session, or shell changes: run the relevant script in
  `test/`.
- Docs-only changes normally do not require code validation, but examples should
  be checked against the current CLI syntax.
