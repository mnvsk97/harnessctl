---
name: debug
description: Investigate Symphony run failures, stalls, and retry loops.
---

# Debug Symphony Runs

## Log Sources

- Symphony runtime logs normally live under the Symphony service directory:
  `log/symphony.log` and rotated `log/symphony.log*`.
- Workspaces are under the configured `workspace.root` in `WORKFLOW.md`.

## Correlation Keys

- `issue_identifier`: Linear key, for example `HC-123`.
- `issue_id`: Linear internal UUID.
- `session_id`: Codex app-server thread and turn id.

## Triage

1. Search logs by ticket key:
   - `rg -n "issue_identifier=<KEY>" log/symphony.log*`
2. Extract session ids:
   - `rg -o "session_id=[^ ;]+" log/symphony.log* | sort -u`
3. Trace one session:
   - `rg -n "session_id=<SESSION>" log/symphony.log*`
4. Classify the failure:
   - app-server startup failure
   - turn timeout
   - stall timeout
   - hook failure
   - Linear API or auth failure
   - GitHub auth or push failure
5. Record exact evidence and the smallest required fix in the workpad.

Prefer narrow log slices. Do not delete workspaces while debugging unless the
issue is terminal or the user explicitly asked for cleanup.
