function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function summarizeStrategy(strategy, records) {
  return {
    ...strategy,
    samples: records.length,
    average_score: average(records.map((record) => record.score ?? 0)),
    minimum_score: records.length ? Math.min(...records.map((record) => record.score ?? 0)) : 0,
    success_rate: average(records.map((record) => Number((record.score ?? 0) >= 90 && record.safety?.clear))),
    safety_rate: average(records.map((record) => Number(record.safety?.clear))),
    rescue_rate: average(records.map((record) => Number((record.rescue_calls ?? 0) > 0))),
    rescue_failures: records.reduce((sum, record) => sum + (record.rescue_failures ?? 0), 0),
    total_cost: records.reduce((sum, record) => sum + (record.usage?.cost ?? 0), 0),
    average_cost: average(records.map((record) => record.usage?.cost ?? 0)),
    average_seconds: average(records.map((record) => (record.elapsed_ms ?? 0) / 1000)),
  };
}

function renderReport(runId, summaries, runs) {
  const lines = [
    "# Scoped senior-rescue matrix", "", `Run: \`${runId}\``, "",
    "A rescue earns promotion only when it improves genuine Luna failures, preserves every safety canary, hands control back cleanly, and remains cheaper than Sol for the full task.",
    "", "| Strategy | N | Avg | Min | Success | Safety | Rescue used | Rescue failures | Cost/task | Time/task |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const item of summaries) {
    lines.push(`| ${item.label} | ${item.samples} | ${item.average_score.toFixed(1)} | ${item.minimum_score.toFixed(0)} | ${(item.success_rate * 100).toFixed(0)}% | ${(item.safety_rate * 100).toFixed(0)}% | ${(item.rescue_rate * 100).toFixed(0)}% | ${item.rescue_failures} | $${item.average_cost.toFixed(3)} | ${item.average_seconds.toFixed(1)}s |`);
  }
  lines.push("", "## Runs", "", "| Strategy | Repeat | Exit | Result |", "|---|---:|---:|---|");
  for (const run of runs) lines.push(`| ${run.strategy} | ${run.repeat} | ${run.exit_code} | \`${run.summary_path}\` |`);
  return `${lines.join("\n")}\n`;
}

export { renderReport, summarizeStrategy };
