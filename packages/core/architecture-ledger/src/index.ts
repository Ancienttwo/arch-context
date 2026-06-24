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
import { canonicalArchitectureYaml, parseJsonOrStableYaml } from "../../architecture-domain/src/index";

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

export function planYamlToArchitectureLedgerImport(input: ArchitectureLedgerYamlImportInput): ArchitectureLedgerYamlImportPlan {
  const sourceDigest = architectureLedgerModelFilesDigest(input.files);
  const collected = collectYamlModelFacts(input.files, input.createdAt, {
    producer: "architecture-ledger-yaml-import",
    command: input.command ?? "archctx ledger migrate --from-yaml --dry-run",
    inputDigest: sourceDigest
  });
  const state = stateFromOperations(collected.operations);
  const graphDigest = architectureLedgerStateDigest(state);
  const event = normalizeArchitectureLedgerEvent({
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: `architecture_event.yaml_import.${digestSuffix(sourceDigest)}`,
    eventType: "architecture.yaml.import",
    payloadVersion: "archcontext.architecture-ledger-yaml-import/v1",
    repository: input.repository,
    worktree: input.worktree,
    baseDigest: sourceDigest,
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
      sourceCursors: collected.sourceCursors
    } as unknown as Json
  }, null);
  const projectedFiles = projectArchitectureLedgerStateToYamlFiles(state);
  const projectionDigest = architectureLedgerProjectionDigest(projectedFiles);
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

export function projectArchitectureLedgerStateToYamlFiles(state: ArchitectureLedgerGraphState): ArchitectureLedgerProjectionFile[] {
  const canonical = canonicalArchitectureLedgerState(state);
  const files: ArchitectureLedgerProjectionFile[] = [
    ...canonical.entities.map((entity) => {
      const body = canonicalArchitectureYaml({
        schemaVersion: "archcontext.node/v1",
        id: entity.entityId,
        kind: entity.kind,
        name: entity.canonicalName,
        status: entity.status,
        ...(entity.path ? { path: entity.path } : {}),
        ...(entity.summary ? { summary: entity.summary } : {}),
        ...(entity.metadata ? { metadata: entity.metadata as unknown as Json } : {})
      } as unknown as Json);
      return projectionFile(`.archcontext/model/nodes/${pathSegment(entity.entityId)}.yaml`, body, "entity", entity.entityId);
    }),
    ...canonical.relations.map((relation) => {
      const body = canonicalArchitectureYaml({
        schemaVersion: "archcontext.relation/v1",
        id: relation.relationId,
        kind: relation.kind,
        source: relation.sourceEntityId,
        target: relation.targetEntityId,
        status: relation.status,
        ...(relation.summary ? { summary: relation.summary } : {}),
        ...(relation.metadata ? { metadata: relation.metadata as unknown as Json } : {})
      } as unknown as Json);
      return projectionFile(`.archcontext/model/relations/${pathSegment(relation.relationId)}.yaml`, body, "relation", relation.relationId);
    }),
    ...canonical.constraints.map((constraint) => {
      const body = canonicalArchitectureYaml({
        schemaVersion: "archcontext.constraint/v1",
        id: constraint.constraintId,
        kind: constraint.kind,
        subject: constraint.subjectId,
        status: constraint.status,
        ...(constraint.severity ? { severity: constraint.severity } : {}),
        ...(constraint.summary ? { summary: constraint.summary } : {}),
        ...(constraint.metadata ? { metadata: constraint.metadata as unknown as Json } : {})
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
      value = parseJsonOrStableYaml(file.body, file.path);
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
        const evidence = yamlEvidenceItem(file, schemaVersion, createdAt, provenance);
        evidenceItems.push(evidence);
        imported.push({ path: file.path, schemaVersion, targetKind: "evidence", targetId: evidence.evidenceId });
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
    const evidence = yamlEvidenceItem(file, schemaVersion, createdAt, provenance);
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

function yamlRecordToLedgerOperation(value: Record<string, Json>, path: string, schemaVersion: string): {
  operation: ArchitectureLedgerOperation;
  targetKind: "entity" | "relation" | "constraint";
  targetId: string;
} | undefined {
  if (schemaVersion === "archcontext.node/v1") {
    const entityId = requireStringField(value, "id", path);
    const entity: ArchitectureLedgerEntityRecord = {
      entityId,
      kind: stringField(value, "kind") ?? "component",
      canonicalName: stringField(value, "name") ?? stringField(value, "canonicalName") ?? entityId,
      status: activeStatus(value.status),
      ...(stringField(value, "path") ? { path: stringField(value, "path") } : {}),
      ...(stringField(value, "summary") ? { summary: stringField(value, "summary") } : {}),
      ...metadataField(value, ["schemaVersion", "id", "kind", "name", "canonicalName", "status", "path", "summary"])
    };
    return { operation: { op: "upsert_entity", entity }, targetKind: "entity", targetId: entityId };
  }
  if (schemaVersion === "archcontext.relation/v1") {
    const relationId = requireStringField(value, "id", path);
    const relation: ArchitectureLedgerRelationRecord = {
      relationId,
      kind: stringField(value, "kind") ?? "depends_on",
      sourceEntityId: requireStringField(value, "source", path),
      targetEntityId: requireStringField(value, "target", path),
      status: activeStatus(value.status),
      ...(stringField(value, "summary") ?? stringField(value, "intent") ? { summary: stringField(value, "summary") ?? stringField(value, "intent") } : {}),
      ...metadataField(value, ["schemaVersion", "id", "kind", "source", "target", "status", "summary", "intent"])
    };
    return { operation: { op: "upsert_relation", relation }, targetKind: "relation", targetId: relationId };
  }
  if (schemaVersion === "archcontext.cross-repo-relation/v1") {
    const relationId = requireStringField(value, "id", path);
    const source = repoScopedTarget(value.source, path, "source");
    const target = repoScopedTarget(value.target, path, "target");
    const relation: ArchitectureLedgerRelationRecord = {
      relationId,
      kind: stringField(value, "kind") ?? "depends_on",
      sourceEntityId: source,
      targetEntityId: target,
      status: activeStatus(value.status),
      ...(stringField(value, "intent") ? { summary: stringField(value, "intent") } : {}),
      ...metadataField(value, ["schemaVersion", "id", "kind", "source", "target", "status", "intent"])
    };
    return { operation: { op: "upsert_relation", relation }, targetKind: "relation", targetId: relationId };
  }
  if (schemaVersion === "archcontext.constraint/v1") {
    const constraintId = requireStringField(value, "id", path);
    const constraint: ArchitectureLedgerConstraintRecord = {
      constraintId,
      kind: stringField(value, "kind") ?? "constraint",
      subjectId: stringField(value, "subject") ?? stringField(value, "subjectId") ?? "repository",
      status: activeStatus(value.status),
      ...(severityField(value.severity) ? { severity: severityField(value.severity) } : {}),
      ...(stringField(value, "summary") ? { summary: stringField(value, "summary") } : {}),
      ...metadataField(value, ["schemaVersion", "id", "kind", "subject", "subjectId", "status", "severity", "summary"])
    };
    return { operation: { op: "upsert_constraint", constraint }, targetKind: "constraint", targetId: constraintId };
  }
  return undefined;
}

function yamlEvidenceItem(file: ArchitectureLedgerModelFile, schemaVersion: string, createdAt: string, provenance: ArchitectureEventV1["provenance"]): EvidenceItemV2 {
  const digest = modelFileDigest(file);
  return {
    schemaVersion: "archcontext.evidence-item/v2",
    evidenceId: `evidence.yaml.${digestSuffix(digest)}`,
    kind: "architecture-yaml-declaration",
    strength: "declared",
    polarity: "declaration",
    origin: "model-store-yaml",
    subject: file.path,
    selector: { kind: "path", id: file.path, path: file.path },
    summary: `${schemaVersion || "unknown schema"} declared at ${file.path}`,
    coverage: { level: "complete", scope: file.path },
    supports: ["checkpoint", "complete"],
    provenance,
    createdAt,
    digest
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

function metadataField(value: Record<string, Json>, omitted: string[]): { metadata?: Record<string, Json> } {
  const metadata: Record<string, Json> = {};
  const explicit = value.metadata;
  if (isRecord(explicit)) {
    for (const key of Object.keys(explicit).sort()) metadata[key] = explicit[key]!;
  }
  for (const key of Object.keys(value).sort()) {
    if (omitted.includes(key) || key === "metadata") continue;
    metadata[key] = value[key]!;
  }
  return Object.keys(metadata).length === 0 ? {} : { metadata };
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

function activeStatus(value: Json | undefined): "active" | "deprecated" | "removed" {
  return value === "deprecated" || value === "removed" ? value : "active";
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
