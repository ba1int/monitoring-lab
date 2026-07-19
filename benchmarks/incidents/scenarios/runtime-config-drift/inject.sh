#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "ok" ]]
[[ ! -e /etc/lab-middleware ]]
[[ ! -e /var/log/lab-middleware ]]

install -d -o root -g root -m 0755 /etc/lab-middleware /var/log/lab-middleware
printf 'UPSTREAM_HOST=lab-prod-mq01\nUPSTREAM_PORT=8080\n' > /etc/lab-middleware/middleware.env
chmod 0644 /etc/lab-middleware/middleware.env
nohup env UPSTREAM_HOST=lab-prod-mq01 UPSTREAM_PORT=8081 sleep 86400 >/dev/null 2>&1 &
runtime_pid=$!
printf '%s\n' "$runtime_pid" > /run/lab-middleware-benchmark.pid
cat > /var/log/lab-middleware/current.log <<EOF
2026-07-19T09:41:02Z INFO config=/etc/lab-middleware/middleware.env disk_port=8080 event="configuration deployed"
2026-07-19T09:41:03Z WARN pid=$runtime_pid event="reload skipped" reason="process environment unchanged"
2026-07-19T09:41:04Z ERROR pid=$runtime_pid dependency=messaging-api effective_port=8081 error="Connection refused"
2026-07-19T09:41:04Z ERROR health=critical reason="upstream dependency unavailable"
EOF
chmod 0644 /var/log/lab-middleware/current.log /run/lab-middleware-benchmark.pid
printf 'critical\n' > /state/status
