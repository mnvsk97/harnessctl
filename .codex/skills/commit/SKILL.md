---
name: commit
description: Stage intended changes and create a clean git commit.
---

# Commit

## Steps

1. Inspect `git status --short`, `git diff`, and `git diff --staged`.
2. Stage only the intended files. Do not include unrelated user changes,
   generated build output, `node_modules/`, `.harnessctl/`, or local binaries.
3. Review newly added files before committing.
4. Choose a concise conventional subject, for example:
   - `feat(adapter): add cursor session recovery`
   - `fix(run): preserve fallback transcript`
   - `docs: clarify setup command`
5. Include a commit body with:
   - Summary
   - Rationale
   - Validation
6. Add `Co-authored-by: Codex <codex@openai.com>` unless instructed otherwise.
7. Use `git commit -F <message-file>` so line breaks are literal.

## Message Template

```text
<type>(<scope>): <short imperative summary>

Summary:
- <what changed>

Rationale:
- <why this approach>

Validation:
- <command and result>

Co-authored-by: Codex <codex@openai.com>
```
