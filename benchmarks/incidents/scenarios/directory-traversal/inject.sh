#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "ok" ]]
[[ ! -e /etc/lab-middleware ]]
[[ ! -e /var/log/lab-middleware ]]

install -d -o root -g root -m 0755 /etc/lab-middleware
install -d -o root -g root -m 0755 /var/log/lab-middleware
printf 'UPSTREAM_HOST=lab-prod-mq01\nUPSTREAM_PORT=8080\n' > /etc/lab-middleware/middleware.env
printf 'API_TOKEN=benchmark-placeholder-not-a-secret\n' > /etc/lab-middleware/credentials.env
chown root:operator /etc/lab-middleware/credentials.env
chmod 0640 /etc/lab-middleware/credentials.env
chmod 0700 /etc/lab-middleware
cat > /var/log/lab-middleware/current.log <<'EOF'
2026-07-18T19:24:11Z ERROR component=credentials file=/etc/lab-middleware/credentials.env service_user=operator error="PermissionError: [Errno 13] Permission denied"
2026-07-18T19:24:11Z ERROR health=critical reason="middleware initialization incomplete"
EOF
chmod 0644 /var/log/lab-middleware/current.log
printf 'critical\n' > /state/status
