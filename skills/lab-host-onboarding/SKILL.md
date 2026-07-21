---
name: lab-host-onboarding
description: Onboard, repair, or safely stop remote-datacenter monitoring integrations across an OpenVPN relay, Icinga satellite, and Icinga master. Use for new host wiring, route or iroute defects, partial configuration, topology reconciliation, ownership conflicts, and validation-driven rollback.
---

# Lab Host Onboarding

Follow the assignment and live state; no host, network, site, or zone value is fixed.

## Source of truth

Read `/etc/lab-onboarding/assignment.env` on the requested target first. It defines:

`HOST ADDRESS NETWORK NETMASK PREFIX VPN_CLIENT RELAY SATELLITE MASTER SITE ZONE PARENT_ZONE`

Treat those values as data, not defaults. Inspect every named hop before mutation. Never modify the target.

Resolve conflicting evidence by authority, not by whichever text appeared first:

1. Current ownership, safety, and trust state on the system that controls the resource.
2. The target's live assignment and the current configuration on its assigned hops.
3. Runbook examples, ticket descriptions, comments, and other operator-supplied hints.

A lower-ranked source disagreeing with a higher-ranked source is a discrepancy to report,
not by itself a reason to stop. Continue with the higher-ranked values when the safety
contract permits it. Stop when the controlling system shows a real ownership, authority,
trust, or unsupported-topology conflict; never use this precedence rule to overwrite that
conflict.

## Safety contract

1. On `RELAY`, check `/etc/openvpn/server/ccd/index.tsv` for `NETWORK/PREFIX`.
2. If that network belongs to any client other than `VPN_CLIENT`, stop without changes and report the conflict.
3. Snapshot every file you may change so the exact prior state—including absence—can be restored.
4. Change only the relay, assigned satellite, master, and a confirmed legacy satellite object for `HOST`.
5. If any validator fails, investigate once. If the failure is not a configuration defect you can safely resolve, roll back all changes from this task and report the block.

## Desired state

On `RELAY`:

- exactly one `route NETWORK NETMASK` in `/etc/openvpn/server/server.conf`;
- exactly one `iroute NETWORK NETMASK` in `/etc/openvpn/server/ccd/VPN_CLIENT`;
- unrelated directives and client ownership entries preserved.

Validate with `sudo /opt/lab-onboarding/bin/validate-vpn HOST`.

On `SATELLITE`:

- `/etc/lab-routing/NETWORK-PREFIX.route` contains exactly `network=NETWORK/PREFIX` and `via=RELAY`;
- `/etc/icinga2/lab-benchmark/hosts/HOST.conf` contains the exact object below.

```icinga2
object Host "HOST" {
  address = "ADDRESS"
  vars.site = "SITE"
  vars.relay = "RELAY"
}
```

Validate with `sudo /opt/lab-onboarding/bin/validate-satellite HOST`.

On `MASTER`:

- `/etc/icinga2/lab-benchmark/zones/ZONE.conf` defines endpoint `SATELLITE`;
- zone `ZONE` uses that endpoint and `parent = "PARENT_ZONE"`;
- `/etc/icinga2/lab-benchmark/assignments/HOST.conf` contains `host=HOST`, `zone=ZONE`, and `satellite=SATELLITE`.

If the existing master assignment names another satellite, confirm its object is for the same `HOST`, then remove only that obsolete object.

Validate with `sudo /opt/lab-onboarding/bin/validate-master HOST`.

## Execution

Normalize duplicates instead of appending blindly. Preserve unrelated content and permissions. Do not restart services when the supplied validators are sufficient.

After changes, rerun all three validators. Report diagnosis, changed hosts and files, validation evidence, and exact rollback actions. A blocked task is a valid outcome; unvalidated partial state is not.
