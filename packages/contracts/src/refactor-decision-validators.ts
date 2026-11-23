import type { ArchitectureActorKind, ArchitectureSubjectSelectorKind, RecommendationStatus } from "./ledger-records";
import {
  isValidRefactorKillListSymbolTarget,
  REFACTOR_DECISION_ACTOR_ID_MAX_LENGTH,
  REFACTOR_DECISION_DIRECTORY,
  REFACTOR_DECISION_FILE_PATTERN,
  REFACTOR_DECISION_REASON_MAX_LENGTH,
  REFACTOR_DECISION_SCHEMA_VERSION,
  REFACTOR_DECISION_STABLE_KEY_MAX_LENGTH,
  REFACTOR_DECISION_STATUSES,
  REFACTOR_DETECTOR_EXTRA_KINDS,
  REFACTOR_EVIDENCE_ID_LIST_LIMIT,
  REFACTOR_KILL_LIST_KINDS,
  REFACTOR_OBSERVATION_KINDS,
  REFACTOR_RECOMMENDATION_FINGERPRINT_SCHEMA_VERSION,
  REFACTOR_RECOMMENDATION_ID_PATTERN,
  refactorNamespaceIssues,
  type RefactorDecisionStatus
} from "./refactor-constants";
import type { RefactorDecisionV1 } from "./refactor-evidence-types";
import {
  canonicalRepoPathIssues,
  digestIssues,
  GIT_HEAD_SHA_PATTERN,
  outcomeIssues,
  repoPathIssues,
  sortedUniqueIssues
} from "./refactor-validation-helpers";

const REFACTOR_DECISION_ACTOR_KINDS: readonly ArchitectureActorKind[] = ["cli", "daemon", "developer", "hook", "mcp", "migration", "subagent", "system"];
const REFACTOR_DECISION_SELECTOR_KINDS: readonly ArchitectureSubjectSelectorKind[] = ["node", "repository"];
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const GIT_CONFLICT_MARKER_PATTERN = /^(<{7}|={7}|>{7}|\|{7})( |$)/m;

const REFACTOR_DECISION_KEYS = [
  "actor",
  "affectedNodeCount",
  "affectedNodeIds",
  "category",
  "decidedAt",
  "fingerprint",
  "fingerprintSchemaVersion",
  "kind",
  "namespace",
  "observationMetrics",
  "provenance",
  "reason",
  "recommendationId",
  "regressesFrom",
  "schemaVersion",
  "status",
  "subject"
] as const;
const REFACTOR_DECISION_OPTIONAL_KEYS = [
  "observationScopeDigest",
  "snapshotDigest",
  "evidenceDigest",
  "resolutionDigest",
  "scope",
  "importNodeLimit",
  "targetOutcomes",
  "killList"
] as const;

export function isRefactorDecisionStatus(status: RecommendationStatus | string): status is RefactorDecisionStatus {
  return (REFACTOR_DECISION_STATUSES as readonly string[]).includes(status);
}

/**
 * Who states a refactor recommendation's status (ADR-0046): its Git decision file
 * (`git-decision`), a machine status the ledger holds (`ledger`), or nobody — a human status the
 * ledger recorded whose Git file this checkout does not carry is audit only (`ledger-audit`): it
 * keeps its recorded status as history, is never reported as the current status of the subject,
 * and never appears in an open or status listing.
 */
export type RefactorStatusAuthority = "git-decision" | "ledger" | "ledger-audit";

/** The one status rule every reader shares. */
export function refactorRecommendationStatusView(
  ledgerStatus: RecommendationStatus,
  decided: RefactorDecisionStatus | undefined
): { status: RecommendationStatus; authority: RefactorStatusAuthority } {
  if (decided !== undefined) return { status: decided, authority: "git-decision" };
  return { status: ledgerStatus, authority: isRefactorDecisionStatus(ledgerStatus) ? "ledger-audit" : "ledger" };
}

/** The repository path of the decision file for one recommendation id. */
export function refactorDecisionPath(recommendationId: string): string {
  return `${REFACTOR_DECISION_DIRECTORY}/${recommendationId}.json`;
}

/**
 * The one serialization the daemon writes: two-space JSON, LF line endings, keys in declaration
 * order at every level (`observationMetrics` keys sorted), final newline. It does not depend on the
 * key order of the value it is given, so a parsed file serializes back to its own bytes only when
 * it is already canonical.
 */
export function serializeRefactorDecision(decision: RefactorDecisionV1): string {
  const canonical: RefactorDecisionV1 = {
    schemaVersion: decision.schemaVersion,
    namespace: decision.namespace,
    recommendationId: decision.recommendationId,
    fingerprint: decision.fingerprint,
    fingerprintSchemaVersion: decision.fingerprintSchemaVersion,
    category: decision.category,
    kind: decision.kind,
    subject: {
      selectorKind: decision.subject.selectorKind,
      stableKey: decision.subject.stableKey,
      subjectSelectorId: decision.subject.subjectSelectorId
    },
    affectedNodeIds: decision.affectedNodeIds,
    affectedNodeCount: decision.affectedNodeCount,
    regressesFrom: decision.regressesFrom,
    status: decision.status,
    observationMetrics: decision.observationMetrics === null
      ? null
      : Object.fromEntries(Object.entries(decision.observationMetrics).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))),
    ...(decision.observationScopeDigest === undefined ? {} : { observationScopeDigest: decision.observationScopeDigest }),
    reason: decision.reason,
    actor: { kind: decision.actor.kind, id: decision.actor.id },
    decidedAt: decision.decidedAt,
    provenance: {
      headSha: decision.provenance.headSha,
      assessmentDigest: decision.provenance.assessmentDigest,
      baselineSnapshotDigest: decision.provenance.baselineSnapshotDigest
    },
    ...(decision.snapshotDigest === undefined ? {} : { snapshotDigest: decision.snapshotDigest }),
    ...(decision.evidenceDigest === undefined ? {} : { evidenceDigest: decision.evidenceDigest }),
    ...(decision.resolutionDigest === undefined ? {} : { resolutionDigest: decision.resolutionDigest }),
    ...(decision.scope === undefined ? {} : { scope: decision.scope }),
    ...(decision.importNodeLimit === undefined ? {} : { importNodeLimit: decision.importNodeLimit }),
    ...(decision.targetOutcomes === undefined ? {} : { targetOutcomes: decision.targetOutcomes }),
    ...(decision.killList === undefined ? {} : { killList: decision.killList })
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

/**
 * Validates a decision value: closed key sets at every level, the frozen vocabularies, bounded
 * one-line strings and sorted bounded id lists. Identity that needs the core hashers (the
 * recommendation id from fingerprint and `regressesFrom`, the namespace-scoped selector) is checked
 * by the reader that has them.
 */
export function refactorDecisionInvariantIssues(value: unknown, prefix = "refactorDecision"): string[] {
  if (!isPlainObject(value)) return [`${prefix} must be an object`];
  const issues: string[] = [];
  const allowedKeys: readonly string[] = [...REFACTOR_DECISION_KEYS, ...REFACTOR_DECISION_OPTIONAL_KEYS];
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key)).sort();
  if (unknownKeys.length > 0) issues.push(`${prefix} has unsupported key(s): ${unknownKeys.join(", ")}`);
  const missing = REFACTOR_DECISION_KEYS.filter((key) => !(key in value));
  if (missing.length > 0) issues.push(`${prefix} is missing key(s): ${missing.join(", ")}`);
  if (issues.length > 0) return issues;
  const decision = value as unknown as RefactorDecisionV1;
  if (decision.schemaVersion !== REFACTOR_DECISION_SCHEMA_VERSION) issues.push(`${prefix}.schemaVersion must be ${REFACTOR_DECISION_SCHEMA_VERSION}`);
  issues.push(...refactorNamespaceIssues(decision.namespace, `${prefix}.namespace`));
  if (typeof decision.recommendationId !== "string" || !REFACTOR_RECOMMENDATION_ID_PATTERN.test(decision.recommendationId)) {
    issues.push(`${prefix}.recommendationId must match ${REFACTOR_RECOMMENDATION_ID_PATTERN.source}`);
  }
  if (typeof decision.fingerprint !== "string") issues.push(`${prefix}.fingerprint must be a sha256:<64-hex> digest`);
  else issues.push(...digestIssues(`${prefix}.fingerprint`, decision.fingerprint));
  if (decision.fingerprintSchemaVersion !== REFACTOR_RECOMMENDATION_FINGERPRINT_SCHEMA_VERSION) {
    issues.push(`${prefix}.fingerprintSchemaVersion must be ${REFACTOR_RECOMMENDATION_FINGERPRINT_SCHEMA_VERSION}`);
  }
  if (decision.category !== "structural_observation" && decision.category !== "refactor_proposal") {
    issues.push(`${prefix}.category must be structural_observation or refactor_proposal`);
  } else if (decision.category === "structural_observation"
    ? !(REFACTOR_OBSERVATION_KINDS as readonly unknown[]).includes(decision.kind)
      && !(REFACTOR_DETECTOR_EXTRA_KINDS as readonly unknown[]).includes(decision.kind)
    : decision.kind !== null) {
    issues.push(`${prefix}.kind must be an observation kind for structural_observation and null for refactor_proposal`);
  }
  issues.push(...decisionSubjectIssues(decision.subject, `${prefix}.subject`));
  if (!Array.isArray(decision.affectedNodeIds) || decision.affectedNodeIds.some((id) => typeof id !== "string" || id.trim() === "")) {
    issues.push(`${prefix}.affectedNodeIds must be an array of node ids`);
  } else {
    issues.push(...sortedUniqueIssues(`${prefix}.affectedNodeIds`, decision.affectedNodeIds));
    if (!Number.isInteger(decision.affectedNodeCount) || decision.affectedNodeCount < 0) {
      issues.push(`${prefix}.affectedNodeCount must be a non-negative integer`);
    } else if (decision.affectedNodeIds.length !== Math.min(decision.affectedNodeCount, REFACTOR_EVIDENCE_ID_LIST_LIMIT)) {
      issues.push(`${prefix}.affectedNodeIds must hold min(affectedNodeCount, ${REFACTOR_EVIDENCE_ID_LIST_LIMIT}) entries`);
    }
  }
  if (decision.regressesFrom !== null
    && (typeof decision.regressesFrom !== "string" || !REFACTOR_RECOMMENDATION_ID_PATTERN.test(decision.regressesFrom))) {
    issues.push(`${prefix}.regressesFrom must be null or a recommendation id`);
  }
  if (!isRefactorDecisionStatus(String(decision.status))) {
    issues.push(`${prefix}.status must be one of ${REFACTOR_DECISION_STATUSES.join(", ")}`);
  }
  if (decision.observationMetrics !== null) {
    if (!isPlainObject(decision.observationMetrics)
      || Object.entries(decision.observationMetrics).some(([key, metric]) =>
        key.trim() === "" || !(metric === null || (typeof metric === "number" && Number.isFinite(metric))))) {
      issues.push(`${prefix}.observationMetrics must be null or a map of finite numbers and nulls`);
    }
  }
  if (decision.observationScopeDigest !== undefined) {
    if (typeof decision.observationScopeDigest === "string") issues.push(...digestIssues(`${prefix}.observationScopeDigest`, decision.observationScopeDigest));
    else issues.push(`${prefix}.observationScopeDigest must be a digest`);
    if (decision.category !== "structural_observation" || decision.observationMetrics === null) {
      issues.push(`${prefix}.observationScopeDigest requires measured observation metrics`);
    }
  }
  issues.push(...boundedLineIssues(`${prefix}.reason`, decision.reason, REFACTOR_DECISION_REASON_MAX_LENGTH));
  if (!isPlainObject(decision.actor) || Object.keys(decision.actor).sort().join(",") !== "id,kind") {
    issues.push(`${prefix}.actor must carry exactly kind and id`);
  } else {
    if (!REFACTOR_DECISION_ACTOR_KINDS.includes(decision.actor.kind)) issues.push(`${prefix}.actor.kind is unsupported`);
    issues.push(...boundedLineIssues(`${prefix}.actor.id`, decision.actor.id, REFACTOR_DECISION_ACTOR_ID_MAX_LENGTH));
  }
  if (typeof decision.decidedAt !== "string" || !ISO_TIMESTAMP_PATTERN.test(decision.decidedAt)) {
    issues.push(`${prefix}.decidedAt must be an ISO-8601 timestamp`);
  }
  if (!isPlainObject(decision.provenance)
    || Object.keys(decision.provenance).sort().join(",") !== "assessmentDigest,baselineSnapshotDigest,headSha") {
    issues.push(`${prefix}.provenance must carry exactly headSha, assessmentDigest and baselineSnapshotDigest`);
  } else {
    if (typeof decision.provenance.headSha !== "string" || !GIT_HEAD_SHA_PATTERN.test(decision.provenance.headSha)) {
      issues.push(`${prefix}.provenance.headSha must be a 40-hex Git commit sha`);
    }
    for (const field of ["assessmentDigest", "baselineSnapshotDigest"] as const) {
      const digest = decision.provenance[field];
      issues.push(...(typeof digest === "string" ? digestIssues(`${prefix}.provenance.${field}`, digest) : [`${prefix}.provenance.${field} must be a digest`]));
    }
  }
  for (const field of ["snapshotDigest", "evidenceDigest", "resolutionDigest"] as const) {
    const digest = decision[field];
    if (digest !== undefined) {
      issues.push(...(typeof digest === "string" ? digestIssues(`${prefix}.${field}`, digest) : [`${prefix}.${field} must be a digest`]));
    }
  }
  if (decision.importNodeLimit !== undefined && !(Number.isInteger(decision.importNodeLimit) && decision.importNodeLimit >= 1)) {
    issues.push(`${prefix}.importNodeLimit must be a positive integer`);
  }
  if (decision.scope !== undefined) {
    issues.push(...decisionScopeIssues(decision.scope, `${prefix}.scope`));
  }
  if (decision.targetOutcomes !== undefined) {
    if (!Array.isArray(decision.targetOutcomes)) issues.push(`${prefix}.targetOutcomes must be an array`);
    else issues.push(...outcomeIssues(`${prefix}.targetOutcomes`, decision.targetOutcomes));
  }
  if (decision.killList !== undefined) {
    if (!Array.isArray(decision.killList)) issues.push(`${prefix}.killList must be an array`);
    else {
      for (const entry of decision.killList) {
        if (!isPlainObject(entry) || !(REFACTOR_KILL_LIST_KINDS as readonly string[]).includes(String(entry.kind)) || typeof entry.target !== "string" || entry.target.trim() === "" || typeof entry.required !== "boolean") {
          issues.push(`${prefix}.killList entry is invalid`);
          continue;
        }
        const entryKeys = Object.keys(entry).sort().join(",");
        if (entryKeys !== "kind,required,target") {
          issues.push(`${prefix}.killList entry must carry exactly kind, target and required`);
          continue;
        }
        if (entry.kind === "path") {
          issues.push(...canonicalRepoPathIssues(`${prefix}.killList.target`, entry.target));
        } else if (entry.kind === "symbol" && !isValidRefactorKillListSymbolTarget(entry.target)) {
          issues.push(`${prefix}.killList.target must be <repo-relative-path>#<symbol>`);
        }
      }
    }
  }
  return issues;
}

/**
 * Parses one decision file exactly as it sits in the checkout. A file with an unresolved merge
 * conflict, a body that is not one JSON object, a value that breaks the contract, a basename that
 * is not its own recommendation id, or bytes that are not the canonical serialization is refused
 * with every reason; nothing is repaired.
 *
 * The one tolerated difference is CRLF line endings: a checkout with `core.autocrlf` (Windows)
 * turns every LF of a committed canonical file into CRLF, so the body is compared after rewriting
 * only `\r\n` pairs to `\n` — the projection digest's rule. A lone CR, or any other byte that
 * differs from the canonical serialization, still fails closed.
 */
export function parseRefactorDecisionFile(path: string, body: string): RefactorDecisionV1 {
  const match = REFACTOR_DECISION_FILE_PATTERN.exec(path);
  if (!match) throw new Error(`refactor-decision-path-invalid: ${path} must be ${REFACTOR_DECISION_DIRECTORY}/recommendation.<16-hex>.json`);
  const normalized = body.replaceAll("\r\n", "\n");
  if (GIT_CONFLICT_MARKER_PATTERN.test(normalized)) throw new Error(`refactor-decision-conflicted: ${path} carries Git conflict markers; resolve the merge first`);
  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch (error) {
    throw new Error(`refactor-decision-malformed: ${path} is not JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  const issues = refactorDecisionInvariantIssues(value, path);
  if (issues.length > 0) throw new Error(`refactor-decision-invalid: ${issues.join("; ")}`);
  const decision = value as RefactorDecisionV1;
  if (decision.recommendationId !== match[1]) {
    throw new Error(`refactor-decision-invalid: ${path} must be named after its recommendationId ${decision.recommendationId}`);
  }
  if (serializeRefactorDecision(decision) !== normalized) {
    throw new Error(`refactor-decision-noncanonical: ${path} is not the canonical serialization the daemon writes; decision files are written only by archctx recommendations <verb>`);
  }
  return decision;
}

function decisionSubjectIssues(subject: unknown, label: string): string[] {
  if (!isPlainObject(subject) || Object.keys(subject).sort().join(",") !== "selectorKind,stableKey,subjectSelectorId") {
    return [`${label} must carry exactly selectorKind, stableKey and subjectSelectorId`];
  }
  const issues: string[] = [];
  if (!REFACTOR_DECISION_SELECTOR_KINDS.includes(subject.selectorKind as ArchitectureSubjectSelectorKind)) {
    issues.push(`${label}.selectorKind must be node or repository`);
  }
  issues.push(...boundedLineIssues(`${label}.stableKey`, subject.stableKey, REFACTOR_DECISION_STABLE_KEY_MAX_LENGTH));
  if (typeof subject.subjectSelectorId !== "string" || !/^subject\.(node|repository)\.[a-f0-9]{16}$/.test(subject.subjectSelectorId)) {
    issues.push(`${label}.subjectSelectorId must be a refactor subject selector id`);
  }
  return issues;
}

function decisionScopeIssues(scope: unknown, label: string): string[] {
  if (!isPlainObject(scope)) return [`${label} must be an object`];
  const keys = Object.keys(scope).sort().join(",");
  if (scope.kind === "repository") {
    return keys === "kind" ? [] : [`${label} must carry only kind for repository scope`];
  }
  if (scope.kind === "node") {
    if (keys !== "kind,nodeId" || typeof scope.nodeId !== "string" || scope.nodeId.trim() === "") {
      return [`${label} must carry kind and a non-empty nodeId for node scope`];
    }
    return [];
  }
  if (scope.kind === "paths") {
    if (keys !== "kind,paths" || !Array.isArray(scope.paths) || scope.paths.length === 0 || scope.paths.some((p) => typeof p !== "string")) {
      return [`${label} must carry kind and a non-empty paths array for paths scope`];
    }
    const issues = sortedUniqueIssues(`${label}.paths`, scope.paths as string[]);
    for (const entry of scope.paths as string[]) {
      issues.push(...repoPathIssues(`${label}.paths`, entry));
    }
    return issues;
  }
  return [`${label}.kind must be repository, node, or paths`];
}

function boundedLineIssues(label: string, value: unknown, maxLength: number): string[] {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
    return [`${label} must be a non-empty string without leading or trailing whitespace`];
  }
  if (value.length > maxLength) return [`${label} must be at most ${maxLength} characters`];
  return /[\u0000-\u001f\u007f]/.test(value) ? [`${label} must be one line without control characters`] : [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
