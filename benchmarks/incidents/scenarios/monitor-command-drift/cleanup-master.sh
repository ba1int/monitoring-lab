#!/usr/bin/env bash
set -Eeuo pipefail

printf 'ok\n' > /state/status
rm -f -- /etc/icinga2/lab-benchmark/lab-test-app01.conf /var/log/icinga2/lab-benchmark-check.log
rmdir /etc/icinga2/lab-benchmark /etc/icinga2 2>/dev/null || true
rmdir /var/log/icinga2 2>/dev/null || true
