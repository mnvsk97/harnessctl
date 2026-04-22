#!/bin/bash
# Fake agent for headless mode: simulates Claude stream-json with rate limit.
# Reads stdin (prompt), outputs stream-json events, exits with error.

# Auth check (generic adapter runs cmd --version)
if [[ "$1" == "--version" ]]; then
  echo "fake-headless 0.1.0"
  exit 0
fi

# Read and discard stdin prompt
cat > /dev/null

# Simulate some work output then hit rate limit
echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I will help you with that task. Let me start by analyzing..."}]}}'
sleep 0.2
echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Read"}]}}'
sleep 0.2
echo '{"type":"result","is_error":true,"subtype":"rate_limit","result":"Error: 429 Too Many Requests — rate limit exceeded. Please wait before retrying."}'
exit 1
