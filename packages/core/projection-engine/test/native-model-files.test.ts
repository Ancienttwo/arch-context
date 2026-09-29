import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson, stableYaml, type Json } from "@archcontext/contracts";
import { loadNativeModelFromArchContext, loadNativeModelFromModelFiles } from "../src/index";

test("the in-memory model loader builds the same NativeModel as the directory loader", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-native-model-files-"));
  try {
    const write = (path: string, value: Record<string, Json>) => {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), stableYaml(value), "utf8");
    };
    write(".archcontext/model/nodes/capability.b.yaml", { schemaVersion: "archcontext.node/v2", id: "capability.b", kind: "capability", name: "B", status: "active" });
    write(".archcontext/model/nodes/capability.a.yml", { schemaVersion: "archcontext.node/v2", id: "capability.a", kind: "capability", name: "A", status: "active" });
    write(".archcontext/model/nodes/component.a-child.yaml", { schemaVersion: "archcontext.node/v2", id: "component.a-child", kind: "component", name: "Child", parent: "capability.a", status: "active" });
    write(".archcontext/model/relations/relation.a.yaml", { schemaVersion: "archcontext.relation/v1", id: "relation.a", kind: "writes", source: "capability.a", target: "component.a-child", intent: "writes" });
    write(".archcontext/model/flows/flow.a.yaml", { schemaVersion: "archcontext.flow/v1", id: "flow.a", capabilityId: "capability.a", name: "A", applicability: "not-applicable", rationale: "Fixture." });
    writeFileSync(join(root, ".archcontext/model/nodes/README.md"), "not a model file\n", "utf8");
    const files = new Map<string, string>();
    for (const directory of ["nodes", "relations", "flows"]) {
      for (const name of readdirSync(join(root, ".archcontext/model", directory))) {
        files.set(`.archcontext/model/${directory}/${name}`, readFileSync(join(root, ".archcontext/model", directory, name), "utf8"));
      }
    }
    // Paths outside the direct model directories are ignored, exactly as the directory loader does.
    files.set(".archcontext/model/nodes/nested/component.hidden.yaml", stableYaml({ schemaVersion: "archcontext.node/v2", id: "component.hidden", kind: "component", name: "Hidden", status: "active" }));
    files.set(".archcontext/generated/ARCHITECTURE.yaml", "id: ignored\n");
    const fromDisk = loadNativeModelFromArchContext(root);
    const fromFiles = loadNativeModelFromModelFiles(files);
    expect(fromFiles).toEqual(fromDisk);
    expect(digestJson(fromFiles as unknown as Json)).toBe(digestJson(fromDisk as unknown as Json));
    expect(fromFiles.nodes.map((node) => node.id)).toEqual(["capability.a", "capability.b", "component.a-child"]);
    expect(() => loadNativeModelFromModelFiles(new Map([[".archcontext/model/nodes/bad.yaml", "id: bad\nschemaVersion: archcontext.node/v1\n"]])))
      .toThrow(/architecture-node-schema-version-unsupported/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
