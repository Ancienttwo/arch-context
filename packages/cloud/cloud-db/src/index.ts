import { digestJson, type GovernanceCheckName } from "@archcontext/contracts";

export const D1_MIGRATIONS = [
  {
    id: "0001_control_plane",
    sql: `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  github_user_id TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  stripe_customer_id TEXT,
  status TEXT NOT NULL,
  plan TEXT NOT NULL,
  billing_interval TEXT NOT NULL DEFAULT 'monthly',
  current_period_end TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS github_installations (
  installation_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  repository_selection TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_identities (
  device_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  public_key_id TEXT NOT NULL,
  public_key_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  CHECK(length(public_key_fingerprint) = 71 AND substr(public_key_fingerprint, 1, 7) = 'sha256:'),
  CHECK(status != 'active' OR revoked_at IS NULL),
  CHECK(status != 'revoked' OR revoked_at IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS review_challenges (
  challenge_id TEXT PRIMARY KEY,
  installation_id INTEGER NOT NULL,
  repository_id INTEGER NOT NULL,
  pull_request_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  required_trust TEXT NOT NULL CHECK(required_trust IN ('developer', 'organization')),
  policy_profile_id TEXT NOT NULL,
  nonce_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('PENDING', 'LEASED', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'SUPERSEDED', 'EXPIRED')),
  lease_owner TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  superseded_by TEXT,
  consumed_at TEXT,
  CHECK(expires_at > created_at),
  CHECK(lease_expires_at IS NULL OR lease_expires_at <= expires_at),
  CHECK(consumed_at IS NULL OR status IN ('SUBMITTED', 'VERIFIED', 'REJECTED')),
  CHECK(superseded_by IS NULL OR status = 'SUPERSEDED')
);
CREATE TABLE IF NOT EXISTS attestations (
  attestation_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'archcontext.attestation/v2'),
  challenge_id TEXT NOT NULL,
  installation_id INTEGER NOT NULL,
  repository_id INTEGER NOT NULL,
  pull_request_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  merge_base_sha TEXT NOT NULL,
  head_tree_oid TEXT NOT NULL,
  worktree_digest TEXT NOT NULL,
  model_digest TEXT NOT NULL,
  policy_digest TEXT NOT NULL,
  code_facts_digest TEXT NOT NULL,
  review_digest TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('pass', 'fail', 'error')),
  error_code TEXT,
  execution_trust_level TEXT NOT NULL CHECK(execution_trust_level IN ('developer', 'organization')),
  execution_origin TEXT NOT NULL CHECK(execution_origin IN ('clean-commit-worktree', 'organization-runner-checkout')),
  principal_id TEXT NOT NULL,
  public_key_id TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  runtime_build_digest TEXT NOT NULL,
  runtime_graph_version TEXT NOT NULL,
  runtime_capabilities_digest TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  signature_algorithm TEXT NOT NULL CHECK(signature_algorithm = 'ed25519'),
  signature_present INTEGER NOT NULL CHECK(signature_present IN (0, 1)),
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  payload_digest TEXT NOT NULL UNIQUE,
  migration_status TEXT NOT NULL DEFAULT 'native-v2' CHECK(migration_status = 'native-v2'),
  CHECK(completed_at >= started_at),
  CHECK(expires_at > completed_at),
  CHECK(length(payload_digest) = 71 AND substr(payload_digest, 1, 7) = 'sha256:')
);
CREATE TABLE IF NOT EXISTS retention_purge_authorizations (
  table_name TEXT PRIMARY KEY,
  authorized_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS trg_attestations_append_only_no_update
  BEFORE UPDATE ON attestations
  BEGIN
    SELECT RAISE(ABORT, 'attestations are append-only');
  END;
CREATE TRIGGER IF NOT EXISTS trg_attestations_append_only_no_delete
  BEFORE DELETE ON attestations
  WHEN NOT EXISTS (
    SELECT 1 FROM retention_purge_authorizations
    WHERE table_name = 'attestations'
  )
  BEGIN
    SELECT RAISE(ABORT, 'attestations are append-only');
  END;
CREATE TABLE IF NOT EXISTS legacy_attestation_migrations (
  original_attestation_id TEXT PRIMARY KEY,
  original_challenge_id TEXT NOT NULL,
  legacy_schema_version TEXT NOT NULL CHECK(legacy_schema_version = 'archcontext.attestation/v1'),
  target_schema_version TEXT NOT NULL CHECK(target_schema_version = 'archcontext.attestation/v2'),
  migration_status TEXT NOT NULL CHECK(migration_status = 'legacy-audit-only'),
  required_check_eligible INTEGER NOT NULL CHECK(required_check_eligible = 0),
  rejection_reason_code TEXT NOT NULL CHECK(rejection_reason_code = 'ATTESTATION_SCHEMA_UNSUPPORTED'),
  head_sha TEXT NOT NULL,
  worktree_digest TEXT NOT NULL,
  review_digest TEXT NOT NULL,
  trust_level TEXT NOT NULL CHECK(trust_level IN ('developer', 'organization')),
  principal_id TEXT NOT NULL,
  public_key_id TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  migrated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runner_identities (
  runner_id TEXT PRIMARY KEY,
  installation_id INTEGER NOT NULL,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('repository', 'organization')),
  workflow_ref TEXT NOT NULL,
  public_key_id TEXT NOT NULL,
  public_key_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'rotating', 'revoked')),
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  revoked_at TEXT,
  termination_kind TEXT CHECK(termination_kind IN ('revoked', 'unregistered')),
  CHECK(length(public_key_fingerprint) = 71 AND substr(public_key_fingerprint, 1, 7) = 'sha256:'),
  CHECK(status != 'active' OR (rotated_at IS NULL AND revoked_at IS NULL AND termination_kind IS NULL)),
  CHECK(status != 'rotating' OR (rotated_at IS NOT NULL AND revoked_at IS NULL AND termination_kind IS NULL)),
  CHECK(status != 'revoked' OR revoked_at IS NOT NULL),
  CHECK(termination_kind IS NULL OR status = 'revoked')
);
CREATE TABLE IF NOT EXISTS runner_identity_repositories (
  runner_id TEXT NOT NULL,
  repository_id INTEGER NOT NULL,
  PRIMARY KEY(runner_id, repository_id),
  FOREIGN KEY(runner_id) REFERENCES runner_identities(runner_id)
);
CREATE TABLE IF NOT EXISTS runner_key_rotation_windows (
  previous_runner_id TEXT PRIMARY KEY,
  next_runner_id TEXT NOT NULL UNIQUE,
  rotated_at TEXT NOT NULL,
  overlap_until TEXT NOT NULL,
  CHECK(overlap_until > rotated_at),
  FOREIGN KEY(previous_runner_id) REFERENCES runner_identities(runner_id),
  FOREIGN KEY(next_runner_id) REFERENCES runner_identities(runner_id)
);
CREATE TABLE IF NOT EXISTS check_deliveries (
  delivery_id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  check_run_id TEXT,
  check_name TEXT NOT NULL CHECK(check_name IN ('ArchContext / Developer Review', 'ArchContext / Organization Runner')),
  head_sha TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING', 'PUBLISHED', 'RETRYING', 'DEAD_LETTER')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  next_attempt_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(length(head_sha) BETWEEN 40 AND 64),
  CHECK(updated_at >= created_at),
  CHECK(status != 'PUBLISHED' OR check_run_id IS NOT NULL),
  CHECK(status != 'RETRYING' OR next_attempt_at IS NOT NULL),
  CHECK(status != 'DEAD_LETTER' OR last_error_code IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  provider TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  projected_digest TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  retention_delete_after TEXT NOT NULL,
  CHECK(length(projected_digest) = 71 AND substr(projected_digest, 1, 7) = 'sha256:'),
  CHECK(processed_at IS NULL OR processed_at >= received_at),
  CHECK(retention_delete_after > received_at),
  PRIMARY KEY(provider, delivery_id)
);`
  },
  {
    id: "0002_indexes",
    sql: `
CREATE INDEX IF NOT EXISTS idx_subscriptions_account ON subscriptions(account_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS ux_device_identities_account_public_key ON device_identities(account_id, public_key_id);
CREATE INDEX IF NOT EXISTS idx_device_identities_account_status ON device_identities(account_id, status);
CREATE INDEX IF NOT EXISTS idx_challenges_repo_head ON review_challenges(repository_id, pull_request_number, head_sha);
CREATE INDEX IF NOT EXISTS idx_challenges_current_lookup ON review_challenges(repository_id, pull_request_number, head_sha, required_trust, status);
CREATE INDEX IF NOT EXISTS idx_challenges_status_expiry ON review_challenges(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_challenges_lease_expiry ON review_challenges(status, lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_review_challenges_active_identity
  ON review_challenges(installation_id, repository_id, pull_request_number, head_sha, required_trust)
  WHERE status IN ('PENDING', 'LEASED', 'SUBMITTED');
CREATE UNIQUE INDEX IF NOT EXISTS ux_attestations_challenge ON attestations(challenge_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_attestations_payload_digest ON attestations(payload_digest);
CREATE INDEX IF NOT EXISTS idx_attestations_repo_head ON attestations(repository_id, pull_request_number, head_sha);
CREATE INDEX IF NOT EXISTS idx_attestations_retention ON attestations(result, accepted_at);
CREATE INDEX IF NOT EXISTS idx_legacy_attestation_migrations_challenge ON legacy_attestation_migrations(original_challenge_id);
CREATE INDEX IF NOT EXISTS idx_legacy_attestation_migrations_retention ON legacy_attestation_migrations(migrated_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_runner_identities_public_key ON runner_identities(installation_id, public_key_id);
CREATE INDEX IF NOT EXISTS idx_runner_identities_installation_status ON runner_identities(installation_id, status);
CREATE INDEX IF NOT EXISTS idx_runner_identities_revoked_retention ON runner_identities(status, revoked_at)
  WHERE status = 'revoked';
CREATE INDEX IF NOT EXISTS idx_runner_identity_repositories_repository ON runner_identity_repositories(repository_id, runner_id);
CREATE INDEX IF NOT EXISTS idx_runner_key_rotation_next ON runner_key_rotation_windows(next_runner_id);
CREATE INDEX IF NOT EXISTS idx_check_deliveries_challenge ON check_deliveries(challenge_id, status);
CREATE INDEX IF NOT EXISTS idx_check_deliveries_next_attempt ON check_deliveries(status, next_attempt_at)
  WHERE status = 'RETRYING';
CREATE INDEX IF NOT EXISTS idx_check_deliveries_head_context ON check_deliveries(head_sha, check_name, status);
CREATE INDEX IF NOT EXISTS idx_check_deliveries_retention ON check_deliveries(updated_at, status);
CREATE INDEX IF NOT EXISTS idx_deliveries_provider ON webhook_deliveries(provider, received_at);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event_type ON webhook_deliveries(provider, event_type, received_at);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retention ON webhook_deliveries(retention_delete_after, provider);`
  }
] as const;

export function d1MigrationSql(): string {
  return D1_MIGRATIONS.map((migration) => `-- ${migration.id}\n${migration.sql.trim()}`).join("\n\n");
}

export function assertD1PrivacySchema(sql = d1MigrationSql()): void {
  const forbiddenTerms = ["source", "diff", "symbol", ["code", "graph"].join(""), "model_body", "finding_detail", "embedding"];
  if (forbiddenTerms.some((term) => sql.toLowerCase().includes(term))) {
    throw new Error("D1 schema contains forbidden content storage column");
  }
}

export function highFrequencyIndexes(): string[] {
  return D1_MIGRATIONS.flatMap((migration) => [...migration.sql.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ([a-z0-9_]+)/g)].map((match) => match[1]));
}

export function checkDeliveryIdempotencyKey(input: {
  challengeId: string;
  checkName: GovernanceCheckName;
  headSha: string;
}): string {
  return digestJson({
    schemaVersion: "archcontext.check-delivery-idempotency-key/v1",
    challengeId: input.challengeId,
    checkName: input.checkName,
    headSha: input.headSha
  });
}

export interface SqlStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
}

export interface TransactionalSqlDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SqlStatement;
}

export interface AcceptedAttestationPersistenceRow {
  attestationId: string;
  challengeId: string;
  installationId: number;
  repositoryId: number;
  pullRequestNumber: number;
  headSha: string;
  baseSha: string;
  mergeBaseSha: string;
  headTreeOid: string;
  worktreeDigest: string;
  modelDigest: string;
  policyDigest: string;
  codeFactsDigest: string;
  reviewDigest: string;
  result: "pass" | "fail" | "error";
  errorCode?: string | null;
  executionTrustLevel: "developer" | "organization";
  executionOrigin: "clean-commit-worktree" | "organization-runner-checkout";
  principalId: string;
  publicKeyId: string;
  runtimeVersion: string;
  runtimeBuildDigest: string;
  runtimeGraphVersion: string;
  runtimeCapabilitiesDigest: string;
  nonceHash: string;
  signaturePresent: boolean;
  startedAt: string;
  completedAt: string;
  expiresAt: string;
  acceptedAt: string;
  payloadDigest: string;
}

export interface PendingCheckDeliveryPersistenceRow {
  deliveryId: string;
  challengeId: string;
  checkName: GovernanceCheckName;
  headSha: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersistAcceptedAttestationSubmissionInput {
  challengeId: string;
  nonceHash: string;
  acceptedAt: string;
  attestation: AcceptedAttestationPersistenceRow;
  checkDelivery?: PendingCheckDeliveryPersistenceRow;
}

export const DEFAULT_CONTROL_PLANE_RETENTION_DAYS = {
  webhookDelivery: 30,
  unfinishedChallenge: 7,
  verifiedAttestation: 365,
  rejectedAttestation: 30,
  legacyAttestationAudit: 30,
  checkDelivery: 90,
  revokedRunnerKey: 365,
  rawWebhookBody: 0,
  privateContent: 0
} as const;

export interface ControlPlaneRetentionPolicyDays {
  webhookDelivery?: number;
  unfinishedChallenge?: number;
  verifiedAttestation?: number;
  rejectedAttestation?: number;
  legacyAttestationAudit?: number;
  checkDelivery?: number;
  revokedRunnerKey?: number;
}

export interface ControlPlaneRetentionCutoffs {
  now: string;
  webhookDeliveryBefore: string;
  unfinishedChallengeCreatedBefore: string;
  verifiedAttestationAcceptedBefore: string;
  rejectedAttestationAcceptedBefore: string;
  legacyAttestationAuditBefore: string;
  checkDeliveryUpdatedBefore: string;
  revokedRunnerKeyBefore: string;
}

export interface ControlPlaneRetentionPurgeResult {
  schemaVersion: "archcontext.control-plane-retention-purge/v1";
  now: string;
  cutoffs: ControlPlaneRetentionCutoffs;
  deleted: {
    webhookDeliveries: number;
    unfinishedReviewChallenges: number;
    verifiedAttestations: number;
    rejectedAttestations: number;
    legacyAttestationMigrations: number;
    checkDeliveries: number;
    runnerKeyRotationWindows: number;
    runnerIdentityRepositories: number;
    revokedRunnerIdentities: number;
  };
}

export function controlPlaneRetentionCutoffs(input: { now: string; policyDays?: ControlPlaneRetentionPolicyDays }): ControlPlaneRetentionCutoffs {
  const nowMs = requireFiniteTime(input.now, "retention.now");
  const days = {
    ...DEFAULT_CONTROL_PLANE_RETENTION_DAYS,
    ...(input.policyDays ?? {})
  };
  return {
    now: new Date(nowMs).toISOString(),
    webhookDeliveryBefore: retentionCutoff(nowMs, days.webhookDelivery, "retention.webhookDeliveryDays"),
    unfinishedChallengeCreatedBefore: retentionCutoff(nowMs, days.unfinishedChallenge, "retention.unfinishedChallengeDays"),
    verifiedAttestationAcceptedBefore: retentionCutoff(nowMs, days.verifiedAttestation, "retention.verifiedAttestationDays"),
    rejectedAttestationAcceptedBefore: retentionCutoff(nowMs, days.rejectedAttestation, "retention.rejectedAttestationDays"),
    legacyAttestationAuditBefore: retentionCutoff(nowMs, days.legacyAttestationAudit, "retention.legacyAttestationAuditDays"),
    checkDeliveryUpdatedBefore: retentionCutoff(nowMs, days.checkDelivery, "retention.checkDeliveryDays"),
    revokedRunnerKeyBefore: retentionCutoff(nowMs, days.revokedRunnerKey, "retention.revokedRunnerKeyDays")
  };
}

export function purgeExpiredControlPlaneData(
  db: TransactionalSqlDatabase,
  input: { now: string; policyDays?: ControlPlaneRetentionPolicyDays }
): ControlPlaneRetentionPurgeResult {
  const cutoffs = controlPlaneRetentionCutoffs(input);
  db.exec("BEGIN IMMEDIATE");
  try {
    const deleted = {
      webhookDeliveries: deleteRows(db, "DELETE FROM webhook_deliveries WHERE retention_delete_after <= ?", cutoffs.now),
      unfinishedReviewChallenges: deleteRows(db, `
DELETE FROM review_challenges
WHERE status IN ('PENDING', 'LEASED', 'SUBMITTED')
  AND created_at <= ?
`, cutoffs.unfinishedChallengeCreatedBefore),
      verifiedAttestations: 0,
      rejectedAttestations: 0,
      legacyAttestationMigrations: deleteRows(db, "DELETE FROM legacy_attestation_migrations WHERE migrated_at <= ?", cutoffs.legacyAttestationAuditBefore),
      checkDeliveries: deleteRows(db, "DELETE FROM check_deliveries WHERE updated_at <= ?", cutoffs.checkDeliveryUpdatedBefore),
      runnerKeyRotationWindows: deleteRows(db, `
DELETE FROM runner_key_rotation_windows
WHERE previous_runner_id IN (
  SELECT runner_id FROM runner_identities
  WHERE status = 'revoked' AND revoked_at <= ?
)
OR next_runner_id IN (
  SELECT runner_id FROM runner_identities
  WHERE status = 'revoked' AND revoked_at <= ?
)
`, cutoffs.revokedRunnerKeyBefore, cutoffs.revokedRunnerKeyBefore),
      runnerIdentityRepositories: deleteRows(db, `
DELETE FROM runner_identity_repositories
WHERE runner_id IN (
  SELECT runner_id FROM runner_identities
  WHERE status = 'revoked' AND revoked_at <= ?
)
`, cutoffs.revokedRunnerKeyBefore),
      revokedRunnerIdentities: 0
    };

    db.prepare(`
INSERT OR REPLACE INTO retention_purge_authorizations (table_name, authorized_at)
VALUES ('attestations', ?)
`).run(cutoffs.now);
    deleted.verifiedAttestations = deleteRows(db, `
DELETE FROM attestations
WHERE result = 'pass'
  AND accepted_at <= ?
`, cutoffs.verifiedAttestationAcceptedBefore);
    deleted.rejectedAttestations = deleteRows(db, `
DELETE FROM attestations
WHERE result IN ('fail', 'error')
  AND accepted_at <= ?
`, cutoffs.rejectedAttestationAcceptedBefore);
    deleteRows(db, "DELETE FROM retention_purge_authorizations WHERE table_name = 'attestations'");

    deleted.revokedRunnerIdentities = deleteRows(db, `
DELETE FROM runner_identities
WHERE status = 'revoked'
  AND revoked_at <= ?
`, cutoffs.revokedRunnerKeyBefore);

    db.exec("COMMIT");
    return {
      schemaVersion: "archcontext.control-plane-retention-purge/v1",
      now: cutoffs.now,
      cutoffs,
      deleted
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function persistAcceptedAttestationSubmission(db: TransactionalSqlDatabase, input: PersistAcceptedAttestationSubmissionInput): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const challenge = db.prepare(`
SELECT challenge_id, nonce_hash, status, consumed_at
FROM review_challenges
WHERE challenge_id = ?
`).get(input.challengeId) as { challenge_id: string; nonce_hash: string; status: string; consumed_at: string | null } | null | undefined;
    if (!challenge) throw new Error("review-challenge-not-found");
    if (challenge.nonce_hash !== input.nonceHash) throw new Error("review-challenge-nonce-mismatch");
    if (challenge.consumed_at !== null || challenge.status !== "LEASED") throw new Error("review-challenge-not-submittable");

    insertAcceptedAttestationRow(db, input.attestation);
    if (input.checkDelivery) insertPendingCheckDeliveryRow(db, input.checkDelivery);
    const updated = db.prepare(`
UPDATE review_challenges
SET status = 'SUBMITTED',
    consumed_at = ?,
    lease_owner = NULL,
    lease_expires_at = NULL
WHERE challenge_id = ?
  AND nonce_hash = ?
  AND status = 'LEASED'
  AND consumed_at IS NULL
`).run(input.acceptedAt, input.challengeId, input.nonceHash);
    if (runChanges(updated) !== 1) throw new Error("review-challenge-submit-transition-conflict");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function persistPendingCheckDelivery(db: TransactionalSqlDatabase, row: PendingCheckDeliveryPersistenceRow): void {
  insertPendingCheckDeliveryRow(db, row);
}

function insertAcceptedAttestationRow(db: TransactionalSqlDatabase, row: AcceptedAttestationPersistenceRow): void {
  db.prepare(`
INSERT INTO attestations (
  attestation_id,
  schema_version,
  challenge_id,
  installation_id,
  repository_id,
  pull_request_number,
  head_sha,
  base_sha,
  merge_base_sha,
  head_tree_oid,
  worktree_digest,
  model_digest,
  policy_digest,
  code_facts_digest,
  review_digest,
  result,
  error_code,
  execution_trust_level,
  execution_origin,
  principal_id,
  public_key_id,
  runtime_version,
  runtime_build_digest,
  runtime_graph_version,
  runtime_capabilities_digest,
  nonce_hash,
  signature_algorithm,
  signature_present,
  started_at,
  completed_at,
  expires_at,
  accepted_at,
  payload_digest,
  migration_status
) VALUES (
  ?, 'archcontext.attestation/v2', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ed25519', ?, ?, ?, ?, ?, ?, 'native-v2'
)
`).run(
    row.attestationId,
    row.challengeId,
    row.installationId,
    row.repositoryId,
    row.pullRequestNumber,
    row.headSha,
    row.baseSha,
    row.mergeBaseSha,
    row.headTreeOid,
    row.worktreeDigest,
    row.modelDigest,
    row.policyDigest,
    row.codeFactsDigest,
    row.reviewDigest,
    row.result,
    row.errorCode ?? null,
    row.executionTrustLevel,
    row.executionOrigin,
    row.principalId,
    row.publicKeyId,
    row.runtimeVersion,
    row.runtimeBuildDigest,
    row.runtimeGraphVersion,
    row.runtimeCapabilitiesDigest,
    row.nonceHash,
    row.signaturePresent ? 1 : 0,
    row.startedAt,
    row.completedAt,
    row.expiresAt,
    row.acceptedAt,
    row.payloadDigest
  );
}

function insertPendingCheckDeliveryRow(db: TransactionalSqlDatabase, row: PendingCheckDeliveryPersistenceRow): void {
  db.prepare(`
INSERT INTO check_deliveries (
  delivery_id,
  challenge_id,
  check_run_id,
  check_name,
  head_sha,
  status,
  attempt_count,
  next_attempt_at,
  last_error_code,
  created_at,
  updated_at
) VALUES (
  ?, ?, NULL, ?, ?, 'PENDING', 0, NULL, NULL, ?, ?
)
`).run(
    row.deliveryId,
    row.challengeId,
    row.checkName,
    row.headSha,
    row.createdAt,
    row.updatedAt
  );
}

function runChanges(result: unknown): number | undefined {
  if (!result || typeof result !== "object" || !("changes" in result)) return undefined;
  const value = (result as { changes?: unknown }).changes;
  return typeof value === "number" ? value : undefined;
}

function deleteRows(db: TransactionalSqlDatabase, sql: string, ...params: unknown[]): number {
  return runChanges(db.prepare(sql).run(...params)) ?? 0;
}

function requireFiniteTime(value: string, field: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${field}-invalid`);
  return time;
}

function retentionCutoff(nowMs: number, days: number, field: string): string {
  if (!Number.isFinite(days) || days < 0) throw new Error(`${field}-invalid`);
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}
