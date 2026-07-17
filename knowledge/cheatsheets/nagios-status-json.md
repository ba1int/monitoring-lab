# Nagios Status JSON

The isolated Nagios CGI is available inside the workstation at `nagios`.

```bash
curl -sS -u nagiosadmin:monitoring-lab --get \
  --data-urlencode 'query=servicelist' \
  --data-urlencode 'details=true' \
  http://nagios/nagios/cgi-bin/statusjson.cgi | jq
```

Use `last_hard_state` for service severity. The `status` field is a bitmask,
not the usual `0` through `3` service-state code.
