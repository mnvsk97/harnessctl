#!/bin/bash
#
# End-to-end simulation test for the built-in DeepAgents adapter.
# Uses a fake deepagents binary so the harnessctl subprocess path can be
# verified without live LLM credentials or network access.
#
# Usage: bash test/sim-deepagents.sh
# Requires: bun
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d)"
FAKE_BIN="$TMP_DIR/bin"
FAKE_HOME="$TMP_DIR/home"
WORK_DIR="$TMP_DIR/work"
CALL_LOG="$TMP_DIR/deepagents-calls.log"
STDIN_LOG="$TMP_DIR/deepagents-stdin.log"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$FAKE_BIN" "$FAKE_HOME" "$WORK_DIR"
mkdir -p "$FAKE_HOME/.deepagents/.state"
printf 'fake sqlite placeholder\n' > "$FAKE_HOME/.deepagents/.state/sessions.db"

cat > "$FAKE_BIN/deepagents" <<'SH'
#!/bin/sh
set -eu

printf '%s\n' "$*" >> "$DEEPAGENTS_FAKE_CALL_LOG"

if [ "${1:-}" = "--version" ]; then
  echo "deepagents-cli fake"
  exit 0
fi

if [ "${1:-}" = "threads" ]; then
  echo '{"schema_version":1,"command":"threads list","data":[{"thread_id":"fake-thread-1"}]}'
  exit 0
fi

input="$(cat)"
printf '%s\n' "$input" > "$DEEPAGENTS_FAKE_STDIN_LOG"
echo "fake deepagents saw: $input"
SH
chmod +x "$FAKE_BIN/deepagents"

run_harnessctl() {
  HOME="$FAKE_HOME" \
  PATH="$FAKE_BIN:$PATH" \
  DEEPAGENTS_FAKE_CALL_LOG="$CALL_LOG" \
  DEEPAGENTS_FAKE_STDIN_LOG="$STDIN_LOG" \
    bun run "$PROJECT_DIR/src/cli.ts" "$@"
}

cd "$WORK_DIR"
mkdir -p "$WORK_DIR/.harnessctl"
printf 'DEEPAGENTS_CLI_OPENAI_API_KEY=sk-test\n' > "$WORK_DIR/.harnessctl/.env"

echo "======================================="
echo " harnessctl DeepAgents adapter smoke"
echo "======================================="

run_harnessctl config set default deepagents >/dev/null

doctor_output="$(run_harnessctl doctor 2>&1)"
echo "$doctor_output"
if ! echo "$doctor_output" | grep -q "deepagents"; then
  echo "FAIL: doctor did not include deepagents" >&2
  exit 1
fi
if ! echo "$doctor_output" | grep -q "authenticated"; then
  echo "FAIL: doctor did not report DeepAgents auth" >&2
  exit 1
fi

list_output="$(run_harnessctl list 2>&1)"
echo "$list_output"
if ! echo "$list_output" | grep -q "deepagents"; then
  echo "FAIL: list did not include deepagents" >&2
  exit 1
fi

models_output="$(run_harnessctl models --agent deepagents 2>&1)"
echo "$models_output"
if ! echo "$models_output" | grep -q "Available models for deepagents"; then
  echo "FAIL: models did not include DeepAgents heading" >&2
  exit 1
fi
if ! echo "$models_output" | grep -q "anthropic:claude-sonnet-4-6"; then
  echo "FAIL: models did not include expected DeepAgents model" >&2
  exit 1
fi

run_output="$(run_harnessctl run --agent deepagents "say smoke ok" -- --max-turns 2 2>&1)"
echo "$run_output"

if ! echo "$run_output" | grep -q "fake deepagents saw: say smoke ok"; then
  echo "FAIL: harnessctl did not print fake DeepAgents output" >&2
  exit 1
fi

if ! grep -q -- "--stdin --auto-approve --shell-allow-list recommended --quiet --no-stream --max-turns 2" "$CALL_LOG"; then
  echo "FAIL: DeepAgents command args were not mapped as expected" >&2
  echo "Calls:" >&2
  cat "$CALL_LOG" >&2
  exit 1
fi

if [ "$(cat "$STDIN_LOG")" != "say smoke ok" ]; then
  echo "FAIL: prompt was not sent to DeepAgents stdin" >&2
  exit 1
fi

first_run_id="$(echo "$run_output" | sed -n 's/.*run: \([^ ]*-deepagents\).*/\1/p' | head -n 1)"
if [ -z "$first_run_id" ]; then
  echo "FAIL: could not parse first DeepAgents run ID" >&2
  exit 1
fi

compare_output="$(run_harnessctl compare "compare smoke ok" --agents deepagents -- --max-turns 1 2>&1)"
echo "$compare_output"

if ! echo "$compare_output" | grep -q "fake deepagents saw: compare smoke ok"; then
  echo "FAIL: compare did not run DeepAgents through harnessctl" >&2
  exit 1
fi

if ! find "$WORK_DIR/.harnessctl/compare" -type f -name '*-compare.md' | grep -q .; then
  echo "FAIL: expected DeepAgents compare report" >&2
  exit 1
fi

rm "$WORK_DIR/.harnessctl/.env"
cat > "$FAKE_HOME/.harnessctl/agents/deepagents.yaml" <<'YAML'
env:
  DEEPAGENTS_CLI_OPENAI_API_KEY: sk-test-agent-yaml
timeout: 300
model: anthropic:claude-sonnet-4-6
extra_args: []
YAML

resume_output="$(run_harnessctl run --agent deepagents "resume smoke ok" --resume -- --max-turns 1 2>&1)"
echo "$resume_output"

if ! echo "$resume_output" | grep -q "fake deepagents saw: resume smoke ok"; then
  echo "FAIL: resumed harnessctl run did not print fake DeepAgents output" >&2
  exit 1
fi

if ! grep -q -- "--stdin --auto-approve --shell-allow-list recommended --quiet --no-stream --model anthropic:claude-sonnet-4-6 --resume fake-thread-1 --max-turns 1" "$CALL_LOG"; then
  echo "FAIL: DeepAgents model/resume args were not mapped as expected" >&2
  echo "Calls:" >&2
  cat "$CALL_LOG" >&2
  exit 1
fi

if [ "$(cat "$STDIN_LOG")" != "resume smoke ok" ]; then
  echo "FAIL: resumed prompt was not sent to DeepAgents stdin" >&2
  exit 1
fi

handoff_output="$(run_harnessctl handoff "$first_run_id" --agent deepagents --resume "handoff smoke ok" -- --max-turns 1 2>&1)"
echo "$handoff_output"

if ! echo "$handoff_output" | grep -q "fake deepagents saw: handoff smoke ok"; then
  echo "FAIL: handoff did not resume DeepAgents through harnessctl" >&2
  exit 1
fi

if ! grep -q -- "--stdin --auto-approve --shell-allow-list recommended --quiet --no-stream --model anthropic:claude-sonnet-4-6 --resume fake-thread-1 --max-turns 1" "$CALL_LOG"; then
  echo "FAIL: DeepAgents handoff did not map resume args as expected" >&2
  echo "Calls:" >&2
  cat "$CALL_LOG" >&2
  exit 1
fi

pipeline_output="$(run_harnessctl pipeline "pipeline smoke ok" --step deepagents:"summarize briefly" -- --max-turns 1 2>&1)"
echo "$pipeline_output"

if ! echo "$pipeline_output" | grep -q "Pipeline summary:"; then
  echo "FAIL: pipeline did not produce a summary" >&2
  exit 1
fi
if ! echo "$pipeline_output" | grep -q "deepagents:step 1"; then
  echo "FAIL: pipeline did not run the DeepAgents stage" >&2
  exit 1
fi

run_count="$(find "$FAKE_HOME/.harnessctl/runs" -type f -name '*-deepagents.json' | wc -l | tr -d ' ')"
if [ "$run_count" -lt 5 ]; then
  echo "FAIL: expected at least five DeepAgents run logs, found $run_count" >&2
  exit 1
fi

if ! find "$FAKE_HOME/.harnessctl/sessions" -type f -name '*.json' | grep -q .; then
  echo "FAIL: expected harness session files" >&2
  exit 1
fi

handoff_file="$(find "$WORK_DIR/.harnessctl/handoffs" -type f -name '*-deepagents.md' -print -quit 2>/dev/null || true)"
if [ -z "$handoff_file" ] || ! grep -q "$FAKE_HOME/.deepagents/.state/sessions.db" "$handoff_file"; then
  echo "FAIL: expected DeepAgents sessions DB pointer in handoff file" >&2
  exit 1
fi

echo "PASS: DeepAgents adapter smoke test"
