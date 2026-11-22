import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { FailureError, digestJson, type Json } from "@archcontext/contracts";
import { evaluateChangeSetPaths } from "@archcontext/core/policy-engine";
import {
  assertExpectedHash,
  assertPathHasNoSymlinkSegments,
  assertSafeTarget,
  atomicWriteFile,
  cleanupBackups,
  fsyncDirectory,
  preimageFailure,
  rollback
} from "./atomic-fs";
import {
  EMPTY_PATH_SET,
  PLAN_OPERATIONS_SCHEMA,
  assertModelValidationPassed,
  assertProjectionDeleteAllowed,
  assertProjectionGuardAllowed,
  assertProjectionGuardHolds,
  assertProjectionWriteCompatibility,
  assertRefactorDecisionDraft,
  buildAdrReferenceBody,
  buildManifestUpdateBody,
  changeSetBaseModelBlockingErrors,
  entityPreimageFindings,
  isProjectionManifestDestination,
  isRefactorDecisionOnly,
  operationTargetPaths,
  pathScope,
  planManifestFieldsOperation,
  projectionGuards,
  projectionPreimageFindings,
  refactorDecisionBody,
  validateRootContractFileWrite
} from "./guards";
import type {
  AgentContextScopePort,
  ApplyOptions,
  ChangeOperation,
  ChangeOperationKind,
  ChangeSetBase,
  ChangeSetDraft,
  ChangeSetEngineDeps,
  ChangeSetJournalFile,
  ChangeSetJournalPort,
  ChangeSetProjectionDelete,
  ChangeSetProjectionFile,
  ChangeSetProjectionGuard,
  ChangeSetReason,
  ChangeSetStatus,
  ProjectionRebuilderPort
} from "./types";

export { MANIFEST_UPDATE_PATH, MANIFEST_UPDATE_OPERATION_SCHEMA, type ManifestUpdateFields } from "./manifest-update";
export { ADR_REFERENCE_OPERATION_SCHEMA, assertAdrReferenceOperation, type AdrReferenceReplacement } from "./adr-reference-update";
export {
  PLAN_OPERATIONS_SCHEMA,
  assertPathHasNoSymlinkSegments,
  changeSetBaseModelBlockingErrors,
  isRefactorDecisionOnly,
  planManifestFieldsOperation,
  projectionPreimageFindings
};
export type {
  AgentContextScopePort,
  ApplyOptions,
  ChangeOperation,
  ChangeOperationKind,
  ChangeSetBase,
  ChangeSetDraft,
  ChangeSetEngineDeps,
  ChangeSetJournalFile,
  ChangeSetJournalPort,
  ChangeSetProjectionDelete,
  ChangeSetProjectionFile,
  ChangeSetProjectionGuard,
  ChangeSetReason,
  ChangeSetStatus,
  ProjectionRebuilderPort
};

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
      try { buildManifestUpdateBody(root, draft); }
      catch (error) { findings.push(error instanceof Error ? error.message : String(error)); }
    }
    try { assertRefactorDecisionDraft(draft); }
    catch (error) { findings.push(error instanceof Error ? error.message : String(error)); }
    try { projectionGuards(draft); }
    catch (error) { findings.push(error instanceof Error ? error.message : String(error)); }
    for (const operation of draft.operations) {
      try {
        if (operation.op === "update_adr_references") buildAdrReferenceBody(root, operation);
        if (operation.op === "write_refactor_decision") refactorDecisionBody(root, operation);
        for (const file of operation.projectionFiles ?? []) {
          if ("delete" in file) assertProjectionDeleteAllowed(operation.op, file);
          else if ("guard" in file) assertProjectionGuardAllowed(operation.op, file);
          else if (operation.op === "render_agent_context") validateRootContractFileWrite(root, file, this.deps?.agentContextScope);
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
      ? buildManifestUpdateBody(root, draft) : undefined;
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
          : operation.op === "update_adr_references" ? buildAdrReferenceBody(root, operation)
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

  private async validateModel(root: string, draft: ChangeSetDraft, deps: ChangeSetEngineDeps, phase: "before" | "after"): Promise<void> {
    const result = await deps.modelStore.validateModel({ root, repositoryId: draft.reason.taskSessionId, headSha: draft.base.headSha });
    assertModelValidationPassed(result, draft, phase);
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
    if (operation === "render_agent_context") validateRootContractFileWrite(root, { path, expectedHash, body }, this.deps?.agentContextScope);
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
        validateRootContractFileWrite(root, { path, expectedHash, body }, this.deps?.agentContextScope);
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
