import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RuntimeRpcInputInvalidError,
  rpcInputInvalid,
  rpcOptionalNumber,
  rpcOptionalObject,
  rpcOptionalString,
  rpcOptionalStringArray,
  rpcRequiredObject,
  rpcRequiredString
} from "../src/rpc-argument-codec";
import { RUNTIME_RPC_VERSION, type RuntimeRpcConnection } from "../src/rpc-protocol";
import { ArchctxRuntimeRpcServer, RuntimeRpcClient } from "../src/index";
import { RUNTIME_RPC_METHODS, type RuntimeRpcClientMethods, type RuntimeRpcMethodName } from "../src/rpc-methods";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { createStartedDaemon } from "../src/index";

const ctx = "unitTest";

const DEV_REVIEW_METHODS = new Set<string>([
  "startDeveloperReviewRun",
  "runSignedDeveloperReviewAttestation",
  "cleanupDeveloperReviewRun",
  "recoverDeveloperReviewRuns"
]);
const GENERAL_METHODS = (Object.keys(RUNTIME_RPC_METHODS) as RuntimeRpcMethodName[]).filter((m) => !DEV_REVIEW_METHODS.has(m));
// The only general (envelopeMethod) entries with no positional params at all — the "one wrong-type
// argument" half of the table-driven test below does not apply to these; the "non-array params
// container" half still does.
const ZERO_ARG_METHODS = new Set<string>(["repoList", "landscapeStatus", "stopExplorer", "revokeExplorerToken", "explorerStatus"]);

describe("rpc-argument-codec: shared positional decoders", () => {
  test("rpcInputInvalid returns a RuntimeRpcInputInvalidError carrying the runtime-rpc-input-invalid message", () => {
    const error = rpcInputInvalid(ctx, "label must be a string");
    expect(error).toBeInstanceOf(RuntimeRpcInputInvalidError);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("runtime-rpc-input-invalid: unitTest label must be a string");
  });

  test("rpcRequiredString accepts any string (including empty) and rejects missing/wrong-type", () => {
    expect(rpcRequiredString(["value"], 0, ctx, "label")).toBe("value");
    expect(rpcRequiredString([""], 0, ctx, "label")).toBe("");
    expect(() => rpcRequiredString([], 0, ctx, "label")).toThrow("runtime-rpc-input-invalid: unitTest label must be a string");
    for (const bad of [undefined, null, 42, true, {}, [], ["nested"]]) {
      expect(() => rpcRequiredString([bad], 0, ctx, "label")).toThrow(RuntimeRpcInputInvalidError);
    }
  });

  test("rpcOptionalString passes undefined/null through unchanged and rejects wrong-type", () => {
    expect(rpcOptionalString([undefined], 0, ctx, "label")).toBeUndefined();
    expect(rpcOptionalString([null], 0, ctx, "label")).toBeNull();
    expect(rpcOptionalString([], 0, ctx, "label")).toBeUndefined();
    expect(rpcOptionalString(["value"], 0, ctx, "label")).toBe("value");
    for (const bad of [42, true, {}, []]) {
      expect(() => rpcOptionalString([bad], 0, ctx, "label")).toThrow(RuntimeRpcInputInvalidError);
    }
  });

  test("rpcOptionalNumber passes undefined/null through unchanged and rejects non-finite/wrong-type", () => {
    expect(rpcOptionalNumber([undefined], 0, ctx, "label")).toBeUndefined();
    expect(rpcOptionalNumber([null], 0, ctx, "label")).toBeNull();
    expect(rpcOptionalNumber([12], 0, ctx, "label")).toBe(12);
    expect(rpcOptionalNumber([0], 0, ctx, "label")).toBe(0);
    for (const bad of ["12", true, {}, [], NaN, Infinity, -Infinity]) {
      expect(() => rpcOptionalNumber([bad], 0, ctx, "label")).toThrow(RuntimeRpcInputInvalidError);
    }
  });

  test("rpcOptionalStringArray passes undefined/null through, accepts string[], rejects other shapes", () => {
    expect(rpcOptionalStringArray([undefined], 0, ctx, "label")).toBeUndefined();
    expect(rpcOptionalStringArray([null], 0, ctx, "label")).toBeNull();
    expect(rpcOptionalStringArray([[]], 0, ctx, "label")).toEqual([]);
    expect(rpcOptionalStringArray([["a", "b"]], 0, ctx, "label")).toEqual(["a", "b"]);
    for (const bad of ["a", 1, {}, [1, 2], ["a", 2], [null]]) {
      expect(() => rpcOptionalStringArray([bad], 0, ctx, "label")).toThrow(RuntimeRpcInputInvalidError);
    }
  });

  test("rpcRequiredObject accepts plain objects and rejects missing/null/arrays/primitives (fully strict)", () => {
    expect(rpcRequiredObject<{ a: number }>([{ a: 1 }], 0, ctx, "label")).toEqual({ a: 1 });
    expect(rpcRequiredObject<Record<string, never>>([{}], 0, ctx, "label")).toEqual({});
    // No absence tolerance any more: the server now maps a decode failure to a structured
    // AC_SCHEMA_INVALID envelope, the same shape a handler's own validation already answers with,
    // so there is no more "uncaught 500" outcome a lenient decoder needed to avoid.
    for (const bad of [undefined, null, "x", 1, true, [], ["nested"]]) {
      expect(() => rpcRequiredObject([bad], 0, ctx, "label")).toThrow(RuntimeRpcInputInvalidError);
    }
    expect(() => rpcRequiredObject([], 0, ctx, "label")).toThrow("runtime-rpc-input-invalid: unitTest label must be an object");
  });

  test("rpcOptionalObject passes undefined/null through unchanged and rejects non-object shapes", () => {
    expect(rpcOptionalObject([undefined], 0, ctx, "label")).toBeUndefined();
    expect(rpcOptionalObject([null], 0, ctx, "label")).toBeNull();
    expect(rpcOptionalObject<{ a: number }>([{ a: 1 }], 0, ctx, "label")).toEqual({ a: 1 });
    for (const bad of ["x", 1, true, [], ["nested"]]) {
      expect(() => rpcOptionalObject([bad], 0, ctx, "label")).toThrow(RuntimeRpcInputInvalidError);
    }
  });
});

// Wire-level proof that a bad positional slot is rejected with the same shape a handler's own
// input validation already answers with: HTTP 200, `ok: false`, a structured
// `error: { code: "AC_SCHEMA_INVALID", message: "runtime-rpc-input-invalid: ...", ... }` — not the
// raw HTTP 500 string error a decode failure used to produce. The stub target below never needs
// per-method handlers because a `decodeArgs` failure throws inside
// `ArchctxRuntimeRpcServer.dispatch` before `Reflect.apply` ever reaches the handler.
describe("RPC method table: invalid positional input is a structured AC_SCHEMA_INVALID envelope, not a 500", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-rpc-argument-codec-"));
  let running = false;
  const target: Record<string, unknown> = {
    start: async () => { running = true; },
    stop: async () => { running = false; },
    status: () => ({ running }),
    hasActiveBackgroundWork: async () => false,
    compositionReport: () => ({}),
    egressReport: async () => ({})
  };
  const rpc = new ArchctxRuntimeRpcServer(target as unknown as ConstructorParameters<typeof ArchctxRuntimeRpcServer>[0], {
    root,
    lockPath: join(root, "daemon.lock"),
    connectionPath: join(root, "daemon.json"),
    idleTimeoutMs: 0
  });
  let connection: RuntimeRpcConnection;

  beforeAll(async () => {
    connection = await rpc.start();
  });

  afterAll(async () => {
    await rpc.stop();
    rmSync(root, { recursive: true, force: true });
  });

  const rpcCall = async (method: string, params: unknown) => {
    const response = await fetch(`${connection.url}rpc`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${connection.token}`,
        "Content-Type": "application/json",
        "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION
      },
      body: JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method, params })
    });
    return {
      status: response.status,
      body: await response.json() as { schemaVersion: string; ok: boolean; error?: { code: string; message: string; severity: string; retryable: boolean; action: string } }
    };
  };

  const assertSchemaInvalid = (result: { status: number; body: { ok: boolean; error?: { code: string; message: string } } } , expectSubstring?: string) => {
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(false);
    expect(result.body.error?.code).toBe("AC_SCHEMA_INVALID");
    expect(result.body.error?.message).toContain("runtime-rpc-input-invalid");
    if (expectSubstring) expect(result.body.error?.message).toContain(expectSubstring);
  };

  // One representative method per distinct decoder shape, covering wrong type, missing required
  // param, and malformed object.
  const cases: Array<{ method: string; params: unknown[]; expectSubstring: string }> = [
    // required string only ("root" position with no other params)
    { method: "validate", params: [42], expectSubstring: "validate root must be a string" },
    { method: "validate", params: [], expectSubstring: "validate root must be a string" },
    // required string + optional string
    { method: "init", params: [42, "x"], expectSubstring: "init root must be a string" },
    { method: "init", params: ["/root", 42], expectSubstring: "init productName must be a string" },
    // required string + required string
    { method: "auditShow", params: ["/root", 42], expectSubstring: "auditShow runId must be a string" },
    { method: "auditShow", params: ["/root"], expectSubstring: "auditShow runId must be a string" },
    // required string + optional string[]
    { method: "sync", params: ["/root", "not-an-array"], expectSubstring: "sync changedPaths must be an array of strings" },
    { method: "sync", params: ["/root", [1, 2]], expectSubstring: "sync changedPaths must be an array of strings" },
    // required string + optional number
    { method: "context", params: ["/root", "task", "12"], expectSubstring: "context maxSymbols must be a number" },
    { method: "contextLandscape", params: [42], expectSubstring: "contextLandscape task must be a string" },
    // required string + required object: wrong type, malformed (array), and missing — every
    // required-object slot is fully strict now, so any of the 61 methods works; jobsClaim and
    // checkpoint are picked for variety.
    { method: "checkpoint", params: ["/root", "not-an-object"], expectSubstring: "checkpoint input must be an object" },
    { method: "checkpoint", params: ["/root", ["array", "not", "object"]], expectSubstring: "checkpoint input must be an object" },
    { method: "checkpoint", params: ["/root"], expectSubstring: "checkpoint input must be an object" },
    { method: "checkpoint", params: ["/root", null], expectSubstring: "checkpoint input must be an object" },
    { method: "jobsClaim", params: ["/root", 42], expectSubstring: "jobsClaim input must be an object" },
    // required string + optional object: present but malformed (not simply omitted)
    { method: "jobsEnqueueGitHook", params: ["/root", "bad"], expectSubstring: "jobsEnqueueGitHook input must be an object" },
    { method: "ledgerProject", params: ["/root", 7], expectSubstring: "ledgerProject input must be an object" },
    // required string + required object + required boolean
    { method: "mcpProjection", params: ["/root", { action: "run", request: {} }, "true"], expectSubstring: "mcpProjection approved must be a boolean" },
    { method: "mcpProjection", params: ["/root", { action: "run", request: {} }], expectSubstring: "mcpProjection approved must be a boolean" },
    { method: "mcpProjection", params: ["/root", "bad", true], expectSubstring: "mcpProjection input must be an object" },
    // bare required string with a non-"root" label
    { method: "repoRemove", params: [42], expectSubstring: "repoRemove repositoryId must be a string" },
    { method: "practiceWaivers", params: [null], expectSubstring: "practiceWaivers root must be a string" },
    // optional string only, no root
    { method: "runtimeStatus", params: [42], expectSubstring: "runtimeStatus root must be a string" }
  ];

  for (const { method, params, expectSubstring } of cases) {
    test(`${method} answers a structured AC_SCHEMA_INVALID for ${JSON.stringify(params)}`, async () => {
      assertSchemaInvalid(await rpcCall(method, params), expectSubstring);
    });
  }

  test("a well-formed mcpProjection input still lets the later approved slot fail on its own", async () => {
    const result = await rpcCall("mcpProjection", ["/root", { action: "run", request: {} }, 42]);
    assertSchemaInvalid(result, "approved must be a boolean");
    expect(result.body.error?.message).not.toContain("input must be an object");
  });

  // Finding 2 (still in force): a non-array `params` container must be rejected before any
  // per-slot decoding runs — otherwise `params[0]`/`params[1]` silently index into a string or
  // object's properties instead of failing (`"/tmp/x"[0]` is `"/"`, not the first real argument).
  test("a string params container is a structured AC_SCHEMA_INVALID", async () => {
    assertSchemaInvalid(await rpcCall("init", "/tmp/x"), "init params must be an array");
  });

  test("an object params container is a structured AC_SCHEMA_INVALID", async () => {
    assertSchemaInvalid(await rpcCall("init", { "0": "/tmp/x", "1": "name" }), "init params must be an array");
  });

  test("a non-array params container is a structured AC_SCHEMA_INVALID for a zero-arg method too", async () => {
    assertSchemaInvalid(await rpcCall("repoList", "not-an-array"), "repoList params must be an array");
  });

  // Table-driven over every general (envelopeMethod) table entry: one wrong-type positional
  // argument (an array is wrong for every slot kind — string, optional string, optional number,
  // and object — so it works uniformly at slot 0 without needing a per-method value table) plus
  // the non-array params container, for all 61 entries.
  for (const method of GENERAL_METHODS) {
    if (!ZERO_ARG_METHODS.has(method)) {
      test(`${method} rejects a wrong-type value at its first positional slot as AC_SCHEMA_INVALID`, async () => {
        assertSchemaInvalid(await rpcCall(method, [["wrong-type-sentinel"]]));
      });
    }

    test(`${method} rejects a non-array params container as AC_SCHEMA_INVALID`, async () => {
      assertSchemaInvalid(await rpcCall(method, "not-an-array"), `${method} params must be an array`);
    });
  }
});

// Real-daemon coverage: proves the strict decoder does not race a handler's own domain validation
// for a *well-formed* object that is nonetheless incomplete — the decoder only checks "is this a
// plain object", so `{}` (or any other plain object) always reaches the handler, which is free to
// answer whatever structured code its own logic decides. Also verifies valid input still succeeds,
// and what a real `RuntimeRpcClient` caller actually receives for both an envelopeMethod entry and
// a developer-review dataMethod entry.
describe("RPC method table: well-formed objects still reach the handler's own validation unchanged", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "archctx-rpc-argument-codec-realdaemon-state-"));
  const root = mkdtempSync(join(tmpdir(), "archctx-rpc-argument-codec-realdaemon-repo-"));
  let rpc: ArchctxRuntimeRpcServer;
  let connection: RuntimeRpcConnection;
  let client: RuntimeRpcClient;

  beforeAll(async () => {
    writeFileSync(join(root, "README.md"), "# rpc-argument-codec real-daemon fixture\n", "utf8");
    initializeArchContextModel(root, "Real Daemon Fixture");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-qm", "fixture"], { cwd: root });

    const daemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: new TestLocalStore()
    });
    rpc = new ArchctxRuntimeRpcServer(daemon, {
      root,
      port: 0,
      token: "real-daemon-token",
      lockPath: join(stateRoot, "daemon.lock"),
      connectionPath: join(stateRoot, "daemon.json"),
      idleTimeoutMs: 0
    });
    connection = await rpc.start();
    client = new RuntimeRpcClient(connection);
  });

  afterAll(async () => {
    // `rpc.stop()` also stops the underlying daemon (see ArchctxRuntimeRpcServer.stop).
    await rpc.stop();
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  test("applyUpdate with approved: false answers AC_USER_CONFIRMATION_REQUIRED before touching the draft", async () => {
    const result = await client.applyUpdate(root, { id: "changeset.missing", approved: false, expectedWorktreeDigest: "sha256:" + "0".repeat(64) });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("AC_USER_CONFIRMATION_REQUIRED");
  });

  test("applyUpdate with a non-boolean approved answers AC_SCHEMA_INVALID", async () => {
    const result = await client.applyUpdate(root, { id: "changeset.missing", approved: "true", expectedWorktreeDigest: "sha256:" + "0".repeat(64) } as never);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("AC_SCHEMA_INVALID");
  });

  test("jobsClaim with an object missing workerId still answers AC_SCHEMA_INVALID from the handler itself", async () => {
    const result = await client.jobsClaim(root, {} as never);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("AC_SCHEMA_INVALID");
    expect(result.error?.message).toContain("workerId");
  });

  test("projection with an object missing action still answers a structured error from the handler itself", async () => {
    const result = await client.projection(root, {} as never);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("AC_SCHEMA_INVALID");
  });

  test("refactorRecord with an object missing assessmentDigest still answers a structured error from the handler itself", async () => {
    const result = await client.refactorRecord(root, {} as never);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("AC_SCHEMA_INVALID");
  });

  test("validate still succeeds for a real repository root (valid input is unaffected)", async () => {
    const result = await client.validate(root);
    expect(result.ok).toBe(true);
  });

  test("client behavior: an envelopeMethod entry's ok:false envelope is a normal resolved return value, not a thrown exception", async () => {
    // Before this design: the same malformed call produced an HTTP 500 body with a raw string
    // `error`; the client still resolved (RuntimeRpcClient.request() parses the body regardless of
    // status), just with `error` as an unstructured string. After: HTTP 200 with a structured
    // `ArchContextError` object — strictly more informative, same "resolves, does not throw" shape.
    const result = await client.checkpoint(root, "not-an-object" as never);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("AC_SCHEMA_INVALID");
    expect(result.error?.message).toContain("runtime-rpc-input-invalid: checkpoint input must be an object");
  });

  test("client behavior: a developer-review dataMethod entry's decodeResponse now throws the real validation message, not the generic placeholder", async () => {
    // unwrapRpcData (rpc-methods.ts) does `if (!result.ok) throw new Error(result.error?.message ?? "runtime-rpc-call-failed")`.
    // Before: `result.error` was a raw string, so `result.error?.message` was undefined and every
    // decode failure threw the generic "runtime-rpc-call-failed", losing the actual detail. After:
    // `result.error` is the structured ArchContextError object, so `.message` is the real
    // "runtime-rpc-input-invalid: ..." text — strictly more useful, no code change needed in
    // unwrapRpcData itself.
    await expect(client.startDeveloperReviewRun("not-an-object" as never)).rejects.toThrow(/runtime-rpc-input-invalid: startDeveloperReviewRun/);
  });
});
