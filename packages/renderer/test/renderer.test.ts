import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeArchContextModel } from "../../model-store-yaml/src/index";
import { exportMermaidModel, loadNativeModelFromArchContext, normalizeNativeModel, type NativeModel } from "../src/index";

const model: NativeModel = {
  nodes: [
    { id: "module.payment", kind: "module", name: "Payment" },
    { id: "module.subscription", kind: "module", name: "Subscription" }
  ],
  relations: [
    { id: "relation.subscription-calls-payment", kind: "calls", source: "module.subscription", target: "module.payment", intent: "charge" }
  ]
};

describe("@archcontext/renderer", () => {
  test("normalizes model and exports deterministic Mermaid projection", () => {
    const first = exportMermaidModel(model);
    const second = exportMermaidModel({ nodes: [...model.nodes].reverse(), relations: [...model.relations] });
    expect(first.files[0].content).toBe(second.files[0].content);
    expect(first.files[0].content).toContain("module_subscription");
    expect(first.digest).toBe(second.digest);
    expect(normalizeNativeModel(model).nodes.map((node) => node.id)).toEqual(["module.payment", "module.subscription"]);
  });

  test("loads native model from initialized ArchContext files", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-renderer-"));
    try {
      writeFileSync(join(root, "README.md"), "# tmp\n");
      initializeArchContextModel(root, "Renderer App");
      const loaded = loadNativeModelFromArchContext(root);
      expect(loaded.nodes.map((node) => node.id)).toContain("capability.architecture-context");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("exports a larger model deterministically without dropping relations", () => {
    const nodes = Array.from({ length: 250 }, (_, index) => ({
      id: `module.service-${index.toString().padStart(3, "0")}`,
      kind: "module",
      name: `Service ${index}`
    }));
    const relations = nodes.slice(1).map((node, index) => ({
      id: `relation.service-${index.toString().padStart(3, "0")}`,
      kind: "calls",
      source: nodes[index].id,
      target: node.id,
      intent: "large model regression"
    }));
    const first = exportMermaidModel({ nodes, relations });
    const second = exportMermaidModel({ nodes: [...nodes].reverse(), relations: [...relations].reverse() });
    expect(first.digest).toBe(second.digest);
    expect(first.files[0].content.match(/-->/g)?.length).toBe(249);
  });
});
