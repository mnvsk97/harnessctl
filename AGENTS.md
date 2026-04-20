# Agent Collaboration via cmux

This document defines the inter-agent communication protocol for harnessctl, enabling Claude Code, Codex, OpenCode, Gemini, Cursor, and other agents to communicate directly via [cmux](https://ghostty.org) (Ghostty terminal multiplexer).

## Prerequisites

- cmux installed and available on `$PATH` (`cmux -h` to verify)
- Each agent running in its own Ghostty surface/tab
- Agents share the same project working directory

## Setup: Discovering Your Surface ID

On session start, each agent should identify itself:

```bash
# List all active surfaces/panes
cmux surfaces

# Your surface ID is in $CMUX_SURFACE (auto-wired by cmux)
echo $CMUX_SURFACE

# Or read from the workspace env
cmux env
```

After discovering surface IDs, update the **Active Surfaces** section at the bottom of this file so other agents can address you.

## XML Message Protocol

All inter-agent messages use this envelope:

```xml
<message
  from="<agent-name>"
  to="<agent-name>"
  surface="<target-surface-id>"
  type="<request|response|notify|handoff>"
  id="<short-uuid>"
  ref="<id-of-message-being-replied-to>"
>
  <context>
    <!-- Task description, relevant files, or background -->
  </context>
  <body>
    <!-- Main request, question, or result -->
  </body>
  <diff>
    <!-- Optional: git diff or code snippet -->
  </diff>
  <next>
    <!-- Optional: suggested next action for the recipient -->
  </next>
</message>
```

### Message Types

| Type | Usage |
|------|-------|
| `request` | Ask another agent to do work |
| `response` | Reply to a prior request (use `ref=` to link) |
| `notify` | One-way status update, no reply expected |
| `handoff` | Transfer ownership of a task (equivalent to `harnessctl handoff`) |

### Required vs Optional Fields

- **Required:** `from`, `to`, `type`, `id`, `<body>`
- **Optional:** `surface` (omit if broadcasting), `ref` (only on replies), `<context>`, `<diff>`, `<next>`

## Sending a Message

Use `cmux send-keys` to deliver a message to another agent's pane:

```bash
# Send to a specific surface
cmux send-keys --surface <target-surface-id> "<message>..."

# Or write to a shared file the other agent polls (fallback)
echo '<message ...>...</message>' >> .harnessctl/agent-inbox/<agent-name>.xml
```

### Recommended: Shared Inbox Files

For reliability across terminal layouts, each agent watches its own inbox file:

```
.harnessctl/
  agent-inbox/
    claude.xml       # Claude Code reads this
    codex.xml        # Codex reads this
    opencode.xml
    gemini.xml
    cursor.xml
```

To send a message to Claude:
```bash
cat >> .harnessctl/agent-inbox/claude.xml << 'EOF'
<message from="codex" to="claude" type="request" id="abc12345">
  <context>Working on src/invoke.ts, added retry logic in branch feat/retry</context>
  <body>Please review the error handling in the new retryWithBackoff() function and suggest improvements.</body>
  <diff>
    --- a/src/invoke.ts
    +++ b/src/invoke.ts
    @@ ... @@
    +async function retryWithBackoff(...) { ... }
  </diff>
  <next>Reply with a response message in .harnessctl/agent-inbox/codex.xml</next>
</message>
EOF
```

## Message Examples

### Codex → Claude: Code Review Request

```xml
<message from="codex" to="claude" type="request" id="req-001">
  <context>Implementing auto-failover in src/commands/run.ts, branch feat/failover</context>
  <body>
    I've added silent failover on rate_limit exits. Can you check that the
    transcript extraction in buildTranscriptBlock() will correctly handle
    the Codex JSONL format before I commit?
  </body>
  <next>Reply in .harnessctl/agent-inbox/codex.xml with a response message</next>
</message>
```

### Claude → Codex: Response

```xml
<message from="claude" to="codex" type="response" id="res-002" ref="req-001">
  <body>
    Reviewed buildTranscriptBlock(). The JSONL parsing looks correct for Codex
    rollout format. One issue: the role field in older rollouts uses "system"
    not "assistant" — filter those out or you'll get duplicated context blocks.
    Specific line: src/lib/transcript.ts:47.
  </body>
  <next>Fix transcript.ts:47 then proceed with commit</next>
</message>
```

### Claude → Gemini: Task Handoff

```xml
<message from="claude" to="gemini" type="handoff" id="hnd-003">
  <context>
    Completed: refactored src/adapters/claude.ts — session discovery now uses
    discoverSession() scanning ~/.claude/projects/. Run ID: run-8f3a2b1c.
  </context>
  <body>
    Please take over and add the same discoverSession() pattern to gemini.ts.
    Reference the claude.ts implementation. The harnessctl handoff file is at
    .harnessctl/handoffs/run-8f3a2b1c.md for full context.
  </body>
  <next>Read .harnessctl/handoffs/run-8f3a2b1c.md, then implement discoverSession() in src/adapters/gemini.ts</next>
</message>
```

## cmux Capabilities Reference

Beyond basic messaging, cmux exposes these features agents can use:

```bash
# Progress tracking (0.0–1.0) — great for long tasks
cmux progress 0.5 "Running tests..."
cmux progress 1.0 "Done"

# Structured logs (levels: info, warn, error, debug)
cmux log info claude "Starting code review of src/invoke.ts"
cmux log error codex "Auth check failed, requesting handoff"

# Native notifications
cmux notify --title "Codex" --body "PR ready for Claude review" --subtitle "harnessctl"

# Open markdown in live-reload viewer
cmux markdown .harnessctl/handoffs/run-8f3a2b1c.md

# Read another pane's screen content (for ad-hoc checks)
cmux capture --surface <surface-id>

# Create a new tab and start an agent
cmux new-tab --title "gemini" -- harnessctl shell --agent gemini

# Wire Claude session events into the UI
cmux claude-hook session-start
cmux claude-hook session-stop
```

## Coordination Workflow

1. **Human kicks off task** — opens surfaces for each agent, runs `cmux surfaces` to note IDs
2. **Lead agent starts work** — e.g., Claude begins implementation, Codex handles tests in parallel
3. **Agents communicate via inbox files** — structured XML keeps context intact across turns
4. **Blocked? Use `handoff` type** — or run `harnessctl handoff <run-id> --agent <name> "<prompt>"` for a formal hand-off with full context file
5. **Progress visible to human** — `cmux progress` and `cmux log` feed into the sidebar without interrupting agents
6. **Human intervenes only for high-level decisions** — agents resolve implementation details themselves

## Adding More Agents

To extend this protocol to a new agent:

1. Create `.harnessctl/agent-inbox/<agent-name>.xml` (touch the file)
2. Add the agent's surface ID to the **Active Surfaces** table below
3. Instruct the new agent: *"Read your inbox at `.harnessctl/agent-inbox/<your-name>.xml`. Reply using the XML protocol defined in AGENTS.md."*
4. If the agent has a harnessctl adapter (`src/adapters/<agent>.ts`), its `memoryFile` is already pointed at `AGENTS.md` — it will see this document automatically on next `harnessctl run`

## Active Surfaces

Update this table each session after running `cmux surfaces`:

| Agent | Surface ID | Status | Notes |
|-------|-----------|--------|-------|
| claude | _discover via `echo $CMUX_SURFACE`_ | — | Primary reviewer |
| codex | _discover via `echo $CMUX_SURFACE`_ | — | Implementation |
| opencode | — | inactive | |
| gemini | — | inactive | Long-context tasks |
| cursor | — | inactive | IDE-integrated tasks |

## Notes

- Inbox XML files are append-only during a session; truncate between sessions
- `.harnessctl/` is auto-added to `.gitignore` by harnessctl — inbox files won't be committed
- If cmux is unavailable (e.g., non-Ghostty terminal), use inbox files alone — they work without cmux
- Keep `<body>` focused: one clear ask per message. Split large tasks into sequential messages
- Always include `<next>` when you want a reply — it removes ambiguity about expected action
