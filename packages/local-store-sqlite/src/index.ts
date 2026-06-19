import type { CrossRepoRelation, Landscape } from "../../architecture-domain/src/index";
import type { LocalStorePort, RepositorySnapshot } from "../../contracts/src/index";

export const SQLITE_PRAGMAS = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA foreign_keys = ON",
  "PRAGMA busy_timeout = 5000"
] as const;

export const LOCAL_SQLITE_MIGRATIONS = [
  {
    id: "0001_runtime_state",
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS repository_sessions (
        repository_id TEXT PRIMARY KEY,
        root TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        worktree_digest TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        worktree_digest TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        committed_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS task_states (
        task_session_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS observed_evidence (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        selector_json TEXT NOT NULL,
        summary TEXT NOT NULL,
        confidence TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS review_results (
        review_id TEXT PRIMARY KEY,
        task_session_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`
    ]
  },
  {
    id: "0002_indexes",
    statements: [
      "CREATE INDEX IF NOT EXISTS idx_snapshots_repository ON snapshots(repository_id, head_sha)",
      "CREATE INDEX IF NOT EXISTS idx_evidence_repository ON observed_evidence(repository_id, head_sha)",
      "CREATE INDEX IF NOT EXISTS idx_reviews_task ON review_results(task_session_id)"
    ]
  },
  {
    id: "0003_landscape_state",
    statements: [
      `CREATE TABLE IF NOT EXISTS landscapes (
        id TEXT PRIMARY KEY,
        digest TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS cross_repo_edges (
        id TEXT PRIMARY KEY,
        landscape_id TEXT NOT NULL,
        from_repository_id TEXT NOT NULL,
        from_node_id TEXT NOT NULL,
        to_repository_id TEXT NOT NULL,
        to_node_id TEXT NOT NULL,
        via_kind TEXT NOT NULL,
        via_id TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS idx_cross_repo_edges_from ON cross_repo_edges(from_repository_id, from_node_id)",
      "CREATE INDEX IF NOT EXISTS idx_cross_repo_edges_to ON cross_repo_edges(to_repository_id, to_node_id)"
    ]
  }
] as const;

export function migrationSql(): string[] {
  return [...SQLITE_PRAGMAS, ...LOCAL_SQLITE_MIGRATIONS.flatMap((migration) => migration.statements)];
}

export function assertNoSourceStorageSchema(sql: string[]): void {
  const joined = sql.join("\n").toLowerCase();
  for (const forbidden of ["source_code", "source_body", "diff_body", "symbol_payload", "codegraph_db"]) {
    if (joined.includes(forbidden)) throw new Error(`SQLite schema contains forbidden storage column: ${forbidden}`);
  }
}

export class InMemoryLocalStore implements LocalStorePort {
  readonly migrations = new Set<string>();
  readonly snapshots = new Map<string, { snapshot: RepositorySnapshot; state: "pending" | "committed" }>();
  readonly taskStates = new Map<string, unknown>();
  readonly reviews = new Map<string, unknown>();
  readonly landscapes = new Map<string, Landscape>();
  readonly crossRepoEdges = new Map<string, CrossRepoRelation>();

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
}
