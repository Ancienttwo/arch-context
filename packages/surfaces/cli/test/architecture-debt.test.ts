import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { architectureDebtReportIssues, digestJson, stableYaml, type ArchitectureDebtReportV1 } from "@archcontext/contracts";
import { loadNativeModelFromArchContext, resolveArchitectureDocumentationLayout } from "@archcontext/core/projection-engine";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { readArchitectureDebt } from "@archcontext/local-runtime/architecture-debt";
import type { RuntimeDaemonClient } from "@archcontext/local-runtime/runtime-daemon";
import { publishedSchemaIssues } from "../../../contracts/test/published-schemas";
import { runCli } from "../src/main";
import { McpLocalServer } from "@archcontext/surfaces/mcp-local";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const noRuntime = new Proxy({}, { get: (_target, key) => { throw new Error(`debt reached runtime: ${String(key)}`); } }) as RuntimeDaemonClient;
function git(root: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: root, stdio: "pipe", encoding: "utf8" });
}
function write(root: string, path: string, body: string) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body); }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "archctx-debt-")); roots.push(root);
  git(root, "init", "-q");
  initializeArchContextModel(root, "Debt App");
  write(root, ".gitignore", ".codegraph/\n.archcontext/.local/\n");
  write(root, "src/a/main.ts", "export const value = 1;\n");
  write(root, "src/b/main.ts", "export const other = 2;\n");
  for (const name of ["a", "b"]) write(root, `.archcontext/model/nodes/capability.${name}.yaml`, stableYaml({
    schemaVersion: "archcontext.node/v2", id: `capability.${name}`, kind: "capability", name, status: "active",
    summary: `Owns ${name}.`, source: { include: [`src/${name}/**`], exclude: [`src/${name}/ignored/**`] }
  }));
  const model = loadNativeModelFromArchContext(root);
  const paths = resolveArchitectureDocumentationLayout({ nodes: model.nodes, relations: model.relations }).entityPathByNodeId;
  const document = paths.get("capability.b")!;
  write(root, document, "# B\n\nCitation: `src/a/main.ts:1`.\n");
  git(root, "add", "-A"); git(root, "commit", "-qm", "fixture");
  return { root, document };
}
function tree(root: string): string {
  const walk = (path: string): unknown => readdirSync(join(root, path), { withFileTypes: true }).filter(e => e.name !== ".git")
    .sort((a,b)=>a.name.localeCompare(b.name)).map(e => [e.name, e.isDirectory() ? walk(join(path,e.name)) : digestJson({ body: readFileSync(join(root,path,e.name),"utf8") })]);
  return JSON.stringify(walk(""));
}
async function read(root: string, paths: string[]) {
  const before = tree(root);
  const state = mkdtempSync(join(tmpdir(), "archctx-debt-state-")); roots.push(state);
  write(state, "sentinel", "preserve\n");
  const previous = process.env.ARCHCONTEXT_STATE_DIR;
  process.env.ARCHCONTEXT_STATE_DIR = state;
  try {
    const args = ["--json", ...paths.flatMap(path => ["--changed-path",path])];
    const result = await runCli("checkpoint", args, root, { runtimeClient: noRuntime });
    expect(result.requestId).toBe("checkpoint");
    const debt = await runCli("debt", args, root, { runtimeClient: noRuntime });
    expect(debt.data).toEqual(result.data);
    const server = new McpLocalServer({ runtimeResolver: () => { throw new Error("checkpoint reached runtime resolver"); } });
    const mcp = await server.callTool("archcontext_checkpoint", { root, changedPaths: paths });
    expect(mcp.content as unknown).toEqual(result);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(tree(root)).toBe(before);
    expect(readdirSync(state)).toEqual(["sentinel"]);
    expect(existsSync(join(root,".codegraph"))).toBe(false);
    const report = result.data as unknown as ArchitectureDebtReportV1;
    expect(architectureDebtReportIssues(report)).toEqual([]);
    expect(publishedSchemaIssues("runtime/architecture-debt.schema.json", report)).toEqual([]);
    return report;
  } finally {
    if (previous === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previous;
  }
}

test("former checkpoint fields are rejected before any runtime access", async () => {
  const { root } = fixture();
  const fields = ["taskSessionId", "task", "event", "toolCallId", "expectedHeadSha", "expectedWorktreeDigest", "maxBytes", "maxItems"];
  const server = new McpLocalServer({ runtimeResolver: () => { throw new Error("invalid reader input reached runtime"); } });
  for (const field of fields) {
    const result = await server.callTool("archcontext_checkpoint", { root, [field]: field.startsWith("max") ? 12 : "old" });
    expect(result.content).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
  }
  for (const flag of ["--task-session-id", "--task", "--event", "--tool-call-id", "--expected-head-sha", "--head-sha", "--expected-worktree-digest", "--max-bytes", "--max-items", "--path", "--changed"]) {
    expect(await runCli("checkpoint", [flag, "old"], root, { runtimeClient: noRuntime })).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
    if (flag !== "--event") expect(await runCli("hook", ["checkpoint", flag, "old"], root, { runtimeClient: noRuntime })).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
  }
  const missing = await server.callTool("archcontext_checkpoint", { root: join(root, "absent"), changedPaths: ["../outside"] });
  expect(missing.content).toMatchObject({ ok: false });
});

test("hook read preserves the debt report and a typed unknown failure without state access", async () => {
  const { root } = fixture();
  const before = tree(root);
  const result = await runCli("hook", ["checkpoint", "--event", "post-edit", "--changed-path", "src/a/main.ts"], root, { runtimeClient: noRuntime });
  expect(result.ok).toBe(true);
  expect((result.data as any).debt).toEqual(readArchitectureDebt(root, { changedPaths: ["src/a/main.ts"] }));
  expect(publishedSchemaIssues("runtime/hook-debt-checkpoint.schema.json", result.data)).toEqual([]);
  expect(tree(root)).toBe(before);
  expect(await runCli("hook", ["checkpoint", "--changed-path", "../outside"], root, { runtimeClient: noRuntime }))
    .toMatchObject({ ok: false, error: { reasonCode: "changed-path-invalid" } });
  expect(await runCli("hook", ["checkpoint", "--event", ""], root, { runtimeClient: noRuntime }))
    .toMatchObject({ ok: false, error: { reasonCode: "hook-event-invalid" } });
  rmSync(join(root, ".archcontext/manifest.yaml"));
  const missingModelTree = tree(root);
  const failure = await runCli("hook", ["checkpoint"], root, { runtimeClient: noRuntime });
  const producer = await runCli("checkpoint", [], root, { runtimeClient: noRuntime });
  expect(failure.ok).toBe(true);
  expect(failure.data).toMatchObject({ accepted: false, failOpen: true, coverage: "unknown", error: "error" in producer ? producer.error : undefined });
  expect((failure.data as any).debt).toBeUndefined();
  expect(tree(root)).toBe(missingModelTree);
});

test("invalid hook changed-path rejects before repository discovery even outside Git", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-hook-non-git-")); roots.push(root);
  const state = mkdtempSync(join(tmpdir(), "archctx-hook-non-git-state-")); roots.push(state);
  write(root, "sentinel", "preserve worktree\n");
  write(state, "sentinel", "preserve state\n");
  const before = tree(root);
  const stateBefore = tree(state);
  let runtimeAccesses = 0;
  let storeAccesses = 0;
  const forbiddenRuntime = new Proxy({}, { get: () => { runtimeAccesses++; throw new Error("runtime accessed"); } });
  const forbiddenStore = new Proxy({}, { get: () => { storeAccesses++; throw new Error("store accessed"); } });
  const previous = process.env.ARCHCONTEXT_STATE_DIR;
  process.env.ARCHCONTEXT_STATE_DIR = state;
  try {
    const result = await runCli("hook", ["checkpoint", "--changed-path", "../outside"], root, {
      runtimeClient: forbiddenRuntime as RuntimeDaemonClient, localStore: forbiddenStore as any
    });
    expect(result).toMatchObject({ ok: false, requestId: "hook.checkpoint",
      error: { code: "AC_SCHEMA_INVALID", reasonCode: "changed-path-invalid" } });
    expect(result.data).toBeUndefined();
    expect(runtimeAccesses).toBe(0);
    expect(storeAccesses).toBe(0);
    expect(tree(root)).toBe(before);
    expect(tree(state)).toBe(stateBefore);
  } finally {
    if (previous === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previous;
  }
});

test("a logic-only edit owes no task and the process writes no worktree or runtime state", async () => {
  const { root } = fixture();
  const before = await read(root,["src/a/main.ts"]);
  write(root,"src/a/main.ts","export const value = 42;\n");
  const after = await read(root,["src/a/main.ts"]);
  expect(after).toEqual(before);
  expect(after.items).toEqual([]);
  expect(after.coverage).toBe("partial");
  expect(after.checks).toContainEqual({ check:"dependencies",coverage:"unknown",reasonCodes:["deferred-to-complete","not-evaluated"] });
});

test("a shortened source reports the human citation in another capability and its repair removes that debt", async () => {
  const {root,document}=fixture();
  write(root,"src/a/main.ts","");
  const report=await read(root,["src/a/main.ts"]);
  expect(report.items).toHaveLength(1);
  expect(report.items[0]!.kind).toBe("stale-anchor");
  expect(report.items[0]!.capabilityIds).toEqual(["capability.b"]);
  expect(report.items[0]!.paths).toEqual([document,"src/a/main.ts"].sort());
  write(root,document,"# B\n\nCitation: `src/a/main.ts`.\n");
  expect((await read(root,["src/a/main.ts"])).items).toEqual([]);
});

test("a real ambiguous source owner is debt, and non-source or excluded files are not", async () => {
  const {root}=fixture();
  write(root,".archcontext/model/nodes/capability.c.yaml",stableYaml({schemaVersion:"archcontext.node/v2",id:"capability.c",kind:"capability",name:"C",status:"active",source:{include:["src/a/**"]}}));
  expect((await read(root,["src/a/main.ts"])).items.some(item=>item.kind==="ambiguous-owner")).toBe(true);
  write(root,"notes.md","Human notes.\n");
  write(root,"src/b/ignored/test.ts","ignored\n");
  expect((await read(root,["notes.md","src/b/ignored/test.ts"])).items).toEqual([]);
});

test("deleted cited files still produce anchor debt, without inventing an unowned existing file", async () => {
  const {root}=fixture();
  rmSync(join(root,"src/a/main.ts"));
  const report=await read(root,["src/a/main.ts"]);
  expect(report.items.map(item=>item.kind)).toEqual(["stale-anchor"]);
  expect(report.items[0]!.reasonCode).toBe("missing-path");
});

test("a new file under a declared source root without a matching owner is actionable", async () => {
  const {root}=fixture();
  write(root,".archcontext/model/nodes/capability.a.yaml",stableYaml({schemaVersion:"archcontext.node/v2",id:"capability.a",kind:"capability",name:"A",status:"active",source:{include:["src/a/*.ts"]}}));
  write(root,"src/a/new/tool.ts","export const newFile = 1;\n");
  const report=await read(root,["src/a/new/tool.ts"]);
  expect(report.items.map(item=>item.kind)).toEqual(["unowned-path"]);
  expect(report.items[0]!.paths).toEqual(["src/a/new/tool.ts"]);
});

test("invalid inputs, a non-Git directory and a missing model refuse without a daemon", async () => {
  const {root}=fixture();
  for (const args of [["--changed-path"],["--changed-path","../escape"],["--bogus"]]) {
    expect(await runCli("debt",args,root,{runtimeClient:noRuntime})).toMatchObject({ok:false,error:{code:"AC_SCHEMA_INVALID"}});
  }
  expect(()=>readArchitectureDebt(root,{changedPaths:"src/a.ts" as unknown as string[]})).toThrow("must be an array");
  const empty=mkdtempSync(join(tmpdir(),"archctx-debt-empty-")); roots.push(empty);
  expect(await runCli("debt",[],empty,{runtimeClient:noRuntime})).toMatchObject({ok:false,error:{code:"AC_REPO_NOT_FOUND"}});
  git(empty,"init","-q");
  expect(await runCli("debt",[],empty,{runtimeClient:noRuntime})).toMatchObject({ok:false,error:{code:"AC_MODEL_ADOPTION_REQUIRED"}});
  expect((await runCli("debt",["--help"],empty,{runtimeClient:noRuntime})).ok).toBe(true);
});

test("D6-A anchors refusal retains code/action/reason/details through raw, CLI, MCP and hook", async () => {
  const { FailureError, failureIssues } = await import("@archcontext/contracts");
  const { root } = fixture();
  write(root, "docs/architecture/.projection-manifest.json", JSON.stringify({ schemaVersion: "archcontext.architecture-docs-projection-manifest/v2", profile: "default" }));
  const before = tree(root);
  let raw: unknown;
  try { readArchitectureDebt(root); } catch (error) { raw = error; }
  expect(raw).toBeInstanceOf(FailureError);
  const producer = (raw as InstanceType<typeof FailureError>).failure;
  expect(producer).toMatchObject({
    code: "AC_PRECONDITION_FAILED",
    reasonCode: "projection-manifest-upgrade-required",
    action: "rebuild-plan",
    details: {
      manifestPath: "docs/architecture/.projection-manifest.json",
      foundSchemaVersion: "archcontext.architecture-docs-projection-manifest/v2",
      supportedSchemaVersion: "archcontext.architecture-docs-projection-manifest/v3",
      upgradeCommand: "archctx docs apply --approved --profile <default|repo-harness/v1>",
      migrationGuide: "docs/runbooks/architecture-documentation-projections.md"
    }
  });
  expect(failureIssues(producer)).toEqual([]);
  for (const command of ["debt", "checkpoint"]) {
    const result = await runCli(command, [], root, { runtimeClient: noRuntime });
    expect("error" in result ? result.error : undefined).toEqual(producer);
  }
  const mcp = await new McpLocalServer({ runtimeResolver: () => { throw new Error("read started runtime"); } }).callTool("archcontext_checkpoint", { root });
  expect((mcp.content as any).error).toEqual(producer);
  const hook = await runCli("hook", ["checkpoint"], root, { runtimeClient: noRuntime });
  expect(hook).toMatchObject({ ok: true, data: { accepted: false, failOpen: true, coverage: "unknown", error: producer } });
  expect(tree(root)).toBe(before);
});
