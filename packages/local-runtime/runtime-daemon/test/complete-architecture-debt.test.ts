import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { architectureDebtReportIssues, stableYaml } from "@archcontext/contracts";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { publishedSchemaIssues } from "../../../contracts/test/published-schemas";
import { createStartedTestDaemon, tempRepo, removeTempRepo } from "./runtime-test-fixtures";
import { readArchitectureDebt } from "../src/architecture-debt";

function write(root: string, path: string, value: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), value);
}

function ownedModel(root: string) {
  write(root, ".archcontext/model/nodes/capability.architecture.context.yaml", stableYaml({
    schemaVersion: "archcontext.node/v2", id: "capability.architecture.context", kind: "capability",
    name: "Context", status: "active", summary: "Owns context.", source: { include: ["src/*.ts"] }
  }));
  write(root, "src/main.ts", "export const value = 1;\n");
}

test("complete publishes absent adoption as unknown and missing optional facts as one warning", async () => {
  const root = tempRepo();
  const daemon = await createStartedTestDaemon();
  try {
    const unadopted = await daemon.completeTask(root);
    expect(unadopted.ok).toBe(true);
    expect((unadopted.data as any).result).toBe("fail_action_required");
    expect((unadopted.data as any).findings).toEqual([expect.objectContaining({ type: "invalid-schema" })]);
    expect((unadopted.data as any).debt).toMatchObject({ coverage: "unknown", items: [] });
    expect((unadopted.data as any).debt.coverageReasonCodes).toContain("ownership:model-not-adopted");
    await daemon.init(root, "Debt");
    ownedModel(root);
    const review = (await daemon.completeTask(root)).data as any;
    expect(review.result).toBe("pass_with_warnings");
    expect(review.findings).toEqual([expect.objectContaining({ type: "architecture-debt-coverage", severity: "warning" })]);
    expect(review.actionsRequired).toEqual([]);
    expect(review.debt.coverage).toBe("partial");
    expect(review.debt.items).toEqual([]);
    expect(review.debt.coverageReasonCodes).toContain("dependencies:index-missing");
    expect(review.debt.coverageReasonCodes).toContain("practices:not-enabled");
    expect(architectureDebtReportIssues(review.debt)).toEqual([]);
    expect(publishedSchemaIssues("runtime/review-result.schema.json", review)).toEqual([]);
  } finally { await daemon.stop(); Bun.gc(true); removeTempRepo(root); }
});

test("complete measures debt without a projection manifest, preserves checkpoint identities and stores actions", async () => {
  const root = tempRepo();
  const store = new TestLocalStore();
  const daemon = await createStartedTestDaemon({ localStore: store });
  try {
    await daemon.init(root, "Debt"); ownedModel(root);
    write(root, "src/new/tool.ts", "export const tool = 1;\n");
    const node = join(root, ".archcontext/model/nodes/capability.architecture.context.yaml");
    writeFileSync(node, readFileSync(node, "utf8").replace("Owns context.", "See `src/missing.ts:1`."));
    const editTime = readArchitectureDebt(root);
    expect(editTime.items.map(item => item.kind).sort()).toEqual(["stale-anchor", "unowned-path"]);
    const review = (await daemon.completeTask(root, { taskSessionId: "task.debt" })).data as any;
    expect(review.result).toBe("fail_action_required");
    expect(review.debt.items).toEqual(editTime.items);
    expect(review.actionsRequired).toEqual(editTime.actionsRequired);
    expect(review.findings.filter((finding: any) => finding.type === "architecture-debt").map((finding: any) => finding.id)).toEqual(editTime.items.map(item => item.id));
    expect(store.reviews.get(review.reviewId)).toEqual(review);
    expect(publishedSchemaIssues("runtime/review-result.schema.json", review)).toEqual([]);
    write(root, "src/missing.ts", "export const fixed = true;\n");
    writeFileSync(node, readFileSync(node, "utf8").replace("src/*.ts", "src/**"));
    const repaired = (await daemon.completeTask(root)).data as any;
    expect(repaired.result).toBe("pass_with_warnings");
    expect(repaired.debt.items).toEqual([]);
    expect(repaired.actionsRequired).toEqual([]);
  } finally { await daemon.stop(); Bun.gc(true); removeTempRepo(root); }
});

test("invalid models keep the schema gate and never publish a fabricated clean debt report", async () => {
  const root = tempRepo();
  const daemon = await createStartedTestDaemon();
  try {
    await daemon.init(root, "Debt"); ownedModel(root);
    const node = join(root, ".archcontext/model/nodes/capability.architecture.context.yaml");
    writeFileSync(node, readFileSync(node, "utf8").replace("archcontext.node/v2", "archcontext.node/v0"));
    const review = (await daemon.completeTask(root)).data as any;
    expect(review.result).toBe("fail_action_required");
    expect(review.findings).toContainEqual(expect.objectContaining({ type: "invalid-schema" }));
    expect(review.debt).toBeUndefined();
    expect(review.actionsRequired).toContain("archctx validate");
  } finally { await daemon.stop(); Bun.gc(true); removeTempRepo(root); }
});
