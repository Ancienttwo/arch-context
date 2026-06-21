import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertD1PrivacySchema, checkDeliveryIdempotencyKey, controlPlaneRetentionCutoffs, DEFAULT_CONTROL_PLANE_RETENTION_DAYS, d1MigrationSql, highFrequencyIndexes, persistAcceptedAttestationSubmission, purgeExpiredControlPlaneData } from "../src/index";

interface ReviewChallengeRow {
  challengeId?: string;
  installationId?: number;
  repositoryId?: number;
  pullRequestNumber?: number;
  headSha?: string;
  baseSha?: string;
  requiredTrust?: "developer" | "organization";
  policyProfileId?: string;
  nonceHash?: string;
  status?: "PENDING" | "LEASED" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "SUPERSEDED" | "EXPIRED";
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
  createdAt?: string;
  expiresAt?: string;
  supersededBy?: string | null;
  consumedAt?: string | null;
}

interface AttestationRow {
  attestationId?: string;
  challengeId?: string;
  repositoryId?: number;
  nonceHash?: string;
  payloadDigest?: string;
  result?: "pass" | "fail" | "error";
  acceptedAt?: string;
}

interface DeviceIdentityRow {
  deviceId?: string;
  accountId?: string;
  publicKeyId?: string;
  publicKeyFingerprint?: string;
  status?: "active" | "revoked";
  revokedAt?: string | null;
}

interface RunnerIdentityRow {
  runnerId?: string;
  installationId?: number;
  scopeKind?: "repository" | "organization";
  workflowRef?: string;
  publicKeyId?: string;
  publicKeyFingerprint?: string;
  status?: "active" | "rotating" | "revoked";
  rotatedAt?: string | null;
  revokedAt?: string | null;
  terminationKind?: "revoked" | "unregistered" | null;
}

interface CheckDeliveryRow {
  deliveryId?: string;
  challengeId?: string;
  checkRunId?: string | null;
  checkName?: "ArchContext / Developer Review" | "ArchContext / Organization Runner" | string;
  headSha?: string;
  status?: "PENDING" | "PUBLISHED" | "RETRYING" | "DEAD_LETTER" | string;
  attemptCount?: number;
  nextAttemptAt?: string | null;
  lastErrorCode?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface WebhookDeliveryRow {
  provider?: string;
  deliveryId?: string;
  eventType?: string;
  projectedDigest?: string;
  receivedAt?: string;
  processedAt?: string | null;
  retentionDeleteAfter?: string;
}

describe("cloud D1 schema", () => {
  test("stores metadata only and indexes high-frequency queries", () => {
    const sql = d1MigrationSql();
    expect(() => assertD1PrivacySchema()).not.toThrow();
    expect(highFrequencyIndexes()).toContain("idx_challenges_repo_head");
    expect(highFrequencyIndexes()).toContain("idx_challenges_current_lookup");
    expect(highFrequencyIndexes()).toContain("idx_challenges_status_expiry");
    expect(highFrequencyIndexes()).toContain("idx_challenges_lease_expiry");
    expect(highFrequencyIndexes()).toContain("ux_review_challenges_active_identity");
    expect(highFrequencyIndexes()).toContain("ux_device_identities_account_public_key");
    expect(highFrequencyIndexes()).toContain("idx_device_identities_account_status");
    expect(highFrequencyIndexes()).toContain("ux_attestations_challenge");
    expect(highFrequencyIndexes()).toContain("ux_attestations_payload_digest");
    expect(highFrequencyIndexes()).toContain("idx_attestations_repo_head");
    expect(highFrequencyIndexes()).toContain("idx_attestations_retention");
    expect(highFrequencyIndexes()).toContain("idx_legacy_attestation_migrations_challenge");
    expect(highFrequencyIndexes()).toContain("idx_legacy_attestation_migrations_retention");
    expect(highFrequencyIndexes()).toContain("ux_runner_identities_public_key");
    expect(highFrequencyIndexes()).toContain("idx_runner_identities_installation_status");
    expect(highFrequencyIndexes()).toContain("idx_runner_identities_revoked_retention");
    expect(highFrequencyIndexes()).toContain("idx_runner_identity_repositories_repository");
    expect(highFrequencyIndexes()).toContain("idx_runner_key_rotation_next");
    expect(highFrequencyIndexes()).toContain("idx_check_deliveries_challenge");
    expect(highFrequencyIndexes()).toContain("idx_check_deliveries_next_attempt");
    expect(highFrequencyIndexes()).toContain("idx_check_deliveries_head_context");
    expect(highFrequencyIndexes()).toContain("idx_check_deliveries_retention");
    expect(highFrequencyIndexes()).toContain("idx_webhook_deliveries_event_type");
    expect(highFrequencyIndexes()).toContain("idx_webhook_deliveries_retention");
    expect(sql).toContain("review_challenges");
    expect(sql).toContain("billing_interval");
    expect(sql).toContain("device_identities");
    expect(sql).toContain("runner_identities");
    expect(sql).toContain("runner_identity_repositories");
    expect(sql).toContain("runner_key_rotation_windows");
    expect(sql).toContain("check_deliveries");
    expect(sql).not.toContain("repository_numeric_ids_json");
    expect(sql).toContain("webhook_deliveries");
    expect(sql).toContain("PRIMARY KEY(provider, delivery_id)");
    expect(highFrequencyIndexes()).toContain("idx_deliveries_provider");
    expect(sql.toLowerCase()).not.toContain("raw_body");
  });

  test("review challenge persistence enforces active identity uniqueness", () => {
    const sql = d1MigrationSql();

    for (const column of [
      "installation_id INTEGER NOT NULL",
      "repository_id INTEGER NOT NULL",
      "pull_request_number INTEGER NOT NULL",
      "head_sha TEXT NOT NULL",
      "base_sha TEXT NOT NULL",
      "required_trust TEXT NOT NULL",
      "policy_profile_id TEXT NOT NULL",
      "nonce_hash TEXT NOT NULL UNIQUE",
      "status TEXT NOT NULL"
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).not.toContain("nonce TEXT NOT NULL");
    expect(sql).toContain("ON review_challenges(installation_id, repository_id, pull_request_number, head_sha, required_trust)");
    expect(sql).toContain("WHERE status IN ('PENDING', 'LEASED', 'SUBMITTED')");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_challenges_current_lookup ON review_challenges(repository_id, pull_request_number, head_sha, required_trust, status)");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_challenges_lease_expiry ON review_challenges(status, lease_expires_at)");
    expect(sql).toContain("CHECK(required_trust IN ('developer', 'organization'))");
    expect(sql).toContain("CHECK(status IN ('PENDING', 'LEASED', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'SUPERSEDED', 'EXPIRED'))");
    expect(sql).toContain("CHECK(lease_expires_at IS NULL OR lease_expires_at <= expires_at)");
    expect(sql).toContain("CHECK(consumed_at IS NULL OR status IN ('SUBMITTED', 'VERIFIED', 'REJECTED'))");
    expect(sql).toContain("CHECK(superseded_by IS NULL OR status = 'SUPERSEDED')");
  });

  test("review challenge migration executes and enforces durable identity constraints", () => {
    const db = migratedDb();
    try {
      insertReviewChallenge(db);

      expect(() => insertReviewChallenge(db, {
        challengeId: "chal_duplicate_active",
        nonceHash: "sha256:nonce-duplicate-active"
      })).toThrow();

      expect(() => insertReviewChallenge(db, {
        challengeId: "chal_duplicate_nonce",
        repositoryId: 987654321,
        nonceHash: "sha256:nonce-base"
      })).toThrow();

      expect(() => insertReviewChallenge(db, {
        challengeId: "chal_terminal_retry",
        nonceHash: "sha256:nonce-terminal-retry",
        status: "REJECTED",
        consumedAt: "2026-06-21T14:02:00.000Z"
      })).not.toThrow();

      expect(() => insertReviewChallenge(db, {
        challengeId: "chal_organization_parallel",
        nonceHash: "sha256:nonce-organization",
        requiredTrust: "organization"
      })).not.toThrow();

      expect(() => insertReviewChallenge(db, {
        challengeId: "chal_bad_lease",
        repositoryId: 987654322,
        nonceHash: "sha256:nonce-bad-lease",
        status: "LEASED",
        leaseOwner: "device-1",
        leaseExpiresAt: "2026-06-21T14:20:00.000Z",
        expiresAt: "2026-06-21T14:15:00.000Z"
      })).toThrow();

      expect(() => insertReviewChallenge(db, {
        challengeId: "chal_bad_consumed",
        repositoryId: 987654323,
        nonceHash: "sha256:nonce-bad-consumed",
        status: "PENDING",
        consumedAt: "2026-06-21T14:02:00.000Z"
      })).toThrow();

      expect(() => insertReviewChallenge(db, {
        challengeId: "chal_bad_supersede",
        repositoryId: 987654324,
        nonceHash: "sha256:nonce-bad-supersede",
        status: "PENDING",
        supersededBy: "chal_next"
      })).toThrow();
    } finally {
      db.close();
    }
  });

  test("device key persistence stores only metadata and revocation status", () => {
    const sql = d1MigrationSql();

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS device_identities");
    for (const column of [
      "device_id TEXT PRIMARY KEY",
      "account_id TEXT NOT NULL",
      "public_key_id TEXT NOT NULL",
      "public_key_fingerprint TEXT NOT NULL",
      "status TEXT NOT NULL CHECK(status IN ('active', 'revoked'))",
      "created_at TEXT NOT NULL",
      "revoked_at TEXT"
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS ux_device_identities_account_public_key ON device_identities(account_id, public_key_id)");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_device_identities_account_status ON device_identities(account_id, status)");
    expect(sql).toContain("CHECK(length(public_key_fingerprint) = 71 AND substr(public_key_fingerprint, 1, 7) = 'sha256:')");
    expect(sql).toContain("CHECK(status != 'active' OR revoked_at IS NULL)");
    expect(sql).toContain("CHECK(status != 'revoked' OR revoked_at IS NOT NULL)");
    expect(sql).not.toContain("private_key");
    expect(sql).not.toContain("public_key_body");
  });

  test("device and runner identity migrations enforce key lifecycle metadata", () => {
    const db = migratedDb();
    try {
      insertDeviceIdentity(db);
      expect(() => insertDeviceIdentity(db, {
        deviceId: "dev_duplicate_key",
        publicKeyFingerprint: fingerprint("device-2")
      })).toThrow();
      expect(() => insertDeviceIdentity(db, {
        deviceId: "dev_invalid_fingerprint",
        publicKeyId: "device-key-invalid",
        publicKeyFingerprint: "sha256:not-long-enough"
      })).toThrow();
      expect(() => insertDeviceIdentity(db, {
        deviceId: "dev_active_revoked_at",
        publicKeyId: "device-key-active-revoked",
        publicKeyFingerprint: fingerprint("device-active-revoked"),
        revokedAt: "2026-06-21T14:03:00.000Z"
      })).toThrow();
      expect(() => insertDeviceIdentity(db, {
        deviceId: "dev_revoked_missing_time",
        publicKeyId: "device-key-revoked-missing",
        publicKeyFingerprint: fingerprint("device-revoked-missing"),
        status: "revoked"
      })).toThrow();

      insertRunnerIdentity(db);
      insertRunnerIdentity(db, {
        runnerId: "runner_repo",
        scopeKind: "repository",
        publicKeyId: "runner-key-repo",
        publicKeyFingerprint: fingerprint("runner-repo")
      });
      insertRunnerRepository(db, "runner_repo", 987654320);

      expect(() => insertRunnerIdentity(db, {
        runnerId: "runner_duplicate_key",
        publicKeyFingerprint: fingerprint("runner-duplicate")
      })).toThrow();
      expect(() => insertRunnerIdentity(db, {
        runnerId: "runner_invalid_fingerprint",
        publicKeyId: "runner-key-invalid",
        publicKeyFingerprint: "sha256:not-long-enough"
      })).toThrow();
      expect(() => insertRunnerIdentity(db, {
        runnerId: "runner_rotating_missing_time",
        publicKeyId: "runner-key-rotating-missing",
        publicKeyFingerprint: fingerprint("runner-rotating-missing"),
        status: "rotating"
      })).toThrow();
      expect(() => insertRunnerIdentity(db, {
        runnerId: "runner_revoked_missing_time",
        publicKeyId: "runner-key-revoked-missing",
        publicKeyFingerprint: fingerprint("runner-revoked-missing"),
        status: "revoked"
      })).toThrow();
      expect(() => insertRunnerIdentity(db, {
        runnerId: "runner_termination_without_revoke",
        publicKeyId: "runner-key-termination",
        publicKeyFingerprint: fingerprint("runner-termination"),
        terminationKind: "unregistered"
      })).toThrow();
      expect(() => insertRunnerRepository(db, "runner_repo", 987654320)).toThrow();

      insertRunnerIdentity(db, {
        runnerId: "runner_next",
        publicKeyId: "runner-key-next",
        publicKeyFingerprint: fingerprint("runner-next")
      });
      insertRunnerRotationWindow(db);
      expect(() => insertRunnerRotationWindow(db, {
        previousRunnerId: "runner_bad_window",
        nextRunnerId: "runner_next_bad_window",
        overlapUntil: "2026-06-21T14:00:00.000Z"
      })).toThrow();
    } finally {
      db.close();
    }
  });

  test("attestation persistence is v2-only and migrates v1 as audit-only metadata", () => {
    const sql = d1MigrationSql();

    for (const column of [
      "schema_version TEXT NOT NULL CHECK(schema_version = 'archcontext.attestation/v2')",
      "installation_id INTEGER NOT NULL",
      "repository_id INTEGER NOT NULL",
      "pull_request_number INTEGER NOT NULL",
      "base_sha TEXT NOT NULL",
      "merge_base_sha TEXT NOT NULL",
      "head_tree_oid TEXT NOT NULL",
      "model_digest TEXT NOT NULL",
      "policy_digest TEXT NOT NULL",
      "code_facts_digest TEXT NOT NULL",
      "execution_trust_level TEXT NOT NULL",
      "execution_origin TEXT NOT NULL",
      "principal_id TEXT NOT NULL",
      "public_key_id TEXT NOT NULL",
      "runtime_build_digest TEXT NOT NULL",
      "runtime_graph_version TEXT NOT NULL",
      "runtime_capabilities_digest TEXT NOT NULL",
      "nonce_hash TEXT NOT NULL",
      "signature_algorithm TEXT NOT NULL",
      "payload_digest TEXT NOT NULL UNIQUE",
      "migration_status TEXT NOT NULL DEFAULT 'native-v2'"
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain("CHECK(length(payload_digest) = 71 AND substr(payload_digest, 1, 7) = 'sha256:')");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS retention_purge_authorizations");
    expect(sql).toContain("CREATE TRIGGER IF NOT EXISTS trg_attestations_append_only_no_update");
    expect(sql).toContain("CREATE TRIGGER IF NOT EXISTS trg_attestations_append_only_no_delete");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS ux_attestations_challenge ON attestations(challenge_id)");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS ux_attestations_payload_digest ON attestations(payload_digest)");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS legacy_attestation_migrations");
    expect(sql).toContain("legacy_schema_version TEXT NOT NULL CHECK(legacy_schema_version = 'archcontext.attestation/v1')");
    expect(sql).toContain("target_schema_version TEXT NOT NULL CHECK(target_schema_version = 'archcontext.attestation/v2')");
    expect(sql).toContain("required_check_eligible INTEGER NOT NULL CHECK(required_check_eligible = 0)");
    expect(sql).toContain("rejection_reason_code TEXT NOT NULL CHECK(rejection_reason_code = 'ATTESTATION_SCHEMA_UNSUPPORTED')");
    expect(sql).not.toContain("schema_version TEXT NOT NULL CHECK(schema_version = 'archcontext.attestation/v1')");
    expect(sql).not.toContain("nonce TEXT NOT NULL");
  });

  test("attestation persistence is append-only and stores a stable payload digest", () => {
    const db = migratedDb();
    try {
      insertAttestation(db);

      expect(() => insertAttestation(db, {
        attestationId: "att_duplicate_challenge",
        nonceHash: digest("2"),
        payloadDigest: digest("2")
      })).toThrow();

      expect(() => insertAttestation(db, {
        attestationId: "att_duplicate_payload",
        challengeId: "chal_other",
        nonceHash: digest("3")
      })).toThrow();

      expect(() => insertAttestation(db, {
        attestationId: "att_invalid_payload",
        challengeId: "chal_invalid_payload",
        nonceHash: digest("4"),
        payloadDigest: "sha256:not-long-enough"
      })).toThrow();

      expect(() => db.exec("UPDATE attestations SET result = 'fail' WHERE attestation_id = 'att_base'")).toThrow();
      expect(() => db.exec("DELETE FROM attestations WHERE attestation_id = 'att_base'")).toThrow();
    } finally {
      db.close();
    }
  });

  test("attestation submit transaction persists row and consumes Challenge nonce atomically", () => {
    const db = migratedDb();
    try {
      insertReviewChallenge(db, {
        challengeId: "chal_submit_tx",
        nonceHash: digest("nonce-submit-tx"),
        status: "LEASED",
        leaseOwner: "device-1",
        leaseExpiresAt: "2026-06-21T14:10:00.000Z"
      });

      persistAcceptedAttestationSubmission(db, {
        challengeId: "chal_submit_tx",
        nonceHash: digest("nonce-submit-tx"),
        acceptedAt: "2026-06-21T14:02:01.000Z",
        attestation: acceptedAttestationRow({
          attestationId: "att_submit_tx",
          challengeId: "chal_submit_tx",
          nonceHash: digest("nonce-submit-tx"),
          payloadDigest: digest("payload-submit-tx")
        }),
        checkDelivery: {
          deliveryId: checkDeliveryIdempotencyKey({
            challengeId: "chal_submit_tx",
            checkName: "ArchContext / Developer Review",
            headSha: "a".repeat(40)
          }),
          challengeId: "chal_submit_tx",
          checkName: "ArchContext / Developer Review",
          headSha: "a".repeat(40),
          createdAt: "2026-06-21T14:02:01.000Z",
          updatedAt: "2026-06-21T14:02:01.000Z"
        }
      });

      expect(db.query("SELECT status, consumed_at, lease_owner, lease_expires_at FROM review_challenges WHERE challenge_id = ?").get("chal_submit_tx")).toEqual({
        status: "SUBMITTED",
        consumed_at: "2026-06-21T14:02:01.000Z",
        lease_owner: null,
        lease_expires_at: null
      });
      expect(db.query("SELECT COUNT(*) AS count FROM attestations WHERE challenge_id = ?").get("chal_submit_tx")).toEqual({ count: 1 });
      expect(db.query("SELECT status, attempt_count, check_run_id, next_attempt_at, last_error_code FROM check_deliveries WHERE challenge_id = ?").get("chal_submit_tx")).toEqual({
        status: "PENDING",
        attempt_count: 0,
        check_run_id: null,
        next_attempt_at: null,
        last_error_code: null
      });

      expect(() => persistAcceptedAttestationSubmission(db, {
        challengeId: "chal_submit_tx",
        nonceHash: digest("nonce-submit-tx-wrong"),
        acceptedAt: "2026-06-21T14:02:02.000Z",
        attestation: acceptedAttestationRow({
          attestationId: "att_submit_tx_wrong_nonce",
          challengeId: "chal_submit_tx",
          nonceHash: digest("nonce-submit-tx-wrong"),
          payloadDigest: digest("payload-submit-tx-wrong-nonce")
        })
      })).toThrow("review-challenge-nonce-mismatch");
      expect(() => persistAcceptedAttestationSubmission(db, {
        challengeId: "chal_submit_tx",
        nonceHash: digest("nonce-submit-tx"),
        acceptedAt: "2026-06-21T14:02:03.000Z",
        attestation: acceptedAttestationRow({
          attestationId: "att_submit_tx_already_submitted",
          challengeId: "chal_submit_tx",
          nonceHash: digest("nonce-submit-tx"),
          payloadDigest: digest("payload-submit-tx-already-submitted")
        })
      })).toThrow("review-challenge-not-submittable");
      expect(db.query("SELECT COUNT(*) AS count FROM attestations WHERE challenge_id = ?").get("chal_submit_tx")).toEqual({ count: 1 });

      insertReviewChallenge(db, {
        challengeId: "chal_submit_tx_rollback",
        repositoryId: 987654321,
        nonceHash: digest("nonce-submit-tx-rollback"),
        status: "LEASED",
        leaseOwner: "device-rollback",
        leaseExpiresAt: "2026-06-21T14:10:00.000Z"
      });
      expect(() => persistAcceptedAttestationSubmission(db, {
        challengeId: "chal_submit_tx_rollback",
        nonceHash: digest("nonce-submit-tx-rollback"),
        acceptedAt: "2026-06-21T14:03:01.000Z",
        attestation: acceptedAttestationRow({
          attestationId: "att_submit_tx_rollback",
          challengeId: "chal_submit_tx_rollback",
          repositoryId: 987654321,
          nonceHash: digest("nonce-submit-tx-rollback"),
          payloadDigest: "sha256:not-long-enough"
        })
      })).toThrow();
      expect(db.query("SELECT status, consumed_at, lease_owner, lease_expires_at FROM review_challenges WHERE challenge_id = ?").get("chal_submit_tx_rollback")).toEqual({
        status: "LEASED",
        consumed_at: null,
        lease_owner: "device-rollback",
        lease_expires_at: "2026-06-21T14:10:00.000Z"
      });
      expect(db.query("SELECT COUNT(*) AS count FROM attestations WHERE challenge_id = ?").get("chal_submit_tx_rollback")).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  test("transaction fault injection rolls back Attestation Check delivery and nonce consumption", () => {
    const db = migratedDb();
    try {
      insertReviewChallenge(db, {
        challengeId: "chal_submit_tx_check_fault",
        repositoryId: 987654341,
        nonceHash: digest("nonce-submit-tx-check-fault"),
        status: "LEASED",
        leaseOwner: "device-check-fault",
        leaseExpiresAt: "2026-06-21T14:10:00.000Z"
      });
      expect(() => persistAcceptedAttestationSubmission(faultingDatabase(db, {
        failOnSql: /INSERT INTO check_deliveries/i,
        message: "injected-check-delivery-failure"
      }), {
        challengeId: "chal_submit_tx_check_fault",
        nonceHash: digest("nonce-submit-tx-check-fault"),
        acceptedAt: "2026-06-21T14:03:01.000Z",
        attestation: acceptedAttestationRow({
          attestationId: "att_submit_tx_check_fault",
          challengeId: "chal_submit_tx_check_fault",
          repositoryId: 987654341,
          nonceHash: digest("nonce-submit-tx-check-fault"),
          payloadDigest: digest("payload-submit-tx-check-fault")
        }),
        checkDelivery: {
          deliveryId: checkDeliveryIdempotencyKey({
            challengeId: "chal_submit_tx_check_fault",
            checkName: "ArchContext / Developer Review",
            headSha: "a".repeat(40)
          }),
          challengeId: "chal_submit_tx_check_fault",
          checkName: "ArchContext / Developer Review",
          headSha: "a".repeat(40),
          createdAt: "2026-06-21T14:03:01.000Z",
          updatedAt: "2026-06-21T14:03:01.000Z"
        }
      })).toThrow("injected-check-delivery-failure");
      expectSubmitTransactionRolledBack(db, {
        challengeId: "chal_submit_tx_check_fault",
        leaseOwner: "device-check-fault",
        leaseExpiresAt: "2026-06-21T14:10:00.000Z"
      });

      insertReviewChallenge(db, {
        challengeId: "chal_submit_tx_update_fault",
        repositoryId: 987654342,
        nonceHash: digest("nonce-submit-tx-update-fault"),
        status: "LEASED",
        leaseOwner: "device-update-fault",
        leaseExpiresAt: "2026-06-21T14:11:00.000Z"
      });
      expect(() => persistAcceptedAttestationSubmission(faultingDatabase(db, {
        failOnSql: /UPDATE review_challenges/i,
        message: "injected-challenge-update-failure"
      }), {
        challengeId: "chal_submit_tx_update_fault",
        nonceHash: digest("nonce-submit-tx-update-fault"),
        acceptedAt: "2026-06-21T14:04:01.000Z",
        attestation: acceptedAttestationRow({
          attestationId: "att_submit_tx_update_fault",
          challengeId: "chal_submit_tx_update_fault",
          repositoryId: 987654342,
          nonceHash: digest("nonce-submit-tx-update-fault"),
          payloadDigest: digest("payload-submit-tx-update-fault")
        }),
        checkDelivery: {
          deliveryId: checkDeliveryIdempotencyKey({
            challengeId: "chal_submit_tx_update_fault",
            checkName: "ArchContext / Developer Review",
            headSha: "a".repeat(40)
          }),
          challengeId: "chal_submit_tx_update_fault",
          checkName: "ArchContext / Developer Review",
          headSha: "a".repeat(40),
          createdAt: "2026-06-21T14:04:01.000Z",
          updatedAt: "2026-06-21T14:04:01.000Z"
        }
      })).toThrow("injected-challenge-update-failure");
      expectSubmitTransactionRolledBack(db, {
        challengeId: "chal_submit_tx_update_fault",
        leaseOwner: "device-update-fault",
        leaseExpiresAt: "2026-06-21T14:11:00.000Z"
      });
    } finally {
      db.close();
    }
  });

  test("durable integration E2E persists Challenge Attestation Key and Delivery state across restart", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-fg5-eg1-"));
    const dbPath = join(root, "control-plane.sqlite");
    let activeDb: Database | null = null;
    try {
      const firstDb = new Database(dbPath);
      activeDb = firstDb;
      firstDb.exec(d1MigrationSql());
      insertDeviceIdentity(firstDb, {
        deviceId: "dev_restart",
        accountId: "acct_restart",
        publicKeyId: "device-key-restart",
        publicKeyFingerprint: fingerprint("device-restart")
      });
      insertRunnerIdentity(firstDb, {
        runnerId: "runner_restart",
        publicKeyId: "runner-key-restart",
        publicKeyFingerprint: fingerprint("runner-restart")
      });
      insertRunnerRepository(firstDb, "runner_restart", 987654320);
      insertReviewChallenge(firstDb, {
        challengeId: "chal_restart",
        nonceHash: digest("nonce-restart"),
        status: "LEASED",
        leaseOwner: "dev_restart",
        leaseExpiresAt: "2026-06-21T14:10:00.000Z"
      });
      const deliveryId = checkDeliveryIdempotencyKey({
        challengeId: "chal_restart",
        checkName: "ArchContext / Developer Review",
        headSha: "a".repeat(40)
      });
      persistAcceptedAttestationSubmission(firstDb, {
        challengeId: "chal_restart",
        nonceHash: digest("nonce-restart"),
        acceptedAt: "2026-06-21T14:02:01.000Z",
        attestation: acceptedAttestationRow({
          attestationId: "att_restart",
          challengeId: "chal_restart",
          nonceHash: digest("nonce-restart"),
          payloadDigest: digest("payload-restart")
        }),
        checkDelivery: {
          deliveryId,
          challengeId: "chal_restart",
          checkName: "ArchContext / Developer Review",
          headSha: "a".repeat(40),
          createdAt: "2026-06-21T14:02:01.000Z",
          updatedAt: "2026-06-21T14:02:01.000Z"
        }
      });
      firstDb.close();
      activeDb = null;

      const secondDb = new Database(dbPath);
      activeDb = secondDb;
      secondDb.exec(d1MigrationSql());
      expect(secondDb.query("SELECT status, consumed_at, lease_owner, lease_expires_at FROM review_challenges WHERE challenge_id = ?").get("chal_restart")).toEqual({
        status: "SUBMITTED",
        consumed_at: "2026-06-21T14:02:01.000Z",
        lease_owner: null,
        lease_expires_at: null
      });
      expect(secondDb.query("SELECT attestation_id, payload_digest, result FROM attestations WHERE challenge_id = ?").get("chal_restart")).toEqual({
        attestation_id: "att_restart",
        payload_digest: digest("payload-restart"),
        result: "pass"
      });
      expect(secondDb.query("SELECT device_id, account_id, public_key_id, status FROM device_identities WHERE device_id = ?").get("dev_restart")).toEqual({
        device_id: "dev_restart",
        account_id: "acct_restart",
        public_key_id: "device-key-restart",
        status: "active"
      });
      expect(secondDb.query("SELECT runner_id, installation_id, scope_kind, status FROM runner_identities WHERE runner_id = ?").get("runner_restart")).toEqual({
        runner_id: "runner_restart",
        installation_id: 12345,
        scope_kind: "organization",
        status: "active"
      });
      expect(secondDb.query("SELECT repository_id FROM runner_identity_repositories WHERE runner_id = ?").all("runner_restart")).toEqual([{ repository_id: 987654320 }]);
      expect(secondDb.query("SELECT delivery_id, status, attempt_count, check_run_id, next_attempt_at, last_error_code FROM check_deliveries WHERE challenge_id = ?").get("chal_restart")).toEqual({
        delivery_id: deliveryId,
        status: "PENDING",
        attempt_count: 0,
        check_run_id: null,
        next_attempt_at: null,
        last_error_code: null
      });
      expect(() => secondDb.exec("DELETE FROM attestations WHERE attestation_id = 'att_restart'")).toThrow("attestations are append-only");
    } finally {
      activeDb?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("concurrency idempotency suite keeps duplicate Webhook submit and queue writes to one domain result", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-fg5-eg2-"));
    const dbPath = join(root, "control-plane.sqlite");
    const openDbs: Database[] = [];
    const openDb = () => {
      const db = new Database(dbPath);
      openDbs.push(db);
      db.exec(d1MigrationSql());
      return db;
    };
    try {
      const firstDb = openDb();
      const secondDb = openDb();

      insertWebhookDelivery(firstDb, {
        deliveryId: "delivery_duplicate_webhook",
        projectedDigest: digest("webhook-duplicate")
      });
      expect(() => insertWebhookDelivery(secondDb, {
        deliveryId: "delivery_duplicate_webhook",
        projectedDigest: digest("webhook-duplicate-replayed")
      })).toThrow();
      expect(firstDb.query("SELECT COUNT(*) AS count FROM webhook_deliveries WHERE provider = 'github' AND delivery_id = ?").get("delivery_duplicate_webhook")).toEqual({ count: 1 });

      insertReviewChallenge(firstDb, {
        challengeId: "chal_duplicate_submit",
        nonceHash: digest("nonce-duplicate-submit"),
        status: "LEASED",
        leaseOwner: "dev_duplicate_submit",
        leaseExpiresAt: "2026-06-21T14:10:00.000Z"
      });
      const submitDeliveryId = checkDeliveryIdempotencyKey({
        challengeId: "chal_duplicate_submit",
        checkName: "ArchContext / Developer Review",
        headSha: "a".repeat(40)
      });
      const submitInput = {
        challengeId: "chal_duplicate_submit",
        nonceHash: digest("nonce-duplicate-submit"),
        acceptedAt: "2026-06-21T14:02:01.000Z",
        attestation: acceptedAttestationRow({
          attestationId: "att_duplicate_submit",
          challengeId: "chal_duplicate_submit",
          nonceHash: digest("nonce-duplicate-submit"),
          payloadDigest: digest("payload-duplicate-submit")
        }),
        checkDelivery: {
          deliveryId: submitDeliveryId,
          challengeId: "chal_duplicate_submit",
          checkName: "ArchContext / Developer Review" as const,
          headSha: "a".repeat(40),
          createdAt: "2026-06-21T14:02:01.000Z",
          updatedAt: "2026-06-21T14:02:01.000Z"
        }
      };
      persistAcceptedAttestationSubmission(firstDb, submitInput);
      expect(() => persistAcceptedAttestationSubmission(secondDb, submitInput)).toThrow("review-challenge-not-submittable");
      expect(firstDb.query("SELECT status, consumed_at FROM review_challenges WHERE challenge_id = ?").get("chal_duplicate_submit")).toEqual({
        status: "SUBMITTED",
        consumed_at: "2026-06-21T14:02:01.000Z"
      });
      expect(firstDb.query("SELECT COUNT(*) AS count FROM attestations WHERE challenge_id = ?").get("chal_duplicate_submit")).toEqual({ count: 1 });
      expect(firstDb.query("SELECT COUNT(*) AS count FROM check_deliveries WHERE delivery_id = ?").get(submitDeliveryId)).toEqual({ count: 1 });

      const queueDeliveryId = checkDeliveryIdempotencyKey({
        challengeId: "chal_duplicate_queue",
        checkName: "ArchContext / Developer Review",
        headSha: "a".repeat(40)
      });
      insertCheckDelivery(firstDb, {
        deliveryId: queueDeliveryId,
        challengeId: "chal_duplicate_queue"
      });
      expect(() => insertCheckDelivery(secondDb, {
        deliveryId: queueDeliveryId,
        challengeId: "chal_duplicate_queue"
      })).toThrow();
      expect(firstDb.query("SELECT delivery_id, status, attempt_count FROM check_deliveries WHERE delivery_id = ?").get(queueDeliveryId)).toEqual({
        delivery_id: queueDeliveryId,
        status: "PENDING",
        attempt_count: 0
      });
    } finally {
      for (const db of openDbs.reverse()) db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("check delivery persistence keeps retry state independent and bounded", () => {
    const sql = d1MigrationSql();

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS check_deliveries");
    expect(sql).toContain("status TEXT NOT NULL CHECK(status IN ('PENDING', 'PUBLISHED', 'RETRYING', 'DEAD_LETTER'))");
    expect(sql).toContain("attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0)");
    expect(sql).toContain("CHECK(status != 'PUBLISHED' OR check_run_id IS NOT NULL)");
    expect(sql).toContain("CHECK(status != 'RETRYING' OR next_attempt_at IS NOT NULL)");
    expect(sql).toContain("CHECK(status != 'DEAD_LETTER' OR last_error_code IS NOT NULL)");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_check_deliveries_next_attempt ON check_deliveries(status, next_attempt_at)");

    const db = migratedDb();
    try {
      insertCheckDelivery(db);
      const stableDeliveryId = checkDeliveryIdempotencyKey({
        challengeId: "chal_base",
        checkName: "ArchContext / Developer Review",
        headSha: "a".repeat(40)
      });
      expect(stableDeliveryId).toMatch(/^sha256:[a-f0-9]{64}$/);
      insertCheckDelivery(db, {
        deliveryId: stableDeliveryId
      });
      expect(() => insertCheckDelivery(db, {
        deliveryId: stableDeliveryId,
        checkName: "ArchContext / Organization Runner"
      })).toThrow();
      insertCheckDelivery(db, {
        deliveryId: "delivery_published",
        checkRunId: "82579129841",
        status: "PUBLISHED",
        attemptCount: 1,
        updatedAt: "2026-06-21T14:03:00.000Z"
      });
      insertCheckDelivery(db, {
        deliveryId: "delivery_retrying",
        status: "RETRYING",
        attemptCount: 2,
        nextAttemptAt: "2026-06-21T14:10:00.000Z",
        lastErrorCode: "HEAD_SHA_MISMATCH",
        updatedAt: "2026-06-21T14:04:00.000Z"
      });
      insertCheckDelivery(db, {
        deliveryId: "delivery_dead_letter",
        status: "DEAD_LETTER",
        attemptCount: 8,
        lastErrorCode: "SIGNATURE_INVALID",
        updatedAt: "2026-06-21T14:05:00.000Z"
      });

      expect(() => insertCheckDelivery(db, {
        checkName: "ArchContext / Organization Runner"
      })).toThrow();
      expect(() => insertCheckDelivery(db, {
        deliveryId: "delivery_published_missing_check",
        status: "PUBLISHED",
        attemptCount: 1
      })).toThrow();
      expect(() => insertCheckDelivery(db, {
        deliveryId: "delivery_retry_missing_next",
        status: "RETRYING",
        attemptCount: 1
      })).toThrow();
      expect(() => insertCheckDelivery(db, {
        deliveryId: "delivery_dlq_missing_error",
        status: "DEAD_LETTER",
        attemptCount: 8
      })).toThrow();
      expect(() => insertCheckDelivery(db, {
        deliveryId: "delivery_negative_attempt",
        attemptCount: -1
      })).toThrow();
      expect(() => insertCheckDelivery(db, {
        deliveryId: "delivery_wrong_check_name",
        checkName: "ArchContext / Unknown Check"
      })).toThrow();
    } finally {
      db.close();
    }
  });

  test("webhook delivery persistence stores projected metadata with retention bounds", () => {
    const sql = d1MigrationSql();

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS webhook_deliveries");
    expect(sql).toContain("event_type TEXT NOT NULL");
    expect(sql).toContain("projected_digest TEXT NOT NULL");
    expect(sql).toContain("processed_at TEXT");
    expect(sql).toContain("retention_delete_after TEXT NOT NULL");
    expect(sql).toContain("PRIMARY KEY(provider, delivery_id)");
    expect(sql).toContain("CHECK(processed_at IS NULL OR processed_at >= received_at)");
    expect(sql).toContain("CHECK(retention_delete_after > received_at)");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retention ON webhook_deliveries(retention_delete_after, provider)");
    expect(sql.toLowerCase()).not.toContain("raw_body");

    const db = migratedDb();
    try {
      insertWebhookDelivery(db);
      insertWebhookDelivery(db, {
        provider: "gitlab",
        eventType: "merge_request",
        projectedDigest: digest("webhook-gitlab")
      });

      expect(() => insertWebhookDelivery(db, {
        eventType: "pull_request.synchronize"
      })).toThrow();
      expect(() => insertWebhookDelivery(db, {
        deliveryId: "delivery_invalid_digest",
        projectedDigest: "sha256:not-long-enough"
      })).toThrow();
      expect(() => insertWebhookDelivery(db, {
        deliveryId: "delivery_processed_before_receive",
        processedAt: "2026-06-21T13:59:59.000Z"
      })).toThrow();
      expect(() => insertWebhookDelivery(db, {
        deliveryId: "delivery_retention_before_receive",
        retentionDeleteAfter: "2026-06-21T13:59:59.000Z"
      })).toThrow();
    } finally {
      db.close();
    }
  });

  test("retention purge deletes expired metadata while preserving append-only protections", () => {
    const db = migratedDb();
    try {
      expect(DEFAULT_CONTROL_PLANE_RETENTION_DAYS).toMatchObject({
        webhookDelivery: 30,
        unfinishedChallenge: 7,
        verifiedAttestation: 365,
        rejectedAttestation: 30,
        checkDelivery: 90,
        revokedRunnerKey: 365,
        rawWebhookBody: 0,
        privateContent: 0
      });
      expect(controlPlaneRetentionCutoffs({ now: "2026-06-21T14:00:00.000Z" })).toMatchObject({
        webhookDeliveryBefore: "2026-05-22T14:00:00.000Z",
        unfinishedChallengeCreatedBefore: "2026-06-14T14:00:00.000Z",
        verifiedAttestationAcceptedBefore: "2025-06-21T14:00:00.000Z",
        rejectedAttestationAcceptedBefore: "2026-05-22T14:00:00.000Z",
        checkDeliveryUpdatedBefore: "2026-03-23T14:00:00.000Z",
        revokedRunnerKeyBefore: "2025-06-21T14:00:00.000Z"
      });

      insertWebhookDelivery(db, {
        deliveryId: "delivery_webhook_expired",
        projectedDigest: digest("webhook-expired"),
        receivedAt: "2026-04-22T14:00:00.000Z",
        processedAt: "2026-04-22T14:00:01.000Z",
        retentionDeleteAfter: "2026-05-22T13:59:59.000Z"
      });
      insertWebhookDelivery(db, {
        deliveryId: "delivery_webhook_recent",
        projectedDigest: digest("webhook-recent"),
        receivedAt: "2026-05-22T14:00:01.000Z",
        processedAt: "2026-05-22T14:00:02.000Z",
        retentionDeleteAfter: "2026-06-21T14:00:01.000Z"
      });
      insertReviewChallenge(db, {
        challengeId: "chal_unfinished_expired",
        repositoryId: 987654331,
        nonceHash: digest("nonce-unfinished-expired"),
        createdAt: "2026-06-14T13:59:59.000Z",
        expiresAt: "2026-06-14T14:15:00.000Z"
      });
      insertReviewChallenge(db, {
        challengeId: "chal_unfinished_recent",
        repositoryId: 987654332,
        nonceHash: digest("nonce-unfinished-recent"),
        createdAt: "2026-06-14T14:00:01.000Z",
        expiresAt: "2026-06-14T14:15:01.000Z"
      });
      insertReviewChallenge(db, {
        challengeId: "chal_terminal_old",
        repositoryId: 987654333,
        nonceHash: digest("nonce-terminal-old"),
        status: "EXPIRED",
        createdAt: "2026-06-14T13:59:59.000Z",
        expiresAt: "2026-06-14T14:15:00.000Z"
      });
      insertAttestation(db, {
        attestationId: "att_verified_expired",
        challengeId: "chal_att_verified_expired",
        nonceHash: digest("nonce-att-verified-expired"),
        payloadDigest: digest("payload-att-verified-expired"),
        result: "pass",
        acceptedAt: "2025-06-21T13:59:59.000Z"
      });
      insertAttestation(db, {
        attestationId: "att_verified_recent",
        challengeId: "chal_att_verified_recent",
        nonceHash: digest("nonce-att-verified-recent"),
        payloadDigest: digest("payload-att-verified-recent"),
        result: "pass",
        acceptedAt: "2025-06-21T14:00:01.000Z"
      });
      insertAttestation(db, {
        attestationId: "att_rejected_expired",
        challengeId: "chal_att_rejected_expired",
        nonceHash: digest("nonce-att-rejected-expired"),
        payloadDigest: digest("payload-att-rejected-expired"),
        result: "fail",
        acceptedAt: "2026-05-22T13:59:59.000Z"
      });
      insertAttestation(db, {
        attestationId: "att_rejected_recent",
        challengeId: "chal_att_rejected_recent",
        nonceHash: digest("nonce-att-rejected-recent"),
        payloadDigest: digest("payload-att-rejected-recent"),
        result: "error",
        acceptedAt: "2026-05-22T14:00:01.000Z"
      });
      expect(() => db.exec("DELETE FROM attestations WHERE attestation_id = 'att_verified_expired'")).toThrow("attestations are append-only");

      insertLegacyAttestationMigration(db, "legacy_expired", "2026-05-22T13:59:59.000Z");
      insertLegacyAttestationMigration(db, "legacy_recent", "2026-05-22T14:00:01.000Z");
      insertCheckDelivery(db, {
        deliveryId: "delivery_check_expired",
        createdAt: "2026-03-23T13:00:00.000Z",
        updatedAt: "2026-03-23T13:59:59.000Z"
      });
      insertCheckDelivery(db, {
        deliveryId: "delivery_check_recent",
        createdAt: "2026-03-23T13:00:00.000Z",
        updatedAt: "2026-03-23T14:00:01.000Z"
      });
      insertRunnerIdentity(db, {
        runnerId: "runner_revoked_expired",
        publicKeyId: "runner-key-revoked-expired",
        publicKeyFingerprint: fingerprint("runner-revoked-expired"),
        status: "revoked",
        revokedAt: "2025-06-21T13:59:59.000Z",
        terminationKind: "revoked"
      });
      insertRunnerRepository(db, "runner_revoked_expired", 987654320);
      insertRunnerIdentity(db, {
        runnerId: "runner_recent_next",
        publicKeyId: "runner-key-recent-next",
        publicKeyFingerprint: fingerprint("runner-recent-next")
      });
      insertRunnerRotationWindow(db, {
        previousRunnerId: "runner_revoked_expired",
        nextRunnerId: "runner_recent_next",
        rotatedAt: "2025-06-21T13:00:00.000Z",
        overlapUntil: "2025-06-21T13:30:00.000Z"
      });
      insertRunnerIdentity(db, {
        runnerId: "runner_revoked_recent",
        publicKeyId: "runner-key-revoked-recent",
        publicKeyFingerprint: fingerprint("runner-revoked-recent"),
        status: "revoked",
        revokedAt: "2025-06-21T14:00:01.000Z",
        terminationKind: "revoked"
      });

      const result = purgeExpiredControlPlaneData(db, { now: "2026-06-21T14:00:00.000Z" });

      expect(result).toMatchObject({
        schemaVersion: "archcontext.control-plane-retention-purge/v1",
        now: "2026-06-21T14:00:00.000Z",
        deleted: {
          webhookDeliveries: 1,
          unfinishedReviewChallenges: 1,
          verifiedAttestations: 1,
          rejectedAttestations: 1,
          legacyAttestationMigrations: 1,
          checkDeliveries: 1,
          runnerKeyRotationWindows: 1,
          runnerIdentityRepositories: 1,
          revokedRunnerIdentities: 1
        }
      });
      expect(db.query("SELECT COUNT(*) AS count FROM retention_purge_authorizations").get()).toEqual({ count: 0 });
      expect(db.query("SELECT delivery_id FROM webhook_deliveries ORDER BY delivery_id").all()).toEqual([{ delivery_id: "delivery_webhook_recent" }]);
      expect(db.query("SELECT challenge_id FROM review_challenges ORDER BY challenge_id").all()).toEqual([
        { challenge_id: "chal_terminal_old" },
        { challenge_id: "chal_unfinished_recent" }
      ]);
      expect(db.query("SELECT attestation_id FROM attestations ORDER BY attestation_id").all()).toEqual([
        { attestation_id: "att_rejected_recent" },
        { attestation_id: "att_verified_recent" }
      ]);
      expect(db.query("SELECT original_attestation_id FROM legacy_attestation_migrations ORDER BY original_attestation_id").all()).toEqual([{ original_attestation_id: "legacy_recent" }]);
      expect(db.query("SELECT delivery_id FROM check_deliveries ORDER BY delivery_id").all()).toEqual([{ delivery_id: "delivery_check_recent" }]);
      expect(db.query("SELECT runner_id FROM runner_identities WHERE runner_id LIKE 'runner_revoked_%' ORDER BY runner_id").all()).toEqual([{ runner_id: "runner_revoked_recent" }]);
      expect(() => db.exec("DELETE FROM attestations WHERE attestation_id = 'att_verified_recent'")).toThrow("attestations are append-only");
    } finally {
      db.close();
    }
  });

  test("deploy SQL mirrors the metadata-only v2 attestation migration surface", () => {
    const deploySql = readFileSync("deploy/sql/0001_archcontext_control_plane.sql", "utf8");

    expect(deploySql).toContain("CREATE TABLE IF NOT EXISTS device_identities");
    expect(deploySql).toContain("public_key_fingerprint TEXT NOT NULL");
    expect(deploySql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS ux_device_identities_account_public_key ON device_identities(account_id, public_key_id)");
    expect(deploySql).toContain("CREATE TABLE IF NOT EXISTS runner_identities");
    expect(deploySql).toContain("CREATE TABLE IF NOT EXISTS runner_identity_repositories");
    expect(deploySql).toContain("CREATE TABLE IF NOT EXISTS runner_key_rotation_windows");
    expect(deploySql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS ux_runner_identities_public_key ON runner_identities(installation_id, public_key_id)");
    expect(deploySql).not.toContain("repository_numeric_ids_json");
    expect(deploySql).toContain("CREATE TABLE IF NOT EXISTS check_deliveries");
    expect(deploySql).toContain("CREATE INDEX IF NOT EXISTS idx_check_deliveries_next_attempt ON check_deliveries(status, next_attempt_at)");
    expect(deploySql).toContain("event_type TEXT NOT NULL");
    expect(deploySql).toContain("retention_delete_after TEXT NOT NULL");
    expect(deploySql).toContain("CREATE TABLE IF NOT EXISTS attestations");
    expect(deploySql).toContain("CREATE TABLE IF NOT EXISTS retention_purge_authorizations");
    expect(deploySql).toContain("schema_version TEXT NOT NULL CHECK(schema_version = 'archcontext.attestation/v2')");
    expect(deploySql).toContain("payload_digest TEXT NOT NULL UNIQUE");
    expect(deploySql).toContain("CREATE TRIGGER IF NOT EXISTS trg_attestations_append_only_no_update");
    expect(deploySql).toContain("CREATE INDEX IF NOT EXISTS idx_attestations_retention ON attestations(result, accepted_at)");
    expect(deploySql).toContain("CREATE TABLE IF NOT EXISTS legacy_attestation_migrations");
    expect(deploySql).toContain("CREATE INDEX IF NOT EXISTS idx_legacy_attestation_migrations_retention ON legacy_attestation_migrations(migrated_at)");
    expect(deploySql).toContain("required_check_eligible INTEGER NOT NULL CHECK(required_check_eligible = 0)");
    expect(deploySql).toContain("CREATE INDEX IF NOT EXISTS idx_runner_identities_revoked_retention ON runner_identities(status, revoked_at)");
    expect(deploySql).not.toContain("nonce TEXT NOT NULL");
  });

  test("deploy SQL stays in parity with generated D1 migration SQL", () => {
    const deploySql = readFileSync("deploy/sql/0001_archcontext_control_plane.sql", "utf8");

    expect(normalizeSql(deploySql)).toBe(normalizeSql(d1MigrationSql()));
  });
});

function migratedDb(): Database {
  const db = new Database(":memory:");
  db.exec(d1MigrationSql());
  return db;
}

function faultingDatabase(db: Database, fault: { failOnSql: RegExp; message: string }) {
  return {
    exec(sql: string) {
      return db.exec(sql);
    },
    prepare(sql: string) {
      const statement = db.prepare(sql);
      return {
        run(...params: Parameters<typeof statement.run>) {
          if (fault.failOnSql.test(sql)) throw new Error(fault.message);
          return statement.run(...params);
        },
        get(...params: Parameters<typeof statement.get>) {
          if (fault.failOnSql.test(sql)) throw new Error(fault.message);
          return statement.get(...params);
        }
      };
    }
  };
}

function expectSubmitTransactionRolledBack(
  db: Database,
  input: { challengeId: string; leaseOwner: string; leaseExpiresAt: string }
): void {
  expect(db.query("SELECT status, consumed_at, lease_owner, lease_expires_at FROM review_challenges WHERE challenge_id = ?").get(input.challengeId)).toEqual({
    status: "LEASED",
    consumed_at: null,
    lease_owner: input.leaseOwner,
    lease_expires_at: input.leaseExpiresAt
  });
  expect(db.query("SELECT COUNT(*) AS count FROM attestations WHERE challenge_id = ?").get(input.challengeId)).toEqual({ count: 0 });
  expect(db.query("SELECT COUNT(*) AS count FROM check_deliveries WHERE challenge_id = ?").get(input.challengeId)).toEqual({ count: 0 });
}

function insertReviewChallenge(db: Database, overrides: ReviewChallengeRow = {}): void {
  const row = {
    challengeId: "chal_base",
    installationId: 12345,
    repositoryId: 987654320,
    pullRequestNumber: 42,
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    requiredTrust: "developer" as const,
    policyProfileId: "default",
    nonceHash: "sha256:nonce-base",
    status: "PENDING" as const,
    leaseOwner: null,
    leaseExpiresAt: null,
    createdAt: "2026-06-21T14:00:00.000Z",
    expiresAt: "2026-06-21T14:15:00.000Z",
    supersededBy: null,
    consumedAt: null,
    ...overrides
  };
  db.query(`
    INSERT INTO review_challenges (
      challenge_id,
      installation_id,
      repository_id,
      pull_request_number,
      head_sha,
      base_sha,
      required_trust,
      policy_profile_id,
      nonce_hash,
      status,
      lease_owner,
      lease_expires_at,
      created_at,
      expires_at,
      superseded_by,
      consumed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.challengeId,
    row.installationId,
    row.repositoryId,
    row.pullRequestNumber,
    row.headSha,
    row.baseSha,
    row.requiredTrust,
    row.policyProfileId,
    row.nonceHash,
    row.status,
    row.leaseOwner,
    row.leaseExpiresAt,
    row.createdAt,
    row.expiresAt,
    row.supersededBy,
    row.consumedAt
  );
}

function insertDeviceIdentity(db: Database, overrides: DeviceIdentityRow = {}): void {
  const row = {
    deviceId: "dev_base",
    accountId: "acct_1",
    publicKeyId: "device-key-base",
    publicKeyFingerprint: fingerprint("device-base"),
    status: "active" as const,
    revokedAt: null,
    ...overrides
  };
  db.query(`
    INSERT INTO device_identities (
      device_id,
      account_id,
      public_key_id,
      public_key_fingerprint,
      status,
      created_at,
      revoked_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.deviceId,
    row.accountId,
    row.publicKeyId,
    row.publicKeyFingerprint,
    row.status,
    "2026-06-21T14:00:00.000Z",
    row.revokedAt
  );
}

function insertRunnerIdentity(db: Database, overrides: RunnerIdentityRow = {}): void {
  const row = {
    runnerId: "runner_base",
    installationId: 12345,
    scopeKind: "organization" as const,
    workflowRef: "Ancienttwo/arch-context/.github/workflows/archcontext-organization-runner.yml@refs/heads/main",
    publicKeyId: "runner-key-base",
    publicKeyFingerprint: fingerprint("runner-base"),
    status: "active" as const,
    rotatedAt: null,
    revokedAt: null,
    terminationKind: null,
    ...overrides
  };
  db.query(`
    INSERT INTO runner_identities (
      runner_id,
      installation_id,
      scope_kind,
      workflow_ref,
      public_key_id,
      public_key_fingerprint,
      status,
      created_at,
      rotated_at,
      revoked_at,
      termination_kind
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.runnerId,
    row.installationId,
    row.scopeKind,
    row.workflowRef,
    row.publicKeyId,
    row.publicKeyFingerprint,
    row.status,
    "2026-06-21T14:00:00.000Z",
    row.rotatedAt,
    row.revokedAt,
    row.terminationKind
  );
}

function insertRunnerRepository(db: Database, runnerId: string, repositoryId: number): void {
  db.query(`
    INSERT INTO runner_identity_repositories (
      runner_id,
      repository_id
    )
    VALUES (?, ?)
  `).run(runnerId, repositoryId);
}

function insertRunnerRotationWindow(
  db: Database,
  overrides: {
    previousRunnerId?: string;
    nextRunnerId?: string;
    rotatedAt?: string;
    overlapUntil?: string;
  } = {}
): void {
  const row = {
    previousRunnerId: "runner_base",
    nextRunnerId: "runner_next",
    rotatedAt: "2026-06-21T14:00:00.000Z",
    overlapUntil: "2026-06-21T14:15:00.000Z",
    ...overrides
  };
  db.query(`
    INSERT INTO runner_key_rotation_windows (
      previous_runner_id,
      next_runner_id,
      rotated_at,
      overlap_until
    )
    VALUES (?, ?, ?, ?)
  `).run(row.previousRunnerId, row.nextRunnerId, row.rotatedAt, row.overlapUntil);
}

function insertAttestation(db: Database, overrides: AttestationRow = {}): void {
  const row = {
    attestationId: "att_base",
    challengeId: "chal_base",
    repositoryId: 987654320,
    nonceHash: digest("1"),
    payloadDigest: digest("payload-1"),
    result: "pass" as const,
    acceptedAt: "2026-06-21T14:02:01.000Z",
    ...overrides
  };
  db.query(`
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
      payload_digest
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.attestationId,
    "archcontext.attestation/v2",
    row.challengeId,
    12345,
    row.repositoryId,
    42,
    "a".repeat(40),
    "b".repeat(40),
    "c".repeat(40),
    "d".repeat(40),
    digest("worktree"),
    digest("model"),
    digest("policy"),
    digest("code-facts"),
    digest("review"),
    row.result,
    null,
    "developer",
    "clean-commit-worktree",
    "device-1",
    "device-key-1",
    "0.1.0",
    digest("runtime-build"),
    "1",
    digest("runtime-capabilities"),
    row.nonceHash,
    "ed25519",
    1,
    "2026-06-21T14:01:00.000Z",
    "2026-06-21T14:02:00.000Z",
    "2026-06-21T14:15:00.000Z",
    row.acceptedAt,
    row.payloadDigest
  );
}

function insertLegacyAttestationMigration(db: Database, originalAttestationId: string, migratedAt: string): void {
  db.query(`
    INSERT INTO legacy_attestation_migrations (
      original_attestation_id,
      original_challenge_id,
      legacy_schema_version,
      target_schema_version,
      migration_status,
      required_check_eligible,
      rejection_reason_code,
      head_sha,
      worktree_digest,
      review_digest,
      trust_level,
      principal_id,
      public_key_id,
      issued_at,
      expires_at,
      migrated_at
    )
    VALUES (?, ?, 'archcontext.attestation/v1', 'archcontext.attestation/v2', 'legacy-audit-only', 0, 'ATTESTATION_SCHEMA_UNSUPPORTED', ?, ?, ?, 'developer', 'device-1', 'device-key-1', ?, ?, ?)
  `).run(
    originalAttestationId,
    `chal_${originalAttestationId}`,
    "a".repeat(40),
    digest(`legacy-worktree-${originalAttestationId}`),
    digest(`legacy-review-${originalAttestationId}`),
    "2026-05-01T00:00:00.000Z",
    "2026-05-01T00:15:00.000Z",
    migratedAt
  );
}

function acceptedAttestationRow(
  overrides: Partial<Parameters<typeof persistAcceptedAttestationSubmission>[1]["attestation"]> = {}
): Parameters<typeof persistAcceptedAttestationSubmission>[1]["attestation"] {
  return {
    attestationId: "att_base",
    challengeId: "chal_base",
    installationId: 12345,
    repositoryId: 987654320,
    pullRequestNumber: 42,
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    mergeBaseSha: "c".repeat(40),
    headTreeOid: "d".repeat(40),
    worktreeDigest: digest("worktree"),
    modelDigest: digest("model"),
    policyDigest: digest("policy"),
    codeFactsDigest: digest("code-facts"),
    reviewDigest: digest("review"),
    result: "pass",
    errorCode: null,
    executionTrustLevel: "developer",
    executionOrigin: "clean-commit-worktree",
    principalId: "device-1",
    publicKeyId: "device-key-1",
    runtimeVersion: "0.1.0",
    runtimeBuildDigest: digest("runtime-build"),
    runtimeGraphVersion: "1",
    runtimeCapabilitiesDigest: digest("runtime-capabilities"),
    nonceHash: digest("1"),
    signaturePresent: true,
    startedAt: "2026-06-21T14:01:00.000Z",
    completedAt: "2026-06-21T14:02:00.000Z",
    expiresAt: "2026-06-21T14:15:00.000Z",
    acceptedAt: "2026-06-21T14:02:01.000Z",
    payloadDigest: digest("payload-1"),
    ...overrides
  };
}

function insertCheckDelivery(db: Database, overrides: CheckDeliveryRow = {}): void {
  const row = {
    deliveryId: "delivery_base",
    challengeId: "chal_base",
    checkRunId: null,
    checkName: "ArchContext / Developer Review",
    headSha: "a".repeat(40),
    status: "PENDING",
    attemptCount: 0,
    nextAttemptAt: null,
    lastErrorCode: null,
    createdAt: "2026-06-21T14:00:00.000Z",
    updatedAt: "2026-06-21T14:02:00.000Z",
    ...overrides
  };
  db.query(`
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
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.deliveryId,
    row.challengeId,
    row.checkRunId,
    row.checkName,
    row.headSha,
    row.status,
    row.attemptCount,
    row.nextAttemptAt,
    row.lastErrorCode,
    row.createdAt,
    row.updatedAt
  );
}

function insertWebhookDelivery(db: Database, overrides: WebhookDeliveryRow = {}): void {
  const row = {
    provider: "github",
    deliveryId: "delivery_base",
    eventType: "pull_request.opened",
    projectedDigest: digest("webhook-base"),
    receivedAt: "2026-06-21T14:00:00.000Z",
    processedAt: "2026-06-21T14:00:01.000Z",
    retentionDeleteAfter: "2026-07-21T14:00:00.000Z",
    ...overrides
  };
  db.query(`
    INSERT INTO webhook_deliveries (
      provider,
      delivery_id,
      event_type,
      projected_digest,
      received_at,
      processed_at,
      retention_delete_after
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.provider,
    row.deliveryId,
    row.eventType,
    row.projectedDigest,
    row.receivedAt,
    row.processedAt,
    row.retentionDeleteAfter
  );
}

function digest(seed: string): string {
  return `sha256:${seed.padEnd(64, "0").slice(0, 64)}`;
}

function fingerprint(seed: string): string {
  return digest(seed);
}

function normalizeSql(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}
