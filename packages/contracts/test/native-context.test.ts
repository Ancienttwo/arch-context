import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NATIVE_CONTEXT_LIMITS, NATIVE_CONTEXT_REASONS, NativeContextError, assertNativeContextLimit, isNativeContextPath, nativeAllowedNodeKinds, nativeContextErrorEnvelope, nativeContextModelIssues, type NativeContextModel, type NativeContextSchemas } from "../src/native-context";
import type { Json } from "../src/schema";
import { fixtureModel } from "../../local-runtime/model-store-yaml/test/fixtures/native-context/fixture";
import node from "../../../schemas/repo/architecture-node.schema.json";
import relation from "../../../schemas/repo/architecture-relation.schema.json";
import flow from "../../../schemas/repo/architecture-flow.schema.json";
import exportSchema from "../../../schemas/runtime/native-context-export.schema.json";
import { validateJsonSchema } from "../src/validator";
import { publishedSchemaResolver } from "./published-schemas";

const schemas = { node, relation, flow } as unknown as NativeContextSchemas;
function model(): NativeContextModel {
  const records = fixtureModel();
  return { ...records, sourcePaths: Object.fromEntries((["nodes", "relations", "flows"] as const).map(kind => [kind, Object.fromEntries(records[kind].map(record => [record.id, `.archcontext/model/${kind}/${record.id}.yaml`]))])) as NativeContextModel["sourcePaths"] };
}
describe("native context contract", () => {
  test("canonical model preserves all eight kinds and schema-valid empty fields", () => {
    const value = model();
    expect(nativeAllowedNodeKinds(schemas)).toEqual(node.properties.kind.enum);
    expect(new Set(value.nodes.map(record => record.kind)).size).toBe(8);
    expect(nativeContextModelIssues(value, schemas)).toEqual([]);
    expect(value.nodes.find(record => record.kind === "component")!.summary).toBe("");
    expect(value.relations[0]!.intent).toBe("");
  });
  const cases: Array<[string, (value: NativeContextModel) => void, string]> = [
    ["omitted summary", value => { delete value.nodes[0]!.summary; }, "required"],
    ["unknown native field", value => { value.nodes[0]!.untyped = true; }, "additional"],
    ["duplicate ID", value => { value.nodes.push({ ...value.nodes[0]! }); }, "duplicate-entity-id"],
    ["missing parent", value => { value.nodes[1]!.parent = "module.demo.absent"; }, "parent-node-missing"],
    ["self parent", value => { value.nodes[1]!.parent = value.nodes[1]!.id!; }, "parent-cycle"],
    ["cyclic parent", value => { value.nodes[0]!.parent = value.nodes[1]!.id!; }, "parent-cycle"],
    ["missing relation endpoint", value => { value.relations[0]!.target = "component.demo.absent"; }, "relation-node-missing"],
    ["missing via", value => { value.relations[0]!.via = "interface.demo.absent"; }, "relation-node-missing"],
    ["non-capability flow", value => { value.flows[0]!.capabilityId = "capability.demo.absent"; }, "flow-capability-missing"],
    ["duplicate participant", value => { (value.flows[0]!.participants as any[]).push({ ...(value.flows[0]!.participants as any[])[0] }); }, "participant-id-ambiguous"],
    ["missing participant node", value => { (value.flows[0]!.participants as any[])[0].nodeId = "component.demo.absent"; }, "participant-node-missing"],
    ["missing terminal", value => { (value.flows[0]!.outcomes as any[])[0].terminal.participant = "absent"; }, "terminal-participant-missing"],
    ["missing step participant", value => { (value.flows[0]!.steps as any[])[0].to = "absent"; }, "step-participant-missing"],
    ["missing selector in outcome", value => { (value.flows[0]!.outcomes as any[])[0].steps[0].evidence.sinkId = "sink.demo.absent"; }, "selector-missing"],
    ["duplicate outcome", value => { (value.flows[0]!.outcomes as any[])[1].id = (value.flows[0]!.outcomes as any[])[0].id; }, "outcome-id-ambiguous"],
    ["disagreeing step definitions", value => { (value.flows[0]!.outcomes as any[])[0].steps[0].id = (value.flows[0]!.steps as any[])[0].id; }, "step-definition-ambiguous"],
    ["unsafe selector path", value => { (value.nodes[2]!.source as any).entrypoints[0].path = "../escape.ts"; }, "path-unsafe"],
    ["duplicate selector tuple", value => { const symbols = (value.nodes[2]!.source as any).entrypoints[0].symbols; symbols.push(structuredClone(symbols[0])); }, "selector-ambiguous"],
    ["incomplete source index", value => { delete value.sourcePaths.nodes[value.nodes[0]!.id as string]; }, "source-path-index-incomplete"]
  ];
  test.each(cases)("rejects %s", (_name, mutate, invariant) => {
    const value = model(); mutate(value);
    expect(nativeContextModelIssues(value, schemas).some(issue => issue.invariant.includes(invariant))).toBe(true);
  });
  test("same symbol with distinct complete selector tuples remains valid", () => {
    const value = model();
    const symbol = (value.nodes[2]!.source as any).entrypoints[0].symbols[0];
    (value.nodes[2]!.source as any).entrypoints[0].symbols.push({ ...symbol, sinks: [{ ...symbol.sinks[0], id: "sink.demo.second" }] });
    expect(nativeContextModelIssues(value, schemas)).toEqual([]);
  });
  test("not-applicable flow is validated rather than omitted", () => {
    const value = model(); value.flows[1]!.participants = [];
    expect(nativeContextModelIssues(value, schemas).length).toBeGreaterThan(0);
  });
  test.each(Object.entries(NATIVE_CONTEXT_LIMITS))("%s accepts its exact limit and rejects excess", (name, maximum) => {
    const key = name as keyof typeof NATIVE_CONTEXT_LIMITS;
    expect(() => assertNativeContextLimit(key, maximum)).not.toThrow();
    expect(() => assertNativeContextLimit(key, maximum + 1)).toThrow("native-context-limit-exceeded");
  });
  test("typed failures have a closed vocabulary and only drift is retryable", () => {
    for (const reason of NATIVE_CONTEXT_REASONS) {
      const result = nativeContextErrorEnvelope(new NativeContextError(reason));
      expect(result.requestId).toBe("export.native");
      expect(result.error!.reasonCode).toBe(reason);
      expect(result.error!.retryable).toBe(reason === "native-context-input-changed");
    }
  });
  test.each(["/absolute", "C:/drive", "C:relative", "\\server\\share", "a/../b", "./a", "a//b", "a/", "a\0b", "a\nb", "a/./b", "a\\b", "\ud800"])("unsafe POSIX path %j", path => { expect(isNativeContextPath(path)).toBe(false); });
  test("literal filenames, spaces, brackets and UTF-8 paths remain literal", () => {
    for (const path of ["src/a.ts", "src/[locale]/**", "src/a-*.ts", 'src/"café".ts', "docs/some name.md"]) expect(isNativeContextPath(path)).toBe(true);
  });
  test("public schema validates the complete fixture with canonical external refs", () => {
    const value = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/valid/native-context-export.json"), "utf8")) as Json;
    expect(validateJsonSchema(exportSchema as any, value, { resolveSchema: publishedSchemaResolver() }).issues).toEqual([]);
    expect(validateJsonSchema(exportSchema as any, value).valid).toBe(false);
  });
});
