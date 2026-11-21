import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH,
  architectureDocsProjectionCompatibilityIssues,
  isSupersededArchitectureDocsProjectionManifestSchemaVersion,
  FailureError,
  baseModelBlockingErrors,
  digestJson,
  parseRefactorDecisionFile,
  serializeRefactorDecision,
  type Json,
  type ModelValidationResult,
  type ModelStorePort,
  type validateJsonSchema
} from "@archcontext/contracts";
import { assertAllowedArchContextPath, evaluateChangeSetPaths, type ArchContextPathScope } from "@archcontext/core/policy-engine";
import { MANIFEST_UPDATE_OPERATION_SCHEMA, MANIFEST_UPDATE_PATH, assertManifestUpdateOperation, renderManifestFieldsUpdate, type ManifestUpdateFields } from "./manifest-update";
export { MANIFEST_UPDATE_PATH, MANIFEST_UPDATE_OPERATION_SCHEMA, type ManifestUpdateFields } from "./manifest-update";

import { ADR_REFERENCE_OPERATION_SCHEMA, assertAdrReferenceOperation, renderAdrReferenceUpdate, type AdrReferenceReplacement } from "./adr-reference-update";
export { ADR_REFERENCE_OPERATION_SCHEMA, assertAdrReferenceOperation, type AdrReferenceReplacement } from "./adr-reference-update";

type JsonSchema = Parameters<typeof validateJsonSchema>[0];
const nonEmptyTextSchema: JsonSchema = { type: "string", minLength: 1 };
const planEntityOperationSchema: JsonSchema = {
  type: "object",
  required: ["op", "expectedHash"],
  additionalProperties: false,
  properties: {
    op: { enum: ["create_entity", "update_entity_fields", "delete_entity", "write_policy", "write_waiver", "render_projection", "render_agent_context"] },
    path: nonEmptyTextSchema,
    entityId: nonEmptyTextSchema,
    expectedHash: nonEmptyTextSchema,
    body: { type: "string" },
    projectionFiles: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "expectedHash", "body"],
        additionalProperties: false,
        properties: { path: nonEmptyTextSchema, expectedHash: nonEmptyTextSchema, body: { type: "string" } }
      }
    }
  }
};

/** Schema for `archctx plan --operations-file` operations array. */
export const PLAN_OPERATIONS_SCHEMA: JsonSchema = {
  type: "array",
  items: { oneOf: [planEntityOperationSchema, MANIFEST_UPDATE_OPERATION_SCHEMA, ADR_REFERENCE_OPERATION_SCHEMA] }
};

export type ChangeSetStatus = "proposed" | "approved" | "applied" | "rolled-back" | "rejected";
export type ChangeOperationKind =
  | "create_entity"
  | "update_entity_fields"
  | "delete_entity"
  | "update_manifest_fields"
  | "update_adr_references"
  | "write_policy"
  | "write_waiver"
  | "render_projection"
  | "render_agent_context"
  | "write_refactor_decision";

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
  fields?: ManifestUpdateFields;
  references?: AdrReferenceReplacement[];
  projectionFiles?: Array<ChangeSetProjectionFile | ChangeSetProjectionDelete | ChangeSetProjectionGuard>;
}

export interface ChangeSetProjectionFile {
  path: string;
  expectedHash: string;
  body: string;
}

/**
 * Removes one projection-owned file inside the same explicit write set. Only `render_projection`
 * accepts it, and only for a file that exists with exactly `expectedHash`; the journal records it
 * as a delete, like a generated-projection delete.
 */
export interface ChangeSetProjectionDelete {
  path: string;
  expectedHash: string;
  delete: true;
}

/**
 * Binds one projection-owned file the write set depends on but does not write: a document a
 * partial apply carries forward unchanged. Only `render_projection` accepts it, only with the exact
 * hash of the bytes the render read, and only for a path no write of the same draft touches. The
 * apply writes and journals nothing for it; it verifies the file still exists with `expectedHash`
 * immediately before the commit, and any other state fails the whole apply.
 */
export interface ChangeSetProjectionGuard {
  path: string;
  expectedHash: string;
  guard: true;
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

/** Shared by the daemon preflight and the engine. Post-apply validation has no exemptions. */
export function changeSetBaseModelBlockingErrors(result: ModelValidationResult, draft: ChangeSetDraft): string[] {
  const repairedPaths = new Set(draft.operations
    .filter(operation => operation.op === "update_entity_fields" || operation.op === "delete_entity")
    .map(operation => operation.path));
  const repairedErrors = new Set((result.nodeSchemaErrors ?? [])
    .filter(issue => repairedPaths.has(issue.path))
    .map(issue => issue.error));
  if (draft.operations.length === 1) {
    const operation = draft.operations[0]!;
    try {
      assertManifestUpdateOperation(operation);
      if (operation.fields["model.layers"] !== undefined) for (const error of result.layerOrderErrors ?? []) repairedErrors.add(error);
    } catch { /* An invalid or unrelated operation cannot relax base validation. */ }
  }
  return baseModelBlockingErrors(result).filter(error => !repairedErrors.has(error));
}

export interface ApplyOptions {
  approved?: boolean;
  faultAfterOperations?: number;
  afterModelValidatedBeforeCommit?: (input: {
    root: string;
    draft: ChangeSetDraft;
    journalId?: string;
  }) => Promise<{ journalCommitted?: boolean } | void> | { journalCommitted?: boolean } | void;
}

export interface ProjectionRebuilderPort {
  planGeneratedProjection(root: string): {
    path: string;
    expectedHash: string;
    body: string;
    operation: "render_projection" | "delete_entity";
  }[];
}

export interface ChangeSetJournalFile {
  path: string;
  tempPath?: string;
  backupPath?: string;
  existed: boolean;
  operation: ChangeOperationKind;
  /**
   * `digestJson({ body })` of the bytes this operation wrote, or `"missing"` for a delete. The
   * journal is the only durable record of what a committed ChangeSet actually wrote: the draft
   * metadata keeps `expectedHash` (the preimage) and drops projection bodies entirely, so without
   * this a later reader cannot name the committed content.
   */
  bodyHash: string;
}

export interface ChangeSetJournalPort {
  beginChangeSet(root: string, draft: ChangeSetDraft): Promise<string>;
  recordChangeSetFile(journalId: string, file: ChangeSetJournalFile): Promise<void>;
  commitChangeSet(journalId: string): Promise<void>;
  completeChangeSetCleanup(journalId: string): Promise<void>;
  abortChangeSet(journalId: string, reason: string): Promise<void>;
  recoverPendingChangeSets(): number;
}

/**
 * Derives the exact repo paths a `render_agent_context` operation may write, from the model on
 * disk at the moment of the preview or apply. Re-deriving per call (rather than trusting a path set
 * carried in the ChangeSet) means a model change between plan and apply narrows the write surface
 * instead of leaving a stale widening in place.
 */
export interface AgentContextScopePort {
  derive(root: string): ReadonlySet<string>;
  /** Mandatory for existing root contracts; verifies canonical marker-only rendering. */
  validateRootWrite?(root: string, file: ChangeSetProjectionFile): void;
}

export interface ChangeSetEngineDeps {
  modelStore: ModelStorePort;
  projection: ProjectionRebuilderPort;
  journal?: ChangeSetJournalPort;
  agentContextScope?: AgentContextScopePort;
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
      postconditions: input.operations.some(operation => operation.op === "update_manifest_fields")
        ? ["schema-valid-after", "manifest-fields-updated"]
        : isRefactorDecisionOnly(input.operations)
          ? ["schema-valid-after", "refactor-decision-written"]
          : ["schema-valid-after", "projection-rebuilt"],
      requiresConfirmation: input.requiresConfirmation ?? true,
      idempotencyKey: `idem_${input.id}`
    };
    this.states.set(draft.id, draft);
    return draft;
  }

  /**
   * Path check is per operation, not per ChangeSet: the agent-context widening belongs to the
   * `render_agent_context` operation kind alone, so a `render_projection` operation carrying an
   * agent-context path is still denied even when the same draft legitimately widens elsewhere.
   */
  preview(root: string, draft: ChangeSetDraft): { digest: string; paths: string[]; allowed: boolean; findings: string[] } {
    const agentContextPaths = this.agentContextPathsFor(root, draft);
    const paths: string[] = [];
    const findings: string[] = [];
    if (draft.operations.some(operation => operation.op === "update_manifest_fields")) {
      try { this.manifestUpdateBody(root, draft); }
      catch (error) { findings.push(error instanceof Error ? error.message : String(error)); }
    }
    try { assertRefactorDecisionDraft(draft); }
    catch (error) { findings.push(error instanceof Error ? error.message : String(error)); }
    try { projectionGuards(draft); }
    catch (error) { findings.push(error instanceof Error ? error.message : String(error)); }
    for (const operation of draft.operations) {
      try {
        if (operation.op === "update_adr_references") this.adrReferenceBody(root, operation);
        if (operation.op === "write_refactor_decision") refactorDecisionBody(root, operation);
        for (const file of operation.projectionFiles ?? []) {
          if ("delete" in file) assertProjectionDeleteAllowed(operation.op, file);
          else if ("guard" in file) assertProjectionGuardAllowed(operation.op, file);
          else if (operation.op === "render_agent_context") this.validateRootContractWrite(root, file);
        }
      } catch (error) { findings.push(error instanceof Error ? error.message : String(error)); }
      const operationPaths = operationTargetPaths(operation);
      paths.push(...operationPaths);
      findings.push(
        ...evaluateChangeSetPaths(root, operationPaths, pathScope(operation.op, agentContextPaths)).map((finding) => finding.message),
        ...entityPreimageFindings(root, operation)
      );
    }
    return { digest: digestJson(draft as unknown as Json), paths, allowed: findings.length === 0, findings };
  }

  /**
   * Derived once per preview/apply, and only when the draft actually carries a
   * `render_agent_context` operation: a repository whose model cannot produce an agent-context
   * scope must not have every unrelated ChangeSet fail with its derivation error.
   */
  private agentContextPathsFor(root: string, draft: ChangeSetDraft): ReadonlySet<string> {
    if (!draft.operations.some((operation) => operation.op === "render_agent_context")) return EMPTY_PATH_SET;
    return this.deps?.agentContextScope?.derive(root) ?? EMPTY_PATH_SET;
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
    assertRefactorDecisionDraft(draft);
    const guards = projectionGuards(draft);
    await this.validateModel(root, draft, deps, "before");
    const agentContextPaths = this.agentContextPathsFor(root, draft);
    const manifestBody = draft.operations.some(operation => operation.op === "update_manifest_fields")
      ? this.manifestUpdateBody(root, draft) : undefined;
    // The same predicate controls the implicit rebuild below; check before any business write.
    const explicitProjectionOnly = draft.operations.length > 0 && draft.operations.every(operation =>
      (operation.op === "render_projection" || operation.op === "render_agent_context") &&
      operation.projectionFiles !== undefined && operation.projectionFiles.length > 0
    );
    const projects = draft.operations.some(operation => operation.op === "render_projection" || operation.op === "render_agent_context")
      || (!explicitProjectionOnly && manifestBody === undefined && !isRefactorDecisionOnly(draft.operations));
    const proposedManifests = draft.operations.flatMap(operation => operation.projectionFiles ?? [])
      .filter(file => isProjectionManifestDestination(root, file.path) && !("guard" in file)) as Array<ChangeSetProjectionFile | ChangeSetProjectionDelete>;
    for (const operation of draft.operations) {
      if (operation.path && operation.op !== "render_projection" && operation.op !== "render_agent_context" && isProjectionManifestDestination(root, operation.path)) {
        proposedManifests.push(operation.op === "delete_entity"
          ? { path: operation.path, expectedHash: operation.expectedHash, delete: true }
          : { path: operation.path, expectedHash: operation.expectedHash, body: operation.body ?? "" });
      }
    }
    if (proposedManifests.length > 1) throw new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-incompatible");
    const checkProjectionCompatibility = projects ? () => {
      assertProjectionWriteCompatibility(root);
      for (const proposed of proposedManifests) assertProjectionWriteCompatibility(root, proposed);
    } : undefined;
    checkProjectionCompatibility?.();
    const backups: { path: string; backupPath: string; tempPath?: string; existed: boolean; manifestBodyHash?: string }[] = [];
    const journalId = await deps.journal?.beginChangeSet(root, draft);
    let journalCommitted = false;
    let applied = 0;
    const deferredManifests: Array<{ path: string; expectedHash: string; body: string; operation: ChangeOperationKind }> = [];
    const writeOrDeferManifest = async (path: string, expectedHash: string, body: string, operation: ChangeOperationKind): Promise<boolean> => {
      if (isProjectionManifestDestination(root, path)) {
        if (operation === "delete_entity" || deferredManifests.length > 0) throw new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-incompatible");
        deferredManifests.push({ path, expectedHash, body, operation });
        return false;
      }
      await this.applyFileOperation(root, path, expectedHash, body, operation, backups, journalId, applied + 1, agentContextPaths, checkProjectionCompatibility);
      return true;
    };
    try {
      for (const operation of draft.operations) {
        if (operation.op === "render_projection" || operation.op === "render_agent_context") {
          if (operation.projectionFiles && operation.projectionFiles.length > 0) {
            for (const file of operation.projectionFiles) {
              // A guard writes nothing; it is verified once, immediately before the commit.
              if ("guard" in file) continue;
              if ("delete" in file) assertProjectionDeleteAllowed(operation.op, file);
              if (await writeOrDeferManifest(file.path, file.expectedHash, "delete" in file ? "" : file.body, "delete" in file ? "delete_entity" : operation.op)) applied += 1;
              if (options.faultAfterOperations && applied >= options.faultAfterOperations) throw new Error("fault-injection");
            }
          } else {
            // The daemon-owned generated projection is planned and journaled once below.
          }
          if (options.faultAfterOperations && applied >= options.faultAfterOperations) throw new Error("fault-injection");
          continue;
        }
        if (!operation.path) throw new Error(`Change operation requires path: ${operation.op}`);
        const body = operation.op === "update_manifest_fields" ? manifestBody!
          : operation.op === "update_adr_references" ? this.adrReferenceBody(root, operation)
          : operation.op === "write_refactor_decision" ? refactorDecisionBody(root, operation)
          : operation.body ?? "";
        if (await writeOrDeferManifest(operation.path, operation.expectedHash, body, operation.op)) applied += 1;
        if (options.faultAfterOperations && applied >= options.faultAfterOperations) throw new Error("fault-injection");
      }
      // Explicit projection-only drafts own their complete write set. Rebuilding
      // unrelated generated outputs here would escape preview/receipt ownership
      // and invalidate the caller's unchanged-input snapshot after commit.
      // A decision-only draft writes Git-visible decision files, which are not model input: no
      // generated projection can change, so none is planned (ADR-0046).
      if (!explicitProjectionOnly && manifestBody === undefined && !isRefactorDecisionOnly(draft.operations)) {
        for (const projection of deps.projection.planGeneratedProjection(root)) {
          if (await writeOrDeferManifest(
            projection.path,
            projection.expectedHash,
            projection.body,
            projection.operation
          )) applied += 1;
          if (options.faultAfterOperations && applied >= options.faultAfterOperations) throw new Error("fault-injection");
        }
      }
      // Keep the live manifest outside rollback backups while any later file/journal guard can
      // refuse a newly raised floor. Supplied operations and implicit rebuilds share this queue.
      for (const manifest of deferredManifests) {
        checkProjectionCompatibility?.();
        await this.applyFileOperation(root, manifest.path, manifest.expectedHash, manifest.body, manifest.operation, backups, journalId, applied + 1, agentContextPaths, checkProjectionCompatibility);
        applied += 1;
        if (options.faultAfterOperations && applied >= options.faultAfterOperations) throw new Error("fault-injection");
      }
      await this.validateModel(root, draft, deps, "after");
      for (const guard of guards) assertProjectionGuardHolds(root, guard);
      const commit = await options.afterModelValidatedBeforeCommit?.({ root, draft, journalId });
      if (commit?.journalCommitted) journalCommitted = true;
      if (journalId && !journalCommitted) {
        await deps.journal?.commitChangeSet(journalId);
        journalCommitted = true;
      }
      try {
        cleanupBackups(backups);
        if (journalId) await deps.journal?.completeChangeSetCleanup(journalId);
      } catch {
        // A committed journal lets startup recovery remove stale temp/backup files without rolling back applied content.
      }
      const appliedDraft = { ...draft, status: "applied" as const };
      this.states.set(draft.id, appliedDraft);
      return appliedDraft;
    } catch (error) {
      if (!journalCommitted) {
        if (!rollback(backups)) {
          // Keep the pending journal and original backup for an operator; do not claim a rollback.
          throw new FailureError("AC_PRECONDITION_FAILED", "changeset-rollback-conflict", { ...(journalId ? { journalId } : {}), changeSetId: draft.id, manualRecoveryRequired: true });
        }
        if (journalId) await deps.journal?.abortChangeSet(journalId, error instanceof Error ? error.message : String(error));
      }
      const rolledBack = { ...draft, status: "rolled-back" as const };
      this.states.set(draft.id, rolledBack);
      throw error;
    }
  }

  private adrReferenceBody(root: string, operation: ChangeOperation): string {
    assertAdrReferenceOperation(operation);
    const absolute = assertPathHasNoSymlinkSegments(root, operation.path);
    assertExpectedHash(absolute, operation.expectedHash);
    return renderAdrReferenceUpdate(readFileSync(absolute, "utf8"), operation.references);
  }

  private validateRootContractWrite(root: string, file: ChangeSetProjectionFile): void {
    if (file.path !== "AGENTS.md" && file.path !== "CLAUDE.md") return;
    const validate = this.deps?.agentContextScope?.validateRootWrite;
    if (!validate) throw new Error("Root contract write requires canonical marker-only validation");
    const absolute = assertPathHasNoSymlinkSegments(root, file.path);
    if (!/^sha256:[a-f0-9]{64}$/.test(file.expectedHash)) throw new Error("Root contract must exist with an exact expectedHash");
    assertExpectedHash(absolute, file.expectedHash);
    validate(root, file);
  }

  private manifestUpdateBody(root: string, draft: ChangeSetDraft): string {
    if (draft.operations.length !== 1) throw new Error("Manifest update must be the only ChangeSet operation");
    const operation = draft.operations[0]!;
    assertManifestUpdateOperation(operation);
    const absolute = assertPathHasNoSymlinkSegments(root, MANIFEST_UPDATE_PATH);
    assertExpectedHash(absolute, operation.expectedHash);
    if (operation.fields["content.decisions"] !== undefined) {
      const directory = assertPathHasNoSymlinkSegments(root, "docs/adr");
      if (!lstatSync(directory).isDirectory()) throw new Error("Manifest decisions target docs/adr must be an existing directory");
    }
    return renderManifestFieldsUpdate(readFileSync(absolute, "utf8"), operation.fields);
  }

  private async validateModel(root: string, draft: ChangeSetDraft, deps: ChangeSetEngineDeps, phase: "before" | "after"): Promise<void> {
    const result = await deps.modelStore.validateModel({ root, repositoryId: draft.reason.taskSessionId, headSha: draft.base.headSha });
    // The base may have dangling references or schema errors on nodes this draft repairs.
    // The after-apply model must be fully valid.
    const errors = phase === "before" ? changeSetBaseModelBlockingErrors(result, draft) : result.errors;
    const blocked = phase === "before" ? errors.length > 0 : !result.valid;
    if (blocked) {
      const path = errors[0]?.match(/^(\.archcontext\/.+?): /)?.[1];
      const error = new FailureError("AC_SCHEMA_INVALID", "native-context-model-invalid", {
        invariant: `model-validation-${phase}-apply`,
        ...(path ? { path } : {})
      });
      // Keep the local diagnostic. Public adapters publish only the classified failure.
      error.message = `ChangeSet model validation failed ${phase} apply: ${errors.join("; ") || "unknown validation error"}`;
      throw error;
    }
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
    backups: { path: string; backupPath: string; tempPath?: string; existed: boolean; manifestBodyHash?: string }[],
    journalId: string | undefined,
    sequence: number,
    agentContextPaths: ReadonlySet<string> = EMPTY_PATH_SET,
    checkProjectionCompatibility?: () => void
  ): Promise<void> {
    assertSafeTarget(root, path, pathScope(operation, agentContextPaths));
    const deps = this.requireDeps();
    if (operation === "render_agent_context") this.validateRootContractWrite(root, { path, expectedHash, body });
    const absolute = resolve(root, path);
    const existed = existsSync(absolute);
    const backupPath = `${absolute}.archctx-backup`;
    const tempPath = operation === "delete_entity" ? undefined : `${absolute}.archctx-tmp-${process.pid}-${sequence}`;
    if (existsSync(backupPath)) throw new Error(`Backup path already exists: ${path}`);
    if (existed) assertExpectedHash(absolute, expectedHash);
    else if (expectedHash !== "missing") throw preimageFailure(`Expected missing file hash for new path: ${path}`);
    const backup = { path: absolute, backupPath, tempPath, existed, ...(isProjectionManifestDestination(root, path) ? { manifestBodyHash: operation === "delete_entity" ? "missing" : digestJson({ body }) } : {}) };
    if (journalId) {
      await deps.journal?.recordChangeSetFile(journalId, {
        path,
        tempPath,
        backupPath,
        existed,
        operation,
        bodyHash: operation === "delete_entity" ? "missing" : digestJson({ body })
      });
    }
    // Recheck after the asynchronous journal append, immediately before touching files.
    if (operation === "write_refactor_decision") {
      assertPathHasNoSymlinkSegments(root, path);
      if (existsSync(absolute)) assertExpectedHash(absolute, expectedHash);
      else if (expectedHash !== "missing") throw preimageFailure(`Expected missing file hash for new path: ${path}`);
    }
    if (operation === "update_adr_references" || (operation === "render_agent_context" && (path === "AGENTS.md" || path === "CLAUDE.md"))) {
      assertPathHasNoSymlinkSegments(root, path);
      assertExpectedHash(absolute, expectedHash);
      if (operation === "render_agent_context") {
        const currentPaths = deps.agentContextScope?.derive(root) ?? EMPTY_PATH_SET;
        assertSafeTarget(root, path, pathScope(operation, currentPaths));
        this.validateRootContractWrite(root, { path, expectedHash, body });
      }
    }
    // No await remains between the live compatibility check and this file mutation.
    checkProjectionCompatibility?.();
    if (checkProjectionCompatibility && isProjectionManifestDestination(root, path)) {
      assertProjectionWriteCompatibility(root, operation === "delete_entity" ? { path, expectedHash, delete: true } : { path, body, expectedHash });
    }
    backups.push(backup);
    if (existed) {
      renameSync(absolute, backupPath);
      fsyncDirectory(dirname(absolute));
    }
    if (operation === "delete_entity") {
      rmSync(absolute, { force: true });
    } else {
      atomicWriteFile(absolute, tempPath!, body);
    }
  }
}

/** Reserve the manifest destination through dot/slash aliases and case-insensitive filesystems. */
function isProjectionManifestDestination(root: string, path: string): boolean {
  return resolve(root, path).toLowerCase() === resolve(root, ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH).toLowerCase();
}

/** Live repository floors also govern supplied output and implicit generated rebuilds. */
function assertProjectionWriteCompatibility(root: string, proposed?: ChangeSetProjectionFile | ChangeSetProjectionDelete): void {
  const path = resolve(root, ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH);
  let current: unknown;
  if (existsSync(path)) {
    const body = readFileSync(path, "utf8");
    try { current = JSON.parse(body); } catch { /* Existing malformed-manifest handling remains. */ }
  }
  if (architectureDocsProjectionCompatibilityIssues(current).length) throw new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-incompatible");
  if (!proposed) return;
  if ("delete" in proposed) throw new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-incompatible");
  let candidate: unknown;
  try { candidate = JSON.parse(proposed.body); } catch { throw new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-incompatible"); }
  if (architectureDocsProjectionCompatibilityIssues(candidate).length) throw new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-incompatible");
  // A superseded manifest is not a baseline: its floors only decide whether this engine may replace it (#579).
  const currentSchema = current && typeof current === "object" ? (current as Record<string, unknown>).schemaVersion : undefined;
  if (typeof currentSchema === "string" && isSupersededArchitectureDocsProjectionManifestSchemaVersion(currentSchema)) return;
  for (const key of ["minimumRendererVersion", "minimumProtocolVersion"] as const) {
    const floor = current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined;
    if (floor !== undefined && (!candidate || typeof candidate !== "object" || (candidate as Record<string, unknown>)[key] !== floor)) throw new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-incompatible");
  }
}

const EMPTY_PATH_SET: ReadonlySet<string> = new Set<string>();

export function planManifestFieldsOperation(root: string, fields: ManifestUpdateFields): ChangeOperation {
  const absolute = assertPathHasNoSymlinkSegments(root, MANIFEST_UPDATE_PATH);
  const body = readFileSync(absolute, "utf8");
  const operation: ChangeOperation = { op: "update_manifest_fields", path: MANIFEST_UPDATE_PATH, expectedHash: digestJson({ body }), fields };
  assertManifestUpdateOperation(operation);
  renderManifestFieldsUpdate(body, fields);
  return operation;
}

const ENTITY_FILE_OPERATIONS: ReadonlySet<ChangeOperationKind> = new Set(["create_entity", "update_entity_fields", "delete_entity"]);

/**
 * Preview-time view of the per-entity preimage: the expected hash must match the current file
 * (`missing` for an absent one), and the preview reports update or delete of an absent target as
 * a finding. A mismatch names the current hash so the caller can re-read and re-plan. Apply does
 * not trust the preview and does not repeat the target-exists check: `applyFileOperation` only
 * rechecks the expected hash immediately before it writes.
 */
function entityPreimageFindings(root: string, operation: ChangeOperation): string[] {
  if (!ENTITY_FILE_OPERATIONS.has(operation.op) || !operation.path) return [];
  let absolute: string;
  try {
    absolute = assertPathHasNoSymlinkSegments(root, operation.path);
  } catch {
    // Path containment and symlink findings are the path policy's to report, not a preimage finding.
    return [];
  }
  const current = existsSync(absolute) && lstatSync(absolute).isFile() ? digestJson({ body: readFileSync(absolute, "utf8") }) : "missing";
  if (current === "missing" && operation.op !== "create_entity") return [`${operation.op} target does not exist: ${operation.path}`];
  return current === operation.expectedHash ? [] : [`Expected hash mismatch: ${operation.path} (current ${current})`];
}

/**
 * Every projection file write's preimage, checked as one pass before any file is touched. Apply
 * rechecks each file again immediately before it writes; this pass lets a caller refuse a stale
 * projection with nothing written instead of rolling back the files written before the stale one.
 * A path an earlier operation of the same draft writes is left to that per-file recheck. Paths that
 * fail containment or symlink checks are the path policy's to report, not a preimage finding.
 */
export function projectionPreimageFindings(root: string, draft: ChangeSetDraft): string[] {
  const findings: string[] = [];
  const written = new Set<string>();
  for (const operation of draft.operations) {
    if (operation.path) written.add(operation.path);
    for (const file of operation.projectionFiles ?? []) {
      if (written.has(file.path)) continue;
      written.add(file.path);
      let absolute: string;
      try {
        absolute = assertPathHasNoSymlinkSegments(root, file.path);
      } catch {
        continue;
      }
      const current = existsSync(absolute) && lstatSync(absolute).isFile() ? digestJson({ body: readFileSync(absolute, "utf8") }) : "missing";
      if (current !== file.expectedHash) findings.push(`Expected hash mismatch: ${file.path} (current ${current})`);
    }
  }
  return findings;
}

/**
 * The draft's projection guards, each allowed by its operation and on a path no write or delete of
 * the same draft touches: a guarded file is one the apply depends on and leaves alone.
 */
function projectionGuards(draft: ChangeSetDraft): ChangeSetProjectionGuard[] {
  const guards: ChangeSetProjectionGuard[] = [];
  const touched = new Set<string>();
  for (const operation of draft.operations) {
    if (operation.path) touched.add(operation.path);
    for (const file of operation.projectionFiles ?? []) {
      if (!("guard" in file)) {
        touched.add(file.path);
        continue;
      }
      assertProjectionGuardAllowed(operation.op, file);
      guards.push(file);
    }
  }
  const overlapping = guards.find((guard) => touched.has(guard.path));
  if (overlapping) throw new Error(`Projection file guard must not be written by the same ChangeSet: ${overlapping.path}`);
  return guards;
}

function assertProjectionGuardAllowed(op: ChangeOperationKind, file: ChangeSetProjectionGuard): void {
  if (op !== "render_projection") throw new Error(`Projection file guard is only allowed in render_projection: ${file.path}`);
  if (file.guard !== true || "body" in file || "delete" in file) throw new Error(`Projection file guard must carry guard: true and no body: ${file.path}`);
  if (!/^sha256:[a-f0-9]{64}$/.test(file.expectedHash)) throw new Error(`Projection file guard requires the exact current hash: ${file.path}`);
}

/** The guarded file still exists with exactly the raw bytes the render read; nothing is written. */
function assertProjectionGuardHolds(root: string, guard: ChangeSetProjectionGuard): void {
  const absolute = assertPathHasNoSymlinkSegments(root, guard.path);
  if (!existsSync(absolute) || !lstatSync(absolute).isFile()) throw preimageFailure(`Expected hash mismatch: ${guard.path} (current missing)`);
  assertExpectedHash(absolute, guard.expectedHash);
}

function assertProjectionDeleteAllowed(op: ChangeOperationKind, file: ChangeSetProjectionDelete): void {
  if (op !== "render_projection") throw new Error(`Projection file delete is only allowed in render_projection: ${file.path}`);
  if (file.delete !== true || "body" in file) throw new Error(`Projection file delete must carry delete: true and no body: ${file.path}`);
  if (!/^sha256:[a-f0-9]{64}$/.test(file.expectedHash)) throw new Error(`Projection file delete requires the exact current hash: ${file.path}`);
}

function operationTargetPaths(operation: ChangeOperation): string[] {
  return [
    ...(operation.path ? [operation.path] : []),
    ...(operation.projectionFiles?.map((file) => file.path) ?? [])
  ];
}

function pathScope(operation: ChangeOperationKind, agentContextPaths: ReadonlySet<string>): ArchContextPathScope {
  return {
    operation: operation === "render_agent_context" ? "agent-context"
      : operation === "update_manifest_fields" ? "manifest"
      : operation === "update_adr_references" ? "adr-reference"
      : operation === "write_refactor_decision" ? "refactor-decision"
      : "default",
    agentContextPaths
  };
}

/** True when every operation of a non-empty draft writes a refactor decision file. */
export function isRefactorDecisionOnly(operations: readonly ChangeOperation[]): boolean {
  return operations.length > 0 && operations.every((operation) => operation.op === "write_refactor_decision");
}

/**
 * A decision write never shares a draft with another operation kind: the daemon builds it as a
 * decision-only ChangeSet, so it can skip projection planning without hiding a model change.
 */
function assertRefactorDecisionDraft(draft: ChangeSetDraft): void {
  if (draft.operations.some((operation) => operation.op === "write_refactor_decision") && !isRefactorDecisionOnly(draft.operations)) {
    throw new Error("write_refactor_decision must not be combined with other ChangeSet operations");
  }
}

/**
 * The bytes of one decision write, checked before anything is touched: a no-follow path that is
 * exactly a decision file, a body that parses as that file's `RefactorDecisionV1` and is already in
 * the one canonical serialization, and the expected preimage hash.
 */
function refactorDecisionBody(root: string, operation: ChangeOperation): string {
  if (!operation.path || operation.body === undefined) throw new Error("write_refactor_decision requires path and body");
  if (operation.fields !== undefined || operation.references !== undefined || operation.projectionFiles !== undefined || operation.entityId !== undefined) {
    throw new Error("write_refactor_decision carries only path, expectedHash and body");
  }
  const absolute = assertPathHasNoSymlinkSegments(root, operation.path);
  const decision = parseRefactorDecisionFile(operation.path, operation.body);
  if (serializeRefactorDecision(decision) !== operation.body) {
    throw new Error(`write_refactor_decision body must be the canonical serialization: ${operation.path}`);
  }
  if (existsSync(absolute)) assertExpectedHash(absolute, operation.expectedHash);
  else if (operation.expectedHash !== "missing") throw preimageFailure(`Expected missing file hash for new path: ${operation.path}`);
  return operation.body;
}

function assertSafeTarget(root: string, path: string, scope?: ArchContextPathScope): void {
  assertAllowedArchContextPath(root, path, scope);
  const absolute = resolve(root, path);
  if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) {
    throw new Error(`Refusing to write symlink target: ${path}`);
  }
}

/**
 * Containment plus no-follow validation for a repository-relative path, returning its absolute form.
 *
 * Exported so readers of the same fail-closed files apply the identical rule: a path that is unsafe
 * to write is also unsafe to parse, because following it hands an attacker-chosen file to a parser
 * that was only ever meant to see repository state.
 */
export function assertPathHasNoSymlinkSegments(root: string, path: string): string {
  const absoluteRoot = resolve(root);
  const absolute = resolve(absoluteRoot, path);
  const contained = relative(absoluteRoot, absolute);
  if (contained === "" || contained === ".." || contained.startsWith(`..${sep}`) || isAbsolute(contained)) {
    throw new Error(`Path escapes repository: ${path}`);
  }
  assertNoSymlinkSegments(absoluteRoot, contained.split(sep), path);
  return absolute;
}

/**
 * `lstat` every existing component, destination included. `existsSync` is deliberately not used to
 * decide whether a component is there: it follows links, so a dangling symlink would read as absent
 * and be silently accepted as a path to create.
 */
function assertNoSymlinkSegments(absoluteRoot: string, segments: string[], displayPath: string): void {
  let current = absoluteRoot;
  for (const segment of segments) {
    current = resolve(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      return;
    }
    if (stat.isSymbolicLink()) throw new Error(`Refusing to write through symlink: ${displayPath}`);
  }
}

/** Keep the existing local preview diagnostic; public adapters publish only `.failure`. */
function preimageFailure(diagnostic: string): FailureError<"AC_PRECONDITION_FAILED"> {
  const error = new FailureError("AC_PRECONDITION_FAILED", "apply-preimage-changed", { issueCount: 1 });
  error.message = diagnostic;
  return error;
}

function assertExpectedHash(path: string, expectedHash: string): void {
  const actual = digestJson({ body: readFileSync(path, "utf8") });
  if (expectedHash !== actual) throw preimageFailure(`Expected hash mismatch: ${path}`);
}

function atomicWriteFile(path: string, tempPath: string, body: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tempPath, body, mode === undefined ? "utf8" : { encoding: "utf8", mode, flag: "wx" });
  // The mode is forced on the temp name, which only this process can reach. Doing it on the
  // destination after the rename would leave a window where a swapped path receives the chmod.
  if (mode !== undefined) chmodSync(tempPath, mode);
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

function isIgnorableDirectoryFsyncError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "EINVAL" || code === "EISDIR" || (process.platform === "win32" && code === "EPERM");
}

function rollback(backups: { path: string; backupPath: string; tempPath?: string; existed: boolean; manifestBodyHash?: string }[]): boolean {
  let complete = true;
  for (const backup of [...backups].reverse()) {
    // An await after the manifest write may let another writer raise its floor. Never erase
    // external bytes or unreadable replacements. A missing target can be restored from its backup.
    if (backup.manifestBodyHash !== undefined) {
      let current = "unreadable";
      try {
        const stat=lstatSync(backup.path);
        if(stat.isFile() && !stat.isSymbolicLink()) {
          const bytes=readFileSync(backup.path),body=bytes.toString("utf8");
          if(Buffer.from(body,"utf8").equals(bytes)) current=digestJson({body});
        }
      } catch(error) { if((error as NodeJS.ErrnoException).code === "ENOENT") current="missing"; }
      if (current !== "missing" && current !== backup.manifestBodyHash) { complete = false; continue; }
    }
    if (backup.tempPath) rmSync(backup.tempPath, { recursive: true, force: true });
    if (backup.existed) {
      if (existsSync(backup.backupPath)) {
        rmSync(backup.path, { recursive: true, force: true });
        renameSync(backup.backupPath, backup.path);
      }
    } else {
      rmSync(backup.path, { recursive: true, force: true });
    }
    fsyncDirectory(dirname(backup.path));
  }
  return complete;
}

function cleanupBackups(backups: { backupPath: string; tempPath?: string }[]): void {
  for (const backup of backups) {
    if (backup.tempPath) rmSync(backup.tempPath, { recursive: true, force: true });
    rmSync(backup.backupPath, { recursive: true, force: true });
  }
}
