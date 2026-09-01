import { digestJson, type Json } from "./schema";

export const PROJECTION_REQUEST_SCHEMA_VERSION = "archcontext.projection-request/v1" as const;
export const PROJECTION_RESULT_SCHEMA_VERSION = "archcontext.projection-result/v2" as const;
export const PROJECTION_APPLY_IDENTITY_SCHEMA_VERSION = "archcontext.projection-apply-identity/v1" as const;
export const PROJECTION_APPLY_RECEIPT_SCHEMA_VERSION = "archcontext.projection-apply-receipt/v1" as const;
export const PROJECTION_APPLY_RECOVERY_BINDING_SCHEMA_VERSION = "archcontext.projection-apply-recovery-binding/v1" as const;
export const PROJECTION_APPLY_RECOVERY_INTENT_SCHEMA_VERSION = "archcontext.projection-apply-recovery-intent/v1" as const;
export const PROJECTION_APPLY_RECOVERY_PROOF_SCHEMA_VERSION = "archcontext.projection-apply-recovery-proof/v1" as const;
export const PROJECTION_APPLY_RECOVERY_RESULT_SCHEMA_VERSION = "archcontext.projection-apply-recovery-result/v1" as const;
export const ARCHITECTURE_REFRESH_SIGNAL_SCHEMA_VERSION = "archcontext.architecture-refresh-signal/v1" as const;
export const ARCHCTX_CAPABILITIES_SCHEMA_VERSION = "archcontext.capabilities/v1" as const;
export const ARCHITECTURE_DOCS_RENDERER_VERSION = "archcontext.docs-renderer/v4" as const;
export const AGENT_CONTEXT_RENDERER_VERSION = "archcontext.agent-context-renderer/v1" as const;

export const PROJECTION_MODES = ["check", "plan", "apply", "adopt"] as const;
export const PROJECTION_TARGETS = ["agent-context", "architecture-docs"] as const;
export const PROJECTION_RESULT_STATUSES = [
  "adoption-required",
  "applied",
  "applied-reconcile-required",
  "blocked",
  "human-action-required",
  "noop",
  "permanent-failure",
  "planned",
  "retryable-failure"
] as const;
export const PROJECTION_HUMAN_ACTION_REASON_CODES = [
  "adoption-required",
  "manual-region-conflict",
  "target-collision",
  "unprovable-required-flow",
  "unresolved-major-change"
] as const;
export const ARCHITECTURE_MAJOR_CHANGE_REASON_CODES = [
  "constraint-changed",
  "entrypoint-changed",
  "interface-changed",
  "lifecycle-changed",
  "node-added",
  "node-moved",
  "node-removed",
  "node-renamed",
  "ownership-changed",
  "relation-changed",
  "responsibility-changed",
  "risk-boundary-changed",
  "verified-flow-proof-changed"
] as const;
export const ARCHITECTURE_REFRESH_TARGETS = [
  "architecture-contract-context",
  "architecture-readiness",
  "architecture-request-index",
  "capability-context",
  "capability-index"
] as const;
export const ARCHCTX_FEATURES = [
  "architecture-docs-renderer-v2",
  "architecture-refresh-signal-v1",
  "projection-apply-receipt-v1",
  "projection-apply-recovery-v1",
  "projection-protocol-v2"
] as const;

export type ProjectionMode = (typeof PROJECTION_MODES)[number];
export type ProjectionTarget = (typeof PROJECTION_TARGETS)[number];
export type ProjectionResultStatus = (typeof PROJECTION_RESULT_STATUSES)[number];
export type ProjectionHumanActionReasonCode = (typeof PROJECTION_HUMAN_ACTION_REASON_CODES)[number];
export type ArchitectureMajorChangeReasonCode = (typeof ARCHITECTURE_MAJOR_CHANGE_REASON_CODES)[number];
export type ArchitectureRefreshTarget = (typeof ARCHITECTURE_REFRESH_TARGETS)[number];
export type ArchctxFeature = (typeof ARCHCTX_FEATURES)[number];
export type Sha256Digest = `sha256:${string}`;

export interface ProjectionExpectedSnapshotV1 {
  repositoryId: string;
  workspaceId: string;
  headSha: string;
  worktreeDigest: Sha256Digest;
}

export interface ProjectionRequestV1 {
  schemaVersion: typeof PROJECTION_REQUEST_SCHEMA_VERSION;
  requestId: string;
  profile: "repo-harness/v1";
  mode: ProjectionMode;
  targets: ProjectionTarget[];
  changedPaths: string[];
  expected: ProjectionExpectedSnapshotV1;
  adoptionPlanId?: string;
  acceptedChange?: AcceptedArchitectureChangeReferenceV1;
}

export interface ProjectionSnapshotV1 extends ProjectionExpectedSnapshotV1 {
  baseHeadSha: string;
  sourceTreeDigest: Sha256Digest;
  modelDigest: Sha256Digest;
  codeGraphDigest: Sha256Digest;
  indexedWorktreeDigest: Sha256Digest | null;
  projectionInputDigest: Sha256Digest;
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  layoutVersion: "archcontext.docs-layout/v1";
  generatedFrom: {
    codeGraphPackage: "@colbymchenry/codegraph";
    codeGraphVersion: "1.5.0";
    codeGraphBinaryDigest: Sha256Digest;
    codeGraphStatus: "ready" | "unavailable";
  };
}

export interface ProjectionFileResultV1 {
  path: string;
  action: "create" | "delete" | "unchanged" | "update";
  preimageDigest: Sha256Digest | null;
  outputDigest: Sha256Digest | null;
}

export interface ProjectionHumanActionV1 {
  reasonCode: ProjectionHumanActionReasonCode;
  affectedNodeIds: string[];
  requestPayloadDigest: Sha256Digest;
}

export interface ProjectionApplyIdentityV1 {
  schemaVersion: typeof PROJECTION_APPLY_IDENTITY_SCHEMA_VERSION;
  applyId: Sha256Digest;
  lookupKey: Sha256Digest;
  repositoryId: string;
  workspaceId: string;
  acceptedChange: AcceptedArchitectureChangeReferenceV1;
  semanticCommit: {
    changeSetId: string;
    idempotencyKey: string;
  };
  ownedFilesDigest: Sha256Digest;
  refreshSignalsDigest: Sha256Digest;
}

export interface ArchitectureDigestSetV1 {
  modelDigest: Sha256Digest;
  sourceTreeDigest: Sha256Digest;
  flowProofDigest: Sha256Digest;
  projectionDigest: Sha256Digest;
}

export interface AcceptedArchitectureChangeReferenceV1 {
  changeSetId: string;
  eventId: string;
  reasonCodes: ArchitectureMajorChangeReasonCode[];
  affectedNodeIds: string[];
}

export interface ArchitectureRefreshSignalV1 {
  schemaVersion: typeof ARCHITECTURE_REFRESH_SIGNAL_SCHEMA_VERSION;
  signalId: Sha256Digest;
  idempotencyKey: Sha256Digest;
  mode: "human-action-required" | "refresh-required";
  repository: { repositoryId: string };
  worktree: { workspaceId: string; headSha: string; worktreeDigest: Sha256Digest };
  cause: "accepted-semantic-delta" | "unresolved-major-candidate" | "verified-flow-proof-delta";
  acceptedChange?: AcceptedArchitectureChangeReferenceV1;
  reasonCodes: ArchitectureMajorChangeReasonCode[];
  affectedNodeIds: string[];
  refreshTargets: ArchitectureRefreshTarget[];
  baseDigests: ArchitectureDigestSetV1;
  resultingDigests: ArchitectureDigestSetV1;
  projectionReceiptDigest: Sha256Digest;
}

export interface ProjectionResultV2 {
  schemaVersion: typeof PROJECTION_RESULT_SCHEMA_VERSION;
  requestId: string;
  status: ProjectionResultStatus;
  inputSnapshot: ProjectionSnapshotV1;
  outputSnapshot: ProjectionSnapshotV1;
  affectedNodeIds: string[];
  files: ProjectionFileResultV1[];
  humanActions: ProjectionHumanActionV1[];
  refreshSignals: ArchitectureRefreshSignalV1[];
  applyReceipt?: ProjectionApplyIdentityV1;
  receiptDigest: Sha256Digest;
}

export interface ProjectionApplyReceiptV1 {
  schemaVersion: typeof PROJECTION_APPLY_RECEIPT_SCHEMA_VERSION;
  identity: ProjectionApplyIdentityV1;
  result: ProjectionResultV2;
  /**
   * Present only on receipts written after recovery protocol v1 shipped. Receipts created by
   * v0.4.7 remain inspectable, but cannot be recovered because they never recorded this exact
   * approval binding.
   */
  recovery?: ProjectionApplyRecoveryBindingV1;
}

/** Immutable approval metadata recorded with a new committed apply receipt, never inferred later. */
export interface ProjectionApplyRecoveryBindingV1 {
  schemaVersion: typeof PROJECTION_APPLY_RECOVERY_BINDING_SCHEMA_VERSION;
  targets: ProjectionTarget[];
  changedPaths: string[];
  originalExpectedSnapshot: ProjectionExpectedSnapshotV1;
  expectedResultingDigests: ArchitectureDigestSetV1;
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  layoutVersion: "archcontext.docs-layout/v1";
  generatedFrom: ProjectionSnapshotV1["generatedFrom"];
  ownedOutputDigest: Sha256Digest;
  receiptDigest: Sha256Digest;
}

/**
 * The only client-supplied recovery input. The daemon resolves every semantic field from the
 * committed receipt and repository authority while it holds the writer boundary.
 */
export interface ProjectionApplyRecoveryIntentV1 {
  schemaVersion: typeof PROJECTION_APPLY_RECOVERY_INTENT_SCHEMA_VERSION;
  requestId: string;
  profile: "repo-harness/v1";
  receipt: {
    lookupKey: Sha256Digest;
    applyId: Sha256Digest;
  };
}

export type ProjectionApplyRecoveryDeliveryStatus = "delivered" | "already-delivered";

/**
 * A semantic proof created only after the CLI has rebuilt the current projection fixed point.
 * `proofDigest` intentionally excludes deliveryStatus so an idempotent repeat can change only
 * that explicitly declared field.
 */
export interface ProjectionApplyRecoveryProofV1 {
  schemaVersion: typeof PROJECTION_APPLY_RECOVERY_PROOF_SCHEMA_VERSION;
  requestId: string;
  requestDigest: Sha256Digest;
  proofDigest: Sha256Digest;
  deliveryStatus: ProjectionApplyRecoveryDeliveryStatus;
  receipt: {
    lookupKey: Sha256Digest;
    applyId: Sha256Digest;
    receiptDigest: Sha256Digest;
  };
  acceptedChange: AcceptedArchitectureChangeReferenceV1;
  expectedResultingDigests: ArchitectureDigestSetV1;
  current: {
    snapshot: ProjectionSnapshotV1;
    resultingDigests: ArchitectureDigestSetV1;
    ownedOutputDigest: Sha256Digest;
    fixedPointDigest: Sha256Digest;
  };
}

export interface ProjectionApplyRecoveryResultV1 {
  schemaVersion: typeof PROJECTION_APPLY_RECOVERY_RESULT_SCHEMA_VERSION;
  proof: ProjectionApplyRecoveryProofV1;
  refreshSignals: ArchitectureRefreshSignalV1[];
}

export interface ArchctxCapabilitiesV1 {
  schemaVersion: typeof ARCHCTX_CAPABILITIES_SCHEMA_VERSION;
  package: {
    name: "archctx";
    version: string;
  };
  protocols: {
    projectionRequest: typeof PROJECTION_REQUEST_SCHEMA_VERSION;
    projectionResult: typeof PROJECTION_RESULT_SCHEMA_VERSION;
    architectureRefreshSignal: typeof ARCHITECTURE_REFRESH_SIGNAL_SCHEMA_VERSION;
  };
  renderers: {
    architectureDocs: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
    agentContext: typeof AGENT_CONTEXT_RENDERER_VERSION;
  };
  features: ArchctxFeature[];
}

export function archctxCapabilities(packageVersion: string): ArchctxCapabilitiesV1 {
  return {
    schemaVersion: ARCHCTX_CAPABILITIES_SCHEMA_VERSION,
    package: { name: "archctx", version: packageVersion },
    protocols: {
      projectionRequest: PROJECTION_REQUEST_SCHEMA_VERSION,
      projectionResult: PROJECTION_RESULT_SCHEMA_VERSION,
      architectureRefreshSignal: ARCHITECTURE_REFRESH_SIGNAL_SCHEMA_VERSION
    },
    renderers: {
      architectureDocs: ARCHITECTURE_DOCS_RENDERER_VERSION,
      agentContext: AGENT_CONTEXT_RENDERER_VERSION
    },
    features: [...ARCHCTX_FEATURES]
  };
}

export function projectionRequestInvariantIssues(input: ProjectionRequestV1): string[] {
  const issues = [
    ...sortedUniqueIssues("targets", input.targets),
    ...sortedUniqueIssues("changedPaths", input.changedPaths),
    ...(input.acceptedChange
      ? [
          ...sortedUniqueIssues("acceptedChange.reasonCodes", input.acceptedChange.reasonCodes),
          ...sortedUniqueIssues("acceptedChange.affectedNodeIds", input.acceptedChange.affectedNodeIds)
        ]
      : [])
  ];
  if (input.targets.length === 0) issues.push("targets must contain at least one projection target");
  if (!/^[a-zA-Z0-9_.:-]+$/.test(input.requestId)) issues.push("requestId must use the stable identifier character set");
  if (input.mode === "adopt" && !input.adoptionPlanId) issues.push("adoptionPlanId is required when mode=adopt");
  if (input.mode !== "adopt" && input.adoptionPlanId !== undefined) issues.push("adoptionPlanId is only allowed when mode=adopt");
  if (input.acceptedChange) {
    if (input.acceptedChange.changeSetId.trim() === "") issues.push("acceptedChange.changeSetId must not be empty");
    if (input.acceptedChange.eventId.trim() === "") issues.push("acceptedChange.eventId must not be empty");
    if (input.acceptedChange.reasonCodes.length === 0) issues.push("acceptedChange.reasonCodes must contain at least one reason");
    if (input.acceptedChange.affectedNodeIds.length === 0) issues.push("acceptedChange.affectedNodeIds must contain at least one node");
    const allowedReasons = new Set<string>(ARCHITECTURE_MAJOR_CHANGE_REASON_CODES);
    for (const reason of input.acceptedChange.reasonCodes) {
      if (!allowedReasons.has(reason)) issues.push(`acceptedChange.reasonCodes contains unsupported reason: ${reason}`);
    }
    for (const nodeId of input.acceptedChange.affectedNodeIds) {
      if (nodeId.trim() === "") issues.push("acceptedChange.affectedNodeIds must not contain empty node ids");
    }
  }
  return issues;
}

export function projectionResultInvariantIssues(input: ProjectionResultV2): string[] {
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
  }
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

/**
 * Computes the accepted projection receipt. Signal back-references are omitted from the
 * receipt payload to avoid a circular hash; every signal must then bind that receipt via
 * projectionReceiptDigest, which projectionResultInvariantIssues verifies.
 */
export function projectionResultReceiptDigest(input: Omit<ProjectionResultV2, "receiptDigest">): Sha256Digest {
  const refreshSignals = input.refreshSignals.map(({ projectionReceiptDigest: _projectionReceiptDigest, ...signal }) => signal);
  return digestJson({ ...input, refreshSignals } as unknown as Json) as Sha256Digest;
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
  refreshSignals: ArchitectureRefreshSignalV1[];
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
  if (digestJson(input.result.applyReceipt as unknown as Json) !== digestJson(input.identity as unknown as Json)) {
    issues.push("projection apply receipt result must carry the same apply identity");
  }
  if (input.recovery) issues.push(...projectionApplyRecoveryBindingInvariantIssues(input.recovery, input));
  return issues;
}

export function projectionApplyRecoveryBindingInvariantIssues(
  binding: ProjectionApplyRecoveryBindingV1,
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

export function projectionApplyRecoveryProofDigest(input: Omit<ProjectionApplyRecoveryProofV1, "proofDigest" | "deliveryStatus">): Sha256Digest {
  return digestJson(input as unknown as Json) as Sha256Digest;
}

export function projectionApplyRecoveryProofInvariantIssues(input: ProjectionApplyRecoveryProofV1): string[] {
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

export function projectionApplyRecoveryResultInvariantIssues(input: ProjectionApplyRecoveryResultV1): string[] {
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
  proof: ProjectionApplyRecoveryProofV1,
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

function projectionApplyReceiptResultingDigests(receipt: ProjectionApplyReceiptV1): ArchitectureDigestSetV1 | undefined {
  const signals = receipt.result.refreshSignals;
  if (signals.length === 0) return undefined;
  const [first] = signals;
  return signals.every((signal) => digestJson(signal.resultingDigests as unknown as Json) === digestJson(first.resultingDigests as unknown as Json))
    ? first.resultingDigests
    : undefined;
}

export function architectureRefreshSignalInvariantIssues(input: ArchitectureRefreshSignalV1, prefix = "signal"): string[] {
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

function sortedUniqueIssues(label: string, values: readonly string[]): string[] {
  const expected = [...new Set(values)].sort();
  return expected.length === values.length && expected.every((value, index) => value === values[index])
    ? []
    : [`${label} must be sorted and unique`];
}
