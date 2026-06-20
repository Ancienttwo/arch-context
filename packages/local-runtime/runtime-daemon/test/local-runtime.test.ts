import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { assertNoCodeGraphInternalPathAccess, CodeGraphAdapter, REQUIRED_CODEGRAPH_VERSION } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { migrationSql, assertNoSourceStorageSchema, SQLITE_PRAGMAS } from "@archcontext/local-runtime/local-store-sqlite";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { listModelFiles } from "@archcontext/local-runtime/model-store-yaml";
import { createStartedDaemon } from "../src/index";

function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-"));
  writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
  return root;
}

function createStartedTestDaemon(deps: Parameters<typeof createStartedDaemon>[0] = {}) {
  return createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore(),
    ...deps
  });
}

describe("local runtime foundation", () => {
  test("init, validate, sync, context, and status share one runtime session", async () => {
    const root = tempRepo();
    try {
      const daemon = await createStartedTestDaemon();
      const init = await daemon.init(root, "Test App");
      expect(init.ok).toBe(true);
      expect(readFileSync(join(root, ".archcontext/manifest.yaml"), "utf8")).toContain("archcontext.manifest/v1");
      mkdirSync(join(root, ".archcontext/decisions"), { recursive: true });
      writeFileSync(
        join(root, ".archcontext/decisions/ADR-0001-test.md"),
        "---\nschemaVersion: archcontext.adr/v1\nid: adr.0001.test\n---\n# Test\n",
        "utf8"
      );
      expect(listModelFiles(root).map((file) => file.path)).toContain(".archcontext/decisions/ADR-0001-test.md");

      const validateA = await daemon.validate(root);
      const validateB = await daemon.validate(root);
      expect(validateA).toEqual(validateB);
      expect((validateA.data as any).valid).toBe(true);

      const sync = await daemon.sync(root);
      expect(sync.ok).toBe(true);
      expect((sync.data as any).codeFactsDigest).toMatch(/^sha256:/);

      const context = await daemon.context(root, "add billing");
      expect(context.ok).toBe(true);
      expect((context.data as any).schemaVersion).toBe("archcontext.task-context/v1");
      expect((context.data as any).resources.length).toBeGreaterThanOrEqual(3);

      const status = await daemon.runtimeStatus(root);
      expect((status.data as any).repositoryId).toBe(repositoryFingerprint(root));
      expect((status.data as any).worktreeDigest).toMatch(/^sha256:/);
      expect(daemon.status().sessions).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("SQLite contract enables WAL, foreign keys, busy timeout, and stores no source bodies", () => {
    const sql = migrationSql();
    for (const pragma of SQLITE_PRAGMAS) expect(sql).toContain(pragma);
    expect(() => assertNoSourceStorageSchema(sql)).not.toThrow();
  });

  test("runtime store recovers pending snapshots without losing committed state", async () => {
    const store = new TestLocalStore();
    await store.migrate();
    const snapshot = { repositoryId: "repo.test", headSha: "abc", worktreeDigest: "sha256:test" };
    const pending = await store.beginSnapshot(snapshot);
    const committed = await store.beginSnapshot(snapshot);
    await store.commitSnapshot(committed);

    expect(store.recoverPendingSnapshots()).toBe(1);
    expect(store.snapshots.has(pending)).toBe(false);
    expect(store.snapshots.get(committed)?.state).toBe("committed");
  });

  test("CodeGraph adapter is version/capability checked and blocks internal storage access", async () => {
    delete process.env.DO_NOT_TRACK;
    const provider = new MockCodeGraphProvider();
    const adapter = new CodeGraphAdapter(provider);
    expect(String(process.env.DO_NOT_TRACK)).toBe("1");
    await expect(adapter.ensureReady({ root: "/tmp/repo", repositoryId: "repo.test", headSha: "abc" })).resolves.toMatchObject({
      provider: "codegraph",
      version: REQUIRED_CODEGRAPH_VERSION
    });

    provider.version = "0.0.0";
    await expect(adapter.sync({ workspace: { root: "/tmp/repo", repositoryId: "repo.test", headSha: "abc" } })).rejects.toThrow("required");
    expect(() => assertNoCodeGraphInternalPathAccess(".codegraph/state.db")).toThrow();
  });

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
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
      rmSync(third, { recursive: true, force: true });
    }
  });

  test("Explorer loopback service is token-gated, read-only, and revocable", async () => {
    const root = tempRepo();
    try {
      const daemon = await createStartedTestDaemon({ clock: () => "2026-06-20T00:00:00.000Z" });
      await daemon.init(root, "Explorer App");
      const started = await daemon.startExplorer(root, { port: 0, tokenTtlSeconds: 60 });
      expect(started.ok).toBe(true);
      const data = started.data as any;
      expect(data.host).toBe("127.0.0.1");
      expect(data.readOnly).toBe(true);

      const projectionDenied = await fetch(`${data.url}projection`);
      expect(projectionDenied.status).toBe(401);

      const projectionWrite = await fetch(`${data.url}projection`, {
        method: "POST",
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(projectionWrite.status).toBe(405);

      const projection = await fetch(`${data.url}projection`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(projection.status).toBe(200);
      const body = await projection.json() as any;
      expect(body.data.schemaVersion).toBe("archcontext.explorer-projection/v1");
      expect(body.data.capabilities).toMatchObject({ readOnly: true, mutationMode: "forbidden", egress: "none" });
      expect(JSON.stringify(body.data)).not.toContain("sourceBody");

      const rootProjection = await fetch(`${data.url}?token=${data.token}`);
      expect((await rootProjection.json() as any).data.schemaVersion).toBe("archcontext.explorer-projection/v1");

      await daemon.revokeExplorerToken();
      const revoked = await fetch(`${data.url}projection`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(revoked.status).toBe(401);
      await daemon.stopExplorer();
      expect((daemon.explorerStatus().data as any).running).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
