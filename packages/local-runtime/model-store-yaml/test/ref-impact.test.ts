import { describe, expect, test } from "bun:test";
import { rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NativeContextModel, NativeContextSnapshot } from "@archcontext/contracts";
import { computeRefImpact, countImpactLines, IMPACT_LIMITS, parseImpactHunks, parseImpactNumstat, readRefImpact, type RefImpactFacts } from "../src/ref-impact";
import { createNativeFixture, commitFixture, fixtureGit, fixtureModel, writeFixtureFile, SELECTOR } from "./fixtures/native-context/fixture";
const snapshot: NativeContextSnapshot = { source: "ref", commitSha: "a".repeat(40), treeOid: "b".repeat(40), validation: "immutable-tree" };
function model(): NativeContextModel { return { ...fixtureModel(), sourcePaths: { nodes: {}, relations: {}, flows: {} } }; }
function state() { return { model: model(), snapshot }; }
const change = { path: "src/worker.ts", added: 1, deleted: 1, hunks: [{ baseStart: 4, baseCount: 1, headStart: 4, headCount: 1 }] };
const facts = (status: "resolved" | "unresolved" = "resolved"): RefImpactFacts => ({ commitSha: "a".repeat(40), treeOid: "b".repeat(40), selectors: [{ ...SELECTOR, status, ...(status === "resolved" ? { ranges: [{ path: "src/worker.ts", startLine: 2, endLine: 8 }] } : {}) }] } as RefImpactFacts);

describe("stateless ref impact", () => {
  test("reads immutable refs and deletion owners without altering HEAD, index or dirty files", () => {
    const fixture = createNativeFixture();
    try {
      writeFixtureFile(fixture.root, "src/worker.ts", "const first = 1;\nconst second = 2;\n");
      writeFixtureFile(fixture.root, "src/deleted.ts", "const gone = true;\n");
      const base = commitFixture(fixture.root);
      writeFixtureFile(fixture.root, "src/worker.ts", "const first = 3;\nconst second = 2;\nconst third = 4;\n");
      rmSync(join(fixture.root, "src/deleted.ts"));
      const head = commitFixture(fixture.root);
      writeFixtureFile(fixture.root, "src/worker.ts", "dirty unrelated worktree content\n");
      const index = readFileSync(join(fixture.root, ".git/index"));
      const result = readRefImpact(fixture.root, { base, head });
      expect(result.changedPaths.find(row => row.path === "src/worker.ts")).toMatchObject({ added: 2, deleted: 1, owners: ["component.demo.worker"] });
      expect(result.changedPaths.find(row => row.path === "src/deleted.ts")).toMatchObject({ added: 0, deleted: 1, baseOwners: ["capability.demo.feature"] });
      expect(result.touchedFlowSteps).toEqual({ status: "unknown", reasonCodes: ["ref-code-facts-unavailable"], items: null });
      expect(result.dependents).toContainEqual({ nodeId: "interface.demo.resource", touchedNodeId: "component.demo.worker", relationIds: ["relation.demo.call"] });
      expect(JSON.stringify(result)).toBe(JSON.stringify(readRefImpact(fixture.root, { base, head })));
      writeFixtureFile(fixture.root, ".gitattributes", "*.ts -diff\n");
      writeFixtureFile(fixture.root, ".git/info/attributes", "*.ts -diff\n");
      expect(JSON.stringify(readRefImpact(fixture.root, { base, head }))).toBe(JSON.stringify(result));
      expect(fixtureGit(fixture.root, ["rev-parse", "HEAD"])).toBe(head);
      expect(readFileSync(join(fixture.root, ".git/index"))).toEqual(index);
      expect(readFileSync(join(fixture.root, "src/worker.ts"), "utf8")).toBe("dirty unrelated worktree content\n");
    } finally { fixture.cleanup(); }
  });
  test("matches flow steps to head and deleted base lines, and reports unresolved selectors", () => {
    const result = computeRefImpact({ base: state(), head: state(), changes: [change], headFacts: facts(), baseFacts: facts() });
    expect(result.touchedFlowSteps.status).toBe("known");
    expect(result.touchedFlowSteps.items).toContainEqual({ flowId: "flow.demo.primary", stepId: "request", outcomeId: null, reasonCodes: ["head-lines-changed", "base-lines-deleted"] });
    const removed = computeRefImpact({ base: state(), head: state(), changes: [{ ...change, added: 0, hunks: [{ baseStart: 4, baseCount: 1, headStart: 3, headCount: 0 }] }], headFacts: facts("unresolved"), baseFacts: facts() });
    expect(removed.touchedFlowSteps.items?.[0]?.reasonCodes).toEqual(["selector-unresolved-at-head", "base-lines-deleted"]);
  });
  test("wrong-ref and missing selector evidence cannot become an empty known result", () => {
    expect(computeRefImpact({ head: state(), changes: [change], headFacts: { ...facts(), commitSha: "c".repeat(40) } }).touchedFlowSteps).toMatchObject({ status: "unknown", items: null });
    expect(computeRefImpact({ head: state(), changes: [change], headFacts: { ...facts(), selectors: [{ ...SELECTOR, status: "resolved", ranges: [] }] } }).touchedFlowSteps.status).toBe("unknown");
    expect(computeRefImpact({ base: state(), head: state(), changes: [change], headFacts: facts(), baseFacts: { ...facts(), selectors: [] } }).touchedFlowSteps.status).toBe("unknown");
    expect(computeRefImpact({ head: state(), changes: [change], headFacts: { ...facts(), selectors: [] } }).touchedFlowSteps).toMatchObject({ status: "unknown", reasonCodes: ["selector-evidence-unavailable"] });
  });
  test("equal-specificity owners retain both candidates and ambiguity", () => {
    const head = state();
    head.model.nodes.push({ ...head.model.nodes.find(row => row.id === "component.demo.worker")!, id: "component.demo.other" });
    const result = computeRefImpact({ head, changes: [change] });
    expect(result.changedPaths[0]).toMatchObject({ owners: ["component.demo.other", "component.demo.worker"], reasonCodes: ["ambiguous-owner"] });
  });
  test("model delta includes additions, removals and changed fields", () => {
    const base = state(), head = state();
    head.model.nodes[0]!.summary = "changed";
    head.model.relations = [];
    head.model.flows.push({ ...head.model.flows[1]!, id: "flow.demo.new" });
    const result = computeRefImpact({ base, head, changes: [] });
    expect(result.modelDelta.changes).toContainEqual({ kind: "nodes", id: "capability.demo.feature", change: "changed", fields: ["summary"] });
    expect(result.modelDelta.changes).toContainEqual({ kind: "relations", id: "relation.demo.call", change: "removed", fields: ["id", "intent", "kind", "schemaVersion", "source", "target", "via"] });
    expect(result.modelDelta.changes?.find(row => row.id === "flow.demo.new")?.change).toBe("added");
  });
  test("dependency traversal respects depth and terminates on cycles", () => {
    const head = state();
    head.model.relations.push({ id: "relation.second", kind: "depends-on", source: "module.demo.system", target: "interface.demo.resource" }, { id: "relation.cycle", kind: "calls", source: "component.demo.worker", target: "module.demo.system" });
    expect(computeRefImpact({ head, changes: [change], depth: 1 }).dependents).toHaveLength(1);
    const result = computeRefImpact({ head, changes: [change], depth: 3 });
    expect(result.dependents).toHaveLength(2);
    expect(result.dependents.find(row => row.nodeId === "module.demo.system")?.relationIds).toEqual(["relation.second", "relation.demo.call"]);
  });
  test("bounded results advertise truncation and unknown flow coverage", () => {
    const changes = Array.from({ length: IMPACT_LIMITS.changedPaths + 1 }, (_, index) => ({ ...change, path: `src/${String(index).padStart(4, "0")}.ts` }));
    const result = computeRefImpact({ head: state(), changes });
    expect(result.changedPaths).toHaveLength(IMPACT_LIMITS.changedPaths);
    expect(result.truncated.changedPaths).toBe(true);
    expect(result.touchedFlowSteps.reasonCodes).toContain("impact-truncated");
    expect(result.dependencyCoverage.status).toBe("partial");
  });
  test("raw line distance preserves final newlines and returns unknown when work is bounded", () => {
    expect(countImpactLines(Buffer.from("a\nb\nc\n"), Buffer.from("a\nx\nb\n"))).toEqual({ added: 1, deleted: 1 });
    expect(countImpactLines(Buffer.from("a"), Buffer.from("a\n"))).toEqual({ added: 1, deleted: 1 });
    expect(countImpactLines(Buffer.from("a\n".repeat(3000)), Buffer.from("b\n".repeat(3000)))).toMatchObject({ added: null, deleted: null, reasonCode: "diff-limit-exceeded" });
  });
  test("binary counts remain unknown and pure deletion hunks keep both coordinates", () => {
    expect(parseImpactNumstat(Buffer.from("-\t-\tasset.png\0"))).toEqual([{ path: "asset.png", added: null, deleted: null, hunks: [], reasonCode: "binary-diff" }]);
    expect(parseImpactHunks(Buffer.from("@@ -4,2 +3,0 @@ symbol\n-old\n-older\n"))).toEqual([{ baseStart: 4, baseCount: 2, headStart: 3, headCount: 0 }]);
  });
  test("binary classification uses fixed blobs despite attributes declaring text", () => {
    const fixture = createNativeFixture();
    try {
      writeFixtureFile(fixture.root, "asset.bin", Buffer.from([1, 0, 2]));
      const head = commitFixture(fixture.root);
      writeFixtureFile(fixture.root, ".gitattributes", "*.bin diff\n");
      const result = readRefImpact(fixture.root, { base: fixture.commit, head });
      expect(result.changedPaths.find(row => row.path === "asset.bin")).toMatchObject({ added: null, deleted: null, reasonCodes: ["binary-diff"] });
    } finally { fixture.cleanup(); }
  });
  test("paths-only reports unknown counts and model delta using stable worktree model", () => {
    const fixture = createNativeFixture();
    try {
      const result = readRefImpact(fixture.root, { paths: ["src/worker.ts", "unknown.bin", "src/worker.ts"] });
      expect(result.changedPaths).toHaveLength(2);
      expect(result.changedPaths[0]).toMatchObject({ added: null, deleted: null });
      expect(result.unownedPaths).toEqual(["unknown.bin"]);
      expect(result.modelDelta).toMatchObject({ status: "unknown", reasonCode: "paths-only", changes: null });
    } finally { fixture.cleanup(); }
  });
});
