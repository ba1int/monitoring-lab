# Monitoring lab

A disposable SSH-first playground for operating Icinga, Nagios Core, and ten
mock Linux hosts. It is deliberately Docker Compose rather than Kubernetes:
the point is to practice host and middleware operations, not maintain a lab
control plane.

## Topology

```text
Ghostty / Windows Terminal
          |
          v
Ubuntu 24.04 workstation -> SSH bastion -> ten mock hosts
          |                       ^              ^
          |                       |              |
          +------------------ Icinga 2      Nagios Core
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
`monitoring-lab` Zellij session **inside an Ubuntu 24.04 container**. Every tab
therefore runs Linux Zellij and a Bash 5.2 login shell rather than inheriting
the Mac's zsh. The container links the same Protocol Ink Neovim, Zellij, and
shell configuration that will be used in WSL.

The workstation has its own persistent Linux home volume. The dotfiles checkout
is mounted at `/opt/dotfiles` as a read-only source, and no personal SSH keys or
host home directory are mounted. Use `Ctrl-o d` to detach and return to the host
without destroying the session. `lab` attaches to it again next time.

When `lab` is launched from an existing macOS Zellij session, the outer session
temporarily enters locked mode so its keybindings do not steal `Ctrl-o` from the
inner Linux session. `Ctrl-g` deliberately returns control to the outer Zellij;
the launcher restores its normal mode after the inner session detaches.

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
export MONITORING_LAB_DOTFILES="$HOME/dotfiles"
```

The dotfiles checkout is discovered automatically at `~/dotfiles` (the WSL
clone-and-run location) or `~/Documents/setup` (this Mac). The explicit
`MONITORING_LAB_DOTFILES` override wins.

## Inventory

The ten hosts span production-like, test, and development metadata without
claiming to model a real company network. The source of truth is
`inventory/hosts.tsv`.

The workstation faithfully exercises Ubuntu userland, Bash, SSH, Neovim,
Zellij, GNU paths, and the mounted dotfiles. It does not emulate `wsl.exe`,
PowerShell interop, the Windows clipboard bridge, a systemd-enabled WSL boot, or
Windows Terminal rendering. The ten target containers also intentionally do
not pretend to be complete virtual machines. Exercises that need journald,
kernel behavior, or boot ordering belong in a separate real Linux VM profile.

## Safety and state

Generated keys, host states, and known-host records live in ignored `.state/`.
The directory carries a lab-owned safety marker, and `lab reset` refuses to
delete an unmarked or unsafe path. No personal SSH key, Docker socket,
privileged container, host networking, or fixed container address is used.
The workstation runs without Linux capabilities, with a read-only root
filesystem; only its named home volume is writable. `lab down` retains state
and that Linux home. `lab reset` removes containers, volumes, keys, the home,
and injected failures.

The workstation image pins Neovim 0.12.4, Zellij 0.44.3, and fzf 0.72.0 for both
ARM64 and x86_64. Release archives are SHA-256 verified during the build, so the
same Compose source works on Apple Silicon at home and the usual x86_64 WSL
workstation at work.

The Icinga image is pinned to the maintained multi-architecture
`icinga/icinga2:2.16.4` image. Nagios is built natively from pinned official
Nagios Core 4.5.13 and Nagios Plugins 2.5 source because the old published
Nagios container is unsuitable for a current ARM64 lab.
