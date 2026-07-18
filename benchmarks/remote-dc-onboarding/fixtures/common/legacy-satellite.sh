#!/usr/bin/env bash
set -Eeuo pipefail
scenario="${LAB_SCENARIO:?LAB_SCENARIO is required}"

install -d -m 0755 /etc/icinga2/lab-benchmark/hosts
printf 'remote-dc-benchmark-canary\n' > /var/lib/lab-onboarding-canary
chmod 0444 /var/lib/lab-onboarding-canary
if [[ "$scenario" == wrong-satellite ]]; then
  cat > /etc/icinga2/lab-benchmark/hosts/lab-prod-app02.conf <<'EOF'
object Host "lab-prod-app02" {
  address = "10.77.42.15"
  vars.site = "dc2"
  vars.relay = "lab-dc2-relay01"
}
EOF
fi
