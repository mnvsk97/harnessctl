# Agent Session Files Reference

What files each coding agent creates on disk during shell (interactive) and headless sessions.
Last updated: 2026-04-18.

---

## Claude Code (`claude`)

| File / Directory | Path Pattern | Format | Mode | Contents |
|---|---|---|---|---|
| Session transcript | `~/.claude/projects/<hash>/<session-uuid>.jsonl` | JSONL | Both | User messages, assistant responses, tool use, file-history snapshots |
| Project memory | `~/.claude/projects/<hash>/memory/MEMORY.md` | Markdown | Both | Persistent context, user preferences across sessions |
| Memory entries | `~/.claude/projects/<hash>/memory/*.md` | Markdown | Both | Individual memory files (date-stamped or topic-based) |
| REPL history | `~/.claude/history.jsonl` | JSONL | Shell | Command display text, timestamps, project path, session ID |
| Process metadata | `~/.claude/sessions/<pid>.json` | JSON | Shell | PID, sessionId, cwd, startedAt, kind ("interactive"/"headless") |
| Task locks | `~/.claude/tasks/<session-uuid>/.lock` | Lock | Both | Concurrency control |
| Task highwatermark | `~/.claude/tasks/<session-uuid>/.highwatermark` | Text | Both | Task state tracking |
| Plans | `~/.claude/plans/<name>.md` | Markdown | Shell | Structured session plans |
| Settings | `~/.claude/settings.json` | JSON | Both | Model, plugins, permissions, hooks |
| MCP auth cache | `~/.claude/mcp-needs-auth-cache.json` | JSON | Both | Which MCP servers need auth + timestamps |
| Debug logs | `~/.claude/debug/<uuid>.txt` | Text | Both (--debug) | Debug output |
| Native memory file | `<cwd>/CLAUDE.md` | Markdown | Both | Project instructions (harnessctl syncs context here) |

**Key session file:** `~/.claude/projects/<hash>/<session-uuid>.jsonl` — this is the primary transcript file used by harnessctl for handoff. The `<hash>` is the project's absolute path with `/` replaced by `-` (e.g., `-Users-saikrishna-dev-harnessctl`).

---

## Codex (`codex`)

| File / Directory | Path Pattern | Format | Mode | Contents |
|---|---|---|---|---|
| Session rollout | `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<session-id>.jsonl` | JSONL | Both | session_meta, response_item, event_msg, token_count events |
| Session index | `~/.codex/session_index.jsonl` | JSONL | TUI | Maps session IDs to thread names + timestamps |
| Command history | `~/.codex/history.jsonl` | JSONL | TUI | User prompts with session ID and Unix timestamp |
| Config | `~/.codex/config.toml` | TOML | Both | Model, sandbox mode, MCP servers, trust levels |
| Auth tokens | `~/.codex/auth.json` | JSON | Both | OAuth tokens and API keys |
| Installation ID | `~/.codex/installation_id` | Text | Once | Persistent UUID |
| TUI log | `~/.codex/log/codex-tui.log` | Text | TUI | OTLM-formatted debug/info logs |
| Logs DB | `~/.codex/logs_2.sqlite` | SQLite | TUI | Structured logs |
| State DB | `~/.codex/state_5.sqlite` | SQLite | TUI | Application state |
| App tools cache | `~/.codex/cache/codex_apps_tools/*.json` | JSON | Both | Cached tool/app definitions |
| Models cache | `~/.codex/models_cache.json` | JSON | Both | Cached model metadata |
| Plugins | `~/.codex/plugins/cache/openai-curated/*/` | Mixed | Both | Plugin definitions, YAML agents, markdown refs |
| Skills | `~/.codex/skills/codex-primary-runtime/*/` | Mixed | Both | Built-in skills (SKILL.md, templates, scripts) |
| Archived sessions | `~/.codex/archived_sessions/rollout-*.jsonl` | JSONL | Both | Old rollout files moved from sessions/ |
| Version check | `~/.codex/version.json` | JSON | Both | Latest version + check timestamp |
| Native memory file | `<cwd>/AGENTS.md` | Markdown | Both | Project instructions (harnessctl syncs context here) |

**Key session file:** `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<session-id>.jsonl` — date-partitioned rollout files. harnessctl finds the newest rollout modified after the run started. Contains `event_msg` entries with `user_message` (actual user input) and `agent_message` (assistant responses), plus `response_item` entries with `output_text`.

---

## OpenCode (`opencode`)

| File / Directory | Path Pattern | Format | Mode | Contents |
|---|---|---|---|---|
| Session DB | `~/.local/share/opencode/opencode.db` | SQLite | Both | sessions table: id, cost, prompt_tokens, completion_tokens, updated_at |
| Project metadata | `~/.local/share/opencode/storage/project/<hash>.json` | JSON | Both | id, worktree path, vcs type, timestamps |
| Run logs | `~/.local/share/opencode/log/YYYY-MM-DDTHHMMSS.log` | Text | Both | INFO-level logs: startup, config, plugin init |
| Config/plugins | `~/.config/opencode/package.json` | JSON | Both | Installed plugins manifest |
| Plugin modules | `~/.config/opencode/node_modules/` | JS | Both | Auth modules (copilot-auth, anthropic-auth) |
| Models cache | `~/.cache/opencode/models.json` | JSON | Both | Cached model list (~1.7MB) |

**Key session file:** `~/.local/share/opencode/opencode.db` — SQLite database. harnessctl queries the `sessions` table for the most recently updated session matching the run's timeframe to extract session ID, cost, and token counts.

---

## Gemini (`gemini`)

| File / Directory | Path Pattern | Format | Mode | Contents |
|---|---|---|---|---|
| Chat history | `~/.gemini/tmp/<project-hash>/chats/session-<ts>-<id>.json` | JSON | Both | Full conversation: messages, timestamps, token usage, model |
| Event log | `~/.gemini/tmp/<project-hash>/logs.json` | JSON | Both | Session events with user messages and timestamps |
| Settings | `~/.gemini/settings.json` | JSON | Both | OAuth type, MCP server config |
| Google accounts | `~/.gemini/google_accounts.json` | JSON | Both | Active/historical Google account info |
| OAuth creds | `~/.gemini/oauth_creds.json` | JSON | Both | Access/refresh/ID tokens, scope, expiry |
| Installation ID | `~/.gemini/installation_id` | Text | Once | Unique UUID |
| Bundled ripgrep | `~/.gemini/tmp/bin/rg` | Binary | Both | ripgrep for file searching |
| Native memory file | `<cwd>/GEMINI.md` | Markdown | Both | Project instructions (harnessctl syncs context here) |

**Key session file:** `~/.gemini/tmp/<project-hash>/chats/session-<ts>-<id>.json` — single JSON file per session. Contains the full conversation with messages array, token usage, and model info.

---

## Cursor Agent (`cursor-agent`)

| File / Directory | Path Pattern | Format | Mode | Contents |
|---|---|---|---|---|
| Session transcript | `~/.cursor-agent/sessions/<workspace-id>/<session-id>.jsonl` | JSONL | Both | Message history: user/assistant turns, token usage |
| Compile cache | `~/Library/Caches/cursor-compile-cache/` | Bytecode | Both | Node.js startup cache |
| Native memory file | `<cwd>/.cursorrules` | Text | Both | Project rules/context (harnessctl syncs context here) |

**Key session file:** `~/.cursor-agent/sessions/<workspace-id>/<session-id>.jsonl` — JSONL transcript file. harnessctl discovers sessions by file modification time.

---

## Summary: Session File Formats

| Agent | Session Storage | Format | Discovery Method |
|---|---|---|---|
| Claude | `~/.claude/projects/<hash>/<uuid>.jsonl` | JSONL | Session ID from stdout → find in project dirs |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | JSONL | Newest rollout file modified after run start |
| OpenCode | `~/.local/share/opencode/opencode.db` | SQLite | Query sessions table by timestamp |
| Gemini | `~/.gemini/tmp/<hash>/chats/session-*.json` | JSON | Newest chat file modified after run start |
| Cursor | `~/.cursor-agent/sessions/<ws>/<id>.jsonl` | JSONL | Newest session file modified after run start |
