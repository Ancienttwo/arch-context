import { describe, expect, test } from "bun:test";
import { exportLikeC4Model, importLikeC4InitialModel } from "../src/index";
import type { NativeModel } from "@archcontext/surfaces/renderer";

const model: NativeModel = {
  nodes: [
    { id: "module.subscription", kind: "module", name: "Subscription", evidence: ["native-only"] as any },
    { id: "module.payment", kind: "module", name: "Payment" }
  ],
  relations: [
    { id: "relation.subscription-calls-payment", kind: "calls", source: "module.subscription", target: "module.payment", intent: "charge" }
  ]
};

describe("@archcontext/surfaces/adapter-likec4", () => {
  test("exports deterministic LikeC4 DSL with Native comments for initialization import", () => {
    const first = exportLikeC4Model(model);
    const second = exportLikeC4Model({ nodes: [...model.nodes].reverse(), relations: [...model.relations] });
    expect(first.files[0].content).toBe(second.files[0].content);
    expect(first.files[0].content).toContain("model {");
    expect(first.files[0].content).toContain("archctx-node");
  });

  test("renders node layers as view groups and keeps the flat view without layers", () => {
    const layered: NativeModel = {
      nodes: [
        { id: "module.subscription", kind: "module", name: "Subscription", layer: "domain" },
        { id: "module.payment", kind: "module", name: "Payment", layer: "domain" },
        { id: "module.gateway", kind: "module", name: "Gateway" }
      ],
      relations: model.relations
    };
    const content = exportLikeC4Model(layered).files[0].content;
    expect(content.slice(content.indexOf("views {"))).toBe([
      "views {",
      "  view index {",
      "    group \"domain\" {",
      "      include module_payment",
      "      include module_subscription",
      "    }",
      "    include *",
      "    autoLayout TopBottom",
      "  }",
      "}",
      ""
    ].join("\n"));
    expect(exportLikeC4Model({ nodes: [...layered.nodes].reverse(), relations: layered.relations }).files[0].content).toBe(content);
    expect(importLikeC4InitialModel(content).nodes.find((node) => node.id === "module.payment")?.layer).toBe("domain");
    const flat = exportLikeC4Model(model).files[0].content;
    expect(flat.slice(flat.indexOf("views {"))).toBe("views {\n  view index {\n    include *\n    autoLayout TopBottom\n  }\n}\n");
  });

  test("imports only initialization data and strips Native protected fields", () => {
    const exported = exportLikeC4Model(model);
    const imported = importLikeC4InitialModel(exported.files[0].content);
    expect(imported.nodes.map((node) => node.id)).toContain("module.subscription");
    expect((imported.nodes.find((node) => node.id === "module.subscription") as any).evidence).toBeUndefined();
    expect(imported.relations).toHaveLength(1);
    expect(imported.warnings[0]).toContain("initialization-only");
  });
});
