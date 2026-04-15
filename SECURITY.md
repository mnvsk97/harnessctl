# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in harnessctl, please report it responsibly.

**Do not open a public issue.** Instead, email the maintainer or use GitHub's private security advisory feature.

## Scope

harnessctl shells out to coding agent CLIs. It passes user-provided prompts to subprocess stdin and forwards agent-specific flags. Security considerations:

- **Subprocess execution**: harnessctl spawns agent CLIs as child processes. It does not execute arbitrary commands from prompts.
- **Environment variables**: Agent YAML configs can reference env vars via `${VAR}` syntax. These are resolved from the user's shell environment only.
- **State directory**: Session data and run logs are stored in `~/.harnessctl/`. These may contain prompts and agent output summaries.
- **No network access**: harnessctl itself makes no network requests. Network access is handled entirely by the agent CLIs it invokes.

## Supported versions

Only the latest release is supported with security updates.
