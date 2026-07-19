#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "ok" ]]
install -d -o root -g root -m 0755 /etc/icinga2/lab-benchmark /var/log/icinga2
cat > /etc/icinga2/lab-benchmark/lab-test-app01.conf <<'EOF'
object Service "middleware" {
  host_name = "lab-test-app01"
  check_command = "http-health"
  vars.health_path = "/status"
}
EOF
cat > /var/log/icinga2/lab-benchmark-check.log <<'EOF'
2026-07-19T11:42:15Z host=lab-test-app01 service=middleware path=/status http_status=404 output="not found" state=CRITICAL
EOF
chmod 0644 /etc/icinga2/lab-benchmark/lab-test-app01.conf /var/log/icinga2/lab-benchmark-check.log
