import { describe, expect, test } from "bun:test";
import { digestJson, moduleStatisticsSnapshotInvariantIssues, type DependencyConstraintV1, type Json } from "@archcontext/contracts";
import type { NativeNode } from "../../projection-engine/src/index";
import {
  buildModuleStatisticsSnapshot,
  evaluateDependencyConstraints,
  type DependencyConstraintInputV1,
  type ModuleStatisticsWorkspacePackageV1
} from "../src/index";
import { MODEL, WORKTREE_DIGEST, digestOf, makeInput } from "./factories";

/** Three layers mirroring the repository: core may use contracts, never the runtime. */
const NODES: NativeNode[] = [
  { id: "module.contracts", kind: "module", name: "Contracts", source: { include: ["packages/contracts/**"] } },
  { id: "module.core", kind: "module", name: "Core", source: { include: ["packages/core/**"] } },
  { id: "component.core.review", kind: "component", name: "Review", parent: "module.core", source: { include: ["packages/core/review/**"] } },
  { id: "module.runtime", kind: "module", name: "Runtime", source: { include: ["packages/runtime/**"] } }
];

const WORKSPACE_PACKAGES: ModuleStatisticsWorkspacePackageV1[] = [
  { name: "@archcontext/contracts", root: "packages/contracts", exports: { ".": "./src/index.ts" } },
  { name: "@archcontext/core", root: "packages/core", exports: { "./review": "./review/src/index.ts" } },
  { name: "@archcontext/runtime", root: "packages/runtime", exports: { ".": "./src/index.ts" } }
];

const FILES = [
  "packages/contracts/src/index.ts",
  "packages/core/review/src/index.ts",
  "packages/core/src/index.ts",
  "packages/runtime/src/index.ts"
];

const CORE_NOT_RUNTIME: DependencyConstraintV1 = {
  id: "constraint.core-not-runtime",
  severity: "error",
  scope: { nodes: ["module.core"] },
  rule: { type: "forbid-dependency", targets: ["module.runtime"] },
  rationale: "Core is pure; the runtime depends on it, never the reverse."
};

const CORE_TO_CONTRACTS = { from: "packages/core/review/src/index.ts", specifier: "@archcontext/contracts", to: null };
const CORE_TO_RUNTIME = { from: "packages/core/review/src/index.ts", specifier: "@archcontext/runtime", to: null };

function input(overrides: Partial<DependencyConstraintInputV1> = {}): DependencyConstraintInputV1 {
  return {
    nodes: NODES,
    constraints: [CORE_NOT_RUNTIME],
    worktreeDigest: WORKTREE_DIGEST,
    files: FILES,
    importEdges: [CORE_TO_CONTRACTS],
    workspacePackages: WORKSPACE_PACKAGES,
    truncated: false,
    codeFacts: { availability: "ready", indexedWorktreeDigest: WORKTREE_DIGEST },
    ...overrides
  };
}

describe("evaluateDependencyConstraints", () => {
  test("a core -> runtime import through a workspace specifier is violated", () => {
    const evaluation = evaluateDependencyConstraints(input({ importEdges: [CORE_TO_CONTRACTS, CORE_TO_RUNTIME] }));

    expect(evaluation.status).toBe("violated");
    expect(evaluation.coverage).toBe("complete");
    expect(evaluation.reasonCodes).toEqual([]);
    // The source file is owned by the component; the scope names its parent module.
    expect(evaluation.violations).toEqual([{
      constraintId: "constraint.core-not-runtime",
      fromPath: "packages/core/review/src/index.ts",
      toPath: "packages/runtime/src/index.ts",
      fromNode: "component.core.review",
      toNode: "module.runtime",
      severity: "error"
    }]);
  });

  test("core -> contracts only is a pass over complete evidence", () => {
    const evaluation = evaluateDependencyConstraints(input());

    expect(evaluation.status).toBe("pass");
    expect(evaluation.coverage).toBe("complete");
    expect(evaluation.importEdgeCount).toBe(1);
    expect(evaluation.violations).toEqual([]);
  });

  test("no constraints is not-applicable, whatever the index says", () => {
    expect(evaluateDependencyConstraints(input({ constraints: [], importEdges: [CORE_TO_RUNTIME] })).status).toBe("not-applicable");
    const unobserved = evaluateDependencyConstraints(input({ constraints: [], codeFacts: { availability: "unavailable", indexedWorktreeDigest: null } }));
    expect(unobserved).toMatchObject({ status: "not-applicable", coverage: "unknown", reasonCodes: [], violations: [] });
  });

  test("an unavailable index is undetermined, never pass", () => {
    const evaluation = evaluateDependencyConstraints(input({ codeFacts: { availability: "unavailable", indexedWorktreeDigest: null } }));

    expect(evaluation.status).toBe("undetermined");
    expect(evaluation.coverage).toBe("unknown");
    expect(evaluation.reasonCodes).toEqual(["code-facts-unavailable"]);
    expect(evaluation.importEdgeCount).toBe(0);
  });

  test("an index certified for a different worktree is undetermined and its edges are not read", () => {
    const evaluation = evaluateDependencyConstraints(input({
      importEdges: [CORE_TO_RUNTIME],
      codeFacts: { availability: "ready", indexedWorktreeDigest: digestOf("worktree.other") }
    }));

    expect(evaluation.status).toBe("undetermined");
    expect(evaluation.reasonCodes).toEqual(["code-facts-stale"]);
    expect(evaluation.violations).toEqual([]);
  });

  test("a truncated import dump is undetermined", () => {
    const evaluation = evaluateDependencyConstraints(input({ truncated: true }));

    expect(evaluation.status).toBe("undetermined");
    expect(evaluation.coverage).toBe("partial");
    expect(evaluation.reasonCodes).toEqual(["code-facts-truncated"]);
  });

  test("an unreadable workspace package map is undetermined", () => {
    const evaluation = evaluateDependencyConstraints(input({ workspacePackages: [], workspacePackagesResolved: false }));

    expect(evaluation.status).toBe("undetermined");
    expect(evaluation.reasonCodes).toContain("workspace-resolution-failed");
  });

  test("a found violation stays violated over truncated evidence, with the reason attached", () => {
    const evaluation = evaluateDependencyConstraints(input({ importEdges: [CORE_TO_RUNTIME], truncated: true }));

    expect(evaluation.status).toBe("violated");
    expect(evaluation.reasonCodes).toEqual(["code-facts-truncated"]);
    expect(evaluation.violations).toHaveLength(1);
  });

  test("an unresolved workspace or relative import in a constrained file is undetermined", () => {
    const unresolvedWorkspace = evaluateDependencyConstraints(input({
      importEdges: [CORE_TO_CONTRACTS, { from: "packages/core/src/index.ts", specifier: "@archcontext/core/missing", to: null }]
    }));
    expect(unresolvedWorkspace.status).toBe("undetermined");
    expect(unresolvedWorkspace.reasonCodes).toEqual(["unresolved-import"]);
    expect(unresolvedWorkspace.unresolvedImports).toEqual([{ from: "packages/core/src/index.ts", specifier: "@archcontext/core/missing" }]);

    const unresolvedRelative = evaluateDependencyConstraints(input({
      importEdges: [{ from: "packages/core/review/src/index.ts", specifier: "../../gone", to: null }]
    }));
    expect(unresolvedRelative.status).toBe("undetermined");

    // Runtime and third-party specifiers are outside the repository, and a file no constraint
    // scopes cannot hide a violation, so neither makes the answer undetermined.
    const outside = evaluateDependencyConstraints(input({
      importEdges: [
        CORE_TO_CONTRACTS,
        { from: "packages/core/src/index.ts", specifier: "node:fs", to: null },
        { from: "packages/core/src/index.ts", specifier: "yaml", to: null },
        { from: "packages/runtime/src/index.ts", specifier: "./missing", to: null }
      ]
    }));
    expect(outside.status).toBe("pass");
  });

  test("a violation from a file that is not in HEAD is still violated", () => {
    const untracked = "packages/core/review/src/new-file.ts";
    const edge = { from: untracked, specifier: "../../../runtime/src/index", to: "packages/runtime/src/index.ts" };

    // A review hands over tracked plus untracked files.
    const worktreeAware = evaluateDependencyConstraints(input({ files: [...FILES, untracked], importEdges: [edge] }));
    expect(worktreeAware.status).toBe("violated");
    expect(worktreeAware.violations[0]).toMatchObject({ fromPath: untracked, fromNode: "component.core.review" });

    // Even a file list without it cannot hide it: every observed edge endpoint is owned.
    const headOnly = evaluateDependencyConstraints(input({ importEdges: [edge] }));
    expect(headOnly.status).toBe("violated");
  });

  test("a target importing itself is not a violation of a constraint scoped around it", () => {
    const evaluation = evaluateDependencyConstraints(input({
      constraints: [{ ...CORE_NOT_RUNTIME, id: "constraint.core-not-review", rule: { type: "forbid-dependency", targets: ["component.core.review"] } }],
      importEdges: [
        { from: "packages/core/review/src/index.ts", specifier: "../../src/index", to: "packages/core/src/index.ts" },
        { from: "packages/core/src/index.ts", specifier: "@archcontext/core/review", to: null }
      ]
    }));

    expect(evaluation.violations.map((violation) => `${violation.fromPath}->${violation.toPath}`))
      .toEqual(["packages/core/src/index.ts->packages/core/review/src/index.ts"]);
  });
});

describe("snapshot direction counts", () => {
  const RUNTIME_NOT_CORE: DependencyConstraintV1 = {
    id: "constraint.core-not-runtime",
    severity: "warning",
    scope: { nodes: ["module.core"] },
    rule: { type: "forbid-dependency", targets: ["module.runtime"] },
    rationale: "fixture"
  };

  test("empty or absent constraints leave the snapshot byte-identical to the pre-constraint shape", () => {
    const absent = buildModuleStatisticsSnapshot(makeInput());
    const empty = buildModuleStatisticsSnapshot(makeInput({ constraints: [] }));
    const byId = (left: { id: string }, right: { id: string }) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

    expect(JSON.stringify(empty)).toBe(JSON.stringify(absent));
    expect(absent.modelDigest).toBe(digestJson({
      nodes: [...MODEL.nodes].sort(byId),
      relations: [...MODEL.relations].sort(byId),
      flows: []
    } as unknown as Json));
    expect(absent.modules.every((module) => (module.dependencyGraph?.directionViolationCount ?? null) === null)).toBe(true);
  });

  test("declared constraints fill each measured module's direction count and join the model digest", () => {
    const absent = buildModuleStatisticsSnapshot(makeInput());
    // `component.shared` claims `packages/core/shared/**` but sits under `module.runtime`, so the
    // pressure engine's `../shared/util` import crosses from core into the runtime layer.
    const snapshot = buildModuleStatisticsSnapshot(makeInput({ constraints: [RUNTIME_NOT_CORE] }));

    expect(moduleStatisticsSnapshotInvariantIssues(snapshot)).toEqual([]);
    expect(snapshot.modelDigest).not.toBe(absent.modelDigest);
    const counts = Object.fromEntries(snapshot.modules.map((module) => [module.nodeId, module.dependencyGraph?.directionViolationCount ?? null]));
    expect(counts).toEqual({
      "component.pressure": 1,
      "component.shared": 0,
      "module.core": 0,
      "module.runtime": 0,
      "node.undeclared": null
    });
  });
});
