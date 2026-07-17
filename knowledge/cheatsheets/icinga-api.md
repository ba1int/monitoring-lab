# Icinga API service problems

The isolated master is available inside the workstation as `icinga:5665`.

```bash
curl -ksS -u lab:monitoring-lab --get \
  --data-urlencode 'filter=service.last_hard_state!=ServiceOK' \
  --data-urlencode 'attrs=host_name' \
  --data-urlencode 'attrs=display_name' \
  --data-urlencode 'attrs=last_hard_state' \
  https://icinga:5665/v1/objects/services | jq
```

State codes are `0 OK`, `1 WARNING`, `2 CRITICAL`, and `3 UNKNOWN`.
