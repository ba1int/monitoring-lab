#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "ok" ]]
install -d -o root -g root -m 0755 /etc/lab-middleware /var/log/lab-middleware
printf 'UPSTREAM_HOST=lab-prod-app01\nUPSTREAM_PORT=8081\nHEALTH_PATH=/health\n' > /etc/lab-middleware/middleware.env
cat > /var/log/lab-middleware/current.log <<'EOF'
2026-07-19T11:03:37Z ERROR dependency=queue-store target=lab-prod-app01 port=8081 error="Connection refused"
2026-07-19T11:03:37Z INFO service_catalog dependency=queue-store expected_port=8080
2026-07-19T11:03:38Z ERROR health=critical reason="upstream dependency unavailable"
EOF
chmod 0644 /etc/lab-middleware/middleware.env /var/log/lab-middleware/current.log
printf 'critical\n' > /state/status
