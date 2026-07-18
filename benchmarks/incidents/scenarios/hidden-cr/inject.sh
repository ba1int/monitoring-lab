#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "ok" ]]
[[ ! -e /etc/lab-middleware ]]
[[ ! -e /var/log/lab-middleware ]]

install -d -o root -g root -m 0755 /etc/lab-middleware
install -d -o root -g root -m 0755 /var/log/lab-middleware
printf 'UPSTREAM_HOST=lab-prod-mq01\r\nUPSTREAM_PORT=8080\n' > /etc/lab-middleware/middleware.env
chmod 0644 /etc/lab-middleware/middleware.env
cat > /var/log/lab-middleware/current.log <<'EOF'
2026-07-18T18:10:41Z ERROR dependency=messaging-api target=lab-prod-mq01 port=8080 error="Name or service not known"
2026-07-18T18:10:41Z ERROR health=critical reason="upstream dependency unavailable"
EOF
chmod 0644 /var/log/lab-middleware/current.log
printf 'critical\n' > /state/status
