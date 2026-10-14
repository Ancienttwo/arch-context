import type { EvidenceCoverageLevelV2 } from "./ledger";
import { digestJson, isRepoRelativePosixPath, type Json } from "./schema";

export const PROJECTION_REQUEST_SCHEMA_VERSION = "archcontext.projection-request/v1" as const;
export const PROJECTION_RESULT_SCHEMA_VERSION = "archcontext.projection-result/v2" as const;
export const PROJECTION_APPLY_IDENTITY_SCHEMA_VERSION = "archcontext.projection-apply-identity/v1" as const;
export const PROJECTION_APPLY_RECEIPT_SCHEMA_VERSION = "archcontext.projection-apply-receipt/v1" as const;
export const PROJECTION_APPLY_RECOVERY_BINDING_SCHEMA_VERSION = "archcontext.projection-apply-recovery-binding/v1" as const;
export const PROJECTION_APPLY_RECOVERY_INTENT_SCHEMA_VERSION = "archcontext.projection-apply-recovery-intent/v1" as const;
export const PROJECTION_APPLY_RECOVERY_PROOF_SCHEMA_VERSION = "archcontext.projection-apply-recovery-proof/v1" as const;
export const PROJECTION_APPLY_RECOVERY_RESULT_SCHEMA_VERSION = "archcontext.projection-apply-recovery-result/v1" as const;
export const PROJECTION_APPLY_READBACK_RESULT_SCHEMA_VERSION = "archcontext.projection-apply-readback-result/v1" as const;
export const ARCHITECTURE_REFRESH_SIGNAL_SCHEMA_VERSION = "archcontext.architecture-refresh-signal/v1" as const;
export const ARCHCTX_CAPABILITIES_SCHEMA_VERSION = "archcontext.capabilities/v1" as const;
export const ARCHITECTURE_DOCS_RENDERER_VERSION = "archcontext.docs-renderer/v6" as const;
export const AGENT_CONTEXT_RENDERER_VERSION = "archcontext.agent-context-renderer/v1" as const;

export const PROJECTION_MODES = ["check", "plan", "apply", "adopt"] as const;
export const PROJECTION_PRIOR_COMMITTED_APPLY_OPERATIONS = ["delete", "write"] as const;
export const PROJECTION_TARGETS = ["agent-context", "architecture-docs"] as const;
export const PROJECTION_RESULT_STATUSES = [
  "adoption-required",
  "applied",
  "applied-partial",
  "applied-reconcile-required",
  "blocked",
  "human-action-required",
  "noop",
  "permanent-failure",
  "planned",
  "planned-partial",
  "retryable-failure"
] as const;
/**
 * The two statuses of a projection that covers only part of its targets (#327, Phase 1 capability
 * isolation): `planned-partial` from `check` and `plan`, `applied-partial` from `apply`. Exactly
 * these results carry `coverage`, always with `complete: false`; a complete result omits it.
 */
export const PROJECTION_PARTIAL_RESULT_STATUSES = ["applied-partial", "planned-partial"] as const;
/**
 * Why a target is carried forward instead of applied: a capability it depends on has an
 * unprovable P1 or P2 proof (`unprovable-required-flow`), or its flow proof moved since the
 * committed baseline while its semantic fingerprint held (`verified-flow-proof-changed`).
 */
export const PROJECTION_COVERAGE_REASON_CODES = ["unprovable-required-flow", "verified-flow-proof-changed"] as const;
export const PROJECTION_HUMAN_ACTION_REASON_CODES = [
  "adoption-required",
  "manual-region-conflict",
  "orphaned-document-review",
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
  "architecture-change-capabilities-v1",
  "architecture-debt-v1",
  "architecture-docs-renderer-v2",
  "architecture-refresh-signal-v1",
  "capability-dependencies-declared-v1",
  "capability-dependencies-v1",
  "changeset-entity-operations-v1",
  "changeset-ownership-delta-v1",
  "code-facts-unavailable-error-v1",
  "docs-anchors-v1",
  "flow-selector-check-v1",
  "module-statistics-v1",
  "projection-apply-readback-v1",
  "projection-apply-receipt-v1",
  "projection-apply-recovery-v1",
  "projection-apply-replay-restore-v1",
  "projection-apply-replay-v1",
  "projection-architecture-debt-v1",
  "projection-capability-isolation-v1",
  "projection-change-classification-v1",
  "projection-check-freshness-v1",
  "projection-freshness-v1",
  "projection-manifest-contract-v3",
  "projection-observed-major-change-acceptance-v1",
  "projection-orphan-review-v1",
  "projection-preview-v1",
  "projection-prior-committed-applies-v1",
  "projection-protocol-v2",
  "projection-snapshot-v1",
  "recommendation-scan-decision-v1",
  "recommendation-v3",
  "refactor-assessment-v1",
  "refactor-observation-evidence-v1",
  "refactor-resolution-v1",
  "refactor-scan-limits-v1",
  "refactor-scan-untracked-count-v1"
] as const;

/**
 * The closed set of semantic facets a capability's semantic state digests. Each facet maps to the
 * major-change reason code it raises when its digest moves.
 */
export const ARCHITECTURE_SEMANTIC_FACETS = [
  "constraints",
  "entrypoints",
  "interfaces",
  "lifecycle",
  "names",
  "ownership",
  "placement",
  "relations",
  "responsibilities",
  "riskBoundaries"
] as const;
export const ARCHITECTURE_PROOF_P1_STATUSES = ["proven", "unprovable"] as const;
export const ARCHITECTURE_PROOF_P2_STATUSES = ["not-applicable", "proven", "unprovable"] as const;

export const ARCHITECTURE_FLOW_SELECTOR_CHECK_SCHEMA_VERSION = "archcontext.flow-selector-check/v1" as const;

/**
 * The proof status of one declared entrypoint→sink selector, as the P2 flow proof reads its
 * evidence. Only `proven` can bind a flow step. `no-direct-call`: no `calls` edge from the source
 * to the sink. `only-references`: no proving call, but the source references the sink by value.
 * `false-builtin-call`: the only calls carry a runtime built-in name and the source file does not
 * import the sink file. `ambiguous-symbol`: the source or the sink matches more than one indexed
 * symbol. `evidence-missing`: no evidence was measured (for example, no CodeGraph index).
 * `evidence-truncated`: the evidence producer could not enumerate every edge.
 */
export const ARCHITECTURE_FLOW_SELECTOR_PROOF_STATUSES = [
  "ambiguous-symbol",
  "evidence-missing",
  "evidence-truncated",
  "false-builtin-call",
  "no-direct-call",
  "only-references",
  "proven"
] as const;
export type ArchitectureFlowSelectorProofStatus = typeof ARCHITECTURE_FLOW_SELECTOR_PROOF_STATUSES[number];

export interface ArchitectureFlowSelectorSiteV1 {
  path: string;
  line?: number;
}

export interface ArchitectureFlowSelectorCheckEntryV1 {
  nodeId: string;
  entrypointId: string;
  sourcePath: string;
  sourceSymbol: string;
  sinkId: string;
  sinkPath: string;
  sinkSymbol: string;
  status: ArchitectureFlowSelectorProofStatus;
  callSites: ArchitectureFlowSelectorSiteV1[];
  referenceSites: ArchitectureFlowSelectorSiteV1[];
  rejectedBuiltinCallSites: ArchitectureFlowSelectorSiteV1[];
  /** The required-flow steps that name this selector as evidence. Empty for an unused selector. */
  flowSteps: Array<{ flowId: string; stepId: string }>;
}

export interface ArchitectureFlowSelectorCheckCapabilityV1 {
  capabilityId: string;
  /** The same P2 status a projection records for this capability. */
  p2Status: typeof ARCHITECTURE_PROOF_P2_STATUSES[number];
  diagnostics: Array<{ code: string; flowId?: string; stepId?: string; detail: string }>;
}

/**
 * `archctx flows check`: the P2 flow proof without rendering. Read-only. `ok` is true when no
 * capability that declares a flow has an unprovable P2 proof.
 */
export interface ArchitectureFlowSelectorCheckV1 {
  schemaVersion: typeof ARCHITECTURE_FLOW_SELECTOR_CHECK_SCHEMA_VERSION;
  ok: boolean;
  codeGraph: { availability: "ready" | "unavailable"; version: string };
  summary: { selectors: number; proven: number; unproven: number; usedUnproven: number };
  selectors: ArchitectureFlowSelectorCheckEntryV1[];
  capabilities: ArchitectureFlowSelectorCheckCapabilityV1[];
}

/** `files[].preview.format`: a `create` carries the rendered body, an `update` or `delete` a unified diff. */
export const PROJECTION_FILE_PREVIEW_FORMATS = ["body", "unified-diff"] as const;
/** Upper bound, in UTF-8 bytes, on one `files[].preview.content`. */
export const PROJECTION_FILE_PREVIEW_MAX_BYTES = 65_536;
/** Upper bound, in UTF-8 bytes, on the sum of every `files[].preview.content` of one result. */
export const PROJECTION_PREVIEW_TOTAL_MAX_BYTES = 1_048_576;

/**
 * Why a projection is not fresh. Shared by the core freshness evaluator and the `check` result's
 * `freshness` field so the two can never disagree.
 */
export const PROJECTION_FRESHNESS_REASON_CODES = [
  "projection-manifest-missing",
  "projection-manifest-unreadable",
  "projection-source-changed-since-stamp",
  "projection-source-stamp-missing",
  "projection-source-tree-digest-mismatch"
] as const;

/** The architecture debt a `check` or `plan` result reports. Debt is a finding, never a blocker. */
export const PROJECTION_ARCHITECTURE_DEBT_REASON_CODES = ["undeclared-dependency"] as const;
/**
 * Why the debt read is not a complete observation. The `code-facts-*` codes mean what they mean on
 * `archctx deps`; `workspace-resolution-failed` means the workspace package map was unreadable, so
 * no bare workspace import specifier could be resolved.
 */
export const PROJECTION_ARCHITECTURE_DEBT_COVERAGE_REASON_CODES = [
  "code-facts-import-limit",
  "code-facts-truncated",
  "code-facts-unavailable",
  "workspace-resolution-failed"
] as const;

/**
 * How one target of a `check` or `plan` result changes (#327 finding 2), from the strongest reason
 * down: `blocked` (a human must act before the target can be written: Phase 1 isolation, an orphan
 * that needs review, an adoption or ownership rejection), `proof-change` (a known proof change,
 * which a missing baseline never hides), `baseline-missing` (a comparison is unknown: no committed
 * v3 manifest, or no committed row for the target), `semantic-change`, `output-change`,
 * `stamp-only` (only the source stamps moved) and `unchanged`.
 * `projectionTargetChangeClassification` is the one precedence rule.
 */
export const PROJECTION_TARGET_CHANGE_CLASSIFICATIONS = [
  "baseline-missing",
  "blocked",
  "output-change",
  "proof-change",
  "semantic-change",
  "stamp-only",
  "unchanged"
] as const;
/** What the projection write does to the target's file: the result's own `files[]` decision for that path. */
export const PROJECTION_TARGET_CHANGE_PLANNED_ACTIONS = ["create", "delete", "none", "update"] as const;
/** The reason codes that block a target: no apply writes it until a human acts. */
export const PROJECTION_TARGET_CHANGE_BLOCKING_REASON_CODES = [
  "adoption-required",
  "ambiguous-ownership",
  "orphan-review-required",
  "unprovable-required-flow",
  "verified-flow-proof-changed"
] as const;
/**
 * Why a target is classified as it is. Each comparison flag has its codes: `stampChanged` is
 * `source-stamp-changed`; `semanticChanged` is `semantic-fingerprint-changed` or, for a target that
 * describes the whole model, `model-digest-changed` (the committed `semanticBaseline.modelDigest`
 * differs from the current model's); `proofChanged` is
 * `flow-proof-changed` or `selector-evidence-changed`; `outputChanged` is `rendered-output-changed`
 * (the rendered output differs from the committed row's `outputDigest`), `target-added`,
 * `target-removed` or `file-bytes-changed` (the write changes the file although its rendered output
 * is the committed one: a marker, a missing file, an edited region); an unknown comparison is
 * `baseline-missing` or `target-row-missing`.
 */
export const PROJECTION_TARGET_CHANGE_REASON_CODES = [
  "adoption-required",
  "ambiguous-ownership",
  "baseline-missing",
  "file-bytes-changed",
  "flow-proof-changed",
  "model-digest-changed",
  "orphan-review-required",
  "rendered-output-changed",
  "selector-evidence-changed",
  "semantic-fingerprint-changed",
  "source-stamp-changed",
  "target-added",
  "target-removed",
  "target-row-missing",
  "unprovable-required-flow",
  "verified-flow-proof-changed"
] as const;

export type ProjectionMode = (typeof PROJECTION_MODES)[number];
export type ProjectionTargetChangeClassification = (typeof PROJECTION_TARGET_CHANGE_CLASSIFICATIONS)[number];
export type ProjectionTargetChangePlannedAction = (typeof PROJECTION_TARGET_CHANGE_PLANNED_ACTIONS)[number];
export type ProjectionTargetChangeReasonCode = (typeof PROJECTION_TARGET_CHANGE_REASON_CODES)[number];
export type ProjectionFreshnessReasonCode = (typeof PROJECTION_FRESHNESS_REASON_CODES)[number];
export type ProjectionTarget = (typeof PROJECTION_TARGETS)[number];
export type ProjectionResultStatus = (typeof PROJECTION_RESULT_STATUSES)[number];
export type ProjectionPartialResultStatus = (typeof PROJECTION_PARTIAL_RESULT_STATUSES)[number];
export type ProjectionCoverageReasonCode = (typeof PROJECTION_COVERAGE_REASON_CODES)[number];
export type ProjectionHumanActionReasonCode = (typeof PROJECTION_HUMAN_ACTION_REASON_CODES)[number];
export type ProjectionPriorCommittedApplyOperation = (typeof PROJECTION_PRIOR_COMMITTED_APPLY_OPERATIONS)[number];
export type ArchitectureMajorChangeReasonCode = (typeof ARCHITECTURE_MAJOR_CHANGE_REASON_CODES)[number];
export type ArchitectureRefreshTarget = (typeof ARCHITECTURE_REFRESH_TARGETS)[number];
export type ArchctxFeature = (typeof ARCHCTX_FEATURES)[number];
export type ProjectionArchitectureDebtReasonCode = (typeof PROJECTION_ARCHITECTURE_DEBT_REASON_CODES)[number];
export type ProjectionArchitectureDebtCoverageReasonCode = (typeof PROJECTION_ARCHITECTURE_DEBT_COVERAGE_REASON_CODES)[number];
export type ArchitectureSemanticFacet = (typeof ARCHITECTURE_SEMANTIC_FACETS)[number];
export type ProjectionFilePreviewFormat = (typeof PROJECTION_FILE_PREVIEW_FORMATS)[number];
export type Sha256Digest = `sha256:${string}`;

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
    codeGraphVersion: "1.6.1";
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
  /**
   * The observed per-capability breakdown of the semantic delta this signal classifies, sorted by
   * capabilityId (#264). Every signal this provider produces carries it; it is part of the signal
   * identity; signals committed before it existed lack it. Consumers gate on
   * `architecture-change-capabilities-v1`, not on field presence.
   */
  capabilities?: ArchitectureCapabilityChangeV1[];
  refreshTargets: ArchitectureRefreshTarget[];
  baseDigests: ArchitectureDigestSetV1;
  resultingDigests: ArchitectureDigestSetV1;
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

export interface ProjectionFreshnessStaleNodeV1 {
  nodeId: string;
  /** Source-footprint digest the node's projected document is stamped with. */
  stampedDigest: Sha256Digest;
  /** Source-footprint digest measured by this run. */
  currentDigest: Sha256Digest;
}

/** Read-only per-node freshness of the committed projection, as `check` measured it. */
export interface ProjectionFreshnessV1 {
  ok: boolean;
  reasonCodes: ProjectionFreshnessReasonCode[];
  staleNodes: ProjectionFreshnessStaleNodeV1[];
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
 * record), one per path. The projection manifest is not a target; its write is the `files[]` entry
 * no change names.
 *
 * Each comparison is against the committed v3 manifest: `stampChanged` the target row's
 * `sourceStamps`; `outputChanged` the row's `outputDigest`, or any byte the write changes;
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
export interface ProjectionTargetChangeV1 {
  targetId: string;
  path: string;
  /** Sorted and unique: the documented capabilities whose change affects this target. Empty when unchanged. */
  affectedCapabilityIds: string[];
  stampChanged: boolean | null;
  outputChanged: boolean;
  semanticChanged: boolean | null;
  proofChanged: boolean | null;
  plannedAction: ProjectionTargetChangePlannedAction;
  classification: ProjectionTargetChangeClassification;
  /** Sorted and unique. Empty exactly when `classification` is `unchanged`. */
  reasonCodes: ProjectionTargetChangeReasonCode[];
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
  /**
   * Omitted, never `[]`, when no earlier attempt of this requestId committed. Never present on
   * `check` results: a check runs in-process without the daemon journal, so read committed applies
   * through `apply` or `readback`.
   */
  priorCommittedApplies?: ProjectionPriorCommittedApplyV1[];
  /**
   * Present on `check` results only: which nodes changed since their documents were verified.
   * Consumers gate on the `projection-check-freshness-v1` capability, not on field presence.
   */
  freshness?: ProjectionFreshnessV1;
  /**
   * Present on every `check` and `plan` result, and on no other: the architecture debt this run
   * found. It never changes `status`. Consumers gate on the `projection-architecture-debt-v1`
   * capability, not on field presence.
   */
  architectureDebt?: ProjectionArchitectureDebtV1;
  /**
   * Present on every `check` and `plan` result, and on no other: per-target change classification,
   * sorted by path (#327). It never changes `status` or `files`.
   */
  changes?: ProjectionTargetChangeV1[];
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

/** Non-consuming receipt retrieval; current state is rebuilt for every response. */
export interface ProjectionApplyReadbackResultV1 {
  schemaVersion: typeof PROJECTION_APPLY_READBACK_RESULT_SCHEMA_VERSION;
  requestId: string;
  requestDigest: Sha256Digest;
  receipt: ProjectionApplyReceiptV1;
  current: ProjectionApplyRecoveryProofV1["current"];
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

export type ProjectionApplyReadbackV1 = ProjectionApplyReadbackResultV1 | ProjectionApplyAbsenceV1;

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
  if (input.acceptObservedMajorChange !== undefined) {
    if (input.acceptObservedMajorChange !== true) issues.push("acceptObservedMajorChange must be true when present");
    if (input.mode !== "apply" && input.mode !== "adopt") issues.push("acceptObservedMajorChange is only allowed when mode=apply or mode=adopt");
    if (input.acceptedChange !== undefined) issues.push("acceptObservedMajorChange and acceptedChange are mutually exclusive");
  }
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

/**
 * Invariants that bind a result to the request mode that produced it, which the result itself does
 * not carry: only a `plan` result previews what it would write (#264); `check`, `apply` and
 * `adopt` results never carry `files[].preview`, whatever their status.
 */
export function projectionResultRequestModeIssues(input: ProjectionResultV2, mode: ProjectionMode): string[] {
  const issues: string[] = [];
  if (mode !== "plan" && input.files.some((file) => file.preview !== undefined)) {
    issues.push(`files[].preview is only allowed on a plan result, never when mode=${mode}`);
  }
  if (mode !== "check" && mode !== "plan" && input.architectureDebt !== undefined) {
    issues.push(`architectureDebt is only allowed on a check or plan result, never when mode=${mode}`);
  }
  if (mode !== "check" && mode !== "plan" && input.changes !== undefined) {
    issues.push(`changes is only allowed on a check or plan result, never when mode=${mode}`);
  }
  if (input.status === "planned-partial" && mode !== "check" && mode !== "plan") {
    issues.push(`planned-partial is only allowed on a check or plan result, never when mode=${mode}`);
  }
  if (input.status === "applied-partial" && mode !== "apply") {
    issues.push(`applied-partial is only allowed on an apply result, never when mode=${mode}`);
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
      const entry = input.changes.find((candidate) => candidate.path === target.path);
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

const UTF8 = new TextEncoder();

function utf8ByteLength(value: string): number {
  return UTF8.encode(value).length;
}

/**
 * Shape and canonical order of a partial result's `coverage`, and its binding to the result's
 * files: a carried-forward target is never also a written file.
 */
export function projectionCoverageIssues(input: ProjectionCoverageV1, files: readonly ProjectionFileResultV1[] = []): string[] {
  const issues = [
    ...sortedUniqueIssues("coverage.blockedCapabilityIds", input.blockedCapabilityIds),
    ...sortedUniqueIssues("coverage.blockedTargets.targetId", input.blockedTargets.map((target) => target.targetId)),
    ...sortedUniqueIssues("coverage.appliedTargetIds", input.appliedTargetIds)
  ];
  if (input.complete !== false) issues.push("coverage.complete must be false; a result that covers every target omits coverage");
  if (input.blockedCapabilityIds.length === 0) issues.push("coverage.blockedCapabilityIds must name at least one capability");
  if (input.blockedTargets.length === 0) issues.push("coverage.blockedTargets must name at least one target");
  if (input.blockedCapabilityIds.some((id) => typeof id !== "string" || id.trim() === "")) issues.push("coverage.blockedCapabilityIds must not contain empty ids");
  if (input.appliedTargetIds.some((id) => typeof id !== "string" || id.trim() === "")) issues.push("coverage.appliedTargetIds must not contain empty ids");
  const blockedCapabilities = new Set(input.blockedCapabilityIds);
  const blockingCapabilities = new Set<string>();
  const blockedPaths = new Set<string>();
  const reasons = new Set<string>(PROJECTION_COVERAGE_REASON_CODES);
  for (const [index, target] of input.blockedTargets.entries()) {
    const prefix = `coverage.blockedTargets[${index}]`;
    if (typeof target.targetId !== "string" || target.targetId.trim() === "") issues.push(`${prefix}.targetId must not be empty`);
    if (!isRepoRelativePosixPath(target.path)) issues.push(`${prefix}.path must be a repository-relative POSIX path`);
    else if (blockedPaths.has(target.path)) issues.push(`${prefix}.path is named by another blocked target`);
    blockedPaths.add(target.path);
    issues.push(...sortedUniqueIssues(`${prefix}.capabilityIds`, target.capabilityIds), ...sortedUniqueIssues(`${prefix}.reasonCodes`, target.reasonCodes));
    if (target.capabilityIds.length === 0) issues.push(`${prefix}.capabilityIds must name at least one capability`);
    if (target.reasonCodes.length === 0) issues.push(`${prefix}.reasonCodes must name at least one reason`);
    for (const capabilityId of target.capabilityIds) {
      if (!blockedCapabilities.has(capabilityId)) issues.push(`${prefix}.capabilityIds names ${capabilityId}, which is not a blocked capability`);
      blockingCapabilities.add(capabilityId);
    }
    const reason = target.reasonCodes.find((code) => !reasons.has(code));
    if (reason !== undefined) issues.push(`${prefix}.reasonCodes contains unsupported reason: ${reason}`);
    if (input.appliedTargetIds.includes(target.targetId)) issues.push(`${prefix}.targetId must not also be an applied target`);
  }
  for (const capabilityId of input.blockedCapabilityIds) {
    if (!blockingCapabilities.has(capabilityId)) issues.push(`coverage.blockedCapabilityIds names ${capabilityId}, which blocks no target`);
  }
  for (const file of files) {
    if (blockedPaths.has(file.path)) issues.push(`files[] must not write the carried-forward target path ${file.path}`);
  }
  return issues;
}

const TARGET_CHANGE_BLOCKING_REASONS = new Set<string>(PROJECTION_TARGET_CHANGE_BLOCKING_REASON_CODES);
const TARGET_CHANGE_UNKNOWN_REASONS = ["baseline-missing", "target-row-missing"] as const;
const TARGET_CHANGE_OUTPUT_REASONS = ["file-bytes-changed", "rendered-output-changed", "target-added", "target-removed"] as const;
const TARGET_CHANGE_PROOF_REASONS = ["flow-proof-changed", "selector-evidence-changed"] as const;
const TARGET_CHANGE_SEMANTIC_REASONS = ["model-digest-changed", "semantic-fingerprint-changed"] as const;

/**
 * The one precedence rule of a target change: blocked > proof-change (`proofChanged === true`) >
 * baseline-missing > semantic-change > output-change > stamp-only > unchanged. A known proof change
 * is never hidden by an unknown comparison (a target without a committed row can still carry a
 * moved flow proof); an unknown comparison outranks everything below the proof change and is never
 * `unchanged`. `stamp-only` therefore means the stamps moved while the output bytes, and the
 * semantic and proof comparisons, are known and unchanged on a target nothing blocks.
 */
export function projectionTargetChangeClassification(
  input: Pick<ProjectionTargetChangeV1, "reasonCodes" | "stampChanged" | "outputChanged" | "semanticChanged" | "proofChanged">
): ProjectionTargetChangeClassification {
  if (input.reasonCodes.some((code) => TARGET_CHANGE_BLOCKING_REASONS.has(code))) return "blocked";
  if (input.proofChanged === true) return "proof-change";
  if (input.stampChanged === null || input.semanticChanged === null || input.proofChanged === null) return "baseline-missing";
  if (input.semanticChanged) return "semantic-change";
  if (input.outputChanged) return "output-change";
  if (input.stampChanged) return "stamp-only";
  return "unchanged";
}

/**
 * Shape, canonical order and internal consistency of a result's `changes`, and their binding to its
 * `files`: a change with a planned action names the `files[]` entry of its path with that action; a
 * `files[]` entry a change names but does not plan is a path rejected for adoption or ownership
 * repair, so that change is blocked by that rejection. The one `files[]` entry no change names is
 * the projection manifest.
 */
export function projectionTargetChangesIssues(input: readonly ProjectionTargetChangeV1[], files: readonly ProjectionFileResultV1[] = []): string[] {
  const issues = sortedUniqueIssues("changes.path", input.map((entry) => entry.path));
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const reasons = new Set<string>(PROJECTION_TARGET_CHANGE_REASON_CODES);
  for (const [index, entry] of input.entries()) {
    const prefix = `changes[${index}]`;
    const has = (codes: readonly string[]) => codes.some((code) => entry.reasonCodes.includes(code as ProjectionTargetChangeReasonCode));
    if (typeof entry.targetId !== "string" || entry.targetId.trim() === "") issues.push(`${prefix}.targetId must not be empty`);
    if (!isRepoRelativePosixPath(entry.path)) issues.push(`${prefix}.path must be a repository-relative POSIX path`);
    issues.push(...sortedUniqueIssues(`${prefix}.affectedCapabilityIds`, entry.affectedCapabilityIds), ...sortedUniqueIssues(`${prefix}.reasonCodes`, entry.reasonCodes));
    if (entry.affectedCapabilityIds.some((id) => typeof id !== "string" || id.trim() === "")) issues.push(`${prefix}.affectedCapabilityIds must not contain empty ids`);
    const unsupported = entry.reasonCodes.find((code) => !reasons.has(code));
    if (unsupported !== undefined) issues.push(`${prefix}.reasonCodes contains an unsupported code: ${unsupported}`);
    for (const field of ["stampChanged", "semanticChanged", "proofChanged"] as const) {
      if (entry[field] !== null && typeof entry[field] !== "boolean") issues.push(`${prefix}.${field} must be a boolean or null`);
    }
    if (typeof entry.outputChanged !== "boolean") issues.push(`${prefix}.outputChanged must be a boolean`);
    if (!(PROJECTION_TARGET_CHANGE_PLANNED_ACTIONS as readonly string[]).includes(entry.plannedAction)) issues.push(`${prefix}.plannedAction is unsupported`);
    if ((entry.stampChanged === true) !== has(["source-stamp-changed"])) issues.push(`${prefix}.stampChanged must be true exactly when source-stamp-changed is reported`);
    if ((entry.semanticChanged === true) !== has(TARGET_CHANGE_SEMANTIC_REASONS)) issues.push(`${prefix}.semanticChanged must be true exactly when semantic-fingerprint-changed or model-digest-changed is reported`);
    if ((entry.proofChanged === true) !== has(TARGET_CHANGE_PROOF_REASONS)) issues.push(`${prefix}.proofChanged must be true exactly when flow-proof-changed or selector-evidence-changed is reported`);
    if (entry.outputChanged !== has(TARGET_CHANGE_OUTPUT_REASONS)) issues.push(`${prefix}.outputChanged must be true exactly when an output reason code is reported`);
    if ((entry.stampChanged === null || entry.semanticChanged === null || entry.proofChanged === null) !== has(TARGET_CHANGE_UNKNOWN_REASONS)) {
      issues.push(`${prefix} must report baseline-missing or target-row-missing exactly when a comparison is unknown`);
    }
    const derived = projectionTargetChangeClassification(entry);
    if (entry.classification !== derived) issues.push(`${prefix}.classification must be ${derived} for its comparisons and reason codes`);
    if ((entry.classification === "unchanged") !== (entry.reasonCodes.length === 0)) issues.push(`${prefix}.reasonCodes must be empty exactly when classification is unchanged`);
    if (entry.classification === "unchanged" && entry.affectedCapabilityIds.length > 0) issues.push(`${prefix} is unchanged, so affectedCapabilityIds must be empty`);
    if (entry.classification === "blocked" && entry.plannedAction !== "none") issues.push(`${prefix} is blocked, so plannedAction must be none`);
    if (entry.plannedAction !== "none" && entry.outputChanged !== true) issues.push(`${prefix} writes its file, so outputChanged must be true`);
    const file = fileByPath.get(entry.path);
    const fileAction = file === undefined || file.action === "unchanged" ? "none" : file.action;
    const rejected = has(["adoption-required", "ambiguous-ownership"]);
    if (entry.plannedAction !== fileAction && !(rejected && entry.plannedAction === "none" && fileAction === "update")) {
      issues.push(`${prefix}.plannedAction must be ${fileAction}, the files[] action for ${entry.path}`);
    }
  }
  return issues;
}

export function projectionFreshnessIssues(input: ProjectionFreshnessV1): string[] {
  const issues = [
    ...sortedUniqueIssues("freshness.reasonCodes", input.reasonCodes),
    ...sortedUniqueIssues("freshness.staleNodes.nodeId", input.staleNodes.map((node) => node.nodeId))
  ];
  const unsupported = input.reasonCodes.find((code) => !(PROJECTION_FRESHNESS_REASON_CODES as readonly string[]).includes(code));
  if (unsupported) issues.push(`freshness.reasonCodes contains an unsupported code: ${unsupported}`);
  if (input.ok !== (input.reasonCodes.length === 0)) issues.push("freshness.ok must be true exactly when reasonCodes is empty");
  if ((input.staleNodes.length > 0) !== input.reasonCodes.includes("projection-source-changed-since-stamp")) {
    issues.push("freshness.staleNodes must be non-empty exactly when projection-source-changed-since-stamp is reported");
  }
  for (const [index, node] of input.staleNodes.entries()) {
    const prefix = `freshness.staleNodes[${index}]`;
    if (node.nodeId.trim() === "") issues.push(`${prefix}.nodeId must not be empty`);
    if (!SHA256_DIGEST.test(node.stampedDigest) || !SHA256_DIGEST.test(node.currentDigest)) issues.push(`${prefix} digests must be SHA-256 digests`);
    else if (node.stampedDigest === node.currentDigest) issues.push(`${prefix} must name two different digests`);
  }
  return issues;
}

export function projectionArchitectureDebtIssues(input: ProjectionArchitectureDebtV1): string[] {
  const issues = [
    ...sortedUniqueIssues("architectureDebt.coverageReasonCodes", input.coverageReasonCodes),
    ...sortedUniqueIssues("architectureDebt.items", input.items.map((item) => JSON.stringify([item.fromCapabilityId, item.toCapabilityId])))
  ];
  if (!(["complete", "partial", "unknown"] as const).includes(input.coverage)) issues.push("architectureDebt.coverage is unsupported");
  const unsupported = input.coverageReasonCodes.find((code) => !(PROJECTION_ARCHITECTURE_DEBT_COVERAGE_REASON_CODES as readonly string[]).includes(code));
  if (unsupported) issues.push(`architectureDebt.coverageReasonCodes contains an unsupported code: ${unsupported}`);
  if ((input.coverage === "complete") !== (input.coverageReasonCodes.length === 0)) {
    issues.push("architectureDebt.coverageReasonCodes must be empty exactly when coverage is complete");
  }
  if ((input.coverage === "unknown") !== input.coverageReasonCodes.includes("code-facts-unavailable")) {
    issues.push("architectureDebt.coverage must be unknown exactly when code-facts-unavailable is reported");
  }
  if (input.coverage === "unknown" && input.items.length > 0) issues.push("architectureDebt.items must be empty when coverage is unknown");
  for (const [index, item] of input.items.entries()) {
    const prefix = `architectureDebt.items[${index}]`;
    if (!(PROJECTION_ARCHITECTURE_DEBT_REASON_CODES as readonly string[]).includes(item.reasonCode)) issues.push(`${prefix}.reasonCode is unsupported`);
    if (item.fromCapabilityId.trim() === "" || item.toCapabilityId.trim() === "") issues.push(`${prefix} must name two capabilities`);
    else if (item.fromCapabilityId === item.toCapabilityId) issues.push(`${prefix} must name two different capabilities`);
    if (!Number.isSafeInteger(item.importEdgeCount) || item.importEdgeCount < 1) issues.push(`${prefix}.importEdgeCount must be a positive integer`);
  }
  return issues;
}

export function projectionPriorCommittedAppliesIssues(
  input: readonly ProjectionPriorCommittedApplyV1[],
  requestId: string
): string[] {
  const issues = sortedUniqueIssues("priorCommittedApplies.changeSetId", input.map((entry) => entry.changeSetId));
  if (input.length === 0) issues.push("priorCommittedApplies must be omitted instead of empty");
  for (const [index, entry] of input.entries()) {
    const prefix = `priorCommittedApplies[${index}]`;
    issues.push(...sortedUniqueIssues(`${prefix}.files.path`, entry.files.map((file) => file.path)));
    if (entry.requestId !== requestId) issues.push(`${prefix}.requestId must match the projection result requestId`);
    if (entry.changeSetId.trim() === "") issues.push(`${prefix}.changeSetId must not be empty`);
    if (!ISO_INSTANT.test(entry.committedAt)) issues.push(`${prefix}.committedAt must be an ISO-8601 UTC instant`);
    if (entry.files.length === 0) issues.push(`${prefix}.files must name at least one committed file`);
    if ((entry.applyId === undefined) !== (entry.lookupKey === undefined)) {
      issues.push(`${prefix}.applyId and lookupKey must be present together or both absent`);
    }
    for (const field of ["applyId", "lookupKey"] as const) {
      const value = entry[field];
      if (value !== undefined && !SHA256_DIGEST.test(value)) issues.push(`${prefix}.${field} must be a SHA-256 digest`);
    }
    for (const [fileIndex, file] of entry.files.entries()) {
      const filePrefix = `${prefix}.files[${fileIndex}]`;
      if (!isRepoRelativePosixPath(file.path)) issues.push(`${filePrefix}.path must be a repository-relative POSIX path`);
      if (!(PROJECTION_PRIOR_COMMITTED_APPLY_OPERATIONS as readonly string[]).includes(file.operation)) {
        issues.push(`${filePrefix}.operation must be a supported committed operation`);
      }
      const expectsMissing = file.operation === "delete";
      if (expectsMissing && file.hash !== "missing") issues.push(`${filePrefix}.hash must be "missing" for a delete`);
      if (!expectsMissing && !SHA256_DIGEST.test(file.hash)) issues.push(`${filePrefix}.hash must be a SHA-256 body digest`);
    }
  }
  return issues;
}

/**
 * Computes the accepted projection receipt. Signal back-references are omitted from the
 * receipt payload to avoid a circular hash; every signal must then bind that receipt via
 * projectionReceiptDigest, which projectionResultInvariantIssues verifies.
 */
export function projectionResultReceiptDigest(input: Omit<ProjectionResultV2, "receiptDigest">): Sha256Digest {
  const { replayed: _replayed, written: _written, ...payload } = input;
  const refreshSignals = payload.refreshSignals.map(({ projectionReceiptDigest: _projectionReceiptDigest, ...signal }) => signal);
  return digestJson({ ...payload, refreshSignals } as unknown as Json) as Sha256Digest;
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
  // A partial projection is never accepted, so no receipt ever records one.
  if (input.result.coverage !== undefined) issues.push("projection apply receipt result must cover every target");
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

export function projectionApplyReadbackResultDigest(input: Omit<ProjectionApplyReadbackResultV1, "readbackDigest">): Sha256Digest {
  return digestJson(input as unknown as Json) as Sha256Digest;
}

export function projectionApplyReadbackResultInvariantIssues(
  input: ProjectionApplyReadbackResultV1,
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

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function sortedUniqueIssues(label: string, values: readonly string[]): string[] {
  const expected = [...new Set(values)].sort();
  return expected.length === values.length && expected.every((value, index) => value === values[index])
    ? []
    : [`${label} must be sorted and unique`];
}
