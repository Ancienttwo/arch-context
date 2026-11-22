import { describe, expect, test } from "bun:test";
import {
  buildModuleStatisticsSnapshot,
  computeInstability,
  detectCoChangeCoupling,
  detectEntrypointBypasses,
  detectLowCohesionGodFiles,
  measureCapabilityDependencies,
  measureModuleStatistics,
  resolveOwnership
} from "../src/index";
import { makeInput } from "./factories";

describe("module-statistics #636 / #637 pure graph intelligence", () => {
  test("computes instability and test caller coverage cleanly when structuralFacts are supplied", () => {
    expect(computeInstability(0, 0)).toBeNull();
    expect(computeInstability(3, 2)).toBe(0.4);

    const base = makeInput();
    const measurement = measureModuleStatistics({
      ...base,
      trackedFiles: [
        ...base.trackedFiles,
        { path: "packages/runtime/test/main.test.ts", lineCount: 10 }
      ],
      importEdges: [
        ...base.importEdges,
        { from: "packages/runtime/test/main.test.ts", specifier: "../main", to: "packages/runtime/main.ts" }
      ],
      structuralFacts: {
        coverage: "complete",
        reasonCodes: [],
        callEdges: [
          {
            fromPath: "packages/runtime/test/main.test.ts",
            toPath: "packages/runtime/main.ts",
            fromSymbol: "testMain",
            toSymbol: "startRuntime",
            kind: "calls"
          }
        ],
        callEdgeCount: 1,
        callEdgeLimit: 128_000,
        callEdgeLimitExceeded: false,
        fileStructures: [
          {
            path: "packages/runtime/main.ts",
            lineCount: 120,
            topLevelSymbols: [],
            intraFileEdges: []
          }
        ]
      }
    });

    const runtime = measurement.snapshot.modules.find((m) => m.nodeId === "module.runtime")!;
    expect(runtime.tests.coverageStatus).toBe("measured");
    expect(runtime.tests.observedTestEdges).toBe(2);
    expect(runtime.tests.callerCoverage).toBeGreaterThan(0);
    expect(measurement.snapshot.codeFacts.reasonCodes).not.toContain("caller-coverage-unknown");
  });

  test("detectLowCohesionGodFiles finds AST disconnected components without regexes", () => {
    const nodes = [
      { id: "component.a", kind: "component" as const, name: "A", summary: "A", status: "active" as const, source: { include: ["packages/a/**"] } }
    ];
    const ownership = resolveOwnership(nodes as any, ["packages/a/god.ts", "packages/a/test/god.test.ts"]);
    const map = detectLowCohesionGodFiles([
      {
        path: "packages/a/god.ts",
        lineCount: 450,
        topLevelSymbols: Array.from({ length: 8 }, (_, index) => ({
          name: `sym${index}`,
          qualifiedName: `sym${index}`,
          kind: "function",
          startLine: index * 50 + 1,
          endLine: index * 50 + 40,
          isExported: true
        })),
        intraFileEdges: [
          { from: "sym0", to: "sym1" },
          { from: "sym1", to: "sym2" },
          { from: "sym4", to: "sym5" },
          { from: "sym5", to: "sym6" }
        ]
      },
      {
        path: "packages/a/test/god.test.ts",
        lineCount: 900,
        topLevelSymbols: Array.from({ length: 12 }, (_, index) => ({
          name: `t${index}`,
          qualifiedName: `t${index}`,
          kind: "function",
          startLine: index * 20 + 1,
          endLine: index * 20 + 15,
          isExported: false
        })),
        intraFileEdges: []
      }
    ], ownership);

    const finding = map.get("component.a")!;
    expect(finding.measuredFileCount).toBe(1);
    expect(finding.files).toHaveLength(1);
    expect(finding.files[0]!.clusterCount).toBe(2);
  });

  test("detectEntrypointBypasses flags non-entrypoint cross-module imports only", () => {
    const nodes = [
      { id: "component.a", kind: "component" as const, name: "A", summary: "A", status: "active" as const, source: { include: ["packages/a/**"] } },
      {
        id: "component.b",
        kind: "component" as const,
        name: "B",
        summary: "B",
        status: "active" as const,
        source: {
          include: ["packages/b/**"],
          entrypoints: [{ id: "entrypoint.b", path: "packages/b/index.ts", symbols: [] }]
        }
      }
    ];
    const ownership = resolveOwnership(nodes as any, ["packages/a/main.ts", "packages/b/index.ts", "packages/b/internal.ts"]);
    const bypasses = detectEntrypointBypasses(nodes as any, ownership, [
      { from: "packages/a/main.ts", to: "packages/b/index.ts", specifier: "@b" },
      { from: "packages/a/main.ts", to: "packages/b/internal.ts", specifier: "@b/internal", line: 2 }
    ]);
    expect(bypasses.get("component.b")?.edges).toHaveLength(1);
    expect(bypasses.get("component.b")?.edges[0]?.toPath).toBe("packages/b/internal.ts");
  });

  test("detectCoChangeCoupling stays fail-closed unless git history is complete", () => {
    const nodes = [
      { id: "component.a", kind: "component" as const, name: "A", summary: "A", status: "active" as const, source: { include: ["packages/a/**"] } },
      { id: "component.b", kind: "component" as const, name: "B", summary: "B", status: "active" as const, source: { include: ["packages/b/**"] } }
    ];
    const ownership = resolveOwnership(nodes as any, ["packages/a/one.ts", "packages/b/two.ts"]);

    const shallow = detectCoChangeCoupling({
      coverageStatus: "shallow",
      windowLimit: 200,
      minHistoryCommits: 5,
      maxFilesPerCommit: 20,
      observedCommitCount: 0,
      skippedBulkCommitCount: 0,
      commits: [{ commitSha: "a".repeat(40), paths: ["packages/a/one.ts", "packages/b/two.ts"] }]
    }, ownership);
    expect(shallow.findings).toEqual([]);
    expect(shallow.window?.isShallow).toBe(true);

    const complete = detectCoChangeCoupling({
      coverageStatus: "complete",
      windowLimit: 200,
      minHistoryCommits: 5,
      maxFilesPerCommit: 20,
      observedCommitCount: 6,
      skippedBulkCommitCount: 0,
      commits: Array.from({ length: 5 }, (_, index) => ({
        commitSha: `${index}`.repeat(40),
        paths: ["packages/a/one.ts", "packages/b/two.ts"]
      }))
    }, ownership);
    expect(complete.findings).toHaveLength(1);
    expect(complete.findings[0]?.pairs[0]?.coChangeCount).toBe(5);
  });

  test("measureCapabilityDependencies populates bounded call counts when callFacts are supplied", () => {
    const base = makeInput();
    const deps = measureCapabilityDependencies({
      nodes: [
        { id: "capability.runtime", kind: "capability", name: "Runtime", summary: "Runtime", status: "active", source: { include: ["packages/runtime/**"] } },
        { id: "capability.core", kind: "capability", name: "Core", summary: "Core", status: "active", source: { include: ["packages/core/**"] } }
      ] as any,
      relations: [],
      worktreeDigest: base.worktree.worktreeDigest,
      files: base.trackedFiles.map((file) => file.path),
      importEdges: base.importEdges,
      workspacePackages: base.workspacePackages,
      truncated: false,
      importNodeCount: base.importEdges.length,
      importNodeLimit: 64_000,
      importNodeLimitExceeded: false,
      codeFacts: base.codeFacts,
      callFacts: {
        coverage: "partial",
        reasonCodes: ["code-facts-call-limit"],
        edgeCount: 2,
        edgeLimit: 2,
        limitExceeded: true,
        callEdges: [
          { fromPath: "packages/runtime/main.ts", toPath: "packages/core/index.ts" },
          { fromPath: "packages/runtime/main.ts", toPath: "packages/core/index.ts" }
        ]
      }
    });
    expect(deps.calls).toEqual({
      coverage: "partial",
      reasonCodes: ["code-facts-call-limit"],
      edgeCount: 2,
      edgeLimit: 2,
      limitExceeded: true
    });
    const cell = deps.matrix.find((entry) => entry.from === "capability.runtime" && entry.to === "capability.core")!;
    expect(cell.calls).toBe(2);
  });
});
