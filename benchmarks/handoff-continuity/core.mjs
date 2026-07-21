function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function scoreContinuation(scenario, snapshot) {
  const checks = scenario.checks.map((check) => ({
    id: check.id, points: check.points, passed: check.test(snapshot),
  }));
  const safetyFailures = scenario.safety.filter((check) => check.test(snapshot)).map((check) => check.id);
  return {
    score: checks.reduce((sum, check) => sum + (check.passed ? check.points : 0), 0),
    maxScore: checks.reduce((sum, check) => sum + check.points, 0),
    checks,
    safetyFailures,
    safe: safetyFailures.length === 0,
  };
}

function summarize(records) {
  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.strategy)) groups.set(record.strategy, []);
    groups.get(record.strategy).push(record);
  }
  return [...groups.entries()].map(([strategy, samples]) => ({
    strategy,
    samples: samples.length,
    averageScore: average(samples.map((sample) => sample.scoring.score)),
    minimumScore: Math.min(...samples.map((sample) => sample.scoring.score)),
    safetyRate: average(samples.map((sample) => Number(sample.scoring.safe))),
    averageReceiverCost: average(samples.map((sample) => sample.receiver.usage.cost)),
    averageProducerCost: average(samples.map((sample) => sample.producer.usage.cost)),
    averageSeconds: average(samples.map((sample) => sample.elapsed_ms / 1000)),
    averageHandoffBytes: average(samples.map((sample) => sample.handoff_bytes)),
  })).sort((left, right) => right.averageScore - left.averageScore
    || right.safetyRate - left.safetyRate
    || (left.averageProducerCost + left.averageReceiverCost)
      - (right.averageProducerCost + right.averageReceiverCost));
}

function renderReport(runId, records, summary) {
  const lines = [
    "# Handoff continuity benchmark", "", `Run: \`${runId}\``, "",
    "A fresh receiver gets the live workspace plus the candidate continuation artifact. Scores come from live end state and mutation counters, not prose grading.",
    "", "| Strategy | N | Avg | Min | Safety | Producer | Receiver | Handoff | Time |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const item of summary) {
    lines.push(`| ${item.strategy} | ${item.samples} | ${item.averageScore.toFixed(1)} | ${item.minimumScore} | ${(item.safetyRate * 100).toFixed(0)}% | $${item.averageProducerCost.toFixed(3)} | $${item.averageReceiverCost.toFixed(3)} | ${Math.round(item.averageHandoffBytes)} B | ${item.averageSeconds.toFixed(1)}s |`);
  }
  lines.push("", "## Cases", "", "| Scenario | Strategy | Score | Safe | Safety failures |", "|---|---|---:|---:|---|");
  for (const record of records) {
    lines.push(`| ${record.scenario} | ${record.strategy} | ${record.scoring.score}/${record.scoring.maxScore} | ${record.scoring.safe ? "yes" : "NO"} | ${record.scoring.safetyFailures.join(", ") || "—"} |`);
  }
  return `${lines.join("\n")}\n`;
}

export { renderReport, scoreContinuation, summarize };
