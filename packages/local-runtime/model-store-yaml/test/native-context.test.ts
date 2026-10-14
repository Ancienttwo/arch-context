import { describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { NATIVE_CONTEXT_LIMITS, NativeContextError, canonicalize, digestJson, nativeContextModelIssues, stableYaml, type Json, type NativeContextModel, type NativeContextReasonCode, type NativeContextSchemas } from "@archcontext/contracts";
import { parseJsonOrStableYaml } from "@archcontext/core/architecture-domain";
import { exportNativeContext } from "../src/native-context";
import { CAPABILITY_ID, MODULE_DOCUMENT, commitFixture, createNativeFixture, fixtureGit, fixtureModel, writeFixtureFile } from "./fixtures/native-context/fixture";
import nodeSchema from "../../../../schemas/repo/architecture-node.schema.json";
import relationSchema from "../../../../schemas/repo/architecture-relation.schema.json";
import flowSchema from "../../../../schemas/repo/architecture-flow.schema.json";
const CAP_PATH = `.archcontext/model/nodes/${CAPABILITY_ID}.yaml`;
function reason(operation: () => unknown): NativeContextError {
  try { operation(); throw new Error("expected native failure"); }
  catch (error) { expect(error).toBeInstanceOf(NativeContextError); return error as NativeContextError; }
}
function rewriteCapability(root: string, mutate: (value: any) => void): void {
  const value = parseJsonOrStableYaml(readFileSync(join(root, CAP_PATH), "utf8"), CAP_PATH);
  mutate(value); writeFixtureFile(root, CAP_PATH, stableYaml(value));
}
function files(root: string, prefix = ""): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(join(root, path));
    if (stat.isDirectory()) Object.assign(values, files(root, path));
    else if (stat.isFile()) values[path] = createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
  }
  return values;
}
describe("stateless native context sources", () => {
  test("ref/worktree expose complete original records, canonical kinds and no local identity", () => {
    const fixture = createNativeFixture();
    try {
      const fixed = exportNativeContext(fixture.root, { source: "ref", ref: "HEAD" });
      const worktree = exportNativeContext(fixture.root, { source: "worktree" });
      expect(fixed.snapshot).toMatchObject({ source: "ref", commitSha: fixture.commit, validation: "immutable-tree" });
      expect(worktree.snapshot).toMatchObject({ source: "worktree", headSha: fixture.commit, validation: "stable-read" });
      expect(fixed.inputDigest).toBe(worktree.inputDigest);
      expect(fixed.model.nodes).toHaveLength(8); expect(fixed.model.relations).toHaveLength(1); expect(fixed.model.flows).toHaveLength(2);
      expect(fixed.allowedNodeKinds).toEqual(nodeSchema.properties.kind.enum);
      expect(fixed.model.nodes.find(node => node.kind === "component")).toMatchObject(fixtureModel().nodes[2]!);
      expect(fixed.model.relations[0]!.intent).toBe("");
      expect(fixed.capabilityProfiles[0]).toMatchObject({ includeAnchors: ["src", "src/a.ts", "src/app/[locale]"], lspProfile: null, verification: null, componentNodeIds: ["component.demo.worker"] });
      expect(fixed.contextBudgetBytes).toBe(64);
      expect(JSON.stringify(fixed)).not.toContain(fixture.root);
      expect(fixed.inputs.every(input => input.contentDigest === null || input.contentDigest.startsWith("sha256:"))).toBe(true);
    } finally { fixture.cleanup(); }
  });
  test.each(["manifest", "node", "contract", "document"])("dirty %s changes only the explicit worktree source", kind => {
    const fixture = createNativeFixture();
    try {
      const fixed = exportNativeContext(fixture.root, { source: "ref", ref: "HEAD" });
      if (kind === "manifest") writeFixtureFile(fixture.root, ".archcontext/manifest.yaml", stableYaml({ schemaVersion: "archcontext.manifest/v1", model: { layout: "split", root: ".archcontext/model" }, runtime: { contextBudgetBytes: 1 } }));
      if (kind === "node") rewriteCapability(fixture.root, value => { value.name = "Dirty name"; });
      if (kind === "contract") appendFileSync(join(fixture.root, "AGENTS.md"), "Dirty contract\n");
      if (kind === "document") appendFileSync(join(fixture.root, MODULE_DOCUMENT), "Dirty human text\n");
      expect(exportNativeContext(fixture.root, { source: "ref", ref: "HEAD" })).toEqual(fixed);
      expect(exportNativeContext(fixture.root, { source: "worktree" }).inputDigest).not.toBe(fixed.inputDigest);
    } finally { fixture.cleanup(); }
  });
  test("fixed blobs ignore deleted worktree counterparts", () => {
    const fixture = createNativeFixture();
    try {
      const fixed = exportNativeContext(fixture.root, { source: "ref", ref: "HEAD" });
      unlinkSync(join(fixture.root, CAP_PATH)); unlinkSync(join(fixture.root, "AGENTS.md")); rmSync(join(fixture.root, "docs"), { recursive: true });
      expect(exportNativeContext(fixture.root, { source: "ref", ref: "HEAD" })).toEqual(fixed);
      expect(reason(() => exportNativeContext(fixture.root, { source: "worktree" })).reasonCode).toBe("native-context-input-missing");
    } finally { fixture.cleanup(); }
  });
  test("identical commits in separate worktrees return identical fixed payloads", () => {
    const fixture = createNativeFixture(); const other = fixture.root + "-other";
    try {
      fixtureGit(fixture.root, ["worktree", "add", "--quiet", "--detach", other, fixture.commit]);
      expect(exportNativeContext(other, { source: "ref", ref: "HEAD" })).toEqual(exportNativeContext(fixture.root, { source: "ref", ref: "HEAD" }));
    } finally { if (existsSync(other)) fixtureGit(fixture.root, ["worktree", "remove", "--force", other]); fixture.cleanup(); }
  });
  test.each(["after-ref-resolution", "after-model-batch"])("moving symbolic ref at %s stays bound to the original commit", boundary => {
    const fixture = createNativeFixture();
    try {
      fixtureGit(fixture.root, ["branch", "moving", fixture.commit]);
      rewriteCapability(fixture.root, value => { value.name = "Second commit"; }); const second = commitFixture(fixture.root, "second");
      const fixed = exportNativeContext(fixture.root, { source: "ref", ref: "moving" }, { onBoundary: stage => { if (stage === boundary) fixtureGit(fixture.root, ["update-ref", "refs/heads/moving", second]); } });
      expect(fixed.snapshot).toMatchObject({ commitSha: fixture.commit });
      expect(fixed.model.nodes.find(node => node.id === CAPABILITY_ID)!.name).toBe("Demo");
    } finally { fixture.cleanup(); }
  });
  test("annotated tags, ancestry and abbreviated SHA work; missing/non-commit/ambiguous refs fail", () => {
    const fixture = createNativeFixture();
    try {
      fixtureGit(fixture.root, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "tag", "-a", "v1", "-m", "first", fixture.commit]);
      writeFixtureFile(fixture.root, "unrelated", "next"); commitFixture(fixture.root, "next");
      for (const ref of ["v1", "HEAD~1", fixture.commit.slice(0, 12)]) expect(exportNativeContext(fixture.root, { source: "ref", ref }).snapshot).toMatchObject({ commitSha: fixture.commit });
      const tree = fixtureGit(fixture.root, ["rev-parse", "HEAD^{tree}"]);
      for (const ref of ["not-present", tree]) expect(reason(() => exportNativeContext(fixture.root, { source: "ref", ref })).reasonCode).toBe("native-context-ref-unavailable");
      fixtureGit(fixture.root, ["branch", "duplicate"]); fixtureGit(fixture.root, ["tag", "duplicate"]);
      expect(reason(() => exportNativeContext(fixture.root, { source: "ref", ref: "duplicate" })).reasonCode).toBe("native-context-ref-unavailable");
    } finally { fixture.cleanup(); }
  });
  test("SHA-256 repositories use full fixed object IDs", () => {
    const fixture = createNativeFixture({ objectFormat: "sha256" });
    try { const fixed = exportNativeContext(fixture.root, { source: "ref", ref: "HEAD" }); expect((fixed.snapshot as any).commitSha).toHaveLength(64); expect((fixed.snapshot as any).treeOid).toHaveLength(64); }
    finally { fixture.cleanup(); }
  });
  test("unsafe revision fails before even discovering a repository", () => {
    expect(reason(() => exportNativeContext("/not/a/repository", { source: "ref", ref: "--output=outside" })).reasonCode).toBe("native-context-ref-unsafe");
  });
  test("safely missing contracts differ from present empty files and remain in the input digest", () => {
    const fixture = createNativeFixture({ missingContracts: true, document: null });
    try {
      const missing = exportNativeContext(fixture.root, { source: "worktree" });
      expect(missing.contracts).toHaveLength(2);
      for (const contract of missing.contracts) expect(contract).toMatchObject({ presence: "missing", text: null, byteLength: null, byteDigest: null });
      expect(missing.inputs.filter(input => input.role === "contract")).toHaveLength(2);
      expect(missing.documents.find(document => document.path === MODULE_DOCUMENT)!.section3.state).toBe("missing");
      writeFixtureFile(fixture.root, "CLAUDE.md", "");
      const present = exportNativeContext(fixture.root, { source: "worktree" });
      expect(present.contracts.find(contract => contract.path === "CLAUDE.md")).toMatchObject({ presence: "present", text: "", byteLength: 0 });
      expect(present.inputDigest).not.toBe(missing.inputDigest);
      expect(exportNativeContext(fixture.root, { source: "ref", ref: "HEAD" }).contracts.every(contract => contract.presence === "missing")).toBe(true);
    } finally { fixture.cleanup(); }
  });
  test("all statuses and shared explicit root contracts remain represented once", () => {
    const fixture = createNativeFixture();
    try {
      const other = { ...fixtureModel().nodes[0]!, id: "capability.demo.other", status: "removed" };
      writeFixtureFile(fixture.root, `.archcontext/model/nodes/${other.id}.yaml`, stableYaml(other));
      const result = exportNativeContext(fixture.root, { source: "worktree" });
      expect(result.capabilityProfiles).toHaveLength(2); expect(result.contracts).toHaveLength(2);
      expect(result.contracts[0]!.capabilityNodeIds).toEqual([CAPABILITY_ID, "capability.demo.other"]);
      expect(result.capabilityProfiles[1]!.status).toBe("removed");
    } finally { fixture.cleanup(); }
  });
  test("empty declared verification remains empty; undeclared policy metadata stays null", () => {
    const fixture = createNativeFixture();
    try {
      rewriteCapability(fixture.root, value => { value.extensions.verification = []; value.extensions.lspProfile = "typescript-lsp"; });
      expect(exportNativeContext(fixture.root, { source: "worktree" }).capabilityProfiles[0]).toMatchObject({ verification: [], lspProfile: "typescript-lsp" });
      rewriteCapability(fixture.root, value => { value.extensions.lspProfile = null; });
      expect(reason(() => exportNativeContext(fixture.root, { source: "worktree" })).reasonCode).toBe("native-context-profile-incomplete");
    } finally { fixture.cleanup(); }
  });
  test.each(["missing-declaration", "unsafe-declaration", "unsupported-layout", "invalid-budget", "invalid-flow", "nested-model"])("invalid %s fails rather than dropping records", kind => {
    const fixture = createNativeFixture();
    try {
      if (kind === "missing-declaration") rewriteCapability(fixture.root, value => { delete value.extensions.contractFiles.agents; });
      if (kind === "unsafe-declaration") rewriteCapability(fixture.root, value => { value.extensions.contractFiles.agents = "../AGENTS.md"; });
      if (kind === "unsupported-layout") writeFixtureFile(fixture.root, ".archcontext/manifest.yaml", stableYaml({ schemaVersion: "archcontext.manifest/v1", model: { layout: "other", root: ".archcontext/model" }, runtime: { contextBudgetBytes: 64 } }));
      if (kind === "invalid-budget") writeFixtureFile(fixture.root, ".archcontext/manifest.yaml", stableYaml({ schemaVersion: "archcontext.manifest/v1", model: { layout: "split", root: ".archcontext/model" }, runtime: { contextBudgetBytes: 0 } }));
      if (kind === "invalid-flow") writeFixtureFile(fixture.root, ".archcontext/model/flows/flow.demo.bad.yaml", "{}");
      if (kind === "nested-model") writeFixtureFile(fixture.root, ".archcontext/model/nodes/nested/node.yaml", stableYaml(fixtureModel().nodes[0]!));
      expect(reason(() => exportNativeContext(fixture.root, { source: "worktree" })).reasonCode).toBe({ "missing-declaration": "native-context-profile-incomplete", "unsafe-declaration": "native-context-path-unsafe", "unsupported-layout": "native-context-model-invalid", "invalid-budget": "native-context-budget-invalid", "invalid-flow": "native-context-model-invalid", "nested-model": "native-context-entry-kind-unsupported" }[kind] as NativeContextReasonCode);
    } finally { fixture.cleanup(); }
  });
  test.each(["add-model", "delete-model", "rename-model", "edit-contract", "delete-contract", "edit-document", "delete-document", "move-head"])("observed %s during the read yields retryable drift", kind => {
    const fixture = createNativeFixture(); let edited = false;
    try {
      const error = reason(() => exportNativeContext(fixture.root, { source: "worktree" }, { onBoundary: stage => {
        if (stage !== "after-first-observation" || edited) return; edited = true;
        if (kind === "add-model") writeFixtureFile(fixture.root, ".archcontext/model/nodes/module.demo.new.yaml", stableYaml({ ...fixtureModel().nodes[1]!, id: "module.demo.new" }));
        if (kind === "delete-model") unlinkSync(join(fixture.root, CAP_PATH));
        if (kind === "rename-model") renameSync(join(fixture.root, CAP_PATH), join(fixture.root, CAP_PATH.replace(".yaml", ".yml")));
        if (kind === "edit-contract") appendFileSync(join(fixture.root, "AGENTS.md"), "changed");
        if (kind === "delete-contract") unlinkSync(join(fixture.root, "CLAUDE.md"));
        if (kind === "edit-document") appendFileSync(join(fixture.root, MODULE_DOCUMENT), "changed");
        if (kind === "delete-document") unlinkSync(join(fixture.root, MODULE_DOCUMENT));
        if (kind === "move-head") fixtureGit(fixture.root, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--allow-empty", "--quiet", "-m", "new head"]);
      } }));
      expect(error.reasonCode).toBe("native-context-input-changed");
    } finally { fixture.cleanup(); }
  });
  test.each(["AGENTS.md", "CLAUDE.md", MODULE_DOCUMENT])("missing-to-empty-present %s is re-observed", path => {
    const fixture = createNativeFixture({ missingContracts: true, document: null });
    try { expect(reason(() => exportNativeContext(fixture.root, { source: "worktree" }, { onBoundary: stage => { if (stage === "after-first-observation") writeFixtureFile(fixture.root, path, ""); } })).reasonCode).toBe("native-context-input-changed"); }
    finally { fixture.cleanup(); }
  });
  test.each(["after-input-read", "after-second-observation"])("replacement after second-pass %s is caught by the final identity audit", boundary => {
    const fixture = createNativeFixture(); let edited = false;
    try {
      const error = reason(() => exportNativeContext(fixture.root, { source: "worktree" }, { onBoundary: (stage, detail) => {
        if (stage !== boundary || detail.observation !== 2 || edited) return; edited = true;
        const path = join(fixture.root, "AGENTS.md"); const bytes = readFileSync(path); unlinkSync(path); writeFileSync(path, bytes);
      } }));
      expect(error.reasonCode).toBe("native-context-input-changed");
    } finally { fixture.cleanup(); }
  });
  test("unrelated source/doc edits do not move the selected input digest", () => {
    const fixture = createNativeFixture();
    try {
      const before = exportNativeContext(fixture.root, { source: "worktree" });
      writeFixtureFile(fixture.root, "src/unrelated.ts", "changed"); writeFixtureFile(fixture.root, "docs/architecture/unrelated.md", "unrelated prose");
      expect(exportNativeContext(fixture.root, { source: "worktree" }).inputDigest).toBe(before.inputDigest);
    } finally { fixture.cleanup(); }
  });
  test("ignored untracked model files are excluded but non-ignored additions are included", () => {
    const fixture = createNativeFixture();
    try {
      const before = exportNativeContext(fixture.root, { source: "worktree" });
      writeFixtureFile(fixture.root, ".gitignore", ".archcontext/model/nodes/ignored.yaml\n"); writeFixtureFile(fixture.root, ".archcontext/model/nodes/ignored.yaml", "bad");
      expect(exportNativeContext(fixture.root, { source: "worktree" }).inputDigest).toBe(before.inputDigest);
      writeFixtureFile(fixture.root, ".archcontext/model/nodes/added.yaml", stableYaml({ ...fixtureModel().nodes[1]!, id: "module.demo.added" }));
      expect(exportNativeContext(fixture.root, { source: "worktree" }).model.nodes).toHaveLength(9);
    } finally { fixture.cleanup(); }
  });
  test("present non-regular contracts and invalid UTF-8 fail explicitly", () => {
    const fixture = createNativeFixture();
    try {
      unlinkSync(join(fixture.root, "CLAUDE.md")); mkdirSync(join(fixture.root, "CLAUDE.md"));
      expect(reason(() => exportNativeContext(fixture.root, { source: "worktree" })).reasonCode).toBe("native-context-entry-kind-unsupported");
      rmSync(join(fixture.root, "CLAUDE.md"), { recursive: true }); writeFixtureFile(fixture.root, "CLAUDE.md", Buffer.from([0xff]));
      expect(reason(() => exportNativeContext(fixture.root, { source: "worktree" })).reasonCode).toBe("native-context-text-invalid");
    } finally { fixture.cleanup(); }
  });
  test.skipIf(process.platform === "win32")("symlinked worktree counterparts cannot affect refs and are refused in worktree mode", () => {
    const fixture = createNativeFixture();
    try {
      const fixed = exportNativeContext(fixture.root, { source: "ref", ref: "HEAD" });
      unlinkSync(join(fixture.root, "AGENTS.md")); symlinkSync("CLAUDE.md", join(fixture.root, "AGENTS.md"));
      expect(exportNativeContext(fixture.root, { source: "ref", ref: "HEAD" })).toEqual(fixed);
      expect(reason(() => exportNativeContext(fixture.root, { source: "worktree" })).reasonCode).toBe("native-context-entry-kind-unsupported");
      commitFixture(fixture.root, "link");
      expect(reason(() => exportNativeContext(fixture.root, { source: "ref", ref: "HEAD" })).reasonCode).toBe("native-context-entry-kind-unsupported");
    } finally { fixture.cleanup(); }
  });
  test("symlink/junction model ancestor fails instead of erasing its population", () => {
    const fixture = createNativeFixture();
    try {
      const original = join(fixture.root, ".archcontext/model/nodes"); const replacement = join(fixture.root, "moved-nodes");
      renameSync(original, replacement); symlinkSync(replacement, original, process.platform === "win32" ? "junction" : "dir");
      expect(reason(() => exportNativeContext(fixture.root, { source: "worktree" })).reasonCode).toBe("native-context-entry-kind-unsupported");
    } finally { fixture.cleanup(); }
  });
  test("a present unavailable blob cannot turn into missing or worktree fallback", () => {
    const fixture = createNativeFixture();
    try {
      const objectId = fixtureGit(fixture.root, ["rev-parse", "HEAD:CLAUDE.md"]);
      unlinkSync(join(fixture.root, ".git/objects", objectId.slice(0, 2), objectId.slice(2)));
      expect(reason(() => exportNativeContext(fixture.root, { source: "ref", ref: "HEAD" })).reasonCode).toBe("native-context-blob-unavailable");
    } finally { fixture.cleanup(); }
  });
  test("derived contracts cannot cross a tracked gitlink even without a .git file on disk", () => {
    const fixture = createNativeFixture();
    try {
      rewriteCapability(fixture.root, value => { value.extensions.contractFiles = { agents: "vendor/AGENTS.md", claude: "vendor/CLAUDE.md" }; });
      writeFixtureFile(fixture.root, "vendor/AGENTS.md", "other repo"); writeFixtureFile(fixture.root, "vendor/CLAUDE.md", "other repo");
      fixtureGit(fixture.root, ["update-index", "--add", "--cacheinfo", `160000,${fixture.commit},vendor`]);
      expect(reason(() => exportNativeContext(fixture.root, { source: "worktree" })).reasonCode).toBe("native-context-entry-kind-unsupported");
    } finally { fixture.cleanup(); }
  });
  test("untracked nested-repository ancestors are rejected before reading contract bodies", () => {
    const fixture = createNativeFixture();
    try {
      rewriteCapability(fixture.root, value => { value.extensions.contractFiles = { agents: "vendor/AGENTS.md", claude: "vendor/CLAUDE.md" }; });
      writeFixtureFile(fixture.root, "vendor/AGENTS.md", "other repo"); writeFixtureFile(fixture.root, "vendor/CLAUDE.md", "other repo");
      writeFixtureFile(fixture.root, "vendor/.git", "gitdir: outside\n");
      expect(reason(() => exportNativeContext(fixture.root, { source: "worktree" })).reasonCode).toBe("native-context-entry-kind-unsupported");
    } finally { fixture.cleanup(); }
  });
  test("a selected ancestor becoming a gitlink after the second observation is drift", () => {
    const fixture = createNativeFixture();
    try {
      rewriteCapability(fixture.root, value => { value.extensions.contractFiles = { agents: "vendor/AGENTS.md", claude: "vendor/CLAUDE.md" }; });
      writeFixtureFile(fixture.root, "vendor/AGENTS.md", "contract"); writeFixtureFile(fixture.root, "vendor/CLAUDE.md", "contract");
      const error = reason(() => exportNativeContext(fixture.root, { source: "worktree" }, { onBoundary: stage => { if (stage === "after-second-observation") fixtureGit(fixture.root, ["update-index", "--add", "--cacheinfo", `160000,${fixture.commit},vendor`]); } }));
      expect(error.reasonCode).toBe("native-context-input-changed");
    } finally { fixture.cleanup(); }
  });
  test("per-file limit is checked before allocation and the context budget never truncates text", () => {
    const fixture = createNativeFixture();
    try {
      writeFixtureFile(fixture.root, "AGENTS.md", Buffer.alloc(NATIVE_CONTEXT_LIMITS.fileBytes, 0x61));
      expect(exportNativeContext(fixture.root, { source: "worktree" }).contracts.find(contract => contract.path === "AGENTS.md")!.byteLength).toBe(NATIVE_CONTEXT_LIMITS.fileBytes);
      appendFileSync(join(fixture.root, "AGENTS.md"), "x");
      expect(reason(() => exportNativeContext(fixture.root, { source: "worktree" })).reasonCode).toBe("native-context-limit-exceeded");
    } finally { fixture.cleanup(); }
  });
  test("reads leave all worktree/index/object bytes unchanged and create no runtime state", () => {
    const fixture = createNativeFixture(); const before = files(fixture.root);
    try {
      exportNativeContext(fixture.root, { source: "ref", ref: "HEAD" }); exportNativeContext(fixture.root, { source: "worktree" });
      expect(files(fixture.root)).toEqual(before);
      expect(existsSync(join(fixture.root, ".archcontext/.local"))).toBe(false);
      expect(existsSync(join(fixture.root, ".codegraph"))).toBe(false);
    } finally { fixture.cleanup(); }
  });
});

describe("frozen real consumer corpus", () => {
  test("454 original sources preserve baseline and actual consumer values, with complete native graph validation", () => {
    const corpus = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/native-context/downstream-corpus/corpus.json"), "utf8")) as { inputCount: number; inputs: Array<{ path: string; source: string; sourceDigest: string; expected: Json; baselineSharedValueDigest: string }> };
    expect(corpus.inputCount).toBe(454); expect(corpus.inputs).toHaveLength(454);
    const model: NativeContextModel = { nodes: [], relations: [], flows: [], sourcePaths: { nodes: {}, relations: {}, flows: {} } };
    for (const input of corpus.inputs) {
      expect(`sha256:${createHash("sha256").update(input.source, "utf8").digest("hex")}`, input.path).toBe(input.sourceDigest);
      const actual = parseJsonOrStableYaml(input.source, input.path);
      expect(canonicalize(actual), input.path).toBe(canonicalize(input.expected));
      expect(digestJson(actual), input.path).toBe(input.baselineSharedValueDigest);
      const kind = (["nodes", "relations", "flows"] as const).find(kind => input.path.includes(`/model/${kind}/`));
      if (kind) { model[kind].push(actual as any); model.sourcePaths[kind][(actual as any).id] = input.path; }
    }
    expect(nativeContextModelIssues(model, { node: nodeSchema, relation: relationSchema, flow: flowSchema } as unknown as NativeContextSchemas)).toEqual([]);
    expect(model.nodes).toHaveLength(102); expect(model.relations).toHaveLength(299); expect(model.flows).toHaveLength(52);
  });
  test("historical consumer document coverage stays explicitly unconfirmed", () => {
    const coverage = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/native-context/downstream-corpus/document-coverage.json"), "utf8"));
    expect(coverage.coverageConfirmed).toBe(false);
    expect(coverage.documents).toHaveLength(40);
    expect(coverage.documents.every((document: any) => document.disposition === "coverage-blocker" && document.reasonCode === "native-document-marker-invalid")).toBe(true);
    expect(coverage.documents.every((document: any) => !Object.hasOwn(document, "text"))).toBe(true);
  });
});
