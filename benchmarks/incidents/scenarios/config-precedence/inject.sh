#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "ok" ]]
[[ ! -e /etc/lab-middleware ]]
[[ ! -e /var/log/lab-middleware ]]

install -d -o root -g root -m 0755 /etc/lab-middleware
install -d -o root -g root -m 0755 /var/log/lab-middleware
printf 'UPSTREAM_HOST=lab-prod-mq01\nUPSTREAM_PORT=8080\n' > /etc/lab-middleware/middleware.env
printf 'UPSTREAM_PORT=8081\n' > /etc/lab-middleware/override.env
chmod 0644 /etc/lab-middleware/middleware.env /etc/lab-middleware/override.env
cat > /var/log/lab-middleware/current.log <<'EOF'
2026-07-18T19:20:04Z INFO loaded_config="/etc/lab-middleware/middleware.env,/etc/lab-middleware/override.env" precedence="last value wins"
2026-07-18T19:20:05Z ERROR dependency=messaging-api target=lab-prod-mq01 port=8081 error="Connection refused"
2026-07-18T19:20:05Z ERROR health=critical reason="upstream dependency unavailable"
EOF
chmod 0644 /var/log/lab-middleware/current.log
printf 'critical\n' > /state/status
