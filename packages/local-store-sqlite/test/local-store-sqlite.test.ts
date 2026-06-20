import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LANDSCAPE_FILE, landscapeYaml } from "@archcontext/architecture-domain";
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
    expect(LOCAL_SQLITE_MIGRATIONS.map((migration) => migration.id)).toEqual([
      "0001_runtime_state",
      "0002_indexes",
      "0003_landscape_state"
    ]);
    expect(sql.some((statement) => statement.includes("cross_repo_edges"))).toBe(true);
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
    expect([...store.migrations]).toEqual(["0001_runtime_state", "0002_indexes", "0003_landscape_state"]);

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

  test("rebuilds derived landscape metadata from Git-tracked repo files and CodeGraph indexing", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-landscape-root-"));
    const webRoot = mkdtempSync(join(tmpdir(), "archctx-web-"));
    const apiRoot = mkdtempSync(join(tmpdir(), "archctx-api-"));
    const store = new InMemoryLocalStore();
    try {
      await store.migrate();
      const landscape = {
        schemaVersion: "archcontext.landscape/v1" as const,
        id: "landscape.product",
        name: "Product",
        repositories: [
          { repositoryId: "repo.web", numericRepositoryId: 1001, name: "web", role: "frontend", root: webRoot },
          { repositoryId: "repo.api", numericRepositoryId: 1002, name: "api", role: "runtime", root: apiRoot }
        ],
        relations: ["relation.web-calls-api"],
        syncPolicy: { mode: "git-worktree-only" as const, archcontextSyncService: "forbidden" as const }
      };
      const relation = {
        schemaVersion: "archcontext.cross-repo-relation/v1" as const,
        id: "relation.web-calls-api",
        kind: "calls" as const,
        source: { repositoryId: "repo.web", nodeId: "module.checkout-ui" },
        target: { repositoryId: "repo.api", nodeId: "module.billing-api" },
        via: { kind: "interface" as const, id: "interface.billing-http" },
        intent: "checkout to billing"
      };
      writeRepoFile(root, LANDSCAPE_FILE, landscapeYaml(landscape));
      writeRepoFile(root, ".archcontext/relations/relation.web-calls-api.json", JSON.stringify(relation, null, 2));

      await store.saveLandscape(landscape);
      await store.saveCrossRepoRelation(relation);
      store.clearDerivedLandscapeState();
      expect(await store.readLandscape("landscape.product")).toBeUndefined();
      expect(await store.listCrossRepoRelations()).toEqual([]);

      const indexedRepositories: string[] = [];
      const rebuilt = await store.rebuildDerivedLandscapeState({
        root,
        indexRepository: async (repository) => {
          expect(repository.root).toBe(repository.repositoryId === "repo.web" ? webRoot : apiRoot);
          indexedRepositories.push(repository.repositoryId);
        }
      });

      expect(rebuilt.landscape).toEqual(landscape);
      expect(rebuilt.relations).toEqual([relation]);
      expect(rebuilt.indexedRepositories).toEqual(["repo.web", "repo.api"]);
      expect(rebuilt.digest).toMatch(/^sha256:/);
      expect(indexedRepositories).toEqual(["repo.web", "repo.api"]);
      expect(await store.readLandscape("landscape.product")).toEqual(landscape);
      expect(await store.listCrossRepoRelations(landscape)).toEqual([relation]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(webRoot, { recursive: true, force: true });
      rmSync(apiRoot, { recursive: true, force: true });
    }
  });

  test("rebuild fails when a Git-tracked landscape references missing relation files", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-landscape-root-"));
    const store = new InMemoryLocalStore();
    try {
      await store.migrate();
      writeRepoFile(
        root,
        LANDSCAPE_FILE,
        landscapeYaml({
          schemaVersion: "archcontext.landscape/v1" as const,
          id: "landscape.product",
          name: "Product",
          repositories: [
            { repositoryId: "repo.web", numericRepositoryId: 1001, name: "web", role: "frontend" },
            { repositoryId: "repo.api", numericRepositoryId: 1002, name: "api", role: "runtime" }
          ],
          relations: ["relation.web-calls-api"],
          syncPolicy: { mode: "git-worktree-only" as const, archcontextSyncService: "forbidden" as const }
        })
      );

      await expect(store.rebuildDerivedLandscapeState({ root })).rejects.toThrow("missing relations relation.web-calls-api");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function writeRepoFile(root: string, path: string, body: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, body.endsWith("\n") ? body : `${body}\n`, "utf8");
}
