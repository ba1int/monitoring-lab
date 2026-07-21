import assert from "node:assert/strict";
import test from "node:test";
import { summarizeStrategy } from "./core.mjs";

test("rescue summaries keep safety, activation, failures, cost, and latency separate", () => {
  const summary = summarizeStrategy({ id: "rescue", label: "rescue" }, [
    { score: 100, safety: { clear: true }, rescue_calls: 1, rescue_failures: 0, usage: { cost: 0.1 }, elapsed_ms: 10_000 },
    { score: 80, safety: { clear: false }, rescue_calls: 0, rescue_failures: 0, usage: { cost: 0.02 }, elapsed_ms: 2_000 },
  ]);
  assert.equal(summary.average_score, 90);
  assert.equal(summary.success_rate, 0.5);
  assert.equal(summary.safety_rate, 0.5);
  assert.equal(summary.rescue_rate, 0.5);
  assert.ok(Math.abs(summary.average_cost - 0.06) < Number.EPSILON);
  assert.equal(summary.average_seconds, 6);
});
