import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { digestJson, validateJsonSchema, type Json } from "@archcontext/contracts";
import { initializeArchContextModel, YamlModelStore } from "../../../local-runtime/model-store-yaml/src/index";
import { SqliteLocalStore, committedChangeSetFileOperation } from "../../../local-runtime/local-store-sqlite/src/index";
import { ChangeSetEngine, MANIFEST_UPDATE_OPERATION_SCHEMA, MANIFEST_UPDATE_PATH, planManifestFieldsOperation, type ChangeOperation } from "../src/index";
import { renderManifestFieldsUpdate } from "../src/manifest-update";
import { MCP_TOOL_INPUT_SCHEMAS } from "../../../surfaces/mcp-local/src/tool-schemas";

const roots: string[] = [];
const stores: SqliteLocalStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "archctx-manifest-")); roots.push(root);
  initializeArchContextModel(root, "Manifest Test");
  mkdirSync(join(root, "docs/adr"), { recursive: true });
  const path = join(root, MANIFEST_UPDATE_PATH);
  const before = readFileSync(path, "utf8").replace('decisions: "docs/adr"', 'decisions: ".archcontext/decisions"');
  writeFileSync(path, before);
  const journal = new SqliteLocalStore(join(root, "journal.sqlite")); stores.push(journal); await journal.migrate();
  const engine = new ChangeSetEngine({ modelStore: new YamlModelStore(), journal, projection: { planGeneratedProjection() { throw new Error("manifest update must not rebuild projections"); } } });
  const operation = planManifestFieldsOperation(root, { "content.decisions": "docs/adr" });
  const plan = (operations = [operation]) => engine.plan({ id: "changeset.manifest", base: { headSha: "test", worktreeDigest: digestJson({}), modelDigest: digestJson({}) }, reason: { taskSessionId: "task.manifest" }, operations });
  return { root, path, before, journal, engine, operation, plan };
}

test("manifest ChangeSet preserves unrelated settings and projections, with durable committed readback", async () => {
  const { root, path, before, journal, engine, plan } = await fixture();
  const marker = join(root, ".archcontext/generated/keep.txt"); writeFileSync(marker, "untouched\n");
  const draft = plan();
  expect(engine.preview(root, draft)).toMatchObject({ allowed: true, paths: [MANIFEST_UPDATE_PATH] });
  expect(readFileSync(path, "utf8")).toBe(before);
  await expect(engine.apply(root, draft)).rejects.toThrow("approved");
  await engine.apply(root, draft, { approved: true });
  const after = before.replace('decisions: ".archcontext/decisions"', 'decisions: "docs/adr"');
  expect(readFileSync(path, "utf8")).toBe(after);
  expect(readFileSync(marker, "utf8")).toBe("untouched\n");
  expect((await journal.listCommittedChangeSetsForTaskSession(root, "task.manifest"))[0].files).toEqual([{ path: MANIFEST_UPDATE_PATH, operation: "write", hash: digestJson({ body: after }) }]);
  expect(existsSync(`${path}.archctx-backup`)).toBe(false);
  expect(() => committedChangeSetFileOperation("unknown", "journal", MANIFEST_UPDATE_PATH)).toThrow("malformed");
});

test("manifest write failure rolls back exact bytes and creates no committed claim", async () => {
  const { root, path, before, journal, engine, plan } = await fixture();
  await expect(engine.apply(root, plan(), { approved: true, faultAfterOperations: 1 })).rejects.toThrow("fault-injection");
  expect(readFileSync(path, "utf8")).toBe(before);
  expect(await journal.listCommittedChangeSetsForTaskSession(root, "task.manifest")).toEqual([]);
  expect(journal.listUnresolvedChangeSetJournals()).toEqual([]);
  expect(existsSync(`${path}.archctx-backup`)).toBe(false);
});

test("pending manifest journal recovery restores the preimage after restart", async () => {
  const { root, path, before, journal, plan } = await fixture();
  const id = await journal.beginChangeSet(root, plan());
  const backupPath = `${path}.archctx-backup`;
  const body = renderManifestFieldsUpdate(before, { "content.decisions": "docs/adr" });
  await journal.recordChangeSetFile(id, { path: MANIFEST_UPDATE_PATH, backupPath, existed: true, operation: "update_manifest_fields", bodyHash: digestJson({ body }) });
  renameSync(path, backupPath); writeFileSync(path, body);
  journal.close(); stores.splice(stores.indexOf(journal), 1);
  const reopened = new SqliteLocalStore(join(root, "journal.sqlite")); stores.push(reopened); await reopened.migrate();
  expect(reopened.recoverPendingChangeSets()).toBe(1);
  expect(readFileSync(path, "utf8")).toBe(before);
  expect(await reopened.listCommittedChangeSetsForTaskSession(root, "task.manifest")).toEqual([]);
});

const invalid: Record<string, unknown>[] = [
  { path: ".archcontext/policies/other.yaml" }, { path: ".archcontext/./manifest.yaml" },
  { expectedHash: "missing" }, { expectedHash: "sha256:bad" }, { body: "arbitrary YAML" },
  { projectionFiles: [] }, { entityId: "product.other" }, { fields: {} },
  { fields: { "content.decisions": "elsewhere" } },
  { fields: { "content.decisions": "docs/adr", "privacy.cloudContentUpload": "allow" } }
];
for (const patch of invalid) test(`manifest rejects unsupported operation ${JSON.stringify(patch)}`, async () => {
  const { root, path, before, engine, operation, plan, journal } = await fixture();
  const draft = plan([{ ...operation, ...patch } as ChangeOperation]);
  expect(engine.preview(root, draft).allowed).toBe(false);
  await expect(engine.apply(root, draft, { approved: true })).rejects.toThrow();
  expect(readFileSync(path, "utf8")).toBe(before);
  expect(journal.listUnresolvedChangeSetJournals()).toEqual([]);
});

test("manifest scope cannot widen a mixed draft or generic operations", async () => {
  const { root, path, before, engine, operation, plan } = await fixture();
  const mixed = plan([operation, { op: "write_policy", path: ".archcontext/policies/new.yaml", expectedHash: "missing", body: "arbitrary" }]);
  expect(engine.preview(root, mixed).allowed).toBe(false);
  await expect(engine.apply(root, mixed, { approved: true })).rejects.toThrow("only ChangeSet operation");
  for (const op of ["create_entity", "update_entity_fields", "delete_entity", "write_policy", "render_projection", "render_agent_context"] as const) {
    const draft = plan([{ op, path: MANIFEST_UPDATE_PATH, expectedHash: operation.expectedHash, body: "arbitrary", ...((op === "render_projection" || op === "render_agent_context") ? { projectionFiles: [{ path: MANIFEST_UPDATE_PATH, expectedHash: operation.expectedHash, body: "arbitrary" }] } : {}) }]);
    expect(engine.preview(root, draft).allowed).toBe(false);
    await expect(engine.apply(root, draft, { approved: true })).rejects.toThrow();
    expect(readFileSync(path, "utf8")).toBe(before);
  }
});

test("manifest preview and apply reject a stale hash and absent ADR directory", async () => {
  const { root, path, before, engine, plan } = await fixture(); const draft = plan();
  writeFileSync(path, `${before}# concurrent edit\n`);
  expect(engine.preview(root, draft).allowed).toBe(false);
  await expect(engine.apply(root, draft, { approved: true })).rejects.toThrow();
  expect(readFileSync(path, "utf8")).toBe(`${before}# concurrent edit\n`);
  writeFileSync(path, before); rmSync(join(root, "docs/adr"), { recursive: true });
  expect(engine.preview(root, draft).allowed).toBe(false);
  await expect(engine.apply(root, draft, { approved: true })).rejects.toThrow();
  expect(readFileSync(path, "utf8")).toBe(before);
});

// Windows non-admin file symlink creation is not available; native path security has separate coverage.
test.skipIf(process.platform === "win32")("manifest rejects symlinked manifest, parent and ADR target", async () => {
  for (const target of [MANIFEST_UPDATE_PATH, ".archcontext", "docs/adr"]) {
    const { root, path, before, engine, plan } = await fixture(); const draft = plan();
    const original = join(root, target); const moved = `${original}-moved`;
    renameSync(original, moved); symlinkSync(moved, original, target.endsWith("yaml") ? "file" : "dir");
    expect(engine.preview(root, draft).allowed).toBe(false);
    await expect(engine.apply(root, draft, { approved: true })).rejects.toThrow();
    expect(readFileSync(path, "utf8")).toBe(before);
  }
});

test("manifest YAML edit preserves comments and unrelated settings and rejects ambiguous authority", () => {
  const body = '# project settings\nschemaVersion: archcontext.manifest/v1\ncontent:\n  decisions: legacy # ADR declaration\nprivacy:\n  cloudContentUpload: deny\nextension:\n  unknown: [one, two]\n';
  const after = renderManifestFieldsUpdate(body, { "content.decisions": "docs/adr" });
  expect(after).toContain("# project settings"); expect(after).toContain("# ADR declaration");
  expect(Bun.YAML.parse(after)).toEqual({ ...(Bun.YAML.parse(body) as object), content: { decisions: "docs/adr" } });
  for (const bad of [
    body.replace("decisions: legacy", "decisions: docs/adr"),
    body.replace("decisions: legacy", "decisions: [legacy]"),
    body.replace("archcontext.manifest/v1", "archcontext.manifest/v2"),
    body.replace("content:", "other:"),
    `${body}content:\n  decisions: duplicate\n`,
    'schemaVersion: archcontext.manifest/v1\ncontent: &shared\n  decisions: legacy\nother: *shared\n',
    'schemaVersion: archcontext.manifest/v1\ncontent:\n  decisions: &shared legacy\nother: *shared\n'
  ]) expect(() => renderManifestFieldsUpdate(bad, { "content.decisions": "docs/adr" })).toThrow();
});

test("manifest operation schema is shared by MCP and the checked runtime schema projection", async () => {
  const { operation } = await fixture();
  const runtime = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../schemas/runtime/changeset.schema.json"), "utf8"));
  expect(runtime.properties.operations.items.oneOf[1]).toEqual(MANIFEST_UPDATE_OPERATION_SCHEMA);
  const schema = MCP_TOOL_INPUT_SCHEMAS.archcontext_plan_update;
  expect(validateJsonSchema(schema, { root: "/repo", id: "changeset.manifest", operations: [operation] } as unknown as Json).valid).toBe(true);
  for (const patch of invalid) expect(validateJsonSchema(schema, { root: "/repo", id: "changeset.manifest", operations: [{ ...operation, ...patch }] } as unknown as Json).valid).toBe(false);
});
