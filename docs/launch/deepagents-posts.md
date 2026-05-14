# DeepAgents harnessctl launch posts

## LinkedIn

I added DeepAgents CLI support to harnessctl.

harnessctl can now run Claude Code, Codex, DeepAgents, Gemini, Cursor, OpenCode, and custom agents behind one consistent interface.

The DeepAgents adapter uses the CLI's non-interactive stdin mode, supports model and resume flags, captures summaries, tracks thread/session context, and writes handoff pointers so another agent can pick up the work.

```bash
harnessctl run --agent deepagents "fix the failing tests"
harnessctl run --agent deepagents "continue that change" --resume
harnessctl run --agent deepagents -- --agent backend-dev
```

I also added docs, changelog notes, unit tests, a deterministic fake-binary end-to-end smoke test, and a credential-gated live smoke test for provider-backed verification.

The broader idea: coding agents should be interchangeable at the workflow layer. Start with one, compare with another, hand off when needed, and fail over when auth, rate, or context limits get in the way.

## X / Twitter

### Single post

Added DeepAgents CLI support to harnessctl.

One workflow layer now runs Claude Code, Codex, DeepAgents, Gemini, Cursor, OpenCode, and custom agents:

`harnessctl run --agent deepagents "fix the failing tests"`

Run, resume, handoff, compare, failover.

### Thread

1/ Added DeepAgents CLI support to harnessctl.

2/ harnessctl now gives Claude Code, Codex, DeepAgents, Gemini, Cursor, OpenCode, and custom agents the same workflow layer.

3/ The DeepAgents adapter uses non-interactive stdin mode, supports model/resume flags, captures summaries, and writes handoff pointers.

4/ Example:
`harnessctl run --agent deepagents "fix the failing tests"`

5/ The point: agents should be interchangeable at the workflow layer. Run, resume, handoff, compare, and fail over without rebuilding your process.
