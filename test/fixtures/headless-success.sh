#!/bin/bash
# Fake agent for headless mode: completes successfully with stream-json output.

if [[ "$1" == "--version" ]]; then
  echo "fake-headless 0.1.0"
  exit 0
fi

# Consume stdin (prompt) but don't echo it back
cat > /dev/null

echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I completed the task successfully. Here is the result."}]}}'
sleep 0.2
echo '{"type":"result","is_error":false,"result":"Task completed successfully.","session_id":"fake-session-001","cost_usd":0.005,"usage":{"input_tokens":500,"output_tokens":200}}'
exit 0
