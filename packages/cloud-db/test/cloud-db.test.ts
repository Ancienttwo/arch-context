import { describe, expect, test } from "bun:test";
import { assertD1PrivacySchema, d1MigrationSql, highFrequencyIndexes } from "../src/index";

describe("cloud D1 schema", () => {
  test("stores metadata only and indexes high-frequency queries", () => {
    expect(() => assertD1PrivacySchema()).not.toThrow();
    expect(highFrequencyIndexes()).toContain("idx_challenges_repo_head");
    expect(d1MigrationSql()).toContain("review_challenges");
  });
});
