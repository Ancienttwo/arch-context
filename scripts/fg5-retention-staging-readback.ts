#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { controlPlaneRetentionCutoffs, DEFAULT_CONTROL_PLANE_RETENTION_DAYS } from "@archcontext/cloud/cloud-db";

const DEFAULT_DATABASE = "archcontext-control-plane-staging";
const DEFAULT_CONFIG = "wrangler.jsonc";
const DEFAULT_OUTPUT = "docs/verification/fg5-retention-staging-readback.json";
const DEFAULT_NOW = "2026-06-21T14:00:00.000Z";
const SECRET_PATTERNS = [
  /gh[opsu]_[A-Za-z0-9_]+/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /GITHUB_WEBHOOK_SECRET/i,
  /installation[_-]?token/i,
  /jwt/i
] as const;
const CODE_CONTENT_PATTERNS = [
  /diff\s+--git/i,
  /^@@\s/m,
  /"patch"\s*:/i,
  /"fileBody"\s*:/i,
  /"sourceBody"\s*:/i,
  /"diffBody"\s*:/i,
  /\/contents(?:\/|\b)/i,
  /\/git\/blobs(?:\/|\b)/i,
  /\/git\/trees(?:\/|\b)/i,
  /\/pulls\/\d+\/files/i,
  /application\/vnd\.github\.(?:v3\.)?(?:diff|patch)/i
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildFg5RetentionStagingReadbackConfig(process.env, args);
    const result = await runFg5RetentionStagingReadback(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg5RetentionStagingReadback(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg5-retention-staging-readback] usage: run|inspect [--database name] [--config wrangler.jsonc] [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg5RetentionStagingReadbackConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    database: readFlag(args, "--database") ?? env.ARCHCONTEXT_FG5_RETENTION_DATABASE ?? DEFAULT_DATABASE,
    wranglerConfig: readFlag(args, "--config") ?? env.ARCHCONTEXT_WRANGLER_CONFIG ?? DEFAULT_CONFIG,
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG5_RETENTION_OUTPUT ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    now: readFlag(args, "--now") ?? env.ARCHCONTEXT_FG5_RETENTION_NOW ?? DEFAULT_NOW,
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg5RetentionStagingReadback(config: ReturnType<typeof buildFg5RetentionStagingReadbackConfig>) {
  const generatedAt = config.generatedAt();
  const prefix = `fg5eg5_${generatedAt.replace(/[^0-9A-Za-z]/g, "").slice(0, 20)}`;
  const cutoffs = controlPlaneRetentionCutoffs({ now: config.now });
  const temp = mkdtempSync(join(tmpdir(), "archctx-fg5-eg5-"));
  const failures: string[] = [];
  try {
    const seedSqlPath = join(temp, "seed.sql");
    const purgeSqlPath = join(temp, "purge.sql");
    writeFileSync(seedSqlPath, buildSeedSql(prefix), "utf8");
    writeFileSync(purgeSqlPath, buildPurgeSql(prefix, cutoffs), "utf8");

    const migration = runWranglerD1(config, ["--file", "deploy/sql/0001_archcontext_control_plane.sql"]);
    const seed = runWranglerD1(config, ["--file", seedSqlPath]);
    const ordinaryDelete = runWranglerD1AllowFailure(config, [
      "--command",
      `DELETE FROM attestations WHERE attestation_id = '${prefix}_att_verified_recent'`
    ]);
    if (ordinaryDelete.ok) failures.push("ordinary Attestation DELETE unexpectedly succeeded");
    if (!ordinaryDelete.output.includes("attestations are append-only")) failures.push("ordinary Attestation DELETE did not hit append-only trigger");

    const purge = runWranglerD1(config, ["--file", purgeSqlPath]);
    const readback = runWranglerD1(config, ["--command", buildReadbackSql(prefix)]);
    const counts = readFirstResult(readback.output);
    const evidence = {
      database: config.database,
      migration: summarizeD1Execution(migration.output),
      seed: summarizeD1Execution(seed.output),
      ordinaryDeleteRejected: !ordinaryDelete.ok && ordinaryDelete.output.includes("attestations are append-only"),
      purge: summarizeD1Execution(purge.output),
      counts
    };
    failures.push(...validateCounts(counts));
    const recording = {
      schemaVersion: "archcontext.fg5-retention-staging-readback/v1",
      environment: "staging",
      status: failures.length === 0 ? "verified" : "failed",
      ok: failures.length === 0,
      generatedAt,
      config: {
        database: config.database,
        wranglerConfig: config.wranglerConfig,
        output: config.outputPath,
        now: config.now,
        prefix
      },
      policy: {
        days: DEFAULT_CONTROL_PLANE_RETENTION_DAYS,
        cutoffs
      },
      evidence,
      privacy: scanPrivacy({ evidence, policy: { cutoffs } }),
      failures
    };
    recording.privacy = scanPrivacy(recording);
    if (recording.privacy.privateContentHits !== 0) {
      recording.status = "failed";
      recording.ok = false;
      recording.failures.push("recording contains forbidden private content markers");
    }
    const inspection = inspectFg5RetentionStagingReadback(recording);
    recording.status = inspection.ok ? recording.status : "failed";
    recording.ok = recording.ok && inspection.ok;
    recording.failures = mergeFailures(recording.failures, inspection.failures);
    await writeRecording(config, recording);
    return recording;
  } catch (error) {
    const recording = {
      schemaVersion: "archcontext.fg5-retention-staging-readback/v1",
      environment: "staging",
      status: "failed",
      ok: false,
      generatedAt,
      config: {
        database: config.database,
        wranglerConfig: config.wranglerConfig,
        output: config.outputPath,
        now: config.now,
        prefix
      },
      policy: {
        days: DEFAULT_CONTROL_PLANE_RETENTION_DAYS,
        cutoffs
      },
      evidence: {},
      privacy: {
        privateContentHits: 0,
        secretMarkerHits: 0,
        codeContentMarkerHits: 0
      },
      failures: [error instanceof Error ? error.message : String(error)]
    };
    await writeRecording(config, recording);
    return recording;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function inspectFg5RetentionStagingReadback(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const config = readRecord(record.config);
  const policy = readRecord(record.policy);
  const evidence = readRecord(record.evidence);
  const counts = readRecord(evidence.counts);
  const privacy = readRecord(record.privacy);
  if (record.schemaVersion !== "archcontext.fg5-retention-staging-readback/v1") failures.push("schemaVersion mismatch");
  if (record.environment !== "staging") failures.push("environment must be staging");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  if (String(config.database ?? "") !== DEFAULT_DATABASE) failures.push("database must be staging D1");
  if (String(config.now ?? "") !== DEFAULT_NOW) failures.push("retention now must match time-shift fixture");
  if (!readRecord(policy.cutoffs).webhookDeliveryBefore) failures.push("retention cutoffs missing");
  if (evidence.ordinaryDeleteRejected !== true) failures.push("ordinary Attestation DELETE must be rejected");
  failures.push(...validateCounts(counts));
  if (Number(privacy.privateContentHits) !== 0) failures.push("privacy.privateContentHits must be 0");
  if (Number(privacy.secretMarkerHits) !== 0) failures.push("privacy.secretMarkerHits must be 0");
  if (Number(privacy.codeContentMarkerHits) !== 0) failures.push("privacy.codeContentMarkerHits must be 0");
  const serialized = JSON.stringify(recording);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden secret marker: ${pattern}`);
  }
  for (const pattern of CODE_CONTENT_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden code-content marker: ${pattern}`);
  }
  return { ok: failures.length === 0, failures };
}

function buildSeedSql(prefix: string): string {
  const now = DEFAULT_NOW;
  return `
INSERT INTO webhook_deliveries (provider, delivery_id, event_type, projected_digest, received_at, processed_at, retention_delete_after)
VALUES
  ('github', '${prefix}_webhook_expired', 'pull_request', '${digest(`${prefix}:webhook-expired`)}', '2026-04-22T14:00:00.000Z', '2026-04-22T14:00:01.000Z', '2026-05-22T13:59:59.000Z'),
  ('github', '${prefix}_webhook_recent', 'pull_request', '${digest(`${prefix}:webhook-recent`)}', '2026-05-22T14:00:01.000Z', '2026-05-22T14:00:02.000Z', '2026-06-21T14:00:01.000Z');

INSERT INTO review_challenges (
  challenge_id, installation_id, repository_id, pull_request_number, head_sha, base_sha, required_trust,
  policy_profile_id, nonce_hash, status, lease_owner, lease_expires_at, created_at, expires_at, superseded_by, consumed_at
) VALUES
  ('${prefix}_challenge_unfinished_expired', 12345, 987654501, 42, '${hex40(`${prefix}:head-unfinished-expired`)}', '${hex40(`${prefix}:base-unfinished-expired`)}', 'developer', 'default', '${digest(`${prefix}:nonce-unfinished-expired`)}', 'PENDING', NULL, NULL, '2026-06-14T13:59:59.000Z', '2026-06-14T14:15:00.000Z', NULL, NULL),
  ('${prefix}_challenge_unfinished_recent', 12345, 987654502, 42, '${hex40(`${prefix}:head-unfinished-recent`)}', '${hex40(`${prefix}:base-unfinished-recent`)}', 'developer', 'default', '${digest(`${prefix}:nonce-unfinished-recent`)}', 'PENDING', NULL, NULL, '2026-06-14T14:00:01.000Z', '2026-06-14T14:15:01.000Z', NULL, NULL),
  ('${prefix}_challenge_terminal_old', 12345, 987654503, 42, '${hex40(`${prefix}:head-terminal-old`)}', '${hex40(`${prefix}:base-terminal-old`)}', 'developer', 'default', '${digest(`${prefix}:nonce-terminal-old`)}', 'EXPIRED', NULL, NULL, '2026-06-14T13:59:59.000Z', '2026-06-14T14:15:00.000Z', NULL, NULL);

${attestationInsert(prefix, "att_verified_expired", "pass", "2025-06-21T13:59:59.000Z")}
${attestationInsert(prefix, "att_verified_recent", "pass", "2025-06-21T14:00:01.000Z")}
${attestationInsert(prefix, "att_rejected_expired", "fail", "2026-05-22T13:59:59.000Z")}
${attestationInsert(prefix, "att_rejected_recent", "error", "2026-05-22T14:00:01.000Z")}

INSERT INTO legacy_attestation_migrations (
  original_attestation_id, original_challenge_id, legacy_schema_version, target_schema_version, migration_status,
  required_check_eligible, rejection_reason_code, head_sha, worktree_digest, review_digest, trust_level,
  principal_id, public_key_id, issued_at, expires_at, migrated_at
) VALUES
  ('${prefix}_legacy_expired', '${prefix}_legacy_chal_expired', 'archcontext.attestation/v1', 'archcontext.attestation/v2', 'legacy-audit-only', 0, 'ATTESTATION_SCHEMA_UNSUPPORTED', '${"a".repeat(40)}', '${digest(`${prefix}:legacy-worktree-expired`)}', '${digest(`${prefix}:legacy-review-expired`)}', 'developer', 'device-1', 'device-key-1', '2026-05-01T00:00:00.000Z', '2026-05-01T00:15:00.000Z', '2026-05-22T13:59:59.000Z'),
  ('${prefix}_legacy_recent', '${prefix}_legacy_chal_recent', 'archcontext.attestation/v1', 'archcontext.attestation/v2', 'legacy-audit-only', 0, 'ATTESTATION_SCHEMA_UNSUPPORTED', '${"a".repeat(40)}', '${digest(`${prefix}:legacy-worktree-recent`)}', '${digest(`${prefix}:legacy-review-recent`)}', 'developer', 'device-1', 'device-key-1', '2026-05-01T00:00:00.000Z', '2026-05-01T00:15:00.000Z', '2026-05-22T14:00:01.000Z');

INSERT INTO check_deliveries (delivery_id, challenge_id, check_run_id, check_name, head_sha, status, attempt_count, next_attempt_at, last_error_code, created_at, updated_at)
VALUES
  ('${prefix}_check_expired', '${prefix}_challenge_check_expired', NULL, 'ArchContext / Developer Review', '${"a".repeat(40)}', 'PENDING', 0, NULL, NULL, '2026-03-23T13:00:00.000Z', '2026-03-23T13:59:59.000Z'),
  ('${prefix}_check_recent', '${prefix}_challenge_check_recent', NULL, 'ArchContext / Developer Review', '${"a".repeat(40)}', 'PENDING', 0, NULL, NULL, '2026-03-23T13:00:00.000Z', '2026-03-23T14:00:01.000Z');

INSERT INTO runner_identities (
  runner_id, installation_id, scope_kind, workflow_ref, public_key_id, public_key_fingerprint,
  status, created_at, rotated_at, revoked_at, termination_kind
) VALUES
  ('${prefix}_runner_revoked_expired', 12345, 'repository', 'Ancienttwo/arch-context/.github/workflows/archcontext-organization-runner.yml@refs/heads/main', '${prefix}_runner_key_expired', '${fingerprint(`${prefix}:runner-expired`)}', 'revoked', '${now}', NULL, '2025-06-21T13:59:59.000Z', 'revoked'),
  ('${prefix}_runner_recent_next', 12345, 'repository', 'Ancienttwo/arch-context/.github/workflows/archcontext-organization-runner.yml@refs/heads/main', '${prefix}_runner_key_next', '${fingerprint(`${prefix}:runner-next`)}', 'active', '${now}', NULL, NULL, NULL),
  ('${prefix}_runner_revoked_recent', 12345, 'repository', 'Ancienttwo/arch-context/.github/workflows/archcontext-organization-runner.yml@refs/heads/main', '${prefix}_runner_key_recent', '${fingerprint(`${prefix}:runner-recent`)}', 'revoked', '${now}', NULL, '2025-06-21T14:00:01.000Z', 'revoked');

INSERT INTO runner_identity_repositories (runner_id, repository_id)
VALUES ('${prefix}_runner_revoked_expired', 987654501), ('${prefix}_runner_revoked_recent', 987654502);

INSERT INTO runner_key_rotation_windows (previous_runner_id, next_runner_id, rotated_at, overlap_until)
VALUES ('${prefix}_runner_revoked_expired', '${prefix}_runner_recent_next', '2025-06-21T13:00:00.000Z', '2025-06-21T13:30:00.000Z');
`;
}

function buildPurgeSql(prefix: string, cutoffs: ReturnType<typeof controlPlaneRetentionCutoffs>): string {
  return `
DELETE FROM webhook_deliveries WHERE delivery_id LIKE '${prefix}_%' AND retention_delete_after <= '${cutoffs.now}';
DELETE FROM review_challenges WHERE challenge_id LIKE '${prefix}_%' AND status IN ('PENDING', 'LEASED', 'SUBMITTED') AND created_at <= '${cutoffs.unfinishedChallengeCreatedBefore}';
DELETE FROM legacy_attestation_migrations WHERE original_attestation_id LIKE '${prefix}_%' AND migrated_at <= '${cutoffs.legacyAttestationAuditBefore}';
DELETE FROM check_deliveries WHERE delivery_id LIKE '${prefix}_%' AND updated_at <= '${cutoffs.checkDeliveryUpdatedBefore}';
DELETE FROM runner_key_rotation_windows
WHERE previous_runner_id IN (SELECT runner_id FROM runner_identities WHERE runner_id LIKE '${prefix}_%' AND status = 'revoked' AND revoked_at <= '${cutoffs.revokedRunnerKeyBefore}')
   OR next_runner_id IN (SELECT runner_id FROM runner_identities WHERE runner_id LIKE '${prefix}_%' AND status = 'revoked' AND revoked_at <= '${cutoffs.revokedRunnerKeyBefore}');
DELETE FROM runner_identity_repositories
WHERE runner_id IN (SELECT runner_id FROM runner_identities WHERE runner_id LIKE '${prefix}_%' AND status = 'revoked' AND revoked_at <= '${cutoffs.revokedRunnerKeyBefore}');
INSERT OR REPLACE INTO retention_purge_authorizations (table_name, authorized_at) VALUES ('attestations', '${cutoffs.now}');
DELETE FROM attestations WHERE attestation_id LIKE '${prefix}_%' AND result = 'pass' AND accepted_at <= '${cutoffs.verifiedAttestationAcceptedBefore}';
DELETE FROM attestations WHERE attestation_id LIKE '${prefix}_%' AND result IN ('fail', 'error') AND accepted_at <= '${cutoffs.rejectedAttestationAcceptedBefore}';
DELETE FROM retention_purge_authorizations WHERE table_name = 'attestations';
DELETE FROM runner_identities WHERE runner_id LIKE '${prefix}_%' AND status = 'revoked' AND revoked_at <= '${cutoffs.revokedRunnerKeyBefore}';
`;
}

function buildReadbackSql(prefix: string): string {
  return `
SELECT
  (SELECT COUNT(*) FROM webhook_deliveries WHERE delivery_id = '${prefix}_webhook_expired') AS webhookExpired,
  (SELECT COUNT(*) FROM webhook_deliveries WHERE delivery_id = '${prefix}_webhook_recent') AS webhookRecent,
  (SELECT COUNT(*) FROM review_challenges WHERE challenge_id = '${prefix}_challenge_unfinished_expired') AS unfinishedChallengeExpired,
  (SELECT COUNT(*) FROM review_challenges WHERE challenge_id = '${prefix}_challenge_unfinished_recent') AS unfinishedChallengeRecent,
  (SELECT COUNT(*) FROM review_challenges WHERE challenge_id = '${prefix}_challenge_terminal_old') AS terminalChallengeOld,
  (SELECT COUNT(*) FROM attestations WHERE attestation_id = '${prefix}_att_verified_expired') AS verifiedAttestationExpired,
  (SELECT COUNT(*) FROM attestations WHERE attestation_id = '${prefix}_att_verified_recent') AS verifiedAttestationRecent,
  (SELECT COUNT(*) FROM attestations WHERE attestation_id = '${prefix}_att_rejected_expired') AS rejectedAttestationExpired,
  (SELECT COUNT(*) FROM attestations WHERE attestation_id = '${prefix}_att_rejected_recent') AS rejectedAttestationRecent,
  (SELECT COUNT(*) FROM legacy_attestation_migrations WHERE original_attestation_id = '${prefix}_legacy_expired') AS legacyExpired,
  (SELECT COUNT(*) FROM legacy_attestation_migrations WHERE original_attestation_id = '${prefix}_legacy_recent') AS legacyRecent,
  (SELECT COUNT(*) FROM check_deliveries WHERE delivery_id = '${prefix}_check_expired') AS checkExpired,
  (SELECT COUNT(*) FROM check_deliveries WHERE delivery_id = '${prefix}_check_recent') AS checkRecent,
  (SELECT COUNT(*) FROM runner_identities WHERE runner_id = '${prefix}_runner_revoked_expired') AS revokedRunnerExpired,
  (SELECT COUNT(*) FROM runner_identity_repositories WHERE runner_id = '${prefix}_runner_revoked_expired') AS revokedRunnerExpiredRepositories,
  (SELECT COUNT(*) FROM runner_key_rotation_windows WHERE previous_runner_id = '${prefix}_runner_revoked_expired') AS revokedRunnerExpiredRotationWindows,
  (SELECT COUNT(*) FROM runner_identities WHERE runner_id = '${prefix}_runner_revoked_recent') AS revokedRunnerRecent,
  (SELECT COUNT(*) FROM retention_purge_authorizations) AS retentionPurgeAuthorizations;
`;
}

function attestationInsert(prefix: string, id: string, result: "pass" | "fail" | "error", acceptedAt: string): string {
  return `
INSERT INTO attestations (
  attestation_id, schema_version, challenge_id, installation_id, repository_id, pull_request_number,
  head_sha, base_sha, merge_base_sha, head_tree_oid, worktree_digest, model_digest, policy_digest,
  code_facts_digest, review_digest, result, error_code, execution_trust_level, execution_origin,
  principal_id, public_key_id, runtime_version, runtime_build_digest, runtime_graph_version,
  runtime_capabilities_digest, nonce_hash, signature_algorithm, signature_present, started_at,
  completed_at, expires_at, accepted_at, payload_digest, migration_status
) VALUES (
  '${prefix}_${id}', 'archcontext.attestation/v2', '${prefix}_chal_${id}', 12345, 987654501, 42,
  '${"a".repeat(40)}', '${"b".repeat(40)}', '${"c".repeat(40)}', '${"d".repeat(40)}',
  '${digest(`${prefix}:${id}:worktree`)}', '${digest(`${prefix}:${id}:model`)}',
  '${digest(`${prefix}:${id}:policy`)}', '${digest(`${prefix}:${id}:codefacts`)}',
  '${digest(`${prefix}:${id}:review`)}', '${result}', NULL, 'developer', 'clean-commit-worktree',
  'device-1', 'device-key-1', '0.1.0', '${digest(`${prefix}:${id}:runtime-build`)}', '1',
  '${digest(`${prefix}:${id}:runtime-capabilities`)}', '${digest(`${prefix}:${id}:nonce`)}',
  'ed25519', 1, '2026-06-21T14:01:00.000Z', '2026-06-21T14:02:00.000Z',
  '2026-06-21T14:15:00.000Z', '${acceptedAt}', '${digest(`${prefix}:${id}:payload`)}', 'native-v2'
);`;
}

function runWranglerD1(config: ReturnType<typeof buildFg5RetentionStagingReadbackConfig>, args: string[]) {
  return runWranglerD1AllowFailure(config, args, true);
}

function runWranglerD1AllowFailure(config: ReturnType<typeof buildFg5RetentionStagingReadbackConfig>, args: string[], throwOnFailure = false) {
  const fullArgs = ["d1", "execute", config.database, "--remote", "--json", "--config", config.wranglerConfig, ...args];
  try {
    return {
      ok: true,
      output: execFileSync("wrangler", fullArgs, {
        cwd: config.root,
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" }
      })
    };
  } catch (error) {
    const output = [
      error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout ?? "") : "",
      error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : ""
    ].join("\n");
    if (throwOnFailure) throw new Error(output.trim() || "wrangler d1 execute failed");
    return { ok: false, output };
  }
}

function summarizeD1Execution(output: string) {
  const parsed = parseWranglerJson(output);
  const first = readRecord(Array.isArray(parsed) ? parsed[0] : undefined);
  const meta = readRecord(first.meta);
  return {
    success: first.success === true,
    rowsRead: Number(meta.rows_read ?? 0),
    rowsWritten: Number(meta.rows_written ?? 0),
    changedDb: meta.changed_db === true,
    finalBookmark: String(first.finalBookmark ?? "")
  };
}

function readFirstResult(output: string): Record<string, unknown> {
  const parsed = parseWranglerJson(output);
  const first = readRecord(Array.isArray(parsed) ? parsed[0] : undefined);
  const results = Array.isArray(first.results) ? first.results : [];
  return readRecord(results[0]);
}

function parseWranglerJson(output: string): unknown {
  const stripped = output.replace(/\u001b\[[0-9;]*m/g, "");
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error(`wrangler JSON output missing: ${stripped.slice(0, 400)}`);
  return JSON.parse(stripped.slice(start, end + 1)) as unknown;
}

function validateCounts(counts: Record<string, unknown>): string[] {
  const failures: string[] = [];
  const expected: Record<string, number> = {
    webhookExpired: 0,
    webhookRecent: 1,
    unfinishedChallengeExpired: 0,
    unfinishedChallengeRecent: 1,
    terminalChallengeOld: 1,
    verifiedAttestationExpired: 0,
    verifiedAttestationRecent: 1,
    rejectedAttestationExpired: 0,
    rejectedAttestationRecent: 1,
    legacyExpired: 0,
    legacyRecent: 1,
    checkExpired: 0,
    checkRecent: 1,
    revokedRunnerExpired: 0,
    revokedRunnerExpiredRepositories: 0,
    revokedRunnerExpiredRotationWindows: 0,
    revokedRunnerRecent: 1,
    retentionPurgeAuthorizations: 0
  };
  for (const [key, value] of Object.entries(expected)) {
    if (Number(counts[key] ?? -1) !== value) failures.push(`${key} must be ${value}`);
  }
  return failures;
}

function scanPrivacy(value: unknown) {
  const serialized = JSON.stringify(value);
  const secretMarkerHits = countPatterns(serialized, SECRET_PATTERNS);
  const codeContentMarkerHits = countPatterns(serialized, CODE_CONTENT_PATTERNS);
  return {
    privateContentHits: secretMarkerHits + codeContentMarkerHits,
    secretMarkerHits,
    codeContentMarkerHits
  };
}

function countPatterns(text: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function hex40(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 40);
}

function fingerprint(value: string): string {
  return digest(`fingerprint:${value}`);
}

async function writeRecording(config: ReturnType<typeof buildFg5RetentionStagingReadbackConfig>, recording: unknown): Promise<void> {
  const output = resolve(config.root, config.outputPath);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(recording, null, 2)}\n`, "utf8");
}

function mergeFailures(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])];
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
  return result.ok === true ? "FG5 retention staging readback verified" : `FG5 retention staging readback failed: ${failures.join("; ")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }): string {
  return result.ok ? "FG5 retention staging readback evidence verified" : `FG5 retention staging readback evidence failed: ${result.failures.join("; ")}`;
}
