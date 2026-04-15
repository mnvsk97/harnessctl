#!/bin/bash
# Fake agent that always fails auth check.
# Returns the right format for each adapter but with "not logged in" state.

# Claude: claude auth status
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo '{"loggedIn":false}'
  exit 1
fi

# Codex: codex login status
if [[ "$1" == "login" && "$2" == "status" ]]; then
  echo "not logged in"
  exit 1
fi

# OpenCode: opencode auth list
if [[ "$1" == "auth" && "$2" == "list" ]]; then
  echo "0 credentials configured"
  echo "0 environment variables set"
  exit 1
fi

if [[ "$1" == "--version" ]]; then
  echo "fake-agent 0.1.0"
  exit 0
fi

echo "Error: not authenticated"
exit 1
