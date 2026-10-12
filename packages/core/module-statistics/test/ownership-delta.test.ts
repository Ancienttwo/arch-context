import { describe, expect, test } from "bun:test";
import type { NativeNode } from "@archcontext/core/projection-engine";
import { ownershipDelta } from "../src/index";
import { MODEL, TRACKED_FILES } from "./factories";

const PATHS = TRACKED_FILES.map((file) => file.path);

function withNode(nodes: NativeNode[], node: NativeNode): NativeNode[] {
  return [...nodes.filter((existing) => existing.id !== node.id), node];
}

describe("ownership delta of a planned model (#301)", () => {
  test("a new include that overlaps another chain reports the file as newly contested", () => {
    // `module.runtime` is not on `module.core`'s chain, so claiming `packages/core/index.ts` contests it.
    const after = withNode(MODEL.nodes, {
      id: "module.runtime",
      kind: "module",
      name: "Runtime",
      source: { include: ["packages/runtime/**", "packages/core/index.ts"] }
    });
    const delta = ownershipDelta(MODEL.nodes, after, PATHS);
    expect(delta.changedNodeIds).toEqual(["module.runtime"]);
    expect(delta.becameContested).toEqual({
      count: 1,
      files: [{ path: "packages/core/index.ts", before: ["module.core"], after: ["module.core", "module.runtime"] }],
      omittedCount: 0
    });
    expect(delta.before.multiplyOwnedFileCount).toBe(1);
    expect(delta.after.multiplyOwnedFileCount).toBe(2);
    expect(delta.becameOwned.count).toBe(0);
    expect(delta.ownerChanged.count).toBe(0);
    expect(delta.becameUnowned.count).toBe(0);
  });

  test("an include on an unowned file reports it as newly owned, a descendant include as an owner change", () => {
    const after = withNode(
      withNode(MODEL.nodes, { id: "component.tools", kind: "component", name: "Tools", source: { include: ["packages/tools/**"] } }),
      { id: "component.index", kind: "component", name: "Index", parent: "module.core", source: { include: ["packages/core/index.ts"] } }
    );
    const delta = ownershipDelta(MODEL.nodes, after, PATHS);
    expect(delta.changedNodeIds).toEqual(["component.index", "component.tools"]);
    expect(delta.becameOwned.files).toEqual([{ path: "packages/tools/gen.ts", before: [], after: ["component.tools"] }]);
    // The new component sits on `module.core`'s chain, so the deepest node takes the file outright.
    expect(delta.ownerChanged.files).toEqual([{ path: "packages/core/index.ts", before: ["module.core"], after: ["component.index"] }]);
    expect(delta.becameContested.count).toBe(0);
  });

  test("deleting a node with a footprint reports the files it alone owned as newly unowned", () => {
    const after = MODEL.nodes.filter((node) => node.id !== "component.pressure");
    const delta = ownershipDelta(MODEL.nodes, after, PATHS);
    expect(delta.changedNodeIds).toEqual(["component.pressure"]);
    // `module.core` still claims the pressure files, so they change owner rather than become unowned.
    expect(delta.ownerChanged.files.map((file) => file.path)).toEqual([
      "packages/core/pressure-engine/engine.ts",
      "packages/core/pressure-engine/src/index.ts"
    ]);
    const withoutRuntime = MODEL.nodes.filter((node) => node.id !== "module.runtime");
    const runtimeDelta = ownershipDelta(MODEL.nodes, withoutRuntime, PATHS);
    expect(runtimeDelta.becameUnowned.files).toEqual([{ path: "packages/runtime/main.ts", before: ["module.runtime"], after: [] }]);
  });

  test("a body change that does not touch include, exclude or parent reports no change", () => {
    const after = MODEL.nodes.map((node) => (node.id === "module.core" ? { ...node, name: "Core renamed" } : node));
    const delta = ownershipDelta(MODEL.nodes, after, PATHS);
    expect(delta.changedNodeIds).toEqual([]);
    expect(delta.before).toEqual(delta.after);
    for (const category of [delta.becameOwned, delta.becameContested, delta.ownerChanged, delta.becameUnowned]) {
      expect(category).toEqual({ count: 0, files: [], omittedCount: 0 });
    }
  });

  test("each category lists at most pathLimit files and keeps the full count", () => {
    const paths = Array.from({ length: 7 }, (_, index) => `packages/tools/file-${index}.ts`);
    const after = withNode(MODEL.nodes, { id: "component.tools", kind: "component", name: "Tools", source: { include: ["packages/tools/**"] } });
    const delta = ownershipDelta(MODEL.nodes, after, paths, 3);
    expect(delta.pathLimit).toBe(3);
    expect(delta.becameOwned.count).toBe(7);
    expect(delta.becameOwned.files.map((file) => file.path)).toEqual(paths.slice(0, 3));
    expect(delta.becameOwned.omittedCount).toBe(4);
  });
});
