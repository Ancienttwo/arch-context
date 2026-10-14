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
    const facts: Record<string, any> = { checks: ["ownership", "anchors"], issueCount: 2, method: "completeTask", timeoutMs: 5, elapsedMs: 6, mutationOutcome: "unknown" };
    const details = Object.fromEntries((policy.fields ?? []).map(key => [key, facts[key]]));
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
