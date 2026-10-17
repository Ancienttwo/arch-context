import { expect, test } from "bun:test";
import { NativeContextError, nativeContextErrorEnvelope, failureIssues } from "../src";

test("native schema failures preserve optional source paths through public validation", () => {
  const issue = { entityId: "flow.Module.primary", field: "$.id", invariant: "invalid-id" };
  const path = ".archcontext/model/flows/input.yaml";
  for (const item of [issue, { ...issue, path }]) {
    const result = nativeContextErrorEnvelope(new NativeContextError("native-context-model-invalid", { path, issues: [item] }));
    expect(result.error?.reasonCode).toBe("native-context-model-invalid");
    expect(result.error?.details).toEqual({ path, issues: [item] });
    expect(failureIssues(result.error)).toEqual([]);
  }
});

test("native issue path metadata retains own-data and whole-item limits", () => {
  const issue = { entityId: "flow.demo.primary", field: "$.id", invariant: "invalid-id" };
  let reads = 0;
  const accessor = Object.defineProperty({ ...issue }, "path", { enumerable: true, get() { reads++; return "private-body"; } });
  for (const item of [accessor, { ...issue, path: 7 }, { ...issue, path: "input.yaml", unknown: "field" }]) {
    const result = nativeContextErrorEnvelope(new NativeContextError("native-context-model-invalid", { issues: [item] }));
    expect(result.error?.code).toBe("AC_UNCLASSIFIED_FAILURE");
    expect(failureIssues(result.error)).toEqual([]);
  }
  expect(reads).toBe(0);
  const result = nativeContextErrorEnvelope(new NativeContextError("native-context-model-invalid", { issues: [{ ...issue, path: "x".repeat(257) }] }));
  expect(result.error?.reasonCode).toBe("native-context-model-invalid");
  expect(result.error?.details).toMatchObject({ issues: [], omittedDiagnosticCount: 1 });
  expect(failureIssues(result.error)).toEqual([]);
});

test("native shared source paths reflect the issues left after budget omission", () => {
  const path = ".archcontext/model/flows/first.yaml";
  const issues = Array.from({ length: 31 }, () => ({ entityId: "flow.demo.primary", field: "f".repeat(200), invariant: "i".repeat(200), path }));
  issues.push({ ...issues[0]!, path: ".archcontext/model/flows/second.yaml" });
  const result = nativeContextErrorEnvelope(new NativeContextError("native-context-model-invalid", { issues }));
  const reported = result.error?.details?.issues as typeof issues;
  expect(reported.length).toBeGreaterThan(0);
  expect(reported.length).toBeLessThan(issues.length);
  expect(reported.every(issue => issue.path === path)).toBe(true);
  expect(result.error?.details?.path).toBe(path);
  expect(result.error?.details?.omittedDiagnosticCount).toBe(issues.length - reported.length);
  expect(Buffer.byteLength(JSON.stringify(result, null, 2) + "\n")).toBeLessThanOrEqual(8192);
  expect(failureIssues(result.error)).toEqual([]);
});

test("source-aware issues determine the summary even when a caller supplies a conflicting path", () => {
  const issue = { entityId: "flow.demo.primary", field: "$.id", invariant: "invalid-id", path: "first.yaml" };
  for (const issues of [[issue], [issue, { ...issue, path: "second.yaml" }]]) {
    const result = nativeContextErrorEnvelope(new NativeContextError("native-context-model-invalid", { path: "unrelated.yaml", issues }));
    expect(result.error?.details?.issues).toEqual(issues);
    if (issues.length === 1) expect(result.error?.details?.path).toBe("first.yaml");
    else expect(result.error?.details).not.toHaveProperty("path");
    expect(failureIssues(result.error)).toEqual([]);
  }
});

test("C1 native diagnostic metadata is own-data only and never invokes a getter", () => {
  let hooks = 0;
  const details = Object.defineProperty({}, "path", { enumerable: true, get() { hooks++; return "private-native-body"; } });
  const error = new NativeContextError("native-context-input-missing", details);
  const result = nativeContextErrorEnvelope(error);
  expect(hooks).toBe(0);
  expect(result.error?.code).toBe("AC_UNCLASSIFIED_FAILURE");
  expect(failureIssues(result.error)).toEqual([]);
  expect(JSON.stringify(result)).not.toContain("private-native-body");
});

test("C1 native whole-item omission bounds actual rendered output without truncating identity", () => {
  const issues = Array.from({ length: 32 }, (_, i) => ({ entityId: "node."+String(i)+"x".repeat(230), field: "field".repeat(40), invariant: "invariant".repeat(25) }));
  const result = nativeContextErrorEnvelope(new NativeContextError("native-context-model-invalid", { issues }));
  expect(result.error?.reasonCode).toBe("native-context-model-invalid");
  expect(Buffer.byteLength(JSON.stringify(result, null, 2)+"\n")).toBeLessThanOrEqual(8192);
  expect(failureIssues(result.error)).toEqual([]);
  expect(Number(result.error?.details?.omittedDiagnosticCount)).toBeGreaterThan(0);
  for (const issue of (result.error?.details?.issues ?? []) as typeof issues) expect(issues).toContainEqual(issue);
});


test("C1 critical facts are complete own-data values and malformed bindings are refused without getters", async () => {
  const {knownFailure} = await import("../src");
  const facts = {recommendationId: "recommendation."+"a".repeat(240), evidenceDigest:"sha256:"+"b".repeat(64)};
  expect(knownFailure("AC_REFACTOR_EVIDENCE_REQUIRED", "evidence-unknown", facts).details).toEqual(facts);
  let reads=0;
  const accessor = Object.defineProperty({...facts}, "evidenceDigest", {enumerable:true, get(){reads++;return facts.evidenceDigest;}});
  const inherited = Object.assign(Object.create({evidenceDigest:facts.evidenceDigest}), {recommendationId:facts.recommendationId});
  for (const invalid of [accessor, inherited, {...facts,recommendationId:facts.recommendationId+"oversized"}, {...facts,readbackRequest:{receiptDigest:"sha256:"+"c".repeat(64)}}]) {
    expect(()=>knownFailure("AC_REFACTOR_EVIDENCE_REQUIRED", "evidence-unknown", invalid)).toThrow();
  }
  expect(reads).toBe(0);
});

test("C1 retains a long full confirmation binding through rendered envelope validation", async () => {
  const {knownFailure,failureEnvelope} = await import("../src");
  const confirmationToken = "public:github.com/"+"o".repeat(100)+"/"+"r".repeat(100)+":"+"a".repeat(40)+":audit_run."+"b".repeat(64);
  const failure = knownFailure("AC_USER_CONFIRMATION_REQUIRED", "audit-confirmation-required", {runId:"audit_run.fixture",confirmationToken});
  const result = failureEnvelope("audit.approve", failure);
  expect(result.error.details.confirmationToken).toBe(confirmationToken);
  expect(failureIssues(result.error)).toEqual([]);
  expect(Buffer.byteLength(JSON.stringify(result,null,2)+"\n")).toBeLessThanOrEqual(8192);
  expect(()=>knownFailure("AC_USER_CONFIRMATION_REQUIRED", "audit-confirmation-required", {runId:"audit_run.fixture",confirmationToken:confirmationToken+"a".repeat(1024)})).toThrow();
});


test("C1 native Git read categories retain the existing producer code and action", () => {
  for(const category of ["timeout","unavailable"]) {
    const result=nativeContextErrorEnvelope(new NativeContextError("native-context-git-read-failed",{operation:"rev-parse",category}));
    expect(result.error).toMatchObject({code:"AC_PRECONDITION_FAILED",reasonCode:"native-context-git-read-failed",action:"repair-native-input",details:{category}});
    expect(failureIssues(result.error)).toEqual([]);
  }
});

test("C1 native inherited schema names cannot bypass compound fact guards or mutate result prototypes", () => {
  const item={kind:"marker-nested",range:{startByte:0,endByte:1,startLine:1,endLine:1}};
  for(const key of ["constructor","__proto__"]) {
    const result=nativeContextErrorEnvelope(new NativeContextError("native-context-model-invalid",Object.fromEntries([[key,[item]]])));
    expect(result.error?.code).toBe("AC_UNCLASSIFIED_FAILURE");
    expect(result.error?.reasonCode).toBe("failure-unclassified");
    expect(failureIssues(result.error)).toEqual([]);
    expect(Object.getPrototypeOf(result.error!.details)).toBe(Object.prototype);
    expect(Object.hasOwn(result.error!.details!,key)).toBe(false);
  }
});
