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

export type ArchitectureLedgerWriter = "runtime-daemon";

export interface ArchitectureLedgerScope {
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
}

export interface ArchitectureLedgerEntityRecord {
  entityId: string;
  kind: string;
  canonicalName: string;
  status: "active" | "deprecated" | "removed";
  path?: string;
  summary?: string;
  metadata?: Record<string, Json>;
}

export interface ArchitectureLedgerRelationRecord {
  relationId: string;
  kind: string;
  sourceEntityId: string;
  targetEntityId: string;
  status: "active" | "deprecated" | "removed";
  summary?: string;
  metadata?: Record<string, Json>;
}

export interface ArchitectureLedgerConstraintRecord {
  constraintId: string;
  kind: string;
  subjectId: string;
  status: "active" | "deprecated" | "removed";
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
  const payload = architectureLedgerPayload(event);
  for (const operation of payload.operations ?? []) validateArchitectureLedgerOperation(operation, event.eventId);
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
  if (!["active", "deprecated", "removed"].includes(value)) {
    throw new Error(`architecture-ledger-invalid-operation: invalid status for ${eventId}`);
  }
}

function assertRecord(value: Json, label: string): asserts value is { [key: string]: Json } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`architecture-ledger-invalid-payload: ${label} must be an object`);
  }
}
