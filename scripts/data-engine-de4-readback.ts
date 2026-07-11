#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const defaultOut = resolve(root, "docs/verification/data-engine-de4-readback.json");
const defaultReport = resolve(root, "docs/verification/data-engine-de4-readback.md");
const mode = process.argv[2] ?? "inspect";
const out = argumentPath("--out", defaultOut);
const report = argumentPath("--report", defaultReport);

const verificationCommands = [
  ["bun", "run", "typecheck"],
  ["bun", "test", "packages/contracts/test/contracts.test.ts", "packages/local-runtime/local-store-sqlite", "packages/local-runtime/runtime-daemon"],
  ["bun", "run", "verify:explorer"],
  ["node", "scripts/packaged-cli-smoke.mjs"]
] as const;

if (mode === "run") {
  const commands = verificationCommands.map((command) => execute(command));
  const contractPreflight = execute([
    "repo-harness", "run", "contract-run", "preflight",
    "--contract", "tasks/contracts/20260711-1836-data-engine-de4-bounded-read-planner.contract.md",
    "--json"
  ]);
  const contractsSource = await source("packages/contracts/src/ports.ts");
  const compilerSource = await source("packages/local-runtime/runtime-daemon/src/explorer-projection.ts");
  const daemonSource = await source("packages/local-runtime/runtime-daemon/src/index.ts");
  const storeSource = await source("packages/local-runtime/local-store-sqlite/src/index.ts");
  const compilerTest = await source("packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts");
  const daemonTest = await source("packages/local-runtime/runtime-daemon/test/local-runtime.test.ts");
  const storeTest = await source("packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts");
  const artifact = {
    schemaVersion: "archcontext.data-engine-de4-readback/v1",
    generatedAt: new Date().toISOString(),
    gitCommit: textCommand(["git", "rev-parse", "HEAD"]),
    branch: textCommand(["git", "branch", "--show-current"]),
    contracts: {
      planner: "archcontext.projection-read-planner/v1",
      plan: "archcontext.projection-read-plan/v1",
      readSet: "archcontext.projection-read-set/v1",
      authority: "git-product-authority-or-verified-ledger-current"
    },
    invariants: {
      canonicalTypedPlan: contractsSource.includes("ProjectionReadPlanV1")
        && contractsSource.includes("PROJECTION_READ_PLANNER_VERSION")
        && contractsSource.includes("canonicalProjectionReadPlanV1")
        && compilerSource.includes("planProjectionRead")
        && compilerTest.includes("read planner deterministically selects overview context and focused bounded policies"),
      manifestBindsPlanAndReadSet: contractsSource.includes("readPlan: ProjectionReadPlanV1")
        && contractsSource.includes("readSet: ProjectionReadSetV1")
        && compilerSource.includes("projection-read-plan-mismatch")
        && compilerSource.includes("selectedGraphDigest"),
      verifiedCursorBindsPartialSqlite: storeSource.includes("readExplorerProjectionAuthorityFromDb")
        && storeSource.includes("explorer-projection-authority-cursor-mismatch")
        && storeSource.includes("evidence_after_digest")
        && storeSource.includes("verifiedMaterializingEventForCurrentRow")
        && storeSource.includes("assertLatestMaterializedSubject")
        && storeTest.includes("bounded Explorer read plan selects a focused SQLite neighborhood and targeted metadata"),
      boundedFocusNoFullGraphRead: daemonSource.includes("architectureLedgerProjectionGitScope")
        && daemonSource.includes("readExplorerProjectionInputs")
        && daemonTest.includes("verified-ledger focused Explorer projection uses bounded reads without loading the full graph")
        && daemonTest.includes("architectureLedgerFullStateReads).toBe(0)"),
      boundedGraphAndMetadataSql: storeSource.includes("readExplorerFocusedNeighborhoodGraphFromDb")
        && storeSource.includes("readExplorerProjectionMetadataFromDb")
        && storeSource.includes("maxBacklinks")
        && storeSource.includes("maxBindings"),
      actualRowsAndAuthoritativeTotals: storeSource.includes("readExplorerFocusedNeighborhoodTotalsFromDb")
        && storeSource.includes("rowsRead: rows.length")
        && storeTest.includes("explorer-projection-neighborhood-budget-exceeded")
        && compilerTest.includes("omittedNodeCount: 1, truncated: true"),
      gitAuthoritySelectsFromGitState: daemonSource.includes("selectProjectionGraphFromAuthority(readPlan, yamlPlan!.state)")
        && daemonSource.includes("evidenceAuthorityCursor")
        && daemonTest.includes("Git graph authority retains verified ledger evidence and backlinks through a separate cursor")
        && compilerSource.includes('input.readPlan.source !== expectedSource'),
      compilerHasNoStoreDependency: !compilerSource.includes("local-store-sqlite")
        && !compilerSource.includes("readArchitectureLedgerState")
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

if (mode !== "inspect") throw new Error("usage: bun scripts/data-engine-de4-readback.ts run|inspect [--out <path>] [--report <path>]");
if (!existsSync(out)) throw new Error(`DE4 readback not found: ${out}`);
const artifact = await Bun.file(out).json() as any;
const failures: string[] = [];
if (artifact.schemaVersion !== "archcontext.data-engine-de4-readback/v1") failures.push("schemaVersion");
if (artifact.verdict !== "PASS") failures.push("verdict");
for (const [key, value] of Object.entries(artifact.invariants ?? {})) if (value !== true) failures.push(`invariant:${key}`);
for (const command of artifact.commands ?? []) if (command.ok !== true) failures.push(`command:${command.command}`);
if (failures.length > 0) throw new Error(`DE4 readback failed: ${failures.join(", ")}`);
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
  return `# Data Engine DE4 Readback\n\n- Verdict: **${artifact.verdict}**\n- Generated: ${artifact.generatedAt}\n- Commit: \`${artifact.gitCommit}\`\n- Branch: \`${artifact.branch}\`\n\n## Invariants\n\n| Invariant | Status |\n|---|---|\n${invariants}\n\n## Commands\n\n| Command | Status | Duration ms |\n|---|---|---:|\n${commands}\n`;
}
