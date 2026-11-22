export const PROJECTION_REQUEST_SCHEMA_VERSION = "archcontext.projection-request/v1" as const;
export const PROJECTION_RESULT_SCHEMA_VERSION = "archcontext.projection-result/v3" as const;
export const PROJECTION_APPLY_IDENTITY_SCHEMA_VERSION = "archcontext.projection-apply-identity/v1" as const;
export const PROJECTION_APPLY_RECEIPT_SCHEMA_VERSION = "archcontext.projection-apply-receipt/v1" as const;
export const PROJECTION_APPLY_RECOVERY_BINDING_SCHEMA_VERSION = "archcontext.projection-apply-recovery-binding/v2" as const;
export const PROJECTION_APPLY_RECOVERY_INTENT_SCHEMA_VERSION = "archcontext.projection-apply-recovery-intent/v1" as const;
export const PROJECTION_APPLY_RECOVERY_PROOF_SCHEMA_VERSION = "archcontext.projection-apply-recovery-proof/v2" as const;
export const PROJECTION_APPLY_RECOVERY_RESULT_SCHEMA_VERSION = "archcontext.projection-apply-recovery-result/v2" as const;
export const PROJECTION_APPLY_READBACK_RESULT_SCHEMA_VERSION = "archcontext.projection-apply-readback-result/v2" as const;
export const ARCHITECTURE_REFRESH_SIGNAL_SCHEMA_VERSION = "archcontext.architecture-refresh-signal/v2" as const;
export const ARCHCTX_CAPABILITIES_SCHEMA_VERSION = "archcontext.capabilities/v1" as const;
export const ARCHITECTURE_DOCS_RENDERER_VERSION = "archcontext.docs-renderer/v6" as const;
/**
 * The committed projection manifest's path. `projection-manifest.ts` owns its shape and byte layout;
 * the path lives here because a projection result's `files[]` names the manifest write.
 */
export const ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH = "docs/architecture/.projection-manifest.json" as const;
export const AGENT_CONTEXT_RENDERER_VERSION = "archcontext.agent-context-renderer/v2" as const;

export const PROJECTION_MODES = ["check", "plan", "apply", "adopt"] as const;
export const PROJECTION_PRIOR_COMMITTED_APPLY_OPERATIONS = ["delete", "write"] as const;
export const PROJECTION_TARGETS = ["agent-context", "architecture-docs", "architecture-history"] as const;
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
  "cli-check-v1",
  "code-facts-unavailable-error-v1",
  "deps-calls-matrix-v1",
  "docs-anchors-v1",
  "flow-selector-check-v1",
  "host-ownership-isolation-v1",
  "index-seed-v1",
  "module-statistics-v1",
  "native-context-export-v1",
  "projection-apply-receipt-v1",
  "projection-apply-replay-restore-v1",
  "projection-apply-replay-v1",
  "projection-architecture-debt-v1",
  "projection-capability-isolation-v1",
  "projection-change-classification-v2",
  "projection-check-freshness-v2",
  "projection-freshness-v2",
  "projection-manifest-contract-v4",
  "projection-observed-major-change-acceptance-v1",
  "projection-orphan-review-v1",
  "projection-preview-v1",
  "projection-prior-committed-applies-v1",
  "projection-protocol-v2",
  "projection-publish-v1",
  "projection-slice-v1",
  "projection-snapshot-v1",
  "projection-verify-pr-v1",
  "recommendation-scan-decision-v1",
  "recommendation-v3",
  "refactor-assessment-v1",
  "refactor-observation-evidence-v1",
  "refactor-radar-v2",
  "refactor-resolution-v1",
  "refactor-scan-limits-v1",
  "refactor-scan-untracked-count-v1",
  "refactor-simulate-v1",
  "refactor-symbol-kill-list-v1"
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
export const PROJECTION_SLICE_SCHEMA_VERSION = "archcontext.projection-slice/v1" as const;
export const PROJECTION_FILE_PREVIEW_FORMATS = ["body", "unified-diff"] as const;
/** Upper bound, in UTF-8 bytes, on one `files[].preview.content`. */
export const PROJECTION_FILE_PREVIEW_MAX_BYTES = 65_536;
/** Upper bound, in UTF-8 bytes, on the sum of every `files[].preview.content` of one result. */
export const PROJECTION_PREVIEW_TOTAL_MAX_BYTES = 1_048_576;

/**
 * Why a projection is not fresh (ADR-0056 §1). Shared by the engine's freshness evaluator and the
 * `check` result's `freshness` field so the two can never disagree. `projection-output-changed`:
 * a target renders an output other than its committed row's (`staleTargets`).
 * `projection-manifest-changed`: every output equals its row, but the manifest the render would
 * write differs from the committed bytes (the semantic baseline or a header line).
 */
export const PROJECTION_FRESHNESS_REASON_CODES = [
  "projection-manifest-changed",
  "projection-manifest-missing",
  "projection-manifest-unreadable",
  "projection-output-changed"
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
 * current-format manifest, or no committed row for the target), `semantic-change`, `output-change`
 * and `unchanged`.
 * `projectionTargetChangeClassification` is the one precedence rule.
 */
export const PROJECTION_TARGET_CHANGE_CLASSIFICATIONS = [
  "baseline-missing",
  "blocked",
  "output-change",
  "proof-change",
  "semantic-change",
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
 * Why a target is classified as it is. Each comparison flag has its codes: `semanticChanged` is `semantic-fingerprint-changed` or, for a target that
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
