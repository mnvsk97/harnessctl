# Example notebooks

The example notebooks are command walkthroughs for common harnessctl workflows. They use shell cells and keep dependencies out of the repo.

## Notebooks

- [Quickstart handoff](../examples/notebooks/01-quickstart-handoff.ipynb): start with Codex, hand off to Claude Code, then inspect logs.
- [Compare and judge](../examples/notebooks/02-compare-and-judge.ipynb): compare Codex and Claude Code, ask a judge agent, then inspect the report.
- [Pipelines and fallback](../examples/notebooks/03-pipelines-and-failover.ipynb): run a sequential pipeline and configure fallback basics.

Run them from disposable git repos. The notebooks create `/tmp/harnessctl-notebook-*` fixtures so users do not need to point agents at a real project while learning.
