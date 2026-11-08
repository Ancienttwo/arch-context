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

-- 0002_indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_account ON subscriptions(account_id, status);
