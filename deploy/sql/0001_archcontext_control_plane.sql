-- ArchContext D1 control-plane metadata schema.
-- This file is generated from packages/cloud/cloud-db/src/index.ts.
-- It must never contain source, diff, symbol, CodeGraph payload, model body, or finding detail columns.

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
  current_period_end TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS github_installations (
  installation_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  repository_selection TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_challenges (
  challenge_id TEXT PRIMARY KEY,
  repository_owner TEXT NOT NULL,
  repository_name TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS attestations (
  attestation_id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  worktree_digest TEXT NOT NULL,
  review_digest TEXT NOT NULL,
  device_id TEXT NOT NULL,
  trust_level TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  provider TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY(provider, delivery_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_account ON subscriptions(account_id, status);
CREATE INDEX IF NOT EXISTS idx_challenges_repo_head ON review_challenges(repository_owner, repository_name, head_sha);
CREATE INDEX IF NOT EXISTS idx_attestations_challenge ON attestations(challenge_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_provider ON webhook_deliveries(provider, received_at);
