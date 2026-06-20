import { describe, expect, test } from "bun:test";
import { assertD1PrivacySchema, d1MigrationSql, highFrequencyIndexes } from "../src/index";

describe("cloud D1 schema", () => {
  test("stores metadata only and indexes high-frequency queries", () => {
    expect(() => assertD1PrivacySchema()).not.toThrow();
    expect(highFrequencyIndexes()).toContain("idx_challenges_repo_head");
    expect(highFrequencyIndexes()).toContain("idx_org_runner_installation");
    expect(d1MigrationSql()).toContain("review_challenges");
    expect(d1MigrationSql()).toContain("billing_interval");
    expect(d1MigrationSql()).toContain("org_runner_identities");
    expect(d1MigrationSql()).toContain("webhook_deliveries");
    expect(d1MigrationSql()).toContain("PRIMARY KEY(provider, delivery_id)");
    expect(highFrequencyIndexes()).toContain("idx_deliveries_provider");
    expect(d1MigrationSql().toLowerCase()).not.toContain("raw_body");
  });
});
