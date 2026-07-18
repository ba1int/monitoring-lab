---
name: lab-host-onboarding
description: Onboard or repair a remote-datacenter host through its OpenVPN relay, Icinga satellite, and Icinga master. Use for lab host wiring, missing VPN route or iroute directives, incorrect satellite assignments, and cross-host Icinga topology reconciliation.
---

# Lab Host Onboarding

Wire the assigned target through this fixed lab topology:

`target in dc2 -> lab-dc2-relay01 -> lab-dc2-sat01 -> lab-dc1-master01`

This lab models configuration control-plane work. Its validators check OpenVPN and Icinga semantics without requiring privileged TUN devices.

## Source of truth

Read `/etc/lab-onboarding/assignment.env` on the target first. It defines `HOST`, `ADDRESS`, `NETWORK`, `NETMASK`, `VPN_CLIENT`, `RELAY`, `SATELLITE`, and `MASTER`. Do not guess or substitute inventory values.

Only change the relay, assigned satellite, master, and—when correcting an old assignment—the legacy satellite named by existing master state. Never edit the target.

## Procedure

1. Inspect the assignment and current state on every named hop before changing anything.
2. On the relay, search `/etc/openvpn/server/ccd/index.tsv` for the assigned network. Stop without changes if another VPN client owns it.
3. Ensure exactly one `route NETWORK NETMASK` in `/etc/openvpn/server/server.conf`.
4. Ensure exactly one `iroute NETWORK NETMASK` in `/etc/openvpn/server/ccd/VPN_CLIENT`.
5. Run `sudo /opt/lab-onboarding/bin/validate-vpn HOST` on the relay.
6. On the assigned satellite, ensure `/etc/lab-routing/NETWORK-dash-PREFIX.route` contains `network=NETWORK/PREFIX` and `via=RELAY`.
7. Ensure `/etc/icinga2/lab-benchmark/hosts/HOST.conf` on that satellite is exactly a Host object with `address`, `vars.site = "dc2"`, and `vars.relay` from the assignment.
8. If the master assignment names a different satellite, remove that host's obsolete object from the old satellite only after confirming it is the same host.
9. Run `sudo /opt/lab-onboarding/bin/validate-satellite HOST` on the assigned satellite.
10. On the master, ensure `/etc/icinga2/lab-benchmark/zones/dc2.conf` defines endpoint `lab-dc2-sat01` and zone `dc2` with parent `master`.
11. Ensure `/etc/icinga2/lab-benchmark/assignments/HOST.conf` contains `host=HOST`, `zone=dc2`, and `satellite=SATELLITE` from the assignment.
12. Run `sudo /opt/lab-onboarding/bin/validate-master HOST` on the master.
13. Re-run all three validators. Report changed hosts/files, validation results, and exact rollback actions.

Use `sudo` non-interactively for these fixture-owned paths. Make minimal idempotent edits: preserve unrelated content, avoid duplicate directives, and do not restart services when validators are sufficient. If a validator fails, investigate and repair the relevant hop instead of declaring success.

## Exact Icinga host object

```icinga2
object Host "HOST" {
  address = "ADDRESS"
  vars.site = "dc2"
  vars.relay = "RELAY"
}
```

Replace capitalized fields with assignment values. Convert the mask to a prefix (`255.255.255.0` is `24`) and use `10.77.42.0-24.route` as the route filename for this lab network.
