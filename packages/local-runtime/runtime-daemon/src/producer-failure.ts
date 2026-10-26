import { FailureError, failureEnvelope, toEnvelope, unclassifiedFailure, type ArchContextErrorCode, type FailureStage, type JsonEnvelope } from "@archcontext/contracts";
import { ProjectionPreconditionError } from "@archcontext/core/projection-engine";
import { ProjectionCodeFactsUnavailableError } from "@archcontext/local-runtime/codegraph-adapter";
import { GitVisibleFilesUnavailableError } from "@archcontext/local-runtime/git-adapter";

/** Selected producer metadata must remain own data fields, even on a recognized error class. */
function selectedProducerData<T extends object, K extends keyof T>(error: T, key: K): T[K] {
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  if (!descriptor || !("value" in descriptor)) throw new Error("Invalid selected producer metadata");
  return descriptor.value as T[K];
}

/** Class identity or registered producer metadata classifies a failure; message/stack never do. */
export function selectedProducerFailure(error: unknown, stage: FailureStage): FailureError<ArchContextErrorCode> {
  try {
    if (error instanceof FailureError) {
      const failure = toEnvelope("failure", error, stage).error;
      if (failure.code !== "RPC_TIMEOUT" && failure.code !== "RPC_ABORTED") {
        return new FailureError(failure.code, failure.reasonCode, failure.details, failure);
      }
    }
    if (error instanceof GitVisibleFilesUnavailableError) {
      const details = stage === "docs-anchors" || stage === "flows-check" ? {} : { checks: ["ownership", "anchors"] };
      return new FailureError(selectedProducerData(error, "code"), selectedProducerData(error, "reasonCode"), details);
    }
    if (error instanceof ProjectionPreconditionError) return new FailureError("AC_PRECONDITION_FAILED", selectedProducerData(error, "reasonCode"));
    if (error instanceof ProjectionCodeFactsUnavailableError) return new FailureError(selectedProducerData(error, "code"), selectedProducerData(error, "reasonCode"));
    const failure = unclassifiedFailure(stage, error);
    return new FailureError(failure.code, failure.reasonCode, failure.details, failure);
  } catch { return new FailureError("AC_UNCLASSIFIED_FAILURE", "failure-unclassified", { stage: "failure-metadata" }); }
}
export function selectedProducerFailureEnvelope(requestId: string, error: unknown, stage: FailureStage): JsonEnvelope {
  const failure = selectedProducerFailure(error, stage);
  return failureEnvelope(requestId, failure.failure);
}
