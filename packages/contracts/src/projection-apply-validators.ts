import {
  ARCHITECTURE_MAJOR_CHANGE_REASON_CODES,
  ARCHITECTURE_PROOF_P1_STATUSES,
  ARCHITECTURE_PROOF_P2_STATUSES,
  ARCHITECTURE_SEMANTIC_FACETS,
  PROJECTION_APPLY_IDENTITY_SCHEMA_VERSION,
  PROJECTION_FILE_PREVIEW_MAX_BYTES,
  PROJECTION_HUMAN_ACTION_REASON_CODES,
  PROJECTION_PARTIAL_RESULT_STATUSES,
  PROJECTION_PREVIEW_TOTAL_MAX_BYTES,
  PROJECTION_REQUEST_SCHEMA_VERSION,
  PROJECTION_TARGETS,
  type ProjectionFilePreviewFormat,
  type Sha256Digest
} from "./projection-constants";
import type {
  AcceptedArchitectureChangeReferenceV1,
  ArchitectureCapabilityChangeV1,
  ArchitectureCapabilityProofStatusV1,
  ArchitectureRefreshSignalV2,
  ProjectionApplyIdentityV1,
  ProjectionExpectedSnapshotV1,
  ProjectionFileResultV1,
  ProjectionRequestV1
} from "./projection-types";
import type { ProjectionApplyAbsenceV1, ProjectionApplyReceiptV1, ProjectionResultV3 } from "./projection-apply-types";
import {
  projectionArchitectureDebtIssues,
  projectionCoverageIssues,
  projectionFreshnessIssues,
  projectionPriorCommittedAppliesIssues,
  projectionRequestInvariantIssues,
  projectionResultReceiptDigest,
  projectionTargetChangesIssues
} from "./projection-request-validators";
import { SHA256_DIGEST, sortedUniqueIssues, utf8ByteLength } from "./projection-validation-helpers";
import { digestJson, isRepoRelativePosixPath, type Json } from "./schema";

export function projectionResultInvariantIssues(input: ProjectionResultV3): string[] {
  const issues = [
    ...sortedUniqueIssues("affectedNodeIds", input.affectedNodeIds),
    ...sortedUniqueIssues("files.path", input.files.map((file) => file.path)),
    ...sortedUniqueIssues("refreshSignals.signalId", input.refreshSignals.map((signal) => signal.signalId)),
    ...input.humanActions.flatMap((action, index) => sortedUniqueIssues(`humanActions[${index}].affectedNodeIds`, action.affectedNodeIds)),
    ...input.refreshSignals.flatMap((signal, index) => architectureRefreshSignalInvariantIssues(signal, `refreshSignals[${index}]`))
  ];
  if (!/^[a-zA-Z0-9_.:-]+$/.test(input.requestId)) issues.push("requestId must use the stable identifier character set");
  if (input.inputSnapshot.repositoryId !== input.outputSnapshot.repositoryId) issues.push("outputSnapshot.repositoryId must match inputSnapshot.repositoryId");
  if (input.inputSnapshot.workspaceId !== input.outputSnapshot.workspaceId) issues.push("outputSnapshot.workspaceId must match inputSnapshot.workspaceId");
  if (input.inputSnapshot.baseHeadSha !== input.outputSnapshot.baseHeadSha) issues.push("outputSnapshot.baseHeadSha must match inputSnapshot.baseHeadSha");
  const statusRequiresHumanAction = input.status === "adoption-required" || input.status === "human-action-required";
  if (statusRequiresHumanAction && input.humanActions.length === 0) issues.push(`${input.status} status requires at least one human action`);
  if (!statusRequiresHumanAction && input.humanActions.length > 0) issues.push(`human actions are not allowed when status=${input.status}`);
  if (input.status === "applied-reconcile-required") {
    if (!input.applyReceipt) issues.push("applied-reconcile-required status requires applyReceipt");
    if (input.refreshSignals.length > 0) issues.push("applied-reconcile-required status cannot deliver refreshSignals");
  }
  const partial = (PROJECTION_PARTIAL_RESULT_STATUSES as readonly string[]).includes(input.status);
  if (partial !== (input.coverage !== undefined)) issues.push("coverage must be present exactly when status is planned-partial or applied-partial");
  if (input.coverage !== undefined) issues.push(...projectionCoverageIssues(input.coverage, input.files));
  if (partial) {
    // An incomplete projection is never an acceptance: it records no apply and signals no refresh.
    if (input.applyReceipt !== undefined) issues.push(`${input.status} status never carries applyReceipt`);
    if (input.refreshSignals.length > 0) issues.push(`${input.status} status carries no refreshSignals`);
  }
  const committedApply = input.applyReceipt !== undefined || input.status === "applied" || input.status === "applied-partial" || input.status === "applied-reconcile-required";
  for (const [index, action] of input.humanActions.entries()) {
    const prefix = `humanActions[${index}]`;
    if (!(PROJECTION_HUMAN_ACTION_REASON_CODES as readonly string[]).includes(action.reasonCode)) issues.push(`${prefix}.reasonCode is unsupported`);
    if ((action.reasonCode === "orphaned-document-review") !== (action.path !== undefined)) {
      issues.push(`${prefix}.path must be present exactly when reasonCode=orphaned-document-review`);
    }
    if (action.path !== undefined && !isRepoRelativePosixPath(action.path)) issues.push(`${prefix}.path must be a repository-relative POSIX path`);
  }
  const orphanReviewPaths = input.humanActions.flatMap((action) => action.reasonCode === "orphaned-document-review" && action.path !== undefined ? [action.path] : []);
  issues.push(...sortedUniqueIssues("humanActions[orphaned-document-review].path", orphanReviewPaths));
  if (orphanReviewPaths.some((path) => input.files.some((file) => file.path === path))) {
    issues.push("an orphaned-document-review path must not also be a files[] entry");
  }
  for (const [index, file] of input.files.entries()) {
    const prefix = `files[${index}]`;
    if (file.action === "create" && (file.preimageDigest !== null || file.outputDigest === null)) {
      issues.push(`${prefix} create requires null preimageDigest and non-null outputDigest`);
    }
    if (file.action === "delete" && (file.preimageDigest === null || file.outputDigest !== null)) {
      issues.push(`${prefix} delete requires non-null preimageDigest and null outputDigest`);
    }
    if (file.action === "update" && (file.preimageDigest === null || file.outputDigest === null || file.preimageDigest === file.outputDigest)) {
      issues.push(`${prefix} update requires two different non-null digests`);
    }
    if (file.action === "unchanged" && (file.preimageDigest === null || file.outputDigest === null || file.preimageDigest !== file.outputDigest)) {
      issues.push(`${prefix} unchanged requires equal non-null digests`);
    }
    if (file.preview !== undefined) issues.push(...projectionFilePreviewIssues(file, prefix));
  }
  const previewBytes = input.files.reduce((total, file) => total + (file.preview ? utf8ByteLength(file.preview.content) : 0), 0);
  if (previewBytes > PROJECTION_PREVIEW_TOTAL_MAX_BYTES) {
    issues.push(`files[].preview.content must not exceed ${PROJECTION_PREVIEW_TOTAL_MAX_BYTES} UTF-8 bytes in total`);
  }
  // The result does not carry its request mode; projectionResultRequestModeIssues binds a preview
  // to mode=plan. On the result alone, a committed apply (and so a persisted receipt) never carries one.
  if (input.files.some((file) => file.preview !== undefined) && committedApply) {
    issues.push("files[].preview is only allowed on a plan result, never on a committed apply");
  }
  if (input.priorCommittedApplies) {
    issues.push(...projectionPriorCommittedAppliesIssues(input.priorCommittedApplies, input.requestId));
  }
  if (input.freshness) issues.push(...projectionFreshnessIssues(input.freshness));
  if (input.architectureDebt) {
    issues.push(...projectionArchitectureDebtIssues(input.architectureDebt));
    if (committedApply) {
      issues.push("architectureDebt is only allowed on a check or plan result, never on a committed apply");
    }
  }
  if (input.changes) {
    issues.push(...projectionTargetChangesIssues(input.changes, input.files));
    if (committedApply) issues.push("changes is only allowed on a check or plan result, never on a committed apply");
    // A carried-forward target is blocked, by the same reasons its coverage entry names.
    for (const target of input.coverage?.blockedTargets ?? []) {
      const entry = input.changes.find((candidate) => candidate.targetId === target.targetId);
      if (!entry || entry.classification !== "blocked" || target.reasonCodes.some((code) => !entry.reasonCodes.includes(code))) {
        issues.push(`changes must classify the carried-forward target ${target.path} as blocked with its coverage reason codes`);
      }
    }
  }
  if (input.majorChangeAcceptance !== undefined) {
    if (input.majorChangeAcceptance !== "declined-unprovable-proof") issues.push("majorChangeAcceptance is unsupported");
    if (input.status !== "human-action-required"
      || !input.humanActions.some((action) => action.reasonCode === "unprovable-required-flow")
      || input.humanActions.some((action) => action.reasonCode === "unresolved-major-change")) {
      issues.push("majorChangeAcceptance requires human-action-required with unprovable-required-flow in place of unresolved-major-change");
    }
  }
  if (input.replayed !== undefined) {
    if (input.replayed !== true) issues.push("replayed must be true when present");
    if (!input.applyReceipt || (input.status !== "applied" && input.status !== "applied-reconcile-required")) {
      issues.push("replayed is only allowed on a committed apply result with applyReceipt");
    }
  }
  if ((input.replayed !== undefined) !== (input.written !== undefined)) issues.push("written must be present exactly when replayed is present");
  if (input.written !== undefined && typeof input.written !== "boolean") issues.push("written must be a boolean when present");
  const { receiptDigest, ...receiptPayload } = input;
  if (projectionResultReceiptDigest(receiptPayload) !== receiptDigest) issues.push("receiptDigest must match the canonical projection result payload");
  for (const [index, signal] of input.refreshSignals.entries()) {
    const prefix = `refreshSignals[${index}]`;
    if (signal.projectionReceiptDigest !== receiptDigest) issues.push(`${prefix}.projectionReceiptDigest must match receiptDigest`);
    if (signal.repository.repositoryId !== input.outputSnapshot.repositoryId) issues.push(`${prefix}.repositoryId must match outputSnapshot.repositoryId`);
    if (signal.worktree.workspaceId !== input.outputSnapshot.workspaceId) issues.push(`${prefix}.workspaceId must match outputSnapshot.workspaceId`);
    if (signal.worktree.headSha !== input.outputSnapshot.headSha) issues.push(`${prefix}.headSha must match outputSnapshot.headSha`);
    if (signal.worktree.worktreeDigest !== input.outputSnapshot.worktreeDigest) issues.push(`${prefix}.worktreeDigest must match outputSnapshot.worktreeDigest`);
  }
  return issues;
}

function projectionFilePreviewIssues(file: ProjectionFileResultV1, prefix: string): string[] {
  const preview = file.preview!;
  const issues: string[] = [];
  const expectedFormat: ProjectionFilePreviewFormat | undefined = file.action === "create"
    ? "body"
    : file.action === "update" || file.action === "delete" ? "unified-diff" : undefined;
  if (expectedFormat === undefined) issues.push(`${prefix}.preview is not allowed when action=${file.action}`);
  else if (preview.format !== expectedFormat) issues.push(`${prefix}.preview.format must be ${expectedFormat} when action=${file.action}`);
  if (typeof preview.content !== "string" || typeof preview.truncated !== "boolean"
    || !Number.isSafeInteger(preview.byteLength) || preview.byteLength < 0) {
    issues.push(`${prefix}.preview must carry string content, a boolean truncated flag and a non-negative integer byteLength`);
    return issues;
  }
  const contentBytes = utf8ByteLength(preview.content);
  if (contentBytes > PROJECTION_FILE_PREVIEW_MAX_BYTES) issues.push(`${prefix}.preview.content must not exceed ${PROJECTION_FILE_PREVIEW_MAX_BYTES} UTF-8 bytes`);
  if (preview.truncated ? contentBytes >= preview.byteLength : contentBytes !== preview.byteLength) {
    issues.push(`${prefix}.preview.truncated must be true exactly when content is shorter than byteLength`);
  }
  return issues;
}

export function projectionApplyLookupKey(input: {
  repositoryId: string;
  workspaceId: string;
  acceptedChange: AcceptedArchitectureChangeReferenceV1;
}): Sha256Digest {
  return digestJson({
    schemaVersion: "archcontext.projection-apply-lookup/v1",
    repositoryId: input.repositoryId,
    workspaceId: input.workspaceId,
    acceptedChange: input.acceptedChange
  } as unknown as Json) as Sha256Digest;
}

export function createProjectionApplyIdentity(input: {
  repositoryId: string;
  workspaceId: string;
  acceptedChange: AcceptedArchitectureChangeReferenceV1;
  changeSetId: string;
  idempotencyKey: string;
  files: ProjectionFileResultV1[];
  refreshSignals: ArchitectureRefreshSignalV2[];
}): ProjectionApplyIdentityV1 {
  const lookupKey = projectionApplyLookupKey(input);
  const ownedFilesDigest = digestJson(input.files as unknown as Json) as Sha256Digest;
  const refreshSignals = input.refreshSignals.map(({ projectionReceiptDigest: _receipt, ...signal }) => signal);
  const refreshSignalsDigest = digestJson(refreshSignals as unknown as Json) as Sha256Digest;
  const withoutApplyId = {
    schemaVersion: PROJECTION_APPLY_IDENTITY_SCHEMA_VERSION,
    lookupKey,
    repositoryId: input.repositoryId,
    workspaceId: input.workspaceId,
    acceptedChange: input.acceptedChange,
    semanticCommit: { changeSetId: input.changeSetId, idempotencyKey: input.idempotencyKey },
    ownedFilesDigest,
    refreshSignalsDigest
  };
  return {
    ...withoutApplyId,
    applyId: digestJson(withoutApplyId as unknown as Json) as Sha256Digest
  };
}

/** Readback carries the original accepted apply request, never caller-authored receipt data. */
export function projectionApplyReadbackRequestInvariantIssues(request: ProjectionRequestV1): string[] {
  const issues = projectionRequestInvariantIssues(request);
  const allowed = new Set(["schemaVersion", "requestId", "profile", "mode", "targets", "changedPaths", "expected", "acceptedChange"]);
  if (Object.keys(request).some((key) => !allowed.has(key))) issues.push("readback request contains unsupported fields");
  if (request.mode !== "apply" || !request.acceptedChange) issues.push("readback requires an accepted apply request");
  if (request.schemaVersion !== PROJECTION_REQUEST_SCHEMA_VERSION || request.profile !== "repo-harness/v1") issues.push("readback request protocol is invalid");
  if (typeof request.requestId !== "string"
    || request.targets.some((target) => !(PROJECTION_TARGETS as readonly string[]).includes(target))
    || request.changedPaths.some((path) => typeof path !== "string" || !isRepoRelativePosixPath(path))) issues.push("readback request fields are invalid");
  const expectedKeys = ["repositoryId", "workspaceId", "headSha", "worktreeDigest"];
  if (Object.keys(request.expected).some((key) => !expectedKeys.includes(key))
    || expectedKeys.some((key) => typeof request.expected[key as keyof ProjectionExpectedSnapshotV1] !== "string")
    || !request.expected.repositoryId || !request.expected.workspaceId
    || !/^[a-f0-9]{40}$/.test(request.expected.headSha)
    || !SHA256_DIGEST.test(request.expected.worktreeDigest)) issues.push("readback expected snapshot is invalid");
  if (request.acceptedChange && Object.keys(request.acceptedChange).some((key) => !["changeSetId", "eventId", "reasonCodes", "affectedNodeIds"].includes(key))) {
    issues.push("readback accepted change contains unsupported fields");
  }
  return issues;
}

/**
 * The readback request for a committed apply receipt, built only from what the receipt recorded:
 * its requestId, the recovery binding's targets, changedPaths and original expected snapshot, and
 * the identity's accepted change. Readback always takes `mode: "apply"`, also for an adopt receipt,
 * because the binding never records the mode. A caller that held only `acceptObservedMajorChange`
 * never had the accepted change, so `AC_PROJECTION_APPLY_COMMITTED` hands it this request (#278).
 * Undefined for a receipt without a recovery binding, which readback cannot prove.
 */
export function projectionApplyReadbackRequestFromReceipt(receipt: ProjectionApplyReceiptV1): ProjectionRequestV1 | undefined {
  const binding = receipt.recovery;
  if (!binding) return undefined;
  return {
    schemaVersion: PROJECTION_REQUEST_SCHEMA_VERSION,
    requestId: receipt.result.requestId,
    profile: "repo-harness/v1",
    mode: "apply",
    targets: [...binding.targets],
    changedPaths: [...binding.changedPaths],
    expected: { ...binding.originalExpectedSnapshot },
    acceptedChange: {
      ...receipt.identity.acceptedChange,
      reasonCodes: [...receipt.identity.acceptedChange.reasonCodes],
      affectedNodeIds: [...receipt.identity.acceptedChange.affectedNodeIds]
    }
  };
}

export function projectionApplyAbsenceInvariantIssues(input: ProjectionApplyAbsenceV1, request: ProjectionRequestV1): string[] {
  const issues = projectionApplyReadbackRequestInvariantIssues(request);
  if (input.schemaVersion !== "archcontext.projection-apply-absence/v1") issues.push("absence schemaVersion is invalid");
  if (Object.keys(input).some((key) => !["schemaVersion", "requestId", "requestDigest", "lookupKey", "current", "absenceDigest"].includes(key))) issues.push("absence contains unsupported fields");
  const { absenceDigest, ...body } = input;
  if (absenceDigest !== digestJson(body as unknown as Json)) issues.push("absenceDigest must bind the complete absence result");
  if (input.requestId !== request.requestId || input.requestDigest !== digestJson(request as unknown as Json)) issues.push("absence request identity mismatch");
  if (digestJson(input.current as unknown as Json) !== digestJson(request.expected as unknown as Json)) issues.push("absence current snapshot differs from request");
  if (!request.acceptedChange || input.lookupKey !== projectionApplyLookupKey({
    repositoryId: request.expected.repositoryId, workspaceId: request.expected.workspaceId, acceptedChange: request.acceptedChange
  })) issues.push("absence lookup identity mismatch");
  return issues;
}

export function architectureRefreshSignalInvariantIssues(input: ArchitectureRefreshSignalV2, prefix = "signal"): string[] {
  const issues = [
    ...sortedUniqueIssues(`${prefix}.reasonCodes`, input.reasonCodes),
    ...sortedUniqueIssues(`${prefix}.affectedNodeIds`, input.affectedNodeIds),
    ...sortedUniqueIssues(`${prefix}.refreshTargets`, input.refreshTargets)
  ];
  if (input.acceptedChange) {
    issues.push(
      ...sortedUniqueIssues(`${prefix}.acceptedChange.reasonCodes`, input.acceptedChange.reasonCodes),
      ...sortedUniqueIssues(`${prefix}.acceptedChange.affectedNodeIds`, input.acceptedChange.affectedNodeIds)
    );
    if (input.acceptedChange.changeSetId.trim() === "") issues.push(`${prefix}.acceptedChange.changeSetId must not be empty`);
    if (input.acceptedChange.eventId.trim() === "") issues.push(`${prefix}.acceptedChange.eventId must not be empty`);
    if (input.acceptedChange.reasonCodes.join("\u0000") !== input.reasonCodes.join("\u0000")) {
      issues.push(`${prefix}.acceptedChange.reasonCodes must match signal reasonCodes`);
    }
    if (input.acceptedChange.affectedNodeIds.join("\u0000") !== input.affectedNodeIds.join("\u0000")) {
      issues.push(`${prefix}.acceptedChange.affectedNodeIds must match signal affectedNodeIds`);
    }
  }
  if (input.capabilities !== undefined) issues.push(...architectureCapabilityChangesIssues(input.capabilities, `${prefix}.capabilities`));
  if (input.reasonCodes.length === 0) issues.push(`${prefix}.reasonCodes must contain at least one reason`);
  if (input.affectedNodeIds.length === 0) issues.push(`${prefix}.affectedNodeIds must contain at least one node`);
  if (input.refreshTargets.length === 0) issues.push(`${prefix}.refreshTargets must contain at least one target`);
  if (input.cause === "unresolved-major-candidate" && input.mode !== "human-action-required") {
    issues.push(`${prefix}.unresolved-major-candidate requires human-action-required mode`);
  }
  if (input.cause !== "unresolved-major-candidate" && input.mode !== "refresh-required") {
    issues.push(`${prefix}.${input.cause} requires refresh-required mode`);
  }
  if (input.mode === "refresh-required" && !input.acceptedChange) {
    issues.push(`${prefix}.refresh-required requires acceptedChange`);
  }
  if (input.mode === "human-action-required" && input.acceptedChange) {
    issues.push(`${prefix}.human-action-required forbids acceptedChange`);
  }
  return issues;
}

/** Shape and canonical order of a per-capability major-change breakdown (#264). */
export function architectureCapabilityChangesIssues(input: readonly ArchitectureCapabilityChangeV1[], prefix = "capabilities"): string[] {
  const issues = sortedUniqueIssues(`${prefix}.capabilityId`, input.map((entry) => entry.capabilityId));
  if (input.length === 0) issues.push(`${prefix} must name at least one capability`);
  const reasons = new Set<string>(ARCHITECTURE_MAJOR_CHANGE_REASON_CODES);
  const facets = new Set<string>(ARCHITECTURE_SEMANTIC_FACETS);
  for (const [index, entry] of input.entries()) {
    const entryPrefix = `${prefix}[${index}]`;
    if (typeof entry.capabilityId !== "string" || entry.capabilityId.trim() === "") issues.push(`${entryPrefix}.capabilityId must not be empty`);
    issues.push(
      ...sortedUniqueIssues(`${entryPrefix}.reasonCodes`, entry.reasonCodes),
      ...sortedUniqueIssues(`${entryPrefix}.changedFacets`, entry.changedFacets)
    );
    const reason = entry.reasonCodes.find((code) => !reasons.has(code));
    if (reason !== undefined) issues.push(`${entryPrefix}.reasonCodes contains unsupported reason: ${reason}`);
    const facet = entry.changedFacets.find((name) => !facets.has(name));
    if (facet !== undefined) issues.push(`${entryPrefix}.changedFacets contains unsupported facet: ${facet}`);
    for (const field of ["proofStatusBefore", "proofStatusAfter"] as const) {
      const status = entry[field];
      if (status !== null && !isArchitectureCapabilityProofStatus(status)) issues.push(`${entryPrefix}.${field} must be null or a P1/P2 proof status`);
    }
    if (entry.proofStatusBefore === null && entry.proofStatusAfter === null) issues.push(`${entryPrefix} must exist before or after the change`);
    if ((entry.proofStatusBefore === null || entry.proofStatusAfter === null) && entry.changedFacets.length > 0) {
      issues.push(`${entryPrefix}.changedFacets must be empty for a capability present on one side only`);
    }
  }
  return issues;
}

export function isArchitectureCapabilityProofStatus(value: unknown): value is ArchitectureCapabilityProofStatusV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 2
    && (ARCHITECTURE_PROOF_P1_STATUSES as readonly unknown[]).includes(record.p1)
    && (ARCHITECTURE_PROOF_P2_STATUSES as readonly unknown[]).includes(record.p2);
}
