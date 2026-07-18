#!/usr/bin/env bash
set -Eeuo pipefail
scenario="${LAB_SCENARIO:?LAB_SCENARIO is required}"

install -d -m 0755 /etc/icinga2/lab-benchmark/{zones,assignments} /opt/lab-onboarding/bin
printf 'remote-dc-benchmark-canary\n' > /var/lib/lab-onboarding-canary
chmod 0444 /var/lib/lab-onboarding-canary

if [[ "$scenario" != full-onboarding ]]; then
  cat > /etc/icinga2/lab-benchmark/zones/dc2.conf <<'EOF'
object Endpoint "lab-dc2-sat01" {}
object Zone "dc2" {
  endpoints = [ "lab-dc2-sat01" ]
  parent = "master"
}
EOF
fi
case "$scenario" in
  missing-iroute|missing-route)
    printf 'host=lab-prod-app02\nzone=dc2\nsatellite=lab-dc2-sat01\n' \
      > /etc/icinga2/lab-benchmark/assignments/lab-prod-app02.conf
    ;;
  wrong-satellite)
    printf 'host=lab-prod-app02\nzone=dc2\nsatellite=lab-prod-app01\n' \
      > /etc/icinga2/lab-benchmark/assignments/lab-prod-app02.conf
    ;;
esac
