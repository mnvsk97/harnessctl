# Changelog

## Unreleased

- Added DeepAgents as a built-in adapter. `harnessctl run --agent deepagents` now invokes the DeepAgents CLI in non-interactive stdin mode with model and resume flag support.
- Documented DeepAgents usage in the README and adapter guide.
- Synced harnessctl project context into DeepAgents' native `.deepagents/AGENTS.md` project memory file.
- Aligned DeepAgents auth preflight with the CLI's credential sources and harnessctl agent env, including DeepAgents' `/auth` store, shell environment, custom `api_key_env` values from `~/.deepagents/config.toml`, project `.env`, `~/.deepagents/.env`, harnessctl `.env` files, and `~/.harnessctl/agents/deepagents.yaml`.
- Added a DeepAgents adapter smoke script that verifies the end-to-end harnessctl subprocess path, resume mapping, handoff command, compare reports, pipeline stages, run logs, and handoff pointers with a fake `deepagents` binary.
- Added a live DeepAgents smoke script that verifies installed CLI flag/thread-list compatibility, uses real provider credentials when configured, and falls back to a temporary local `class_path` chat model so the installed CLI path is still tested without external secrets.
