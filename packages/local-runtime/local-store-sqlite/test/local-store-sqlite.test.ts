import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LANDSCAPE_FILE, landscapeYaml } from "@archcontext/core/architecture-domain";
import {
  LOCAL_SQLITE_MIGRATIONS,
  SQLITE_PRAGMAS,
  SqliteLocalStore,
  assertNoSourceStorageSchema,
  inspectLegacyLocalStoreMigration,
  migrateLegacyLocalStoreIfNeeded,
  migrationSql,
  runtimeStatePaths
} from "../src/index";
import { TestLocalStore } from "./factories";

const LEGACY_SQLITE_MIGRATION_TIMEOUT_MS = 30_000;

describe("@archcontext/local-runtime/local-store-sqlite", () => {
  test("migration SQL enables required SQLite safety pragmas", () => {
    const sql = migrationSql();
    expect(sql.slice(0, SQLITE_PRAGMAS.length)).toEqual([...SQLITE_PRAGMAS]);
    expect(sql.some((statement) => statement.includes("repository_sessions"))).toBe(true);
    expect(LOCAL_SQLITE_MIGRATIONS.map((migration) => migration.id)).toEqual([
      "0001_runtime_state",
      "0002_indexes",
      "0003_landscape_state",
      "0004_changeset_journal"
    ]);
    expect(sql.some((statement) => statement.includes("cross_repo_edges"))).toBe(true);
    expect(sql.some((statement) => statement.includes("changeset_journal"))).toBe(true);
    expect(() => assertNoSourceStorageSchema(sql)).not.toThrow();
  });

  test("schema guard rejects source or diff storage columns", () => {
    expect(() => assertNoSourceStorageSchema(["CREATE TABLE bad (source_code TEXT NOT NULL)"])).toThrow(
      "source_code"
    );
    expect(() => assertNoSourceStorageSchema(["CREATE TABLE bad (diff_body TEXT NOT NULL)"])).toThrow("diff_body");
  });

  test("runtime state paths use an OS/user-data root partitioned by repository and worktree", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-state-paths-repo-"));
    const stateRoot = mkdtempSync(join(tmpdir(), "archctx-state-root-"));
    try {
      const paths = runtimeStatePaths(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
      expect(paths.source).toBe("environment");
      expect(paths.stateRoot).toBe(stateRoot);
      expect(paths.storageRepositoryId).toMatch(/^repo\.[0-9a-f]{16}$/);
      expect(paths.storageWorkspaceId).toMatch(/^ws\.[0-9a-f]{16}$/);
      expect(paths.repositoryId).toMatch(/^repo\.[0-9a-f]{16}$/);
      expect(paths.workspaceId).toMatch(/^ws\.[0-9a-f]{16}$/);
      expect(paths.repositoryId).toBe(paths.storageRepositoryId);
      expect(paths.workspaceId).toBe(paths.storageWorkspaceId);
      expect(paths.localStorePath).toBe(join(paths.workspaceStateDir, "runtime.sqlite"));
      expect(paths.daemonConnectionPath).toBe(join(paths.workspaceStateDir, "archctxd.json"));
      expect(paths.legacyLocalStorePath).toBe(join(paths.repositoryRoot, ".archcontext", ".local", "runtime.sqlite"));
      expect(paths.localStorePath.startsWith(root)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  test("runtime state paths use Git common-dir for linked worktrees and worktree root for workspace identity", () => {
    const workspace = mkdtempSync(join(tmpdir(), "archctx-state-git-worktrees-"));
    const repo = join(workspace, "repo");
    const linked = join(workspace, "repo-linked");
    const stateRoot = join(workspace, "state");
    try {
      createCommittedGitRepo(repo);
      git(repo, "worktree", "add", "-b", "linked-fixture", linked);

      const primary = runtimeStatePaths(repo, { ARCHCONTEXT_STATE_DIR: stateRoot });
      const linkedPaths = runtimeStatePaths(linked, { ARCHCONTEXT_STATE_DIR: stateRoot });
      expect(primary.storageRepositoryId).toBe(linkedPaths.storageRepositoryId);
      expect(primary.repositoryAnchor).toBe(linkedPaths.repositoryAnchor);
      expect(primary.storageWorkspaceId).not.toBe(linkedPaths.storageWorkspaceId);
      expect(primary.workspaceStateDir).not.toBe(linkedPaths.workspaceStateDir);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("runtime state paths collapse monorepo subdirectories and isolate sibling repositories", () => {
    const workspace = mkdtempSync(join(tmpdir(), "archctx-state-git-roots-"));
    const repo = join(workspace, "repo");
    const sibling = join(workspace, "sibling");
    const stateRoot = join(workspace, "state");
    try {
      createCommittedGitRepo(repo);
      mkdirSync(join(repo, "packages", "web"), { recursive: true });
      createCommittedGitRepo(sibling);

      const rootPaths = runtimeStatePaths(repo, { ARCHCONTEXT_STATE_DIR: stateRoot });
      const subdirPaths = runtimeStatePaths(join(repo, "packages", "web"), { ARCHCONTEXT_STATE_DIR: stateRoot });
      const siblingPaths = runtimeStatePaths(sibling, { ARCHCONTEXT_STATE_DIR: stateRoot });
      expect(subdirPaths.repositoryRoot).toBe(rootPaths.repositoryRoot);
      expect(subdirPaths.storageRepositoryId).toBe(rootPaths.storageRepositoryId);
      expect(subdirPaths.storageWorkspaceId).toBe(rootPaths.storageWorkspaceId);
      expect(siblingPaths.storageRepositoryId).not.toBe(rootPaths.storageRepositoryId);
      expect(siblingPaths.workspaceStateDir).not.toBe(rootPaths.workspaceStateDir);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test(
    "legacy repo-local SQLite WAL database migrates through staging into the runtime state partition",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "archctx-state-migration-repo-"));
      const stateRoot = mkdtempSync(join(tmpdir(), "archctx-state-migration-root-"));
      try {
        const paths = runtimeStatePaths(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        await writeTaskState(paths.legacyLocalStorePath, "task_legacy", { migrated: true });

        const migration = migrateLegacyLocalStoreIfNeeded(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        expect(migration.migrated).toBe(true);
        expect(migration.status).toBe("migrated");
        expect(migration.integrityCheck).toMatchObject({ legacy: "ok", staging: "ok", target: "ok" });
        expect(migration.copiedFiles).toEqual([paths.localStorePath]);
        expect(existsSync(migration.markerPath)).toBe(true);
        await expectTaskState(paths.localStorePath, "task_legacy", { migrated: true });
      } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(stateRoot, { recursive: true, force: true });
      }
    },
    LEGACY_SQLITE_MIGRATION_TIMEOUT_MS
  );

  test(
    "partial invalid target is quarantined and migration retries from legacy SQLite",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "archctx-state-partial-target-repo-"));
      const stateRoot = mkdtempSync(join(tmpdir(), "archctx-state-partial-target-root-"));
      try {
        const paths = runtimeStatePaths(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        await writeTaskState(paths.legacyLocalStorePath, "task_legacy", { recovered: true });
        mkdirSync(dirname(paths.localStorePath), { recursive: true });
        writeFileSync(paths.localStorePath, "partial sqlite target", "utf8");

        const migration = migrateLegacyLocalStoreIfNeeded(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        expect(migration.migrated).toBe(true);
        expect(migration.status).toBe("target-quarantined-and-migrated");
        expect(migration.quarantinedFiles).toHaveLength(1);
        expect(existsSync(migration.quarantinedFiles[0]!)).toBe(true);
        await expectTaskState(paths.localStorePath, "task_legacy", { recovered: true });
      } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(stateRoot, { recursive: true, force: true });
      }
    },
    LEGACY_SQLITE_MIGRATION_TIMEOUT_MS
  );

  test(
    "integrity-valid but schema-incomplete target is quarantined and migration retries from legacy SQLite",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "archctx-state-incomplete-target-repo-"));
      const stateRoot = mkdtempSync(join(tmpdir(), "archctx-state-incomplete-target-root-"));
      try {
        const paths = runtimeStatePaths(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        await writeTaskState(paths.legacyLocalStorePath, "task_legacy", { recovered: "schema-incomplete-target" });
        await writeIncompleteSqliteTarget(paths.localStorePath);

        const migration = migrateLegacyLocalStoreIfNeeded(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        expect(migration.migrated).toBe(true);
        expect(migration.status).toBe("target-quarantined-and-migrated");
        expect(migration.integrityCheck.target).toBe("ok");
        expect(migration.quarantinedFiles).toHaveLength(1);
        expect(existsSync(migration.quarantinedFiles[0]!)).toBe(true);
        await expectTaskState(paths.localStorePath, "task_legacy", { recovered: "schema-incomplete-target" });
      } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(stateRoot, { recursive: true, force: true });
      }
    },
    LEGACY_SQLITE_MIGRATION_TIMEOUT_MS
  );

  test(
    "valid existing target is not overwritten by stale legacy SQLite",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "archctx-state-existing-target-repo-"));
      const stateRoot = mkdtempSync(join(tmpdir(), "archctx-state-existing-target-root-"));
      try {
        const paths = runtimeStatePaths(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        await writeTaskState(paths.legacyLocalStorePath, "task_state", { source: "legacy" });
        await writeTaskState(paths.localStorePath, "task_state", { source: "target" });

        const migration = migrateLegacyLocalStoreIfNeeded(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        expect(migration.migrated).toBe(false);
        expect(migration.status).toBe("target-current");
        expect(migration.skippedReason).toBe("target-exists");
        expect(migration.quarantinedFiles).toEqual([]);
        await expectTaskState(paths.localStorePath, "task_state", { source: "target" });
      } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(stateRoot, { recursive: true, force: true });
      }
    },
    LEGACY_SQLITE_MIGRATION_TIMEOUT_MS
  );

  test("active legacy migration lock prevents target quarantine side effects", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-state-active-lock-repo-"));
    const stateRoot = mkdtempSync(join(tmpdir(), "archctx-state-active-lock-root-"));
    try {
      const paths = runtimeStatePaths(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
      await writeTaskState(paths.legacyLocalStorePath, "task_legacy", { source: "legacy" });
      mkdirSync(dirname(paths.localStorePath), { recursive: true });
      writeFileSync(paths.localStorePath, "malformed target before active-lock check\n", "utf8");
      const lockPath = inspectLegacyLocalStoreMigration(root, { ARCHCONTEXT_STATE_DIR: stateRoot }).lockPath;
      mkdirSync(dirname(lockPath), { recursive: true });
      writeFileSync(lockPath, JSON.stringify({
        schemaVersion: "archcontext.legacy-local-store-migration-lock/v1",
        pid: process.pid,
        root,
        targetLocalStorePath: paths.localStorePath,
        startedAt: "2026-06-23T00:00:00.000Z"
      }), "utf8");

      expect(() => migrateLegacyLocalStoreIfNeeded(root, { ARCHCONTEXT_STATE_DIR: stateRoot })).toThrow(
        "Legacy SQLite migration already in progress"
      );
      expect(readFileSync(paths.localStorePath, "utf8")).toBe("malformed target before active-lock check\n");
      expect(existsSync(join(dirname(paths.localStorePath), "quarantine"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  test("invalid legacy SQLite fails without publishing an empty target", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-state-invalid-legacy-repo-"));
    const stateRoot = mkdtempSync(join(tmpdir(), "archctx-state-invalid-legacy-root-"));
    try {
      const paths = runtimeStatePaths(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
      mkdirSync(dirname(paths.legacyLocalStorePath), { recursive: true });
      writeFileSync(paths.legacyLocalStorePath, "not sqlite", "utf8");

      expect(() => migrateLegacyLocalStoreIfNeeded(root, { ARCHCONTEXT_STATE_DIR: stateRoot })).toThrow(
        "ArchContext legacy SQLite migration failed"
      );
      expect(existsSync(paths.localStorePath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  test("repo-local legacy SQLite symlink to outside repository is rejected", async () => {
    if (process.platform === "win32") {
      expect(process.platform).toBe("win32");
      return;
    }
    const root = mkdtempSync(join(tmpdir(), "archctx-state-symlink-legacy-repo-"));
    const stateRoot = mkdtempSync(join(tmpdir(), "archctx-state-symlink-legacy-root-"));
    const outsideRoot = mkdtempSync(join(tmpdir(), "archctx-state-symlink-outside-"));
    try {
      const paths = runtimeStatePaths(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
      const outsideStore = join(outsideRoot, "outside.sqlite");
      await writeTaskState(outsideStore, "task_external", { source: "outside-repo" });
      mkdirSync(dirname(paths.legacyLocalStorePath), { recursive: true });
      symlinkSync(outsideStore, paths.legacyLocalStorePath);

      expect(() => migrateLegacyLocalStoreIfNeeded(root, { ARCHCONTEXT_STATE_DIR: stateRoot })).toThrow(
        "Legacy SQLite source must not be a symbolic link"
      );
      expect(existsSync(paths.localStorePath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(stateRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  test("in-memory store follows snapshot and task state contracts", async () => {
    const store = new TestLocalStore();
    await store.migrate();
    expect([...store.migrations]).toEqual(["0001_runtime_state", "0002_indexes", "0003_landscape_state", "0004_changeset_journal"]);

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

  test("sqlite changeset journal recovers pending temp writes after reopen", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-changeset-journal-"));
    const dbPath = join(root, "runtime.sqlite");
    const relativePath = ".archcontext/policies/review.yaml";
    const absolutePath = join(root, relativePath);
    const backupPath = `${absolutePath}.archctx-backup`;
    const tempPath = `${absolutePath}.archctx-tmp-test`;
    const original = "schemaVersion: archcontext.policy/v1\nid: policy.original\n";
    try {
      writeRepoFile(root, relativePath, original);
      const first = new SqliteLocalStore(dbPath);
      await first.migrate();
      const journalId = await first.beginChangeSet(root, changeSetDraft("changeset.recover", relativePath));
      renameSync(absolutePath, backupPath);
      writeFileSync(tempPath, "partial write", "utf8");
      await first.recordChangeSetFile(journalId, {
        path: relativePath,
        tempPath,
        backupPath,
        existed: true,
        operation: "update_entity_fields"
      });
      first.close();

      const second = new SqliteLocalStore(dbPath);
      await second.migrate();
      expect(second.recoverPendingChangeSets()).toBe(1);
      expect(readFileSync(absolutePath, "utf8")).toBe(original);
      expect(existsSync(tempPath)).toBe(false);
      expect(existsSync(backupPath)).toBe(false);
      expect(second.recoverPendingChangeSets()).toBe(0);
      second.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("sqlite changeset journal cleans committed backup artifacts after reopen", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-changeset-committed-"));
    const dbPath = join(root, "runtime.sqlite");
    const relativePath = ".archcontext/policies/review.yaml";
    const absolutePath = join(root, relativePath);
    const backupPath = `${absolutePath}.archctx-backup`;
    const tempPath = `${absolutePath}.archctx-tmp-test`;
    try {
      writeRepoFile(root, relativePath, "schemaVersion: archcontext.policy/v1\nid: policy.final\n");
      writeFileSync(backupPath, "old backup", "utf8");
      writeFileSync(tempPath, "old temp", "utf8");
      const first = new SqliteLocalStore(dbPath);
      await first.migrate();
      const journalId = await first.beginChangeSet(root, changeSetDraft("changeset.committed-cleanup", relativePath));
      await first.recordChangeSetFile(journalId, {
        path: relativePath,
        tempPath,
        backupPath,
        existed: true,
        operation: "update_entity_fields"
      });
      await first.commitChangeSet(journalId);
      first.close();

      const second = new SqliteLocalStore(dbPath);
      await second.migrate();
      expect(second.recoverPendingChangeSets()).toBe(0);
      expect(existsSync(absolutePath)).toBe(true);
      expect(existsSync(tempPath)).toBe(false);
      expect(existsSync(backupPath)).toBe(false);
      second.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("sqlite store persists repository session, task state, landscape metadata, and committed snapshots across reopen", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-sqlite-store-"));
    const dbPath = join(root, "runtime.sqlite");
    const snapshot = {
      repositoryId: "repo.test",
      headSha: "abc123",
      worktreeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    };
    const landscape = {
      schemaVersion: "archcontext.landscape/v1" as const,
      id: "landscape.product",
      name: "Product",
      repositories: [
        { repositoryId: "repo.web", numericRepositoryId: 1001, name: "web", role: "frontend" as const }
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

    try {
      const first = new SqliteLocalStore(dbPath);
      await first.migrate();
      const committed = await first.beginSnapshot(snapshot);
      await first.commitSnapshot(committed);
      await first.saveRepositorySession({
        repositoryId: snapshot.repositoryId,
        root,
        headSha: snapshot.headSha,
        worktreeDigest: snapshot.worktreeDigest,
        updatedAt: "2026-06-20T00:00:00.000Z"
      });
      await first.saveTaskState("task_1", { posture: "normal" });
      await first.saveLandscape(landscape);
      await first.saveCrossRepoRelation(relation);
      first.close();

      const second = new SqliteLocalStore(dbPath);
      await second.migrate();
      expect(await second.listRepositorySessions()).toEqual([{
        repositoryId: snapshot.repositoryId,
        root,
        headSha: snapshot.headSha,
        worktreeDigest: snapshot.worktreeDigest,
        updatedAt: "2026-06-20T00:00:00.000Z"
      }]);
      expect(await second.readTaskState("task_1")).toEqual({ posture: "normal" });
      expect(await second.readLandscape("landscape.product")).toEqual(landscape);
      expect(await second.listCrossRepoRelations(landscape)).toEqual([relation]);
      await second.beginSnapshot(snapshot);
      expect(second.recoverPendingSnapshots()).toBe(1);
      second.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rebuilds derived landscape metadata from Git-tracked repo files and CodeGraph indexing", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-landscape-root-"));
    const webRoot = mkdtempSync(join(tmpdir(), "archctx-web-"));
    const apiRoot = mkdtempSync(join(tmpdir(), "archctx-api-"));
    const store = new TestLocalStore();
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
    const store = new TestLocalStore();
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

async function writeTaskState(databasePath: string, taskSessionId: string, state: unknown): Promise<void> {
  const store = new SqliteLocalStore(databasePath);
  await store.migrate();
  await store.saveTaskState(taskSessionId, state);
  store.close();
}

async function writeIncompleteSqliteTarget(databasePath: string): Promise<void> {
  mkdirSync(dirname(databasePath), { recursive: true });
  const bunSqlite = await import("bun:sqlite");
  const db = new (bunSqlite as any).Database(databasePath, { create: true });
  try {
    db.exec("CREATE TABLE unrelated_table (id INTEGER PRIMARY KEY, note TEXT)");
    db.exec("INSERT INTO unrelated_table(note) VALUES ('valid-but-incomplete')");
  } finally {
    db.close();
  }
}

async function expectTaskState(databasePath: string, taskSessionId: string, expected: unknown): Promise<void> {
  const store = new SqliteLocalStore(databasePath);
  await store.migrate();
  expect(await store.readTaskState(taskSessionId)).toEqual(expected);
  store.close();
}

function createCommittedGitRepo(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "README.md"), "# fixture\n", "utf8");
  git(root, "init");
  git(root, "add", ".");
  git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture");
}

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function writeRepoFile(root: string, path: string, body: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, body.endsWith("\n") ? body : `${body}\n`, "utf8");
}

function changeSetDraft(id: string, path: string) {
  return {
    schemaVersion: "archcontext.changeset/v1" as const,
    id,
    status: "approved" as const,
    base: {
      headSha: "abc123",
      worktreeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      modelDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    },
    reason: { taskSessionId: "task.test" },
    operations: [
      {
        op: "update_entity_fields" as const,
        path,
        expectedHash: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        body: "not persisted in journal"
      }
    ],
    preconditions: [],
    postconditions: [],
    requiresConfirmation: true,
    idempotencyKey: `idem_${id}`
  };
}
