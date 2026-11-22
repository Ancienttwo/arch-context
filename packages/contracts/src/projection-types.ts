import type { EvidenceCoverageLevelV2 } from "./ledger-records";
import type {
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  ARCHITECTURE_PROOF_P1_STATUSES,
  ARCHITECTURE_PROOF_P2_STATUSES,
  ARCHITECTURE_REFRESH_SIGNAL_SCHEMA_VERSION,
  PROJECTION_APPLY_IDENTITY_SCHEMA_VERSION,
  PROJECTION_REQUEST_SCHEMA_VERSION,
  PROJECTION_SLICE_SCHEMA_VERSION,
  ArchitectureMajorChangeReasonCode,
  ArchitectureRefreshTarget,
  ArchitectureSemanticFacet,
  ProjectionArchitectureDebtCoverageReasonCode,
  ProjectionArchitectureDebtReasonCode,
  ProjectionCoverageReasonCode,
  ProjectionFilePreviewFormat,
  ProjectionFreshnessReasonCode,
  ProjectionHumanActionReasonCode,
  ProjectionMode,
  ProjectionPriorCommittedApplyOperation,
  ProjectionTarget,
  ProjectionTargetChangeClassification,
  ProjectionTargetChangePlannedAction,
  ProjectionTargetChangeReasonCode,
  Sha256Digest
} from "./projection-constants";

/** One capability's P1/P2 proof status, as its semantic state records it. */
export interface ArchitectureCapabilityProofStatusV1 {
  p1: (typeof ARCHITECTURE_PROOF_P1_STATUSES)[number];
  p2: (typeof ARCHITECTURE_PROOF_P2_STATUSES)[number];
}

/**
 * Why one capability is part of a major change: the reason codes and semantic facets that moved for
 * it between the committed semantic baseline and this run. `proofStatusBefore` is null when the
 * baseline has no such capability (or no baseline exists); `proofStatusAfter` is null when the
 * capability was removed. A capability present on one side only lists no changed facets. A
 * capability listed only because its current proof is unprovable, while another capability carries
 * the observed change, lists no reason codes.
 */
export interface ArchitectureCapabilityChangeV1 {
  capabilityId: string;
  reasonCodes: ArchitectureMajorChangeReasonCode[];
  changedFacets: ArchitectureSemanticFacet[];
  proofStatusBefore: ArchitectureCapabilityProofStatusV1 | null;
  proofStatusAfter: ArchitectureCapabilityProofStatusV1 | null;
}

/**
 * What a `plan` would write to one file, returned in the response only and never persisted: the
 * rendered body of a `create`, or a unified diff (current bytes to rendered bytes) of an `update` or
 * `delete`. `content` is cut at a line boundary to at most PROJECTION_FILE_PREVIEW_MAX_BYTES UTF-8
 * bytes, and to whatever remains of PROJECTION_PREVIEW_TOTAL_MAX_BYTES across the result, in path
 * order; `byteLength` is the UTF-8 length of the complete content and `truncated` says whether
 * `content` is shorter.
 */
export interface ProjectionSliceEntrypointV1 {
  nodeId: string;
  entrypointId: string;
  path: string;
  symbol: string;
}

export interface ProjectionSliceCapabilityV1 {
  capabilityId: string;
  modulePath: string;
  /** Unfenced Mermaid. Null when the capability was removed or P1 cannot be rendered. */
  diagramMermaid: string | null;
  entrypoints: ProjectionSliceEntrypointV1[];
  markdown: string;
}

export interface ProjectionSliceV1 {
  schemaVersion: typeof PROJECTION_SLICE_SCHEMA_VERSION;
  base: string;
  baseSha: string;
  mergeBase: string;
  headSha: string;
  changedPaths: string[];
  changed: boolean;
  affectedCapabilities: ProjectionSliceCapabilityV1[];
  markdown: string;
}

export interface ProjectionFilePreviewV1 {
  format: ProjectionFilePreviewFormat;
  content: string;
  byteLength: number;
  truncated: boolean;
}

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
  /**
   * `apply` and `adopt` only, never together with `acceptedChange`: accept the major change this
   * run observes at `expected`. The provider classifies, derives the accepted change and applies
   * it against the same expected snapshot, which the daemon re-checks under its writer lock before
   * writing. The apply receipt records the observed change with provider-generated `changeSetId`
   * and `eventId`. Absent, a major change still stops at `human-action-required` (#261).
   */
  acceptObservedMajorChange?: true;
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
    codeGraphVersion: "1.6.4";
    codeGraphStatus: "ready" | "unavailable";
  };
}

export interface ProjectionFileResultV1 {
  path: string;
  action: "create" | "delete" | "unchanged" | "update";
  preimageDigest: Sha256Digest | null;
  outputDigest: Sha256Digest | null;
  /**
   * `plan` results only (#264): what this entry would write. Absent on every other mode, on a
   * committed receipt, and on an entry whose path the projection rejected for adoption or ownership
   * repair, because no apply writes that rendered body. Consumers gate on `projection-preview-v1`.
   */
  preview?: ProjectionFilePreviewV1;
}

export interface ProjectionHumanActionV1 {
  reasonCode: ProjectionHumanActionReasonCode;
  affectedNodeIds: string[];
  /**
   * Present exactly on `orphaned-document-review`: the managed document whose target the model no
   * longer renders and which may hold human text. `apply` never deletes it; a human must review,
   * move or remove it. A generated-only orphan is a `files[]` delete instead.
   */
  path?: string;
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

/**
 * The global digests of a projection. The base digests come from the committed manifest, which
 * records no source state, so the set carries no source tree digest (ADR-0056 §4).
 */
export interface ArchitectureDigestSetV2 {
  modelDigest: Sha256Digest;
  flowProofDigest: Sha256Digest;
  projectionDigest: Sha256Digest;
}

export interface AcceptedArchitectureChangeReferenceV1 {
  changeSetId: string;
  eventId: string;
  reasonCodes: ArchitectureMajorChangeReasonCode[];
  affectedNodeIds: string[];
}

export interface ArchitectureRefreshSignalV2 {
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
  /**
   * The observed per-capability breakdown of the semantic delta this signal classifies, sorted by
   * capabilityId (#264). Every signal this provider produces carries it; it is part of the signal
   * identity; signals committed before it existed lack it. Consumers gate on
   * `architecture-change-capabilities-v1`, not on field presence.
   */
  capabilities?: ArchitectureCapabilityChangeV1[];
  refreshTargets: ArchitectureRefreshTarget[];
  baseDigests: ArchitectureDigestSetV2;
  resultingDigests: ArchitectureDigestSetV2;
  projectionReceiptDigest: Sha256Digest;
}

export interface ProjectionPriorCommittedApplyFileV1 {
  path: string;
  operation: ProjectionPriorCommittedApplyOperation;
  /** `digestJson({ body })` of the body this ChangeSet wrote, or `"missing"` for a delete. */
  hash: string;
}

/**
 * A ChangeSet already committed under this request's requestId by an earlier attempt of the same
 * request. The CLI is a short-lived RPC client while the daemon owns the write, so a caller whose
 * process was killed after the commit sees only `status: noop` on retry; this array is the only
 * surface that names what that lost attempt actually wrote.
 */
export interface ProjectionPriorCommittedApplyV1 {
  /**
   * Present together with `lookupKey` only when the committed ChangeSet also carried a projection
   * apply receipt, which happens only for an accepted-semantic-change apply. A plain drift-repair
   * apply commits without one, and both fields are then absent rather than invented.
   */
  applyId?: Sha256Digest;
  lookupKey?: Sha256Digest;
  requestId: string;
  changeSetId: string;
  committedAt: string;
  files: ProjectionPriorCommittedApplyFileV1[];
}

/** One target whose rendered output differs from its committed manifest row. */
export interface ProjectionFreshnessStaleTargetV2 {
  targetId: string;
  path: string;
  /** The committed row's `outputDigest`; `null` for a target the committed manifest does not record. */
  committedOutputDigest: Sha256Digest | null;
  /** The current render's `outputDigest`; `null` for a committed row the current layout no longer renders. */
  renderedOutputDigest: Sha256Digest | null;
}

/**
 * Render-equivalent freshness of the committed projection (ADR-0056 §1): a target is fresh when the
 * output the current render produces equals its committed row's `outputDigest`, and the projection
 * is fresh when every target is, the two target sets are equal, and the manifest the render would
 * write equals the committed bytes.
 */
export interface ProjectionFreshnessV2 {
  ok: boolean;
  reasonCodes: ProjectionFreshnessReasonCode[];
  /** Sorted and unique by targetId. Non-empty exactly when `projection-output-changed` is reported. */
  staleTargets: ProjectionFreshnessStaleTargetV2[];
}

/**
 * One capability pair whose imports no model relation declares, under the rule of
 * CAPABILITY_DEPENDENCY_DECLARING_RELATION_KINDS. It is the same pair, with the same edge count,
 * that `archctx deps` reports as a cross-capability cell with `declared: false`, measured over
 * the files this run measured instead of the `HEAD` tree.
 */
export interface ProjectionUndeclaredDependencyV1 {
  reasonCode: "undeclared-dependency";
  fromCapabilityId: string;
  toCapabilityId: string;
  /** Distinct file-to-file import edges from `fromCapabilityId` into `toCapabilityId`; at least 1. */
  importEdgeCount: number;
}

/**
 * Architecture debt that this `check` or `plan` run found. It reuses the import facts the run
 * already read, never blocks a mode and changes no rendered output. It covers every capability
 * pair in the repository, not only pairs that touch the request's `changedPaths`.
 */
export interface ProjectionArchitectureDebtV1 {
  /**
   * `unknown` when the run had no code facts (`code-facts-unavailable`): `items` is then empty and
   * says nothing about the repository. `partial` when the import read is a prefix of the index or
   * a workspace specifier could not be resolved: `items` then holds what was observed.
   */
  coverage: EvidenceCoverageLevelV2;
  /** Sorted and unique; empty exactly when `coverage` is `complete`. */
  coverageReasonCodes: ProjectionArchitectureDebtCoverageReasonCode[];
  /** Sorted by `fromCapabilityId`, then `toCapabilityId`. */
  items: ProjectionUndeclaredDependencyV1[];
}

/** One target a partial result carries forward instead of applying. */
export interface ProjectionCoverageBlockedTargetV1 {
  targetId: string;
  path: string;
  /** The blocked capabilities this target depends on, sorted. Never empty. */
  capabilityIds: string[];
  /** Why those capabilities block it, sorted. Never empty. */
  reasonCodes: ProjectionCoverageReasonCode[];
}

/**
 * Which part of the projection a `planned-partial` or `applied-partial` result covers (#327,
 * Phase 1 capability isolation). The blocked capabilities are those whose proof is unprovable or
 * whose flow proof moved without an accepted change, while their semantic fingerprint held. Every
 * target that depends on one of them is carried forward unchanged: its document, its manifest row
 * and the capability's baseline entry keep their committed bytes. `appliedTargetIds` are all the
 * other targets, which the result renders from the current model and sources.
 *
 * `complete` is always `false`: a result that covers every target omits `coverage` instead. A
 * partial result is never an acceptance. It carries no apply receipt and no refresh signal, and a
 * complete check or the `complete` gate still reports the blocked capabilities until they are
 * fixed or accepted.
 */
export interface ProjectionCoverageV1 {
  complete: false;
  /** Sorted and unique. Never empty. */
  blockedCapabilityIds: string[];
  /** Sorted and unique by targetId. Never empty. */
  blockedTargets: ProjectionCoverageBlockedTargetV1[];
  /** Sorted and unique; disjoint from the blocked targets. */
  appliedTargetIds: string[];
}

/**
 * One target of a `check` or `plan` result (#327 finding 2): how it changes since the committed
 * projection, and what this run's write does to its file. The entries cover the union of the
 * current layout's targets and the committed manifest's rows (plus orphans the manifest does not
 * record), one per target. Only agent-context targets share a path (ADR-0056 §9). The projection
 * manifest is not a target; its write is the `files[]` entry no change names.
 *
 * Each comparison is against the committed v4 manifest: `outputChanged` the row's `outputDigest`, or any byte the write changes;
 * `semanticChanged` the `semanticFingerprint` of a capability the target documents (every
 * capability for a target that is not an entity summary, which also compares the manifest's
 * `semanticBaseline.modelDigest`, because it renders the whole model); `proofChanged` the `flowProofFingerprint`
 * or `selectorEvidenceDigest` of a capability an entity summary documents. `null` is an unknown
 * comparison, never `false`.
 *
 * `plannedAction` is the result's own write decision (`files[]`) for that path. When `status` is
 * `planned` or `planned-partial`, the targets whose action is not `none` are exactly the documents
 * an apply of this run writes or deletes; under `adoption-required` or `human-action-required`
 * apply writes nothing, and `plannedAction` reports only what the render would write. A
 * path rejected for adoption or ownership repair is `blocked` and `none`, because only an
 * approved adoption writes it. `classification` never changes `status`, the write set or a gate.
 */
export interface ProjectionTargetChangeV2 {
  targetId: string;
  path: string;
  /** Sorted and unique: the documented capabilities whose change affects this target. Empty when unchanged. */
  affectedCapabilityIds: string[];
  outputChanged: boolean;
  semanticChanged: boolean | null;
  proofChanged: boolean | null;
  plannedAction: ProjectionTargetChangePlannedAction;
  classification: ProjectionTargetChangeClassification;
  /** Sorted and unique. Empty exactly when `classification` is `unchanged`. */
  reasonCodes: ProjectionTargetChangeReasonCode[];
}
