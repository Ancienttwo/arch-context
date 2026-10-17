import { expect, test } from "bun:test";
import { ERROR_CATALOG, FAILURE_POLICIES, FAILURE_STAGES, FailureError, failureEnvelope, failureIssues, knownFailure, normalizeFailureResult, toEnvelope } from "../src";

const privateText = "/private/customer/model source body Authorization=do-not-emit";
const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

test("every registered failure reason has the strict four fields and bounded UTF-8 metadata", () => {
  for (const [reason, policy] of Object.entries(FAILURE_POLICIES)) {
    const facts: Record<string, any> = {
      stage: "debt", checks: ["ownership", "anchors"], issueCount: 2, method: "completeTask", timeoutMs: 5, elapsedMs: 6, mutationOutcome: "unknown",
      issues: [{ code: "version-mismatch", message: "CodeGraph repository status version mismatch" }],
      jobId: "job.fixture", runId: "audit_run.fixture", draftId: "draft.fixture", recommendationId: "recommendation."+"a".repeat(16), currentRecommendationId: "recommendation."+"b".repeat(16), currentRecorded: true,
      consentReason: "not-granted", searched: "recorded", decisionStatus: "accepted", disposition: "resolved", changedFields: ["headSha", "worktreeDigest"],
      evidenceDigest: "sha256:"+"a".repeat(64), assessmentDigest: "sha256:"+"b".repeat(64), expectedHeadSha: "a".repeat(40), actualHeadSha: "b".repeat(40),
      expectedWorktreeDigest: "sha256:"+"c".repeat(64), actualWorktreeDigest: "sha256:"+"d".repeat(64), expectedNamespace: "product.fixture", actualNamespace: "product.next", measuredBytes: 10, limitBytes: 9, kind: "timeout", confirmationToken: "public:github.com/acme/widgets:"+"a".repeat(40)+":audit_run.fixture", recordCommand: null, verifyCommand: null, observation: "before-resolve-append", field: reason === "projection-snapshot-mismatch" ? "worktreeDigest" : reason === "jobs-input-invalid" ? "workerId" : "into", issue: "unknown-node", inputDomain: "observed", availability: "unavailable", cause: "unclassified"
    };
    Object.assign(facts, {journalId:"journal.fixture",challengeId:"challenge.fixture",previousJournalId:"journal.previous",capabilityId:"capability.fixture",changeSetId:"changeset.fixture",manualRecoveryRequired:true,expectedModelDigest:"sha256:"+"a".repeat(64),actualModelDigest:"sha256:"+"b".repeat(64),expectedPlanDigest:"sha256:"+"a".repeat(64),actualPlanDigest:"sha256:"+"b".repeat(64),lookupKey:"sha256:"+"a".repeat(64),applyId:"sha256:"+"b".repeat(64),driftCount:1,rejectedCount:1,digestStable:false,pathCount:1,paths:["docs/file.md"],action:"remove-whole-file-outputs-and-reapply",commands:["archctx docs apply --approved"],omittedPathCount:0,omittedCommandCount:0});
    if(reason==="developer-review-worktree-invalid") facts.refusal="WORKTREE_NOT_CLEAN";
    if(reason==="developer-review-run-not-owned") facts.refusal="run-id";
    if(reason==="runtime-ledger-mode-invalid") facts.field="rolloutMode";
    if(reason==="projection-inputs-changed-during-run") facts.field="sourceFiles";
    if(reason==="rpc-version-mismatch") Object.assign(facts,{expected:"archcontext.runtime-rpc/v2",received:"archcontext.runtime-rpc/v1",action:"upgrade-archctx-runtime",upgradeCommand:"archctx daemon upgrade"});
    const details = policy.journalRecovery ? {unresolvedJournals:[]} : policy.recovery ? {requestId: "request.fixture", lookupKey: "sha256:"+"a".repeat(64), applyId: "sha256:"+"b".repeat(64), ...(reason === "projection-apply-committed-manual-only" ? {manualRecoveryRequired: true, readbackUnavailable: "details-budget-exceeded"} : {})} : policy.native ? {} : policy.facts ? Object.fromEntries(Object.keys(policy.facts).map(key => [key, facts[key]])) : {stage: "debt"};
    const failure = knownFailure(policy.code, reason, details);
    expect(failureIssues(failure)).toEqual([]);
    expect(size(failure.details)).toBeLessThanOrEqual(8192);
    expect(new TextEncoder().encode(failure.message).byteLength).toBeLessThanOrEqual(1024);
    expect(failureEnvelope("checkpoint", failure)).toMatchObject({ ok: false, error: failure });
  }
});

test("unclassified failure names the local inspection command without changing its shape", () => {
  const failure = knownFailure("AC_UNCLASSIFIED_FAILURE", "failure-unclassified", { stage: "complete" });
  expect(failure.message).toContain("archctx doctor --json");
  expect(failure).toMatchObject({ code: "AC_UNCLASSIFIED_FAILURE", reasonCode: "failure-unclassified", action: "inspect-diagnostics", retryable: false, details: { stage: "complete" } });
});

test("code facts not-ready is a registered failure with bounded issue facts", () => {
  const issues = [{ code: "version-mismatch", message: "CodeGraph repository status version mismatch" }];
  const failure = knownFailure("AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", { issues });
  expect(failure).toMatchObject({ code: "AC_CODE_FACTS_NOT_READY", action: "codegraph-index", retryable: false, details: { issues } });
  expect(failureIssues(failure)).toEqual([]);
  expect(size(failure.details)).toBeLessThanOrEqual(8192);
  for (const invalid of [Array(33).fill(issues[0]), [{ ...issues[0], message: privateText }], [{ ...issues[0], path: privateText }]]) {
    expect(() => knownFailure("AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", { issues: invalid })).toThrow();
  }
  expect(size(knownFailure("AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", { issues: Array(32).fill(issues[0]) }).details)).toBeLessThanOrEqual(8192);
  let reads = 0;
  const hostile = Object.defineProperty({ code: "version-mismatch" }, "message", { enumerable: true, get() { reads++; return privateText; } });
  expect(() => knownFailure("AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", { issues: [hostile] })).toThrow();
  expect(reads).toBe(0);
});

test("known metadata survives typed errors and returned envelopes without copying raw messages", () => {
  const typed = new FailureError("AC_REPO_NOT_FOUND", "git-worktree-required", { checks: ["ownership", "anchors"] }, { action: "run-diagnostics", retryable: false });
  const direct = toEnvelope("checkpoint", typed, "cli");
  const returned = normalizeFailureResult({ ...direct, error: { ...direct.error, message: privateText } }, "mcp") as any;
  expect(returned.error).toEqual(direct.error);
  expect(returned.error.action).toBe("run-diagnostics");
  expect(returned.error.retryable).toBe(false);
  expect(JSON.stringify(returned)).not.toContain(privateText);
  expect(failureIssues({ ...returned.error, details: returned.error.details })).toEqual([]);
});

test("opaque errors, forged codes and hostile string conversion cannot classify or leak", () => {
  const cycle: any = {}; cycle.self = cycle;
  for (const error of [new Error(privateText), privateText, null, cycle, { code: "AC_REPO_NOT_FOUND", message: privateText }, { toString() { throw new Error(privateText); } }]) {
    const result = toEnvelope("complete_task", error, "complete");
    expect(result.error).toMatchObject({ code: "AC_UNCLASSIFIED_FAILURE", reasonCode: "failure-unclassified", severity: "error", retryable: false, action: "inspect-diagnostics", details: { stage: "complete" } });
    expect(JSON.stringify(result)).not.toContain(privateText);
    expect(failureIssues(result.error)).toEqual([]);
  }
});

test("closed allowlists omit ordinary scalar facts without reading getters", () => {
  const details = { body: privateText.repeat(5000), summaryCount: 12 };
  Object.defineProperty(details, "stderr", { enumerable: true, get() { throw new Error(privateText); } });
  const result = knownFailure("AC_SCHEMA_INVALID", "changed-path-invalid", details);
  expect(result.details).toEqual({ omittedCount: 3 });
  expect(size(result.details)).toBeLessThanOrEqual(8192);
  expect(failureIssues(result)).toEqual([]);
  expect(JSON.stringify(result)).not.toContain(privateText);
  expect(knownFailure("AC_SCHEMA_INVALID", "checkpoint-input-invalid", { issueCount: Infinity }).details).toEqual({ omittedCount: 1 });
});

test("critical recovery bindings are refused, never silently omitted or truncated", () => {
  for (const key of ["applyId", "requestDigest", "receipt", "readbackRequest", "lookupKey"]) {
    expect(() => knownFailure("AC_PRECONDITION_FAILED", "projection-manifest-invalid", { [key]: privateText })).toThrow("unsupported critical binding");
  }
});

test("strict validation rejects missing fields, extra raw facts, byte overruns and deep cycles", () => {
  const failure = knownFailure("AC_SCHEMA_INVALID", "changed-path-invalid");
  const { details: _details, ...missing } = failure;
  const cycle: any = {}; cycle.self = cycle;
  for (const invalid of [missing, { ...failure, details: { body: privateText } }, { ...failure, message: "界".repeat(400) }, { ...failure, details: cycle }, { ...failure, details: { checks: Array(33).fill("ownership") } }]) expect(failureIssues(invalid).length).toBeGreaterThan(0);
});

test("success values are untouched and selected transport codes have no auto-retry", () => {
  const result = { ok: true, data: { result: "fail_action_required", actionsRequired: ["repair"] } };
  expect(normalizeFailureResult(result, "complete")).toBe(result);
  for (const code of ["RPC_TIMEOUT", "RPC_ABORTED"] as const) {
    const failure = knownFailure(code, code === "RPC_TIMEOUT" ? "rpc-timeout" : "rpc-aborted", { method: "completeTask", timeoutMs: 5, elapsedMs: 6, mutationOutcome: "unknown" });
    expect(failure.code).toBe(code);
    expect(failure.retryable).toBe(false);
    expect(failureIssues(failure)).toEqual([]);
  }
});

test("array facts use validated own data values without caller getters, methods or iterators", () => {
  let reads = 0;
  const accessor: any[] = [];
  Object.defineProperty(accessor, "0", { configurable: true, get() { reads++; return reads === 1 ? "ownership" : privateText; } });
  const methods: any = [privateText]; methods.every = () => true;
  const iterator: any = ["ownership"]; iterator[Symbol.iterator] = function* () { yield privateText; };
  for (const checks of [accessor, methods, iterator]) {
    const raw = { ...knownFailure("AC_SCHEMA_INVALID", "changed-path-invalid"), details: { checks } };
    const emitted = normalizeFailureResult({ ok: false, error: raw }, "cli") as any;
    expect(failureIssues(emitted.error)).toEqual([]);
    expect(JSON.stringify(emitted)).not.toContain(privateText);
  }
  expect(reads).toBe(0);
});

test("exported failure policies and nested field lists cannot mutate authoritative messages", () => {
  const before = knownFailure("AC_UNCLASSIFIED_FAILURE", "failure-unclassified");
  expect(Reflect.set(FAILURE_POLICIES["failure-unclassified"]!, "message", privateText)).toBe(false);
  expect(Reflect.set(FAILURE_POLICIES, "failure-unclassified", { message: privateText })).toBe(false);
  expect(Object.isFrozen(FAILURE_POLICIES["git-worktree-required"]!.fields)).toBe(true);
  expect(Reflect.set(FAILURE_STAGES, "0", privateText)).toBe(false);
  expect(knownFailure("AC_UNCLASSIFIED_FAILURE", "failure-unclassified")).toEqual(before);
});

test("explicit malformed details cannot erase a critical binding while retaining classification", () => {
  for (const details of [null, "unsafe", 42, [{ receipt: "essential-binding" }]]) {
    expect(() => knownFailure("AC_PRECONDITION_FAILED", "projection-manifest-invalid", details)).toThrow("must be an object");
    const result = normalizeFailureResult({ ok: false, error: { code: "AC_PRECONDITION_FAILED", reasonCode: "projection-manifest-invalid", details } }, "cli") as any;
    expect(result.error).toMatchObject({ code: "AC_UNCLASSIFIED_FAILURE", reasonCode: "failure-unclassified", retryable: false, details: { stage: "failure-metadata" } });
  }
});


test("unknown compound metadata cannot hide nested recovery bindings or cycles", () => {
  const cycle: any = {}; cycle.self = cycle;
  for (const details of [{ summary: { receipt: "essential-binding" } }, { summary: [{ applyId: "apply.123" }] }, { summary: cycle }, { omittedCount: { receipt: "essential-binding" } }, { omittedCount: cycle }]) {
    expect(() => knownFailure("AC_PRECONDITION_FAILED", "projection-manifest-invalid", details)).toThrow("unsupported compound fact");
    const result = normalizeFailureResult({ ok: false, error: { code: "AC_PRECONDITION_FAILED", reasonCode: "projection-manifest-invalid", details } }, "cli") as any;
    expect(result.error).toMatchObject({ code: "AC_UNCLASSIFIED_FAILURE", details: { stage: "failure-metadata" } });
    expect(failureIssues(result.error)).toEqual([]);
  }
});

test("selected failure defaults do not depend on later public catalog mutations", () => {
  const entry = ERROR_CATALOG.AC_UNCLASSIFIED_FAILURE;
  const original = { ...entry };
  try {
    entry.retryable = true; entry.action = "unsafe-action";
    const result = toEnvelope("complete", new Error(privateText), "complete");
    expect(result.error).toMatchObject({ code: "AC_UNCLASSIFIED_FAILURE", retryable: false, action: "inspect-diagnostics", details: { stage: "complete" } });
    expect(failureIssues(result.error)).toEqual([]);
  } finally { Object.assign(entry, original); }
});

test("P2 primitive policy keys reject coercible and boxed reason values before lookup", () => {
  let conversions = 0;
  const reasons: unknown[] = [
    { privateText, toString() { conversions++; return "projection-manifest-invalid"; } },
    { privateText, [Symbol.toPrimitive]() { conversions++; return "projection-manifest-invalid"; } },
    Object.assign(new String("projection-manifest-invalid"), { toJSON() { conversions++; return { privateText }; } })
  ];
  for (const reason of reasons) {
    expect(() => knownFailure("AC_PRECONDITION_FAILED", reason as any)).toThrow();
    const error = new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-invalid");
    (error.failure as any).reasonCode = reason;
    const result = toEnvelope("complete", error, "complete");
    expect(result.error.code).toBe("AC_UNCLASSIFIED_FAILURE");
    expect(result.error.details).toEqual({ stage: "failure-metadata" });
    expect(JSON.stringify(result)).not.toContain(privateText);
    expect(failureIssues(error.failure).length).toBeGreaterThan(0);
  }
  expect(conversions).toBe(0);
});

test("P2 metadata snapshots never invoke changing top-level accessors or inherited values", () => {
  const valid = knownFailure("AC_PRECONDITION_FAILED", "projection-manifest-invalid");
  for (const key of ["code", "reasonCode", "action", "severity", "retryable", "details"] as const) {
    let reads = 0;
    const failure = { ...valid };
    Object.defineProperty(failure, key, { enumerable: true, get() { reads++; return reads === 1 ? valid[key] : { privateText, toString() { return "projection-manifest-invalid"; } }; } });
    const result = normalizeFailureResult({ ok: false, error: failure }, "cli") as any;
    expect(result.error.code).toBe("AC_UNCLASSIFIED_FAILURE");
    expect(JSON.stringify(result)).not.toContain(privateText);
    expect(failureIssues(failure).length).toBeGreaterThan(0);
    expect(reads).toBe(0);
  }
  const inherited = normalizeFailureResult({ ok: false, error: Object.create(valid) }, "cli") as any;
  expect(inherited.error.code).toBe("AC_UNCLASSIFIED_FAILURE");
  for (const key of ["ok", "error"]) {
    let reads = 0;
    const result: any = { ok: false, error: valid };
    Object.defineProperty(result, key, { get() { reads++; throw new Error(privateText); } });
    expect((normalizeFailureResult(result, "cli") as any).error.code).toBe("AC_UNCLASSIFIED_FAILURE");
    expect(reads).toBe(0);
  }
  let reads = 0;
  const typed = new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-invalid");
  Object.defineProperty(typed, "failure", { get() { reads++; return valid; } });
  expect(toEnvelope("complete", typed, "complete").error.code).toBe("AC_UNCLASSIFIED_FAILURE");
  expect(reads).toBe(0);
});

test("P2 attribute and stage types do not run conversion or accessor hooks", () => {
  let calls = 0;
  const hostile = { privateText, toString() { calls++; return "rebuild-plan"; } };
  for (const key of ["action", "severity", "retryable"]) {
    const attributes = Object.defineProperty({}, key, { get() { calls++; return key === "action" ? "rebuild-plan" : key === "severity" ? "error" : false; } });
    expect(() => knownFailure("AC_PRECONDITION_FAILED", "projection-manifest-invalid", {}, attributes)).toThrow();
    expect(() => knownFailure("AC_PRECONDITION_FAILED", "projection-manifest-invalid", {}, { [key]: hostile } as any)).toThrow();
  }
  expect(() => knownFailure(hostile as any, "projection-manifest-invalid")).toThrow();
  expect(toEnvelope("complete", new Error("unknown"), hostile as any).error.code).toBe("AC_UNCLASSIFIED_FAILURE");
  expect(calls).toBe(0);
  const legacy = normalizeFailureResult({ ok: false, error: { code: "AC_PRECONDITION_FAILED", reasonCode: "projection-manifest-invalid" } }, "cli") as any;
  expect(legacy.error).toEqual(knownFailure("AC_PRECONDITION_FAILED", "projection-manifest-invalid"));
});

test("P2 strict validator refuses extra accessor metadata without executing it", () => {
  let reads = 0;
  const value = { ...knownFailure("AC_PRECONDITION_FAILED", "projection-manifest-invalid") };
  Object.defineProperty(value, "extra", { enumerable: true, get() { reads++; return privateText; } });
  expect(failureIssues(value).length).toBeGreaterThan(0);
  expect(reads).toBe(0);
});


test("P2 strict validator rejects non-enumerable wire object fields", () => {
  const valid = knownFailure("AC_SCHEMA_INVALID", "changed-path-invalid", { checks: ["ownership"], stage: "debt" });
  for (const key of Object.keys(valid)) {
    const value = { ...valid };
    Object.defineProperty(value, key, { enumerable: false });
    expect(failureIssues(value).length).toBeGreaterThan(0);
  }
  for (const key of Object.keys(valid.details)) {
    const value = { ...valid, details: { ...valid.details } };
    Object.defineProperty(value.details, key, { enumerable: false });
    expect(failureIssues(value).length).toBeGreaterThan(0);
  }
});


test("D6-B standalone reader stages are fixed and valid under the same failure contract", () => {
  for (const stage of ["docs-anchors", "flows-check"]) {
    expect(FAILURE_STAGES as readonly string[]).toContain(stage);
    const value = knownFailure("AC_UNCLASSIFIED_FAILURE", "failure-unclassified", { stage });
    expect(value.details).toEqual({ stage });
    expect(failureIssues(value)).toEqual([]);
  }
});
