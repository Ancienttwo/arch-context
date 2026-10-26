import { expect, test } from "bun:test";
import { stableYaml } from "@archcontext/contracts";
import { exportNativeContext } from "../src/native-context";
import { createNativeFixture, writeFixtureFile, commitFixture, fixtureModel, CAPABILITY_ID } from "./fixtures/native-context/fixture";

test("ordered layers export equally from immutable ref and worktree and fail closed on unknown node layer", () => {
  const fixture = createNativeFixture();
  try {
    expect(exportNativeContext(fixture.root, { source: "ref", ref: "HEAD" }).model.layers).toBeUndefined();
    writeFixtureFile(fixture.root, ".archcontext/manifest.yaml", stableYaml({ schemaVersion: "archcontext.manifest/v1", model: { layout: "split", root: ".archcontext/model", layers: ["cli", "core"] }, runtime: { contextBudgetBytes: 64 } }));
    const node = { ...fixtureModel().nodes[0], layer: "core" };
    writeFixtureFile(fixture.root, `.archcontext/model/nodes/${CAPABILITY_ID}.yaml`, stableYaml(node));
    commitFixture(fixture.root);
    const fixed = exportNativeContext(fixture.root, { source: "ref", ref: "HEAD" });
    const live = exportNativeContext(fixture.root, { source: "worktree" });
    expect(fixed.model.layers).toEqual(["cli", "core"]);
    expect(live.model).toEqual(fixed.model);
    writeFixtureFile(fixture.root, `.archcontext/model/nodes/${CAPABILITY_ID}.yaml`, stableYaml({ ...node, layer: "unknown" }));
    expect(() => exportNativeContext(fixture.root, { source: "worktree" })).toThrow("native-context-model-invalid");
    expect(exportNativeContext(fixture.root, { source: "ref", ref: "HEAD" }).model).toEqual(fixed.model);
  } finally { fixture.cleanup(); }
});
