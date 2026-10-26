import { expect, test } from "bun:test";
import { readDependencyConstraints } from "@archcontext/core/architecture-domain";
import { evaluateDependencyConstraints, type DependencyConstraintInputV1 } from "../src/index";

const files = (layers: unknown = ["cli", "effects", "core"], rule = "layer-direction") => [
  { path: ".archcontext/manifest.yaml", body: JSON.stringify({ schemaVersion: "archcontext.manifest/v1", model: { layers } }) },
  ...["cli", "effects", "core"].map(layer => ({ path: `.archcontext/model/nodes/module.${layer}.yaml`, body: JSON.stringify({ id: `module.${layer}`, layer }) })),
  { path: ".archcontext/model/constraints/constraint.layers.yaml", body: JSON.stringify({ schemaVersion: "archcontext.constraint/v1", id: "constraint.layers", severity: "error", scope: {}, rule: { type: rule } }) }
];
function input(): DependencyConstraintInputV1 {
  return { nodes: ["cli", "effects", "core"].map(layer => ({ id: `module.${layer}`, kind: "module", name: layer, layer, source: { include: [`${layer}/**`] } })), constraints: readDependencyConstraints(files()).constraints, files: ["core/a.ts", "effects/b.ts", "cli/c.ts", "unowned.ts"], worktreeDigest: "sha256:tree", codeFacts: { availability: "ready", indexedWorktreeDigest: "sha256:tree" }, importEdges: [], workspacePackages: [], truncated: false };
}
test("lower to upper violates with explicit layers; reverse passes", () => {
  const a = input(); a.importEdges = [{ from: "core/a.ts", to: "effects/b.ts", specifier: "../effects/b" }];
  expect(evaluateDependencyConstraints(a)).toMatchObject({ status: "violated", violations: [{ fromLayer: "core", toLayer: "effects", fromNode: "module.core", toNode: "module.effects" }] });
  a.importEdges = [{ from: "effects/b.ts", to: "core/a.ts", specifier: "../core/a" }];
  expect(evaluateDependencyConstraints(a).status).toBe("pass");
});
test("new layer node needs no constraint edit; parent is not a layer authority", () => {
  const a = input(); a.nodes.push({ id: "component.new", kind: "component", name: "New", layer: "core", source: { include: ["new.ts"] } }); a.files.push("new.ts"); a.importEdges = [{ from: "new.ts", to: "effects/b.ts", specifier: "./effects/b" }];
  expect(evaluateDependencyConstraints(a).status).toBe("violated");
  delete a.nodes[3].layer; a.nodes[3].parent = "module.core";
  expect(evaluateDependencyConstraints(a)).toMatchObject({ status: "undetermined", reasonCodes: ["layer-endpoint-unclassified"] });
});
test("unowned or unlayered endpoint does not pass silently in either direction", () => {
  for (const reverse of [false, true]) {
    const a = input(); a.importEdges = [{ from: reverse ? "unowned.ts" : "core/a.ts", to: reverse ? "core/a.ts" : "unowned.ts", specifier: "./other" }];
    expect(evaluateDependencyConstraints(a)).toMatchObject({ status: "undetermined", reasonCodes: ["layer-endpoint-unclassified"] });
  }
});
test("unresolved imports and stale facts remain unknown", () => {
  const a = input(); a.importEdges = [{ from: "core/a.ts", to: null, specifier: "./missing" }];
  expect(evaluateDependencyConstraints(a)).toMatchObject({ status: "undetermined", reasonCodes: ["unresolved-import"] });
  a.codeFacts.availability = "unavailable";
  expect(evaluateDependencyConstraints(a).status).toBe("undetermined");
});
test("ordered list is validated; unsupported constraints warn once", () => {
  for (const layers of [[], ["core", "core"], ["Core"], "core", ["core"]]) expect(readDependencyConstraints(files(layers)).errors.length).toBeGreaterThan(0);
  expect(readDependencyConstraints(files()).errors).toEqual([]);
  const result = readDependencyConstraints(files(["cli", "effects", "core"], "forbid-cycle"));
  expect(result.constraints).toEqual([]);
  expect(result.warnings).toEqual([".archcontext/model/constraints/constraint.layers.yaml: constraint constraint.layers rule forbid-cycle is not evaluated yet"]);
});
