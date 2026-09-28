import {
  computeWorktreeDigest
} from "@archcontext/core/architecture-domain";
import {
  diffArchitectureLedgerBookStates,
  emptyArchitectureLedgerState,
  planYamlToArchitectureLedgerImport,
  queryArchitectureLedgerBookNeighbors,
  replayArchitectureLedgerEvidenceState,
  type ArchitectureLedgerReplayResult,
  type ArchitectureLedgerScope,
  type ArchitectureLedgerGraphState
} from "@archcontext/core/architecture-ledger";
import { compileArchitectureFactChanges, compileEvidenceStateChanges } from "@archcontext/core/architecture-delta";
import { detectArchitecturePressure } from "@archcontext/core/pressure-engine";
import { digestJson, errorEnvelope, okEnvelope, type ArchitectureChangeFeedRecordV1, type ArchitectureEventBacklinkV1, type AuthorityCursorV1, type CodeFactsPort, type ExplorerDeltaFailureReasonV2, type ExplorerDeltaQueryV2, type ExplorerProjectionDeltaV2, type ExplorerProjectionQueryV2, type ExplorerProjectionV2, type Json, type JsonEnvelope, type NormalizedCodeContext, type PracticeCheckpointSnapshotV1 } from "@archcontext/contracts";
import { readHeadSha } from "@archcontext/local-runtime/git-adapter";
import type { RuntimeLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import { listModelFiles } from "@archcontext/local-runtime/model-store-yaml";
import {
  ExplorerProjectionCompileError,
  compileExplorerProjection,
  compileExplorerProjectionChanges,
  compileProjectionInputManifest,
  planProjectionRead,
  projectionReadSetFromGraph,
  selectProjectionGraphFromAuthority,
  type ExplorerResolvedBindingV2
} from "./explorer-projection";
import type { RuntimeArchitectureLedgerModes } from "./ledger-admin";

interface ExplorerProjectionContext {
  assertRunning(): void;
  clock(): string;
  localStore: RuntimeLocalStore;
  architectureLedger: RuntimeArchitectureLedgerModes;
  codeFacts: CodeFactsPort;
  architectureLedgerReadback(root: string): Promise<{ repository: ArchitectureLedgerScope["repository"]; worktree: ArchitectureLedgerScope["worktree"] }>;
  architectureLedgerProjectionGitScope(root: string): ArchitectureLedgerScope;
  readPracticeCheckpointBaseline(repositoryId: string, taskSessionId: string): Promise<PracticeCheckpointSnapshotV1 | undefined>;
  notifyExplorerInvalidation(projection: ExplorerProjectionV2, affectedOccurrenceIds: string[]): void;
  notifyExplorerAuthorityInvalidation(root: string, record: ArchitectureChangeFeedRecordV1, occurrenceIds: string[]): void;
}

/**
 * Owns Explorer projection compilation, the digest-addressed projection cache and delta reads,
 * and the architecture change-feed drain that invalidates cached occurrences. The daemon keeps the
 * ledger append itself and hands each committed scope to `processArchitectureChangeFeedAfterCommit`.
 *
 * `localStore` and `architectureLedger` keep the daemon's field names on purpose: the DE source
 * readbacks and `scripts/data-engine-source-invariants.ts` match these method bodies verbatim.
 */
export class ExplorerProjectionService {
  private readonly localStore: RuntimeLocalStore;
  private readonly architectureLedger: RuntimeArchitectureLedgerModes;
  private readonly codeFacts: CodeFactsPort;
  private readonly deferredArchitectureChangeFeedFailures = new Map<string, string>();

  constructor(private readonly context: ExplorerProjectionContext) {
    this.localStore = context.localStore;
    this.architectureLedger = context.architectureLedger;
    this.codeFacts = context.codeFacts;
  }

  changeFeedStatus(): { deferredScopeCount: number; failureDigests: string[] } {
    return {
      deferredScopeCount: this.deferredArchitectureChangeFeedFailures.size,
      failureDigests: [...this.deferredArchitectureChangeFeedFailures.values()].sort()
    };
  }

  clearDeferredChangeFeedFailures(): void {
    this.deferredArchitectureChangeFeedFailures.clear();
  }

  async explorerProjectionV2(root: string, query: ExplorerProjectionQueryV2): Promise<JsonEnvelope> {
    this.assertRunning();
    try {
      const projection = await this.buildExplorerProjectionV2(root, query);
      return okEnvelope("explorer.projection.v2", projection as unknown as Json);
    } catch (error) {
      if (error instanceof ExplorerProjectionCompileError) {
        return errorEnvelope(
          "explorer.projection.v2",
          error.reason === "precondition-failed" ? "AC_PRECONDITION_FAILED" : "AC_SCHEMA_INVALID",
          error.message
        );
      }
      throw error;
    }
  }

  async explorerProjectionDelta(root: string, query: ExplorerDeltaQueryV2): Promise<JsonEnvelope> {
    this.assertRunning();
    const queryFailure = validateExplorerDeltaQueryV2(query);
    if (queryFailure) {
      return errorEnvelope("explorer.delta", "AC_SCHEMA_INVALID", queryFailure, "invalid-delta-query");
    }
    const readback = await this.architectureLedgerReadback(root);
    const scope = { repository: readback.repository, worktree: readback.worktree };
    const [base, head] = await Promise.all([
      this.localStore.readExplorerProjection({ ...scope, projectionDigest: query.base.projectionDigest }),
      this.localStore.readExplorerProjection({ ...scope, projectionDigest: query.head.projectionDigest })
    ]);
    if (!base || !head) {
      return errorEnvelope(
        "explorer.delta",
        "AC_PRECONDITION_FAILED",
        "both digest-addressed Explorer projections must exist in the daemon cache",
        "projection-cache-miss"
      );
    }
    const pinExpiresAt = new Date(Date.parse(this.clock()) + 10 * 60 * 1000).toISOString();
    await this.localStore.pinExplorerProjections({ ...scope, projectionDigests: [base.projectionDigest], reason: "delta-base", expiresAt: pinExpiresAt });
    await this.localStore.pinExplorerProjections({ ...scope, projectionDigests: [head.projectionDigest], reason: "delta-head", expiresAt: pinExpiresAt });
    try {
      let baseReplay: ArchitectureLedgerReplayResult;
      let headReplay: ArchitectureLedgerReplayResult;
      try {
        [baseReplay, headReplay] = await Promise.all([
          this.localStore.replayArchitectureLedger({ ...scope, untilEventId: query.base.eventId }),
          this.localStore.replayArchitectureLedger({ ...scope, untilEventId: query.head.eventId })
        ]);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("architecture-ledger-event-not-found:")) {
          throw new ExplorerDeltaPreconditionError("authority-event-missing", "both authority cursor events must exist in the selected repository/worktree scope");
        }
        throw error;
      }
      if (baseReplay.cursor.lastEventSequence > headReplay.cursor.lastEventSequence) {
        throw new ExplorerDeltaPreconditionError("authority-cursor-reversed", "Explorer delta requires base event at or before head event");
      }
      const baseGraph = baseReplay.state;
      const headGraph = headReplay.state;
      const baseEvidence = baseReplay.evidenceState;
      const headEvidence = headReplay.evidenceState;
      const baseCursor = explorerAuthorityCursorFromReplay(scope, baseReplay);
      const headCursor = explorerAuthorityCursorFromReplay(scope, headReplay);
      if (!sameExplorerAuthorityCursor(base.cursor.authorityCursor, baseCursor) || !sameExplorerAuthorityCursor(head.cursor.authorityCursor, headCursor)) {
        throw new ExplorerDeltaPreconditionError("projection-authority-mismatch", "Explorer projection authority cursor does not match the requested event state");
      }
      const projectionChanges = compileExplorerProjectionChanges(base, head);
      const factChanges = compileArchitectureFactChanges(baseGraph, headGraph);
      const evidenceChanges = compileEvidenceStateChanges(baseEvidence, headEvidence);
      const withoutDigest = {
        schemaVersion: "archcontext.explorer-projection-delta/v2" as const,
        base: { ...baseCursor, projectionDigest: base.projectionDigest, inputManifestDigest: base.inputManifest.manifestDigest },
        head: { ...headCursor, projectionDigest: head.projectionDigest, inputManifestDigest: head.inputManifest.manifestDigest },
        factChanges,
        evidenceChanges,
        projectionChanges,
        counts: {
          "architecture-fact": factChanges.length,
          evidence: evidenceChanges.length,
          projection: projectionChanges.length
        }
      };
      const delta: ExplorerProjectionDeltaV2 = { ...withoutDigest, deltaDigest: digestJson(withoutDigest as unknown as Json) };
      return okEnvelope("explorer.delta", delta as unknown as Json);
    } catch (error) {
      if (error instanceof ExplorerDeltaPreconditionError) {
        return errorEnvelope("explorer.delta", "AC_PRECONDITION_FAILED", error.message, error.reasonCode);
      }
      if (error instanceof ExplorerProjectionCompileError) {
        return errorEnvelope("explorer.delta", "AC_PRECONDITION_FAILED", error.message, "projection-manifest-incompatible");
      }
      throw error;
    }
  }

  private async buildExplorerProjectionV2(root: string, query: ExplorerProjectionQueryV2): Promise<ExplorerProjectionV2> {
    void planProjectionRead(query, "git-authority");
    const gitScope = this.architectureLedgerProjectionGitScope(root);
    const ledgerScope = await this.localStore.resolveArchitectureLedgerScope(gitScope);
    const ledgerAuthority = await this.localStore.readExplorerProjectionAuthority(ledgerScope);
    if (this.architectureLedger.readMode === "ledger" && !ledgerAuthority) {
      throw new ExplorerProjectionCompileError("precondition-failed", "required-input-unavailable:architecture-ledger:no-current-event");
    }
    const emptyEvidenceState = replayArchitectureLedgerEvidenceState([]);
    const needsGitPlan = this.architectureLedger.readMode !== "ledger" || query.viewId === "drift-pressure";
    const yamlPlan = needsGitPlan ? planYamlToArchitectureLedgerImport({
      ...gitScope,
      files: listModelFiles(root),
      previousEvidenceState: emptyEvidenceState,
      createdAt: this.clock(),
      command: "archctx explorer projection"
    }) : undefined;
    if (yamlPlan && (readHeadSha(root) !== gitScope.worktree.headSha || computeWorktreeDigest(root) !== gitScope.worktree.worktreeDigest)) {
      throw new ExplorerProjectionCompileError("precondition-failed", "Explorer authority input changed during projection planning");
    }
    const ledgerMatchesGit = yamlPlan !== undefined && ledgerAuthority?.authorityCursor.graphDigest === yamlPlan.graphDigest;
    const ledgerMatchesGitScope = ledgerAuthority !== undefined
      && digestJson(ledgerAuthority.authorityCursor.repository as unknown as Json) === digestJson(gitScope.repository as unknown as Json)
      && digestJson(ledgerAuthority.authorityCursor.worktree as unknown as Json) === digestJson(gitScope.worktree as unknown as Json);
    const authoritySource = ledgerAuthority && (this.architectureLedger.readMode === "ledger" || (ledgerMatchesGit && ledgerMatchesGitScope)) ? "ledger" as const : "git" as const;
    const scope = authoritySource === "ledger" ? ledgerScope : gitScope;
    const authorityCursor: AuthorityCursorV1 | null = authoritySource === "ledger" ? ledgerAuthority!.authorityCursor : null;
    if (authoritySource === "git" && !yamlPlan) throw new ExplorerProjectionCompileError("precondition-failed", "Git authority plan is required");
    const graphDigest = authoritySource === "ledger" ? ledgerAuthority!.authorityCursor.graphDigest : yamlPlan!.graphDigest;
    const gitEvidenceState = yamlPlan ? replayArchitectureLedgerEvidenceState([yamlPlan.event]) : emptyEvidenceState;
    const evidenceAuthorityCursor = ledgerAuthority?.authorityCursor ?? null;
    const evidenceStateDigest = ledgerAuthority?.evidenceStateDigest ?? gitEvidenceState.stateDigest;
    const workspace = { root, repositoryId: scope.repository.repositoryId, headSha: scope.worktree.headSha };
    let taskSession: { taskSessionId: string; task: string; taskSessionDigest: string } | undefined;
    if (query.taskSessionId) {
      const snapshot = await this.readPracticeCheckpointBaseline(scope.repository.repositoryId, query.taskSessionId);
      if (!snapshot) {
        if (query.viewId === "task-impact") throw new ExplorerProjectionCompileError("precondition-failed", `task session not found: ${query.taskSessionId}`);
      } else if (snapshot.headSha !== scope.worktree.headSha || snapshot.worktreeDigest !== scope.worktree.worktreeDigest) {
        if (query.viewId === "task-impact") throw new ExplorerProjectionCompileError("precondition-failed", `task session is stale: ${query.taskSessionId}`);
      } else {
        taskSession = {
          taskSessionId: query.taskSessionId,
          task: snapshot.task,
          taskSessionDigest: digestJson({ taskSessionId: query.taskSessionId, snapshot } as unknown as Json)
        };
      }
    }
    const task = query.viewId === "task-impact" && taskSession ? taskSession.task : `architecture explorer ${query.viewId}`;
    let observed: NormalizedCodeContext;
    let observedAvailability: { status: "ready" | "unavailable"; reasonCode?: string } = { status: "ready" };
    try {
      await this.codeFacts.ensureReady(workspace);
      observed = await this.codeFacts.buildTaskContext({
        task,
        maxSymbols: Math.min(1000, Math.max(query.budget.maxNodes, query.budget.maxNodes * 4)),
        includeSource: false
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reasonCode = message.includes("CodeGraph index missing") ? "codegraph-index-missing" : "codegraph-unavailable";
      throw new ExplorerProjectionCompileError("precondition-failed", `required-input-unavailable:observed:${reasonCode}`);
    }
    await this.processArchitectureChangeFeed(root, scope);
    const pressureResult = observedAvailability.status === "ready" ? detectArchitecturePressure({
      task,
      symbols: observed.symbols.map((symbol) => symbol.id),
      files: observed.symbols.map((symbol) => symbol.path),
      edges: observed.edges,
      observedEvidence: observed.evidence
    }) : undefined;
    const pressure = pressureResult ? {
      inputDigest: digestJson({ task, observedFactsDigest: observed.digest, pressure: pressureResult } as unknown as Json),
      level: pressureResult.level,
      score: pressureResult.score,
      signals: pressureResult.signals.map((signal) => ({ type: signal.type, evidence: signal.evidence }))
    } : undefined;
    const readPlan = planProjectionRead(query, authoritySource === "ledger" ? "verified-ledger-current" : "git-authority");
    let plannedGraph: ArchitectureLedgerGraphState;
    let plannedBindings: ExplorerResolvedBindingV2[];
    let eventBacklinks: ArchitectureEventBacklinkV1[];
    let readSet: ExplorerProjectionV2["inputManifest"]["readSet"];
    if (authoritySource === "ledger") {
      if (!authorityCursor) throw new ExplorerProjectionCompileError("precondition-failed", "verified ledger authority cursor is required");
      const planned = await this.localStore.readExplorerProjectionInputs({ ...scope, query, plan: readPlan, authorityCursor });
      plannedGraph = planned.graph;
      plannedBindings = planned.bindings;
      eventBacklinks = planned.eventBacklinks;
      readSet = planned.readSet;
    } else {
      plannedGraph = selectProjectionGraphFromAuthority(readPlan, yamlPlan!.state);
      const selectedEntityIds = new Set(plannedGraph.entities.map((item) => item.entityId));
      const selectedSubjectIds = [
        ...plannedGraph.entities.map((item) => item.entityId),
        ...plannedGraph.relations.map((item) => item.relationId),
        ...plannedGraph.constraints.map((item) => item.constraintId)
      ];
      let metadata: { rowsRead: { bindings: number; backlinks: number }; truncated: boolean };
      if (ledgerAuthority) {
        const ledgerMetadata = await this.localStore.readExplorerProjectionMetadata({
          ...ledgerScope,
          query,
          plan: readPlan,
          authorityCursor: ledgerAuthority.authorityCursor,
          entityIds: [...selectedEntityIds],
          subjectIds: selectedSubjectIds
        });
        plannedBindings = ledgerMetadata.bindings;
        eventBacklinks = ledgerMetadata.eventBacklinks;
        metadata = ledgerMetadata;
      } else {
        const evidenceById = new Map(gitEvidenceState.evidenceItems.map((item) => [item.evidenceId, item]));
        const bindingRows = gitEvidenceState.evidenceBindings
          .filter((binding) => binding.target.kind === "entity" && selectedEntityIds.has(binding.target.id));
        plannedBindings = bindingRows.slice(0, readPlan.limits.maxBindings).flatMap((binding) => {
          const evidence = evidenceById.get(binding.evidenceId);
          return evidence?.selector.symbolId ? [{
            bindingId: binding.bindingId,
            targetEntityId: binding.target.id,
            observedSymbolId: evidence.selector.symbolId,
            verified: evidence.strength === "verified" && binding.authorityEffect !== "context-only"
          }] : [];
        });
        eventBacklinks = [];
        metadata = {
          rowsRead: { bindings: Math.min(bindingRows.length, readPlan.limits.maxBindings), backlinks: 0 },
          truncated: bindingRows.length > readPlan.limits.maxBindings
        };
      }
      const activeState = {
        entities: yamlPlan!.state.entities.filter((item) => item.status !== "removed"),
        relations: yamlPlan!.state.relations.filter((item) => item.status !== "removed"),
        constraints: yamlPlan!.state.constraints.filter((item) => item.status !== "removed")
      };
      const focusedTotals = readPlan.kind === "focused-neighborhood" && readPlan.focusSubjectId
        ? (() => {
            const neighbors = queryArchitectureLedgerBookNeighbors({
              state: yamlPlan!.state,
              id: readPlan.focusSubjectId!,
              depth: readPlan.depth,
              maxItems: activeState.entities.length + activeState.relations.length + activeState.constraints.length + 1,
              maxBytes: 100_000_000
            });
            return { entities: neighbors.nodes.length, relations: neighbors.relations.length, constraints: neighbors.constraints.length };
          })()
        : undefined;
      readSet = projectionReadSetFromGraph(readPlan, plannedGraph, {
        entities: focusedTotals?.entities ?? activeState.entities.length,
        relations: focusedTotals?.relations ?? activeState.relations.length,
        constraints: focusedTotals?.constraints ?? activeState.constraints.length
      }, {
        bindings: metadata.rowsRead.bindings,
        backlinks: metadata.rowsRead.backlinks
      }, [...activeState.entities.reduce((counts, entity) => counts.set(entity.kind, (counts.get(entity.kind) ?? 0) + 1), new Map<string, number>()).entries()]
        .map(([kind, count]) => ({ kind, count })).sort((a, b) => a.kind.localeCompare(b.kind)), metadata.truncated);
    }
    await this.localStore.recordExplorerRuntimeMetric({
      ...scope,
      metricName: "plan-rows-read",
      reasonCode: "bounded-read-plan",
      value: Object.values(readSet.rowsRead).reduce((sum, value) => sum + value, 0)
    });
    let drift: { inputDigest: string; subjectIds: string[]; reasonCodes: string[] } | undefined;
    if (yamlPlan) {
      let ledgerComparisonGraph = emptyArchitectureLedgerState();
      if (authoritySource === "ledger") {
        ledgerComparisonGraph = plannedGraph;
      } else if (ledgerAuthority) {
        const ledgerComparisonPlan = planProjectionRead(query, "verified-ledger-current");
        ledgerComparisonGraph = (await this.localStore.readExplorerProjectionInputs({
          ...ledgerScope,
          query,
          plan: ledgerComparisonPlan,
          authorityCursor: ledgerAuthority.authorityCursor
        })).graph;
      }
      const gitComparisonPlan = planProjectionRead(query, "git-authority");
      const gitComparisonGraph = selectProjectionGraphFromAuthority(gitComparisonPlan, yamlPlan.state);
      const boundedDrift = diffArchitectureLedgerBookStates({
        previousState: ledgerComparisonGraph,
        nextState: gitComparisonGraph,
        fromRef: "ledger-current",
        toRef: "git-authority",
        maxItems: readPlan.limits.maxGraphRows,
        maxBytes: 10_000_000
      });
      drift = {
        inputDigest: digestJson(boundedDrift as unknown as Json),
        subjectIds: uniqueStrings(boundedDrift.changes.map((change) => change.id)),
        reasonCodes: uniqueStrings([
          ...boundedDrift.reasonCodes,
          ...(ledgerAuthority && ledgerAuthority.authorityCursor.graphDigest !== yamlPlan.graphDigest ? ["graph-digest-mismatch"] : []),
          ...(!ledgerAuthority && yamlPlan.state.entities.length + yamlPlan.state.relations.length + yamlPlan.state.constraints.length > 0 ? ["ledger-authority-unavailable"] : [])
        ])
      };
    }
    if (yamlPlan && (readHeadSha(root) !== gitScope.worktree.headSha || computeWorktreeDigest(root) !== gitScope.worktree.worktreeDigest)) {
      throw new ExplorerProjectionCompileError("precondition-failed", "Explorer authority input changed before projection compilation");
    }
    const projectionInput = {
      query,
      repository: scope.repository,
      worktree: scope.worktree,
      authoritySource,
      authorityCursor,
      evidenceAuthorityCursor,
      graph: plannedGraph,
      graphDigest,
      evidenceStateDigest,
      readPlan,
      readSet,
      observed,
      bindings: plannedBindings,
      pressure,
      drift,
      taskSession,
      eventBacklinks,
      observedAvailability,
      tokenRequired: true
    };
    const inputManifest = compileProjectionInputManifest(projectionInput);
    let cached: ExplorerProjectionV2 | undefined;
    try {
      cached = await this.localStore.readExplorerProjectionByManifest({
        ...scope,
        manifestDigest: inputManifest.manifestDigest
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("explorer-projection-cache-")) {
        throw new ExplorerProjectionCompileError("precondition-failed", error.message);
      }
      throw error;
    }
    if (cached) return cached;
    await this.localStore.recordExplorerRuntimeMetric({ ...scope, metricName: "cache-rebuild", reasonCode: "manifest-miss", value: 1 });
    const compileStartedAt = Date.now();
    const projection = compileExplorerProjection(projectionInput);
    await this.localStore.recordExplorerRuntimeMetric({ ...scope, metricName: "compile-time-ms", reasonCode: "projection-compile", value: Date.now() - compileStartedAt });
    const previous = await this.localStore.readLatestExplorerProjection({ ...scope, viewId: projection.view.id });
    const changedDependencyKeys = previous ? explorerChangedDependencyKeys(previous, projection) : [];
    const affectedOccurrenceIds = await this.localStore.listAffectedExplorerOccurrences({ ...scope, dependencyKeys: changedDependencyKeys });
    await this.localStore.invalidateExplorerOccurrences({ ...scope, occurrenceIds: affectedOccurrenceIds });
    await this.localStore.saveExplorerProjection({
      repository: scope.repository,
      worktree: scope.worktree,
      projection,
      dependencies: explorerProjectionDependencies(projection)
    });
    this.notifyExplorerInvalidation(projection, affectedOccurrenceIds);
    return projection;
  }

  async processArchitectureChangeFeedAfterCommit(root: string, scope: ArchitectureLedgerScope): Promise<void> {
    const scopeDigest = digestJson(scope as unknown as Json);
    try {
      await this.processArchitectureChangeFeed(root, scope);
      this.deferredArchitectureChangeFeedFailures.delete(scopeDigest);
    } catch (error) {
      this.deferredArchitectureChangeFeedFailures.set(scopeDigest, digestJson({
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error)
      } as unknown as Json));
    }
  }

  private async processArchitectureChangeFeed(root: string, scope: ArchitectureLedgerScope): Promise<number> {
    const consumerId = "runtime-daemon.explorer-cache.v1";
    const scopeDigest = digestJson(scope as unknown as Json);
    let processed = 0;
    for (let page = 0; page < 1_000; page += 1) {
      const batch = await this.localStore.listArchitectureChangeFeed({ ...scope, consumerId, limit: 100 });
      if (batch.records.length === 0) {
        this.deferredArchitectureChangeFeedFailures.delete(scopeDigest);
        return processed;
      }
      await this.localStore.recordExplorerRuntimeMetric({
        ...scope,
        metricName: "feed-lag",
        reasonCode: "change-feed",
        value: Math.max(0, Date.parse(this.clock()) - Date.parse(batch.records[0]!.committedAt))
      });
      for (const record of batch.records) {
        const dependencyKeys = architectureChangeFeedDependencyKeys(record);
        const occurrenceIds = await this.localStore.listAffectedExplorerOccurrences({ ...scope, dependencyKeys });
        await this.localStore.invalidateExplorerOccurrences({ ...scope, occurrenceIds });
        this.notifyExplorerAuthorityInvalidation(root, record, occurrenceIds);
        processed += 1;
      }
      await this.localStore.acknowledgeArchitectureChangeFeed({
        ...scope,
        consumerId,
        feedSequence: batch.records.at(-1)!.feedSequence
      });
      if (!batch.hasMore) {
        this.deferredArchitectureChangeFeedFailures.delete(scopeDigest);
        return processed;
      }
    }
    throw new Error("architecture-change-feed-page-limit-exceeded");
  }

  private assertRunning(): void {
    this.context.assertRunning();
  }

  private clock(): string {
    return this.context.clock();
  }

  private architectureLedgerReadback(root: string) {
    return this.context.architectureLedgerReadback(root);
  }

  private architectureLedgerProjectionGitScope(root: string): ArchitectureLedgerScope {
    return this.context.architectureLedgerProjectionGitScope(root);
  }

  private readPracticeCheckpointBaseline(repositoryId: string, taskSessionId: string): Promise<PracticeCheckpointSnapshotV1 | undefined> {
    return this.context.readPracticeCheckpointBaseline(repositoryId, taskSessionId);
  }

  private notifyExplorerInvalidation(projection: ExplorerProjectionV2, affectedOccurrenceIds: string[]): void {
    this.context.notifyExplorerInvalidation(projection, affectedOccurrenceIds);
  }

  private notifyExplorerAuthorityInvalidation(root: string, record: ArchitectureChangeFeedRecordV1, occurrenceIds: string[]): void {
    this.context.notifyExplorerAuthorityInvalidation(root, record, occurrenceIds);
  }
}

class ExplorerDeltaPreconditionError extends Error {
  constructor(readonly reasonCode: ExplorerDeltaFailureReasonV2, message: string) {
    super(message);
    this.name = "ExplorerDeltaPreconditionError";
  }
}

function validateExplorerDeltaQueryV2(query: unknown): string | undefined {
  if (!query || typeof query !== "object" || Array.isArray(query)) return "Explorer delta query must be an object";
  const value = query as Record<string, unknown>;
  if (value.schemaVersion !== "archcontext.explorer-delta-query/v2") return `unsupported Explorer delta schema: ${String(value.schemaVersion)}`;
  for (const side of ["base", "head"] as const) {
    const ref = value[side];
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) return `Explorer delta ${side} cursor reference is required`;
    const record = ref as Record<string, unknown>;
    if (typeof record.eventId !== "string" || record.eventId.length === 0) return `Explorer delta ${side}.eventId is required`;
    if (typeof record.projectionDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.projectionDigest)) {
      return `Explorer delta ${side}.projectionDigest must be a sha256 digest`;
    }
  }
  return undefined;
}

function sameExplorerAuthorityCursor(actual: AuthorityCursorV1 | null, expected: AuthorityCursorV1): boolean {
  return actual !== null && digestJson(actual as unknown as Json) === digestJson(expected as unknown as Json);
}

function explorerAuthorityCursorFromReplay(
  scope: ArchitectureLedgerScope,
  replay: ArchitectureLedgerReplayResult
): AuthorityCursorV1 {
  if (!replay.cursor.lastEventId || !replay.cursor.lastEventHash) {
    throw new ExplorerProjectionCompileError("precondition-failed", "authority cursor requires a replayed event");
  }
  return {
    schemaVersion: "archcontext.authority-cursor/v1",
    repository: scope.repository,
    worktree: scope.worktree,
    eventSequence: replay.cursor.eventCount,
    eventId: replay.cursor.lastEventId,
    eventHash: replay.cursor.lastEventHash,
    graphDigest: replay.graphDigest,
    evidenceStateDigest: replay.evidenceState.stateDigest
  };
}

function explorerProjectionDependencies(projection: ExplorerProjectionV2): Array<{ occurrenceId: string; dependencyKeys: string[] }> {
  return projection.occurrences.map((occurrence) => ({
    occurrenceId: occurrence.occurrenceId,
    dependencyKeys: uniqueStrings([
      `graph:${projection.cursor.graphDigest}`,
      `observed:${projection.cursor.observedFactsDigest}`,
      `view:${projection.cursor.viewDefinitionDigest}`,
      ...occurrence.provenance.declaredEntityIds.map((id) => `entity:${id}`),
      ...occurrence.provenance.observedSymbolIds.map((id) => `symbol:${id}`),
      ...occurrence.provenance.evidenceBindingIds.map((id) => `binding:${id}`),
      ...occurrence.sourceSelectors.map((selector) => `path:${selector.path}`),
      ...projection.relations.filter((relation) => relation.sourceOccurrenceId === occurrence.occurrenceId || relation.targetOccurrenceId === occurrence.occurrenceId).flatMap((relation) => [
        ...relation.provenance.declaredRelationIds.map((id) => `relation:${id}`),
        ...relation.provenance.observedEdgeIds.map((id) => `edge:${id}`)
      ])
    ])
  }));
}

function architectureChangeFeedDependencyKeys(record: ArchitectureChangeFeedRecordV1): string[] {
  const keys = record.changedInputDigests.graphBefore === record.changedInputDigests.graphAfter
    ? []
    : [`graph:${record.changedInputDigests.graphBefore}`];
  for (const subject of record.affectedSubjects) {
    if (subject.subjectKind === "entity") keys.push(`entity:${subject.subjectId}`);
    else if (subject.subjectKind === "relation") keys.push(`relation:${subject.subjectId}`);
    else if (subject.subjectKind === "constraint") keys.push(`constraint:${subject.subjectId}`);
    else if (subject.subjectKind === "evidence-binding") keys.push(`binding:${subject.subjectId}`);
    else if (subject.subjectKind === "subject") {
      keys.push(`entity:${subject.subjectId}`, `relation:${subject.subjectId}`, `constraint:${subject.subjectId}`);
    }
  }
  return uniqueStrings(keys);
}

function explorerChangedDependencyKeys(base: ExplorerProjectionV2, head: ExplorerProjectionV2): string[] {
  const baseById = new Map(base.occurrences.map((occurrence) => [occurrence.occurrenceId, occurrence]));
  const headById = new Map(head.occurrences.map((occurrence) => [occurrence.occurrenceId, occurrence]));
  const keys: string[] = [];
  for (const occurrenceId of uniqueStrings([...baseById.keys(), ...headById.keys()])) {
    const before = baseById.get(occurrenceId);
    const after = headById.get(occurrenceId);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    for (const occurrence of [before, after]) {
      if (!occurrence) continue;
      keys.push(...occurrence.provenance.declaredEntityIds.map((id) => `entity:${id}`));
      keys.push(...occurrence.provenance.observedSymbolIds.map((id) => `symbol:${id}`));
      keys.push(...occurrence.provenance.evidenceBindingIds.map((id) => `binding:${id}`));
      keys.push(...occurrence.sourceSelectors.map((selector) => `path:${selector.path}`));
    }
  }
  const baseRelations = new Map(base.relations.map((relation) => [relation.occurrenceId, relation]));
  const headRelations = new Map(head.relations.map((relation) => [relation.occurrenceId, relation]));
  for (const relationId of uniqueStrings([...baseRelations.keys(), ...headRelations.keys()])) {
    const before = baseRelations.get(relationId);
    const after = headRelations.get(relationId);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    for (const relation of [before, after]) {
      if (!relation) continue;
      keys.push(...relation.provenance.declaredRelationIds.map((id) => `relation:${id}`));
      keys.push(...relation.provenance.observedEdgeIds.map((id) => `edge:${id}`));
    }
  }
  return uniqueStrings(keys);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}
