#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "ok" ]]
grep -Fq 'endpoint=/health http_status=200 state=ok' /var/log/lab-middleware/current.log
