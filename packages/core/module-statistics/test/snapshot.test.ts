import { describe, expect, test } from "bun:test";
import {
  MODULE_STATISTICS_SCHEMA_VERSION,
  moduleStatisticsSnapshotInvariantIssues,
  type ModuleStatisticsSnapshotV1
} from "@archcontext/contracts";
import { buildModuleStatisticsSnapshot } from "../src/index";
import { WORKTREE_DIGEST, digestOf, makeInput } from "./factories";

function issues(snapshot: ModuleStatisticsSnapshotV1): string[] {
  return moduleStatisticsSnapshotInvariantIssues(snapshot);
}

describe("module statistics snapshot", () => {
  test("two builds of the same input are byte-identical JSON", () => {
    const first = buildModuleStatisticsSnapshot(makeInput());
    const second = buildModuleStatisticsSnapshot(makeInput());

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second.snapshotDigest).toBe(first.snapshotDigest);
    expect(first.snapshotDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test("input ordering does not change the snapshot, but a measured value does", () => {
    const base = makeInput();
    const shuffled = buildModuleStatisticsSnapshot(makeInput({
      model: { ...base.model, nodes: [...base.model.nodes].reverse() },
      trackedFiles: [...base.trackedFiles].reverse(),
      importEdges: [...base.importEdges].reverse()
    }));
    expect(shuffled.snapshotDigest).toBe(buildModuleStatisticsSnapshot(base).snapshotDigest);

    const changed = buildModuleStatisticsSnapshot(makeInput({
      trackedFiles: base.trackedFiles.map((file) => file.path === "packages/core/index.ts" ? { ...file, lineCount: 6 } : file)
    }));
    expect(changed.snapshotDigest).not.toBe(shuffled.snapshotDigest);
  });

  test("createdAt is carried but excluded from snapshot identity", () => {
    const early = buildModuleStatisticsSnapshot(makeInput({ createdAt: "2026-01-01T00:00:00.000Z" }));
    const late = buildModuleStatisticsSnapshot(makeInput({ createdAt: "2026-12-31T23:59:59.000Z" }));
    expect(early.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(late.snapshotDigest).toBe(early.snapshotDigest);
  });

  test("a complete measurement satisfies the frozen validator", () => {
    const snapshot = buildModuleStatisticsSnapshot(makeInput());

    expect(issues(snapshot)).toEqual([]);
    expect(snapshot.schemaVersion).toBe(MODULE_STATISTICS_SCHEMA_VERSION);
    expect(snapshot.codeFacts).toMatchObject({
      provider: "codegraph",
      coverage: "complete",
      truncated: false,
      indexedWorktreeDigest: WORKTREE_DIGEST,
      edgeLimit: 20000
    });
    expect(snapshot.modules.map((module) => module.nodeId)).toEqual([
      "component.pressure",
      "component.shared",
      "module.core",
      "module.runtime",
      "node.undeclared"
    ]);
    expect(snapshot.repositorySummary).toMatchObject({
      moduleCount: 5,
      undeclaredFootprintNodeCount: 1,
      ownedFileCount: 4,
      unownedFileCount: 2,
      multiplyOwnedFileCount: 1,
      unresolvedImportCount: 1,
      dynamicInvocationRiskCount: 5
    });
  });

  test("a saturated edge dump reports partial coverage and stays valid", () => {
    const snapshot = buildModuleStatisticsSnapshot(makeInput({ truncated: true }));

    expect(issues(snapshot)).toEqual([]);
    expect(snapshot.codeFacts.coverage).toBe("partial");
    expect(snapshot.codeFacts.truncated).toBe(true);
    expect(snapshot.codeFacts.indexedWorktreeDigest).toBe(WORKTREE_DIGEST);
    expect(snapshot.codeFacts.reasonCodes).toContain("code-facts-truncated");
    // A partial edge set is still a measurement, so the graph is reported.
    expect(snapshot.modules.find((module) => module.nodeId === "module.core")!.dependencyGraph).not.toBeNull();
  });

  test("a missing index yields unknown coverage, no digest, and no dependency graph anywhere", () => {
    const snapshot = buildModuleStatisticsSnapshot(makeInput({
      codeFacts: { ...makeInput().codeFacts, availability: "unavailable" },
      importEdges: []
    }));

    expect(issues(snapshot)).toEqual([]);
    expect(snapshot.codeFacts.coverage).toBe("unknown");
    expect(snapshot.codeFacts.truncated).toBe(true);
    expect(snapshot.codeFacts.indexedWorktreeDigest).toBeNull();
    expect(snapshot.codeFacts.reasonCodes).toContain("code-facts-missing");
    expect(snapshot.modules.every((module) => module.dependencyGraph === null)).toBe(true);
    expect(snapshot.repositorySummary).toMatchObject({
      crossModuleEdgeCount: 0,
      crossModuleCycleCount: 0,
      stronglyConnectedComponentCount: 0
    });
    // The footprint is Git-measured, so it survives an unusable index.
    expect(snapshot.modules.find((module) => module.nodeId === "module.core")!.footprint).not.toBeNull();
  });

  test("an index built against a different worktree is not treated as fresh evidence", () => {
    const snapshot = buildModuleStatisticsSnapshot(makeInput({
      codeFacts: { ...makeInput().codeFacts, indexFreshForWorktreeDigest: digestOf("worktree.other") }
    }));

    expect(issues(snapshot)).toEqual([]);
    expect(snapshot.codeFacts.coverage).toBe("unknown");
    expect(snapshot.codeFacts.indexedWorktreeDigest).toBeNull();
    expect(snapshot.codeFacts.reasonCodes).toContain("code-facts-missing");

    const never = buildModuleStatisticsSnapshot(makeInput({
      codeFacts: { ...makeInput().codeFacts, indexFreshForWorktreeDigest: null }
    }));
    expect(never.codeFacts.coverage).toBe("unknown");
  });

  test("v1 reports no test evidence and no caller coverage, and says so in the reason codes", () => {
    const snapshot = buildModuleStatisticsSnapshot(makeInput());

    for (const module of snapshot.modules) {
      expect(module.tests).toEqual({
        testFileCount: null,
        observedTestEdges: null,
        callerCoverage: null,
        coverageStatus: "unknown"
      });
      expect(module.uncertainty.dynamicInvocation).toBe("unknown");
    }
    expect(snapshot.codeFacts.reasonCodes).toContain("caller-coverage-unknown");
    expect(snapshot.repositorySummary.dynamicInvocationRiskCount).toBe(snapshot.modules.length);
  });

  test("reason codes are sorted, unique, and drawn from the frozen vocabulary", () => {
    const snapshot = buildModuleStatisticsSnapshot(makeInput({ truncated: true }));

    expect(snapshot.codeFacts.reasonCodes).toEqual([
      "caller-coverage-unknown",
      "code-facts-truncated",
      "node-footprint-undeclared",
      "ownership-ambiguous",
      "unowned-paths"
    ]);
  });

  test("unresolved specifiers are attributed to the owning module and to the repository total", () => {
    const snapshot = buildModuleStatisticsSnapshot(makeInput());
    const core = snapshot.modules.find((module) => module.nodeId === "module.core")!;

    // packages/core/index.ts carries the one unresolved specifier and is owned by module.core.
    expect(core.uncertainty.unresolvedImports).toBe(1);
    expect(snapshot.modules.find((module) => module.nodeId === "module.runtime")!.uncertainty.unresolvedImports).toBe(0);
    expect(snapshot.repositorySummary.unresolvedImportCount).toBe(1);
  });

  test("a model with no declared footprint at all still produces a valid snapshot", () => {
    const snapshot = buildModuleStatisticsSnapshot(makeInput({
      model: { nodes: [{ id: "module.only", kind: "module", name: "Only" }], relations: [] },
      importEdges: []
    }));

    expect(issues(snapshot)).toEqual([]);
    expect(snapshot.repositorySummary).toMatchObject({
      moduleCount: 1,
      undeclaredFootprintNodeCount: 1,
      ownedFileCount: 0,
      unownedFileCount: 6,
      multiplyOwnedFileCount: 0
    });
    expect(snapshot.codeFacts.reasonCodes).toContain("unowned-paths");
  });

  test("an empty repository produces a valid, empty snapshot rather than failing", () => {
    const snapshot = buildModuleStatisticsSnapshot(makeInput({
      model: { nodes: [], relations: [] },
      trackedFiles: [],
      importEdges: []
    }));

    expect(issues(snapshot)).toEqual([]);
    expect(snapshot.modules).toEqual([]);
    expect(snapshot.repositorySummary.moduleCount).toBe(0);
  });

  test("the footprint is a digest over paths and counts, never file bodies", () => {
    const snapshot = buildModuleStatisticsSnapshot(makeInput());
    const core = snapshot.modules.find((module) => module.nodeId === "module.core")!;

    expect(core.footprint!.sourceFilesDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    // Changing a file's measured size changes the digest; the bodies themselves never appear.
    const grown = buildModuleStatisticsSnapshot(makeInput({
      trackedFiles: makeInput().trackedFiles.map((file) => file.path === "packages/core/index.ts" ? { ...file, lineCount: 6 } : file)
    }));
    expect(grown.modules.find((module) => module.nodeId === "module.core")!.footprint!.sourceFilesDigest)
      .not.toBe(core.footprint!.sourceFilesDigest);
  });
});
