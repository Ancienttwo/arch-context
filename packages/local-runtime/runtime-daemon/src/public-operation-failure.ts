import { FailureError, failureEnvelope, knownFailure, normalizeFailureResult, toEnvelope, type FailureCode, type JsonEnvelope, type StrictFailure } from "@archcontext/contracts";
import { ProjectionPreconditionError } from "@archcontext/core/projection-engine";
import { ProjectionCodeFactsUnavailableError } from "@archcontext/local-runtime/codegraph-adapter";
import { Context7ProviderError } from "@archcontext/local-runtime/context7-adapter";
import { LocalEgressPolicyError } from "@archcontext/local-runtime/egress-admission";
import { GitVisibleFilesUnavailableError } from "@archcontext/local-runtime/git-adapter";
import { ExplorerProjectionCompileError } from "./explorer-projection";
import { ChangeSetRecoveryUnresolvedError } from "./changeset-recovery-error";
import { ProjectionFreshnessChangedPathError } from "./projection-freshness";

const surfaceId = (value: string): string => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value) ? value : "public.operation";
function own(error: object, field: string): unknown {
  const data = Object.getOwnPropertyDescriptor(error, field);
  if (!data || !("value" in data)) throw new Error("Invalid typed producer metadata");
  return data.value;
}
/** Source branches pass registered reasons/facts; diagnostics never select a policy. */
export function publicFailureEnvelope(requestId: string, code: FailureCode, reasonCode: string, details: unknown = {}, attributes: Partial<StrictFailure> = {}): JsonEnvelope {
  try { return failureEnvelope(surfaceId(requestId), knownFailure(code, reasonCode, details, attributes)) as JsonEnvelope; }
  catch { return toEnvelope(surfaceId(requestId), undefined, "failure-metadata") as JsonEnvelope; }
}
export function publicOperationFailure(error: unknown): FailureError<FailureCode> {
  // Explicit C2 stop: keep original identity and complete journal bindings, without interpretation.
  let recovery: ChangeSetRecoveryUnresolvedError | undefined;
  try { if (error instanceof ChangeSetRecoveryUnresolvedError) recovery = error; }
  catch { return new FailureError("AC_UNCLASSIFIED_FAILURE", "failure-unclassified", {stage: "failure-metadata"}); }
  if (recovery) throw recovery;
  let failure;
  try {
    if (error instanceof FailureError) failure = toEnvelope("public.operation", error, "public-operation").error;
    else if (error instanceof ExplorerProjectionCompileError) {
      const reason = own(error, "reason");
      if (reason === "precondition-failed") failure = knownFailure("AC_PRECONDITION_FAILED", "explorer-precondition-failed", own(error, "failureFacts"));
      else if (reason === "invalid-query") failure = knownFailure("AC_SCHEMA_INVALID", "explorer-query-invalid");
      else if (reason === "incompatible-delta") failure = knownFailure("AC_PRECONDITION_FAILED", "projection-manifest-incompatible");
      else failure = toEnvelope("public.operation", undefined, "public-operation").error;
    }
    else if (error instanceof GitVisibleFilesUnavailableError) failure = knownFailure(own(error, "code") as any, own(error, "reasonCode") as string);
    else if (error instanceof ProjectionPreconditionError) failure = knownFailure("AC_PRECONDITION_FAILED", own(error, "reasonCode") as string);
    else if (error instanceof ProjectionCodeFactsUnavailableError) failure = knownFailure(own(error, "code") as any, own(error, "reasonCode") as string);
    else if (error instanceof ProjectionFreshnessChangedPathError) failure = knownFailure(own(error, "code") as any, own(error, "reasonCode") as string);
    else if (error instanceof LocalEgressPolicyError) failure = knownFailure("AC_POLICY_VIOLATION", "egress-policy-denied");
    else if (error instanceof Context7ProviderError) failure = knownFailure("AC_SCHEMA_INVALID", "context7-provider-refused", {kind: own(error, "kind") as any}, {retryable: own(error, "retryable") as boolean});
    else failure = toEnvelope("public.operation", undefined, "public-operation").error;
  } catch { failure = toEnvelope("public.operation", undefined, "failure-metadata").error; }
  return new FailureError(failure.code, failure.reasonCode, failure.details, failure);
}
export function publicOperationErrorEnvelope(requestId: string, error: unknown): JsonEnvelope {
  const failure = publicOperationFailure(error);
  return failureEnvelope(surfaceId(requestId), failure.failure) as JsonEnvelope;
}
export function publicOperationResult<T>(requestId: string, result: T): T | JsonEnvelope {
  return normalizeFailureResult(result, "public-operation", surfaceId(requestId)) as T | JsonEnvelope;
}
