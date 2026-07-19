#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const HOSTS = (process.env.BENCH_HOSTS ?? [
  "lab-prod-app01",
  "lab-prod-app02",
  "lab-prod-web01",
  "lab-prod-mq01",
  "lab-dev-app01",
  "lab-dev-web01",
  "lab-dev-db01",
  "lab-test-app01",
  "lab-test-web01",
  "lab-test-mq01",
].join(",")).split(",").filter(Boolean);

const REPEATS = Number(process.env.BENCH_REPEATS ?? 12);
const FANOUT_CONCURRENCY = Number(process.env.BENCH_FANOUT_CONCURRENCY ?? 4);
const STAGE_REPEATS = Number(process.env.BENCH_STAGE_REPEATS ?? 5);
const STAGE_BYTES = Number(process.env.BENCH_STAGE_BYTES ?? 16 * 1024);
const CONTROL_ROOT = "/tmp";

function validatePositiveInteger(name, value, minimum = 1, maximum = 1000) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
}

validatePositiveInteger("BENCH_REPEATS", REPEATS, 3, 100);
validatePositiveInteger("BENCH_FANOUT_CONCURRENCY", FANOUT_CONCURRENCY, 1, 32);
validatePositiveInteger("BENCH_STAGE_REPEATS", STAGE_REPEATS, 2, 25);
validatePositiveInteger("BENCH_STAGE_BYTES", STAGE_BYTES, 1024, 256 * 1024);
if (HOSTS.length < 2 || HOSTS.length > 32) throw new Error("BENCH_HOSTS must contain 2 to 32 hosts");

function baseArgs(host) {
  return [
    "-T",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "ClearAllForwardings=yes",
    "-o", "ForwardAgent=no",
    "-o", "ForwardX11=no",
    "-o", "PermitLocalCommand=no",
    "-o", "RequestTTY=no",
    "-o", "UpdateHostKeys=no",
    "--",
    host,
  ];
}

function run(command, args, { input = "", timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        elapsedMs,
        timedOut,
      });
    });
    child.stdin.end(input);
  });
}

async function sshExec(host, command, { controlPath } = {}) {
  const args = baseArgs(host);
  if (controlPath) {
    args.unshift(
      "-o", "ControlMaster=auto",
      "-o", "ControlPersist=60",
      "-o", `ControlPath=${controlPath}`,
    );
  }
  args.push("exec bash -se");
  const result = await run("ssh", args, { input: `set -o pipefail\n${command}\n` });
  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error(`ssh ${host} failed: ${result.stderr.toString("utf8")}`);
  }
  return result;
}

async function sshRaw(host, command, { timeoutMs = 30_000 } = {}) {
  const args = baseArgs(host);
  args.push("exec bash -se");
  return run("ssh", args, {
    input: `set -o pipefail\n${command}\n`,
    timeoutMs,
  });
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function stats(values) {
  return {
    calls: values.length,
    total_ms: Math.round(values.reduce((sum, value) => sum + value, 0)),
    median_ms: Math.round(percentile(values, 0.5)),
    p95_ms: Math.round(percentile(values, 0.95)),
    min_ms: Math.round(Math.min(...values)),
    max_ms: Math.round(Math.max(...values)),
  };
}

async function benchmarkMultiplexing() {
  const directory = join(CONTROL_ROOT, `pi-ssh-bench-${process.pid}`);
  const controlPath = join(directory, "%C");
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const baseline = [];
  await sshExec(HOSTS[0], "true");
  for (let index = 0; index < REPEATS; index += 1) {
    baseline.push((await sshExec(HOSTS[0], "true")).elapsedMs);
  }

  const cold = await sshExec(HOSTS[0], "true", { controlPath });
  const warm = [];
  for (let index = 0; index < REPEATS; index += 1) {
    warm.push((await sshExec(HOSTS[0], "true", { controlPath })).elapsedMs);
  }

  await run("ssh", [
    "-O", "exit",
    "-o", `ControlPath=${controlPath}`,
    "--", HOSTS[0],
  ]).catch(() => {});
  await rm(directory, { recursive: true, force: true });

  const baselineStats = stats(baseline);
  const warmStats = stats(warm);
  const savedPercent = Math.round((1 - warmStats.median_ms / baselineStats.median_ms) * 100);
  return {
    host: HOSTS[0],
    baseline: baselineStats,
    multiplexed_cold_ms: Math.round(cold.elapsedMs),
    multiplexed_warm: warmStats,
    median_saved_ms: baselineStats.median_ms - warmStats.median_ms,
    median_saved_percent: savedPercent,
    candidate_pass: savedPercent >= 40 && baselineStats.median_ms - warmStats.median_ms >= 50,
  };
}

async function controlCommand(operation, host, controlPath) {
  return run("ssh", [
    "-O", operation,
    "-o", `ControlPath=${controlPath}`,
    "--", host,
  ]);
}

async function benchmarkReuseReliability() {
  const directory = join(CONTROL_ROOT, `pi-ssh-rel-${process.pid}`);
  const controlPath = join(directory, "%C");
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const expected = Array.from({ length: 6 }, (_, index) => `parallel-${index}`);
  let concurrentPass = false;
  let staleRecoveryPass = false;
  let recoveryError = null;
  let killedMasterPid = null;
  let recoveryColdMs = null;
  let recoveryReusedMs = null;

  try {
    const concurrent = await Promise.all(expected.map((marker) =>
      sshExec(HOSTS[0], `printf '%s\\n' '${marker}'`, { controlPath })));
    concurrentPass = concurrent.every((result, index) =>
      result.exitCode === 0 && result.stdout.toString("utf8").trim() === expected[index]);

    const status = await controlCommand("check", HOSTS[0], controlPath);
    const statusText = Buffer.concat([status.stdout, status.stderr]).toString("utf8");
    const match = statusText.match(/pid=(\d+)/);
    if (!match) throw new Error(`could not identify control master: ${statusText.trim()}`);
    killedMasterPid = Number(match[1]);
    process.kill(killedMasterPid, "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 100));

    const recovered = await sshExec(HOSTS[0], "printf 'recovered\\n'", { controlPath });
    const reused = await sshExec(HOSTS[0], "printf 'reused\\n'", { controlPath });
    recoveryColdMs = Math.round(recovered.elapsedMs);
    recoveryReusedMs = Math.round(reused.elapsedMs);
    staleRecoveryPass = recovered.stdout.toString("utf8").trim() === "recovered"
      && reused.stdout.toString("utf8").trim() === "reused"
      && reused.elapsedMs < 200;
  } catch (error) {
    recoveryError = error instanceof Error ? error.message : String(error);
  } finally {
    await controlCommand("exit", HOSTS[0], controlPath).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }

  return {
    host: HOSTS[0],
    concurrent_calls: expected.length,
    concurrent_same_host_pass: concurrentPass,
    killed_master_pid: killedMasterPid,
    recovery_cold_ms: recoveryColdMs,
    recovery_reused_ms: recoveryReusedMs,
    stale_socket_recovery_pass: staleRecoveryPass,
    error: recoveryError,
    regression_pass: concurrentPass && staleRecoveryPass,
  };
}

async function benchmarkFailureSemantics() {
  const liveScenarios = [
    { id: "success", host: HOSTS[0], command: "true", expected: null },
    { id: "remote-exit", host: HOSTS[0], command: "printf 'application failed\\n' >&2; exit 7", expected: "remote_exit" },
    { id: "dns", host: "missing-host.invalid", command: "true", expected: "dns" },
    { id: "refused", host: "operator@127.0.0.1", command: "true", expected: "connection_refused" },
    { id: "authentication", host: `nobody@${HOSTS[0]}`, command: "true", expected: "authentication" },
    { id: "timeout", host: HOSTS[0], command: "sleep 3", timeoutMs: 500, expected: "timeout" },
  ];
  const staticScenarios = [
    {
      id: "host-key",
      result: { exitCode: 255, timedOut: false, stderr: "Host key verification failed.\r\n" },
      expected: "host_key",
    },
    {
      id: "connection-closed",
      result: { exitCode: 255, timedOut: false, stderr: "kex_exchange_identification: Connection closed by remote host\r\n" },
      expected: "connection_closed",
    },
    {
      id: "remote-255",
      result: { exitCode: 255, timedOut: false, stderr: "application chose exit 255\n" },
      expected: "remote_exit",
    },
  ];

  const liveResults = [];
  for (const scenario of liveScenarios) {
    const raw = await sshRaw(scenario.host, scenario.command, { timeoutMs: scenario.timeoutMs });
    liveResults.push({
      id: scenario.id,
      expected: scenario.expected,
      result: {
        exitCode: raw.exitCode,
        timedOut: raw.timedOut,
        stderr: raw.stderr.toString("utf8"),
      },
    });
  }

  const sshCore = await import("file:///opt/pi-tools/extensions/ssh-direct/core.js");
  const routerCore = await import("file:///opt/pi-tools/extensions/thinking-router/core.js");
  const classifierAvailable = typeof sshCore.classifySshFailure === "function";
  const transportPredicateAvailable = typeof sshCore.isTransportFailureKind === "function";
  const scenarios = [...liveResults, ...staticScenarios];
  const classifications = scenarios.map((scenario) => {
    const actual = classifierAvailable ? sshCore.classifySshFailure(scenario.result) : null;
    return { id: scenario.id, expected: scenario.expected, actual, pass: actual === scenario.expected };
  });

  const baselineTransportEscalates = routerCore.toolFailureRequiresEscalation(
    { exitCode: 255, timedOut: false, isError: false },
    false,
  );
  let candidateTransportEscalates = false;
  let remoteExitStaysLow = false;
  let maximumContextOverhead = null;
  if (classifierAvailable && transportPredicateAvailable) {
    const kind = sshCore.classifySshFailure({
      exitCode: 255,
      timedOut: false,
      stderr: "ssh: Could not resolve hostname missing.invalid: Name or service not known\r\n",
    });
    candidateTransportEscalates = routerCore.toolFailureRequiresEscalation(
      { exitCode: 255, timedOut: false, isError: false, transportError: sshCore.isTransportFailureKind(kind) },
      false,
    );
    remoteExitStaysLow = !routerCore.toolFailureRequiresEscalation(
      { exitCode: 7, timedOut: false, isError: false, transportError: false },
      false,
    );

    maximumContextOverhead = Math.max(...scenarios.map((scenario) => {
      const base = sshCore.formatResult({
        host: "example",
        exitCode: scenario.result.exitCode,
        stdout: "",
        stderr: scenario.result.stderr,
        elapsedMs: 1,
        maxOutputBytes: 16 * 1024,
        timedOut: scenario.result.timedOut,
      }).text;
      const kindForScenario = sshCore.classifySshFailure(scenario.result);
      const classified = sshCore.formatResult({
        host: "example",
        exitCode: scenario.result.exitCode,
        stdout: "",
        stderr: scenario.result.stderr,
        elapsedMs: 1,
        maxOutputBytes: 16 * 1024,
        timedOut: scenario.result.timedOut,
        failureKind: kindForScenario,
      }).text;
      return Buffer.byteLength(classified) - Buffer.byteLength(base);
    }));
  }

  const classificationPass = classifications.every((item) => item.pass);
  return {
    classifier_available: classifierAvailable,
    baseline_transport_escalates: baselineTransportEscalates,
    candidate_transport_escalates: candidateTransportEscalates,
    remote_exit_stays_low: remoteExitStaysLow,
    classifications,
    maximum_context_overhead_bytes: maximumContextOverhead,
    acceptance_threshold: {
      exact_classification: "9/9",
      transport_escalation: true,
      remote_exit_escalation: false,
      maximum_context_overhead_bytes: 40,
    },
    candidate_pass: classifierAvailable
      && classificationPass
      && candidateTransportEscalates
      && remoteExitStaysLow
      && maximumContextOverhead <= 40,
  };
}

function unsafeTerminalControls(text) {
  return [...text].filter((character) => {
    const code = character.charCodeAt(0);
    return code === 0x1b
      || (code < 0x20 && character !== "\n" && character !== "\t")
      || (code >= 0x7f && code <= 0x9f);
  }).length;
}

async function benchmarkOutputSafety() {
  const malicious = [
    "plain\t雪\n",
    "\u001b[31mred\u001b[0m\n",
    "\u001b]52;c;Y2xpcGJvYXJkLXBvaXNvbg==\u0007after\n",
    "\u001b]8;;https://example.invalid\u0007link\u001b]8;;\u0007\n",
    "cursor\u001b[2Jdone\n",
    "carriage\roverwrite\n",
    "back\bspace\n",
    "\u001bPprivate-device-command\u001b\\\n",
  ].join("");
  const expected = [
    "plain\t雪\n",
    "red\n",
    "after\n",
    "link\n",
    "cursordone\n",
    "carriageoverwrite\n",
    "backspace\n",
    "\n",
  ].join("");
  const normal = "host=app01 status=ok\nsecond\tcolumn 雪\n";
  const live = await sshRaw(HOSTS[0], "printf '\\033[31mred\\033[0m\\n\\033]52;c;Y2xpcGJvYXJkLXBvaXNvbg==\\aafter\\n'");
  const rawLive = live.stdout.toString("utf8");
  const sshCore = await import("file:///opt/pi-tools/extensions/ssh-direct/core.js");
  const sanitizerAvailable = typeof sshCore.sanitizeTerminalText === "function";
  const sanitized = sanitizerAvailable ? sshCore.sanitizeTerminalText(malicious) : malicious;
  const sanitizedLive = sanitizerAvailable ? sshCore.sanitizeTerminalText(rawLive) : rawLive;
  const normalAfter = sanitizerAvailable ? sshCore.sanitizeTerminalText(normal) : normal;
  const rawDangerousControls = unsafeTerminalControls(malicious);
  const remainingDangerousControls = unsafeTerminalControls(sanitized);
  const liveRemainingDangerousControls = unsafeTerminalControls(sanitizedLive);
  const contextDelta = Buffer.byteLength(sanitized) - Buffer.byteLength(malicious);

  return {
    sanitizer_available: sanitizerAvailable,
    baseline_dangerous_controls: rawDangerousControls,
    remaining_dangerous_controls: remainingDangerousControls,
    live_remaining_dangerous_controls: liveRemainingDangerousControls,
    exact_expected_output: sanitized === expected,
    normal_output_unchanged: normalAfter === normal,
    context_delta_bytes: contextDelta,
    acceptance_threshold: {
      remaining_dangerous_controls: 0,
      live_remaining_dangerous_controls: 0,
      exact_expected_output: true,
      normal_output_unchanged: true,
      maximum_context_growth_bytes: 0,
    },
    candidate_pass: sanitizerAvailable
      && remainingDangerousControls === 0
      && liveRemainingDangerousControls === 0
      && sanitized === expected
      && normalAfter === normal
      && contextDelta <= 0,
  };
}

async function mapLimit(items, concurrency, operation) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await operation(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function fullResult(host, result) {
  return `host: ${host}\nexit: ${result.exitCode}\nelapsed_ms: ${Math.round(result.elapsedMs)}\n\nstdout:\n${result.stdout.toString("utf8")}`;
}

function compactResult(host, result) {
  return `${host}\t${result.exitCode}\t${result.stdout.toString("utf8").trim().replaceAll("\n", " | ")}`;
}

async function runHostSet(concurrency, command) {
  const started = process.hrtime.bigint();
  const results = await mapLimit(HOSTS, concurrency, (host) => sshExec(host, command));
  return {
    elapsedMs: Number(process.hrtime.bigint() - started) / 1_000_000,
    results,
  };
}

async function benchmarkFanout() {
  const command = "hostname; awk -F= '/^(environment|role)=/ {printf \"%s=%s \", $1, $2} END {print \"\"}' /etc/lab-metadata";
  const separate = await runHostSet(HOSTS.length, command);
  const bounded = await runHostSet(FANOUT_CONCURRENCY, command);
  const separateArguments = HOSTS.map((host) => JSON.stringify({ host, command }));
  const fanoutArguments = JSON.stringify({ hosts: HOSTS, command, concurrency: FANOUT_CONCURRENCY });
  const separateOutput = separate.results.map((result, index) => fullResult(HOSTS[index], result)).join("\n\n");
  const compactOutput = bounded.results.map((result, index) => compactResult(HOSTS[index], result)).join("\n");
  const inputSavedPercent = Math.round((1 - Buffer.byteLength(fanoutArguments) /
    separateArguments.reduce((sum, value) => sum + Buffer.byteLength(value), 0)) * 100);

  return {
    hosts: HOSTS.length,
    current_parallel_ssh_exec_ms: Math.round(separate.elapsedMs),
    bounded_fanout_ms: Math.round(bounded.elapsedMs),
    bounded_concurrency: FANOUT_CONCURRENCY,
    separate_tool_calls: HOSTS.length,
    fanout_tool_calls: 1,
    separate_argument_bytes: separateArguments.reduce((sum, value) => sum + Buffer.byteLength(value), 0),
    fanout_argument_bytes: Buffer.byteLength(fanoutArguments),
    argument_saved_percent: inputSavedPercent,
    separate_result_bytes: Buffer.byteLength(separateOutput),
    compact_result_bytes: Buffer.byteLength(compactOutput),
    result_saved_percent: Math.round((1 - Buffer.byteLength(compactOutput) / Buffer.byteLength(separateOutput)) * 100),
    all_results_equal: separate.results.every((result, index) =>
      result.stdout.equals(bounded.results[index].stdout) && result.exitCode === bounded.results[index].exitCode),
    candidate_pass: inputSavedPercent >= 50 && separate.results.every((result, index) =>
      result.stdout.equals(bounded.results[index].stdout) && result.exitCode === bounded.results[index].exitCode),
    safety_note: "A generic shell command cannot be proven read-only; measured efficiency alone is insufficient to ship this candidate.",
  };
}

function stagePayload(size) {
  const line = "object Host ´quoted-app´ { vars.note = \"$dollar 'single' \\\\ slash 雪\" }\n";
  let value = "";
  while (Buffer.byteLength(value + line) <= size) value += line;
  const remaining = size - Buffer.byteLength(value);
  if (remaining > 0) value += `${"x".repeat(remaining - 1)}\n`;
  return Buffer.from(value);
}

async function streamStage(host, file, controlPath) {
  const args = baseArgs(host);
  if (controlPath) {
    args.unshift("-o", "ControlMaster=auto", "-o", "ControlPersist=60", "-o", `ControlPath=${controlPath}`);
  }
  args.push(
    "exec bash -c 'umask 077; p=$(mktemp /tmp/pi-stage-bench.XXXXXX); cat >\"$p\"; wc -c <\"$p\"; sha256sum \"$p\" | cut -d\" \" -f1; rm -f \"$p\"'",
  );
  return run("ssh", args, { input: file });
}

async function benchmarkStage() {
  const payload = stagePayload(STAGE_BYTES);
  const hash = createHash("sha256").update(payload).digest("hex");
  const localPath = `/tmp/pi-stage-benchmark-${process.pid}.conf`;
  await writeFile(localPath, payload, { mode: 0o600 });
  const delimiter = "PI_STAGE_BENCHMARK_EOF";
  const heredocCommand = `p=$(mktemp /tmp/pi-heredoc-bench.XXXXXX); cat >\"$p\" <<'${delimiter}'\n${payload.toString("utf8")}${delimiter}\nwc -c <\"$p\"; sha256sum \"$p\" | cut -d' ' -f1; rm -f \"$p\"`;
  const baseline = [];
  const streamed = [];
  let correct = true;

  for (let index = 0; index < STAGE_REPEATS; index += 1) {
    const result = await sshExec(HOSTS[0], heredocCommand);
    baseline.push(result.elapsedMs);
    const output = result.stdout.toString("utf8");
    correct &&= output.includes(String(payload.length)) && output.includes(hash);
  }
  for (let index = 0; index < STAGE_REPEATS; index += 1) {
    const result = await streamStage(HOSTS[0], payload);
    streamed.push(result.elapsedMs);
    const output = result.stdout.toString("utf8");
    correct &&= result.exitCode === 0 && output.includes(String(payload.length)) && output.includes(hash);
  }
  await rm(localPath, { force: true });

  const currentArgs = JSON.stringify({ host: HOSTS[0], command: heredocCommand });
  const localWriteArgs = JSON.stringify({ path: localPath, content: payload.toString("utf8") });
  const stagedArgs = JSON.stringify({ host: HOSTS[0], local_path: localPath });
  const stagedWorkflowBytes = Buffer.byteLength(localWriteArgs) + Buffer.byteLength(stagedArgs);
  const workflowSavedPercent = Math.round((1 - stagedWorkflowBytes / Buffer.byteLength(currentArgs)) * 100);
  const baselineStats = stats(baseline);
  const streamedStats = stats(streamed);
  return {
    payload_bytes: payload.length,
    correctness_verified: correct,
    current_heredoc: baselineStats,
    direct_stream: streamedStats,
    current_argument_bytes: Buffer.byteLength(currentArgs),
    staged_remote_argument_bytes: Buffer.byteLength(stagedArgs),
    staged_workflow_argument_bytes: stagedWorkflowBytes,
    preexisting_file_argument_saved_percent: Math.round((1 - Buffer.byteLength(stagedArgs) / Buffer.byteLength(currentArgs)) * 100),
    end_to_end_argument_saved_percent: workflowSavedPercent,
    latency_saved_percent: Math.round((1 - streamedStats.median_ms / baselineStats.median_ms) * 100),
    caveat: "A pre-existing local file makes staging cheap, but generated content requires an additional write tool call containing the same bytes.",
    candidate_pass: correct && workflowSavedPercent >= 20 && streamedStats.median_ms <= baselineStats.median_ms * 1.2,
  };
}

const results = {
  generated_at: new Date().toISOString(),
  environment: {
    node: process.version,
    hosts: HOSTS,
    repeats: REPEATS,
    stage_repeats: STAGE_REPEATS,
  },
  multiplexing: await benchmarkMultiplexing(),
  reuse_reliability: await benchmarkReuseReliability(),
  failure_semantics: await benchmarkFailureSemantics(),
  output_safety: await benchmarkOutputSafety(),
  fanout: await benchmarkFanout(),
  staging: await benchmarkStage(),
};

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
