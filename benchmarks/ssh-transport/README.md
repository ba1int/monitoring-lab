# SSH tool candidate benchmark

The bounded execution-improvement sprint is recorded in
[`OVERNIGHT-2026-07-18.md`](OVERNIGHT-2026-07-18.md).

This microbenchmark evaluates three proposed `pi-tools` changes against the
current `ssh_exec` transport inside the WSL-like workstation:

1. OpenSSH connection reuse for repeated calls to one host;
2. one fan-out call versus Pi's existing parallel independent tool calls; and
3. staging a local file by streaming it versus today's remote heredoc, counting
   the local write tool call when the content does not already exist in a file.

It also regression-checks concurrent calls sharing one control path and
recovery after the OpenSSH control master is killed without cleanup.

The transport-failure gate uses live DNS, authentication, refusal, timeout,
success, and remote-exit cases plus fixed host-key and connection-closure
fixtures. A candidate must classify every case exactly, escalate actual
transport failures out of low thinking, leave ordinary read-only command exits
alone, and add no more than 40 bytes to a rendered result.

The output-safety gate sends ANSI color/cursor sequences, OSC hyperlinks and
clipboard writes, DCS strings, carriage returns, backspaces, tabs, newlines,
and UTF-8 through the real SSH path. A candidate must remove every terminal
control, preserve the exact intended printable text, leave normal output
byte-for-byte unchanged, and never increase context size.

Run it from the lab repository root:

```bash
node benchmarks/ssh-transport/run.mjs
node benchmarks/ssh-transport/run.mjs --json
```

The benchmark reports efficiency thresholds separately from safety gates.
Passing the latency or context threshold does not automatically justify adding
a tool. In particular, arbitrary Bash cannot be reliably classified as
read-only, so the generic fan-out candidate remains rejected unless its safety
surface is redesigned.

## Decision recorded 2026-07-18

- **Keep connection reuse.** Three lab runs reduced the warm median from
  407–431 ms to 17 ms (96%). A real Pi run measured 488 ms cold, then 27 ms and
  23 ms through the same `ssh_exec` interface.
- **Reject generic fan-out.** It reduced repeated tool arguments by 78%, but a
  four-worker cap took roughly 1.3 seconds while Pi's existing parallel
  `ssh_exec` calls finished in roughly 0.5 seconds. Arbitrary Bash also cannot
  be guaranteed read-only across a fleet.
- **Reject file staging for now.** For agent-generated 16 KiB content it saved
  0% end to end and had essentially identical latency. It is compelling only
  when the file already exists locally, which is not yet a demonstrated common
  workload.
