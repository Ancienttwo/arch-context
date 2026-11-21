import { digestJson, errorEnvelope, okEnvelope, type ArchitectureEventBacklinkV1, type AuthorityCursorV1, type CodeFactsPort, type ExplorerDeltaFailureReasonV2, type ExplorerProjectionDeltaV2, type ExplorerProjectionQueryV2, type ExplorerProjectionV2, type Json, type JsonEnvelope, type NormalizedCodeContext, type PracticeCheckpointSnapshotV1 } from "@archcontext/contracts";
import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import { diffArchitectureLedgerBookStates, emptyArchitectureLedgerState, planYamlToArchitectureLedgerImport, queryArchitectureLedgerBookNeighbors, replayArchitectureLedgerEvidenceState, type ArchitectureLedgerGraphState, type ArchitectureLedgerScope } from "@archcontext/core/architecture-ledger";
import { compileArchitectureFactChanges, compileEvidenceStateChanges } from "@archcontext/core/architecture-delta";
import { detectArchitecturePressure } from "@archcontext/core/pressure-engine";
import { listGitVisibleFiles, readHeadSha } from "@archcontext/local-runtime/git-adapter";
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
import { publicFailureEnvelope, publicOperationErrorEnvelope, publicOperationFailure, publicOperationResult } from "./public-operation-failure";

interface CachedExplorerRecord {
  projection: ExplorerProjectionV2;
  graph: ArchitectureLedgerGraphState;
  evidenceState: ReturnType<typeof replayArchitectureLedgerEvidenceState>;
}

interface ExplorerProjectionContext {
  assertRunning(): void;
  clock(): string;
  localStore: Pick<RuntimeLocalStore, "readCacheEntry" | "writeCacheEntry">;
  codeFacts: CodeFactsPort;
  architectureLedgerProjectionGitScope(root: string): ArchitectureLedgerScope;
  readPracticeCheckpointBaseline(repositoryId: string, taskSessionId: string): Promise<PracticeCheckpointSnapshotV1 | undefined>;
  notifyExplorerInvalidation(projection: ExplorerProjectionV2, affectedOccurrenceIds: string[]): void;
}

/** Compiles and caches read-only Explorer projections directly from YAML model + CodeGraph facts. */
export class ExplorerProjectionService {
  private readonly cache = new Map<string, CachedExplorerRecord>();
  private readonly latestByView = new Map<string, ExplorerProjectionV2>();

  constructor(private readonly context: ExplorerProjectionContext) {}

  clearDeferredChangeFeedFailures(): void {
    this.cache.clear();
    this.latestByView.clear();
  }

  async explorerProjectionV2(root: string, query: ExplorerProjectionQueryV2): Promise<JsonEnvelope> {
    try { return publicOperationResult("explorer.projection.v2", await this.explorerProjectionV2Unchecked(root, query)) as JsonEnvelope; }
    catch (error) { throw publicOperationFailure(error); }
  }

  private async explorerProjectionV2Unchecked(root: string, query: ExplorerProjectionQueryV2): Promise<JsonEnvelope> {
    this.context.assertRunning();
    try {
      return okEnvelope("explorer.projection.v2", (await this.buildExplorerProjectionV2(root, query)) as unknown as Json);
    } catch (error) {
      if (error instanceof ExplorerProjectionCompileError) return publicOperationErrorEnvelope("explorer.projection.v2", error);
      throw error;
    }
  }

  async explorerProjectionDelta(root: string, query: ExplorerProjectionDeltaV2 | unknown): Promise<JsonEnvelope> {
    try { return publicOperationResult("explorer.delta", await this.explorerProjectionDeltaUnchecked(root, query)) as JsonEnvelope; }
    catch (error) { throw publicOperationFailure(error); }
  }

  private async explorerProjectionDeltaUnchecked(root: string, query: unknown): Promise<JsonEnvelope> {
    this.context.assertRunning();
    const issue = validateExplorerDeltaQueryV2(query);
    if (issue) return publicFailureEnvelope("explorer.delta", "AC_SCHEMA_INVALID", "invalid-delta-query", {});
    const parsed = query as import("@archcontext/contracts").ExplorerDeltaQueryV2;
    const scope = this.context.architectureLedgerProjectionGitScope(root);
    const scopeKey = `${scope.repository.storageRepositoryId}:${scope.worktree.storageWorkspaceId}`;
    const base = this.cache.get(`${scopeKey}:${parsed.base.projectionDigest}`)
      ?? await this.context.localStore.readCacheEntry<CachedExplorerRecord>("explorer_projection", `${scopeKey}:${parsed.base.projectionDigest}`);
    const head = this.cache.get(`${scopeKey}:${parsed.head.projectionDigest}`)
      ?? await this.context.localStore.readCacheEntry<CachedExplorerRecord>("explorer_projection", `${scopeKey}:${parsed.head.projectionDigest}`);
    if (!base || !head) {
      return errorEnvelope("explorer.delta", "AC_PRECONDITION_FAILED", "both digest-addressed Explorer projections must exist in cache", "projection-cache-miss");
    }
    const projectionChanges = compileExplorerProjectionChanges(base.projection, head.projection);
    const factChanges = compileArchitectureFactChanges(base.graph, head.graph);
    const evidenceChanges = compileEvidenceStateChanges(base.evidenceState, head.evidenceState);
    const baseCursor = base.projection.cursor.authorityCursor ?? {
      schemaVersion: "archcontext.authority-cursor/v1" as const,
      repository: scope.repository,
      worktree: scope.worktree,
      eventSequence: 0,
      eventId: parsed.base.eventId,
      eventHash: digestJson({ eventId: parsed.base.eventId }),
      graphDigest: base.projection.cursor.graphDigest,
      evidenceStateDigest: base.evidenceState.stateDigest
    };
    const headCursor = head.projection.cursor.authorityCursor ?? {
      schemaVersion: "archcontext.authority-cursor/v1" as const,
      repository: scope.repository,
      worktree: scope.worktree,
      eventSequence: 0,
      eventId: parsed.head.eventId,
      eventHash: digestJson({ eventId: parsed.head.eventId }),
      graphDigest: head.projection.cursor.graphDigest,
      evidenceStateDigest: head.evidenceState.stateDigest
    };
    const withoutDigest = {
      schemaVersion: "archcontext.explorer-projection-delta/v2" as const,
      base: { ...baseCursor, projectionDigest: base.projection.projectionDigest, inputManifestDigest: base.projection.inputManifest.manifestDigest },
      head: { ...headCursor, projectionDigest: head.projection.projectionDigest, inputManifestDigest: head.projection.inputManifest.manifestDigest },
      factChanges,
      evidenceChanges,
      projectionChanges,
      counts: { "architecture-fact": factChanges.length, evidence: evidenceChanges.length, projection: projectionChanges.length }
    };
    const delta: ExplorerProjectionDeltaV2 = { ...withoutDigest, deltaDigest: digestJson(withoutDigest as unknown as Json) };
    return okEnvelope("explorer.delta", delta as unknown as Json);
  }

  private async buildExplorerProjectionV2(root: string, query: ExplorerProjectionQueryV2): Promise<ExplorerProjectionV2> {
    const scope = this.context.architectureLedgerProjectionGitScope(root);
    const yamlPlan = planYamlToArchitectureLedgerImport({
      ...scope,
      files: listModelFiles(root),
      previousEvidenceState: replayArchitectureLedgerEvidenceState([]),
      createdAt: this.context.clock(),
      command: "archctx explorer projection"
    });
    if (readHeadSha(root) !== scope.worktree.headSha || computeWorktreeDigest(root, listGitVisibleFiles(root)) !== scope.worktree.worktreeDigest) {
      throw new ExplorerProjectionCompileError("precondition-failed", "Explorer authority input changed during projection planning");
    }
    const workspace = { root, repositoryId: scope.repository.repositoryId, headSha: scope.worktree.headSha };
    let taskSession: { taskSessionId: string; task: string; taskSessionDigest: string } | undefined;
    if (query.taskSessionId) {
      const snapshot = await this.context.readPracticeCheckpointBaseline(scope.repository.repositoryId, query.taskSessionId);
      if (!snapshot && query.viewId === "task-impact") throw new ExplorerProjectionCompileError("precondition-failed", `task session not found: ${query.taskSessionId}`);
      if (snapshot && (snapshot.headSha !== scope.worktree.headSha || snapshot.worktreeDigest !== scope.worktree.worktreeDigest)) {
        if (query.viewId === "task-impact") throw new ExplorerProjectionCompileError("precondition-failed", `task session is stale: ${query.taskSessionId}`);
      } else if (snapshot) {
        taskSession = { taskSessionId: query.taskSessionId, task: snapshot.task, taskSessionDigest: digestJson({ taskSessionId: query.taskSessionId, snapshot } as unknown as Json) };
      }
    }
    const task = query.viewId === "task-impact" && taskSession ? taskSession.task : `architecture explorer ${query.viewId}`;
    let observed: NormalizedCodeContext;
    let observedAvailability: { status: "ready" | "unavailable"; reasonCode?: string } = { status: "ready" };
    try {
      await this.context.codeFacts.ensureReady(workspace);
      observed = await this.context.codeFacts.buildTaskContext({
        workspace,
        task,
        maxSymbols: Math.min(1000, Math.max(query.budget.maxNodes, query.budget.maxNodes * 4)),
        includeSource: false
      });
    } catch {
      throw new ExplorerProjectionCompileError("precondition-failed", "required-input-unavailable:observed", {
        inputDomain: "observed",
        availability: "unavailable",
        cause: "unclassified"
      });
    }
    const pressureResult = observedAvailability.status === "ready" ? detectArchitecturePressure({
      task,
      symbols: observed.symbols.map((s) => s.id),
      files: observed.symbols.map((s) => s.path),
      edges: observed.edges,
      observedEvidence: observed.evidence
    }) : undefined;
    const pressure = pressureResult ? {
      inputDigest: digestJson({ task, observedFactsDigest: observed.digest, pressure: pressureResult } as unknown as Json),
      level: pressureResult.level,
      score: pressureResult.score,
      signals: pressureResult.signals.map((signal) => ({ type: signal.type, evidence: signal.evidence }))
    } : undefined;
    const readPlan = planProjectionRead(query, "git-authority");
    const plannedGraph = selectProjectionGraphFromAuthority(readPlan, yamlPlan.state);
    const gitEvidenceState = replayArchitectureLedgerEvidenceState([yamlPlan.event]);
    const selectedEntityIds = new Set(plannedGraph.entities.map((e) => e.entityId));
    const evidenceById = new Map(gitEvidenceState.evidenceItems.map((item) => [item.evidenceId, item]));
    const bindingRows = gitEvidenceState.evidenceBindings.filter((b) => b.target.kind === "entity" && selectedEntityIds.has(b.target.id));
    const plannedBindings: ExplorerResolvedBindingV2[] = bindingRows.slice(0, readPlan.limits.maxBindings).flatMap((binding) => {
      const evidence = evidenceById.get(binding.evidenceId);
      return evidence?.selector.symbolId ? [{
        bindingId: binding.bindingId,
        targetEntityId: binding.target.id,
        observedSymbolId: evidence.selector.symbolId,
        verified: evidence.strength === "verified" && binding.authorityEffect !== "context-only"
      }] : [];
    });
    const activeState = {
      entities: yamlPlan.state.entities.filter((i) => i.status !== "removed"),
      relations: yamlPlan.state.relations.filter((i) => i.status !== "removed"),
      constraints: yamlPlan.state.constraints.filter((i) => i.status !== "removed")
    };
    const focusedTotals = readPlan.kind === "focused-neighborhood" && readPlan.focusSubjectId
      ? (() => {
          const neighbors = queryArchitectureLedgerBookNeighbors({
            state: yamlPlan.state,
            id: readPlan.focusSubjectId!,
            depth: readPlan.depth,
            maxItems: activeState.entities.length + activeState.relations.length + activeState.constraints.length + 1,
            maxBytes: 100_000_000
          });
          return { entities: neighbors.nodes.length, relations: neighbors.relations.length, constraints: neighbors.constraints.length };
        })()
      : undefined;
    const readSet = projectionReadSetFromGraph(readPlan, plannedGraph, {
      entities: focusedTotals?.entities ?? activeState.entities.length,
      relations: focusedTotals?.relations ?? activeState.relations.length,
      constraints: focusedTotals?.constraints ?? activeState.constraints.length
    }, {
      bindings: Math.min(bindingRows.length, readPlan.limits.maxBindings),
      backlinks: 0
    }, [...activeState.entities.reduce((counts, entity) => counts.set(entity.kind, (counts.get(entity.kind) ?? 0) + 1), new Map<string, number>()).entries()]
      .map(([kind, count]) => ({ kind, count })).sort((a, b) => a.kind.localeCompare(b.kind)), bindingRows.length > readPlan.limits.maxBindings);
    const gitComparisonGraph = selectProjectionGraphFromAuthority(readPlan, yamlPlan.state);
    const boundedDrift = diffArchitectureLedgerBookStates({
      previousState: emptyArchitectureLedgerState(),
      nextState: gitComparisonGraph,
      fromRef: "git-empty",
      toRef: "git-authority",
      maxItems: readPlan.limits.maxGraphRows,
      maxBytes: 10_000_000
    });
    const projectionInput = {
      query,
      repository: scope.repository,
      worktree: scope.worktree,
      authoritySource: "git" as const,
      authorityCursor: null as AuthorityCursorV1 | null,
      evidenceAuthorityCursor: null as AuthorityCursorV1 | null,
      graph: plannedGraph,
      graphDigest: yamlPlan.graphDigest,
      evidenceStateDigest: gitEvidenceState.stateDigest,
      readPlan,
      readSet,
      observed,
      bindings: plannedBindings,
      pressure,
      drift: { inputDigest: digestJson(boundedDrift as unknown as Json), subjectIds: uniqueStrings(boundedDrift.changes.map((c) => c.id)), reasonCodes: uniqueStrings(boundedDrift.reasonCodes) },
      taskSession,
      eventBacklinks: [] as ArchitectureEventBacklinkV1[],
      observedAvailability,
      tokenRequired: true
    };
    const inputManifest = compileProjectionInputManifest(projectionInput);
    const scopeKey = `${scope.repository.storageRepositoryId}:${scope.worktree.storageWorkspaceId}`;
    const cached = await this.context.localStore.readCacheEntry<ExplorerProjectionV2>("explorer_projection_manifest", `${scopeKey}:${inputManifest.manifestDigest}`);
    if (cached) return cached;
    const projection = compileExplorerProjection(projectionInput);
    const record: CachedExplorerRecord = { projection, graph: yamlPlan.state, evidenceState: gitEvidenceState };
    this.cache.set(`${scopeKey}:${projection.projectionDigest}`, record);
    const previous = this.latestByView.get(`${scopeKey}:${projection.view.id}`);
    this.latestByView.set(`${scopeKey}:${projection.view.id}`, projection);
    await this.context.localStore.writeCacheEntry("explorer_projection_manifest", `${scopeKey}:${inputManifest.manifestDigest}`, projection);
    await this.context.localStore.writeCacheEntry("explorer_projection", `${scopeKey}:${projection.projectionDigest}`, record);
    const affected = previous ? projection.occurrences.map((o) => o.occurrenceId).filter((id) => !previous.occurrences.some((p) => p.occurrenceId === id)) : [];
    this.context.notifyExplorerInvalidation(projection, affected);
    return projection;
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
    if (typeof record.projectionDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.projectionDigest)) return `Explorer delta ${side}.projectionDigest must be a sha256 digest`;
  }
  return undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}
