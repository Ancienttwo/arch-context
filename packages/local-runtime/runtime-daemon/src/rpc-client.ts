import { RUNTIME_RPC_METHODS, runtimeRpcMethod, type RuntimeRpcClientMethods, type RuntimeRpcMethodName } from "./rpc-methods";
import { RUNTIME_RPC_VERSION } from "./rpc-protocol";
import type { Json, JsonEnvelope } from "@archcontext/contracts";
import type { RuntimeDaemonClient, RuntimeRpcConnection } from "./rpc-protocol";

export type RuntimeRpcTransportErrorCode = "RPC_TIMEOUT" | "RPC_ABORTED";

/**
 * Stable classification for a runtime RPC call that never produced a response. Carries the method
 * and its deadline so a caller can decide on retry/backoff, and deliberately carries neither the
 * bearer token nor the request body.
 */
export class RuntimeRpcTransportError extends Error {
  constructor(
    readonly code: RuntimeRpcTransportErrorCode,
    readonly method: string,
    readonly timeoutMs: number,
    readonly elapsedMs: number
  ) {
    super(code === "RPC_TIMEOUT"
      ? `runtime RPC timeout: ${method} exceeded ${timeoutMs}ms`
      : `runtime RPC cancelled: ${method} aborted after ${elapsedMs}ms`);
    this.name = "RuntimeRpcTransportError";
  }
}

export interface RuntimeRpcClientTimeoutPolicy {
  /** `GET /health` liveness probe. */
  health: number;
  /** Control and status reads that must not depend on repository work. */
  short: number;
  /** Default class for ordinary repository operations. */
  normal: number;
  /** Indexing, audit, and review methods that legitimately run for minutes. */
  long: number;
}

export interface RuntimeRpcClientOptions {
  timeouts?: Partial<RuntimeRpcClientTimeoutPolicy>;
  /** Caller-owned cancellation applied to every call this client makes. */
  signal?: AbortSignal;
}

export const RUNTIME_RPC_CLIENT_TIMEOUT_POLICY: RuntimeRpcClientTimeoutPolicy = {
  health: 5_000,
  short: 15_000,
  normal: 120_000,
  long: 900_000
};

function runtimeRpcMethodTimeout(method: RuntimeRpcMethodName | "shutdown", policy: RuntimeRpcClientTimeoutPolicy): number {
  return policy[method === "shutdown" ? "short" : RUNTIME_RPC_METHODS[method].timeout];
}

export interface RuntimeRpcClient extends RuntimeRpcClientMethods {}

export class RuntimeRpcClient implements RuntimeDaemonClient {
  private readonly timeouts: RuntimeRpcClientTimeoutPolicy;

  constructor(private readonly connection: RuntimeRpcConnection, private readonly options: RuntimeRpcClientOptions = {}) {
    this.timeouts = { ...RUNTIME_RPC_CLIENT_TIMEOUT_POLICY, ...options.timeouts };
  }

  static {
    for (const method of Object.keys(RUNTIME_RPC_METHODS) as RuntimeRpcMethodName[]) {
      const definition = runtimeRpcMethod(method)!;
      Object.defineProperty(RuntimeRpcClient.prototype, method, {
        configurable: true,
        writable: true,
        value: async function (this: RuntimeRpcClient, ...args: unknown[]) {
          return definition.decodeResponse(await this.call(method, definition.encodeArgs(...args)));
        }
      });
    }
  }

  async health(options: { includeEgress?: boolean } = {}): Promise<Json> {
    const suffix = options.includeEgress ? "?egress=1" : "";
    return await this.request("health", options.includeEgress ? this.timeouts.normal : this.timeouts.health, `${this.connection.url}health${suffix}`, {
      headers: { "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION, Authorization: `Bearer ${this.connection.token}` }
    }) as Json;
  }

  async shutdown(): Promise<JsonEnvelope> {
    return this.call("shutdown", []);
  }

  connectionInfo(): Omit<RuntimeRpcConnection, "token"> {
    const { token: _token, ...safe } = this.connection;
    return safe;
  }

  private async call(method: RuntimeRpcMethodName | "shutdown", params: readonly unknown[]): Promise<JsonEnvelope> {
    return await this.request(method, runtimeRpcMethodTimeout(method, this.timeouts), `${this.connection.url}rpc`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.connection.token}`,
        "Content-Type": "application/json",
        "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION
      },
      body: JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method, params })
    }) as JsonEnvelope;
  }

  /**
   * Single transport path for health and every RPC method. The deadline covers response headers
   * *and* body, so a daemon that starts a response and stalls still fails. A timed-out call is
   * never replayed here: the daemon may have already committed a mutation whose response was lost,
   * so reconciliation is the caller's decision, not a silent retry.
   *
   * Every request also opts out of HTTP keep-alive (`Connection: close`, #178). The daemon closes an
   * idle kept-alive socket on its own keep-alive timer; when a synchronous RPC such as `planUpdate`
   * blocks the daemon's event loop past that deadline, the close fires right after the response,
   * while the client (whose keep-alive clock also stalls during synchronous CLI work) is reusing the
   * same pooled socket for the next call. That next call, e.g. `applyUpdate`, then dies with
   * `fetch failed` before the daemon reads it. A fresh loopback connection per call costs far less
   * than any retry, and a retry is not an option here for the same reason as above.
   */
  private async request(method: string, timeoutMs: number, url: string, init: { method?: string; headers: Record<string, string>; body?: string }): Promise<unknown> {
    const controller = new AbortController();
    const startedAt = Date.now();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const callerSignal = this.options.signal;
    const onCallerAbort = (): void => controller.abort();
    if (callerSignal?.aborted) controller.abort();
    else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    try {
      const response = await fetch(url, { ...init, headers: { ...init.headers, "Connection": "close" }, signal: controller.signal });
      return await response.json();
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      if (timedOut) throw new RuntimeRpcTransportError("RPC_TIMEOUT", method, timeoutMs, elapsedMs);
      if (callerSignal?.aborted) throw new RuntimeRpcTransportError("RPC_ABORTED", method, timeoutMs, elapsedMs);
      throw error;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  }
}
