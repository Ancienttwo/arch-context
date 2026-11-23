import type {
  ArchitectureActorKind,
  ArchitectureSubjectSelectorKind,
  RecommendationStatus
} from "./ledger-records";
import { isCanonicalRepoRelativePosixPath } from "./schema";

/**
 * The bounded grammar an execution evidence `locator` must fit: 1..256 characters drawn from the
 * unreserved plus sub-delims/gen-delims set that repo-relative paths and URLs already live in.
 *
 * A locator is a *reference*, not a body. Left unbounded it is a string field on a record whose
 * envelope promises `privacy.rawDiffPersisted: false`, so a caller could park a whole diff, a
 * credential, or a multi-line prompt in it and the digest check would still pass. Whitespace,
 * newlines and control characters are the shapes that only a body has, and the length ceiling is
 * what stops a single-line body from riding through anyway.
 */
export const REFACTOR_EXECUTION_EVIDENCE_LOCATOR_PATTERN = /^[A-Za-z0-9._~:\/?#@!$&'()*+,;=%-]{1,256}$/;

/** The single sentence every ingress uses to name the locator rule, so they cannot drift apart. */
export const REFACTOR_EXECUTION_EVIDENCE_LOCATOR_RULE =
  "must be a bounded reference: 1-256 characters from [A-Za-z0-9._~:/?#@!$&'()*+,;=%-], no whitespace or control characters";

/** The only top-level keys a verification request may carry; anything else is a caller typo. */
export const REFACTOR_VERIFICATION_REQUEST_KEYS = [
  "executionEvidenceRefs",
  "expectedHeadSha",
  "expectedWorktreeDigest",
  "importNodeLimit",
  "recommendationId",
  "schemaVersion"
] as const;

/**
 * The grammar of the refactor identity namespace: the manifest `product.id`, which scopes every
 * refactor subject selector so one subject has one recommendation id in every worktree, branch and
 * clone (ADR-0046). It is the declared-id grammar node ids use, without the cross-repo prefix.
 */
export const REFACTOR_NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/;

/** Issues with a refactor namespace value; empty when it is a well-formed `product.id`. */
export function refactorNamespaceIssues(value: unknown, label = "product.id"): string[] {
  if (typeof value !== "string") return [`${label} must be a string`];
  if (value.trim() === "") return [`${label} must not be blank`];
  return REFACTOR_NAMESPACE_PATTERN.test(value)
    ? []
    : [`${label} must match ${REFACTOR_NAMESPACE_PATTERN.source}`];
}

export const REFACTOR_REQUEST_SCHEMA_VERSION = "archcontext.refactor-request/v1" as const;
export const REFACTOR_PROPOSAL_SCHEMA_VERSION = "archcontext.refactor-proposal/v1" as const;
export const MODULE_STATISTICS_SCHEMA_VERSION = "archcontext.module-statistics/v1" as const;
export const REFACTOR_ASSESSMENT_SCHEMA_VERSION = "archcontext.refactor-assessment/v1" as const;
export const REFACTOR_RESOLUTION_EVIDENCE_SCHEMA_VERSION = "archcontext.refactor-resolution-evidence/v1" as const;
export const REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION = "archcontext.refactor-verification-request/v1" as const;

export const REFACTOR_SCALES = [
  "architecture",
  "cross_module",
  "insufficient_evidence",
  "model_adoption_required",
  "module"
] as const;
export const REFACTOR_SCALE_REASON_CODES = [
  "caller-coverage-unknown",
  "code-facts-import-limit",
  "code-facts-missing",
  "code-facts-truncated",
  "major-change-detected",
  "multi-node-scope",
  "node-footprint-undeclared",
  "ownership-ambiguous",
  "single-node-scope",
  "target-unresolved",
  "unowned-paths"
] as const;
/**
 * `cycle` is one bidirectional module pair; `residual-cycle` is a strongly connected component that
 * survives cutting the thin direction of every pair (ADR-0046).
 */
export const REFACTOR_OBSERVATION_KINDS = [
  "co-change-coupling",
  "cycle",
  "direction-violation",
  "entrypoint-bypass",
  "evidence-gap",
  "low-cohesion-god-file",
  "ownership-ambiguous",
  "residual-cycle",
  "undeclared-footprint",
  "unowned-paths",
  "unstable-dependency"
] as const;
export const REFACTOR_DETECTOR_EXTRA_KINDS = [
  "component-cycle",
  "dead-public-export",
  "file-cycle",
  "god-file",
  "purity-violation",
  "shotgun-surgery-hotspot",
  "undeclared-dependency"
] as const;
export const REFACTOR_RESOLUTION_DISPOSITIONS = [
  "not_improved",
  "partially_resolved",
  "regressed",
  "resolved",
  "stale"
] as const;
export const REFACTOR_OUTCOME_OPERATORS = ["absent", "equals", "greater_than", "less_than", "present"] as const;
export const REFACTOR_OUTCOME_DIRECTIONS = ["improved", "regressed", "unchanged", "unknown"] as const;
export const REFACTOR_KILL_LIST_KINDS = ["path", "relation", "symbol"] as const;
export const REFACTOR_EXECUTION_EVIDENCE_KINDS = [
  "acceptance_receipt",
  "cutover_closure",
  "merge_receipt",
  "task_contract"
] as const;
export const REFACTOR_PROPOSAL_AUTHOR_SOURCES = ["cli", "manual", "mcp", "subagent"] as const;
export const REFACTOR_PROPOSAL_AUTHOR_KINDS = ["cli", "developer", "mcp", "subagent"] as const;
/**
 * A refactor proposal is authored by an agent surface acting for itself, or by
 * a human acting manually. `daemon`, `system`, `hook`, and `migration` kinds
 * are ArchContext acting on its own behalf and can never author a proposal.
 */
export const REFACTOR_PROPOSAL_AUTHOR_PAIRS: Readonly<Record<RefactorProposalAuthorKind, readonly RefactorProposalAuthorSource[]>> = {
  cli: ["cli"],
  developer: ["manual"],
  mcp: ["mcp"],
  subagent: ["subagent"]
};
export const MODULE_DYNAMIC_INVOCATION_LEVELS = ["known", "none_observed", "possible", "unknown"] as const;
export const MODULE_TESTS_COVERAGE_STATUSES = ["measured", "partial", "unknown"] as const;

export type RefactorScale = (typeof REFACTOR_SCALES)[number];
export type RefactorScaleReasonCode = (typeof REFACTOR_SCALE_REASON_CODES)[number];
export type RefactorObservationKind = (typeof REFACTOR_OBSERVATION_KINDS)[number];
export type RefactorResolutionDisposition = (typeof REFACTOR_RESOLUTION_DISPOSITIONS)[number];
export type RefactorOutcomeOperator = (typeof REFACTOR_OUTCOME_OPERATORS)[number];
export type RefactorOutcomeDirection = (typeof REFACTOR_OUTCOME_DIRECTIONS)[number];
export type RefactorKillListKind = (typeof REFACTOR_KILL_LIST_KINDS)[number];
export type RefactorExecutionEvidenceKind = (typeof REFACTOR_EXECUTION_EVIDENCE_KINDS)[number];
export type RefactorProposalAuthorSource = (typeof REFACTOR_PROPOSAL_AUTHOR_SOURCES)[number];
export type RefactorProposalAuthorKind = (typeof REFACTOR_PROPOSAL_AUTHOR_KINDS)[number];
export type ModuleDynamicInvocationLevel = (typeof MODULE_DYNAMIC_INVOCATION_LEVELS)[number];
export type ModuleTestsCoverageStatus = (typeof MODULE_TESTS_COVERAGE_STATUSES)[number];

/**
 * The fixed per-observation bound on sampled evidence entries (edges, violations, paths,
 * unresolved imports). It bounds entry *count* only: a path or a specifier has no fixed byte
 * size, so this bound alone does not keep a recording event under the ledger's persisted-JSON
 * ceiling. The recording planner enforces that separately, by measuring the event it would
 * persist and shrinking every sample to one shared smaller limit until the event fits.
 */
export const REFACTOR_OBSERVATION_EVIDENCE_LIMIT = 20;
/**
 * The fixed bound on every id list inside evidence (`memberNodeIds`, `constraintIds`,
 * `candidateOwnerNodeIds`). Each list is the sorted prefix of its population and carries the true
 * size beside it (`metrics.memberCount`, `constraintCount`, `candidateOwnerCount`). It is no
 * smaller than `REFACTOR_OBSERVATION_EVIDENCE_LIMIT`, so the constraints named by a violation
 * sample — the smallest ids, since violations sort by constraint first — are always listed.
 */
export const REFACTOR_EVIDENCE_ID_LIST_LIMIT = 32;
/** An import specifier is a module reference, not code: one line, bounded like a locator. */
export const REFACTOR_EVIDENCE_SPECIFIER_MAX_LENGTH = 512;

/**
 * The fingerprint schema every refactor recommendation id is derived under. v3 is the first whose
 * subject selector is scoped by the product namespace instead of the worktree path (ADR-0046).
 * Owned here so the planner and the Git decision contract can never name two different versions.
 */
export const REFACTOR_RECOMMENDATION_FINGERPRINT_SCHEMA_VERSION = "archcontext.recommendation-fingerprint/v3" as const;

export const REFACTOR_DECISION_SCHEMA_VERSION = "archcontext.refactor-decision/v1" as const;
/** Git-visible home of human refactor decisions; outside `listModelFiles`, so never in `modelDigest`. */
export const REFACTOR_DECISION_DIRECTORY = ".archcontext/refactor-decisions" as const;
export const REFACTOR_DECISION_FILE_PATTERN = /^\.archcontext\/refactor-decisions\/(recommendation\.[a-f0-9]{16})\.json$/;
export const REFACTOR_RECOMMENDATION_ID_PATTERN = /^recommendation\.[a-f0-9]{16}$/;

/**
 * #636 / #643: Symbolic kill-list targets use `path#symbol`, where `path` is a safe repo-relative
 * POSIX path and `symbol` is a non-empty identifier without whitespace or control characters.
 */
export const REFACTOR_KILL_LIST_SYMBOL_TARGET_REGEX = "^(?![A-Za-z]:)(?!\\.\\.?(?:/|#))[^/#\\s\\\\\\u0000-\\u001f\\u007f]+(?:/(?!\\.\\.?(?:/|#))[^/#\\s\\\\\\u0000-\\u001f\\u007f]+)*#[^#\\s\\u0000-\\u001f\\u007f]+$";

export function formatRefactorKillListSymbolTarget(path: string, symbol: string): string {
  return `${path}#${symbol}`;
}

export function parseRefactorKillListSymbolTarget(target: string): { path: string; symbol: string } | undefined {
  const hashIndex = target.indexOf("#");
  if (hashIndex <= 0 || hashIndex === target.length - 1) return undefined;
  if (target.indexOf("#", hashIndex + 1) !== -1) return undefined;
  const path = target.slice(0, hashIndex);
  const symbol = target.slice(hashIndex + 1);
  if (!isCanonicalRepoRelativePosixPath(path) || /[\s\u0000-\u001f\u007f]/.test(path)) return undefined;
  if (/[\s\u0000-\u001f\u007f]/.test(symbol) || symbol.length === 0) return undefined;
  return { path, symbol };
}

export function isValidRefactorKillListSymbolTarget(target: string): boolean {
  return parseRefactorKillListSymbolTarget(target) !== undefined;
}
/** The six human statuses. `open` is a machine status and is never a decision. */
export const REFACTOR_DECISION_STATUSES = ["acknowledged", "accepted", "deferred", "rejected", "resolved", "waived"] as const;
export const REFACTOR_DECISION_REASON_MAX_LENGTH = 1024;
export const REFACTOR_DECISION_ACTOR_ID_MAX_LENGTH = 128;
export const REFACTOR_DECISION_STABLE_KEY_MAX_LENGTH = 512;

export type RefactorDecisionStatus = (typeof REFACTOR_DECISION_STATUSES)[number];
export type RefactorDecisionActorKind = ArchitectureActorKind;
export type RefactorDecisionSelectorKind = ArchitectureSubjectSelectorKind;
export type RefactorDecisionRecommendationStatus = RecommendationStatus;
