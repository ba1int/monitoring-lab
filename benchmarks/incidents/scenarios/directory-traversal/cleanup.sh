#!/usr/bin/env bash
set -Eeuo pipefail

chmod 0755 /etc/lab-middleware 2>/dev/null || true
printf 'ok\n' > /state/status
rm -rf -- /etc/lab-middleware /var/log/lab-middleware
