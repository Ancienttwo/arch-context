import type { CrossRepoRelation, Landscape } from "@archcontext/core/architecture-domain";
import type { ChangeSetDraft, ChangeSetJournalFile } from "@archcontext/core/changeset-engine";
import type { RepositorySnapshot } from "@archcontext/contracts";
import { LOCAL_SQLITE_MIGRATIONS, rebuildDerivedLandscapeState, type LandscapeRebuildInput, type LandscapeRebuildResult, type RuntimeLocalStore } from "../src/index";

export class TestLocalStore implements RuntimeLocalStore {
  readonly migrations = new Set<string>();
  readonly snapshots = new Map<string, { snapshot: RepositorySnapshot; state: "pending" | "committed" }>();
  readonly taskStates = new Map<string, unknown>();
  readonly reviews = new Map<string, unknown>();
  readonly landscapes = new Map<string, Landscape>();
  readonly crossRepoEdges = new Map<string, CrossRepoRelation>();
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

  clearDerivedLandscapeState(): void {
    this.landscapes.clear();
    this.crossRepoEdges.clear();
  }

  async rebuildDerivedLandscapeState(input: LandscapeRebuildInput): Promise<LandscapeRebuildResult> {
    return rebuildDerivedLandscapeState(this, input);
  }

  close(): void {}
}
