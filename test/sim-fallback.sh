#!/bin/bash
#
# Simulation tests for shell fallback behavior.
# Uses fake agent scripts + expect to simulate terminal interaction.
#
# Usage: bash test/sim-fallback.sh
# Requires: bun, expect
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURES="$SCRIPT_DIR/fixtures"
FAKE_DIR="$(mktemp -d)"

PASS=0
FAIL=0
TOTAL=0

# ── Helpers ──────────────────────────────────────────────

cleanup() {
  rm -rf "$FAKE_DIR"
}
trap cleanup EXIT

setup_agent() {
  local name="$1" fixture="$2"
  cp "$FIXTURES/$fixture" "$FAKE_DIR/$name"
  chmod +x "$FAKE_DIR/$name"
}

configure_fallback() {
  cd "$PROJECT_DIR"
  bun run src/cli.ts config set-fallback "$1" "$2" >/dev/null 2>&1
}

remove_fallback() {
  cd "$PROJECT_DIR"
  bun run src/cli.ts config remove-fallback "$1" >/dev/null 2>&1 || true
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

# Run harnessctl shell with expect, send answer to fallback prompt.
# Args: agent, answer ("y" or "n"), expected_exit_code
# Captures output for assertion.
run_shell_expect() {
  local agent="$1"
  local answer="$2"
  local expect_script

  expect_script=$(cat <<EXPECT_EOF
#!/usr/bin/expect -f
set timeout 30
log_user 1
spawn env PATH=$FAKE_DIR:\$env(PATH) bun run src/cli.ts shell --agent $agent
expect {
  "Hand off to *" {
    send "$answer\r"
    exp_continue
  }
  "Launch *instead*" {
    send "$answer\r"
    exp_continue
  }
  eof {}
  timeout { exit 99 }
}
lassign [wait] pid spawnid os_error exit_code
exit \$exit_code
EXPECT_EOF
  )

  cd "$PROJECT_DIR"
  local output
  local exit_code=0
  output=$(expect -c "$expect_script" 2>&1) || exit_code=$?
  echo "$output"
  return $exit_code
}

# Run harnessctl shell non-interactively (no expect).
# For cases where no prompt is expected.
run_shell_no_prompt() {
  local agent="$1"
  cd "$PROJECT_DIR"
  local output
  local exit_code=0
  output=$(PATH="$FAKE_DIR:$PATH" bun run src/cli.ts shell --agent "$agent" 2>&1 </dev/null) || exit_code=$?
  echo "$output"
  return $exit_code
}

# ── Simulations ──────────────────────────────────────────

echo "========================================"
echo " harnessctl fallback simulation tests"
echo "========================================"

# ── 1. Out-of-tokens → accept fallback ──────────────────

run_test "Out-of-tokens → accept fallback → fallback succeeds"

setup_agent codex agent-out-of-tokens.sh
setup_agent claude agent-ok.sh
configure_fallback codex claude

output=$(run_shell_expect codex y) && exit_code=$? || exit_code=$?
echo "$output" | head -30

if [ $exit_code -eq 0 ] && echo "$output" | grep -q "exited with code"; then
  if echo "$output" | grep -q "Hand off to claude"; then
    pass
  else
    fail "fallback prompt not shown"
  fi
else
  fail "expected exit 0, got $exit_code"
fi

# ── 2. Out-of-tokens → decline fallback ─────────────────

run_test "Out-of-tokens → decline fallback → returns original exit code"

output=$(run_shell_expect codex n) && exit_code=$? || exit_code=$?
echo "$output" | head -20

if [ $exit_code -ne 0 ] && echo "$output" | grep -q "fallback declined"; then
  pass
else
  fail "expected non-zero exit with 'fallback declined', got exit=$exit_code"
fi

# ── 3. Rate limit → accept fallback ─────────────────────

run_test "Rate-limited → accept fallback → fallback succeeds"

setup_agent codex agent-rate-limited.sh
setup_agent claude agent-ok.sh

output=$(run_shell_expect codex y) && exit_code=$? || exit_code=$?
echo "$output" | head -25

if [ $exit_code -eq 0 ] && echo "$output" | grep -q "exited with code 1"; then
  pass
else
  fail "expected exit 0 after fallback, got $exit_code"
fi

# ── 4. Crash → accept fallback ──────────────────────────

run_test "Agent crash (exit 139) → accept fallback → fallback succeeds"

setup_agent codex agent-crash.sh
setup_agent claude agent-ok.sh

output=$(run_shell_expect codex y) && exit_code=$? || exit_code=$?
echo "$output" | head -25

if [ $exit_code -eq 0 ] && echo "$output" | grep -q "exited with code 139"; then
  pass
else
  fail "expected exit 0 after fallback from crash, got $exit_code"
fi

# ── 5. Auth failure → accept fallback ───────────────────

run_test "Auth failure → accept fallback → fallback succeeds"

setup_agent codex agent-auth-fail.sh
setup_agent claude agent-ok.sh

output=$(run_shell_expect codex y) && exit_code=$? || exit_code=$?
echo "$output" | head -20

if [ $exit_code -eq 0 ] && echo "$output" | grep -q "auth failed"; then
  pass
else
  fail "expected exit 0 after auth fallback, got $exit_code"
fi

# ── 6. Auth failure → decline fallback ──────────────────

run_test "Auth failure → decline fallback → returns 1"

output=$(run_shell_expect codex n) && exit_code=$? || exit_code=$?
echo "$output" | head -15

if [ $exit_code -ne 0 ]; then
  pass
else
  fail "expected non-zero exit, got $exit_code"
fi

# ── 7. Auth failure → fallback also fails auth ──────────

run_test "Auth failure → fallback also fails auth → returns 1"

setup_agent codex agent-auth-fail.sh
setup_agent claude agent-auth-fail.sh

output=$(run_shell_expect codex y) && exit_code=$? || exit_code=$?
echo "$output" | head -20

if [ $exit_code -ne 0 ]; then
  pass
else
  fail "expected non-zero when both agents fail auth, got $exit_code"
fi

# ── 8. Chained fallback: codex → claude → opencode ──────

run_test "Chained fallback: codex(fail) → claude(fail) → opencode(ok)"

setup_agent codex agent-out-of-tokens.sh
setup_agent claude agent-rate-limited.sh
setup_agent opencode agent-ok.sh
configure_fallback codex claude
configure_fallback claude opencode

output=$(run_shell_expect codex y) && exit_code=$? || exit_code=$?
echo "$output" | head -35

if [ $exit_code -eq 0 ]; then
  pass
else
  fail "expected exit 0 after chained fallback, got $exit_code"
fi

# ── 9. No fallback configured → exits with error code ───

run_test "No fallback configured → exits with agent's error code"

setup_agent codex agent-out-of-tokens.sh
remove_fallback codex

output=$(run_shell_no_prompt codex) && exit_code=$? || exit_code=$?
echo "$output" | head -15

if [ $exit_code -ne 0 ] && ! echo "$output" | grep -q "Hand off"; then
  pass
else
  fail "expected error exit without fallback prompt, got $exit_code"
fi

# ── 10. Clean exit → no fallback offered ─────────────────

run_test "Clean exit (code 0) → no fallback offered"

setup_agent codex agent-ok.sh
configure_fallback codex claude

output=$(run_shell_no_prompt codex) && exit_code=$? || exit_code=$?
echo "$output" | head -15

if [ $exit_code -eq 0 ] && ! echo "$output" | grep -q "Hand off"; then
  pass
else
  fail "expected clean exit without fallback, got $exit_code"
fi

# ── Cleanup fallback configs ────────────────────────────

remove_fallback codex
remove_fallback claude

# ── Summary ──────────────────────────────────────────────

echo ""
echo "========================================"
echo " Results: $PASS passed, $FAIL failed (of $TOTAL)"
echo "========================================"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
