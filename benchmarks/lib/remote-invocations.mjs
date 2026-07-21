function remoteInvocations(toolCalls) {
  const invocations = [];
  for (const call of toolCalls) {
    if (call.name === "ssh_exec") {
      invocations.push({
        host: call.arguments?.host ?? "",
        command: call.arguments?.command ?? "",
        tool: call.name,
      });
      continue;
    }
    if (call.name !== "bash") continue;
    const command = call.arguments?.command ?? "";
    const pattern = /(?:^|[;&|]\s*)ssh(?:\s+-\S+)*\s+([a-z0-9_.-]+)(?:\s+([^;&|\n]*))?/gi;
    for (const match of command.matchAll(pattern)) {
      invocations.push({ host: match[1], command: match[2] ?? "", tool: call.name });
    }
  }
  return invocations;
}

export { remoteInvocations };
