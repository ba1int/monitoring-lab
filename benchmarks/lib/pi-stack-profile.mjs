const EXTENSION_ROOT = "/opt/pi-tools/extensions";

const profiles = {
  plain: [],
  ssh: ["ssh-direct"],
  routed: ["ssh-direct", "thinking-router"],
  continuity: ["ssh-direct", "thinking-router", "context-sentinel"],
  ops: ["ssh-direct", "thinking-router", "context-sentinel", "task-ledger"],
  full: null,
};

function profileNames() {
  return Object.keys(profiles);
}

function profileArgs(name) {
  if (!(name in profiles)) throw new Error(`unknown Pi stack profile: ${name}`);
  if (profiles[name] === null) return [];
  return [
    "--no-extensions",
    ...profiles[name].flatMap((extension) => ["--extension", `${EXTENSION_ROOT}/${extension}/index.ts`]),
  ];
}

function profileEnvironment(name) {
  const routed = ["routed", "continuity", "ops", "full"].includes(name);
  const continuity = ["continuity", "ops", "full"].includes(name);
  const ledger = ["ops", "full"].includes(name);
  return {
    PI_THINKING_ROUTER: routed ? "on" : "off",
    PI_CONTEXT_SENTINEL: continuity ? "on" : "off",
    PI_TASK_LEDGER: ledger ? "on" : "off",
  };
}

export { profileArgs, profileEnvironment, profileNames };
