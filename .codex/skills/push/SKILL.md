---
name: push
description: Push the current branch and create or update the pull request.
---

# Push

## Prerequisites

- `gh` CLI is installed and authenticated.
- The current branch is not `main`.
- Required validation for the changed scope has passed.

## Steps

1. Inspect branch, status, and latest commit:
   - `git status --short --branch`
   - `git log -1 --oneline`
2. Run required validation:
   - Code changes: `bun test` and `bun run typecheck`
   - Packaging or entrypoint changes: also `bun run bundle`
   - Fallback, shell, handoff, or session changes: relevant script under `test/`
3. Push with upstream tracking:
   - `git push -u origin HEAD`
4. If push is rejected because the branch is stale, run the `pull` skill, repeat
   validation, then push again.
5. Create or update the PR:
   - `gh pr view` to detect an existing PR.
   - `gh pr create` when none exists.
   - `gh pr edit` when title or body no longer matches the branch.
6. Use this PR body shape:

```md
## Summary
- ...

## Validation
- [x] `bun test`
- [x] `bun run typecheck`

## Risks / Rollout
- ...
```

7. Add the `symphony` label when permitted:
   - `gh label create symphony --color 5319e7 --description "Managed by Symphony" || true`
   - `gh pr edit --add-label symphony`
8. Link the PR to Linear using the `linear` skill when the tool is available.
9. Record the PR URL, validation, and any CI caveats in the workpad.

## Notes

- Do not use `--force`; use `--force-with-lease` only after an intentional local
  history rewrite.
- Do not change remotes as a workaround for auth failure. Surface the exact
  failure in the workpad.
