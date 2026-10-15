import { publicFailureEnvelope, publicOperationErrorEnvelope, publicOperationFailure, publicOperationResult } from "./public-operation-failure";
import { checkpointTask, prepareTask } from "@archcontext/core/application";
import type { ArchitectureContextLedgerPort } from "@archcontext/core/context-compiler";
import { practiceCatalogEnvelope, type PracticeCatalogCommandInput } from "@archcontext/core/practice-catalog";
import { loadPracticeWaiverOwnerRegistry, loadPracticeWaivers } from "@archcontext/core/practice-engine";
import { digestJson, errorEnvelope, okEnvelope, type ArchitectureDebtReportV1, type CodeFactsPort, type Json, type JsonEnvelope, type ModelStorePort, type PracticeCheckpointSnapshotV1, type RepositorySnapshot, type WorkspaceRef } from "@archcontext/contracts";
import { listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import type { RuntimeLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import type { ExternalDocumentationService } from "./external-documentation";
import type { RuntimePracticeCheckpointInput } from "./rpc-types";
import { runArchitectureDebtCommand, selectedProducerFailureEnvelope } from "./architecture-debt";

/** The parts of the daemon's repository session this service reads. */
type RepositorySession = { workspace: WorkspaceRef; snapshot: RepositorySnapshot };

interface CheckpointCoalesceEntry {
  repositoryId: string;
  taskSessionId: string;
  data: Json;
  eventCount: number;
}

interface PersistedPracticeCheckpointBaseline {
  schemaVersion: "archcontext.practice-checkpoint-baseline/v1";
  repositoryId: string;
  taskSessionId: string;
  snapshot: PracticeCheckpointSnapshotV1;
  updatedAt: string;
}

interface PracticeCheckpointContext {
  assertRunning(): void;
  clock(): string;
  openSession(root: string): Promise<RepositorySession>;
  codeFacts: CodeFactsPort;
  readModelStore: ModelStorePort;
  localStore: Pick<RuntimeLocalStore, "saveTaskState" | "readTaskState">;
  externalDocumentationService: Pick<ExternalDocumentationService, "augmentPrepareContextWithExternalDocs">;
  runtimeArchitectureLedgerContextPort(root: string): ArchitectureContextLedgerPort | undefined;
}

/**
 * Owns prepare and the explicit practice checkpoint writer, the per-task practice checkpoint baseline (memory cache plus the
 * persisted task-state row), checkpoint coalescing, and the practice catalog and waiver reads.
 *
 * `completeTask` and the Explorer task-impact view read the baseline through
 * `readPracticeCheckpointBaseline`; `completeTask` itself and `planPracticeWaiver` (ChangeSet
 * authority) stay in the daemon facade. Member names match the daemon's so the moved bodies are
 * unchanged, and the Context7 hard-gate scan follows `practiceCheckpoint` into this file.
 */
export class PracticeCheckpointService {
  private readonly codeFacts: CodeFactsPort;
  private readonly readModelStore: ModelStorePort;
  private readonly localStore: PracticeCheckpointContext["localStore"];
  private readonly externalDocumentationService: PracticeCheckpointContext["externalDocumentationService"];
  private readonly checkpointBaselines = new Map<string, PracticeCheckpointSnapshotV1>();
  private readonly checkpointCoalesced = new Map<string, CheckpointCoalesceEntry>();

  constructor(private readonly context: PracticeCheckpointContext) {
    this.codeFacts = context.codeFacts;
    this.readModelStore = context.readModelStore;
    this.localStore = context.localStore;
    this.externalDocumentationService = context.externalDocumentationService;
  }

  /** Drops the in-memory baseline cache and coalesced checkpoints; the daemon calls this on stop. */
  clear(): void {
    this.checkpointBaselines.clear();
    this.checkpointCoalesced.clear();
  }

  async prepare(root: string, task: string, maxBytes = 12_288, maxItems = 12, taskSessionId = "task_runtime"): Promise<JsonEnvelope> {
    try { return publicOperationResult("prepare", await this.prepareUnchecked(root, task, maxBytes, maxItems, taskSessionId)) as JsonEnvelope; }
    catch (error) { throw publicOperationFailure(error); }
  }

  private async prepareUnchecked(root: string, task: string, maxBytes = 12_288, maxItems = 12, taskSessionId = "task_runtime"): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const result = await prepareTask({
      workspace: session.workspace,
      task,
      codeFacts: this.codeFacts,
      modelStore: this.readModelStore,
      architectureLedger: this.runtimeArchitectureLedgerContextPort(root),
      budget: { maxBytes, maxItems }
    });
    const context = await this.externalDocumentationService.augmentPrepareContextWithExternalDocs(session, task, result.context, maxBytes);
    const augmentedResult = context === result.context ? result : { ...result, context };
    await this.savePracticeCheckpointBaseline(session.workspace.repositoryId, taskSessionId, {
      schemaVersion: "archcontext.practice-checkpoint-snapshot/v1",
      task,
      headSha: session.workspace.headSha,
      worktreeDigest: session.snapshot.worktreeDigest,
      contextDigest: augmentedResult.context.extensions.digest,
      practiceGuidanceDigest: augmentedResult.context.extensions.practiceGuidanceDigest,
      catalogDigest: augmentedResult.context.practiceGuidance.catalogDigest,
      matches: augmentedResult.context.practiceGuidance.matches
    });
    this.clearPracticeCheckpointCoalesced(session.workspace.repositoryId, taskSessionId);
    return okEnvelope("prepare", augmentedResult as unknown as Json);
  }

  async practiceCheckpoint(root: string, input: RuntimePracticeCheckpointInput): Promise<JsonEnvelope> {
    try { return await this.practiceCheckpointUnchecked(root, input); }
    catch (error) { return selectedProducerFailureEnvelope("practices.checkpoint", error, "practice-checkpoint"); }
  }

  private async practiceCheckpointUnchecked(root: string, input: RuntimePracticeCheckpointInput): Promise<JsonEnvelope> {
    this.assertRunning();
    const started = Date.now();
    const session = await this.openSession(root);
    const taskSessionId = input.taskSessionId ?? "task_runtime";
    const baseline = await this.readPracticeCheckpointBaseline(session.workspace.repositoryId, taskSessionId);
    const task = input.task ?? baseline?.task ?? "checkpoint";
    const coalesceKey = this.practiceCheckpointCoalesceKey(session, taskSessionId, task, input, baseline);
    const debtResult = runArchitectureDebtCommand(root, { changedPaths: input.changedPaths });
    if (!debtResult.ok) return { ...debtResult, requestId: "practices.checkpoint" };
    const debt = debtResult.data as unknown as ArchitectureDebtReportV1;
    const coalesced = this.checkpointCoalesced.get(coalesceKey);
    if (coalesced) {
      coalesced.eventCount += 1;
      const cached = coalesced.data as Record<string, any>;
      return okEnvelope("practices.checkpoint", {
        ...cached,
        // Human text is not part of the context-guidance digest. Re-read it even on a coalesced
        // practice checkpoint so the debt cannot retain a citation repaired between events.
        debt: debt as unknown as Json,
        hook: {
          ...cached.hook,
          coalesced: true,
          skippedAnalysis: true,
          coalescedEventCount: coalesced.eventCount,
          elapsedMs: Date.now() - started
        }
      } as Json);
    }
    const result = await checkpointTask({
      workspace: session.workspace,
      taskSessionId,
      task,
      event: input.event ?? "manual",
      changedPaths: input.changedPaths ?? [],
      toolCallId: input.toolCallId,
      expectedHeadSha: input.expectedHeadSha,
      expectedWorktreeDigest: input.expectedWorktreeDigest,
      worktreeFiles: listGitVisibleFiles(session.workspace.root),
      previous: baseline,
      codeFacts: this.codeFacts,
      modelStore: this.readModelStore,
      architectureLedger: this.runtimeArchitectureLedgerContextPort(root),
      budget: { maxBytes: input.maxBytes ?? 12_288, maxItems: input.maxItems ?? 12 }
    });
    await this.savePracticeCheckpointBaseline(session.workspace.repositoryId, taskSessionId, result.nextSnapshot);
    const data = {
      ...result,
      debt,
      hook: {
        ...result.hook,
        coalesced: false,
        skippedAnalysis: false,
        coalescedEventCount: 1,
        coalesceKey,
        elapsedMs: Date.now() - started
      }
    } as unknown as Json;
    this.checkpointCoalesced.set(coalesceKey, {
      repositoryId: session.workspace.repositoryId,
      taskSessionId,
      data,
      eventCount: 1
    });
    this.pruneCheckpointCoalesced();
    return okEnvelope("practices.checkpoint", data);
  }

  practices(root: string, input: PracticeCatalogCommandInput): JsonEnvelope {
    try { return publicOperationResult("practices", this.practicesUnchecked(root, input)) as JsonEnvelope; }
    catch (error) { throw publicOperationFailure(error); }
  }

  private practicesUnchecked(root: string, input: PracticeCatalogCommandInput): JsonEnvelope {
    this.assertRunning();
    return practiceCatalogEnvelope(root, input);
  }

  practiceWaivers(root: string): JsonEnvelope {
    this.assertRunning();
    try {
      const ownerRegistry = loadPracticeWaiverOwnerRegistry(root);
      const waivers = loadPracticeWaivers(root);
      return okEnvelope("practices.waivers", {
        schemaVersion: "archcontext.practice-waiver-list/v1",
        ownerRegistry,
        count: waivers.length,
        waivers: waivers.map((waiver) => ({
          ...waiver,
          waiverDigest: digestJson(waiver as unknown as Json)
        }))
      } as unknown as Json);
    } catch (error) {
      return publicFailureEnvelope("practices.waivers", "AC_SCHEMA_INVALID", "waiver-list-unreadable");
    }
  }

  private async savePracticeCheckpointBaseline(repositoryId: string, taskSessionId: string, snapshot: PracticeCheckpointSnapshotV1): Promise<void> {
    this.checkpointBaselines.set(this.practiceCheckpointKey(repositoryId, taskSessionId), snapshot);
    await this.localStore.saveTaskState(this.practiceCheckpointStateKey(repositoryId, taskSessionId), {
      schemaVersion: "archcontext.practice-checkpoint-baseline/v1",
      repositoryId,
      taskSessionId,
      snapshot,
      updatedAt: this.clock()
    } satisfies PersistedPracticeCheckpointBaseline);
  }

  async readPracticeCheckpointBaseline(repositoryId: string, taskSessionId: string): Promise<PracticeCheckpointSnapshotV1 | undefined> {
    const key = this.practiceCheckpointKey(repositoryId, taskSessionId);
    const memory = this.checkpointBaselines.get(key);
    if (memory) return memory;
    const state = await this.localStore.readTaskState(this.practiceCheckpointStateKey(repositoryId, taskSessionId));
    const persisted = parsePracticeCheckpointBaselineState(state, repositoryId, taskSessionId);
    if (!persisted) return undefined;
    this.checkpointBaselines.set(key, persisted.snapshot);
    return persisted.snapshot;
  }

  private practiceCheckpointKey(repositoryId: string, taskSessionId: string): string {
    return `${repositoryId}:${taskSessionId}`;
  }

  private practiceCheckpointStateKey(repositoryId: string, taskSessionId: string): string {
    return `practice-checkpoint:${repositoryId}:${taskSessionId}`;
  }

  private practiceCheckpointCoalesceKey(session: RepositorySession, taskSessionId: string, task: string, input: RuntimePracticeCheckpointInput, baseline?: PracticeCheckpointSnapshotV1): string {
    return digestJson({
      repositoryId: session.workspace.repositoryId,
      headSha: session.workspace.headSha,
      worktreeDigest: session.snapshot.worktreeDigest,
      taskSessionId,
      task,
      previousContextDigest: baseline?.contextDigest,
      previousPracticeGuidanceDigest: baseline?.practiceGuidanceDigest,
      event: input.event ?? "manual",
      changedPaths: normalizeCheckpointPaths(input.changedPaths ?? []),
      toolCallId: input.toolCallId,
      expectedHeadSha: input.expectedHeadSha,
      expectedWorktreeDigest: input.expectedWorktreeDigest,
      maxBytes: input.maxBytes ?? 12_288,
      maxItems: input.maxItems ?? 12
    } as Json);
  }

  private clearPracticeCheckpointCoalesced(repositoryId: string, taskSessionId: string): void {
    for (const [key, entry] of this.checkpointCoalesced) {
      if (entry.repositoryId === repositoryId && entry.taskSessionId === taskSessionId) this.checkpointCoalesced.delete(key);
    }
  }

  private pruneCheckpointCoalesced(): void {
    while (this.checkpointCoalesced.size > 128) {
      const oldest = this.checkpointCoalesced.keys().next().value;
      if (oldest === undefined) return;
      this.checkpointCoalesced.delete(oldest);
    }
  }

  private assertRunning(): void {
    this.context.assertRunning();
  }

  private clock(): string {
    return this.context.clock();
  }

  private openSession(root: string): Promise<RepositorySession> {
    return this.context.openSession(root);
  }

  private runtimeArchitectureLedgerContextPort(root: string): ArchitectureContextLedgerPort | undefined {
    return this.context.runtimeArchitectureLedgerContextPort(root);
  }
}

function normalizeCheckpointPaths(paths: string[]): string[] {
  return [...new Set(paths
    .map((path) => path.trim().replaceAll("\\", "/"))
    .filter((path) => path.length > 0 && !path.startsWith("/") && !path.includes(".."))
  )].sort();
}

function parsePracticeCheckpointBaselineState(
  state: unknown,
  repositoryId: string,
  taskSessionId: string
): PersistedPracticeCheckpointBaseline | undefined {
  if (!state || typeof state !== "object") return undefined;
  const record = state as Partial<PersistedPracticeCheckpointBaseline>;
  if (record.schemaVersion !== "archcontext.practice-checkpoint-baseline/v1") return undefined;
  if (record.repositoryId !== repositoryId || record.taskSessionId !== taskSessionId) return undefined;
  const snapshot = record.snapshot as Partial<PracticeCheckpointSnapshotV1> | undefined;
  if (!snapshot || snapshot.schemaVersion !== "archcontext.practice-checkpoint-snapshot/v1") return undefined;
  if (
    typeof snapshot.task !== "string" ||
    typeof snapshot.headSha !== "string" ||
    typeof snapshot.worktreeDigest !== "string" ||
    typeof snapshot.contextDigest !== "string" ||
    typeof snapshot.practiceGuidanceDigest !== "string" ||
    typeof snapshot.catalogDigest !== "string" ||
    !Array.isArray(snapshot.matches)
  ) {
    return undefined;
  }
  return record as PersistedPracticeCheckpointBaseline;
}
