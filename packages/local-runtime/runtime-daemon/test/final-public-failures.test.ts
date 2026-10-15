import { expect, test } from "bun:test";
import { FailureError, failureIssues, knownFailure, toEnvelope } from "@archcontext/contracts";
import { ArchctxDaemon, createStartedDaemon } from "../src/index";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { ChangeSetRecoveryUnresolvedError } from "../src/changeset-recovery-error";
import { projectionFailureEnvelope } from "../src/projection-service";
import { publicOperationFailure } from "../src/public-operation-failure";
const privateText = "Authorization=private customer /private/repository";
const digest = `sha256:${"a".repeat(64)}`;
function fixture() {
  const store = new TestLocalStore();
  const daemon = new ArchctxDaemon({localStore: store, codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider())});
  return {store, daemon: daemon as any};
}
function strict(error: any, code = "AC_UNCLASSIFIED_FAILURE") {
  expect(error).toBeInstanceOf(FailureError);
  expect(error.code).toBe(code);
  expect(failureIssues(error.failure)).toEqual([]);
  if (code === "AC_UNCLASSIFIED_FAILURE") expect(JSON.stringify(error.failure)).not.toContain(privateText);
}
test("generic apply preserves returned refusals and thrown unknown draft, without business writes", async () => {
  const {daemon, store} = fixture();
  await daemon.start();
  try {
    const result = await daemon.applyUpdate("/unused", {id:"changeset.absent", approved:false, expectedWorktreeDigest:digest});
    expect(result.error.reasonCode).toBe("apply-approval-required");
    expect(failureIssues(result.error)).toEqual([]);
    const error = await daemon.applyUpdate("/unused", {id:"changeset.absent", approved:true, expectedWorktreeDigest:digest}).catch((error: unknown)=>error);
    strict(error,"AC_PRECONDITION_FAILED");
    expect(error.reasonCode).toBe("apply-draft-missing");
    expect(store.listUnresolvedChangeSetJournals()).toEqual([]);
  } finally {await daemon.stop();}
});
test("projection unknown failures are safe and known failures retain all attributes", () => {
  const unknown = projectionFailureEnvelope("projection.run",new Error(privateText));
  expect(unknown.error?.code).toBe("AC_UNCLASSIFIED_FAILURE");
  expect(failureIssues(unknown.error)).toEqual([]);
  expect(JSON.stringify(unknown)).not.toContain(privateText);
  const known = new FailureError("AC_PRECONDITION_FAILED","projection-manifest-invalid",{}, {severity:"critical",retryable:false,action:"run-diagnostics"});
  expect(projectionFailureEnvelope("projection.run",known).error).toEqual(known.failure);
});
test("unresolved journals remain complete and sentinel identity survives public adaptation", () => {
  const journals = [{journalId:"journal."+"a".repeat(300),changeSetId:"changeset."+"b".repeat(300),root:"/long/"+"r".repeat(400),reason:"recovery failed"}];
  const error = new ChangeSetRecoveryUnresolvedError(journals);
  expect(publicOperationFailure(error)).toBe(error);
  strict(error,"AC_PRECONDITION_FAILED");
  expect(error.unresolvedJournals).toBe(journals);
  expect(error.details.unresolvedJournals).toEqual(journals);
});
test("all original partial public wrappers safely classify unexpected entry failures", async () => {
  const {daemon,store} = fixture();
  daemon.assertRunning = () => {throw new Error(privateText);};
  const cases: Array<[string,unknown[]]> = [
    ["acceptCommittedChange",["/unused",{}]], ["ledgerProject",["/unused",{}]], ["ledgerMigrate",["/unused",{}]],
    ["ledgerRollback",["/unused",{}]], ["ledgerRebuild",["/unused",{}]], ["recommendations",["/unused",{}]],
    ["refactorRecord",["/unused",{}]], ["refactorVerify",["/unused",{}]], ["auditApprove",["/unused",{}]],
    ["docs",["/unused",{}]], ["applyUpdate",["/unused",{}]], ["planPracticeWaiver",["/unused",{}]],
    ["docsProjection",["/unused",{}]], ["agentContextProjection",["/unused",{}]], ["projection",["/unused",{}]],
    ["mcpProjection",["/unused",{},true]], ["inspectProjectionApplyReceipt",["/unused",digest]],
    ["listProjectionPriorCommittedApplies",["/unused",{}]], ["readbackProjectionApply",["/unused",{}]], ["recoverProjectionApply",["/unused",{}]]
  ];
  try {for (const [method,args] of cases) {
    const error = await Promise.resolve().then(()=>daemon[method](...args)).catch(error=>error);
    strict(error);
  }} finally {store.close();}
});
test("constructor, startup and factory failures retain lifecycle ordering and cleanup priority", async () => {
  const deps = Object.defineProperty({},"localStore",{get(){throw new Error(privateText);}});
  let error: unknown;
  try {new ArchctxDaemon(deps);} catch(caught) {error=caught;}
  strict(error);
  const {daemon,store} = fixture();
  const order: string[] = [];
  (store as any).acquireWriterOwnership = () => {order.push("ownership");};
  store.migrate = async () => {order.push("migrate");throw new Error(privateText);};
  store.close = () => {order.push("close");};
  strict(await daemon.start().catch((error: unknown)=>error));
  expect(order).toEqual(["ownership","migrate","close"]);
  expect(daemon.status().running).toBe(false);
  order.length=0;
  strict(await createStartedDaemon({localStore:store,codeFacts:new CodeGraphAdapter(new MockCodeGraphProvider())}).catch(error=>error));
  expect(order).toEqual(["ownership","migrate","close"]);
  const typed = new FailureError("AC_PRECONDITION_FAILED","projection-manifest-invalid");
  store.close = () => {throw typed;};
  expect((await daemon.start().catch((error: unknown)=>error)).failure).toEqual(typed.failure);
});
test("stop retains explorer then finally cleanup and cleanup error priority", async () => {
  const {daemon,store} = fixture();
  const order: string[] = [];
  daemon.closeExplorer = async()=>{order.push("explorer");throw new Error(privateText);};
  store.close = ()=>{order.push("close");};
  strict(await daemon.stop().catch((error: unknown)=>error));
  expect(order).toEqual(["explorer","close"]);
  const known = new FailureError("AC_PRECONDITION_FAILED","projection-manifest-invalid");
  store.close=()=>{throw known;};
  expect((await daemon.stop().catch((error: unknown)=>error)).failure).toEqual(known.failure);
});


test("recovery sentinel metadata cannot execute getters or escape a raw failure",()=>{
 const error=new ChangeSetRecoveryUnresolvedError([]);let calls=0;
 Object.defineProperty(error,"failure",{get(){calls++;throw new Error(privateText);}});
 const failure=publicOperationFailure(error);strict(failure);
 expect(failureIssues(projectionFailureEnvelope("projection.run",error).error)).toEqual([]);
 expect(calls).toBe(0);
});
test("approved docs pin returns complete typed unresolved recovery authority",async()=>{
 const {ExternalDocumentationService}=await import("../src/external-documentation");
 const journals=[{journalId:"journal.pin",changeSetId:"changeset.pin",root:"/unused",reason:"failed recovery"}];
 const sentinel=new ChangeSetRecoveryUnresolvedError(journals);
 const service=new ExternalDocumentationService({assertRunning(){},async openSession(){return {workspace:{root:"/unused"}};},clock:()=>"2026-10-15T00:00:00.000Z",async withWriter(){throw sentinel;}} as any);
 const result=await service.docs("/unused",{command:"pin",libraryId:"/bun/bun",version:"1.0.0",approved:true});
 expect(result.error?.reasonCode).toBe("changeset-recovery-unresolved");
 expect(result.error?.details).toEqual({unresolvedJournals:journals});expect(failureIssues(result.error)).toEqual([]);
});

test("MCP stale snapshot keeps its proven field and precondition classification",async()=>{
 const {createInitializedGitRepo,removeTempRepo}=await import("./runtime-test-fixtures");
 const root=createInitializedGitRepo();const {daemon}=fixture();await daemon.start();
 try {
  const result=await daemon.mcpProjection(root,{action:"run",request:{schemaVersion:"archcontext.projection-request/v1",profile:"repo-harness/v1",mode:"apply",targets:["architecture-docs"],changedPaths:[],requestId:"request.stale",expected:{repositoryId:"repo.wrong",workspaceId:"ws.wrong",headSha:"a".repeat(40),worktreeDigest:digest}}},true);
  expect(result.error).toMatchObject({code:"AC_PRECONDITION_FAILED",reasonCode:"projection-snapshot-mismatch",action:"rebuild-plan",details:{field:"repositoryId"}});
  expect(failureIssues(result.error)).toEqual([]);
 } finally {await daemon.stop();removeTempRepo(root);}
});

test("remaining review value APIs preserve success object identity and safely type raw failures",async()=>{
 const {daemon,store}=fixture();const success={marker:"same instance"};
 const groups=[
  ["developerReviewRuns",["prepareDeveloperReviewWorktree","startDeveloperReviewRun","withDeveloperReviewRun","cleanupOwnedDeveloperReviewRun","cleanupDeveloperReviewRun","recoverDeveloperReviewRuns"]],
  ["developerReviewSessions",["computeDeveloperReviewDigestBundle","runDeveloperReviewSession","runSignedDeveloperReviewAttestation"]]
 ] as const;
 try {for(const [field,methods] of groups) {
  daemon[field]=Object.fromEntries(methods.map(method=>[method,()=>success]));
  for(const method of methods)expect(await daemon[method]({})).toBe(success);
  daemon[field]=Object.fromEntries(methods.map(method=>[method,()=>{throw new Error(privateText);} ]));
  for(const method of methods)strict(await Promise.resolve().then(()=>daemon[method]({})).catch(error=>error));
 }}finally{store.close();}
});
test("init, waiver list and status do not expose raw ordinary failures",async()=>{
 const {daemon,store}=fixture();
 try {
  daemon.assertRunning=()=>{throw new Error(privateText);};
  for(const [method,args] of [["init",["/unused"]],["practiceWaivers",["/unused"]]] as Array<[string,unknown[]]>) strict(await Promise.resolve().then(()=>daemon[method](...args)).catch(error=>error));
  daemon.explorerProjections.changeFeedStatus=()=>{throw new Error(privateText);};
  strict(await daemon.runtimeStatus().catch((error:unknown)=>error));
  let error:unknown;try{daemon.status();}catch(caught){error=caught;}strict(error);
 }finally{store.close();}
});

test("projection mismatch metadata is copied from the typed failure without reading a replaced field getter",async()=>{
 const {createInitializedGitRepo,removeTempRepo}=await import("./runtime-test-fixtures");
 const {assertProjectionInvocationSnapshot}=await import("../src/projection-service");
 const root=createInitializedGitRepo();let error:any,calls=0;
 try {
  try {assertProjectionInvocationSnapshot(root,{action:"run",request:{expected:{repositoryId:"wrong"}}} as any);}catch(caught){error=caught;}
  Object.defineProperty(error,"field",{get(){calls++;throw new Error(privateText);}});
  const envelope=projectionFailureEnvelope("projection.run",error);
  expect(envelope.error).toMatchObject({code:"AC_PRECONDITION_FAILED",reasonCode:"projection-snapshot-mismatch",details:{field:"repositoryId"}});
  expect(failureIssues(envelope.error)).toEqual([]);expect(calls).toBe(0);
 }finally{removeTempRepo(root);}
});


function publicWriterFiles(root: string): Record<string, string> {
  const { readFileSync, readdirSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const files: Record<string, string> = {};
  const walk = (relative: string) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files[path] = readFileSync(join(root, path), "utf8");
    }
  };
  walk("");
  return files;
}

test("approved public docs pin preserves a racing descriptor preimage and returns its registered refusal", async () => {
  const { createInitializedGitRepo, removeTempRepo } = await import("./runtime-test-fixtures");
  const { setDescriptorRelativeWriteTestHook } = await import("../../../core/changeset-engine/src/descriptor-relative-write");
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = createInitializedGitRepo();
  const { daemon, store } = fixture();
  await daemon.start();
  const relative = ".archcontext/integrations/context7.lock.yaml";
  const external = JSON.stringify({ schemaVersion: "archcontext.context7-lockfile/v1", provider: "context7", libraries: [], marker: "racing writer" });
  const before = publicWriterFiles(root);
  let reached = 0;
  setDescriptorRelativeWriteTestHook(() => {
    reached++;
    setDescriptorRelativeWriteTestHook(undefined);
    writeFileSync(join(root, relative), external, "utf8");
  });
  try {
    const result = await daemon.docs(root, { command: "pin", libraryId: "/facebook/react", version: "18.2.0", approved: true });
    expect(reached).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.error).toEqual(knownFailure("AC_PRECONDITION_FAILED", "apply-preimage-changed", { issueCount: 1 }));
    expect(failureIssues(result.error)).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(root);
    expect(publicWriterFiles(root)).toEqual({ ...before, [relative]: external });
    expect(store.changeSetJournals.size).toBe(0);
  } finally {
    setDescriptorRelativeWriteTestHook(undefined);
    await daemon.stop();
    removeTempRepo(root);
  }
});

test("public init rolls back its created model and preserves a racing generated preimage with typed refusal", async () => {
  const { createGitRepo, removeTempRepo } = await import("./runtime-test-fixtures");
  const { setDescriptorRelativeWriteTestHook } = await import("../../../core/changeset-engine/src/descriptor-relative-write");
  const { existsSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = createGitRepo();
  const { daemon, store } = fixture();
  await daemon.start();
  const relative = ".archcontext/generated/ARCHITECTURE.md";
  const external = "racing generated destination; preserve these bytes\n";
  const before = publicWriterFiles(root);
  let reached = 0;
  setDescriptorRelativeWriteTestHook(() => {
    if (!existsSync(join(root, ".archcontext/generated"))) return;
    reached++;
    setDescriptorRelativeWriteTestHook(undefined);
    writeFileSync(join(root, relative), external, "utf8");
  });
  try {
    const error = await daemon.init(root, "Racing init").catch((caught: unknown) => caught);
    expect(reached).toBe(1);
    strict(error, "AC_PRECONDITION_FAILED");
    const envelope = toEnvelope("init", error, "public-operation");
    expect(envelope.error).toEqual(knownFailure("AC_PRECONDITION_FAILED", "apply-preimage-changed", { issueCount: 1 }));
    expect(JSON.stringify(envelope)).not.toContain(root);
    expect(publicWriterFiles(root)).toEqual({ ...before, [relative]: external });
    expect(store.changeSetJournals.size).toBe(0);
  } finally {
    setDescriptorRelativeWriteTestHook(undefined);
    await daemon.stop();
    removeTempRepo(root);
  }
});

test("unknown descriptor I/O with a lookalike diagnostic remains safe unclassified at public pin", async () => {
  const { createInitializedGitRepo, removeTempRepo } = await import("./runtime-test-fixtures");
  const { setDescriptorRelativeWriteTestHook } = await import("../../../core/changeset-engine/src/descriptor-relative-write");
  const root = createInitializedGitRepo();
  const { daemon, store } = fixture();
  await daemon.start();
  const before = publicWriterFiles(root);
  setDescriptorRelativeWriteTestHook(() => { throw new Error(`Expected hash mismatch: ${privateText}`); });
  try {
    const result = await daemon.docs(root, { command: "pin", libraryId: "/facebook/react", version: "18.2.0", approved: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: "AC_UNCLASSIFIED_FAILURE", reasonCode: "failure-unclassified" });
    expect(failureIssues(result.error)).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(privateText);
    expect(publicWriterFiles(root)).toEqual(before);
    expect(store.changeSetJournals.size).toBe(0);
  } finally {
    setDescriptorRelativeWriteTestHook(undefined);
    await daemon.stop();
    removeTempRepo(root);
  }
});
