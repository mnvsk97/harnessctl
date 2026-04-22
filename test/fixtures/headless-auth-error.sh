#!/bin/bash
# Fake agent for headless mode: simulates auth failure during run.

if [[ "$1" == "--version" ]]; then
  echo "fake-headless 0.1.0"
  exit 0
fi

cat > /dev/null

echo "Error: 401 Unauthorized — invalid API key"
echo "Please run: claude auth login"
exit 1
