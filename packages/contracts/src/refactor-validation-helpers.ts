import type { RecommendationAuthorV1, RecommendationCategory } from "./ledger-records";
import type {
  PracticeRecommendationPayloadV1,
  RecommendationPayloadV1,
  RefactorProposalPayloadV1,
  StructuralObservationPayloadV1
} from "./ledger";
import {
  REFACTOR_EVIDENCE_SPECIFIER_MAX_LENGTH,
  REFACTOR_PROPOSAL_AUTHOR_KINDS,
  REFACTOR_PROPOSAL_AUTHOR_PAIRS,
  REFACTOR_PROPOSAL_AUTHOR_SOURCES,
  type RefactorProposalAuthorKind,
  type RefactorProposalAuthorSource
} from "./refactor-constants";
import type { ArchitectureTargetDeltaV1, RefactorTargetOutcomeV1 } from "./refactor-types";
import { isCanonicalRepoRelativePosixPath, isRepoRelativePosixPath, type Json } from "./schema";

export const DIGEST_PREFIX_LENGTH = "sha256:".length;
export const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
export const BARE_SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const GIT_HEAD_SHA_PATTERN = /^[a-f0-9]{40}$/;

export function authoredTargetDelta(delta: ArchitectureTargetDeltaV1): Omit<ArchitectureTargetDeltaV1, "interventionId" | "unresolvedTargets" | "extensions"> {
  const {
    interventionId: _interventionId,
    unresolvedTargets: _unresolvedTargets,
    extensions: _extensions,
    ...authored
  } = delta;
  return authored;
}

export function isRefactorProposalAuthorSource(source: string): source is RefactorProposalAuthorSource {
  return (REFACTOR_PROPOSAL_AUTHOR_SOURCES as readonly string[]).includes(source);
}

export function isRefactorProposalAuthorKind(kind: string): kind is RefactorProposalAuthorKind {
  return (REFACTOR_PROPOSAL_AUTHOR_KINDS as readonly string[]).includes(kind);
}

export function refactorProposalAuthorIssues(author: RecommendationAuthorV1, prefix: string): string[] {
  const issues: string[] = [];
  if (author.id.trim() === "") issues.push(`${prefix}.authoredBy.id must not be empty`);
  if (!isRefactorProposalAuthorSource(author.source)) {
    issues.push(`${prefix}.authoredBy.source must not be ${author.source}; refactor proposals are agent or human authored`);
  }
  if (!isRefactorProposalAuthorKind(author.kind)) {
    issues.push(`${prefix}.authoredBy.kind must not be ${author.kind}; refactor proposals are agent or human authored`);
    return issues;
  }
  if (isRefactorProposalAuthorSource(author.source) && !REFACTOR_PROPOSAL_AUTHOR_PAIRS[author.kind].includes(author.source)) {
    issues.push(`${prefix}.authoredBy.kind ${author.kind} is not compatible with source ${author.source}`);
  }
  return issues;
}

export function outcomeSatisfied(expected: RefactorTargetOutcomeV1, observedValue: number | null): boolean {
  switch (expected.operator) {
    case "absent":
      return observedValue === null || observedValue === 0;
    case "present":
      return observedValue !== null && observedValue !== 0;
    case "equals":
      return observedValue !== null && expected.value !== null && observedValue === expected.value;
    case "greater_than":
      return observedValue !== null && expected.value !== null && observedValue > expected.value;
    case "less_than":
      return observedValue !== null && expected.value !== null && observedValue < expected.value;
  }
}

export function recommendationPayloadShapeIssues(
  category: RecommendationCategory,
  payload: RecommendationPayloadV1,
  prefix: string
): string[] {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return [`${prefix}.payload must be an object for category ${category}`];
  }
  const record = payload as unknown as Record<string, unknown>;
  const required = REQUIRED_PAYLOAD_FIELDS[category];
  const missing = required.filter((field) => !(field in record));
  return missing.length === 0 ? [] : [`${prefix}.payload does not match category ${category}; missing ${missing.sort().join(", ")}`];
}

export function nonNegativeIntegerIssues(label: string, value: number | null): string[] {
  if (value === null) return [];
  return Number.isInteger(value) && value >= 0 ? [] : [`${label} must be a non-negative integer`];
}

export function ratioIssues(label: string, value: number | null): string[] {
  if (value === null) return [];
  return Number.isFinite(value) && value >= 0 && value <= 1 ? [] : [`${label} must be a ratio between 0 and 1`];
}

const REQUIRED_PAYLOAD_FIELDS: Readonly<Record<RecommendationCategory, readonly string[]>> = {
  practice: ["baselineDigest", "practiceId"],
  refactor_proposal: [
    "affectedNodeIds",
    "assessmentDigest",
    "baselineSnapshotDigest",
    "killList",
    "majorChangeReasons",
    "proposalDigest",
    "scale",
    "targetOutcomes"
  ],
  structural_observation: [
    "affectedNodeIds",
    "assessmentDigest",
    "baselineSnapshotDigest",
    "derivedOutcomes",
    "evidence",
    "kind",
    "metrics",
    "signalIds"
  ]
};

export function fingerprintPayloadSubset(category: RecommendationCategory, payload: RecommendationPayloadV1): Record<string, Json> {
  if (category === "practice") {
    return { baselineDigest: (payload as PracticeRecommendationPayloadV1).baselineDigest };
  }
  if (category === "structural_observation") {
    const observation = payload as StructuralObservationPayloadV1;
    return { kind: observation.kind, affectedNodeIds: [...observation.affectedNodeIds].sort() };
  }
  const proposal = payload as RefactorProposalPayloadV1;
  return {
    proposalDigest: proposal.proposalDigest,
    scale: proposal.scale,
    affectedNodeIds: [...proposal.affectedNodeIds].sort(),
    majorChangeReasons: [...proposal.majorChangeReasons].sort()
  };
}

export function outcomeIssues(label: string, outcomes: readonly RefactorTargetOutcomeV1[]): string[] {
  const issues = sortedUniqueIssues(`${label}.outcomeId`, outcomes.map((outcome) => outcome.outcomeId));
  for (const outcome of outcomes) {
    if (outcome.memberNodeIds !== undefined) {
      if (!Array.isArray(outcome.memberNodeIds) || outcome.memberNodeIds.length < 2) {
        issues.push(`${label} memberNodeIds must list at least two modules`);
      } else {
        issues.push(...sortedUniqueIssues(`${label}.memberNodeIds`, outcome.memberNodeIds));
      }
    }
    const valueless = outcome.operator === "absent" || outcome.operator === "present";
    if (valueless && outcome.value !== null) issues.push(`${label} operator ${outcome.operator} must not carry a value`);
    if (!valueless && outcome.value === null) issues.push(`${label} operator ${outcome.operator} requires a value`);
    if (outcome.metric.trim() === "") issues.push(`${label} metric must not be empty`);
  }
  return issues;
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** An unknown line sorts before every known one, so the order is total. */
export function compareLine(left: number | null, right: number | null): number {
  return (left ?? 0) - (right ?? 0);
}

export function repoPathIssues(label: string, path: string): string[] {
  return typeof path === "string" && isRepoRelativePosixPath(path) ? [] : [`${label} must be a repo-relative POSIX path`];
}

export function canonicalRepoPathIssues(label: string, path: string): string[] {
  return typeof path === "string" && isCanonicalRepoRelativePosixPath(path) ? [] : [`${label} must be a canonical repo-relative POSIX path`];
}

export function lineIssues(label: string, line: number | null): string[] {
  return line === null || (Number.isInteger(line) && line >= 1) ? [] : [`${label} must be null or a positive integer`];
}

export function specifierIssues(label: string, specifier: string): string[] {
  return typeof specifier === "string"
    && specifier.length > 0
    && specifier.length <= REFACTOR_EVIDENCE_SPECIFIER_MAX_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(specifier)
    ? []
    : [`${label} must be a single-line specifier of 1-${REFACTOR_EVIDENCE_SPECIFIER_MAX_LENGTH} characters`];
}

export function digestIssues(label: string, value: string): string[] {
  return SHA256_DIGEST_PATTERN.test(value) ? [] : [`${label} must be a sha256:<64-hex> digest`];
}

export function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}

export function sortedUniqueIssues(label: string, values: readonly string[]): string[] {
  const expected = [...new Set(values)].sort();
  return expected.length === values.length && expected.every((value, index) => value === values[index])
    ? []
    : [`${label} must be sorted and unique`];
}
