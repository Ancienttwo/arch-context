import { describe, expect, test } from "bun:test";
import type { NativeModel } from "../../projection-engine/src/index";
import { buildModuleStatisticsSnapshot, resolveOwnership } from "../src/index";
import { MODEL, TRACKED_FILES, makeInput } from "./factories";

const PATHS = TRACKED_FILES.map((file) => file.path);

describe("tracked file ownership under the PRD ancestor rule", () => {
  test("the deepest node on one parent chain owns the file, not the ancestor that also matches", () => {
    const ownership = resolveOwnership(MODEL.nodes, PATHS);

    // `packages/core/**` and `packages/core/pressure-engine/**` both match, and the component is a
    // descendant of the module, so the component owns it outright: no ambiguity, no double count.
    expect(ownership.byPath.get("packages/core/pressure-engine/engine.ts")).toEqual({
      owners: ["component.pressure"],
      ambiguous: false
    });
    expect(ownership.filesByNode.get("component.pressure")).toEqual(["packages/core/pressure-engine/engine.ts"]);
    // The module keeps only what no descendant took: `engine.ts` is gone, the contested
    // `shared/util.ts` stays because no descendant of `module.core` claims it.
    expect(ownership.filesByNode.get("module.core")).toEqual([
      "packages/core/index.ts",
      "packages/core/shared/util.ts"
    ]);
  });

  test("claimants that are not on one parent chain stay contested instead of being arbitrated", () => {
    const ownership = resolveOwnership(MODEL.nodes, PATHS);

    // `component.shared` sits under `module.runtime`, so it is not a descendant of `module.core`:
    // neither claim outranks the other and both keep the file.
    expect(ownership.byPath.get("packages/core/shared/util.ts")).toEqual({
      owners: ["component.shared", "module.core"],
      ambiguous: true
    });
    expect(ownership.multiplyOwnedFileCount).toBe(1);
    expect(ownership.filesByNode.get("component.shared")).toEqual(["packages/core/shared/util.ts"]);

    const snapshot = buildModuleStatisticsSnapshot(makeInput());
    const flagged = snapshot.modules.filter((module) => module.uncertainty.ambiguousOwnership).map((module) => module.nodeId);
    expect(flagged).toEqual(["component.shared", "module.core"]);
    expect(snapshot.codeFacts.reasonCodes).toContain("ownership-ambiguous");
  });

  test("source.exclude is applied before source.include, and unmatched paths stay unowned", () => {
    const ownership = resolveOwnership(MODEL.nodes, PATHS);

    // Excluded by `packages/core/**/test/**` even though `packages/core/**` matches.
    expect(ownership.byPath.get("packages/core/test/core.test.ts")).toEqual({ owners: [], ambiguous: false });
    expect(ownership.byPath.get("docs/readme.md")).toEqual({ owners: [], ambiguous: false });
    expect(ownership.unownedFileCount).toBe(2);
    expect(ownership.ownedFileCount).toBe(4);
    expect(ownership.ownedFileCount + ownership.unownedFileCount).toBe(PATHS.length);
  });

  test("a node without source.include declares no footprint and owns nothing", () => {
    const snapshot = buildModuleStatisticsSnapshot(makeInput());
    const undeclared = snapshot.modules.find((module) => module.nodeId === "node.undeclared")!;

    expect(undeclared.footprintDeclared).toBe(false);
    expect(undeclared.footprint).toBeNull();
    // Nothing was measured for it, so it reports no graph rather than a zero-filled one.
    expect(undeclared.dependencyGraph).toBeNull();
    expect(snapshot.repositorySummary.undeclaredFootprintNodeCount).toBe(1);
    expect(snapshot.codeFacts.reasonCodes).toContain("node-footprint-undeclared");
  });

  test("a declared footprint reports the tracked line counts and the verbatim patterns", () => {
    const snapshot = buildModuleStatisticsSnapshot(makeInput());
    const core = snapshot.modules.find((module) => module.nodeId === "module.core")!;

    expect(core.footprint).toMatchObject({
      fileCount: 2,
      // packages/core/index.ts (5) + the contested packages/core/shared/util.ts (7).
      lineCount: 12,
      includePatterns: ["packages/core/**"],
      excludePatterns: ["packages/core/**/test/**"]
    });
    expect(core.parentNodeId).toBeNull();
    expect(snapshot.modules.find((module) => module.nodeId === "component.pressure")!.parentNodeId).toBe("module.core");
  });

  test("a parent cycle in the model ends the ancestor walk instead of hanging the resolver", () => {
    const cyclic: NativeModel = {
      nodes: [
        { id: "a", kind: "module", name: "A", parent: "b", source: { include: ["src/**"] } },
        { id: "b", kind: "module", name: "B", parent: "a", source: { include: ["src/deep/**"] } }
      ],
      relations: []
    };
    const ownership = resolveOwnership(cyclic.nodes, ["src/deep/file.ts"]);
    expect(ownership.byPath.get("src/deep/file.ts")!.owners.length).toBeGreaterThan(0);
  });
});
