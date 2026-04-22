#!/bin/bash
# Fake agent for headless mode: generic error (not a limit reason).
# Should NOT auto-failover, should prompt user.

if [[ "$1" == "--version" ]]; then
  echo "fake-headless 0.1.0"
  exit 0
fi

cat > /dev/null

echo "Working on your task..."
sleep 0.2
echo "Error: internal failure — something went wrong"
exit 1
