#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "critical" ]]
[[ "$(cat /etc/lab-middleware/middleware.env)" == $'UPSTREAM_HOST=lab-prod-mq01\nUPSTREAM_PORT=8080\nHEALTH_PATH=/health' ]]
grep -Fq 'http_status=503' /var/log/lab-middleware/current.log
