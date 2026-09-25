import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson, type Json } from "@archcontext/contracts";
import { initializeArchContextModel, YamlModelStore } from "../../../local-runtime/model-store-yaml/src/index";
import { SqliteLocalStore } from "../../../local-runtime/local-store-sqlite/src/index";
import { renderAgentContextProjection, loadAgentContextProjectionFiles, loadNativeModelFromArchContext, agentContextProjectionTargetPaths } from "../../projection-engine/src/index";
import { ChangeSetEngine, type AgentContextScopePort, type ChangeOperation } from "../src/index";

const roots: string[] = [], stores: SqliteLocalStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "archctx-root-contract-")); roots.push(root);
  initializeArchContextModel(root, "Root Test");
  const nodePath = join(root, ".archcontext/model/nodes/capability.architecture.context.yaml");
  writeFileSync(nodePath, readFileSync(nodePath, "utf8") + 'extensions:\n  contractFiles:\n    agents: "AGENTS.md"\n    claude: "CLAUDE.md"\n');
  const human = "# Human routing\nKeep these spaces.  \n\n\n";
  for (const path of ["AGENTS.md", "CLAUDE.md"]) writeFileSync(join(root, path), human);
  const canonical = () => { const model = loadNativeModelFromArchContext(root); return renderAgentContextProjection({ model, sourceDigest: digestJson({ model } as unknown as Json), existingFiles: loadAgentContextProjectionFiles(root, model) }); };
  const scope: AgentContextScopePort = {
    derive: () => new Set(agentContextProjectionTargetPaths(loadNativeModelFromArchContext(root)).map(target => target.path)),
    validateRootWrite: (_root, file) => { if (canonical().files.find(candidate => candidate.path === file.path)?.body !== file.body) throw new Error("canonical mismatch"); }
  };
  const journal = new SqliteLocalStore(join(root, "journal.sqlite")); stores.push(journal); await journal.migrate();
  const engine = new ChangeSetEngine({ modelStore: new YamlModelStore(), projection: { planGeneratedProjection: () => [] }, journal, agentContextScope: scope });
  const operation: ChangeOperation = { op: "render_agent_context", expectedHash: "missing", projectionFiles: canonical().files.map(file => ({ path: file.path, body: file.body, expectedHash: digestJson({ body: human }) })) };
  const plan = (ops = [operation]) => engine.plan({ id: "changeset.root", base: { headSha: "test", worktreeDigest: digestJson({}), modelDigest: digestJson({}) }, reason: { taskSessionId: "task.root" }, operations: ops });
  return { root, human, scope, journal, engine, operation, plan, nodePath };
}

test("root failure after the first file restores both human contracts and aborts journal", async () => {
  const { root, human, journal, engine, plan } = await fixture();
  await expect(engine.apply(root, plan(), { approved: true, faultAfterOperations: 1 })).rejects.toThrow("fault-injection");
  for (const path of ["AGENTS.md", "CLAUDE.md"]) expect(readFileSync(join(root, path), "utf8")).toBe(human);
  expect(await journal.listCommittedChangeSetsForTaskSession(root, "task.root")).toEqual([]);
  expect(journal.listUnresolvedChangeSetJournals()).toEqual([]);
});

for (const variant of ["human", "generated", "missing", "stale", "symlink", "undeclared", "validator", "wrong-kind"] as const) test(`root rejects ${variant} write`, async () => {
  const { root, human, scope, engine, operation, plan, nodePath } = await fixture();
  const file = operation.projectionFiles![0]!;
  if (variant === "human") file.body = file.body.replace("Human routing", "forged");
  if (variant === "generated") file.body = file.body.replace("Architecture Context", "forged");
  if (variant === "missing") { rmSync(join(root, file.path)); file.expectedHash = "missing"; }
  if (variant === "stale") file.expectedHash = digestJson({ body: "stale" });
  if (variant === "symlink") { rmSync(join(root, file.path)); symlinkSync(join(root, "CLAUDE.md"), join(root, file.path)); }
  if (variant === "undeclared") writeFileSync(nodePath, readFileSync(nodePath, "utf8").split("extensions:")[0]!);
  if (variant === "validator") delete scope.validateRootWrite;
  if (variant === "wrong-kind") operation.op = "render_projection";
  expect(engine.preview(root, plan()).allowed).toBe(false);
  await expect(engine.apply(root, plan(), { approved: true })).rejects.toThrow();
  expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(human);
});

test("root revalidates hash after async journal boundary and leaves concurrent human edit intact", async () => {
  const { root, journal, engine, plan } = await fixture();
  const original = journal.recordChangeSetFile.bind(journal);
  journal.recordChangeSetFile = async (id, file) => { await original(id, file); writeFileSync(join(root, file.path), "concurrent human edit\n"); };
  await expect(engine.apply(root, plan(), { approved: true })).rejects.toThrow();
  expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("concurrent human edit\n");
  expect(await journal.listCommittedChangeSetsForTaskSession(root, "task.root")).toEqual([]);
});
