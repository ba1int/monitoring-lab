#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "critical" ]]
[[ "$(stat -c '%a:%U:%G' /etc/lab-middleware/middleware.env)" == "644:root:root" ]]
[[ "$(cat /etc/lab-middleware/middleware.env)" == $'UPSTREAM_SCHEME=https\nUPSTREAM_HOST=lab-prod-mq01\nUPSTREAM_PORT=8080' ]]
grep -Fq 'ssl.SSLError: WRONG_VERSION_NUMBER' /var/log/lab-middleware/current.log
