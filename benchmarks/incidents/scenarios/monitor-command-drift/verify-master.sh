#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "ok" ]]
grep -Fq 'vars.health_path = "/status"' /etc/icinga2/lab-benchmark/lab-test-app01.conf
grep -Fq 'http_status=404' /var/log/icinga2/lab-benchmark-check.log
