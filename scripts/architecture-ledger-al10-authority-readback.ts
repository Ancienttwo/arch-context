#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { digestJson, type Json } from "@archcontext/contracts";

const ROOT = resolve(import.meta.dir, "..");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al10-authority-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al10-authority-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al10-authority.md";
const GATES = ["AL10-local-authority-readback"] as const;
const FORBIDDEN_KEYS = new Set(["body", "sourceCode", "sourceBody", "rawSource", "rawDiff", "prompt", "completion", "projectedFiles"]);
const AUTHORITATIVE_ENV = {
  ARCHCONTEXT_LEDGER_MODE: "ledger-authoritative",
  ARCHCONTEXT_LEDGER_READ_MODE: "ledger",
  ARCHCONTEXT_LEDGER_WRITE_MODE: "ledger-with-projection"
} as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[architecture-ledger-al10-authority-readback] usage: run|inspect [--out path] [--report path] [--evidence path] [--json]");
    process.exit(2);
  }
  const result = command === "run"
    ? await runArchitectureLedgerAl10AuthorityReadback({
        outPath: readFlag(args, "--out") ?? DEFAULT_OUT,
        reportPath: readFlag(args, "--report") ?? DEFAULT_REPORT
      })
    : inspectArchitectureLedgerAl10AuthorityReadback(
        JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
      );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export async function runArchitectureLedgerAl10AuthorityReadback({
  outPath = DEFAULT_OUT,
  reportPath = DEFAULT_REPORT
} = {}) {
  const packet = await buildArchitectureLedgerAl10AuthorityPacket();
  const inspected = inspectArchitectureLedgerAl10AuthorityReadback(packet);
  const finalPacket = {
    ...packet,
    status: inspected.ok ? "verified" : "failed",
    failures: inspected.failures
  };
  writeJson(outPath, finalPacket);
  writeText(reportPath, `${renderReport(finalPacket)}\n`);
  return inspectArchitectureLedgerAl10AuthorityReadback(finalPacket);
}

export async function buildArchitectureLedgerAl10AuthorityPacket() {
  const stateRoot = mkdtempSync(resolve(tmpdir(), "archctx-al10-authority-state-"));
  const baseEnv = { ARCHCONTEXT_STATE_DIR: stateRoot };
  try {
    stopDaemon(baseEnv);
    const yamlStatus = runCli(["status", "--json"], baseEnv).data;
    const migration = runCli(["ledger", "migrate", "--from-yaml", "--write", "--expected-worktree-digest", String(yamlStatus.worktreeDigest)], baseEnv).data;
    const sqlite = inspectRuntimeSqlite(baseEnv);

    stopDaemon(baseEnv);
    const dualStatus = runCli(["status", "--json"], { ...baseEnv, ARCHCONTEXT_LEDGER_MODE: "dual" }).data;
    const dualPromote = runCli(["ledger", "promote", "--mode", "authoritative", "--preflight", "--rollback-plan"], { ...baseEnv, ARCHCONTEXT_LEDGER_MODE: "dual" }).data;
    const dualRollbackDryRun = runCli(["ledger", "rollback", "--to-yaml", "--dry-run"], { ...baseEnv, ARCHCONTEXT_LEDGER_MODE: "dual" }).data;

    stopDaemon(baseEnv);
    const shadowStatus = runCli(["status", "--json"], { ...baseEnv, ARCHCONTEXT_LEDGER_MODE: "ledger-shadow" }).data;
    const shadowPromote = runCli(["ledger", "promote", "--mode", "authoritative", "--preflight", "--rollback-plan"], { ...baseEnv, ARCHCONTEXT_LEDGER_MODE: "ledger-shadow" }).data;

    stopDaemon(baseEnv);
    const authoritativeStatus = runCli(["status", "--json"], { ...baseEnv, ...AUTHORITATIVE_ENV }).data;
    const authoritativeDrift = runCli(["ledger", "drift", "--json"], { ...baseEnv, ...AUTHORITATIVE_ENV }).data;
    const authoritativePromote = runCli(["ledger", "promote", "--mode", "authoritative", "--preflight", "--rollback-plan"], { ...baseEnv, ...AUTHORITATIVE_ENV }).data;
    const authoritativeRollbackDryRun = runCli(["ledger", "rollback", "--to-yaml", "--dry-run"], { ...baseEnv, ...AUTHORITATIVE_ENV }).data;

    const packet = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date(0).toISOString(),
      gates: [...GATES],
      scope: {
        repo: "local-architecture-ledger-authority-readback",
        authority: "temporary runtime state plus current Git .archcontext YAML",
        closedGates: [...GATES],
        explicitlyOpen: [
          "production-ga",
          "hard-enforcement",
          "rollback-write-drill",
          "independent-security-review",
          "representative-beta-readback"
        ]
      },
      source: {
        stateRoot: "$TMPDIR/archctx-al10-authority-state-*",
        gitHead: yamlStatus.headSha,
        initialWorktreeDigest: yamlStatus.worktreeDigest
      },
      migration: summarizeMigration(migration),
      sqlite,
      dual: {
        status: summarizeStatus(dualStatus),
        promotionPreflight: summarizePromotion(dualPromote),
        rollbackDryRun: summarizeRollback(dualRollbackDryRun)
      },
      ledgerShadow: {
        status: summarizeStatus(shadowStatus),
        promotionPreflight: summarizePromotion(shadowPromote)
      },
      authoritative: {
        expectedEnvironment: AUTHORITATIVE_ENV,
        status: summarizeStatus(authoritativeStatus),
        drift: summarizeDrift(authoritativeDrift),
        promotionPreflight: summarizePromotion(authoritativePromote),
        rollbackDryRun: summarizeRollback(authoritativeRollbackDryRun)
      }
    };
    const forbidden = scanForbiddenKeys(packet);
    const assertions = {
      dualMigrationVerified: packet.migration.status === "verified"
        && packet.migration.writes === "architecture-ledger"
        && packet.migration.appendedEventCount === 1
        && packet.migration.verificationOk === true
        && packet.migration.driftOk === true
        && packet.migration.reconcileOk === true,
      runtimeSqliteCurrent: packet.sqlite.integrity === "ok"
        && packet.sqlite.architectureEvents === 1
        && packet.sqlite.architectureEntitiesCurrent === 1,
      dualBlocksAuthoritativeSkip: packet.dual.status.activePhase === "dual"
        && packet.dual.status.readAuthority === "yaml"
        && packet.dual.status.writeAuthority === "dual"
        && packet.dual.promotionPreflight.status === "blocked"
        && packet.dual.promotionPreflight.nextRequiredPhase === "ledger-shadow",
      dualRollbackDryRunClean: packet.dual.rollbackDryRun.writes === "none"
        && packet.dual.rollbackDryRun.targetAuthority === "yaml"
        && packet.dual.rollbackDryRun.driftOk === true
        && packet.dual.rollbackDryRun.reconcileOk === true,
      ledgerShadowReady: packet.ledgerShadow.status.activePhase === "ledger-shadow"
        && packet.ledgerShadow.promotionPreflight.status === "ready"
        && packet.ledgerShadow.promotionPreflight.ready === true
        && packet.ledgerShadow.promotionPreflight.reasonCodes.length === 0,
      authoritativeReadsFromLedger: packet.authoritative.status.activePhase === "ledger-authoritative"
        && packet.authoritative.status.readAuthority === "ledger"
        && packet.authoritative.status.writeAuthority === "ledger-with-projection",
      authoritativeDriftClean: packet.authoritative.drift.driftOk === true
        && packet.authoritative.drift.reconcileOk === true
        && packet.authoritative.drift.semanticDrift === false
        && packet.authoritative.drift.unsupportedFileCount === 0,
      authoritativeAlreadyActivePreflight: packet.authoritative.promotionPreflight.status === "already-active"
        && packet.authoritative.promotionPreflight.reasonCodes.includes("already-ledger-authoritative")
        && packet.authoritative.promotionPreflight.sideEffects.sqliteMutated === false
        && packet.authoritative.promotionPreflight.boundary.productionGaClaimed === false,
      authoritativeRollbackDryRunClean: packet.authoritative.rollbackDryRun.writes === "none"
        && packet.authoritative.rollbackDryRun.targetAuthority === "yaml"
        && packet.authoritative.rollbackDryRun.driftOk === true
        && packet.authoritative.rollbackDryRun.reconcileOk === true,
      noRawBodiesPersisted: forbidden.length === 0
    };
    return {
      ...packet,
      assertions,
      privacy: {
        rawBodiesPersisted: forbidden.length > 0,
        forbiddenKeys: forbidden
      },
      readbackDigest: digestJson({ ...packet, assertions } as unknown as Json)
    };
  } finally {
    stopDaemon(baseEnv);
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

export function inspectArchitectureLedgerAl10AuthorityReadback(packet: any) {
  const failures: string[] = [];
  if (packet?.schemaVersion !== SCHEMA_VERSION) failures.push("schemaVersion mismatch");
  if (!Array.isArray(packet?.gates) || packet.gates.join(",") !== GATES.join(",")) failures.push("gates must be exactly AL10-local-authority-readback");
  for (const [key, value] of Object.entries(packet?.assertions ?? {})) {
    if (value !== true) failures.push(`assertions.${key} must be true`);
  }
  if (packet?.privacy?.rawBodiesPersisted === true) failures.push(`privacy forbidden keys present: ${(packet.privacy.forbiddenKeys ?? []).join(",")}`);
  if (packet?.status === "verified" && failures.length > 0) failures.push("status cannot be verified when failures exist");
  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? "verified" : "failed",
    failures,
    assertions: packet?.assertions,
    readbackDigest: packet?.readbackDigest
  };
}

function summarizeStatus(data: any) {
  const ledger = data?.architectureLedger ?? {};
  const flags = ledger.phaseFlags ?? {};
  return {
    rolloutMode: ledger.rolloutMode,
    readMode: ledger.readMode,
    writeMode: ledger.writeMode,
    readAuthority: ledger.readAuthority,
    writeAuthority: ledger.writeAuthority,
    activePhase: flags.activePhase,
    promotionPath: flags.promotionPath ?? [],
    downgradePath: flags.downgradePath ?? [],
    worktreeDigest: data?.worktreeDigest
  };
}

function summarizeMigration(data: any) {
  return {
    status: data?.status,
    writes: data?.writes,
    graphDigest: data?.graphDigest,
    previousGraphDigest: data?.previousGraphDigest,
    importedCount: Array.isArray(data?.imported) ? data.imported.length : 0,
    ignoredFileCount: Array.isArray(data?.ignoredFiles) ? data.ignoredFiles.length : 0,
    unsupportedFileCount: Array.isArray(data?.unsupportedFiles) ? data.unsupportedFiles.length : 0,
    backupStatus: data?.backup?.status,
    backupIntegrity: data?.backup?.integrity,
    appendedEventCount: data?.append?.appendedEventCount,
    duplicateEventCount: data?.append?.duplicateEventCount,
    entityCount: data?.append?.entityCount,
    relationCount: data?.append?.relationCount,
    constraintCount: data?.append?.constraintCount,
    verificationOk: data?.verification?.ok === true,
    driftOk: data?.drift?.ok === true,
    reconcileOk: data?.reconcile?.ok === true,
    recommendedMode: data?.recommendedEnvironment?.ARCHCONTEXT_LEDGER_MODE,
    rollbackCommandTemplate: data?.rollback?.command
  };
}

function summarizePromotion(data: any) {
  return {
    status: data?.status,
    ready: data?.ready === true,
    targetMode: data?.targetMode,
    currentPhase: data?.current?.phase,
    readAuthority: data?.current?.readAuthority,
    writeAuthority: data?.current?.writeAuthority,
    ledgerGraphDigest: data?.current?.ledgerGraphDigest,
    yamlGraphDigest: data?.current?.yamlGraphDigest,
    reasonCodes: data?.reasonCodes ?? [],
    nextRequiredPhase: data?.nextRequiredPhase ?? null,
    rollbackCommandTemplate: data?.rollbackPlan?.commandTemplate,
    sideEffects: data?.sideEffects ?? {},
    boundary: data?.boundary ?? {}
  };
}

function summarizeDrift(data: any) {
  return {
    activePhase: data?.architectureLedger?.phaseFlags?.activePhase,
    readAuthority: data?.architectureLedger?.readAuthority,
    writeAuthority: data?.architectureLedger?.writeAuthority,
    ledgerGraphDigest: data?.ledger?.graphDigest,
    yamlGraphDigest: data?.yaml?.graphDigest,
    entityCount: data?.ledger?.entityCount,
    relationCount: data?.ledger?.relationCount,
    constraintCount: data?.ledger?.constraintCount,
    importedCount: data?.yaml?.importedCount,
    ignoredFileCount: data?.yaml?.ignoredFileCount,
    unsupportedFileCount: data?.yaml?.unsupportedFileCount,
    driftOk: data?.drift?.ok === true,
    semanticDrift: data?.drift?.semanticDrift === true,
    driftReasonCodes: data?.drift?.reasonCodes ?? [],
    reconcileOk: data?.reconcile?.ok === true,
    reconcileRequired: data?.reconcile?.reconcileRequired === true,
    reconcileReasonCodes: data?.reconcile?.reasonCodes ?? []
  };
}

function summarizeRollback(data: any) {
  return {
    sourceAuthority: data?.sourceAuthority,
    targetAuthority: data?.targetAuthority,
    dryRun: data?.dryRun === true,
    writes: data?.writes,
    backupRequired: data?.backup?.required === true,
    backupFileCount: data?.backup?.fileCount,
    backupDigest: data?.backup?.digest,
    projectedFileCount: data?.projectedFileCount,
    writtenPathCount: Array.isArray(data?.writtenPaths) ? data.writtenPaths.length : 0,
    removedPathCount: Array.isArray(data?.removedPaths) ? data.removedPaths.length : 0,
    graphDigest: data?.graphDigest,
    driftOk: data?.drift?.ok === true,
    reconcileOk: data?.reconcile?.ok === true,
    recommendedMode: data?.recommendedEnvironment?.ARCHCONTEXT_LEDGER_MODE
  };
}

function inspectRuntimeSqlite(env: Record<string, string | undefined>) {
  const paths = runCli(["paths", "--json"], env).data;
  const localStorePath = String(paths.localStorePath);
  return {
    path: "$ARCHCONTEXT_STATE_DIR/repositories/<repo>/worktrees/<workspace>/runtime.sqlite",
    source: paths.source,
    integrity: sqliteScalar(localStorePath, "PRAGMA integrity_check"),
    schemaMigrationCount: Number(sqliteScalar(localStorePath, "SELECT COUNT(*) FROM schema_migrations")),
    architectureEvents: Number(sqliteScalar(localStorePath, "SELECT COUNT(*) FROM architecture_events")),
    architectureEntitiesCurrent: Number(sqliteScalar(localStorePath, "SELECT COUNT(*) FROM architecture_entities_current")),
    architectureRelationsCurrent: Number(sqliteScalar(localStorePath, "SELECT COUNT(*) FROM architecture_relations_current")),
    architectureConstraintsCurrent: Number(sqliteScalar(localStorePath, "SELECT COUNT(*) FROM architecture_constraints_current"))
  };
}

function sqliteScalar(databasePath: string, sql: string): string {
  const result = spawnSync("sqlite3", [databasePath, sql], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`sqlite3 failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function runCli(args: string[], env: Record<string, string | undefined>) {
  const result = spawnSync("bun", ["packages/surfaces/cli/src/main.ts", ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`archctx ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout);
  if (parsed.ok !== true) throw new Error(`archctx ${args.join(" ")} returned not ok:\n${result.stdout}`);
  return parsed;
}

function stopDaemon(env: Record<string, string | undefined>): void {
  spawnSync("bun", ["packages/surfaces/cli/src/main.ts", "daemon", "stop"], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

function scanForbiddenKeys(value: unknown): string[] {
  return [...inspectObject(value)].sort();
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
  const inspected = inspectArchitectureLedgerAl10AuthorityReadback(packet);
  return [
    "# Architecture Ledger AL10 Local Authority Readback",
    "",
    `Status: ${inspected.status}`,
    "",
    "Scope: local runtime authority-mode readback using temporary runtime state. This verifies the mode chain and rollback dry-run; it does not enable production GA, hard enforcement, or persistent ledger-authoritative defaults.",
    "",
    "## Evidence",
    "",
    `- Migration: ${packet.migration?.status}, writes=${packet.migration?.writes}, appendedEvents=${packet.migration?.appendedEventCount}`,
    `- Runtime SQLite: integrity=${packet.sqlite?.integrity}, events=${packet.sqlite?.architectureEvents}, entities=${packet.sqlite?.architectureEntitiesCurrent}`,
    `- Dual mode: phase=${packet.dual?.status?.activePhase}, promotion=${packet.dual?.promotionPreflight?.status}, next=${packet.dual?.promotionPreflight?.nextRequiredPhase}`,
    `- Ledger shadow: phase=${packet.ledgerShadow?.status?.activePhase}, promotion=${packet.ledgerShadow?.promotionPreflight?.status}`,
    `- Authoritative: phase=${packet.authoritative?.status?.activePhase}, read=${packet.authoritative?.status?.readAuthority}, write=${packet.authoritative?.status?.writeAuthority}`,
    `- Authoritative drift: driftOk=${packet.authoritative?.drift?.driftOk}, reconcileOk=${packet.authoritative?.drift?.reconcileOk}, semanticDrift=${packet.authoritative?.drift?.semanticDrift}`,
    `- Authoritative rollback dry-run: writes=${packet.authoritative?.rollbackDryRun?.writes}, target=${packet.authoritative?.rollbackDryRun?.targetAuthority}`,
    "",
    "## Assertions",
    "",
    ...Object.entries(packet.assertions ?? {}).map(([key, value]) => `- ${key}: ${value ? "PASS" : "FAIL"}`),
    "",
    "## Boundary",
    "",
    "- No raw source bodies, raw diffs, prompts, completions, or rollback projected file bodies are persisted in this artifact.",
    "- `ledger-authoritative` is verified as an environment-mode readback only.",
    "- Production GA, hard enforcement, rollback-write drill, independent security review, and representative beta evidence remain explicit non-claims.",
    "",
    inspected.ok ? "VERIFIED: local architecture-ledger authority readback passes." : `FAILED:\n- ${inspected.failures.join("\n- ")}`
  ].join("\n");
}

function renderHuman(result: ReturnType<typeof inspectArchitectureLedgerAl10AuthorityReadback>): string {
  return result.ok
    ? "AL10 local authority readback verified\n"
    : `AL10 local authority readback failed:\n- ${result.failures.join("\n- ")}\n`;
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}
