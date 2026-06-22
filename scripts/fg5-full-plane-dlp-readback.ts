#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { CHECK_DELIVERY_QUEUE_MESSAGE_SCHEMA_VERSION, ControlPlane } from "@archcontext/cloud/control-plane";
import { assertD1PrivacySchema, checkDeliveryIdempotencyKey, d1MigrationSql, persistAcceptedAttestationSubmission, type AcceptedAttestationPersistenceRow, type PendingCheckDeliveryPersistenceRow } from "@archcontext/cloud/cloud-db";

const DEFAULT_OUTPUT = "docs/verification/fg5-full-plane-dlp-readback.json";
const BAIT_FIXTURE = "docs/security/fixtures/cloud-private-content-bait.json";
const REQUIRED_SURFACES = ["database", "log", "trace", "queue"] as const;
const CODE_CONTENT_PATTERNS = [
  /"sourceCode"\s*:/i,
  /"source"\s*:/i,
  /"diff"\s*:/i,
  /"patch"\s*:/i,
  /"fileBody"\s*:/i,
  /"sourceBody"\s*:/i,
  /"diffBody"\s*:/i,
  /"symbolPayload"\s*:/i,
  /"modelBody"\s*:/i,
  /"finding"\s*:/i,
  /"findingDetail"\s*:/i,
  /source\s+code/i,
  /diff\s+--git/i,
  /^@@\s/m
] as const;
const SECRET_PATTERNS = [
  /gh[opsu]_[A-Za-z0-9_]+/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /GITHUB_WEBHOOK_SECRET/i,
  /installation[_-]?token/i,
  /privateKey/i
] as const;
const FORBIDDEN_ENDPOINT_OR_MEDIA = [
  /\/contents(?:\/|\b)/i,
  /\/git\/blobs(?:\/|\b)/i,
  /\/git\/trees(?:\/|\b)/i,
  /\/pulls\/\d+\/files/i,
  /application\/vnd\.github\.(?:v3\.)?(?:diff|patch)/i
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildFg5FullPlaneDlpConfig(process.env, args);
    const result = await runFg5FullPlaneDlp(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg5FullPlaneDlp(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg5-full-plane-dlp-readback] usage: run|inspect [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg5FullPlaneDlpConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG5_FULL_PLANE_DLP_OUTPUT ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    now: readFlag(args, "--now") ?? "2026-06-21T19:00:00.000Z",
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg5FullPlaneDlp(config: ReturnType<typeof buildFg5FullPlaneDlpConfig>) {
  const bait = JSON.parse(await readFile(resolve(config.root, BAIT_FIXTURE), "utf8")) as { payload: Record<string, string> };
  const baitNeedles = Object.values(bait.payload);
  const baitKeys = Object.keys(bait.payload);
  const database = buildDatabaseExport(config.now);
  const dtoExports = buildDtoExports(bait.payload);
  const scans = {
    database: scanSurface("database", database, baitKeys, baitNeedles),
    log: scanSurface("log", dtoExports.log, baitKeys, baitNeedles),
    trace: scanSurface("trace", dtoExports.trace, baitKeys, baitNeedles),
    queue: scanSurface("queue", dtoExports.queue, baitKeys, baitNeedles),
    error: scanSurface("error", dtoExports.error, baitKeys, baitNeedles)
  };
  const failures = dlpFailures(scans);
  if (!database.schemaPrivacyOk) failures.push("database schema privacy assertion must pass");
  if (database.tableCount < 13) failures.push("database export must include all control-plane tables");
  if (database.rowCount < 10) failures.push("database export must include representative rows");
  if (!dtoExports.queueHasCheckDeliveryMessage) failures.push("queue export must include Check delivery queue message");

  const recording = {
    schemaVersion: "archcontext.fg5-full-plane-dlp-readback/v1",
    environment: "local-full-plane",
    status: failures.length === 0 ? "verified" : "failed",
    ok: failures.length === 0,
    generatedAt: config.generatedAt(),
    config: {
      output: config.outputPath,
      now: config.now,
      baitFixture: BAIT_FIXTURE,
      baitNeedleCount: baitNeedles.length
    },
    evidence: {
      database: {
        schemaPrivacyOk: database.schemaPrivacyOk,
        tableCount: database.tableCount,
        rowCount: database.rowCount,
        tables: database.tables.map((table) => ({ name: table.name, rowCount: table.rows.length }))
      },
      exports: {
        logRecordCount: dtoExports.log.length,
        traceRecordCount: dtoExports.trace.length,
        queueRecordCount: dtoExports.queue.length,
        errorRecordCount: dtoExports.error.length,
        queueHasCheckDeliveryMessage: dtoExports.queueHasCheckDeliveryMessage
      },
      scans
    },
    failures
  };
  const inspection = inspectFg5FullPlaneDlp(recording);
  recording.status = inspection.ok ? "verified" : "failed";
  recording.ok = inspection.ok;
  recording.failures = inspection.failures;
  await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
  await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(recording, null, 2)}\n`, "utf8");
  return recording;
}

export function inspectFg5FullPlaneDlp(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const database = readRecord(evidence.database);
  const exports = readRecord(evidence.exports);
  const scans = readRecord(evidence.scans);
  if (record.schemaVersion !== "archcontext.fg5-full-plane-dlp-readback/v1") failures.push("schemaVersion mismatch");
  if (record.environment !== "local-full-plane") failures.push("environment must be local-full-plane");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  if (database.schemaPrivacyOk !== true) failures.push("database.schemaPrivacyOk must be true");
  if (Number(database.tableCount) < 13) failures.push("database.tableCount must cover control-plane tables");
  if (Number(database.rowCount) < 10) failures.push("database.rowCount must include representative rows");
  if (exports.queueHasCheckDeliveryMessage !== true) failures.push("queue export must include Check delivery message");
  for (const surface of REQUIRED_SURFACES) {
    const scan = readRecord(scans[surface]);
    if (scan.surface !== surface) failures.push(`${surface}.surface mismatch`);
    if (Number(scan.exportedRecordCount) <= 0) failures.push(`${surface}.exportedRecordCount must be positive`);
    for (const key of ["codeContentMatches", "baitValueMatches", "forbiddenKeyMatches", "forbiddenEndpointOrMediaMatches", "secretMatches"]) {
      if (Number(scan[key]) !== 0) failures.push(`${surface}.${key} must be 0`);
    }
  }
  const errorScan = readRecord(scans.error);
  for (const key of ["codeContentMatches", "baitValueMatches", "forbiddenKeyMatches", "forbiddenEndpointOrMediaMatches", "secretMatches"]) {
    if (Number(errorScan[key]) !== 0) failures.push(`error.${key} must be 0`);
  }
  const serialized = JSON.stringify(recording);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden secret marker: ${pattern}`);
  }
  return { ok: failures.length === 0, failures };
}

function buildDatabaseExport(now: string) {
  assertD1PrivacySchema();
  const db = new Database(":memory:");
  try {
    db.exec(d1MigrationSql());
    seedDatabase(db, now);
    const tableNames = (db.query("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
    const tables = tableNames.map((name) => {
      const rows = db.query(`SELECT * FROM ${quoteIdent(name)} ORDER BY 1`).all() as Record<string, unknown>[];
      return { name, rows };
    });
    return {
      schemaPrivacyOk: true,
      tableCount: tables.length,
      rowCount: tables.reduce((sum, table) => sum + table.rows.length, 0),
      tables
    };
  } finally {
    db.close();
  }
}

function seedDatabase(db: Database, now: string): void {
  const headSha = "a".repeat(40);
  const baseSha = "b".repeat(40);
  const mergeBaseSha = "c".repeat(40);
  const treeOid = "d".repeat(40);
  const challengeId = "chal_fg5_full_plane_dlp";
  const nonceHash = digest("1");
  db.query("INSERT INTO accounts (id, github_user_id, created_at) VALUES (?, ?, ?)").run("acct_fg5_dlp", "10001", now);
  db.query("INSERT INTO subscriptions (id, account_id, stripe_customer_id, status, plan, billing_interval, current_period_end, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("sub_fg5_dlp", "acct_fg5_dlp", "cus_fg5_dlp", "active", "team", "annual", "2027-06-21T19:00:00.000Z", now);
  db.query("INSERT INTO github_installations (installation_id, account_id, repository_selection, created_at) VALUES (?, ?, ?, ?)").run("10001", "acct_fg5_dlp", "selected", now);
  db.query("INSERT INTO device_identities (device_id, account_id, public_key_id, public_key_fingerprint, status, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("dev_fg5_dlp", "acct_fg5_dlp", "devkey_fg5_dlp", digest("2"), "active", now, null);
  db.query("INSERT INTO runner_identities (runner_id, installation_id, scope_kind, workflow_ref, public_key_id, public_key_fingerprint, status, created_at, rotated_at, revoked_at, termination_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("runner_fg5_dlp", 10001, "repository", "owner/repo/.github/workflows/archcontext-organization-runner.yml@refs/tags/v1", "runnerkey_fg5_dlp", digest("3"), "active", now, null, null, null);
  db.query("INSERT INTO runner_identity_repositories (runner_id, repository_id) VALUES (?, ?)").run("runner_fg5_dlp", 20002);
  db.query("INSERT INTO webhook_deliveries (provider, delivery_id, event_type, projected_digest, received_at, processed_at, retention_delete_after) VALUES (?, ?, ?, ?, ?, ?, ?)").run("github", "delivery_fg5_dlp", "pull_request", digest("4"), now, now, "2026-07-21T19:00:00.000Z");
  db.query(`
INSERT INTO review_challenges (
  challenge_id, installation_id, repository_id, pull_request_number, head_sha, base_sha, required_trust, policy_profile_id,
  nonce_hash, status, lease_owner, lease_expires_at, created_at, expires_at, superseded_by, consumed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(challengeId, 10001, 20002, 42, headSha, baseSha, "developer", "default", nonceHash, "LEASED", "worker_fg5_dlp", "2026-06-21T19:05:00.000Z", now, "2026-06-21T19:30:00.000Z", null, null);
  persistAcceptedAttestationSubmission(db, {
    challengeId,
    nonceHash,
    acceptedAt: "2026-06-21T19:02:00.000Z",
    attestation: attestationRow({ challengeId, headSha, baseSha, mergeBaseSha, treeOid, nonceHash }),
    checkDelivery: checkDeliveryRow({ challengeId, headSha })
  });
  db.query("INSERT INTO legacy_attestation_migrations (original_attestation_id, original_challenge_id, legacy_schema_version, target_schema_version, migration_status, required_check_eligible, rejection_reason_code, head_sha, worktree_digest, review_digest, trust_level, principal_id, public_key_id, issued_at, expires_at, migrated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "att_legacy_fg5_dlp",
    "chal_legacy_fg5_dlp",
    "archcontext.attestation/v1",
    "archcontext.attestation/v2",
    "legacy-audit-only",
    0,
    "ATTESTATION_SCHEMA_UNSUPPORTED",
    headSha,
    digest("13"),
    digest("14"),
    "developer",
    "acct_fg5_dlp",
    "devkey_fg5_dlp",
    "2026-06-21T18:00:00.000Z",
    "2026-06-21T20:00:00.000Z",
    now
  );
}

function attestationRow(input: { challengeId: string; headSha: string; baseSha: string; mergeBaseSha: string; treeOid: string; nonceHash: string }): AcceptedAttestationPersistenceRow {
  return {
    attestationId: "att_fg5_full_plane_dlp",
    challengeId: input.challengeId,
    installationId: 10001,
    repositoryId: 20002,
    pullRequestNumber: 42,
    headSha: input.headSha,
    baseSha: input.baseSha,
    mergeBaseSha: input.mergeBaseSha,
    headTreeOid: input.treeOid,
    worktreeDigest: digest("5"),
    modelDigest: digest("6"),
    policyDigest: digest("7"),
    codeFactsDigest: digest("8"),
    reviewDigest: digest("9"),
    result: "pass",
    errorCode: null,
    executionTrustLevel: "developer",
    executionOrigin: "clean-commit-worktree",
    principalId: "acct_fg5_dlp",
    publicKeyId: "devkey_fg5_dlp",
    runtimeVersion: "archctx/0.5.0",
    runtimeBuildDigest: digest("10"),
    runtimeGraphVersion: "graph-v1",
    runtimeCapabilitiesDigest: digest("11"),
    nonceHash: input.nonceHash,
    signaturePresent: true,
    startedAt: "2026-06-21T19:01:00.000Z",
    completedAt: "2026-06-21T19:01:20.000Z",
    expiresAt: "2026-06-21T19:30:00.000Z",
    acceptedAt: "2026-06-21T19:02:00.000Z",
    payloadDigest: digest("12")
  };
}

function checkDeliveryRow(input: { challengeId: string; headSha: string }): PendingCheckDeliveryPersistenceRow {
  return {
    deliveryId: checkDeliveryIdempotencyKey({
      challengeId: input.challengeId,
      checkName: "ArchContext / Developer Review",
      headSha: input.headSha
    }),
    challengeId: input.challengeId,
    checkName: "ArchContext / Developer Review",
    headSha: input.headSha,
    createdAt: "2026-06-21T19:02:00.000Z",
    updatedAt: "2026-06-21T19:02:00.000Z"
  };
}

function buildDtoExports(baitPayload: Record<string, string>) {
  const cp = new ControlPlane();
  const telemetry = {
    requestId: "req_fg5_dlp",
    routeId: "POST /v1/challenges/:challenge/attestations",
    installationId: 10001,
    repositoryId: 20002,
    pullRequestNumber: 42,
    headSha: "a".repeat(40),
    challengeId: "chal_fg5_full_plane_dlp",
    attestationId: "att_fg5_full_plane_dlp",
    checkDeliveryId: checkDeliveryIdempotencyKey({
      challengeId: "chal_fg5_full_plane_dlp",
      checkName: "ArchContext / Developer Review",
      headSha: "a".repeat(40)
    }),
    status: "verified",
    reasonCode: "CHECK_DELIVERY_FAILED",
    latencyMs: 24,
    attempt: 1,
    runtimeVersion: "archctx/0.5.0",
    ...baitPayload
  };
  const checkDelivery = {
    schemaVersion: "archcontext.check-delivery/v1" as const,
    deliveryId: telemetry.checkDeliveryId,
    challengeId: telemetry.challengeId,
    checkRunId: null,
    checkName: "ArchContext / Developer Review" as const,
    headSha: telemetry.headSha,
    status: "PENDING" as const,
    attemptCount: 0,
    nextAttemptAt: null,
    lastErrorCode: null,
    createdAt: "2026-06-21T19:02:00.000Z",
    updatedAt: "2026-06-21T19:02:00.000Z"
  };
  const queue = [
    cp.buildCheckDeliveryQueueMessage({ checkDelivery, payloadDigest: digest("12") }),
    cp.projectQueuePayload({ kind: "notification.event", id: "evt_fg5_dlp", accountId: "acct_fg5_dlp", ...baitPayload })
  ];
  return {
    log: [cp.projectLogRecord(telemetry)],
    trace: [cp.projectTraceRecord({ ...telemetry, spanId: "span_fg5_dlp", parentSpanId: "span_root" })],
    queue,
    error: [cp.projectErrorObject(new Error("bait should not be retained"), { errorCode: "PAYLOAD_PRIVACY_VIOLATION", requestId: "req_fg5_dlp", ...baitPayload })],
    queueHasCheckDeliveryMessage: queue.some((item) => item.schemaVersion === CHECK_DELIVERY_QUEUE_MESSAGE_SCHEMA_VERSION)
  };
}

function scanSurface(surface: string, value: unknown, baitKeys: string[], baitNeedles: string[]) {
  const serialized = JSON.stringify(value);
  return {
    surface,
    exportedRecordCount: exportedRecordCount(value),
    codeContentMatches: countPatterns(serialized, CODE_CONTENT_PATTERNS),
    baitValueMatches: countNeedles(serialized, baitNeedles),
    forbiddenKeyMatches: countForbiddenKeys(value, new Set(baitKeys.map((key) => key.toLowerCase()))),
    forbiddenEndpointOrMediaMatches: countPatterns(serialized, FORBIDDEN_ENDPOINT_OR_MEDIA),
    secretMatches: countPatterns(serialized, SECRET_PATTERNS)
  };
}

function dlpFailures(scans: Record<string, ReturnType<typeof scanSurface>>): string[] {
  const failures: string[] = [];
  for (const [surface, scan] of Object.entries(scans)) {
    if (scan.exportedRecordCount <= 0) failures.push(`${surface} exportedRecordCount must be positive`);
    for (const key of ["codeContentMatches", "baitValueMatches", "forbiddenKeyMatches", "forbiddenEndpointOrMediaMatches", "secretMatches"] as const) {
      if (scan[key] !== 0) failures.push(`${surface}.${key} must be 0`);
    }
  }
  return failures;
}

function exportedRecordCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.tables)) {
      return record.tables.reduce((sum, table) => {
        const rows = readRecord(table).rows;
        return sum + (Array.isArray(rows) ? rows.length : 0);
      }, 0);
    }
    return Object.keys(record).length;
  }
  return 0;
}

function countForbiddenKeys(value: unknown, forbidden: Set<string>): number {
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value)) return value.reduce((sum, child) => sum + countForbiddenKeys(child, forbidden), 0);
  return Object.entries(value as Record<string, unknown>).reduce((sum, [key, child]) => {
    return sum + (forbidden.has(key.toLowerCase()) ? 1 : 0) + countForbiddenKeys(child, forbidden);
  }, 0);
}

function countPatterns(text: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function countNeedles(text: string, needles: string[]): number {
  return needles.reduce((count, needle) => count + (needle && text.includes(needle) ? 1 : 0), 0);
}

function digest(seed: string): `sha256:${string}` {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function renderHuman(result: { ok?: unknown; failures?: unknown }): string {
  const failures = Array.isArray(result.failures) ? result.failures.map(String) : [];
  return result.ok === true ? "FG5 full-plane DLP readback verified" : `FG5 full-plane DLP readback failed: ${failures.join("; ")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }): string {
  return result.ok ? "FG5 full-plane DLP evidence verified" : `FG5 full-plane DLP evidence failed: ${result.failures.join("; ")}`;
}
