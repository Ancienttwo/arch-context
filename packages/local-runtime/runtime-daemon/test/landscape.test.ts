import { rmSync, tempRepo, removeTempRepo, createStartedTestDaemon } from "./runtime-test-fixtures";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryFingerprint, validateLandscape, type CrossRepoRelation } from "@archcontext/core/architecture-domain";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";

const PREVIOUS_ARCHCONTEXT_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const RUNTIME_TEST_STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-landscape-state-"));
process.env.ARCHCONTEXT_STATE_DIR = RUNTIME_TEST_STATE_ROOT;
afterAll(() => {
  if (PREVIOUS_ARCHCONTEXT_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_ARCHCONTEXT_STATE_DIR;
  rmSync(RUNTIME_TEST_STATE_ROOT, { recursive: true, force: true });
});

describe("daemon landscape", () => {
  test("multi-repo sessions use LRU and landscape context stays local", async () => {
    const first = tempRepo();
    const second = tempRepo();
    const third = tempRepo();
    try {
      const daemon = await createStartedTestDaemon({ maxRepoSessions: 2 });
      const addedFirst = await daemon.repoAdd(first, "web");
      const addedSecond = await daemon.repoAdd(second, "api");
      const firstRepo = (addedFirst.data as any).repository.repositoryId;
      const secondRepo = (addedSecond.data as any).repository.repositoryId;
      await daemon.repoAdd(third, "worker");

      expect(daemon.status().sessions).toBe(2);
      expect(daemon.status().repositories).not.toContain(firstRepo);

      const list = await daemon.repoList();
      expect((list.data as any).repositories.map((repo: any) => repo.repositoryId)).toEqual([
        firstRepo,
        secondRepo,
        repositoryFingerprint(third)
      ].sort());

      const context = await daemon.contextLandscape("change api used by web", 4);
      expect(context.ok).toBe(true);
      expect((context.data as any).extensions.landscapeDigest).toMatch(/^sha256:/);
      expect(JSON.stringify(context.data)).not.toContain("archcontextSyncService\":\"allowed");
    } finally {
      removeTempRepo(first);
      removeTempRepo(second);
      removeTempRepo(third);
    }
  });

  test("repo remove survives a daemon restart and detaches dependent landscape state", async () => {
    const removedRoot = tempRepo();
    const keptRoot = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({ localStore: store });
      const addedRemoved = await daemon.repoAdd(removedRoot, "web");
      const addedKept = await daemon.repoAdd(keptRoot, "api");
      const removedId = (addedRemoved.data as any).repository.repositoryId;
      const keptId = (addedKept.data as any).repository.repositoryId;

      const outbound: CrossRepoRelation = {
        schemaVersion: "archcontext.cross-repo-relation/v1",
        id: "relation.outbound",
        kind: "calls",
        source: { repositoryId: removedId, nodeId: "node.web" },
        target: { repositoryId: keptId, nodeId: "node.api" },
        via: { kind: "interface", id: "interface.checkout" },
        intent: "web calls api"
      };
      const inbound: CrossRepoRelation = {
        schemaVersion: "archcontext.cross-repo-relation/v1",
        id: "relation.inbound",
        kind: "subscribes",
        source: { repositoryId: keptId, nodeId: "node.api" },
        target: { repositoryId: removedId, nodeId: "node.web" },
        via: { kind: "event", id: "event.checkout-completed" },
        intent: "api subscribes to web"
      };
      await store.saveCrossRepoRelation(outbound);
      await store.saveCrossRepoRelation(inbound);
      const registered = (await store.readLandscape("landscape.local"))!;
      expect(registered.scope?.defaultActiveRepositories).toEqual([removedId, keptId]);
      const loaded = await daemon.loadLandscape({ ...registered, relations: [inbound.id, outbound.id] });
      expect(loaded.ok).toBe(true);

      const removal = await daemon.repoRemove(removedId);
      expect(removal.ok).toBe(true);
      expect(removal.data).toMatchObject({
        repositoryId: removedId,
        removed: true,
        sessionRemoved: true,
        detachedRelationIds: [inbound.id, outbound.id]
      });

      const saved = (await store.readLandscape("landscape.local"))!;
      expect(saved.repositories.map((repo) => repo.repositoryId)).toEqual([keptId]);
      expect(saved.scope?.defaultActiveRepositories).toEqual([keptId]);
      expect(saved.relations).toEqual([]);
      expect(validateLandscape(saved, await store.listCrossRepoRelations(saved))).toEqual({ valid: true, errors: [] });
      expect([...store.repositorySessions.keys()]).toEqual([keptId]);
      expect([...store.crossRepoEdges.keys()].sort()).toEqual([inbound.id, outbound.id]);

      await daemon.stop();
      const restarted = await createStartedTestDaemon({ localStore: store });
      expect((await restarted.repoList()).data).toMatchObject({ activeSessions: [keptId] });

      const unknown = await restarted.repoRemove(removedId);
      expect(unknown.ok).toBe(false);
      expect((unknown as any).error.code).toBe("AC_REPO_NOT_FOUND");
      expect([...store.repositorySessions.keys()]).toEqual([keptId]);
      await restarted.stop();
    } finally {
      removeTempRepo(removedRoot);
      removeTempRepo(keptRoot);
    }
  });

  test("repo remove after daemon restart updates the persisted landscape", async () => {
    const removedRoot = tempRepo();
    const keptRoot = tempRepo();
    const store = new TestLocalStore();
    try {
      const first = await createStartedTestDaemon({ localStore: store });
      const removedId = ((await first.repoAdd(removedRoot, "web")).data as any).repository.repositoryId;
      const keptId = ((await first.repoAdd(keptRoot, "api")).data as any).repository.repositoryId;
      await first.stop();

      const restarted = await createStartedTestDaemon({ localStore: store });
      const removal = await restarted.repoRemove(removedId);
      expect(removal.ok).toBe(true);
      expect(removal.data).toMatchObject({ repositoryId: removedId, removed: true, sessionRemoved: true });

      const saved = (await store.readLandscape("landscape.local"))!;
      expect(saved.repositories.map((repo) => repo.repositoryId)).toEqual([keptId]);
      expect(saved.scope?.defaultActiveRepositories).toEqual([keptId]);
      expect([...store.repositorySessions.keys()]).toEqual([keptId]);
      await restarted.stop();
    } finally {
      removeTempRepo(removedRoot);
      removeTempRepo(keptRoot);
    }
  });

  test("repo remove rejected by landscape validation leaves every session untouched", async () => {
    const removedRoot = tempRepo();
    const keptRoot = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({ localStore: store });
      const addedRemoved = await daemon.repoAdd(removedRoot, "web");
      const addedKept = await daemon.repoAdd(keptRoot, "api");
      const removedId = (addedRemoved.data as any).repository.repositoryId;
      const keptId = (addedKept.data as any).repository.repositoryId;

      // A relation between the kept repository and one that was never registered. loadLandscape
      // validates without relations, so this reaches the saved landscape; repoRemove validates the
      // post-removal landscape *with* its active relations, so the dangling endpoint surfaces
      // there. Nothing about it involves the repository being removed.
      const dangling: CrossRepoRelation = {
        schemaVersion: "archcontext.cross-repo-relation/v1",
        id: "relation.dangling",
        kind: "depends-on",
        source: { repositoryId: keptId, nodeId: "node.api" },
        target: { repositoryId: "repo.never-registered", nodeId: "node.ghost" },
        via: { kind: "interface", id: "interface.ghost" },
        intent: "api depends on an unregistered repository"
      };
      await store.saveCrossRepoRelation(dangling);
      const registered = (await store.readLandscape("landscape.local"))!;
      expect((await daemon.loadLandscape({ ...registered, relations: [dangling.id] })).ok).toBe(true);

      const rejected = await daemon.repoRemove(removedId);
      expect(rejected.ok).toBe(false);
      expect((rejected as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((rejected as any).error.message).toContain("repo.never-registered");

      expect([...store.repositorySessions.keys()].sort()).toEqual([removedId, keptId].sort());
      expect((await daemon.repoList()).data).toMatchObject({ activeSessions: [removedId, keptId].sort() });
      const stillSaved = (await store.readLandscape("landscape.local"))!;
      expect(stillSaved.repositories.map((repo) => repo.repositoryId).sort()).toEqual([removedId, keptId].sort());
      expect(stillSaved.relations).toEqual([dangling.id]);

      await daemon.stop();
      const restarted = await createStartedTestDaemon({ localStore: store });
      expect((await restarted.repoList()).data).toMatchObject({ activeSessions: [removedId, keptId].sort() });
      await restarted.stop();
    } finally {
      removeTempRepo(removedRoot);
      removeTempRepo(keptRoot);
    }
  });
});
