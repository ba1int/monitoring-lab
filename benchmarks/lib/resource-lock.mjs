import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

const POLL_MS = 250;

function resourceName(value) {
  const name = String(value);
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error(`invalid benchmark lock resource: ${name}`);
  }
  return name;
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function removeStaleLock(directory) {
  try {
    const owner = JSON.parse(await readFile(join(directory, "owner.json"), "utf8"));
    if (owner.hostname !== hostname() || processIsAlive(owner.pid)) return false;
    await rm(directory, { recursive: true, force: true });
    return true;
  } catch (error) {
    // A contender can observe the directory in the tiny window before its
    // owner metadata is written. Treat that as busy, not stale.
    if (error.code === "ENOENT") return false;
    return false;
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function acquireResourceLocks(root, resources, {
  timeoutMs = 15 * 60 * 1_000,
  label = "benchmark",
} = {}) {
  const names = [...new Set(resources.map(resourceName))].sort();
  const acquired = [];
  const deadline = Date.now() + timeoutMs;
  await mkdir(root, { recursive: true });

  const release = async () => {
    for (const directory of acquired.reverse()) {
      await rm(directory, { recursive: true, force: true });
    }
  };

  try {
    for (const name of names) {
      const directory = join(root, name);
      for (;;) {
        try {
          await mkdir(directory);
          await writeFile(join(directory, "owner.json"), `${JSON.stringify({
            pid: process.pid,
            hostname: hostname(),
            label,
            acquired_at: new Date().toISOString(),
          })}\n`);
          acquired.push(directory);
          break;
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          if (await removeStaleLock(directory)) continue;
          if (Date.now() >= deadline) {
            throw new Error(`${label}: timed out waiting for fixture lock ${name}`);
          }
          await sleep(POLL_MS);
        }
      }
    }
  } catch (error) {
    await release();
    throw error;
  }

  return release;
}
