import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ChangeSetEngine, type ChangeOperation } from "@archcontext/core/changeset-engine";
import {
  ARCHITECTURE_LEDGER_GIT_CURSOR_ID,
  architectureLedgerGitCursorFromPlan,
  architectureLedgerStateDigest,
  architectureLedgerProjectionDigest,
  compareArchitectureLedgerStateToYaml,
  planExternalProjectionChangeToArchitectureLedgerEvent,
  planGitCursorRefreshToArchitectureLedgerEvent,
  planYamlToArchitectureLedgerImport,
  planYamlToArchitectureLedgerRebuild,
  projectArchitectureLedgerStateToYamlFiles,
  type ArchitectureLedgerAppendInput,
  type ArchitectureLedgerAppendResult,
  type ArchitectureLedgerProjectionFile,
  type ArchitectureLedgerScope,
  type ArchitectureLedgerGraphState,
  type RecommendationLedgerRecordV1
} from "@archcontext/core/architecture-ledger";
import {
  planRecommendationV3Migration
} from "./refactor-recording";
import { reconcileArchitectureLedgerDrift } from "@archcontext/core/reconcile-engine";
import { baseModelBlockingErrors, digestJson, errorEnvelope, okEnvelope, type ArchitectureEventV1, type Json, type JsonEnvelope, type ModelStorePort, type RepositorySnapshot, type WorkspaceRef } from "@archcontext/contracts";
import { findRepositoryRoot } from "@archcontext/local-runtime/git-adapter";
import { runtimeStatePaths, type RuntimeLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import { listModelFiles, type ModelFile } from "@archcontext/local-runtime/model-store-yaml";
import type { RuntimeArchitectureLedgerModes, RuntimeLedgerProjectInput, RuntimeLedgerMigrateInput, RuntimeLedgerRollbackInput, RuntimeLedgerRebuildInput } from "./index";

interface LedgerAdminContext {
  assertRunning(): void;
  withWriter<T>(run: () => Promise<T>): Promise<T>;
  clock(): string;
  architectureLedger: RuntimeArchitectureLedgerModes;
  architectureLedgerScope(root: string): Promise<ArchitectureLedgerScope>;
  architectureLedgerGitScope(root: string): Promise<ArchitectureLedgerScope>;
  assertFreshWorktree(root: string, expectedWorktreeDigest: string | undefined, command: string): void;
  appendArchitectureEventsWithFeed(root: string, input: ArchitectureLedgerAppendInput): Promise<ArchitectureLedgerAppendResult>;
  localStore: Pick<RuntimeLocalStore, "readArchitectureLedgerState" | "replayArchitectureLedgerEvidence" | "replayArchitectureLedger" | "resolveLatestArchitectureLedgerScope" | "readArchitectureLedgerSourceCursor" | "backupArchitectureLedger" | "rebuildArchitectureLedgerCurrentState" | "checkArchitectureLedgerIntegrity">;
  openSession(root: string): Promise<{ workspace: WorkspaceRef; snapshot: RepositorySnapshot }>;
  modelStore: Pick<ModelStorePort, "validateModel">;
  changeSetEngine: Pick<ChangeSetEngine, "plan" | "approve" | "apply">;
  recommendationArtifacts(events: readonly ArchitectureEventV1[]): { recommendations: RecommendationLedgerRecordV1[] };
  managedModelPath(path: string): boolean;
  shortDigest(digest: string): string;
}

export class LedgerAdminService {
  constructor(private readonly context: LedgerAdminContext) {}

  async ledgerProject(root: string, input: RuntimeLedgerProjectInput = { dryRun: true }): Promise<JsonEnvelope> {
    this.context.assertRunning();
    const writes = input.dryRun === false;
    const project = async () => {
      if (writes) this.context.assertFreshWorktree(root, input.expectedWorktreeDigest, "ledger project --to-git");
      const scope = await this.context.architectureLedgerScope(root);
      const state = await this.context.localStore.readArchitectureLedgerState(scope);
      const projectedFiles = projectArchitectureLedgerStateToYamlFiles(state);
      const removedPaths = obsoleteManagedProjectionPaths(
        listModelFiles(root).filter((file) => this.context.managedModelPath(file.path)),
        projectedFiles
      );
      if (writes) {
        await this.applyArchitectureProjectionChangeSet(root, {
          id: `changeset.ledger-project-${this.context.shortDigest(architectureLedgerProjectionDigest(projectedFiles))}`,
          files: projectedFiles.map(({ path, body }) => ({ path, body })),
          removedPaths
        });
      }
      const drift = compareArchitectureLedgerStateToYaml({
        state,
        files: listModelFiles(root),
        createdAt: this.context.clock(),
        command: "archctx ledger project --to-git"
      });
      const reconcile = reconcileArchitectureLedgerDrift({ drift });
      return okEnvelope("ledger.project", {
        schemaVersion: "archcontext.runtime-architecture-ledger-project/v1",
        architectureLedger: this.context.architectureLedger,
        repository: scope.repository,
        worktree: scope.worktree,
        dryRun: !writes,
        writes: writes ? "git-projection" : "none",
        projectedFileCount: projectedFiles.length,
        projectionDigest: architectureLedgerProjectionDigest(projectedFiles),
        graphDigest: architectureLedgerStateDigest(state),
        writtenPaths: writes ? projectedFiles.map((file) => file.path) : [],
        removedPaths: writes ? removedPaths : [],
        projectedFiles: writes ? undefined : projectedFiles,
        drift,
        reconcile
      } as unknown as Json);
    };
    return writes ? this.context.withWriter(project) : project();
  }

  async ledgerMigrate(root: string, input: RuntimeLedgerMigrateInput = { dryRun: true }): Promise<JsonEnvelope> {
    this.context.assertRunning();
    if (input.fromYaml && input.recommendationV3) {
      return errorEnvelope("ledger.migrate", "AC_SCHEMA_INVALID", "ledger migrate accepts --from-yaml or --recommendation-v3, not both");
    }
    if (input.recommendationV3) return this.ledgerMigrateRecommendationV3(root, input);
    if (!input.fromYaml) return errorEnvelope("ledger.migrate", "AC_SCHEMA_INVALID", "ledger migrate requires --from-yaml or --recommendation-v3");
    const writes = input.dryRun === false;
    const migrate = async () => {
      const repositoryRoot = root;
      if (writes) this.context.assertFreshWorktree(repositoryRoot, input.expectedWorktreeDigest, "ledger migrate --from-yaml");
      const scope = await this.context.architectureLedgerScope(repositoryRoot);
      const files = listModelFiles(repositoryRoot);
      const command = writes
        ? "archctx ledger migrate --from-yaml --write"
        : "archctx ledger migrate --from-yaml --dry-run";
      const previousEvidenceState = await this.context.localStore.replayArchitectureLedgerEvidence(scope);
      const plan = planYamlToArchitectureLedgerImport({
        ...scope,
        files,
        previousEvidenceState,
        createdAt: this.context.clock(),
        command
      });
      const previousState = await this.context.localStore.readArchitectureLedgerState(scope);
      const previousGraphDigest = architectureLedgerStateDigest(previousState);
      const base = {
        schemaVersion: "archcontext.runtime-architecture-ledger-migrate/v1",
        architectureLedger: this.context.architectureLedger,
        repository: scope.repository,
        worktree: scope.worktree,
        sourceMode: "git-yaml",
        dryRun: !writes,
        graphDigest: plan.graphDigest,
        previousGraphDigest,
        sourceDigest: plan.sourceDigest,
        projectionDigest: plan.projectionDigest,
        imported: plan.imported,
        ignoredFiles: plan.ignoredFiles,
        unsupportedFiles: plan.unsupportedFiles,
        rollback: {
          command: "archctx ledger rollback --to-yaml --write --expected-worktree-digest <current>",
          safeDowngradeEnvironment: this.context.architectureLedger.phaseFlags.safeDowngrade.environment
        }
      } as const;
      if (!writes) {
        return okEnvelope("ledger.migrate", {
          ...base,
          status: plan.unsupportedFiles.length > 0 ? "blocked" : "planned",
          writes: "none",
          backup: { status: "not-created", reason: "dry-run" },
          append: { status: "not-applied" },
          verification: { status: "not-run", reason: "dry-run" },
          drift: plan.drift,
          reconcile: reconcileArchitectureLedgerDrift({ drift: plan.drift })
        } as unknown as Json);
      }
      if (plan.unsupportedFiles.length > 0) {
        return errorEnvelope("ledger.migrate", "AC_SCHEMA_INVALID", "ledger migrate --from-yaml --write requires supported YAML model files");
      }
      const paths = runtimeStatePaths(repositoryRoot);
      const backupCreatedAt = this.context.clock();
      const backupPath = uniqueRuntimeBackupPath(join(
        paths.workspaceStateDir,
        "backups",
        "ledger-migrate",
        safePathSegment(backupCreatedAt),
        "runtime.sqlite"
      ));
      const backup = await this.context.localStore.backupArchitectureLedger({ backupPath });
      const append = await this.context.appendArchitectureEventsWithFeed(repositoryRoot, {
        writer: "runtime-daemon",
        events: [plan.event]
      });
      const replay = await this.context.localStore.rebuildArchitectureLedgerCurrentState(scope);
      const integrity = await this.context.localStore.checkArchitectureLedgerIntegrity(scope);
      const drift = compareArchitectureLedgerStateToYaml({
        state: replay.state,
        files: listModelFiles(repositoryRoot),
        createdAt: this.context.clock(),
        command
      });
      const reconcile = reconcileArchitectureLedgerDrift({ drift });
      const verified = integrity.ok && replay.graphDigest === plan.graphDigest && drift.ok && reconcile.ok;
      return okEnvelope("ledger.migrate", {
        ...base,
        status: verified ? "verified" : "verification-failed",
        writes: "architecture-ledger",
        backup: {
          schemaVersion: "archcontext.runtime-architecture-ledger-sqlite-backup/v1",
          status: "created",
          backupPath: backup.backupPath,
          integrity: backup.integrity,
          createdAt: backupCreatedAt
        },
        append: {
          status: "appended",
          appendedEventCount: append.appendedEvents.length,
          duplicateEventCount: append.duplicateEvents.length,
          graphDigest: append.graphDigest,
          entityCount: append.entityCount,
          relationCount: append.relationCount,
          constraintCount: append.constraintCount
        },
        verification: {
          schemaVersion: "archcontext.runtime-architecture-ledger-migration-verification/v1",
          ok: verified,
          replayedEventCount: replay.cursor.eventCount,
          graphDigest: replay.graphDigest,
          expectedGraphDigest: plan.graphDigest,
          integrity,
          driftOk: drift.ok,
          reconcileOk: reconcile.ok
        },
        drift,
        reconcile,
        recommendedEnvironment: {
          ARCHCONTEXT_LEDGER_MODE: "dual"
        }
      } as unknown as Json);
    };
    return writes ? this.context.withWriter(migrate) : migrate();
  }

  /**
   * Appends one migration event; it never rewrites a `recommendations` row. The event stream is
   * the authority, so an in-place UPDATE would leave the log at v2, and `operations` stays empty
   * so `ledger rebuild` replays to an identical `graphDigest` before and after.
   */
  private async ledgerMigrateRecommendationV3(root: string, input: RuntimeLedgerMigrateInput): Promise<JsonEnvelope> {
    const repositoryRoot = findRepositoryRoot(root);
    const writes = input.dryRun === false;
    const migrate = async (): Promise<JsonEnvelope> => {
      if (writes) this.context.assertFreshWorktree(repositoryRoot, input.expectedWorktreeDigest, "ledger migrate --recommendation-v3");
      const scope = await this.context.architectureLedgerScope(repositoryRoot);
      const replay = await this.context.localStore.replayArchitectureLedger({ ...scope, mode: "genesis" });
      const artifacts = this.context.recommendationArtifacts(replay.events);
      let plan: ReturnType<typeof planRecommendationV3Migration>;
      try {
        plan = planRecommendationV3Migration({
          repository: scope.repository,
          worktree: scope.worktree,
          recommendations: artifacts.recommendations,
          graphDigest: replay.graphDigest,
          now: this.context.clock()
        });
      } catch (error) {
        return errorEnvelope("ledger.migrate", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
      }
      const base = {
        schemaVersion: "archcontext.runtime-recommendation-v3-migrate/v1",
        mode: "recommendation-v3",
        architectureLedger: this.context.architectureLedger,
        repository: scope.repository,
        worktree: scope.worktree,
        dryRun: !writes,
        graphDigest: replay.graphDigest,
        inputDigest: plan.inputDigest,
        upgradedCount: plan.upgraded.length,
        recommendationIds: plan.upgraded.map((recommendation) => recommendation.recommendationId)
      } as const;
      if (!writes) {
        return okEnvelope("ledger.migrate", {
          ...base,
          status: plan.upgraded.length === 0 ? "up-to-date" : "planned",
          writes: "none",
          append: { status: "not-applied" }
        } as unknown as Json);
      }
      if (!plan.event) {
        return okEnvelope("ledger.migrate", {
          ...base,
          status: "up-to-date",
          writes: "none",
          append: { status: "not-applied", appendedEventCount: 0, duplicateEventCount: 0 },
          verification: { ok: true, graphDigest: replay.graphDigest, expectedGraphDigest: replay.graphDigest }
        } as unknown as Json);
      }
      const append = await this.context.appendArchitectureEventsWithFeed(root, {
        writer: "runtime-daemon",
        events: [plan.event]
      });
      const rebuilt = await this.context.localStore.rebuildArchitectureLedgerCurrentState(scope);
      const verified = rebuilt.graphDigest === replay.graphDigest;
      return okEnvelope("ledger.migrate", {
        ...base,
        status: verified ? "verified" : "verification-failed",
        writes: "architecture-ledger",
        append: {
          status: "appended",
          appendedEventCount: append.appendedEvents.length,
          duplicateEventCount: append.duplicateEvents.length,
          graphDigest: append.graphDigest,
          entityCount: append.entityCount,
          relationCount: append.relationCount,
          constraintCount: append.constraintCount
        },
        verification: {
          schemaVersion: "archcontext.runtime-recommendation-v3-migration-verification/v1",
          ok: verified,
          replayedEventCount: rebuilt.cursor.eventCount,
          graphDigest: rebuilt.graphDigest,
          expectedGraphDigest: replay.graphDigest
        }
      } as unknown as Json);
    };
    return writes ? this.context.withWriter(migrate) : migrate();
  }

  async ledgerRollback(root: string, input: RuntimeLedgerRollbackInput = { dryRun: true }): Promise<JsonEnvelope> {
    this.context.assertRunning();
    if (!input.toYaml) return errorEnvelope("ledger.rollback", "AC_SCHEMA_INVALID", "ledger rollback currently requires --to-yaml");
    const writes = input.dryRun === false;
    const rollback = async () => {
      if (writes) this.context.assertFreshWorktree(root, input.expectedWorktreeDigest, "ledger rollback --to-yaml");
      const scope = await this.context.architectureLedgerScope(root);
      const state = await this.context.localStore.readArchitectureLedgerState(scope);
      const projectedFiles = projectArchitectureLedgerStateToYamlFiles(state);
      const currentManagedFiles = listModelFiles(root).filter((file) => this.context.managedModelPath(file.path));
      const backupPlan = architectureProjectionRollbackBackup(currentManagedFiles);
      const writeResult = writes
        ? await this.applyArchitectureProjectionRollbackChangeSet(root, projectedFiles, currentManagedFiles, this.context.clock())
        : { backup: backupPlan.backup, writtenPaths: [], removedPaths: [] };
      const drift = compareArchitectureLedgerStateToYaml({
        state,
        files: listModelFiles(root),
        createdAt: this.context.clock(),
        command: "archctx ledger rollback --to-yaml"
      });
      const reconcile = reconcileArchitectureLedgerDrift({ drift });
      return okEnvelope("ledger.rollback", {
        schemaVersion: "archcontext.runtime-architecture-ledger-rollback/v1",
        architectureLedger: this.context.architectureLedger,
        repository: scope.repository,
        worktree: scope.worktree,
        sourceAuthority: "ledger",
        targetAuthority: "yaml",
        dryRun: !writes,
        writes: writes ? "git-projection" : "none",
        backup: writeResult.backup,
        projectedFileCount: projectedFiles.length,
        projectionDigest: architectureLedgerProjectionDigest(projectedFiles),
        graphDigest: architectureLedgerStateDigest(state),
        writtenPaths: writeResult.writtenPaths,
        removedPaths: writeResult.removedPaths,
        projectedFiles: writes ? undefined : projectedFiles,
        drift,
        reconcile,
        recommendedEnvironment: {
          ARCHCONTEXT_LEDGER_MODE: "yaml"
        }
      } as unknown as Json);
    };
    return writes ? this.context.withWriter(rollback) : rollback();
  }

  async ledgerRebuild(root: string, input: RuntimeLedgerRebuildInput = {}): Promise<JsonEnvelope> {
    this.context.assertRunning();
    if (!input.fromGit) return errorEnvelope("ledger.rebuild", "AC_SCHEMA_INVALID", "ledger rebuild currently requires --from-git");
    return this.context.withWriter(async () => {
      this.context.assertFreshWorktree(root, input.expectedWorktreeDigest, "ledger rebuild --from-git");
      const scope = await this.context.architectureLedgerGitScope(root);
      const files = listModelFiles(root);
      const exactReplay = await this.context.localStore.replayArchitectureLedger(scope);
      const exactEvidenceState = exactReplay.evidenceState;
      const exactScopeHasEvents = exactReplay.cursor.eventCount > 0;
      const authorityScope = exactScopeHasEvents
        ? scope
        : await this.context.localStore.resolveLatestArchitectureLedgerScope(scope);
      const previousState = exactScopeHasEvents
        ? exactReplay.state
        : await this.context.localStore.readArchitectureLedgerState(authorityScope);
      const previousGraphDigest = architectureLedgerStateDigest(previousState);
      const authorityEvidenceState = exactScopeHasEvents
        ? exactEvidenceState
        : (await this.context.localStore.replayArchitectureLedger(authorityScope)).evidenceState;
      const rebuildCommand = input.acceptExternalProjection
        ? "archctx ledger rebuild --from-git --accept-external-projection"
        : "archctx ledger rebuild --from-git";
      const plan = planYamlToArchitectureLedgerRebuild({
        ...scope,
        files,
        createdAt: this.context.clock(),
        command: rebuildCommand,
        previousState,
        previousEvidenceState: exactEvidenceState
      });
      const importPlan = planYamlToArchitectureLedgerImport({
        ...scope,
        files,
        previousEvidenceState: exactEvidenceState,
        createdAt: this.context.clock(),
        command: rebuildCommand
      });
      if (plan.unsupportedFiles.length > 0) {
        return errorEnvelope("ledger.rebuild", "AC_SCHEMA_INVALID", "ledger rebuild requires supported YAML model files");
      }
      const cursor = architectureLedgerGitCursorFromPlan({ ...scope, plan });
      const previousCursor = await this.context.localStore.readArchitectureLedgerSourceCursor({
        ...authorityScope,
        cursorId: ARCHITECTURE_LEDGER_GIT_CURSOR_ID
      });
      const cursorChanged = previousCursor?.cursorDigest !== cursor.cursorDigest;
      const previousStateEmpty = isEmptyArchitectureLedgerState(previousState);
      let append: ArchitectureLedgerAppendResult = {
        appendedEvents: [],
        duplicateEvents: [],
        graphDigest: previousGraphDigest,
        entityCount: previousState.entities.length,
        relationCount: previousState.relations.length,
        constraintCount: previousState.constraints.length
      };
      let rebuildStatus: "unchanged" | "cursor-refreshed" | "rebuilt" | "external-projection-proposed" | "external-projection-accepted" = "unchanged";
      let proposedExternalProjectionChange: Json | undefined;
      if (previousGraphDigest === plan.graphDigest) {
        if (!exactScopeHasEvents) {
          append = await this.context.appendArchitectureEventsWithFeed(root, {
            writer: "runtime-daemon",
            events: [importPlan.event]
          });
          rebuildStatus = isEmptyArchitectureLedgerState(previousState) ? "rebuilt" : "cursor-refreshed";
        } else if (cursorChanged) {
          const cursorPlan = planGitCursorRefreshToArchitectureLedgerEvent({
            ...scope,
            cursor,
            graphDigest: plan.graphDigest,
            createdAt: this.context.clock(),
            command: rebuildCommand
          });
          append = await this.context.appendArchitectureEventsWithFeed(root, {
            writer: "runtime-daemon",
            events: [cursorPlan.event]
          });
          rebuildStatus = "cursor-refreshed";
        }
      } else if (!previousStateEmpty && !input.acceptExternalProjection) {
        const proposal = planExternalProjectionChangeToArchitectureLedgerEvent({
          ...authorityScope,
          files,
          createdAt: this.context.clock(),
          command: rebuildCommand,
          previousState,
          previousEvidenceState: authorityEvidenceState
        });
        append = await this.context.appendArchitectureEventsWithFeed(root, {
          writer: "runtime-daemon",
          events: [proposal.event]
        });
        rebuildStatus = "external-projection-proposed";
        proposedExternalProjectionChange = {
          eventId: proposal.event.eventId,
          baseGraphDigest: proposal.baseGraphDigest,
          proposedGraphDigest: proposal.proposedGraphDigest,
          sourceDigest: proposal.sourceDigest,
          projectionDigest: proposal.projectionDigest,
          reasonCodes: proposal.drift.reasonCodes,
          reconcileCommand: "archctx ledger rebuild --from-git --accept-external-projection --expected-worktree-digest <current>"
        } as unknown as Json;
      } else {
        append = await this.context.appendArchitectureEventsWithFeed(root, {
          writer: "runtime-daemon",
          events: [exactScopeHasEvents ? plan.event : importPlan.event]
        });
        rebuildStatus = previousStateEmpty ? "rebuilt" : "external-projection-accepted";
      }
      const replayScope = rebuildStatus === "external-projection-proposed" ? authorityScope : scope;
      const replay = await this.context.localStore.rebuildArchitectureLedgerCurrentState(replayScope);
      const drift = compareArchitectureLedgerStateToYaml({
        state: replay.state,
        files: listModelFiles(root),
        createdAt: this.context.clock(),
        command: "archctx ledger rebuild --from-git"
      });
      const reconcile = reconcileArchitectureLedgerDrift({ drift });
      return okEnvelope("ledger.rebuild", {
        schemaVersion: "archcontext.runtime-architecture-ledger-rebuild/v1",
        architectureLedger: this.context.architectureLedger,
        repository: scope.repository,
        worktree: scope.worktree,
        sourceMode: "git-yaml",
        status: rebuildStatus,
        reconcileRequired: rebuildStatus === "external-projection-proposed",
        appendedEventCount: append.appendedEvents.length,
        duplicateEventCount: append.duplicateEvents.length,
        replayedEventCount: replay.cursor.eventCount,
        graphDigest: replay.graphDigest,
        previousGraphDigest,
        proposedGraphDigest: plan.graphDigest,
        cursor: {
          changed: cursorChanged,
          cursorDigest: cursor.cursorDigest,
          previousCursorDigest: typeof previousCursor?.cursorDigest === "string" ? previousCursor.cursorDigest : undefined,
          sourceDigest: cursor.sourceDigest,
          projectionDigest: cursor.projectionDigest,
          branch: cursor.branch,
          headSha: cursor.headSha,
          worktreeDigest: cursor.worktreeDigest
        },
        proposedExternalProjectionChange,
        imported: plan.imported,
        ignoredFiles: plan.ignoredFiles,
        unsupportedFiles: plan.unsupportedFiles,
        drift,
        reconcile
      } as unknown as Json);
    });
  }

  private async applyArchitectureProjectionChangeSet(root: string, input: {
    id: string;
    files: { path: string; body: string }[];
    removedPaths: string[];
  }): Promise<void> {
    const session = await this.context.openSession(root);
    const model = await this.context.modelStore.validateModel(session.workspace);
    const baseErrors = baseModelBlockingErrors(model);
    if (baseErrors.length > 0) throw new Error(`Architecture projection ChangeSet base model is invalid: ${baseErrors.join("; ")}`);
    const projectionFiles = input.files.map((file) => ({
      path: file.path,
      body: file.body.endsWith("\n") ? file.body : `${file.body}\n`,
      expectedHash: expectedFileHash(root, file.path)
    }));
    const operations: ChangeOperation[] = [
      ...(projectionFiles.length > 0 ? [{ op: "render_projection" as const, expectedHash: "missing", projectionFiles }] : []),
      ...input.removedPaths.map((path) => ({
        op: "delete_entity" as const,
        path,
        expectedHash: expectedFileHash(root, path)
      }))
    ];
    const draft = this.context.changeSetEngine.approve(this.context.changeSetEngine.plan({
      id: input.id,
      base: {
        headSha: session.workspace.headSha,
        worktreeDigest: session.snapshot.worktreeDigest,
        modelDigest: model.modelDigest
      },
      reason: { taskSessionId: input.id },
      operations
    }));
    await this.context.changeSetEngine.apply(root, draft, { approved: true });
  }

  private async applyArchitectureProjectionRollbackChangeSet(
    root: string,
    projectedFiles: ArchitectureLedgerProjectionFile[],
    currentFiles: ModelFile[],
    createdAt: string
  ): Promise<ArchitectureProjectionRollbackWriteResult> {
    const backupBase = `.archcontext/backups/ledger-rollback/${safePathSegment(createdAt)}`;
    const backupRelativePath = uniqueBackupPath(root, backupBase);
    const manifestPath = `${backupRelativePath}/manifest.json`;
    const { backup, manifest } = architectureProjectionRollbackBackup(currentFiles, {
      createdAt,
      path: backupRelativePath,
      manifestPath
    });
    const removedPaths = obsoleteManagedProjectionPaths(currentFiles, projectedFiles);
    await this.applyArchitectureProjectionChangeSet(root, {
      id: `changeset.ledger-rollback-${this.context.shortDigest(digestJson({ createdAt, projectionDigest: architectureLedgerProjectionDigest(projectedFiles) } as unknown as Json))}`,
      files: [
        ...currentFiles.map((file) => ({
          path: `${backupRelativePath}/${archContextRelativePath(file.path)}`,
          body: file.body
        })),
        { path: manifestPath, body: `${JSON.stringify(manifest, null, 2)}\n` },
        ...projectedFiles.map(({ path, body }) => ({ path, body }))
      ],
      removedPaths
    });
    return {
      backup,
      writtenPaths: projectedFiles.map((file) => file.path),
      removedPaths
    };
  }

}

interface ArchitectureProjectionRollbackWriteResult {
  backup: Json;
  writtenPaths: string[];
  removedPaths: string[];
}

/**
 * Managed model files the ledger no longer projects.
 *
 * Both ledger-to-Git directions — `ledger project --to-git` and `ledger rollback --to-yaml` — must
 * use this one set difference, so an entity, relation, or constraint retired in the ledger cannot
 * survive as stale YAML. `currentFiles` is already filtered to ledger-managed model paths, which is
 * what keeps manifests, policies, waivers, backups, and generated artifacts out of the deletion set.
 */
function obsoleteManagedProjectionPaths(
  currentFiles: ModelFile[],
  projectedFiles: ArchitectureLedgerProjectionFile[]
): string[] {
  const targetPaths = new Set(projectedFiles.map((file) => file.path));
  return currentFiles.filter((file) => !targetPaths.has(file.path)).map((file) => file.path);
}

function expectedFileHash(root: string, path: string): string {
  const absolute = resolve(root, path);
  return existsSync(absolute) ? digestJson({ body: readFileSync(absolute, "utf8") } as unknown as Json) : "missing";
}

function architectureProjectionRollbackBackup(
  files: ModelFile[],
  options: { createdAt?: string; path?: string; manifestPath?: string } = {}
): { backup: Json; manifest: Json } {
  const manifest = {
    schemaVersion: "archcontext.architecture-ledger-yaml-rollback-backup/v1",
    createdAt: options.createdAt,
    fileCount: files.length,
    files: files.map((file) => ({
      path: file.path,
      schemaVersion: file.schemaVersion,
      digest: file.digest
    }))
  } as unknown as Json;
  const backup = {
    schemaVersion: "archcontext.architecture-ledger-yaml-rollback-backup/v1",
    required: true,
    path: options.path,
    manifestPath: options.manifestPath,
    fileCount: files.length,
    paths: files.map((file) => file.path),
    digest: digestJson(manifest)
  } as unknown as Json;
  return { backup, manifest };
}

function uniqueBackupPath(root: string, backupBase: string): string {
  let candidate = backupBase;
  let suffix = 2;
  while (existsSync(resolve(root, candidate))) {
    candidate = `${backupBase}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function uniqueRuntimeBackupPath(backupBase: string): string {
  let candidate = backupBase;
  let suffix = 2;
  while (existsSync(candidate)) {
    candidate = backupBase.replace(/\.sqlite$/, `-${suffix}.sqlite`);
    suffix += 1;
  }
  return candidate;
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-");
}

function archContextRelativePath(path: string): string {
  return path.startsWith(".archcontext/") ? path.slice(".archcontext/".length) : path;
}

function isEmptyArchitectureLedgerState(state: ArchitectureLedgerGraphState): boolean {
  return state.entities.length === 0 && state.relations.length === 0 && state.constraints.length === 0;
}

