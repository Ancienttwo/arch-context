import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FailureError, failureIssues, type JsonEnvelope } from "@archcontext/contracts";
import { ProjectionFootprintUncoveredError, ProjectionManifestInvalidError, ProjectionManifestUpgradeRequiredError } from "@archcontext/core/projection-engine";
import { ProjectionCodeFactsUnavailableError } from "@archcontext/local-runtime/codegraph-adapter";
import { GitVisibleFilesUnavailableError } from "@archcontext/local-runtime/git-adapter";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { runDocsAnchorsCommand, type DocsAnchorsReadInputs } from "../src/docs-anchors";
import { runFlowSelectorCheckCommand } from "../src/flow-selector-check";

const privateText = "/private/customer/reader Authorization=reader-secret body";
const repositoryRoot = resolve(import.meta.dir, "../../../..");
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "d6-b-read-"));
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  initializeArchContextModel(root, "D6 Reader");
  writeFileSync(join(root, "reader.ts"), "export const reader = true;\n");
  return root;
}
const readers = [
  { stage: "docs-anchors", requestId: "docs.anchors", read: runDocsAnchorsCommand,
    throwing(root: string, error: unknown) {
      const inputs = Object.defineProperty({ files: [] }, "model", { get() { throw error; } });
      return runDocsAnchorsCommand(root, {}, inputs as unknown as DocsAnchorsReadInputs);
    } },
  { stage: "flows-check", requestId: "flows.check", read: runFlowSelectorCheckCommand,
    throwing(root: string, error: unknown) {
      return runFlowSelectorCheckCommand(root, { get binary(): string { throw error; } });
    } }
] as const;
function assertSafe(result: JsonEnvelope, code: string, reasonCode: string, requestId: string) {
  expect(result).toMatchObject({ ok: false, requestId, error: { code, reasonCode } });
  expect(failureIssues(result.error)).toEqual([]);
  expect(JSON.stringify(result)).not.toContain(privateText);
}

test("D6-B direct reader Git refusals have strict metadata without debt-specific checks", () => {
  const root = mkdtempSync(join(tmpdir(), "d6-b-not-git-"));
  try {
    for (const reader of readers) {
      const result = reader.read(root);
      assertSafe(result, "AC_REPO_NOT_FOUND", "git-worktree-required", reader.requestId);
      expect(result.error?.details).toEqual({});
      expect(JSON.stringify(result)).not.toContain(root);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("D6-B both direct reader exits preserve registered producer metadata", () => {
  const root = fixture();
  const cases = [
    [() => new GitVisibleFilesUnavailableError(privateText, privateText), "AC_REPO_NOT_FOUND", "git-worktree-required"],
    [() => new ProjectionManifestUpgradeRequiredError(privateText), "AC_PRECONDITION_FAILED", "projection-manifest-upgrade-required"],
    [() => new ProjectionManifestInvalidError([privateText]), "AC_PRECONDITION_FAILED", "projection-manifest-invalid"],
    [() => new ProjectionFootprintUncoveredError([privateText], "default"), "AC_PRECONDITION_FAILED", "projection-footprint-uncovered"],
    [() => new ProjectionCodeFactsUnavailableError("index-missing"), "AC_CODE_FACTS_UNAVAILABLE", "index-missing"]
  ] as const;
  try {
    for (const reader of readers) for (const [makeError, code, reason] of cases) {
      const result = reader.throwing(root, makeError());
      assertSafe(result, code, reason, reader.requestId);
      expect(result.error?.details).toEqual({});
      expect(result.error).toMatchObject(code === "AC_REPO_NOT_FOUND"
        ? { action: "open-correct-repository", severity: "error", retryable: false }
        : code === "AC_CODE_FACTS_UNAVAILABLE" ? { action: "codegraph-init", severity: "error", retryable: true }
        : { action: "rebuild-plan", severity: "warning", retryable: true });
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("D6-B unknown reader failures are honest W1 without message or conversion hooks", () => {
  const root = fixture();
  let conversions = 0;
  const cycle: any = {}; cycle.self = cycle;
  const errors = [new Error(privateText), privateText, cycle, { toString() { conversions++; return privateText; } }];
  try {
    for (const reader of readers) for (const error of errors) {
      const result = reader.throwing(root, error);
      assertSafe(result, "AC_UNCLASSIFIED_FAILURE", "failure-unclassified", reader.requestId);
      expect(result.error).toMatchObject({ action: "inspect-diagnostics", severity: "error", retryable: false, details: { stage: reader.stage } });
    }
    expect(conversions).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("D6-B typed attributes survive and forged producer metadata never invokes getters", () => {
  const root = fixture();
  let hooks = 0;
  try {
    for (const reader of readers) {
      const typed = new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-invalid", {}, { action: "run-diagnostics", severity: "critical", retryable: false });
      const result = reader.throwing(root, typed);
      assertSafe(result, "AC_PRECONDITION_FAILED", "projection-manifest-invalid", reader.requestId);
      expect(result.error).toEqual(typed.failure);
      for (const boxed of [false, true]) {
        const invalid = new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-invalid");
        (invalid.failure as any).reasonCode = boxed
          ? Object.assign(new String("projection-manifest-invalid"), { toJSON() { hooks++; return privateText; } })
          : { privateText, toString() { hooks++; return "projection-manifest-invalid"; } };
        const refusal = reader.throwing(root, invalid);
        assertSafe(refusal, "AC_UNCLASSIFIED_FAILURE", "failure-unclassified", reader.requestId);
        expect(refusal.error?.details).toEqual({ stage: "failure-metadata" });
      }
      for (const key of ["code", "reasonCode"]) {
        const producer = new GitVisibleFilesUnavailableError(privateText, privateText);
        Object.defineProperty(producer, key, { get() { hooks++; throw new Error(privateText); } });
        const refusal = reader.throwing(root, producer);
        assertSafe(refusal, "AC_UNCLASSIFIED_FAILURE", "failure-unclassified", reader.requestId);
        expect(refusal.error?.details).toEqual({ stage: "failure-metadata" });
      }
    }
    expect(hooks).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("D6-B one anchors boundary closes once and preserves the primary refusal for standalone and debt", async () => {
  const root = fixture();
  const source = `
    import { mock } from "bun:test";
    import { FailureError } from "@archcontext/contracts";
    import { ProjectionManifestInvalidError } from "@archcontext/core/projection-engine";
    const original = await import("@archcontext/local-runtime/codegraph-adapter");
    let primary = 0, closes = 0;
    const reader = {
      supportsPath() {
        if (primary === 1) throw new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-invalid", {}, { action: "run-diagnostics", severity: "critical", retryable: false });
        if (primary === 2) throw new ProjectionManifestInvalidError([${JSON.stringify(privateText)}]);
        return false;
      },
      declarationsInSource() { return []; }, declarationsNamed() { return []; },
      close() { closes++; throw new Error(${JSON.stringify(privateText)}); }
    };
    mock.module("@archcontext/local-runtime/codegraph-adapter", () => ({ ...original, openCodeGraphSymbolReader: () => ({ availability: "ready", reader }) }));
    const { runDocsAnchorsCommand } = await import(${JSON.stringify(resolve(import.meta.dir, "../src/docs-anchors.ts"))});
    const { runArchitectureDebtCommand } = await import(${JSON.stringify(resolve(import.meta.dir, "../src/architecture-debt.ts"))});
    const outcomes = [], nested = [], closeCounts = [];
    for (const value of [0, 1, 2]) {
      primary = value;
      let before = closes;
      try { outcomes.push(runDocsAnchorsCommand(${JSON.stringify(root)})); } catch { outcomes.push({ escaped: true }); }
      closeCounts.push(closes - before);
      before = closes;
      nested.push(runArchitectureDebtCommand(${JSON.stringify(root)}));
      closeCounts.push(closes - before);
    }
    process.stdout.write(JSON.stringify({ outcomes, nested, closes, closeCounts }));
  `;
  try {
    const child = Bun.spawn([process.execPath, "--eval", source], { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(exit).toBe(0); expect(stderr).toBe("");
    const { outcomes, nested, closes, closeCounts } = JSON.parse(stdout);
    expect(closes).toBe(6);
    expect(closeCounts).toEqual([1, 1, 1, 1, 1, 1]);
    assertSafe(outcomes[0], "AC_UNCLASSIFIED_FAILURE", "failure-unclassified", "docs.anchors");
    expect(outcomes[0].error).toMatchObject({ action: "inspect-diagnostics", severity: "error", retryable: false, details: { stage: "docs-anchors" } });
    for (const result of outcomes.slice(1)) assertSafe(result, "AC_PRECONDITION_FAILED", "projection-manifest-invalid", "docs.anchors");
    expect(outcomes[1].error).toMatchObject({ action: "run-diagnostics", severity: "critical", retryable: false });
    expect(outcomes[2].error).toMatchObject({ action: "rebuild-plan", severity: "warning", retryable: true });
    for (const [index, result] of nested.entries()) {
      assertSafe(result, outcomes[index].error.code, outcomes[index].error.reasonCode, "debt");
      expect(result.error).toEqual(outcomes[index].error);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("D6-B nested debt keeps known anchors metadata and attributes unknown failures to the producer", async () => {
  const root = fixture();
  const source = `
    import { spyOn } from "bun:test";
    import * as projection from "@archcontext/core/projection-engine";
    import { FailureError } from "@archcontext/contracts";
    import { GitVisibleFilesUnavailableError } from "@archcontext/local-runtime/git-adapter";
    import { ProjectionCodeFactsUnavailableError } from "@archcontext/local-runtime/codegraph-adapter";
    const { runDocsAnchorsCommand } = await import(${JSON.stringify(resolve(import.meta.dir, "../src/docs-anchors.ts"))});
    const { runArchitectureDebtCommand, readArchitectureDebt, readCompleteTaskArchitectureDebt } = await import(${JSON.stringify(resolve(import.meta.dir, "../src/architecture-debt.ts"))});
    let conversions = 0;
    const cycle = {}; cycle.self = cycle;
    const cases = [
      new Error(${JSON.stringify(privateText)}),
      ${JSON.stringify(privateText)},
      cycle,
      { toString() { conversions++; return ${JSON.stringify(privateText)}; } },
      new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-invalid", {}, { severity: "critical", action: "run-diagnostics", retryable: false }),
      new projection.ProjectionManifestUpgradeRequiredError(${JSON.stringify(privateText)}),
      new projection.ProjectionManifestInvalidError([${JSON.stringify(privateText)}]),
      new projection.ProjectionFootprintUncoveredError([${JSON.stringify(privateText)}], "default"),
      new GitVisibleFilesUnavailableError(${JSON.stringify(privateText)}, ${JSON.stringify(privateText)}),
      new ProjectionCodeFactsUnavailableError("index-missing")
    ];
    let injected;
    const loader = spyOn(projection, "loadArchitectureFilesForLayout").mockImplementation(() => { throw injected; });
    const rows = [];
    try {
      for (const error of cases) {
        injected = error;
        const raw = [];
        for (const read of [readArchitectureDebt, readCompleteTaskArchitectureDebt]) {
          try { read(${JSON.stringify(root)}); raw.push({ escapedSuccess: true }); }
          catch (failure) { raw.push(failure.failure); }
        }
        rows.push({ standalone: runDocsAnchorsCommand(${JSON.stringify(root)}), debt: runArchitectureDebtCommand(${JSON.stringify(root)}), raw });
      }
    } finally { loader.mockRestore(); }
    process.stdout.write(JSON.stringify({ rows, conversions }));
  `;
  try {
    const child = Bun.spawn([process.execPath, "--eval", source], { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(exit).toBe(0); expect(stderr).toBe("");
    const { rows, conversions } = JSON.parse(stdout);
    const precondition = { code: "AC_PRECONDITION_FAILED", action: "rebuild-plan", severity: "warning", retryable: true, details: {} };
    const expected = [
      ...Array.from({ length: 4 }, () => ({ code: "AC_UNCLASSIFIED_FAILURE", reasonCode: "failure-unclassified", action: "inspect-diagnostics", severity: "error", retryable: false, details: { stage: "docs-anchors" } })),
      { ...precondition, reasonCode: "projection-manifest-invalid", severity: "critical", action: "run-diagnostics", retryable: false },
      { ...precondition, reasonCode: "projection-manifest-upgrade-required" },
      { ...precondition, reasonCode: "projection-manifest-invalid" },
      { ...precondition, reasonCode: "projection-footprint-uncovered" },
      { code: "AC_REPO_NOT_FOUND", reasonCode: "git-worktree-required", action: "open-correct-repository", severity: "error", retryable: false, details: {} },
      { code: "AC_CODE_FACTS_UNAVAILABLE", reasonCode: "index-missing", action: "codegraph-init", severity: "error", retryable: true, details: {} }
    ];
    expect(rows).toHaveLength(expected.length);
    for (const [index, failure] of expected.entries()) {
      const row = rows[index];
      assertSafe(row.debt, failure.code, failure.reasonCode, "debt");
      expect(row.debt.error).toMatchObject(failure);
      expect(row.debt.error).toEqual(row.standalone.error);
      for (const raw of row.raw) {
        expect(failureIssues(raw)).toEqual([]);
        expect(raw).toEqual(row.debt.error);
      }
    }
    expect(conversions).toBe(0);
    expect(stdout).not.toContain(privateText);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
