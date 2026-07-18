#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "critical" ]]
[[ "$(stat -c '%a:%U:%G' /etc/lab-middleware/middleware.env)" == "644:root:root" ]]
[[ "$(cat /etc/lab-middleware/middleware.env)" == $'UPSTREAM_HOST=lab-dev-app01\nUPSTREAM_PORT=8080' ]]
grep -Fq 'expected_environment=PROD actual_environment=DEV' /var/log/lab-middleware/current.log
