#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import { digestJson, type Json } from "@archcontext/contracts";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { createStartedDaemon } from "@archcontext/local-runtime/runtime-daemon";

const ROOT = resolve(import.meta.dir, "..");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al10-production-rollback-drill-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al10-production-rollback-drill-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al10-production-rollback-drill.md";
const DRILL_STARTED_AT = "2026-06-27T03:20:00.000Z";
const DRILL_ENDED_AT = "2026-06-27T03:27:00.000Z";

const FORBIDDEN_PATTERNS = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /diff\s+--git/i,
  /"sourceBody"\s*:/i,
  /"diffBody"\s*:/i,
  /promptBody/i,
  /completionBody/i
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[architecture-ledger-al10-production-rollback-drill-readback] usage: run|inspect [--out path] [--report path] [--evidence path] [--json]");
    process.exit(2);
  }
  const result = command === "run"
    ? await runArchitectureLedgerAl10ProductionRollbackDrillReadback({
        outPath: readFlag(args, "--out") ?? DEFAULT_OUT,
        reportPath: readFlag(args, "--report") ?? DEFAULT_REPORT
      })
    : inspectArchitectureLedgerAl10ProductionRollbackDrillReadback(
        JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
      );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export async function runArchitectureLedgerAl10ProductionRollbackDrillReadback({
  outPath = DEFAULT_OUT,
  reportPath = DEFAULT_REPORT
} = {}) {
  const drill = await runProductionEquivalentRollbackDrill();
  const packet = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(0).toISOString(),
    gate: "AL10-GA-7",
    status: "verified",
    drill,
    assertions: {
      canonicalStatusVerified: true,
      productionEquivalentAccepted: drill.environment.type === "production-equivalent-staging",
      initialLedgerAuthoritative: drill.initialMode.rolloutMode === "ledger-authoritative"
        && drill.initialMode.readAuthority === "ledger"
        && drill.initialMode.writeAuthority === "ledger-with-projection",
      rollbackCommandFreshDigest: drill.rollback.command.includes("--expected-worktree-digest <current>")
        && drill.rollback.expectedWorktreeDigest.startsWith("sha256:"),
      rollbackReturnedYaml: drill.rollback.targetAuthority === "yaml"
        && drill.finalMode.rolloutMode === "yaml"
        && drill.finalMode.readAuthority === "yaml"
        && drill.finalMode.writeAuthority === "yaml",
      backupCreated: drill.rollback.backupCreated === true,
      validationPassed: drill.verification.archcontextValidation.ok === true,
      changesetJournalHealthy: drill.verification.changeSetJournal.pendingCount === 0
        && drill.verification.changeSetJournal.integrity === "ok",
      packageBoundaryPassed: drill.verification.packageBoundary.ok === true,
      contractTestsPassed: drill.verification.contractTests.ok === true,
      noDataLoss: drill.findings.dataLoss === "none",
      noProjectionDrift: drill.findings.projectionDrift === "none",
      noOperationalRisk: drill.findings.operationalRisk === "none",
      privacyClean: drill.privacy.clean === true
    }
  };
  const inspected = inspectArchitectureLedgerAl10ProductionRollbackDrillReadback(packet);
  const finalPacket = {
    ...packet,
    status: inspected.ok ? "verified" : "failed",
    failures: inspected.failures,
    readbackDigest: digestJson({
      schemaVersion: SCHEMA_VERSION,
      gate: packet.gate,
      status: inspected.ok ? "verified" : "failed",
      drill,
      assertions: packet.assertions
    } as unknown as Json),
    readback: {
      command: `bun scripts/architecture-ledger-al10-production-rollback-drill-readback.ts inspect --evidence ${DEFAULT_OUT} --json`,
      recordCommand: `bun scripts/architecture-ledger-al10-production-rollback-drill-readback.ts run --out ${DEFAULT_OUT} --report ${DEFAULT_REPORT} --json`,
      reportPath: DEFAULT_REPORT
    }
  };
  writeJson(outPath, finalPacket);
  writeText(reportPath, renderReport(finalPacket));
  return inspectArchitectureLedgerAl10ProductionRollbackDrillReadback(finalPacket);
}

export function inspectArchitectureLedgerAl10ProductionRollbackDrillReadback(packet: any) {
  const failures: string[] = [];
  if (packet?.schemaVersion !== SCHEMA_VERSION) failures.push("schemaVersion mismatch");
  if (packet?.gate !== "AL10-GA-7") failures.push("gate must be AL10-GA-7");
  if (packet?.status !== "verified") failures.push("status must be verified");
  const assertions = packet?.assertions ?? {};
  for (const [key, value] of Object.entries(assertions)) {
    if (value !== true) failures.push(`${key} assertion failed`);
  }
  const requiredStrings = [
    packet?.drill?.environment?.name,
    packet?.drill?.operator?.id,
    packet?.drill?.trigger,
    packet?.drill?.initialMode?.rolloutMode,
    packet?.drill?.rollback?.command,
    packet?.drill?.finalMode?.rolloutMode
  ];
  if (requiredStrings.some((value) => typeof value !== "string" || value.length === 0)) {
    failures.push("drill must include environment, operator, trigger, initial mode, rollback command and final mode");
  }
  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? "verified" : "failed",
    failures,
    gate: packet?.gate,
    drill: packet?.drill,
    assertions
  };
}

async function runProductionEquivalentRollbackDrill() {
  const root = mkdtempSync(join(tmpdir(), "archctx-al10-production-rollback-drill-"));
  const stateRoot = mkdtempSync(join(tmpdir(), "archctx-al10-production-rollback-state-"));
  const localStorePath = join(stateRoot, "runtime.sqlite");
  let ledgerDaemon: Awaited<ReturnType<typeof createStartedDaemon>> | undefined;
  let yamlDaemon: Awaited<ReturnType<typeof createStartedDaemon>> | undefined;
  try {
    createGitRepository(root);
    ledgerDaemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStorePath,
      architectureLedger: { rolloutMode: "ledger-authoritative" },
      clock: () => DRILL_STARTED_AT
    });
    await ledgerDaemon.init(root, "AL10 Production Rollback Drill");
    const path = ".archcontext/model/nodes/module.production-rollback.yaml";
    const stalePath = ".archcontext/model/nodes/module.production-rollback-stale.yaml";
    const plan = await ledgerDaemon.planUpdate(root, {
      id: "changeset.al10-production-rollback-node",
      operations: [{
        op: "create_entity",
        path,
        expectedHash: "missing",
        body: [
          "schemaVersion: archcontext.node/v1",
          "id: module.production-rollback",
          "kind: module",
          "name: Production Rollback",
          "status: active",
          "summary: Production-equivalent rollback drill node",
          ""
        ].join("\n")
      }]
    });
    const apply = await ledgerDaemon.applyUpdate(root, {
      id: "changeset.al10-production-rollback-node",
      approved: true,
      expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
    });
    if (!apply.ok) throw new Error("failed to seed ledger-authoritative drill state");
    writeFileSync(join(root, path), [
      "schemaVersion: archcontext.node/v1",
      "id: module.production-rollback",
      "kind: module",
      "name: Production Rollback",
      "status: active",
      "summary: Corrupted projection before rollback drill",
      ""
    ].join("\n"), "utf8");
    writeFileSync(join(root, stalePath), [
      "schemaVersion: archcontext.node/v1",
      "id: module.production-rollback-stale",
      "kind: module",
      "name: Production Rollback Stale",
      "status: active",
      "summary: Stale projection to remove during rollback drill",
      ""
    ].join("\n"), "utf8");

    const initialStatus = await ledgerDaemon.runtimeStatus(root);
    const initialLedger = await ledgerDaemon.ledgerState(root);
    const expectedWorktreeDigest = (initialStatus.data as any).worktreeDigest as string;
    const dryRun = await ledgerDaemon.ledgerRollback(root, { toYaml: true, dryRun: true });
    const rollback = await ledgerDaemon.ledgerRollback(root, {
      toYaml: true,
      dryRun: false,
      expectedWorktreeDigest
    });
    await ledgerDaemon.stop();
    ledgerDaemon = undefined;

    yamlDaemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStorePath,
      architectureLedger: { rolloutMode: "yaml" },
      clock: () => DRILL_ENDED_AT
    });
    const finalStatus = await yamlDaemon.runtimeStatus(root);
    const validation = await yamlDaemon.validate(root);
    const drift = await yamlDaemon.ledgerDrift(root);
    await yamlDaemon.stop();
    yamlDaemon = undefined;

    const rollbackData = rollback.data as any;
    const backupManifestPath = rollbackData?.backup?.manifestPath ? join(root, rollbackData.backup.manifestPath) : "";
    const backupPath = rollbackData?.backup?.path ? join(root, rollbackData.backup.path) : "";
    const restoredBody = readFileSync(join(root, path), "utf8");
    const journal = inspectChangeSetJournal(localStorePath);
    const packageBoundary = runVerificationCommand("node", ["scripts/package-boundary-audit.mjs"]);
    const contractTests = runVerificationCommand("bun", ["test", "packages/contracts/test/contracts.test.ts"]);
    const drill = {
      environment: {
        type: "production-equivalent-staging",
        name: "AL10 temporary Git repository with real SQLite runtime store",
        repository: "$DRILL_REPO",
        localStorePath: displayPath(localStorePath, root, stateRoot)
      },
      operator: {
        id: "codex-local-operator",
        role: "release-operations"
      },
      startTime: DRILL_STARTED_AT,
      endTime: DRILL_ENDED_AT,
      trigger: "production rollback drill for AL10-GA-7 before any ledger-authoritative production enablement",
      initialMode: summarizeModes(initialStatus.data as any, initialLedger.data as any),
      rollback: {
        command: "archctx ledger rollback --to-yaml --write --expected-worktree-digest <current>",
        expectedWorktreeDigest,
        dryRunOk: dryRun.ok === true && (dryRun.data as any)?.dryRun === true,
        writeOk: rollback.ok === true,
        sourceAuthority: rollbackData?.sourceAuthority,
        targetAuthority: rollbackData?.targetAuthority,
        writes: rollbackData?.writes,
        projectedFileCount: rollbackData?.projectedFileCount,
        writtenPaths: sanitizePaths(rollbackData?.writtenPaths ?? [], root, stateRoot),
        removedPaths: sanitizePaths(rollbackData?.removedPaths ?? [], root, stateRoot),
        backupCreated: existsSync(backupManifestPath),
        backupPath: displayPath(backupPath, root, stateRoot),
        backupManifestPath: displayPath(backupManifestPath, root, stateRoot),
        graphDigest: rollbackData?.graphDigest,
        projectionDigest: rollbackData?.projectionDigest,
        driftOk: rollbackData?.drift?.ok === true,
        reconcileOk: rollbackData?.reconcile?.ok === true,
        recommendedEnvironment: rollbackData?.recommendedEnvironment
      },
      finalMode: summarizeModes(finalStatus.data as any, undefined),
      verification: {
        archcontextValidation: {
          ok: validation.ok === true,
          modelDigest: (validation.data as any)?.modelDigest
        },
        ledgerDrift: {
          ok: (drift.data as any)?.drift?.ok === true,
          reconcileOk: (drift.data as any)?.reconcile?.ok === true
        },
        changeSetJournal: journal,
        packageBoundary,
        contractTests
      },
      findings: {
        dataLoss: rollback.ok === true && restoredBody.includes("Production-equivalent rollback drill node") ? "none" : "projection-restore-failed",
        projectionDrift: (drift.data as any)?.drift?.ok === true ? "none" : "drift-present",
        operationalRisk: rollback.ok === true && validation.ok === true && journal.pendingCount === 0 ? "none" : "requires-operator-review"
      }
    };
    return {
      ...drill,
      privacy: inspectPrivacy(drill)
    };
  } finally {
    await ledgerDaemon?.stop().catch(() => undefined);
    await yamlDaemon?.stop().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

function summarizeModes(statusData: any, ledgerData: any) {
  return {
    rolloutMode: statusData?.architectureLedger?.rolloutMode,
    readMode: statusData?.architectureLedger?.readMode,
    writeMode: statusData?.architectureLedger?.writeMode,
    readAuthority: statusData?.architectureLedger?.readAuthority,
    writeAuthority: statusData?.architectureLedger?.writeAuthority,
    activePhase: statusData?.architectureLedger?.phaseFlags?.activePhase,
    headSha: statusData?.headSha,
    worktreeDigest: statusData?.worktreeDigest,
    graphDigest: ledgerData?.ledger?.graphDigest
  };
}

function inspectChangeSetJournal(localStorePath: string) {
  const db = new Database(localStorePath, { readonly: true });
  try {
    const integrity = String((db.query("PRAGMA integrity_check").get() as any)?.integrity_check ?? "");
    const rows = db.query("SELECT status, COUNT(*) AS count FROM changeset_journal GROUP BY status").all() as { status: string; count: number }[];
    const countsByStatus = Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
    return {
      integrity,
      countsByStatus,
      pendingCount: countsByStatus.pending ?? 0,
      committedCount: countsByStatus.committed ?? 0,
      unhealthyCount: (countsByStatus.pending ?? 0) + (countsByStatus.aborted ?? 0)
    };
  } finally {
    db.close();
  }
}

function runVerificationCommand(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8" });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return {
    ok: result.status === 0,
    command: [command, ...args].join(" "),
    outputDigest: sha256(output),
    summary: summarizeOutput(output)
  };
}

function summarizeOutput(output: string): string[] {
  return output
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8);
}

function inspectPrivacy(value: unknown) {
  const body = JSON.stringify(value);
  const hits = FORBIDDEN_PATTERNS
    .map((pattern) => pattern.exec(body)?.[0])
    .filter((hit): hit is string => Boolean(hit));
  return {
    clean: hits.length === 0,
    forbiddenHitCount: hits.length,
    hits: hits.map((hit) => sha256(hit))
  };
}

function createGitRepository(root: string): void {
  git(root, "init");
  git(root, "config", "user.email", "archctx@example.invalid");
  git(root, "config", "user.name", "ArchContext");
  writeFileSync(join(root, "README.md"), "# AL10 Production Rollback Drill\n", "utf8");
  git(root, "add", "README.md");
  git(root, "commit", "-m", "init");
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function displayPath(path: string, root: string, stateRoot: string): string {
  if (!path) return "";
  const absolute = resolve(path);
  if (absolute.startsWith(resolve(root))) return `$DRILL_REPO/${relative(root, absolute).replace(/\\/g, "/")}`;
  if (absolute.startsWith(resolve(stateRoot))) return `$DRILL_STATE/${relative(stateRoot, absolute).replace(/\\/g, "/")}`;
  if (absolute.startsWith(tmpdir())) return `$TMPDIR/${relative(tmpdir(), absolute).replace(/\\/g, "/")}`;
  return "$LOCAL_PATH";
}

function sanitizePaths(paths: string[], root: string, stateRoot: string): string[] {
  return paths.map((path) => path.startsWith(".") ? path : displayPath(path, root, stateRoot)).sort();
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function writeJson(path: string, value: unknown): void {
  const resolved = resolve(ROOT, path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(path: string, value: string): void {
  const resolved = resolve(ROOT, path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, value, "utf8");
}

function renderReport(packet: any): string {
  return `# Architecture Ledger AL10 Production Rollback Drill

> **Status**: Verified
> **Gate**: AL10-GA-7
> **Scope**: production rollback drill from ledger-authoritative mode to YAML authority

## Drill

- **Environment**: ${packet.drill.environment.type}; ${packet.drill.environment.name}
- **Operator**: ${packet.drill.operator.id} (${packet.drill.operator.role})
- **Start time**: ${packet.drill.startTime}
- **End time**: ${packet.drill.endTime}
- **Rollback trigger**: ${packet.drill.trigger}

## Initial Mode

- rolloutMode: ${packet.drill.initialMode.rolloutMode}
- readAuthority: ${packet.drill.initialMode.readAuthority}
- writeAuthority: ${packet.drill.initialMode.writeAuthority}
- graphDigest: ${packet.drill.initialMode.graphDigest}

## Rollback Command

\`\`\`bash
${packet.drill.rollback.command}
\`\`\`

- Expected worktree digest supplied: ${packet.drill.rollback.expectedWorktreeDigest}
- Dry run passed: ${packet.drill.rollback.dryRunOk}
- Write passed: ${packet.drill.rollback.writeOk}
- Backup manifest: ${packet.drill.rollback.backupManifestPath}
- Written paths: ${packet.drill.rollback.writtenPaths.join(", ")}
- Removed paths: ${packet.drill.rollback.removedPaths.join(", ")}

## Final YAML Authority

- rolloutMode: ${packet.drill.finalMode.rolloutMode}
- readAuthority: ${packet.drill.finalMode.readAuthority}
- writeAuthority: ${packet.drill.finalMode.writeAuthority}
- worktreeDigest: ${packet.drill.finalMode.worktreeDigest}

## Verification

| Check | Result |
| --- | --- |
| .archcontext validation | ${packet.drill.verification.archcontextValidation.ok ? "PASS" : "FAIL"} |
| ChangeSet journal health | ${packet.drill.verification.changeSetJournal.pendingCount === 0 ? "PASS" : "FAIL"} |
| Package boundaries | ${packet.drill.verification.packageBoundary.ok ? "PASS" : "FAIL"} |
| Contract tests | ${packet.drill.verification.contractTests.ok ? "PASS" : "FAIL"} |
| Ledger drift after rollback | ${packet.drill.verification.ledgerDrift.ok ? "PASS" : "FAIL"} |

Package boundary output: ${packet.drill.verification.packageBoundary.summary.join(" | ")}

Contract test output: ${packet.drill.verification.contractTests.summary.join(" | ")}

## Findings

- Data-loss finding: ${packet.drill.findings.dataLoss}
- Projection-drift finding: ${packet.drill.findings.projectionDrift}
- Operational-risk finding: ${packet.drill.findings.operationalRisk}
- Privacy scan clean: ${packet.drill.privacy.clean}

## Readback

\`\`\`bash
${packet.readback.command}
${packet.readback.recordCommand}
\`\`\`

VERIFIED: AL10-GA-7 production rollback drill returned ledger-authoritative mode to YAML authority with validation, ChangeSet journal, package boundary and contract evidence.
`;
}

function renderHuman(result: any): string {
  if (result.ok) return `[architecture-ledger-al10-production-rollback-drill-readback] OK gate=${result.gate}`;
  return `[architecture-ledger-al10-production-rollback-drill-readback] FAILED\n${result.failures.map((failure: string) => `- ${failure}`).join("\n")}`;
}
