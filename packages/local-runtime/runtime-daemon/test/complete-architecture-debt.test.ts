import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { architectureDebtReportIssues, stableYaml } from "@archcontext/contracts";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { publishedSchemaIssues } from "../../../contracts/test/published-schemas";
import { createStartedTestDaemon, tempRepo, removeTempRepo } from "./runtime-test-fixtures";
import { readArchitectureDebt } from "../src/architecture-debt";
import { runStateMachineCheckCommand } from "../src/state-machine-check";
import { indexCodeGraphFixture, syncCodeGraphFixture } from "../../codegraph-adapter/test/real-index";

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

const RULES = "export interface Shape {\n  size: number;\n}\nexport type Port = {\n  send: (value: number) => number;\n};\nexport function measure(shape: Shape): number {\n  return shape.size;\n}\nexport function scale(value: number): number {\n  return value * 2;\n}\nexport function decide(shape: Shape, by: (shape: Shape) => number): number {\n  return by(shape);\n}\n";
const JOB = "import { decide, measure, scale, type Port, type Shape } from \"./rules\";\nexport class Store {\n  finish(shape: Shape, port: Port): number {\n    const inner = () => scale(1);\n    return decide(shape, measure) + inner() + port.send(1);\n  }\n}\n";
function jobMachine(digests: { file?: string; symbol?: string } = {}) {
  return stableYaml({
    schemaVersion: "archcontext.state-machine/v1", id: "state-machine.architecture.context.job", capabilityId: "capability.architecture.context", name: "Job",
    regions: [
      { id: "job", label: "Job", initial: "queued", states: [{ id: "queued", label: "Queued" }, { id: "done", label: "Done" }],
        source: { kind: "code", path: "src/job.ts", ...(digests.file ? { confirmedDigest: digests.file } : {}) } },
      { id: "lock", label: "Lock", initial: "free", states: [{ id: "free", label: "Free" }] }
    ],
    events: [
      { id: "finish", label: "Finish", source: { kind: "code", path: "src/job.ts", symbol: "Store.finish", ...(digests.symbol ? { confirmedDigest: digests.symbol } : {}) },
        steps: [{ when: { job: ["queued"] }, then: { job: "done" } }] },
      { id: "reopen", label: "Reopen", source: { kind: "environment" }, steps: [{ when: { job: ["done"] }, then: { job: "queued" } }] }
    ],
    rules: [
      { id: "never-done", label: "Never done", never: { job: ["done"], lock: ["free"] } },
      { id: "done-stays", label: "Done stays", final: { job: ["done"] }, finding: { tracking: "https://example.com/issues/1" } },
      { id: "lock-stays", label: "Lock stays", final: { lock: ["free"] }, finding: { tracking: "https://example.com/issues/2" } }
    ]
  });
}

test("state machine debt: complete reports rules, and anchors go stale until the digest is confirmed (SM-S17 to SM-S20, SM-S23)", async () => {
  const root = tempRepo();
  const daemon = await createStartedTestDaemon();
  const machinePath = ".archcontext/model/state-machines/job.yaml";
  const stale = (paths: string[]) => readArchitectureDebt(root, { changedPaths: paths }).items.filter(item => item.kind === "state-machine-stale")
    .map((item): unknown[] => [item.reasonCode, item.paths, item.details.ownerId, item.details.symbol ?? null]);
  try {
    await daemon.init(root, "Debt"); ownedModel(root);
    write(root, "src/job.ts", JOB);
    write(root, "src/rules.ts", RULES);
    write(root, machinePath, jobMachine());
    const review = (await daemon.completeTask(root)).data as any;
    expect(review.debt.items.filter((item: any) => item.kind === "state-machine-rule").map((item: any) => [item.reasonCode, item.details.ruleId]).sort())
      .toEqual([["finding-resolved", "lock-stays"], ["rule-broken", "never-done"]]);
    expect(architectureDebtReportIssues(review.debt)).toEqual([]);

    // Without an index a changed path cannot rule out a callee, so the symbol anchor is a coverage gap.
    expect(readArchitectureDebt(root, { changedPaths: ["src/main.ts"] }).coverageReasonCodes).toContain("state-machines:index-missing");

    indexCodeGraphFixture(root);
    // Bun on macOS uses the system SQLite, which refuses a read-only open unless a connection holds the index.
    const holder = new Database(join(root, ".codegraph", "codegraph.db"));
    try {
      holder.query("SELECT count(*) FROM sqlite_master").get();
      const check = runStateMachineCheckCommand(root);
      const anchors = (check.data as any).machines[0].anchors;
      expect(anchors.map((anchor: any) => [anchor.owner, anchor.ownerId, anchor.status])).toEqual([["region", "job", "anchor-unconfirmed"], ["event", "finish", "anchor-unconfirmed"]]);
      expect(anchors[0].digest).toBe(`sha256:${createHash("sha256").update(JOB).digest("hex")}`);
      // A call, a value reference and a call from a nested declaration are callees; an interface, a type alias and its member are not.
      expect(anchors[1].callees.map((callee: any) => [callee.path, callee.qualifiedName])).toEqual([["src/rules.ts", "decide"], ["src/rules.ts", "measure"], ["src/rules.ts", "scale"]]);
      const lines = (text: string, from: number, to: number) => text.split("\n").slice(from - 1, to).join("\n");
      expect(anchors[1].digest).toBe(`sha256:${createHash("sha256").update(JSON.stringify([lines(JOB, 3, 6), lines(RULES, 13, 15), lines(RULES, 7, 9), lines(RULES, 10, 12)])).digest("hex")}`);
      expect(publishedSchemaIssues("runtime/state-machine-check.schema.json", check.data)).toEqual([]);
      expect(stale(["src/job.ts"])).toHaveLength(2);

      // The test writes the reported digests where a ChangeSet would.
      write(root, machinePath, jobMachine({ file: anchors[0].digest, symbol: anchors[1].digest }));
      expect(stale(["src/job.ts"])).toEqual([]);

      // A fresh anchor file with a stale callee file fails closed too.
      write(root, "src/rules.ts", RULES.replace("value * 2", "value * 4"));
      expect(readArchitectureDebt(root, { changedPaths: ["src/rules.ts"] }).coverageReasonCodes).toContain("state-machines:index-stale");
      write(root, "src/rules.ts", RULES);

      write(root, "src/job.ts", `${JOB}export const later = 2;\n`);
      expect(stale(["src/job.ts"])).toEqual([["anchor-changed", ["src/job.ts"], "job", null]]);
      // The index no longer holds the anchored file, so the symbol anchor is not measured until a sync.
      expect((runStateMachineCheckCommand(root).data as any).machines[0].anchors[1]).toMatchObject({ status: "unchecked", reason: "index-stale" });

      write(root, "src/job.ts", JOB.replace("port.send(1)", "port.send(2)"));
      syncCodeGraphFixture(root);
      expect(stale(["src/job.ts"]).filter(entry => entry[3] !== null)).toEqual([["anchor-changed", ["src/job.ts"], "finish", "Store.finish"]]);

      // A callee edit in another file selects the anchor through that path; the item keeps the anchor's path.
      write(root, "src/job.ts", JOB);
      write(root, "src/rules.ts", RULES.replace("value * 2", "value * 3"));
      syncCodeGraphFixture(root);
      expect(stale(["src/rules.ts"])).toEqual([["anchor-changed", ["src/job.ts"], "finish", "Store.finish"]]);

      // A sibling declared on the anchor's last line is not part of its body, so its callee is not the anchor's.
      write(root, "src/rules.ts", `${RULES}export function spare(): number {\n  return 0;\n}\n`);
      write(root, "src/job.ts", JOB.replace("scale,", "scale, spare,").replace("port.send(1);\n  }", "port.send(1);\n  } other(): number { return spare(); }"));
      syncCodeGraphFixture(root);
      expect((runStateMachineCheckCommand(root).data as any).machines[0].anchors[1].callees.map((callee: any) => callee.qualifiedName)).toEqual(["decide", "measure", "scale"]);

      // A deleted callee file still selects the anchor, which the index cannot measure until a sync.
      rmSync(join(root, "src/rules.ts"));
      expect(readArchitectureDebt(root, { changedPaths: ["src/rules.ts"] }).coverageReasonCodes).toContain("state-machines:index-stale");
      // After the sync the index holds no edge into the deleted file, and the path still selects the anchor.
      syncCodeGraphFixture(root);
      expect(stale(["src/rules.ts"])).toEqual([["anchor-changed", ["src/job.ts"], "finish", "Store.finish"]]);
      // A symbol anchor whose own file is gone as well is selected and reported as missing.
      rmSync(join(root, "src/job.ts"));
      expect(stale(["src/rules.ts"])).toEqual([["anchor-missing-path", ["src/job.ts"], "finish", "Store.finish"]]);
    } finally { holder.close(); }
  } finally { await daemon.stop(); Bun.gc(true); removeTempRepo(root); }
}, 120_000);

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

test("D6-A embedded unknown provider failure is safe and never saves a successful review", async () => {
  const { CodeGraphAdapter } = await import("@archcontext/local-runtime/codegraph-adapter");
  const { MockCodeGraphProvider } = await import("@archcontext/local-runtime/test/codegraph-factories");
  const { failureIssues } = await import("@archcontext/contracts");
  const root = tempRepo();
  const store = new TestLocalStore();
  const facts = new CodeGraphAdapter(new MockCodeGraphProvider());
  const daemon = await createStartedTestDaemon({ codeFacts: facts, localStore: store });
  const sentinel = "/private/provider/root Authorization=provider-secret source-body";
  try {
    await daemon.init(root, "D6 unknown provider");
    facts.sync = async () => { throw new Error(sentinel); };
    const result = await daemon.completeTask(root);
    expect(result).toMatchObject({ ok: false, error: { code: "AC_UNCLASSIFIED_FAILURE", reasonCode: "failure-unclassified", retryable: false, details: { stage: "complete" } } });
    expect(failureIssues(result.error)).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(store.reviews.size).toBe(0);
  } finally { await daemon.stop(); removeTempRepo(root); }
});

test("D6-A explicit checkpoint failure preserves its seeded baseline", async () => {
  const root = tempRepo();
  const store = new TestLocalStore();
  const daemon = await createStartedTestDaemon({ localStore: store });
  try {
    await daemon.init(root, "D6 baseline");
    await daemon.prepare(root, "keep checkpoint baseline", 12288, 12, "task_d6");
    const before = structuredClone([...store.taskStates]);
    const invalid = await daemon.practiceCheckpoint(root, { taskSessionId: "task_d6", changedPaths: ["../outside"] });
    expect(invalid).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID", reasonCode: "changed-path-invalid", details: { checks: ["ownership", "anchors"] } } });
    expect([...store.taskStates]).toEqual(before);
    await daemon.stop();
    const stopped = await daemon.practiceCheckpoint(root, { taskSessionId: "task_d6" });
    expect(stopped).toMatchObject({ ok: false, error: { code: "AC_PRECONDITION_FAILED", reasonCode: "runtime-not-running", action: "rebuild-plan", details: {} } });
    expect([...store.taskStates]).toEqual(before);
  } finally { await daemon.stop(); removeTempRepo(root); }
});
