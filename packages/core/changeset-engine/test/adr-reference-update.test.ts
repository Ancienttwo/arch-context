import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson } from "@archcontext/contracts";
import { initializeArchContextModel, YamlModelStore } from "../../../local-runtime/model-store-yaml/src/index";
import { SqliteLocalStore } from "../../../local-runtime/local-store-sqlite/src/index";
import { ChangeSetEngine, type ChangeOperation } from "../src/index";

const roots: string[] = [];
const stores: SqliteLocalStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const oldId = "capability.architecture.context", newId = "capability.architecture.renamed";
const adrPath = "docs/adr/ADR-0099-reference-test.md";
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "archctx-adr-")); roots.push(root);
  initializeArchContextModel(root, "ADR Test");
  mkdirSync(join(root, "docs/adr"), { recursive: true });
  const before = `---\nschemaVersion: archcontext.adr/v1\nid: adr.0099.reference-test\ntitle: References\nstatus: accepted\nappliesTo: # keep this comment\n  - '${oldId}' # keep inline\n---\n\n# Human prose\nDo not replace ${oldId} here.  \n\n`;
  writeFileSync(join(root, adrPath), before);
  const journal = new SqliteLocalStore(join(root, "journal.sqlite")); stores.push(journal); await journal.migrate();
  const engine = new ChangeSetEngine({ modelStore: new YamlModelStore(), journal, projection: { planGeneratedProjection: () => [] } });
  const operation = { op: "update_adr_references", path: adrPath, expectedHash: digestJson({ body: before }), references: [{ from: oldId, to: newId }] } as unknown as ChangeOperation;
  const nodePath = `.archcontext/model/nodes/${oldId}.yaml`;
  const node = readFileSync(join(root, nodePath), "utf8");
  const operations: ChangeOperation[] = [
    { op: "create_entity", path: `.archcontext/model/nodes/${newId}.yaml`, expectedHash: "missing", body: node.replace(oldId, newId) },
    operation,
    { op: "delete_entity", path: nodePath, expectedHash: digestJson({ body: node }) }
  ];
  const plan = (ops = operations) => engine.plan({ id: "changeset.adr", base: { headSha: "test", worktreeDigest: digestJson({}), modelDigest: digestJson({}) }, reason: { taskSessionId: "task.adr" }, operations: ops });
  return { root, before, journal, engine, operation, plan, nodePath, node };
}

test("ADR reference migration commits with its model rename and preserves every unrelated byte", async () => {
  const { root, before, journal, engine, plan, nodePath } = await fixture();
  expect(engine.preview(root, plan()).allowed).toBe(true);
  await engine.apply(root, plan(), { approved: true });
  const after = before.replace(`'${oldId}'`, `'${newId}'`);
  expect(readFileSync(join(root, adrPath), "utf8")).toBe(after);
  expect(existsSync(join(root, nodePath))).toBe(false);
  expect((await journal.listCommittedChangeSetsForTaskSession(root, "task.adr"))[0].files).toContainEqual({ path: adrPath, operation: "write", hash: digestJson({ body: after }) });
});

test("failure after ADR write restores model and ADR preimages without a committed claim", async () => {
  const { root, before, journal, engine, plan, nodePath, node } = await fixture();
  await expect(engine.apply(root, plan(), { approved: true, faultAfterOperations: 2 })).rejects.toThrow("fault-injection");
  expect(readFileSync(join(root, adrPath), "utf8")).toBe(before);
  expect(readFileSync(join(root, nodePath), "utf8")).toBe(node);
  expect(existsSync(join(root, `.archcontext/model/nodes/${newId}.yaml`))).toBe(false);
  expect(await journal.listCommittedChangeSetsForTaskSession(root, "task.adr")).toEqual([]);
  expect(journal.listUnresolvedChangeSetJournals()).toEqual([]);
});

const invalid: Record<string, unknown>[] = [
  { path: "docs/adr/other.md" }, { path: "docs/adr/../ADR-0099-reference-test.md" },
  { path: "AGENTS.md" }, { expectedHash: "missing" }, { expectedHash: `sha256:${"0".repeat(64)}` },
  { body: "# arbitrary body" }, { projectionFiles: [] }, { references: [] },
  { references: [{ from: oldId, to: newId, extra: true }] },
  { references: [{ from: oldId, to: oldId }] },
  { references: [{ from: "capability.absent", to: newId }] },
  { references: [{ from: oldId, to: newId }, { from: oldId, to: "capability.other" }] }
];
for (const patch of invalid) test(`ADR operation rejects ${JSON.stringify(patch)}`, async () => {
  const { root, before, journal, engine, operation, plan } = await fixture();
  const draft = plan([{ ...operation, ...patch } as ChangeOperation]);
  expect(engine.preview(root, draft).allowed).toBe(false);
  await expect(engine.apply(root, draft, { approved: true })).rejects.toThrow();
  expect(readFileSync(join(root, adrPath), "utf8")).toBe(before);
  expect(await journal.listCommittedChangeSetsForTaskSession(root, "task.adr")).toEqual([]);
});

test("ADR unknown target fails model validation and generic operations cannot write ADRs", async () => {
  const { root, before, engine, operation, plan } = await fixture();
  await expect(engine.apply(root, plan([operation]), { approved: true })).rejects.toThrow("after apply");
  expect(readFileSync(join(root, adrPath), "utf8")).toBe(before);
  for (const op of ["create_entity", "update_entity_fields", "delete_entity", "write_policy", "render_projection", "render_agent_context"] as const) {
    const draft = plan([{ op, path: adrPath, expectedHash: operation.expectedHash, body: "arbitrary", ...((op === "render_projection" || op === "render_agent_context") ? { projectionFiles: [{ path: adrPath, expectedHash: operation.expectedHash, body: "arbitrary" }] } : {}) }]);
    expect(engine.preview(root, draft).allowed).toBe(false);
    await expect(engine.apply(root, draft, { approved: true })).rejects.toThrow();
    expect(readFileSync(join(root, adrPath), "utf8")).toBe(before);
  }
});

test("ADR schema is shared with MCP and proposal parser, without arbitrary-body escape", async () => {
  const { ADR_REFERENCE_OPERATION_SCHEMA } = await import("../src/index");
  const { MCP_TOOL_INPUT_SCHEMAS } = await import("../../../surfaces/mcp-local/src/tool-schemas");
  const { validateJsonSchema } = await import("@archcontext/contracts");
  const { parseModelProposal } = await import("../../../../scripts/apply-model-proposal");
  const { root, operation } = await fixture();
  const runtime = await Bun.file(join(import.meta.dir, "../../../../schemas/runtime/changeset.schema.json")).json();
  expect(runtime.properties.operations.items.oneOf[2]).toEqual(ADR_REFERENCE_OPERATION_SCHEMA);
  expect(validateJsonSchema(MCP_TOOL_INPUT_SCHEMAS.archcontext_plan_update, { root, id: "changeset.adr", operations: [operation] } as any).valid).toBe(true);
  const proposal = { schemaVersion: "archcontext.model-proposal/v1", changeSetId: "changeset.adr", taskSessionId: "task.adr", operations: [operation] };
  expect(JSON.stringify(parseModelProposal(proposal).operations)).toBe(JSON.stringify([operation]));
  expect(() => parseModelProposal({ ...proposal, operations: [{ ...operation, body: "arbitrary" }] })).toThrow();
  expect(() => parseModelProposal({ ...proposal, operations: [operation, operation] })).toThrow("duplicate");
});

test("ADR scalar edits preserve CRLF, quote style, prose and comments; ambiguous frontmatter is refused", async () => {
  const { renderAdrReferenceUpdate } = await import("../src/adr-reference-update");
  const { before } = await fixture();
  const references = [{ from: oldId, to: newId }];
  const crlf = before.replaceAll("\n", "\r\n");
  expect(renderAdrReferenceUpdate(crlf, references)).toBe(crlf.replace(`'${oldId}'`, `'${newId}'`));
  for (const bad of [
    before.replace("---\n", ""), before.replace("archcontext.adr/v1", "other"),
    before.replace(`'${oldId}'`, `&ref '${oldId}'`),
  ]) expect(() => renderAdrReferenceUpdate(bad, references)).toThrow();
  for (const extra of [`  - '${oldId}'\n`, `  - '${newId}'\n`, "appliesTo: [other]\n", "other: &shared [one]\nconsumer: *shared\n"]) {
    expect(() => renderAdrReferenceUpdate(before.replace("---\n\n# Human", `${extra}---\n\n# Human`), references)).toThrow();
  }
});


test("ADR symlink target and parent are refused without changing their content", async () => {
  const { root, before, engine, operation, plan } = await fixture();
  const path = join(root, adrPath);
  renameSync(path, `${path}.original`); symlinkSync(`${path}.original`, path);
  expect(engine.preview(root, plan([operation])).allowed).toBe(false);
  await expect(engine.apply(root, plan([operation]), { approved: true })).rejects.toThrow("symlink");
  expect(readFileSync(`${path}.original`, "utf8")).toBe(before);
  rmSync(path); renameSync(`${path}.original`, path);
  renameSync(join(root, "docs/adr"), join(root, "docs/adr-original"));
  symlinkSync(join(root, "docs/adr-original"), join(root, "docs/adr"));
  expect(engine.preview(root, plan([operation])).allowed).toBe(false);
  await expect(engine.apply(root, plan([operation]), { approved: true })).rejects.toThrow("symlink");
  expect(readFileSync(path, "utf8")).toBe(before);
});

test("pending ADR journal recovery restores the exact preimage after restart", async () => {
  const { root, before, journal, operation, plan } = await fixture();
  const { renderAdrReferenceUpdate } = await import("../src/adr-reference-update");
  const path = join(root, adrPath), backupPath = `${path}.archctx-backup`;
  const body = renderAdrReferenceUpdate(before, operation.references!);
  const id = await journal.beginChangeSet(root, plan([operation]));
  await journal.recordChangeSetFile(id, { path: adrPath, backupPath, existed: true, operation: "update_adr_references", bodyHash: digestJson({ body }) });
  renameSync(path, backupPath); writeFileSync(path, body);
  journal.close(); stores.splice(stores.indexOf(journal), 1);
  const reopened = new SqliteLocalStore(join(root, "journal.sqlite")); stores.push(reopened); await reopened.migrate();
  expect(reopened.recoverPendingChangeSets()).toBe(1);
  expect(readFileSync(path, "utf8")).toBe(before);
  expect(await reopened.listCommittedChangeSetsForTaskSession(root, "task.adr")).toEqual([]);
});
