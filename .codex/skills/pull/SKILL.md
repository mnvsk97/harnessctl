---
name: pull
description: Merge latest origin/main into the current branch and resolve conflicts.
---

# Pull

Use this skill before substantive implementation work and whenever a push is
rejected because the remote branch or `origin/main` moved.

## Steps

1. Inspect `git status --short --branch`.
2. If local changes exist, commit them with the `commit` skill or stop and
   explain why they cannot be safely staged yet.
3. Enable rerere locally:
   - `git config rerere.enabled true`
   - `git config rerere.autoupdate true`
4. Fetch latest refs:
   - `git fetch origin`
5. If the current branch has an upstream, fast-forward from it:
   - `git pull --ff-only`
6. Merge `origin/main`:
   - `git -c merge.conflictstyle=zdiff3 merge origin/main`
7. Resolve conflicts by understanding both sides first. Preserve behavior and
   public CLI contracts unless the ticket clearly requires a change.
8. After resolving, run:
   - `git diff --check`
   - the validation relevant to the changed files
9. Record the merge result and validation in the Linear workpad.

## Conflict Guidance

- Prefer minimal, intention-preserving resolutions.
- Use `git diff --merge` and staged-base comparisons before choosing a side.
- For generated output, resolve source files first and regenerate.
- If product intent is genuinely ambiguous, document the ambiguity in the
  workpad and stop instead of guessing.
