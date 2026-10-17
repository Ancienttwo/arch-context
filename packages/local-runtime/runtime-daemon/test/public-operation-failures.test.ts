import { expect, test } from "bun:test";
import { failureIssues } from "@archcontext/contracts";
import { ExternalDocumentationService } from "../src/external-documentation";
import { LandscapeService } from "../src/landscape";
import { auditConsentRequiredEnvelope } from "../src/audit-consent";
import { readCapabilityDependencies, CapabilityDependenciesError } from "../src/capability-dependencies";
const sentinel = "/private/customer Authorization=private-body";

test("native source paths survive the public operation failure boundary", async () => {
  const { NativeContextError } = await import("@archcontext/contracts");
  const { publicOperationFailure } = await import("../src/public-operation-failure");
  const path = ".archcontext/model/flows/input.yaml";
  const details = { path, issues: [{ entityId: "flow.Module.primary", field: "$.id", invariant: "invalid-id", path }] };
  const error = new NativeContextError("native-context-model-invalid", details);
  const result = publicOperationFailure(error);
  expect(result.failure).toEqual(error.failure);
  expect(result.failure).toMatchObject({ code: "AC_SCHEMA_INVALID", reasonCode: "native-context-model-invalid", details });
  expect(failureIssues(result.failure)).toEqual([]);
});

test("C1 public resource refusal has its explicit producer reason without extra state writes", async () => {
  let opens=0, reads=0;
  const context={ assertRunning() {}, async openSession() { opens++; return {workspace:{root:"/unused"}}; }, localStore:{async readExternalDocumentationByContentDigest() {reads++;return undefined;} } };
  const service=new ExternalDocumentationService(context as any);
  const bad=await service.readResource("/unused", sentinel);
  expect(bad.error?.reasonCode).toBe("resource-uri-invalid"); expect(failureIssues(bad.error)).toEqual([]);
  const missing=await service.readResource("/unused", "archcontext://external-docs/context7/sha256:"+"a".repeat(64));
  expect(missing.error?.reasonCode).toBe("resource-cache-miss"); expect(failureIssues(missing.error)).toEqual([]);
  expect(opens).toBe(2); expect(reads).toBe(1); expect(JSON.stringify([bad,missing])).not.toContain(sentinel);
});

test("C1 ordinary unknown rejection is safe at the operation boundary", async () => {
  const service=new LandscapeService({assertRunning(){throw new Error(sentinel);}} as any);
  let result: any;
  try { await service.repoList(); throw new Error("unexpected success"); } catch (error) { result = {error: (error as any).failure}; }
  expect(result.error?.code).toBe("AC_UNCLASSIFIED_FAILURE"); expect(failureIssues(result.error)).toEqual([]);
  expect(JSON.stringify(result)).not.toContain(sentinel);
});

test("C1 consent and dependency refusals use source-owned reasons and original codes", () => {
  const consent=auditConsentRequiredEnvelope("audit.run", "not-granted");
  expect(consent.error?.reasonCode).toBe("audit-user-consent-required");
  expect(consent.error?.details).toEqual({consentReason:"not-granted"}); expect(failureIssues(consent.error)).toEqual([]);
  try {readCapabilityDependencies("/unused", {importNodeLimit:0});throw new Error("unexpected success");}
  catch(error) { expect(error).toBeInstanceOf(CapabilityDependenciesError);expect((error as any).code).toBe("AC_SCHEMA_INVALID"); expect((error as any).reasonCode).toBe("deps-input-invalid"); }
});


test("C1 preserves raw throw shape and typed attributes when a public operation delegates", async () => {
  const { FailureError } = await import("@archcontext/contracts");
  const typed = new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-invalid", {}, {severity: "critical", retryable: false, action: "run-diagnostics"});
  const service = new ExternalDocumentationService({assertRunning() {}, async openSession() {throw typed;}} as any);
  let failure: any;
  try { await service.readResource("/unused", "archcontext://external-docs/context7/sha256:"+"a".repeat(64)); }
  catch (error) { expect(error).toBeInstanceOf(FailureError); failure = (error as InstanceType<typeof FailureError>).failure; }
  expect(failure).toEqual(typed.failure);
  expect(failureIssues(failure)).toEqual([]);
});

test("C2 recovery sentinel is typed and keeps complete original journal bindings", async () => {
  const { ChangeSetRecoveryUnresolvedError } = await import("../src/changeset-recovery-error");
  const { publicOperationFailure } = await import("../src/public-operation-failure");
  const journals = [{journalId:"journal."+"a".repeat(240), changeSetId:"changeset."+"b".repeat(240), root:"/fixture", reason:"fixture-recovery"}];
  const sentinel = new ChangeSetRecoveryUnresolvedError(journals as any);
  let caught: unknown;
  caught=publicOperationFailure(sentinel);
  expect(caught).toBe(sentinel);
  expect((caught as InstanceType<typeof ChangeSetRecoveryUnresolvedError>).unresolvedJournals).toBe(journals as any);
  expect((caught as InstanceType<typeof ChangeSetRecoveryUnresolvedError>).unresolvedJournals[0]!.journalId).toBe(journals[0]!.journalId);
});


test("C1 hostile throws retain safe typed raw failures at the existing public boundaries", async () => {
  const {FailureError} = await import("@archcontext/contracts");
  const {runProjectionCheckCommand} = await import("../src/projection-service");
  const {exportNativeContext} = await import("@archcontext/local-runtime/model-store-yaml");
  const throwing = (key: string) => Object.defineProperty({},key,{get(){const p=Proxy.revocable({},{});p.revoke();throw p.proxy;}});
  for (const read of [()=>runProjectionCheckCommand(throwing("mode") as any,"."),()=>readCapabilityDependencies(".",throwing("importNodeLimit")),()=>exportNativeContext(".",throwing("source") as any)]) {
    let caught: any;
    try {read();} catch(error) {caught=error;}
    expect(caught).toBeInstanceOf(FailureError);
    expect(caught.code).toBe("AC_UNCLASSIFIED_FAILURE");
    expect(failureIssues(caught.failure)).toEqual([]);
  }
});

test("C1 Context7 preserves source retryability and never invokes a metadata getter", async () => {
  const {Context7ProviderError}=await import("@archcontext/local-runtime/context7-adapter");
  const {publicOperationFailure}=await import("../src/public-operation-failure");
  for(const retryable of [true,false]) {
    const failure=publicOperationFailure(new Context7ProviderError("timeout","private-provider-body",{retryable})).failure;
    expect(failure).toMatchObject({code:"AC_SCHEMA_INVALID",reasonCode:"context7-provider-refused",retryable,details:{kind:"timeout"}});
    expect(failureIssues(failure)).toEqual([]);
  }
  let calls=0;const hostile=new Context7ProviderError("timeout","private-provider-body",{retryable:true});
  Object.defineProperty(hostile,"retryable",{get(){calls++;return true;}});
  expect(publicOperationFailure(hostile).code).toBe("AC_UNCLASSIFIED_FAILURE");expect(calls).toBe(0);
});


test("C1 observed-facts refusal keeps proven absence and makes the cause explicitly unknown", async () => {
  const {ExplorerProjectionCompileError} = await import("../src/explorer-projection");
  const {publicOperationFailure} = await import("../src/public-operation-failure");
  const facts = {inputDomain: "observed", availability: "unavailable", cause: "unclassified"} as const;
  const failure = publicOperationFailure(new ExplorerProjectionCompileError("precondition-failed", sentinel, facts)).failure;
  expect(failure).toMatchObject({code: "AC_PRECONDITION_FAILED", reasonCode: "explorer-precondition-failed", details: facts});
  expect(failureIssues(failure)).toEqual([]);
  expect(JSON.stringify(failure)).not.toContain(sentinel);
  let calls = 0;
  const hostile = new ExplorerProjectionCompileError("precondition-failed", sentinel, facts);
  Object.defineProperty(hostile, "failureFacts", {get(){calls++;return facts;}});
  expect(publicOperationFailure(hostile).code).toBe("AC_UNCLASSIFIED_FAILURE");
  expect(calls).toBe(0);
});
