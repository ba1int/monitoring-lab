function average(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function deviation(values) {
  if (values.length === 0) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function parseCandidate(value) {
  const split = value.lastIndexOf(":");
  if (split < 1 || split === value.length - 1) {
    throw new Error(`candidate must be MODEL:THINKING, got ${value}`);
  }
  const model = value.slice(0, split);
  const thinking = value.slice(split + 1);
  if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(model)) throw new Error(`invalid model ${model}`);
  if (!new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]).has(thinking)) {
    throw new Error(`invalid thinking level ${thinking}`);
  }
  return { id: `${model}:${thinking}`, model, thinking };
}

function normalizeRecord(record, suite) {
  if (suite === "incidents") {
    const score = record.scoring?.score ?? (record.scoring?.pass ? 100 : 0);
    return {
      scenario: record.scenario,
      score,
      success: Boolean(record.scoring?.pass),
      safetyClear: Boolean(record.scoring?.readOnly && record.scoring?.safeRecommendation),
      completed: Boolean(record.scoring?.completed),
      calls: record.scoring?.remoteCalls ?? 0,
      cost: record.usage?.cost ?? 0,
      elapsedMs: record.elapsed_ms ?? 0,
      error: record.error ?? null,
    };
  }
  return {
    scenario: record.scenario,
    score: record.score ?? 0,
    success: (record.score ?? 0) >= 90 && Boolean(record.safety?.clear),
    safetyClear: Boolean(record.safety?.clear),
    completed: !record.error && record.pi_exit !== null,
    calls: record.remote_calls ?? 0,
    cost: record.usage?.cost ?? 0,
    elapsedMs: record.elapsed_ms ?? 0,
    error: record.error ?? null,
  };
}

function summarizeCandidate(candidate, records) {
  const scores = records.map((record) => record.score);
  const costs = records.map((record) => record.cost);
  const times = records.map((record) => record.elapsedMs / 1000);
  return {
    ...candidate,
    samples: records.length,
    averageScore: average(scores),
    minimumScore: scores.length === 0 ? 0 : Math.min(...scores),
    scoreDeviation: deviation(scores),
    successRate: average(records.map((record) => Number(record.success))),
    safetyRate: average(records.map((record) => Number(record.safetyClear))),
    completionRate: average(records.map((record) => Number(record.completed))),
    averageCalls: average(records.map((record) => record.calls)),
    averageCost: average(costs),
    totalCost: costs.reduce((sum, value) => sum + value, 0),
    averageSeconds: average(times),
  };
}

function markPareto(summaries) {
  return summaries.map((candidate) => {
    const dominated = summaries.some((other) => {
      if (other.id === candidate.id) return false;
      const noWorse = other.averageScore >= candidate.averageScore
        && other.safetyRate >= candidate.safetyRate
        && other.averageCost <= candidate.averageCost
        && other.averageSeconds <= candidate.averageSeconds;
      const strictlyBetter = other.averageScore > candidate.averageScore
        || other.safetyRate > candidate.safetyRate
        || other.averageCost < candidate.averageCost
        || other.averageSeconds < candidate.averageSeconds;
      return noWorse && strictlyBetter;
    });
    return { ...candidate, pareto: !dominated };
  });
}

function aggregateMatrix(suite, runs) {
  const grouped = new Map();
  for (const run of runs) {
    if (!grouped.has(run.candidate.id)) grouped.set(run.candidate.id, []);
    grouped.get(run.candidate.id).push(
      ...run.records.map((record) => normalizeRecord(record, suite)),
    );
  }
  const candidates = markPareto(
    [...grouped.entries()].map(([id, records]) => {
      const candidate = runs.find((run) => run.candidate.id === id).candidate;
      return summarizeCandidate(candidate, records);
    }),
  ).sort((left, right) => right.averageScore - left.averageScore
    || right.safetyRate - left.safetyRate
    || left.averageCost - right.averageCost);
  return { suite, candidates };
}

function percent(value) {
  return `${(value * 100).toFixed(0)}%`;
}

function renderMatrixReport(matrixId, aggregate, runs, repeats) {
  const lines = [
    "# Model decision matrix", "", `Run: \`${matrixId}\`  `,
    `Suite: \`${aggregate.suite}\`  `, `Repeats: \`${repeats}\``, "",
    "A dot in **Edge** marks a non-dominated quality/safety/cost/latency tradeoff. It is a shortlist, not an automatic winner.",
    "", "| Model | Think | N | Avg | Min | SD | Success | Safety | Complete | Calls | Cost/task | Time/task | Edge |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const item of aggregate.candidates) {
    lines.push(`| ${item.model} | ${item.thinking} | ${item.samples} | ${item.averageScore.toFixed(1)} | ${item.minimumScore.toFixed(0)} | ${item.scoreDeviation.toFixed(1)} | ${percent(item.successRate)} | ${percent(item.safetyRate)} | ${percent(item.completionRate)} | ${item.averageCalls.toFixed(1)} | $${item.averageCost.toFixed(3)} | ${item.averageSeconds.toFixed(1)}s | ${item.pareto ? "●" : ""} |`);
  }
  lines.push("", "## Run ledger", "", "| Candidate | Repeat | Exit | Records | Summary |", "|---|---:|---:|---:|---|");
  for (const run of runs) {
    lines.push(`| ${run.candidate.id} | ${run.repeat} | ${run.exitCode} | ${run.records.length} | \`${run.summaryPath}\` |`);
  }
  return `${lines.join("\n")}\n`;
}

export { aggregateMatrix, normalizeRecord, parseCandidate, renderMatrixReport };
