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

  test("sets each element's group to its node layer and omits group without one", () => {
    const layered: NativeModel = {
      nodes: [
        { id: "module.subscription", kind: "module", name: "Subscription", layer: "domain" },
        { id: "datastore.billing", kind: "datastore", name: "Billing DB" }
      ],
      relations: model.relations
    };
    const first = exportStructurizrWorkspace(layered);
    expect(exportStructurizrWorkspace({ nodes: [...layered.nodes].reverse(), relations: layered.relations })).toEqual(first);
    const elements = JSON.parse(first.files[0].content).model.elements as Record<string, unknown>[];
    expect(elements.map((element) => Object.keys(element))).toEqual([
      ["id", "name", "type", "tags", "archcontextNative"],
      ["id", "name", "type", "tags", "group", "archcontextNative"]
    ]);
    expect(elements[1]!.group).toBe("domain");
    expect(importStructurizrInitialModel(first.files[0].content).nodes.find((node) => node.id === "module.subscription")?.layer).toBe("domain");
    expect(exportStructurizrWorkspace(model).files[0].content).not.toContain("\"group\"");
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
