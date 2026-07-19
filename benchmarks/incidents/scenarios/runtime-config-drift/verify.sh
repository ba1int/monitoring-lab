#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "critical" ]]
[[ "$(cat /etc/lab-middleware/middleware.env)" == $'UPSTREAM_HOST=lab-prod-mq01\nUPSTREAM_PORT=8080' ]]
runtime_pid=$(cat /run/lab-middleware-benchmark.pid)
kill -0 "$runtime_pid"
tr '\0' '\n' < "/proc/$runtime_pid/environ" | grep -Fxq 'UPSTREAM_PORT=8081'
grep -Fq "pid=$runtime_pid" /var/log/lab-middleware/current.log
