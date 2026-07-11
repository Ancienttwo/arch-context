#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const defaultOut = resolve(root, "docs/verification/data-engine-de1-readback.json");
const defaultReport = resolve(root, "docs/verification/data-engine-de1-readback.md");
const mode = process.argv[2] ?? "inspect";
const out = argumentPath("--out", defaultOut);
const report = argumentPath("--report", defaultReport);

const verificationCommands = [
  ["bun", "run", "typecheck"],
  ["bun", "run", "check:package-boundaries"],
  ["bun", "test", "packages/contracts/test/contracts.test.ts", "packages/local-runtime/local-store-sqlite", "packages/local-runtime/runtime-daemon", "scripts/architecture-ledger-al10-release-packaging-readback.test.ts"],
  ["bun", "run", "verify:explorer"]
] as const;

if (mode === "run") {
  const commands = verificationCommands.map((command) => execute(command));
  const contractPreflight = execute([
    "repo-harness", "run", "contract-run", "preflight",
    "--contract", "tasks/contracts/20260711-1605-data-engine-de1-change-feed.contract.md",
    "--json"
  ]);
  const storeSource = await source("packages/local-runtime/local-store-sqlite/src/index.ts");
  const daemonSource = await source("packages/local-runtime/runtime-daemon/src/index.ts");
  const storeTest = await source("packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts");
  const daemonTest = await source("packages/local-runtime/runtime-daemon/test/local-runtime.test.ts");
  const artifact = {
    schemaVersion: "archcontext.data-engine-de1-readback/v1",
    generatedAt: new Date().toISOString(),
    gitCommit: textCommand(["git", "rev-parse", "HEAD"]),
    branch: textCommand(["git", "branch", "--show-current"]),
    contracts: {
      feedRecord: "archcontext.architecture-change-feed-record/v1",
      feedBatch: "archcontext.architecture-change-feed-batch/v1",
      migration: "0014_architecture_change_feed",
      consumer: "runtime-daemon.explorer-cache.v1",
      sse: "archcontext.explorer-authority-invalidation/v1"
    },
    invariants: {
      transactionalOutbox: storeSource.includes("appendArchitectureChangeFeed(db") && storeSource.includes("db.exec(\"BEGIN IMMEDIATE\")"),
      typedSubjectIndex: storeSource.includes("architecture_event_subjects") && storeSource.includes("architectureAffectedSubjectFromRow"),
      durableMonotonicFeed: storeSource.includes("architecture_change_feed_consumers") && storeSource.includes("architecture-change-feed-ack-requires-delivered-sequence"),
      indexedBacklinks: daemonSource.includes("listArchitectureEventBacklinks(scope)") && !daemonSource.includes("function explorerEventBacklinks("),
      feedDrivenInvalidation: daemonSource.includes("processArchitectureChangeFeed(root, scope)") && daemonSource.includes("architectureChangeFeedDependencyKeys(record)"),
      digestOnlySse: daemonSource.includes("archcontext.explorer-authority-invalidation/v1") && daemonTest.includes("expect(eventText).not.toContain(\"payload\")"),
      crashAndRestartRecovery: storeTest.includes("transactional typed restart-safe and idempotent") && daemonTest.includes("lifecycleFeedRecord.feedSequence"),
      evidenceBindingInvalidation: storeTest.includes("subjectKind: \"evidence-binding\"") && storeTest.includes("operation: \"reference\"")
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

if (mode !== "inspect") throw new Error("usage: bun scripts/data-engine-de1-readback.ts run|inspect [--out <path>] [--report <path>]");
if (!existsSync(out)) throw new Error(`DE1 readback not found: ${out}`);
const artifact = await Bun.file(out).json() as any;
const failures: string[] = [];
if (artifact.schemaVersion !== "archcontext.data-engine-de1-readback/v1") failures.push("schemaVersion");
if (artifact.verdict !== "PASS") failures.push("verdict");
for (const [key, value] of Object.entries(artifact.invariants ?? {})) if (value !== true) failures.push(`invariant:${key}`);
for (const command of artifact.commands ?? []) if (command.ok !== true) failures.push(`command:${command.command}`);
if (failures.length > 0) throw new Error(`DE1 readback failed: ${failures.join(", ")}`);
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
  return `# Data Engine DE1 Readback\n\n- Verdict: **${artifact.verdict}**\n- Generated: ${artifact.generatedAt}\n- Commit: \`${artifact.gitCommit}\`\n- Branch: \`${artifact.branch}\`\n\n## Invariants\n\n| Invariant | Status |\n|---|---|\n${invariants}\n\n## Commands\n\n| Command | Status | Duration ms |\n|---|---|---:|\n${commands}\n`;
}
