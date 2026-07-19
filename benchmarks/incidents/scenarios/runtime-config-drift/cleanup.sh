#!/usr/bin/env bash
set -Eeuo pipefail

if [[ -r /run/lab-middleware-benchmark.pid ]]; then
  runtime_pid=$(cat /run/lab-middleware-benchmark.pid)
  kill "$runtime_pid" 2>/dev/null || true
fi
rm -f -- /run/lab-middleware-benchmark.pid
printf 'ok\n' > /state/status
rm -rf -- /etc/lab-middleware /var/log/lab-middleware
