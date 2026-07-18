#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(cat /state/status)" == "critical" ]]
[[ "$(stat -c '%a:%U:%G' /etc/lab-middleware/middleware.env)" == "644:root:root" ]]
[[ "$(od -An -tx1 -v /etc/lab-middleware/middleware.env | tr -d ' \n')" == "555053545245414d5f484f53543d6c61622d70726f642d6d7130310d0a555053545245414d5f504f52543d383038300a" ]]
grep -Fq 'Name or service not known' /var/log/lab-middleware/current.log
