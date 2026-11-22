import { describe, expect, test } from "bun:test";
import { simulateRefactorPlan } from "../src/index";
import { CYCLE_EDGES, MODEL, WORKTREE_DIGEST, makeSnapshot, makeSnapshotInput, structureOf } from "./factories";

describe("simulateRefactorPlan (#638, P2 Invariant #3)", () => {
  test("computes honest measured deltas for whole-file moves and unmeasured status for symbol subsets and extract/invert", () => {
    const snapshot = makeSnapshot({ importEdges: CYCLE_EDGES });
    const structure = structureOf(snapshot);
    const snapInput = makeSnapshotInput({ importEdges: CYCLE_EDGES });

    const wholeFileMove = simulateRefactorPlan({
      snapshot,
      structure,
      model: MODEL,
      repository: snapInput.repository,
      worktree: snapInput.worktree,
      trackedFiles: snapInput.trackedFiles,
      importEdges: CYCLE_EDGES,
      workspacePackages: [],
      truncated: false,
      edgeLimit: 20_000,
      codeFacts: {
        version: snapshot.codeFacts.version,
        binaryDigest: snapshot.codeFacts.binaryDigest,
        availability: "ready",
        indexedWorktreeDigest: WORKTREE_DIGEST
      },
      createdAt: "2026-11-22T00:00:00.000Z",
      moves: [{ path: "src/m/a/x.ts", toNodeId: "module.c" }],
      targetSubject: "pair:component.a|module.c"
    });

    expect(wholeFileMove.measurementStatus).toBe("measured");
    expect(wholeFileMove.metricsDelta.before.crossModuleCycleCount).toBe(2);
    expect(wholeFileMove.metricsDelta.after?.crossModuleCycleCount).toBe(0);
    expect(wholeFileMove.metricsDelta.delta?.crossModuleCycleCount).toBe(-2);
    expect(wholeFileMove.resolvedCycles).toContain("component.a<->module.c");
    expect(wholeFileMove.privacy).toEqual({
      writes: "none",
      rawSourcePersisted: false,
      rawDiffPersisted: false,
      promptPersisted: false
    });

    const unmeasuredExtract = wholeFileMove.cutCandidates.find((c) => c.strategy === "extract-shared-leaf");
    const unmeasuredInvert = wholeFileMove.cutCandidates.find((c) => c.strategy === "invert-interface");
    expect(unmeasuredExtract).toMatchObject({
      measured: false,
      measurementStatus: "unmeasured",
      thinDirectionEdgeDelta: null,
      breaksPair: null
    });
    expect(unmeasuredInvert).toMatchObject({
      measured: false,
      measurementStatus: "unmeasured",
      thinDirectionEdgeDelta: null,
      breaksPair: null
    });

    const symbolSubset = simulateRefactorPlan({
      snapshot,
      structure,
      model: MODEL,
      repository: snapInput.repository,
      worktree: snapInput.worktree,
      trackedFiles: snapInput.trackedFiles,
      importEdges: CYCLE_EDGES,
      workspacePackages: [],
      truncated: false,
      edgeLimit: 20_000,
      codeFacts: {
        version: snapshot.codeFacts.version,
        binaryDigest: snapshot.codeFacts.binaryDigest,
        availability: "ready",
        indexedWorktreeDigest: WORKTREE_DIGEST
      },
      createdAt: "2026-11-22T00:00:00.000Z",
      moves: [{ path: "src/m/a/x.ts", toNodeId: "module.c", symbols: ["movedFn"] }],
      targetSubject: "pair:component.a|module.c"
    });

    expect(symbolSubset.measurementStatus).toBe("unmeasured");
    expect(symbolSubset.unmeasuredReasons).toContain("symbol-subset-rewrite-unmodeled");
    expect(symbolSubset.metricsDelta.after).toBeNull();
    expect(symbolSubset.metricsDelta.delta).toBeNull();
  });
});
