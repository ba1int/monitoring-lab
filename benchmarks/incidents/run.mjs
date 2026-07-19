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
  --rescore RUN_ID        Re-evaluate saved answer/tool checkpoints without Pi
  --static-only           Validate fixtures without Docker or model calls
  --fixtures-only         Inject, verify, and clean fixtures without model calls
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
    rescore: null,
    staticOnly: false,
    fixturesOnly: false,
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
      case "--rescore":
        options.rescore = value();
        break;
      case "--static-only":
        options.staticOnly = true;
        break;
      case "--fixtures-only":
        options.fixturesOnly = true;
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
  if (options.rescore && !/^[a-zA-Z0-9._-]+$/.test(options.rescore)) {
    throw new Error("--rescore may contain only letters, digits, dot, underscore, and dash");
  }
  if (options.staticOnly && options.fixturesOnly) {
    throw new Error("--static-only and --fixtures-only are mutually exclusive");
  }
  if (options.rescore && (options.staticOnly || options.fixturesOnly || options.runId
      || options.cases || options.limit !== null)) {
    throw new Error("--rescore cannot be combined with selection, fixture, static, or run-id options");
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

async function verifyCleanBaseline(container, context) {
  await execScript(container, `
[[ "$(cat /state/status)" == "ok" ]]
[[ ! -e /etc/lab-middleware ]]
[[ ! -e /var/log/lab-middleware ]]
[[ ! -e /opt/lab-middleware ]]
`, context);
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
    const fixtureHosts = manifest.fixture_hosts ?? { target: manifest.host };
    if (fixtureHosts.target !== manifest.host) {
      throw new Error(`${name}: fixture_hosts.target must match host`);
    }
    const fixtures = [];
    for (const [role, host] of Object.entries(fixtureHosts)) {
      if (!/^[a-z][a-z0-9-]*$/.test(role)) throw new Error(`${name}: invalid fixture role ${role}`);
      const suffix = manifest.fixture_hosts ? `-${role}` : "";
      const fixture = { role, host };
      for (const action of ["inject", "verify", "cleanup"]) {
        fixture[action] = await readFile(join(directory, `${action}${suffix}.sh`), "utf8");
      }
      fixtures.push(fixture);
    }
    if (!Array.isArray(manifest.expected?.required_groups)
      || manifest.expected.required_groups.length === 0) {
      throw new Error(`${name}: expected.required_groups is required`);
    }
    if (manifest.expected.required_hosts?.some(
      (host) => !Object.values(fixtureHosts).includes(host),
    )) {
      throw new Error(`${name}: expected.required_hosts must reference fixture hosts`);
    }
    scenarios.push({ directory, manifest, fixtures });
  }
  if (options.cases) {
    const found = new Set(scenarios.map(({ manifest }) => manifest.id));
    const missing = [...options.cases].filter((id) => !found.has(id));
    if (missing.length) throw new Error(`unknown scenarios: ${missing.join(", ")}`);
  }
  if (options.limit !== null) return scenarios.slice(0, options.limit);
  return scenarios;
}

async function resolveFixtureContainers(fixtures) {
  const pairs = await Promise.all(fixtures.map(async (fixture) => [
    fixture.role,
    await containerId(fixture.host),
  ]));
  return Object.fromEntries(pairs);
}

async function cleanupFixtures(fixtures, containers, scenario) {
  let firstError = null;
  for (const fixture of [...fixtures].reverse()) {
    try {
      await execScript(
        containers[fixture.role], fixture.cleanup,
        `${scenario}: cleanup ${fixture.role}`,
      );
      await verifyCleanBaseline(
        containers[fixture.role], `${scenario}: verify cleanup ${fixture.role}`,
      );
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError) throw firstError;
}

async function runScenario({ manifest, fixtures }, context) {
  const { options, outputDirectory, workstation } = context;
  const containers = await resolveFixtureContainers(fixtures);
  const caseDirectory = join(outputDirectory, manifest.id);
  await mkdir(caseDirectory, { recursive: true });
  const sessionRoot = `/home/operator/.local/state/monitoring-lab/incident-benchmark/${context.runId}/${manifest.id}`;
  let fixtureUnchanged = false;
  let sessionText = "";
  let piResult = null;
  const startedAt = Date.now();

  try {
    for (const fixture of fixtures) {
      await verifyCleanBaseline(
        containers[fixture.role], `${manifest.id}: require clean ${fixture.role}`,
      );
      await execScript(
        containers[fixture.role], fixture.inject,
        `${manifest.id}: inject ${fixture.role}`,
      );
      await execScript(
        containers[fixture.role], fixture.verify,
        `${manifest.id}: verify injection ${fixture.role}`,
      );
    }

    const piArgs = [
      "exec", "-w", "/home/operator",
      "-e", "PI_SKIP_VERSION_CHECK=1",
      "-e", "PI_TELEMETRY=0",
      "-e", "PI_THINKING_ROUTER=off",
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

    const unchanged = await Promise.all(fixtures.map(async (fixture) => {
      const result = await docker(
        ["exec", "-i", "--user", "root", containers[fixture.role], "/bin/bash", "-se"],
        { input: fixture.verify, timeoutMs: 30_000 },
      );
      return result.code === 0;
    }));
    fixtureUnchanged = unchanged.every(Boolean);
  } finally {
    try {
      await cleanupFixtures(fixtures, containers, manifest.id);
    } finally {
      await docker(["exec", workstation, "rm", "-rf", "--", sessionRoot]);
    }
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
    fixture_unchanged: fixtureUnchanged,
    usage: session.usage,
    scoring,
    final_text: session.finalText,
  };
  await writeFile(join(caseDirectory, "result.json"), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

async function verifyFixture({ manifest, fixtures }) {
  const containers = await resolveFixtureContainers(fixtures);
  try {
    for (const fixture of fixtures) {
      await verifyCleanBaseline(
        containers[fixture.role], `${manifest.id}: require clean ${fixture.role}`,
      );
      await execScript(
        containers[fixture.role], fixture.inject,
        `${manifest.id}: inject ${fixture.role}`,
      );
      await execScript(
        containers[fixture.role], fixture.verify,
        `${manifest.id}: verify injection ${fixture.role}`,
      );
    }
  } finally {
    await cleanupFixtures(fixtures, containers, manifest.id);
  }
}

function renderReport(runId, records) {
  const passed = records.filter((record) => record.scoring.pass).length;
  const lines = [
    "# Incident benchmark",
    "",
    `Run: \`${runId}\``,
    `Correctness: **${passed}/${records.length} passed**`,
    "",
    "| Scenario | Score | Result | Root cause | Read-only | SSH calls | Cost | Time |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const record of records) {
    lines.push(
      `| ${record.scenario} | ${record.scoring.score}/100 | ${record.scoring.pass ? "PASS" : "FAIL"} | ${record.scoring.rootCause ? "yes" : "no"} | ${record.scoring.readOnly ? "yes" : "no"} | ${record.scoring.remoteCalls} | $${record.usage.cost.toFixed(3)} | ${(record.elapsed_ms / 1000).toFixed(1)}s |`,
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

async function rescoreExisting(scenarios, options) {
  const outputDirectory = join(options.outputRoot, options.rescore);
  const records = [];
  for (const { manifest } of scenarios) {
    const caseDirectory = join(outputDirectory, manifest.id);
    let prior;
    let sessionText;
    try {
      prior = JSON.parse(await readFile(join(caseDirectory, "result.json"), "utf8"));
      sessionText = await readFile(join(caseDirectory, "session.jsonl"), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const session = parseSession(sessionText);
    const scoring = score(manifest, session, prior.fixture_unchanged, prior.elapsed_ms);
    const record = { ...prior, scoring, final_text: session.finalText };
    records.push(record);
    await writeFile(join(caseDirectory, "result.json"), `${JSON.stringify(record, null, 2)}\n`);
  }
  if (records.length === 0) throw new Error(`no saved scenarios found in ${outputDirectory}`);
  await writeFile(join(outputDirectory, "REPORT.md"), renderReport(options.rescore, records));
  await writeFile(
    join(outputDirectory, "summary.json"),
    `${JSON.stringify({ schema_version: "incident-benchmark-summary/1", run_id: options.rescore, records }, null, 2)}\n`,
  );
  process.stdout.write(`rescored ${records.length} incident scenarios in ${outputDirectory}\n`);
}

function failedRecord(scenario, error) {
  return {
    schema_version: "incident-benchmark/1",
    scenario: scenario.manifest.id,
    description: scenario.manifest.description,
    host: scenario.manifest.host,
    elapsed_ms: null,
    fixture_unchanged: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 },
    scoring: {
      pass: false, score: 0, maxScore: 100, completed: false, rootCause: false, readOnly: false,
      safeRecommendation: false, efficient: false, evidence: [],
      unsafeText: null, mutatingCall: null, remoteCalls: 0,
    },
    final_text: "",
    error: error.stack ?? String(error),
  };
}

async function executeScenario(scenario, context) {
  process.stdout.write(`incident ${scenario.manifest.id}: running\n`);
  try {
    const record = await runScenario(scenario, context);
    process.stdout.write(
      `incident ${record.scenario}: ${record.scoring.score}/100 ${record.scoring.pass ? "PASS" : "FAIL"} calls=${record.scoring.remoteCalls} cost=$${record.usage.cost.toFixed(3)} time=${(record.elapsed_ms / 1000).toFixed(1)}s\n`,
    );
    return record;
  } catch (error) {
    const record = failedRecord(scenario, error);
    await mkdir(join(context.outputDirectory, record.scenario), { recursive: true });
    await writeFile(
      join(context.outputDirectory, record.scenario, "result.json"),
      `${JSON.stringify(record, null, 2)}\n`,
    );
    process.stdout.write(`incident ${record.scenario}: ERROR ${error.message}\n`);
    return record;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const scenarios = await loadScenarios(options);
  if (scenarios.length === 0) throw new Error("no scenarios selected");
  if (options.rescore) {
    await rescoreExisting(scenarios, options);
    return;
  }
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
    if (options.fixturesOnly) {
      for (const scenario of scenarios) {
        await verifyFixture(scenario);
        process.stdout.write(`fixture  ${scenario.manifest.id}: PASS\n`);
      }
      return;
    }
    const workstation = await containerId("workstation");
    await mkdir(outputDirectory, { recursive: true });
    for (const scenario of scenarios) {
      records.push(await executeScenario(
        scenario, { options, outputDirectory, runId, workstation },
      ));
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
