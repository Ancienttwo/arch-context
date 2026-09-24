import { describe, expect, test } from "bun:test";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createNetServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { RUNTIME_RPC_VERSION } from "../src/rpc-protocol";
import { RuntimeRpcClient, RuntimeRpcTransportError } from "../src/rpc-client";

function loopbackRpcConnection(port: number) {
  return {
    schemaVersion: RUNTIME_RPC_VERSION,
    protocol: "http-loopback",
    version: 1,
    root: tmpdir(),
    url: `http://127.0.0.1:${port}/`,
    token: "stalled-runtime-rpc-token",
    pid: process.pid,
    lockPath: "",
    connectionPath: "",
    startedAt: "2026-06-20T00:00:00.000Z"
  } as const;
}

async function listenLoopback(server: HttpServer): Promise<number> {
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return (server.address() as { port: number }).port;
}

async function closeLoopback(server: HttpServer): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

describe("runtime RPC client transport", () => {
  test("runtime RPC client fails stalled health and RPC calls within its configured deadline", async () => {
    let requests = 0;
    const stalled = createHttpServer((request) => {
      requests += 1;
      request.resume();
    });
    const port = await listenLoopback(stalled);
    try {
      const connection = loopbackRpcConnection(port);
      const client = new RuntimeRpcClient(connection, { timeouts: { health: 150, short: 150, normal: 150, long: 150 } });

      const startedAt = Date.now();
      const healthError = await client.health().catch((error: unknown) => error);
      expect(healthError).toBeInstanceOf(RuntimeRpcTransportError);
      expect((healthError as RuntimeRpcTransportError).code).toBe("RPC_TIMEOUT");
      expect((healthError as RuntimeRpcTransportError).method).toBe("health");
      expect((healthError as RuntimeRpcTransportError).timeoutMs).toBe(150);
      expect((healthError as RuntimeRpcTransportError).elapsedMs).toBeGreaterThanOrEqual(100);
      expect(Date.now() - startedAt).toBeLessThan(3_000);

      const rpcError = await client.runtimeStatus(tmpdir()).catch((error: unknown) => error);
      expect(rpcError).toBeInstanceOf(RuntimeRpcTransportError);
      expect((rpcError as RuntimeRpcTransportError).code).toBe("RPC_TIMEOUT");
      expect((rpcError as RuntimeRpcTransportError).method).toBe("runtimeStatus");
      expect((rpcError as Error).message).not.toContain(connection.token);
      expect(String((rpcError as Error).stack)).not.toContain(connection.token);

      // A timed-out mutation must not be replayed: the daemon may have already committed it.
      const before = requests;
      await client.applyUpdate(tmpdir(), { id: "changeset.timeout", approved: true, expectedWorktreeDigest: `sha256:${"0".repeat(64)}` })
        .catch(() => undefined);
      await sleep(300);
      expect(requests - before).toBe(1);

      const controller = new AbortController();
      const cancellable = new RuntimeRpcClient(connection, {
        timeouts: { health: 10_000, short: 10_000, normal: 10_000, long: 10_000 },
        signal: controller.signal
      });
      const cancelStartedAt = Date.now();
      setTimeout(() => controller.abort(), 50);
      const cancelled = await cancellable.runtimeStatus(tmpdir()).catch((error: unknown) => error);
      expect(cancelled).toBeInstanceOf(RuntimeRpcTransportError);
      expect((cancelled as RuntimeRpcTransportError).code).toBe("RPC_ABORTED");
      expect(Date.now() - cancelStartedAt).toBeLessThan(3_000);
    } finally {
      await closeLoopback(stalled);
    }
  }, 15_000);

  test("runtime RPC client separates long running method deadlines from short control calls", async () => {
    const server = createHttpServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); });
      request.on("end", () => {
        const method = request.url === "/health" ? "health" : (JSON.parse(body || "{}") as { method?: string }).method ?? "unknown";
        if (method === "validate") {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.write("{\"schemaVersion\":");
          return;
        }
        setTimeout(() => {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ schemaVersion: "archcontext.envelope/v1", ok: true, kind: `test.${method}`, data: {} }));
        }, 250);
      });
    });
    const port = await listenLoopback(server);
    try {
      const connection = loopbackRpcConnection(port);
      const strict = new RuntimeRpcClient(connection, { timeouts: { health: 900, short: 100, normal: 100, long: 900 } });

      const shortTimeout = await strict.runtimeStatus(tmpdir()).catch((error: unknown) => error);
      expect(shortTimeout).toBeInstanceOf(RuntimeRpcTransportError);
      expect((shortTimeout as RuntimeRpcTransportError).method).toBe("runtimeStatus");

      // Delayed headers on a long-running method stay inside its own, explicitly longer deadline.
      expect((await strict.auditRun(tmpdir())).ok).toBe(true);
      expect((await strict.health() as any).ok).toBe(true);

      // A response that starts but never finishes still fails on the deadline.
      const stalledBody = await strict.validate(tmpdir()).catch((error: unknown) => error);
      expect(stalledBody).toBeInstanceOf(RuntimeRpcTransportError);
      expect((stalledBody as RuntimeRpcTransportError).code).toBe("RPC_TIMEOUT");

      const relaxed = new RuntimeRpcClient(connection, { timeouts: { health: 900, short: 400, normal: 400, long: 900 } });
      expect((await relaxed.runtimeStatus(tmpdir())).ok).toBe(true);
    } finally {
      await closeLoopback(server);
    }
  }, 15_000);

  test("runtime RPC client never reuses a kept-alive socket the daemon may already be closing (#178)", async () => {
    // Worst-case model of the daemon's keep-alive race: an HTTP/1.1 server that keeps idle
    // connections alive unless the client asks to close, but whose idle-socket close fires the
    // moment a second request arrives on a reused connection (what node:http does when a
    // synchronous planUpdate held its event loop past the keep-alive deadline). A client that reuses
    // pooled sockets loses the follow-up applyUpdate as `fetch failed` before the server reads it.
    const received: Array<{ method: string; connection: number; connectionHeader: string | undefined }> = [];
    const sockets = new Set<Socket>();
    let connections = 0;
    const server = createNetServer((socket) => {
      const connection = ++connections;
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      let buffered = Buffer.alloc(0);
      let answered = false;
      socket.on("data", (chunk: Buffer) => {
        if (answered) {
          socket.destroy();
          return;
        }
        buffered = Buffer.concat([buffered, chunk]);
        const headerEnd = buffered.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const head = buffered.subarray(0, headerEnd).toString("latin1").split("\r\n");
        const headers = new Map(head.slice(1).map((line) => {
          const colon = line.indexOf(":");
          return [line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()] as const;
        }));
        const bodyLength = Number(headers.get("content-length") ?? 0);
        if (buffered.length < headerEnd + 4 + bodyLength) return;
        const body = buffered.subarray(headerEnd + 4, headerEnd + 4 + bodyLength).toString("utf8");
        const method = head[0]!.startsWith("GET /health") ? "health" : (JSON.parse(body) as { method: string }).method;
        const connectionHeader = headers.get("connection");
        received.push({ method, connection, connectionHeader });
        answered = true;
        const close = connectionHeader?.toLowerCase() === "close";
        const payload = JSON.stringify(method === "health"
          ? { schemaVersion: RUNTIME_RPC_VERSION, ok: true }
          : { schemaVersion: "archcontext.envelope/v1", ok: true, kind: `test.${method}`, data: {} });
        socket.write([
          "HTTP/1.1 200 OK",
          "Content-Type: application/json",
          `Content-Length: ${Buffer.byteLength(payload)}`,
          close ? "Connection: close" : "Connection: keep-alive",
          ...(close ? [] : ["Keep-Alive: timeout=5"]),
          "",
          payload
        ].join("\r\n"));
        if (close) socket.end();
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const client = new RuntimeRpcClient(loopbackRpcConnection((server.address() as { port: number }).port));
      expect((await client.health() as { ok?: boolean }).ok).toBe(true);
      const root = tmpdir();
      const planned = await client.planUpdate(root, { id: "changeset.keepalive", operations: [] });
      expect(planned.ok).toBe(true);
      const applied = await client.applyUpdate(root, { id: "changeset.keepalive", approved: true, expectedWorktreeDigest: `sha256:${"0".repeat(64)}` });
      expect(applied.ok).toBe(true);

      expect(received.map((entry) => entry.method)).toEqual(["health", "planUpdate", "applyUpdate"]);
      expect(new Set(received.map((entry) => entry.connection)).size).toBe(received.length);
      expect(received.every((entry) => entry.connectionHeader?.toLowerCase() === "close")).toBe(true);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  }, 15_000);

});
