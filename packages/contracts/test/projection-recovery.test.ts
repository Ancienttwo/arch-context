import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ERROR_CATALOG, failureIssues, knownFailure, normalizeFailureResult, projectionApplyReadbackRequestFromReceipt, projectionApplyRecoveryDetailsBytes, projectionApplyRecoveryDetailsFit, type ProjectionApplyReceiptV1 } from "../src";
import { projectionApplyCommittedEnvelope } from "../../local-runtime/runtime-daemon/src/projection-service";

const LIMIT = 256 * 1024;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const sha = (c: string) => `sha256:${c.repeat(64)}`;
function receipt(pathBytes = 0, requestId = "request.recovery"): ProjectionApplyReceiptV1 {
  const fixture = JSON.parse(readFileSync(new URL("../fixtures/valid/projection-request.json", import.meta.url), "utf8"));
  return {
    result: { requestId },
    identity: {
      lookupKey: sha("a"), applyId: sha("b"),
      acceptedChange: { changeSetId: "changeset.recovery", eventId: "event.recovery", reasonCodes: ["responsibility-changed"], affectedNodeIds: ["capability.example"] }
    },
    recovery: { targets: ["architecture-docs"], changedPaths: pathBytes ? ["src/" + "界".repeat(pathBytes) + ".ts"] : [], originalExpectedSnapshot: fixture.expected, requestDigest: sha("c") }
  } as unknown as ProjectionApplyReceiptV1;
}

test("complete committed readback uses its dedicated budget and survives strict normalization", () => {
  const value = receipt(6000);
  const result = projectionApplyCommittedEnvelope("projection.run", value, "projection-accepted-change-committed", false);
  expect(result.ok).toBe(false);
  if (result.ok || !result.error) throw new Error("expected committed failure");
  expect(result.error).toMatchObject({ ...ERROR_CATALOG.AC_PROJECTION_APPLY_COMMITTED, reasonCode: "projection-accepted-change-committed" });
  expect(result.error.details!.readbackRequest as unknown).toEqual(projectionApplyReadbackRequestFromReceipt(value) as unknown);
  expect(bytes(result.error.details)).toBeGreaterThan(8192);
  expect(bytes(result.error.details)).toBeLessThanOrEqual(LIMIT);
  expect(failureIssues(result.error)).toEqual([]);
  expect((normalizeFailureResult(result, "cli", "projection.run") as any).error).toEqual(result.error);
});

test("historical oversized committed metadata is bounded, manual-only and keeps both complete IDs", () => {
  for (const written of [undefined, false, true]) {
    const value = receipt(90000);
    const before = JSON.stringify(value);
    const result = projectionApplyCommittedEnvelope("projection.run", value, "projection-apply-request-differs", written);
    expect(result.ok).toBe(false);
    if (result.ok || !result.error) throw new Error("expected committed failure");
    expect(result.error).toMatchObject({ ...ERROR_CATALOG.AC_PROJECTION_APPLY_COMMITTED, reasonCode: "projection-apply-committed-manual-only", details: {
      requestId: value.result.requestId, lookupKey: value.identity.lookupKey, applyId: value.identity.applyId,
      manualRecoveryRequired: true, readbackUnavailable: "details-budget-exceeded", ...(written === undefined ? {} : { written })
    } });
    expect(Object.hasOwn(result.error.details!, "written")).toBe(written !== undefined);
    expect(result.error.details!.readbackRequest).toBeUndefined();
    expect(bytes(result.error.details)).toBeLessThanOrEqual(LIMIT);
    expect(failureIssues(result.error)).toEqual([]);
    expect(JSON.stringify(value)).toBe(before);
  }
});

test("an unavailable oversized request ID is omitted whole and never truncated", () => {
  const result = projectionApplyCommittedEnvelope("apply_update", receipt(0, "r".repeat(LIMIT + 1)), "projection-accepted-change-committed", false);
  expect(result.ok).toBe(false);
  if (result.ok || !result.error) throw new Error("expected committed failure");
  expect(result.error.reasonCode).toBe("projection-apply-committed-manual-only");
  expect(result.error.details).toMatchObject({ requestIdUnavailable: true, lookupKey: sha("a"), applyId: sha("b"), written: false });
  expect(Object.hasOwn(result.error.details!, "requestId")).toBe(false);
  expect(bytes(result.error.details)).toBeLessThanOrEqual(LIMIT);
});

test("dedicated details never evaluate caller accessors", () => {
  let reads = 0;
  const input = { lookupKey: sha("a"), applyId: sha("b"), requestId: "request.recovery" };
  Object.defineProperty(input, "readbackRequest", { enumerable: true, get() { reads++; throw new Error("private body"); } });
  expect(() => knownFailure("AC_PROJECTION_APPLY_COMMITTED", "projection-accepted-change-committed", input)).toThrow();
  expect(reads).toBe(0);
});


test("the dedicated budget includes full UTF-8 expansion and the longest written branch at exact threshold", () => {
  for (const delta of [-1, 0, 1]) {
    const value = receipt();
    value.recovery!.changedPaths = ["src/.ts"];
    const padding = LIMIT + delta - projectionApplyRecoveryDetailsBytes(value);
    value.recovery!.changedPaths = ["src/" + "界".repeat(Math.floor(padding / 3)) + "x".repeat(padding % 3) + ".ts"];
    expect(projectionApplyRecoveryDetailsBytes(value)).toBe(LIMIT + delta);
    expect(projectionApplyRecoveryDetailsFit(value)).toBe(delta <= 0);
    for (const written of [undefined, false, true]) {
      const output = projectionApplyCommittedEnvelope("projection.run", value, "projection-accepted-change-committed", written);
      if (!output.error) throw new Error("expected committed failure");
      expect(output.error.reasonCode).toBe(delta <= 0 ? "projection-accepted-change-committed" : "projection-apply-committed-manual-only");
      expect(bytes(output.error.details)).toBeLessThanOrEqual(LIMIT);
      expect(failureIssues(output.error)).toEqual([]);
    }
  }
});

test("dedicated metadata cannot change the catalog attributes or admit an unknown binding", () => {
  const value = receipt();
  const output = projectionApplyCommittedEnvelope("projection.run", value, "projection-accepted-change-committed", false);
  if (!output.error) throw new Error("expected committed failure");
  const details = output.error.details;
  for (const attributes of [{ action: "inspect-diagnostics" }, { retryable: true }, { severity: "warning" as const }]) {
    expect(() => knownFailure("AC_PROJECTION_APPLY_COMMITTED", "projection-accepted-change-committed", details, attributes)).toThrow();
  }
  expect(() => knownFailure("AC_PROJECTION_APPLY_COMMITTED", "projection-accepted-change-committed", { ...details, receipt: {} })).toThrow();
});
