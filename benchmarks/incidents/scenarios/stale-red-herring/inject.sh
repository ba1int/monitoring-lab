#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "ok" ]]
[[ ! -e /etc/lab-middleware ]]
[[ ! -e /var/log/lab-middleware ]]

install -d -o root -g root -m 0755 /etc/lab-middleware
install -d -o root -g root -m 0755 /var/log/lab-middleware
printf 'UPSTREAM_HOST=lab-prod-mq01\nUPSTREAM_PORT=8080\nHEALTH_PATH=/status\n' > /etc/lab-middleware/middleware.env
chmod 0644 /etc/lab-middleware/middleware.env
cat > /var/log/lab-middleware/current.log <<'EOF'
2026-07-18T18:02:14Z ERROR dependency=messaging-api target=lab-prod-mq01 error="Name or service not known"
2026-07-18T18:03:01Z INFO dependency=messaging-api event="DNS resolution recovered"
2026-07-18T19:31:48Z ERROR dependency=messaging-api url=http://lab-prod-mq01:8080/status http_status=404 body="not found"
2026-07-18T19:31:48Z ERROR health=critical reason="upstream health probe failed"
EOF
chmod 0644 /var/log/lab-middleware/current.log
printf 'critical\n' > /state/status
