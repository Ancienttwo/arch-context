import { describe, expect, test } from "bun:test";
import { architectureCandidateDeltaDigest, architectureSubjectSelectorDigest, digestJson, type Json, type NormalizedCodeContext } from "@archcontext/contracts";
import { buildArchitectureCandidateDelta, type ArchitectureDeltaGitChangeMetadata } from "../src/index";

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
