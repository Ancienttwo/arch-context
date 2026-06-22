-- 0001_control_plane
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
);

-- 0002_indexes
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
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retention ON webhook_deliveries(retention_delete_after, provider);
