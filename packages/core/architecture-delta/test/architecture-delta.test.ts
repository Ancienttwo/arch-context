import { describe, expect, test } from "bun:test";
import { architectureCandidateDeltaDigest, architectureSubjectSelectorDigest, digestJson, type Json, type NormalizedCodeContext } from "@archcontext/contracts";
import { buildArchitectureCandidateDelta, type ArchitectureDeltaDeclaredGraph, type ArchitectureDeltaGitChangeMetadata } from "../src/index";

const repository = {
  repositoryId: "repo.checkout",
  storageRepositoryId: "repo.storage.checkout"
};

const worktree = {
  workspaceId: "workspace.checkout.main",
  storageWorkspaceId: "workspace.storage.checkout.main",
  branch: "main",
  headSha: "head-002",
  worktreeDigest: digestJson({ worktree: "checkout" } as unknown as Json)
};

describe("@archcontext/core/architecture-delta", () => {
  test("builds deterministic candidate deltas with changed path, symbol, relation and typed evidence", () => {
    const first = buildArchitectureCandidateDelta({
      repository,
      worktree,
      git: gitChange([
        { path: "src/web/page.ts", status: "modified", rawStatus: "M" },
        { path: "src/api/orders.ts", previousPath: "src/api/order.ts", status: "renamed", rawStatus: "R100" }
      ]),
      codeContext: codeContext(),
      declaredGraph: declaredGraph(),
      createdAt: "2026-06-25T04:00:00.000Z"
    });
    const repeated = buildArchitectureCandidateDelta({
      repository,
      worktree,
      git: gitChange([
        { path: "src/api/orders.ts", previousPath: "src/api/order.ts", status: "renamed", rawStatus: "R100" },
        { path: "src/web/page.ts", status: "modified", rawStatus: "M" }
      ]),
      codeContext: codeContext(),
      declaredGraph: declaredGraph(),
      createdAt: "2026-06-25T04:00:00.000Z"
    });

    expect(first.deltaDigest).toBe(repeated.deltaDigest);
    expect(first.deltaDigest).toBe(architectureCandidateDeltaDigest(first));
    expect(first.subjectSelectors.every((selector) => selector.digest === architectureSubjectSelectorDigest(selector))).toBe(true);
    expect(first.subjectSelectors.filter((selector) => selector.kind === "path")).toHaveLength(3);
    expect(first.subjectSelectors.filter((selector) => selector.kind === "symbol")).toHaveLength(1);
    expect(first.subjectSelectors.filter((selector) => selector.kind === "relation")).toHaveLength(1);
    expect(first.rawFacts.filter((fact) => fact.kind === "git-path-change")).toHaveLength(2);
    expect(first.rawFacts.filter((fact) => fact.kind === "codegraph-symbol")).toHaveLength(1);
    expect(first.rawFacts.filter((fact) => fact.kind === "codegraph-relation")).toHaveLength(1);
    expect(first.changedSubjects.map((subject) => subject.changeKind)).toContain("renamed");
    expect(first.changedSubjects.map((subject) => subject.changeKind)).toContain("materially_changed");
    expect(first.declaredSubjectMappings.length).toBeGreaterThanOrEqual(3);
    expect(first.mappingAmbiguities).toEqual([]);
    expect(first.summary.mapped).toBe(first.declaredSubjectMappings.length);
    expect(first.summary.ambiguous).toBe(0);
    expect(first.summary.unresolved).toBe(0);
    expect(first.declaredSubjectMappings).toContainEqual(expect.objectContaining({
      target: { kind: "entity", id: "module.checkout-ui" },
      matchReason: "declared-path-prefix"
    }));
    expect(first.declaredSubjectMappings).toContainEqual(expect.objectContaining({
      target: { kind: "relation", id: "relation.checkout-ui-orders-api" },
      matchReason: "declared-relation-endpoints"
    }));
    expect(first.candidateChanges.map((change) => change.kind)).toEqual(expect.arrayContaining([
      "node-materially-changed",
      "node-renamed",
      "relation-materially-changed",
      "constraint-materially-changed",
      "owner-materially-changed",
      "migration-state-renamed"
    ]));
    expect(first.evidenceBindings.some((binding) => binding.target.kind === "entity" && binding.target.id === "module.checkout-ui")).toBe(true);
    expect(first.evidenceBindings.some((binding) => binding.target.kind === "relation" && binding.target.id === "relation.checkout-ui-orders-api")).toBe(true);
    expect(first.interpretations.every((interpretation) => interpretation.evidenceIds.length > 0)).toBe(true);
    expect(first.evidenceBindings.some((binding) => binding.target.kind === "subject")).toBe(true);
    expect(first.evidenceBindings.some((binding) => binding.target.kind === "candidate-delta")).toBe(true);
    expect(JSON.stringify(first)).not.toContain("const secret");
    expect(JSON.stringify(first)).not.toContain("diff --git");
  });

  test("normalizes path moves without emitting delete plus add churn", () => {
    const delta = buildArchitectureCandidateDelta({
      repository,
      worktree,
      git: gitChange([
        { path: "src/new/service.ts", previousPath: "src/old/service.ts", status: "renamed", rawStatus: "R100" }
      ]),
      codeContext: {
        task: "move service",
        symbols: [],
        edges: [],
        evidence: [],
        digest: digestJson({ empty: true } as unknown as Json)
      },
      createdAt: "2026-06-25T04:00:00.000Z"
    });

    expect(delta.summary).toMatchObject({ moved: 1, added: 0, removed: 0, renamed: 0 });
    expect(delta.changedSubjects).toHaveLength(1);
    expect(delta.changedSubjects[0].previousSelectorId).toBeTruthy();
    expect(delta.declaredSubjectMappings).toEqual([]);
    expect(delta.mappingAmbiguities).toContainEqual(expect.objectContaining({
      reasonCode: "declared-graph-unavailable"
    }));
    expect(delta.summary.unresolved).toBe(1);
  });

  test("represents equal declared target matches as ambiguity instead of inventing an entity", () => {
    const delta = buildArchitectureCandidateDelta({
      repository,
      worktree,
      git: gitChange([{ path: "src/shared/service.ts", status: "modified", rawStatus: "M" }]),
      codeContext: {
        task: "change shared service",
        symbols: [],
        edges: [],
        evidence: [],
        digest: digestJson({ shared: true } as unknown as Json)
      },
      declaredGraph: {
        entities: [
          {
            entityId: "module.shared-a",
            kind: "module",
            canonicalName: "Shared A",
            status: "active",
            path: "src/shared"
          },
          {
            entityId: "module.shared-b",
            kind: "module",
            canonicalName: "Shared B",
            status: "active",
            path: "src/shared"
          }
        ],
        relations: [],
        constraints: []
      },
      createdAt: "2026-06-25T04:00:00.000Z"
    });

    expect(delta.declaredSubjectMappings).toEqual([]);
    expect(delta.candidateChanges).toEqual([]);
    expect(delta.mappingAmbiguities).toContainEqual(expect.objectContaining({
      reasonCode: "multiple-declared-targets",
      candidateTargets: expect.arrayContaining([
        expect.objectContaining({ target: { kind: "entity", id: "module.shared-a" } }),
        expect.objectContaining({ target: { kind: "entity", id: "module.shared-b" } })
      ])
    }));
    expect(delta.summary).toMatchObject({ mapped: 0, ambiguous: 1, unresolved: 1, candidateChanges: 0 });
  });
});

function gitChange(paths: ArchitectureDeltaGitChangeMetadata["paths"]): ArchitectureDeltaGitChangeMetadata {
  const payload = {
    schemaVersion: "archcontext.git-change-metadata/v1" as const,
    source: "commit" as const,
    baseSha: "head-001",
    headSha: "head-002",
    paths: [...paths].sort((left, right) => left.path.localeCompare(right.path)),
    pathCount: paths.length
  };
  return {
    ...payload,
    metadataDigest: digestJson(payload as unknown as Json)
  };
}

function declaredGraph(): ArchitectureDeltaDeclaredGraph {
  return {
    entities: [
      {
        entityId: "module.checkout-ui",
        kind: "module",
        canonicalName: "Checkout UI",
        status: "active",
        path: "src/web",
        metadata: { owner: "team.frontend" }
      },
      {
        entityId: "module.orders-api",
        kind: "module",
        canonicalName: "Orders API",
        status: "active",
        path: "src/api",
        metadata: { migrationState: "in-progress" }
      }
    ],
    relations: [
      {
        relationId: "relation.checkout-ui-orders-api",
        kind: "depends_on",
        sourceEntityId: "module.checkout-ui",
        targetEntityId: "module.orders-api",
        status: "active"
      }
    ],
    constraints: [
      {
        constraintId: "constraint.checkout-ui-owner",
        kind: "owner-required",
        subjectId: "module.checkout-ui",
        status: "active",
        severity: "warning"
      },
      {
        constraintId: "constraint.orders-api-migration",
        kind: "migration-state",
        subjectId: "module.orders-api",
        status: "active"
      }
    ]
  };
}

function codeContext(): NormalizedCodeContext {
  const context = {
    task: "change checkout order page",
    symbols: [
      {
        id: "symbol.page",
        name: "CheckoutPage",
        kind: "function",
        path: "src/web/page.ts",
        range: { startLine: 1, endLine: 12 }
      }
    ],
    edges: [
      {
        source: "file:src/web/page.ts",
        target: "file:src/api/orders.ts",
        kind: "imports" as const,
        confidence: "high" as const
      }
    ],
    evidence: [],
    digest: ""
  };
  return {
    ...context,
    digest: digestJson({ task: context.task, symbols: context.symbols, edges: context.edges } as unknown as Json)
  };
}
