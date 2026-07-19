#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "critical" ]]
[[ -L /etc/lab-middleware/current.env ]]
[[ "$(readlink /etc/lab-middleware/current.env)" == /opt/lab-middleware/releases/2026.07.18/middleware.env ]]
grep -Fxq 'UPSTREAM_PORT=8081' /etc/lab-middleware/current.env
grep -Fxq 'UPSTREAM_PORT=8080' /opt/lab-middleware/releases/2026.07.19/middleware.env
