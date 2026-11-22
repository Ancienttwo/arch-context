import {
  PROJECTION_APPLY_READBACK_RESULT_SCHEMA_VERSION,
  PROJECTION_APPLY_RECEIPT_SCHEMA_VERSION,
  PROJECTION_APPLY_RECOVERY_BINDING_SCHEMA_VERSION,
  PROJECTION_APPLY_RECOVERY_INTENT_SCHEMA_VERSION,
  PROJECTION_APPLY_RECOVERY_PROOF_SCHEMA_VERSION,
  PROJECTION_APPLY_RECOVERY_RESULT_SCHEMA_VERSION,
  type Sha256Digest
} from "./projection-constants";
import type { ArchitectureDigestSetV2, ProjectionRequestV1 } from "./projection-types";
import type {
  ProjectionApplyReadbackResultV2,
  ProjectionApplyReceiptV1,
  ProjectionApplyRecoveryBindingV2,
  ProjectionApplyRecoveryIntentV1,
  ProjectionApplyRecoveryProofV2,
  ProjectionApplyRecoveryResultV2
} from "./projection-apply-types";
import {
  architectureRefreshSignalInvariantIssues,
  createProjectionApplyIdentity,
  projectionApplyReadbackRequestInvariantIssues,
  projectionResultInvariantIssues
} from "./projection-apply-validators";
import { SHA256_DIGEST, sortedUniqueIssues } from "./projection-validation-helpers";
import { digestJson, type Json } from "./schema";

export function projectionApplyReceiptInvariantIssues(input: ProjectionApplyReceiptV1): string[] {
  const identity = createProjectionApplyIdentity({
    repositoryId: input.identity.repositoryId,
    workspaceId: input.identity.workspaceId,
    acceptedChange: input.identity.acceptedChange,
    changeSetId: input.identity.semanticCommit.changeSetId,
    idempotencyKey: input.identity.semanticCommit.idempotencyKey,
    files: input.result.files,
    refreshSignals: input.result.refreshSignals
  });
  const issues = projectionResultInvariantIssues(input.result);
  if (digestJson(identity as unknown as Json) !== digestJson(input.identity as unknown as Json)) {
    issues.push("projection apply identity must bind the committed files and original refresh signals");
  }
  if (input.result.status !== "applied") issues.push("projection apply receipt result status must be applied");
  // A partial projection is never accepted, so no receipt ever records one.
  if (input.result.coverage !== undefined) issues.push("projection apply receipt result must cover every target");
  if (digestJson(input.result.applyReceipt as unknown as Json) !== digestJson(input.identity as unknown as Json)) {
    issues.push("projection apply receipt result must carry the same apply identity");
  }
  if (input.recovery) issues.push(...projectionApplyRecoveryBindingInvariantIssues(input.recovery, input));
  return issues;
}

export function projectionApplyRecoveryBindingInvariantIssues(
  binding: ProjectionApplyRecoveryBindingV2,
  receipt?: ProjectionApplyReceiptV1
): string[] {
  const issues = [
    ...sortedUniqueIssues("recovery.targets", binding.targets),
    ...sortedUniqueIssues("recovery.changedPaths", binding.changedPaths)
  ];
  if (binding.schemaVersion !== PROJECTION_APPLY_RECOVERY_BINDING_SCHEMA_VERSION) {
    issues.push("recovery schemaVersion is invalid");
  }
  if (binding.targets.length === 0) issues.push("recovery targets must contain at least one projection target");
  if (binding.requestDigest !== undefined && !SHA256_DIGEST.test(binding.requestDigest)) issues.push("recovery requestDigest must be a SHA-256 digest");
  if (receipt) {
    if (binding.receiptDigest !== receipt.result.receiptDigest) {
      issues.push("recovery receiptDigest must match the committed result receiptDigest");
    }
    if (binding.originalExpectedSnapshot.repositoryId !== receipt.result.inputSnapshot.repositoryId
      || binding.originalExpectedSnapshot.workspaceId !== receipt.result.inputSnapshot.workspaceId
      || binding.originalExpectedSnapshot.headSha !== receipt.result.inputSnapshot.headSha
      || binding.originalExpectedSnapshot.worktreeDigest !== receipt.result.inputSnapshot.worktreeDigest) {
      issues.push("recovery originalExpectedSnapshot must match the committed input snapshot");
    }
    if (binding.rendererVersion !== receipt.result.outputSnapshot.rendererVersion
      || binding.layoutVersion !== receipt.result.outputSnapshot.layoutVersion
      || digestJson(binding.generatedFrom as unknown as Json) !== digestJson(receipt.result.outputSnapshot.generatedFrom as unknown as Json)) {
      issues.push("recovery renderer, layout, and CodeGraph provenance must match the committed output snapshot");
    }
    const expectedDigests = projectionApplyReceiptResultingDigests(receipt);
    if (!expectedDigests || digestJson(binding.expectedResultingDigests as unknown as Json) !== digestJson(expectedDigests as unknown as Json)) {
      issues.push("recovery expectedResultingDigests must match committed refresh signals");
    }
  }
  return issues;
}

export function projectionApplyReadbackResultDigest(input: Omit<ProjectionApplyReadbackResultV2, "readbackDigest">): Sha256Digest {
  return digestJson(input as unknown as Json) as Sha256Digest;
}

export function projectionApplyReadbackResultInvariantIssues(
  input: ProjectionApplyReadbackResultV2,
  request?: ProjectionRequestV1
): string[] {
  const issues = projectionApplyReceiptInvariantIssues(input.receipt);
  const { readbackDigest, ...body } = input;
  if (input.schemaVersion !== PROJECTION_APPLY_READBACK_RESULT_SCHEMA_VERSION) issues.push("readback schemaVersion is invalid");
  if (projectionApplyReadbackResultDigest(body) !== readbackDigest) issues.push("readbackDigest must bind the complete readback result");
  if (!/^[a-zA-Z0-9_.:-]+$/.test(input.requestId)) issues.push("readback requestId is invalid");
  for (const value of [input.requestDigest, input.current.ownedOutputDigest, input.current.fixedPointDigest]) {
    if (!/^sha256:[a-f0-9]{64}$/.test(value)) issues.push("readback digest is invalid");
  }
  const receipt = input.receipt;
  if (receipt.schemaVersion !== PROJECTION_APPLY_RECEIPT_SCHEMA_VERSION) issues.push("readback receipt schemaVersion is invalid");
  const binding = receipt.recovery;
  if (!binding) return [...issues, "committed receipt lacks its original recovery binding"];
  for (const field of ["repositoryId", "workspaceId", "headSha", "worktreeDigest"] as const) {
    if (input.current.snapshot[field] !== binding.originalExpectedSnapshot[field]) issues.push(`readback current ${field} differs from approval`);
  }
  if (input.current.snapshot.generatedFrom.codeGraphStatus !== "ready"
    || input.current.snapshot.rendererVersion !== binding.rendererVersion
    || input.current.snapshot.layoutVersion !== binding.layoutVersion
    || input.current.snapshot.projectionInputDigest !== receipt.result.outputSnapshot.projectionInputDigest
    || input.current.snapshot.codeGraphDigest !== receipt.result.outputSnapshot.codeGraphDigest
    || digestJson(input.current.snapshot.generatedFrom as unknown as Json) !== digestJson(binding.generatedFrom as unknown as Json)
    || digestJson(input.current.resultingDigests as unknown as Json) !== digestJson(binding.expectedResultingDigests as unknown as Json)
    || input.current.ownedOutputDigest !== binding.ownedOutputDigest) {
    issues.push("readback current state differs from committed recovery binding");
  }
  if (input.requestId !== receipt.result.requestId) issues.push("readback requestId differs from committed request");
  if (request) {
    issues.push(...projectionApplyReadbackRequestInvariantIssues(request));
    if (input.requestDigest !== digestJson(request as unknown as Json) || input.requestId !== request.requestId) issues.push("readback request identity mismatch");
    if (digestJson(request.expected as unknown as Json) !== digestJson(binding.originalExpectedSnapshot as unknown as Json)
      || digestJson(request.acceptedChange as unknown as Json) !== digestJson(receipt.identity.acceptedChange as unknown as Json)
      || digestJson(request.targets as unknown as Json) !== digestJson(binding.targets as unknown as Json)
      || digestJson(request.changedPaths as unknown as Json) !== digestJson(binding.changedPaths as unknown as Json)) {
      issues.push("readback request differs from committed approval binding");
    }
  }
  return issues;
}

export function projectionApplyRecoveryIntentInvariantIssues(input: ProjectionApplyRecoveryIntentV1): string[] {
  const issues: string[] = [];
  if (input.schemaVersion !== PROJECTION_APPLY_RECOVERY_INTENT_SCHEMA_VERSION) issues.push("recovery intent schemaVersion is invalid");
  if (!/^[a-zA-Z0-9_.:-]+$/.test(input.requestId)) issues.push("recovery intent requestId must use the stable identifier character set");
  if (input.profile !== "repo-harness/v1") issues.push("recovery intent profile is invalid");
  for (const field of ["lookupKey", "applyId"] as const) {
    if (!/^sha256:[a-f0-9]{64}$/.test(input.receipt[field])) issues.push(`recovery intent receipt.${field} must be a SHA-256 digest`);
  }
  return issues;
}

export function projectionApplyRecoveryProofDigest(input: Omit<ProjectionApplyRecoveryProofV2, "proofDigest" | "deliveryStatus">): Sha256Digest {
  return digestJson(input as unknown as Json) as Sha256Digest;
}

export function projectionApplyRecoveryProofInvariantIssues(input: ProjectionApplyRecoveryProofV2): string[] {
  const issues = [
    ...sortedUniqueIssues("acceptedChange.reasonCodes", input.acceptedChange.reasonCodes),
    ...sortedUniqueIssues("acceptedChange.affectedNodeIds", input.acceptedChange.affectedNodeIds)
  ];
  if (input.schemaVersion !== PROJECTION_APPLY_RECOVERY_PROOF_SCHEMA_VERSION) issues.push("recovery proof schemaVersion is invalid");
  if (!/^[a-zA-Z0-9_.:-]+$/.test(input.requestId)) issues.push("recovery proof requestId must use the stable identifier character set");
  if (input.current.snapshot.generatedFrom.codeGraphStatus !== "ready") issues.push("recovery proof requires a ready current CodeGraph snapshot");
  const { proofDigest: _proofDigest, deliveryStatus: _deliveryStatus, ...payload } = input;
  if (projectionApplyRecoveryProofDigest(payload) !== input.proofDigest) {
    issues.push("recovery proofDigest must bind the semantic proof payload");
  }
  return issues;
}

export function projectionApplyRecoveryResultInvariantIssues(input: ProjectionApplyRecoveryResultV2): string[] {
  const issues = [
    ...projectionApplyRecoveryProofInvariantIssues(input.proof),
    ...input.refreshSignals.flatMap((signal, index) => architectureRefreshSignalInvariantIssues(signal, `refreshSignals[${index}]`)),
    ...sortedUniqueIssues("refreshSignals.signalId", input.refreshSignals.map((signal) => signal.signalId))
  ];
  if (input.schemaVersion !== PROJECTION_APPLY_RECOVERY_RESULT_SCHEMA_VERSION) {
    issues.push("recovery result schemaVersion is invalid");
  }
  if (input.proof.deliveryStatus === "already-delivered" && input.refreshSignals.length > 0) {
    issues.push("already-delivered recovery result cannot repeat refreshSignals");
  }
  for (const [index, signal] of input.refreshSignals.entries()) {
    const prefix = `refreshSignals[${index}]`;
    if (signal.projectionReceiptDigest !== input.proof.receipt.receiptDigest) {
      issues.push(`${prefix}.projectionReceiptDigest must match recovery proof receiptDigest`);
    }
    if (digestJson(signal.acceptedChange as unknown as Json) !== digestJson(input.proof.acceptedChange as unknown as Json)) {
      issues.push(`${prefix}.acceptedChange must match recovery proof approval`);
    }
    if (digestJson(signal.resultingDigests as unknown as Json) !== digestJson(input.proof.expectedResultingDigests as unknown as Json)) {
      issues.push(`${prefix}.resultingDigests must match recovery proof`);
    }
  }
  return issues;
}

/** The durable store uses this before delivery; it can validate immutable bindings but not re-render the current projection. */
export function projectionApplyRecoveryProofReceiptInvariantIssues(
  proof: ProjectionApplyRecoveryProofV2,
  receipt: ProjectionApplyReceiptV1
): string[] {
  const issues = [
    ...projectionApplyRecoveryProofInvariantIssues(proof),
    ...projectionApplyReceiptInvariantIssues(receipt)
  ];
  const binding = receipt.recovery;
  if (!binding) return [...issues, "committed projection receipt does not support semantic recovery"];
  if (proof.receipt.lookupKey !== receipt.identity.lookupKey
    || proof.receipt.applyId !== receipt.identity.applyId
    || proof.receipt.receiptDigest !== receipt.result.receiptDigest) {
    issues.push("recovery proof receipt identity must match the committed receipt");
  }
  if (digestJson(proof.acceptedChange as unknown as Json) !== digestJson(receipt.identity.acceptedChange as unknown as Json)
    || digestJson(proof.expectedResultingDigests as unknown as Json) !== digestJson(binding.expectedResultingDigests as unknown as Json)) {
    issues.push("recovery proof approval binding must match the committed receipt");
  }
  if (digestJson(proof.current.resultingDigests as unknown as Json) !== digestJson(binding.expectedResultingDigests as unknown as Json)
    || proof.current.ownedOutputDigest !== binding.ownedOutputDigest
    || proof.current.snapshot.rendererVersion !== binding.rendererVersion
    || proof.current.snapshot.layoutVersion !== binding.layoutVersion
    || digestJson(proof.current.snapshot.generatedFrom as unknown as Json) !== digestJson(binding.generatedFrom as unknown as Json)) {
    issues.push("recovery proof current state must match the committed recovery binding");
  }
  return issues;
}

function projectionApplyReceiptResultingDigests(receipt: ProjectionApplyReceiptV1): ArchitectureDigestSetV2 | undefined {
  const signals = receipt.result.refreshSignals;
  if (signals.length === 0) return undefined;
  const [first] = signals;
  return signals.every((signal) => digestJson(signal.resultingDigests as unknown as Json) === digestJson(first.resultingDigests as unknown as Json))
    ? first.resultingDigests
    : undefined;
}
