# Monitoring lab

An isolated Ubuntu workstation connected to an Icinga 2 master, a Nagios Core
master, an SSH bastion, and ten disposable mock hosts. Its purpose is to test
generic agent tools before they are installed on the work WSL machine.

Work-specific procedures do not belong here. The work machine's skills define
what must be done and where; this lab validates only transport behavior,
skill discovery, incident reasoning, execution ergonomics, and context cost. The synthetic
`lab-middleware-health` skill is a lab fixture that stands in for those work
skills; it is not installed by `pi-tools` or the workstation dotfiles.

## Workstation baseline

The workstation contains:

- Ubuntu 24.04 and Bash 5.2;
- the mounted Protocol Ink dotfiles for shell, Neovim, and Zellij;
- Pi pinned by the mounted `pi-tools` repository;
- the repository-owned stateless `ssh_exec` tool;
- the generic `incident-investigation` reasoning skill; and
- the lab-only `lab-middleware-health` test skill.

There are no third-party Pi extensions or packages. Protocol Ops, Tura-derived
runbooks, task/checkpoint state, permission packages, reviewer agents, `hop`,
`peek`, `kb`, `pulse`, and `pi-safe` are absent.

`ssh_exec` takes a literal host on every call. A user can write “inspect
lab-prod-app01” or describe a multi-host task normally; Pi needs no `/ssh`
command, active-host mode, or picker. Output is bounded before it enters model
context.

## Architecture

```text
work skill (work WSL only)
          |
          v
Pi reasoning -> ssh_exec(host, command) -> SSH bastion -> target hosts
          |
          +---- Protocol Ink terminal / Neovim / Zellij

Icinga 2 master -------------------------------> target hosts
Nagios Core ----------------------------------> target hosts
```

The mock inventory contains production-like, test, and development hosts with
middleware, web, messaging, and database roles. It is synthetic and isolated.

## Enter the lab

With the companion launcher installed:

```sh
lab
```

Or from this checkout:

```sh
./bin/lab
```

The first run generates a disposable SSH identity, builds or starts the stack,
waits for health checks, and creates a Zellij session inside Ubuntu. Run `pi`
and complete `/login` once. Authentication persists across `lab down` and
`lab rebuild`, but not across `lab reset`.

Test the intended interaction by typing a normal request:

```text
Inspect lab-prod-app01 and report its middleware health.
```

The agent should call `ssh_exec` directly. It should never ask for an SSH mode
or invoke the raw `ssh` executable through local Bash. For this specific
prompt, it should load `lab-middleware-health`, run the installed monitoring
plugin in one remote call, and return a concise result.

## Commands

```sh
lab up
lab rebuild
lab status
lab hosts
lab ssh lab-prod-app01
lab shell icinga
lab shell nagios
lab logs workstation
lab fail lab-prod-app01 app
lab heal lab-prod-app01
lab verify
lab benchmark incidents --static-only
lab benchmark incidents
lab down
lab reset --yes
```

`lab down` retains container volumes and workstation state. `lab reset --yes`
deletes the isolated containers, volumes, disposable SSH keys, Pi login, and
workstation home.

## Incident benchmark

`lab benchmark incidents` seeds one fault at a time on a disposable target,
asks Pi to investigate without making changes, verifies that the fixture was
not mutated, and cleans up before the next case. The scenario definitions and
answer checks stay on the Docker host; they are never mounted into the
workstation container or exposed to Pi.

The report records root-cause evidence, unsafe or mutating behavior, SSH call
count, elapsed time, and model cost. Results are written beneath
`$MONITORING_LAB_STATE/benchmarks/incidents`. The suite covers hidden bytes,
permissions, configuration precedence, environment and protocol mismatches,
wrong endpoints, and stale evidence. Useful focused and comparative runs
include:

```sh
lab benchmark incidents --cases hidden-cr
lab benchmark incidents --limit 1 --thinking high
lab benchmark incidents --fixtures-only
lab benchmark incidents --thinking high --run-id high
lab benchmark incidents --thinking xhigh --run-id xhigh
```

`high` is the intentional routine default. Treat `xhigh` as a candidate to
benchmark against the same cases, not an automatic upgrade: additional
reasoning is useful only when it produces a measurable correctness gain.

## Monitoring endpoints

- Icinga API: `https://127.0.0.1:15665`
- Nagios UI: `http://127.0.0.1:18081/nagios/`

The launcher opens the same ports through SSH tunnels when the stack runs on a
remote host.

Disposable lab credentials:

- Icinga: `lab` / `monitoring-lab`
- Nagios: `nagiosadmin` / `monitoring-lab`

## Runtime overrides

```sh
export MONITORING_LAB_HOME="$HOME/src/monitoring-lab"
export MONITORING_LAB_STATE="$HOME/.local/state/monitoring-lab"
export MONITORING_LAB_DOCKER_CONTEXT=my-context
export MONITORING_LAB_DOTFILES="$HOME/dotfiles"
export MONITORING_LAB_PI_TOOLS="$HOME/pi-tools"
```

The launcher discovers `dotfiles` and `pi-tools` in normal home/Documents
locations or beside this repository. Explicit overrides win.

## Isolation notes

The workstation has a named persistent home volume. Dotfiles and `pi-tools` are
mounted read-only under `/opt`. No personal SSH key, Docker socket, privileged
container, host networking, or host home directory is mounted. The workstation
drops Linux capabilities and uses a read-only root filesystem.

The environment reproduces Ubuntu userland, Bash, SSH, Neovim, Zellij, and the
agent installation. It does not emulate `wsl.exe`, PowerShell integration,
Windows clipboard behavior, systemd-enabled WSL boot, or Windows Terminal
rendering.
