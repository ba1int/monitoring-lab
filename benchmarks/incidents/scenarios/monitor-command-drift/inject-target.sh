#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "ok" ]]
install -d -o root -g root -m 0755 /var/log/lab-middleware
cat > /var/log/lab-middleware/current.log <<'EOF'
2026-07-19T11:42:12Z INFO endpoint=/health http_status=200 state=ok
2026-07-19T11:42:12Z INFO readiness=/ready http_status=200 ready=true
EOF
chmod 0644 /var/log/lab-middleware/current.log
