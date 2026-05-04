---
name: land
description: Shepherd an approved PR through checks and merge.
---

# Land

Use this only when the Linear issue is in `Merging`.

## Steps

1. Confirm the working tree is clean and the current branch has an open PR.
2. Inspect PR status:
   - `gh pr view --json number,title,body,mergeable,reviewDecision,url`
   - `gh pr checks`
3. If local changes exist, commit with the `commit` skill and publish with the
   `push` skill.
4. If the PR conflicts with `main`, run the `pull` skill, validate, and push.
5. Sweep review feedback:
   - top-level PR comments
   - inline review comments
   - review summaries
6. Address or explicitly answer every actionable item before merging.
7. Wait for checks to complete. If checks fail, inspect logs, fix, validate,
   commit, and push.
8. Squash merge when checks are green and feedback is resolved:
   - `gh pr merge --squash --subject "$PR_TITLE" --body "$PR_BODY"`
9. Move the Linear issue to `Done` and update the workpad with merge evidence.

## Guardrails

- Do not enable auto-merge.
- Do not merge while human review comments are unresolved.
- If a failure is external and cannot be fixed in-session, document the exact
  blocker in the workpad and leave the issue in `Merging`.
