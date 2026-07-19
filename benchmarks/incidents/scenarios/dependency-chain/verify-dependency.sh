#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "critical" ]]
[[ "$(cat /etc/lab-middleware/middleware.env)" == $'UPSTREAM_HOST=lab-prod-app01\nUPSTREAM_PORT=8081\nHEALTH_PATH=/health' ]]
grep -Fq 'expected_port=8080' /var/log/lab-middleware/current.log
