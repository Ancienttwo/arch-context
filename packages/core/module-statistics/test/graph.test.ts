import { describe, expect, test } from "bun:test";
import { buildModuleGraph, buildModuleStatisticsSnapshot } from "../src/index";
import { makeInput } from "./factories";

const NODE_IDS = ["module.a", "module.b", "module.c"];
const OWNERS = new Map([
  ["a1.ts", ["module.a"]],
  ["a2.ts", ["module.a"]],
  ["b1.ts", ["module.b"]],
  ["c1.ts", ["module.c"]],
  ["orphan.ts", []]
]);

describe("module import graph and strongly connected components", () => {
  test("counts internal, outbound and inbound edges separately from distinct peer fan", () => {
    const graph = buildModuleGraph(NODE_IDS, [
      { from: "a1.ts", to: "a2.ts" },
      { from: "a1.ts", to: "b1.ts" },
      { from: "a2.ts", to: "b1.ts" },
      { from: "a1.ts", to: "c1.ts" },
      { from: "b1.ts", to: "c1.ts" }
    ], OWNERS);

    const a = graph.countsByNode.get("module.a")!;
    // Two file edges cross into module.b but they reach only one peer module.
    expect(a).toMatchObject({ internalEdgeCount: 1, outboundModuleEdges: 3, inboundModuleEdges: 0, fanOut: 2, fanIn: 0 });
    expect(graph.countsByNode.get("module.c")).toMatchObject({ inboundModuleEdges: 2, fanIn: 2, fanOut: 0, outboundModuleEdges: 0 });
    // Distinct ordered module pairs: a->b, a->c, b->c.
    expect(graph.crossModuleEdgeCount).toBe(3);
  });

  test("an acyclic graph has no components, so every component id is null", () => {
    const graph = buildModuleGraph(NODE_IDS, [
      { from: "a1.ts", to: "b1.ts" },
      { from: "b1.ts", to: "c1.ts" }
    ], OWNERS);

    expect(graph.stronglyConnectedComponentCount).toBe(0);
    expect(graph.crossModuleCycleCount).toBe(0);
    for (const id of NODE_IDS) {
      expect(graph.countsByNode.get(id)!.stronglyConnectedComponentId).toBeNull();
      expect(graph.countsByNode.get(id)!.cycleCount).toBe(0);
    }
  });

  test("members of one cycle share a component id and count only the out-edges that stay inside it", () => {
    const graph = buildModuleGraph(NODE_IDS, [
      { from: "a1.ts", to: "b1.ts" },
      { from: "b1.ts", to: "a1.ts" },
      { from: "a1.ts", to: "c1.ts" }
    ], OWNERS);

    const componentId = graph.countsByNode.get("module.a")!.stronglyConnectedComponentId;
    expect(componentId).toMatch(/^scc\.[a-f0-9]{16}$/);
    expect(graph.countsByNode.get("module.b")!.stronglyConnectedComponentId).toBe(componentId);
    expect(graph.countsByNode.get("module.c")!.stronglyConnectedComponentId).toBeNull();
    expect(graph.stronglyConnectedComponentCount).toBe(1);
    // module.a has two out-edges; only the one to module.b closes back into its own component.
    expect(graph.countsByNode.get("module.a")!.cycleCount).toBe(1);
    expect(graph.countsByNode.get("module.b")!.cycleCount).toBe(1);
    expect(graph.countsByNode.get("module.c")!.cycleCount).toBe(0);
    expect(graph.crossModuleCycleCount).toBe(2);
  });

  test("the component id is derived from the member set, so it survives node ordering", () => {
    const edges = [{ from: "a1.ts", to: "b1.ts" }, { from: "b1.ts", to: "a1.ts" }];
    const forward = buildModuleGraph(NODE_IDS, edges, OWNERS);
    const reversed = buildModuleGraph([...NODE_IDS].reverse(), edges, OWNERS);
    expect(reversed.countsByNode.get("module.a")!.stronglyConnectedComponentId)
      .toBe(forward.countsByNode.get("module.a")!.stronglyConnectedComponentId);
  });

  test("a self-loop is a non-trivial one-member component, an internal edge is not", () => {
    const internalOnly = buildModuleGraph(NODE_IDS, [{ from: "a1.ts", to: "a2.ts" }], OWNERS);
    // Two files of the same module: one module-level self edge, which does close a cycle on itself.
    expect(internalOnly.countsByNode.get("module.a")).toMatchObject({ internalEdgeCount: 1, cycleCount: 1 });
    expect(internalOnly.countsByNode.get("module.a")!.stronglyConnectedComponentId).toMatch(/^scc\./);
    expect(internalOnly.stronglyConnectedComponentCount).toBe(1);
    // A self-loop is never a cross-module pair.
    expect(internalOnly.crossModuleEdgeCount).toBe(0);
    expect(internalOnly.crossModuleCycleCount).toBe(0);
  });

  test("edges touching an unowned file are dropped rather than attributed to a guess", () => {
    const graph = buildModuleGraph(NODE_IDS, [
      { from: "orphan.ts", to: "a1.ts" },
      { from: "a1.ts", to: "orphan.ts" },
      { from: "a1.ts", to: "unknown.ts" }
    ], OWNERS);
    expect(graph.crossModuleEdgeCount).toBe(0);
    expect(graph.countsByNode.get("module.a")).toMatchObject({ inboundModuleEdges: 0, outboundModuleEdges: 0, internalEdgeCount: 0 });
  });

  test("a contested file feeds every claimant instead of one arbitrary winner", () => {
    const contested = new Map([["shared.ts", ["module.a", "module.b"]], ["c1.ts", ["module.c"]]]);
    const graph = buildModuleGraph(NODE_IDS, [{ from: "shared.ts", to: "c1.ts" }], contested);
    expect(graph.countsByNode.get("module.a")).toMatchObject({ outboundModuleEdges: 1, fanOut: 1 });
    expect(graph.countsByNode.get("module.b")).toMatchObject({ outboundModuleEdges: 1, fanOut: 1 });
    expect(graph.countsByNode.get("module.c")).toMatchObject({ inboundModuleEdges: 2, fanIn: 2 });
  });

  test("the snapshot carries the measured graph and leaves instability unmeasured", () => {
    const snapshot = buildModuleStatisticsSnapshot(makeInput());
    const runtime = snapshot.modules.find((module) => module.nodeId === "module.runtime")!;

    expect(runtime.dependencyGraph).toMatchObject({
      instability: null,
      directionViolationCount: null,
      inboundModuleEdges: 0
    });
    // packages/runtime/main.ts imports packages/core/index.ts (module.core) and
    // packages/core/shared/util.ts (module.core and component.shared).
    expect(runtime.dependencyGraph!.outboundModuleEdges).toBe(3);
    expect(runtime.dependencyGraph!.fanOut).toBe(2);
    expect(snapshot.repositorySummary.crossModuleEdgeCount).toBe(graphPairCount(snapshot));
  });
});

function graphPairCount(snapshot: ReturnType<typeof buildModuleStatisticsSnapshot>): number {
  return snapshot.modules.reduce((total, module) => total + (module.dependencyGraph?.fanOut ?? 0), 0);
}
