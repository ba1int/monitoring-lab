# Monitoring lab

An isolated Ubuntu workstation connected to an Icinga 2 master, a Nagios Core
master, an SSH bastion, and thirteen disposable mock hosts. Its purpose is to test
generic agent tools before they are installed on the work WSL machine.

Work-specific procedures do not belong here. The work machine's skills define
what must be done and where; this lab validates only transport behavior,
skill discovery, incident reasoning, execution ergonomics, and context cost. The synthetic
`lab-middleware-health` and `lab-host-onboarding` skills are lab fixtures that
stand in for those work skills; neither is installed by `pi-tools` or the
workstation dotfiles.

## Workstation baseline

The workstation contains:

- Ubuntu 24.04 and Bash 5.2;
- the mounted Protocol Ink dotfiles for shell, Neovim, and Zellij;
- Pi pinned by the mounted `pi-tools` repository;
- the mounted Study Room for terminal-native operational lessons;
- the repository-owned stateless `ssh_exec` tool;
- the repository-owned zero-token low/high thinking router;
- the repository-owned native-compaction context sentinel;
- the repository-owned zero-token task ledger and Zellij viewer;
- the generic `incident-investigation` reasoning skill; and
- the lab-only `lab-middleware-health` and `lab-host-onboarding` test skills.

There are no third-party Pi extensions or packages. Protocol Ops, Tura-derived
runbooks, durable task/checkpoint orchestration, permission packages, reviewer
agents, `hop`, `peek`, `kb`, `pulse`, and `pi-safe` are absent. The task ledger
is a bounded local display snapshot; it does not inject prompts or control Pi.

`ssh_exec` takes a literal host on every call. A user can write “inspect
lab-prod-app01” or describe a multi-host task normally; Pi needs no `/ssh`
command, active-host mode, or picker. Output is bounded before it enters model
context.

Interactive Pi routes bounded runbook execution to `low` and open-ended
incidents or runbook engineering to `high`. It escalates from low to high on
SSH transport errors and timeouts, or when a remote checkpoint fails after a
mutation. Benchmark subprocesses disable this router so explicit `--thinking`
comparisons remain controlled.

## Architecture

```text
work skill (work WSL only)
          |
          v
Pi reasoning -> ssh_exec(host, command) -> SSH bastion -> target hosts
          |
          +---- local task events -> Ctrl+o i task ledger
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
lab benchmark remote-dc-onboarding --static-only
lab benchmark remote-dc-onboarding
lab benchmark model-matrix --profile screen --cases runtime-config-drift
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
wrong endpoints, stale evidence, runtime-versus-disk drift, release symlinks,
cross-host dependency chains, and monitoring-command drift. Incident results
retain pass/fail for strict correctness and also award up to 100 checkpoint
points so partial diagnosis remains visible. Useful focused runs include:

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

## Model decision matrix

`lab benchmark model-matrix` runs identical scenarios across explicit model and
thinking candidates. It reports average and minimum checkpoint score, variance,
strict success, safety, completion, remote calls, cost, and latency. A Pareto
marker identifies candidates that are not simultaneously beaten on quality,
safety, cost, and time; it is a shortlist rather than an automatic winner.

Start with one pass over the four discrimination cases:

```sh
CASES=runtime-config-drift,symlink-release-drift,dependency-chain,monitor-command-drift
lab benchmark model-matrix --profile screen --cases "$CASES" --run-id screen-01
```

The `screen` profile compares Luna, Terra, and Sol at low and high. The `deep`
profile expands all three families across low, medium, high, and xhigh; it is
deliberately opt-in because twelve candidates over a full suite is expensive.
After screening, repeat only the non-dominated candidates three times:

```sh
lab benchmark model-matrix \
  --candidates openai-codex/gpt-5.6-luna:low,openai-codex/gpt-5.6-terra:high,openai-codex/gpt-5.6-sol:high \
  --cases "$CASES" --repeats 3 --run-id confirm-01
```

Results live beneath `$MONITORING_LAB_STATE/benchmarks/model-matrix`. Matrix
runs rotate candidate order between repeats to reduce order bias. Scenario
truth and scorecards remain outside the workstation container.

The matrix defaults to two concurrent model runs, leaving headroom for one
Codex task and one interactive Pi session. Per-host fixture locks let independent
incident cases overlap while automatically serializing any cases that touch the
same mock host. Use `--jobs 1` for a fully serial run; values above two are
rejected deliberately.

When score patterns change, re-evaluate saved sessions without another model
call:

```sh
lab benchmark model-matrix --rescore screen-01
```

## Remote-datacenter onboarding benchmark

`lab benchmark remote-dc-onboarding` evaluates actual cross-host change work:
a dc2 target is wired through an OpenVPN relay and Icinga satellite to the dc1
master. The suite has four fixtures: full onboarding, a missing client
`iroute`, a missing server `route`, and a stale satellite assignment.

The first four cases are calibration scenarios with stable dc2 values. Four
hard-tier cases remove that advantage: an unfamiliar `/23` and zone, a
conflicting VPN owner that requires a safe stop, duplicated partial state, and
a downstream trust failure that requires exact rollback.

The onboarding skill contains only the generic procedure. Hostnames, networks,
prefixes, clients, sites, and zones come from each target's assignment and are
not fixed in agent-visible instructions.

The OpenVPN fixture validates control-plane semantics without giving containers
privileged TUN devices. Pi works over normal SSH with passwordless `sudo`, just
as it would follow a work runbook on WSL. Scenario truth stays on the Docker
host and is not mounted into the workstation.

This is deliberately not pass/fail. Each scenario awards up to 100 points at
weighted checkpoints for discovery, correct changes, preserved state,
validation, and rollback reporting. Hard safety flags—out-of-scope hosts,
dangerous commands, target mutation, or damaged canaries—are shown separately
and cannot be hidden by a high score.

```sh
lab benchmark remote-dc-onboarding --fixtures-only
lab benchmark remote-dc-onboarding --cases missing-iroute
lab benchmark remote-dc-onboarding --thinking high --run-id high
lab benchmark remote-dc-onboarding --thinking xhigh --run-id xhigh
lab benchmark remote-dc-onboarding --rescore high
```

Run only the generalization tier with:

```sh
HARD_CASES=generalized-full,ownership-conflict,partial-duplicate,validator-rollback
lab benchmark remote-dc-onboarding --cases "$HARD_CASES" --thinking high --run-id hard-high
lab benchmark remote-dc-onboarding --cases "$HARD_CASES" --thinking medium --run-id hard-medium
lab benchmark remote-dc-onboarding --cases "$HARD_CASES" --thinking low --run-id hard-low
```

The router-discrimination tier adds failure modes where blindly completing the
runbook is not enough: a one-shot transport interruption, a concurrent operator
edit, stale ticket data that conflicts with live assignment data, and an
unsupported active-active topology whose correct outcome is escalation.

```sh
ROUTER_CASES=transient-resume,concurrent-drift,misleading-ticket,unsupported-topology
lab benchmark remote-dc-onboarding --cases "$ROUTER_CASES" --fixtures-only
lab benchmark model-matrix \
  --suite remote-dc-onboarding \
  --candidates openai-codex/gpt-5.6-luna:medium,openai-codex/gpt-5.6-sol:high \
  --cases "$ROUTER_CASES" \
  --run-id router-discrimination
```

These scenarios evaluate whether a cheaper first-line model can recover,
preserve shared state, reject stale instructions, and stop for escalation. They
do not by themselves validate an automatic router; compare a staged
Luna-to-Sol policy against always-Sol after the individual model behavior is
repeatable.

Run the installed Pi router itself with:

```sh
lab benchmark remote-dc-onboarding \
  --router \
  --cases misleading-ticket,unsupported-topology \
  --run-id router-e2e
```

Router runs record `model_sequence` for selections and `model_usage_sequence`
for models that actually produced assistant output. Use the latter to verify a
Luna-to-Sol retry or a Luna-only legitimate stop without mistaking Pi's initial
configured model for a routed call.

`--rescore` re-evaluates report wording and tool-use checkpoints from saved
sessions while retaining the state checks captured before fixture cleanup. It
does not call a model or pretend to re-check state that no longer exists.

Results are written beneath
`$MONITORING_LAB_STATE/benchmarks/remote-dc-onboarding`.

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
export MONITORING_LAB_STUDY_ROOM="$HOME/study-room"
```

The launcher discovers `dotfiles`, `pi-tools`, and `study-room` in normal
home/Documents locations or beside this repository. Explicit overrides win.

## Isolation notes

The workstation has a named persistent home volume. Dotfiles, `pi-tools`, and
`study-room` are mounted read-only under `/opt`. No personal SSH key, Docker
socket, privileged container, host networking, or host home directory is
mounted. The workstation drops Linux capabilities and uses a read-only root
filesystem.

The environment reproduces Ubuntu userland, Bash, SSH, Neovim, Zellij, and the
agent installation. It does not emulate `wsl.exe`, PowerShell integration,
Windows clipboard behavior, systemd-enabled WSL boot, or Windows Terminal
rendering.
