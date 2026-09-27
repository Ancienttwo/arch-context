import { spawnSync } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";
import { createConnection, createServer } from "node:net";

const CHILD_FLAG = "--network-isolated-child";
const PROFILE = '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))';
const DENIED_CODES = { darwin: ["EPERM", "EACCES"], linux: ["ENETUNREACH"] };
const PROBE_PROGRAM = `
const net = require("node:net");
const s = net.createConnection({host:process.argv[1],port:9});
s.setTimeout(2000,()=>{s.destroy();process.exit(3)});
s.once("connect",()=>{s.destroy();process.exit(2)});
s.once("error",e=>{process.stdout.write(e.code);process.exit(0)});
`;

/** Re-exec the whole test process tree under a kernel policy; unsupported hosts refuse. */
export function enterLocalNetworkSandbox(script) {
  if (process.argv.includes(CHILD_FLAG)) return;
  let command;
  let args;
  const env = { ...process.env };
  if (process.platform === "darwin") {
    command = "/usr/bin/sandbox-exec";
    args = ["-p", PROFILE, process.execPath, script, CHILD_FLAG];
  } else if (process.platform === "linux") {
    const parentNamespace = readlinkSync("/proc/self/ns/net");
    command = "sudo";
    // No host interface/firewall changes: lo is enabled only inside the new namespace.
    args = ["-n", "unshare", "--net", "--", "sh", "-c",
      'ip link set lo up && exec setpriv --reuid "$1" --regid "$2" --init-groups /usr/bin/env PATH="$6" HOME="$7" ARCHCONTEXT_TEST_PARENT_NETNS="$8" "$3" "$4" "$5"',
      "archctx-network-sandbox", String(process.getuid()), String(process.getgid()), process.execPath, script, CHILD_FLAG, process.env.PATH ?? "", process.env.HOME ?? "", parentNamespace];
  } else {
    throw new Error(`network-isolation-unsupported: ${process.platform}; use Linux network namespaces or macOS Seatbelt`);
  }
  const result = spawnSync(command, args, { cwd: process.cwd(), env, encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: 180_000 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw new Error(`network-isolation-launch-failed: ${result.error.code ?? "unknown"}`);
  process.exit(result.status ?? 1);
}

/** Negative controls must receive an OS denial, never a timeout/refusal from a remote host. */
export async function proveLocalNetworkIsolation() {
  if (!DENIED_CODES[process.platform]) throw new Error("network-isolation-unsupported");
  let namespace;
  if (process.platform === "linux") {
    const current = readlinkSync("/proc/self/ns/net");
    const parent = process.env.ARCHCONTEXT_TEST_PARENT_NETNS;
    if (!parent || parent === current) throw new Error("network-namespace-not-isolated");
    const interfaces = readFileSync("/proc/net/dev", "utf8").split("\n").slice(2).map(line => line.split(":")[0].trim()).filter(Boolean);
    if (interfaces.length !== 1 || interfaces[0] !== "lo") throw new Error("network-namespace-has-external-interface");
    namespace = { distinctFromParent: true, interfaces };
  }
  const probes = [];
  for (const [family, host] of [["ipv4", "198.51.100.1"], ["ipv6", "2001:db8::1"]]) {
    const directCode = await deniedConnection(host);
    const child = spawnSync(process.execPath, ["-e", PROBE_PROGRAM, host], { encoding: "utf8", timeout: 5000 });
    if (child.status !== 0 || !DENIED_CODES[process.platform].includes(child.stdout)) throw new Error(`network-child-denial-unproven: ${family}`);
    probes.push({ family, directCode, childCode: child.stdout });
  }
  const loopback = await proveLoopback();
  return { mechanism: process.platform === "darwin" ? "macos-seatbelt" : "linux-network-namespace", platform: process.platform, nonLoopbackDenied: true, descendantDenied: true, loopbackAllowed: loopback, probes, ...(namespace ? { namespace } : {}) };
}

function deniedConnection(host) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port: 9 });
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error("network-denial-unproven: timeout")); });
    socket.once("connect", () => { socket.destroy(); reject(new Error("network-denial-unproven: connected")); });
    socket.once("error", error => {
      socket.destroy();
      if (DENIED_CODES[process.platform].includes(error.code)) resolve(error.code);
      else reject(new Error(`network-denial-unproven: ${error.code}`));
    });
  });
}

async function proveLoopback() {
  const server = createServer(socket => socket.end());
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    await new Promise((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port: server.address().port });
      socket.once("error", reject); socket.once("connect", () => { socket.destroy(); resolve(); });
    });
    return true;
  } finally { await new Promise(resolve => server.close(resolve)); }
}
