import { digestJson, type ArchitectureDebtReportV1, type ExternalDocumentationCacheEntry, type ExternalDocumentationProvider, type Json } from "@archcontext/contracts";
import type { CrossRepoRelation, Landscape } from "@archcontext/core/architecture-domain";
import type { ArchitectureDebtBaseCacheKey, PersistedRepositorySession, RuntimeLocalStore } from "../src/index";

/** In-memory test double for the Stage 3 discardable SQLite cache contract. */
export class TestLocalStore implements RuntimeLocalStore {
  private readonly debtBaseReports = new Map<string, ArchitectureDebtReportV1>();
  readonly cache = new Map<string, { value: unknown; updatedAt: string }>();
  readonly repositorySessions = new Map<string, PersistedRepositorySession>();
  readonly taskStates = new Map<string, unknown>();
  readonly reviews = new Map<string, unknown>();
  readonly landscapes = new Map<string, Landscape>();
  readonly crossRepoEdges = new Map<string, CrossRepoRelation>();
  readonly externalDocumentation = new Map<string, ExternalDocumentationCacheEntry>();

  constructor(private readonly clock: () => string = () => new Date().toISOString()) {}

  async migrate(): Promise<void> {}

  private cacheMapKey(namespace: string, cacheKey: string): string {
    return `${namespace}\0${cacheKey}`;
  }

  async readCacheEntry<T = unknown>(namespace: string, cacheKey: string): Promise<T | undefined> {
    const entry = this.cache.get(this.cacheMapKey(namespace, cacheKey));
    return entry === undefined ? undefined : structuredClone(entry.value) as T;
  }

  async writeCacheEntry(namespace: string, cacheKey: string, value: unknown): Promise<void> {
    this.cache.set(this.cacheMapKey(namespace, cacheKey), { value: structuredClone(value), updatedAt: this.clock() });
  }

  async deleteCacheEntry(namespace: string, cacheKey: string): Promise<void> {
    this.cache.delete(this.cacheMapKey(namespace, cacheKey));
  }

  async listCacheEntries<T = unknown>(namespace: string): Promise<Array<{ cacheKey: string; value: T; updatedAt: string }>> {
    const prefix = `${namespace}\0`;
    return [...this.cache.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => ({
        cacheKey: key.slice(prefix.length),
        value: structuredClone(entry.value) as T,
        updatedAt: entry.updatedAt
      }));
  }

  async readArchitectureDebtBase(key: ArchitectureDebtBaseCacheKey): Promise<ArchitectureDebtReportV1 | undefined> {
    return structuredClone(this.debtBaseReports.get(digestJson({ ...key } as unknown as Json)));
  }

  async saveArchitectureDebtBase(key: ArchitectureDebtBaseCacheKey, report: ArchitectureDebtReportV1): Promise<void> {
    this.debtBaseReports.set(digestJson({ ...key } as unknown as Json), structuredClone(report));
  }

  async saveTaskState(taskSessionId: string, state: unknown): Promise<void> {
    this.taskStates.set(taskSessionId, structuredClone(state));
  }

  async readTaskState(taskSessionId: string): Promise<unknown | undefined> {
    return structuredClone(this.taskStates.get(taskSessionId));
  }

  async saveReviewResult(reviewId: string, result: unknown): Promise<void> {
    this.reviews.set(reviewId, structuredClone(result));
  }

  async saveRepositorySession(session: PersistedRepositorySession): Promise<void> {
    this.repositorySessions.set(session.repositoryId, structuredClone(session));
  }

  async listRepositorySessions(): Promise<PersistedRepositorySession[]> {
    return [...this.repositorySessions.values()].sort((a, b) => a.repositoryId.localeCompare(b.repositoryId)).map((s) => structuredClone(s));
  }

  async commitRepositoryRemoval(repositoryId: string, landscape?: Landscape): Promise<boolean> {
    const existed = this.repositorySessions.delete(repositoryId);
    if (landscape) await this.saveLandscape(landscape);
    return existed;
  }

  async saveLandscape(landscape: Landscape): Promise<void> {
    this.landscapes.set(landscape.id, structuredClone(landscape));
  }

  async readLandscape(landscapeId: string): Promise<Landscape | undefined> {
    return structuredClone(this.landscapes.get(landscapeId));
  }

  async saveCrossRepoRelation(relation: CrossRepoRelation): Promise<void> {
    this.crossRepoEdges.set(relation.id, structuredClone(relation));
  }

  async listCrossRepoRelations(landscape?: Landscape): Promise<CrossRepoRelation[]> {
    const all = [...this.crossRepoEdges.values()].sort((a, b) => a.id.localeCompare(b.id));
    if (!landscape) return structuredClone(all);
    const allowed = new Set(landscape.relations);
    return structuredClone(all.filter((relation) => allowed.has(relation.id)));
  }

  async saveExternalDocumentation(entry: ExternalDocumentationCacheEntry): Promise<void> {
    const key = `${entry.provider}\0${entry.libraryId}\0${entry.version}\0${entry.queryDigest}`;
    this.externalDocumentation.set(key, structuredClone(entry));
  }

  async readExternalDocumentation(input: { provider: ExternalDocumentationProvider; libraryId: string; version: string; queryDigest: string }): Promise<ExternalDocumentationCacheEntry | undefined> {
    const key = `${input.provider}\0${input.libraryId}\0${input.version}\0${input.queryDigest}`;
    return structuredClone(this.externalDocumentation.get(key));
  }

  async readExternalDocumentationByContentDigest(input: { provider: ExternalDocumentationProvider; contentDigest: string }): Promise<ExternalDocumentationCacheEntry | undefined> {
    const matches = [...this.externalDocumentation.values()]
      .filter((entry) => entry.provider === input.provider && entry.contentDigest === input.contentDigest)
      .sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt) || a.libraryId.localeCompare(b.libraryId));
    return matches[0] ? structuredClone(matches[0]) : undefined;
  }

  async listExternalDocumentation(provider?: ExternalDocumentationProvider): Promise<ExternalDocumentationCacheEntry[]> {
    return [...this.externalDocumentation.values()]
      .filter((entry) => provider === undefined || entry.provider === provider)
      .sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt) || a.provider.localeCompare(b.provider) || a.libraryId.localeCompare(b.libraryId))
      .map((entry) => structuredClone(entry));
  }

  async purgeExternalDocumentation(input: { provider?: ExternalDocumentationProvider; libraryId?: string; all?: boolean }): Promise<number> {
    let removed = 0;
    for (const [key, entry] of this.externalDocumentation.entries()) {
      const match = Boolean(input.all)
        || (input.provider && input.libraryId && entry.provider === input.provider && entry.libraryId === input.libraryId)
        || (input.provider && !input.libraryId && entry.provider === input.provider);
      if (match) {
        this.externalDocumentation.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  close(): void {}
}
