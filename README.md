# Monitoring lab

A disposable SSH-first playground for operating Icinga, Nagios Core, and ten
mock Linux hosts. It is deliberately Docker Compose rather than Kubernetes:
the point is to practice host and middleware operations, not maintain a lab
control plane.

## Topology

```text
terminal -> 127.0.0.1:2222 -> SSH bastion -> ten mock hosts
                                      ^              ^
                                      |              |
                                Icinga 2          Nagios Core
```

Each host runs key-only SSH plus a tiny stateful middleware check. Icinga and
Nagios resolve the same Compose DNS names, use SSH for host reachability, and
run `/usr/local/libexec/check_lab_middleware` remotely. The target state can be
`ok`, `warning`, or `critical` without making SSH disappear.

Only loopback ports are published:

- SSH bastion: `127.0.0.1:2222`
- Icinga API: `https://127.0.0.1:15665`
- Nagios UI: `http://127.0.0.1:18081/nagios/`

Lab-only credentials are `lab / monitoring-lab` for the Icinga API and
`nagiosadmin / monitoring-lab` for Nagios.

## Enter the lab

With the companion dotfiles launcher installed, run this from anywhere:

```sh
lab
```

The first run generates a dedicated SSH identity, starts the container runtime
and Compose services, waits for health checks, and creates or resumes the
`monitoring-lab` Zellij session. Running `lab` inside an existing Zellij
session focuses or adds the lab tabs instead of nesting another session.

The project also works without the dotfiles wrapper:

```sh
./bin/lab
```

Useful operations:

```sh
lab hosts
lab status
lab ssh lab-prod-app01
ssh lab-prod-app01

lab fail lab-prod-app01 app
lab fail lab-prod-app01 app warning
lab fail lab-prod-app01 host
lab heal lab-prod-app01

lab logs icinga
lab shell nagios
lab verify
lab rebuild
lab down
```

Direct aliases such as `ssh lab-prod-app01` work when the dotfiles installer has
added the optional `~/.config/monitoring-lab/ssh_config` include. Only the ten
inventory names are generated; unrelated `lab-*` SSH names are left alone.
`lab ssh HOST` always uses the generated lab config explicitly.

## Runtime

On macOS the launcher uses a dedicated Colima profile named `monitoring-lab`:

```sh
brew install colima docker docker-compose docker-buildx
```

On WSL 2, enable the distribution in Docker Desktop's WSL Integration. The
same Compose project then runs against the current Docker context; Colima is
not required.

Override project/runtime locations when needed:

```sh
export MONITORING_LAB_HOME="$HOME/src/monitoring-lab"
export MONITORING_LAB_STATE="$HOME/.local/state/monitoring-lab"
export MONITORING_LAB_DOCKER_CONTEXT=my-context
```

## Inventory

The ten hosts span production-like, test, and development metadata without
claiming to model a real company network. The source of truth is
`inventory/hosts.tsv`.

Containers intentionally do not run systemd or pretend to be complete virtual
machines. If a future exercise needs journald, boot ordering, kernel behavior,
or package-manager recovery, add one real Linux VM as a separate profile rather
than making all ten containers privileged.

## Safety and state

Generated keys, host states, and known-host records live in ignored `.state/`.
The directory carries a lab-owned safety marker, and `lab reset` refuses to
delete an unmarked or unsafe path. No personal SSH key, Docker socket,
privileged container, host networking, or fixed container address is used.
`lab down` retains state; `lab reset` removes containers, volumes, keys, and
injected failures.

The Icinga image is pinned to the maintained multi-architecture
`icinga/icinga2:2.16.4` image. Nagios is built natively from pinned official
Nagios Core 4.5.13 and Nagios Plugins 2.5 source because the old published
Nagios container is unsuitable for a current ARM64 lab.
