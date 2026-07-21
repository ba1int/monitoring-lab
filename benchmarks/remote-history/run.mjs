#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const LAB_ROOT = join(ROOT, "..", "..");
const COMPOSE_FILE = join(LAB_ROOT, "compose.yaml");
const STATE_ROOT = process.env.MONITORING_LAB_STATE
  ?? join(homedir(), ".local", "state", "monitoring-lab");
const OUTPUT_ROOT = join(STATE_ROOT, "benchmarks", "remote-history");
const PI_TOOLS_ROOT = process.env.MONITORING_LAB_PI_TOOLS;
const MAX_BYTES = 32 * 1024 * 1024;

function parseArgs(argv) {
  const options = {
    model: "openai-codex/gpt-5.6-luna", thinking: "low",
    runId: new Date().toISOString().replace(/[:.]/g, "-"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--model") options.model = value();
    else if (arg === "--thinking") options.thinking = value();
    else if (arg === "--run-id") options.runId = value();
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write("usage: lab benchmark remote-history [--model MODEL] [--thinking LEVEL] [--run-id ID]\n");
      process.exit(0);
    } else throw new Error(`unknown option: ${arg}`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(options.runId)) throw new Error("invalid --run-id");
  return options;
}

function run(command, args, { input, timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let timedOut = false;
    const collect = (target, chunk) => {
      bytes += chunk.length;
      if (bytes <= MAX_BYTES) target.push(chunk);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => collect(stdout, chunk));
    child.stderr.on("data", (chunk) => collect(stderr, chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, signal, timedOut,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8") });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

async function requireSuccess(result, context) {
  if (result.code === 0 && !result.timedOut) return result;
  throw new Error(`${context} failed (exit=${result.code}, timeout=${result.timedOut})\n${result.stderr}`);
}

async function docker(args, options) {
  return run("docker", ["compose", "--project-directory", LAB_ROOT, "-f", COMPOSE_FILE, ...args], options);
}

async function containerId(service) {
  const result = await requireSuccess(await docker(["ps", "-q", service]), `resolve ${service}`);
  const id = result.stdout.trim();
  if (!id) throw new Error(`${service} is not running`);
  return id;
}

async function execContainer(container, script, { user = "root", timeoutMs = 60_000 } = {}) {
  return requireSuccess(await run("docker", ["exec", "-i", "--user", user, container, "/bin/bash", "-se"],
    { input: script, timeoutMs }), `exec ${container}`);
}

async function resetHistory(container) {
  await execContainer(container, "install -o operator -g operator -m 0600 /dev/null /home/operator/.bash_history\n");
}

async function history(container) {
  const result = await execContainer(container, "cat /home/operator/.bash_history 2>/dev/null || true\n");
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function check(name, pass, detail = "") {
  return { name, pass: Boolean(pass), detail };
}

function cleanHistoryChecks(lines) {
  const joined = lines.join("\n");
  const outputOnlyStage = lines.some((line) =>
    /^(?:head|tail|sort|uniq|cut|tr|column)(?:\s|$)/.test(line)
    && !/(?:^|\s)(?:\/|\.\/|\.\.\/|~\/)[^\s]*/.test(line));
  return [
    check("no credential values", !/Example(?:History|Bench|Det)|do-not-store/i.test(joined)),
    check("no shell scaffolding", !/^(?:for|while|if|then|do|done|fi)(?:\s|$)/m.test(joined)),
    check("no unresolved variables", !/\$(?:\{|[A-Za-z_])/.test(joined)),
    check("no output-only stages", !outputOnlyStage),
    check("no heredoc launchers", !/<<|^(?:python|bash)(?:3)?(?:\s|$)/m.test(joined)),
    check("no temporary paths", !/(?:^|\s)(?:\/tmp\/|\/var\/tmp\/|\/[^\s]+\/\.[^\s]+\.[0-9]{4,})(?:\s|$)/m.test(joined)),
  ];
}

function sanitizedSshCalls(jsonLines) {
  const calls = [];
  for (const line of jsonLines.split("\n")) {
    if (!line) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type !== "message_end" || event.message?.role !== "assistant") continue;
    for (const item of event.message.content ?? []) {
      if (item.type !== "toolCall" || item.name !== "ssh_exec") continue;
      const host = String(item.arguments?.host ?? "unknown");
      const command = String(item.arguments?.command ?? "")
        .replace(/Example(?:History|Bench|Det)[^\s'\"]*/gi, "[REDACTED]");
      calls.push({ host, command });
    }
  }
  return calls;
}

async function runPi(workstation, options, prompt) {
  const command = "exec pi --no-session --mode json --model \"$1\" --thinking \"$2\" --print \"$3\"";
  const result = await requireSuccess(await run("docker", ["exec", "--user", "operator", workstation,
    "/bin/bash", "-lc", command, "pi-history-benchmark", options.model, options.thinking, prompt],
  { timeoutMs: 300_000 }), "Pi benchmark task");
  return { calls: sanitizedSshCalls(result.stdout) };
}

async function deterministicNestedCase(workstation, target, remoteProgram) {
  await execContainer(target, `
for n in 1 2 3 4; do
  userdel -r "histdet\${n}" >/dev/null 2>&1 || true
  groupdel "histdetg\${n}" >/dev/null 2>&1 || true
done
`);
  await resetHistory(target);
  const command = `set -euo pipefail
sudo /bin/bash <<'ROOT'
set -euo pipefail
for n in 1 2 3; do
  user="histdet\${n}"
  group="histdetg\${n}"
  if ! getent group "$group" >/dev/null; then groupadd "$group"; fi
  if ! getent passwd "$user" >/dev/null; then useradd -m -s /bin/bash -g "$group" "$user"; fi
  usermod -a -G "$group" "$user"
  printf '%s:%s\\n' "$user" "DetExample\${n}!" | chpasswd
  passwd -u "$user" >/dev/null 2>&1 || true
  chage -M 99999 -E -1 "$user"
done
ROOT
GROUPADD=/usr/sbin/groupadd
USERADD=/usr/sbin/useradd
CHPASSWD=/usr/sbin/chpasswd
sudo "$GROUPADD" histdetg4
sudo "$USERADD" -m -s /bin/bash -g histdetg4 histdet4
printf '%s:%s\n' histdet4 'DetExample4!' | sudo "$CHPASSWD"
for n in 1 2 3 4; do getent passwd "histdet\${n}"; getent group "histdetg\${n}"; done`;
  const result = await requireSuccess(await run("docker", ["exec", "-i", "--user", "operator", workstation,
    "ssh", "-T", "-o", "BatchMode=yes", "lab-test-mq01", "exec bash -se"],
  { input: remoteProgram(command) }), "deterministic nested-shell transport");
  const lines = await history(target);
  const joined = lines.join("\n");
  const checks = cleanHistoryChecks(lines);
  for (let n = 1; n <= 4; n += 1) {
    checks.push(check(`group ${n} recorded`, joined.includes(`sudo groupadd histdetg${n}`)));
    checks.push(check(`user ${n} recorded`, joined.includes(`sudo useradd -m -s /bin/bash -g histdetg${n} histdet${n}`)));
    checks.push(check(`user ${n} validated`, joined.includes(`getent passwd histdet${n}`)));
  }
  checks.push(check("password operation recorded", /sudo (?:chpasswd|passwd\b)/m.test(joined)));
  checks.push(check("command completed", result.code === 0));
  return { id: "deterministic-nested-sudo", lines, checks };
}

async function healthCase(workstation, target, options) {
  await resetHistory(target);
  const pi = await runPi(workstation, options,
    "Inspect lab-dev-web01 and report its middleware, resource, network, and monitoring health. Make no changes.");
  const lines = await history(target);
  const joined = lines.join("\n");
  const generated = pi.calls.map((call) => call.command).join("\n");
  const generatedResourceInspection = /^(?:uptime|free\b|df\b|awk .*\/proc\/meminfo)/m.test(generated);
  const retainedResourceInspection = /^(?:uptime|free\b|df\b|awk .*\/proc\/meminfo)/m.test(joined);
  const checks = cleanHistoryChecks(lines);
  checks.push(check("custom monitor retained", joined.includes("/usr/local/libexec/check_lab_middleware")));
  checks.push(check("generated resource inspection retained", !generatedResourceInspection || retainedResourceInspection));
  checks.push(check("absent ip utility omitted", !/^ip\b/m.test(joined)));
  checks.push(check("no mutation commands", !/\b(?:useradd|groupadd|install|systemctl restart|rm -)/m.test(joined)));
  return { id: "pi-health-read-only", lines, checks, calls: pi.calls };
}

async function accountCase(workstation, target, options) {
  await execContainer(target, `
for n in 1 2 3; do
  userdel -r "histbench\${n}" >/dev/null 2>&1 || true
  groupdel "histbenchg\${n}" >/dev/null 2>&1 || true
done
`);
  await resetHistory(target);
  const pi = await runPi(workstation, options,
    "On lab-test-web01 create users histbench1, histbench2, and histbench3 with matching primary groups histbenchg1, histbenchg2, and histbenchg3. Set example passwords ExampleBench1!, ExampleBench2!, and ExampleBench3!, then validate every account, group, and password status.");
  const lines = await history(target);
  const joined = lines.join("\n");
  const checks = cleanHistoryChecks(lines);
  for (let n = 1; n <= 3; n += 1) {
    await execContainer(target, `getent passwd histbench${n}\ngetent group histbenchg${n}\ntest "$(id -gn histbench${n})" = histbenchg${n}\npasswd -S histbench${n} | grep -Eq '^histbench${n} P '\n`);
    checks.push(check(`account ${n} exists`, true));
    checks.push(check(`group ${n} recorded`, joined.includes(`sudo groupadd histbenchg${n}`)));
    checks.push(check(`user ${n} recorded`, new RegExp(`^sudo useradd .*histbenchg${n} .*histbench${n}$`, "m").test(joined)));
    checks.push(check(`account ${n} validation recorded`, new RegExp(`^(?:sudo )?(?:getent passwd|id)[^\\n]*\\bhistbench${n}\\b`, "m").test(joined)));
  }
  checks.push(check("password operation recorded", /sudo (?:chpasswd|passwd\b)/m.test(joined)));
  return { id: "pi-bulk-accounts", lines, checks, calls: pi.calls };
}

async function configCase(workstation, target, options) {
  await execContainer(target, `
rm -f /etc/pi-history-bench.conf /run/pi-history-bench-reloaded
cat > /usr/local/sbin/pi-history-bench-service <<'SCRIPT'
#!/usr/bin/env bash
set -e
case "\${1:-}" in
  reload) touch /run/pi-history-bench-reloaded ;;
  status) test -f /run/pi-history-bench-reloaded && grep -qx 'mode=active' /etc/pi-history-bench.conf ;;
  *) exit 2 ;;
esac
SCRIPT
chmod 0755 /usr/local/sbin/pi-history-bench-service
`);
  await resetHistory(target);
  const pi = await runPi(workstation, options,
    "On lab-dev-app01 create /etc/pi-history-bench.conf containing exactly 'mode=active' using a user-writable temporary file and an atomic sudo installation with mode 0644. Then run sudo /usr/local/sbin/pi-history-bench-service reload and validate it with /usr/local/sbin/pi-history-bench-service status plus a direct config read.");
  await execContainer(target, "test \"$(cat /etc/pi-history-bench.conf)\" = mode=active\ntest -f /run/pi-history-bench-reloaded\n");
  const lines = await history(target);
  const joined = lines.join("\n");
  const checks = cleanHistoryChecks(lines);
  checks.push(check("configuration installed", true));
  checks.push(check("file change projected", joined.includes("sudoedit /etc/pi-history-bench.conf")));
  checks.push(check("reload retained", joined.includes("sudo /usr/local/sbin/pi-history-bench-service reload")));
  checks.push(check("status retained", joined.includes("/usr/local/sbin/pi-history-bench-service status")));
  checks.push(check("config read retained", /(?:cat|grep|od).*\/etc\/pi-history-bench\.conf/m.test(joined)));
  return { id: "pi-config-deploy", lines, checks, calls: pi.calls };
}

function renderReport(metadata, cases) {
  const rows = cases.map((item) => {
    const passed = item.checks.filter((entry) => entry.pass).length;
    return `| ${item.id} | ${passed}/${item.checks.length} | ${passed === item.checks.length ? "PASS" : "FAIL"} |`;
  });
  const details = cases.map((item) => {
    const calls = (item.calls ?? []).map((call) => `${call.host}:\n${call.command}`).join("\n\n");
    const callSection = calls ? `\n\n### Sanitized Pi SSH calls\n\n\`\`\`bash\n${calls}\n\`\`\`` : "";
    return `## ${item.id}\n\n${item.checks.map((entry) => `- ${entry.pass ? "PASS" : "FAIL"}: ${entry.name}`).join("\n")}\n\n\`\`\`text\n${item.lines.join("\n")}\n\`\`\`${callSection}`;
  }).join("\n\n");
  return `# Remote history acceptance\n\nModel: ${metadata.model}\nThinking: ${metadata.thinking}\n\n| Case | Checks | Result |\n|---|---:|---|\n${rows.join("\n")}\n\n${details}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!PI_TOOLS_ROOT) throw new Error("MONITORING_LAB_PI_TOOLS is required");
  const { remoteProgram } = await import(pathToFileURL(join(PI_TOOLS_ROOT, "extensions", "ssh-direct", "core.js")));
  const workstation = await containerId("workstation");
  const cases = [];
  cases.push(await deterministicNestedCase(workstation, await containerId("lab-test-mq01"), remoteProgram));
  cases.push(await healthCase(workstation, await containerId("lab-dev-web01"), options));
  cases.push(await accountCase(workstation, await containerId("lab-test-web01"), options));
  cases.push(await configCase(workstation, await containerId("lab-dev-app01"), options));
  const passed = cases.every((item) => item.checks.every((entry) => entry.pass));
  const outputDirectory = join(OUTPUT_ROOT, options.runId);
  await mkdir(outputDirectory, { recursive: true });
  const summary = { schema_version: "remote-history-acceptance/1", ...options, passed, cases };
  await writeFile(join(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(join(outputDirectory, "REPORT.md"), renderReport(options, cases));
  process.stdout.write(`${passed ? "PASS" : "FAIL"} ${join(outputDirectory, "REPORT.md")}\n`);
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
