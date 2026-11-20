import { expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failureIssues, stableYaml, type Json, type JsonEnvelope } from "@archcontext/contracts";
import * as projectionEngine from "@archcontext/core/projection-engine";
import * as modelStore from "@archcontext/local-runtime/model-store-yaml";
import { createStartedTestDaemon } from "./runtime-test-fixtures";
import { publishedSchemaIssues } from "../../../contracts/test/published-schemas";
import { runCli } from "../../../surfaces/cli/src/main";
import * as codeGraphCli from "../../codegraph-adapter/src/cli-invocation";
import { pinnedCodeGraphProvider } from "../../codegraph-adapter/src/read-session";
import { indexCodeGraphFixture } from "../../codegraph-adapter/test/real-index";
import { commitFixture, fixtureGit, writeFixtureFile } from "../../model-store-yaml/test/fixtures/native-context/fixture";
import { buildArchitectureDocsProjection } from "../src/projection-service";
import { runRuntimeVerifyCommand } from "../src/verify";

const CAPABILITY = "capability.architecture.context";
const STORE = "component.verify.store";
const MANIFEST_PATH = "docs/architecture/.projection-manifest.json";
const MACHINE = "state-machine.verify.run";

function fixture(): { root: string; base: string; head: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), "archctx-verify-"));
  const cleanup = () => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  try {
    fixtureGit(root, ["init", "-q"]);
    fixtureGit(root, ["config", "core.autocrlf", "false"]);
    fixtureGit(root, ["config", "maintenance.auto", "false"]);
    modelStore.initializeArchContextModel(root, "Verify fixture");
    const write = (path: string, value: Json) => writeFixtureFile(root, path, stableYaml(value));
    writeFixtureFile(root, ".gitignore", ".codegraph/\n");
    writeFixtureFile(root, "src/run.ts", 'import { save } from "./store";\nexport function run() { return save(); }\n');
    writeFixtureFile(root, "src/store.ts", 'export function save() { return "saved"; }\n');
    write(`.archcontext/model/nodes/${CAPABILITY}.yaml`, {
      schemaVersion: "archcontext.node/v2", id: CAPABILITY, kind: "capability", name: "Verify", status: "active",
      summary: "See `src/missing.ts:1`.",
      source: { include: ["src/run.ts"], entrypoints: [{ id: "entrypoint.verify.run", path: "src/run.ts", symbols: [
        { name: "run", sinks: [{ id: "sink.verify.save", path: "src/store.ts", symbol: "save" }] }
      ] }] }, extensions: { contractFiles: { agents: "AGENTS.md", claude: "CLAUDE.md" } }
    });
    write(`.archcontext/model/nodes/${STORE}.yaml`, {
      schemaVersion: "archcontext.node/v2", id: STORE, kind: "component", parent: CAPABILITY,
      name: "Store", status: "active", summary: "Stores data.", source: { include: ["src/store.ts"] }
    });
    write(".archcontext/model/relations/relation.verify.store.yaml", {
      schemaVersion: "archcontext.relation/v1", id: "relation.verify.store", kind: "writes",
      source: CAPABILITY, target: STORE, intent: "Store the result."
    });
    write(".archcontext/model/flows/flow.verify.yaml", {
      schemaVersion: "archcontext.flow/v1", id: "flow.verify", capabilityId: CAPABILITY,
      name: "Verify", applicability: "not-applicable", rationale: "Fixture uses the selector outside a flow."
    });
    write(".archcontext/model/constraints/constraint.verify.store.yaml", {
      schemaVersion: "archcontext.constraint/v1", id: "constraint.verify.store", name: "Store boundary", severity: "error",
      rationale: "Exercise real import evidence.", scope: { nodes: [CAPABILITY] },
      rule: { type: "forbid-dependency", targets: [STORE] }
    });
    write(`.archcontext/model/state-machines/${MACHINE}.yaml`, {
      schemaVersion: "archcontext.state-machine/v1", id: MACHINE, capabilityId: CAPABILITY, name: "Run",
      regions: [
        { id: "job", label: "Job", initial: "pending", states: [{ id: "pending", label: "Pending" }, { id: "done", label: "Done", terminal: true }] },
        { id: "lock", label: "Lock", initial: "free", states: [{ id: "free", label: "Free" }] }
      ],
      events: [{ id: "run", label: "Run", source: { kind: "code", path: "src/run.ts", symbol: "run" }, steps: [{ when: { job: ["pending"] }, then: { job: "done" } }] }],
      rules: [{ id: "never-done", label: "Never done", never: { job: ["done"], lock: ["free"] } }]
    });
    commitFixture(root, "model and source");
    indexCodeGraphFixture(root);
    const projection = buildArchitectureDocsProjection(undefined, root, "repo-harness/v1");
    for (const file of projection.files) writeFixtureFile(root, file.path, file.body);
    const base = commitFixture(root, "baseline projection");
    writeFixtureFile(root, MANIFEST_PATH, `${readFileSync(join(root, MANIFEST_PATH), "utf8")}\n`);
    const head = commitFixture(root, "generated-only change");
    return { root, base, head, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** Directory times also catch files created and removed within a command. */
function checkoutSnapshot(path: string): unknown {
  const stat = statSync(path, { bigint: true });
  const content = stat.isDirectory()
    ? readdirSync(path).sort().map(name => [name, checkoutSnapshot(join(path, name))])
    : readFileSync(path).toString("base64");
  return [stat.ino, stat.mtimeNs, stat.ctimeNs, stat.size, content];
}

function checkPayload(result: Awaited<ReturnType<typeof runCli>>) {
  return result.ok ? { ok: true, data: result.data } : { ok: false, error: "error" in result ? result.error : undefined };
}

const verifySchema = "runtime/runtime-verify.schema.json";
const timeout = 90_000;

test("verify matches the seven standalone CLI checks on one certified snapshot", async () => {
  const { root, base, head, cleanup } = fixture();
  const daemon = await createStartedTestDaemon();
  const provider = pinnedCodeGraphProvider();
  const open = spyOn(provider, "openReadOnly");
  const model = spyOn(projectionEngine, "loadNativeModelFromModelFiles");
  const diskModel = spyOn(projectionEngine, "loadNativeModelFromArchContext");
  const files = spyOn(modelStore, "listModelFiles");
  const sync = spyOn(codeGraphCli, "syncCodeGraphIndex");
  let batched: JsonEnvelope;
  try {
    try {
      const before = checkoutSnapshot(root);
      batched = runRuntimeVerifyCommand(root, base, provider);
      expect(batched.ok, JSON.stringify(batched)).toBe(true);
      expect(open).toHaveBeenCalledTimes(1);
      expect(existsSync(open.mock.calls[0]![0])).toBe(false);
      expect(model).toHaveBeenCalledTimes(1);
      expect(diskModel).toHaveBeenCalledTimes(0);
      expect(files).toHaveBeenCalledTimes(1);
      expect(sync).toHaveBeenCalledTimes(0);
      expect(checkoutSnapshot(root)).toEqual(before);
    } finally {
      for (const spy of [open, model, diskModel, files, sync]) spy.mockRestore();
    }
    const cli = await runCli("verify", ["--base", base, "--json"], root);
    expect(cli).toEqual(batched);
    expect(publishedSchemaIssues(verifySchema, cli.data)).toEqual([]);
    const checks = {
      validate: checkPayload(await runCli("validate", ["--json"], root, { runtimeClient: daemon })),
      flows: checkPayload(await runCli("flows", ["check", "--no-sync", "--json"], root)),
      "state-machines": checkPayload(await runCli("state-machines", ["check", "--json"], root)),
      constraints: checkPayload(await runCli("constraints", ["check", "--json"], root)),
      docs: checkPayload(await runCli("docs", ["anchors", "--json"], root)),
      projection: checkPayload(await runCli("projection", ["verify-pr", "--base", base, "--json"], root)),
      debt: checkPayload(await runCli("debt", ["--json"], root))
    };
    // Compare the standalone payloads byte for byte, including serialization order.
    expect(JSON.stringify(cli.data)).toBe(JSON.stringify({ schemaVersion: "archcontext.runtime-verify/v1", base, baseSha: base, headSha: head, checks }));
    expect(checks.projection).toMatchObject({ ok: true, data: { generatedOnly: true } });
    expect(checks.flows).toMatchObject({ ok: true, data: { selectors: [{ status: "proven" }] } });
    expect(checks["state-machines"]).toMatchObject({ ok: true, data: { machines: [{ anchors: [{ status: "anchor-unconfirmed" }] }] } });
    expect(checks.constraints).toMatchObject({ ok: true, data: { status: "violated", coverage: "complete" } });
    expect(checks.docs).toMatchObject({ ok: true, data: { summary: { findings: 1 } } });
    expect(checks.debt).toMatchObject({ ok: true, data: { items: expect.arrayContaining([expect.objectContaining({ kind: "state-machine-rule" })]) } });
  } finally {
    await daemon.stop();
    cleanup();
  }
}, timeout);

for (const state of ["stale", "missing"] as const) {
  test(`verify preserves findings on a generated-only PR with a ${state} index, without sync or writes`, async () => {
    const { root, base, cleanup } = fixture();
    const sync = spyOn(codeGraphCli, "syncCodeGraphIndex");
    try {
      if (state === "stale") {
        writeFixtureFile(root, "new-untracked.ts", "export const pending = 1;\n");
        // The normal SDK open repairs this file. Verify must leave its absence intact.
        rmSync(join(root, ".codegraph/.gitignore"));
        // A stat-only change must not rewrite the Git index or mark the worktree dirty.
        utimesSync(join(root, "src/run.ts"), 0, 0);
      } else {
        rmSync(join(root, ".codegraph"), { recursive: true });
      }
      const before = checkoutSnapshot(root);
      const result = await runCli("verify", ["--base", base, "--json"], root);
      expect(publishedSchemaIssues(verifySchema, result.data)).toEqual([]);
      const unavailable = { ok: false, error: {
        code: "AC_CODE_FACTS_UNAVAILABLE",
        reasonCode: state === "stale" ? "code-facts-read-not-ready" : "index-missing"
      }};
      expect(result).toMatchObject({ ok: true, data: { checks: {
        validate: { ok: true, data: { valid: true } },
        projection: unavailable,
        flows: unavailable,
        "state-machines": { ok: true, data: { machines: [{ id: MACHINE, rules: [{ id: "never-done", status: "broken" }] }] } },
        docs: { ok: true, data: { summary: { findings: 1 } } },
        constraints: { ok: true, data: { status: "undetermined" } },
        debt: { ok: true, data: { items: expect.arrayContaining([expect.objectContaining({ kind: "state-machine-rule" })]) } }
      } } });
      expect(sync).toHaveBeenCalledTimes(0);
      expect(checkoutSnapshot(root)).toEqual(before);
    } finally {
      sync.mockRestore();
      cleanup();
    }
  }, timeout);
}

test("verify validates the worktree YAML when standalone validate uses the authoritative ledger", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-verify-ledger-"));
  const daemon = await createStartedTestDaemon({ architectureLedger: { rolloutMode: "ledger-authoritative" } });
  try {
    fixtureGit(root, ["init", "-q"]);
    expect((await daemon.init(root, "Verify ledger authority")).ok).toBe(true);
    const path = ".archcontext/model/nodes/module.verify.ledger.yaml";
    const plan = await daemon.planUpdate(root, {
      id: "changeset.verify-ledger-node",
      operations: [{ op: "create_entity", path, expectedHash: "missing", body: stableYaml({
        schemaVersion: "archcontext.node/v2", id: "module.verify.ledger", kind: "module",
        name: "Ledger node", status: "active", summary: "Retained in the ledger."
      }) }]
    });
    expect(plan.ok).toBe(true);
    const data = plan.data as { draft: { base: { worktreeDigest: string } } };
    const applied = await daemon.applyUpdate(root, {
      id: "changeset.verify-ledger-node", approved: true, expectedWorktreeDigest: data.draft.base.worktreeDigest
    });
    expect(applied.ok).toBe(true);
    commitFixture(root);
    rmSync(join(root, path));

    const standalone = await runCli("validate", ["--json"], root, { runtimeClient: daemon });
    expect(standalone).toMatchObject({ ok: true, data: { valid: true, architectureLedger: { readAuthority: "ledger" } } });
    const yaml = modelStore.validateModelFiles(modelStore.listModelFiles(root));
    expect(yaml.modelDigest).not.toBe((standalone.data as { modelDigest: string }).modelDigest);
    const before = checkoutSnapshot(root);
    const verify = await runCli("verify", ["--base", "HEAD", "--json"], root, { runtimeClient: daemon });
    expect(verify).toMatchObject({ ok: true });
    expect((verify.data as { checks: { validate: unknown } }).checks.validate).toEqual({ ok: true, data: yaml });
    expect(publishedSchemaIssues(verifySchema, verify.data)).toEqual([]);
    expect(checkoutSnapshot(root)).toEqual(before);
  } finally {
    await daemon.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify fails closed on an invalid base and preserves the model adoption error at a valid base", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-verify-bad-base-"));
  try {
    fixtureGit(root, ["init", "-q"]);
    writeFixtureFile(root, "readme.md", "fixture\n");
    commitFixture(root);
    const result = await runCli("verify", ["--base", "refs/heads/absent", "--json"], root);
    expect(result).toMatchObject({ schemaVersion: "archcontext.envelope/v1", requestId: "verify", ok: false, error: {
      code: "AC_PRECONDITION_FAILED", reasonCode: "native-context-ref-unavailable"
    } });
    expect(result.data).toBeUndefined();
    expect(failureIssues("error" in result ? result.error : undefined)).toEqual([]);
    const unadopted = await runCli("verify", ["--base", "HEAD", "--json"], root);
    expect(unadopted).toMatchObject({ ok: true, data: { checks: {
      validate: { ok: true, data: { valid: false } },
      projection: { ok: true, data: { verdict: "no-changes" } },
      debt: { ok: false, error: { code: "AC_MODEL_ADOPTION_REQUIRED", reasonCode: "model-missing" } }
    } } });
    expect(publishedSchemaIssues(verifySchema, unadopted.data)).toEqual([]);
    expect(existsSync(join(root, ".codegraph"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
