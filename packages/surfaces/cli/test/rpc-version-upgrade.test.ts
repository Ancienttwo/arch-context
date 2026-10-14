import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { RuntimeRpcClient, RUNTIME_RPC_VERSION } from "@archcontext/local-runtime/runtime-rpc-client";
import { defaultDaemonConnectionPath, defaultDaemonLockPath, readRuntimeRpcConnection, runtimeRpcCompatibilityIssue } from "@archcontext/local-runtime/runtime-daemon";
import { isProcessAlive } from "@archcontext/local-runtime/process-liveness";
import { createCommittedGitRepo } from "../../../local-runtime/local-store-sqlite/test/git-fixtures";
import { removeTempPath, waitUntil } from "../../../local-runtime/runtime-daemon/test/runtime-test-fixtures";
import { runFastHookEnqueue } from "../src/hook-fast";
import { runCli } from "../src/main";

const V1 = "archcontext.runtime-rpc/v1";
const V2 = "archcontext.runtime-rpc/v2";

test("v2 CLI diagnoses a frozen-v1 peer, preserves discovery files, and upgrades it by PID", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "archctx-rpc-v2-upgrade-"));
  const root = join(workspace, "repo");
  const previous = process.env.ARCHCONTEXT_STATE_DIR;
  process.env.ARCHCONTEXT_STATE_DIR = join(workspace, "state");
  createCommittedGitRepo(root);
  const connectionPath = defaultDaemonConnectionPath(root);
  const lockPath = defaultDaemonLockPath(root);
  const requestsPath = join(workspace, "requests.jsonl");
  mkdirSync(dirname(connectionPath), { recursive: true });
  const peer = spawn(process.execPath, [fileURLToPath(new URL("./fixtures/legacy-rpc-peer.ts", import.meta.url)), root, connectionPath, lockPath, requestsPath], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  peer.stdout!.on("data", chunk => { output += chunk.toString(); });
  peer.stderr!.on("data", chunk => { output += chunk.toString(); });
  let replacementPid: number | undefined;
  try {
    await waitUntil(() => output.includes("ready\n"), 15_000, "frozen v1 peer startup");
    const connectionBytes = readFileSync(connectionPath);
    const lockBytes = readFileSync(lockPath);
    const connection = JSON.parse(connectionBytes.toString());
    expect(RUNTIME_RPC_VERSION).toBe(V2);
    expect(runtimeRpcCompatibilityIssue(root)).toMatchObject({
      reason: "rpc-version-mismatch", expected: V2, received: V1,
      pid: peer.pid, pidAlive: true, upgradeCommand: "archctx daemon upgrade"
    });
    expect(readRuntimeRpcConnection(root)).toBeUndefined();
    const status = await runCli("daemon", ["status"], root);
    expect(status.data).toMatchObject({ rpcVersionCompatible: false, versionUnsupported: { reason: "rpc-version-mismatch", received: V1, command: "archctx daemon upgrade" } });
    const hook = await runFastHookEnqueue(["hook", "enqueue"], root);
    expect(hook.handled).toBe(true);
    expect(hook.envelope).toMatchObject({ ok: true, data: { schemaVersion: "archcontext.hook-enqueue-fail-open/v1", failOpen: true, reasonCode: "runtime-unavailable" } });
    expect((hook.envelope as any).data.message).toContain("archctx daemon upgrade");
    expect((hook.envelope as any).data.message).toContain(V1);
    expect((hook.envelope as any).data.message).toContain(V2);
    expect(readFileSync(connectionPath)).toEqual(connectionBytes);
    expect(readFileSync(lockPath)).toEqual(lockBytes);
    expect(existsSync(requestsPath)).toBe(false);

    // Force transport negotiation independently of the connection-file discovery gate.
    const client = new RuntimeRpcClient({ ...connection, schemaVersion: V2 });
    const health = await client.health() as any;
    expect(health).toMatchObject({ ok: false, error: "runtime RPC version mismatch", expected: V1, received: V2 });
    const writer = await client.practiceCheckpoint(root, { taskSessionId: "never-written" });
    expect(writer).toMatchObject({ ok: false, error: "runtime RPC version mismatch", expected: V1, received: V2 });
    writeFileSync(connectionPath, JSON.stringify({ ...connection, schemaVersion: V2 }), { mode: 0o600 });
    const transportStatus = await runCli("daemon", ["status"], root);
    expect(transportStatus.data).toMatchObject({ rpcVersionCompatible: false,
      versionUnsupported: { reason: "rpc-version-mismatch", expected: V2, received: V1, command: "archctx daemon upgrade" } });
    writeFileSync(connectionPath, connectionBytes, { mode: 0o600 });
    const requestBytes = readFileSync(requestsPath, "utf8");
    const requests = requestBytes.trim().split("\n").map(line => JSON.parse(line));
    expect(requests.every(request => request.header === V2)).toBe(true);
    expect(requests.find(request => request.route === "/rpc").body.schemaVersion).toBe(V2);

    const upgraded = await runCli("daemon", ["upgrade"], root);
    if (existsSync(connectionPath)) replacementPid = JSON.parse(readFileSync(connectionPath, "utf8")).pid;
    expect(upgraded.ok).toBe(true);
    expect(upgraded.data).toMatchObject({ upgraded: true, replacedRuntime: {
      previousRpcSchemaVersion: V1, expectedRpcSchemaVersion: V2, previousPid: peer.pid
    } });
    expect(isProcessAlive(peer.pid!)).toBe(false);
    const current = JSON.parse(readFileSync(connectionPath, "utf8"));
    replacementPid = current.pid;
    expect(current.schemaVersion).toBe(V2);
    expect(current.version).toBe(1);
    expect(current.pid).not.toBe(peer.pid);
    expect(readFileSync(requestsPath, "utf8")).toBe(requestBytes);
    const currentHealth = await new RuntimeRpcClient(current).health() as any;
    expect(currentHealth.ok).toBe(true);
    expect(currentHealth.schemaVersion).toBe(V2);
  } finally {
    if (peer.pid && isProcessAlive(peer.pid)) {
      peer.kill("SIGTERM");
      await waitUntil(() => !isProcessAlive(peer.pid!), 10_000, "v1 peer cleanup");
    }
    if (replacementPid && isProcessAlive(replacementPid)) {
      await runCli("daemon", ["stop"], root);
      await waitUntil(() => !isProcessAlive(replacementPid!), 10_000, "v2 replacement cleanup");
    }
    if (previous === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previous;
    removeTempPath(workspace);
  }
}, process.platform === "win32" ? 240_000 : 45_000);
