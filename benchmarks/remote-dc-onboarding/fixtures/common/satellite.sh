#!/usr/bin/env bash
set -Eeuo pipefail
scenario="${LAB_SCENARIO:?LAB_SCENARIO is required}"

install -d -m 0755 /etc/lab-routing /etc/icinga2/lab-benchmark/hosts /opt/lab-onboarding/bin
printf 'remote-dc-benchmark-canary\n' > /var/lib/lab-onboarding-canary
chmod 0444 /var/lib/lab-onboarding-canary

if [[ "$scenario" != full-onboarding ]]; then
  printf 'network=10.77.42.0/24\nvia=lab-dc2-relay01\n' \
    > /etc/lab-routing/10.77.42.0-24.route
fi
if [[ "$scenario" == missing-iroute || "$scenario" == missing-route ]]; then
  cat > /etc/icinga2/lab-benchmark/hosts/lab-prod-app02.conf <<'EOF'
object Host "lab-prod-app02" {
  address = "10.77.42.15"
  vars.site = "dc2"
  vars.relay = "lab-dc2-relay01"
}
EOF
fi
