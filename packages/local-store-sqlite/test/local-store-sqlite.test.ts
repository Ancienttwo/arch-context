import { describe, expect, test } from "bun:test";
import {
  InMemoryLocalStore,
  LOCAL_SQLITE_MIGRATIONS,
  SQLITE_PRAGMAS,
  assertNoSourceStorageSchema,
  migrationSql
} from "../src/index";

describe("@archcontext/local-store-sqlite", () => {
  test("migration SQL enables required SQLite safety pragmas", () => {
    const sql = migrationSql();
    expect(sql.slice(0, SQLITE_PRAGMAS.length)).toEqual([...SQLITE_PRAGMAS]);
    expect(sql.some((statement) => statement.includes("repository_sessions"))).toBe(true);
    expect(LOCAL_SQLITE_MIGRATIONS.map((migration) => migration.id)).toEqual(["0001_runtime_state", "0002_indexes"]);
    expect(() => assertNoSourceStorageSchema(sql)).not.toThrow();
  });

  test("schema guard rejects source or diff storage columns", () => {
    expect(() => assertNoSourceStorageSchema(["CREATE TABLE bad (source_code TEXT NOT NULL)"])).toThrow(
      "source_code"
    );
    expect(() => assertNoSourceStorageSchema(["CREATE TABLE bad (diff_body TEXT NOT NULL)"])).toThrow("diff_body");
  });

  test("in-memory store follows snapshot and task state contracts", async () => {
    const store = new InMemoryLocalStore();
    await store.migrate();
    expect([...store.migrations]).toEqual(["0001_runtime_state", "0002_indexes"]);

    const snapshot = {
      repositoryId: "repo.test",
      headSha: "abc123",
      worktreeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    };
    const snapshotId = await store.beginSnapshot(snapshot);
    await store.saveTaskState("task_1", { posture: "normal" });
    await store.saveReviewResult("review_1", { result: "pass" });

    expect(await store.readTaskState("task_1")).toEqual({ posture: "normal" });
    await store.commitSnapshot(snapshotId);
    expect(store.recoverPendingSnapshots()).toBe(0);

    await store.beginSnapshot(snapshot);
    expect(store.recoverPendingSnapshots()).toBe(1);
  });
});
