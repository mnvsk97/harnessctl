#!/bin/bash
#
# Live smoke test for the built-in DeepAgents adapter.
#
# This test requires a real DeepAgents install. When provider credentials are
# configured via DeepAgents /auth, the shell, project .env, ~/.deepagents/.env,
# ~/.harnessctl/.env, project .harnessctl/.env, or
# ~/.harnessctl/agents/deepagents.yaml env, it uses that configuration. When no
# credentials are configured, it runs the real CLI with a temporary local
# class_path chat model so the harnessctl subprocess path is still exercised
# end to end without external secrets or network calls.
#
# Usage: bash test/real-deepagents-smoke.sh
# Requires: bun, deepagents
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TMP_DIR=""

cleanup() {
  if [ -n "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

has_env_key() {
  [ -n "${DEEPAGENTS_CLI_OPENAI_API_KEY:-}" ] ||
    [ -n "${OPENAI_API_KEY:-}" ] ||
    [ -n "${DEEPAGENTS_CLI_ANTHROPIC_API_KEY:-}" ] ||
    [ -n "${ANTHROPIC_API_KEY:-}" ] ||
    [ -n "${DEEPAGENTS_CLI_GOOGLE_API_KEY:-}" ] ||
    [ -n "${GOOGLE_API_KEY:-}" ] ||
    [ -n "${DEEPAGENTS_CLI_GOOGLE_CLOUD_PROJECT:-}" ] ||
    [ -n "${GOOGLE_CLOUD_PROJECT:-}" ]
}

has_env_file_key() {
  local env_file="$1"
  [ -f "$env_file" ] || return 1
  grep -Eq '^[[:space:]]*(DEEPAGENTS_CLI_)?(OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|GOOGLE_CLOUD_PROJECT)[[:space:]]*=[[:space:]]*[^[:space:]#]+' "$env_file"
}

has_agent_yaml_key() {
  local config_file="$1"
  [ -f "$config_file" ] || return 1
  grep -Eq '^[[:space:]]*(DEEPAGENTS_CLI_)?(OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|GOOGLE_CLOUD_PROJECT)[[:space:]]*:[[:space:]]*[^[:space:]#]+' "$config_file"
}

has_stored_auth_key() {
  local auth_file="$1"
  [ -f "$auth_file" ] || return 1
  AUTH_FILE="$auth_file" bun --eval '
    const fs = require("fs");
    try {
      const parsed = JSON.parse(fs.readFileSync(process.env.AUTH_FILE, "utf8"));
      const credentials = parsed && parsed.version === 1 && parsed.credentials;
      const ok = credentials && typeof credentials === "object" && !Array.isArray(credentials) &&
        Object.values(credentials).some((entry) => entry && typeof entry === "object" && entry.type === "api_key" && typeof entry.key === "string" && entry.key.trim());
      process.exit(ok ? 0 : 1);
    } catch {
      process.exit(1);
    }
  ' >/dev/null 2>&1
}

require_help_option() {
  local help_output="$1"
  local option="$2"
  if ! echo "$help_output" | grep -q -- "$option"; then
    echo "FAIL: installed deepagents CLI does not advertise $option" >&2
    exit 1
  fi
}

run_harness_smoke() {
  bun run "$PROJECT_DIR/src/cli.ts" run \
    --agent deepagents \
    "Reply with exactly: deepagents harnessctl smoke ok" \
    -- --max-turns 2
}

if ! command -v deepagents >/dev/null 2>&1; then
  echo "FAIL: deepagents is not installed" >&2
  exit 1
fi

help_output="$(deepagents --help)"
require_help_option "$help_output" "--stdin"
require_help_option "$help_output" "--auto-approve"
require_help_option "$help_output" "--shell-allow-list"
require_help_option "$help_output" "--quiet"
require_help_option "$help_output" "--no-stream"
require_help_option "$help_output" "--model"
require_help_option "$help_output" "--resume"

threads_output="$(deepagents threads list --limit 1 --sort updated --json)"
if ! echo "$threads_output" | grep -q '"command": "threads list"'; then
  echo "FAIL: deepagents threads list --json did not return the expected envelope" >&2
  echo "$threads_output" >&2
  exit 1
fi

if has_env_key ||
  has_stored_auth_key "$HOME/.deepagents/.state/auth.json" ||
  has_env_file_key "$PROJECT_DIR/.env" ||
  has_env_file_key "$HOME/.deepagents/.env" ||
  has_env_file_key "$HOME/.harnessctl/.env" ||
  has_env_file_key "$PROJECT_DIR/.harnessctl/.env" ||
  has_agent_yaml_key "$HOME/.harnessctl/agents/deepagents.yaml"
then
  output="$(run_harness_smoke)"
else
  TMP_DIR="$(mktemp -d)"
  mkdir -p "$TMP_DIR/home/.deepagents" "$TMP_DIR/work"

  cat > "$TMP_DIR/fake_model.py" <<'PY'
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult


class SmokeChatModel(BaseChatModel):
    @property
    def _llm_type(self) -> str:
        return "harnessctl-smoke"

    def bind_tools(self, tools, *, tool_choice=None, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs: Any) -> ChatResult:
        return ChatResult(
            generations=[
                ChatGeneration(message=AIMessage(content="deepagents harnessctl smoke ok"))
            ]
        )
PY

  cat > "$TMP_DIR/home/.deepagents/config.toml" <<'TOML'
[models]
default = "harnessctl_smoke:smoke"

[models.providers.harnessctl_smoke]
models = ["smoke"]
class_path = "fake_model:SmokeChatModel"

[warnings]
suppress = ["tavily"]
TOML

  output="$(
    cd "$TMP_DIR/work"
    HOME="$TMP_DIR/home" \
      PYTHONPATH="$TMP_DIR" \
      DEEPAGENTS_CLI_OPENAI_API_KEY="sk-harnessctl-local-smoke" \
      run_harness_smoke
  )"
fi

if ! has_env_key &&
  ! has_stored_auth_key "$HOME/.deepagents/.state/auth.json" &&
  ! has_env_file_key "$PROJECT_DIR/.env" &&
  ! has_env_file_key "$HOME/.deepagents/.env" &&
  ! has_env_file_key "$HOME/.harnessctl/.env" &&
  ! has_env_file_key "$PROJECT_DIR/.harnessctl/.env" &&
  ! has_agent_yaml_key "$HOME/.harnessctl/agents/deepagents.yaml"
then
  echo "INFO: no DeepAgents provider credentials found; used temporary local class_path model"
fi

echo "$output"

if ! echo "$output" | grep -q "deepagents harnessctl smoke ok"; then
  echo "FAIL: DeepAgents live smoke output did not contain expected response" >&2
  exit 1
fi

echo "PASS: DeepAgents live adapter smoke test"
