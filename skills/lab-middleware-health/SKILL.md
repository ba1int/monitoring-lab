---
name: lab-middleware-health
description: Inspect and report the health of mock middleware services on lab-* hosts in the isolated monitoring lab. Use for middleware health, readiness, status, or middleware alerts on a named lab host.
---

# Lab Middleware Health

Treat the installed monitoring plugin as the initial source of truth.

## Procedure

1. Call `ssh_exec` exactly once with the named host and this command:

   ```sh
   /usr/local/libexec/check_lab_middleware
   ```

2. Interpret the plugin exit code using the standard monitoring convention:

   - `0`: OK
   - `1`: WARNING
   - `2`: CRITICAL
   - `3`: UNKNOWN

3. Report the state and the plugin-provided host, environment, role, and site. Keep a healthy result brief.

4. Make another remote call only when the plugin reports UNKNOWN, its evidence conflicts, or the user explicitly asks for diagnosis or deeper proof.

## Diagnosis

- Treat `/state/status` and `/health` as declarations of the symptom, never as the root cause. Do not recommend editing the state file to clear an alert.
- Before reading service implementation, inspect `/var/log/lab-middleware/current.log` and the relevant files under `/etc/lab-middleware` when present.
- When a configured value looks correct but runtime behavior contradicts it, inspect its exact bytes and test the parsed value rather than the visually rendered text.
- Validate a suspected dependency by resolving and probing the configured value, then compare it with the intended literal value.
- Remain read-only during diagnosis unless the user explicitly authorizes a change.

## Investigation facts

- Targets are containers supervised by `tini`; systemd is intentionally absent.
- The middleware endpoint listens on port `8080`; `/health` and `/ready` are valid paths.
- Synthetic dependency endpoints on other `lab-*` hosts also listen on port `8080`.
- Lab middleware configuration and credentials, when present, live under `/etc/lab-middleware`.
- State is stored in `/state/status`, and metadata is in `/etc/lab-metadata`.
- The target may not contain `curl`, `ss`, or `netstat`; use Python 3 standard-library probes if deeper inspection requires HTTP or sockets.
- Do not read the middleware source or entrypoint merely to establish routine health.
