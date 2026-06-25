import type { CrossRepoRelation, Landscape } from "@archcontext/core/architecture-domain";
import type { ChangeSetDraft, ChangeSetJournalFile } from "@archcontext/core/changeset-engine";
import {
  architectureLedgerPayload,
  architectureLedgerStateDigest,
  emptyArchitectureLedgerState,
  normalizeArchitectureLedgerEvent,
  replayArchitectureLedgerEvents,
  type ArchitectureLedgerAppendInput,
  type ArchitectureLedgerAppendResult,
  type ArchitectureLedgerGraphState,
  type ArchitectureLedgerReplayInput,
  type ArchitectureLedgerReplayResult,
  type ArchitectureLedgerReplayVerification,
  type ArchitectureLedgerScope
} from "@archcontext/core/architecture-ledger";
import type { AgentJobV1, ArchitectureEventV1, ExternalDocumentationCacheEntry, ExternalDocumentationProvider, Json, RepositorySnapshot } from "@archcontext/contracts";
import { LOCAL_SQLITE_MIGRATIONS, rebuildDerivedLandscapeState, type LandscapeRebuildInput, type LandscapeRebuildResult, type PersistedRepositorySession, type RuntimeAgentJobCancelInput, type RuntimeAgentJobClaimInput, type RuntimeAgentJobCompleteInput, type RuntimeAgentJobEnqueueInput, type RuntimeAgentJobEnqueueResult, type RuntimeAgentJobRecord, type RuntimeAgentJobRetryInput, type RuntimeAgentJobStaleCancellationInput, type RuntimeAgentJobStatus, type RuntimeLocalStore } from "../src/index";

export class TestLocalStore implements RuntimeLocalStore {
  readonly migrations = new Set<string>();
  readonly snapshots = new Map<string, { snapshot: RepositorySnapshot; state: "pending" | "committed" }>();
  readonly repositorySessions = new Map<string, PersistedRepositorySession>();
  readonly taskStates = new Map<string, unknown>();
  readonly reviews = new Map<string, unknown>();
  readonly landscapes = new Map<string, Landscape>();
  readonly crossRepoEdges = new Map<string, CrossRepoRelation>();
  readonly externalDocumentation = new Map<string, ExternalDocumentationCacheEntry>();
  readonly runtimeAgentJobs = new Map<string, RuntimeAgentJobRecord>();
  readonly changeSetJournals = new Map<string, {
    root: string;
    draft: ChangeSetDraft;
    files: ChangeSetJournalFile[];
    status: "pending" | "committed" | "aborted" | "recovered";
    reason?: string;
    ledger?: {
      plannedEvent?: ArchitectureEventV1;
      append?: ArchitectureLedgerAppendResult;
    };
  }>();
  readonly architectureEventAppends: ArchitectureLedgerAppendInput[] = [];
  readonly architectureEvents: ArchitectureEventV1[] = [];

  async migrate(): Promise<void> {
    for (const migration of LOCAL_SQLITE_MIGRATIONS) this.migrations.add(migration.id);
  }

  async beginSnapshot(snapshot: RepositorySnapshot): Promise<string> {
    const id = `snapshot_${this.snapshots.size + 1}`;
    this.snapshots.set(id, { snapshot, state: "pending" });
    return id;
  }

  async commitSnapshot(snapshotId: string): Promise<void> {
    const record = this.snapshots.get(snapshotId);
    if (!record) throw new Error(`Snapshot not found: ${snapshotId}`);
    record.state = "committed";
  }

  recoverPendingSnapshots(): number {
    let recovered = 0;
    for (const [id, record] of this.snapshots) {
      if (record.state === "pending") {
        this.snapshots.delete(id);
        recovered += 1;
      }
    }
    return recovered;
  }

  async saveRepositorySession(session: PersistedRepositorySession): Promise<void> {
    this.repositorySessions.set(session.repositoryId, session);
  }

  async listRepositorySessions(): Promise<PersistedRepositorySession[]> {
    return [...this.repositorySessions.values()].sort((a, b) =>
      a.updatedAt.localeCompare(b.updatedAt) || a.repositoryId.localeCompare(b.repositoryId)
    );
  }

  async enqueueRuntimeAgentJob(input: RuntimeAgentJobEnqueueInput): Promise<RuntimeAgentJobEnqueueResult> {
    if (input.job.status !== "queued") throw new Error("runtime-agent-job-enqueue-requires-queued-status");
    const coalesceKey = input.coalesceKey ?? testRuntimeAgentJobDefaultCoalesceKey(input.job, input.analysisKind);
    const duplicate = [...this.runtimeAgentJobs.values()]
      .filter((record) => testRuntimeAgentJobMatchesScope(record, input.job)
        && record.analysisKind === input.analysisKind
        && record.job.fingerprint === input.job.fingerprint
        && (record.job.status === "queued" || record.job.status === "running"))
      .sort(testRuntimeAgentJobSort)[0];
    if (duplicate) {
      return { record: duplicate, enqueued: false, deduplicated: true, supersededJobIds: [] };
    }

    const superseded = [...this.runtimeAgentJobs.values()]
      .filter((record) => testRuntimeAgentJobMatchesScope(record, input.job)
        && record.analysisKind === input.analysisKind
        && record.coalesceKey === coalesceKey
        && record.job.status === "queued")
      .sort(testRuntimeAgentJobSort);
    for (const record of superseded) {
      this.runtimeAgentJobs.set(record.job.jobId, {
        ...record,
        job: testRuntimeAgentJobWithStatus(record.job, "superseded", input.job.queuedAt),
        lastError: "coalesced-by-newer-job",
        supersededByJobId: input.job.jobId
      });
    }

    const record: RuntimeAgentJobRecord = {
      job: input.job,
      analysisKind: input.analysisKind,
      coalesceKey,
      attemptCount: 0,
      maxAttempts: Math.max(1, Math.trunc(input.maxAttempts ?? 3)),
      debounceUntil: input.debounceUntil
    };
    this.runtimeAgentJobs.set(input.job.jobId, record);
    return {
      record,
      enqueued: true,
      deduplicated: false,
      supersededJobIds: superseded.map((job) => job.job.jobId)
    };
  }

  async listRuntimeAgentJobs(input: ArchitectureLedgerScope & { statuses?: RuntimeAgentJobStatus[] }): Promise<RuntimeAgentJobRecord[]> {
    const statuses = new Set(input.statuses);
    return [...this.runtimeAgentJobs.values()]
      .filter((record) => record.job.repository.storageRepositoryId === input.repository.storageRepositoryId
        && record.job.worktree.storageWorkspaceId === input.worktree.storageWorkspaceId
        && (!input.statuses || statuses.has(record.job.status)))
      .sort(testRuntimeAgentJobSort);
  }

  async claimRuntimeAgentJob(input: RuntimeAgentJobClaimInput): Promise<RuntimeAgentJobRecord | undefined> {
    const record = [...this.runtimeAgentJobs.values()]
      .filter((candidate) => candidate.job.repository.storageRepositoryId === input.repository.storageRepositoryId
        && candidate.job.worktree.storageWorkspaceId === input.worktree.storageWorkspaceId
        && ((candidate.job.status === "queued" && (!candidate.debounceUntil || candidate.debounceUntil <= input.now))
          || (candidate.job.status === "running" && !!candidate.leaseExpiresAt && candidate.leaseExpiresAt <= input.now)))
      .sort(testRuntimeAgentJobSort)[0];
    if (!record) return undefined;
    const attemptCount = record.attemptCount + 1;
    if (attemptCount > record.maxAttempts) {
      this.runtimeAgentJobs.set(record.job.jobId, {
        ...record,
        job: testRuntimeAgentJobWithStatus(record.job, "failed", input.now),
        attemptCount,
        leaseOwner: undefined,
        leasedAt: undefined,
        leaseExpiresAt: undefined,
        lastError: "max-attempts-exhausted",
        deadLetteredAt: input.now
      });
      return undefined;
    }
    const leaseExpiresAt = new Date(Date.parse(input.now) + input.leaseMs).toISOString();
    const claimed = {
      ...record,
      job: testRuntimeAgentJobWithStatus(record.job, "running", input.now),
      attemptCount,
      leaseOwner: input.workerId,
      leasedAt: input.now,
      leaseExpiresAt,
      lastError: undefined
    };
    this.runtimeAgentJobs.set(record.job.jobId, claimed);
    return claimed;
  }

  async completeRuntimeAgentJob(input: RuntimeAgentJobCompleteInput): Promise<RuntimeAgentJobRecord> {
    const record = this.requiredRuntimeAgentJob(input.jobId);
    if (input.workerId && record.leaseOwner && record.leaseOwner !== input.workerId) {
      throw new Error(`runtime-agent-job-lease-owner-mismatch: ${input.jobId}`);
    }
    const updated = {
      ...record,
      job: testRuntimeAgentJobWithStatus(record.job, input.status, input.now, input.outputDigest),
      leaseOwner: undefined,
      leasedAt: undefined,
      leaseExpiresAt: undefined,
      lastError: input.error,
      deadLetteredAt: input.status === "failed" && record.attemptCount >= record.maxAttempts ? input.now : record.deadLetteredAt
    };
    this.runtimeAgentJobs.set(input.jobId, updated);
    return updated;
  }

  async retryRuntimeAgentJob(input: RuntimeAgentJobRetryInput): Promise<RuntimeAgentJobRecord> {
    const record = this.requiredRuntimeAgentJob(input.jobId);
    const maxed = record.attemptCount >= record.maxAttempts;
    const updated = {
      ...record,
      job: testRuntimeAgentJobWithStatus(record.job, maxed ? "failed" : "queued", input.now),
      leaseOwner: undefined,
      leasedAt: undefined,
      leaseExpiresAt: undefined,
      lastError: input.reason,
      deadLetteredAt: maxed ? input.now : undefined
    };
    this.runtimeAgentJobs.set(input.jobId, updated);
    return updated;
  }

  async cancelRuntimeAgentJob(input: RuntimeAgentJobCancelInput): Promise<RuntimeAgentJobRecord> {
    const record = this.requiredRuntimeAgentJob(input.jobId);
    const updated = {
      ...record,
      job: testRuntimeAgentJobWithStatus(record.job, input.status, input.now),
      leaseOwner: undefined,
      leasedAt: undefined,
      leaseExpiresAt: undefined,
      lastError: input.reason,
      supersededByJobId: input.supersededByJobId ?? record.supersededByJobId
    };
    this.runtimeAgentJobs.set(input.jobId, updated);
    return updated;
  }

  async cancelStaleRuntimeAgentJobs(input: RuntimeAgentJobStaleCancellationInput): Promise<RuntimeAgentJobRecord[]> {
    const stale = [...this.runtimeAgentJobs.values()]
      .filter((record) => record.job.repository.storageRepositoryId === input.repository.storageRepositoryId
        && record.job.worktree.storageWorkspaceId === input.worktree.storageWorkspaceId
        && (record.job.status === "queued" || record.job.status === "running")
        && record.job.stalePolicy === "cancel-on-head-change"
        && (record.job.worktree.headSha !== input.headSha || record.job.worktree.worktreeDigest !== input.worktreeDigest))
      .sort(testRuntimeAgentJobSort);
    const cancelled: RuntimeAgentJobRecord[] = [];
    for (const record of stale) {
      cancelled.push(await this.cancelRuntimeAgentJob({
        jobId: record.job.jobId,
        status: "expired",
        now: input.now,
        reason: input.reason ?? "stale-head-or-worktree"
      }));
    }
    return cancelled;
  }

  async beginChangeSet(root: string, draft: ChangeSetDraft): Promise<string> {
    const id = `changeset_${this.changeSetJournals.size + 1}`;
    this.changeSetJournals.set(id, { root, draft, files: [], status: "pending" });
    return id;
  }

  async recordChangeSetFile(journalId: string, file: ChangeSetJournalFile): Promise<void> {
    const record = this.changeSetJournals.get(journalId);
    if (!record) throw new Error(`ChangeSet journal not found: ${journalId}`);
    record.files.push(file);
  }

  async recordChangeSetLedgerPlan(journalId: string, input: { event: ArchitectureEventV1 }): Promise<void> {
    const record = this.changeSetJournals.get(journalId);
    if (!record) throw new Error(`ChangeSet journal not found: ${journalId}`);
    record.ledger = { ...record.ledger, plannedEvent: input.event };
  }

  async recordChangeSetLedgerAppend(journalId: string, input: { result: ArchitectureLedgerAppendResult }): Promise<void> {
    const record = this.changeSetJournals.get(journalId);
    if (!record) throw new Error(`ChangeSet journal not found: ${journalId}`);
    record.ledger = { ...record.ledger, append: input.result };
  }

  async commitChangeSet(journalId: string): Promise<void> {
    const record = this.changeSetJournals.get(journalId);
    if (!record) throw new Error(`ChangeSet journal not found: ${journalId}`);
    record.status = "committed";
  }

  async abortChangeSet(journalId: string, reason: string): Promise<void> {
    const record = this.changeSetJournals.get(journalId);
    if (!record) throw new Error(`ChangeSet journal not found: ${journalId}`);
    record.status = "aborted";
    record.reason = reason;
  }

  recoverPendingChangeSets(): number {
    let recovered = 0;
    for (const record of this.changeSetJournals.values()) {
      if (record.status === "pending") {
        const plannedEvent = record.ledger?.plannedEvent;
        const ledgerEventExists = plannedEvent
          ? this.architectureEvents.some((event) =>
            event.repository.storageRepositoryId === plannedEvent.repository.storageRepositoryId
            && event.worktree.storageWorkspaceId === plannedEvent.worktree.storageWorkspaceId
            && event.idempotencyKey === plannedEvent.idempotencyKey)
          : false;
        record.status = ledgerEventExists ? "committed" : "recovered";
        recovered += 1;
      }
    }
    return recovered;
  }

  async saveTaskState(taskSessionId: string, state: unknown): Promise<void> {
    this.taskStates.set(taskSessionId, state);
  }

  async readTaskState(taskSessionId: string): Promise<unknown | undefined> {
    return this.taskStates.get(taskSessionId);
  }

  async saveReviewResult(reviewId: string, result: unknown): Promise<void> {
    this.reviews.set(reviewId, result);
  }

  async saveLandscape(landscape: Landscape): Promise<void> {
    this.landscapes.set(landscape.id, landscape);
  }

  async readLandscape(landscapeId: string): Promise<Landscape | undefined> {
    return this.landscapes.get(landscapeId);
  }

  async saveCrossRepoRelation(relation: CrossRepoRelation): Promise<void> {
    this.crossRepoEdges.set(relation.id, relation);
  }

  async listCrossRepoRelations(landscape?: Landscape): Promise<CrossRepoRelation[]> {
    const ids = new Set(landscape?.relations);
    return [...this.crossRepoEdges.values()]
      .filter((relation) => !landscape || ids.has(relation.id))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async saveExternalDocumentation(entry: ExternalDocumentationCacheEntry): Promise<void> {
    this.externalDocumentation.set(externalDocumentationKey(entry), entry);
  }

  async readExternalDocumentation(input: {
    provider: ExternalDocumentationProvider;
    libraryId: string;
    version: string;
    queryDigest: string;
  }): Promise<ExternalDocumentationCacheEntry | undefined> {
    return this.externalDocumentation.get(externalDocumentationKey(input));
  }

  async readExternalDocumentationByContentDigest(input: {
    provider: ExternalDocumentationProvider;
    contentDigest: string;
  }): Promise<ExternalDocumentationCacheEntry | undefined> {
    return [...this.externalDocumentation.values()]
      .filter((entry) => entry.provider === input.provider && entry.contentDigest === input.contentDigest)
      .sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt)
        || a.libraryId.localeCompare(b.libraryId)
        || a.version.localeCompare(b.version)
        || a.queryDigest.localeCompare(b.queryDigest))[0];
  }

  async listExternalDocumentation(provider?: ExternalDocumentationProvider): Promise<ExternalDocumentationCacheEntry[]> {
    return [...this.externalDocumentation.values()]
      .filter((entry) => !provider || entry.provider === provider)
      .sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt) || a.libraryId.localeCompare(b.libraryId));
  }

  async purgeExternalDocumentation(input: { provider?: ExternalDocumentationProvider; libraryId?: string; all?: boolean }): Promise<number> {
    let purged = 0;
    for (const [key, entry] of [...this.externalDocumentation.entries()]) {
      const matches = input.all
        || (input.provider && input.libraryId && entry.provider === input.provider && entry.libraryId === input.libraryId)
        || (input.provider && !input.libraryId && entry.provider === input.provider);
      if (matches) {
        this.externalDocumentation.delete(key);
        purged += 1;
      }
    }
    return purged;
  }

  async appendArchitectureEvents(input: ArchitectureLedgerAppendInput): Promise<ArchitectureLedgerAppendResult> {
    this.architectureEventAppends.push(input);
    const appendedEvents: ArchitectureEventV1[] = [];
    const duplicateEvents: ArchitectureEventV1[] = [];
    for (const event of input.events) {
      const duplicate = this.architectureEvents.find((candidate) => candidate.idempotencyKey === event.idempotencyKey);
      if (duplicate) {
        duplicateEvents.push(duplicate);
        continue;
      }
      const normalized = normalizeArchitectureLedgerEvent(event, this.latestEventHashForScope(event));
      this.architectureEvents.push(normalized);
      appendedEvents.push(normalized);
    }
    const scope = input.events[0] ? scopeFromEvent(input.events[0]) : undefined;
    const state = scope ? this.stateForScope(scope) : emptyArchitectureLedgerState();
    return {
      appendedEvents,
      duplicateEvents,
      graphDigest: architectureLedgerStateDigest(state),
      entityCount: state.entities.length,
      relationCount: state.relations.length,
      constraintCount: state.constraints.length
    };
  }

  async readArchitectureLedgerSourceCursor(input: ArchitectureLedgerScope & { cursorId: string }): Promise<Record<string, Json> | undefined> {
    return [...this.eventsForScope(input)].reverse()
      .flatMap((event) => architectureLedgerPayload(event).sourceCursors ?? [])
      .find((cursor) => cursor.cursorId === input.cursorId) as Record<string, Json> | undefined;
  }

  async createArchitectureLedgerSnapshot(): Promise<never> {
    throw new Error("TestLocalStore does not implement the SQLite architecture ledger");
  }

  async readArchitectureLedgerState(input: ArchitectureLedgerScope): Promise<ArchitectureLedgerGraphState> {
    return this.stateForScope(input);
  }

  async replayArchitectureLedger(input: ArchitectureLedgerReplayInput): Promise<ArchitectureLedgerReplayResult> {
    const events = this.eventsForScope(input);
    const state = replayArchitectureLedgerEvents(events);
    return { events, state, graphDigest: architectureLedgerStateDigest(state) };
  }

  async verifyArchitectureLedgerReplay(input: ArchitectureLedgerReplayInput): Promise<ArchitectureLedgerReplayVerification> {
    const materialized = await this.readArchitectureLedgerState(input);
    const replayed = await this.replayArchitectureLedger(input);
    const materializedDigest = architectureLedgerStateDigest(materialized);
    return {
      ok: materializedDigest === replayed.graphDigest,
      materializedDigest,
      replayedDigest: replayed.graphDigest,
      eventCount: replayed.events.length,
      mismatches: materializedDigest === replayed.graphDigest ? [] : ["materialized-current-state-does-not-match-replay"]
    };
  }

  async rebuildArchitectureLedgerCurrentState(input: ArchitectureLedgerScope): Promise<ArchitectureLedgerReplayResult> {
    return this.replayArchitectureLedger(input);
  }

  async compactArchitectureLedger(): Promise<never> {
    throw new Error("TestLocalStore does not implement the SQLite architecture ledger");
  }

  async checkArchitectureLedgerIntegrity(): Promise<never> {
    throw new Error("TestLocalStore does not implement the SQLite architecture ledger");
  }

  async backupArchitectureLedger(): Promise<never> {
    throw new Error("TestLocalStore does not implement the SQLite architecture ledger");
  }

  clearDerivedLandscapeState(): void {
    this.landscapes.clear();
    this.crossRepoEdges.clear();
  }

  async rebuildDerivedLandscapeState(input: LandscapeRebuildInput): Promise<LandscapeRebuildResult> {
    return rebuildDerivedLandscapeState(this, input);
  }

  close(): void {}

  private requiredRuntimeAgentJob(jobId: string): RuntimeAgentJobRecord {
    const record = this.runtimeAgentJobs.get(jobId);
    if (!record) throw new Error(`runtime-agent-job-not-found: ${jobId}`);
    return record;
  }

  private stateForScope(scope: ArchitectureLedgerScope): ArchitectureLedgerGraphState {
    return replayArchitectureLedgerEvents(this.eventsForScope(scope));
  }

  private eventsForScope(input: ArchitectureLedgerReplayInput): ArchitectureEventV1[] {
    const events = this.architectureEvents
      .filter((event) => event.repository.storageRepositoryId === input.repository.storageRepositoryId
        && event.worktree.storageWorkspaceId === input.worktree.storageWorkspaceId);
    if (!input.untilEventId) return events;
    const out: ArchitectureEventV1[] = [];
    for (const event of events) {
      out.push(event);
      if (event.eventId === input.untilEventId) break;
    }
    return out;
  }

  private latestEventHashForScope(scope: ArchitectureLedgerScope): string | null {
    return [...this.architectureEvents].reverse()
      .find((event) => event.repository.storageRepositoryId === scope.repository.storageRepositoryId
        && event.worktree.storageWorkspaceId === scope.worktree.storageWorkspaceId)
      ?.eventHash ?? null;
  }
}

function scopeFromEvent(event: ArchitectureEventV1): ArchitectureLedgerScope {
  return { repository: event.repository, worktree: event.worktree };
}

function externalDocumentationKey(input: {
  provider: ExternalDocumentationProvider;
  libraryId: string;
  version: string;
  queryDigest: string;
}): string {
  return [input.provider, input.libraryId, input.version, input.queryDigest].join("\0");
}

function testRuntimeAgentJobDefaultCoalesceKey(job: AgentJobV1, analysisKind: string): string {
  return [
    job.repository.storageRepositoryId,
    job.worktree.storageWorkspaceId,
    analysisKind,
    job.trigger.source,
    job.trigger.reason
  ].join("\0");
}

function testRuntimeAgentJobMatchesScope(record: RuntimeAgentJobRecord, job: AgentJobV1): boolean {
  return record.job.repository.storageRepositoryId === job.repository.storageRepositoryId
    && record.job.worktree.storageWorkspaceId === job.worktree.storageWorkspaceId;
}

function testRuntimeAgentJobSort(left: RuntimeAgentJobRecord, right: RuntimeAgentJobRecord): number {
  return left.job.queuedAt.localeCompare(right.job.queuedAt) || left.job.jobId.localeCompare(right.job.jobId);
}

function testRuntimeAgentJobWithStatus(job: AgentJobV1, status: RuntimeAgentJobStatus, updatedAt: string, outputDigest?: string): AgentJobV1 {
  const next: AgentJobV1 = { ...job, status, updatedAt };
  if (outputDigest) next.outputDigest = outputDigest;
  return next;
}
