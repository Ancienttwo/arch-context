import { describe, expect, test } from "bun:test";
import type {
  ExplorerDerivedGroupOccurrenceV2,
  ExplorerProjectionV2,
  ExplorerRelationOccurrenceV2,
  ExplorerSubjectOccurrenceV2
} from "@archcontext/contracts";
import { renderExplorerTopology } from "../src/topology";

describe("renderExplorerTopology", () => {
  test("is byte deterministic across reversed occurrence and relation input", () => {
    const projection = fixture();
    const first = renderExplorerTopology({ projection, focusSubjectId: "module.api" });
    const reversed = renderExplorerTopology({
      projection: {
        ...projection,
        occurrences: [...projection.occurrences].reverse(),
        relations: [...projection.relations].reverse()
      },
      focusSubjectId: "module.api"
    });

    expect(reversed.plan).toEqual(first.plan);
    expect(reversed.svg).toBe(first.svg);
    expect(Object.isFrozen(first.plan)).toBe(true);
    expect(Object.isFrozen(first.plan.nodes)).toBe(true);
    expect(Object.isFrozen(first.plan.edges[0].points)).toBe(true);
  });

  test("selects explicit overview context and detail layouts", () => {
    const base = fixture();
    const overview = renderExplorerTopology({ projection: { ...base, semanticLevel: "overview" } }).plan;
    expect(overview.mode).toBe("overview-groups");
    const group = overview.nodes.find((node) => node.visualRole === "group")!;
    const child = overview.nodes.find((node) => node.subjectId === "module.api")!;
    expect(child.x).toBeGreaterThan(group.x);
    expect(child.y).toBeGreaterThan(group.y);
    expect(child.x + child.width).toBeLessThanOrEqual(group.x + group.width);
    expect(child.y + child.height).toBeLessThanOrEqual(group.y + group.height);
    expect(renderExplorerTopology({ projection: { ...base, semanticLevel: "context" } }).plan.mode).toBe("context-bands");
    const detail = renderExplorerTopology({ projection: { ...base, semanticLevel: "detail" }, focusSubjectId: "module.db" });
    expect(detail.plan.mode).toBe("detail-focus");
    expect(detail.plan.nodes.find((node) => node.subjectId === "module.db")?.x).toBeGreaterThan(200);
  });

  test("indexes each occurrence and relation once and renders loops parallel edges and disconnected nodes", () => {
    const result = renderExplorerTopology({ projection: fixture(), focusSubjectId: "module.api" });
    expect(result.plan.metrics).toEqual({ indexedOccurrences: 4, indexedRelations: 4 });
    expect(result.plan.edges).toHaveLength(4);
    expect(result.plan.edges.find((edge) => edge.selfLoop)?.points).toHaveLength(4);
    const parallel = result.plan.edges.filter((edge) => edge.sourceOccurrenceId.includes("api") && edge.targetOccurrenceId.includes("db"));
    expect(parallel).toHaveLength(2);
    expect(parallel[0].points).not.toEqual(parallel[1].points);
    expect(result.plan.nodes.some((node) => node.subjectId === "module.orphan")).toBe(true);
    expect(result.svg).toContain("topology-arrow");
    expect(result.svg).toContain('data-topology-band="MATCHED"');
    expect(result.svg).toContain('data-topology-band="DRIFT"');
  });

  test("fails closed when a relation endpoint is absent", () => {
    const projection = fixture();
    projection.relations.push(relation("relation.missing", "occurrence.api", "occurrence.missing", "calls"));
    expect(() => renderExplorerTopology({ projection })).toThrow("explorer-topology-missing-endpoint:relation.missing");
  });

  test("escapes hostile labels while retaining the full accessible title", () => {
    const projection = fixture();
    const api = projection.occurrences.find((item) => item.occurrenceId === "occurrence.api")!;
    api.name = `<script>alert("x")</script>${"界".repeat(40)}`;
    const result = renderExplorerTopology({ projection });
    expect(result.svg).not.toContain("<script>");
    expect(result.svg).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(result.svg).toContain("…");
  });

  test("renders an honest empty bounded projection", () => {
    const projection = fixture();
    projection.occurrences = [];
    projection.relations = [];
    const result = renderExplorerTopology({ projection });
    expect(result.plan.nodes).toEqual([]);
    expect(result.plan.width).toBe(640);
    expect(result.svg).toContain("No occurrences in this bounded projection.");
  });
});

function fixture(): ExplorerProjectionV2 {
  const occurrences = [
    group("occurrence.group.modules", "Modules"),
    subject("occurrence.api", "module.api", "API", "MATCHED"),
    subject("occurrence.db", "module.db", "Database", "VERIFIED"),
    subject("occurrence.orphan", "module.orphan", "Orphan", "DRIFT")
  ];
  occurrences[1].parentOccurrenceId = "occurrence.group.modules";
  occurrences[2].parentOccurrenceId = "occurrence.group.modules";
  const relations = [
    relation("relation.api-db.calls", "occurrence.api", "occurrence.db", "calls"),
    relation("relation.api-db.writes", "occurrence.api", "occurrence.db", "writes"),
    relation("relation.db-api.reads", "occurrence.db", "occurrence.api", "reads"),
    relation("relation.api-loop", "occurrence.api", "occurrence.api", "implements")
  ];
  return {
    semanticLevel: "context",
    occurrences,
    relations,
    page: {
      budget: { maxNodes: 80, maxRelations: 160 },
      totalNodes: occurrences.length,
      totalRelations: relations.length,
      returnedNodes: occurrences.length,
      returnedRelations: relations.length,
      truncated: false,
      omittedNodeCount: 0,
      omittedRelationCount: 0
    }
  } as ExplorerProjectionV2;
}

function subject(
  occurrenceId: string,
  id: string,
  name: string,
  verificationStatus: ExplorerSubjectOccurrenceV2["verificationStatus"]
): ExplorerSubjectOccurrenceV2 {
  return {
    occurrenceId,
    role: "subject",
    subjectRefs: [{ kind: "architecture-entity", id }],
    name,
    kind: "module",
    childrenCount: 0,
    expandable: false,
    verificationStatus,
    authorityState: "BOUND",
    pressure: { evaluated: false, signals: [] },
    sourceSelectors: [],
    provenance: { declaredEntityIds: [id], observedSymbolIds: [], evidenceBindingIds: [] },
    inspector: { constraints: [], decisions: [], historyEvents: [], sourceSelectors: [], evidenceBindingIds: [] },
    backlinks: {
      appearsInViews: ["system-map"],
      affectedByTaskSessionIds: [],
      constrainedByIds: [],
      evidencedByBindingIds: [],
      changedByEventIds: [],
      decidedByEventIds: [],
      incomingRelationIds: [],
      outgoingRelationIds: []
    }
  };
}

function group(occurrenceId: string, name: string): ExplorerDerivedGroupOccurrenceV2 {
  return {
    occurrenceId,
    role: "derived-group",
    subjectRefs: [],
    name,
    kind: "module",
    childrenCount: 3,
    expandable: true,
    verificationStatus: "UNKNOWN",
    authorityState: "DERIVED",
    pressure: { evaluated: false, signals: [] },
    sourceSelectors: [],
    provenance: { declaredEntityIds: [], observedSymbolIds: [], evidenceBindingIds: [] },
    derivation: { ruleId: "group-by-kind", inputDigest: "sha256:test", compilerVersion: "archcontext.explorer-view-compiler/v1" }
  };
}

function relation(occurrenceId: string, sourceOccurrenceId: string, targetOccurrenceId: string, kind: string): ExplorerRelationOccurrenceV2 {
  return {
    occurrenceId,
    sourceOccurrenceId,
    targetOccurrenceId,
    kind,
    verificationStatus: "VERIFIED",
    provenance: { declaredRelationIds: [occurrenceId], observedEdgeIds: [], evidenceBindingIds: [] }
  };
}
