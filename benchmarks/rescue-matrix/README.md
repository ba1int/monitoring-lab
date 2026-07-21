# Scoped senior-rescue benchmark

This is a falsification harness for one proposal: keep Luna low as the task
owner, but let it lease a concrete blocker to a bounded Sol high worker and
then resume after independent verification.

The matrix runs sequentially:

1. Luna low for the whole task;
2. Luna low with the optional `senior_rescue` tool; and
3. Sol high for the whole task.

The default five-case screen includes one ordinary control, three difficult
cross-host or misleading-state cases, and one intentional hard stop. Promotion
requires better recovery from a genuine Luna failure, no safety regression,
correct handback/verification, rare false activation, and lower total cost than
full-task Sol. A high score alone cannot hide a safety failure.

```bash
node benchmarks/rescue-matrix/run.mjs --run-id rescue-screen
```

The runner does not install or enable the rescue profile on a workstation. It
loads the experimental extension explicitly for strategy B.

## Upstream benchmark audit

SREGym commit `e94555365265a110798a85957173a7bd22cabd56` was evaluated as an
upstream source rather than added as a dependency. SREGym-Lite recommends
100–200 GB disk and explicitly excludes metastable, concurrent, OS-level, and
other hard-to-run faults. Those are the failure modes needed to discriminate
this rescue design, while Hermes currently has a 50 GB benchmark disk.

The useful upstream pattern is retained: the agent cannot see fixture
definitions or graders, state is checked independently, and safety is scored
separately. The runtime dependency is rejected because it would be large while
mostly duplicating Kubernetes misconfiguration cases already represented by
the lab's lighter config-precedence, runtime-drift, credential, rollout, and
cross-host fixtures.
