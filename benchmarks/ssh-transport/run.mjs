#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const LAB_ROOT = join(ROOT, "..", "..");
const worker = await readFile(join(ROOT, "worker.mjs"));
const DOCKER_CONTEXT = process.env.SSH_BENCH_DOCKER_CONTEXT ?? "";

function runWorker() {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [
      ...(DOCKER_CONTEXT ? ["--context", DOCKER_CONTEXT] : []),
      "compose",
      "--project-directory", LAB_ROOT,
      "-f", join(LAB_ROOT, "compose.yaml"),
      "exec", "-T", "-u", "operator",
      "workstation",
      "node", "--input-type=module", "-",
    ], {
      cwd: LAB_ROOT,
      env: process.env,
      stdio: ["pipe", "pipe", "inherit"],
    });
    const stdout = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`benchmark worker exited ${code}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.end(worker);
  });
}

const output = await runWorker();
const results = JSON.parse(output);

function line(label, value) {
  process.stdout.write(`${label.padEnd(34)} ${value}\n`);
}

process.stdout.write("SSH TOOL CANDIDATE BENCHMARK\n\n");
line("Connection reuse baseline median", `${results.multiplexing.baseline.median_ms} ms`);
line("Connection reuse warm median", `${results.multiplexing.multiplexed_warm.median_ms} ms`);
line("Connection reuse median saved", `${results.multiplexing.median_saved_percent}%`);
line("Connection reuse threshold", results.multiplexing.candidate_pass ? "PASS" : "FAIL");
line("Concurrent same-host calls", results.reuse_reliability.concurrent_same_host_pass ? "PASS" : "FAIL");
line("Dead-master recovery", results.reuse_reliability.stale_socket_recovery_pass ? "PASS" : "FAIL");
line("Transport classification", results.failure_semantics.candidate_pass ? "PASS" : "FAIL");
line("Preflight transport defer", results.failure_semantics.preflight_transport_defers ? "PASS" : "FAIL");
line("Post-mutation escalation", results.failure_semantics.post_mutation_transport_escalates ? "PASS" : "FAIL");
line("Terminal-control sanitization", results.output_safety.candidate_pass ? "PASS" : "FAIL");
line("Leaked terminal controls", String(results.output_safety.remaining_dangerous_controls));
process.stdout.write("\n");
line("Parallel ssh_exec latency", `${results.fanout.current_parallel_ssh_exec_ms} ms`);
line("Bounded fanout latency", `${results.fanout.bounded_fanout_ms} ms`);
line("Fanout argument reduction", `${results.fanout.argument_saved_percent}%`);
line("Fanout result reduction", `${results.fanout.result_saved_percent}%`);
line("Fanout efficiency threshold", results.fanout.candidate_pass ? "PASS" : "FAIL");
line("Fanout safety gate", "FAIL (generic shell is not provably read-only)");
process.stdout.write("\n");
line("Stage payload", `${results.staging.payload_bytes} bytes`);
line("Current heredoc median", `${results.staging.current_heredoc.median_ms} ms`);
line("Direct stream median", `${results.staging.direct_stream.median_ms} ms`);
line("Stage end-to-end arg reduction", `${results.staging.end_to_end_argument_saved_percent}%`);
line("Stage with pre-existing file", `${results.staging.preexisting_file_argument_saved_percent}% reduction`);
line("Stage correctness", results.staging.correctness_verified ? "PASS" : "FAIL");
line("Stage threshold", results.staging.candidate_pass ? "PASS" : "FAIL");

if (process.argv.includes("--json")) {
  process.stdout.write(`\n${JSON.stringify(results, null, 2)}\n`);
}
