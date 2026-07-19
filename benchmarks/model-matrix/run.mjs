#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { aggregateMatrix, parseCandidate, renderMatrixReport } from "./core.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BENCHMARKS_ROOT = join(ROOT, "..");
const STATE_ROOT = process.env.MONITORING_LAB_STATE
  ?? join(homedir(), ".local", "state", "monitoring-lab");
const DEFAULT_OUTPUT_ROOT = join(STATE_ROOT, "benchmarks", "model-matrix");
const PROFILES = {
  screen: [
    "openai-codex/gpt-5.6-luna:low",
    "openai-codex/gpt-5.6-terra:low",
    "openai-codex/gpt-5.6-sol:low",
    "openai-codex/gpt-5.6-luna:high",
    "openai-codex/gpt-5.6-terra:high",
    "openai-codex/gpt-5.6-sol:high",
  ],
  deep: ["luna", "terra", "sol"].flatMap((family) =>
    ["low", "medium", "high", "xhigh"].map(
      (thinking) => `openai-codex/gpt-5.6-${family}:${thinking}`,
    )),
};

function usage() {
  process.stdout.write(`Model decision matrix

Usage: node run.mjs --profile screen|deep [options]

  --suite NAME            incidents or remote-dc-onboarding (default: incidents)
  --profile NAME          screen (6 candidates) or deep (12 candidates)
  --candidates LIST       Comma-separated MODEL:THINKING entries instead of a profile
  --repeats N             Repeat each candidate (default: 1)
  --cases ID,ID           Forward a scenario selection to the suite
  --limit N               Forward a scenario limit to the suite
  --timeout-seconds N     Forward the per-scenario timeout
  --output-root PATH      Matrix result root
  --run-id ID             Stable matrix directory name
  --rescore RUN_ID        Re-evaluate every saved child run without model calls
  --dry-run               Print the run ledger without model calls
  --help                  Show this help

Use screen for cheap elimination, then repeat only the non-dominated candidates
three times on the full discrimination tier. A deep run is intentionally not
the default because it can be expensive.
`);
}

function parseArgs(argv) {
  const options = {
    suite: "incidents", profile: null, candidates: null, repeats: 1,
    cases: null, limit: null, timeoutSeconds: null,
    outputRoot: DEFAULT_OUTPUT_ROOT, runId: null, dryRun: false,
    rescore: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${argument} requires a value`);
      return argv[index];
    };
    switch (argument) {
      case "--suite": options.suite = value(); break;
      case "--profile": options.profile = value(); break;
      case "--candidates": options.candidates = value().split(",").filter(Boolean); break;
      case "--repeats": options.repeats = Number(value()); break;
      case "--cases": options.cases = value(); break;
      case "--limit": options.limit = Number(value()); break;
      case "--timeout-seconds": options.timeoutSeconds = Number(value()); break;
      case "--output-root": options.outputRoot = value(); break;
      case "--run-id": options.runId = value(); break;
      case "--rescore": options.rescore = value(); break;
      case "--dry-run": options.dryRun = true; break;
      case "--help": case "-h": usage(); process.exit(0); break;
      default: throw new Error(`unknown option: ${argument}`);
    }
  }
  if (!new Set(["incidents", "remote-dc-onboarding"]).has(options.suite)) {
    throw new Error("--suite must be incidents or remote-dc-onboarding");
  }
  if (options.profile && options.candidates) throw new Error("choose --profile or --candidates, not both");
  if (!options.rescore && !options.profile && !options.candidates) {
    throw new Error("--profile or --candidates is required");
  }
  if (options.rescore && (options.profile || options.candidates || options.runId
      || options.cases || options.limit !== null || options.timeoutSeconds !== null
      || options.dryRun)) {
    throw new Error("--rescore cannot be combined with candidates, selection, timeout, dry-run, or run-id");
  }
  if (options.profile && !PROFILES[options.profile]) throw new Error(`unknown profile ${options.profile}`);
  if (!Number.isInteger(options.repeats) || options.repeats < 1 || options.repeats > 10) {
    throw new Error("--repeats must be an integer from 1 to 10");
  }
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  if (options.runId && !/^[a-zA-Z0-9._-]+$/.test(options.runId)) {
    throw new Error("--run-id may contain only letters, digits, dot, underscore, and dash");
  }
  if (options.rescore && !/^[a-zA-Z0-9._-]+$/.test(options.rescore)) {
    throw new Error("--rescore may contain only letters, digits, dot, underscore, and dash");
  }
  const raw = options.candidates ?? PROFILES[options.profile] ?? [];
  options.parsedCandidates = raw.map(parseCandidate);
  return options;
}

function makeRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeId(candidate) {
  return `${candidate.model.split("/").at(-1)}-${candidate.thinking}`.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code: code ?? 1, signal }));
  });
}

async function writeResults(outputDirectory, matrixId, suite, repeats, ledger) {
  const aggregate = aggregateMatrix(suite, ledger);
  const summary = {
    schema_version: "model-decision-matrix/1",
    run_id: matrixId,
    suite,
    repeats,
    candidates: aggregate.candidates,
    runs: ledger.map(({ records, ...run }) => ({ ...run, record_count: records.length })),
  };
  await writeFile(join(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(
    join(outputDirectory, "REPORT.md"),
    renderMatrixReport(matrixId, aggregate, ledger, repeats),
  );
  process.stdout.write(`matrix   ${join(outputDirectory, "REPORT.md")}\n`);
}

async function rescoreMatrix(options) {
  const outputDirectory = join(options.outputRoot, options.rescore);
  const saved = JSON.parse(await readFile(join(outputDirectory, "summary.json"), "utf8"));
  const runner = join(BENCHMARKS_ROOT, saved.suite, "run.mjs");
  const ledger = [];
  for (const savedRun of saved.runs) {
    const childRunId = basename(dirname(savedRun.summaryPath));
    const runsRoot = dirname(dirname(savedRun.summaryPath));
    const result = await run(process.execPath, [
      runner, "--output-root", runsRoot, "--rescore", childRunId,
    ]);
    if (result.code !== 0) throw new Error(`rescore failed for ${childRunId}`);
    const child = JSON.parse(await readFile(savedRun.summaryPath, "utf8"));
    ledger.push({ ...savedRun, exitCode: result.code, records: child.records });
  }
  await writeResults(outputDirectory, saved.run_id, saved.suite, saved.repeats, ledger);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.rescore) {
    await rescoreMatrix(options);
    return;
  }
  const matrixId = options.runId ?? makeRunId();
  const outputDirectory = join(options.outputRoot, matrixId);
  const runsRoot = join(outputDirectory, "runs");
  const lockDirectory = join(options.outputRoot, ".lock");
  const runner = join(BENCHMARKS_ROOT, options.suite, "run.mjs");
  await mkdir(options.outputRoot, { recursive: true });
  await mkdir(lockDirectory).catch((error) => {
    if (error.code === "EEXIST") throw new Error(`model matrix already running: ${lockDirectory}`);
    throw error;
  });
  const ledger = [];
  try {
    await mkdir(runsRoot, { recursive: true });
    for (let repeat = 1; repeat <= options.repeats; repeat += 1) {
      const offset = (repeat - 1) % options.parsedCandidates.length;
      const candidates = options.parsedCandidates.slice(offset)
        .concat(options.parsedCandidates.slice(0, offset));
      for (const candidate of candidates) {
        const childRunId = `${safeId(candidate)}-r${repeat}`;
        const summaryPath = join(runsRoot, childRunId, "summary.json");
        const args = [
          runner, "--model", candidate.model, "--thinking", candidate.thinking,
          "--output-root", runsRoot, "--run-id", childRunId,
        ];
        if (options.cases) args.push("--cases", options.cases);
        if (options.limit !== null) args.push("--limit", String(options.limit));
        if (options.timeoutSeconds !== null) args.push("--timeout-seconds", String(options.timeoutSeconds));
        process.stdout.write(`matrix   ${candidate.id} repeat=${repeat}\n`);
        if (options.dryRun) {
          process.stdout.write(`dry-run  node ${args.join(" ")}\n`);
          continue;
        }
        const result = await run(process.execPath, args);
        let summary;
        try {
          summary = JSON.parse(await readFile(summaryPath, "utf8"));
        } catch (error) {
          throw new Error(`${candidate.id} repeat ${repeat} produced no readable summary: ${error.message}`);
        }
        ledger.push({
          candidate, repeat, exitCode: result.code, signal: result.signal,
          summaryPath, records: summary.records,
        });
      }
    }
    if (options.dryRun) return;
    await writeResults(outputDirectory, matrixId, options.suite, options.repeats, ledger);
  } finally {
    await rm(lockDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
