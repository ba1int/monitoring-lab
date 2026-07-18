#!/usr/bin/env bash
set -Eeuo pipefail

rm -rf -- \
  /etc/lab-onboarding \
  /etc/openvpn/server \
  /etc/lab-routing \
  /etc/icinga2/lab-benchmark \
  /opt/lab-onboarding \
  /var/lib/lab-onboarding-canary
