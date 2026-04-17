#!/bin/bash
# Fake agent that passes auth but dies with rate limit error.

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

# Cursor: cursor-agent status
if [[ "$1" == "status" ]]; then
  echo "Logged in as test@example.com"
  exit 0
fi

if [[ "$1" == "--version" ]]; then
  echo "fake-agent 0.1.0"
  exit 0
fi

echo ""
echo "  Agent session started (fake-rate-limited)"
echo "  > Processing..."
sleep 1
echo ""
echo "  Error: 429 Too Many Requests — rate limit exceeded"
echo "  Please wait 60 seconds before retrying."
echo ""
exit 1
