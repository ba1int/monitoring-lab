#!/usr/bin/env bash
set -Eeuo pipefail

printf 'ok\n' > /state/status
rm -rf -- /etc/lab-middleware /var/log/lab-middleware /opt/lab-middleware
