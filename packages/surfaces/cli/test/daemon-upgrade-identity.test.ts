import { expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { digestJson, type JsonEnvelope } from "@archcontext/contracts";
import { createPrivateControlFile } from "@archcontext/local-runtime/control-file-security";
import { defaultDaemonConnectionPath, defaultDaemonLockPath } from "@archcontext/local-runtime/runtime-daemon";
import { RuntimeRpcClient, RUNTIME_RPC_VERSION } from "@archcontext/local-runtime/runtime-rpc-client";
import { isProcessAlive } from "@archcontext/local-runtime/process-liveness";
import { SqliteLocalStore, runtimeStatePaths } from "@archcontext/local-runtime/local-store-sqlite";
import { createCommittedGitRepo } from "../../../local-runtime/local-store-sqlite/test/git-fixtures";
import { createStartedTestDaemon, removeTempPath, waitUntil } from "../../../local-runtime/runtime-daemon/test/runtime-test-fixtures";
import { runCli } from "../src/main";

async function fixture(mode: string) {
  const workspace = mkdtempSync(join(tmpdir(), "archctx-upgrade-identity-"));
  const root = join(workspace, "repo");
  const previous = process.env.ARCHCONTEXT_STATE_DIR;
  process.env.ARCHCONTEXT_STATE_DIR = join(workspace, "state");
  createCommittedGitRepo(root);
  const dbPath = runtimeStatePaths(root).localStorePath;
  const store = new SqliteLocalStore(dbPath);
  const seed = await createStartedTestDaemon({ localStore: store });
  await store.saveTaskState("identity-fixture", { fixture: "preserve this runtime state" });
  await seed.stop();
  const runtimeBytes = readFileSync(dbPath);
  const signalsPath = join(workspace, "signals");
  const children: ChildProcess[] = [];
  const connectionPath = defaultDaemonConnectionPath(root);
  const lockPath = defaultDaemonLockPath(root);
  const spawnChild = async (kind: string) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("./fixtures/upgrade-owner.ts", import.meta.url)), root, kind, signalsPath], { stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let output = "";
    child.stdout!.on("data", chunk => { output += chunk.toString(); });
    child.stderr!.on("data", chunk => { output += chunk.toString(); });
    await waitUntil(() => output.includes("ready\n"), 15_000, `isolated ${kind} fixture startup`);
    return child;
  };
  const child = await spawnChild(mode);
  const publish = (pid: number, token?: string) => {
    mkdirSync(dirname(connectionPath), { recursive: true });
    createPrivateControlFile(connectionPath, JSON.stringify({
      schemaVersion: "archcontext.runtime-rpc/v0", protocol: "http-loopback", version: 1, root,
      url: "http://127.0.0.1:1/", ...(token ? { token } : {}), pid, connectionPath, lockPath, startedAt: "2000-01-01T00:00:00.000Z"
    }));
    createPrivateControlFile(lockPath, JSON.stringify({ root, pid }));
  };
  const cleanup = async () => {
    // Any replacement belongs exclusively to this test's isolated state directory.
    if (existsSync(connectionPath)) {
      const current = JSON.parse(readFileSync(connectionPath, "utf8"));
      if (!children.some(item => item.pid === current.pid) && current.schemaVersion === RUNTIME_RPC_VERSION) {
        await new RuntimeRpcClient(current).shutdown().catch(() => undefined);
        await waitUntil(() => !isProcessAlive(current.pid), 10_000, "isolated replacement cleanup");
      }
    }
    for (const item of children) {
      if (item.pid && isProcessAlive(item.pid)) {
        item.kill("SIGTERM");
        await waitUntil(() => !isProcessAlive(item.pid!), 10_000, "owned fixture cleanup");
      }
    }
    if (previous === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previous;
    removeTempPath(workspace);
  };
  return { root, workspace, child, signalsPath, connectionPath, lockPath, dbPath, runtimeBytes, publish, cleanup };
}

for (const token of [undefined, "stale-instance-token"]) {
  test(`#351: upgrade refuses ${token ? "reused unrelated PID" : "legacy PID-only record"} without signalling or starting a writer`, async () => {
    const f = await fixture("unrelated");
    try {
      f.publish(f.child.pid!, token);
      const before = [readFileSync(f.connectionPath), readFileSync(f.lockPath)];
      const result = await runCli("daemon", ["upgrade", "--timeout-ms", "2000"], f.root) as JsonEnvelope;
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("AC_RUNTIME_VERSION_UNSUPPORTED");
      expect(result.error?.reasonCode).toBe("daemon-ownership-unproven");
      expect(result.error?.message).toContain("owning terminal");
      expect(isProcessAlive(f.child.pid!)).toBe(true);
      expect(existsSync(f.signalsPath)).toBe(false);
      expect([readFileSync(f.connectionPath), readFileSync(f.lockPath)]).toEqual(before);
      expect(readFileSync(f.dbPath)).toEqual(f.runtimeBytes);
      expect(existsSync(join(dirname(f.connectionPath), "archctxd.log"))).toBe(false);
    } finally { await f.cleanup(); }
  }, 30_000);
}

test("#351: identity change after health refuses termination and preserves control files", async () => {
  const f = await fixture("change-after-health");
  try {
    const before = [readFileSync(f.connectionPath), readFileSync(f.lockPath)];
    const result = await runCli("daemon", ["upgrade", "--timeout-ms", "2000"], f.root) as JsonEnvelope;
    expect(result.ok).toBe(false);
    expect(result.error?.reasonCode).toBe("daemon-ownership-unproven");
    expect(isProcessAlive(f.child.pid!)).toBe(true);
    expect(existsSync(f.signalsPath)).toBe(false);
    expect([readFileSync(f.connectionPath), readFileSync(f.lockPath)]).toEqual(before);
    expect(readFileSync(f.dbPath)).toEqual(f.runtimeBytes);
    expect(existsSync(join(dirname(f.connectionPath), "archctxd.log"))).toBe(false);
  } finally { await f.cleanup(); }
}, 30_000);

test("#351: server rejects an expected identity that differs from its live instance", async () => {
  const f = await fixture("normal");
  try {
    const connection = JSON.parse(readFileSync(f.connectionPath, "utf8"));
    const response = await fetch(`${connection.url}rpc`, {
      method: "POST", headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json", "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION },
      body: JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method: "shutdown", params: [{
        schemaVersion: "archcontext.daemon-instance/v1", pid: connection.pid, root: connection.root,
        instanceId: digestJson({ token: "different-instance" })
      }] })
    });
    expect(await response.json()).toMatchObject({ ok: false, error: { reasonCode: "daemon-stop-identity-mismatch" } });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(isProcessAlive(f.child.pid!)).toBe(true);
    expect(existsSync(f.connectionPath)).toBe(true);
  } finally { await f.cleanup(); }
}, 30_000);

test("#351: verified owner upgrades by self-stop without any external signal", async () => {
  const f = await fixture("normal");
  try {
    const result = await runCli("daemon", ["upgrade"], f.root) as JsonEnvelope;
    expect(result).toMatchObject({ ok: true });
    expect(result.data).toMatchObject({ upgraded: true, replacedRuntime: { previousPid: f.child.pid } });
    expect(isProcessAlive(f.child.pid!)).toBe(false);
    expect(existsSync(f.signalsPath)).toBe(false);
    const current = JSON.parse(readFileSync(f.connectionPath, "utf8"));
    expect(current.pid).not.toBe(f.child.pid);
    expect((await new RuntimeRpcClient(current).health() as any).ok).toBe(true);
  } finally { await f.cleanup(); }
}, 45_000);

test("#351: dead fixture PID recovers and starts one replacement", async () => {
  const f = await fixture("unrelated");
  try {
    f.child.kill("SIGTERM");
    await waitUntil(() => !isProcessAlive(f.child.pid!), 10_000, "fixture exit before stale record");
    f.publish(f.child.pid!);
    // Windows force-terminates the owned fixture without running its SIGTERM handler.
    const signalsSnapshot = () => process.platform === "win32" && !existsSync(f.signalsPath)
      ? undefined : readFileSync(f.signalsPath);
    const signals = signalsSnapshot();
    const result = await runCli("daemon", ["upgrade"], f.root) as JsonEnvelope;
    expect(result.ok).toBe(true);
    expect(signalsSnapshot()).toEqual(signals);
    const current = JSON.parse(readFileSync(f.connectionPath, "utf8"));
    expect(current.pid).not.toBe(f.child.pid);
    expect((await new RuntimeRpcClient(current).health() as any).ok).toBe(true);
  } finally { await f.cleanup(); }
}, 45_000);
