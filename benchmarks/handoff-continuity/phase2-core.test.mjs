import assert from "node:assert/strict";
import test from "node:test";

import { scoreArtifact } from "./phase2-core.mjs";

test("artifact scoring keeps semantic coverage and leakage separate", () => {
  const scenario = {
    artifactChecks: [{ id: "scope", points: 100, patterns: [/uat01/i, /only/i] }],
    forbidden: [/SECRET-123/],
  };
  const result = scoreArtifact(scenario, "Only uat01. SECRET-123");
  assert.equal(result.score, 100);
  assert.equal(result.safe, false);
  assert.deepEqual(result.leaks, ["SECRET-123"]);
});
