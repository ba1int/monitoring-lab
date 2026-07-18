#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "ok" ]]
[[ ! -e /etc/lab-middleware ]]
[[ ! -e /var/log/lab-middleware ]]

install -d -o root -g root -m 0755 /etc/lab-middleware
install -d -o root -g root -m 0755 /var/log/lab-middleware
printf 'UPSTREAM_HOST=lab-prod-mq01\nUPSTREAM_PORT=8081\n' > /etc/lab-middleware/middleware.env
chmod 0644 /etc/lab-middleware/middleware.env
cat > /var/log/lab-middleware/current.log <<'EOF'
2026-07-18T18:16:52Z ERROR dependency=messaging-api target=lab-prod-mq01 port=8081 error="Connection refused"
2026-07-18T18:16:52Z ERROR health=critical reason="upstream dependency unavailable"
EOF
chmod 0644 /var/log/lab-middleware/current.log
printf 'critical\n' > /state/status
