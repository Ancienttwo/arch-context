#!/usr/bin/env bun
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { RUNTIME_RPC_VERSION, readRuntimeRpcConnection } from "@archcontext/local-runtime/runtime-daemon";

const ROOT = resolve(import.meta.dir, "..");
const ARCHCTX_BIN = join(ROOT, "packages", "surfaces", "cli", "bin", "archctx");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al4-closeout-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al4-closeout-readback.json";
const DEFAULT_SAMPLE_COUNT = 24;
const DEFAULT_WARMUP_COUNT = 3;
const HOOK_P95_THRESHOLD_MS = 150;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[architecture-ledger-al4-closeout-readback] usage: run|inspect [--out path] [--evidence path] [--json]");
    process.exit(2);
  }
  const result = command === "run"
    ? await runArchitectureLedgerAl4CloseoutReadback({
        outPath: readFlag(args, "--out") ?? DEFAULT_OUT,
        sampleCount: numberFlag(args, "--samples") ?? DEFAULT_SAMPLE_COUNT,
        warmupCount: numberFlag(args, "--warmup") ?? DEFAULT_WARMUP_COUNT
      })
    : inspectArchitectureLedgerAl4CloseoutReadback(
        JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
      );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export async function runArchitectureLedgerAl4CloseoutReadback({
  outPath = DEFAULT_OUT,
  sampleCount = DEFAULT_SAMPLE_COUNT,
  warmupCount = DEFAULT_WARMUP_COUNT
} = {}) {
  const workspace = mkdtempSync(join(tmpdir(), "archctx-al4-closeout-"));
  const stateRoot = mkdtempSync(join(tmpdir(), "archctx-al4-state-"));
  const repo = join(workspace, "repo");
  const env = { ...process.env, ARCHCONTEXT_STATE_DIR: stateRoot };
  let daemonStarted = false;
  const previousStateDir = process.env.ARCHCONTEXT_STATE_DIR;
  process.env.ARCHCONTEXT_STATE_DIR = stateRoot;
  try {
    createFixtureRepo(repo);
    runArchctxJson(repo, env, ["daemon", "start"]);
    daemonStarted = true;

    const generatedProjectionSkip = runArchctxJson(repo, env, [
      "hook", "enqueue",
      "--event", "post-write",
      "--path", ".archcontext/generated/ARCHITECTURE.md"
    ]);
    const doctor = runArchctxJson(repo, env, ["hooks", "doctor", "--host", "codex"]);
    const benchmark = runHookBenchmark(repo, env, { sampleCount, warmupCount });
    const chaining = runHookChainingReadback(repo, env);
    const staleGuard = await runStaleWorkerGuardReadback(repo, env);

    const packet = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      status: "verified",
      gates: {
        "AL4-EG1": {
          name: "Hook enqueue overhead p95 <= 150 ms",
          status: benchmark.p95Ms <= HOOK_P95_THRESHOLD_MS ? "verified" : "blocked",
          thresholdMs: HOOK_P95_THRESHOLD_MS,
          p95Ms: benchmark.p95Ms,
          sampleCount: benchmark.samples.length,
          samples: benchmark.samples
        },
        "AL4-EG2": {
          name: "No default hook network provider or LLM",
          status: hookEnvelopeDeclaresNoEgress(generatedProjectionSkip)
            && benchmark.samples.every((sample) => sample.egress === "none" && sample.network === "forbidden")
            && doctorDeclaresNoEgress(doctor) ? "verified" : "blocked",
          generatedProjectionSkip,
          doctor
        },
        "AL4-EG4": {
          name: "Stale jobs cannot complete as successful worker output",
          status: staleGuard.rejected === true && staleGuard.expired === true ? "verified" : "blocked",
          ...staleGuard
        },
        "AL4-EG5": {
          name: "Existing user hooks remain chained and functional",
          status: chaining.markerWritten === true && chaining.exitCode === 0 ? "verified" : "blocked",
          ...chaining
        }
      }
    };
    const inspected = inspectArchitectureLedgerAl4CloseoutReadback(packet);
    const finalPacket = { ...packet, status: inspected.ok ? "verified" : "blocked", failures: inspected.failures };
    const absoluteOut = resolve(ROOT, outPath);
    mkdirSync(dirname(absoluteOut), { recursive: true });
    writeFileSync(absoluteOut, `${JSON.stringify(finalPacket, null, 2)}\n`, "utf8");
    return inspectArchitectureLedgerAl4CloseoutReadback(finalPacket);
  } finally {
    if (previousStateDir === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previousStateDir;
    if (daemonStarted) {
      try {
        runArchctxJson(repo, env, ["daemon", "stop"]);
      } catch {
        // Best effort cleanup after a readback run.
      }
    }
    rmSync(workspace, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
    rmSync(stateRoot, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
  }
}

export function inspectArchitectureLedgerAl4CloseoutReadback(packet: any) {
  const failures: string[] = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return { ok: false, schemaVersion: SCHEMA_VERSION, failures: ["packet must be an object"], gates: {} };
  }
  if (packet.schemaVersion !== SCHEMA_VERSION) failures.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (packet.status !== "verified") failures.push("status must be verified");
  const gates = packet.gates ?? {};
  requireGate(gates, "AL4-EG1", failures, (gate) => {
    if (gate.thresholdMs !== HOOK_P95_THRESHOLD_MS) failures.push("AL4-EG1 threshold must be 150 ms");
    if (!(typeof gate.p95Ms === "number" && gate.p95Ms <= HOOK_P95_THRESHOLD_MS)) failures.push("AL4-EG1 p95 must be <= 150 ms");
    if (!(Number.isInteger(gate.sampleCount) && gate.sampleCount >= 5)) failures.push("AL4-EG1 sampleCount must be >= 5");
  });
  requireGate(gates, "AL4-EG2", failures, (gate) => {
    if (!hookEnvelopeDeclaresNoEgress(gate.generatedProjectionSkip)) failures.push("AL4-EG2 generated projection skip must declare no egress");
    if (!doctorDeclaresNoEgress(gate.doctor)) failures.push("AL4-EG2 hooks doctor must declare no egress");
  });
  requireGate(gates, "AL4-EG4", failures, (gate) => {
    if (gate.rejected !== true) failures.push("AL4-EG4 stale completion must be rejected");
    if (gate.expired !== true) failures.push("AL4-EG4 stale job must be expired");
    if (gate.errorCode !== "AC_CONTEXT_STALE") failures.push("AL4-EG4 errorCode must be AC_CONTEXT_STALE");
  });
  requireGate(gates, "AL4-EG5", failures, (gate) => {
    if (gate.markerWritten !== true) failures.push("AL4-EG5 user hook marker must be written");
    if (gate.exitCode !== 0) failures.push("AL4-EG5 hook chain exit code must be 0");
  });
  return {
    ok: failures.length === 0,
    schemaVersion: SCHEMA_VERSION,
    gates: Object.fromEntries(Object.entries(gates).map(([id, gate]: [string, any]) => [id, gate?.status ?? "missing"])),
    failures
  };
}

function runHookBenchmark(repo: string, env: NodeJS.ProcessEnv, options: { sampleCount: number; warmupCount: number }) {
  const samples: Array<{ elapsedMs: number; reasonCode: string; egress: string; network: string }> = [];
  for (let index = 0; index < options.warmupCount + options.sampleCount; index += 1) {
    const result = runArchctxJson(repo, env, [
      "hook", "enqueue",
      "--event", "post-edit",
      "--path", "src/app.ts"
    ]);
    const hookLog = result.data?.hookLog;
    const sample = {
      elapsedMs: Number(hookLog?.elapsedMs),
      reasonCode: String(hookLog?.reasonCode ?? "unknown"),
      egress: String(hookLog?.egress ?? ""),
      network: String(hookLog?.network ?? "")
    };
    if (index >= options.warmupCount) samples.push(sample);
  }
  return {
    p95Ms: percentile(samples.map((sample) => sample.elapsedMs), 0.95),
    samples
  };
}

function runHookChainingReadback(repo: string, env: NodeJS.ProcessEnv) {
  const hookDir = join(repo, ".git", "hooks");
  const hookPath = join(hookDir, "post-commit");
  const localPath = join(hookDir, "post-commit.local");
  const markerPath = join(repo, ".git", "hooks", "post-commit.local.marker");
  writeFileSync(localPath, `#!/bin/sh\nprintf chained > ${JSON.stringify(markerPath)}\nexit 0\n`, "utf8");
  chmodSync(localPath, 0o755);
  writeFileSync(hookPath, [
    "#!/bin/sh",
    "set +e",
    `${JSON.stringify(process.execPath)} ${JSON.stringify(ARCHCTX_BIN)} hook enqueue --event post-commit --source commit --max-queued-jobs 32 --priority 0 >/dev/null 2>&1`,
    `if [ -x ${JSON.stringify(localPath)} ]; then`,
    `  ${JSON.stringify(localPath)} "$@"`,
    "  exit $?",
    "fi",
    "exit 0",
    ""
  ].join("\n"), "utf8");
  chmodSync(hookPath, 0o755);
  const result = spawnSync("sh", [hookPath], { cwd: repo, env, encoding: "utf8" });
  return {
    exitCode: result.status ?? 1,
    markerWritten: existsSync(markerPath) && readFileSync(markerPath, "utf8") === "chained",
    stderr: result.stderr.trim()
  };
}

async function runStaleWorkerGuardReadback(repo: string, env: NodeJS.ProcessEnv) {
  const connection = readRuntimeRpcConnection(repo);
  if (!connection) throw new Error("runtime RPC connection missing after daemon start");
  await expireActiveJobs(connection, repo);
  const enqueued = runArchctxJson(repo, env, [
    "hook", "enqueue",
    "--event", "post-edit",
    "--path", "src/stale.ts",
    "--analysis-kind", `architecture-delta-stale-readback-${Date.now()}`,
    "--priority", "10"
  ]);
  const jobId = enqueued.data?.record?.job?.jobId;
  const claimed = await callRuntimeRpc(connection, "jobsClaim", [repo, {
    workerId: "worker.al4-closeout",
    leaseMs: 30_000,
    now: "2026-06-25T03:00:00.000Z",
    maxRunningJobs: 1
  }]);
  writeFileSync(join(repo, "src", "stale.ts"), "export const stale = true;\n", "utf8");
  execFileSync("git", ["add", "src/stale.ts"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "advance-stale-head"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  const completed = await callRuntimeRpc(connection, "jobsComplete", [repo, {
    jobId,
    workerId: "worker.al4-closeout",
    status: "succeeded",
    outputDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    now: "2026-06-25T03:00:01.000Z"
  }]);
  const expired = await callRuntimeRpc(connection, "jobsList", [repo, { statuses: ["expired"] }]);
  const expiredJobs = Array.isArray(expired.data?.jobs) ? expired.data.jobs : [];
  return {
    jobId,
    claimed: claimed.ok === true && claimed.data?.job?.job?.jobId === jobId,
    rejected: completed.ok === false,
    errorCode: completed.error?.code,
    expired: expiredJobs.some((record: any) => record?.job?.jobId === jobId),
    completion: completed
  };
}

async function expireActiveJobs(connection: NonNullable<ReturnType<typeof readRuntimeRpcConnection>>, repo: string) {
  const list = await callRuntimeRpc(connection, "jobsList", [repo, { statuses: ["queued", "running"] }]);
  const jobs = Array.isArray(list.data?.jobs) ? list.data.jobs : [];
  for (const record of jobs) {
    const jobId = record?.job?.jobId;
    if (typeof jobId === "string") {
      await callRuntimeRpc(connection, "jobsCancel", [repo, { jobId, status: "expired", reason: "al4-closeout-readback-reset" }]);
    }
  }
}

async function callRuntimeRpc(connection: NonNullable<ReturnType<typeof readRuntimeRpcConnection>>, method: string, params: unknown[]) {
  const response = await fetch(`${connection.url}rpc`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${connection.token}`,
      "Content-Type": "application/json",
      "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION
    },
    body: JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method, params })
  });
  return await response.json() as any;
}

function runArchctxJson(cwd: string, env: NodeJS.ProcessEnv, args: string[]) {
  const result = spawnSync(process.execPath, [ARCHCTX_BIN, ...args], {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: process.platform === "win32" ? 45_000 : 15_000
  });
  if (result.status !== 0) {
    throw new Error(`archctx ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function createFixtureRepo(repo: string) {
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "README.md"), "# AL4 closeout\n", "utf8");
  writeFileSync(join(repo, "src", "app.ts"), "export const app = true;\n", "utf8");
  execFileSync("git", ["init"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["add", "."], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  writeFileSync(join(repo, "src", "app.ts"), "export const app = false;\n", "utf8");
}

function requireGate(gates: any, id: string, failures: string[], check: (gate: any) => void) {
  const gate = gates[id];
  if (!gate || typeof gate !== "object") {
    failures.push(`${id} gate must be present`);
    return;
  }
  if (gate.status !== "verified") failures.push(`${id} status must be verified`);
  check(gate);
}

function hookEnvelopeDeclaresNoEgress(envelope: any) {
  return envelope?.ok === true
    && envelope.data?.egress === "none"
    && envelope.data?.network === "forbidden"
    && envelope.data?.hookLog?.egress === "none"
    && envelope.data?.hookLog?.network === "forbidden";
}

function doctorDeclaresNoEgress(envelope: any) {
  const checks = Array.isArray(envelope?.data?.checks) ? envelope.data.checks : [];
  return envelope?.ok === true
    && envelope.data?.entrypoint?.args?.join(" ") === "hook enqueue"
    && checks.some((check: any) => check.id === "egress" && check.status === "pass" && check.egress === "none" && check.network === "forbidden");
}

function percentile(values: number[], quantile: number) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index]!;
}

function readFlag(args: string[], flag: string) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function numberFlag(args: string[], flag: string) {
  const value = readFlag(args, flag);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function renderHuman(result: ReturnType<typeof inspectArchitectureLedgerAl4CloseoutReadback>) {
  const lines = [`[architecture-ledger-al4-closeout-readback] ${result.ok ? "OK" : "FAILED"}`];
  for (const [gate, status] of Object.entries(result.gates)) lines.push(`- ${gate}: ${status}`);
  for (const failure of result.failures) lines.push(`- failure: ${failure}`);
  return lines.join("\n");
}
