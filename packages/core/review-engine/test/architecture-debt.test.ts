import { expect, test } from "bun:test";
import { architectureDebtReportIssues, type ArchitectureFlowSelectorCheckV1, type CapabilityDependenciesV1, type DocsAnchorsReportV1, type PracticeEnforcementEvaluationV1 } from "@archcontext/contracts";
import { publishedSchemaIssues } from "../../../contracts/test/published-schemas";
import { dependencyDebtFromMeasurement, evaluateArchitectureDebt, type ArchitectureDebtEvidence } from "../src/architecture-debt";

const anchors: DocsAnchorsReportV1 = {
  schemaVersion: "archcontext.docs-anchors/v1", profile: "default", codeGraph: { availability: "unavailable", reasonCode: "index-missing" },
  summary: { nodes: 0, documents: 0, citations: 0, findings: 0, unchecked: 0, byKind: { "line-moved": 0, "line-out-of-range": 0, "missing-path": 0, "missing-symbol": 0, "unknown-selector": 0 } }, nodes: []
};
const flows: ArchitectureFlowSelectorCheckV1 = { schemaVersion: "archcontext.flow-selector-check/v1", ok: true, codeGraph: { availability: "ready", version: "1.6.1" },
  summary: { selectors: 0, proven: 0, unproven: 0, usedUnproven: 0 }, selectors: [], capabilities: [] };
const practices = { schemaVersion: "archcontext.practice-enforcement-evaluation/v1", results: [], violations: [], nonBlockingViolations: [], waiversApplied: [], actionsRequired: [] } as unknown as PracticeEnforcementEvaluationV1;
function clean(): ArchitectureDebtEvidence {
  return { scope: { kind: "changed-paths", changedPaths: ["src/a.ts"], capabilityIds: ["capability.a"] },
    ownership: [], anchors, dependencies: { coverage: "complete", coverageReasonCodes: [], items: [] }, flows, practices,
    scopedNodeIds: ["capability.a"], capabilityByNodeId: new Map([["capability.a", "capability.a"]]) };
}

test("measured clean input produces no task, and byte stamps are not an input", () => {
  const result = evaluateArchitectureDebt(clean());
  expect(result.coverage).toBe("complete");
  expect(result.items).toEqual([]);
  expect(result.actionsRequired).toEqual([]);
  expect(architectureDebtReportIssues(result)).toEqual([]);
  expect(publishedSchemaIssues("runtime/architecture-debt.schema.json", result)).toEqual([]);
});

test("missing or deferred producers stay partial even next to actionable ownership", () => {
  const input = clean();
  delete input.dependencies; delete input.flows; delete input.practices;
  input.ownership = [{ path: "src/a.ts", nodeIds: [], capabilityIds: [], status: "unowned" }];
  const result = evaluateArchitectureDebt(input);
  expect(result.coverage).toBe("partial");
  expect(result.items.map(item => item.kind)).toEqual(["unowned-path"]);
  expect(result.checks.find(check => check.check === "flows")?.coverage).toBe("unknown");
  expect(result.actionsRequired).toHaveLength(1);
  expect(architectureDebtReportIssues(result)).toEqual([]);
  expect(publishedSchemaIssues("runtime/architecture-debt.schema.json", result)).toEqual([]);
});

test("dependency debt uses producer declarations and scopes either endpoint without changing its count", () => {
  const measured = { imports: { coverage: "complete", reasonCodes: [] }, matrix: [
    { from: "capability.a", to: "capability.a", imports: 1, declared: true },
    { from: "capability.a", to: "capability.b", imports: 3, declared: false },
    { from: "capability.c", to: "capability.d", imports: 9, declared: false },
    { from: "capability.b", to: "capability.a", imports: 2, declared: true }
  ] } as unknown as CapabilityDependenciesV1;
  const dependencies = dependencyDebtFromMeasurement(measured);
  const report = evaluateArchitectureDebt({ ...clean(), dependencies });
  expect(report.items).toHaveLength(1);
  expect(report.items[0]!.details).toMatchObject({ fromCapabilityId: "capability.a", toCapabilityId: "capability.b", importEdgeCount: 3 });
  const all = evaluateArchitectureDebt({ ...clean(), scope: { kind: "repository", changedPaths: [], capabilityIds: [] }, dependencies });
  expect(all.items.filter(item => item.kind === "undeclared-dependency").map(item => ({
    reasonCode: item.reasonCode, fromCapabilityId: item.details.fromCapabilityId, toCapabilityId: item.details.toCapabilityId, importEdgeCount: item.details.importEdgeCount
  })).sort((a,b)=>String(a.fromCapabilityId).localeCompare(String(b.fromCapabilityId)))).toEqual(dependencies.items);
  expect(dependencyDebtFromMeasurement(measured, ["workspace-resolution-failed"]).coverage).toBe("partial");
  expect(architectureDebtReportIssues(report)).toEqual([]);
});

test("a missing flow evidence producer is not a fabricated failed flow", () => {
  const report = evaluateArchitectureDebt({ ...clean(), flows: { ...flows, codeGraph: { availability: "unavailable", version: "1.6.1" }, capabilities: [
    { capabilityId: "capability.a", p2Status: "unprovable", diagnostics: [{ code: "evidence-missing", detail: "not measured" }] }
  ] } });
  expect(report.items).toEqual([]);
  expect(report.coverageReasonCodes).toContain("flows:code-facts-unavailable");
});

test("a failed proof names the capability and precise flow step without copying provider text", () => {
  const report = evaluateArchitectureDebt({ ...clean(), flows: { ...flows, ok: false, capabilities: [
    { capabilityId: "capability.a", p2Status: "unprovable", diagnostics: [{ code: "selector-unproven", flowId: "flow.a", stepId: "step.write", detail: "raw source must not escape" }] },
    { capabilityId: "capability.b", p2Status: "unprovable", diagnostics: [{ code: "selector-unproven", detail: "unrelated" }] }
  ] } });
  expect(report.items).toHaveLength(1);
  expect(report.items[0]!.details).toEqual({ modelField: "flows.steps.evidence", flowId: "flow.a", stepId: "step.write" });
  expect(JSON.stringify(report)).not.toContain("raw source");
});

test("a changed cited path reaches a different capability's human document, but unrelated citations do not", () => {
  const report = evaluateArchitectureDebt({ ...clean(), anchors: { ...anchors, nodes: [
    { nodeId: "capability.b", documentPath: "docs/b.md", citationCount: 2, unchecked: [], findings: [
      { kind: "line-out-of-range", origin: { kind: "document", path: "docs/b.md", line: 7 }, citation: { text: "src/a.ts:99", path: "src/a.ts", line: 99 }, lineCount: 3 },
      { kind: "missing-path", origin: { kind: "document", path: "docs/b.md", line: 8 }, citation: { text: "src/other.ts", path: "src/other.ts" } }
    ] }
  ] } });
  expect(report.items).toHaveLength(1);
  expect(report.items[0]!.paths).toEqual(["docs/b.md", "src/a.ts"]);
  expect(report.items[0]!.reasonCode).toBe("line-out-of-range");
});

test("debt ids are stable across input ordering and import count changes", () => {
  const input = clean();
  input.dependencies = { coverage: "complete", coverageReasonCodes: [], items: [{ reasonCode: "undeclared-dependency", fromCapabilityId: "capability.a", toCapabilityId: "capability.b", importEdgeCount: 1 }] };
  const first = evaluateArchitectureDebt(input);
  input.dependencies.items[0]!.importEdgeCount = 2;
  expect(evaluateArchitectureDebt(input).items[0]!.id).toBe(first.items[0]!.id);
  expect(architectureDebtReportIssues({ ...first, actionsRequired: [] })).toContain("actionsRequired must name the measured debt actions");
});
