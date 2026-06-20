import { describe, expect, test } from "bun:test";
import { exportStructurizrWorkspace, importStructurizrInitialModel } from "../src/index";
import type { NativeModel } from "@archcontext/surfaces/renderer";

const model: NativeModel = {
  nodes: [
    { id: "module.subscription", kind: "module", name: "Subscription", constraint: ["native-only"] as any },
    { id: "datastore.billing", kind: "datastore", name: "Billing DB" }
  ],
  relations: [
    { id: "relation.subscription-writes-billing", kind: "writes", source: "module.subscription", target: "datastore.billing", intent: "persist" }
  ]
};

describe("@archcontext/surfaces/adapter-structurizr", () => {
  test("exports deterministic Structurizr workspace JSON", () => {
    const first = exportStructurizrWorkspace(model);
    const second = exportStructurizrWorkspace({ nodes: [...model.nodes].reverse(), relations: [...model.relations] });
    expect(first.files[0].content).toBe(second.files[0].content);
    expect(JSON.parse(first.files[0].content).views.systemLandscape.key).toBe("archcontext-landscape");
  });

  test("imports only initialization data and strips Native protected fields", () => {
    const exported = exportStructurizrWorkspace(model);
    const imported = importStructurizrInitialModel(exported.files[0].content);
    expect(imported.nodes.map((node) => node.id)).toContain("module.subscription");
    expect((imported.nodes.find((node) => node.id === "module.subscription") as any).constraint).toBeUndefined();
    expect(imported.relations).toHaveLength(1);
    expect(imported.warnings[0]).toContain("initialization-only");
  });
});
