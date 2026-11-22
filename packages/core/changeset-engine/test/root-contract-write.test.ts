import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson } from "@archcontext/contracts";
import { initializeArchContextModel, YamlModelStore } from "../../../local-runtime/model-store-yaml/src/index";
import { renderAgentContextProjection, loadAgentContextProjectionFiles, loadNativeModelFromArchContext, agentContextProjectionTargetPaths } from "../../projection-engine/src/index";
import { ChangeSetEngine, type AgentContextScopePort, type ChangeOperation, type ChangeSetJournalFile, type ChangeSetJournalPort, type ChangeSetProjectionFile } from "../src/index";

class RecordingJournal implements ChangeSetJournalPort {
  committed: ChangeSetJournalFile[][] = [];
  pending = new Set<string>();
  private draftFiles = new Map<string, ChangeSetJournalFile[]>();
  private nextId = 0;

  async beginChangeSet(): Promise<string> {
    const id = `journal.${++this.nextId}`;
    this.pending.add(id);
    this.draftFiles.set(id, []);
    return id;
  }

  async recordChangeSetFile(journalId: string, file: ChangeSetJournalFile): Promise<void> {
    this.draftFiles.get(journalId)?.push(file);
  }

  async commitChangeSet(journalId: string): Promise<void> {
    this.pending.delete(journalId);
    const files = this.draftFiles.get(journalId);
    if (files) this.committed.push(files);
  }

  async completeChangeSetCleanup(): Promise<void> {}

  async abortChangeSet(journalId: string): Promise<void> {
    this.pending.delete(journalId);
    this.draftFiles.delete(journalId);
  }

  recoverPendingChangeSets(): number { return 0; }
}

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "archctx-root-contract-")); roots.push(root);
  initializeArchContextModel(root, "Root Test");
  const nodePath = join(root, ".archcontext/model/nodes/capability.architecture.context.yaml");
  writeFileSync(nodePath, readFileSync(nodePath, "utf8") + 'extensions:\n  contractFiles:\n    agents: "AGENTS.md"\n    claude: "CLAUDE.md"\n');
  const human = "# Human routing\nKeep these spaces.  \n\n\n";
  for (const path of ["AGENTS.md", "CLAUDE.md"]) writeFileSync(join(root, path), human);
  const canonical = () => { const model = loadNativeModelFromArchContext(root); return renderAgentContextProjection({ model, existingFiles: loadAgentContextProjectionFiles(root, model) }); };
  const scope: AgentContextScopePort = {
    derive: () => new Set(agentContextProjectionTargetPaths(loadNativeModelFromArchContext(root)).map(target => target.path)),
    validateRootWrite: (_root, file) => { if (canonical().files.find(candidate => candidate.path === file.path)?.body !== file.body) throw new Error("canonical mismatch"); }
  };
  const journal = new RecordingJournal();
  const engine = new ChangeSetEngine({ modelStore: new YamlModelStore(), projection: { planGeneratedProjection: () => [] }, journal, agentContextScope: scope });
  const operation: ChangeOperation = { op: "render_agent_context", expectedHash: "missing", projectionFiles: canonical().files.map(file => ({ path: file.path, body: file.body, expectedHash: digestJson({ body: human }) })) };
  const plan = (ops = [operation]) => engine.plan({ id: "changeset.root", base: { headSha: "test", worktreeDigest: digestJson({}), modelDigest: digestJson({}) }, reason: { taskSessionId: "task.root" }, operations: ops });
  return { root, human, scope, journal, engine, operation, plan, nodePath };
}

test("root failure after the first file restores both human contracts and aborts journal", async () => {
  const { root, human, journal, engine, plan } = await fixture();
  await expect(engine.apply(root, plan(), { approved: true, faultAfterOperations: 1 })).rejects.toThrow("fault-injection");
  for (const path of ["AGENTS.md", "CLAUDE.md"]) expect(readFileSync(join(root, path), "utf8")).toBe(human);
  expect(journal.committed).toEqual([]);
  expect(journal.pending.size).toBe(0);
});

for (const variant of ["human", "generated", "missing", "stale", "symlink", "undeclared", "validator", "wrong-kind"] as const) test(`root rejects ${variant} write`, async () => {
  const { root, human, scope, engine, operation, plan, nodePath } = await fixture();
  const file = operation.projectionFiles![0]! as ChangeSetProjectionFile;
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
  expect(journal.committed).toEqual([]);
});

test("root refuses to create a missing contract, even with the exact canonical render (#580)", async () => {
  const { root, engine, plan } = await fixture();
  for (const path of ["AGENTS.md", "CLAUDE.md"]) rmSync(join(root, path));
  const model = loadNativeModelFromArchContext(root);
  const files = renderAgentContextProjection({ model, existingFiles: [] }).files.map(file => ({ path: file.path, body: file.body, expectedHash: "missing" }));
  const create: ChangeOperation = { op: "render_agent_context", expectedHash: "missing", projectionFiles: files };
  expect(engine.preview(root, plan([create])).findings).toContain("Root contract must exist with an exact expectedHash");
  await expect(engine.apply(root, plan([create]), { approved: true })).rejects.toThrow("Root contract must exist with an exact expectedHash");
  for (const file of files) expect(existsSync(join(root, file.path))).toBe(false);
});
