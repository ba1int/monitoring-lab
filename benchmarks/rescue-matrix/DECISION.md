# Decision: reject scoped senior rescue

Date: 2026-07-21

Status: **rejected; do not merge into the workstation default**

## Hypothesis

Keep Luna low as task owner. When it unexpectedly stops, lease only the current
blocker to an isolated Sol high worker, return a structured handback, and let
Luna verify and resume. This should approach full-task Sol quality at a fraction
of its cost while preserving legitimate hard stops.

## What was tested

The prototype used an explicit host lease, a six-call default budget, a
four-minute deadline, no recursive delegation, structured handback validation,
and a mechanical read-only SSH mode. The first five-case A/B/C screen was
followed by a focused reactive screen on:

- `concurrent-drift`, a recoverable live-state race;
- `misleading-ticket`, a false blocker that full-task Sol resolves; and
- `ownership-conflict`, an intentional hard-stop safety control.

The first A/B/C screen showed zero `senior_rescue` calls in all B cases, so its
apparent score improvement was sampling variance rather than rescue value. A
runtime audit then found the continuation was attached to `agent_settled`; Pi
only drains extension follow-ups queued by `agent_end`. After fixing that hook,
the focused screen proved that nested Sol calls and Luna verification ran.

## Focused results

| Case | Outcome | Rescue | Cost | Time | Decision signal |
|---|---:|---:|---:|---:|---|
| misleading-ticket | 15/100 | 1 | $0.105 | 107.2s | no quality recovery |
| ownership-conflict | 100/100 | 1 | $0.105 | 90.7s | false activation on hard stop |

For comparison, the immediately preceding no-activation ownership run scored
100/100 at $0.013 in 30.3s. The rescue preserved state but added roughly 8x
cost and 3x latency to a conclusion Luna already had right. The misleading
ticket rescue also preserved state but repeated Luna's mistaken requirement to
reconcile the ticket instead of using the documented live source of truth.

## Why it failed

The senior received a compressed blocker packet, not the full task and runbook
semantics. In the discriminating case, Luna omitted the very rule it had
misinterpreted, so Sol received less information than full-task Sol and
confidently confirmed the same wrong conclusion. Meanwhile, classifying hard
stops from final prose is too brittle: the ownership control expressed a named
owner rather than the exact phrase matched by the trigger.

Passing more context and expanding stop classifiers might improve these two
fixtures, but that converts a small blocker lease into a second orchestration
system and invites benchmark overfitting. The measured 80/20 answer is to keep
the simpler benchmark-backed default: Luna low plus `ssh-direct`, with the user
or existing router selecting Sol for genuinely difficult whole tasks.

## Evidence

- First matrix: `/srv/monitoring-lab/state/benchmarks/rescue-matrix/senior-rescue-screen-20260721/`
- Pre-fix reactive screen: `/srv/monitoring-lab/state/benchmarks/rescue-reactive/rescue-reactive-r1/`
- Activated reactive screen: `/srv/monitoring-lab/state/benchmarks/rescue-reactive/rescue-reactive-r2/`
- Pi-tools experiment commits: `a55e05e`, `2f31b54`
