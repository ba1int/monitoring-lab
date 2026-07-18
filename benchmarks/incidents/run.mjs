#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { score } from "./scoring.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const LAB_ROOT = join(ROOT, "..", "..");
const STATE_ROOT = process.env.MONITORING_LAB_STATE
  ?? join(homedir(), ".local", "state", "monitoring-lab");
const DEFAULT_OUTPUT_ROOT = join(STATE_ROOT, "benchmarks", "incidents");
const DOCKER_CONTEXT = process.env.INCIDENT_BENCH_DOCKER_CONTEXT ?? "";
const COMPOSE_FILE = process.env.INCIDENT_BENCH_COMPOSE_FILE
  ?? join(LAB_ROOT, "compose.yaml");
const PROJECT_DIRECTORY = process.env.INCIDENT_BENCH_PROJECT_DIRECTORY ?? LAB_ROOT;
const LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const MAX_CAPTURE_BYTES = 12 * 1024 * 1024;

function usage() {
  process.stdout.write(`Incident investigation benchmark

Usage: node run.mjs [options]

  --cases ID,ID           Run only named scenarios
  --limit N               Run only the first N selected scenarios
  --thinking LEVEL        Pi thinking level (default: high)
  --model PROVIDER/MODEL  Override the configured Pi model
  --timeout-seconds N     Per-scenario Pi timeout (default: 300)
  --output-root PATH      Parent results directory
  --run-id ID             Stable results directory name
  --static-only           Validate fixtures without Docker or model calls
  --help                  Show this help
`);
}

function parseArgs(argv) {
  const options = {
    cases: null,
    limit: null,
    thinking: "high",
    model: null,
    timeoutSeconds: 300,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    runId: null,
    staticOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${argument} requires a value`);
      return argv[index];
    };
    switch (argument) {
      case "--cases":
        options.cases = new Set(value().split(",").filter(Boolean));
        break;
      case "--limit":
        options.limit = Number(value());
        break;
      case "--thinking":
        options.thinking = value();
        break;
      case "--model":
        options.model = value();
        break;
      case "--timeout-seconds":
        options.timeoutSeconds = Number(value());
        break;
      case "--output-root":
        options.outputRoot = value();
        break;
      case "--run-id":
        options.runId = value();
        break;
      case "--static-only":
        options.staticOnly = true;
        break;
      case "--help":
      case "-h":
        usage();
        process.exit(0);
        break;
      default:
        throw new Error(`unknown option: ${argument}`);
    }
  }

  if (!LEVELS.has(options.thinking)) throw new Error("invalid --thinking level");
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  if (!Number.isInteger(options.timeoutSeconds) || options.timeoutSeconds < 30) {
    throw new Error("--timeout-seconds must be an integer of at least 30");
  }
  if (options.runId && !/^[a-zA-Z0-9._-]+$/.test(options.runId)) {
    throw new Error("--run-id may contain only letters, digits, dot, underscore, and dash");
  }
  return options;
}

function dockerArgs(args) {
  return DOCKER_CONTEXT ? ["--context", DOCKER_CONTEXT, ...args] : args;
}

function run(command, args, { input, captureStdout = true, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [input === undefined ? "ignore" : "pipe", captureStdout ? "pipe" : "ignore", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);

    const collect = (target, chunk, count) => {
      if (count >= MAX_CAPTURE_BYTES) return count + chunk.length;
      target.push(chunk.subarray(0, Math.max(0, MAX_CAPTURE_BYTES - count)));
      return count + chunk.length;
    };
    child.stdout?.on("data", (chunk) => { stdoutBytes = collect(stdout, chunk, stdoutBytes); });
    child.stderr.on("data", (chunk) => { stderrBytes = collect(stderr, chunk, stderrBytes); });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        timedOut,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdoutTruncated: stdoutBytes > MAX_CAPTURE_BYTES,
        stderrTruncated: stderrBytes > MAX_CAPTURE_BYTES,
      });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

async function docker(args, options = {}) {
  return run("docker", dockerArgs(args), options);
}

async function requireSuccess(result, context) {
  if (result.code === 0 && !result.timedOut) return result;
  throw new Error(
    `${context} failed (exit=${result.code ?? "none"} signal=${result.signal ?? "none"})\n${result.stderr}`,
  );
}

async function containerId(service) {
  const result = await docker([
    "compose", "--project-directory", PROJECT_DIRECTORY,
    "-f", COMPOSE_FILE, "ps", "-q", service,
  ]);
  await requireSuccess(result, `resolve container ${service}`);
  const id = result.stdout.trim();
  if (!id) throw new Error(`service is not running: ${service}`);
  return id;
}

async function execScript(container, script, context) {
  const result = await docker(
    ["exec", "-i", "--user", "root", container, "/bin/bash", "-se"],
    { input: script, timeoutMs: 30_000 },
  );
  await requireSuccess(result, context);
  return result;
}

function parseSession(text) {
  const entries = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const assistants = entries.filter(
    (entry) => entry.type === "message" && entry.message?.role === "assistant",
  );
  const toolCalls = assistants.flatMap((entry) =>
    (entry.message.content ?? []).filter((item) => item.type === "toolCall"),
  );
  const final = [...assistants].reverse().find(
    (entry) => entry.message.stopReason === "stop",
  );
  const finalText = (final?.message.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  const usage = assistants.reduce((total, entry) => {
    const current = entry.message.usage ?? {};
    total.input += current.input ?? 0;
    total.output += current.output ?? 0;
    total.cacheRead += current.cacheRead ?? 0;
    total.cacheWrite += current.cacheWrite ?? 0;
    total.reasoning += current.reasoning ?? 0;
    total.cost += current.cost?.total ?? 0;
    return total;
  }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 });
  return { entries, assistants, toolCalls, final, finalText, usage };
}

async function loadScenarios(options) {
  const scenariosRoot = join(ROOT, "scenarios");
  const names = (await readdir(scenariosRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const scenarios = [];
  for (const name of names) {
    if (options.cases && !options.cases.has(name)) continue;
    const directory = join(scenariosRoot, name);
    const manifest = JSON.parse(await readFile(join(directory, "scenario.json"), "utf8"));
    if (manifest.id !== name) throw new Error(`${name}: manifest id mismatch`);
    for (const script of ["inject.sh", "verify.sh", "cleanup.sh"]) {
      await readFile(join(directory, script), "utf8");
    }
    if (!Array.isArray(manifest.expected?.required_groups)
      || manifest.expected.required_groups.length === 0) {
      throw new Error(`${name}: expected.required_groups is required`);
    }
    scenarios.push({ directory, manifest });
  }
  if (options.cases) {
    const found = new Set(scenarios.map(({ manifest }) => manifest.id));
    const missing = [...options.cases].filter((id) => !found.has(id));
    if (missing.length) throw new Error(`unknown scenarios: ${missing.join(", ")}`);
  }
  if (options.limit !== null) return scenarios.slice(0, options.limit);
  return scenarios;
}

async function runScenario({ directory, manifest }, context) {
  const { options, outputDirectory, workstation } = context;
  const target = await containerId(manifest.host);
  const caseDirectory = join(outputDirectory, manifest.id);
  await mkdir(caseDirectory, { recursive: true });
  const inject = await readFile(join(directory, "inject.sh"), "utf8");
  const verify = await readFile(join(directory, "verify.sh"), "utf8");
  const cleanup = await readFile(join(directory, "cleanup.sh"), "utf8");
  const sessionRoot = `/home/operator/.local/state/monitoring-lab/incident-benchmark/${context.runId}/${manifest.id}`;
  let fixtureUnchanged = false;
  let sessionText = "";
  let piResult = null;
  const startedAt = Date.now();

  try {
    await execScript(target, inject, `${manifest.id}: inject`);
    await execScript(target, verify, `${manifest.id}: verify injection`);

    const piArgs = [
      "exec", "-w", "/home/operator",
      "-e", "PI_SKIP_VERSION_CHECK=1",
      "-e", "PI_TELEMETRY=0",
      workstation,
      "/usr/bin/timeout", "--signal=TERM", "--kill-after=5",
      `${options.timeoutSeconds}s`,
      "/home/operator/.local/bin/pi",
      "--mode", "json",
      "--no-approve",
      "--thinking", options.thinking,
      "--session-dir", `${sessionRoot}/sessions`,
      "--name", `incident-bench-${manifest.id}`,
    ];
    if (options.model) piArgs.push("--model", options.model);
    piArgs.push(manifest.prompt);
    piResult = await docker(piArgs, {
      captureStdout: false,
      timeoutMs: (options.timeoutSeconds + 20) * 1_000,
    });

    const findResult = await docker([
      "exec", workstation, "find", `${sessionRoot}/sessions`,
      "-type", "f", "-name", "*.jsonl", "-print",
    ]);
    await requireSuccess(findResult, `${manifest.id}: locate session`);
    const sessionPaths = findResult.stdout.trim().split("\n").filter(Boolean);
    if (sessionPaths.length !== 1) {
      throw new Error(`${manifest.id}: expected one session, found ${sessionPaths.length}`);
    }
    const sessionResult = await docker(["exec", workstation, "cat", sessionPaths[0]]);
    await requireSuccess(sessionResult, `${manifest.id}: read session`);
    sessionText = sessionResult.stdout;
    await writeFile(join(caseDirectory, "session.jsonl"), sessionText);

    const verifyResult = await docker(
      ["exec", "-i", "--user", "root", target, "/bin/bash", "-se"],
      { input: verify, timeoutMs: 30_000 },
    );
    fixtureUnchanged = verifyResult.code === 0;
  } finally {
    await execScript(target, cleanup, `${manifest.id}: cleanup`);
    await docker(["exec", workstation, "rm", "-rf", "--", sessionRoot]);
  }

  const elapsedMs = Date.now() - startedAt;
  const session = parseSession(sessionText);
  const scoring = score(manifest, session, fixtureUnchanged, elapsedMs);
  const record = {
    schema_version: "incident-benchmark/1",
    scenario: manifest.id,
    description: manifest.description,
    host: manifest.host,
    model: session.final?.message.model ?? null,
    provider: session.final?.message.provider ?? null,
    thinking: options.thinking,
    elapsed_ms: elapsedMs,
    pi_exit: piResult?.code ?? null,
    usage: session.usage,
    scoring,
    final_text: session.finalText,
  };
  await writeFile(join(caseDirectory, "result.json"), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

function renderReport(runId, records) {
  const passed = records.filter((record) => record.scoring.pass).length;
  const lines = [
    "# Incident benchmark",
    "",
    `Run: \`${runId}\``,
    `Correctness: **${passed}/${records.length} passed**`,
    "",
    "| Scenario | Result | Root cause | Read-only | SSH calls | Cost | Time |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const record of records) {
    lines.push(
      `| ${record.scenario} | ${record.scoring.pass ? "PASS" : "FAIL"} | ${record.scoring.rootCause ? "yes" : "no"} | ${record.scoring.readOnly ? "yes" : "no"} | ${record.scoring.remoteCalls} | $${record.usage.cost.toFixed(3)} | ${(record.elapsed_ms / 1000).toFixed(1)}s |`,
    );
  }
  for (const record of records) {
    lines.push("", `## ${record.scenario}`, "", record.final_text || "_No final answer._");
  }
  return `${lines.join("\n")}\n`;
}

function makeRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const scenarios = await loadScenarios(options);
  if (scenarios.length === 0) throw new Error("no scenarios selected");
  if (options.staticOnly) {
    process.stdout.write(`validated ${scenarios.length} incident scenarios\n`);
    return;
  }

  const runId = options.runId ?? makeRunId();
  const outputDirectory = join(options.outputRoot, runId);
  const lockDirectory = join(options.outputRoot, ".lock");
  await mkdir(options.outputRoot, { recursive: true });
  try {
    await mkdir(lockDirectory);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`benchmark already running: ${lockDirectory}`);
    throw error;
  }

  const records = [];
  try {
    const workstation = await containerId("workstation");
    await mkdir(outputDirectory, { recursive: true });
    for (const scenario of scenarios) {
      process.stdout.write(`incident ${scenario.manifest.id}: running\n`);
      try {
        const record = await runScenario(scenario, {
          options, outputDirectory, runId, workstation,
        });
        records.push(record);
        process.stdout.write(
          `incident ${record.scenario}: ${record.scoring.pass ? "PASS" : "FAIL"} calls=${record.scoring.remoteCalls} cost=$${record.usage.cost.toFixed(3)} time=${(record.elapsed_ms / 1000).toFixed(1)}s\n`,
        );
      } catch (error) {
        const record = {
          schema_version: "incident-benchmark/1",
          scenario: scenario.manifest.id,
          description: scenario.manifest.description,
          host: scenario.manifest.host,
          elapsed_ms: null,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 },
          scoring: {
            pass: false, completed: false, rootCause: false, readOnly: false,
            safeRecommendation: false, efficient: false, evidence: [],
            unsafeText: null, mutatingCall: null, remoteCalls: 0,
          },
          final_text: "",
          error: error.stack ?? String(error),
        };
        records.push(record);
        await mkdir(join(outputDirectory, record.scenario), { recursive: true });
        await writeFile(
          join(outputDirectory, record.scenario, "result.json"),
          `${JSON.stringify(record, null, 2)}\n`,
        );
        process.stdout.write(`incident ${record.scenario}: ERROR ${error.message}\n`);
      }
    }
    const report = renderReport(runId, records);
    await writeFile(join(outputDirectory, "REPORT.md"), report);
    await writeFile(
      join(outputDirectory, "summary.json"),
      `${JSON.stringify({ schema_version: "incident-benchmark-summary/1", run_id: runId, records }, null, 2)}\n`,
    );
    process.stdout.write(`report   ${join(outputDirectory, "REPORT.md")}\n`);
  } finally {
    await rm(lockDirectory, { recursive: true, force: true });
  }

  if (records.some((record) => !record.scoring.pass)) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
