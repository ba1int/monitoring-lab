#!/usr/bin/env bash
set -Eeuo pipefail

install -d -m 0755 /etc/lab-onboarding
cat > /etc/lab-onboarding/assignment.env <<'EOF'
HOST=lab-prod-app02
ADDRESS=10.77.42.15
NETWORK=10.77.42.0
NETMASK=255.255.255.0
PREFIX=24
VPN_CLIENT=dc2-relay01
RELAY=lab-dc2-relay01
SATELLITE=lab-dc2-sat01
MASTER=lab-dc1-master01
SITE=dc2
ZONE=dc2
PARENT_ZONE=master
EOF
chmod 0644 /etc/lab-onboarding/assignment.env
printf 'remote-dc-benchmark-canary\n' > /var/lib/lab-onboarding-canary
chmod 0444 /var/lib/lab-onboarding-canary
