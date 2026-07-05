import { describe, expect, test } from "bun:test";
import {
  globLiteralPrefixLength,
  matchesGlob,
  resolveArchitectureOwnerForPath,
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
