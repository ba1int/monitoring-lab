#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "critical" ]]
[[ "$(stat -c '%a:%U:%G' /etc/lab-middleware/credentials.env)" == "600:root:root" ]]
[[ "$(cat /etc/lab-middleware/credentials.env)" == "API_TOKEN=benchmark-placeholder-not-a-secret" ]]
grep -Fq 'Permission denied' /var/log/lab-middleware/current.log
