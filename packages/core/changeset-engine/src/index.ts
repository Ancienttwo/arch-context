import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ARCHITECTURE_EVENT_SCHEMA_VERSION,
  architectureEventHash,
  digestJson,
  type ArchitectureCandidateChangeV1,
  type ArchitectureCandidateDeltaPolicyAction,
  type ArchitectureCandidateDeltaPolicyDecisionV1,
  type ArchitectureCandidateDeltaPolicyEvaluationV1,
  type ArchitectureCandidateDeltaV1,
  type ArchitectureEventSource,
  type ArchitectureEventV1,
  type Json,
  type ModelStorePort
} from "@archcontext/contracts";
import { assertAllowedArchContextPath, evaluateChangeSetPaths } from "@archcontext/core/policy-engine";

export type ChangeSetStatus = "proposed" | "approved" | "applied" | "rolled-back" | "rejected";
export type ChangeOperationKind = "create_entity" | "update_entity_fields" | "delete_entity" | "write_policy" | "write_waiver" | "render_projection";

export interface ChangeSetBase {
  headSha: string;
  worktreeDigest: string;
  modelDigest: string;
}

export interface ChangeSetReason {
  taskSessionId: string;
  interventionId?: string;
}

export interface ChangeOperation {
  op: ChangeOperationKind;
  path?: string;
  entityId?: string;
  expectedHash: string;
  body?: string;
  projectionFiles?: ChangeSetProjectionFile[];
}

export interface ChangeSetProjectionFile {
  path: string;
  expectedHash: string;
  body: string;
}

export const ARCHITECTURE_CANDIDATE_CHANGESET_PLAN_SCHEMA_VERSION = "archcontext.architecture-candidate-changeset-plan/v1" as const;

export interface ArchitectureCandidateChangeOperation extends ChangeOperation {
  candidateChangeId: string;
  targetKind: ArchitectureCandidateChangeV1["target"]["kind"];
  targetId: string;
  targetParentId?: string;
  stateDimension: ArchitectureCandidateChangeV1["stateDimension"];
  changeKind: ArchitectureCandidateChangeV1["changeKind"];
  confidence: ArchitectureCandidateChangeV1["confidence"];
  evidenceIds: string[];
  subjectSelectorIds: string[];
  mappingIds: string[];
  ambiguityIds: string[];
  candidateChangeDigest: string;
  policyDecisionDigest: string;
  summary: string;
  changes: Json;
}

export interface ChangeSetDraft {
  schemaVersion: "archcontext.changeset/v1";
  id: string;
  status: ChangeSetStatus;
  base: ChangeSetBase;
  reason: ChangeSetReason;
  operations: ChangeOperation[];
  preconditions: string[];
  postconditions: string[];
  requiresConfirmation: boolean;
  idempotencyKey: string;
}

export interface ApplyOptions {
  approved?: boolean;
  faultAfterOperations?: number;
  afterModelValidatedBeforeCommit?: (input: { root: string; draft: ChangeSetDraft; journalId?: string }) => Promise<void> | void;
}

export interface ProjectionRebuilderPort {
  rebuildGeneratedProjection(root: string): void;
}

export interface ChangeSetJournalFile {
  path: string;
  tempPath?: string;
  backupPath?: string;
  existed: boolean;
  operation: ChangeOperationKind;
}

export interface ChangeSetJournalPort {
  beginChangeSet(root: string, draft: ChangeSetDraft): Promise<string>;
  recordChangeSetFile(journalId: string, file: ChangeSetJournalFile): Promise<void>;
  commitChangeSet(journalId: string): Promise<void>;
  abortChangeSet(journalId: string, reason: string): Promise<void>;
  recoverPendingChangeSets(): number;
}

export interface ChangeSetEngineDeps {
  modelStore: ModelStorePort;
  projection: ProjectionRebuilderPort;
  journal?: ChangeSetJournalPort;
}

export interface ArchitectureCandidateDeferredChange {
  candidateChangeId: string;
  action?: ArchitectureCandidateDeltaPolicyAction;
  reason: "policy-action-not-accepted" | "missing-policy-decision";
  reasonCodes: string[];
  target: ArchitectureCandidateChangeV1["target"];
  stateDimension: ArchitectureCandidateChangeV1["stateDimension"];
  changeKind: ArchitectureCandidateChangeV1["changeKind"];
  confidence: ArchitectureCandidateChangeV1["confidence"];
}

export interface ArchitectureCandidateChangeSetPlanInput {
  delta: ArchitectureCandidateDeltaV1;
  policyEvaluation: ArchitectureCandidateDeltaPolicyEvaluationV1;
  base: ChangeSetBase;
  reason: ChangeSetReason;
  acceptedActions?: ArchitectureCandidateDeltaPolicyAction[];
  actor?: ArchitectureEventV1["actor"];
  source?: ArchitectureEventSource;
  timestamp?: string;
  previousEventHash?: string | null;
}

export interface ArchitectureCandidateChangeSetPlan {
  schemaVersion: typeof ARCHITECTURE_CANDIDATE_CHANGESET_PLAN_SCHEMA_VERSION;
  changeSet: ChangeSetDraft;
  eventBatch: ArchitectureEventV1[];
  acceptedCandidateChangeIds: string[];
  deferredCandidateChanges: ArchitectureCandidateDeferredChange[];
  planDigest: string;
}

export class ChangeSetEngine {
  private readonly states = new Map<string, ChangeSetDraft>();

  constructor(private readonly deps?: ChangeSetEngineDeps) {}

  plan(input: {
    id: string;
    base: ChangeSetBase;
    reason: ChangeSetReason;
    operations: ChangeOperation[];
    requiresConfirmation?: boolean;
  }): ChangeSetDraft {
    const draft: ChangeSetDraft = {
      schemaVersion: "archcontext.changeset/v1",
      id: input.id,
      status: "proposed",
      base: input.base,
      reason: input.reason,
      operations: input.operations,
      preconditions: ["schema-valid-before", "expected-digest-match"],
      postconditions: ["schema-valid-after", "projection-rebuilt"],
      requiresConfirmation: input.requiresConfirmation ?? true,
      idempotencyKey: `idem_${input.id}`
    };
    this.states.set(draft.id, draft);
    return draft;
  }

  preview(root: string, draft: ChangeSetDraft): { digest: string; paths: string[]; allowed: boolean; findings: string[] } {
    const paths = draft.operations.flatMap((operation) => [
      ...(operation.path ? [operation.path] : []),
      ...(operation.projectionFiles?.map((file) => file.path) ?? [])
    ]);
    const findings = evaluateChangeSetPaths(root, paths).map((finding) => finding.message);
    return { digest: digestJson(draft as unknown as Json), paths, allowed: findings.length === 0, findings };
  }

  approve(draft: ChangeSetDraft): ChangeSetDraft {
    const approved = { ...draft, status: "approved" as const };
    this.states.set(approved.id, approved);
    return approved;
  }

  async apply(root: string, draft: ChangeSetDraft, options: ApplyOptions = {}): Promise<ChangeSetDraft> {
    const approved = options.approved || draft.status === "approved";
    if (!approved) throw new Error("ChangeSet must be approved before apply");
    const deps = this.requireDeps();
    const backups: { path: string; backupPath: string; tempPath?: string; existed: boolean }[] = [];
    const journalId = await deps.journal?.beginChangeSet(root, draft);
    let journalCommitted = false;
    let applied = 0;
    try {
      for (const operation of draft.operations) {
        if (operation.op === "render_projection") {
          if (operation.projectionFiles && operation.projectionFiles.length > 0) {
            for (const file of operation.projectionFiles) {
              await this.applyFileOperation(root, file.path, file.expectedHash, file.body, operation.op, backups, journalId, applied + 1);
              applied += 1;
              if (options.faultAfterOperations && applied >= options.faultAfterOperations) throw new Error("fault-injection");
            }
          } else {
            this.rebuildGeneratedProjection(root, deps);
            applied += 1;
          }
          if (options.faultAfterOperations && applied >= options.faultAfterOperations) throw new Error("fault-injection");
          continue;
        }
        if (!operation.path) throw new Error(`Change operation requires path: ${operation.op}`);
        await this.applyFileOperation(root, operation.path, operation.expectedHash, operation.body ?? "", operation.op, backups, journalId, applied + 1);
        applied += 1;
        if (options.faultAfterOperations && applied >= options.faultAfterOperations) throw new Error("fault-injection");
      }
      this.rebuildGeneratedProjection(root, deps);
      await this.validateModel(root, draft, deps);
      await options.afterModelValidatedBeforeCommit?.({ root, draft, journalId });
      if (journalId) {
        await deps.journal?.commitChangeSet(journalId);
        journalCommitted = true;
      }
      try {
        cleanupBackups(backups);
      } catch {
        // A committed journal lets startup recovery remove stale temp/backup files without rolling back applied content.
      }
      const appliedDraft = { ...draft, status: "applied" as const };
      this.states.set(draft.id, appliedDraft);
      return appliedDraft;
    } catch (error) {
      if (!journalCommitted) {
        rollback(backups);
        if (journalId) await deps.journal?.abortChangeSet(journalId, error instanceof Error ? error.message : String(error));
      }
      const rolledBack = { ...draft, status: "rolled-back" as const };
      this.states.set(draft.id, rolledBack);
      throw error;
    }
  }

  private rebuildGeneratedProjection(root: string, deps: ChangeSetEngineDeps): void {
    deps.projection.rebuildGeneratedProjection(root);
  }

  private async validateModel(root: string, draft: ChangeSetDraft, deps: ChangeSetEngineDeps): Promise<void> {
    await deps.modelStore.validateModel({ root, repositoryId: draft.reason.taskSessionId, headSha: draft.base.headSha });
  }

  private requireDeps(): ChangeSetEngineDeps {
    if (!this.deps) throw new Error("ChangeSetEngine apply requires modelStore and projection dependencies");
    return this.deps;
  }

  private async applyFileOperation(
    root: string,
    path: string,
    expectedHash: string,
    body: string,
    operation: ChangeOperationKind,
    backups: { path: string; backupPath: string; tempPath?: string; existed: boolean }[],
    journalId: string | undefined,
    sequence: number
  ): Promise<void> {
    assertSafeTarget(root, path);
    const deps = this.requireDeps();
    const absolute = resolve(root, path);
    const existed = existsSync(absolute);
    const backupPath = `${absolute}.archctx-backup`;
    const tempPath = operation === "delete_entity" ? undefined : `${absolute}.archctx-tmp-${process.pid}-${sequence}`;
    if (existsSync(backupPath)) throw new Error(`Backup path already exists: ${path}`);
    if (existed) {
      assertExpectedHash(absolute, expectedHash);
      renameSync(absolute, backupPath);
      fsyncDirectory(dirname(absolute));
    } else if (expectedHash !== "missing") {
      throw new Error(`Expected missing file hash for new path: ${path}`);
    }
    backups.push({ path: absolute, backupPath, tempPath, existed });
    if (journalId) {
      await deps.journal?.recordChangeSetFile(journalId, {
        path,
        tempPath,
        backupPath,
        existed,
        operation
      });
    }
    if (operation === "delete_entity") {
      rmSync(absolute, { force: true });
    } else {
      atomicWriteFile(absolute, tempPath!, body);
    }
  }
}

export function planArchitectureCandidateChangeSet(input: ArchitectureCandidateChangeSetPlanInput): ArchitectureCandidateChangeSetPlan {
  assertNoAgentProposalDeltaPromotion(input.delta);
  assertPolicyEvaluationMatchesDelta(input.delta, input.policyEvaluation);
  const acceptedActionSet = new Set<ArchitectureCandidateDeltaPolicyAction>(input.acceptedActions ?? ["auto-accept"]);
  const candidatesById = new Map(input.delta.candidateChanges.map((candidate) => [candidate.candidateChangeId, candidate]));
  const decisionsByCandidateId = new Map(input.policyEvaluation.decisions.map((decision) => [decision.candidateChangeId, decision]));
  const accepted: { candidate: ArchitectureCandidateChangeV1; decision: ArchitectureCandidateDeltaPolicyDecisionV1 }[] = [];
  const deferred: ArchitectureCandidateDeferredChange[] = [];

  for (const decision of input.policyEvaluation.decisions) {
    const candidate = candidatesById.get(decision.candidateChangeId);
    if (!candidate) throw new Error(`Policy decision references unknown candidate change: ${decision.candidateChangeId}`);
    assertPolicyDecisionMatchesCandidate(candidate, decision);
    if (acceptedActionSet.has(decision.action)) {
      accepted.push({ candidate, decision });
    } else {
      deferred.push(deferredCandidate(candidate, decision, "policy-action-not-accepted"));
    }
  }

  for (const candidate of input.delta.candidateChanges) {
    if (!decisionsByCandidateId.has(candidate.candidateChangeId)) {
      deferred.push(deferredCandidate(candidate, undefined, "missing-policy-decision"));
    }
  }

  if (accepted.length === 0) throw new Error("No accepted architecture candidate changes available for ChangeSet planning");
  accepted.sort((left, right) => left.candidate.candidateChangeId.localeCompare(right.candidate.candidateChangeId));
  deferred.sort((left, right) => left.candidateChangeId.localeCompare(right.candidateChangeId));

  const acceptedCandidateChangeIds = accepted.map(({ candidate }) => candidate.candidateChangeId);
  const inputDigest = digestJson({
    deltaId: input.delta.deltaId,
    deltaDigest: input.delta.deltaDigest,
    evaluationId: input.policyEvaluation.evaluationId,
    evaluationDigest: input.policyEvaluation.evaluationDigest,
    acceptedActions: [...acceptedActionSet].sort(),
    acceptedCandidateChangeIds,
    base: input.base as unknown as Json,
    reason: input.reason as unknown as Json
  });
  const changeSetId = `changeset.architecture-candidates-${shortDigest(inputDigest)}`;
  const changeSet = new ChangeSetEngine().plan({
    id: changeSetId,
    base: input.base,
    reason: input.reason,
    operations: accepted.map(({ candidate, decision }) => candidateChangeOperation(candidate, decision)),
    requiresConfirmation: true
  });
  changeSet.preconditions = [
    "schema-valid-before",
    "expected-digest-match",
    "candidate-delta-policy-evaluated",
    "accepted-candidates-only"
  ];
  changeSet.postconditions = [
    "schema-valid-after",
    "ledger-event-batch-previewed",
    "projection-rebuild-required-on-apply"
  ];

  const eventBatch = [
    architectureCandidateChangeSetEvent({
      input,
      changeSet,
      acceptedCandidateChangeIds,
      deferredCandidateChanges: deferred,
      inputDigest
    })
  ];
  const planDigest = digestJson({
    schemaVersion: ARCHITECTURE_CANDIDATE_CHANGESET_PLAN_SCHEMA_VERSION,
    changeSet: changeSet as unknown as Json,
    eventBatch: eventBatch as unknown as Json,
    acceptedCandidateChangeIds,
    deferredCandidateChanges: deferred as unknown as Json
  });

  return {
    schemaVersion: ARCHITECTURE_CANDIDATE_CHANGESET_PLAN_SCHEMA_VERSION,
    changeSet,
    eventBatch,
    acceptedCandidateChangeIds,
    deferredCandidateChanges: deferred,
    planDigest
  };
}

function assertPolicyEvaluationMatchesDelta(delta: ArchitectureCandidateDeltaV1, policyEvaluation: ArchitectureCandidateDeltaPolicyEvaluationV1): void {
  if (delta.deltaId !== policyEvaluation.deltaId) throw new Error(`Policy evaluation delta mismatch: ${policyEvaluation.deltaId} !== ${delta.deltaId}`);
  if (delta.deltaDigest !== policyEvaluation.deltaDigest) throw new Error(`Policy evaluation digest mismatch: ${policyEvaluation.deltaDigest} !== ${delta.deltaDigest}`);
  if (!sameJson(delta.repository as unknown as Json, policyEvaluation.repository as unknown as Json)) throw new Error("Policy evaluation repository mismatch");
  if (!sameJson(delta.worktree as unknown as Json, policyEvaluation.worktree as unknown as Json)) throw new Error("Policy evaluation worktree mismatch");
}

function assertPolicyDecisionMatchesCandidate(candidate: ArchitectureCandidateChangeV1, decision: ArchitectureCandidateDeltaPolicyDecisionV1): void {
  if (!sameJson(candidate.target as unknown as Json, decision.target as unknown as Json)) throw new Error(`Policy decision target mismatch: ${decision.candidateChangeId}`);
  if (candidate.stateDimension !== decision.stateDimension) throw new Error(`Policy decision state dimension mismatch: ${decision.candidateChangeId}`);
  if (candidate.changeKind !== decision.changeKind) throw new Error(`Policy decision change kind mismatch: ${decision.candidateChangeId}`);
  if (candidate.confidence !== decision.confidence) throw new Error(`Policy decision confidence mismatch: ${decision.candidateChangeId}`);
}

function candidateChangeOperation(candidate: ArchitectureCandidateChangeV1, decision: ArchitectureCandidateDeltaPolicyDecisionV1): ArchitectureCandidateChangeOperation {
  const operation: ArchitectureCandidateChangeOperation = {
    op: operationKindForCandidate(candidate),
    entityId: candidate.target.parentId ?? candidate.target.id,
    expectedHash: candidate.changeKind === "added" ? "missing" : "unknown",
    candidateChangeId: candidate.candidateChangeId,
    targetKind: candidate.target.kind,
    targetId: candidate.target.id,
    stateDimension: candidate.stateDimension,
    changeKind: candidate.changeKind,
    confidence: candidate.confidence,
    evidenceIds: [...candidate.evidenceIds],
    subjectSelectorIds: [...candidate.subjectSelectorIds],
    mappingIds: [...candidate.mappingIds],
    ambiguityIds: [...candidate.ambiguityIds],
    candidateChangeDigest: candidate.digest,
    policyDecisionDigest: decision.digest,
    summary: candidate.summary,
    changes: {
      schemaVersion: ARCHITECTURE_CANDIDATE_CHANGESET_PLAN_SCHEMA_VERSION,
      summary: candidate.summary,
      heuristic: candidate.heuristic,
      policyAction: decision.action,
      policyReasonCodes: decision.reasonCodes,
      source: "architecture-candidate-delta"
    }
  };
  if (candidate.target.parentId) operation.targetParentId = candidate.target.parentId;
  return operation;
}

function operationKindForCandidate(candidate: ArchitectureCandidateChangeV1): ChangeOperationKind {
  if (candidate.changeKind === "added") return "create_entity";
  if (candidate.changeKind === "removed") return "delete_entity";
  return "update_entity_fields";
}

function deferredCandidate(
  candidate: ArchitectureCandidateChangeV1,
  decision: ArchitectureCandidateDeltaPolicyDecisionV1 | undefined,
  reason: ArchitectureCandidateDeferredChange["reason"]
): ArchitectureCandidateDeferredChange {
  const deferred: ArchitectureCandidateDeferredChange = {
    candidateChangeId: candidate.candidateChangeId,
    reason,
    reasonCodes: decision ? [...decision.reasonCodes] : [],
    target: candidate.target,
    stateDimension: candidate.stateDimension,
    changeKind: candidate.changeKind,
    confidence: candidate.confidence
  };
  if (decision) deferred.action = decision.action;
  return deferred;
}

function architectureCandidateChangeSetEvent(input: {
  input: ArchitectureCandidateChangeSetPlanInput;
  changeSet: ChangeSetDraft;
  acceptedCandidateChangeIds: string[];
  deferredCandidateChanges: ArchitectureCandidateDeferredChange[];
  inputDigest: string;
}): ArchitectureEventV1 {
  const payload = {
    schemaVersion: ARCHITECTURE_CANDIDATE_CHANGESET_PLAN_SCHEMA_VERSION,
    changeSetId: input.changeSet.id,
    deltaId: input.input.delta.deltaId,
    deltaDigest: input.input.delta.deltaDigest,
    evaluationId: input.input.policyEvaluation.evaluationId,
    evaluationDigest: input.input.policyEvaluation.evaluationDigest,
    policyVersion: input.input.policyEvaluation.policyVersion,
    acceptedCandidateChangeIds: input.acceptedCandidateChangeIds,
    deferredCandidateChanges: input.deferredCandidateChanges as unknown as Json,
    operations: input.changeSet.operations as unknown as Json,
    authority: "preview-only",
    retention: "no-raw-source-or-diff-bodies"
  };
  const payloadDigest = digestJson(payload as unknown as Json);
  const eventId = `event.architecture-candidates.${shortDigest(digestJson({
    changeSetId: input.changeSet.id,
    inputDigest: input.inputDigest,
    payloadDigest
  }))}`;
  const event: ArchitectureEventV1 = {
    schemaVersion: ARCHITECTURE_EVENT_SCHEMA_VERSION,
    eventId,
    eventType: "architecture_candidate_changeset_planned",
    payloadVersion: ARCHITECTURE_CANDIDATE_CHANGESET_PLAN_SCHEMA_VERSION,
    repository: input.input.delta.repository,
    worktree: input.input.delta.worktree,
    baseDigest: input.input.base.modelDigest,
    resultingDigest: digestJson({
      baseDigest: input.input.base.modelDigest,
      changeSetDigest: digestJson(input.changeSet as unknown as Json),
      payloadDigest
    }),
    headSha: input.input.base.headSha,
    actor: input.input.actor ?? { kind: "daemon", id: "changeset-engine" },
    source: input.input.source ?? "checkpoint",
    timestamp: input.input.timestamp ?? input.input.policyEvaluation.evaluatedAt,
    idempotencyKey: `idem_${input.changeSet.id}.${shortDigest(input.inputDigest)}`,
    provenance: {
      producer: "@archcontext/core/changeset-engine",
      command: "planArchitectureCandidateChangeSet",
      inputDigest: input.inputDigest
    },
    payload: payload as unknown as Json,
    previousEventHash: input.input.previousEventHash ?? null
  };
  return { ...event, eventHash: architectureEventHash(event) };
}

function assertNoAgentProposalDeltaPromotion(delta: ArchitectureCandidateDeltaV1): void {
  const paths = [
    ...agentProposalProvenancePaths(delta.extensions, "$.extensions"),
    ...delta.candidateChanges.flatMap((candidate, index) =>
      agentProposalProvenancePaths(candidate.extensions, `$.candidateChanges[${index}].extensions`))
  ];
  if (paths.length > 0) {
    throw new Error(`architecture-candidate-delta-agent-proposal-requires-deterministic-validation: ${paths.join(",")}`);
  }
}

function agentProposalProvenancePaths(value: unknown, path: string): string[] {
  const paths: string[] = [];
  collectAgentProposalProvenancePaths(value, path, paths);
  return paths;
}

function collectAgentProposalProvenancePaths(value: unknown, path: string, paths: string[]): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (AGENT_PROPOSAL_EXTENSION_VALUES.has(value)) paths.push(path);
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectAgentProposalProvenancePaths(item, `${path}[${index}]`, paths));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = normalizeExtensionKey(key);
    if (AGENT_PROPOSAL_EXTENSION_KEYS.has(normalizedKey)) {
      paths.push(`${path}.${key}`);
      continue;
    }
    collectAgentProposalProvenancePaths(child, `${path}.${key}`, paths);
  }
}

function normalizeExtensionKey(key: string): string {
  return key.replace(/[-_]/g, "").toLowerCase();
}

function sameJson(left: Json, right: Json): boolean {
  return digestJson(left) === digestJson(right);
}

function shortDigest(digest: string): string {
  return digest.replace(/^sha256:/, "").slice(0, 16);
}

function assertSafeTarget(root: string, path: string): void {
  assertAllowedArchContextPath(root, path);
  const absolute = resolve(root, path);
  if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) {
    throw new Error(`Refusing to write symlink target: ${path}`);
  }
}

function assertExpectedHash(path: string, expectedHash: string): void {
  const actual = digestJson({ body: readFileSync(path, "utf8") });
  if (expectedHash !== actual) throw new Error(`Expected hash mismatch: ${path}`);
}

function atomicWriteFile(path: string, tempPath: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tempPath, body, "utf8");
  fsyncFile(tempPath);
  renameSync(tempPath, path);
  fsyncDirectory(dirname(path));
}

function fsyncFile(path: string): void {
  const fd = openSync(path, process.platform === "win32" ? "r+" : "r");
  try {
    try {
      fsyncSync(fd);
    } catch (error) {
      if (!isIgnorableWindowsFsyncError(error)) throw error;
    }
  } finally {
    closeSync(fd);
  }
}

function fsyncDirectory(path: string): void {
  try {
    const fd = openSync(path, "r");
    try {
      try {
        fsyncSync(fd);
      } catch (error) {
        if (!isIgnorableDirectoryFsyncError(error)) throw error;
      }
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    if (!isIgnorableDirectoryFsyncError(error)) throw error;
  }
}

function isIgnorableWindowsFsyncError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return process.platform === "win32" && (code === "EPERM" || code === "EINVAL");
}

const AGENT_PROPOSAL_EXTENSION_KEYS = new Set([
  "agentjobid",
  "agentrunnerid",
  "investigationreportid",
  "investigationproposalid",
  "proposalid",
  "requirednextstep",
  "directmutationallowed",
  "forbiddenactions"
]);

const AGENT_PROPOSAL_EXTENSION_VALUES = new Set([
  "llm-investigation-report",
  "subagent-investigation-report",
  "investigation-report-proposal",
  "advisory-only"
]);

function isIgnorableDirectoryFsyncError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "EINVAL" || code === "EISDIR" || (process.platform === "win32" && code === "EPERM");
}

function rollback(backups: { path: string; backupPath: string; tempPath?: string; existed: boolean }[]): void {
  for (const backup of backups.reverse()) {
    if (backup.tempPath) rmSync(backup.tempPath, { recursive: true, force: true });
    rmSync(backup.path, { recursive: true, force: true });
    if (backup.existed && existsSync(backup.backupPath)) renameSync(backup.backupPath, backup.path);
    fsyncDirectory(dirname(backup.path));
  }
}

function cleanupBackups(backups: { backupPath: string; tempPath?: string }[]): void {
  for (const backup of backups) {
    if (backup.tempPath) rmSync(backup.tempPath, { recursive: true, force: true });
    rmSync(backup.backupPath, { recursive: true, force: true });
  }
}
