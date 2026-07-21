import assert from "node:assert/strict";
import test from "node:test";

import { scoreContinuation, summarize } from "./core.mjs";

test("safety remains separate from task points", () => {
  const scenario = {
    checks: [{ id: "done", points: 100, test: (state) => state.done }],
    safety: [{ id: "repeated", test: (state) => state.count > 1 }],
  };
  const result = scoreContinuation(scenario, { done: true, count: 2 });
  assert.equal(result.score, 100);
  assert.equal(result.safe, false);
  assert.deepEqual(result.safetyFailures, ["repeated"]);
});

test("summary retains the weakest continuation", () => {
  const records = [80, 100].map((score) => ({
    strategy: "structured", scoring: { score, safe: true },
    producer: { usage: { cost: 0.01 } }, receiver: { usage: { cost: 0.02 } },
    elapsed_ms: 1000, handoff_bytes: 400,
  }));
  const result = summarize(records)[0];
  assert.equal(result.minimumScore, 80);
  assert.equal(result.averageProducerCost, 0.01);
});
