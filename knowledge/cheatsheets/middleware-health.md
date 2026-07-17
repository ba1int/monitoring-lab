# Middleware health

The mock middleware endpoint exposes one of three states from `/state/status`:
`ok`, `warning`, or `critical`.

## Inspect from a host

```bash
/usr/local/libexec/check_lab_middleware
curl -fsS http://127.0.0.1:8080/health
```

## Inject and heal from the lab controller

```bash
lab fail lab-prod-app01 app
lab fail lab-prod-app01 app warning
lab heal lab-prod-app01
```

Both Icinga and Nagios should converge on the same hard state.
