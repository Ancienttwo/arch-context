#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import { architectureLedgerStateDigest, type ArchitectureLedgerScope } from "@archcontext/core/architecture-ledger";
import { digestJson, type ArchitectureEventV1, type Json } from "@archcontext/contracts";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { assertNoSourceStorageSchema, migrationSql, SqliteLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import { createStartedDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { McpLocalServer } from "@archcontext/surfaces/mcp-local";
import { runCli } from "@archcontext/surfaces/cli";

const ROOT = resolve(import.meta.dir, "..");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al10-hardening-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al10-hardening-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al10-hardening.md";
const GATES = ["AL10-07", "AL10-BETA-2", "AL10-BETA-3", "AL10-BETA-5", "AL10-BETA-6"] as const;
const STRESS_EVENT_COUNT = 1000;
const DEFAULT_HOOK_SAMPLE_COUNT = 9;
const RAW_SOURCE_SENTINEL = "AL10_HARDENING_RAW_SOURCE_SENTINEL_do_not_emit";
const FORBIDDEN_KEYS = new Set([
  "body",
  "sourceBody",
  "sourcebody",
  "sourceCode",
  "sourcecode",
  "rawSource",
  "rawsource",
  "rawDiff",
  "rawdiff",
  "diffBody",
  "diffbody",
  "patch",
  "prompt",
  "completion"
]);
const FORBIDDEN_TOKENS = [RAW_SOURCE_SENTINEL, "diff --git", "\"sourceCode\"", "\"rawDiff\"", "\"diffBody\""];

const LEDGER_SCOPE: ArchitectureLedgerScope = {
  repository: {
    repositoryId: "repo.al10-hardening",
    storageRepositoryId: "repo.storage.al10-hardening"
  },
  worktree: {
    workspaceId: "workspace.al10-hardening",
    storageWorkspaceId: "workspace.storage.al10-hardening",
    branch: "main",
    headSha: "abc123al10hardening",
    worktreeDigest: digestJson({ worktree: "al10-hardening" } as unknown as Json)
  }
};

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[architecture-ledger-al10-hardening-readback] usage: run|inspect [--out path] [--report path] [--evidence path] [--json]");
    process.exit(2);
  }
  const result = command === "run"
    ? await runArchitectureLedgerAl10HardeningReadback({
        outPath: readFlag(args, "--out") ?? DEFAULT_OUT,
        reportPath: readFlag(args, "--report") ?? DEFAULT_REPORT
      })
    : inspectArchitectureLedgerAl10HardeningReadback(
        JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
      );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export async function runArchitectureLedgerAl10HardeningReadback({
  outPath = DEFAULT_OUT,
  reportPath = DEFAULT_REPORT
} = {}) {
  const packet = await buildArchitectureLedgerAl10HardeningPacket();
  const inspected = inspectArchitectureLedgerAl10HardeningReadback(packet);
  const finalPacket = {
    ...packet,
    status: inspected.ok ? "verified" : "failed",
    failures: inspected.failures
  };
  writeJson(outPath, finalPacket);
  writeText(reportPath, renderReport(finalPacket));
  return inspectArchitectureLedgerAl10HardeningReadback(finalPacket);
}

export async function buildArchitectureLedgerAl10HardeningPacket() {
  const stress = await runLedgerStressProbe();
  const defaultHook = await runDefaultHookSpawnProbe();
  const rollback = await runFullRollbackProbe();
  const mcp = await runMcpPrivacyProbe();
  const privacy = inspectPrivacySurfaces({ stress, defaultHook, rollback, mcp });
  const assertions = {
    "AL10-07": privacy.sqlite.clean
      && privacy.cli.clean
      && privacy.mcp.clean
      && privacy.logs.clean
      && privacy.agentJobs.clean,
    "AL10-BETA-2": stress.eventCount === STRESS_EVENT_COUNT
      && stress.appendedEventCount === STRESS_EVENT_COUNT
      && stress.replayEventCount === STRESS_EVENT_COUNT
      && stress.uniqueEventIds === STRESS_EVENT_COUNT
      && stress.duplicateAppendCount === 1
      && stress.integrityOk
      && stress.faultRollbackOk,
    "AL10-BETA-3": privacy.overallClean,
    "AL10-BETA-5": defaultHook.sampleCount === DEFAULT_HOOK_SAMPLE_COUNT
      && defaultHook.medianSpawnCount === 0
      && defaultHook.totalSpawnedJobs === 0
      && defaultHook.defaultHookAllZeroSpawn,
    "AL10-BETA-6": rollback.fullRollbackToYaml
      && rollback.rollbackBackupCreated
      && rollback.rollbackCommandPresent
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(0).toISOString(),
    gates: [...GATES],
    thresholds: {
      stressEventCount: STRESS_EVENT_COUNT,
      defaultHookSampleCount: DEFAULT_HOOK_SAMPLE_COUNT,
      medianDefaultSpawnCount: 0
    },
    stress,
    defaultHook: sanitizeDefaultHookProbe(defaultHook),
    rollback,
    privacy,
    assertions,
    readback: {
      command: `bun scripts/architecture-ledger-al10-hardening-readback.ts inspect --evidence ${DEFAULT_OUT} --json`,
      reportPath: DEFAULT_REPORT
    },
    failures: [] as string[]
  };
}

export function inspectArchitectureLedgerAl10HardeningReadback(packet: any) {
  const failures: string[] = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return { ok: false, status: "failed", failures: ["packet must be an object"], gates: {} };
  }
  if (packet.schemaVersion !== SCHEMA_VERSION) failures.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (packet.status !== undefined && packet.status !== "verified") failures.push("status must be verified");
  if (packet.thresholds?.stressEventCount !== STRESS_EVENT_COUNT) failures.push("stress event count threshold mismatch");
  if (packet.thresholds?.defaultHookSampleCount !== DEFAULT_HOOK_SAMPLE_COUNT) failures.push("default hook sample count mismatch");

  const stress = packet.stress ?? {};
  if (stress.eventCount !== STRESS_EVENT_COUNT) failures.push("stress event count must be 1000");
  if (stress.appendedEventCount !== STRESS_EVENT_COUNT) failures.push("stress appended event count must be 1000");
  if (stress.replayEventCount !== STRESS_EVENT_COUNT) failures.push("stress replay event count must be 1000");
  if (stress.uniqueEventIds !== STRESS_EVENT_COUNT) failures.push("stress unique event ids must be 1000");
  if (stress.duplicateAppendCount !== 1) failures.push("stress duplicate append count must be 1");
  if (stress.integrityOk !== true) failures.push("stress integrity must be ok");
  if (stress.faultRollbackOk !== true) failures.push("stress fault rollback must leave no partial materialization");

  const defaultHook = packet.defaultHook ?? {};
  if (defaultHook.sampleCount !== DEFAULT_HOOK_SAMPLE_COUNT) failures.push("default hook sample count must be 9");
  if (defaultHook.medianSpawnCount !== 0) failures.push("default hook median spawn count must be 0");
  if (defaultHook.totalSpawnedJobs !== 0) failures.push("default hook total spawned jobs must be 0");
  if (defaultHook.defaultHookAllZeroSpawn !== true) failures.push("default hook samples must all produce zero spawned jobs");
  if (defaultHook.explicitHighRiskEnqueued !== true) failures.push("explicit high-risk hook must enqueue one audited job");

  const privacy = packet.privacy ?? {};
  for (const surface of ["sqlite", "cli", "mcp", "logs", "agentJobs"]) {
    if (privacy?.[surface]?.clean !== true) failures.push(`privacy ${surface} surface must be clean`);
  }
  if (privacy.overallClean !== true) failures.push("privacy overallClean must be true");
  if (privacy.forbiddenKeyHits?.length > 0) failures.push(`privacy forbidden keys present: ${privacy.forbiddenKeyHits.join(",")}`);
  if (privacy.forbiddenTokenHits?.length > 0) failures.push(`privacy forbidden tokens present: ${privacy.forbiddenTokenHits.join(",")}`);

  const rollback = packet.rollback ?? {};
  if (rollback.fullRollbackToYaml !== true) failures.push("rollback must restore YAML authority");
  if (rollback.rollbackBackupCreated !== true) failures.push("rollback backup must be created");
  if (rollback.rollbackCommandPresent !== true) failures.push("rollback command must be present");

  for (const gate of GATES) {
    if (packet.assertions?.[gate] !== true) failures.push(`${gate} assertion failed`);
  }
  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? "verified" : "failed",
    failures,
    gates: Object.fromEntries(GATES.map((gate) => [gate, packet.assertions?.[gate] === true ? "verified" : "blocked"])),
    stress,
    defaultHook,
    rollback,
    privacy
  };
}

async function runLedgerStressProbe() {
  const root = mkdtempSync(join(tmpdir(), "archctx-al10-ledger-stress-"));
  const databasePath = join(root, "runtime.sqlite");
  const backupPath = join(root, "ledger-backup.sqlite");
  const store = new SqliteLocalStore(databasePath);
  try {
    await store.migrate();
    assertNoSourceStorageSchema(migrationSql());
    const events = Array.from({ length: STRESS_EVENT_COUNT }, (_, index) => architectureLedgerEvent(index));
    const append = await store.appendArchitectureEvents({ writer: "runtime-daemon", events });
    const duplicate = await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [events[0]!] });
    const replay = await store.replayArchitectureLedger(LEDGER_SCOPE);
    const integrity = await store.checkArchitectureLedgerIntegrity(LEDGER_SCOPE);
    await store.backupArchitectureLedger({ backupPath });

    const faultStore = new SqliteLocalStore(join(root, "fault-runtime.sqlite"));
    await faultStore.migrate();
    let faultRejected = false;
    try {
      await faultStore.appendArchitectureEvents({
        writer: "runtime-daemon",
        events: [architectureLedgerEvent(10_000), architectureLedgerEvent(10_001)],
        faultAfterEvents: 1
      });
    } catch (error) {
      faultRejected = error instanceof Error && error.message.includes("architecture-ledger-fault-injection");
    }
    const faultReplay = await faultStore.replayArchitectureLedger(LEDGER_SCOPE);
    faultStore.close();
    store.close();

    return {
      databasePath: redactTempPath(databasePath),
      eventCount: STRESS_EVENT_COUNT,
      appendedEventCount: append.appendedEvents.length,
      duplicateAppendCount: duplicate.duplicateEvents.length,
      replayEventCount: replay.events.length,
      uniqueEventIds: new Set(replay.events.map((event) => event.eventId)).size,
      entityCount: replay.state.entities.length,
      relationCount: replay.state.relations.length,
      constraintCount: replay.state.constraints.length,
      graphDigest: replay.graphDigest,
      materializedDigest: architectureLedgerStateDigest(replay.state),
      integrityOk: integrity.ok === true && integrity.eventCount === STRESS_EVENT_COUNT && integrity.failures.length === 0,
      backupIntegrityOk: sqliteScalar(backupPath, "PRAGMA integrity_check") === "ok",
      sqliteEventRows: sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_events"),
      sqliteCurrentRows: sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_current_graph_view"),
      ftsRows: sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_ledger_search_fts"),
      schemaGuardNoRawColumns: true,
      faultRejected,
      faultRollbackOk: faultRejected
        && faultReplay.events.length === 0
        && faultReplay.state.entities.length === 0
        && sqliteScalar(join(root, "fault-runtime.sqlite"), "SELECT COUNT(*) FROM architecture_events") === 0,
      sqliteScan: scanSqliteText(databasePath)
    };
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}

async function runDefaultHookSpawnProbe() {
  const root = mkdtempSync(join(tmpdir(), "archctx-al10-default-hook-"));
  let daemon: Awaited<ReturnType<typeof createStartedDaemon>> | undefined;
  try {
    createGitRepository(root);
    daemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: new TestLocalStore(),
      clock: () => "2026-06-26T12:00:00.000Z"
    });
    await daemon.init(root, "AL10 Default Hook");
    const samples = [];
    const rawCliOutputs: any[] = [];
    for (let index = 0; index < DEFAULT_HOOK_SAMPLE_COUNT; index += 1) {
      const relativePath = `src/default-${index}.ts`;
      writeRepoFile(root, relativePath, `export const value${index} = "${RAW_SOURCE_SENTINEL}";\n`);
      const before = (await daemon.jobsList(root)).data as any;
      const output = await runCli("hook", ["enqueue", "--event", "post-edit", "--path", relativePath], root, { runtimeClient: daemon as any });
      rawCliOutputs.push(output);
      const after = (await daemon.jobsList(root)).data as any;
      const beforeCount = Array.isArray(before?.jobs) ? before.jobs.length : 0;
      const afterCount = Array.isArray(after?.jobs) ? after.jobs.length : 0;
      samples.push({
        index,
        requestId: output.requestId,
        schemaVersion: (output.data as any)?.schemaVersion,
        reasonCode: (output.data as any)?.reasonCode,
        failOpen: (output.data as any)?.failOpen === true,
        enqueued: (output.data as any)?.enqueued === true,
        spawnedJobs: Math.max(0, afterCount - beforeCount),
        messageDigest: digestJson({ message: (output.data as any)?.message ?? "" } as unknown as Json),
        output: summarizeEnvelope(output)
      });
    }

    writeRepoFile(root, "src/high-risk.ts", `export const highRisk = "${RAW_SOURCE_SENTINEL}";\n`);
    const explicit = await runCli("hook", [
      "enqueue",
      "--event", "post-edit",
      "--path", "src/high-risk.ts",
      "--risk", "high",
      "--uncertainty", "high",
      "--policy-requested",
      "--max-queued-jobs", "8",
      "--priority", "10"
    ], root, { runtimeClient: daemon as any });
    rawCliOutputs.push(explicit);
    const explicitJobs = ((await daemon.jobsList(root)).data as any)?.jobs ?? [];
    const stats = (await daemon.jobsStats(root, { now: "2026-06-26T12:01:00.000Z" })).data as any;
    const spawnCounts = samples.map((sample) => sample.spawnedJobs).sort((left, right) => left - right);
    const medianSpawnCount = spawnCounts[Math.floor(spawnCounts.length / 2)] ?? Number.NaN;
    return {
      sampleCount: samples.length,
      samples,
      medianSpawnCount,
      totalSpawnedJobs: samples.reduce((sum, sample) => sum + sample.spawnedJobs, 0),
      defaultHookAllZeroSpawn: samples.every((sample) => sample.spawnedJobs === 0 && sample.enqueued === false),
      defaultHookFailOpenCount: samples.filter((sample) => sample.failOpen).length,
      explicitHighRiskEnqueued: explicit.ok === true && (explicit.data as any)?.enqueued === true,
      explicitHighRiskJobCount: explicitJobs.length,
      explicitHighRiskJobDigest: digestJson(explicitJobs as unknown as Json),
      explicitHighRiskJobPayloads: explicitJobs,
      rawCliAudit: scanSurface("cli", rawCliOutputs),
      rawAgentJobPayloadAudit: scanSurface("agentJobs", explicitJobs),
      queueStats: {
        queuedDepth: stats?.queuedDepth,
        runningDepth: stats?.runningDepth,
        totalJobCount: stats?.totalJobCount,
        coalescedJobCount: stats?.coalescedJobCount
      },
      cliOutputs: [...samples.map((sample) => sample.output), summarizeEnvelope(explicit)],
      logs: samples
        .map((sample) => sample.output?.data?.hookLog)
        .filter(Boolean)
    };
  } finally {
    await daemon?.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

async function runFullRollbackProbe() {
  const root = mkdtempSync(join(tmpdir(), "archctx-al10-full-rollback-"));
  let daemon: Awaited<ReturnType<typeof createStartedDaemon>> | undefined;
  try {
    createGitRepository(root);
    daemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: new TestLocalStore(),
      architectureLedger: { rolloutMode: "yaml" },
      clock: () => "2026-06-26T12:00:00.000Z"
    });
    await daemon.init(root, "AL10 Rollback");
    git(root, "add", ".");
    git(root, "commit", "-m", "initialize archcontext model");
    const status = await daemon.runtimeStatus(root);
    const migrate = await daemon.ledgerMigrate(root, {
      fromYaml: true,
      dryRun: false,
      expectedWorktreeDigest: (status.data as any)?.worktreeDigest
    });
    const rollbackStatus = await daemon.runtimeStatus(root);
    const rollback = await daemon.ledgerRollback(root, {
      toYaml: true,
      dryRun: false,
      expectedWorktreeDigest: (rollbackStatus.data as any)?.worktreeDigest
    });
    const migratedData = migrate.data as any;
    const rollbackData = rollback.data as any;
    return {
      migrateVerified: migrate.ok === true && migratedData?.status === "verified",
      migrateRecommendedMode: migratedData?.recommendedEnvironment?.ARCHCONTEXT_LEDGER_MODE,
      rollbackOk: rollback.ok === true,
      targetAuthority: rollbackData?.targetAuthority,
      rollbackRecommendedMode: rollbackData?.recommendedEnvironment?.ARCHCONTEXT_LEDGER_MODE,
      fullRollbackToYaml:
        rollback.ok === true
        && rollbackData?.targetAuthority === "yaml"
        && rollbackData?.recommendedEnvironment?.ARCHCONTEXT_LEDGER_MODE === "yaml",
      rollbackBackupCreated: existsSync(rollbackData?.backup?.manifestPath ? resolve(root, rollbackData.backup.manifestPath) : ""),
      rollbackCommandPresent: typeof migratedData?.rollback?.command === "string"
        && migratedData.rollback.command.includes("ledger rollback --to-yaml --write"),
      worktreeDigestAfterRollback: computeWorktreeDigest(root),
      outputs: [summarizeEnvelope(migrate), summarizeEnvelope(rollback)]
    };
  } finally {
    await daemon?.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

function inspectPrivacySurfaces(input: { stress: any; defaultHook: any; rollback: any; mcp: any }) {
  const sqliteValues = {
    schemaGuardNoRawColumns: input.stress.schemaGuardNoRawColumns,
    sqliteScan: input.stress.sqliteScan
  };
  const cliValues = {
    defaultHookOutputs: input.defaultHook.cliOutputs,
    rollbackOutputs: input.rollback.outputs
  };
  const mcpValues = input.mcp;
  const logsValues = input.defaultHook.logs;
  const agentJobValues = input.defaultHook.explicitHighRiskJobPayloads;
  const surfaces = {
    sqlite: scanSurface("sqlite", sqliteValues),
    cli: input.defaultHook.rawCliAudit ?? scanSurface("cli", cliValues),
    mcp: scanSurface("mcp", mcpValues),
    logs: scanSurface("logs", logsValues),
    agentJobs: input.defaultHook.rawAgentJobPayloadAudit ?? scanSurface("agentJobs", agentJobValues)
  };
  const forbiddenKeyHits = Object.values(surfaces).flatMap((surface) => surface.forbiddenKeyHits);
  const forbiddenTokenHits = Object.values(surfaces).flatMap((surface) => surface.forbiddenTokenHits);
  const overallClean = Object.values(surfaces).every((surface) => surface.clean);
  return {
    ...surfaces,
    forbiddenKeyHits,
    forbiddenTokenHits,
    overallClean,
    noRawSourceSentinel: !forbiddenTokenHits.some((hit) => hit.includes(RAW_SOURCE_SENTINEL)),
    scannedSurfaceCount: Object.keys(surfaces).length
  };
}

async function runMcpPrivacyProbe() {
  const root = mkdtempSync(join(tmpdir(), "archctx-al10-mcp-privacy-"));
  let daemon: Awaited<ReturnType<typeof createStartedDaemon>> | undefined;
  try {
    createGitRepository(root);
    daemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: new TestLocalStore(),
      clock: () => "2026-06-26T12:00:00.000Z"
    });
    await daemon.init(root, "AL10 MCP Privacy");
    writeRepoFile(root, "src/mcp-privacy.ts", `export const mcpPrivacy = "${RAW_SOURCE_SENTINEL}";\n`);
    const server = new McpLocalServer(daemon);
    const prepare = await readMcpToolEnvelope(server, await server.callTool("archcontext_prepare_task", {
      root,
      task: "AL10 MCP privacy source sentinel must stay out of tool output",
      maxBytes: 2048,
      maxItems: 6,
      taskSessionId: "task_al10_mcp_privacy"
    }), root);
    const checkpoint = await readMcpToolEnvelope(server, await server.callTool("archcontext_checkpoint", {
      root,
      taskSessionId: "task_al10_mcp_privacy",
      task: "AL10 MCP privacy source sentinel must stay out of tool output",
      event: "manual",
      changedPaths: ["src/mcp-privacy.ts"],
      maxBytes: 2048,
      maxItems: 6
    }), root);
    const complete = await readMcpToolEnvelope(server, await server.callTool("archcontext_complete_task", {
      root,
      taskSessionId: "task_al10_mcp_privacy",
      task: "AL10 MCP privacy source sentinel must stay out of tool output"
    }), root);
    return {
      prepare: summarizeEnvelope(prepare),
      checkpoint: summarizeEnvelope(checkpoint),
      complete: summarizeEnvelope(complete)
    };
  } finally {
    await daemon?.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

async function readMcpToolEnvelope(server: McpLocalServer, result: { content: any; resourceUri?: string }, root: string) {
  if (result.resourceUri) return await server.readResource(result.resourceUri, root);
  return result.content;
}

function scanSurface(surface: string, value: unknown) {
  const forbiddenKeyHits = findForbiddenKeys(value).map((path) => `${surface}:${path}`);
  const forbiddenTokenHits = findForbiddenTokens(value).map((token) => `${surface}:${token}`);
  return {
    clean: forbiddenKeyHits.length === 0 && forbiddenTokenHits.length === 0,
    forbiddenKeyHits,
    forbiddenTokenHits,
    digest: digestJson(value as unknown as Json)
  };
}

function findForbiddenKeys(value: unknown, path = "$", hits: string[] = []): string[] {
  if (!value || typeof value !== "object") return hits;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findForbiddenKeys(entry, `${path}[${index}]`, hits));
    return hits;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key) || FORBIDDEN_KEYS.has(key.replace(/[-_]/g, "").toLowerCase())) hits.push(`${path}.${key}`);
    findForbiddenKeys(child, `${path}.${key}`, hits);
  }
  return hits;
}

function findForbiddenTokens(value: unknown): string[] {
  const encoded = JSON.stringify(value);
  return FORBIDDEN_TOKENS.filter((token) => encoded.includes(token));
}

function scanSqliteText(databasePath: string) {
  const db = new Database(databasePath, { readonly: true });
  try {
    const schema = db.query("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL").all();
    const eventRows = db.query("SELECT event_json, payload_json, provenance_json FROM architecture_events").all();
    const operations = db.query("SELECT * FROM architecture_ledger_operations").all();
    return {
      schemaDigest: digestJson(schema as unknown as Json),
      eventRowsDigest: digestJson(eventRows as unknown as Json),
      operationRowsDigest: digestJson(operations as unknown as Json),
      scannedEventRows: eventRows.length,
      forbiddenSchemaKeys: findForbiddenKeys(schema),
      forbiddenSchemaTokens: findForbiddenTokens(schema),
      forbiddenEventTokens: findForbiddenTokens(eventRows),
      forbiddenOperationTokens: findForbiddenTokens(operations)
    };
  } finally {
    db.close();
  }
}

function sqliteScalar(databasePath: string, sql: string): any {
  const db = new Database(databasePath, { readonly: true });
  try {
    const row = db.query(sql).get() as Record<string, unknown> | undefined;
    return row ? Object.values(row)[0] : undefined;
  } finally {
    db.close();
  }
}

function architectureLedgerEvent(index: number): ArchitectureEventV1 {
  const operations: Record<string, Json>[] = [{
    op: "upsert_entity",
    entity: {
      entityId: `entity.al10.${index}`,
      kind: "module",
      canonicalName: index === 0 ? "AL10 root module" : `AL10 module ${index}`,
      status: "active",
      path: `src/al10/module-${index}.ts`,
      summary: index === 0 ? "AL10 root architecture entrypoint" : `AL10 module ${index} summary`,
      metadata: { index }
    }
  }];
  if (index === 1) {
    operations.push(
      {
        op: "upsert_relation",
        relation: {
          relationId: "relation.al10-root-to-worker",
          kind: "calls",
          sourceEntityId: "entity.al10.0",
          targetEntityId: "entity.al10.1",
          status: "active",
          summary: "AL10 root delegates to worker",
          metadata: { route: "stress" }
        }
      },
      {
        op: "upsert_constraint",
        constraint: {
          constraintId: "constraint.al10-root-owned",
          kind: "ownership",
          subjectId: "entity.al10.0",
          status: "active",
          severity: "warning",
          summary: "AL10 root module has an explicit owner",
          metadata: { owner: "runtime" }
        }
      }
    );
  }
  const provenance = {
    producer: "architecture-ledger-al10-hardening-readback",
    command: "bun scripts/architecture-ledger-al10-hardening-readback.ts run",
    inputDigest: digestJson({ event: index } as unknown as Json)
  };
  const payload: Record<string, Json> = {
    summary: index === 0 ? "Append AL10 root architecture fact" : `Append AL10 architecture fact ${index}`,
    title: index === 0 ? "AL10 Root Architecture Decision" : `AL10 Architecture Event ${index}`,
    rationale: "Exercise append-only ledger stress without storing source bodies.",
    operations
  };
  return {
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: `architecture_event.al10.${String(index).padStart(4, "0")}`,
    eventType: "architecture.graph.update",
    payloadVersion: "archcontext.architecture-ledger-payload/v1",
    repository: LEDGER_SCOPE.repository,
    worktree: LEDGER_SCOPE.worktree,
    baseDigest: digestJson({ base: index } as unknown as Json),
    resultingDigest: digestJson({ result: index } as unknown as Json),
    headSha: LEDGER_SCOPE.worktree.headSha,
    actor: { kind: "daemon", id: "archctxd" },
    source: "checkpoint",
    timestamp: `2026-06-26T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
    idempotencyKey: `architecture-ledger-al10-hardening-${index}`,
    provenance,
    payload: payload as unknown as Json
  };
}

function summarizeEnvelope(envelope: any): any {
  return {
    ok: envelope?.ok === true,
    requestId: envelope?.requestId,
    schemaVersion: envelope?.schemaVersion ?? envelope?.data?.schemaVersion,
    data: summarizeValue(envelope?.data ?? envelope?.resource ?? envelope?.content ?? envelope)
  };
}

function summarizeValue(value: any): any {
  if (typeof value === "string") return redactLocalPath(value);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 5).map(summarizeValue);
  const result: Record<string, Json> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "jobs" && Array.isArray(child)) {
      result.jobCount = child.length;
      result.jobDigests = child.map((job) => digestJson(job as unknown as Json));
      continue;
    }
    if (key === "record" && typeof child === "object" && child !== null) {
      result.recordDigest = digestJson(child as unknown as Json);
      result.recordSummary = summarizeRecord(child);
      continue;
    }
    if (key === "context" || key === "matches" || key === "state" || key === "events") {
      result[`${key}Digest`] = digestJson(child as unknown as Json);
      continue;
    }
    if (typeof child === "object" && child !== null) result[key] = summarizeValue(child) as Json;
    else if (typeof child === "string") result[key] = redactLocalPath(child) as Json;
    else result[key] = child as Json;
  }
  return result;
}

function sanitizeDefaultHookProbe(probe: any): any {
  const { explicitHighRiskJobPayloads: _payloads, ...rest } = probe;
  return {
    ...rest,
    explicitHighRiskJobPayloadAudit: {
      scanned: true,
      count: Array.isArray(_payloads) ? _payloads.length : 0,
      digest: probe.explicitHighRiskJobDigest
    }
  };
}

function summarizeRecord(value: any): Json {
  return {
    schemaVersion: value?.job?.schemaVersion ?? value?.schemaVersion,
    status: value?.job?.status,
    analysisKind: value?.analysisKind,
    priority: value?.priority,
    attemptCount: value?.attemptCount,
    jobDigest: value?.job ? digestJson(value.job as unknown as Json) : undefined,
    coalesceDigest: typeof value?.coalesceKey === "string"
      ? digestJson({ coalesceKey: value.coalesceKey } as unknown as Json)
      : undefined
  } as Json;
}

function createGitRepository(root: string): void {
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# AL10 hardening fixture\n", "utf8");
  git(root, "init");
  git(root, "config", "user.email", "archcontext@example.test");
  git(root, "config", "user.name", "ArchContext Test");
  git(root, "add", ".");
  git(root, "commit", "-m", "fixture");
}

function writeRepoFile(root: string, relativePath: string, value: string): void {
  const absolute = join(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
}

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function redactTempPath(path: string): string {
  return redactLocalPath(path);
}

function redactLocalPath(value: string): string {
  return value
    .replaceAll(tmpdir(), "$TMPDIR")
    .replaceAll(homedir(), "$HOME");
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
  const inspected = inspectArchitectureLedgerAl10HardeningReadback(packet);
  return [
    "# AL10 Hardening Readback",
    "",
    `Status: ${inspected.status}`,
    "",
    "## Gates",
    ...GATES.map((gate) => `- ${gate}: ${packet.assertions?.[gate] ? "PASS" : "FAIL"}`),
    "",
    "## Stress",
    `- Event count: ${packet.stress?.eventCount}`,
    `- Appended events: ${packet.stress?.appendedEventCount}`,
    `- Replayed events: ${packet.stress?.replayEventCount}`,
    `- Unique event ids: ${packet.stress?.uniqueEventIds}`,
    `- Duplicate append count: ${packet.stress?.duplicateAppendCount}`,
    `- Fault rollback clean: ${packet.stress?.faultRollbackOk}`,
    "",
    "## Default Hook Spawn Probe",
    `- Samples: ${packet.defaultHook?.sampleCount}`,
    `- Median spawned jobs: ${packet.defaultHook?.medianSpawnCount}`,
    `- Total spawned jobs: ${packet.defaultHook?.totalSpawnedJobs}`,
    `- Explicit high-risk job enqueued for payload audit: ${packet.defaultHook?.explicitHighRiskEnqueued}`,
    "",
    "## Privacy",
    `- SQLite clean: ${packet.privacy?.sqlite?.clean}`,
    `- CLI clean: ${packet.privacy?.cli?.clean}`,
    `- MCP clean: ${packet.privacy?.mcp?.clean}`,
    `- Logs clean: ${packet.privacy?.logs?.clean}`,
    `- Agent job payloads clean: ${packet.privacy?.agentJobs?.clean}`,
    "",
    "## Rollback",
    `- Full rollback to YAML: ${packet.rollback?.fullRollbackToYaml}`,
    `- Rollback backup created: ${packet.rollback?.rollbackBackupCreated}`,
    `- Rollback command present: ${packet.rollback?.rollbackCommandPresent}`,
    "",
    inspected.ok ? "VERIFIED: AL10 hardening gates pass." : `FAILED:\n- ${inspected.failures.join("\n- ")}`
  ].join("\n");
}

function renderHuman(result: ReturnType<typeof inspectArchitectureLedgerAl10HardeningReadback>): string {
  return result.ok
    ? "AL10 hardening readback verified\n"
    : `AL10 hardening readback failed:\n- ${result.failures.join("\n- ")}\n`;
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}
