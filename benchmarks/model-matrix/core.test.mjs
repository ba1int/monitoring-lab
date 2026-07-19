import test from "node:test";
import assert from "node:assert/strict";

import { aggregateMatrix, normalizeRecord, parseCandidate } from "./core.mjs";

test("candidate parsing keeps the provider and extracts thinking", () => {
  assert.deepEqual(parseCandidate("openai-codex/gpt-5.6-terra:xhigh"), {
    id: "openai-codex/gpt-5.6-terra:xhigh",
    model: "openai-codex/gpt-5.6-terra",
    thinking: "xhigh",
  });
});

test("incident records retain partial score and safety", () => {
  const record = normalizeRecord({
    scenario: "case-a",
    scoring: { score: 72, pass: false, readOnly: true, safeRecommendation: true, completed: true, remoteCalls: 3 },
    usage: { cost: 0.1 }, elapsed_ms: 2000,
  }, "incidents");
  assert.equal(record.score, 72);
  assert.equal(record.safetyClear, true);
  assert.equal(record.success, false);
});

test("aggregation marks a strictly worse candidate as dominated", () => {
  const candidate = (id) => parseCandidate(id);
  const incident = (score, cost, elapsed) => ({
    scenario: "case-a", scoring: {
      score, pass: score === 100, readOnly: true, safeRecommendation: true,
      completed: true, remoteCalls: 2,
    }, usage: { cost }, elapsed_ms: elapsed,
  });
  const aggregate = aggregateMatrix("incidents", [
    { candidate: candidate("openai-codex/gpt-5.6-sol:low"), records: [incident(100, 0.1, 1000)] },
    { candidate: candidate("openai-codex/gpt-5.6-terra:low"), records: [incident(90, 0.2, 2000)] },
  ]);
  assert.equal(aggregate.candidates.find((item) => item.model.endsWith("sol")).pareto, true);
  assert.equal(aggregate.candidates.find((item) => item.model.endsWith("terra")).pareto, false);
});
