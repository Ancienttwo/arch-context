import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { okEnvelope } from "@archcontext/contracts";
import { RuntimeRpcClient } from "../src/rpc-client";
import { RUNTIME_RPC_METHODS, runtimeRpcMethod, type RuntimeRpcMethodName } from "../src/rpc-methods";
import { RUNTIME_RPC_VERSION, type RuntimeRpcConnection } from "../src/rpc-protocol";
import { ArchctxRuntimeRpcServer } from "../src/rpc-server";
import baseline from "./rpc-wire-baseline.json";

const projectionCases = [
  { method: "docsProjection", input: { action: "plan" }, timeout: "long" },
  { method: "agentContextProjection", input: { action: "preview" }, timeout: "long" },
  { method: "projection", input: { action: "run", request: {} }, timeout: "long" },
  { method: "approveMcpProjection", input: { action: "recover", request: {} }, timeout: "normal" },
  { method: "mcpProjection", input: { action: "run", request: {} }, timeout: "long" }
].flatMap(({ method, input, timeout }) => {
  const args: unknown[] = ["/rpc/fixture/repo", input];
  const samples = [{ method, variant: "projection", args, params: method === "mcpProjection" ? [...args, null] : args, timeout, response: "envelope" }];
  if (method === "mcpProjection") samples.push({ method, variant: "projection-approved", args: [...args, "one-time-token"], params: [...args, "one-time-token"], timeout, response: "envelope" });
  return samples;
});
const cases = [...baseline.cases, ...projectionCases];

// Captured by exercising the pre-table client, including omitted and explicit arguments.
// These are transport sentinels; domain validation remains covered by daemon integration tests.
describe("RPC method table wire contract", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-rpc-methods-"));
  const calls: Array<{ method: string; params: unknown[]; bound: boolean }> = [];
  const payload = { marker: "wire-response" };
  const envelope = okEnvelope("wire.fixture", payload);
  let running = false;
  const target: Record<string, any> = {
    start: async () => { running = true; },
    stop: async () => { running = false; },
    status: () => ({ running }),
    hasActiveBackgroundWork: async () => false,
    compositionReport: () => ({}),
    egressReport: async () => ({})
  };
  for (const sample of cases) {
    target[sample.method] = function (...params: unknown[]) {
      calls.push({ method: sample.method, params, bound: this === target });
      const result = sample.response === "data" ? payload : envelope;
      return sample.method === "runSignedDeveloperReviewAttestation" ? Promise.resolve(result) : result;
    };
  }
  const rpc = new ArchctxRuntimeRpcServer(target as unknown as ConstructorParameters<typeof ArchctxRuntimeRpcServer>[0], {
    root,
    lockPath: join(root, "daemon.lock"),
    connectionPath: join(root, "daemon.json"),
    idleTimeoutMs: 0
  });
  let connection: RuntimeRpcConnection;
  let client: RuntimeRpcClient;

  beforeAll(async () => {
    connection = await rpc.start();
    client = new RuntimeRpcClient(connection);
  });

  afterAll(async () => {
    await rpc.stop();
    rmSync(root, { recursive: true, force: true });
  });

  for (const sample of cases) {
    test(`${sample.method} preserves ${sample.variant} wire arguments and response`, async () => {
      const method = sample.method as RuntimeRpcMethodName;
      const result = await Reflect.apply(client[method], client, sample.args);
      expect(calls.at(-1)).toEqual({ method, params: sample.params, bound: true });
      expect(result).toEqual(sample.response === "data" ? payload : envelope);
      expect(sample.timeout).toBe(runtimeRpcMethod(method)!.timeout);
    });
  }

  test("every declared method has a wire sentinel", () => {
    expect([...new Set(cases.map(sample => sample.method))].sort()).toEqual(Object.keys(RUNTIME_RPC_METHODS).sort());
  });

  test("unregistered and prototype names never dispatch a handler", async () => {
    const count = calls.length;
    for (const method of ["notAnRpcMethod", "__proto__", "constructor", "toString"]) {
      const response = await fetch(`${connection.url}rpc`, {
        method: "POST",
        headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method, params: [] })
      });
      const body = await response.json() as any;
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("AC_SCHEMA_INVALID");
      expect(body.error.message).toBe(`Unknown runtime RPC method: ${method}`);
    }
    expect(calls.length).toBe(count);
  });

  test("raw review results retain their failure unwrapping", async () => {
    const previous = target.startDeveloperReviewRun;
    target.startDeveloperReviewRun = () => { throw new Error("fixture.raw-failure"); };
    try {
      const sample = baseline.cases.find(entry => entry.method === "startDeveloperReviewRun")!;
      await expect(Reflect.apply(client.startDeveloperReviewRun, client, sample.args)).rejects.toThrow("runtime-rpc-call-failed");
    } finally {
      target.startDeveloperReviewRun = previous;
    }
  });
});
