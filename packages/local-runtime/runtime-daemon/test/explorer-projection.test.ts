import { describe, expect, test } from "bun:test";
import { EXPLORER_VIEW_INPUT_REQUIREMENTS, PROJECTION_READ_PLANNER_VERSION, digestJson, type ExplorerProjectionQueryV2, type Json, type NormalizedCodeContext } from "@archcontext/contracts";
import { architectureLedgerStateDigest, type ArchitectureLedgerGraphState } from "@archcontext/core/architecture-ledger";
import {
  ExplorerProjectionCompileError,
  EXPLORER_VIEW_COMPILER_VERSION,
  compileExplorerProjection,
  compileExplorerProjectionChanges,
  compileSystemMapProjection,
  explorerViewDefinitionDigest,
  planProjectionRead,
  projectionReadSetFromGraph,
  selectProjectionGraphFromAuthority,
  type CompileExplorerProjectionInput,
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
  const inputGraph = overrides.graph ?? graph;
  return compileSystemMapProjection(withReadPlan({
    query,
    repository,
    worktree,
    authoritySource: "git",
    authorityCursor: null,
    graph: inputGraph,
    graphDigest: architectureLedgerStateDigest(inputGraph),
    evidenceStateDigest: `sha256:${"4".repeat(64)}`,
    observed: observed(),
    bindings: [],
    tokenRequired: true,
    ...overrides
  } as CompileExplorerProjectionInput));
}

function withReadPlan(input: Omit<CompileExplorerProjectionInput, "readPlan" | "readSet" | "evidenceAuthorityCursor"> & Partial<Pick<CompileExplorerProjectionInput, "readPlan" | "readSet" | "evidenceAuthorityCursor">>): CompileExplorerProjectionInput {
  const readPlan = input.readPlan ?? planProjectionRead(input.query, input.authoritySource === "ledger" ? "verified-ledger-current" : "git-authority");
  const authorityGraph = input.graph;
  const selectedGraph = input.readSet ? input.graph : selectProjectionGraphFromAuthority(readPlan, authorityGraph);
  const readSet = input.readSet ?? projectionReadSetFromGraph(readPlan, selectedGraph, {
    entities: readPlan.kind === "focused-neighborhood" ? selectedGraph.entities.length : authorityGraph.entities.filter((item) => item.status !== "removed").length,
    relations: readPlan.kind === "focused-neighborhood" ? selectedGraph.relations.length : authorityGraph.relations.filter((item) => item.status !== "removed").length,
    constraints: readPlan.kind === "focused-neighborhood" ? selectedGraph.constraints.length : authorityGraph.constraints.filter((item) => item.status !== "removed").length
  }, {}, [...authorityGraph.entities.filter((item) => item.status !== "removed").reduce((counts, entity) => counts.set(entity.kind, (counts.get(entity.kind) ?? 0) + 1), new Map<string, number>()).entries()].map(([kind, count]) => ({ kind, count })));
  return { ...input, evidenceAuthorityCursor: input.evidenceAuthorityCursor ?? input.authorityCursor, graph: selectedGraph, readPlan, readSet };
}

describe("compileSystemMapProjection", () => {
  test("read planner deterministically selects overview context and focused bounded policies", () => {
    const overviewQuery: ExplorerProjectionQueryV2 = { ...query, semanticLevel: "overview" };
    const contextQuery: ExplorerProjectionQueryV2 = { ...query, semanticLevel: "context" };
    const focusedQuery: ExplorerProjectionQueryV2 = { ...query, semanticLevel: "detail", focus: { subjectId: "module.api" } };
    const overview = planProjectionRead(overviewQuery, "git-authority");
    const context = planProjectionRead(contextQuery, "git-authority");
    const focused = planProjectionRead(focusedQuery, "verified-ledger-current");

    expect(planProjectionRead(overviewQuery, "git-authority")).toEqual(overview);
    expect(overview.kind).toBe("overview-aggregate");
    expect(context.kind).toBe("bounded-context");
    expect(focused).toMatchObject({ kind: "focused-neighborhood", focusSubjectId: "module.api", source: "verified-ledger-current" });
    expect(focused.limits.maxGraphRows).toBe(focused.limits.maxEntities + focused.limits.maxRelations + focused.limits.maxConstraints);
    expect(focused.planDigest).not.toBe(planProjectionRead(focusedQuery, "git-authority").planDigest);
  });

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
    expect(observedOccurrence?.role === "subject" ? observedOccurrence.inspector.historyEvents : undefined).toEqual([]);
  });

  test("input manifest covers every current compiler input domain deterministically", () => {
    const base = compile();
    const repeated = compile();
    const withBinding = compile({
      observed: observed({ symbols: [{ id: "symbol.api", name: "Api", kind: "function", path: "src/api.ts" }] }),
      bindings: [{ bindingId: "binding.api", targetEntityId: "module.api", observedSymbolId: "symbol.api", verified: true }]
    });
    expect(repeated.inputManifest).toEqual(base.inputManifest);
    expect(base.cursor.inputManifestDigest).toBe(base.inputManifest.manifestDigest);
    expect(withBinding.inputManifest.bindingsDigest).not.toBe(base.inputManifest.bindingsDigest);
    expect(withBinding.inputManifest.manifestDigest).not.toBe(base.inputManifest.manifestDigest);
    expect(withBinding.inputManifest.compatibilityDigest).toBe(base.inputManifest.compatibilityDigest);
    expect(base.inputManifest.inputDomains).toMatchObject({
      graph: { requirement: "required", status: "ready" },
      observed: { requirement: "required", status: "ready" },
      bindings: { requirement: "required", status: "ready" },
      "event-backlinks": { requirement: "optional", status: "unavailable", reasonCode: "not-provided" },
      "task-session": { requirement: "optional", status: "unavailable", digest: null }
    });
  });

  test("fails closed on required missing unavailable and mismatched domains", () => {
    expect(() => compile({ bindings: undefined })).toThrow("required-input-unavailable:bindings:not-provided");
    expect(() => compile({ observedAvailability: { status: "unavailable", reasonCode: "codegraph-index-missing" } }))
      .toThrow("required-input-unavailable:observed:codegraph-index-missing");
    const invalidReadSet = structuredClone(compile().inputManifest.readSet);
    invalidReadSet.selectedGraphDigest = `sha256:${"0".repeat(64)}`;
    const { readSetDigest: _ignored, ...invalidReadSetWithoutDigest } = invalidReadSet;
    invalidReadSet.readSetDigest = digestJson(invalidReadSetWithoutDigest as unknown as Json);
    expect(() => compile({ readSet: invalidReadSet })).toThrow("projection-read-plan-mismatch");
    const canonicalPlan = planProjectionRead(query, "git-authority");
    const { planDigest: _canonicalDigest, ...noncanonicalBody } = {
      ...canonicalPlan,
      limits: { ...canonicalPlan.limits, maxEntities: 1_000_000, maxGraphRows: 1_000_000 + canonicalPlan.limits.maxRelations + canonicalPlan.limits.maxConstraints }
    };
    const noncanonicalPlan = { ...noncanonicalBody, planDigest: digestJson(noncanonicalBody as unknown as Json) };
    expect(() => compile({ readPlan: noncanonicalPlan })).toThrow("projection-read-plan-mismatch");
    expect(() => compile({ authoritySource: "ledger", authorityCursor: null }))
      .toThrow("required-input-unavailable:authority:ledger-cursor-not-provided");
    expect(() => compile({
      authoritySource: "ledger",
      authorityCursor: {
        schemaVersion: "archcontext.authority-cursor/v1",
        repository,
        worktree: { ...worktree, headSha: "b".repeat(40) },
        eventSequence: 1,
        eventId: "event.one",
        eventHash: `sha256:${"5".repeat(64)}`,
        graphDigest: architectureLedgerStateDigest({
          entities: [
            { entityId: "module.api", kind: "module", canonicalName: "API", status: "active" },
            { entityId: "module.db", kind: "module", canonicalName: "Database", status: "active" }
          ],
          relations: [
            { relationId: "relation.api-writes-db", kind: "writes", sourceEntityId: "module.api", targetEntityId: "module.db", status: "active" }
          ],
          constraints: []
        }),
        evidenceStateDigest: `sha256:${"4".repeat(64)}`
      }
    })).toThrow("required-input-digest-mismatch:authority");
  });

  test("binds view-definition identity to the typed domain policy", () => {
    const current = explorerViewDefinitionDigest("system-map");
    const changed = explorerViewDefinitionDigest("system-map", {
      authority: "required",
      graph: "required",
      evidence: "required",
      observed: "required",
      bindings: "required",
      "event-backlinks": "required",
      drift: "optional",
      pressure: "optional",
      "task-session": "optional"
    });
    expect(changed).not.toBe(current);
  });

  test("distinguishes an unavailable optional domain from a known-empty domain", () => {
    const unavailable = compile();
    const knownEmpty = compile({ eventBacklinks: [] });
    expect(unavailable.inputManifest.inputDomains["event-backlinks"]).toMatchObject({ status: "unavailable", digest: null });
    expect(knownEmpty.inputManifest.inputDomains["event-backlinks"]).toMatchObject({ status: "ready" });
    expect(knownEmpty.inputManifest.manifestDigest).not.toBe(unavailable.inputManifest.manifestDigest);
    expect(knownEmpty.inputManifest.compatibilityDigest).toBe(unavailable.inputManifest.compatibilityDigest);
  });

  test("compiles complete canonical history while keeping decisions as a strict subset", () => {
    const eventBacklinks = [
      { eventId: "event.b", subjectIds: ["module.api"], title: "Choose API boundary", rationale: "Keep transport local" },
      { eventId: "event.a", subjectIds: ["module.api", "module.api"] },
      { eventId: "event.b", subjectIds: ["module.db", "module.api"], title: "Choose API boundary", rationale: "Keep transport local" },
      { eventId: "event.cross-scope", subjectIds: ["module.not-selected"], title: "Outside selected graph" }
    ];
    const projection = compile({ eventBacklinks });
    const api = projection.occurrences.find((item) => item.role === "subject" && item.subjectRefs.some((ref) => ref.id === "module.api"));
    const database = projection.occurrences.find((item) => item.role === "subject" && item.subjectRefs.some((ref) => ref.id === "module.db"));
    if (!api || api.role !== "subject" || !database || database.role !== "subject") throw new Error("expected subject occurrences");
    expect(api.inspector.historyEvents).toEqual([
      { eventId: "event.a" },
      { eventId: "event.b", title: "Choose API boundary", rationale: "Keep transport local" }
    ]);
    expect(api.inspector.decisions).toEqual([
      { eventId: "event.b", title: "Choose API boundary", rationale: "Keep transport local" }
    ]);
    expect(api.backlinks.changedByEventIds).toEqual(["event.a", "event.b"]);
    expect(api.backlinks.decidedByEventIds).toEqual(["event.b"]);
    expect(database.inspector.historyEvents).toEqual([
      { eventId: "event.b", title: "Choose API boundary", rationale: "Keep transport local" }
    ]);
    expect(projection.occurrences.every((item) => item.role !== "subject" || item.inspector.historyEvents.every((event) => event.eventId !== "event.cross-scope"))).toBe(true);

    const reversed = compile({ eventBacklinks: [...eventBacklinks].reverse() });
    expect(reversed.projectionDigest).toBe(projection.projectionDigest);
    expect(reversed.inputManifest.eventBacklinksDigest).toBe(projection.inputManifest.eventBacklinksDigest);

    const withoutHistory = compile({ eventBacklinks: [] });
    expect(compileExplorerProjectionChanges(withoutHistory, projection)).toContainEqual({
      deltaClass: "projection",
      subjectId: "architecture-entity:module.api",
      change: "changed",
      fields: ["evidence"]
    });
  });

  test("fails closed on conflicting duplicate event backlink metadata", () => {
    expect(() => compile({
      eventBacklinks: [
        { eventId: "event.conflict", subjectIds: ["module.api"], title: "First" },
        { eventId: "event.conflict", subjectIds: ["module.api"], title: "Second" }
      ]
    })).toThrow("conflicting-event-backlink:event.conflict");
  });

  test("changes every view-definition digest for the required history contract", () => {
    const preHistoryDigest = digestJson({
      id: "system-map",
      title: "System Map",
      question: "What accepted architecture entities exist and how do they relate?",
      requirements: EXPLORER_VIEW_INPUT_REQUIREMENTS["system-map"],
      compilerVersion: EXPLORER_VIEW_COMPILER_VERSION,
      plannerVersion: PROJECTION_READ_PLANNER_VERSION,
      grouping: "kind-at-overview",
      authority: "daemon-selected-read-model",
      reconciliation: "accepted-evidence-binding-only"
    } as unknown as Json);
    expect(explorerViewDefinitionDigest("system-map")).not.toBe(preHistoryDigest);
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
    const focusQuery = { ...query, focus: { subjectId: "module.api" }, depth: 1 as const };
    const projection = compile({ query: focusQuery });
    expect(projection.occurrences.map((item) => item.provenance.declaredEntityIds[0])).toEqual(["module.api", "module.db"]);
    expect(projection.relations).toHaveLength(1);
    expect(projection.breadcrumbs).toEqual([
      { occurrenceId: "occurrence.system-map.root", label: "System Map" },
      { occurrenceId: "occurrence.system-map.entity.module.api", label: "API" }
    ]);
    const selectedGraph: ArchitectureLedgerGraphState = {
      entities: [
        { entityId: "module.api", kind: "module", canonicalName: "API", status: "active" },
        { entityId: "module.db", kind: "module", canonicalName: "Database", status: "active" }
      ],
      relations: [{ relationId: "relation.api-writes-db", kind: "writes", sourceEntityId: "module.api", targetEntityId: "module.db", status: "active" }],
      constraints: []
    };
    const readPlan = planProjectionRead(focusQuery, "git-authority");
    const readSet = projectionReadSetFromGraph(readPlan, selectedGraph, { entities: 3, relations: 1, constraints: 0 });
    const truncated = compile({ query: focusQuery, graph: selectedGraph, readPlan, readSet });
    expect(truncated.page).toMatchObject({ totalNodes: 3, returnedNodes: 2, omittedNodeCount: 1, truncated: true });
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
    expect(() => compileExplorerProjection(withReadPlan({
      query: taskQuery, repository, worktree,
      authoritySource: "git",
      authorityCursor: null,
      graph: { entities: [], relations: [], constraints: [] }, graphDigest: `sha256:${"2".repeat(64)}`,
      observed: observed(), evidenceStateDigest: `sha256:${"4".repeat(64)}`, tokenRequired: true
    }))).toThrow(ExplorerProjectionCompileError);
    const taskGraph: ArchitectureLedgerGraphState = {
      entities: [{ entityId: "module.api", kind: "module", canonicalName: "API", status: "active" }], relations: [], constraints: []
    };
    const projection = compileExplorerProjection(withReadPlan({
      query: taskQuery,
      repository,
      worktree,
      authoritySource: "git",
      authorityCursor: null,
      graph: taskGraph,
      graphDigest: architectureLedgerStateDigest(taskGraph),
      evidenceStateDigest: `sha256:${"4".repeat(64)}`,
      observed: observed({ symbols: [{ id: "symbol.api", name: "Api", kind: "function", path: "src/api.ts" }] }),
      bindings: [{ bindingId: "binding.api", targetEntityId: "module.api", observedSymbolId: "symbol.api", verified: true }],
      taskSession: { taskSessionId: "task.current", task: "change API", taskSessionDigest: `sha256:${"7".repeat(64)}` },
      tokenRequired: true
    }));
    expect(projection.view.id).toBe("task-impact");
    expect(projection.occurrences[0]?.role === "subject" && projection.occurrences[0].backlinks.affectedByTaskSessionIds).toEqual(["task.current"]);
  });

  test("drift-pressure uses evaluated inputs and typed inspector backlinks", () => {
    const driftGraph: ArchitectureLedgerGraphState = {
      entities: [{ entityId: "module.api", kind: "module", canonicalName: "API", status: "active", summary: "Owns API" }],
      relations: [],
      constraints: [{ constraintId: "constraint.api", kind: "boundary", subjectId: "module.api", status: "active", severity: "error" }]
    };
    const projection = compileExplorerProjection(withReadPlan({
      query: { ...query, viewId: "drift-pressure" },
      repository,
      worktree,
      authoritySource: "git",
      authorityCursor: null,
      graph: driftGraph,
      graphDigest: architectureLedgerStateDigest(driftGraph),
      evidenceStateDigest: `sha256:${"4".repeat(64)}`,
      observed: observed(),
      bindings: [],
      pressure: { inputDigest: `sha256:${"8".repeat(64)}`, level: "medium", score: 40, signals: [{ type: "boundary-change", evidence: ["module.api"] }] },
      drift: { inputDigest: `sha256:${"9".repeat(64)}`, subjectIds: ["module.api"], reasonCodes: ["semantic-drift"] },
      eventBacklinks: [{ eventId: "event.api", subjectIds: ["module.api"], title: "API decision", rationale: "Keep one boundary" }],
      tokenRequired: true
    }));
    const occurrence = projection.occurrences[0];
    expect(occurrence?.role).toBe("subject");
    if (occurrence?.role !== "subject") throw new Error("subject required");
    expect(occurrence.verificationStatus).toBe("DRIFT");
    expect(occurrence.pressure).toMatchObject({ evaluated: true, score: 25, signals: ["boundary-change"] });
    expect(occurrence.inspector.constraints[0]?.id).toBe("constraint.api");
    expect(occurrence.backlinks.decidedByEventIds).toEqual(["event.api"]);
  });

  test("data-flow selects only exact typed flow relations and their endpoints", () => {
    const flowGraph: ArchitectureLedgerGraphState = {
      entities: [
        { entityId: "module.api", kind: "module", canonicalName: "API", status: "active" },
        { entityId: "datastore.db", kind: "datastore", canonicalName: "Database", status: "active" },
        { entityId: "external.bus", kind: "external-system", canonicalName: "Event Bus", status: "active" },
        { entityId: "module.adversarial", kind: "module", canonicalName: "Reads External Payment API", status: "active" }
      ],
      relations: [
        { relationId: "relation.reads", kind: "reads", sourceEntityId: "module.api", targetEntityId: "datastore.db", status: "active" },
        { relationId: "relation.writes", kind: "writes", sourceEntityId: "module.api", targetEntityId: "datastore.db", status: "active" },
        { relationId: "relation.publishes", kind: "publishes", sourceEntityId: "module.api", targetEntityId: "external.bus", status: "active" },
        { relationId: "relation.subscribes", kind: "subscribes", sourceEntityId: "external.bus", targetEntityId: "module.api", status: "active" },
        { relationId: "relation.calls", kind: "calls", sourceEntityId: "module.adversarial", targetEntityId: "module.api", status: "active" }
      ],
      constraints: []
    };
    const input = {
      query: { ...query, viewId: "data-flow" as const }, repository, worktree,
      authoritySource: "git" as const, authorityCursor: null,
      graph: flowGraph, graphDigest: architectureLedgerStateDigest(flowGraph),
      evidenceStateDigest: `sha256:${"4".repeat(64)}`,
      observed: observed({ symbols: [{ id: "symbol.adversarial", name: "PublishesExternalSystem", kind: "function", path: "src/writes/external-system.ts" }] }),
      bindings: [], tokenRequired: true
    };
    const projection = compileExplorerProjection(withReadPlan(input));
    expect(projection.view).toEqual({
      id: "data-flow",
      title: "Data Flow",
      question: "Where does typed data move through reads, writes, publications, and subscriptions?"
    });
    expect(projection.relations.map((relation) => relation.kind)).toEqual(["publishes", "reads", "subscribes", "writes"]);
    expect(projection.occurrences.flatMap((occurrence) => occurrence.provenance.declaredEntityIds)).toEqual(["datastore.db", "external.bus", "module.api"]);
    expect(JSON.stringify(projection)).not.toContain("module.adversarial");
    expect(projection.occurrences.every((occurrence) => occurrence.role !== "subject" || occurrence.backlinks.appearsInViews.includes("data-flow"))).toBe(true);

    const reversedGraph = { ...flowGraph, entities: [...flowGraph.entities].reverse(), relations: [...flowGraph.relations].reverse() };
    const reversed = compileExplorerProjection(withReadPlan({ ...input, graph: reversedGraph, graphDigest: architectureLedgerStateDigest(reversedGraph) }));
    expect(reversed.occurrences).toEqual(projection.occurrences);
    expect(reversed.relations).toEqual(projection.relations);
  });

  test("external-integrations selects typed external seeds and direct adjacency only", () => {
    const externalGraph: ArchitectureLedgerGraphState = {
      entities: [
        { entityId: "external.payments", kind: "external-system", canonicalName: "Payments", status: "active" },
        { entityId: "module.api", kind: "module", canonicalName: "API", status: "active" },
        { entityId: "datastore.db", kind: "datastore", canonicalName: "Database", status: "active" },
        { entityId: "module.fake", kind: "module", canonicalName: "External Integration Gateway", status: "active" }
      ],
      relations: [
        { relationId: "relation.payment-call", kind: "calls", sourceEntityId: "module.api", targetEntityId: "external.payments", status: "active" },
        { relationId: "relation.payment-read", kind: "reads", sourceEntityId: "external.payments", targetEntityId: "datastore.db", status: "active" },
        { relationId: "relation.neighbor-only", kind: "writes", sourceEntityId: "module.api", targetEntityId: "datastore.db", status: "active" },
        { relationId: "relation.fake", kind: "calls", sourceEntityId: "module.fake", targetEntityId: "module.api", status: "active" }
      ],
      constraints: []
    };
    const projection = compileExplorerProjection(withReadPlan({
      query: { ...query, viewId: "external-integrations" }, repository, worktree,
      authoritySource: "git", authorityCursor: null,
      graph: externalGraph, graphDigest: architectureLedgerStateDigest(externalGraph),
      evidenceStateDigest: `sha256:${"4".repeat(64)}`,
      observed: observed({ symbols: [{ id: "symbol.fake", name: "ExternalIntegration", kind: "function", path: "external/system.ts" }] }),
      bindings: [], tokenRequired: true
    }));
    expect(projection.relations.flatMap((relation) => relation.provenance.declaredRelationIds)).toEqual(["relation.payment-call", "relation.payment-read"]);
    expect(projection.occurrences.flatMap((occurrence) => occurrence.provenance.declaredEntityIds)).toEqual(["datastore.db", "external.payments", "module.api"]);
    expect(JSON.stringify(projection)).not.toContain("module.fake");
    expect(projection.occurrences.find((occurrence) => occurrence.provenance.declaredEntityIds.includes("external.payments"))?.role === "subject").toBe(true);
  });

  test("typed domain views return honest empty, bounded, focused, and stale-safe projections", () => {
    const emptyGraph: ArchitectureLedgerGraphState = {
      entities: [{ entityId: "module.external-name-only", kind: "module", canonicalName: "External Writes Service", status: "active" }],
      relations: [],
      constraints: []
    };
    for (const viewId of ["data-flow", "external-integrations"] as const) {
      const projection = compileExplorerProjection(withReadPlan({
        query: { ...query, viewId }, repository, worktree, authoritySource: "git", authorityCursor: null,
        graph: emptyGraph, graphDigest: architectureLedgerStateDigest(emptyGraph), evidenceStateDigest: `sha256:${"4".repeat(64)}`,
        observed: observed(), bindings: [], tokenRequired: true
      }));
      expect(projection.occurrences).toEqual([]);
      expect(projection.relations).toEqual([]);
      expect(projection.page).toMatchObject({ totalNodes: 0, totalRelations: 0, returnedNodes: 0, returnedRelations: 0, truncated: false });
      const overview = compileExplorerProjection(withReadPlan({
        query: { ...query, viewId, semanticLevel: "overview" }, repository, worktree, authoritySource: "git", authorityCursor: null,
        graph: emptyGraph, graphDigest: architectureLedgerStateDigest(emptyGraph), evidenceStateDigest: `sha256:${"4".repeat(64)}`,
        observed: observed(), bindings: [], tokenRequired: true
      }));
      expect(overview.occurrences).toEqual([]);
    }

    const flowGraph: ArchitectureLedgerGraphState = {
      entities: [
        { entityId: "module.a", kind: "module", canonicalName: "A", status: "active" },
        { entityId: "module.b", kind: "module", canonicalName: "B", status: "active" },
        { entityId: "module.c", kind: "module", canonicalName: "C", status: "active" }
      ],
      relations: [
        { relationId: "relation.a-b", kind: "reads", sourceEntityId: "module.a", targetEntityId: "module.b", status: "active" },
        { relationId: "relation.b-c", kind: "writes", sourceEntityId: "module.b", targetEntityId: "module.c", status: "active" }
      ], constraints: []
    };
    const budgetQuery: ExplorerProjectionQueryV2 = { ...query, viewId: "data-flow", budget: { maxNodes: 2, maxRelations: 1 } };
    const bounded = compileExplorerProjection(withReadPlan({
      query: budgetQuery, repository, worktree, authoritySource: "git", authorityCursor: null,
      graph: flowGraph, graphDigest: architectureLedgerStateDigest(flowGraph), evidenceStateDigest: `sha256:${"4".repeat(64)}`,
      observed: observed(), bindings: [], tokenRequired: true
    }));
    expect(bounded.page.returnedNodes).toBeLessThanOrEqual(2);
    expect(bounded.page.returnedRelations).toBeLessThanOrEqual(1);
    expect(bounded.page.truncated).toBe(true);

    const focused = compileExplorerProjection(withReadPlan({
      query: { ...query, viewId: "data-flow", semanticLevel: "detail", focus: { subjectId: "module.b" }, depth: 1 },
      repository, worktree, authoritySource: "git", authorityCursor: null,
      graph: flowGraph, graphDigest: architectureLedgerStateDigest(flowGraph), evidenceStateDigest: `sha256:${"4".repeat(64)}`,
      observed: observed(), bindings: [], tokenRequired: true
    }));
    expect(focused.occurrences.flatMap((occurrence) => occurrence.provenance.declaredEntityIds)).toEqual(["module.a", "module.b", "module.c"]);
    expect(focused.breadcrumbs).toEqual([
      { occurrenceId: "occurrence.data-flow.root", label: "Data Flow" },
      { occurrenceId: "occurrence.data-flow.entity.module.b", label: "B" }
    ]);

    expect(() => compileExplorerProjection(withReadPlan({
      query: { ...query, viewId: "data-flow", expectedCursor: { headSha: "b".repeat(40), worktreeDigest: worktree.worktreeDigest, graphDigest: architectureLedgerStateDigest(flowGraph) } },
      repository, worktree, authoritySource: "git", authorityCursor: null,
      graph: flowGraph, graphDigest: architectureLedgerStateDigest(flowGraph), evidenceStateDigest: `sha256:${"4".repeat(64)}`,
      observed: observed(), bindings: [], tokenRequired: true
    }))).toThrow(ExplorerProjectionCompileError);
  });

  test("five view definitions have distinct digest-bound selection policies", () => {
    const digests = (["system-map", "task-impact", "drift-pressure", "data-flow", "external-integrations"] as const).map((view) => explorerViewDefinitionDigest(view));
    expect(new Set(digests).size).toBe(5);
    expect(compile().availableViews.map((view) => view.id)).toEqual(["system-map", "task-impact", "drift-pressure", "data-flow", "external-integrations"]);
  });

  test("projection delta never derives fact or evidence changes from rendered occurrences", () => {
    const base = compile();
    const renderedHead = structuredClone(base);
    const first = renderedHead.occurrences.find((item) => item.role === "subject")!;
    if (first.role !== "subject") throw new Error("subject required");
    first.name = "API v2";
    first.verificationStatus = "DRIFT";
    first.parentOccurrenceId = "occurrence.system-map.group.kind.module";
    const changes = compileExplorerProjectionChanges(base, renderedHead);
    expect(changes.filter((change) => change.deltaClass === "architecture-fact")).toHaveLength(0);
    expect(changes.filter((change) => change.deltaClass === "evidence")).toHaveLength(0);
    expect(changes.filter((change) => change.deltaClass === "projection")).toHaveLength(1);

    const projectionOnly = structuredClone(base);
    const projectionSubject = projectionOnly.occurrences.find((item) => item.role === "subject")!;
    projectionSubject.parentOccurrenceId = "occurrence.system-map.group.kind.module";
    const projectionChanges = compileExplorerProjectionChanges(base, projectionOnly);
    expect(projectionChanges.filter((change) => change.deltaClass === "architecture-fact")).toHaveLength(0);
    expect(projectionChanges.filter((change) => change.deltaClass === "evidence")).toHaveLength(0);
    expect(projectionChanges.filter((change) => change.deltaClass === "projection")).toHaveLength(1);
  });

  test("budget displacement is a projection change, not an architecture-fact removal", () => {
    const base = compile({
      query: { ...query, budget: { maxNodes: 1, maxRelations: 0 } },
      graph: {
        entities: [
          { entityId: "module.b", kind: "module", canonicalName: "B", status: "active" },
          { entityId: "module.c", kind: "module", canonicalName: "C", status: "active" }
        ],
        relations: [],
        constraints: []
      }
    });
    const head = compile({
      query: { ...query, budget: { maxNodes: 1, maxRelations: 0 } },
      graph: {
        entities: [
          { entityId: "module.a", kind: "module", canonicalName: "A", status: "active" },
          { entityId: "module.b", kind: "module", canonicalName: "B", status: "active" },
          { entityId: "module.c", kind: "module", canonicalName: "C", status: "active" }
        ],
        relations: [],
        constraints: []
      }
    });

    const changes = compileExplorerProjectionChanges(base, head);
    expect(changes.filter((change) => change.deltaClass === "architecture-fact")).toHaveLength(0);
    expect(changes.filter((change) => change.deltaClass === "evidence")).toHaveLength(0);
    expect(changes).toEqual([
      { deltaClass: "projection", subjectId: "architecture-entity:module.a", change: "added", fields: ["subject"] },
      { deltaClass: "projection", subjectId: "architecture-entity:module.b", change: "removed", fields: ["subject"] }
    ]);
  });

  test("rejects projection deltas across different queries", () => {
    const base = compile();
    const head = compile({ query: { ...query, budget: { maxNodes: 1, maxRelations: 0 } } });
    expect(() => compileExplorerProjectionChanges(base, head)).toThrow("incompatible Explorer delta: manifest");
  });
});
