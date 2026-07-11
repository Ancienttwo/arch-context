import { describe, expect, test } from "bun:test";
import type { ExplorerProjectionV2 } from "@archcontext/contracts";
import { renderExplorerHtml } from "../src/index";

const projection: ExplorerProjectionV2 = {
  schemaVersion: "archcontext.explorer-projection/v2",
  view: { id: "system-map", title: "System Map", question: "What exists?" },
  availableViews: [
    { id: "system-map", enabled: true },
    { id: "task-impact", enabled: false, reason: "current task session required" },
    { id: "drift-pressure", enabled: true }
  ],
  semanticLevel: "context",
  breadcrumbs: [{ occurrenceId: "occurrence.system-map.entity.module.runtime", label: "Runtime" }],
  cursor: {
    repository: { repositoryId: "repo.local", storageRepositoryId: "repo.storage" },
    worktree: { workspaceId: "ws.local", storageWorkspaceId: "ws.storage", branch: "main", headSha: "a".repeat(40), worktreeDigest: `sha256:${"1".repeat(64)}` },
    authoritySource: "git",
    authorityCursor: null,
    evidenceAuthorityCursor: null,
    inputManifestDigest: `sha256:${"0".repeat(64)}`,
    compatibilityDigest: `sha256:${"7".repeat(64)}`,
    graphDigest: `sha256:${"2".repeat(64)}`,
    evidenceStateDigest: `sha256:${"e".repeat(64)}`,
    observedFactsDigest: `sha256:${"3".repeat(64)}`,
    viewDefinitionDigest: `sha256:${"4".repeat(64)}`,
    compilerVersion: "archcontext.explorer-view-compiler/v1",
    observedAvailability: { status: "ready" }
  },
  inputManifest: {
    schemaVersion: "archcontext.projection-input-manifest/v1",
    repository: { repositoryId: "repo.local", storageRepositoryId: "repo.storage" },
    worktree: { workspaceId: "ws.local", storageWorkspaceId: "ws.storage", branch: "main", headSha: "a".repeat(40), worktreeDigest: `sha256:${"1".repeat(64)}` },
    authoritySource: "git",
    authorityCursor: null,
    evidenceAuthorityCursor: null,
    queryDigest: `sha256:${"8".repeat(64)}`,
    graphDigest: `sha256:${"2".repeat(64)}`,
    evidenceStateDigest: `sha256:${"e".repeat(64)}`,
    observedFactsDigest: `sha256:${"3".repeat(64)}`,
    observedAvailability: { status: "ready" },
    bindingsDigest: `sha256:${"9".repeat(64)}`,
    eventBacklinksDigest: `sha256:${"a".repeat(64)}`,
    driftDigest: null,
    pressureDigest: null,
    taskSessionDigest: null,
    readPlan: {
      schemaVersion: "archcontext.projection-read-plan/v1",
      plannerVersion: "archcontext.projection-read-planner/v1",
      kind: "bounded-context",
      source: "git-authority",
      queryDigest: `sha256:${"8".repeat(64)}`,
      semanticLevel: "context",
      focusSubjectId: null,
      expandedKinds: [],
      depth: 1,
      limits: { maxEntities: 80, maxRelations: 160, maxConstraints: 160, maxBindings: 320, maxBacklinks: 640, maxGraphRows: 400 },
      requiredDomains: ["authority", "bindings", "evidence", "graph", "observed"],
      ordering: "canonical-id-asc",
      truncation: "hard-limit-with-authoritative-totals",
      planDigest: `sha256:${"b".repeat(64)}`
    },
    readSet: {
      schemaVersion: "archcontext.projection-read-set/v1",
      planDigest: `sha256:${"b".repeat(64)}`,
      selectedGraphDigest: `sha256:${"2".repeat(64)}`,
      authoritativeTotals: { entities: 1, relations: 0, constraints: 0 },
      entityKindTotals: [{ kind: "module", count: 1 }],
      rowsRead: { entities: 1, relations: 0, constraints: 0, bindings: 0, backlinks: 0 },
      truncated: false,
      readSetDigest: `sha256:${"c".repeat(64)}`
    },
    inputDomains: {
      authority: { requirement: "required", status: "ready", digest: `sha256:${"f".repeat(64)}` },
      graph: { requirement: "required", status: "ready", digest: `sha256:${"2".repeat(64)}` },
      evidence: { requirement: "required", status: "ready", digest: `sha256:${"e".repeat(64)}` },
      observed: { requirement: "required", status: "ready", digest: `sha256:${"3".repeat(64)}` },
      bindings: { requirement: "required", status: "ready", digest: `sha256:${"9".repeat(64)}` },
      "event-backlinks": { requirement: "optional", status: "ready", digest: `sha256:${"a".repeat(64)}` },
      drift: { requirement: "optional", status: "unavailable", digest: null, reasonCode: "not-provided" },
      pressure: { requirement: "optional", status: "unavailable", digest: null, reasonCode: "not-provided" },
      "task-session": { requirement: "optional", status: "unavailable", digest: null, reasonCode: "not-provided" }
    },
    viewDefinitionDigest: `sha256:${"4".repeat(64)}`,
    compilerVersion: "archcontext.explorer-view-compiler/v1",
    tokenRequired: true,
    compatibilityDigest: `sha256:${"7".repeat(64)}`,
    manifestDigest: `sha256:${"0".repeat(64)}`
  },
  occurrences: [{
    occurrenceId: "occurrence.system-map.entity.module.runtime",
    role: "subject",
    subjectRefs: [{ kind: "architecture-entity", id: "module.runtime" }],
    name: "Runtime",
    kind: "module",
    childrenCount: 0,
    expandable: false,
    verificationStatus: "MATCHED",
    authorityState: "BOUND",
    pressure: { evaluated: true, level: "low", score: 0, signals: [], inputDigest: `sha256:${"5".repeat(64)}` },
    sourceSelectors: [{ path: "packages/local-runtime/runtime-daemon/src/index.ts" }],
    provenance: { declaredEntityIds: ["module.runtime"], observedSymbolIds: ["symbol.runtime"], evidenceBindingIds: ["binding.runtime"] },
    inspector: { summary: "Owns local runtime orchestration.", constraints: [], decisions: [], sourceSelectors: [{ path: "packages/local-runtime/runtime-daemon/src/index.ts" }], evidenceBindingIds: ["binding.runtime"] },
    backlinks: { appearsInViews: ["system-map", "drift-pressure"], affectedByTaskSessionIds: [], constrainedByIds: [], evidencedByBindingIds: ["binding.runtime"], changedByEventIds: [], decidedByEventIds: [], incomingRelationIds: [], outgoingRelationIds: [] }
  }],
  relations: [],
  page: { budget: { maxNodes: 80, maxRelations: 160 }, totalNodes: 1, totalRelations: 0, returnedNodes: 1, returnedRelations: 0, truncated: false, omittedNodeCount: 0, omittedRelationCount: 0 },
  projectionDigest: `sha256:${"6".repeat(64)}`,
  capabilities: { readOnly: true, mutationMode: "forbidden", egress: "none", tokenRequired: true }
};

describe("@archcontext/surfaces/explorer-ui V2", () => {
  test("renders a self-contained authority-aware view without external assets", () => {
    const html = renderExplorerHtml(projection);
    expect(html).toContain("ArchContext Explorer V2");
    expect(html).toContain("System Map");
    expect(html).not.toContain("DECLARED_UNOBSERVED");
    expect(html).toContain("BOUND");
    expect(html).toContain("read-only · local · no egress");
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=|https?:\/\//);
  });

  test("renders view, semantic level, focus and digest-only invalidation controls", () => {
    const html = renderExplorerHtml(projection, { focusSubjectId: "module.runtime" });
    expect(html).toContain('data-view="task-impact"');
    expect(html).toContain('data-level="overview"');
    expect(html).toContain("Owns local runtime orchestration.");
    expect(html).toContain("projection-invalidated");
    expect(html).toContain(projection.projectionDigest);
    expect(html).not.toContain("sourceBody");
  });
});
