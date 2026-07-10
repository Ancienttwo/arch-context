import { Buffer } from "node:buffer";
import {
  architectureEventHash,
  architectureSnapshotDigest,
  digestJson,
  type ArchitectureEventV1,
  type ArchitectureLedgerMode,
  type ArchitectureRepositoryIdentityV1,
  type ArchitectureSnapshotV1,
  type ArchitectureWorktreeIdentityV1,
  type EvidenceBindingV1,
  type EvidenceItemV2,
  type Json,
  type RecommendationRunV1,
  type RecommendationV2,
  type AgentJobV1
} from "@archcontext/contracts";
import type { ChangeSetDraft } from "../../changeset-engine/src/index";
import { canonicalArchitectureYaml, parseJsonOrStableYaml } from "../../architecture-domain/src/index";

export type ArchitectureLedgerWriter = "runtime-daemon";
export const ARCHITECTURE_LEDGER_GIT_CURSOR_ID = "source.git.current";

export interface ArchitectureLedgerScope {
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
}

export interface ArchitectureLedgerEntityRecord {
  entityId: string;
  kind: string;
  canonicalName: string;
  status: "active" | "planned" | "deprecated" | "removed";
  path?: string;
  summary?: string;
  metadata?: Record<string, Json>;
}

export interface ArchitectureLedgerRelationRecord {
  relationId: string;
  kind: string;
  sourceEntityId: string;
  targetEntityId: string;
  status: "active" | "planned" | "deprecated" | "removed";
  summary?: string;
  metadata?: Record<string, Json>;
}

export interface ArchitectureLedgerConstraintRecord {
  constraintId: string;
  kind: string;
  subjectId: string;
  status: "active" | "planned" | "deprecated" | "removed";
  severity?: "notice" | "warning" | "error" | "critical";
  summary?: string;
  metadata?: Record<string, Json>;
}

export type ArchitectureLedgerOperation =
  | { op: "upsert_entity"; entity: ArchitectureLedgerEntityRecord }
  | { op: "delete_entity"; entityId: string }
  | { op: "upsert_relation"; relation: ArchitectureLedgerRelationRecord }
  | { op: "delete_relation"; relationId: string }
  | { op: "upsert_constraint"; constraint: ArchitectureLedgerConstraintRecord }
  | { op: "delete_constraint"; constraintId: string };

export interface ArchitectureAuditRunV1 {
  schemaVersion: "archcontext.architecture-audit-run/v1";
  runId: string;
  jobId: string;
  reportId: string;
  status: "pending" | "issuing" | "issued" | "failed";
  repoNameWithOwner: string;
  repoVisibility: "public" | "private" | "internal";
  baseSha: string;
  issueDraftDigests: string[];
  issuedIssues?: { draftId: string; draftDigest?: string; number: number; url: string; issuedAt: string }[];
  inputDigest: string;
  outputDigest: string;
  createdAt: string;
  auditRunDigest: string;
}

export interface ArchitectureLedgerEventPayload {
  summary?: string;
  rationale?: string;
  title?: string;
  operations?: ArchitectureLedgerOperation[];
  evidenceItems?: EvidenceItemV2[];
  evidenceBindings?: EvidenceBindingV1[];
  recommendationRuns?: RecommendationRunV1[];
  recommendations?: RecommendationV2[];
  agentJobs?: AgentJobV1[];
  auditRuns?: ArchitectureAuditRunV1[];
  projectionState?: Record<string, Json>;
  sourceCursors?: Record<string, Json>[];
  waivers?: Record<string, Json>[];
  feedback?: Record<string, Json>[];
}

export interface ArchitectureLedgerGraphState {
  entities: ArchitectureLedgerEntityRecord[];
  relations: ArchitectureLedgerRelationRecord[];
  constraints: ArchitectureLedgerConstraintRecord[];
}

export interface ArchitectureLedgerModelFile {
  path: string;
  body: string;
  digest?: string;
  schemaVersion?: string;
}

export interface ArchitectureLedgerProjectionFile {
  path: string;
  body: string;
  digest: string;
  targetKind: "entity" | "relation" | "constraint";
  targetId: string;
}

export interface ArchitectureLedgerYamlImportRecord {
  path: string;
  schemaVersion: string;
  targetKind: "entity" | "relation" | "constraint" | "evidence";
  targetId: string;
}

export interface ArchitectureLedgerYamlIgnoredFile {
  path: string;
  reasonCode: "generated-projection" | "empty-model-file";
}

export interface ArchitectureLedgerYamlUnsupportedFile {
  path: string;
  schemaVersion?: string;
  reasonCode: "unsupported-schema" | "parse-error" | "invalid-record";
  message: string;
}

export interface ArchitectureLedgerDriftReport {
  schemaVersion: "archcontext.architecture-ledger-drift/v1";
  ok: boolean;
  semanticDrift: boolean;
  sourceGraphDigest: string;
  projectedGraphDigest: string;
  projectionDigest: string;
  reasonCodes: string[];
  unsupportedFiles: ArchitectureLedgerYamlUnsupportedFile[];
  ignoredFiles: ArchitectureLedgerYamlIgnoredFile[];
  projectionDiffs?: ArchitectureLedgerProjectionDiff[];
}

export interface ArchitectureLedgerProjectionDiff {
  path: string;
  reasonCode: "projection-file-missing" | "projection-file-digest-mismatch" | "projection-file-extra";
  expectedDigest?: string;
  actualDigest?: string;
  targetKind?: ArchitectureLedgerProjectionFile["targetKind"];
  targetId?: string;
}

export interface ArchitectureLedgerYamlImportPlan {
  schemaVersion: "archcontext.architecture-ledger-yaml-import-plan/v1";
  sourceMode: "yaml";
  dryRun: true;
  event: ArchitectureEventV1;
  state: ArchitectureLedgerGraphState;
  graphDigest: string;
  sourceDigest: string;
  projectionDigest: string;
  imported: ArchitectureLedgerYamlImportRecord[];
  ignoredFiles: ArchitectureLedgerYamlIgnoredFile[];
  unsupportedFiles: ArchitectureLedgerYamlUnsupportedFile[];
  projectedFiles: ArchitectureLedgerProjectionFile[];
  drift: ArchitectureLedgerDriftReport;
}

export interface ArchitectureLedgerYamlImportInput extends ArchitectureLedgerScope {
  files: ArchitectureLedgerModelFile[];
  createdAt: string;
  command?: string;
}

export interface ArchitectureLedgerChangeSetApplyInput extends ArchitectureLedgerScope {
  draft: ChangeSetDraft;
  files: ArchitectureLedgerModelFile[];
  createdAt: string;
  writeMode: "dual" | "ledger-with-projection";
  command?: string;
}

export interface ArchitectureLedgerGitDriftInput {
  state: ArchitectureLedgerGraphState;
  files: ArchitectureLedgerModelFile[];
  createdAt: string;
  command?: string;
}

export interface ArchitectureLedgerYamlRebuildInput extends ArchitectureLedgerYamlImportInput {
  previousState: ArchitectureLedgerGraphState;
}

export interface ArchitectureLedgerGitCursor {
  schemaVersion: "archcontext.git-cursor/v1";
  cursorId: typeof ARCHITECTURE_LEDGER_GIT_CURSOR_ID;
  source: "git";
  branch: string;
  headSha: string;
  worktreeDigest: string;
  sourceDigest: string;
  graphDigest: string;
  projectionDigest: string;
  fileCount: number;
  importedCount: number;
  ignoredFileCount: number;
  unsupportedFileCount: number;
  cursorDigest: string;
}

export interface ArchitectureLedgerCursorRefreshPlan {
  schemaVersion: "archcontext.architecture-ledger-cursor-refresh-plan/v1";
  event: ArchitectureEventV1;
  cursor: ArchitectureLedgerGitCursor;
  graphDigest: string;
}

export interface ArchitectureLedgerExternalProjectionProposalPlan {
  schemaVersion: "archcontext.architecture-ledger-external-projection-proposal-plan/v1";
  event: ArchitectureEventV1;
  cursor: ArchitectureLedgerGitCursor;
  proposedGraphDigest: string;
  baseGraphDigest: string;
  sourceDigest: string;
  projectionDigest: string;
  imported: ArchitectureLedgerYamlImportRecord[];
  ignoredFiles: ArchitectureLedgerYamlIgnoredFile[];
  unsupportedFiles: ArchitectureLedgerYamlUnsupportedFile[];
  drift: ArchitectureLedgerDriftReport;
}

export interface ArchitectureLedgerAppendInput {
  writer: ArchitectureLedgerWriter;
  events: ArchitectureEventV1[];
  faultAfterEvents?: number;
}

export interface ArchitectureLedgerAppendResult {
  appendedEvents: ArchitectureEventV1[];
  duplicateEvents: ArchitectureEventV1[];
  graphDigest: string;
  entityCount: number;
  relationCount: number;
  constraintCount: number;
}

export interface ArchitectureLedgerSnapshotInput extends ArchitectureLedgerScope {
  snapshotId?: string;
  sourceMode: ArchitectureLedgerMode;
  projectionDigest: string;
  inputDigests: ArchitectureSnapshotV1["inputDigests"];
  createdAt: string;
}

export interface ArchitectureLedgerReplayInput extends ArchitectureLedgerScope {
  untilEventId?: string;
  snapshotId?: string;
}

export interface ArchitectureLedgerReplayResult {
  events: ArchitectureEventV1[];
  state: ArchitectureLedgerGraphState;
  graphDigest: string;
}

export interface ArchitectureLedgerReplayVerification {
  ok: boolean;
  materializedDigest: string;
  replayedDigest: string;
  eventCount: number;
  mismatches: string[];
}

export interface ArchitectureLedgerIntegrityResult {
  ok: boolean;
  graphDigest: string;
  eventCount: number;
  snapshotCount: number;
  failures: string[];
}

export type ArchitectureBookSubjectKind = "entity" | "relation" | "constraint";

export interface ArchitectureBookBudgetInput {
  maxItems?: number;
  maxBytes?: number;
  explain?: boolean;
}

export interface ArchitectureBookBudgetReadback {
  maxItems: number;
  maxBytes: number;
  returnedItems: number;
  omittedItems: number;
  byteLength: number;
  truncated: boolean;
  reasonCodes: string[];
}

export interface ArchitectureBookSubjectRecord {
  kind: ArchitectureBookSubjectKind;
  id: string;
  label: string;
  status: string;
  summary?: string;
  path?: string;
  metadata?: Record<string, Json>;
  relation?: {
    kind: string;
    sourceEntityId: string;
    targetEntityId: string;
  };
  constraint?: {
    kind: string;
    subjectId: string;
    severity?: string;
  };
}

export type ArchitectureBookFtsMatchKind = "title" | "summary" | "rationale" | "evidence-summary" | "mixed";

export interface ArchitectureBookFtsMatch {
  targetKind: ArchitectureBookSubjectKind | "event" | "evidence" | "recommendation" | "adr";
  targetId: string;
  subjectId?: string;
  title?: string;
  summary?: string;
  matchKind: ArchitectureBookFtsMatchKind;
  score: number;
  reasonCodes: string[];
}

export interface ArchitectureBookSelectionSignal {
  source: "lexical" | "graph" | "recency" | "importance" | "evidence" | "fts";
  score: number;
  reasonCode: string;
  detail?: string;
}

export interface ArchitectureBookSelectionExplanation {
  schemaVersion: "archcontext.architecture-book-selection-explanation/v1";
  targetKind: ArchitectureBookSubjectKind | "recommendation";
  targetId: string;
  matchedTokens: string[];
  reasonCodes: string[];
  signals: ArchitectureBookSelectionSignal[];
  fallbackMatches?: ArchitectureBookFtsMatch[];
}

export interface ArchitectureBookScoredSubject extends ArchitectureBookSubjectRecord {
  score: number;
  scoreBreakdown: {
    taskRelevance: number;
    graphDistance: number;
    recency: number;
    declaredImportance: number;
    evidenceStrength: number;
    ftsFallback?: number;
  };
  explanation?: ArchitectureBookSelectionExplanation;
}

export interface ArchitectureBookQueryResult {
  schemaVersion: "archcontext.architecture-book-query/v1";
  query: string;
  graphDigest: string;
  results: ArchitectureBookScoredSubject[];
  budget: ArchitectureBookBudgetReadback;
  reasonCodes: string[];
}

export interface ArchitectureBookShowResult {
  schemaVersion: "archcontext.architecture-book-show/v1";
  id: string;
  found: boolean;
  subject?: ArchitectureBookSubjectRecord;
  reasonCode?: "subject-not-found";
}

export interface ArchitectureBookNeighborsResult {
  schemaVersion: "archcontext.architecture-book-neighbors/v1";
  id: string;
  depth: number;
  center?: ArchitectureBookSubjectRecord;
  nodes: (ArchitectureBookSubjectRecord & { distance: number })[];
  relations: (ArchitectureBookSubjectRecord & { distance: number })[];
  constraints: (ArchitectureBookSubjectRecord & { distance: number })[];
  budget: ArchitectureBookBudgetReadback;
  reasonCodes: string[];
}

export interface ArchitectureBookTimelineEntry {
  eventId: string;
  eventType: string;
  timestamp: string;
  source: ArchitectureEventV1["source"];
  headSha: string;
  summary?: string;
  title?: string;
  operationCount: number;
  affectedSubjects: string[];
  resultingDigest: string;
}

export interface ArchitectureBookTimelineResult {
  schemaVersion: "archcontext.architecture-book-timeline/v1";
  subjectId?: string;
  sinceEventId?: string;
  sinceFound: boolean;
  events: ArchitectureBookTimelineEntry[];
  budget: ArchitectureBookBudgetReadback;
  reasonCodes: string[];
}

export interface ArchitectureBookDiffChange {
  kind: ArchitectureBookSubjectKind;
  id: string;
  changeKind: "added" | "removed" | "changed";
  reasonCodes: string[];
  evidenceIds: string[];
  evidenceBindingIds: string[];
  before?: ArchitectureBookSubjectRecord;
  after?: ArchitectureBookSubjectRecord;
}

export interface ArchitectureBookDiffResult {
  schemaVersion: "archcontext.architecture-book-diff/v1";
  fromRef: string;
  toRef: string;
  fromGraphDigest: string;
  toGraphDigest: string;
  changes: ArchitectureBookDiffChange[];
  summary: {
    added: number;
    removed: number;
    changed: number;
  };
  budget: ArchitectureBookBudgetReadback;
  reasonCodes: string[];
}

export interface ArchitectureBookEvidenceResult {
  schemaVersion: "archcontext.architecture-book-evidence/v1";
  id: string;
  evidenceItems: EvidenceItemV2[];
  evidenceBindings: EvidenceBindingV1[];
  budget: ArchitectureBookBudgetReadback;
  reasonCodes: string[];
}

export interface ArchitectureBookRecommendationsResult {
  schemaVersion: "archcontext.architecture-book-recommendations/v1";
  openOnly: boolean;
  recommendations: RecommendationV2[];
  explanations?: ArchitectureBookSelectionExplanation[];
  budget: ArchitectureBookBudgetReadback;
  reasonCodes: string[];
}

const ACTIVE_BOOK_RECOMMENDATION_STATUSES = new Set<RecommendationV2["status"]>(["open", "acknowledged", "deferred"]);

export function normalizeArchitectureLedgerEvent(event: ArchitectureEventV1, previousEventHash: string | null): ArchitectureEventV1 {
  const normalized = {
    ...event,
    previousEventHash,
    eventHash: undefined
  };
  const eventHash = architectureEventHash(normalized as ArchitectureEventV1);
  return { ...event, previousEventHash, eventHash };
}

export function architectureLedgerStateDigest(state: ArchitectureLedgerGraphState): string {
  return digestJson(canonicalArchitectureLedgerState(state) as unknown as Json);
}

export function architectureLedgerBookSubjects(state: ArchitectureLedgerGraphState): ArchitectureBookSubjectRecord[] {
  const subjects: ArchitectureBookSubjectRecord[] = [
    ...state.entities.map((entity) => ({
      kind: "entity" as const,
      id: entity.entityId,
      label: entity.canonicalName,
      status: entity.status,
      ...(entity.summary ? { summary: entity.summary } : {}),
      ...(entity.path ? { path: entity.path } : {}),
      ...(entity.metadata ? { metadata: entity.metadata } : {})
    })),
    ...state.relations.map((relation) => ({
      kind: "relation" as const,
      id: relation.relationId,
      label: `${relation.sourceEntityId} -> ${relation.targetEntityId}`,
      status: relation.status,
      ...(relation.summary ? { summary: relation.summary } : {}),
      ...(relation.metadata ? { metadata: relation.metadata } : {}),
      relation: {
        kind: relation.kind,
        sourceEntityId: relation.sourceEntityId,
        targetEntityId: relation.targetEntityId
      }
    })),
    ...state.constraints.map((constraint) => ({
      kind: "constraint" as const,
      id: constraint.constraintId,
      label: constraint.subjectId,
      status: constraint.status,
      ...(constraint.summary ? { summary: constraint.summary } : {}),
      ...(constraint.metadata ? { metadata: constraint.metadata } : {}),
      constraint: {
        kind: constraint.kind,
        subjectId: constraint.subjectId,
        ...(constraint.severity ? { severity: constraint.severity } : {})
      }
    }))
  ];
  return subjects.sort(compareBookSubjects);
}

export function showArchitectureLedgerBookSubject(state: ArchitectureLedgerGraphState, id: string): ArchitectureBookShowResult {
  const subject = architectureLedgerBookSubjects(state).find((candidate) => candidate.id === id);
  return subject
    ? { schemaVersion: "archcontext.architecture-book-show/v1", id, found: true, subject }
    : { schemaVersion: "archcontext.architecture-book-show/v1", id, found: false, reasonCode: "subject-not-found" };
}

export function queryArchitectureLedgerBook(input: ArchitectureBookBudgetInput & {
  state: ArchitectureLedgerGraphState;
  query?: string;
  events?: ArchitectureEventV1[];
  ftsMatches?: ArchitectureBookFtsMatch[];
}): ArchitectureBookQueryResult {
  const query = input.query?.trim() ?? "";
  const tokens = tokenizeBookQuery(query);
  const subjects = architectureLedgerBookSubjects(input.state);
  const ftsMatchesBySubject = bookFtsMatchesBySubject(subjects, input.ftsMatches ?? []);
  const baseScored = subjects.map((subject) => scoreBookSubject(subject, tokens, {
    ftsFallback: bookFtsFallbackScore(ftsMatchesBySubject.get(subject.id) ?? [])
  }));
  const seedSubjects = baseScored.filter((subject) => subject.scoreBreakdown.taskRelevance > 0 || (subject.scoreBreakdown.ftsFallback ?? 0) > 0);
  const graphDistanceScores = bookGraphDistanceScores(input.state, seedSubjects.length > 0 ? seedSubjects : subjects);
  const recencyScores = bookRecencyScores(input.events ?? []);
  const scored = subjects
    .map((subject) => {
      const ftsMatches = ftsMatchesBySubject.get(subject.id) ?? [];
      const scoredSubject = scoreBookSubject(subject, tokens, {
        graphDistance: graphDistanceScores.get(subject.id) ?? 0,
        recency: recencyScores.get(subject.id) ?? 0,
        ftsFallback: bookFtsFallbackScore(ftsMatches)
      });
      return input.explain ? { ...scoredSubject, explanation: explainBookSubject(scoredSubject, tokens, ftsMatches) } : scoredSubject;
    })
    .filter((subject) => tokens.length === 0 || subject.score > 0 || (subject.scoreBreakdown.ftsFallback ?? 0) > 0)
    .sort((left, right) => right.score - left.score || compareBookSubjects(left, right));
  const limited = applyArchitectureBookBudget(scored, input);
  return {
    schemaVersion: "archcontext.architecture-book-query/v1",
    query,
    graphDigest: architectureLedgerStateDigest(input.state),
    results: limited.items,
    budget: limited.budget,
    reasonCodes: limited.budget.reasonCodes
  };
}

export function queryArchitectureLedgerBookNeighbors(input: ArchitectureBookBudgetInput & {
  state: ArchitectureLedgerGraphState;
  id: string;
  depth?: number;
}): ArchitectureBookNeighborsResult {
  const depth = Math.max(0, Math.floor(input.depth ?? 1));
  const subjects = architectureLedgerBookSubjects(input.state);
  const center = subjects.find((subject) => subject.id === input.id);
  if (!center) {
    const limited = applyArchitectureBookBudget([], input);
    return {
      schemaVersion: "archcontext.architecture-book-neighbors/v1",
      id: input.id,
      depth,
      nodes: [],
      relations: [],
      constraints: [],
      budget: limited.budget,
      reasonCodes: ["subject-not-found"]
    };
  }

  const entityDistances = new Map<string, number>();
  const relationDistances = new Map<string, number>();
  const constraintDistances = new Map<string, number>();
  const queue: { entityId: string; distance: number }[] = [];
  const enqueueEntity = (entityId: string, distance: number) => {
    if (distance > depth) return;
    const existing = entityDistances.get(entityId);
    if (existing !== undefined && existing <= distance) return;
    entityDistances.set(entityId, distance);
    queue.push({ entityId, distance });
  };

  if (center.kind === "entity") {
    enqueueEntity(center.id, 0);
  } else if (center.relation) {
    relationDistances.set(center.id, 0);
    enqueueEntity(center.relation.sourceEntityId, Math.min(depth, 1));
    enqueueEntity(center.relation.targetEntityId, Math.min(depth, 1));
  } else if (center.constraint) {
    constraintDistances.set(center.id, 0);
    enqueueEntity(center.constraint.subjectId, Math.min(depth, 1));
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.distance >= depth) continue;
    for (const relation of input.state.relations) {
      if (relation.status === "removed") continue;
      if (relation.sourceEntityId !== current.entityId && relation.targetEntityId !== current.entityId) continue;
      const nextDistance = current.distance + 1;
      relationDistances.set(relation.relationId, Math.min(relationDistances.get(relation.relationId) ?? nextDistance, nextDistance));
      enqueueEntity(relation.sourceEntityId === current.entityId ? relation.targetEntityId : relation.sourceEntityId, nextDistance);
    }
    for (const constraint of input.state.constraints) {
      if (constraint.status === "removed" || constraint.subjectId !== current.entityId) continue;
      const nextDistance = current.distance + 1;
      constraintDistances.set(constraint.constraintId, Math.min(constraintDistances.get(constraint.constraintId) ?? nextDistance, nextDistance));
    }
  }

  const tagged = [
    ...subjects
      .filter((subject) => subject.kind === "entity" && entityDistances.has(subject.id))
      .map((subject) => ({ ...subject, distance: entityDistances.get(subject.id)! })),
    ...subjects
      .filter((subject) => subject.kind === "relation" && relationDistances.has(subject.id))
      .map((subject) => ({ ...subject, distance: relationDistances.get(subject.id)! })),
    ...subjects
      .filter((subject) => subject.kind === "constraint" && constraintDistances.has(subject.id))
      .map((subject) => ({ ...subject, distance: constraintDistances.get(subject.id)! }))
  ].sort((left, right) => left.distance - right.distance || compareBookSubjects(left, right));
  const limited = applyArchitectureBookBudget(tagged, input);
  return {
    schemaVersion: "archcontext.architecture-book-neighbors/v1",
    id: input.id,
    depth,
    center,
    nodes: limited.items.filter((subject) => subject.kind === "entity"),
    relations: limited.items.filter((subject) => subject.kind === "relation"),
    constraints: limited.items.filter((subject) => subject.kind === "constraint"),
    budget: limited.budget,
    reasonCodes: limited.budget.reasonCodes
  };
}

export function queryArchitectureLedgerBookTimeline(input: ArchitectureBookBudgetInput & {
  events: ArchitectureEventV1[];
  subjectId?: string;
  sinceEventId?: string;
}): ArchitectureBookTimelineResult {
  let sinceFound = input.sinceEventId === undefined;
  const entries: ArchitectureBookTimelineEntry[] = [];
  for (const event of input.events) {
    if (!sinceFound) {
      sinceFound = event.eventId === input.sinceEventId;
      continue;
    }
    const payload = architectureLedgerPayload(event);
    const operations = payload.operations ?? [];
    const affectedSubjects = uniqueSorted(operations.flatMap(affectedSubjectsForOperation));
    if (input.subjectId && !affectedSubjects.includes(input.subjectId)) continue;
    entries.push({
      eventId: event.eventId,
      eventType: event.eventType,
      timestamp: event.timestamp,
      source: event.source,
      headSha: event.headSha,
      ...(payload.summary ? { summary: payload.summary } : {}),
      ...(payload.title ? { title: payload.title } : {}),
      operationCount: operations.length,
      affectedSubjects,
      resultingDigest: event.resultingDigest
    });
  }
  const limited = applyArchitectureBookBudget(entries.sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.eventId.localeCompare(right.eventId)), input);
  return {
    schemaVersion: "archcontext.architecture-book-timeline/v1",
    ...(input.subjectId ? { subjectId: input.subjectId } : {}),
    ...(input.sinceEventId ? { sinceEventId: input.sinceEventId } : {}),
    sinceFound,
    events: limited.items,
    budget: limited.budget,
    reasonCodes: [
      ...(sinceFound ? [] : ["since-ref-not-found"]),
      ...limited.budget.reasonCodes
    ]
  };
}

export function diffArchitectureLedgerBookStates(input: ArchitectureBookBudgetInput & {
  previousState: ArchitectureLedgerGraphState;
  nextState: ArchitectureLedgerGraphState;
  fromRef: string;
  toRef: string;
  events?: ArchitectureEventV1[];
}): ArchitectureBookDiffResult {
  const previous = new Map(architectureLedgerBookSubjects(input.previousState).map((subject) => [bookSubjectKey(subject), subject]));
  const next = new Map(architectureLedgerBookSubjects(input.nextState).map((subject) => [bookSubjectKey(subject), subject]));
  const evidenceLinks = bookEvidenceLinksBySubject(input.events ?? []);
  const changes: ArchitectureBookDiffChange[] = [];
  for (const [key, after] of next) {
    const before = previous.get(key);
    const links = evidenceLinks.get(after.id) ?? { evidenceIds: [], evidenceBindingIds: [] };
    if (!before) {
      changes.push({ kind: after.kind, id: after.id, changeKind: "added", reasonCodes: ["subject-added"], ...links, after });
      continue;
    }
    if (digestJson(before as unknown as Json) !== digestJson(after as unknown as Json)) {
      changes.push({ kind: after.kind, id: after.id, changeKind: "changed", reasonCodes: ["subject-changed"], ...links, before, after });
    }
  }
  for (const [key, before] of previous) {
    if (next.has(key)) continue;
    const links = evidenceLinks.get(before.id) ?? { evidenceIds: [], evidenceBindingIds: [] };
    changes.push({ kind: before.kind, id: before.id, changeKind: "removed", reasonCodes: ["subject-removed"], ...links, before });
  }
  changes.sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id) || left.changeKind.localeCompare(right.changeKind));
  const limited = applyArchitectureBookBudget(changes, input);
  return {
    schemaVersion: "archcontext.architecture-book-diff/v1",
    fromRef: input.fromRef,
    toRef: input.toRef,
    fromGraphDigest: architectureLedgerStateDigest(input.previousState),
    toGraphDigest: architectureLedgerStateDigest(input.nextState),
    changes: limited.items,
    summary: {
      added: changes.filter((change) => change.changeKind === "added").length,
      removed: changes.filter((change) => change.changeKind === "removed").length,
      changed: changes.filter((change) => change.changeKind === "changed").length
    },
    budget: limited.budget,
    reasonCodes: limited.budget.reasonCodes
  };
}

export function queryArchitectureLedgerBookEvidence(input: ArchitectureBookBudgetInput & {
  events: ArchitectureEventV1[];
  id: string;
}): ArchitectureBookEvidenceResult {
  const evidenceItems: EvidenceItemV2[] = [];
  const evidenceBindings: EvidenceBindingV1[] = [];
  for (const event of input.events) {
    const payload = architectureLedgerPayload(event);
    for (const item of payload.evidenceItems ?? []) {
      if (item.evidenceId === input.id || item.subject === input.id || item.selector.id === input.id) evidenceItems.push(item);
    }
    for (const binding of payload.evidenceBindings ?? []) {
      if (binding.bindingId === input.id || binding.evidenceId === input.id || binding.target.id === input.id) evidenceBindings.push(binding);
    }
  }
  const tagged = [
    ...evidenceItems.map((item) => ({ itemType: "evidenceItem" as const, value: item })),
    ...evidenceBindings.map((binding) => ({ itemType: "evidenceBinding" as const, value: binding }))
  ].sort((left, right) => `${left.itemType}:${evidenceRecordId(left.value)}`.localeCompare(`${right.itemType}:${evidenceRecordId(right.value)}`));
  const limited = applyArchitectureBookBudget(tagged, input);
  return {
    schemaVersion: "archcontext.architecture-book-evidence/v1",
    id: input.id,
    evidenceItems: limited.items.filter((item) => item.itemType === "evidenceItem").map((item) => item.value as EvidenceItemV2),
    evidenceBindings: limited.items.filter((item) => item.itemType === "evidenceBinding").map((item) => item.value as EvidenceBindingV1),
    budget: limited.budget,
    reasonCodes: limited.budget.reasonCodes
  };
}

export function queryArchitectureLedgerBookRecommendations(input: ArchitectureBookBudgetInput & {
  events: ArchitectureEventV1[];
  openOnly?: boolean;
}): ArchitectureBookRecommendationsResult {
  const recommendations = latestBookRecommendations(input.events)
    .filter((recommendation) => !input.openOnly || ACTIVE_BOOK_RECOMMENDATION_STATUSES.has(recommendation.status))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.recommendationId.localeCompare(right.recommendationId));
  const limited = applyArchitectureBookBudget(recommendations, input);
  return {
    schemaVersion: "archcontext.architecture-book-recommendations/v1",
    openOnly: input.openOnly ?? false,
    recommendations: limited.items,
    ...(input.explain ? { explanations: limited.items.map((recommendation) => explainBookRecommendation(recommendation, input.openOnly ?? false)) } : {}),
    budget: limited.budget,
    reasonCodes: limited.budget.reasonCodes
  };
}

function latestBookRecommendations(events: readonly ArchitectureEventV1[]): RecommendationV2[] {
  const latest = new Map<string, { recommendation: RecommendationV2; index: number }>();
  let index = 0;
  for (const event of events) {
    for (const recommendation of architectureLedgerPayload(event).recommendations ?? []) {
      const current = latest.get(recommendation.recommendationId);
      if (
        !current
        || recommendation.updatedAt.localeCompare(current.recommendation.updatedAt) > 0
        || (recommendation.updatedAt === current.recommendation.updatedAt && index > current.index)
      ) {
        latest.set(recommendation.recommendationId, { recommendation, index });
      }
      index += 1;
    }
  }
  return [...latest.values()].map((entry) => entry.recommendation);
}

export function planYamlToArchitectureLedgerImport(input: ArchitectureLedgerYamlImportInput): ArchitectureLedgerYamlImportPlan {
  const sourceDigest = architectureLedgerModelFilesDigest(input.files);
  const collected = collectYamlModelFacts(input.files, input.createdAt, {
    producer: "architecture-ledger-yaml-import",
    command: input.command ?? "archctx ledger migrate --from-yaml --dry-run",
    inputDigest: sourceDigest
  });
  const state = stateFromOperations(collected.operations);
  const graphDigest = architectureLedgerStateDigest(state);
  const projectedFiles = projectArchitectureLedgerStateToYamlFiles(state);
  const projectionDigest = architectureLedgerProjectionDigest(projectedFiles);
  const gitCursor = architectureLedgerGitCursor({
    ...input,
    sourceDigest,
    graphDigest,
    projectionDigest,
    fileCount: input.files.length,
    importedCount: collected.imported.length,
    ignoredFileCount: collected.ignoredFiles.length,
    unsupportedFileCount: collected.unsupportedFiles.length
  });
  const event = normalizeArchitectureLedgerEvent({
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: `architecture_event.yaml_import.${digestSuffix(sourceDigest)}`,
    eventType: "architecture.yaml.import",
    payloadVersion: "archcontext.architecture-ledger-yaml-import/v1",
    repository: input.repository,
    worktree: input.worktree,
    baseDigest: architectureLedgerStateDigest(emptyArchitectureLedgerState()),
    resultingDigest: graphDigest,
    headSha: input.worktree.headSha,
    actor: { kind: "migration", id: "archctx-ledger-yaml-import" },
    source: "yaml_import",
    timestamp: input.createdAt,
    idempotencyKey: `architecture-ledger-yaml-import:${sourceDigest}`,
    provenance: {
      producer: "architecture-ledger-yaml-import",
      command: input.command ?? "archctx ledger migrate --from-yaml --dry-run",
      inputDigest: sourceDigest
    },
    payload: {
      summary: "Dry-run import of Git-tracked ArchContext YAML into the architecture ledger.",
      title: "YAML architecture ledger import",
      operations: collected.operations,
      evidenceItems: collected.evidenceItems,
      evidenceBindings: collected.evidenceBindings,
      sourceCursors: [...collected.sourceCursors, gitCursor]
    } as unknown as Json
  }, null);
  const drift = architectureLedgerYamlDriftReport({
    state,
    projectedFiles,
    unsupportedFiles: collected.unsupportedFiles,
    ignoredFiles: collected.ignoredFiles
  });
  return {
    schemaVersion: "archcontext.architecture-ledger-yaml-import-plan/v1",
    sourceMode: "yaml",
    dryRun: true,
    event: { ...event, resultingDigest: graphDigest },
    state,
    graphDigest,
    sourceDigest,
    projectionDigest,
    imported: collected.imported,
    ignoredFiles: collected.ignoredFiles,
    unsupportedFiles: collected.unsupportedFiles,
    projectedFiles,
    drift
  };
}

export function planChangeSetApplyToArchitectureLedgerEvent(input: ArchitectureLedgerChangeSetApplyInput): ArchitectureLedgerYamlImportPlan {
  const command = input.command ?? "archctx apply";
  const importPlan = planYamlToArchitectureLedgerImport({
    repository: input.repository,
    worktree: input.worktree,
    files: input.files,
    createdAt: input.createdAt,
    command
  });
  const inputDigest = digestJson({
    changeSetId: input.draft.id,
    writeMode: input.writeMode,
    sourceDigest: importPlan.sourceDigest,
    graphDigest: importPlan.graphDigest
  } as unknown as Json);
  const payload = architectureLedgerPayload(importPlan.event);
  const event = normalizeArchitectureLedgerEvent({
    ...importPlan.event,
    eventId: `architecture_event.changeset_apply.${digestSuffix(inputDigest)}`,
    eventType: "architecture.changeset.apply",
    source: "apply_update",
    actor: { kind: "daemon", id: "archctxd" },
    timestamp: input.createdAt,
    idempotencyKey: `architecture-ledger-changeset-apply:${input.draft.id}:${input.writeMode}:${importPlan.sourceDigest}`,
    provenance: {
      producer: "architecture-ledger-runtime-dual-write",
      command,
      inputDigest
    },
    payload: {
      ...payload,
      summary: `ChangeSet ${input.draft.id} applied through ${input.writeMode} architecture ledger mode.`,
      title: `ChangeSet ${input.draft.id} architecture ledger apply`,
      changeSet: changeSetLedgerSummary(input.draft),
      projectionState: {
        projectionId: `projection.changeset.${digestSuffix(inputDigest)}`,
        path: ".archcontext",
        projectionDigest: importPlan.projectionDigest,
        sourceDigest: importPlan.sourceDigest,
        changeSetId: input.draft.id,
        writeMode: input.writeMode
      }
    } as unknown as Json
  }, null);
  return { ...importPlan, event };
}

export function planAuditRunToArchitectureLedgerEvent(input: ArchitectureLedgerScope & {
  jobId: string;
  reportId: string;
  status: ArchitectureAuditRunV1["status"];
  repoNameWithOwner: string;
  repoVisibility: ArchitectureAuditRunV1["repoVisibility"];
  issueDraftDigests: string[];
  issuedIssues?: ArchitectureAuditRunV1["issuedIssues"];
  inputDigest: string;
  outputDigest: string;
  createdAt: string;
  runId?: string;
  command?: string;
  /**
   * Defaults to "architecture.agent_audit.run_pending" (the original AL0/ADR-0041 event type,
   * used for both "pending" and "failed" transitions so those two statuses stay byte-identical
   * to the pre-approve-flow event shape). ADR-0042's approve flow passes
   * "architecture.agent_audit.run_issuing" / "...run_issued" explicitly for the "issuing"/"issued"
   * transitions so the event stream stays self-describing without disturbing the pending/failed
   * default.
   */
  eventType?: string;
  /**
   * Digest-only record (never the raw token) that a public/internal-repository confirmation
   * token was supplied for this transition; folded into the event's provenance.inputDigest so the
   * confirmation is cryptographically bound to the append without ever persisting the token
   * itself. Omitted entirely for private repositories and for the pending/failed statuses, so
   * their provenance.inputDigest stays byte-identical to the pre-approve-flow shape.
   */
  confirmPublicTokenDigest?: string;
}): { event: ArchitectureEventV1 } {
  const issueDraftDigests = [...input.issueDraftDigests].sort();
  const runInputDigest = digestJson({
    jobId: input.jobId,
    reportId: input.reportId,
    inputDigest: input.inputDigest,
    outputDigest: input.outputDigest,
    issueDraftDigests
  } as unknown as Json);
  const runId = input.runId ?? `audit_run.${digestSuffix(runInputDigest)}`;
  const auditRunInput = {
    schemaVersion: "archcontext.architecture-audit-run/v1" as const,
    runId,
    jobId: input.jobId,
    reportId: input.reportId,
    status: input.status,
    repoNameWithOwner: input.repoNameWithOwner,
    repoVisibility: input.repoVisibility,
    baseSha: input.worktree.headSha,
    issueDraftDigests,
    ...(input.issuedIssues ? { issuedIssues: input.issuedIssues } : {}),
    inputDigest: input.inputDigest,
    outputDigest: input.outputDigest,
    createdAt: input.createdAt
  };
  const auditRun: ArchitectureAuditRunV1 = {
    ...auditRunInput,
    auditRunDigest: digestJson(auditRunInput as unknown as Json)
  };
  const eventInputDigest = digestJson({
    runId: auditRun.runId,
    auditRunDigest: auditRun.auditRunDigest,
    ...(input.confirmPublicTokenDigest ? { confirmPublicTokenDigest: input.confirmPublicTokenDigest } : {})
  } as unknown as Json);
  // pending/failed keep the exact original idempotencyKey shape (one key per runId, matching
  // ADR-0041's terminal-or-still-investigating semantics); issuing/issued are content-addressed
  // per transition so a status/issuedIssues change never collides with the prior transition's key,
  // while replaying the identical transition content is still a safe idempotent duplicate.
  const idempotencyKey = input.status === "pending" || input.status === "failed"
    ? `architecture-ledger-agent-audit:${auditRun.runId}`
    : `architecture-ledger-agent-audit:${auditRun.runId}:${input.status}:${digestSuffix(auditRun.auditRunDigest)}`;
  const event = normalizeArchitectureLedgerEvent({
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: `architecture_event.agent_audit.${digestSuffix(eventInputDigest)}`,
    eventType: input.eventType ?? "architecture.agent_audit.run_pending",
    payloadVersion: "archcontext.architecture-audit-run/v1",
    repository: input.repository,
    worktree: input.worktree,
    baseDigest: input.inputDigest,
    resultingDigest: auditRun.auditRunDigest,
    headSha: input.worktree.headSha,
    actor: { kind: "daemon", id: "archctxd" },
    source: "agent_audit",
    timestamp: input.createdAt,
    idempotencyKey,
    provenance: {
      producer: "architecture-ledger-agent-audit",
      command: input.command ?? "archctxd agent-audit",
      inputDigest: eventInputDigest
    },
    payload: {
      summary: `Pending architecture audit run ${auditRun.runId} for ${input.repoNameWithOwner}.`,
      title: `Architecture audit run ${auditRun.runId}`,
      auditRuns: [auditRun]
    } as unknown as Json
  }, null);
  return { event };
}

export function compareArchitectureLedgerStateToYaml(input: ArchitectureLedgerGitDriftInput): ArchitectureLedgerDriftReport {
  const projectedFiles = projectArchitectureLedgerStateToYamlFiles(input.state);
  const collected = collectYamlModelFacts(input.files, input.createdAt, {
    producer: "architecture-ledger-git-drift",
    command: input.command ?? "archctx ledger drift --json",
    inputDigest: architectureLedgerModelFilesDigest(input.files)
  });
  const gitState = stateFromOperations(collected.operations);
  const sourceGraphDigest = architectureLedgerStateDigest(input.state);
  const projectedGraphDigest = architectureLedgerStateDigest(gitState);
  const projectionDiffs = architectureLedgerProjectionDiffs(projectedFiles, input.files);
  const reasonCodes = [...new Set([
    ...(sourceGraphDigest === projectedGraphDigest ? [] : ["semantic-drift"]),
    ...(collected.unsupportedFiles.length === 0 ? [] : ["unsupported-yaml-file"]),
    ...projectionDiffs.map((diff) => diff.reasonCode)
  ])].sort();
  return {
    schemaVersion: "archcontext.architecture-ledger-drift/v1",
    ok: reasonCodes.length === 0,
    semanticDrift: sourceGraphDigest !== projectedGraphDigest,
    sourceGraphDigest,
    projectedGraphDigest,
    projectionDigest: architectureLedgerProjectionDigest(projectedFiles),
    reasonCodes,
    unsupportedFiles: collected.unsupportedFiles,
    ignoredFiles: collected.ignoredFiles,
    projectionDiffs
  };
}

export function planYamlToArchitectureLedgerRebuild(input: ArchitectureLedgerYamlRebuildInput): ArchitectureLedgerYamlImportPlan {
  const plan = planYamlToArchitectureLedgerImport(input);
  const previousGraphDigest = architectureLedgerStateDigest(input.previousState);
  const deleteOperations = architectureLedgerDeletionOperations(input.previousState, plan.state);
  const payload = architectureLedgerPayload(plan.event);
  const event = normalizeArchitectureLedgerEvent({
    ...plan.event,
    eventId: `architecture_event.yaml_rebuild.${digestSuffix(digestJson({
      sourceDigest: plan.sourceDigest,
      previousGraphDigest
    } as unknown as Json))}`,
    eventType: "architecture.yaml.rebuild",
    baseDigest: previousGraphDigest,
    resultingDigest: plan.graphDigest,
    idempotencyKey: `architecture-ledger-yaml-rebuild:${plan.sourceDigest}:${previousGraphDigest}`,
    provenance: {
      producer: "architecture-ledger-yaml-rebuild",
      command: input.command ?? "archctx ledger rebuild --from-git",
      inputDigest: digestJson({
        sourceDigest: plan.sourceDigest,
        previousGraphDigest
      } as unknown as Json)
    },
    payload: {
      ...payload,
      summary: "Rebuild architecture ledger current state from Git-tracked ArchContext YAML.",
      title: "YAML architecture ledger rebuild",
      operations: [...deleteOperations, ...(payload.operations ?? [])]
    } as unknown as Json
  }, null);
  return { ...plan, event };
}

export function architectureLedgerGitCursor(input: ArchitectureLedgerScope & {
  sourceDigest: string;
  graphDigest: string;
  projectionDigest: string;
  fileCount: number;
  importedCount: number;
  ignoredFileCount: number;
  unsupportedFileCount: number;
}): ArchitectureLedgerGitCursor {
  const cursor: Omit<ArchitectureLedgerGitCursor, "cursorDigest"> = {
    schemaVersion: "archcontext.git-cursor/v1" as const,
    cursorId: ARCHITECTURE_LEDGER_GIT_CURSOR_ID,
    source: "git" as const,
    branch: input.worktree.branch,
    headSha: input.worktree.headSha,
    worktreeDigest: input.worktree.worktreeDigest,
    sourceDigest: input.sourceDigest,
    graphDigest: input.graphDigest,
    projectionDigest: input.projectionDigest,
    fileCount: input.fileCount,
    importedCount: input.importedCount,
    ignoredFileCount: input.ignoredFileCount,
    unsupportedFileCount: input.unsupportedFileCount
  };
  return {
    ...cursor,
    cursorDigest: digestJson(cursor as unknown as Json)
  };
}

export function architectureLedgerGitCursorFromPlan(input: ArchitectureLedgerScope & {
  plan: ArchitectureLedgerYamlImportPlan;
}): ArchitectureLedgerGitCursor {
  return architectureLedgerGitCursor({
    ...input,
    sourceDigest: input.plan.sourceDigest,
    graphDigest: input.plan.graphDigest,
    projectionDigest: input.plan.projectionDigest,
    fileCount: input.plan.imported.length + input.plan.ignoredFiles.length + input.plan.unsupportedFiles.length,
    importedCount: input.plan.imported.length,
    ignoredFileCount: input.plan.ignoredFiles.length,
    unsupportedFileCount: input.plan.unsupportedFiles.length
  });
}

export function planGitCursorRefreshToArchitectureLedgerEvent(input: ArchitectureLedgerScope & {
  cursor: ArchitectureLedgerGitCursor;
  graphDigest: string;
  createdAt: string;
  command?: string;
}): ArchitectureLedgerCursorRefreshPlan {
  const inputDigest = digestJson({
    cursorDigest: input.cursor.cursorDigest,
    graphDigest: input.graphDigest
  } as unknown as Json);
  const event = normalizeArchitectureLedgerEvent({
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: `architecture_event.git_cursor.${digestSuffix(inputDigest)}`,
    eventType: "architecture.git.cursor.refresh",
    payloadVersion: "archcontext.architecture-ledger-git-cursor/v1",
    repository: input.repository,
    worktree: input.worktree,
    baseDigest: input.graphDigest,
    resultingDigest: input.graphDigest,
    headSha: input.worktree.headSha,
    actor: { kind: "daemon", id: "archctxd" },
    source: "projection_reconcile",
    timestamp: input.createdAt,
    idempotencyKey: `architecture-ledger-git-cursor:${input.cursor.cursorDigest}:${input.graphDigest}`,
    provenance: {
      producer: "architecture-ledger-git-cursor-refresh",
      command: input.command ?? "archctx ledger rebuild --from-git",
      inputDigest
    },
    payload: {
      summary: "Refresh the architecture ledger Git cursor without changing semantic architecture state.",
      title: "Architecture ledger Git cursor refresh",
      sourceCursors: [input.cursor],
      projectionState: {
        projectionId: "projection.git.current",
        path: ".archcontext",
        projectionDigest: input.cursor.projectionDigest,
        sourceDigest: input.cursor.sourceDigest,
        graphDigest: input.graphDigest,
        status: "current"
      }
    } as unknown as Json
  }, null);
  return {
    schemaVersion: "archcontext.architecture-ledger-cursor-refresh-plan/v1",
    event,
    cursor: input.cursor,
    graphDigest: input.graphDigest
  };
}

export function planExternalProjectionChangeToArchitectureLedgerEvent(input: ArchitectureLedgerYamlRebuildInput): ArchitectureLedgerExternalProjectionProposalPlan {
  const plan = planYamlToArchitectureLedgerImport(input);
  const baseGraphDigest = architectureLedgerStateDigest(input.previousState);
  const cursor = architectureLedgerGitCursorFromPlan({ ...input, plan });
  const inputDigest = digestJson({
    sourceDigest: plan.sourceDigest,
    baseGraphDigest,
    proposedGraphDigest: plan.graphDigest,
    cursorDigest: cursor.cursorDigest
  } as unknown as Json);
  const event = normalizeArchitectureLedgerEvent({
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: `architecture_event.external_projection.${digestSuffix(inputDigest)}`,
    eventType: "architecture.projection.external_change.proposed",
    payloadVersion: "archcontext.architecture-ledger-external-projection/v1",
    repository: input.repository,
    worktree: input.worktree,
    baseDigest: baseGraphDigest,
    resultingDigest: baseGraphDigest,
    headSha: input.worktree.headSha,
    actor: { kind: "daemon", id: "archctxd" },
    source: "projection_reconcile",
    timestamp: input.createdAt,
    idempotencyKey: `architecture-ledger-external-projection:${plan.sourceDigest}:${baseGraphDigest}:${plan.graphDigest}`,
    provenance: {
      producer: "architecture-ledger-external-projection-proposal",
      command: input.command ?? "archctx ledger rebuild --from-git",
      inputDigest
    },
    payload: {
      summary: "Git-tracked architecture projection changed outside an ArchContext ChangeSet; explicit reconcile is required before ledger state changes.",
      title: "External architecture projection change proposed",
      sourceCursors: [cursor],
      projectionState: {
        projectionId: `projection.external.${digestSuffix(inputDigest)}`,
        path: ".archcontext",
        projectionDigest: plan.projectionDigest,
        sourceDigest: plan.sourceDigest,
        baseGraphDigest,
        proposedGraphDigest: plan.graphDigest,
        status: "external-change-proposed",
        reconcileRequired: true
      },
      proposedExternalProjectionChange: {
        schemaVersion: "archcontext.external-projection-change/v1",
        baseGraphDigest,
        proposedGraphDigest: plan.graphDigest,
        sourceDigest: plan.sourceDigest,
        projectionDigest: plan.projectionDigest,
        reasonCodes: plan.drift.reasonCodes,
        imported: plan.imported,
        ignoredFiles: plan.ignoredFiles,
        unsupportedFiles: plan.unsupportedFiles,
        reconcile: {
          required: true,
          command: "archctx ledger rebuild --from-git --accept-external-projection --expected-worktree-digest <current>"
        }
      }
    } as unknown as Json
  }, null);
  return {
    schemaVersion: "archcontext.architecture-ledger-external-projection-proposal-plan/v1",
    event,
    cursor,
    proposedGraphDigest: plan.graphDigest,
    baseGraphDigest,
    sourceDigest: plan.sourceDigest,
    projectionDigest: plan.projectionDigest,
    imported: plan.imported,
    ignoredFiles: plan.ignoredFiles,
    unsupportedFiles: plan.unsupportedFiles,
    drift: plan.drift
  };
}

function stateFromOperations(operations: ArchitectureLedgerOperation[]): ArchitectureLedgerGraphState {
  return replayArchitectureLedgerEvents([{
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: "architecture_event.synthetic_state",
    eventType: "architecture.synthetic.state",
    payloadVersion: "archcontext.architecture-ledger-yaml-import/v1",
    repository: { repositoryId: "repo.synthetic", storageRepositoryId: "repo.synthetic" },
    worktree: {
      workspaceId: "workspace.synthetic",
      storageWorkspaceId: "workspace.synthetic",
      branch: "synthetic",
      headSha: "synthetic",
      worktreeDigest: digestJson(operations as unknown as Json)
    },
    baseDigest: digestJson([] as unknown as Json),
    resultingDigest: digestJson(operations as unknown as Json),
    headSha: "synthetic",
    actor: { kind: "system", id: "archctx-ledger-synthetic-state" },
    source: "projection_reconcile",
    timestamp: "1970-01-01T00:00:00.000Z",
    idempotencyKey: "architecture-ledger-synthetic-state",
    provenance: {
      producer: "architecture-ledger-synthetic-state",
      command: "stateFromOperations",
      inputDigest: digestJson(operations as unknown as Json)
    },
    payload: { operations } as unknown as Json
  }]);
}

function compareBookSubjects(left: Pick<ArchitectureBookSubjectRecord, "kind" | "id">, right: Pick<ArchitectureBookSubjectRecord, "kind" | "id">): number {
  return left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id);
}

function tokenizeBookQuery(query: string): string[] {
  return uniqueSorted(query.toLowerCase().split(/[^a-z0-9_.-]+/).map((token) => token.trim()).filter(Boolean));
}

function scoreBookSubject(
  subject: ArchitectureBookSubjectRecord,
  tokens: string[],
  signals: { graphDistance?: number; recency?: number; ftsFallback?: number } = {}
): ArchitectureBookScoredSubject {
  const haystacks = {
    id: subject.id.toLowerCase(),
    label: subject.label.toLowerCase(),
    summary: (subject.summary ?? "").toLowerCase(),
    kind: subject.kind.toLowerCase(),
    path: (subject.path ?? "").toLowerCase()
  };
  let taskRelevance = tokens.length === 0 ? 1 : 0;
  for (const token of tokens) {
    if (haystacks.id === token) taskRelevance += 80;
    else if (haystacks.id.includes(token)) taskRelevance += 40;
    if (haystacks.label.includes(token)) taskRelevance += 25;
    if (haystacks.summary.includes(token)) taskRelevance += 15;
    if (haystacks.kind.includes(token)) taskRelevance += 5;
    if (haystacks.path.includes(token)) taskRelevance += 5;
  }
  const declaredImportance = bookImportanceScore(subject.metadata);
  const evidenceStrength = bookEvidenceStrengthScore(subject.metadata);
  const graphDistance = signals.graphDistance ?? 0;
  const recency = signals.recency ?? 0;
  const ftsFallback = signals.ftsFallback ?? 0;
  const score = taskRelevance + graphDistance + recency + declaredImportance + evidenceStrength + ftsFallback;
  return {
    ...subject,
    score,
    scoreBreakdown: {
      taskRelevance,
      graphDistance,
      recency,
      declaredImportance,
      evidenceStrength,
      ...(ftsFallback > 0 ? { ftsFallback } : {})
    }
  };
}

function explainBookSubject(subject: ArchitectureBookScoredSubject, tokens: string[], ftsMatches: ArchitectureBookFtsMatch[]): ArchitectureBookSelectionExplanation {
  const signals: ArchitectureBookSelectionSignal[] = [];
  const reasonCodes: string[] = [];
  const matchedTokens = matchedBookSubjectTokens(subject, tokens);
  if (tokens.length === 0) reasonCodes.push("empty-query-default-result");
  if (subject.scoreBreakdown.taskRelevance > 0 && tokens.length > 0) {
    reasonCodes.push("lexical-match");
    signals.push({
      source: "lexical",
      score: subject.scoreBreakdown.taskRelevance,
      reasonCode: "matched-query-token",
      detail: matchedTokens.join(", ")
    });
  }
  if (subject.scoreBreakdown.graphDistance > 0) {
    reasonCodes.push("graph-neighborhood-boost");
    signals.push({ source: "graph", score: subject.scoreBreakdown.graphDistance, reasonCode: "near-query-match" });
  }
  if (subject.scoreBreakdown.recency > 0) {
    reasonCodes.push("recent-ledger-change");
    signals.push({ source: "recency", score: subject.scoreBreakdown.recency, reasonCode: "recent-event-touched-subject" });
  }
  if (subject.scoreBreakdown.declaredImportance > 0) {
    reasonCodes.push("declared-importance");
    signals.push({ source: "importance", score: subject.scoreBreakdown.declaredImportance, reasonCode: "metadata-importance" });
  }
  if (subject.scoreBreakdown.evidenceStrength > 0) {
    reasonCodes.push("evidence-strength");
    signals.push({ source: "evidence", score: subject.scoreBreakdown.evidenceStrength, reasonCode: "metadata-evidence-strength" });
  }
  if ((subject.scoreBreakdown.ftsFallback ?? 0) > 0) {
    reasonCodes.push("fts-fallback-match");
    signals.push({
      source: "fts",
      score: subject.scoreBreakdown.ftsFallback ?? 0,
      reasonCode: "architecture-prose-match",
      detail: ftsMatches.map((match) => `${match.targetKind}:${match.targetId}`).sort().join(", ")
    });
  }
  return {
    schemaVersion: "archcontext.architecture-book-selection-explanation/v1",
    targetKind: subject.kind,
    targetId: subject.id,
    matchedTokens,
    reasonCodes: uniqueSorted(reasonCodes),
    signals,
    ...(ftsMatches.length > 0 ? { fallbackMatches: ftsMatches.slice(0, 3).sort(compareBookFtsMatches) } : {})
  };
}

function explainBookRecommendation(recommendation: RecommendationV2, openOnly: boolean): ArchitectureBookSelectionExplanation {
  const reasonCodes = [
    ...(openOnly ? ["open-recommendation-filter"] : []),
    `status-${recommendation.status}`,
    `confidence-${recommendation.confidence}`,
    `risk-${recommendation.risk}`,
    `enforcement-${recommendation.enforcement}`,
    ...(recommendation.evidenceBindingIds.length > 0 ? ["has-evidence-bindings"] : []),
    ...(recommendation.explanation.length > 0 ? ["has-recommendation-explanation"] : [])
  ];
  const signals: ArchitectureBookSelectionSignal[] = [
    { source: "recency", score: 1, reasonCode: "recommendation-updated-at", detail: recommendation.updatedAt }
  ];
  if (recommendation.evidenceBindingIds.length > 0) {
    signals.push({ source: "evidence", score: recommendation.evidenceBindingIds.length, reasonCode: "recommendation-evidence-binding-count" });
  }
  return {
    schemaVersion: "archcontext.architecture-book-selection-explanation/v1",
    targetKind: "recommendation",
    targetId: recommendation.recommendationId,
    matchedTokens: [],
    reasonCodes: uniqueSorted(reasonCodes),
    signals
  };
}

function matchedBookSubjectTokens(subject: ArchitectureBookSubjectRecord, tokens: string[]): string[] {
  const haystack = [
    subject.id,
    subject.label,
    subject.summary ?? "",
    subject.kind,
    subject.path ?? ""
  ].join(" ").toLowerCase();
  return uniqueSorted(tokens.filter((token) => haystack.includes(token)));
}

function bookFtsMatchesBySubject(subjects: ArchitectureBookSubjectRecord[], matches: ArchitectureBookFtsMatch[]): Map<string, ArchitectureBookFtsMatch[]> {
  const subjectIds = new Set(subjects.map((subject) => subject.id));
  const bySubject = new Map<string, ArchitectureBookFtsMatch[]>();
  for (const match of matches) {
    const ids = uniqueSorted([
      ...(match.subjectId ? [match.subjectId] : []),
      ...(subjectIds.has(match.targetId) ? [match.targetId] : [])
    ]);
    for (const id of ids) {
      if (!subjectIds.has(id)) continue;
      const items = bySubject.get(id) ?? [];
      items.push(match);
      bySubject.set(id, items);
    }
  }
  return bySubject;
}

function bookFtsFallbackScore(matches: ArchitectureBookFtsMatch[]): number {
  return Math.min(30, matches.reduce((total, match) => total + Math.max(1, Math.floor(match.score)), 0));
}

function compareBookFtsMatches(left: ArchitectureBookFtsMatch, right: ArchitectureBookFtsMatch): number {
  return right.score - left.score
    || left.targetKind.localeCompare(right.targetKind)
    || left.targetId.localeCompare(right.targetId)
    || (left.subjectId ?? "").localeCompare(right.subjectId ?? "");
}

function bookGraphDistanceScores(state: ArchitectureLedgerGraphState, seeds: ArchitectureBookSubjectRecord[]): Map<string, number> {
  const maxDepth = 2;
  const entityDistances = new Map<string, number>();
  const relationDistances = new Map<string, number>();
  const constraintDistances = new Map<string, number>();
  const queue: { entityId: string; distance: number }[] = [];
  const enqueueEntity = (entityId: string, distance: number) => {
    if (distance > maxDepth) return;
    const existing = entityDistances.get(entityId);
    if (existing !== undefined && existing <= distance) return;
    entityDistances.set(entityId, distance);
    queue.push({ entityId, distance });
  };
  for (const seed of seeds) {
    if (seed.kind === "entity") enqueueEntity(seed.id, 0);
    else if (seed.relation) {
      relationDistances.set(seed.id, Math.min(relationDistances.get(seed.id) ?? 0, 0));
      enqueueEntity(seed.relation.sourceEntityId, 1);
      enqueueEntity(seed.relation.targetEntityId, 1);
    } else if (seed.constraint) {
      constraintDistances.set(seed.id, Math.min(constraintDistances.get(seed.id) ?? 0, 0));
      enqueueEntity(seed.constraint.subjectId, 1);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.distance >= maxDepth) continue;
    for (const relation of state.relations) {
      if (relation.status === "removed") continue;
      if (relation.sourceEntityId !== current.entityId && relation.targetEntityId !== current.entityId) continue;
      const distance = current.distance + 1;
      relationDistances.set(relation.relationId, Math.min(relationDistances.get(relation.relationId) ?? distance, distance));
      enqueueEntity(relation.sourceEntityId === current.entityId ? relation.targetEntityId : relation.sourceEntityId, distance);
    }
    for (const constraint of state.constraints) {
      if (constraint.status === "removed" || constraint.subjectId !== current.entityId) continue;
      const distance = current.distance + 1;
      constraintDistances.set(constraint.constraintId, Math.min(constraintDistances.get(constraint.constraintId) ?? distance, distance));
    }
  }
  const scores = new Map<string, number>();
  for (const [id, distance] of entityDistances) scores.set(id, bookGraphDistanceScore(distance));
  for (const [id, distance] of relationDistances) scores.set(id, bookGraphDistanceScore(distance));
  for (const [id, distance] of constraintDistances) scores.set(id, bookGraphDistanceScore(distance));
  return scores;
}

function bookGraphDistanceScore(distance: number): number {
  if (distance <= 0) return 8;
  if (distance === 1) return 5;
  if (distance === 2) return 2;
  return 0;
}

function bookRecencyScores(events: ArchitectureEventV1[]): Map<string, number> {
  const scores = new Map<string, number>();
  const recent = events.slice(-20).reverse();
  recent.forEach((event, index) => {
    const score = Math.max(1, 10 - index);
    const payload = architectureLedgerPayload(event);
    const subjects = uniqueSorted((payload.operations ?? []).flatMap(affectedSubjectsForOperation));
    for (const subject of subjects) scores.set(subject, Math.max(scores.get(subject) ?? 0, score));
  });
  return scores;
}

function bookImportanceScore(metadata: Record<string, Json> | undefined): number {
  const value = String(metadata?.importance ?? metadata?.priority ?? "").toLowerCase();
  if (value === "critical" || value === "high") return 20;
  if (value === "medium") return 10;
  if (value === "low") return 2;
  return 0;
}

function bookEvidenceStrengthScore(metadata: Record<string, Json> | undefined): number {
  const value = String(metadata?.evidenceStrength ?? "").toLowerCase();
  if (value === "verified") return 12;
  if (value === "observed") return 8;
  if (value === "declared") return 4;
  return 0;
}

function applyArchitectureBookBudget<T>(
  items: T[],
  input: ArchitectureBookBudgetInput
): { items: T[]; budget: ArchitectureBookBudgetReadback } {
  const maxItems = Math.max(0, Math.floor(input.maxItems ?? 12));
  const maxBytes = Math.max(256, Math.floor(input.maxBytes ?? 12_288));
  const selected: T[] = [];
  let byteLength = 2;
  let omittedItems = 0;
  let hitItemBudget = false;
  let hitByteBudget = false;
  for (const item of items) {
    if (selected.length >= maxItems) {
      omittedItems += 1;
      hitItemBudget = true;
      continue;
    }
    const itemBytes = bookByteLength(item) + (selected.length === 0 ? 0 : 1);
    if (byteLength + itemBytes > maxBytes) {
      omittedItems += 1;
      hitByteBudget = true;
      continue;
    }
    selected.push(item);
    byteLength += itemBytes;
  }
  const reasonCodes = [
    ...(hitItemBudget ? ["item-budget-exceeded"] : []),
    ...(hitByteBudget ? ["byte-budget-exceeded"] : [])
  ];
  return {
    items: selected,
    budget: {
      maxItems,
      maxBytes,
      returnedItems: selected.length,
      omittedItems,
      byteLength,
      truncated: omittedItems > 0,
      reasonCodes
    }
  };
}

function bookByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function affectedSubjectsForOperation(operation: ArchitectureLedgerOperation): string[] {
  switch (operation.op) {
    case "upsert_entity":
      return [operation.entity.entityId];
    case "delete_entity":
      return [operation.entityId];
    case "upsert_relation":
      return [operation.relation.relationId, operation.relation.sourceEntityId, operation.relation.targetEntityId];
    case "delete_relation":
      return [operation.relationId];
    case "upsert_constraint":
      return [operation.constraint.constraintId, operation.constraint.subjectId];
    case "delete_constraint":
      return [operation.constraintId];
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function bookSubjectKey(subject: Pick<ArchitectureBookSubjectRecord, "kind" | "id">): string {
  return `${subject.kind}:${subject.id}`;
}

function evidenceRecordId(record: EvidenceItemV2 | EvidenceBindingV1): string {
  return "bindingId" in record ? record.bindingId : record.evidenceId;
}

function bookEvidenceLinksBySubject(events: ArchitectureEventV1[]): Map<string, { evidenceIds: string[]; evidenceBindingIds: string[] }> {
  const bySubject = new Map<string, { evidenceIds: Set<string>; evidenceBindingIds: Set<string> }>();
  const record = (subjectId: string | undefined, link: { evidenceId?: string; evidenceBindingId?: string }) => {
    if (!subjectId) return;
    const existing = bySubject.get(subjectId) ?? { evidenceIds: new Set<string>(), evidenceBindingIds: new Set<string>() };
    if (link.evidenceId) existing.evidenceIds.add(link.evidenceId);
    if (link.evidenceBindingId) existing.evidenceBindingIds.add(link.evidenceBindingId);
    bySubject.set(subjectId, existing);
  };
  for (const event of events) {
    const payload = architectureLedgerPayload(event);
    for (const item of payload.evidenceItems ?? []) {
      record(item.subject, { evidenceId: item.evidenceId });
      record(item.selector.id, { evidenceId: item.evidenceId });
    }
    for (const binding of payload.evidenceBindings ?? []) {
      record(binding.target.id, { evidenceId: binding.evidenceId, evidenceBindingId: binding.bindingId });
    }
  }
  return new Map([...bySubject.entries()].map(([subjectId, links]) => [
    subjectId,
    {
      evidenceIds: [...links.evidenceIds].sort(),
      evidenceBindingIds: [...links.evidenceBindingIds].sort()
    }
  ]));
}

export function projectArchitectureLedgerStateToYamlFiles(state: ArchitectureLedgerGraphState): ArchitectureLedgerProjectionFile[] {
  const canonical = canonicalArchitectureLedgerState(state);
  const files: ArchitectureLedgerProjectionFile[] = [
    ...canonical.entities.map((entity) => {
      const declared = declaredProjectionRecord(entity.metadata, ["archcontext.node/v1"], `entity ${entity.entityId}`);
      const summary = entity.summary;
      if (!summary) throw new Error(`architecture-ledger-projection-invalid: entity ${entity.entityId} requires summary`);
      const body = canonicalArchitectureYaml({
        ...declared,
        schemaVersion: "archcontext.node/v1",
        id: entity.entityId,
        kind: entity.kind,
        name: entity.canonicalName,
        status: entity.status,
        summary
      } as unknown as Json);
      return projectionFile(`.archcontext/model/nodes/${pathSegment(entity.entityId)}.yaml`, body, "entity", entity.entityId);
    }),
    ...canonical.relations.map((relation) => {
      const declared = declaredProjectionRecord(
        relation.metadata,
        ["archcontext.relation/v1", "archcontext.cross-repo-relation/v1"],
        `relation ${relation.relationId}`
      );
      const schemaVersion = requireStringField(declared, "schemaVersion", `relation ${relation.relationId}`);
      const body = schemaVersion === "archcontext.cross-repo-relation/v1"
        ? canonicalArchitectureYaml({ ...declared, id: relation.relationId, kind: relation.kind } as unknown as Json)
        : canonicalArchitectureYaml({
          ...declared,
          schemaVersion: "archcontext.relation/v1",
          id: relation.relationId,
          kind: relation.kind,
          source: relation.sourceEntityId,
          target: relation.targetEntityId
        } as unknown as Json);
      return projectionFile(`.archcontext/model/relations/${pathSegment(relation.relationId)}.yaml`, body, "relation", relation.relationId);
    }),
    ...canonical.constraints.map((constraint) => {
      const declared = declaredProjectionRecord(constraint.metadata, ["archcontext.constraint/v1"], `constraint ${constraint.constraintId}`);
      const body = canonicalArchitectureYaml({
        ...declared,
        schemaVersion: "archcontext.constraint/v1",
        id: constraint.constraintId,
        ...(constraint.severity ? { severity: constraint.severity } : {})
      } as unknown as Json);
      return projectionFile(`.archcontext/model/constraints/${pathSegment(constraint.constraintId)}.yaml`, body, "constraint", constraint.constraintId);
    })
  ];
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function architectureLedgerProjectionDigest(files: ArchitectureLedgerProjectionFile[]): string {
  return digestJson(files.map((file) => ({ path: file.path, digest: file.digest })) as unknown as Json);
}

export function architectureLedgerModelFilesDigest(files: ArchitectureLedgerModelFile[]): string {
  return digestJson([...files].sort((left, right) => left.path.localeCompare(right.path)).map((file) => ({
    path: file.path,
    digest: modelFileDigest(file),
    schemaVersion: file.schemaVersion
  })) as unknown as Json);
}

function architectureLedgerYamlDriftReport(input: {
  state: ArchitectureLedgerGraphState;
  projectedFiles: ArchitectureLedgerProjectionFile[];
  unsupportedFiles: ArchitectureLedgerYamlUnsupportedFile[];
  ignoredFiles: ArchitectureLedgerYamlIgnoredFile[];
}): ArchitectureLedgerDriftReport {
  const projected = collectYamlModelFacts(input.projectedFiles, "1970-01-01T00:00:00.000Z", {
    producer: "architecture-ledger-yaml-projection",
    command: "archctx ledger project --to-git --dry-run",
    inputDigest: architectureLedgerProjectionDigest(input.projectedFiles)
  });
  const projectedEvent = normalizeArchitectureLedgerEvent({
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: `architecture_event.yaml_projection.${digestSuffix(architectureLedgerProjectionDigest(input.projectedFiles))}`,
    eventType: "architecture.yaml.projection",
    payloadVersion: "archcontext.architecture-ledger-yaml-import/v1",
    repository: { repositoryId: "repo.projection-drift", storageRepositoryId: "repo.projection-drift" },
    worktree: {
      workspaceId: "workspace.projection-drift",
      storageWorkspaceId: "workspace.projection-drift",
      branch: "projection",
      headSha: "projection",
      worktreeDigest: architectureLedgerProjectionDigest(input.projectedFiles)
    },
    baseDigest: architectureLedgerProjectionDigest(input.projectedFiles),
    resultingDigest: digestJson(projected.operations as unknown as Json),
    headSha: "projection",
    actor: { kind: "system", id: "archctx-ledger-projection-drift" },
    source: "projection_reconcile",
    timestamp: "1970-01-01T00:00:00.000Z",
    idempotencyKey: `architecture-ledger-yaml-projection:${architectureLedgerProjectionDigest(input.projectedFiles)}`,
    provenance: {
      producer: "architecture-ledger-yaml-projection",
      command: "archctx ledger drift --json",
      inputDigest: architectureLedgerProjectionDigest(input.projectedFiles)
    },
    payload: { operations: projected.operations } as unknown as Json
  }, null);
  const projectedState = replayArchitectureLedgerEvents([projectedEvent]);
  const sourceGraphDigest = architectureLedgerStateDigest(input.state);
  const projectedGraphDigest = architectureLedgerStateDigest(projectedState);
  const reasonCodes = [
    ...(sourceGraphDigest === projectedGraphDigest ? [] : ["semantic-drift"]),
    ...(input.unsupportedFiles.length === 0 ? [] : ["unsupported-yaml-file"])
  ];
  return {
    schemaVersion: "archcontext.architecture-ledger-drift/v1",
    ok: reasonCodes.length === 0,
    semanticDrift: sourceGraphDigest !== projectedGraphDigest,
    sourceGraphDigest,
    projectedGraphDigest,
    projectionDigest: architectureLedgerProjectionDigest(input.projectedFiles),
    reasonCodes,
    unsupportedFiles: input.unsupportedFiles,
    ignoredFiles: input.ignoredFiles
  };
}

function collectYamlModelFacts(files: ArchitectureLedgerModelFile[], createdAt: string, provenance: ArchitectureEventV1["provenance"]): {
  operations: ArchitectureLedgerOperation[];
  evidenceItems: EvidenceItemV2[];
  evidenceBindings: EvidenceBindingV1[];
  sourceCursors: Record<string, Json>[];
  imported: ArchitectureLedgerYamlImportRecord[];
  ignoredFiles: ArchitectureLedgerYamlIgnoredFile[];
  unsupportedFiles: ArchitectureLedgerYamlUnsupportedFile[];
} {
  const operations: ArchitectureLedgerOperation[] = [];
  const evidenceItems: EvidenceItemV2[] = [];
  const evidenceBindings: EvidenceBindingV1[] = [];
  const sourceCursors: Record<string, Json>[] = [];
  const imported: ArchitectureLedgerYamlImportRecord[] = [];
  const ignoredFiles: ArchitectureLedgerYamlIgnoredFile[] = [];
  const unsupportedFiles: ArchitectureLedgerYamlUnsupportedFile[] = [];

  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    const digest = modelFileDigest(file);
    if (file.body.trim().length === 0) {
      ignoredFiles.push({ path: file.path, reasonCode: "empty-model-file" });
      continue;
    }
    if (isGeneratedProjectionFile(file)) {
      ignoredFiles.push({ path: file.path, reasonCode: "generated-projection" });
      continue;
    }
    let value: Json;
    try {
      value = parseArchitectureLedgerYamlRecord(file);
    } catch (error) {
      unsupportedFiles.push({
        path: file.path,
        schemaVersion: file.schemaVersion,
        reasonCode: "parse-error",
        message: error instanceof Error ? error.message : String(error)
      });
      continue;
    }
    if (!isRecord(value)) {
      unsupportedFiles.push({
        path: file.path,
        schemaVersion: file.schemaVersion,
        reasonCode: "invalid-record",
        message: `${file.path}: expected object`
      });
      continue;
    }
    const schemaVersion = stringField(value, "schemaVersion") ?? file.schemaVersion ?? "";
    if (schemaVersion === "archcontext.generated/v1") {
      ignoredFiles.push({ path: file.path, reasonCode: "generated-projection" });
      continue;
    }
    sourceCursors.push({
      cursorId: `source.yaml.${digestSuffix(digest)}`,
      source: "model-store-yaml",
      path: file.path,
      schemaVersion,
      digest
    });
    let target: ReturnType<typeof yamlRecordToLedgerOperation>;
    try {
      target = yamlRecordToLedgerOperation(value, file.path, schemaVersion);
    } catch (error) {
      unsupportedFiles.push({
        path: file.path,
        schemaVersion,
        reasonCode: "invalid-record",
        message: error instanceof Error ? error.message : String(error)
      });
      continue;
    }
    if (!target) {
      if (isEvidenceOnlySchema(schemaVersion)) {
        const evidence = yamlEvidenceItem(file, schemaVersion, createdAt, provenance, declaredYamlSubject(value, file.path));
        evidenceItems.push(evidence);
        imported.push({ path: file.path, schemaVersion, targetKind: "evidence", targetId: evidence.subject });
        continue;
      }
      unsupportedFiles.push({
        path: file.path,
        schemaVersion,
        reasonCode: "unsupported-schema",
        message: `${file.path}: unsupported architecture ledger YAML schema ${schemaVersion || "(missing schemaVersion)"}`
      });
      continue;
    }
    operations.push(target.operation);
    const evidence = yamlEvidenceItem(file, schemaVersion, createdAt, provenance, target.targetId);
    evidenceItems.push(evidence);
    evidenceBindings.push(yamlEvidenceBinding(evidence, target.targetKind, target.targetId, createdAt, provenance));
    imported.push({ path: file.path, schemaVersion, targetKind: target.targetKind, targetId: target.targetId });
  }

  return {
    operations: operations.sort((left, right) => operationKey(left).localeCompare(operationKey(right))),
    evidenceItems: evidenceItems.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
    evidenceBindings: evidenceBindings.sort((left, right) => left.bindingId.localeCompare(right.bindingId)),
    sourceCursors: sourceCursors.sort((left, right) => String(left.path).localeCompare(String(right.path))),
    imported: imported.sort((left, right) => left.path.localeCompare(right.path)),
    ignoredFiles: ignoredFiles.sort((left, right) => left.path.localeCompare(right.path)),
    unsupportedFiles: unsupportedFiles.sort((left, right) => left.path.localeCompare(right.path))
  };
}

function parseArchitectureLedgerYamlRecord(file: ArchitectureLedgerModelFile): Json {
  return parseJsonOrStableYaml(markdownFrontmatterBody(file.body) ?? file.body, file.path);
}

function markdownFrontmatterBody(body: string): string | undefined {
  const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match?.[1];
}

function yamlRecordToLedgerOperation(value: Record<string, Json>, path: string, schemaVersion: string): {
  operation: ArchitectureLedgerOperation;
  targetKind: "entity" | "relation" | "constraint";
  targetId: string;
} | undefined {
  if (schemaVersion === "archcontext.node/v1") {
    const entityId = requireStringField(value, "id", path);
    const entity: ArchitectureLedgerEntityRecord = {
      entityId,
      kind: requireStringField(value, "kind", path),
      canonicalName: requireStringField(value, "name", path),
      status: declaredStatus(value.status, path),
      summary: requireStringField(value, "summary", path),
      metadata: { declared: value }
    };
    return { operation: { op: "upsert_entity", entity }, targetKind: "entity", targetId: entityId };
  }
  if (schemaVersion === "archcontext.relation/v1") {
    const relationId = requireStringField(value, "id", path);
    const relation: ArchitectureLedgerRelationRecord = {
      relationId,
      kind: requireStringField(value, "kind", path),
      sourceEntityId: requireStringField(value, "source", path),
      targetEntityId: requireStringField(value, "target", path),
      status: "active",
      summary: requireStringField(value, "intent", path),
      metadata: { declared: value }
    };
    return { operation: { op: "upsert_relation", relation }, targetKind: "relation", targetId: relationId };
  }
  if (schemaVersion === "archcontext.cross-repo-relation/v1") {
    const relationId = requireStringField(value, "id", path);
    const source = repoScopedTarget(value.source, path, "source");
    const target = repoScopedTarget(value.target, path, "target");
    const relation: ArchitectureLedgerRelationRecord = {
      relationId,
      kind: requireStringField(value, "kind", path),
      sourceEntityId: source,
      targetEntityId: target,
      status: "active",
      summary: requireStringField(value, "intent", path),
      metadata: { declared: value }
    };
    return { operation: { op: "upsert_relation", relation }, targetKind: "relation", targetId: relationId };
  }
  if (schemaVersion === "archcontext.constraint/v1") {
    const constraintId = requireStringField(value, "id", path);
    const scope = requiredRecordField(value, "scope", path);
    const rule = requiredRecordField(value, "rule", path);
    const subjectId = firstStringArrayValue(scope.nodes) ?? firstStringArrayValue(scope.relations) ?? "repository";
    const constraint: ArchitectureLedgerConstraintRecord = {
      constraintId,
      kind: requireStringField(rule, "type", path),
      subjectId,
      status: "active",
      severity: requiredSeverity(value.severity, path),
      summary: requireStringField(value, "rationale", path),
      metadata: { declared: value }
    };
    return { operation: { op: "upsert_constraint", constraint }, targetKind: "constraint", targetId: constraintId };
  }
  return undefined;
}

function yamlEvidenceItem(
  file: ArchitectureLedgerModelFile,
  schemaVersion: string,
  createdAt: string,
  provenance: ArchitectureEventV1["provenance"],
  subject: string
): EvidenceItemV2 {
  const digest = modelFileDigest(file);
  const extensions: Record<string, Json> = {
    schemaVersion,
    sourcePath: file.path
  };
  if (subject !== file.path) extensions.declaredId = subject;
  return {
    schemaVersion: "archcontext.evidence-item/v2",
    evidenceId: `evidence.yaml.${digestSuffix(digest)}`,
    kind: "architecture-yaml-declaration",
    strength: "declared",
    polarity: "declaration",
    origin: "model-store-yaml",
    subject,
    selector: { kind: "path", id: file.path, path: file.path },
    summary: `${schemaVersion || "unknown schema"} ${subject} declared at ${file.path}`,
    coverage: { level: "complete", scope: file.path },
    supports: ["checkpoint", "complete"],
    provenance,
    createdAt,
    digest,
    extensions
  };
}

function yamlEvidenceBinding(
  evidence: EvidenceItemV2,
  targetKind: "entity" | "relation" | "constraint",
  targetId: string,
  createdAt: string,
  provenance: ArchitectureEventV1["provenance"]
): EvidenceBindingV1 {
  return {
    schemaVersion: "archcontext.evidence-binding/v1",
    bindingId: `binding.yaml.${digestSuffix(digestJson({ evidenceId: evidence.evidenceId, targetKind, targetId } as unknown as Json))}`,
    evidenceId: evidence.evidenceId,
    target: { kind: targetKind, id: targetId },
    bindingReason: "direct-selector",
    authorityEffect: "checkpoint-eligible",
    createdAt,
    provenance
  };
}

function projectionFile(path: string, body: string, targetKind: ArchitectureLedgerProjectionFile["targetKind"], targetId: string): ArchitectureLedgerProjectionFile {
  return {
    path,
    body,
    digest: digestJson({ path, body } as unknown as Json),
    targetKind,
    targetId
  };
}

function modelFileDigest(file: ArchitectureLedgerModelFile): string {
  return file.digest ?? digestJson({ path: file.path, body: file.body } as unknown as Json);
}

function architectureLedgerProjectionDiffs(
  projectedFiles: ArchitectureLedgerProjectionFile[],
  files: ArchitectureLedgerModelFile[]
): ArchitectureLedgerProjectionDiff[] {
  const projected = new Map(projectedFiles.map((file) => [file.path, file]));
  const actual = new Map(files.map((file) => [file.path, file]));
  const diffs: ArchitectureLedgerProjectionDiff[] = [];
  for (const file of projectedFiles) {
    const actualFile = actual.get(file.path);
    if (!actualFile) {
      diffs.push({
        path: file.path,
        reasonCode: "projection-file-missing",
        expectedDigest: file.digest,
        targetKind: file.targetKind,
        targetId: file.targetId
      });
      continue;
    }
    const actualDigest = modelFileDigest(actualFile);
    if (actualDigest !== file.digest) {
      diffs.push({
        path: file.path,
        reasonCode: "projection-file-digest-mismatch",
        expectedDigest: file.digest,
        actualDigest,
        targetKind: file.targetKind,
        targetId: file.targetId
      });
    }
  }
  for (const file of files) {
    if (!isArchitectureModelProjectionPath(file.path) || projected.has(file.path)) continue;
    diffs.push({
      path: file.path,
      reasonCode: "projection-file-extra",
      actualDigest: modelFileDigest(file)
    });
  }
  return diffs.sort((left, right) => left.path.localeCompare(right.path) || left.reasonCode.localeCompare(right.reasonCode));
}

function architectureLedgerDeletionOperations(
  previousState: ArchitectureLedgerGraphState,
  nextState: ArchitectureLedgerGraphState
): ArchitectureLedgerOperation[] {
  const nextEntities = new Set(nextState.entities.map((entity) => entity.entityId));
  const nextRelations = new Set(nextState.relations.map((relation) => relation.relationId));
  const nextConstraints = new Set(nextState.constraints.map((constraint) => constraint.constraintId));
  return [
    ...previousState.constraints
      .filter((constraint) => !nextConstraints.has(constraint.constraintId))
      .map((constraint) => ({ op: "delete_constraint" as const, constraintId: constraint.constraintId }))
      .sort((left, right) => operationKey(left).localeCompare(operationKey(right))),
    ...previousState.relations
      .filter((relation) => !nextRelations.has(relation.relationId))
      .map((relation) => ({ op: "delete_relation" as const, relationId: relation.relationId }))
      .sort((left, right) => operationKey(left).localeCompare(operationKey(right))),
    ...previousState.entities
      .filter((entity) => !nextEntities.has(entity.entityId))
      .map((entity) => ({ op: "delete_entity" as const, entityId: entity.entityId }))
      .sort((left, right) => operationKey(left).localeCompare(operationKey(right)))
  ];
}

function isArchitectureModelProjectionPath(path: string): boolean {
  return path.startsWith(".archcontext/model/nodes/") ||
    path.startsWith(".archcontext/model/relations/") ||
    path.startsWith(".archcontext/model/constraints/");
}

function operationKey(operation: ArchitectureLedgerOperation): string {
  switch (operation.op) {
    case "upsert_entity":
      return `entity:${operation.entity.entityId}`;
    case "delete_entity":
      return `entity:${operation.entityId}`;
    case "upsert_relation":
      return `relation:${operation.relation.relationId}`;
    case "delete_relation":
      return `relation:${operation.relationId}`;
    case "upsert_constraint":
      return `constraint:${operation.constraint.constraintId}`;
    case "delete_constraint":
      return `constraint:${operation.constraintId}`;
  }
}

function isEvidenceOnlySchema(schemaVersion: string): boolean {
  return [
    "archcontext.manifest/v1",
    "archcontext.product/v1",
    "archcontext.policy/v1",
    "archcontext.practice/v1",
    "archcontext.decision/v1",
    "archcontext.adr/v1"
  ].includes(schemaVersion);
}

function isGeneratedProjectionFile(file: ArchitectureLedgerModelFile): boolean {
  return file.schemaVersion === "archcontext.generated/v1" ||
    file.path === ".archcontext/generated" ||
    file.path.startsWith(".archcontext/generated/") ||
    file.body.includes("Generated by ArchContext");
}

function declaredProjectionRecord(
  metadata: Record<string, Json> | undefined,
  allowedSchemaVersions: string[],
  label: string
): Record<string, Json> {
  const declared = metadata?.declared;
  if (!isRecord(declared)) throw new Error(`architecture-ledger-projection-invalid: ${label} has no declared YAML record`);
  const schemaVersion = requireStringField(declared, "schemaVersion", label);
  if (!allowedSchemaVersions.includes(schemaVersion)) {
    throw new Error(`architecture-ledger-projection-invalid: ${label} has unsupported declared schema ${schemaVersion}`);
  }
  return declared;
}

function requiredRecordField(value: Record<string, Json>, key: string, path: string): Record<string, Json> {
  const field = value[key];
  if (!isRecord(field)) throw new Error(`${path}: ${key} is required`);
  return field;
}

function firstStringArrayValue(value: Json | undefined): string | undefined {
  return Array.isArray(value) ? value.find((item): item is string => typeof item === "string" && item.length > 0) : undefined;
}

function requiredSeverity(value: Json | undefined, path: string): "notice" | "warning" | "error" | "critical" {
  const severity = severityField(value);
  if (!severity) throw new Error(`${path}: severity is required`);
  return severity;
}

function declaredYamlSubject(value: Record<string, Json>, path: string): string {
  const id = stringField(value, "id");
  if (id) return id;
  const product = value.product;
  if (isRecord(product)) {
    const productId = stringField(product, "id");
    if (productId) return productId;
  }
  return path;
}

function repoScopedTarget(value: Json | undefined, path: string, label: string): string {
  if (typeof value === "string") return value;
  if (isRecord(value)) {
    const repositoryId = requireStringField(value, "repositoryId", path);
    const nodeId = requireStringField(value, "nodeId", path);
    return `${repositoryId}::${nodeId}`;
  }
  throw new Error(`${path}: ${label} must be a string or repo-scoped target`);
}

function requireStringField(value: Record<string, Json>, key: string, path: string): string {
  const field = stringField(value, key);
  if (!field) throw new Error(`${path}: ${key} is required`);
  return field;
}

function stringField(value: Record<string, Json>, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

function declaredStatus(value: Json | undefined, path: string): "active" | "planned" | "deprecated" | "removed" {
  if (value === "active" || value === "planned" || value === "deprecated" || value === "removed") return value;
  throw new Error(`${path}: status is required`);
}

function severityField(value: Json | undefined): "notice" | "warning" | "error" | "critical" | undefined {
  return value === "notice" || value === "warning" || value === "error" || value === "critical" ? value : undefined;
}

function pathSegment(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]+/g, "_");
}

function digestSuffix(digest: string): string {
  return digest.replace(/^sha256:/, "").slice(0, 16);
}

function changeSetLedgerSummary(draft: ChangeSetDraft): Record<string, Json> {
  return {
    id: draft.id,
    status: draft.status,
    reason: draft.reason as unknown as Json,
    base: draft.base as unknown as Json,
    idempotencyKey: draft.idempotencyKey,
    operationCount: draft.operations.length,
    operations: draft.operations.map((operation) => ({
      op: operation.op,
      ...(operation.path ? { path: operation.path } : {}),
      ...(operation.entityId ? { entityId: operation.entityId } : {}),
      expectedHash: operation.expectedHash,
      ...(operation.body ? { bodyDigest: digestJson({ body: operation.body } as unknown as Json) } : {})
    } as unknown as Json))
  };
}

function isRecord(value: Json | undefined): value is Record<string, Json> {
  return value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value);
}

export function emptyArchitectureLedgerState(): ArchitectureLedgerGraphState {
  return { entities: [], relations: [], constraints: [] };
}

export function replayArchitectureLedgerEvents(events: ArchitectureEventV1[]): ArchitectureLedgerGraphState {
  const state = mutableState(emptyArchitectureLedgerState());
  for (const event of events) applyArchitectureLedgerEvent(state, event);
  return freezeState(state);
}

export function architectureLedgerSnapshotFromState(input: ArchitectureLedgerSnapshotInput & {
  lastEventId: string;
  lastEventHash: string;
  state: ArchitectureLedgerGraphState;
}): ArchitectureSnapshotV1 {
  const snapshot: ArchitectureSnapshotV1 = {
    schemaVersion: "archcontext.architecture-snapshot/v1",
    snapshotId: input.snapshotId ?? `architecture_snapshot.${digestJson({
      repository: input.repository,
      worktree: input.worktree,
      lastEventId: input.lastEventId,
      graphDigest: architectureLedgerStateDigest(input.state)
    } as unknown as Json).slice("sha256:".length, "sha256:".length + 16)}`,
    repository: input.repository,
    worktree: input.worktree,
    sourceMode: input.sourceMode,
    eventCursor: {
      lastEventId: input.lastEventId,
      lastEventHash: input.lastEventHash
    },
    graphDigest: architectureLedgerStateDigest(input.state),
    projectionDigest: input.projectionDigest,
    entityCount: input.state.entities.length,
    relationCount: input.state.relations.length,
    constraintCount: input.state.constraints.length,
    inputDigests: input.inputDigests,
    createdAt: input.createdAt
  };
  return {
    ...snapshot,
    extensions: {
      digest: architectureSnapshotDigest(snapshot)
    }
  };
}

export function architectureLedgerPayload(event: ArchitectureEventV1): ArchitectureLedgerEventPayload {
  assertRecord(event.payload, `event payload for ${event.eventId}`);
  const payload = event.payload as unknown as ArchitectureLedgerEventPayload;
  if (payload.operations !== undefined && !Array.isArray(payload.operations)) {
    throw new Error(`architecture-ledger-invalid-payload: operations must be an array for ${event.eventId}`);
  }
  return payload;
}

export function validateArchitectureLedgerEvent(event: ArchitectureEventV1): void {
  if (event.repository.repositoryId.length === 0 || event.repository.storageRepositoryId.length === 0) {
    throw new Error(`architecture-ledger-invalid-event: repository identity required for ${event.eventId}`);
  }
  if (event.worktree.workspaceId.length === 0 || event.worktree.storageWorkspaceId.length === 0 || event.worktree.headSha.length === 0) {
    throw new Error(`architecture-ledger-invalid-event: worktree identity required for ${event.eventId}`);
  }
  assertArchitectureLedgerPersistenceSafe(event.payload, `event.payload for ${event.eventId}`);
  if (event.extensions) assertArchitectureLedgerPersistenceSafe(event.extensions as unknown as Json, `event.extensions for ${event.eventId}`);
  assertArchitectureLedgerPersistenceSafe(event.provenance as unknown as Json, `event.provenance for ${event.eventId}`);
  const payload = architectureLedgerPayload(event);
  for (const operation of payload.operations ?? []) validateArchitectureLedgerOperation(operation, event.eventId);
}

const ARCHITECTURE_LEDGER_MAX_PERSISTED_JSON_BYTES = 262_144;
const ARCHITECTURE_LEDGER_MAX_PERSISTED_STRING_BYTES = 8_192;
const ARCHITECTURE_LEDGER_MAX_PERSISTED_DEPTH = 32;
const ARCHITECTURE_LEDGER_FORBIDDEN_RAW_KEYS = new Set([
  "rawsource",
  "sourcebody",
  "sourcecode",
  "rawdiff",
  "diffbody",
  "rawpatch",
  "patchbody",
  "prompt",
  "promptbody",
  "completion",
  "completionbody",
  "codegraphoutput",
  "fullcodegraphoutput",
  "webhookbody",
  "rawwebhook",
  "secret",
  "secrets",
  "credential",
  "credentials",
  "privatekey",
  "accesstoken",
  "refreshtoken"
]);
const ARCHITECTURE_LEDGER_SAFE_SENSITIVE_KEY_SUFFIX = /(?:digest|id|ids|count|counts|ref|refs|path|paths|persisted)$/;
const ARCHITECTURE_LEDGER_FORBIDDEN_STRING_PATTERNS = [
  /diff --git /,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i,
  /\b(?:api[_-]?key|secret|token|password|private[_-]?key)\s*[:=]\s*["']?[^\s"',;]{8,}/i
];

export function assertArchitectureLedgerPersistenceSafe(value: Json, label = "architecture-ledger-value"): void {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > ARCHITECTURE_LEDGER_MAX_PERSISTED_JSON_BYTES) {
    throw new Error(`architecture-ledger-privacy-denied: persisted JSON exceeds size limit at ${label}`);
  }
  visit(value, label, 0);

  function visit(current: Json, path: string, depth: number): void {
    if (depth > ARCHITECTURE_LEDGER_MAX_PERSISTED_DEPTH) {
      throw new Error(`architecture-ledger-privacy-denied: persisted JSON exceeds depth limit at ${path}`);
    }
    if (typeof current === "string") {
      if (Buffer.byteLength(current, "utf8") > ARCHITECTURE_LEDGER_MAX_PERSISTED_STRING_BYTES) {
        throw new Error(`architecture-ledger-privacy-denied: persisted string exceeds size limit at ${path}`);
      }
      if (ARCHITECTURE_LEDGER_FORBIDDEN_STRING_PATTERNS.some((pattern) => pattern.test(current))) {
        throw new Error(`architecture-ledger-privacy-denied: forbidden raw or secret-shaped content at ${path}`);
      }
      return;
    }
    if (current === null || typeof current !== "object") return;
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(current)) {
      const normalizedKey = key.replace(/[-_]/g, "").toLowerCase();
      if (
        ARCHITECTURE_LEDGER_FORBIDDEN_RAW_KEYS.has(normalizedKey)
        && !ARCHITECTURE_LEDGER_SAFE_SENSITIVE_KEY_SUFFIX.test(normalizedKey)
      ) {
        throw new Error(`architecture-ledger-privacy-denied: forbidden persisted field at ${path}.${key}`);
      }
      visit(child, `${path}.${key}`, depth + 1);
    }
  }
}

function validateArchitectureLedgerOperation(operation: ArchitectureLedgerOperation, eventId: string): void {
  if (!operation || typeof operation !== "object" || !("op" in operation)) {
    throw new Error(`architecture-ledger-invalid-operation: ${eventId}`);
  }
  switch (operation.op) {
    case "upsert_entity":
      requireNonEmpty(operation.entity.entityId, "entity.entityId", eventId);
      requireNonEmpty(operation.entity.kind, "entity.kind", eventId);
      requireNonEmpty(operation.entity.canonicalName, "entity.canonicalName", eventId);
      requireActiveStatus(operation.entity.status, eventId);
      return;
    case "delete_entity":
      requireNonEmpty(operation.entityId, "entityId", eventId);
      return;
    case "upsert_relation":
      requireNonEmpty(operation.relation.relationId, "relation.relationId", eventId);
      requireNonEmpty(operation.relation.sourceEntityId, "relation.sourceEntityId", eventId);
      requireNonEmpty(operation.relation.targetEntityId, "relation.targetEntityId", eventId);
      requireActiveStatus(operation.relation.status, eventId);
      return;
    case "delete_relation":
      requireNonEmpty(operation.relationId, "relationId", eventId);
      return;
    case "upsert_constraint":
      requireNonEmpty(operation.constraint.constraintId, "constraint.constraintId", eventId);
      requireNonEmpty(operation.constraint.subjectId, "constraint.subjectId", eventId);
      requireActiveStatus(operation.constraint.status, eventId);
      return;
    case "delete_constraint":
      requireNonEmpty(operation.constraintId, "constraintId", eventId);
      return;
  }
}

function applyArchitectureLedgerEvent(state: MutableArchitectureLedgerState, event: ArchitectureEventV1): void {
  const payload = architectureLedgerPayload(event);
  for (const operation of payload.operations ?? []) {
    switch (operation.op) {
      case "upsert_entity":
        state.entities.set(operation.entity.entityId, normalizeEntity(operation.entity));
        break;
      case "delete_entity":
        state.entities.delete(operation.entityId);
        for (const [relationId, relation] of state.relations) {
          if (relation.sourceEntityId === operation.entityId || relation.targetEntityId === operation.entityId) state.relations.delete(relationId);
        }
        break;
      case "upsert_relation":
        state.relations.set(operation.relation.relationId, normalizeRelation(operation.relation));
        break;
      case "delete_relation":
        state.relations.delete(operation.relationId);
        break;
      case "upsert_constraint":
        state.constraints.set(operation.constraint.constraintId, normalizeConstraint(operation.constraint));
        break;
      case "delete_constraint":
        state.constraints.delete(operation.constraintId);
        break;
    }
  }
}

function canonicalArchitectureLedgerState(state: ArchitectureLedgerGraphState): ArchitectureLedgerGraphState {
  return {
    entities: [...state.entities].map(normalizeEntity).sort((left, right) => left.entityId.localeCompare(right.entityId)),
    relations: [...state.relations].map(normalizeRelation).sort((left, right) => left.relationId.localeCompare(right.relationId)),
    constraints: [...state.constraints].map(normalizeConstraint).sort((left, right) => left.constraintId.localeCompare(right.constraintId))
  };
}

interface MutableArchitectureLedgerState {
  entities: Map<string, ArchitectureLedgerEntityRecord>;
  relations: Map<string, ArchitectureLedgerRelationRecord>;
  constraints: Map<string, ArchitectureLedgerConstraintRecord>;
}

function mutableState(state: ArchitectureLedgerGraphState): MutableArchitectureLedgerState {
  return {
    entities: new Map(state.entities.map((entity) => [entity.entityId, normalizeEntity(entity)])),
    relations: new Map(state.relations.map((relation) => [relation.relationId, normalizeRelation(relation)])),
    constraints: new Map(state.constraints.map((constraint) => [constraint.constraintId, normalizeConstraint(constraint)]))
  };
}

function freezeState(state: MutableArchitectureLedgerState): ArchitectureLedgerGraphState {
  return canonicalArchitectureLedgerState({
    entities: [...state.entities.values()],
    relations: [...state.relations.values()],
    constraints: [...state.constraints.values()]
  });
}

function normalizeEntity(entity: ArchitectureLedgerEntityRecord): ArchitectureLedgerEntityRecord {
  return {
    entityId: entity.entityId,
    kind: entity.kind,
    canonicalName: entity.canonicalName,
    status: entity.status,
    ...(entity.path ? { path: entity.path } : {}),
    ...(entity.summary ? { summary: entity.summary } : {}),
    ...(entity.metadata ? { metadata: entity.metadata } : {})
  };
}

function normalizeRelation(relation: ArchitectureLedgerRelationRecord): ArchitectureLedgerRelationRecord {
  return {
    relationId: relation.relationId,
    kind: relation.kind,
    sourceEntityId: relation.sourceEntityId,
    targetEntityId: relation.targetEntityId,
    status: relation.status,
    ...(relation.summary ? { summary: relation.summary } : {}),
    ...(relation.metadata ? { metadata: relation.metadata } : {})
  };
}

function normalizeConstraint(constraint: ArchitectureLedgerConstraintRecord): ArchitectureLedgerConstraintRecord {
  return {
    constraintId: constraint.constraintId,
    kind: constraint.kind,
    subjectId: constraint.subjectId,
    status: constraint.status,
    ...(constraint.severity ? { severity: constraint.severity } : {}),
    ...(constraint.summary ? { summary: constraint.summary } : {}),
    ...(constraint.metadata ? { metadata: constraint.metadata } : {})
  };
}

function requireNonEmpty(value: string, label: string, eventId: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`architecture-ledger-invalid-operation: ${label} required for ${eventId}`);
  }
}

function requireActiveStatus(value: string, eventId: string): void {
  if (!["active", "planned", "deprecated", "removed"].includes(value)) {
    throw new Error(`architecture-ledger-invalid-operation: invalid status for ${eventId}`);
  }
}

function assertRecord(value: Json, label: string): asserts value is { [key: string]: Json } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`architecture-ledger-invalid-payload: ${label} must be an object`);
  }
}
