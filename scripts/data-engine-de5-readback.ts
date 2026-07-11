#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const defaultOut = resolve(root, "docs/verification/data-engine-de5-readback.json");
const defaultReport = resolve(root, "docs/verification/data-engine-de5-readback.md");
const mode = process.argv[2] ?? "inspect";
const out = argumentPath("--out", defaultOut);
const report = argumentPath("--report", defaultReport);
const provenancePaths = [
  "docs/adr/ADR-0045-authority-separated-data-engine.md",
  "docs/runbooks/data-engine-cache-operations.md",
  "package.json",
  "packages/contracts/src/ports.ts",
  "packages/contracts/test/contracts.test.ts",
  "packages/local-runtime/local-store-sqlite/src/index.ts",
  "packages/local-runtime/local-store-sqlite/test/factories.ts",
  "packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts",
  "packages/local-runtime/runtime-daemon/src/index.ts",
  "packages/local-runtime/runtime-daemon/test/local-runtime.test.ts",
  "plans/plan-20260711-1328-data-engine-authority-incremental.md",
  "scripts/data-engine-de5-readback.ts",
  "scripts/architecture-ledger-al10-release-packaging-readback.ts",
  "scripts/architecture-ledger-al10-release-packaging-readback.test.ts",
  "tasks/contracts/20260711-2005-data-engine-de5-cache-lifecycle-observability.contract.md",
  "tasks/notes/20260711-1328-data-engine-authority-incremental.notes.md",
  "tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md"
] as const;
const verificationCommands = [
  ["bun", "run", "typecheck"],
  ["bun", "test", "packages/local-runtime/local-store-sqlite", "packages/local-runtime/runtime-daemon"],
  ["bun", "run", "verify:explorer"],
  ["node", "scripts/packaged-cli-smoke.mjs"]
] as const;

if (mode === "run") {
  const commands = verificationCommands.map(execute);
  const contractPreflight = execute([
    "repo-harness", "run", "contract-run", "preflight",
    "--contract", "tasks/contracts/20260711-2005-data-engine-de5-cache-lifecycle-observability.contract.md",
    "--json"
  ]);
  const benchmark = executeJson(["bun", "scripts/explorer-view-compiler-readback.mjs", "--check"]);
  const contractsSource = await source("packages/contracts/src/ports.ts");
  const storeSource = await source("packages/local-runtime/local-store-sqlite/src/index.ts");
  const storeTest = await source("packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts");
  const daemonSource = await source("packages/local-runtime/runtime-daemon/src/index.ts");
  const runbook = await source("docs/runbooks/data-engine-cache-operations.md");
  const artifact = {
    schemaVersion: "archcontext.data-engine-de5-readback/v1",
    generatedAt: new Date().toISOString(),
    baselineCommit: textCommand(["git", "rev-parse", "HEAD"]),
    branch: textCommand(["git", "branch", "--show-current"]),
    sourceDigest: await provenanceDigest(),
    policy: {
      schemaVersion: "archcontext.explorer-cache-policy/v1",
      defaultMaxEntriesPerScope: 128,
      defaultMaxBytesPerScope: 67_108_864,
      defaultMaxAgeMs: 604_800_000,
      defaultMaxPinnedEntriesPerScope: 8,
      defaultMaxPinTtlMs: 900_000
    },
    representativeScale: benchmark.data?.benchmarks ?? [],
    invariants: {
      additiveLifecycleMigration: contractsSource.includes("ExplorerProjectionCachePolicyV1")
        && storeSource.includes('id: "0017_explorer_cache_lifecycle"')
        && storeSource.includes('id: "0018_immutable_evidence_checkpoints"')
        && storeSource.includes("explorer_runtime_metrics")
        && storeSource.includes("body_bytes")
        && storeSource.includes("pinned_until"),
      deterministicBoundedGc: storeSource.includes("collectExplorerProjectionCacheFromDb")
        && storeSource.includes("maxEntriesPerScope")
        && storeSource.includes("maxBytesPerScope")
        && storeSource.includes("COALESCE(last_accessed_at, created_at), created_at, projection_digest")
        && storeTest.includes("deterministically evicts unpinned LRU rows"),
      boundedDeltaPins: daemonSource.includes('reason: "delta-base"')
        && daemonSource.includes('reason: "delta-head"')
        && storeSource.includes("maxPinTtlMs")
        && storeTest.includes("retains bounded delta pins"),
      startupRecoveryAndOrphans: storeSource.includes('"startup-retention"')
        && storeSource.includes("orphanDependencyCount")
        && storeTest.includes("startup orphan cleanup"),
      allowListedMetadataOnlyMetrics: storeSource.includes("EXPLORER_RUNTIME_METRIC_NAMES")
        && storeSource.includes("EXPLORER_RUNTIME_METRIC_REASONS")
        && storeTest.includes("accept only bounded numeric allow-listed samples")
        && !storeSource.includes("metric_payload"),
      requiredOperationalSignals: ["feed-lag", "replay-tail-length", "plan-rows-read", "compile-time-ms", "cache-hit", "cache-miss", "cache-eviction", "cache-rebuild"]
        .every((name) => storeSource.includes(`\"${name}\"`) || daemonSource.includes(`\"${name}\"`)),
      cacheIsDisposable: runbook.includes("cache deletion cannot change")
        && runbook.includes("Do not edit")
        && runbook.includes(".archcontext/")
        && storeTest.includes("deleting every Explorer cache row cannot change authoritative ledger results"),
      representative10k100k: benchmark.ok
        && benchmark.data?.verdict === "PASS"
        && [10_000, 100_000].every((count) => benchmark.data?.benchmarks?.some((entry: any) => entry.entityCount === count && entry.budgetBounded))
    },
    commands: [...commands, contractPreflight],
    verdict: "FAIL"
  };
  artifact.verdict = commands.every((command) => command.ok)
    && contractPreflight.ok
    && benchmark.ok
    && Object.values(artifact.invariants).every(Boolean)
    ? "PASS"
    : "FAIL";
  await Bun.write(out, `${JSON.stringify(artifact, null, 2)}\n`);
  await Bun.write(report, markdownReport(artifact));
  console.log(JSON.stringify(artifact, null, 2));
  process.exit(artifact.verdict === "PASS" ? 0 : 1);
}

if (mode !== "inspect") throw new Error("usage: bun scripts/data-engine-de5-readback.ts run|inspect [--out <path>] [--report <path>]");
if (!existsSync(out)) throw new Error(`DE5 readback not found: ${out}`);
const artifact = await Bun.file(out).json() as any;
const failures: string[] = [];
if (artifact.schemaVersion !== "archcontext.data-engine-de5-readback/v1") failures.push("schemaVersion");
if (artifact.verdict !== "PASS") failures.push("verdict");
if (artifact.sourceDigest !== await provenanceDigest()) failures.push("sourceDigest");
for (const [key, value] of Object.entries(artifact.invariants ?? {})) if (value !== true) failures.push(`invariant:${key}`);
for (const command of artifact.commands ?? []) if (command.ok !== true) failures.push(`command:${command.command}`);
if (failures.length > 0) throw new Error(`DE5 readback failed: ${failures.join(", ")}`);
console.log(JSON.stringify({ schemaVersion: artifact.schemaVersion, verdict: artifact.verdict, generatedAt: artifact.generatedAt, inspected: true }, null, 2));

function argumentPath(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return resolve(root, index >= 0 ? process.argv[index + 1]! : fallback);
}

function execute(command: readonly string[]) {
  const startedAt = Date.now();
  const result = Bun.spawnSync([...command], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return {
    command: command.join(" "),
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    durationMs: Date.now() - startedAt,
    stdoutDigest: digest(new TextDecoder().decode(result.stdout)),
    stderrDigest: digest(new TextDecoder().decode(result.stderr))
  };
}

function executeJson(command: readonly string[]) {
  const startedAt = Date.now();
  const result = Bun.spawnSync([...command], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const stdout = new TextDecoder().decode(result.stdout);
  let data: any;
  try { data = JSON.parse(stdout); } catch { data = undefined; }
  return { command: command.join(" "), ok: result.exitCode === 0 && data !== undefined, durationMs: Date.now() - startedAt, data };
}

function textCommand(command: string[]): string {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`command failed: ${command.join(" ")}`);
  return new TextDecoder().decode(result.stdout).trim();
}

async function source(path: string): Promise<string> {
  return Bun.file(resolve(root, path)).text();
}

async function provenanceDigest(): Promise<string> {
  const entries = await Promise.all(provenancePaths.map(async (path) => ({ path, body: await source(path) })));
  return digest(JSON.stringify(entries));
}

function digest(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return `sha256:${hasher.digest("hex")}`;
}

function markdownReport(artifact: any): string {
  const commands = artifact.commands.map((command: any) => `| \`${command.command}\` | ${command.ok ? "PASS" : "FAIL"} | ${command.durationMs} |`).join("\n");
  const invariants = Object.entries(artifact.invariants).map(([key, value]) => `| ${key} | ${value ? "PASS" : "FAIL"} |`).join("\n");
  const scale = artifact.representativeScale.map((entry: any) => `| ${entry.entityCount} | ${entry.relationCount} | ${entry.p95Ms} | ${entry.returnedNodes} | ${entry.returnedRelations} | ${entry.budgetBounded ? "PASS" : "FAIL"} |`).join("\n");
  return `# Data Engine DE5 Readback\n\n- Verdict: **${artifact.verdict}**\n- Generated: ${artifact.generatedAt}\n- Baseline commit: \`${artifact.baselineCommit}\`\n- Source digest: \`${artifact.sourceDigest}\`\n- Branch: \`${artifact.branch}\`\n\n## Invariants\n\n| Invariant | Status |\n|---|---|\n${invariants}\n\n## Representative scale\n\n| Entities | Relations | p95 ms | Returned nodes | Returned relations | Bounded |\n|---:|---:|---:|---:|---:|---|\n${scale}\n\n## Commands\n\n| Command | Status | Duration ms |\n|---|---|---:|\n${commands}\n`;
}
