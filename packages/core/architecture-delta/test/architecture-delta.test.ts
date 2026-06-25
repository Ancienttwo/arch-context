import { describe, expect, test } from "bun:test";
import { architectureCandidateDeltaDigest, architectureSubjectSelectorDigest, digestJson, type Json, type NormalizedCodeContext } from "@archcontext/contracts";
import { buildArchitectureCandidateDelta, type ArchitectureDeltaDeclaredGraph, type ArchitectureDeltaGitChangeMetadata } from "../src/index";
import {
  representativeArchitectureChangeScenarios,
  representativeArchitectureCodeContext,
  representativeArchitectureDeclaredGraph,
  representativeArchitectureGitPaths
} from "./fixtures/representative-architecture-changes";

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
    const targetStateChanges = first.candidateChanges.filter((change) => change.stateDimension === "target-state");
    const migrationStateProgress = first.candidateChanges.filter((change) => change.stateDimension === "migration-state");
    expect(first.summary.targetStateChanges).toBe(targetStateChanges.length);
    expect(first.summary.migrationStateProgress).toBe(migrationStateProgress.length);
    expect(targetStateChanges.length).toBeGreaterThan(0);
    expect(migrationStateProgress).toEqual([
      expect.objectContaining({
        kind: "migration-state-renamed",
        target: {
          kind: "migration-state",
          id: "module.orders-api:migration-state",
          parentId: "module.orders-api"
        }
      })
    ]);
    expect(targetStateChanges.some((change) => change.target.kind === "migration-state")).toBe(false);
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

  test("separates pre-existing baseline candidates from task-introduced changes", () => {
    const withoutBaseline = buildArchitectureCandidateDelta({
      repository,
      worktree,
      git: gitChange([{ path: "src/web/page.ts", status: "modified", rawStatus: "M" }]),
      codeContext: codeContext(),
      declaredGraph: declaredGraph(),
      createdAt: "2026-06-25T04:00:00.000Z"
    });
    const preExistingOwner = withoutBaseline.candidateChanges.find((change) => change.kind === "owner-materially-changed");
    expect(preExistingOwner).toBeTruthy();

    const withBaseline = buildArchitectureCandidateDelta({
      repository,
      worktree,
      git: gitChange([{ path: "src/web/page.ts", status: "modified", rawStatus: "M" }]),
      codeContext: codeContext(),
      declaredGraph: declaredGraph(),
      baseline: {
        baselineId: "baseline.previous-checkpoint",
        sourceDigest: digestJson({ checkpoint: "previous" } as unknown as Json),
        candidateChanges: [{
          ...preExistingOwner!,
          candidateChangeId: "candidate_change.previous_owner"
        }]
      },
      createdAt: "2026-06-25T04:00:00.000Z"
    });

    expect(withBaseline.deltaId).not.toBe(withoutBaseline.deltaId);
    expect(withBaseline.deltaDigest).toBe(architectureCandidateDeltaDigest(withBaseline));
    const attribution = withBaseline.extensions?.baselineAttribution as any;
    expect(withBaseline.summary.candidateChanges).toBe(withoutBaseline.summary.candidateChanges - attribution.preExistingCandidateChanges);
    expect(withBaseline.changedSubjects).toHaveLength(withoutBaseline.changedSubjects.length);
    expect(withBaseline.candidateChanges.map((change) => change.kind)).not.toContain("owner-materially-changed");

    expect(attribution).toMatchObject({
      schemaVersion: "archcontext.architecture-delta-baseline-attribution/v1",
      baselineId: "baseline.previous-checkpoint",
      baselineCandidateChanges: 1,
      taskIntroducedCandidateChanges: withBaseline.candidateChanges.length
    });
    expect(attribution.preExistingCandidateChanges).toBeGreaterThanOrEqual(1);
    expect(attribution.suppressedCandidateChanges).toContainEqual(expect.objectContaining({
      candidateChangeId: preExistingOwner!.candidateChangeId,
      baselineCandidateChangeIds: ["candidate_change.previous_owner"],
      reason: "pre-existing-baseline-candidate"
    }));
    expect(attribution.taskIntroducedCandidateChangeIds).toEqual(withBaseline.candidateChanges.map((change) => change.candidateChangeId).sort());
  });

  test("covers representative architecture change fixtures without unmapped churn", () => {
    const delta = buildArchitectureCandidateDelta({
      repository,
      worktree,
      git: gitChange(representativeArchitectureGitPaths),
      codeContext: representativeArchitectureCodeContext,
      declaredGraph: representativeArchitectureDeclaredGraph,
      createdAt: "2026-06-26T04:00:00.000Z"
    });

    expect(representativeArchitectureChangeScenarios.map((scenario) => scenario.scenarioId).sort()).toEqual([
      "mapper-removal",
      "monolith-to-service",
      "package-layer",
      "payment-webhook",
      "persistence-boundary",
      "public-api"
    ]);
    expect(delta.mappingAmbiguities).toEqual([]);
    expect(delta.summary.unresolved).toBe(0);
    expect(delta.summary.ambiguous).toBe(0);
    expect(delta.summary.mapped).toBe(delta.declaredSubjectMappings.length);
    expect(delta.changedSubjects).toHaveLength(representativeArchitectureGitPaths.length + representativeArchitectureCodeContext.symbols.length + representativeArchitectureCodeContext.edges.length);

    for (const scenario of representativeArchitectureChangeScenarios) {
      expect(delta.candidateChanges).toContainEqual(expect.objectContaining({
        kind: scenario.expectedCandidate.kind,
        target: expect.objectContaining(scenario.expectedCandidate.target),
        stateDimension: scenario.expectedCandidate.stateDimension,
        changeKind: scenario.expectedCandidate.changeKind
      }));
    }

    expect(delta.candidateChanges).toContainEqual(expect.objectContaining({
      kind: "migration-state-moved",
      target: {
        kind: "migration-state",
        id: "module.order-service:migration-state",
        parentId: "module.order-service"
      },
      stateDimension: "migration-state",
      changeKind: "moved"
    }));
    expect(delta.candidateChanges).toContainEqual(expect.objectContaining({
      kind: "relation-materially-changed",
      target: { kind: "relation", id: "relation.public-api-order-service" },
      changeKind: "materially_changed"
    }));
    expect(delta.candidateChanges).toContainEqual(expect.objectContaining({
      kind: "relation-materially-changed",
      target: { kind: "relation", id: "relation.payment-webhook-order-service" },
      changeKind: "materially_changed"
    }));
    expect(delta.candidateChanges).toContainEqual(expect.objectContaining({
      kind: "relation-materially-changed",
      target: { kind: "relation", id: "relation.order-service-persistence" },
      changeKind: "materially_changed"
    }));
    expect(delta.candidateChanges).toContainEqual(expect.objectContaining({
      kind: "relation-materially-changed",
      target: { kind: "relation", id: "relation.orders-package-service" },
      changeKind: "materially_changed"
    }));

    expect(delta.declaredSubjectMappings).toContainEqual(expect.objectContaining({
      target: { kind: "entity", id: "module.order-service" },
      matchReason: "declared-path-prefix"
    }));
    expect(delta.declaredSubjectMappings).toContainEqual(expect.objectContaining({
      target: { kind: "relation", id: "relation.public-api-order-service" },
      matchReason: "declared-relation-endpoints"
    }));
    expect(delta.evidenceBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: { kind: "entity", id: "module.order-service" } }),
      expect.objectContaining({ target: { kind: "entity", id: "module.order-persistence" } }),
      expect.objectContaining({ target: { kind: "entity", id: "api.public-orders" } }),
      expect.objectContaining({ target: { kind: "entity", id: "module.payment-webhook" } }),
      expect.objectContaining({ target: { kind: "entity", id: "module.order-mapper" } }),
      expect.objectContaining({ target: { kind: "entity", id: "package.orders" } }),
      expect.objectContaining({ target: { kind: "relation", id: "relation.public-api-order-service" } })
    ]));
    expect(delta.evidenceBindings.every((binding) => binding.authorityEffect === "context-only")).toBe(true);
    expect(delta.deltaDigest).toBe(architectureCandidateDeltaDigest(delta));
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
