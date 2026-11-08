import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { assertD1PrivacySchema, d1MigrationSql, highFrequencyIndexes } from "../src/index";

describe("cloud D1 schema", () => {
  test("stores account and subscription metadata only and indexes high-frequency queries", () => {
    const sql = d1MigrationSql();
    expect(() => assertD1PrivacySchema()).not.toThrow();
    expect(() => new Database(":memory:").exec(sql)).not.toThrow();
    expect(highFrequencyIndexes()).toEqual(["idx_subscriptions_account"]);
    expect([...sql.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)].map((match) => match[1])).toEqual(["accounts", "subscriptions"]);
    expect(sql).toContain("billing_interval");
    expect(sql.toLowerCase()).not.toContain("raw_body");
  });

  test("deploy SQL stays in parity with generated D1 migration SQL", () => {
    const deploySql = readFileSync("deploy/sql/0001_archcontext_control_plane.sql", "utf8");

    expect(normalizeSql(deploySql)).toBe(normalizeSql(d1MigrationSql()));
  });
});

function normalizeSql(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}
