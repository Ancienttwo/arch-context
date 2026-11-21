import { expect, test } from "bun:test";
import { isRefImpactBatchRequest } from "../src";
import verify from "../fixtures/valid/runtime-verify.json";
import batch from "../fixtures/valid/ref-impact-batch.json";
import request from "../fixtures/valid/ref-impact-batch-request.json";
import { publishedSchemaIssues } from "./published-schemas";

const schema = (name: string) => `runtime/${name}.schema.json`;

test("published verify and impact batch examples validate with referenced report schemas", () => {
  expect(publishedSchemaIssues(schema("runtime-verify"), verify)).toEqual([]);
  expect(publishedSchemaIssues(schema("ref-impact-batch"), batch)).toEqual([]);
  expect(publishedSchemaIssues(schema("ref-impact-batch-request"), request)).toEqual([]);
  expect(isRefImpactBatchRequest(request)).toBe(true);

  expect(publishedSchemaIssues(schema("runtime-verify"), {
    ...verify, checks: { ...verify.checks, flows: verify.checks.docs }
  }).length).toBeGreaterThan(0);
  expect(publishedSchemaIssues(schema("ref-impact-batch"), {
    ...batch, items: [{ id: "pr-42", impact: { schemaVersion: "archcontext.ref-impact/v1" } }]
  }).length).toBeGreaterThan(0);
});

test("batch request shape and path rules agree with the published schema", () => {
  for (const items of [null, [{ id: 1, paths: [] }], [{ id: "a" }], [{ id: "a", paths: [], extra: 1 }],
    ...["/abs", "../escape", "x/../escape", "x\n/../escape", "x\\bad", "x\0bad", ""].map(path => [{ id: "a", paths: [path] }])]) {
    const value = { ...request, items };
    expect(isRefImpactBatchRequest(value)).toBe(false);
    expect(publishedSchemaIssues(schema("ref-impact-batch-request"), value).length).toBeGreaterThan(0);
  }
});
