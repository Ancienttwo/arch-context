import { projectionApplyReadbackRequestFromReceipt, projectionApplyReadbackRequestInvariantIssues, type ProjectionApplyReceiptV1, type ProjectionRequestV1 } from "./projection";
import type { Json } from "./schema";

/** Dedicated recovery payload budget; unrelated failure summaries retain their 8 KiB limit. */
export const PROJECTION_RECOVERY_DETAILS_LIMIT_BYTES = 256 * 1024;
export const PROJECTION_COMMITTED_REASONS = ["projection-accepted-change-committed", "projection-apply-request-differs", "projection-apply-request-digest-unrecorded"] as const;
export type ProjectionCommittedReason = typeof PROJECTION_COMMITTED_REASONS[number];
export const PROJECTION_COMMITTED_MANUAL_ONLY = "projection-apply-committed-manual-only" as const;
const utf8 = (value: string) => new TextEncoder().encode(value).length;
const digest = (value: unknown) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);

/** Copy only own JSON data, never accessors/toJSON/iterators. Count exact compact UTF-8 bytes. */
function jsonDataCopy(input: unknown, maximum: number): Json {
  let measured = 0;
  const add = (count: number) => { measured += count; if (measured > maximum) throw new Error("Projection recovery details exceed byte budget"); };
  const copy = (value: unknown, depth: number): Json => {
    if (depth > 16) throw new Error("Projection recovery data exceeds depth budget");
    if (value === null || typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
      add(utf8(JSON.stringify(value))); return value;
    }
    if (typeof value !== "object" || value === null) throw new Error("Projection recovery data must be JSON");
    const keys = Reflect.ownKeys(value);
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== Object.prototype && prototype !== null) throw new Error("Projection recovery data must be plain");
    const get = (key: string): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error("Projection recovery data must use enumerable own data");
      return descriptor.value;
    };
    add(2);
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
      if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) throw new Error("Projection recovery list must be dense data");
      const result: Json[] = [];
      for (let i = 0; i < length; i++) { if (i) add(1); result.push(copy(get(String(i)), depth + 1)); }
      return result;
    }
    const entries: [string, Json][] = [];
    for (const key of keys) {
      if (typeof key !== "string") throw new Error("Projection recovery data cannot use symbols");
      if (entries.length) add(1);
      add(utf8(JSON.stringify(key)) + 1);
      entries.push([key, copy(get(key), depth + 1)]);
    }
    return Object.fromEntries(entries);
  };
  return copy(input, 0);
}

/** Freeze caller-owned receipt data before the writer awaits again. No mutation of caller state. */
export function projectionApplyReceiptDataSnapshot(receipt: ProjectionApplyReceiptV1): ProjectionApplyReceiptV1 {
  return jsonDataCopy(receipt, Number.MAX_SAFE_INTEGER) as unknown as ProjectionApplyReceiptV1;
}

/** The complete recovery metadata, including the original unabridged readback request. */
export function projectionApplyCommittedDetails(receipt: ProjectionApplyReceiptV1, written?: boolean): { [key: string]: Json } {
  const readback = projectionApplyReadbackRequestFromReceipt(receipt);
  return {
    requestId: receipt.result.requestId, lookupKey: receipt.identity.lookupKey, applyId: receipt.identity.applyId,
    ...(receipt.recovery?.requestDigest === undefined ? {} : { requestDigest: receipt.recovery.requestDigest }),
    ...(readback === undefined ? {} : { readbackRequest: readback as unknown as Json }),
    ...(written === undefined ? {} : { written })
  };
}

/** false is the longest written branch; every later committed failure must fit in full. */
export function projectionApplyRecoveryDetailsBytes(receipt: ProjectionApplyReceiptV1): number {
  return utf8(JSON.stringify(projectionApplyCommittedDetails(receipt, false)));
}
export function projectionApplyRecoveryDetailsFit(receipt: ProjectionApplyReceiptV1): boolean {
  return projectionApplyRecoveryDetailsBytes(receipt) <= PROJECTION_RECOVERY_DETAILS_LIMIT_BYTES;
}

/** Historical receipts stay stored; this failure supplies complete IDs for explicit maintenance. */
export function projectionApplyManualOnlyDetails(receipt: ProjectionApplyReceiptV1, written?: boolean): { [key: string]: Json } {
  const result: { [key: string]: Json } = {
    lookupKey: receipt.identity.lookupKey, applyId: receipt.identity.applyId,
    manualRecoveryRequired: true, readbackUnavailable: "details-budget-exceeded",
    ...(written === undefined ? {} : { written })
  };
  const withRequest = { ...result, requestId: receipt.result.requestId };
  return utf8(JSON.stringify(withRequest)) <= PROJECTION_RECOVERY_DETAILS_LIMIT_BYTES
    ? withRequest : { ...result, requestIdUnavailable: true };
}

/** A closed exception to the summary policy, selected only by the committed code/reason pair. */
export function projectionRecoveryDetailsSnapshot(reason: string, input: unknown): { [key: string]: Json } {
  const value = jsonDataCopy(input, PROJECTION_RECOVERY_DETAILS_LIMIT_BYTES);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Recovery details must be an object");
  const manual = reason === PROJECTION_COMMITTED_MANUAL_ONLY;
  if (!manual && !(PROJECTION_COMMITTED_REASONS as readonly string[]).includes(reason)) throw new Error("Unknown recovery reason");
  const allowed = manual
    ? ["requestId", "requestIdUnavailable", "lookupKey", "applyId", "written", "manualRecoveryRequired", "readbackUnavailable"]
    : ["requestId", "lookupKey", "applyId", "requestDigest", "readbackRequest", "written"];
  if (Object.keys(value).some(key => !allowed.includes(key)) || !digest(value.lookupKey) || !digest(value.applyId)) throw new Error("Recovery details require complete identities");
  const requestPresent = typeof value.requestId === "string" && /^[a-zA-Z0-9_.:-]+$/.test(value.requestId);
  if (manual) {
    if (value.manualRecoveryRequired !== true || value.readbackUnavailable !== "details-budget-exceeded"
      || (requestPresent ? Object.hasOwn(value, "requestIdUnavailable") : value.requestIdUnavailable !== true || Object.hasOwn(value, "requestId"))) throw new Error("Manual-only recovery must be explicit");
  } else {
    if (!requestPresent) throw new Error("Recovery details require the original requestId");
    if (Object.hasOwn(value, "requestDigest") && !digest(value.requestDigest)) throw new Error("Recovery request digest is invalid");
    if (Object.hasOwn(value, "readbackRequest")) {
      const request = value.readbackRequest as unknown as ProjectionRequestV1;
      if (projectionApplyReadbackRequestInvariantIssues(request).length || request.requestId !== value.requestId) throw new Error("Recovery readback request is invalid");
    }
  }
  if (Object.hasOwn(value, "written") && typeof value.written !== "boolean") throw new Error("Recovery written flag must be boolean");
  return value;
}
