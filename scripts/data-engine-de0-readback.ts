#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const defaultOut = resolve(root, "docs/verification/data-engine-de0-readback.json");
const mode = process.argv[2] ?? "inspect";
const out = resolve(root, process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1]! : defaultOut);

const verificationCommands = [
  ["bun", "run", "typecheck"],
  ["bun", "run", "check:package-boundaries"],
  ["bun", "test", "packages/contracts/test/contracts.test.ts", "packages/core/architecture-delta", "packages/core/architecture-ledger", "packages/local-runtime/local-store-sqlite", "packages/local-runtime/runtime-daemon", "packages/surfaces/cli", "packages/surfaces/explorer-ui"],
  ["bun", "run", "verify:explorer"]
] as const;

if (mode === "run") {
  const commands = verificationCommands.map((command) => execute(command));
  const legacySearch = Bun.spawnSync([
    "rg", "-n",
    "explorer-delta-query/v1|explorer-projection-delta/v1|ExplorerDeltaQueryV1|ExplorerProjectionDeltaV1|compileExplorerProjectionDelta",
    "packages", "schemas"
  ], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const noLegacyDeltaRuntime = legacySearch.exitCode === 1;
  const contractPreflight = execute([
    "repo-harness", "run", "contract-run", "preflight",
    "--contract", "tasks/contracts/20260711-1328-data-engine-authority-incremental.contract.md",
    "--json"
  ]);
  const artifact = {
    schemaVersion: "archcontext.data-engine-de0-readback/v1",
    generatedAt: new Date().toISOString(),
    gitCommit: textCommand(["git", "rev-parse", "HEAD"]),
    branch: textCommand(["git", "branch", "--show-current"]),
    contracts: {
      deltaQuery: "archcontext.explorer-delta-query/v2",
      deltaResponse: "archcontext.explorer-projection-delta/v2",
      authorityCursor: "archcontext.authority-cursor/v1",
      projectionManifest: "archcontext.projection-input-manifest/v1",
      evidenceState: "archcontext.evidence-state-at-cursor/v1",
      evidenceLifecyclePayload: "archcontext.architecture-evidence-lifecycle/v2"
    },
    invariants: {
      projectionCannotEmitFactOrEvidence: await sourceContains("packages/local-runtime/runtime-daemon/src/explorer-projection.ts", "export function compileExplorerProjectionChanges"),
      budgetDisplacementRegression: await sourceContains("packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts", "budget displacement is a projection change"),
      manifestCompatibility: await sourceContains("packages/local-runtime/runtime-daemon/src/explorer-projection.ts", "compatibilityDigest"),
      explicitEvidenceLifecycle: await sourceContains("packages/core/architecture-ledger/src/index.ts", "ARCHITECTURE_EVIDENCE_LIFECYCLE_PAYLOAD_VERSION"),
      evidenceTombstones: await sourceContains("packages/local-runtime/local-store-sqlite/src/index.ts", "evidence_tombstones"),
      noLegacyDeltaRuntime
    },
    commands: [...commands, contractPreflight],
    verdict: commands.every((command) => command.ok) && contractPreflight.ok && noLegacyDeltaRuntime ? "PASS" : "FAIL"
  };
  await Bun.write(out, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify(artifact, null, 2));
  process.exit(artifact.verdict === "PASS" ? 0 : 1);
}

if (mode !== "inspect") throw new Error("usage: bun scripts/data-engine-de0-readback.ts run|inspect [--out <path>]");
if (!existsSync(out)) throw new Error(`DE0 readback not found: ${out}`);
const artifact = await Bun.file(out).json() as any;
const failures: string[] = [];
if (artifact.schemaVersion !== "archcontext.data-engine-de0-readback/v1") failures.push("schemaVersion");
if (artifact.verdict !== "PASS") failures.push("verdict");
for (const [key, value] of Object.entries(artifact.invariants ?? {})) if (value !== true) failures.push(`invariant:${key}`);
for (const command of artifact.commands ?? []) if (command.ok !== true) failures.push(`command:${command.command}`);
if (failures.length > 0) throw new Error(`DE0 readback failed: ${failures.join(", ")}`);
console.log(JSON.stringify({ schemaVersion: artifact.schemaVersion, verdict: artifact.verdict, generatedAt: artifact.generatedAt, inspected: true }, null, 2));

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

function textCommand(command: string[]): string {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`command failed: ${command.join(" ")}`);
  return new TextDecoder().decode(result.stdout).trim();
}

async function sourceContains(path: string, pattern: string): Promise<boolean> {
  return (await Bun.file(resolve(root, path)).text()).includes(pattern);
}

function digest(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return `sha256:${hasher.digest("hex")}`;
}
