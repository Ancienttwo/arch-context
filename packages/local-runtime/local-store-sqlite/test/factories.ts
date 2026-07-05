import type { CrossRepoRelation, Landscape } from "@archcontext/core/architecture-domain";
import type { ChangeSetDraft, ChangeSetJournalFile } from "@archcontext/core/changeset-engine";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  architectureLedgerPayload,
  architectureLedgerStateDigest,
  emptyArchitectureLedgerState,
  normalizeArchitectureLedgerEvent,
  queryArchitectureLedgerBookNeighbors,
  replayArchitectureLedgerEvents,
  type ArchitectureAuditRunV1,
  type ArchitectureLedgerAppendInput,
  type ArchitectureLedgerAppendResult,
  type ArchitectureBookFtsMatch,
  type ArchitectureLedgerGraphState,
  type ArchitectureLedgerReplayInput,
  type ArchitectureLedgerReplayResult,
  type ArchitectureLedgerReplayVerification,
  type ArchitectureLedgerScope
} from "@archcontext/core/architecture-ledger";
import type { AgentJobV1, ArchitectureEventV1, ExternalDocumentationCacheEntry, ExternalDocumentationProvider, Json, RepositorySnapshot } from "@archcontext/contracts";
import { LOCAL_SQLITE_MIGRATIONS, RUNTIME_AGENT_JOB_STATUSES, rebuildDerivedLandscapeState, type LandscapeRebuildInput, type LandscapeRebuildResult, type PersistedRepositorySession, type RuntimeAgentJobCancelInput, type RuntimeAgentJobClaimInput, type RuntimeAgentJobCompleteInput, type RuntimeAgentJobEnqueueInput, type RuntimeAgentJobEnqueueResult, type RuntimeAgentJobQueueStats, type RuntimeAgentJobRecord, type RuntimeAgentJobRetryInput, type RuntimeAgentJobStaleCancellationInput, type RuntimeAgentJobStatus, type RuntimeLocalStore } from "../src/index";

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
    const priority = testRuntimeAgentJobPriority(input.priority);
    const maxQueuedJobs = testOptionalPositiveInteger(input.maxQueuedJobs, "runtime-agent-job-max-queued-jobs-invalid");
    const duplicate = [...this.runtimeAgentJobs.values()]
      .filter((record) => testRuntimeAgentJobMatchesScope(record, input.job)
        && record.analysisKind === input.analysisKind
        && record.job.fingerprint === input.job.fingerprint
        && (record.job.status === "queued" || record.job.status === "running"))
      .sort(testRuntimeAgentJobSort)[0];
    if (duplicate) {
      return {
        record: duplicate,
        enqueued: false,
        deduplicated: true,
        supersededJobIds: [],
        evictedJobIds: [],
        ...(maxQueuedJobs === undefined ? {} : {
          backpressure: testRuntimeAgentJobBackpressure([...this.runtimeAgentJobs.values()], input.job, {
            accepted: true,
            priority: duplicate.priority,
            maxQueuedJobs,
            evictedJobIds: []
          })
        })
      };
    }

    const superseded = [...this.runtimeAgentJobs.values()]
      .filter((record) => testRuntimeAgentJobMatchesScope(record, input.job)
        && record.analysisKind === input.analysisKind
        && record.coalesceKey === coalesceKey
        && record.job.status === "queued")
      .sort(testRuntimeAgentJobSort);
    const queuedDepthBefore = [...this.runtimeAgentJobs.values()]
      .filter((record) => testRuntimeAgentJobMatchesScope(record, input.job) && record.job.status === "queued")
      .length;
    const reservedQueuedDepth = Math.max(0, queuedDepthBefore - superseded.length);
    const requiredEvictions = maxQueuedJobs === undefined ? 0 : Math.max(0, reservedQueuedDepth - maxQueuedJobs + 1);
    const evictable = requiredEvictions === 0 ? [] : [...this.runtimeAgentJobs.values()]
      .filter((record) => testRuntimeAgentJobMatchesScope(record, input.job)
        && record.job.status === "queued"
        && record.priority <= priority
        && !superseded.some((candidate) => candidate.job.jobId === record.job.jobId))
      .sort((left, right) => left.priority - right.priority || testRuntimeAgentJobSort(left, right))
      .slice(0, requiredEvictions);
    if (evictable.length < requiredEvictions) {
      return {
        enqueued: false,
        deduplicated: false,
        supersededJobIds: [],
        evictedJobIds: [],
        rejected: true,
        reasonCode: "backpressure-queue-cap",
        backpressure: testRuntimeAgentJobBackpressure([...this.runtimeAgentJobs.values()], input.job, {
          accepted: false,
          reasonCode: "backpressure-queue-cap",
          priority,
          maxQueuedJobs,
          evictedJobIds: []
        })
      };
    }
    for (const record of evictable) {
      this.runtimeAgentJobs.set(record.job.jobId, {
        ...record,
        job: testRuntimeAgentJobWithStatus(record.job, "expired", input.job.queuedAt),
        lastError: "backpressure-queue-cap"
      });
    }
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
      priority,
      attemptCount: 0,
      maxAttempts: Math.max(1, Math.trunc(input.maxAttempts ?? 3)),
      debounceUntil: input.debounceUntil
    };
    this.runtimeAgentJobs.set(input.job.jobId, record);
    return {
      record,
      enqueued: true,
      deduplicated: false,
      supersededJobIds: superseded.map((job) => job.job.jobId),
      evictedJobIds: evictable.map((job) => job.job.jobId),
      ...(maxQueuedJobs === undefined ? {} : {
        backpressure: testRuntimeAgentJobBackpressure([...this.runtimeAgentJobs.values()], input.job, {
          accepted: true,
          priority,
          maxQueuedJobs,
          evictedJobIds: evictable.map((job) => job.job.jobId)
        })
      })
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

  async queueStatsRuntimeAgentJobs(input: ArchitectureLedgerScope & { now?: string }): Promise<RuntimeAgentJobQueueStats> {
    return testRuntimeAgentJobQueueStats(
      await this.listRuntimeAgentJobs(input),
      input.now ?? "2026-06-25T00:00:00.000Z",
      input.repository.storageRepositoryId,
      input.worktree.storageWorkspaceId
    );
  }

  async claimRuntimeAgentJob(input: RuntimeAgentJobClaimInput): Promise<RuntimeAgentJobRecord | undefined> {
    const maxRunningJobs = testOptionalPositiveInteger(input.maxRunningJobs, "runtime-agent-job-max-running-jobs-invalid");
    if (maxRunningJobs !== undefined) {
      const runningDepth = [...this.runtimeAgentJobs.values()]
        .filter((candidate) => candidate.job.repository.storageRepositoryId === input.repository.storageRepositoryId
          && candidate.job.status === "running"
          && (!candidate.leaseExpiresAt || candidate.leaseExpiresAt > input.now))
        .length;
      if (runningDepth >= maxRunningJobs) return undefined;
    }
    const record = [...this.runtimeAgentJobs.values()]
      .filter((candidate) => candidate.job.repository.storageRepositoryId === input.repository.storageRepositoryId
        && candidate.job.worktree.storageWorkspaceId === input.worktree.storageWorkspaceId
        && (input.jobId === undefined || candidate.job.jobId === input.jobId)
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
    if (record.job.status !== "running") throw new Error(`runtime-agent-job-complete-requires-running: ${input.jobId}`);
    if (input.workerId && record.leaseOwner && record.leaseOwner !== input.workerId) {
      throw new Error(`runtime-agent-job-lease-owner-mismatch: ${input.jobId}`);
    }
    const updated = {
      ...record,
      job: testRuntimeAgentJobWithStatus(record.job, input.status, input.now, input.outputDigest, input.runMetadata),
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

  async listAuditRuns(input: ArchitectureLedgerScope & { statuses?: ArchitectureAuditRunV1["status"][] }): Promise<ArchitectureAuditRunV1[]> {
    const statuses = new Set(input.statuses);
    const latestById = new Map<string, ArchitectureAuditRunV1>();
    for (const run of this.eventsForScope(input).flatMap((event) => architectureLedgerPayload(event).auditRuns ?? [])) {
      if (!input.statuses || statuses.has(run.status)) latestById.set(run.runId, run);
    }
    return [...latestById.values()].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || left.runId.localeCompare(right.runId)
    );
  }

  async getAuditRun(input: ArchitectureLedgerScope & { runId: string }): Promise<ArchitectureAuditRunV1 | undefined> {
    return (await this.listAuditRuns(input)).find((run) => run.runId === input.runId);
  }

  async createArchitectureLedgerSnapshot(): Promise<never> {
    throw new Error("TestLocalStore does not implement the SQLite architecture ledger");
  }

  async readArchitectureLedgerState(input: ArchitectureLedgerScope): Promise<ArchitectureLedgerGraphState> {
    return this.stateForScope(input);
  }

  async readArchitectureLedgerNeighborhood(input: ArchitectureLedgerScope & { id: string; depth: number }): Promise<ArchitectureLedgerGraphState> {
    const state = await this.readArchitectureLedgerState(input);
    const neighbors = queryArchitectureLedgerBookNeighbors({ state, id: input.id, depth: input.depth, maxItems: 10_000, maxBytes: 1_000_000 });
    const entityIds = new Set(neighbors.nodes.map((node) => node.id));
    const relationIds = new Set(neighbors.relations.map((relation) => relation.id));
    const constraintIds = new Set(neighbors.constraints.map((constraint) => constraint.id));
    return {
      entities: state.entities.filter((entity) => entityIds.has(entity.entityId)),
      relations: state.relations.filter((relation) => relationIds.has(relation.relationId)),
      constraints: state.constraints.filter((constraint) => constraintIds.has(constraint.constraintId))
    };
  }

  async queryArchitectureLedgerFts(): Promise<ArchitectureBookFtsMatch[]> {
    return [];
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

  async checkArchitectureLedgerIntegrity(input: ArchitectureLedgerScope) {
    const replay = await this.verifyArchitectureLedgerReplay(input);
    return {
      ok: replay.ok,
      graphDigest: replay.materializedDigest,
      eventCount: replay.eventCount,
      snapshotCount: 0,
      failures: replay.mismatches
    };
  }

  async backupArchitectureLedger(input: { backupPath: string }): Promise<{ backupPath: string; integrity: string }> {
    mkdirSync(dirname(input.backupPath), { recursive: true });
    if (existsSync(input.backupPath)) rmSync(input.backupPath, { force: true });
    writeFileSync(input.backupPath, `${JSON.stringify({
      schemaVersion: "archcontext.test-local-store-backup/v1",
      eventCount: this.architectureEvents.length,
      graphDigest: architectureLedgerStateDigest(replayArchitectureLedgerEvents(this.architectureEvents))
    }, null, 2)}\n`, "utf8");
    return { backupPath: input.backupPath, integrity: "ok" };
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
  return right.priority - left.priority || left.job.queuedAt.localeCompare(right.job.queuedAt) || left.job.jobId.localeCompare(right.job.jobId);
}

function testRuntimeAgentJobPriority(priority: number | undefined): number {
  if (priority === undefined) return 0;
  if (!Number.isFinite(priority)) throw new Error("runtime-agent-job-priority-invalid");
  return Math.trunc(priority);
}

function testOptionalPositiveInteger(value: number | undefined, errorCode: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1) throw new Error(errorCode);
  return value;
}

function testRuntimeAgentJobBackpressure(records: RuntimeAgentJobRecord[], job: AgentJobV1, input: {
  accepted: boolean;
  reasonCode?: "backpressure-queue-cap";
  priority: number;
  maxQueuedJobs?: number;
  evictedJobIds: string[];
}) {
  const scoped = records.filter((record) => testRuntimeAgentJobMatchesScope(record, job));
  const queuedDepth = scoped.filter((record) => record.job.status === "queued").length;
  const runningDepth = scoped.filter((record) => record.job.status === "running").length;
  return {
    schemaVersion: "archcontext.runtime-agent-job-backpressure/v1",
    accepted: input.accepted,
    ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
    priority: input.priority,
    queuedDepthBefore: queuedDepth,
    queuedDepthAfter: queuedDepth,
    runningDepth,
    maxQueuedJobs: input.maxQueuedJobs,
    evictedJobIds: input.evictedJobIds
  } as const;
}

function testRuntimeAgentJobQueueStats(records: RuntimeAgentJobRecord[], now: string, storageRepositoryId: string, storageWorkspaceId: string): RuntimeAgentJobQueueStats {
  const countsByStatus = Object.fromEntries(RUNTIME_AGENT_JOB_STATUSES.map((status) => [status, 0])) as Record<RuntimeAgentJobStatus, number>;
  for (const record of records) countsByStatus[record.job.status] += 1;
  const queued = records.filter((record) => record.job.status === "queued");
  const oldestQueuedAt = queued.map((record) => record.job.queuedAt).sort((left, right) => left.localeCompare(right))[0];
  const coalescedJobCount = records.filter((record) =>
    record.job.status === "superseded"
    && record.lastError === "coalesced-by-newer-job"
    && record.supersededByJobId
  ).length;
  const lastFailure = records
    .filter((record) => record.lastError && record.job.status !== "superseded")
    .sort((left, right) => left.job.updatedAt.localeCompare(right.job.updatedAt) || left.job.jobId.localeCompare(right.job.jobId))
    .at(-1);
  return {
    schemaVersion: "archcontext.runtime-agent-job-queue-stats/v1",
    generatedAt: now,
    storageRepositoryId,
    storageWorkspaceId,
    countsByStatus,
    queuedDepth: countsByStatus.queued,
    runningDepth: countsByStatus.running,
    activeDepth: countsByStatus.queued + countsByStatus.running,
    terminalDepth: countsByStatus.succeeded + countsByStatus.failed + countsByStatus.cancelled + countsByStatus.superseded + countsByStatus.expired,
    totalJobCount: records.length,
    ...(oldestQueuedAt === undefined ? {} : { oldestQueuedAt, oldestQueuedAgeMs: Math.max(0, Date.parse(now) - Date.parse(oldestQueuedAt)) }),
    coalescedJobCount,
    coalescingRatio: records.length === 0 ? 0 : coalescedJobCount / records.length,
    ...(lastFailure?.lastError === undefined ? {} : { lastFailureReason: lastFailure.lastError, lastFailureJobId: lastFailure.job.jobId })
  };
}

function testRuntimeAgentJobWithStatus(
  job: AgentJobV1,
  status: RuntimeAgentJobStatus,
  updatedAt: string,
  outputDigest?: string,
  runMetadata?: Json
): AgentJobV1 {
  const next: AgentJobV1 = { ...job, status, updatedAt };
  if (outputDigest) next.outputDigest = outputDigest;
  if (runMetadata) {
    next.extensions = {
      ...(next.extensions ?? {}),
      agentRun: runMetadata
    };
  }
  return next;
}
