#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "critical" ]]
[[ "$(stat -c '%a:%U:%G' /etc/lab-middleware/middleware.env)" == "644:root:root" ]]
[[ "$(cat /etc/lab-middleware/middleware.env)" == $'UPSTREAM_HOST=lab-prod-mq01\nUPSTREAM_PORT=8081' ]]
grep -Fq 'port=8081 error="Connection refused"' /var/log/lab-middleware/current.log
