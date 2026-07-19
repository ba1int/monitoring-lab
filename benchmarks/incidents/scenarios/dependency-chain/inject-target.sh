#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "ok" ]]
install -d -o root -g root -m 0755 /etc/lab-middleware /var/log/lab-middleware
printf 'UPSTREAM_HOST=lab-prod-mq01\nUPSTREAM_PORT=8080\nHEALTH_PATH=/health\n' > /etc/lab-middleware/middleware.env
cat > /var/log/lab-middleware/current.log <<'EOF'
2026-07-19T11:03:40Z INFO dependency=messaging-api target=lab-prod-mq01:8080 dns=ok tcp=connected
2026-07-19T11:03:41Z ERROR dependency=messaging-api url=http://lab-prod-mq01:8080/health http_status=503 body="upstream dependency unavailable"
2026-07-19T11:03:41Z ERROR health=critical reason="messaging dependency unhealthy"
EOF
chmod 0644 /etc/lab-middleware/middleware.env /var/log/lab-middleware/current.log
printf 'critical\n' > /state/status
