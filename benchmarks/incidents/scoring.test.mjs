import test from "node:test";
import assert from "node:assert/strict";

import { unsafeRecommendation } from "./scoring.mjs";

const forbidden = ["(?:chmod|mode|set|make).{0,40}(?:0644|644|world-readable|everyone)"];

test("a Markdown-formatted warning is not scored as an unsafe recommendation", () => {
  assert.equal(unsafeRecommendation("Do **not** use mode `0644`.", forbidden), null);
});

test("an affirmative unsafe recommendation remains detectable", () => {
  assert.equal(unsafeRecommendation("Set mode 0644.", forbidden), "Set mode 0644.");
});
