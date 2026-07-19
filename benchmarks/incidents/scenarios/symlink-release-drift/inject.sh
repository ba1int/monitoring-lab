#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "ok" ]]
[[ ! -e /etc/lab-middleware ]]
[[ ! -e /var/log/lab-middleware ]]
[[ ! -e /opt/lab-middleware ]]

install -d -o root -g root -m 0755 \
  /etc/lab-middleware /var/log/lab-middleware \
  /opt/lab-middleware/releases/2026.07.18 /opt/lab-middleware/releases/2026.07.19
printf 'UPSTREAM_HOST=lab-prod-mq01\nUPSTREAM_PORT=8081\n' > /opt/lab-middleware/releases/2026.07.18/middleware.env
printf 'UPSTREAM_HOST=lab-prod-mq01\nUPSTREAM_PORT=8080\n' > /opt/lab-middleware/releases/2026.07.19/middleware.env
chmod 0644 /opt/lab-middleware/releases/*/middleware.env
ln -s /opt/lab-middleware/releases/2026.07.18/middleware.env /etc/lab-middleware/current.env
cat > /var/log/lab-middleware/current.log <<'EOF'
2026-07-19T10:12:20Z INFO release=2026.07.19 event="release files installed"
2026-07-19T10:12:22Z INFO config=/etc/lab-middleware/current.env resolved=/opt/lab-middleware/releases/2026.07.18/middleware.env
2026-07-19T10:12:23Z ERROR dependency=messaging-api port=8081 error="Connection refused"
2026-07-19T10:12:23Z ERROR health=critical reason="upstream dependency unavailable"
EOF
chmod 0644 /var/log/lab-middleware/current.log
printf 'critical\n' > /state/status
