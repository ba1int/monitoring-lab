#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "ok" ]]
[[ ! -e /etc/lab-middleware ]]
[[ ! -e /var/log/lab-middleware ]]

install -d -o root -g root -m 0755 /etc/lab-middleware
install -d -o root -g root -m 0755 /var/log/lab-middleware
printf 'UPSTREAM_HOST=lab-dev-app01\nUPSTREAM_PORT=8080\n' > /etc/lab-middleware/middleware.env
chmod 0644 /etc/lab-middleware/middleware.env
cat > /var/log/lab-middleware/current.log <<'EOF'
2026-07-18T18:14:17Z ERROR dependency=middleware target=lab-dev-app01 expected_environment=PROD actual_environment=DEV policy="cross-environment dependency rejected"
2026-07-18T18:14:17Z ERROR health=critical reason="dependency policy violation"
EOF
chmod 0644 /var/log/lab-middleware/current.log
printf 'critical\n' > /state/status
