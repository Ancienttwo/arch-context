#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { createStartedDaemon } from "@archcontext/local-runtime/runtime-daemon";

const ROOT = resolve(import.meta.dir, "..");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al10-rollout-workflow-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al10-rollout-workflow-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al10-rollout-workflow.md";
const GATES = ["AL10-01", "AL10-02"] as const;
const FORBIDDEN_KEYS = new Set(["body", "sourceCode", "sourceBody", "rawSource", "rawDiff", "prompt", "completion"]);

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[architecture-ledger-al10-rollout-workflow-readback] usage: run|inspect [--out path] [--report path] [--evidence path] [--json]");
    process.exit(2);
  }
  const result = command === "run"
    ? await runArchitectureLedgerAl10RolloutWorkflowReadback({
        outPath: readFlag(args, "--out") ?? DEFAULT_OUT,
        reportPath: readFlag(args, "--report") ?? DEFAULT_REPORT
      })
    : inspectArchitectureLedgerAl10RolloutWorkflowReadback(
        JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
      );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export async function runArchitectureLedgerAl10RolloutWorkflowReadback({
  outPath = DEFAULT_OUT,
  reportPath = DEFAULT_REPORT
} = {}) {
  const workflow = await runWorkflowProbe();
  const privacy = scanForbiddenKeys(workflow);
  const packet = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(0).toISOString(),
    gates: [...GATES],
    workflow,
    privacy: {
      rawSourcePersisted: privacy.length > 0,
      forbiddenKeys: privacy
    },
    assertions: {
      "AL10-01": workflow.phaseFlagsPresent
        && workflow.safeDowngradeEnvironmentYaml
        && workflow.recommendedDualModeAfterMigration,
      "AL10-02": workflow.dryRunPlanned
        && workflow.writeVerified
        && workflow.sqliteBackupCreated
        && workflow.backupIntegrityOk
        && workflow.replayIntegrityVerified
        && workflow.rollbackExecutable
    }
  };
  const inspected = inspectArchitectureLedgerAl10RolloutWorkflowReadback(packet);
  const finalPacket = {
    ...packet,
    status: inspected.ok ? "verified" : "failed",
    failures: inspected.failures
  };
  writeJson(outPath, finalPacket);
  writeText(reportPath, renderReport(finalPacket));
  return inspectArchitectureLedgerAl10RolloutWorkflowReadback(finalPacket);
}

export function inspectArchitectureLedgerAl10RolloutWorkflowReadback(packet: any) {
  const failures: string[] = [];
  if (packet?.schemaVersion !== SCHEMA_VERSION) failures.push("schemaVersion mismatch");
  for (const gate of GATES) {
    if (packet?.assertions?.[gate] !== true) failures.push(`${gate} assertion failed`);
  }
  if (packet?.privacy?.rawSourcePersisted === true) {
    failures.push(`privacy forbidden keys present: ${packet.privacy.forbiddenKeys?.join(",")}`);
  }
  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? "verified" : "failed",
    failures,
    workflow: packet.workflow,
    assertions: packet.assertions
  };
}

async function runWorkflowProbe() {
  const root = mkdtempSync(join(tmpdir(), "archctx-al10-rollout-"));
  let daemon: Awaited<ReturnType<typeof createStartedDaemon>> | undefined;
  try {
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "archctx@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "ArchContext"], { cwd: root });
    writeFileSync(join(root, "README.md"), "# AL10 Rollout Workflow\n", "utf8");
    execFileSync("git", ["add", "README.md"], { cwd: root });
    execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "ignore" });

    daemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: new TestLocalStore(),
      architectureLedger: { rolloutMode: "yaml" },
      clock: () => "2026-06-26T12:00:00.000Z"
    });
    await daemon.init(root, "AL10 Rollout Workflow");

    const dryRun = await daemon.ledgerMigrate(root, { fromYaml: true, dryRun: true });
    const status = await daemon.runtimeStatus(root);
    const migrated = await daemon.ledgerMigrate(root, {
      fromYaml: true,
      dryRun: false,
      expectedWorktreeDigest: (status.data as any).worktreeDigest
    });
    const postMigrateState = await daemon.ledgerState(root);
    const rollbackStatus = await daemon.runtimeStatus(root);
    const rollback = await daemon.ledgerRollback(root, {
      toYaml: true,
      dryRun: false,
      expectedWorktreeDigest: (rollbackStatus.data as any).worktreeDigest
    });

    const migratedData = migrated.data as any;
    const rollbackData = rollback.data as any;
    const phaseFlags = migratedData?.architectureLedger?.phaseFlags;
    return {
      dryRunPlanned: dryRun.ok === true && (dryRun.data as any)?.status === "planned" && (dryRun.data as any)?.writes === "none",
      writeVerified: migrated.ok === true && migratedData?.status === "verified" && migratedData?.writes === "architecture-ledger",
      phaseFlagsPresent:
        phaseFlags?.schemaVersion === "archcontext.runtime-architecture-ledger-phase-flags/v1"
        && phaseFlags?.activePhase === "yaml"
        && Array.isArray(phaseFlags?.supportedPhases)
        && phaseFlags.supportedPhases.includes("ledger-authoritative"),
      safeDowngradeEnvironmentYaml: migratedData?.rollback?.safeDowngradeEnvironment?.ARCHCONTEXT_LEDGER_MODE === "yaml",
      recommendedDualModeAfterMigration: migratedData?.recommendedEnvironment?.ARCHCONTEXT_LEDGER_MODE === "dual",
      sqliteBackupCreated: migratedData?.backup?.status === "created" && existsSync(migratedData.backup.backupPath),
      backupIntegrityOk: migratedData?.backup?.integrity === "ok",
      replayIntegrityVerified:
        migratedData?.verification?.ok === true
        && migratedData?.verification?.graphDigest === migratedData?.verification?.expectedGraphDigest,
      driftCleanAfterMigrate: migratedData?.drift?.ok === true && (postMigrateState.data as any)?.drift?.ok === true,
      appendedImportEvent: migratedData?.append?.status === "appended" && migratedData?.append?.appendedEventCount === 1,
      rollbackExecutable:
        rollback.ok === true
        && rollbackData?.targetAuthority === "yaml"
        && rollbackData?.recommendedEnvironment?.ARCHCONTEXT_LEDGER_MODE === "yaml"
        && existsSync(rollbackData?.backup?.manifestPath ? resolve(root, rollbackData.backup.manifestPath) : ""),
      rollbackCommand: migratedData?.rollback?.command,
      entityCount: migratedData?.append?.entityCount,
      graphDigest: migratedData?.graphDigest
    };
  } finally {
    await daemon?.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

function inspectObject(value: unknown, path = "$", found = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectObject(entry, `${path}[${index}]`, found));
    return found;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) found.add(`${path}.${key}`);
    inspectObject(child, `${path}.${key}`, found);
  }
  return found;
}

function scanForbiddenKeys(value: unknown): string[] {
  return [...inspectObject(value)].sort();
}

function writeJson(path: string, value: unknown): void {
  const absolute = resolve(ROOT, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(path: string, value: string): void {
  const absolute = resolve(ROOT, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
}

function renderReport(packet: any): string {
  const inspected = inspectArchitectureLedgerAl10RolloutWorkflowReadback(packet);
  return [
    "# AL10 Rollout Workflow Readback",
    "",
    `Status: ${inspected.status}`,
    "",
    "## Assertions",
    ...Object.entries(packet.assertions ?? {}).map(([gate, ok]) => `- ${gate}: ${ok ? "PASS" : "FAIL"}`),
    "",
    "## Evidence",
    `- Dry-run planned: ${String(packet.workflow?.dryRunPlanned)}`,
    `- Write verified: ${String(packet.workflow?.writeVerified)}`,
    `- SQLite backup created: ${String(packet.workflow?.sqliteBackupCreated)}`,
    `- Backup integrity: ${String(packet.workflow?.backupIntegrityOk)}`,
    `- Replay/integrity verified: ${String(packet.workflow?.replayIntegrityVerified)}`,
    `- Drift clean after migrate: ${String(packet.workflow?.driftCleanAfterMigrate)}`,
    `- Rollback executable: ${String(packet.workflow?.rollbackExecutable)}`,
    `- Safe downgrade command: ${packet.workflow?.rollbackCommand ?? "missing"}`,
    "",
    inspected.ok ? "VERIFIED: AL10 rollout workflow gates pass." : `FAILED:\n- ${inspected.failures.join("\n- ")}`
  ].join("\n");
}

function renderHuman(result: ReturnType<typeof inspectArchitectureLedgerAl10RolloutWorkflowReadback>): string {
  return result.ok
    ? "AL10 rollout workflow readback verified\n"
    : `AL10 rollout workflow readback failed:\n- ${result.failures.join("\n- ")}\n`;
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}
