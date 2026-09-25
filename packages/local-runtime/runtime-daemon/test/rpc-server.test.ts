import { connect as netConnect } from "node:net";
import { once } from "node:events";
import { join, dirname } from "node:path";
import { sleep, createStartedTestDaemon, readText, removeTempRepo, tempRepo, waitUntil, rmSync } from "./runtime-test-fixtures";
import { RUNTIME_RPC_VERSION } from "../src/rpc-protocol";
import { test, expect, afterAll, describe } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, statSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { ArchctxDaemon } from "../src/index";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { ArchctxRuntimeRpcServer } from "../src/rpc-server";
import { RuntimeRpcClient } from "../src/rpc-client";
import { repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { defaultDaemonConnectionPath, defaultDaemonLockPath, readRuntimeRpcConnection, recoverStaleDaemonControlFiles } from "../src/daemon-control";

const PREVIOUS_ARCHCONTEXT_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const RUNTIME_TEST_STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-rpc-server-state-"));
process.env.ARCHCONTEXT_STATE_DIR = RUNTIME_TEST_STATE_ROOT;

afterAll(() => {
  if (PREVIOUS_ARCHCONTEXT_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_ARCHCONTEXT_STATE_DIR;
  rmSync(RUNTIME_TEST_STATE_ROOT, { recursive: true, force: true });
});

/**
 * Raw HTTP client for the runtime RPC socket. `fetch` cannot express a half-written body, a
 * chunked upload without `Content-Length`, or a mid-upload disconnect, which are exactly the
 * request shapes the daemon's body limits and read deadline have to survive.
 */
async function rawHttpRequest(input: {
  url: string;
  headerLines: string[];
  chunks?: Array<{ data: string; delayMs?: number }>;
  destroyAfterChunks?: boolean;
}): Promise<string> {
  const url = new URL(input.url);
  const socket = netConnect({ host: "127.0.0.1", port: Number(url.port) });
  socket.setNoDelay(true);
  let received = "";
  const response = new Promise<string>((resolveResponse) => {
    socket.on("data", (buffer: Buffer) => {
      received += buffer.toString("utf8");
      if (received.includes("\r\n\r\n")) resolveResponse(received);
    });
    socket.on("close", () => resolveResponse(received));
    socket.on("error", () => resolveResponse(received));
  });
  await once(socket, "connect");
  socket.write(`${input.headerLines.join("\r\n")}\r\n\r\n`);
  for (const chunk of input.chunks ?? []) {
    if (chunk.delayMs) await sleep(chunk.delayMs);
    if (socket.destroyed) break;
    if (chunk.data.length > 0) socket.write(chunk.data);
  }
  if (input.destroyAfterChunks) socket.destroy();
  const raw = await response;
  socket.destroy();
  return raw;
}

function rawHttpStatus(raw: string): number {
  const match = raw.match(/^HTTP\/1\.\d (\d{3})/);
  return match ? Number(match[1]) : 0;
}

function httpChunkFrame(data: string): string {
  return `${Buffer.byteLength(data).toString(16)}\r\n${data}\r\n`;
}

function rpcRequestHeaderLines(connection: { url: string; token: string }, extra: string[]): string[] {
  const url = new URL(connection.url);
  return [
    "POST /rpc HTTP/1.1",
    `Host: 127.0.0.1:${url.port}`,
    `Authorization: Bearer ${connection.token}`,
    "Content-Type: application/json",
    `X-ArchContext-RPC-Version: ${RUNTIME_RPC_VERSION}`,
    ...extra
  ];
}

describe("runtime RPC server", () => {
test("an RPC server whose start fails after starting the daemon releases store ownership for the retry (#160)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "archctx-rpc-start-cleanup-"));
    const dbPath = join(dir, "state", "runtime.sqlite");
    const lockPath = join(dir, "control", "archctxd.lock");
    const occupiedLock = JSON.stringify({ pid: process.pid, root: dir, startedAt: "2026-01-01T00:00:00.000Z" });
    let retry: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      mkdirSync(dirname(lockPath), { recursive: true });
      // A live process (this one) already holds the daemon lock, so start() fails after it has
      // started the daemon and claimed store ownership.
      writeFileSync(lockPath, occupiedLock, { mode: 0o600 });
      const daemon = new ArchctxDaemon({
        codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
        codeGraphProviderFactory: () => new MockCodeGraphProvider(),
        localStorePath: dbPath
      });
      const rpc = new ArchctxRuntimeRpcServer(daemon, { root: dir, port: 0, lockPath, connectionPath: join(dir, "control", "archctxd.json") });
      await expect(rpc.start()).rejects.toThrow("archctxd already running");
      expect(daemon.status().running).toBe(false);
      expect(readText(lockPath)).toBe(occupiedLock);

      retry = await createStartedTestDaemon({ localStore: undefined, localStorePath: dbPath });
      expect(retry.status().running).toBe(true);
    } finally {
      await retry?.stop();
      removeTempRepo(dir);
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

      const deniedHealth = await fetch(`${connection.url}health`);
      expect(deniedHealth.status).toBe(401);
      for (const headers of [
        { Host: "attacker.example" },
        { Origin: "https://attacker.example" },
        { Origin: "null" }
      ] as Record<string, string>[]) {
        const rejectedHealth = await fetch(`${connection.url}health?egress=1`, {
          headers: { ...headers, Authorization: `Bearer ${connection.token}` }
        });
        expect(rejectedHealth.status).toBe(403);
      }
      const health = await fetch(`${connection.url}health`, {
        headers: { "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION, Authorization: `Bearer ${connection.token}` }
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

test("runtime health does not compute egress unless explicitly requested", async () => {
    const root = tempRepo();
    const daemon = await createStartedTestDaemon();
    const rpc = new ArchctxRuntimeRpcServer(daemon, { root, port: 0 });
    let egressCalls = 0;
    daemon.egressReport = async () => { egressCalls += 1; return { source: "daemon", ok: true } as any; };
    try {
      const connection = await rpc.start();
      const client = new RuntimeRpcClient(connection);
      expect((await client.health() as any).ok).toBe(true);
      expect(egressCalls).toBe(0);
      expect((await client.health({ includeEgress: true }) as any).egress.source).toBe("daemon");
      expect(egressCalls).toBe(1);
    } finally {
      await rpc.stop();
      removeTempRepo(root);
    }
  });

test("runtime RPC bounds request bodies and applies a body read deadline", async () => {
    const root = tempRepo();
    const daemon = await createStartedTestDaemon();
    const rpc = new ArchctxRuntimeRpcServer(daemon, {
      root,
      port: 0,
      token: "rpc-body-limit-token",
      maxRequestBodyBytes: 4096,
      requestBodyTimeoutMs: 300
    });
    try {
      const connection = await rpc.start();
      const headers = {
        "Authorization": `Bearer ${connection.token}`,
        "Content-Type": "application/json",
        "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION
      };
      const envelope = (pad: string) => JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method: "runtimeStatus", params: [root], pad });
      const padLength = 4096 - Buffer.byteLength(envelope(""));
      const exact = envelope("p".repeat(padLength));
      expect(Buffer.byteLength(exact)).toBe(4096);

      const accepted = await fetch(`${connection.url}rpc`, { method: "POST", headers, body: exact });
      expect(accepted.status).toBe(200);
      expect((await accepted.json() as any).ok).toBe(true);

      const oversized = await fetch(`${connection.url}rpc`, { method: "POST", headers, body: envelope("p".repeat(padLength + 1)) });
      expect(oversized.status).toBe(413);
      expect((await oversized.json() as any).error).toBe("runtime RPC request body exceeds the configured limit");

      // No Content-Length to pre-check: the streaming byte counter has to stop the upload.
      const chunkedOverflow = await rawHttpRequest({
        url: connection.url,
        headerLines: rpcRequestHeaderLines(connection, ["Transfer-Encoding: chunked"]),
        chunks: [
          { data: httpChunkFrame("q".repeat(3000)) },
          { data: httpChunkFrame("q".repeat(3000)), delayMs: 20 }
        ]
      });
      expect(rawHttpStatus(chunkedOverflow)).toBe(413);

      const chunkedAccepted = await rawHttpRequest({
        url: connection.url,
        headerLines: rpcRequestHeaderLines(connection, ["Transfer-Encoding: chunked"]),
        chunks: [
          { data: httpChunkFrame(JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method: "runtimeStatus", params: [root] })) },
          { data: "0\r\n\r\n" }
        ]
      });
      expect(rawHttpStatus(chunkedAccepted)).toBe(200);

      const slowUpload = await rawHttpRequest({
        url: connection.url,
        headerLines: rpcRequestHeaderLines(connection, ["Content-Length: 4000"]),
        chunks: [{ data: "{" }]
      });
      expect(rawHttpStatus(slowUpload)).toBe(408);

      const malformed = await fetch(`${connection.url}rpc`, { method: "POST", headers, body: "{ not json" });
      expect(malformed.status).toBe(400);
      const malformedBody = await malformed.json() as any;
      expect(malformedBody.error).toBe("runtime RPC request body is not valid JSON");
      expect(JSON.stringify(malformedBody)).not.toContain("position");
    } finally {
      await rpc.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  }, 15_000);

test("idle exit does not start while an accepted RPC request is still reading its body", async () => {
    const root = tempRepo();
    const daemon = await createStartedTestDaemon();
    const exitCodes: number[] = [];
    const rpc = new ArchctxRuntimeRpcServer(daemon, {
      root,
      port: 0,
      token: "rpc-body-idle-token",
      idleTimeoutMs: 100,
      requestBodyTimeoutMs: 5_000,
      exit: (code) => { exitCodes.push(code); }
    });
    try {
      const connection = await rpc.start();
      const inFlight = () => (rpc as unknown as { inFlightRpcRequests: number }).inFlightRpcRequests;
      const body = JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method: "runtimeStatus", params: [root] });
      const slow = rawHttpRequest({
        url: connection.url,
        headerLines: rpcRequestHeaderLines(connection, [`Content-Length: ${Buffer.byteLength(body)}`]),
        chunks: [{ data: body.slice(0, 5) }, { data: body.slice(5), delayMs: 400 }]
      });
      await waitUntil(() => inFlight() === 1, 1_000, "accepted request counted as in flight while uploading");
      await sleep(250);
      // Idle exit "beginning" is observable before the exit callback: it removes the connection
      // file first, and its own `stop()` then blocks on this still-open upload connection.
      expect(exitCodes).toEqual([]);
      expect(existsSync(connection.connectionPath)).toBe(true);
      expect(rawHttpStatus(await slow)).toBe(200);
      await waitUntil(() => inFlight() === 0, 1_000, "in-flight released after the response");
    } finally {
      await rpc.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  }, 15_000);

test("client disconnect during upload releases the RPC body buffers and in-flight slot", async () => {
    const root = tempRepo();
    const daemon = await createStartedTestDaemon();
    const rpc = new ArchctxRuntimeRpcServer(daemon, {
      root,
      port: 0,
      token: "rpc-body-abort-token",
      idleTimeoutMs: 0,
      requestBodyTimeoutMs: 5_000
    });
    try {
      const connection = await rpc.start();
      const inFlight = () => (rpc as unknown as { inFlightRpcRequests: number }).inFlightRpcRequests;
      const aborted = rawHttpRequest({
        url: connection.url,
        headerLines: rpcRequestHeaderLines(connection, ["Content-Length: 4000"]),
        chunks: [{ data: "{" }, { data: "", delayMs: 300 }],
        destroyAfterChunks: true
      });
      await waitUntil(() => inFlight() === 1, 1_000, "aborted request counted as in flight while uploading");
      await aborted;
      await waitUntil(() => inFlight() === 0, 2_000, "in-flight released after client disconnect");

      const recovered = await new RuntimeRpcClient(connection).runtimeStatus(root);
      expect(recovered.ok).toBe(true);
    } finally {
      await rpc.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  }, 15_000);

// Regression tests for the daemon idle self-exit (`archctxd` is spawned `detached`+`unref()`'d
  // with no other exit signal — see F5 in tasks/reviews/audit-approve-gh-publishing.review.md,
  // which caused cross-day zombie processes). `exit` is injected so the idle path's real
  // `process.exit(0)` call never terminates this test runner; real-process termination is covered
  // separately by the CLI-level `--idle-timeout-ms` e2e test.
  test("idle RPC server exits itself once genuinely idle, and a completed RPC request resets the deadline", async () => {
    const root = tempRepo();
    const daemon = await createStartedTestDaemon();
    const exitCodes: number[] = [];
    const rpc = new ArchctxRuntimeRpcServer(daemon, {
      root,
      port: 0,
      token: "idle-exit-token",
      idleTimeoutMs: 300,
      exit: (code) => { exitCodes.push(code); }
    });
    try {
      const connection = await rpc.start();
      // Completing an RPC request well before the original 300ms deadline must push the deadline
      // out again: checking after the *original* deadline has already elapsed (but before the
      // reset one) proves the reset actually happened rather than the timer never having started.
      await sleep(200);
      const init = await new RuntimeRpcClient(connection).init(root, "Idle Reset App");
      expect(init.ok).toBe(true);
      await sleep(150);
      expect(exitCodes).toEqual([]);
      expect(existsSync(connection.connectionPath)).toBe(true);

      await waitUntil(() => exitCodes.length > 0, 3_000, "idle-exit callback after reset");
      expect(exitCodes).toEqual([0]);
      expect(existsSync(connection.connectionPath)).toBe(false);
      expect(existsSync(connection.lockPath)).toBe(false);
      expect(daemon.status().running).toBe(false);
    } finally {
      await rpc.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  }, 10_000);

test("idle RPC server does not exit while an audit investigation abort controller is active", async () => {
    const root = tempRepo();
    const daemon = await createStartedTestDaemon();
    // Simulates `auditRun`'s tracked background investigation without driving a real one: this
    // exercises the RPC server's idle check against `ArchctxDaemon.hasActiveBackgroundWork`
    // in isolation from the audit subsystem itself.
    (daemon as unknown as { auditRunAbortControllers: Map<string, AbortController> })
      .auditRunAbortControllers.set("agent_job.idle-test", new AbortController());
    const exitCodes: number[] = [];
    const rpc = new ArchctxRuntimeRpcServer(daemon, {
      root,
      port: 0,
      token: "idle-busy-audit-token",
      idleTimeoutMs: 150,
      exit: (code) => { exitCodes.push(code); }
    });
    try {
      const connection = await rpc.start();
      await sleep(450);
      expect(exitCodes).toEqual([]);
      expect(existsSync(connection.connectionPath)).toBe(true);
    } finally {
      await rpc.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  }, 10_000);

test("idle timeout of 0 disables idle exit", async () => {
    const root = tempRepo();
    const daemon = await createStartedTestDaemon();
    const exitCodes: number[] = [];
    const rpc = new ArchctxRuntimeRpcServer(daemon, {
      root,
      port: 0,
      token: "idle-disabled-token",
      idleTimeoutMs: 0,
      exit: (code) => { exitCodes.push(code); }
    });
    try {
      const connection = await rpc.start();
      await sleep(450);
      expect(exitCodes).toEqual([]);
      expect(existsSync(connection.connectionPath)).toBe(true);
    } finally {
      await rpc.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  }, 10_000);

test("runtime RPC ignores insecure connection files and recovers stale locks", async () => {
    const root = tempRepo();
    const connectionPath = defaultDaemonConnectionPath(root);
    const lockPath = defaultDaemonLockPath(root);
    mkdirSync(dirname(connectionPath), { recursive: true });
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
});
