export interface ArchitectureSinkSelectorV2 {
  id: string;
  path: string;
  symbol: string;
}

export interface ArchitectureEntrypointSymbolV2 {
  name: string;
  sinks: ArchitectureSinkSelectorV2[];
}

export interface ArchitectureEntrypointV2 {
  id: string;
  path: string;
  symbols: ArchitectureEntrypointSymbolV2[];
}

export interface ArchitectureNodeSourceV2 {
  include?: string[];
  exclude?: string[];
  entrypoints?: ArchitectureEntrypointV2[];
}

export interface ArchitectureFlowEvidenceSelectorV1 {
  entrypointId: string;
  sourceSymbol: string;
  sinkId: string;
}

export interface ArchitectureFlowParticipantV1 {
  id: string;
  nodeId: string;
}

export interface ArchitectureFlowStepV1 {
  id: string;
  from: string;
  to: string;
  label: string;
  evidence: ArchitectureFlowEvidenceSelectorV1;
}

export interface ArchitectureFlowOutcomeV1 {
  id: string;
  kind: "success" | "error";
  label: string;
  steps: ArchitectureFlowStepV1[];
  terminal: {
    participant: string;
    label: string;
  };
}

export type ArchitectureFlowV1 = ArchitectureRequiredFlowV1 | ArchitectureNotApplicableFlowV1;

interface ArchitectureFlowBaseV1 {
  schemaVersion: "archcontext.flow/v1";
  id: string;
  capabilityId: string;
  name: string;
}

export interface ArchitectureRequiredFlowV1 extends ArchitectureFlowBaseV1 {
  applicability: "required";
  participants: ArchitectureFlowParticipantV1[];
  steps: ArchitectureFlowStepV1[];
  outcomes: ArchitectureFlowOutcomeV1[];
}

export interface ArchitectureNotApplicableFlowV1 extends ArchitectureFlowBaseV1 {
  applicability: "not-applicable";
  rationale: string;
}

/**
 * A `forbid-dependency` constraint (`archcontext.constraint/v1`), narrowed to the fields the
 * dependency gate evaluates. A file owned by a `scope.nodes` node (or a descendant) must not
 * import a file owned by a `rule.targets` node (or a descendant). v1 has no `allowedVia` escape.
 */
export interface DependencyConstraintV1 {
  id: string;
  severity: "error" | "warning";
  scope: { nodes: string[] };
  rule: { type: "forbid-dependency"; targets: string[] };
  rationale: string;
}

export const DEPENDENCY_CONSTRAINT_STATUSES = ["not-applicable", "pass", "undetermined", "violated"] as const;
export type DependencyConstraintStatus = (typeof DEPENDENCY_CONSTRAINT_STATUSES)[number];

/**
 * Why a dependency result is not a complete observation: no index answered, the index attested
 * to a different worktree, the import dump hit its limit, or a constrained file carries a
 * repository-local import that resolved to no file.
 */
export const DEPENDENCY_CONSTRAINT_REASON_CODES = [
  "code-facts-stale",
  "code-facts-truncated",
  "code-facts-unavailable",
  "unresolved-import"
] as const;
export type DependencyConstraintReasonCode = (typeof DEPENDENCY_CONSTRAINT_REASON_CODES)[number];

export interface DependencyConstraintViolationV1 {
  constraintId: string;
  fromPath: string;
  toPath: string;
  fromNode: string;
  toNode: string;
  severity: "error" | "warning";
}

export interface DependencyConstraintEvaluationV1 {
  schemaVersion: "archcontext.dependency-constraint-evaluation/v1";
  status: DependencyConstraintStatus;
  /** `complete` only when an index attested to the evaluated worktree and was not truncated. */
  coverage: "complete" | "partial" | "unknown";
  reasonCodes: DependencyConstraintReasonCode[];
  constraintIds: string[];
  /** Import observations the evaluation read; zero when the index did not attest to this tree. */
  importEdgeCount: number;
  /** Repository-local specifiers from constrained files that resolved to no file. */
  unresolvedImports: { from: string; specifier: string }[];
  violations: DependencyConstraintViolationV1[];
}

/**
 * The closed `failOn` vocabulary of `.archcontext/policies/review.yaml`. A review finding in one
 * of these categories blocks only when its category is listed; findings outside the vocabulary
 * are never affected by the policy.
 */
export const REVIEW_FAIL_ON_CATEGORIES = [
  "incomplete-intervention",
  "invalid-schema",
  "prohibited-dependency",
  "stale-context",
  "unjustified-compatibility"
] as const;
export type ReviewFailOnCategory = (typeof REVIEW_FAIL_ON_CATEGORIES)[number];

/**
 * The effective review policy. An error in a category missing from `failOn` is downgraded to a
 * warning, with one exception: the task-snapshot HEAD-mismatch `stale-context` finding always stays
 * an error, because a stale snapshot skips every other review gate.
 */
export interface ReviewPolicyV1 {
  failOn: ReviewFailOnCategory[];
  /** `default` when no policy file declares `failOn`, or it is unreadable: every category blocks. */
  source: "policy-file" | "default";
}
