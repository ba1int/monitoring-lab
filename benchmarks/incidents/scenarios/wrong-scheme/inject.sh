#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "ok" ]]
[[ ! -e /etc/lab-middleware ]]
[[ ! -e /var/log/lab-middleware ]]

install -d -o root -g root -m 0755 /etc/lab-middleware
install -d -o root -g root -m 0755 /var/log/lab-middleware
printf 'UPSTREAM_SCHEME=https\nUPSTREAM_HOST=lab-prod-mq01\nUPSTREAM_PORT=8080\n' > /etc/lab-middleware/middleware.env
chmod 0644 /etc/lab-middleware/middleware.env
cat > /var/log/lab-middleware/current.log <<'EOF'
2026-07-18T19:27:36Z ERROR dependency=messaging-api url=https://lab-prod-mq01:8080/health error="ssl.SSLError: WRONG_VERSION_NUMBER"
2026-07-18T19:27:36Z ERROR health=critical reason="upstream TLS negotiation failed"
EOF
chmod 0644 /var/log/lab-middleware/current.log
printf 'critical\n' > /state/status
