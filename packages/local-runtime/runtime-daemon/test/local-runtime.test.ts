import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { assertNoCodeGraphInternalPathAccess, CodeGraphAdapter, REQUIRED_CODEGRAPH_VERSION } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { migrationSql, assertNoSourceStorageSchema, SQLITE_PRAGMAS } from "@archcontext/local-runtime/local-store-sqlite";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { listModelFiles } from "@archcontext/local-runtime/model-store-yaml";
import {
  ArchctxRuntimeRpcServer,
  RUNTIME_RPC_VERSION,
  RuntimeRpcClient,
  assertProductionRuntimeDeps,
  createStartedProductionDaemon,
  createStartedDaemon,
  defaultDaemonConnectionPath,
  defaultDaemonLockPath,
  recoverStaleDaemonControlFiles,
  readRuntimeRpcConnection
} from "../src/index";

function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-"));
  writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
  return root;
}

function removeTempRepo(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
  } catch (error) {
    if (isIgnorableWindowsCleanupError(error)) return;
    throw error;
  }
}

function isIgnorableWindowsCleanupError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return process.platform === "win32" && (code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY");
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
      removeTempRepo(root);
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

  test("daemon restart restores persisted repository sessions from the local store", async () => {
    const root = tempRepo();
    const dbPath = join(root, ".archcontext/.local/runtime.sqlite");
    let first: Awaited<ReturnType<typeof createStartedDaemon>> | undefined;
    let second: Awaited<ReturnType<typeof createStartedDaemon>> | undefined;
    try {
      first = await createStartedDaemon({
        codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
        codeGraphProviderFactory: () => new MockCodeGraphProvider(),
        localStorePath: dbPath,
        clock: () => "2026-06-20T00:00:00.000Z"
      });
      const init = await first.init(root, "Persistent Session");
      expect(init.ok).toBe(true);
      const before = await first.runtimeStatus(root);
      expect((before.data as any).sessions).toBe(1);
      await first.stop();
      first = undefined;

      second = await createStartedDaemon({
        codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
        codeGraphProviderFactory: () => new MockCodeGraphProvider(),
        localStorePath: dbPath,
        clock: () => "2026-06-20T00:01:00.000Z"
      });
      const after = await second.runtimeStatus(root);
      expect(after.data).toMatchObject({
        sessions: 1,
        repositories: [repositoryFingerprint(root)],
        repositoryId: repositoryFingerprint(root),
        headSha: (before.data as any).headSha,
        worktreeDigest: (before.data as any).worktreeDigest
      });
      await second.stop();
      second = undefined;
    } finally {
      await second?.stop().catch(() => undefined);
      await first?.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  });

  test("runtime RPC server is loopback, versioned, token-gated, and single-locked", async () => {
    const root = tempRepo();
    const daemon = await createStartedTestDaemon();
    const rpc = new ArchctxRuntimeRpcServer(daemon, {
      root,
      port: 0,
      token: "runtime-test-token",
      clock: () => "2026-06-20T00:00:00.000Z"
    });
    let stopped = false;
    try {
      const connection = await rpc.start();
      expect(connection.url.startsWith("http://127.0.0.1:")).toBe(true);
      expect(connection.schemaVersion).toBe(RUNTIME_RPC_VERSION);
      expect(existsSync(connection.connectionPath)).toBe(true);
      expect(existsSync(connection.lockPath)).toBe(true);
      if (process.platform !== "win32") {
        expect(statSync(connection.connectionPath).mode & 0o777).toBe(0o600);
        expect(statSync(connection.lockPath).mode & 0o777).toBe(0o600);
      }

      const health = await fetch(`${connection.url}health`, {
        headers: { "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION }
      });
      expect(health.status).toBe(200);
      const healthBody = await health.json() as any;
      expect(healthBody.schemaVersion).toBe(RUNTIME_RPC_VERSION);
      expect(healthBody.product.runtime.localRpc.schemaVersion).toBe(RUNTIME_RPC_VERSION);
      expect(healthBody.product.surfaces.daemon.rpcSchemaVersion).toBe(RUNTIME_RPC_VERSION);

      const mismatchedHealth = await fetch(`${connection.url}health`, {
        headers: { "X-ArchContext-RPC-Version": "archcontext.runtime-rpc/v0" }
      });
      expect(mismatchedHealth.status).toBe(426);
      expect((await mismatchedHealth.json() as any).expected).toBe(RUNTIME_RPC_VERSION);

      const denied = await fetch(`${connection.url}rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method: "runtimeStatus", params: [root] })
      });
      expect(denied.status).toBe(401);

      const mismatchedRpc = await fetch(`${connection.url}rpc`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${connection.token}`,
          "Content-Type": "application/json",
          "X-ArchContext-RPC-Version": "archcontext.runtime-rpc/v0"
        },
        body: JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method: "runtimeStatus", params: [root] })
      });
      expect(mismatchedRpc.status).toBe(426);

      const clientA = new RuntimeRpcClient(connection);
      const init = await clientA.init(root, "RPC App");
      expect(init.ok).toBe(true);
      const clientB = new RuntimeRpcClient(connection);
      const status = await clientB.runtimeStatus(root);
      expect((status.data as any).sessions).toBe(1);
      expect((status.data as any).repositoryId).toBe(repositoryFingerprint(root));

      const lockedDaemon = await createStartedTestDaemon();
      const locked = new ArchctxRuntimeRpcServer(lockedDaemon, { root, port: 0, token: "other-token" });
      await expect(locked.start()).rejects.toThrow("already running");
      await lockedDaemon.stop();

      await rpc.stop();
      stopped = true;
      expect(existsSync(connection.connectionPath)).toBe(false);
      expect(existsSync(connection.lockPath)).toBe(false);
    } finally {
      if (!stopped) await rpc.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  });

  test("production composition root uses real adapters and rejects injected runtime doubles", async () => {
    const root = tempRepo();
    try {
      const daemon = await createStartedProductionDaemon({ root });
      expect(daemon.compositionReport()).toMatchObject({
        mode: "production",
        productionSafe: true,
        adapters: {
          codeFacts: "codegraph-cli",
          codeGraphProviderFactory: "codegraph-cli",
          modelStore: "yaml",
          localStore: "sqlite",
          changeSetEngine: "default"
        }
      });
      await daemon.stop();

      const codeFacts = new CodeGraphAdapter(new MockCodeGraphProvider());
      expect(() => assertProductionRuntimeDeps({ codeFacts })).toThrow("codeFacts");
      expect(() => assertProductionRuntimeDeps({ codeGraphProviderFactory: () => new MockCodeGraphProvider() })).toThrow("codeGraphProviderFactory");
      expect(() => assertProductionRuntimeDeps({ localStore: new TestLocalStore() })).toThrow("localStore");
      expect(() => assertProductionRuntimeDeps({ clock: () => "2026-06-20T00:00:00.000Z" })).toThrow("clock");
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime RPC ignores insecure connection files and recovers stale locks", async () => {
    const root = tempRepo();
    const connectionPath = defaultDaemonConnectionPath(root);
    const lockPath = defaultDaemonLockPath(root);
    mkdirSync(join(root, ".archcontext/.local"), { recursive: true });
    writeFileSync(connectionPath, JSON.stringify({
      schemaVersion: RUNTIME_RPC_VERSION,
      protocol: "http-loopback",
      version: 1,
      root,
      url: "http://127.0.0.1:1/",
      token: "leaky-token",
      pid: process.pid,
      lockPath,
      connectionPath,
      startedAt: "2026-06-20T00:00:00.000Z"
    }, null, 2), { mode: 0o600 });
    if (process.platform === "win32") {
      expect(readRuntimeRpcConnection(root)?.token).toBe("leaky-token");
    } else {
      chmodSync(connectionPath, 0o644);
      expect(readRuntimeRpcConnection(root)).toBeUndefined();
    }
    const insecureRecovery = recoverStaleDaemonControlFiles(root);
    if (process.platform !== "win32") {
      expect(insecureRecovery.removed).toContain("insecure-connection-file");
      expect(existsSync(connectionPath)).toBe(false);
    } else {
      expect(insecureRecovery.removed).not.toContain("insecure-connection-file");
      rmSync(connectionPath, { force: true });
    }

    writeFileSync(lockPath, JSON.stringify({ pid: -1, root, startedAt: "2026-06-20T00:00:00.000Z" }, null, 2), { mode: 0o600 });
    const staleLockRecovery = recoverStaleDaemonControlFiles(root);
    expect(staleLockRecovery.removed).toContain("stale-lock-file");
    expect(existsSync(lockPath)).toBe(false);
    writeFileSync(lockPath, JSON.stringify({ pid: -1, root, startedAt: "2026-06-20T00:00:00.000Z" }, null, 2), { mode: 0o600 });
    const daemon = await createStartedTestDaemon();
    const rpc = new ArchctxRuntimeRpcServer(daemon, { root, port: 0, token: "stale-lock-token" });
    let stopped = false;
    try {
      const connection = await rpc.start();
      expect(connection.lockPath).toBe(lockPath);
      expect(JSON.parse(readFileSync(lockPath, "utf8")).pid).toBe(process.pid);
      expect(readRuntimeRpcConnection(root)?.token).toBe("stale-lock-token");
      await rpc.stop();
      stopped = true;
    } finally {
      if (!stopped) await rpc.stop().catch(() => undefined);
      removeTempRepo(root);
    }
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
      removeTempRepo(first);
      removeTempRepo(second);
      removeTempRepo(third);
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
      removeTempRepo(root);
    }
  });
});
