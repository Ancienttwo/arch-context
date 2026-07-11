#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const defaultOut = resolve(root, "docs/verification/data-engine-de2-readback.json");
const defaultReport = resolve(root, "docs/verification/data-engine-de2-readback.md");
const mode = process.argv[2] ?? "inspect";
const out = argumentPath("--out", defaultOut);
const report = argumentPath("--report", defaultReport);

const verificationCommands = [
  ["bun", "run", "typecheck"],
  ["bun", "run", "check:package-boundaries"],
  ["bun", "test", "packages/contracts/test/contracts.test.ts", "packages/core/architecture-ledger", "packages/local-runtime/local-store-sqlite", "packages/local-runtime/runtime-daemon", "packages/surfaces/cli/test/cli.test.ts", "scripts/architecture-ledger-al10-release-packaging-readback.test.ts"],
  ["bun", "run", "verify:explorer"]
] as const;

if (mode === "run") {
  const commands = verificationCommands.map((command) => execute(command));
  const contractPreflight = execute([
    "repo-harness", "run", "contract-run", "preflight",
    "--contract", "tasks/contracts/20260711-1720-data-engine-de2-snapshot-replay.contract.md",
    "--json"
  ]);
  const contractsSource = await source("packages/contracts/src/ledger.ts");
  const coreSource = await source("packages/core/architecture-ledger/src/index.ts");
  const storeSource = await source("packages/local-runtime/local-store-sqlite/src/index.ts");
  const daemonSource = await source("packages/local-runtime/runtime-daemon/src/index.ts");
  const storeTest = await source("packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts");
  const artifact = {
    schemaVersion: "archcontext.data-engine-de2-readback/v1",
    generatedAt: new Date().toISOString(),
    gitCommit: textCommand(["git", "rev-parse", "HEAD"]),
    branch: textCommand(["git", "branch", "--show-current"]),
    contracts: {
      snapshot: "archcontext.architecture-snapshot/v2",
      migration: "0015_snapshot_anchor_v2",
      normalReplay: "anchored",
      auditReplay: "genesis"
    },
    invariants: {
      snapshotCarriesGraphAndEvidence: contractsSource.includes("state: {\n    graph: Json;\n    evidence: EvidenceStateAtCursorV1;")
        && contractsSource.includes("evidenceDigest: string")
        && contractsSource.includes("stateDigest: string"),
      exactSequenceIdHashAnchor: contractsSource.includes("lastEventSequence: number")
        && contractsSource.includes("eventCount: number")
        && storeSource.includes("architecture-ledger-snapshot-cursor-mismatch"),
      newestBoundedAnchor: storeSource.includes("last_event_sequence <= ?")
        && storeSource.includes("event_sequence > ? AND event_sequence <= ?"),
      hotReplayHasNoPrefixCount: storeSource.includes("(anchor?.snapshot.eventCursor.eventCount ?? 0) + events.length")
        && !storeSource.includes("event_sequence <= ?`\n  ).get(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), target.eventSequence)"),
      eventCountCheckpointIsImmutableAndScoped: storeSource.includes("scope_event_count")
        && storeSource.includes("idx_architecture_events_scope_count")
        && storeSource.includes("architecture_events_immutable_delete")
        && storeSource.includes("architecture_events_immutable_update")
        && storeSource.includes("architecture_events_scope_backfill_only")
        && storeSource.includes("architecture-ledger-scope-event-count-mismatch"),
      independentGenesisAudit: storeSource.includes('mode: "genesis"')
        && storeSource.includes("anchored-graph-state-does-not-match-genesis-replay")
        && storeSource.includes("anchored-evidence-state-does-not-match-genesis-replay"),
      completeRowIntegrityBinding: storeSource.includes("String(row.snapshot_id) !== snapshot.snapshotId")
        && storeSource.includes("String(row.payload_json) !== stableJson(event.payload)"),
      directIndexedScopeReads: storeSource.includes("source_storage_workspace_id = ? AND workspace_id = ? AND branch = ?")
        && !storeSource.includes("resolveArchitectureLedgerScopeFromEvents"),
      compactRequiresVerifiedAnchor: storeSource.includes("const { snapshot } = verifyArchitectureLedgerSnapshotRow(db, input, row)")
        && storeSource.includes('operationKind: "compact_events"'),
      explorerUsesAnchoredReplay: daemonSource.includes("explorerAuthorityCursorFromReplay")
        && daemonSource.includes("untilEventId: query.base.eventId")
        && daemonSource.includes("untilEventId: query.head.eventId"),
      corruptionAndTailTests: storeTest.includes("snapshot V2 restores verified graph and evidence state then replays only the ordered tail")
        && storeTest.includes("tampered/snapshot-metadata")
        && storeTest.includes("snapshot creation rejects materialized state that diverges from genesis authority")
        && storeTest.includes("tailEventCount: 6"),
      migrationIsV2Only: storeSource.includes('id: "0015_snapshot_anchor_v2"')
        && storeSource.includes("DELETE FROM architecture_snapshots")
        && coreSource.includes('mode: "anchored" | "genesis"')
    },
    commands: [...commands, contractPreflight],
    verdict: "FAIL"
  };
  artifact.verdict = commands.every((command) => command.ok)
    && contractPreflight.ok
    && Object.values(artifact.invariants).every(Boolean)
    ? "PASS"
    : "FAIL";
  await Bun.write(out, `${JSON.stringify(artifact, null, 2)}\n`);
  await Bun.write(report, markdownReport(artifact));
  console.log(JSON.stringify(artifact, null, 2));
  process.exit(artifact.verdict === "PASS" ? 0 : 1);
}

if (mode !== "inspect") throw new Error("usage: bun scripts/data-engine-de2-readback.ts run|inspect [--out <path>] [--report <path>]");
if (!existsSync(out)) throw new Error(`DE2 readback not found: ${out}`);
const artifact = await Bun.file(out).json() as any;
const failures: string[] = [];
if (artifact.schemaVersion !== "archcontext.data-engine-de2-readback/v1") failures.push("schemaVersion");
if (artifact.verdict !== "PASS") failures.push("verdict");
for (const [key, value] of Object.entries(artifact.invariants ?? {})) if (value !== true) failures.push(`invariant:${key}`);
for (const command of artifact.commands ?? []) if (command.ok !== true) failures.push(`command:${command.command}`);
if (failures.length > 0) throw new Error(`DE2 readback failed: ${failures.join(", ")}`);
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

function textCommand(command: string[]): string {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`command failed: ${command.join(" ")}`);
  return new TextDecoder().decode(result.stdout).trim();
}

async function source(path: string): Promise<string> {
  return Bun.file(resolve(root, path)).text();
}

function digest(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return `sha256:${hasher.digest("hex")}`;
}

function markdownReport(artifact: any): string {
  const commands = artifact.commands.map((command: any) => `| \`${command.command}\` | ${command.ok ? "PASS" : "FAIL"} | ${command.durationMs} |`).join("\n");
  const invariants = Object.entries(artifact.invariants).map(([key, value]) => `| ${key} | ${value ? "PASS" : "FAIL"} |`).join("\n");
  return `# Data Engine DE2 Readback\n\n- Verdict: **${artifact.verdict}**\n- Generated: ${artifact.generatedAt}\n- Commit: \`${artifact.gitCommit}\`\n- Branch: \`${artifact.branch}\`\n\n## Invariants\n\n| Invariant | Status |\n|---|---|\n${invariants}\n\n## Commands\n\n| Command | Status | Duration ms |\n|---|---|---:|\n${commands}\n`;
}
