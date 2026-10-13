import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REFACTOR_DECISION_DIRECTORY,
  REFACTOR_EVIDENCE_ID_LIST_LIMIT,
  REFACTOR_RECOMMENDATION_FINGERPRINT_SCHEMA_VERSION,
  REFACTOR_DECISION_SCHEMA_VERSION,
  digestJson,
  parseRefactorDecisionFile,
  refactorRecommendationStatusView,
  refactorDecisionInvariantIssues,
  refactorDecisionPath,
  serializeRefactorDecision,
  type ArchitectureActorKind,
  type Json,
  type RecommendationV3,
  type RefactorDecisionStatus,
  type RefactorDecisionV1,
  type RefactorStatusAuthority
} from "@archcontext/contracts";
import { listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { refactorSubjectSelectorId } from "@archcontext/core/architecture-delta";
import type { RecommendationLedgerRecordV1 } from "@archcontext/core/architecture-ledger";
import { assertPathHasNoSymlinkSegments } from "@archcontext/core/changeset-engine";
import { refactorRecommendationId, refactorRecommendationSubjectKey } from "@archcontext/core/recommendation-engine";
import { RefactorScanError, readRefactorNamespace } from "./refactor-scan";

export const REFACTOR_DECISION_SET_SCHEMA_VERSION = "archcontext.refactor-decision-set/v1" as const;

/**
 * The one materialized read model of the human refactor decisions in the current checkout
 * (ADR-0046). Every entry point that plans, decides, lists, shows, books or verifies refactor
 * recommendations reads this, never SQLite, for human status.
 */
export interface RefactorDecisionSetV1 {
  /** The manifest `product.id` every decision in the set was checked against. */
  namespace: string;
  /** Sorted by `recommendationId`. */
  decisions: RefactorDecisionV1[];
  byId: ReadonlyMap<string, RefactorDecisionV1>;
  /** Binds the namespace and every decision body; part of the run `inputDigest`. */
  digest: string;
}

/**
 * The ChangeSet engine's own transient names beside a decision file while a journal is open: the
 * preimage backup and the atomic-write temp file. They are never decisions and are recovered or
 * removed by the journal, so a reader passes over exactly these names and nothing else.
 */
const REFACTOR_DECISION_FILE_NAME = /^recommendation\.[a-f0-9]{16}\.json$/;
const CHANGESET_TRANSIENT_DECISION_NAME = /^recommendation\.[a-f0-9]{16}\.json\.(archctx-backup|archctx-tmp-[0-9]+-[0-9]+)$/;

/**
 * Reads `.archcontext/refactor-decisions/` from the checkout. The decision files are the
 * Git-visible ones (tracked plus untracked, not ignored), so an ignored `.DS_Store`, a mergetool
 * `.orig` or an editor swap file the repository ignores is never read. Fail-closed: a symlinked or
 * non-directory home, any symlink or directory inside it, any Git-visible entry that is not a
 * regular `recommendation.<16-hex>.json` file, a conflicted or malformed body, a namespace other
 * than the manifest's, or an id or selector that does not recompute from the file's own identity
 * fields refuses the whole read (`AC_SCHEMA_INVALID`). Nothing is repaired.
 */
export function readRefactorDecisionSet(root: string): RefactorDecisionSetV1 {
  const namespace = readRefactorNamespace(root);
  const decisions: RefactorDecisionV1[] = [];
  let absoluteDirectory: string;
  try {
    absoluteDirectory = assertPathHasNoSymlinkSegments(root, REFACTOR_DECISION_DIRECTORY);
  } catch (error) {
    throw decisionReadError(error instanceof Error ? error.message : String(error));
  }
  if (existsSync(absoluteDirectory)) {
    if (!lstatSync(absoluteDirectory).isDirectory()) throw decisionReadError(`${REFACTOR_DECISION_DIRECTORY} must be a directory`);
    // Git lists regular files only, so symlinks and directories are refused from the directory itself.
    const onDisk = readdirSync(absoluteDirectory, { withFileTypes: true });
    for (const entry of onDisk) {
      if (!entry.isFile()) throw decisionReadError(`${REFACTOR_DECISION_DIRECTORY}/${entry.name} must be a regular file, not a directory or symlink`);
    }
    let visible: string[];
    try {
      visible = listGitVisibleFiles(root, REFACTOR_DECISION_DIRECTORY);
    } catch (error) {
      throw decisionReadError(`the Git-visible file list is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    const prefix = `${REFACTOR_DECISION_DIRECTORY}/`;
    // A decision-named file Git ignores would be a decision every other checkout silently lacks:
    // the repository must not ignore its own decisions.
    const visibleNames = new Set(visible.filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length)));
    for (const entry of onDisk) {
      if (REFACTOR_DECISION_FILE_NAME.test(entry.name) && !visibleNames.has(entry.name)) {
        throw decisionReadError(`${prefix}${entry.name} is ignored by Git; a refactor decision must be committable, so remove the ignore rule that matches it`);
      }
    }
    const paths = visible
      .filter((path) => path.startsWith(prefix))
      .filter((path) => !CHANGESET_TRANSIENT_DECISION_NAME.test(path.slice(prefix.length)))
      .sort(compareText);
    for (const path of paths) {
      const name = path.slice(prefix.length);
      if (name.includes("/")) throw decisionReadError(`${path} must sit directly in ${REFACTOR_DECISION_DIRECTORY}`);
      if (!lstatSync(join(absoluteDirectory, name)).isFile()) throw decisionReadError(`${path} must be a regular file, not a directory or symlink`);
      let decision: RefactorDecisionV1;
      try {
        decision = parseRefactorDecisionFile(path, readFileSync(join(absoluteDirectory, name), "utf8"));
      } catch (error) {
        throw decisionReadError(error instanceof Error ? error.message : String(error));
      }
      const identityIssues = refactorDecisionIdentityIssues(decision, namespace);
      if (identityIssues.length > 0) throw decisionReadError(`${path}: ${identityIssues.join("; ")}`);
      decisions.push(decision);
    }
  }
  return {
    namespace,
    decisions,
    byId: new Map(decisions.map((decision) => [decision.recommendationId, decision])),
    digest: refactorDecisionSetDigest(namespace, decisions)
  };
}


/** True for the two categories whose human decisions live in Git; `practice` stays ledger-only. */
export function isRefactorRecommendation(record: RecommendationLedgerRecordV1): record is RecommendationV3 & { category: "refactor_proposal" | "structural_observation" } {
  return "category" in record && (record.category === "refactor_proposal" || record.category === "structural_observation");
}

/**
 * The record as the checkout states it (`refactorRecommendationStatusView`): a refactor record's
 * status replaced by its Git decision, with who states it. A practice record, and a refactor
 * record read without a decision set, is the ledger's.
 */
export function refactorStatusView<T extends RecommendationLedgerRecordV1>(
  record: T,
  decisions: RefactorDecisionSetV1 | undefined
): { record: T; authority: RefactorStatusAuthority } {
  if (!isRefactorRecommendation(record) || decisions === undefined) return { record, authority: "ledger" };
  const view = refactorRecommendationStatusView(record.status, decisions.byId.get(record.recommendationId)?.status);
  return { record: view.status === record.status ? record : { ...record, status: view.status }, authority: view.authority };
}

/** The same decision set without one decision: the planning input that materializes that generation. */
export function refactorDecisionSetWithout(decisions: RefactorDecisionSetV1, recommendationId: string): RefactorDecisionSetV1 {
  const kept = decisions.decisions.filter((decision) => decision.recommendationId !== recommendationId);
  return {
    namespace: decisions.namespace,
    decisions: kept,
    byId: new Map(kept.map((decision) => [decision.recommendationId, decision])),
    digest: refactorDecisionSetDigest(decisions.namespace, kept)
  };
}

function refactorDecisionSetDigest(namespace: string, decisions: readonly RefactorDecisionV1[]): string {
  return digestJson({
    schemaVersion: REFACTOR_DECISION_SET_SCHEMA_VERSION,
    namespace,
    decisions: decisions as unknown as Json
  });
}

export interface BuildRefactorDecisionInput {
  namespace: string;
  /** The record being decided, at the generation the decision names. */
  record: RecommendationV3;
  status: RefactorDecisionStatus;
  reason: string;
  actor: { kind: ArchitectureActorKind; id: string };
  decidedAt: string;
  headSha: string;
}

/**
 * The decision file for one decided generation. The subject key is recomputed from the record and
 * must hash to the record's own selector under the manifest namespace; a record written under
 * another identity (a different `product.id`, or a pre-v3 fingerprint) is refused rather than
 * re-keyed, so a decision never names a subject the planner would not.
 */
export function buildRefactorDecision(input: BuildRefactorDecisionInput): RefactorDecisionV1 {
  const record = input.record;
  if (record.category !== "refactor_proposal" && record.category !== "structural_observation") {
    throw decisionWriteError(`recommendation ${record.recommendationId} is a ${record.category} recommendation; its decisions stay in the ledger`);
  }
  const payload = record.payload as { affectedNodeIds: string[]; assessmentDigest: string; baselineSnapshotDigest: string; kind?: RefactorDecisionV1["kind"]; metrics?: Record<string, number | null> };
  const affectedNodeIds = [...new Set(payload.affectedNodeIds)].sort(compareText);
  const key = refactorRecommendationSubjectKey(record.category, record.subject, affectedNodeIds);
  const subjectSelectorId = refactorSubjectSelectorId(key.selectorKind, input.namespace, key.stableKey);
  if (subjectSelectorId !== record.subjectSelectorId) {
    throw decisionWriteError(
      `recommendation ${record.recommendationId} was recorded under a different refactor identity than product.id ${input.namespace}; run archctx refactor scan and decide the current id`,
      "refactor-identity-mismatch"
    );
  }
  const regressesFrom = record.relations.regressesFrom ?? null;
  if (refactorRecommendationId(record.fingerprint, regressesFrom) !== record.recommendationId) {
    throw decisionWriteError(
      `recommendation ${record.recommendationId} does not derive from its fingerprint; run archctx refactor scan and decide the current id`,
      "refactor-identity-mismatch"
    );
  }
  const decision: RefactorDecisionV1 = {
    schemaVersion: REFACTOR_DECISION_SCHEMA_VERSION,
    namespace: input.namespace,
    recommendationId: record.recommendationId,
    fingerprint: record.fingerprint,
    fingerprintSchemaVersion: REFACTOR_RECOMMENDATION_FINGERPRINT_SCHEMA_VERSION,
    category: record.category,
    kind: record.category === "structural_observation" ? payload.kind ?? null : null,
    subject: { selectorKind: key.selectorKind, stableKey: key.stableKey, subjectSelectorId },
    affectedNodeIds: affectedNodeIds.slice(0, REFACTOR_EVIDENCE_ID_LIST_LIMIT),
    affectedNodeCount: affectedNodeIds.length,
    regressesFrom,
    status: input.status,
    observationMetrics: record.category === "structural_observation" && payload.metrics ? { ...payload.metrics } : null,
    reason: input.reason.trim(),
    actor: { kind: input.actor.kind, id: input.actor.id },
    decidedAt: input.decidedAt,
    provenance: {
      headSha: input.headSha,
      assessmentDigest: payload.assessmentDigest,
      baselineSnapshotDigest: payload.baselineSnapshotDigest
    }
  };
  const issues = [...refactorDecisionInvariantIssues(decision), ...refactorDecisionIdentityIssues(decision, input.namespace)];
  if (issues.length > 0) throw decisionWriteError(issues.join("; "));
  return decision;
}

/** The ChangeSet write of one decision file: path, the current preimage hash and the canonical body. */
export function refactorDecisionWrite(root: string, decision: RefactorDecisionV1): { path: string; expectedHash: string; body: string } {
  const path = refactorDecisionPath(decision.recommendationId);
  const absolute = assertPathHasNoSymlinkSegments(root, path);
  const expectedHash = existsSync(absolute) ? digestJson({ body: readFileSync(absolute, "utf8") }) : "missing";
  return { path, expectedHash, body: serializeRefactorDecision(decision) };
}

/** The identity a decision file must recompute to, beyond its own shape. */
function refactorDecisionIdentityIssues(decision: RefactorDecisionV1, namespace: string): string[] {
  const issues: string[] = [];
  if (decision.namespace !== namespace) issues.push(`namespace ${decision.namespace} is not the manifest product.id ${namespace}`);
  if (refactorRecommendationId(decision.fingerprint, decision.regressesFrom) !== decision.recommendationId) {
    issues.push("recommendationId does not derive from fingerprint and regressesFrom");
  }
  if (refactorSubjectSelectorId(decision.subject.selectorKind, decision.namespace, decision.subject.stableKey) !== decision.subject.subjectSelectorId) {
    issues.push("subject.subjectSelectorId does not derive from selectorKind, namespace and stableKey");
  }
  return issues;
}

function decisionReadError(message: string): RefactorScanError {
  return new RefactorScanError("AC_SCHEMA_INVALID", `refactor decisions unreadable: ${message}`, "refactor-decision-invalid");
}

function decisionWriteError(message: string, reasonCode = "refactor-decision-invalid"): RefactorScanError {
  return new RefactorScanError("AC_SCHEMA_INVALID", message, reasonCode);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
