import { expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { createStartedTestDaemon, removeTempRepo, tempRepo } from "./runtime-test-fixtures";
import { ArchctxRuntimeRpcServer } from "../src/rpc-server";
import { RuntimeRpcClient } from "../src/rpc-client";
import { RUNTIME_RPC_VERSION } from "../src/rpc-protocol";

const V1 = "archcontext.runtime-rpc/v1";
const V2 = "archcontext.runtime-rpc/v2";

function sqliteState(path: string) {
  const db = new Database(path, { readonly: true });
  try {
    const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
    return {
      rows: tables.map(({ name }) => ({ name, rows: db.query(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all().map(row => JSON.stringify(row)).sort() })),
      bytes: [path, `${path}-wal`].map(file => existsSync(file) ? readFileSync(file) : undefined)
    };
  } finally {
    db.close();
  }
}

test("RPC v2 refuses v1 headers and header-less bodies without baseline, SQLite or session changes", async () => {
  const root = tempRepo();
  const state = mkdtempSync(join(tmpdir(), "archctx-rpc-v2-state-"));
  const previous = process.env.ARCHCONTEXT_STATE_DIR;
  process.env.ARCHCONTEXT_STATE_DIR = state;
  const dbPath = join(state, "runtime.sqlite");
  const store = new SqliteLocalStore(dbPath);
  const daemon = await createStartedTestDaemon({ localStore: store });
  const rpc = new ArchctxRuntimeRpcServer(daemon, { root, idleTimeoutMs: 0 });
  try {
    initializeArchContextModel(root, "RPC v2");
    const connection = await rpc.start();
    const client = new RuntimeRpcClient(connection);
    expect((await client.prepare(root, "refactor dependency boundaries", 12_288, 5, "task_rpc_v2")).ok).toBe(true);
    const key = `practice-checkpoint:${repositoryFingerprint(root)}:task_rpc_v2`;
    const baseline = structuredClone(await store.readTaskState(key));
    expect(baseline).toMatchObject({ schemaVersion: "archcontext.practice-checkpoint-baseline/v1" });
    const before = sqliteState(dbPath);
    const sessions = daemon.status().sessions;
    const openSession = spyOn(daemon, "openSession");
    const saveBaseline = spyOn(store, "saveTaskState");
    const saveSession = spyOn(store, "saveRepositorySession");
    try {
      for (const sample of [
        { header: V1, body: V2 },
        { header: V2, body: V1 },
        { header: undefined, body: V1 }
      ]) {
        for (const [method, params] of [
          ["prepare", [root, "must not seed a baseline", 12_288, 5, "rejected_task"]],
          ["practiceCheckpoint", [root, { taskSessionId: "task_rpc_v2", event: "manual" }]]
        ] as const) {
          const response = await fetch(`${connection.url}rpc`, {
            method: "POST",
            headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json",
              ...(sample.header ? { "X-ArchContext-RPC-Version": sample.header } : {}) },
            body: JSON.stringify({ schemaVersion: sample.body, method, params })
          });
          expect(response.status).toBe(426);
          expect(await response.json()).toEqual({
            schemaVersion: V2, ok: false, error: "runtime RPC version mismatch",
            expected: V2, received: V1, action: "upgrade-archctx-runtime", upgradeCommand: "archctx daemon upgrade"
          });
        }
      }
      const health = await fetch(`${connection.url}health`, {
        headers: { Authorization: `Bearer ${connection.token}`, "X-ArchContext-RPC-Version": V1 }
      });
      expect(health.status).toBe(426);
      expect((await health.json() as any).upgradeCommand).toBe("archctx daemon upgrade");
      const legacy = await fetch(`${connection.url}rpc`, {
        method: "POST", headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json", "X-ArchContext-RPC-Version": V2 },
        body: JSON.stringify({ schemaVersion: V2, method: "checkpoint", params: [root, { taskSessionId: "task_rpc_v2" }] })
      });
      expect(await legacy.json()).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID", message: "Unknown runtime RPC method: checkpoint" } });
      expect(openSession).not.toHaveBeenCalled();
      expect(saveBaseline).not.toHaveBeenCalled();
      expect(saveSession).not.toHaveBeenCalled();
      expect(daemon.status().sessions).toBe(sessions);
      expect(await store.readTaskState(key)).toEqual(baseline);
      expect(sqliteState(dbPath)).toEqual(before);

      expect(RUNTIME_RPC_VERSION).toBe(V2);
      expect(connection.schemaVersion).toBe(V2);
      const healthy = await client.health() as any;
      expect(healthy.ok).toBe(true);
      expect(healthy.schemaVersion).toBe(V2);
      const writer = await client.practiceCheckpoint(root, { taskSessionId: "task_rpc_v2", event: "manual" });
      expect(writer.ok).toBe(true);
      expect(writer.data).toMatchObject({ schemaVersion: "archcontext.practice-checkpoint/v1", fresh: true });
      expect(saveBaseline).toHaveBeenCalledTimes(1);
    } finally {
      openSession.mockRestore();
      saveBaseline.mockRestore();
      saveSession.mockRestore();
    }
  } finally {
    await rpc.stop();
    if (previous === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previous;
    removeTempRepo(root);
    removeTempRepo(state);
  }
}, 30_000);
