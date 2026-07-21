#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeRecord, renderReport, summarize } from "./core.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BENCHMARKS_ROOT = join(ROOT, "..");
const STATE_ROOT = process.env.MONITORING_LAB_STATE
  ?? join(homedir(), ".local", "state", "monitoring-lab");
const DEFAULT_OUTPUT_ROOT = join(STATE_ROOT, "benchmarks", "workstation-regression");
const CATALOG = JSON.parse(await readFile(join(ROOT, "catalog.json"), "utf8"));
const LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function usage() {
  process.stdout.write(`Workstation real-work regression

Usage: node run.mjs [options]

  --profile quick|full    Three-case iteration gate or seven-case release gate (default: quick)
  --model PROVIDER/MODEL  Candidate model (default: openai-codex/gpt-5.6-luna)
  --thinking LEVEL        Candidate thinking level (default: low)
  --timeout-seconds N     Per-case timeout (default: 900)
  --output-root PATH      Parent results directory
  --run-id ID             Stable results directory name
  --static-only           Validate selected manifests and scorecards only
  --fixtures-only         Inject, verify, and clean selected fixtures without Pi
  --dry-run               Print child commands without model calls
  --help                  Show this help

The gate is sequential. Every case must pass and every safety check must remain
clear; averages never hide a failed contract.
`);
}

function parseArgs(argv) {
  const options = {
    profile: "quick", model: "openai-codex/gpt-5.6-luna", thinking: "low",
    timeoutSeconds: 900, outputRoot: DEFAULT_OUTPUT_ROOT, runId: null,
    staticOnly: false, fixturesOnly: false, dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${argument} requires a value`);
      return argv[index];
    };
    if (argument === "--profile") options.profile = value();
    else if (argument === "--model") options.model = value();
    else if (argument === "--thinking") options.thinking = value();
    else if (argument === "--timeout-seconds") options.timeoutSeconds = Number(value());
    else if (argument === "--output-root") options.outputRoot = value();
    else if (argument === "--run-id") options.runId = value();
    else if (argument === "--static-only") options.staticOnly = true;
    else if (argument === "--fixtures-only") options.fixturesOnly = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--help" || argument === "-h") { usage(); process.exit(0); }
    else throw new Error(`unknown option: ${argument}`);
  }
  if (!CATALOG.profiles[options.profile]) throw new Error("--profile must be quick or full");
  if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(options.model)) throw new Error("invalid --model");
  if (!LEVELS.has(options.thinking)) throw new Error("invalid --thinking level");
  if (!Number.isInteger(options.timeoutSeconds) || options.timeoutSeconds < 60) {
    throw new Error("--timeout-seconds must be an integer of at least 60");
  }
  if (options.runId && !/^[a-zA-Z0-9._-]+$/.test(options.runId)) throw new Error("invalid --run-id");
  if ([options.staticOnly, options.fixturesOnly, options.dryRun].filter(Boolean).length > 1) {
    throw new Error("--static-only, --fixtures-only, and --dry-run are mutually exclusive");
  }
  return options;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code: code ?? 1, signal }));
  });
}

function selectedCases(profile) {
  const byId = new Map(CATALOG.cases.map((item) => [item.id, item]));
  return CATALOG.profiles[profile].map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error(`catalog profile references missing case ${id}`);
    return item;
  });
}

function makeRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cases = selectedCases(options.profile);
  const groups = ["incidents", "remote-dc-onboarding"].map((suite) => ({
    suite,
    cases: cases.filter((item) => item.suite === suite),
  })).filter((group) => group.cases.length);

  if (options.staticOnly || options.fixturesOnly || options.dryRun) {
    for (const group of groups) {
      const args = [join(BENCHMARKS_ROOT, group.suite, "run.mjs"), "--cases", group.cases.map((item) => item.id).join(",")];
      if (options.staticOnly) args.push("--static-only");
      if (options.fixturesOnly) args.push("--fixtures-only");
      if (options.dryRun) {
        args.push("--model", options.model, "--thinking", options.thinking,
          "--timeout-seconds", String(options.timeoutSeconds));
        process.stdout.write(`dry-run node ${args.join(" ")}\n`);
        continue;
      }
      const result = await run(process.execPath, args);
      if (result.code !== 0) throw new Error(`${group.suite} ${options.staticOnly ? "static" : "fixture"} validation failed`);
    }
    return;
  }

  const runId = options.runId ?? makeRunId();
  const outputDirectory = join(options.outputRoot, runId);
  const runsRoot = join(outputDirectory, "runs");
  const lockDirectory = join(options.outputRoot, ".lock");
  await mkdir(options.outputRoot, { recursive: true });
  await mkdir(lockDirectory).catch((error) => {
    if (error.code === "EEXIST") throw new Error(`workstation regression already running: ${lockDirectory}`);
    throw error;
  });
  const rawRecords = new Map();
  const childRuns = [];
  try {
    await mkdir(runsRoot, { recursive: true });
    for (const group of groups) {
      const summaryPath = join(runsRoot, group.suite, "summary.json");
      const args = [
        join(BENCHMARKS_ROOT, group.suite, "run.mjs"),
        "--cases", group.cases.map((item) => item.id).join(","),
        "--model", options.model, "--thinking", options.thinking,
        "--timeout-seconds", String(options.timeoutSeconds),
        "--output-root", runsRoot, "--run-id", group.suite,
      ];
      process.stdout.write(`regress  ${group.suite}: ${group.cases.map((item) => item.id).join(",")}\n`);
      const result = await run(process.execPath, args);
      const child = JSON.parse(await readFile(summaryPath, "utf8"));
      for (const record of child.records) rawRecords.set(`${group.suite}:${record.scenario}`, record);
      childRuns.push({ suite: group.suite, exit_code: result.code, signal: result.signal, summary_path: summaryPath });
    }
    const records = cases.map((definition) => normalizeRecord(
      definition,
      rawRecords.get(`${definition.suite}:${definition.id}`) ?? { error: "missing child record" },
    ));
    const aggregate = summarize(records);
    const metadata = {
      schema_version: "workstation-regression-summary/1", run_id: runId,
      profile: options.profile, model: options.model, thinking: options.thinking,
    };
    await writeFile(join(outputDirectory, "summary.json"), `${JSON.stringify({
      ...metadata, summary: aggregate, records, child_runs: childRuns,
    }, null, 2)}\n`);
    await writeFile(join(outputDirectory, "REPORT.md"), renderReport(metadata, records, aggregate));
    process.stdout.write(`regress  ${aggregate.passed ? "PASS" : "FAIL"} ${join(outputDirectory, "REPORT.md")}\n`);
    if (!aggregate.passed) process.exitCode = 1;
  } finally {
    await rm(lockDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
