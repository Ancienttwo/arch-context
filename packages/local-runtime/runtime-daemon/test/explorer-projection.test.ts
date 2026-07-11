import { describe, expect, test } from "bun:test";
import type { ExplorerProjectionQueryV2, NormalizedCodeContext } from "@archcontext/contracts";
import type { ArchitectureLedgerGraphState } from "@archcontext/core/architecture-ledger";
import {
  ExplorerProjectionCompileError,
  compileExplorerProjection,
  compileExplorerProjectionDelta,
  compileSystemMapProjection,
  type CompileSystemMapProjectionInput
} from "../src/explorer-projection";

const query: ExplorerProjectionQueryV2 = {
  schemaVersion: "archcontext.explorer-projection-query/v2",
  viewId: "system-map",
  depth: 1,
  budget: { maxNodes: 80, maxRelations: 160 }
};

const repository = { repositoryId: "repo.local", storageRepositoryId: "repo.storage" };
const worktree = {
  workspaceId: "workspace.local",
  storageWorkspaceId: "workspace.storage",
  branch: "main",
  headSha: "a".repeat(40),
  worktreeDigest: `sha256:${"1".repeat(64)}`
};

function observed(overrides: Partial<NormalizedCodeContext> = {}): NormalizedCodeContext {
  return {
    task: "architecture explorer",
    symbols: [],
    edges: [],
    evidence: [],
    digest: `sha256:${"3".repeat(64)}`,
    ...overrides
  };
}

function compile(overrides: Partial<CompileSystemMapProjectionInput> = {}) {
  const graph: ArchitectureLedgerGraphState = {
    entities: [
      { entityId: "module.api", kind: "module", canonicalName: "API", status: "active" },
      { entityId: "module.db", kind: "module", canonicalName: "Database", status: "active" }
    ],
    relations: [
      { relationId: "relation.api-writes-db", kind: "writes", sourceEntityId: "module.api", targetEntityId: "module.db", status: "active" }
    ],
    constraints: []
  };
  return compileSystemMapProjection({
    query,
    repository,
    worktree,
    graph,
    graphDigest: `sha256:${"2".repeat(64)}`,
    observed: observed(),
    tokenRequired: true,
    ...overrides
  });
}

describe("compileSystemMapProjection", () => {
  test("is deterministic across reversed graph and observed input", () => {
    const symbols = [
      { id: "symbol.api", name: "Api", kind: "function", path: "src/api.ts" },
      { id: "symbol.db", name: "Db", kind: "function", path: "src/db.ts" }
    ];
    const edges = [{ source: "symbol.api", target: "symbol.db", kind: "calls" as const, confidence: "high" as const }];
    const first = compile({
      observed: observed({ symbols, edges }),
      bindings: [{ bindingId: "binding.api", targetEntityId: "module.api", observedSymbolId: "symbol.api", verified: false }]
    });
    const reversed = compile({
      graph: {
        entities: [...compile().occurrences]
          .filter((item) => item.provenance.declaredEntityIds.length > 0)
          .reverse()
          .map((item) => ({
            entityId: item.provenance.declaredEntityIds[0],
            kind: item.kind,
            canonicalName: item.name,
            status: "active" as const
          })),
        relations: [{ relationId: "relation.api-writes-db", kind: "writes", sourceEntityId: "module.api", targetEntityId: "module.db", status: "active" }],
        constraints: []
      },
      observed: observed({ symbols: [...symbols].reverse(), edges: [...edges].reverse() }),
      bindings: [{ bindingId: "binding.api", targetEntityId: "module.api", observedSymbolId: "symbol.api", verified: false }]
    });
    expect(reversed.projectionDigest).toBe(first.projectionDigest);
    expect(first.occurrences.find((item) => item.provenance.declaredEntityIds.includes("module.api"))?.verificationStatus).toBe("MATCHED");
  });

  test("keeps unbound observed symbols separate from declared entities", () => {
    const projection = compile({
      observed: observed({ symbols: [{ id: "symbol.api", name: "Api", kind: "function", path: "src/api.ts" }] })
    });
    expect(projection.occurrences).toHaveLength(3);
    const observedOccurrence = projection.occurrences.find((item) => item.provenance.observedSymbolIds.includes("symbol.api"));
    expect(observedOccurrence?.provenance.declaredEntityIds).toEqual([]);
    expect(observedOccurrence?.verificationStatus).toBe("UNKNOWN");
  });

  test("rejects a stale expected cursor", () => {
    expect(() => compile({
      query: {
        ...query,
        expectedCursor: {
          headSha: "b".repeat(40),
          worktreeDigest: worktree.worktreeDigest,
          graphDigest: `sha256:${"2".repeat(64)}`
        }
      }
    })).toThrow(ExplorerProjectionCompileError);
    try {
      compile({
        query: {
          ...query,
          expectedCursor: {
            headSha: "b".repeat(40),
            worktreeDigest: worktree.worktreeDigest,
            graphDigest: `sha256:${"2".repeat(64)}`
          }
        }
      });
    } catch (error) {
      expect((error as ExplorerProjectionCompileError).reason).toBe("precondition-failed");
    }
  });

  test("bounds a 10,000 entity graph before returning occurrences", () => {
    const graph: ArchitectureLedgerGraphState = {
      entities: Array.from({ length: 10_000 }, (_, index) => ({
        entityId: `module.${index.toString().padStart(5, "0")}`,
        kind: "module",
        canonicalName: `Module ${index}`,
        status: "active"
      })),
      relations: Array.from({ length: 9_999 }, (_, index) => ({
        relationId: `relation.${index.toString().padStart(5, "0")}`,
        kind: "calls",
        sourceEntityId: `module.${index.toString().padStart(5, "0")}`,
        targetEntityId: `module.${(index + 1).toString().padStart(5, "0")}`,
        status: "active"
      })),
      constraints: []
    };
    const projection = compile({ graph, query: { ...query, budget: { maxNodes: 25, maxRelations: 10 } } });
    expect(projection.occurrences).toHaveLength(25);
    expect(projection.relations.length).toBeLessThanOrEqual(10);
    expect(projection.page.totalNodes).toBe(10_000);
    expect(projection.page.truncated).toBe(true);
  });

  test("focus returns a bounded neighborhood instead of the full graph", () => {
    const projection = compile({ query: { ...query, focus: { subjectId: "module.api" }, depth: 1 } });
    expect(projection.occurrences.map((item) => item.provenance.declaredEntityIds[0])).toEqual(["module.api", "module.db"]);
    expect(projection.relations).toHaveLength(1);
  });

  test("overview emits derived groups and expands only the requested group", () => {
    const overview = compile({ query: { ...query, semanticLevel: "overview" } });
    expect(overview.occurrences.every((item) => item.role === "derived-group")).toBe(true);
    const group = overview.occurrences[0]!;
    expect(group.role).toBe("derived-group");
    expect(group.subjectRefs).toEqual([]);
    const expanded = compile({ query: { ...query, semanticLevel: "overview", expandedOccurrenceIds: [group.occurrenceId] } });
    expect(expanded.occurrences.some((item) => item.role === "subject" && item.parentOccurrenceId === group.occurrenceId)).toBe(true);
  });

  test("task-impact requires a current task session and exposes task backlinks", () => {
    const taskQuery: ExplorerProjectionQueryV2 = { ...query, viewId: "task-impact", taskSessionId: "task.current" };
    expect(() => compileExplorerProjection({
      query: taskQuery, repository, worktree,
      graph: { entities: [], relations: [], constraints: [] }, graphDigest: `sha256:${"2".repeat(64)}`,
      observed: observed(), tokenRequired: true
    })).toThrow(ExplorerProjectionCompileError);
    const projection = compileExplorerProjection({
      query: taskQuery,
      repository,
      worktree,
      graph: { entities: [{ entityId: "module.api", kind: "module", canonicalName: "API", status: "active" }], relations: [], constraints: [] },
      graphDigest: `sha256:${"2".repeat(64)}`,
      observed: observed({ symbols: [{ id: "symbol.api", name: "Api", kind: "function", path: "src/api.ts" }] }),
      bindings: [{ bindingId: "binding.api", targetEntityId: "module.api", observedSymbolId: "symbol.api", verified: true }],
      taskSession: { taskSessionId: "task.current", task: "change API", taskSessionDigest: `sha256:${"7".repeat(64)}` },
      tokenRequired: true
    });
    expect(projection.view.id).toBe("task-impact");
    expect(projection.occurrences[0]?.role === "subject" && projection.occurrences[0].backlinks.affectedByTaskSessionIds).toEqual(["task.current"]);
  });

  test("drift-pressure uses evaluated inputs and typed inspector backlinks", () => {
    const projection = compileExplorerProjection({
      query: { ...query, viewId: "drift-pressure" },
      repository,
      worktree,
      graph: {
        entities: [{ entityId: "module.api", kind: "module", canonicalName: "API", status: "active", summary: "Owns API" }],
        relations: [],
        constraints: [{ constraintId: "constraint.api", kind: "boundary", subjectId: "module.api", status: "active", severity: "error" }]
      },
      graphDigest: `sha256:${"2".repeat(64)}`,
      observed: observed(),
      pressure: { inputDigest: `sha256:${"8".repeat(64)}`, level: "medium", score: 40, signals: [{ type: "boundary-change", evidence: ["module.api"] }] },
      drift: { inputDigest: `sha256:${"9".repeat(64)}`, subjectIds: ["module.api"], reasonCodes: ["semantic-drift"] },
      eventBacklinks: [{ eventId: "event.api", subjectIds: ["module.api"], title: "API decision", rationale: "Keep one boundary" }],
      tokenRequired: true
    });
    const occurrence = projection.occurrences[0];
    expect(occurrence?.role).toBe("subject");
    if (occurrence?.role !== "subject") throw new Error("subject required");
    expect(occurrence.verificationStatus).toBe("DRIFT");
    expect(occurrence.pressure).toMatchObject({ evaluated: true, score: 25, signals: ["boundary-change"] });
    expect(occurrence.inspector.constraints[0]?.id).toBe("constraint.api");
    expect(occurrence.backlinks.decidedByEventIds).toEqual(["event.api"]);
  });

  test("delta separates fact, evidence, and projection-only changes", () => {
    const base = compile();
    const factHead = structuredClone(base);
    const first = factHead.occurrences.find((item) => item.role === "subject")!;
    if (first.role !== "subject") throw new Error("subject required");
    first.name = "API v2";
    first.verificationStatus = "DRIFT";
    first.parentOccurrenceId = "occurrence.system-map.group.kind.module";
    const delta = compileExplorerProjectionDelta(base, factHead);
    expect(delta.counts["architecture-fact"]).toBe(1);
    expect(delta.counts.evidence).toBe(1);
    expect(delta.counts.projection).toBe(1);
    expect(delta.changes.find((item) => item.deltaClass === "evidence")?.verificationTransition).toEqual({ from: "UNKNOWN", to: "DRIFT" });

    const projectionOnly = structuredClone(base);
    const projectionSubject = projectionOnly.occurrences.find((item) => item.role === "subject")!;
    projectionSubject.parentOccurrenceId = "occurrence.system-map.group.kind.module";
    const projectionDelta = compileExplorerProjectionDelta(base, projectionOnly);
    expect(projectionDelta.counts["architecture-fact"]).toBe(0);
    expect(projectionDelta.counts.evidence).toBe(0);
    expect(projectionDelta.counts.projection).toBe(1);
  });
});
