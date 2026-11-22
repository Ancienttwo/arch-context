import type {
  AGENT_CONTEXT_RENDERER_VERSION,
  ARCHCTX_CAPABILITIES_SCHEMA_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  ARCHITECTURE_REFRESH_SIGNAL_SCHEMA_VERSION,
  PROJECTION_APPLY_READBACK_RESULT_SCHEMA_VERSION,
  PROJECTION_APPLY_RECEIPT_SCHEMA_VERSION,
  PROJECTION_APPLY_RECOVERY_BINDING_SCHEMA_VERSION,
  PROJECTION_APPLY_RECOVERY_INTENT_SCHEMA_VERSION,
  PROJECTION_APPLY_RECOVERY_PROOF_SCHEMA_VERSION,
  PROJECTION_APPLY_RECOVERY_RESULT_SCHEMA_VERSION,
  PROJECTION_REQUEST_SCHEMA_VERSION,
  PROJECTION_RESULT_SCHEMA_VERSION,
  ArchctxFeature,
  ProjectionResultStatus,
  ProjectionTarget,
  Sha256Digest
} from "./projection-constants";
import type {
  AcceptedArchitectureChangeReferenceV1,
  ArchitectureDigestSetV2,
  ArchitectureRefreshSignalV2,
  ProjectionApplyIdentityV1,
  ProjectionArchitectureDebtV1,
  ProjectionCoverageV1,
  ProjectionExpectedSnapshotV1,
  ProjectionFileResultV1,
  ProjectionFreshnessV2,
  ProjectionHumanActionV1,
  ProjectionPriorCommittedApplyV1,
  ProjectionSnapshotV1,
  ProjectionTargetChangeV2
} from "./projection-types";

export interface ProjectionResultV3 {
  schemaVersion: typeof PROJECTION_RESULT_SCHEMA_VERSION;
  requestId: string;
  status: ProjectionResultStatus;
  inputSnapshot: ProjectionSnapshotV1;
  outputSnapshot: ProjectionSnapshotV1;
  affectedNodeIds: string[];
  files: ProjectionFileResultV1[];
  humanActions: ProjectionHumanActionV1[];
  refreshSignals: ArchitectureRefreshSignalV2[];
  applyReceipt?: ProjectionApplyIdentityV1;
  /**
   * Omitted, never `[]`, when no earlier attempt of this requestId committed. Never present on
   * `check` results: a check runs in-process without the daemon journal, so read committed applies
   * through `apply` or `readback`.
   */
  priorCommittedApplies?: ProjectionPriorCommittedApplyV1[];
  /**
   * Present on `check` results only: which targets render differently from the committed
   * manifest. Consumers gate on the `projection-check-freshness-v2` capability, not on field presence.
   */
  freshness?: ProjectionFreshnessV2;
  /**
   * Present on every `check` and `plan` result, and on no other: the architecture debt this run
   * found. It never changes `status`. Consumers gate on the `projection-architecture-debt-v1`
   * capability, not on field presence.
   */
  architectureDebt?: ProjectionArchitectureDebtV1;
  /**
   * Present on every `check` and `plan` result, and on no other: per-target change classification,
   * sorted by path, then targetId (#327). It never changes `status` or `files`.
   */
  changes?: ProjectionTargetChangeV2[];
  /**
   * Present, as `true`, only when this response returns an apply this requestId already committed
   * for the same request digest, without applying again (#265). It is excluded from
   * `receiptDigest`, so a replay carries the committed receipt digest unchanged.
   */
  replayed?: true;
  /**
   * Present exactly when `replayed` is: whether this response wrote projection-owned files (#325).
   * `false` means it wrote nothing; the committed result is returned as recorded. `true` means
   * the projection-owned outputs differed from the approved result at the approved snapshot, so
   * the provider wrote the committed fixed point again under the original receipt. Excluded from
   * `receiptDigest`.
   */
  written?: boolean;
  /**
   * Present only on a `human-action-required` result whose request sent `acceptObservedMajorChange`
   * and the provider declined it: `declined-unprovable-proof` means a capability's P1 or P2 proof is
   * unprovable, so no observed change can be accepted. The result then carries an
   * `unprovable-required-flow` action naming those capabilities, never `unresolved-major-change`,
   * so a caller can tell a declined flag from an absent one (#275).
   */
  majorChangeAcceptance?: "declined-unprovable-proof";
  /**
   * Present exactly on `planned-partial` and `applied-partial` results, with `complete: false`; a
   * result that covers every target omits it. Consumers gate on `projection-capability-isolation-v1`.
   */
  coverage?: ProjectionCoverageV1;
  receiptDigest: Sha256Digest;
}

export interface ProjectionApplyReceiptV1 {
  schemaVersion: typeof PROJECTION_APPLY_RECEIPT_SCHEMA_VERSION;
  identity: ProjectionApplyIdentityV1;
  result: ProjectionResultV3;
  /**
   * Present only on receipts written after recovery protocol v1 shipped. Receipts created by
   * v0.4.7 remain inspectable, but cannot be recovered because they never recorded this exact
   * approval binding.
   */
  recovery?: ProjectionApplyRecoveryBindingV2;
}

/** Immutable approval metadata recorded with a new committed apply receipt, never inferred later. */
export interface ProjectionApplyRecoveryBindingV2 {
  schemaVersion: typeof PROJECTION_APPLY_RECOVERY_BINDING_SCHEMA_VERSION;
  targets: ProjectionTarget[];
  changedPaths: string[];
  originalExpectedSnapshot: ProjectionExpectedSnapshotV1;
  expectedResultingDigests: ArchitectureDigestSetV2;
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  layoutVersion: "archcontext.docs-layout/v1";
  generatedFrom: ProjectionSnapshotV1["generatedFrom"];
  ownedOutputDigest: Sha256Digest;
  receiptDigest: Sha256Digest;
  /**
   * `digestJson` of the caller's ProjectionRequestV1 exactly as received. With the result's
   * requestId it is the replay key of #265; it never includes provider-generated ids. Receipts
   * committed before it existed lack it and are never replayed.
   */
  requestDigest?: Sha256Digest;
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
export interface ProjectionApplyRecoveryProofV2 {
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
  expectedResultingDigests: ArchitectureDigestSetV2;
  current: {
    snapshot: ProjectionSnapshotV1;
    resultingDigests: ArchitectureDigestSetV2;
    ownedOutputDigest: Sha256Digest;
    fixedPointDigest: Sha256Digest;
  };
}

export interface ProjectionApplyRecoveryResultV2 {
  schemaVersion: typeof PROJECTION_APPLY_RECOVERY_RESULT_SCHEMA_VERSION;
  proof: ProjectionApplyRecoveryProofV2;
  refreshSignals: ArchitectureRefreshSignalV2[];
}

/** Non-consuming receipt retrieval; current state is rebuilt for every response. */
export interface ProjectionApplyReadbackResultV2 {
  schemaVersion: typeof PROJECTION_APPLY_READBACK_RESULT_SCHEMA_VERSION;
  requestId: string;
  requestDigest: Sha256Digest;
  receipt: ProjectionApplyReceiptV1;
  current: ProjectionApplyRecoveryProofV2["current"];
  readbackDigest: Sha256Digest;
}

/** Exact-request absence observed under the same writer boundary used by apply. */
export interface ProjectionApplyAbsenceV1 {
  schemaVersion: "archcontext.projection-apply-absence/v1";
  requestId: string;
  requestDigest: Sha256Digest;
  lookupKey: Sha256Digest;
  current: ProjectionExpectedSnapshotV1;
  absenceDigest: Sha256Digest;
}

export type ProjectionApplyReadbackV1 = ProjectionApplyReadbackResultV2 | ProjectionApplyAbsenceV1;

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
