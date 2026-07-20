#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { compactionPrompt, continuationPrompt, scoreCase } from "./core.mjs";
import { scenarios } from "./scenarios.mjs";

const STATE_ROOT = process.env.MONITORING_LAB_STATE
  ?? join(homedir(), ".local", "state", "monitoring-lab");
const DEFAULT_OUTPUT_ROOT = join(STATE_ROOT, "benchmarks", "compaction");
const STRATEGIES = new Set(["native", "sentinel", "capsule"]);
const LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;

function usage() {
  process.stdout.write(`Compaction continuity benchmark

Usage: node run.mjs [options]

  --strategies LIST       native,sentinel,capsule (default: all)
  --cases LIST            Comma-separated scenario IDs
  --model MODEL           Pi model (default: openai-codex/gpt-5.6-luna)
  --thinking LEVEL        Thinking level (default: low)
  --repeats N             Repetitions per case and strategy (default: 1)
  --timeout-seconds N     Per model call timeout (default: 180)
  --output-root PATH      Result parent directory
  --run-id ID             Stable result directory name
  --rescore RUN_ID        Re-evaluate saved outputs without model calls
  --static-only           Validate cases and render prompts without model calls
  --help                  Show this help

Runs sequentially on purpose. Reliability comes from repeats, not risky parallel load.
`);
}

function parseArgs(argv) {
  const options = {
    strategies: ["native", "sentinel", "capsule"], cases: null,
    model: "openai-codex/gpt-5.6-luna", thinking: "low", repeats: 1,
    timeoutSeconds: 180, outputRoot: DEFAULT_OUTPUT_ROOT, runId: null,
    staticOnly: false, rescore: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${argument} requires a value`);
      return argv[index];
    };
    switch (argument) {
      case "--strategies": options.strategies = value().split(",").filter(Boolean); break;
      case "--cases": options.cases = new Set(value().split(",").filter(Boolean)); break;
      case "--model": options.model = value(); break;
      case "--thinking": options.thinking = value(); break;
      case "--repeats": options.repeats = Number(value()); break;
      case "--timeout-seconds": options.timeoutSeconds = Number(value()); break;
      case "--output-root": options.outputRoot = value(); break;
      case "--run-id": options.runId = value(); break;
      case "--static-only": options.staticOnly = true; break;
      case "--rescore": options.rescore = value(); break;
      case "--help": case "-h": usage(); process.exit(0); break;
      default: throw new Error(`unknown option: ${argument}`);
    }
  }
  if (options.strategies.length === 0 || options.strategies.some((item) => !STRATEGIES.has(item))) {
    throw new Error("--strategies accepts native,sentinel,capsule");
  }
  if (!LEVELS.has(options.thinking)) throw new Error("invalid --thinking level");
  if (!Number.isInteger(options.repeats) || options.repeats < 1 || options.repeats > 10) {
    throw new Error("--repeats must be an integer from 1 to 10");
  }
  if (!Number.isInteger(options.timeoutSeconds) || options.timeoutSeconds < 30) {
    throw new Error("--timeout-seconds must be at least 30");
  }
  if (options.runId && !/^[a-zA-Z0-9._-]+$/.test(options.runId)) {
    throw new Error("--run-id may contain only letters, digits, dot, underscore, and dash");
  }
  if (options.rescore && !/^[a-zA-Z0-9._-]+$/.test(options.rescore)) {
    throw new Error("--rescore may contain only letters, digits, dot, underscore, and dash");
  }
  return options;
}

function makeRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function run(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    const collect = (chunks, chunk, bytes) => {
      if (bytes < MAX_CAPTURE_BYTES) chunks.push(chunk.subarray(0, MAX_CAPTURE_BYTES - bytes));
      return bytes + chunk.length;
    };
    child.stdout.on("data", (chunk) => { stdoutBytes = collect(stdout, chunk, stdoutBytes); });
    child.stderr.on("data", (chunk) => { stderrBytes = collect(stderr, chunk, stderrBytes); });
    child.on("error", reject);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        code, signal, timedOut,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        truncated: stdoutBytes > MAX_CAPTURE_BYTES || stderrBytes > MAX_CAPTURE_BYTES,
      });
    });
  });
}

async function findSessionFile(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await findSessionFile(path);
      if (found) return found;
    } else if (entry.name.endsWith(".jsonl")) return path;
  }
  return null;
}

function sessionUsage(text) {
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 };
  for (const line of text.split("\n").filter(Boolean)) {
    const entry = JSON.parse(line);
    if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
    const current = entry.message.usage ?? {};
    total.input += current.input ?? 0;
    total.output += current.output ?? 0;
    total.cacheRead += current.cacheRead ?? 0;
    total.cacheWrite += current.cacheWrite ?? 0;
    total.reasoning += current.reasoning ?? 0;
    total.cost += current.cost?.total ?? 0;
  }
  return total;
}

function addUsage(target, current) {
  for (const key of Object.keys(target)) target[key] += current[key] ?? 0;
}

async function callPi(prompt, options, label) {
  const workstation = process.env.COMPACTION_BENCH_WORKSTATION;
  if (workstation) return callPiInWorkstation(prompt, options, label, workstation);
  const sessionDirectory = await mkdtemp(join(tmpdir(), "pi-compaction-bench-"));
  const startedAt = Date.now();
  try {
    const result = await run(process.env.PI_BIN ?? "pi", [
      "--print", "--mode", "text", "--no-tools", "--no-extensions", "--no-skills",
      "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-approve",
      "--session-dir", sessionDirectory, "--name", label,
      "--model", options.model, "--thinking", options.thinking, prompt,
    ], options.timeoutSeconds * 1_000);
    const sessionPath = await findSessionFile(sessionDirectory);
    const sessionText = sessionPath ? await readFile(sessionPath, "utf8") : "";
    if (result.code !== 0 || result.timedOut) {
      throw new Error(`Pi call failed exit=${result.code} timeout=${result.timedOut}: ${result.stderr.slice(-1_000)}`);
    }
    return {
      text: result.stdout.trim(), usage: sessionUsage(sessionText),
      elapsedMs: Date.now() - startedAt, outputTruncated: result.truncated,
    };
  } finally {
    await rm(sessionDirectory, { recursive: true, force: true });
  }
}

function dockerArgs(args) {
  const context = process.env.COMPACTION_BENCH_DOCKER_CONTEXT;
  return context ? ["--context", context, ...args] : args;
}

async function callPiInWorkstation(prompt, options, label, workstation) {
  const sessionDirectory = `/tmp/pi-compaction-bench-${randomUUID()}`;
  const startedAt = Date.now();
  try {
    const result = await run("docker", dockerArgs([
      "exec", "-w", "/home/operator",
      "-e", "PI_SKIP_VERSION_CHECK=1", "-e", "PI_TELEMETRY=0",
      workstation, "/home/operator/.local/bin/pi",
      "--print", "--mode", "text", "--no-tools", "--no-extensions", "--no-skills",
      "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-approve",
      "--session-dir", sessionDirectory, "--name", label,
      "--model", options.model, "--thinking", options.thinking, prompt,
    ]), options.timeoutSeconds * 1_000);
    const locate = await run("docker", dockerArgs([
      "exec", workstation, "find", sessionDirectory, "-type", "f", "-name", "*.jsonl", "-print",
    ]), 10_000);
    const sessionPath = locate.stdout.trim().split("\n").filter(Boolean)[0];
    const session = sessionPath
      ? await run("docker", dockerArgs(["exec", workstation, "cat", sessionPath]), 10_000)
      : { stdout: "" };
    if (result.code !== 0 || result.timedOut) {
      throw new Error(`Pi call failed exit=${result.code} timeout=${result.timedOut}: ${result.stderr.slice(-1_000)}`);
    }
    return {
      text: result.stdout.trim(), usage: sessionUsage(session.stdout),
      elapsedMs: Date.now() - startedAt, outputTruncated: result.truncated,
    };
  } finally {
    await run("docker", dockerArgs(["exec", workstation, "rm", "-rf", "--", sessionDirectory]), 10_000)
      .catch(() => {});
  }
}

async function runCase(scenario, strategy, repeat, options, caseDirectory) {
  const totalUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 };
  const calls = [];
  let summary = "";
  for (let stage = 0; stage < scenario.stages.length; stage += 1) {
    const prompt = compactionPrompt({ strategy, messages: scenario.stages[stage], previousSummary: summary });
    const response = await callPi(prompt, options, `${scenario.id}-${strategy}-r${repeat}-compact-${stage + 1}`);
    summary = response.text;
    addUsage(totalUsage, response.usage);
    calls.push({ kind: "compact", stage: stage + 1, ...response });
  }
  const continuation = await callPi(
    continuationPrompt(summary, scenario), options,
    `${scenario.id}-${strategy}-r${repeat}-continue`,
  );
  addUsage(totalUsage, continuation.usage);
  calls.push({ kind: "continue", ...continuation });
  const scoring = scoreCase(scenario, summary, continuation.text);
  const record = {
    schema_version: "compaction-continuity/1", scenario: scenario.id,
    description: scenario.description, strategy, repeat, model: options.model,
    thinking: options.thinking, compaction_depth: scenario.stages.length,
    usage: totalUsage, elapsed_ms: calls.reduce((sum, call) => sum + call.elapsedMs, 0),
    scoring, summary, continuation: continuation.text,
    calls: calls.map(({ text, ...call }) => call),
  };
  await mkdir(caseDirectory, { recursive: true });
  await writeFile(join(caseDirectory, "result.json"), `${JSON.stringify(record, null, 2)}\n`);
  await writeFile(join(caseDirectory, "summary.txt"), `${summary}\n`);
  await writeFile(join(caseDirectory, "continuation.txt"), `${continuation.text}\n`);
  return record;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function aggregate(records) {
  return [...new Set(records.map((record) => record.strategy))].map((strategy) => {
    const selected = records.filter((record) => record.strategy === strategy);
    return {
      strategy, samples: selected.length,
      average_score: average(selected.map((record) => record.scoring.score)),
      minimum_score: Math.min(...selected.map((record) => record.scoring.score)),
      pass_rate: average(selected.map((record) => Number(record.scoring.pass))),
      safety_rate: average(selected.map((record) => Number(record.scoring.safetyClear))),
      average_cost: average(selected.map((record) => record.usage.cost)),
      total_cost: selected.reduce((sum, record) => sum + record.usage.cost, 0),
      average_seconds: average(selected.map((record) => record.elapsed_ms / 1_000)),
    };
  }).sort((left, right) => right.average_score - left.average_score
    || right.safety_rate - left.safety_rate || left.average_cost - right.average_cost);
}

function report(runId, records, strategies) {
  const lines = [
    "# Compaction continuity benchmark", "", `Run: \`${runId}\``, "",
    "A strategy is deployable only if it has no hard-safety failure and improves repeated continuation behavior, not merely summary wording.",
    "", "| Strategy | N | Avg | Min | Pass | Safety | Cost/case | Time/case |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const item of strategies) {
    lines.push(`| ${item.strategy} | ${item.samples} | ${item.average_score.toFixed(1)} | ${item.minimum_score} | ${(100 * item.pass_rate).toFixed(0)}% | ${(100 * item.safety_rate).toFixed(0)}% | $${item.average_cost.toFixed(3)} | ${item.average_seconds.toFixed(1)}s |`);
  }
  lines.push("", "## Cases", "", "| Case | Strategy | R | Depth | Score | Pass | Safety | Cost | Time |", "|---|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const record of records) {
    lines.push(`| ${record.scenario} | ${record.strategy} | ${record.repeat} | ${record.compaction_depth} | ${record.scoring.score} | ${record.scoring.pass ? "yes" : "no"} | ${record.scoring.safetyClear ? "yes" : "NO"} | $${record.usage.cost.toFixed(3)} | ${(record.elapsed_ms / 1_000).toFixed(1)}s |`);
  }
  const failures = records.filter((record) => !record.scoring.pass);
  if (failures.length) {
    lines.push("", "## Failures", "");
    for (const record of failures) {
      lines.push(`- **${record.scenario} / ${record.strategy} / r${record.repeat}:** missing=${record.scoring.requiredMisses.join("; ") || "none"}; stale=${record.scoring.forbiddenHits.join("; ") || "none"}; continuation=${(100 * record.scoring.continuationAccuracy).toFixed(0)}%; safety=${record.scoring.safetyClear ? "clear" : "FAILED"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const selected = scenarios.filter((scenario) => !options.cases || options.cases.has(scenario.id));
  if (selected.length === 0) throw new Error("no scenarios selected");
  if (options.cases) {
    const missing = [...options.cases].filter((id) => !selected.some((scenario) => scenario.id === id));
    if (missing.length) throw new Error(`unknown scenarios: ${missing.join(", ")}`);
  }
  if (options.rescore) {
    const outputDirectory = join(options.outputRoot, options.rescore);
    const casesDirectory = join(outputDirectory, "cases");
    const records = [];
    for (const entry of (await readdir(casesDirectory, { withFileTypes: true })).filter((item) => item.isDirectory())) {
      const path = join(casesDirectory, entry.name, "result.json");
      const record = JSON.parse(await readFile(path, "utf8"));
      const scenario = scenarios.find((item) => item.id === record.scenario);
      if (!scenario) throw new Error(`saved result references unknown scenario ${record.scenario}`);
      record.scoring = scoreCase(scenario, record.summary ?? "", record.continuation ?? "");
      records.push(record);
      await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
    }
    records.sort((left, right) => left.repeat - right.repeat
      || left.strategy.localeCompare(right.strategy) || left.scenario.localeCompare(right.scenario));
    const strategies = aggregate(records);
    const prior = JSON.parse(await readFile(join(outputDirectory, "summary.json"), "utf8"));
    await writeFile(join(outputDirectory, "summary.json"), `${JSON.stringify({ ...prior, strategies, records }, null, 2)}\n`);
    await writeFile(join(outputDirectory, "REPORT.md"), report(options.rescore, records, strategies));
    process.stdout.write(`rescored ${records.length} results without model calls\n`);
    return;
  }
  const runId = options.runId ?? makeRunId();
  const outputDirectory = join(options.outputRoot, runId);
  await mkdir(outputDirectory, { recursive: true });
  if (options.staticOnly) {
    const prompts = selected.flatMap((scenario) => options.strategies.map((strategy) => ({
      scenario: scenario.id, strategy,
      prompts: scenario.stages.map((messages) => compactionPrompt({ strategy, messages })),
    })));
    await writeFile(join(outputDirectory, "static-prompts.json"), `${JSON.stringify(prompts, null, 2)}\n`);
    process.stdout.write(`validated ${selected.length} scenarios across ${options.strategies.length} strategies\n`);
    return;
  }
  const records = [];
  for (let repeat = 1; repeat <= options.repeats; repeat += 1) {
    for (const strategy of options.strategies) {
      for (const scenario of selected) {
        process.stdout.write(`compact  ${scenario.id} strategy=${strategy} repeat=${repeat}\n`);
        const caseDirectory = join(outputDirectory, "cases", `${scenario.id}-${strategy}-r${repeat}`);
        try {
          const record = await runCase(scenario, strategy, repeat, options, caseDirectory);
          records.push(record);
          process.stdout.write(`result   ${record.scoring.score}/100 ${record.scoring.pass ? "PASS" : "FAIL"} safety=${record.scoring.safetyClear ? "clear" : "FAILED"} cost=$${record.usage.cost.toFixed(3)}\n`);
        } catch (error) {
          const record = {
            schema_version: "compaction-continuity/1", scenario: scenario.id,
            description: scenario.description, strategy, repeat, model: options.model,
            thinking: options.thinking, compaction_depth: scenario.stages.length,
            usage: { cost: 0 }, elapsed_ms: 0,
            scoring: { score: 0, pass: false, safetyClear: false, requiredMisses: [], forbiddenHits: [], continuationAccuracy: 0 },
            error: error.stack ?? String(error),
          };
          records.push(record);
          await mkdir(caseDirectory, { recursive: true });
          await writeFile(join(caseDirectory, "result.json"), `${JSON.stringify(record, null, 2)}\n`);
          process.stdout.write(`result   ERROR ${error.message}\n`);
        }
      }
    }
  }
  const strategies = aggregate(records);
  const output = {
    schema_version: "compaction-continuity-run/1", run_id: runId,
    model: options.model, thinking: options.thinking, repeats: options.repeats,
    strategies, records,
  };
  await writeFile(join(outputDirectory, "summary.json"), `${JSON.stringify(output, null, 2)}\n`);
  await writeFile(join(outputDirectory, "REPORT.md"), report(runId, records, strategies));
  process.stdout.write(`report   ${join(outputDirectory, "REPORT.md")}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
