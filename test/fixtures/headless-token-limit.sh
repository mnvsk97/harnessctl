#!/bin/bash
# Fake agent for headless mode: simulates token/context limit exhaustion.

if [[ "$1" == "--version" ]]; then
  echo "fake-headless 0.1.0"
  exit 0
fi

cat > /dev/null

echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Analyzing the codebase structure..."}]}}'
sleep 0.2
echo '{"type":"result","is_error":true,"subtype":"context_limit","result":"Error: context window exhausted (200,000 / 200,000 tokens used)"}'
exit 1
