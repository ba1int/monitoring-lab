#!/usr/bin/env bash
set -Eeuo pipefail
scenario="${LAB_SCENARIO:?LAB_SCENARIO is required}"

install -d -m 0755 /etc/openvpn/server/ccd /opt/lab-onboarding/bin
install -m 0644 /dev/null /etc/openvpn/server/server.conf
install -m 0644 /dev/null /etc/openvpn/server/ccd/dc2-relay01
printf '10.77.42.0/24\tdc2-relay01\n10.88.9.0/24\tdc3-relay01\n' \
  > /etc/openvpn/server/ccd/index.tsv
printf 'remote-dc-benchmark-canary\n' > /var/lib/lab-onboarding-canary
chmod 0444 /var/lib/lab-onboarding-canary

case "$scenario" in
  full-onboarding) ;;
  missing-iroute)
    printf 'route 10.77.42.0 255.255.255.0\n' >> /etc/openvpn/server/server.conf
    ;;
  missing-route)
    printf 'iroute 10.77.42.0 255.255.255.0\n' >> /etc/openvpn/server/ccd/dc2-relay01
    ;;
  wrong-satellite)
    printf 'route 10.77.42.0 255.255.255.0\n' >> /etc/openvpn/server/server.conf
    printf 'iroute 10.77.42.0 255.255.255.0\n' >> /etc/openvpn/server/ccd/dc2-relay01
    ;;
  *) printf 'unknown scenario: %s\n' "$scenario" >&2; exit 2 ;;
esac
