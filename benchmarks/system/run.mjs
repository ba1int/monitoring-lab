#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { profileNames } from "../lib/pi-stack-profile.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BENCHMARKS = join(ROOT, "..");
const STATE_ROOT = process.env.MONITORING_LAB_STATE ?? join(homedir(), ".local", "state", "monitoring-lab");
const DEFAULT_OUTPUT_ROOT = join(STATE_ROOT, "benchmarks", "system");
const SCREEN_CASES = "hidden-cr,dependency-chain,config-precedence";

function parseArgs(argv) {
  const options = {
    profiles: ["plain", "ssh", "routed", "continuity", "ops", "full"],
    cases: SCREEN_CASES, model: "openai-codex/gpt-5.6-luna", thinking: "low",
    repeats: 1, timeoutSeconds: 300, outputRoot: DEFAULT_OUTPUT_ROOT,
    runId: null, dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${argument} requires a value`);
      return argv[index];
    };
    switch (argument) {
      case "--profiles": options.profiles = value().split(",").filter(Boolean); break;
      case "--cases": options.cases = value(); break;
      case "--model": options.model = value(); break;
      case "--thinking": options.thinking = value(); break;
      case "--repeats": options.repeats = Number(value()); break;
      case "--timeout-seconds": options.timeoutSeconds = Number(value()); break;
      case "--output-root": options.outputRoot = value(); break;
      case "--run-id": options.runId = value(); break;
      case "--dry-run": options.dryRun = true; break;
      case "--help": case "-h":
        process.stdout.write("Usage: node run.mjs [--profiles LIST] [--cases LIST] [--repeats N] [--dry-run]\n");
        process.exit(0);
      default: throw new Error(`unknown option: ${argument}`);
    }
  }
  const allowed = new Set(profileNames());
  if (options.profiles.some((profile) => !allowed.has(profile))) throw new Error("invalid --profiles");
  if (!Number.isInteger(options.repeats) || options.repeats < 1 || options.repeats > 5) throw new Error("--repeats must be 1-5");
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

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function aggregate(records) {
  return [...new Set(records.map((record) => record.stack_profile))].map((profile) => {
    const selected = records.filter((record) => record.stack_profile === profile);
    return {
      profile, samples: selected.length,
      averageScore: average(selected.map((record) => record.scoring.score)),
      minimumScore: Math.min(...selected.map((record) => record.scoring.score)),
      passRate: average(selected.map((record) => Number(record.scoring.pass))),
      safetyRate: average(selected.map((record) => Number(record.scoring.readOnly && record.scoring.safeRecommendation))),
      completionRate: average(selected.map((record) => Number(record.scoring.completed))),
      averageCalls: average(selected.map((record) => record.scoring.remoteCalls)),
      averageCost: average(selected.map((record) => record.usage.cost)),
      totalCost: selected.reduce((sum, record) => sum + record.usage.cost, 0),
      averageSeconds: average(selected.map((record) => record.elapsed_ms / 1_000)),
    };
  }).sort((left, right) => right.averageScore - left.averageScore || left.averageCost - right.averageCost);
}

function report(runId, summaries, records) {
  const lines = [
    "# Pi workstation ablation", "", `Run: \`${runId}\``, "",
    "Profiles are cumulative. A later profile earns retention only when it improves a measured claim without a safety regression.",
    "", "| Profile | N | Avg | Min | Pass | Safety | Complete | Calls | Cost/task | Time/task |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const item of summaries) {
    lines.push(`| ${item.profile} | ${item.samples} | ${item.averageScore.toFixed(1)} | ${item.minimumScore} | ${(100 * item.passRate).toFixed(0)}% | ${(100 * item.safetyRate).toFixed(0)}% | ${(100 * item.completionRate).toFixed(0)}% | ${item.averageCalls.toFixed(1)} | $${item.averageCost.toFixed(3)} | ${item.averageSeconds.toFixed(1)}s |`);
  }
  lines.push("", "## Cases", "", "| Profile | Case | Score | Pass | Safety | Cost | Time |", "|---|---|---:|---:|---:|---:|---:|");
  for (const record of records) {
    lines.push(`| ${record.stack_profile} | ${record.scenario} | ${record.scoring.score} | ${record.scoring.pass ? "yes" : "no"} | ${record.scoring.readOnly && record.scoring.safeRecommendation ? "clear" : "FAILED"} | $${record.usage.cost.toFixed(3)} | ${(record.elapsed_ms / 1_000).toFixed(1)}s |`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = options.runId ?? new Date().toISOString().replace(/[:.]/g, "-");
  const outputDirectory = join(options.outputRoot, runId);
  const runsRoot = join(outputDirectory, "runs");
  await mkdir(runsRoot, { recursive: true });
  const records = [];
  for (let repeat = 1; repeat <= options.repeats; repeat += 1) {
    for (const profile of options.profiles) {
      const childId = `${profile}-r${repeat}`;
      const args = [
        join(BENCHMARKS, "incidents", "run.mjs"),
        "--stack-profile", profile, "--cases", options.cases,
        "--model", options.model, "--thinking", options.thinking,
        "--timeout-seconds", String(options.timeoutSeconds),
        "--output-root", runsRoot, "--run-id", childId,
      ];
      process.stdout.write(`system   profile=${profile} repeat=${repeat}\n`);
      if (options.dryRun) {
        process.stdout.write(`dry-run  node ${args.join(" ")}\n`);
        continue;
      }
      const code = await run(process.execPath, args);
      let child;
      try {
        child = JSON.parse(await readFile(join(runsRoot, childId, "summary.json"), "utf8"));
      } catch (error) {
        throw new Error(`${profile} repeat ${repeat} produced no report (exit ${code}): ${error.message}`);
      }
      if (code !== 0) process.stdout.write(`system   profile=${profile} retained scored failures (exit=${code})\n`);
      records.push(...child.records);
    }
  }
  if (options.dryRun) return;
  const summaries = aggregate(records);
  await writeFile(join(outputDirectory, "summary.json"), `${JSON.stringify({
    schema_version: "pi-system-ablation/1", run_id: runId, model: options.model,
    thinking: options.thinking, repeats: options.repeats, cases: options.cases,
    profiles: summaries, records,
  }, null, 2)}\n`);
  await writeFile(join(outputDirectory, "REPORT.md"), report(runId, summaries, records));
  process.stdout.write(`report   ${join(outputDirectory, "REPORT.md")}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
