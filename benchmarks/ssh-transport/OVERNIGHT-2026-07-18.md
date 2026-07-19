# Overnight execution sprint — 2026-07-18

## Outcome

The sprint evaluated two candidates and retained both, triggering the requested
two-winner stop rule. No additional candidates were opened. Nothing was merged
to `main`, and `pi-sidetask` was not touched.

Review branches:

- `pi-tools`: `codex/overnight-exec-20260718`
  - `9a6fa53 Harden SSH failure and output semantics`
- `monitoring-lab`: `codex/overnight-exec-20260718`
  - `bd6ccb3 Benchmark SSH failure and output safety`
  - `1b98859 Fix hidden CR benchmark scoring`

The branch builds were deployed only to the isolated Hermes lab.

## Winner 1 — transport failure semantics

Baseline: an SSH transport failure returned exit `255`, but `ssh_exec` did not
distinguish it from a remote command exit. A bounded routine task therefore
remained on low thinking after DNS, authentication, host-key, refusal, or
connection-loss failures.

Acceptance threshold established before implementation:

- exact classification of all nine live/static cases;
- actual transport failures promote automatic thinking to `high`;
- an ordinary non-zero read-only remote command remains at its selected level;
- rendered context overhead is at most 40 bytes.

Measured result:

- classification: **9/9**;
- transport escalation: **pass**;
- ordinary remote-exit isolation: **pass**;
- maximum rendered overhead: **33 bytes**;
- real Pi check: `auto low · bounded routine operation` became
  `auto high · SSH transport failure` after a DNS failure;
- the tool result exposed `failure_kind: dns` and `transportError: true`.

## Winner 2 — terminal-safe remote output

Baseline: the real SSH path passed ANSI cursor/color sequences, OSC hyperlink
and clipboard writes, DCS strings, carriage returns, and backspaces into tool
output. The fixed malicious fixture contained 13 dangerous controls; the live
SSH fixture contained four.

Acceptance threshold established before implementation:

- zero dangerous controls in fixed and live fixtures;
- exact preservation of intended printable text;
- byte-for-byte preservation of normal Unicode/tab/newline output;
- no context growth.

Measured result:

- fixed dangerous controls: **13 → 0**;
- live dangerous controls: **4 → 0**;
- intended printable output: **exact match**;
- normal output: **unchanged**;
- malicious-fixture context delta: **−108 bytes**.

No visible component, command, mode, footer item, or persistent decoration was
added. Screenshots are therefore not applicable. The aesthetic effect is
protective: remote output can no longer recolor, reposition, hyperlink, or
write to the clipboard through the Protocol Ink terminal surface.

## Rejected or deliberately not reopened

- `ssh_facts`: 12 recorded skill-guided remote calls contained zero generic
  host-capability discovery calls. Adding it would raise a typical three-call
  investigation to four calls, roughly 33% more.
- generic fan-out: repeated arguments fell 78%, but bounded fan-out took about
  1.3 seconds versus about 0.5 seconds for existing parallel `ssh_exec` calls,
  and arbitrary fleet-wide Bash cannot be guaranteed read-only.
- file staging: agent-generated 16 KiB content saved 0% end to end and had
  essentially identical transfer latency. It remains useful only for a local
  file that already exists, which is not yet a demonstrated common workload.

## Verification

- `pi-tools`: **23/23** unit tests passed.
- Incident fixtures: **8** static scenarios validated.
- Remote-datacenter onboarding: **8** static scenarios validated; every
  scorecard totals 100 points.
- SSH transport benchmark: connection reuse, concurrency, dead-master
  recovery, failure semantics, and output safety passed.
- Full lab verification: Compose, workstation, every SSH alias, Icinga, Nagios,
  alert injection, and healing passed end to end.
- Real Pi transport check: routine low → transport-failure high passed.
- Original full high-thinking incident run: **7/8** passed. `hidden-cr` found
  the correct hidden byte, mechanism, fix, validation, and rollback but missed
  the old scorer's `causal-location` phrase. Follow-up commit `1b98859`
  replaced that wording check with a bounded causal relationship between the
  hidden byte and `UPSTREAM_HOST` or `middleware.env`. Its deterministic suite
  passes two valid phrasings and rejects two misleading near-matches (**11/11**
  scorer tests). A fresh model replay remains pending because Hermes did not
  accept a non-interactive SSH connection during the follow-up.

## Review

```bash
git -C ~/pi-tools show 9a6fa53
git -C ~/monitoring-lab show bd6ccb3
```

Run the deterministic acceptance suite with:

```bash
lab benchmark ssh-transport --json
```
