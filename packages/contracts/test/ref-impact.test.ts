import { expect, test } from "bun:test";
import { validateJsonSchema, type Json } from "../src/index";
import schema from "../../../schemas/runtime/ref-impact.schema.json";
import { computeRefImpact } from "../../local-runtime/model-store-yaml/src/ref-impact";
import { fixtureModel } from "../../local-runtime/model-store-yaml/test/fixtures/native-context/fixture";

test("published ref-impact schema accepts unknown coverage and rejects fake known emptiness", () => {
  const model = { ...fixtureModel(), sourcePaths: { nodes: {}, relations: {}, flows: {} } };
  const snapshot = { source: "ref", commitSha: "a".repeat(40), treeOid: "b".repeat(40), validation: "immutable-tree" } as const;
  const output = computeRefImpact({ base: { model, snapshot }, head: { model, snapshot }, changes: [] });
  expect(validateJsonSchema(schema as any, output as unknown as Json).issues).toEqual([]);
  expect(validateJsonSchema(schema as any, { ...output, touchedFlowSteps: { status: "known", reasonCodes: ["ref-code-facts-unavailable"], items: [] } } as unknown as Json).issues.length).toBeGreaterThan(0);
  expect(validateJsonSchema(schema as any, { ...output, touchedFlowSteps: { status: "unknown", reasonCodes: [], items: null } } as unknown as Json).issues.length).toBeGreaterThan(0);
});
