import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { assertD1PrivacySchema, d1MigrationSql, highFrequencyIndexes } from "../src/index";

describe("cloud D1 schema", () => {
  test("stores metadata only and indexes high-frequency queries", () => {
    const sql = d1MigrationSql();
    expect(() => assertD1PrivacySchema()).not.toThrow();
    expect(highFrequencyIndexes()).toContain("idx_challenges_repo_head");
    expect(highFrequencyIndexes()).toContain("idx_challenges_status_expiry");
    expect(highFrequencyIndexes()).toContain("ux_review_challenges_active_identity");
    expect(highFrequencyIndexes()).toContain("ux_device_identities_account_public_key");
    expect(highFrequencyIndexes()).toContain("idx_device_identities_account_status");
    expect(highFrequencyIndexes()).toContain("idx_attestations_repo_head");
    expect(highFrequencyIndexes()).toContain("idx_legacy_attestation_migrations_challenge");
    expect(highFrequencyIndexes()).toContain("idx_org_runner_installation");
    expect(sql).toContain("review_challenges");
    expect(sql).toContain("billing_interval");
    expect(sql).toContain("device_identities");
    expect(sql).toContain("org_runner_identities");
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
    expect(sql).toContain("CHECK(required_trust IN ('developer', 'organization'))");
    expect(sql).toContain("CHECK(status IN ('PENDING', 'LEASED', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'SUPERSEDED', 'EXPIRED'))");
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
    expect(sql).not.toContain("private_key");
    expect(sql).not.toContain("public_key_body");
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
      "migration_status TEXT NOT NULL DEFAULT 'native-v2'"
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS legacy_attestation_migrations");
    expect(sql).toContain("legacy_schema_version TEXT NOT NULL CHECK(legacy_schema_version = 'archcontext.attestation/v1')");
    expect(sql).toContain("target_schema_version TEXT NOT NULL CHECK(target_schema_version = 'archcontext.attestation/v2')");
    expect(sql).toContain("required_check_eligible INTEGER NOT NULL CHECK(required_check_eligible = 0)");
    expect(sql).toContain("rejection_reason_code TEXT NOT NULL CHECK(rejection_reason_code = 'ATTESTATION_SCHEMA_UNSUPPORTED')");
    expect(sql).not.toContain("schema_version TEXT NOT NULL CHECK(schema_version = 'archcontext.attestation/v1')");
    expect(sql).not.toContain("nonce TEXT NOT NULL");
  });

  test("deploy SQL mirrors the metadata-only v2 attestation migration surface", () => {
    const deploySql = readFileSync("deploy/sql/0001_archcontext_control_plane.sql", "utf8");

    expect(deploySql).toContain("CREATE TABLE IF NOT EXISTS device_identities");
    expect(deploySql).toContain("public_key_fingerprint TEXT NOT NULL");
    expect(deploySql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS ux_device_identities_account_public_key ON device_identities(account_id, public_key_id)");
    expect(deploySql).toContain("CREATE TABLE IF NOT EXISTS attestations");
    expect(deploySql).toContain("schema_version TEXT NOT NULL CHECK(schema_version = 'archcontext.attestation/v2')");
    expect(deploySql).toContain("CREATE TABLE IF NOT EXISTS legacy_attestation_migrations");
    expect(deploySql).toContain("required_check_eligible INTEGER NOT NULL CHECK(required_check_eligible = 0)");
    expect(deploySql).not.toContain("nonce TEXT NOT NULL");
  });
});
