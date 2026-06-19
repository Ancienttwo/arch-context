import { describe, expect, test } from "bun:test";
import { exportLikeC4Model, importLikeC4InitialModel } from "../src/index";
import type { NativeModel } from "../../renderer/src/index";

const model: NativeModel = {
  nodes: [
    { id: "module.subscription", kind: "module", name: "Subscription", evidence: ["native-only"] as any },
    { id: "module.payment", kind: "module", name: "Payment" }
  ],
  relations: [
    { id: "relation.subscription-calls-payment", kind: "calls", source: "module.subscription", target: "module.payment", intent: "charge" }
  ]
};

describe("@archcontext/adapter-likec4", () => {
  test("exports deterministic LikeC4 DSL with Native comments for initialization import", () => {
    const first = exportLikeC4Model(model);
    const second = exportLikeC4Model({ nodes: [...model.nodes].reverse(), relations: [...model.relations] });
    expect(first.files[0].content).toBe(second.files[0].content);
    expect(first.files[0].content).toContain("model {");
    expect(first.files[0].content).toContain("archctx-node");
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
