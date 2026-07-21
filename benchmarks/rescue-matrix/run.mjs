#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderReport, summarizeStrategy } from "./core.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(ROOT, "..", "remote-dc-onboarding", "run.mjs");
const STATE_ROOT = process.env.MONITORING_LAB_STATE ?? join(homedir(), ".local", "state", "monitoring-lab");
const DEFAULT_OUTPUT_ROOT = join(STATE_ROOT, "benchmarks", "rescue-matrix");
const DEFAULT_CASES = "full-onboarding,validator-rollback,concurrent-drift,misleading-ticket,ownership-conflict";
const STRATEGIES = [
  { id: "luna", label: "A · Luna low", model: "openai-codex/gpt-5.6-luna", thinking: "low", rescue: false },
  { id: "rescue", label: "B · Luna low + scoped Sol", model: "openai-codex/gpt-5.6-luna", thinking: "low", rescue: true },
  { id: "sol", label: "C · Sol high", model: "openai-codex/gpt-5.6-sol", thinking: "high", rescue: false },
];

function parseArgs(argv) {
  const options = { cases: DEFAULT_CASES, repeats: 1, timeoutSeconds: 900, outputRoot: DEFAULT_OUTPUT_ROOT, runId: null, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${argument} requires a value`);
      return argv[index];
    };
    if (argument === "--cases") options.cases = value();
    else if (argument === "--repeats") options.repeats = Number(value());
    else if (argument === "--timeout-seconds") options.timeoutSeconds = Number(value());
    else if (argument === "--output-root") options.outputRoot = value();
    else if (argument === "--run-id") options.runId = value();
    else if (argument === "--dry-run") options.dryRun = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  if (!Number.isInteger(options.repeats) || options.repeats < 1 || options.repeats > 3) throw new Error("--repeats must be 1-3");
  if (!Number.isInteger(options.timeoutSeconds) || options.timeoutSeconds < 60) throw new Error("--timeout-seconds must be at least 60");
  if (options.runId && !/^[a-zA-Z0-9._-]+$/.test(options.runId)) throw new Error("invalid --run-id");
  return options;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = options.runId ?? new Date().toISOString().replace(/[:.]/g, "-");
  const outputDirectory = join(options.outputRoot, runId);
  const lock = join(options.outputRoot, ".lock");
  await mkdir(options.outputRoot, { recursive: true });
  await mkdir(lock).catch((error) => {
    if (error.code === "EEXIST") throw new Error(`rescue matrix already running: ${lock}`);
    throw error;
  });
  const runs = [];
  try {
    await mkdir(outputDirectory, { recursive: true });
    for (let repeat = 1; repeat <= options.repeats; repeat += 1) {
      const order = STRATEGIES.slice((repeat - 1) % STRATEGIES.length)
        .concat(STRATEGIES.slice(0, (repeat - 1) % STRATEGIES.length));
      for (const strategy of order) {
        const childId = `${strategy.id}-r${repeat}`;
        const childRoot = join(outputDirectory, "runs");
        const summaryPath = join(childRoot, childId, "summary.json");
        const args = [
          RUNNER, "--cases", options.cases, "--model", strategy.model,
          "--thinking", strategy.thinking, "--timeout-seconds", String(options.timeoutSeconds),
          "--output-root", childRoot, "--run-id", childId,
        ];
        if (strategy.rescue) args.push("--rescue");
        process.stdout.write(`rescue-matrix ${strategy.label} repeat=${repeat}\n`);
        if (options.dryRun) {
          process.stdout.write(`dry-run node ${args.join(" ")}\n`);
          continue;
        }
        const exitCode = await run(process.execPath, args);
        const child = JSON.parse(await readFile(summaryPath, "utf8"));
        runs.push({ strategy: strategy.id, repeat, exit_code: exitCode, summary_path: summaryPath, records: child.records });
      }
    }
    if (options.dryRun) return;
    const summaries = STRATEGIES.map((strategy) => summarizeStrategy(
      strategy,
      runs.filter((run) => run.strategy === strategy.id).flatMap((run) => run.records),
    ));
    const summary = {
      schema_version: "senior-rescue-matrix/1", run_id: runId, cases: options.cases.split(","),
      repeats: options.repeats, strategies: summaries,
      runs: runs.map(({ records, ...run }) => ({ ...run, record_count: records.length })),
    };
    await writeFile(join(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    await writeFile(join(outputDirectory, "REPORT.md"), renderReport(runId, summaries, runs));
    process.stdout.write(`report ${join(outputDirectory, "REPORT.md")}\n`);
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
