import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson } from "@archcontext/contracts";
import { planManifestFieldsOperation } from "@archcontext/core/changeset-engine";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { SqliteLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import { ArchctxRuntimeRpcServer, RuntimeRpcClient, createStartedDaemon, type RuntimeDaemonClient } from "@archcontext/local-runtime/runtime-daemon";
import { McpLocalServer } from "@archcontext/surfaces/mcp-local";
import { runCli } from "../src/main";

async function fixture() {
  const parent = mkdtempSync(join(tmpdir(), "archctx-manifest-cli-"));
  const root = join(parent, "repo"); mkdirSync(root);
  initializeArchContextModel(root, "Manifest CLI");
  mkdirSync(join(root, "docs/adr"), { recursive: true });
  const path = join(root, ".archcontext/manifest.yaml");
  const before = readFileSync(path, "utf8").replace('decisions: "docs/adr"', 'decisions: ".archcontext/decisions"');
  writeFileSync(path, before);
  for (const args of [["init"], ["add", "."], ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "fixture"]]) execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const store = new SqliteLocalStore(join(parent, "state.sqlite"));
  const daemon = await createStartedDaemon({ localStore: store, codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()), architectureLedger: { rolloutMode: "dual" } });
  const rpc = new ArchctxRuntimeRpcServer(daemon, { root, port: 0, token: "manifest-contract-test" });
  const client = new RuntimeRpcClient(await rpc.start());
  return { root, path, before, store, daemon, client, async close() { await rpc.stop(); await daemon.stop(); rmSync(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
}

test("manifest CLI help and invalid inputs never start the daemon", async () => {
  let calls = 0;
  const runtimeClient = new Proxy({}, { get() { calls++; throw new Error("unexpected daemon access"); } }) as RuntimeDaemonClient;
  expect((await runCli("manifest", ["--help"], "/absent", { runtimeClient })).ok).toBe(true);
  for (const args of [[], ["plan", "--id", "changeset.test", "--decisions", "elsewhere"], ["plan", "--id", "changeset.test", "--decisions", "docs/adr", "--body", "anything"], ["plan", "--id", "one", "--id", "two", "--decisions", "docs/adr"]]) {
    expect((await runCli("manifest", args, "/absent", { runtimeClient })).ok).toBe(false);
  }
  expect(calls).toBe(0);
});

test("manifest CLI plans over RPC without writes and applies once through daemon journal and ledger", async () => {
  const f = await fixture();
  const cli = (command: string, args: string[]) => runCli(command, args, f.root, { runtimeClient: f.client });
  try {
    const planned = await cli("manifest", ["plan", "--id", "changeset.manifest-cli", "--decisions", "docs/adr"]);
    expect(planned.ok, JSON.stringify(planned)).toBe(true);
    const data = planned.data as any;
    expect(data.preview.allowed).toBe(true);
    expect(data.draft.operations[0].fields).toEqual({ "content.decisions": "docs/adr" });
    expect(readFileSync(f.path, "utf8")).toBe(f.before);
    const flags = ["--id", data.draft.id, "--expected-worktree-digest", data.draft.base.worktreeDigest];
    expect((await cli("apply", flags)).ok).toBe(false);
    writeFileSync(join(f.root, "concurrent.txt"), "changed\n");
    expect((await cli("apply", [...flags, "--approved"])).ok).toBe(false);
    rmSync(join(f.root, "concurrent.txt"));
    const result = await cli("apply", [...flags, "--approved"]);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((result.data as any).architectureLedger.append.status).toBe("appended");
    const after = f.before.replace('decisions: ".archcontext/decisions"', 'decisions: "docs/adr"');
    expect(readFileSync(f.path, "utf8")).toBe(after);
    const committed = await f.store.listCommittedChangeSetsForTaskSession(f.root, "task_runtime");
    expect(committed).toHaveLength(1);
    expect(committed[0].files).toEqual([{ path: ".archcontext/manifest.yaml", operation: "write", hash: digestJson({ body: after }) }]);
    expect((await cli("apply", [...flags, "--approved"])).ok).toBe(false);
  } finally { await f.close(); }
}, 30_000);

test("manifest MCP requires and consumes a CLI-confirmed one-time approval over RPC", async () => {
  const f = await fixture();
  try {
    const mcp = new McpLocalServer(f.client);
    const operation = planManifestFieldsOperation(f.root, { "content.decisions": "docs/adr" });
    const planned = await mcp.callTool("archcontext_plan_update", { root: f.root, id: "changeset.manifest-mcp", operations: [operation] });
    const envelope = planned.content as any;
    expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
    const data = envelope.data;
    expect(data.preview.allowed).toBe(true);
    const input = { id: data.draft.id, expectedWorktreeDigest: data.draft.base.worktreeDigest };
    expect(await f.client.applyUpdate(f.root, { ...input, approved: true })).toMatchObject({ ok: false, error: { code: "AC_USER_CONFIRMATION_REQUIRED" } });
    expect(await f.client.applyMcpUpdate(f.root, { ...input, approvalToken: "forged" })).toMatchObject({ ok: false, error: { code: "AC_USER_CONFIRMATION_REQUIRED" } });
    const flags = ["--id", input.id, "--expected-worktree-digest", input.expectedWorktreeDigest, "--expected-changeset-digest", data.changeSetDigest];
    expect((await runCli("approve", flags, f.root, { runtimeClient: f.client })).ok).toBe(false);
    const approved = await runCli("approve", [...flags, "--approved"], f.root, { runtimeClient: f.client });
    expect(approved.ok, JSON.stringify(approved)).toBe(true);
    const approvalToken = (approved.data as any).approvalToken;
    const applied = await mcp.callTool("archcontext_apply_update", { root: f.root, ...input, approvalToken });
    expect((applied.content as any).ok, JSON.stringify(applied)).toBe(true);
    expect(await f.client.applyMcpUpdate(f.root, { ...input, approvalToken })).toMatchObject({ ok: false, error: { code: "AC_USER_CONFIRMATION_REQUIRED" } });
    expect(readFileSync(f.path, "utf8")).toBe(f.before.replace('decisions: ".archcontext/decisions"', 'decisions: "docs/adr"'));
  } finally { await f.close(); }
}, 30_000);
