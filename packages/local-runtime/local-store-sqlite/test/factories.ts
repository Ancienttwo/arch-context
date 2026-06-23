import type { CrossRepoRelation, Landscape } from "@archcontext/core/architecture-domain";
import type { ChangeSetDraft, ChangeSetJournalFile } from "@archcontext/core/changeset-engine";
import type { ExternalDocumentationCacheEntry, ExternalDocumentationProvider, RepositorySnapshot } from "@archcontext/contracts";
import { LOCAL_SQLITE_MIGRATIONS, rebuildDerivedLandscapeState, type LandscapeRebuildInput, type LandscapeRebuildResult, type PersistedRepositorySession, type RuntimeLocalStore } from "../src/index";

export class TestLocalStore implements RuntimeLocalStore {
  readonly migrations = new Set<string>();
  readonly snapshots = new Map<string, { snapshot: RepositorySnapshot; state: "pending" | "committed" }>();
  readonly repositorySessions = new Map<string, PersistedRepositorySession>();
  readonly taskStates = new Map<string, unknown>();
  readonly reviews = new Map<string, unknown>();
  readonly landscapes = new Map<string, Landscape>();
  readonly crossRepoEdges = new Map<string, CrossRepoRelation>();
  readonly externalDocumentation = new Map<string, ExternalDocumentationCacheEntry>();
  readonly changeSetJournals = new Map<string, { root: string; draft: ChangeSetDraft; files: ChangeSetJournalFile[]; status: "pending" | "committed" | "aborted" | "recovered"; reason?: string }>();

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
        record.status = "recovered";
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

  clearDerivedLandscapeState(): void {
    this.landscapes.clear();
    this.crossRepoEdges.clear();
  }

  async rebuildDerivedLandscapeState(input: LandscapeRebuildInput): Promise<LandscapeRebuildResult> {
    return rebuildDerivedLandscapeState(this, input);
  }

  close(): void {}
}

function externalDocumentationKey(input: {
  provider: ExternalDocumentationProvider;
  libraryId: string;
  version: string;
  queryDigest: string;
}): string {
  return [input.provider, input.libraryId, input.version, input.queryDigest].join("\0");
}
