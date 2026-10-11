import { describe, expect, test } from "bun:test";
import {
  deepestOnOneParentChain,
  globLiteralPrefixLength,
  matchesGlob,
  resolveArchitectureOwnerForPath,
  resolveArchitectureOwnersForPaths,
  type NativeNode
} from "../src/index";

function node(id: string, include: string[], exclude?: string[]): NativeNode {
  return {
    id,
    kind: "capability",
    name: id,
    source: { include, ...(exclude ? { exclude } : {}) }
  };
}

describe("matchesGlob / globLiteralPrefixLength", () => {
  test("`**` matches any depth under a directory prefix", () => {
    expect(matchesGlob("packages/core/projection-engine/src/index.ts", "packages/core/projection-engine/**")).toBe(true);
    expect(matchesGlob("packages/core/other/src/index.ts", "packages/core/projection-engine/**")).toBe(false);
  });

  test("a literal pattern with no wildcard requires an exact match", () => {
    expect(matchesGlob("scripts/inspect-project-state.ts", "scripts/inspect-project-state.ts")).toBe(true);
    expect(matchesGlob("scripts/inspect-project-state.ts.bak", "scripts/inspect-project-state.ts")).toBe(false);
  });

  test("literal prefix length stops at the first wildcard", () => {
    expect(globLiteralPrefixLength("packages/core/projection-engine/**")).toBe("packages/core/projection-engine/".length);
    expect(globLiteralPrefixLength("scripts/inspect-project-state.ts")).toBe("scripts/inspect-project-state.ts".length);
  });
});

describe("resolveArchitectureOwnerForPath (ADR-0043 tie-break)", () => {
  test("matches the single node whose include glob covers the path", () => {
    const nodes = [node("capability.a", ["packages/a/**"])];
    const result = resolveArchitectureOwnerForPath(nodes, "packages/a/src/index.ts");
    expect(result.status).toBe("matched");
    if (result.status === "matched") expect(result.node.id).toBe("capability.a");
  });

  test("source.exclude overrides a matching source.include for the same node", () => {
    const nodes = [node("capability.a", ["packages/a/**"], ["packages/a/generated/**"])];
    const result = resolveArchitectureOwnerForPath(nodes, "packages/a/generated/output.ts");
    expect(result.status).toBe("no-match");
  });

  test("equal-specificity include globs across two nodes reject as ambiguous", () => {
    const nodes = [node("capability.a", ["packages/shared/**"]), node("capability.b", ["packages/shared/**"])];
    const result = resolveArchitectureOwnerForPath(nodes, "packages/shared/utils.ts");
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates.map((candidate) => candidate.id).sort()).toEqual(["capability.a", "capability.b"]);
    }
  });

  test("no node's include glob covers the path", () => {
    const nodes = [node("capability.a", ["packages/a/**"])];
    const result = resolveArchitectureOwnerForPath(nodes, "docs/unrelated.md");
    expect(result.status).toBe("no-match");
  });

  test("the more specific (longer literal prefix) include wins over a broader sibling, not ambiguous", () => {
    const nodes = [node("capability.broad", ["packages/**"]), node("capability.narrow", ["packages/core/projection-engine/**"])];
    const result = resolveArchitectureOwnerForPath(nodes, "packages/core/projection-engine/src/index.ts");
    expect(result.status).toBe("matched");
    if (result.status === "matched") expect(result.node.id).toBe("capability.narrow");
  });

  test("a node with no source field owns no paths and never participates", () => {
    const nodes: NativeNode[] = [{ id: "capability.no-source", kind: "capability", name: "No Source" }];
    const result = resolveArchitectureOwnerForPath(nodes, "packages/a/src/index.ts");
    expect(result.status).toBe("no-match");
  });

  test("a node with an empty include list owns no paths", () => {
    const nodes = [node("capability.empty", [])];
    const result = resolveArchitectureOwnerForPath(nodes, "packages/a/src/index.ts");
    expect(result.status).toBe("no-match");
  });
});

function childNode(id: string, kind: string, parent: string | undefined, include: string[]): NativeNode {
  return { id, kind, name: id, ...(parent ? { parent } : {}), ...(include.length > 0 ? { source: { include } } : {}) };
}

describe("resolveArchitectureOwnerForPath (parent-chain rule, issue #296)", () => {
  test("a component whose glob shares its parent capability's literal prefix owns the file, not ambiguous", () => {
    const nodes = [
      childNode("capability.app", "capability", undefined, ["packages/app/**"]),
      childNode("component.app.api", "component", "capability.app", ["packages/app/**/api/**"])
    ];
    const result = resolveArchitectureOwnerForPath(nodes, "packages/app/src/api/handler.ts");
    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.node.id).toBe("component.app.api");
      expect(result.owningCapabilityId).toBe("capability.app");
    }
  });

  test("on one parent chain the deepest node wins even when its ancestor's glob is more specific", () => {
    const nodes = [
      childNode("capability.app", "capability", undefined, ["packages/app/src/api/handler.ts"]),
      childNode("component.app.api", "component", "capability.app", ["packages/app/**"])
    ];
    const result = resolveArchitectureOwnerForPath(nodes, "packages/app/src/api/handler.ts");
    expect(result.status).toBe("matched");
    if (result.status === "matched") expect(result.node.id).toBe("component.app.api");
  });

  test("equal-specificity candidates on different parent chains stay ambiguous", () => {
    const nodes = [
      childNode("capability.a", "capability", undefined, ["packages/shared/**"]),
      childNode("component.a.part", "component", "capability.a", ["packages/shared/**/part/**"]),
      childNode("capability.b", "capability", undefined, ["packages/shared/**"])
    ];
    const result = resolveArchitectureOwnerForPath(nodes, "packages/shared/x/part/file.ts");
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      // `capability.a` yields to its own component; the component and `capability.b` still tie.
      expect(result.candidates.map((candidate) => candidate.id).sort()).toEqual(["capability.b", "component.a.part"]);
      expect(result.owningCapabilityId).toBeNull();
    }
  });

  test("across chains an ancestor yields to its own descendant before the literal-prefix tie-break", () => {
    const nodes = [
      childNode("capability.catch-all", "capability", undefined, ["packages/**"]),
      childNode("capability.app", "capability", undefined, ["packages/app/**"]),
      childNode("component.app.api", "component", "capability.app", ["packages/app/**/api/**"])
    ];
    const result = resolveArchitectureOwnerForPath(nodes, "packages/app/src/api/handler.ts");
    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.node.id).toBe("component.app.api");
      expect(result.owningCapabilityId).toBe("capability.app");
    }
  });

  test("sibling components that tie report the capability they share", () => {
    const nodes = [
      childNode("capability.app", "capability", undefined, ["packages/app/**"]),
      childNode("component.app.left", "component", "capability.app", ["packages/app/shared/**"]),
      childNode("component.app.right", "component", "capability.app", ["packages/app/shared/**"])
    ];
    const result = resolveArchitectureOwnerForPath(nodes, "packages/app/shared/util.ts");
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates.map((candidate) => candidate.id).sort()).toEqual(["component.app.left", "component.app.right"]);
      expect(result.owningCapabilityId).toBe("capability.app");
    }
  });

  test("the owning capability is the nearest capability on the parent chain, or null without one", () => {
    const nodes = [
      childNode("capability.outer", "capability", undefined, []),
      childNode("capability.inner", "capability", "capability.outer", ["packages/inner/**"]),
      childNode("module.inner.core", "module", "capability.inner", []),
      childNode("component.inner.core.engine", "component", "module.inner.core", ["packages/inner/engine/**"]),
      childNode("module.loose", "module", undefined, ["packages/loose/**"])
    ];
    const [engine, inner, loose, none] = resolveArchitectureOwnersForPaths(nodes, [
      "packages/inner/engine/run.ts",
      "packages/inner/index.ts",
      "packages/loose/index.ts",
      "docs/readme.md"
    ]);
    expect(engine.status === "matched" && engine.node.id).toBe("component.inner.core.engine");
    expect(engine.owningCapabilityId).toBe("capability.inner");
    expect(inner.status === "matched" && inner.node.id).toBe("capability.inner");
    expect(inner.owningCapabilityId).toBe("capability.inner");
    expect(loose.status === "matched" && loose.node.id).toBe("module.loose");
    expect(loose.owningCapabilityId).toBeNull();
    expect(none).toEqual({ status: "no-match", owningCapabilityId: null });
  });

  test("a batch returns one result per input path, in input order, equal to the single-path form", () => {
    const nodes = [
      childNode("capability.app", "capability", undefined, ["packages/app/**"]),
      childNode("component.app.api", "component", "capability.app", ["packages/app/**/api/**"]),
      node("capability.shared-a", ["packages/shared/**"]),
      node("capability.shared-b", ["packages/shared/**"])
    ];
    const paths = ["packages/shared/x.ts", "docs/readme.md", "packages/app/src/api/handler.ts", "packages/app/index.ts", "docs/readme.md"];
    const batch = resolveArchitectureOwnersForPaths(nodes, paths);
    expect(batch.map((result) => result.status)).toEqual(["ambiguous", "no-match", "matched", "matched", "no-match"]);
    expect(batch).toEqual(paths.map((path) => resolveArchitectureOwnerForPath(nodes, path)));
    expect(resolveArchitectureOwnersForPaths(nodes, [])).toEqual([]);
  });

  test("deepestOnOneParentChain returns the deepest id on one chain and undefined across chains", () => {
    const parents = new Map<string, string | undefined>([
      ["capability.app", undefined],
      ["component.app.api", "capability.app"],
      ["capability.other", undefined]
    ]);
    expect(deepestOnOneParentChain(["capability.app", "component.app.api"], parents)).toBe("component.app.api");
    expect(deepestOnOneParentChain(["capability.app"], parents)).toBe("capability.app");
    expect(deepestOnOneParentChain(["component.app.api", "capability.other"], parents)).toBeUndefined();
    expect(deepestOnOneParentChain([], parents)).toBeUndefined();
  });
});
