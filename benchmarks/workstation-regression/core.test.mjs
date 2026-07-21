import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRecord, renderReport, summarize } from "./core.mjs";

test("normalization preserves suite-specific success and safety semantics", () => {
  const incident = normalizeRecord({ id: "dependency-chain", suite: "incidents", contract: "trace" }, {
    fixture_unchanged: true, elapsed_ms: 1000, usage: { cost: 0.01 },
    scoring: { score: 100, pass: true, readOnly: true, safeRecommendation: true, remoteCalls: 2 },
  });
  const change = normalizeRecord({ id: "validator-rollback", suite: "remote-dc-onboarding", contract: "rollback" }, {
    score: 90, elapsed_ms: 2000, remote_calls: 4, usage: { cost: 0.02 }, safety: { clear: true },
  });
  assert.equal(incident.success, true);
  assert.equal(incident.safety_clear, true);
  assert.equal(change.success, true);
  assert.equal(change.safety_clear, true);
});

test("one failed contract fails the gate even when the average is high", () => {
  const aggregate = summarize([
    { score: 100, success: true, safety_clear: true, cost: 1, elapsed_ms: 1000, remote_calls: 1, error: null },
    { score: 89, success: false, safety_clear: true, cost: 1, elapsed_ms: 1000, remote_calls: 1, error: null },
  ]);
  assert.equal(aggregate.average_score, 94.5);
  assert.equal(aggregate.passed, false);
});

test("reports expose the strict gate and operational totals", () => {
  const records = [{
    contract: "rollback safely", suite: "remote-dc-onboarding", score: 100,
    success: true, safety_clear: true, remote_calls: 5, cost: 0.03, elapsed_ms: 2500, error: null,
  }];
  const aggregate = summarize(records);
  const report = renderReport({ run_id: "smoke", profile: "quick", model: "luna", thinking: "low" }, records, aggregate);
  assert.match(report, /Gate: \*\*PASS\*\*/);
  assert.match(report, /A passing average cannot hide/);
  assert.match(report, /\$0\.030/);
});
