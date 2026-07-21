import assert from "node:assert/strict";
import test from "node:test";

import { profileArgs, profileEnvironment, profileNames } from "./pi-stack-profile.mjs";

test("plain disables extension discovery", () => {
  assert.deepEqual(profileArgs("plain"), ["--no-extensions"]);
});

test("matched profiles add extensions cumulatively", () => {
  assert.match(profileArgs("ssh").join(" "), /ssh-direct/);
  assert.doesNotMatch(profileArgs("ssh").join(" "), /thinking-router/);
  assert.match(profileArgs("ops").join(" "), /task-ledger/);
});

test("full preserves installed discovery while enabling runtime components", () => {
  assert.deepEqual(profileArgs("full"), []);
  assert.deepEqual(profileEnvironment("full"), {
    PI_THINKING_ROUTER: "on", PI_CONTEXT_SENTINEL: "on", PI_TASK_LEDGER: "on",
  });
  assert.ok(profileNames().includes("plain"));
});
