---
layout: home
hero:
  name: harnessctl
  text: Universal CLI for coding agents
  tagline: One command, any agent. Stop juggling CLIs.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/mnvsk97/harnessctl
features:
  - title: One interface
    details: Same command whether you're running Claude Code, Codex, OpenCode, or any CLI agent.
  - title: Auto-failover
    details: Agent hits a rate limit? harnessctl silently hands off to the next one with the full conversation attached.
  - title: Cross-agent handoff
    details: Hand off any run to a different agent by ID. The target gets a lean prompt with summary, changed files, and a context pointer.
  - title: Full observability
    details: Every run is logged — agent, prompt, result, cost, tokens, duration. Session chains are fully traceable.
  - title: Run or shell
    details: One-shot headless prompts with full capture, or launch the agent's native interactive REPL.
  - title: Zero lock-in
    details: Add any new agent with a YAML file. No code changes, no waiting for releases.
---
