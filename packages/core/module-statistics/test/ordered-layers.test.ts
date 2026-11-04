import { expect, test } from "bun:test";
import { readDependencyConstraints } from "@archcontext/core/architecture-domain";
import type { DependencyConstraintEvaluationV1 } from "@archcontext/contracts";
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
/**
 * Both decision invariants for the single `constraint.layers` constraint of these fixtures: counted
 * plus unclassified edges equal `importEdgeCount`; the violating rows sum to the violating edges,
 * and the distinct file pairs of those edges are the violations whose endpoints each resolve to one
 * layer (here: neither endpoint is a `contested` file).
 */
function expectLayerEdgeInvariants(evaluation: DependencyConstraintEvaluationV1, unclassified: number, violatingEdges: [string, string][], contested: string[] = []) {
  const order = ["cli", "effects", "core"];
  const rows = evaluation.layerEdges!;
  expect(rows.reduce((sum, row) => sum + row.imports, 0) + unclassified).toBe(evaluation.importEdgeCount);
  const violating = rows.filter(row => order.indexOf(row.fromLayer) > order.indexOf(row.toLayer));
  expect(violating.reduce((sum, row) => sum + row.imports, 0)).toBe(violatingEdges.length);
  const singleLayerViolations = evaluation.violations.filter(violation => !contested.includes(violation.fromPath) && !contested.includes(violation.toPath));
  expect([...new Set(violatingEdges.map(pair => JSON.stringify(pair)))].sort())
    .toEqual(singleLayerViolations.map(violation => JSON.stringify([violation.fromPath, violation.toPath])).sort());
}
test("layer edges count allowed, same-layer and violating pairs; an external import is left out", () => {
  const a = input(); a.files.push("core/d.ts");
  a.importEdges = [
    { from: "cli/c.ts", to: "effects/b.ts", specifier: "../effects/b" },
    { from: "core/a.ts", to: "core/d.ts", specifier: "./d" },
    { from: "core/a.ts", to: "effects/b.ts", specifier: "../effects/b" },
    { from: "core/a.ts", to: "effects/b.ts", specifier: "../effects/b.ts" },
    { from: "cli/c.ts", to: null, specifier: "react" }
  ];
  const evaluation = evaluateDependencyConstraints(a);
  expect(evaluation).toMatchObject({ status: "violated", coverage: "complete", reasonCodes: [], importEdgeCount: 5 });
  expect(evaluation.violations).toHaveLength(1);
  expect(evaluation.violations[0]).toMatchObject({ fromPath: "core/a.ts", toPath: "effects/b.ts" });
  expect(evaluation.layerEdges).toEqual([
    { constraintId: "constraint.layers", fromLayer: "cli", toLayer: "effects", imports: 1 },
    { constraintId: "constraint.layers", fromLayer: "core", toLayer: "core", imports: 1 },
    { constraintId: "constraint.layers", fromLayer: "core", toLayer: "effects", imports: 2 }
  ]);
  expectLayerEdgeInvariants(evaluation, 1, [["core/a.ts", "effects/b.ts"], ["core/a.ts", "effects/b.ts"]]);
});
test("a contested file is left out of layer edges but its violation stands", () => {
  const a = input(); a.nodes.push({ id: "component.shared", kind: "component", name: "Shared", layer: "cli", source: { include: ["core/a.ts"] } });
  a.importEdges = [{ from: "cli/c.ts", to: "effects/b.ts", specifier: "../effects/b" }, { from: "core/a.ts", to: "effects/b.ts", specifier: "../effects/b" }];
  const evaluation = evaluateDependencyConstraints(a);
  expect(evaluation).toMatchObject({ status: "violated", coverage: "complete", violations: [{ fromPath: "core/a.ts", fromNode: "module.core" }] });
  expect(evaluation.layerEdges).toEqual([{ constraintId: "constraint.layers", fromLayer: "cli", toLayer: "effects", imports: 1 }]);
  expectLayerEdgeInvariants(evaluation, 1, [], ["core/a.ts"]);
});
test("layer edges are absent when undetermined or when coverage is partial", () => {
  const a = input(); a.importEdges = [{ from: "cli/c.ts", to: "effects/b.ts", specifier: "../effects/b" }, { from: "core/a.ts", to: "unowned.ts", specifier: "../unowned" }];
  const undetermined = evaluateDependencyConstraints(a);
  expect(undetermined).toMatchObject({ status: "undetermined", coverage: "complete" });
  expect(undetermined).not.toHaveProperty("layerEdges");
  a.importEdges = [{ from: "core/a.ts", to: "effects/b.ts", specifier: "../effects/b" }]; a.truncated = true;
  const partial = evaluateDependencyConstraints(a);
  expect(partial).toMatchObject({ status: "violated", coverage: "partial" });
  expect(partial).not.toHaveProperty("layerEdges");
});
test("ordered list is validated; unsupported constraints warn once", () => {
  for (const layers of [[], ["core", "core"], ["Core"], "core", ["core"]]) expect(readDependencyConstraints(files(layers)).errors.length).toBeGreaterThan(0);
  expect(readDependencyConstraints(files()).errors).toEqual([]);
  const result = readDependencyConstraints(files(["cli", "effects", "core"], "forbid-cycle"));
  expect(result.constraints).toEqual([]);
  expect(result.warnings).toEqual([".archcontext/model/constraints/constraint.layers.yaml: constraint constraint.layers rule forbid-cycle is not evaluated yet"]);
});
