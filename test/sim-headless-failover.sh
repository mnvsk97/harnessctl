#!/bin/bash
#
# End-to-end simulation tests for HEADLESS failover behavior.
# Uses custom agent YAML configs pointing to fake scripts.
#
# Usage: bash test/sim-headless-failover.sh
# Requires: bun
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURES="$SCRIPT_DIR/fixtures"
AGENTS_DIR="$HOME/.harnessctl/agents"

PASS=0
FAIL=0
TOTAL=0

# ── Helpers ──────────────────────────────────────────────

# Backup existing agent configs
backup_agents() {
  for f in fake-ratelimit fake-tokenlimit fake-autherr fake-ok fake-generr; do
    if [ -f "$AGENTS_DIR/$f.yaml" ]; then
      cp "$AGENTS_DIR/$f.yaml" "$AGENTS_DIR/$f.yaml.bak"
    fi
  done
}

restore_agents() {
  for f in fake-ratelimit fake-tokenlimit fake-autherr fake-ok fake-generr; do
    if [ -f "$AGENTS_DIR/$f.yaml.bak" ]; then
      mv "$AGENTS_DIR/$f.yaml.bak" "$AGENTS_DIR/$f.yaml"
    else
      rm -f "$AGENTS_DIR/$f.yaml"
    fi
  done
}
trap restore_agents EXIT

write_agent_yaml() {
  local name="$1" fixture="$2"
  shift 2
  local yaml="cmd: $FIXTURES/$fixture"
  # Remaining args are key: value pairs
  while [ $# -ge 2 ]; do
    yaml="$yaml
$1: $2"
    shift 2
  done
  echo "$yaml" > "$AGENTS_DIR/$name.yaml"
}

run_test() {
  local test_name="$1"
  TOTAL=$((TOTAL + 1))
  echo ""
  echo "── TEST $TOTAL: $test_name ──"
}

pass() {
  PASS=$((PASS + 1))
  echo "  ✓ PASS"
}

fail() {
  FAIL=$((FAIL + 1))
  echo "  ✗ FAIL: $1"
}

# Run harnessctl run in headless mode, capture combined output.
# Stdin is piped from /dev/null so askConfirm returns false.
run_headless() {
  local agent="$1"
  shift
  cd "$PROJECT_DIR"
  local output exit_code=0
  output=$(bun run src/cli.ts run --agent "$agent" "$@" "test prompt" 2>&1 </dev/null) || exit_code=$?
  echo "$output"
  return $exit_code
}

echo "============================================"
echo " harnessctl HEADLESS failover simulation"
echo "============================================"

backup_agents

# ── 1. Rate limit + auto_failover → silent handoff ──────

run_test "Rate limit + auto_failover:true → silent handoff to fallback"

write_agent_yaml fake-ratelimit headless-rate-limit.sh \
  fallback fake-ok \
  auto_failover true \
  failover_transfer summary
write_agent_yaml fake-ok headless-success.sh

output=$(run_headless fake-ratelimit) && exit_code=$? || exit_code=$?
echo "$output" | tail -20

if [ $exit_code -eq 0 ]; then
  if echo "$output" | grep -q "auto-failover"; then
    if echo "$output" | grep -q "fake-ok"; then
      pass
    else
      fail "auto-failover fired but fallback agent name not shown"
    fi
  else
    fail "expected auto-failover message"
  fi
else
  fail "expected exit 0 after auto-failover, got $exit_code"
fi

# ── 2. Token limit + auto_failover → silent handoff ─────

run_test "Token limit + auto_failover:true → silent handoff"

write_agent_yaml fake-tokenlimit headless-token-limit.sh \
  fallback fake-ok \
  auto_failover true \
  failover_transfer summary
write_agent_yaml fake-ok headless-success.sh

output=$(run_headless fake-tokenlimit) && exit_code=$? || exit_code=$?
echo "$output" | tail -20

if [ $exit_code -eq 0 ]; then
  if echo "$output" | grep -q "auto-failover"; then
    pass
  else
    fail "expected auto-failover message"
  fi
else
  fail "expected exit 0, got $exit_code"
fi

# ── 3. Auth error + auto_failover → silent handoff ──────

run_test "Auth error + auto_failover:true → silent handoff"

write_agent_yaml fake-autherr headless-auth-error.sh \
  fallback fake-ok \
  auto_failover true
write_agent_yaml fake-ok headless-success.sh

output=$(run_headless fake-autherr) && exit_code=$? || exit_code=$?
echo "$output" | tail -20

if [ $exit_code -eq 0 ]; then
  if echo "$output" | grep -q "auto-failover"; then
    pass
  else
    fail "expected auto-failover message"
  fi
else
  fail "expected exit 0, got $exit_code"
fi

# ── 4. Rate limit + auto_failover:false → prompts user ──

run_test "Rate limit + no auto_failover → prompts user (declined via /dev/null)"

write_agent_yaml fake-ratelimit headless-rate-limit.sh \
  fallback fake-ok

output=$(run_headless fake-ratelimit) && exit_code=$? || exit_code=$?
echo "$output" | tail -15

if [ $exit_code -ne 0 ]; then
  # Should show the failed message but NOT auto-failover
  if echo "$output" | grep -q "auto-failover"; then
    fail "should NOT auto-failover when auto_failover is not set"
  else
    pass
  fi
else
  fail "expected non-zero exit when prompt is declined (no TTY), got $exit_code"
fi

# ── 5. Rate limit + no auto_failover → accept prompt ────
# NOTE: This test requires a real TTY to interact with askConfirm.
# With piped stdin, askConfirm falls back to /dev/tty which doesn't exist
# in headless test runners. Use test/sim-fallback.sh (expect-based) for
# interactive prompt testing. Here we just verify the prompt IS shown.

run_test "Rate limit + no auto_failover → shows fallback prompt (needs TTY to accept)"

write_agent_yaml fake-ratelimit headless-rate-limit.sh \
  fallback fake-ok

output=$(run_headless fake-ratelimit) && exit_code=$? || exit_code=$?
echo "$output" | tail -15

if echo "$output" | grep -q "Hand off to fake-ok"; then
  pass
else
  fail "fallback prompt not shown"
fi

# ── 6. Generic error + auto_failover → still prompts ────

run_test "Generic error + auto_failover:true → should still prompt (not a limit reason)"

write_agent_yaml fake-generr headless-generic-error.sh \
  fallback fake-ok \
  auto_failover true

output=$(run_headless fake-generr) && exit_code=$? || exit_code=$?
echo "$output" | tail -15

if [ $exit_code -ne 0 ]; then
  if echo "$output" | grep -q "auto-failover"; then
    fail "auto-failover should NOT fire for generic errors"
  else
    pass
  fi
else
  fail "expected non-zero exit for generic error with no TTY, got $exit_code"
fi

# ── 7. No fallback configured → just fails ──────────────

run_test "No fallback configured → exits with error"

write_agent_yaml fake-ratelimit headless-rate-limit.sh

output=$(run_headless fake-ratelimit) && exit_code=$? || exit_code=$?
echo "$output" | tail -10

if [ $exit_code -ne 0 ]; then
  if echo "$output" | grep -q "Hand off\|auto-failover"; then
    fail "should not offer fallback when none configured"
  else
    pass
  fi
else
  fail "expected non-zero exit, got $exit_code"
fi

# ── 8. Fallback chain: A → B → C ────────────────────────

run_test "Chained auto-failover: fake-ratelimit → fake-tokenlimit → fake-ok"

write_agent_yaml fake-ratelimit headless-rate-limit.sh \
  fallback fake-tokenlimit \
  auto_failover true \
  failover_transfer summary
write_agent_yaml fake-tokenlimit headless-token-limit.sh \
  fallback fake-ok \
  auto_failover true \
  failover_transfer summary
write_agent_yaml fake-ok headless-success.sh

output=$(run_headless fake-ratelimit) && exit_code=$? || exit_code=$?
echo "$output" | tail -25

if [ $exit_code -eq 0 ]; then
  # Should see two auto-failover messages
  count=$(echo "$output" | grep -c "auto-failover" || true)
  if [ "$count" -ge 2 ]; then
    pass
  else
    fail "expected 2 auto-failover hops, saw $count"
  fi
else
  fail "expected exit 0 after chained failover, got $exit_code"
fi

# ── 9. Cycle detection: A → B → A ───────────────────────

run_test "Cycle detection: fake-ratelimit → fake-tokenlimit → fake-ratelimit (cycle)"

write_agent_yaml fake-ratelimit headless-rate-limit.sh \
  fallback fake-tokenlimit \
  auto_failover true \
  failover_transfer summary
write_agent_yaml fake-tokenlimit headless-token-limit.sh \
  fallback fake-ratelimit \
  auto_failover true \
  failover_transfer summary

output=$(run_headless fake-ratelimit) && exit_code=$? || exit_code=$?
echo "$output" | tail -20

if echo "$output" | grep -qi "cycle"; then
  pass
else
  fail "expected cycle detection message"
fi

# ── 10. Success → no failover ───────────────────────────

run_test "Successful run → no failover attempted"

write_agent_yaml fake-ok headless-success.sh \
  fallback fake-ratelimit \
  auto_failover true

output=$(run_headless fake-ok) && exit_code=$? || exit_code=$?
echo "$output" | tail -10

if [ $exit_code -eq 0 ]; then
  if echo "$output" | grep -q "auto-failover\|Hand off"; then
    fail "should not attempt failover on success"
  else
    pass
  fi
else
  fail "expected exit 0, got $exit_code"
fi

# ── 11. Run log + session created ────────────────────────

run_test "Run creates log file and session with correct metadata"

write_agent_yaml fake-ok headless-success.sh

output=$(run_headless fake-ok) && exit_code=$? || exit_code=$?

# Extract run ID from output
run_id=$(echo "$output" | grep -o "run: [^ ]*" | head -1 | awk '{print $2}')
session_id=$(echo "$output" | grep -o "session: [^ ]*" | head -1 | awk '{print $2}')

if [ -n "$run_id" ] && [ -n "$session_id" ]; then
  # Check run log exists
  log_file="$HOME/.harnessctl/runs/$run_id.json"
  if [ -f "$log_file" ]; then
    pass
  else
    fail "run log file not found: $log_file"
  fi
else
  fail "could not extract run/session IDs from output"
fi

# ── 12. Handoff context file written ─────────────────────

run_test "Handoff context file written after run"

handoff_dir="$PROJECT_DIR/.harnessctl/handoffs"
if [ -n "$run_id" ] && [ -f "$handoff_dir/$run_id.md" ]; then
  # Check it has expected sections
  if grep -q "Summary" "$handoff_dir/$run_id.md"; then
    pass
  else
    fail "handoff file missing Summary section"
  fi
else
  fail "handoff context file not found for run $run_id"
fi

# ── 13. Failover with transcript transfer ────────────────

run_test "Failover with failover_transfer:transcript includes previous conversation"

write_agent_yaml fake-ratelimit headless-rate-limit.sh \
  fallback fake-ok \
  auto_failover true \
  failover_transfer transcript
write_agent_yaml fake-ok headless-success.sh

output=$(run_headless fake-ratelimit) && exit_code=$? || exit_code=$?
echo "$output" | tail -20

# The fallback agent should succeed
if [ $exit_code -eq 0 ]; then
  pass
else
  fail "expected exit 0 with transcript transfer, got $exit_code"
fi

# ── 14. Stream mode with failover ────────────────────────

run_test "Stream mode: rate limit → auto-failover still works"

write_agent_yaml fake-ratelimit headless-rate-limit.sh \
  fallback fake-ok \
  auto_failover true \
  failover_transfer summary
write_agent_yaml fake-ok headless-success.sh

output=$(run_headless fake-ratelimit --stream) && exit_code=$? || exit_code=$?
echo "$output" | tail -20

if [ $exit_code -eq 0 ]; then
  if echo "$output" | grep -q "auto-failover"; then
    pass
  else
    fail "expected auto-failover in stream mode"
  fi
else
  fail "expected exit 0 in stream mode failover, got $exit_code"
fi

# ── Cleanup ──────────────────────────────────────────────

# restore_agents runs via trap

# ── Summary ──────────────────────────────────────────────

echo ""
echo "============================================"
echo " Results: $PASS passed, $FAIL failed (of $TOTAL)"
echo "============================================"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
