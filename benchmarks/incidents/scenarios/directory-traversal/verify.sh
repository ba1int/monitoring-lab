#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "critical" ]]
[[ "$(stat -c '%a:%U:%G' /etc/lab-middleware)" == "700:root:root" ]]
[[ "$(stat -c '%a:%U:%G' /etc/lab-middleware/credentials.env)" == "640:root:operator" ]]
[[ "$(cat /etc/lab-middleware/credentials.env)" == "API_TOKEN=benchmark-placeholder-not-a-secret" ]]
grep -Fq 'service_user=operator' /var/log/lab-middleware/current.log
