import { expect, test } from "bun:test";
import { GitVisibleFilesUnavailableError } from "@archcontext/local-runtime/git-adapter";
import type { RuntimeDaemonClient } from "@archcontext/local-runtime/runtime-daemon";
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
  expect(Object.keys(value.error.details).every(key => key === "stage" || key === "errorClass")).toBe(true);
  if ("errorClass" in value.error.details) expect(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError", "AggregateError", "NonError"]).toContain(value.error.details.errorClass);
}

test("selected CLI commands make unknown exceptions safe and explicitly unclassified", async () => {
  for (const [command, args] of [["complete", []], ["review", []], ["practices", ["checkpoint"]]] as const) {
    assertUnknown(await runCli(command, [...args], "/unused", { runtimeClient: runtimeThrowing(new Error(sentinel)) }));
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

test("all registered producer reasons survive selected CLI adapters", async () => {
  const { FAILURE_POLICIES, knownFailure, failureEnvelope, failureIssues } = await import("@archcontext/contracts");
  for (const [reason, policy] of Object.entries(FAILURE_POLICIES)) {
    const facts: Record<string, any> = {
      stage: "debt", checks: ["ownership", "anchors"], issueCount: 2, method: "completeTask", timeoutMs: 5, elapsedMs: 6, mutationOutcome: "unknown",
      jobId: "job.fixture", runId: "audit_run.fixture", draftId: "draft.fixture", recommendationId: "recommendation."+"a".repeat(16), currentRecommendationId: "recommendation."+"b".repeat(16), currentRecorded: true,
      consentReason: "not-granted", searched: "recorded", decisionStatus: "accepted", disposition: "resolved", changedFields: ["headSha", "worktreeDigest"],
      evidenceDigest: "sha256:"+"a".repeat(64), assessmentDigest: "sha256:"+"b".repeat(64), expectedHeadSha: "a".repeat(40), actualHeadSha: "b".repeat(40),
      expectedBaseSha: "a".repeat(40), actualBaseSha: "b".repeat(40),
      expectedWorktreeDigest: "sha256:"+"c".repeat(64), actualWorktreeDigest: "sha256:"+"d".repeat(64), expectedNamespace: "product.fixture", actualNamespace: "product.next", measuredBytes: 10, limitBytes: 9, kind: "timeout", confirmationToken: "public:github.com/acme/widgets:"+"a".repeat(40)+":audit_run.fixture", recordCommand: null, verifyCommand: null, observation: "before-resolve-append", field: reason === "projection-snapshot-mismatch" ? "worktreeDigest" : reason === "jobs-input-invalid" ? "workerId" : "into", issue: "unknown-node", inputDomain: "observed", availability: "unavailable", cause: "unclassified"
    };
    const ruleFacts: Record<string, any> = {
      codeFactsIssues: [{ code: "version-mismatch", message: "CodeGraph repository status version mismatch" }],
      id: "fixture.authority", uint: 2, sha256: "sha256:" + "a".repeat(64), head: "a".repeat(40), boolean: true,
      rpcVersion: "archcontext.runtime-rpc/v2", upgradeAction: "upgrade-archctx-runtime", upgradeCommand: "archctx daemon upgrade",
      projectionInputField: "headSha", ownershipAction: "remove-whole-file-outputs-and-reapply", ledgerModeField: "readMode",
      changedFields: ["headSha", "worktreeDigest"], publicConfirmationToken: facts.confirmationToken,
      consentReason: "not-granted", searched: "recorded", decisionStatus: "accepted", disposition: "resolved",
      commandSuggestion: null, context7Kind: "timeout", repoPath: "packages/fixture/package.json", exportsSubpath: "./sub",
      modelValidationDiagnostics: [{ path: "docs/adr/ADR-0001-x.md", code: "schema-version-missing" }],
      stateMachineIssues: [".archcontext/model/state-machines/order.yaml: regions[0].initial: state-machine-initial-unknown"]
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
                if (key === "omittedIssueCount") return [key, 1];
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
  }
});

test("returned failures cannot leak raw diagnostics in unknown fields or request IDs", async () => {
  const error = { code: "AC_SCHEMA_INVALID", reasonCode: "changed-path-invalid", action: "repair-model", severity: "error", retryable: false, message: sentinel, details: { body: sentinel, ordinarySummary: "omit-me" } };
  const runtime = { completeTask: async () => ({ ok: false, requestId: sentinel, error, diagnostics: sentinel }) } as unknown as RuntimeDaemonClient;
  const cli = await runCli("complete", [], "/unused", { runtimeClient: runtime });
  expect(cli).toMatchObject({ requestId: "complete", error: { details: { omittedCount: 2 } } });
  expect(JSON.stringify(cli)).not.toContain(sentinel);
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

test("invalid typed transport metadata cannot escape selected CLI safety boundaries", async () => {
  const error = new GitVisibleFilesUnavailableError(sentinel, sentinel);
  Object.defineProperty(error, "code", { get() { throw new Error(sentinel); } });
  const runtime = runtimeThrowing(error);
  const result = await runCli("complete", [], "/unused", { runtimeClient: runtime });
  expect(result).toMatchObject({ ok: false, error: { code: "AC_UNCLASSIFIED_FAILURE", reasonCode: "failure-unclassified", details: { stage: "failure-metadata" } } });
  expect(JSON.stringify(result)).not.toContain(sentinel);
});

test("malformed producer details are refused across selected CLI instead of losing bindings", async () => {
  for (const details of [null, 42, "unsafe", [{ receipt: "essential-binding" }], { summary: { receipt: "essential-binding" } }, { summary: [{ applyId: "apply.123" }] }, { omittedCount: { receipt: "essential-binding" } }]) {
    const runtime = { completeTask: async () => ({ ok: false, error: { code: "AC_PRECONDITION_FAILED", reasonCode: "projection-manifest-invalid", details } }) } as unknown as RuntimeDaemonClient;
    const result = await runCli("complete", [], "/unused", { runtimeClient: runtime });
    expect(result).toMatchObject({ ok: false, error: { code: "AC_UNCLASSIFIED_FAILURE", reasonCode: "failure-unclassified", details: { stage: "failure-metadata" } } });
  }
});

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
    for (const [command, args] of [["complete", []], ["review", []], ["practices", ["checkpoint"]]] as const) {
      hooks = 0;
      const { error, returned } = makeCase();
      let calls = 0;
      const operation = async () => { calls++; if (returned) return { ok: false, error }; throw error; };
      const runtime = { completeTask: operation, practiceCheckpoint: operation } as unknown as RuntimeDaemonClient;
      const value = await runCli(command, [...args], "/unused", { runtimeClient: runtime });
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
    [() => new ProjectionCodeFactsUnavailableError("index-missing"), ["code", "reasonCode"]]
  ];
  for (const [makeError, keys] of cases) for (const key of keys) for (const inherited of [false, true]) {
    for (const [command, args] of [["complete", []], ["review", []], ["practices", ["checkpoint"]]] as const) {
      const error = makeError();
      const original = Object.getOwnPropertyDescriptor(error, key)!.value;
      let reads = 0;
      const target = inherited ? Object.create(Object.getPrototypeOf(error)) : error;
      Object.defineProperty(target, key, { get() { reads++; return original; } });
      if (inherited) { Reflect.deleteProperty(error, key); Object.setPrototypeOf(error, target); }
      const runtime = runtimeThrowing(error);
      const value = await runCli(command, [...args], "/unused", { runtimeClient: runtime });
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
