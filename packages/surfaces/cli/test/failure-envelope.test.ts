import { expect, test } from "bun:test";
import { GitVisibleFilesUnavailableError } from "@archcontext/local-runtime/git-adapter";
import { RuntimeRpcTransportError, type RuntimeDaemonClient } from "@archcontext/local-runtime/runtime-rpc-client";
import { McpLocalServer } from "@archcontext/surfaces/mcp-local";
import { runCli } from "../src/main";

const sentinel = "/private/customer/root provider body Authorization=secret-sentinel";
function runtimeThrowing(error: unknown): RuntimeDaemonClient {
  return { completeTask: async () => { throw error; }, practiceCheckpoint: async () => { throw error; } } as unknown as RuntimeDaemonClient;
}
function assertUnknown(value: any) {
  expect(value).toMatchObject({ ok: false, error: {
    code: "AC_UNCLASSIFIED_FAILURE", reasonCode: "failure-unclassified", action: "inspect-diagnostics",
    severity: "error", retryable: false,
  } });
  expect(JSON.stringify(value)).not.toContain(sentinel);
  expect(Object.keys(value.error.details).every(key => key === "stage")).toBe(true);
}

test("selected CLI commands make unknown exceptions safe and explicitly unclassified", async () => {
  for (const [command, args] of [["complete", []], ["review", []], ["practices", ["checkpoint"]]] as const) {
    assertUnknown(await runCli(command, [...args], "/unused", { runtimeClient: runtimeThrowing(new Error(sentinel)) }));
  }
});

test("selected MCP tools preserve honest unknown failures instead of guessing runtime outage", async () => {
  const server = new McpLocalServer(runtimeThrowing(new Error(sentinel)));
  for (const name of ["archcontext_complete_task", "archcontext_practice_checkpoint"]) {
    assertUnknown((await server.callTool(name, { root: "/unused" })).content);
  }
});

test("typed Git refusal keeps its producer metadata without leaking its private root/cause", async () => {
  const result = await runCli("complete", [], "/unused", { runtimeClient: runtimeThrowing(new GitVisibleFilesUnavailableError(sentinel, sentinel)) });
  expect(result).toMatchObject({ ok: false, error: { code: "AC_REPO_NOT_FOUND", reasonCode: "git-worktree-required", action: "open-correct-repository", details: {} } });
  expect(JSON.stringify(result)).not.toContain(sentinel);
});

test("selected CLI input refusals have four fields without echoing untrusted flags", async () => {
  const result = await runCli("checkpoint", ["--" + sentinel], "/unused");
  expect(result).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID", reasonCode: "cli-input-invalid", action: "correct-command-arguments", details: {} } });
  expect(JSON.stringify(result)).not.toContain(sentinel);
});

test("selected RPC timeout and abort codes survive adaptation and never trigger replay", async () => {
  for (const code of ["RPC_TIMEOUT", "RPC_ABORTED"] as const) {
    let calls = 0;
    const runtime = { completeTask: async () => { calls++; throw new RuntimeRpcTransportError(code, "completeTask", 50, 51); } } as unknown as RuntimeDaemonClient;
    const result = await new McpLocalServer(runtime).callTool("archcontext_complete_task", { root: "/unused" });
    expect(result.content).toMatchObject({ ok: false, error: { code, retryable: false, details: { method: "completeTask", mutationOutcome: "unknown" } } });
    expect(calls).toBe(1);
  }
});

test("all registered producer reasons survive selected CLI and MCP adapters", async () => {
  const { FAILURE_POLICIES, knownFailure, failureEnvelope, failureIssues } = await import("@archcontext/contracts");
  for (const [reason, policy] of Object.entries(FAILURE_POLICIES)) {
    const facts: Record<string, any> = {
      stage: "debt", checks: ["ownership", "anchors"], issueCount: 2, method: "completeTask", timeoutMs: 5, elapsedMs: 6, mutationOutcome: "unknown",
      jobId: "job.fixture", runId: "audit_run.fixture", draftId: "draft.fixture", recommendationId: "recommendation."+"a".repeat(16), currentRecommendationId: "recommendation."+"b".repeat(16), currentRecorded: true,
      consentReason: "not-granted", searched: "recorded", decisionStatus: "accepted", disposition: "resolved", changedFields: ["headSha", "worktreeDigest"],
      evidenceDigest: "sha256:"+"a".repeat(64), assessmentDigest: "sha256:"+"b".repeat(64), expectedHeadSha: "a".repeat(40), actualHeadSha: "b".repeat(40),
      expectedWorktreeDigest: "sha256:"+"c".repeat(64), actualWorktreeDigest: "sha256:"+"d".repeat(64), expectedNamespace: "product.fixture", actualNamespace: "product.next", measuredBytes: 10, limitBytes: 9, kind: "timeout", confirmationToken: "public:github.com/acme/widgets:"+"a".repeat(40)+":audit_run.fixture", recordCommand: null, verifyCommand: null, observation: "before-resolve-append", field: reason === "projection-snapshot-mismatch" ? "worktreeDigest" : reason === "jobs-input-invalid" ? "workerId" : "into", issue: "unknown-node", inputDomain: "observed", availability: "unavailable", cause: "unclassified"
    };
    const ruleFacts: Record<string, any> = {
      id: "fixture.authority", uint: 2, sha256: "sha256:" + "a".repeat(64), head: "a".repeat(40), boolean: true,
      reviewOwnershipRefusal: "persisted-manifest-missing", reviewWorktreeRefusal: "WORKTREE_NOT_CLEAN",
      rpcVersion: "archcontext.runtime-rpc/v2", upgradeAction: "upgrade-archctx-runtime", upgradeCommand: "archctx daemon upgrade",
      projectionInputField: "headSha", ownershipAction: "remove-whole-file-outputs-and-reapply", ledgerModeField: "readMode",
      changedFields: ["headSha", "worktreeDigest"], publicConfirmationToken: facts.confirmationToken,
      consentReason: "not-granted", searched: "recorded", decisionStatus: "accepted", disposition: "resolved",
      commandSuggestion: null, context7Kind: "timeout"
    };
    // Dedicated recovery shapes are authorities, not ordinary summary facts.
    const recoveryIds = { requestId: "request.fixture", lookupKey: "sha256:" + "a".repeat(64), applyId: "sha256:" + "b".repeat(64), written: false };
    const details = policy.journalRecovery
      ? { unresolvedJournals: [{ journalId: "journal.fixture", changeSetId: "changeset.fixture", root: "/fixture", reason: "rollback-conflict" }] }
      : policy.recovery
        ? reason === "projection-apply-committed-manual-only" ? { ...recoveryIds, manualRecoveryRequired: true, readbackUnavailable: "details-budget-exceeded" } : recoveryIds
        : policy.native ? {}
          : policy.facts
            ? Object.fromEntries(Object.entries(policy.facts).filter(([,rule]) => !rule.startsWith("optional:")).map(([key,rule]) => {
                if (!Object.hasOwn(ruleFacts, rule)) throw new Error(`Missing valid fixture for ${reason}.${key}:${rule}`);
                return [key, ruleFacts[rule]];
              }))
            : Object.fromEntries((policy.fields ?? []).map(key => [key, facts[key]]));
    const failure = knownFailure(policy.code, reason, details);
    const result = failureEnvelope("complete_task", failure);
    const runtime = { completeTask: async () => result, practiceCheckpoint: async () => result } as unknown as RuntimeDaemonClient;
    for (const [command, args] of [["complete", []], ["review", []], ["practices", ["checkpoint"]]] as const) {
      const cli = await runCli(command, [...args], "/unused", { runtimeClient: runtime });
      const error = "error" in cli ? cli.error : undefined;
      expect(error).toEqual(failure);
      expect(failureIssues(error)).toEqual([]);
    }
    for (const name of ["archcontext_complete_task", "archcontext_practice_checkpoint"]) {
      const mcp = await new McpLocalServer(runtime).callTool(name, { root: "/unused" });
      expect((mcp.content as any).error).toEqual(failure);
    }
  }
});

test("returned failures cannot leak raw diagnostics in unknown fields or request IDs", async () => {
  const error = { code: "AC_SCHEMA_INVALID", reasonCode: "changed-path-invalid", action: "repair-model", severity: "error", retryable: false, message: sentinel, details: { body: sentinel, ordinarySummary: "omit-me" } };
  const runtime = { completeTask: async () => ({ ok: false, requestId: sentinel, error, diagnostics: sentinel }) } as unknown as RuntimeDaemonClient;
  const cli = await runCli("complete", [], "/unused", { runtimeClient: runtime });
  expect(cli).toMatchObject({ requestId: "complete", error: { details: { omittedCount: 2 } } });
  expect(JSON.stringify(cli)).not.toContain(sentinel);
  const mcp = await new McpLocalServer(runtime).callTool("archcontext_complete_task", { root: "/unused" });
  expect(JSON.stringify(mcp)).not.toContain(sentinel);
  expect(mcp.content).toMatchObject({ requestId: "complete_task", error: { reasonCode: "changed-path-invalid" } });
});

test("real CLI process rejects unsafe input without starting runtime or writing state", async () => {
  const { mkdtempSync, readdirSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const state = mkdtempSync(join(tmpdir(), "d6-cli-state-"));
  try {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/main.ts"), "checkpoint", "--" + sentinel], {
      env: { ...process.env, ARCHCONTEXT_STATE_DIR: state, ARCHCONTEXT_CHECK_UPDATES: "0", DO_NOT_TRACK: "1", CODEGRAPH_NO_DOWNLOAD: "1" }, stdout: "pipe", stderr: "pipe"
    });
    const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(exit).toBe(1);
    expect(err).toBe("");
    expect(JSON.parse(out)).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID", reasonCode: "cli-input-invalid", action: "correct-command-arguments", details: {} } });
    expect(out).not.toContain(sentinel);
    expect(readdirSync(state)).toEqual([]);
  } finally { rmSync(state, { recursive: true, force: true }); }
});

test("invalid typed transport metadata cannot escape selected CLI or MCP safety boundaries", async () => {
  const error = new RuntimeRpcTransportError("RPC_TIMEOUT", "completeTask", 5, 6);
  Object.defineProperty(error, "code", { get() { throw new Error(sentinel); } });
  const runtime = runtimeThrowing(error);
  for (const result of [await runCli("complete", [], "/unused", { runtimeClient: runtime }), (await new McpLocalServer(runtime).callTool("archcontext_complete_task", { root: "/unused" })).content]) {
    expect(result).toMatchObject({ ok: false, error: { code: "AC_UNCLASSIFIED_FAILURE", reasonCode: "failure-unclassified", details: { stage: "failure-metadata" } } });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  }
});

test("malformed producer details are refused across selected CLI and MCP instead of losing bindings", async () => {
  for (const details of [null, 42, "unsafe", [{ receipt: "essential-binding" }], { summary: { receipt: "essential-binding" } }, { summary: [{ applyId: "apply.123" }] }, { omittedCount: { receipt: "essential-binding" } }]) {
    const runtime = { completeTask: async () => ({ ok: false, error: { code: "AC_PRECONDITION_FAILED", reasonCode: "projection-manifest-invalid", details } }) } as unknown as RuntimeDaemonClient;
    for (const result of [await runCli("complete", [], "/unused", { runtimeClient: runtime }), (await new McpLocalServer(runtime).callTool("archcontext_complete_task", { root: "/unused" })).content]) {
      expect(result).toMatchObject({ ok: false, error: { code: "AC_UNCLASSIFIED_FAILURE", reasonCode: "failure-unclassified", details: { stage: "failure-metadata" } } });
    }
  }
});

async function busyHealthFixture() {
  const { createServer } = await import("node:http");
  const { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { SqliteLocalStore, runtimeStatePaths } = await import("@archcontext/local-runtime/local-store-sqlite");
  const { createPrivateControlFile } = await import("@archcontext/local-runtime/control-file-security");
  const { RUNTIME_RPC_VERSION } = await import("@archcontext/local-runtime/runtime-daemon");
  const root = mkdtempSync(join(tmpdir(), "d6-health-root-"));
  const state = mkdtempSync(join(tmpdir(), "d6-health-state-"));
  const env = { ...process.env, ARCHCONTEXT_STATE_DIR: state, ARCHCONTEXT_CHECK_UPDATES: "0", DO_NOT_TRACK: "1", CODEGRAPH_NO_DOWNLOAD: "1" };
  const paths = runtimeStatePaths(root, env);
  writeFileSync(join(root, "README.md"), "preserve repository\n");
  mkdirSync(paths.workspaceStateDir, { recursive: true, mode: 0o700 });
  const store = new SqliteLocalStore(paths.localStorePath);
  await store.migrate();
  await store.saveTaskState("practice-checkpoint:repo_health:task_d6", {
    schemaVersion: "archcontext.practice-checkpoint-baseline/v1", repositoryId: "repo_health", taskSessionId: "task_d6",
    snapshot: { schemaVersion: "archcontext.practice-checkpoint-snapshot/v1", task: "preserve baseline", headSha: "health-head", worktreeDigest: "health-worktree", contextDigest: "health-context", practiceGuidanceDigest: "health-guidance", catalogDigest: "health-catalog", matches: [] },
    updatedAt: "2026-10-14T00:00:00.000Z"
  });
  store.close();
  const requests: string[] = [];
  const server = createServer((request) => { requests.push(`${request.method} ${request.url}`); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const startedAt = new Date(Date.now() + 60_000).toISOString();
  createPrivateControlFile(paths.daemonLockPath, JSON.stringify({ pid: process.pid, root, startedAt }));
  createPrivateControlFile(paths.daemonConnectionPath, JSON.stringify({
    schemaVersion: RUNTIME_RPC_VERSION, protocol: "http-loopback", version: 1, root,
    url: `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/`, token: "test-health-token",
    pid: process.pid, lockPath: paths.daemonLockPath, connectionPath: paths.daemonConnectionPath, startedAt
  }));
  const tree = (directory: string): unknown => readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))
    .map(entry => [entry.name, entry.isDirectory() ? tree(join(directory, entry.name)) : readFileSync(join(directory, entry.name)).toString("hex")]);
  const before = JSON.stringify([tree(root), tree(state)]);
  return { root, env, requests,
    assertUnchanged() { expect(JSON.stringify([tree(root), tree(state)])).toBe(before); },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true }); }
  };
}
function assertHealthTimeout(value: any) {
  expect(value).toMatchObject({ ok: false, error: { code: "RPC_TIMEOUT", reasonCode: "rpc-timeout", action: "reconcile-before-retry", retryable: false,
    details: { method: "health", timeoutMs: 5000, mutationOutcome: "unknown" } } });
  expect(Number.isFinite(value.error.details.elapsedMs)).toBe(true);
  expect(value.error.details.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(value)).not.toContain("test-health-token");
  expect(JSON.stringify(value)).not.toContain("d6-health-root-");
}

test("health timeout retains metadata through real selected CLI processes without state writes or competing daemon", async () => {
  const fixture = await busyHealthFixture();
  const { join } = await import("node:path");
  try {
    for (const args of [["complete"], ["review"], ["practices", "checkpoint"], ["status"]]) {
      const beforeCalls = fixture.requests.length;
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/main.ts"), ...args], { cwd: fixture.root, env: fixture.env, stdout: "pipe", stderr: "pipe" });
      const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(exit).toBe(1); expect(err).toBe("");
      const result = JSON.parse(out);
      if (args[0] === "status") {
        expect(result.error.code).toBe("AC_RUNTIME_UNAVAILABLE");
        expect(result.error.message).toContain("alive but did not answer");
      } else assertHealthTimeout(result);
      expect(fixture.requests.slice(beforeCalls)).toEqual(["GET /health"]);
      fixture.assertUnchanged();
    }
  } finally { await fixture.close(); }
}, 45_000);

test("health timeout survives the actual CLI stdio MCP resolver without state writes or competing daemon", async () => {
  const fixture = await busyHealthFixture();
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const { join } = await import("node:path");
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(import.meta.dir, "../src/main.ts"), "mcp"], cwd: fixture.root,
    env: Object.fromEntries(Object.entries(fixture.env).filter((entry): entry is [string,string] => entry[1] !== undefined)), stderr: "pipe" });
  const client = new Client({ name: "d6-health-process", version: "1" });
  try {
    await client.connect(transport);
    for (const name of ["archcontext_complete_task", "archcontext_practice_checkpoint"]) {
      const beforeCalls = fixture.requests.length;
      const result = await client.callTool({ name, arguments: { root: fixture.root, taskSessionId: "task_d6" } });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      assertHealthTimeout(JSON.parse(content[0]!.text));
      // Existing discovery + existing resolver probe; no mutation or additional retry.
      expect(fixture.requests.slice(beforeCalls)).toEqual(["GET /health", "GET /health"]);
      fixture.assertUnchanged();
    }
    expect(await client.ping()).toEqual({});
  } finally { await client.close(); await fixture.close(); }
}, 45_000);

test("P2 mutated typed failures and changing returned metadata stay private across selected surfaces", async () => {
  const { FailureError, knownFailure, failureIssues } = await import("@archcontext/contracts");
  let hooks = 0;
  const cases: Array<() => { error: unknown; returned: boolean }> = [
    ...[false, true].map(boxed => () => {
      const error = new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-invalid");
      (error.failure as any).reasonCode = boxed
        ? Object.assign(new String("projection-manifest-invalid"), { toJSON() { hooks++; return { privateText: sentinel }; } })
        : { privateText: sentinel, toString() { hooks++; return "projection-manifest-invalid"; } };
      return { error, returned: false };
    }),
    ...["code", "reasonCode", "action", "severity", "retryable", "details"].map(key => () => {
      const valid = knownFailure("AC_PRECONDITION_FAILED", "projection-manifest-invalid");
      const error = { ...valid };
      Object.defineProperty(error, key, { enumerable: true, get() { hooks++; return hooks === 1 ? (valid as any)[key] : { privateText: sentinel, toString() { hooks++; return "projection-manifest-invalid"; } }; } });
      return { error, returned: true };
    })
  ];
  for (const makeCase of cases) {
    for (const [surface, command, args] of [["cli", "complete", []], ["cli", "review", []], ["cli", "practices", ["checkpoint"]], ["mcp", "archcontext_complete_task", []], ["mcp", "archcontext_practice_checkpoint", []]] as const) {
      hooks = 0;
      const { error, returned } = makeCase();
      let calls = 0;
      const operation = async () => { calls++; if (returned) return { ok: false, error }; throw error; };
      const runtime = { completeTask: operation, practiceCheckpoint: operation } as unknown as RuntimeDaemonClient;
      const value = surface === "cli" ? await runCli(command, [...args], "/unused", { runtimeClient: runtime })
        : (await new McpLocalServer(runtime).callTool(command, { root: "/unused" })).content;
      expect(value).toMatchObject({ ok: false, error: { code: "AC_UNCLASSIFIED_FAILURE", action: "inspect-diagnostics", retryable: false } });
      expect(JSON.stringify(value)).not.toContain(sentinel);
      expect(failureIssues((value as any).error)).toEqual([]);
      expect(hooks).toBe(0);
      expect(calls).toBe(1);
    }
  }
});


test("P2 registered producer and transport metadata reject accessors and inherited values without reading them", async () => {
  const { ProjectionManifestInvalidError } = await import("@archcontext/core/projection-engine");
  const { ProjectionCodeFactsUnavailableError } = await import("@archcontext/local-runtime/codegraph-adapter");
  const { failureIssues } = await import("@archcontext/contracts");
  const cases: Array<[() => Error, string[]]> = [
    [() => new GitVisibleFilesUnavailableError(sentinel, sentinel), ["code", "reasonCode"]],
    [() => new ProjectionManifestInvalidError([sentinel]), ["reasonCode"]],
    [() => new ProjectionCodeFactsUnavailableError("index-missing"), ["code", "reasonCode"]],
    [() => new RuntimeRpcTransportError("RPC_TIMEOUT", "completeTask", 5, 6), ["code", "method", "timeoutMs", "elapsedMs"]],
    [() => new RuntimeRpcTransportError("RPC_ABORTED", "practiceCheckpoint", 5, 6), ["code", "method", "timeoutMs", "elapsedMs"]]
  ];
  for (const [makeError, keys] of cases) for (const key of keys) for (const inherited of [false, true]) {
    for (const [surface, command, args] of [["cli", "complete", []], ["cli", "review", []], ["cli", "practices", ["checkpoint"]], ["mcp", "archcontext_complete_task", []], ["mcp", "archcontext_practice_checkpoint", []]] as const) {
      const error = makeError();
      const original = Object.getOwnPropertyDescriptor(error, key)!.value;
      let reads = 0;
      const target = inherited ? Object.create(Object.getPrototypeOf(error)) : error;
      Object.defineProperty(target, key, { get() { reads++; return original; } });
      if (inherited) { Reflect.deleteProperty(error, key); Object.setPrototypeOf(error, target); }
      const runtime = runtimeThrowing(error);
      const value = surface === "cli" ? await runCli(command, [...args], "/unused", { runtimeClient: runtime })
        : (await new McpLocalServer(runtime).callTool(command, { root: "/unused" })).content;
      expect(value).toMatchObject({ ok: false, error: { code: "AC_UNCLASSIFIED_FAILURE", details: { stage: "failure-metadata" } } });
      expect(JSON.stringify(value)).not.toContain(sentinel);
      expect(failureIssues((value as any).error)).toEqual([]);
      expect(reads).toBe(0);
    }
  }
});


test("D6-B selected reader CLI refusals are strict and never obtain a runtime", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { failureIssues } = await import("@archcontext/contracts");
  const root = mkdtempSync(join(tmpdir(), "d6-b-cli-non-git-"));
  let accesses = 0;
  const noRuntime = new Proxy({}, { get() { accesses++; throw new Error(sentinel); } }) as RuntimeDaemonClient;
  try {
    for (const [command, args, requestId] of [["docs", ["anchors"], "docs.anchors"], ["flows", ["check"], "flows.check"]] as const) {
      const result = await runCli(command, [...args], root, { runtimeClient: noRuntime });
      expect(result).toMatchObject({ ok: false, requestId, error: { code: "AC_REPO_NOT_FOUND", reasonCode: "git-worktree-required", action: "open-correct-repository" } });
      expect((result as any).error.details).toEqual({});
      expect(failureIssues((result as any).error)).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(root);
      for (const extra of [["--" + sentinel], ["--profile", sentinel]]) {
        const refusal = await runCli(command, [...args, ...extra], root, { runtimeClient: noRuntime });
        expect(refusal).toMatchObject({ ok: false, requestId, error: { code: "AC_SCHEMA_INVALID", reasonCode: "cli-input-invalid", action: "correct-command-arguments" } });
        expect(failureIssues((refusal as any).error)).toEqual([]);
        expect(JSON.stringify(refusal)).not.toContain(sentinel);
      }
    }
    const wrongVerb = await runCli("flows", ["verify"], root, { runtimeClient: noRuntime });
    expect(wrongVerb).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID", reasonCode: "cli-input-invalid" } });
    expect(accesses).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("D6-B real CLI reader errors keep strict metadata with no diagnostics or state output", async () => {
  const { mkdtempSync, rmSync, existsSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { failureIssues } = await import("@archcontext/contracts");
  const root = mkdtempSync(join(tmpdir(), "d6-b-reader-process-"));
  const state = join(root, "private-runtime-state");
  try {
    for (const args of [["docs", "anchors"], ["flows", "check"], ["docs", "anchors", "--" + sentinel], ["flows", "check", "--" + sentinel]]) {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/main.ts"), ...args], { cwd: root,
        env: { ...process.env, ARCHCONTEXT_STATE_DIR: state, ARCHCONTEXT_CHECK_UPDATES: "0", DO_NOT_TRACK: "1", CODEGRAPH_NO_DOWNLOAD: "1" }, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(exit).toBe(1); expect(stderr).toBe("");
      const value = JSON.parse(stdout);
      expect(failureIssues(value.error)).toEqual([]);
      expect(value.requestId).toBe(args[0] === "docs" ? "docs.anchors" : "flows.check");
      expect(stdout).not.toContain(root); expect(stdout).not.toContain(sentinel);
      expect(existsSync(state)).toBe(false); expect(readdirSync(root)).toEqual([]);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("D6-B leaves other docs passthrough and imported runCli rejection unchanged", async () => {
  const legacy = { schemaVersion: "archcontext.envelope/v1", ok: false, requestId: "legacy", error: { code: "AC_PRECONDITION_FAILED", message: "legacy", severity: "warning", retryable: false, action: "legacy-action", reasonCode: "unregistered-legacy" } } as const;
  const runtime = { docs: async () => legacy, runtimeStatus: async () => { throw legacy; } } as unknown as RuntimeDaemonClient;
  expect(await runCli("docs", ["status"], "/unused", { runtimeClient: runtime })).toBe(legacy);
  await expect(runCli("status", [], "/unused", { runtimeClient: runtime })).rejects.toBe(legacy);
});


test("nonselected CLI init preserves a thrown typed failure without changing its contract", async () => {
  const { FailureError, failureIssues } = await import("@archcontext/contracts");
  const failure = new FailureError("AC_REPO_NOT_FOUND", "git-worktree-required");
  let calls = 0;
  const runtime = { init: async () => { calls++; throw failure; } } as unknown as RuntimeDaemonClient;
  const result = await runCli("init", ["--name", "Fixture"], process.cwd(), { runtimeClient: runtime }).catch(error => ({ caught: error }));
  expect(calls).toBe(1);
  expect(result).toMatchObject({ ok: false, requestId: "init", error: failure.failure });
  expect(failureIssues((result as any).error)).toEqual([]);
});

test("CLI docs keeps typed failures across its inner command catch", async () => {
  const { FailureError, failureIssues } = await import("@archcontext/contracts");
  const failure = new FailureError("AC_PRECONDITION_FAILED", "projection-snapshot-mismatch", { field: "headSha" }, { action: "run-diagnostics", severity: "critical", retryable: false });
  let calls = 0;
  const runtime = { docsProjection: async () => { calls++; throw failure; } } as unknown as RuntimeDaemonClient;
  const result = await runCli("docs", ["drift"], process.cwd(), { runtimeClient: runtime });
  expect(calls).toBe(1);
  expect((result as any).error).toEqual(failure.failure);
  expect(failureIssues((result as any).error)).toEqual([]);
});

test("MCP apply preserves complete typed unresolved recovery authority", async () => {
  const { failureIssues } = await import("@archcontext/contracts");
  const { ChangeSetRecoveryUnresolvedError } = await import("../../../local-runtime/runtime-daemon/src/changeset-recovery-error");
  const journals = [{ journalId: "journal." + "a".repeat(300), changeSetId: "changeset." + "b".repeat(300), root: "/" + "r".repeat(9000), reason: "incomplete rollback" }];
  const failure = new ChangeSetRecoveryUnresolvedError(journals);
  let calls = 0;
  const runtime = { applyUpdate: async () => { calls++; throw failure; } } as unknown as RuntimeDaemonClient;
  const result = await new McpLocalServer(runtime).callTool("archcontext_apply_update", { root: "/unused", id: "changeset.next", expectedWorktreeDigest: "sha256:" + "c".repeat(64), approved: true });
  expect(calls).toBe(1);
  expect((result.content as any).error).toEqual(failure.failure);
  expect(failureIssues((result.content as any).error)).toEqual([]);
  expect((result.content as any).error.details.unresolvedJournals).toEqual(journals);
  expect(failure.unresolvedJournals).toBe(journals);
});
