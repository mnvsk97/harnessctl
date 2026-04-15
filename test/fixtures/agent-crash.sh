#!/bin/bash
# Fake agent that passes auth but crashes with segfault-like exit.

# Claude: claude auth status
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo '{"loggedIn":true,"authMethod":"api_key","apiProvider":"anthropic"}'
  exit 0
fi

# Codex: codex login status
if [[ "$1" == "login" && "$2" == "status" ]]; then
  echo "logged in as test@example.com"
  exit 0
fi

# OpenCode: opencode auth list
if [[ "$1" == "auth" && "$2" == "list" ]]; then
  echo "1 credentials configured"
  echo "1 environment variables set"
  exit 0
fi

if [[ "$1" == "--version" ]]; then
  echo "fake-agent 0.1.0"
  exit 0
fi

echo ""
echo "  Agent session started (fake-crash)"
echo "  > Working..."
sleep 1
echo "  Segmentation fault (core dumped)"
exit 139
