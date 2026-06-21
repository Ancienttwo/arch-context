-- ArchContext D1 control-plane metadata schema.
-- Generated from the cloud-db migration definition.
-- It stores IDs, digests, statuses, timestamps, and fingerprints only.

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
  revoked_at TEXT
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
  CHECK(expires_at > created_at)
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
  migration_status TEXT NOT NULL DEFAULT 'native-v2' CHECK(migration_status = 'native-v2'),
  CHECK(completed_at >= started_at),
  CHECK(expires_at > completed_at)
);

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

CREATE TABLE IF NOT EXISTS org_runner_identities (
  runner_id TEXT PRIMARY KEY,
  installation_id INTEGER NOT NULL,
  public_key_id TEXT NOT NULL,
  public_key_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  repository_numeric_ids_json TEXT,
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  provider TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY(provider, delivery_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_account ON subscriptions(account_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS ux_device_identities_account_public_key ON device_identities(account_id, public_key_id);
CREATE INDEX IF NOT EXISTS idx_device_identities_account_status ON device_identities(account_id, status);
CREATE INDEX IF NOT EXISTS idx_challenges_repo_head ON review_challenges(repository_id, pull_request_number, head_sha);
CREATE INDEX IF NOT EXISTS idx_challenges_status_expiry ON review_challenges(status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_review_challenges_active_identity
  ON review_challenges(installation_id, repository_id, pull_request_number, head_sha, required_trust)
  WHERE status IN ('PENDING', 'LEASED', 'SUBMITTED');
CREATE INDEX IF NOT EXISTS idx_attestations_challenge ON attestations(challenge_id);
CREATE INDEX IF NOT EXISTS idx_attestations_repo_head ON attestations(repository_id, pull_request_number, head_sha);
CREATE INDEX IF NOT EXISTS idx_legacy_attestation_migrations_challenge ON legacy_attestation_migrations(original_challenge_id);
CREATE INDEX IF NOT EXISTS idx_org_runner_installation ON org_runner_identities(installation_id, status);
CREATE INDEX IF NOT EXISTS idx_deliveries_provider ON webhook_deliveries(provider, received_at);
