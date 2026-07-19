import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { acquireResourceLocks } from "./resource-lock.mjs";

test("same resource waits while independent resources proceed", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchmark-lock-"));
  try {
    const releaseFirst = await acquireResourceLocks(root, ["host-a"]);
    let sameAcquired = false;
    const same = acquireResourceLocks(root, ["host-a"], { timeoutMs: 2_000 })
      .then((release) => {
        sameAcquired = true;
        return release;
      });
    const releaseIndependent = await acquireResourceLocks(root, ["host-b"]);
    assert.equal(sameAcquired, false);
    await releaseIndependent();
    await releaseFirst();
    const releaseSame = await same;
    assert.equal(sameAcquired, true);
    await releaseSame();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resource names cannot escape the lock root", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchmark-lock-"));
  try {
    await assert.rejects(
      acquireResourceLocks(root, ["../outside"]),
      /invalid benchmark lock resource/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
