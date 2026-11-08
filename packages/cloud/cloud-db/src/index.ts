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
);`
  },
  {
    id: "0002_indexes",
    sql: `
CREATE INDEX IF NOT EXISTS idx_subscriptions_account ON subscriptions(account_id, status);`
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
