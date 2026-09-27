import {
  architectureLedgerBookSubjects,
  architectureLedgerProjectionDigest,
  diffArchitectureLedgerBookStates,
  projectArchitectureLedgerStateToYamlFiles,
  queryArchitectureLedgerBook,
  queryArchitectureLedgerBookEvidence,
  queryArchitectureLedgerBookNeighbors,
  queryArchitectureLedgerBookRecommendations,
  queryArchitectureLedgerBookTimeline,
  replayArchitectureLedgerEvents,
  showArchitectureLedgerBookSubject,
  type ArchitectureLedgerGraphState,
  type ArchitectureLedgerScope
} from "@archcontext/core/architecture-ledger";
import { errorEnvelope, okEnvelope, type ArchitectureEventV1, type Json, type JsonEnvelope } from "@archcontext/contracts";
import { type ArchitectureContextLedgerPort } from "@archcontext/core/context-compiler";
import { type RuntimeLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import type { RuntimeBookInput } from "./rpc-types";
export type { RuntimeBookInput } from "./rpc-types";

/**
 * Local structural subset of the daemon's architecture-ledger readback (`ArchctxDaemon`'s private
 * `architectureLedgerReadback`), which stays put on the daemon because `ledgerState`, `ledgerDrift`,
 * and `explorerProjectionDelta` all depend on it too. Only the fields Book itself reads are declared
 * here.
 */
interface ArchitectureBookLedgerReadback {
  repository: ArchitectureLedgerScope["repository"];
  worktree: ArchitectureLedgerScope["worktree"];
  readAuthority: string;
  state: ArchitectureLedgerGraphState;
  graphDigest: string;
  architectureLedger: unknown;
  drift: { ok: boolean; reasonCodes: string[] };
  reconcile: { ok: boolean };
}

interface ArchitectureBookContext {
  assertRunning(): void;
  clock(): string;
  architectureLedgerGitScope(root: string): Promise<ArchitectureLedgerScope>;
  architectureLedgerReadback(root: string): Promise<ArchitectureBookLedgerReadback>;
  localStore: Pick<RuntimeLocalStore, "replayArchitectureLedger" | "queryArchitectureLedgerFts" | "readArchitectureLedgerNeighborhood">;
}

export class ArchitectureBookService {
  constructor(private readonly context: ArchitectureBookContext) {}

  async book(root: string, input: RuntimeBookInput = {}): Promise<JsonEnvelope> {
    this.context.assertRunning();
    const command = input.command ?? "status";
    const readback = await this.context.architectureLedgerReadback(root);
    const scope = { repository: readback.repository, worktree: readback.worktree };
    const replayMode = ["query", "timeline", "diff", "evidence", "recommendations"].includes(command) ? "genesis" as const : "anchored" as const;
    const replay = await this.context.localStore.replayArchitectureLedger({ ...scope, mode: replayMode });
    const state = readback.state;
    const projectedFiles = projectArchitectureLedgerStateToYamlFiles(state);
    const freshness = {
      schemaVersion: "archcontext.book-freshness/v1",
      generatedAt: this.context.clock(),
      repository: readback.repository,
      worktree: readback.worktree,
      readAuthority: readback.readAuthority,
      headSha: readback.worktree.headSha,
      worktreeDigest: readback.worktree.worktreeDigest,
      graphDigest: readback.graphDigest,
      projectionDigest: architectureLedgerProjectionDigest(projectedFiles),
      ledgerCursor: {
        eventCount: replay.cursor.eventCount,
        lastEventId: replay.cursor.lastEventId,
        lastEventHash: replay.cursor.lastEventHash
      }
    };
    const provenance = {
      schemaVersion: "archcontext.book-provenance/v1",
      source: "architecture-ledger",
      producer: "runtime-daemon",
      readAuthority: freshness.readAuthority,
      repositoryId: readback.repository.repositoryId,
      storageRepositoryId: readback.repository.storageRepositoryId,
      workspaceId: readback.worktree.workspaceId,
      storageWorkspaceId: readback.worktree.storageWorkspaceId,
      branch: readback.worktree.branch,
      headSha: freshness.headSha,
      worktreeDigest: freshness.worktreeDigest,
      graphDigest: freshness.graphDigest,
      projectionDigest: freshness.projectionDigest,
      ledgerCursor: freshness.ledgerCursor,
      generatedAt: freshness.generatedAt
    };
    const budget = {
      maxItems: input.maxItems,
      maxBytes: input.maxBytes
    };
    if (command === "status") {
      return okEnvelope("book.status", {
        schemaVersion: "archcontext.book-status/v1",
        freshness,
        provenance,
        architectureLedger: readback.architectureLedger,
        counts: {
          entities: state.entities.length,
          relations: state.relations.length,
          constraints: state.constraints.length,
          events: replay.cursor.eventCount
        },
        drift: {
          ok: readback.drift.ok,
          reasonCodes: readback.drift.reasonCodes,
          reconcileRequired: !readback.reconcile.ok
        },
        commands: ["status", "query", "show", "neighbors", "timeline", "diff", "evidence", "recommendations", "export"]
      } as unknown as Json);
    }
    if (command === "query") {
      const query = input.task ?? input.query;
      const ftsMatches = query ? await this.context.localStore.queryArchitectureLedgerFts({
        ...scope,
        query,
        maxItems: input.maxItems
      }) : [];
      return okEnvelope("book.query", {
        ...queryArchitectureLedgerBook({ state, events: replay.events, query, ftsMatches, explain: input.explain, ...budget }),
        freshness,
        provenance
      } as unknown as Json);
    }
    if (command === "show") {
      if (!input.id) return errorEnvelope("book.show", "AC_SCHEMA_INVALID", "book show requires <entity-id> or --id");
      const result = showArchitectureLedgerBookSubject(state, input.id);
      if (!result.found) return errorEnvelope("book.show", "AC_SCHEMA_INVALID", `Book subject not found: ${input.id}`);
      return okEnvelope("book.show", { ...result, freshness, provenance } as unknown as Json);
    }
    if (command === "neighbors") {
      if (!input.id) return errorEnvelope("book.neighbors", "AC_SCHEMA_INVALID", "book neighbors requires <entity-id> or --id");
      const depth = input.depth ?? 1;
      const neighborhoodState = await this.context.localStore.readArchitectureLedgerNeighborhood({ ...scope, id: input.id, depth });
      return okEnvelope("book.neighbors", {
        ...queryArchitectureLedgerBookNeighbors({ state: neighborhoodState, id: input.id, depth, ...budget }),
        freshness,
        provenance
      } as unknown as Json);
    }
    if (command === "timeline") {
      const sinceRef = input.sinceRef ? await architectureBookResolveTimelineSinceRef(this.context.localStore, scope, replay.events, input.sinceRef) : undefined;
      if (input.sinceRef && !sinceRef) return errorEnvelope("book.timeline", "AC_SCHEMA_INVALID", `Book timeline --since ref not found: ${input.sinceRef}`);
      return okEnvelope("book.timeline", {
        ...queryArchitectureLedgerBookTimeline({
          events: replay.events,
          ...(input.id ? { subjectId: input.id } : {}),
          ...(sinceRef ? { sinceEventId: sinceRef.sinceEventId } : {}),
          ...budget
        }),
        freshness,
        provenance
      } as unknown as Json);
    }
    if (command === "diff") {
      const fromRef = input.fromRef ?? "empty";
      const toRef = input.toRef ?? "current";
      const fromResolved = await architectureBookResolveRef(this.context.localStore, scope, replay.events, fromRef);
      const toResolved = await architectureBookResolveRef(this.context.localStore, scope, replay.events, toRef);
      if (!fromResolved) return errorEnvelope("book.diff", "AC_SCHEMA_INVALID", `Book diff --from ref not found: ${fromRef}`);
      if (!toResolved) return errorEnvelope("book.diff", "AC_SCHEMA_INVALID", `Book diff --to ref not found: ${toRef}`);
      return okEnvelope("book.diff", {
        ...diffArchitectureLedgerBookStates({
          previousState: fromResolved.state,
          nextState: toResolved.state,
          fromRef,
          toRef,
          events: toResolved.events,
          ...budget
        }),
        freshness,
        provenance
      } as unknown as Json);
    }
    if (command === "evidence") {
      if (!input.id) return errorEnvelope("book.evidence", "AC_SCHEMA_INVALID", "book evidence requires <finding-or-entity-id> or --id");
      return okEnvelope("book.evidence", {
        ...queryArchitectureLedgerBookEvidence({ events: replay.events, id: input.id, ...budget }),
        freshness,
        provenance
      } as unknown as Json);
    }
    if (command === "recommendations") {
      // Lifecycle readback describes the current checkout; provenance retains the ledger scope.
      const gitScope = await this.context.architectureLedgerGitScope(root);
      return okEnvelope("book.recommendations", {
        ...queryArchitectureLedgerBookRecommendations({ events: replay.events, openOnly: input.openOnly, explain: input.explain, ...budget }),
        freshness: {
          ...freshness,
          repository: gitScope.repository,
          worktree: gitScope.worktree,
          headSha: gitScope.worktree.headSha,
          worktreeDigest: gitScope.worktree.worktreeDigest
        },
        provenance
      } as unknown as Json);
    }
    if (command === "export") {
      const format = input.format ?? "json";
      if (!["json", "yaml", "markdown"].includes(format)) return errorEnvelope("book.export", "AC_SCHEMA_INVALID", "book export --format must be json, yaml, or markdown");
      return okEnvelope("book.export", {
        schemaVersion: "archcontext.book-export/v1",
        format,
        freshness,
        provenance,
        ...(format === "json" ? { state } : {}),
        ...(format === "yaml" ? { projectedFiles } : {}),
        ...(format === "markdown" ? { markdown: architectureBookMarkdown(state) } : {})
      } as unknown as Json);
    }
    return errorEnvelope("book", "AC_SCHEMA_INVALID", "book requires status|query|show|neighbors|timeline|diff|evidence|recommendations|export");
  }

  contextPort(root: string): ArchitectureContextLedgerPort {
    return {
      queryForTask: async ({ task, maxItems, maxBytes }) => {
        const readback = await this.context.architectureLedgerReadback(root);
        const scope = { repository: readback.repository, worktree: readback.worktree };
        const replay = await this.context.localStore.replayArchitectureLedger({ ...scope, mode: "genesis" });
        const ftsMatches = await this.context.localStore.queryArchitectureLedgerFts({
          ...scope,
          query: task,
          maxItems
        });
        const result = queryArchitectureLedgerBook({
          state: readback.state,
          events: replay.events,
          query: task,
          ftsMatches,
          maxItems,
          maxBytes
        });
        const projectedFiles = projectArchitectureLedgerStateToYamlFiles(readback.state);
        const freshness = {
          schemaVersion: "archcontext.book-freshness/v1",
          generatedAt: this.context.clock(),
          repository: readback.repository,
          worktree: readback.worktree,
          readAuthority: readback.readAuthority,
          headSha: readback.worktree.headSha,
          worktreeDigest: readback.worktree.worktreeDigest,
          graphDigest: readback.graphDigest,
          projectionDigest: architectureLedgerProjectionDigest(projectedFiles),
          ledgerCursor: {
            eventCount: replay.cursor.eventCount,
            lastEventId: replay.cursor.lastEventId,
            lastEventHash: replay.cursor.lastEventHash
          }
        };
        return {
          schemaVersion: "archcontext.context-ledger-readback/v1",
          query: result.query,
          graphDigest: result.graphDigest,
          subjects: result.results,
          budget: result.budget,
          freshness: freshness as unknown as Json,
          resource: {
            type: "architecture-book",
            uri: `archcontext://book/query/${result.graphDigest}`,
            digest: result.graphDigest
          }
        };
      }
    };
  }
}

interface ArchitectureBookResolvedRef {
  events: ArchitectureEventV1[];
  state: ArchitectureLedgerGraphState;
  lastEventId?: string;
}

async function architectureBookResolveRef(
  store: Pick<RuntimeLocalStore, "replayArchitectureLedger">,
  scope: ArchitectureLedgerScope,
  events: ArchitectureEventV1[],
  ref: string
): Promise<ArchitectureBookResolvedRef | undefined> {
  const trimmed = ref.trim();
  if (trimmed === "empty" || trimmed === "zero") {
    return { events: [], state: replayArchitectureLedgerEvents([]) };
  }
  if (trimmed === "current" || trimmed === "head") {
    return { events, state: replayArchitectureLedgerEvents(events), lastEventId: events.at(-1)?.eventId };
  }
  const snapshotId = trimmed.startsWith("snapshot:") ? trimmed.slice("snapshot:".length) : undefined;
  if (snapshotId) {
    try {
      const replay = await store.replayArchitectureLedger({ ...scope, snapshotId, mode: "genesis" });
      return { events: replay.events, state: replay.state, lastEventId: replay.cursor.lastEventId };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("architecture-ledger-snapshot-not-found:")) return undefined;
      throw error;
    }
  }
  const eventId = trimmed.startsWith("event:") ? trimmed.slice("event:".length) : trimmed;
  const eventIndex = events.findIndex((event) => event.eventId === eventId);
  if (eventIndex >= 0) {
    const selected = events.slice(0, eventIndex + 1);
    return { events: selected, state: replayArchitectureLedgerEvents(selected), lastEventId: selected.at(-1)?.eventId };
  }
  const commitRef = trimmed.startsWith("commit:") ? trimmed.slice("commit:".length) : trimmed.startsWith("sha:") ? trimmed.slice("sha:".length) : undefined;
  const commitIndex = architectureBookLastIndex(events, (event) => commitRef ? event.headSha === commitRef || event.headSha.startsWith(commitRef) : event.headSha === trimmed);
  if (commitIndex >= 0) {
    const selected = events.slice(0, commitIndex + 1);
    return { events: selected, state: replayArchitectureLedgerEvents(selected), lastEventId: selected.at(-1)?.eventId };
  }
  const timestamp = architectureBookTimestampRef(trimmed);
  if (timestamp !== undefined) {
    const timestampIndex = architectureBookLastIndex(events, (event) => Date.parse(event.timestamp) <= timestamp);
    if (timestampIndex < 0) return { events: [], state: replayArchitectureLedgerEvents([]) };
    const selected = events.slice(0, timestampIndex + 1);
    return { events: selected, state: replayArchitectureLedgerEvents(selected), lastEventId: selected.at(-1)?.eventId };
  }
  return undefined;
}

async function architectureBookResolveTimelineSinceRef(
  store: Pick<RuntimeLocalStore, "replayArchitectureLedger">,
  scope: ArchitectureLedgerScope,
  events: ArchitectureEventV1[],
  ref: string
): Promise<{ sinceEventId?: string } | undefined> {
  const resolved = await architectureBookResolveRef(store, scope, events, ref);
  if (!resolved) return undefined;
  return { sinceEventId: resolved.lastEventId };
}

function architectureBookLastIndex(events: ArchitectureEventV1[], predicate: (event: ArchitectureEventV1) => boolean): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return index;
  }
  return -1;
}

function architectureBookTimestampRef(ref: string): number | undefined {
  const value = ref.startsWith("timestamp:") ? ref.slice("timestamp:".length) : ref.startsWith("time:") ? ref.slice("time:".length) : ref;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function architectureBookMarkdown(state: ArchitectureLedgerGraphState): string {
  const subjects = architectureLedgerBookSubjects(state);
  const lines = [
    "# Architecture Book",
    "",
    "## Entities",
    ...subjects
      .filter((subject) => subject.kind === "entity")
      .map((subject) => `- ${subject.id} (${subject.status}): ${subject.summary ?? subject.label}`),
    "",
    "## Relations",
    ...subjects
      .filter((subject) => subject.kind === "relation")
      .map((subject) => `- ${subject.id} (${subject.status}): ${subject.relation?.sourceEntityId} -> ${subject.relation?.targetEntityId}`),
    "",
    "## Constraints",
    ...subjects
      .filter((subject) => subject.kind === "constraint")
      .map((subject) => `- ${subject.id} (${subject.status}): ${subject.summary ?? subject.constraint?.subjectId ?? subject.label}`)
  ];
  return `${lines.join("\n")}\n`;
}
