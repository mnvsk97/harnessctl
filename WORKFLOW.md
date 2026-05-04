---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: "REPLACE_WITH_LINEAR_PROJECT_SLUG"
  assignee: me
  active_states:
    - Todo
    - In Progress
    - Rework
    - Merging
  terminal_states:
    - Closed
    - Cancelled
    - Canceled
    - Duplicate
    - Done
polling:
  interval_ms: 15000
workspace:
  root: ~/code/symphony-workspaces/harnessctl
hooks:
  after_create: |
    git clone git@github.com:mnvsk97/harnessctl.git .
    git config rerere.enabled true
    git config rerere.autoupdate true
    if command -v bun >/dev/null 2>&1; then
      bun install
    fi
  before_run: |
    git config rerere.enabled true
    git config rerere.autoupdate true
    if [ ! -d node_modules ] && command -v bun >/dev/null 2>&1; then
      bun install
    fi
  timeout_ms: 300000
agent:
  max_concurrent_agents: 2
  max_turns: 16
  max_retry_backoff_ms: 300000
  max_concurrent_agents_by_state:
    todo: 1
    in progress: 2
    rework: 1
    merging: 1
codex:
  command: codex --config shell_environment_policy.inherit=all --config model_reasoning_effort=xhigh app-server
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite
    writableRoots:
      - /Users/saikrishna/code/symphony-workspaces/harnessctl
    readOnlyAccess:
      type: fullAccess
    networkAccess: true
    excludeTmpdirEnvVar: false
    excludeSlashTmp: false
  turn_timeout_ms: 7200000
  read_timeout_ms: 5000
  stall_timeout_ms: 600000
observability:
  dashboard_enabled: true
  refresh_ms: 1000
  render_interval_ms: 16
server:
  host: 127.0.0.1
---

You are working on Linear ticket `{{ issue.identifier }}` for the `harnessctl`
repository.

{% if attempt %}
Continuation context:

- This is retry attempt #{{ attempt }} because the ticket is still in an active
  state.
- Resume from the current workspace and branch state. Do not restart completed
  investigation or validation unless new edits make that necessary.
{% endif %}

Issue context:

- Identifier: {{ issue.identifier }}
- Title: {{ issue.title }}
- Current status: {{ issue.state }}
- Labels: {{ issue.labels }}
- URL: {{ issue.url }}
- Tracker branch hint: {{ issue.branch_name }}
- Blockers: {{ issue.blocked_by }}

Description:

{% if issue.description %}
{{ issue.description }}
{% else %}
No description provided.
{% endif %}

## Operating Posture

This is an unattended Symphony run. Work autonomously inside the provided
workspace and stop only for a true external blocker such as missing required
authentication, unavailable secrets, or an inaccessible required service.

Never modify files outside the repository copy. Treat uncommitted changes as
user or earlier-agent work until you understand them. Do not discard or reset
work unless it is yours and the workflow requires it.

Start by reading the repository guidance:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `CONTRIBUTING.md`

Use the repo-local skills when relevant:

- `linear`: read and update Linear through Symphony's `linear_graphql` tool.
- `pull`: merge latest `origin/main` into the active branch.
- `commit`: create clean commits.
- `push`: publish the branch and create or update the PR.
- `land`: when the ticket is in `Merging`, shepherd the PR until merged.
- `debug`: investigate Symphony run failures or stalls.

## Status Routing

1. Fetch the Linear issue by `{{ issue.identifier }}` and confirm its current
   status before editing anything.
2. Route by status:
   - `Todo`: move it to `In Progress`, create or refresh the workpad, and start
     execution.
   - `In Progress`: continue implementation from the current workpad and branch.
   - `Rework`: collect all reviewer feedback, update the workpad, and perform
     the requested changes. Move back to `In Progress` only if the team's Linear
     workflow requires that for active work.
   - `Human Review`: do not make code changes. Check for fresh feedback, record
     a concise note if needed, and stop.
   - `Merging`: run the `land` skill until the PR is merged, then move the issue
     to `Done`.
   - `Done`, `Closed`, `Cancelled`, `Canceled`, `Duplicate`: terminal states.
     Do no work.
3. If the issue has active blockers, do not start implementation. Record the
   blocker in the workpad and leave the issue in its current nonterminal state.

## Workpad Contract

Use one persistent Linear comment headed exactly:

```md
## Symphony Workpad
```

Reuse the active unresolved workpad if it exists. Do not create separate status
comments. Keep the workpad current throughout the run with:

- Environment stamp: `<host>:<absolute-workdir>@<short-sha>`.
- Plan: short checklist with the current execution path.
- Acceptance Criteria: user-visible and technical outcomes from the ticket.
- Validation: exact commands or manual checks required and their latest result.
- Notes: reproduction signals, assumptions, links, and blockers.
- Confusions: only when something materially unclear affected execution.

Before writing code, update the workpad with the plan, acceptance criteria,
validation plan, and a concrete reproduction or baseline signal.

## Branch And Git Policy

1. Inspect `git status`, current branch, remotes, and `HEAD`.
2. Do not work directly on `main`.
3. If the issue has a usable branch hint, use it. Otherwise create a branch from
   latest `origin/main` named `symphony/<issue-identifier>-<short-slug>`.
4. Run the `pull` skill before substantive edits.
5. Keep commits logical and reviewable. Use the `commit` skill when preparing a
   commit.
6. If an existing PR is attached:
   - If it is open, continue on that branch after syncing.
   - If it is closed or merged, create a fresh branch from `origin/main`.
7. Do not push until required validation for the current change has passed.

## Implementation Rules

- Prefer the existing TypeScript, Bun, and small-dependency style.
- Keep runtime dependencies near zero unless the ticket explicitly justifies a
  new dependency.
- Preserve harnessctl's adapter boundary: adapter behavior belongs in
  `src/adapters/`, command behavior in `src/commands/`, shared runtime behavior
  in `src/lib/`.
- Add or update tests with the changed behavior. Use the nearby test style.
- For CLI output changes, check both human-facing text and machine-parseable
  behavior where applicable.
- For docs changes, keep examples executable and aligned with the current CLI.
- For release or publish workflow changes, inspect `.github/workflows/` and
  validate assumptions against the workflow trigger paths.

## Validation Policy

Choose focused validation first, then run the full gate before handoff when code
changed.

Required gates:

- Any TypeScript or CLI behavior change: `bun test` and `bun run typecheck`.
- Entry point, packaging, install, or npm behavior change: `bun run bundle`.
- Fallback, session, handoff, or shell behavior change: run the relevant
  simulation script under `test/`.
- Docs-only change: inspect rendered Markdown mentally and run no code gate
  unless examples or generated artifacts changed.

Record every validation command and result in the workpad. If a required check
cannot run, explain the exact blocker and what evidence was gathered instead.

## PR And Review Flow

1. Use the `push` skill to publish the branch and create or update the PR.
2. Add the `symphony` label to the PR when GitHub permissions allow it.
3. PR body must include:
   - Summary
   - Validation
   - Risks or rollout notes
4. Link the PR to the Linear issue using a GitHub PR attachment when possible.
5. Before moving to `Human Review`, sweep all PR feedback:
   - Top-level PR comments.
   - Inline review comments.
   - Review summaries.
   - CI/check results.
6. Treat actionable feedback as blocking until fixed or explicitly answered with
   a justified pushback.
7. Move the issue to `Human Review` only after the PR is pushed, validation is
   recorded, checks are green or intentionally explained, and the workpad
   reflects the final state.

Final response for the Symphony run should be short: completed actions,
validation, PR link, and blockers only.
