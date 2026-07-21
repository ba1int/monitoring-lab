import assert from "node:assert/strict";
import test from "node:test";

import { remoteInvocations } from "./remote-invocations.mjs";

test("normalizes ssh_exec and direct bash SSH calls", () => {
  const calls = [
    { name: "ssh_exec", arguments: { host: "lab-a", command: "hostname" } },
    { name: "bash", arguments: { command: "ssh lab-b 'sudo systemctl reload icinga2'" } },
  ];
  assert.deepEqual(remoteInvocations(calls), [
    { host: "lab-a", command: "hostname", tool: "ssh_exec" },
    { host: "lab-b", command: "'sudo systemctl reload icinga2'", tool: "bash" },
  ]);
});

test("ignores local bash and recognizes multiple simple SSH commands", () => {
  const calls = [{
    name: "bash",
    arguments: { command: "printf local; ssh lab-a hostname && ssh lab-b uptime" },
  }];
  assert.deepEqual(remoteInvocations(calls).map(({ host }) => host), ["lab-a", "lab-b"]);
});
