import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson, failureIssues } from "@archcontext/contracts";
import { canonicalRepositoryRoot, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { architectureDocumentationProjectionWorktreeDigest, loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { CodeGraphAdapter, CodeGraphCliProvider, inspectRepositoryCodeFacts, prepareArchitectureDocumentationProjectionSnapshot, REQUIRED_CODEGRAPH_VERSION } from "@archcontext/local-runtime/codegraph-adapter";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { ArchctxDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { runArchitectureDebtCommand } from "@archcontext/local-runtime/architecture-debt";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { incompleteCodeGraphFixture } from "../../../local-runtime/codegraph-adapter/test/real-index";
import { fakeReadProvider, type FakeIndexFacts } from "../../../local-runtime/codegraph-adapter/test/read-provider-fixture";
import { runCli } from "../src/main";

/**
 * Readiness reads the index through the injected read-only provider (ADR-0058); it starts no
 * CodeGraph process. The fake binary only builds (`sync`), and logs every start, so a test proves
 * that no readiness probe spawned anything. `facts.json` is the index the provider reports; the
 * fake `sync` rewrites it, as a real sync rewrites the index.
 */
function fixture(allowSync = false, clearPending = false) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-code-facts-not-ready-")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  initializeArchContextModel(root, "Code facts readiness");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", `core.hooksPath=${join(root, ".git/no-hooks")}`, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "fixture"], { cwd: root });
  const calls = join(root, "calls.log");
  writeFileSync(calls, "");
  const binary = join(root, "codegraph-fixture.cjs");
  const facts: FakeIndexFacts = { builtWithVersion: "1.6.1", builtWithExtractionVersion: 24, currentExtractionVersion: 24 };
  const factsPath = join(root, "codegraph-facts.json");
  writeFileSync(factsPath, JSON.stringify(facts));
  const provider = fakeReadProvider(root, () => JSON.parse(readFileSync(factsPath, "utf8")) as FakeIndexFacts);
  writeFileSync(binary, `
const {appendFileSync, readFileSync, writeFileSync} = require("node:fs");
const command = process.argv[2];
appendFileSync(${JSON.stringify(calls)}, command + "\\n");
if (command === "sync" && ${allowSync}) {
  if (${clearPending}) {
    const facts = JSON.parse(readFileSync(${JSON.stringify(factsPath)}, "utf8"));
    facts.pending = {added: 0, modified: 0, removed: 0};
    writeFileSync(${JSON.stringify(factsPath)}, JSON.stringify(facts));
  }
  process.exit(0);
}
console.error("private raw process output /outside/repository"); process.exit(1);
`);
  const setFacts = (next: FakeIndexFacts) => writeFileSync(factsPath, JSON.stringify(next));
  return { root, calls, binary, facts, setFacts, provider, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test.each(["complete", "prepare", "prepare-empty-budget", "complete-subdirectory", "prepare-subdirectory", "checkpoint"])("%s refuses a version-mismatched index with the doctor issues", async command => {
  const input = fixture();
  const store = new TestLocalStore();
  const daemon = new ArchctxDaemon({ localStore: store, codeFacts: new CodeGraphAdapter(new CodeGraphCliProvider(input.root, input.binary, input.provider)) });
  try {
    const doctor = inspectRepositoryCodeFacts(input.root, { provider: input.provider });
    await daemon.start();
    const cwd = command.endsWith("subdirectory") ? join(input.root, "nested") : input.root;
    mkdirSync(cwd, { recursive: true });
    const result = command === "checkpoint"
      ? runArchitectureDebtCommand(input.root, {}, { provider: input.provider })
      : await runCli(command.startsWith("prepare") ? "prepare" : "complete",
        command === "prepare-empty-budget" ? ["--task", "Inspect readiness", "--max-items", "0"] : command.startsWith("prepare") ? ["--task", "Inspect readiness"] : [], cwd, { runtimeClient: daemon });
    expect(result).toMatchObject({ ok: false, error: {
      code: "AC_CODE_FACTS_NOT_READY", reasonCode: "code-facts-not-ready", retryable: false, action: "codegraph-index",
      details: { issues: "issues" in doctor ? doctor.issues : [] }
    } });
    expect(failureIssues("error" in result ? result.error : undefined)).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("private raw process output");
    expect(JSON.stringify(result)).not.toContain(input.root);
    // Readiness started no CodeGraph process.
    expect(readFileSync(input.calls, "utf8")).toBe("");
    expect(await store.listRepositorySessions()).toEqual([]);
  } finally { await daemon.stop(); input.cleanup(); }
});

test("CLI checkpoint refuses a .codegraph without a database as index-missing, without a runtime", async () => {
  const input = fixture();
  try {
    rmSync(join(input.root, ".codegraph", "codegraph.db"));
    const result = await runCli("checkpoint", [], input.root);
    expect(inspectRepositoryCodeFacts(input.root)).toMatchObject({ state: "index-missing", indexPresent: false });
    expect(result).toMatchObject({ ok: false, error: { code: "AC_CODE_FACTS_UNAVAILABLE", reasonCode: "index-missing" } });
    rmSync(join(input.root, ".codegraph"), { recursive: true });
    expect(await runCli("checkpoint", [], input.root)).toMatchObject({ ok: true });
  } finally { input.cleanup(); }
});

test("checkpoint accepts pending edits without sync but still refuses an incompatible index", () => {
  const input = fixture();
  try {
    const pending = { ...input.facts, builtWithVersion: REQUIRED_CODEGRAPH_VERSION, pending: { added: 1, modified: 1, removed: 0 } };
    input.setFacts(pending);
    const doctor = inspectRepositoryCodeFacts(input.root, { provider: input.provider });
    expect(doctor).toMatchObject({ state: "not-ready", reindexRecommended: false });
    expect(runArchitectureDebtCommand(input.root, {}, { provider: input.provider })).toMatchObject({ ok: true });

    input.setFacts({ ...pending, builtWithVersion: "1.6.1" });
    const mixedDoctor = inspectRepositoryCodeFacts(input.root, { provider: input.provider });
    expect("issues" in mixedDoctor && mixedDoctor.issues.map(issue => issue.code)).toEqual(["version-mismatch", "pending-source-changes"]);
    // The gate reads compatibility only: it refuses with the compatibility issue and reads no source.
    const hashes = input.provider.calls.hash;
    expect(runArchitectureDebtCommand(input.root, {}, { provider: input.provider })).toMatchObject({ ok: false, error: {
      code: "AC_CODE_FACTS_NOT_READY", action: "codegraph-index",
      details: { issues: [{ code: "version-mismatch", message: "CodeGraph repository status version mismatch" }] }
    } });
    expect(input.provider.calls.hash).toBe(hashes);
    expect(readFileSync(input.calls, "utf8")).toBe("");
  } finally { input.cleanup(); }
});

test("a cached code-facts snapshot cannot hide a later index version mismatch", async () => {
  const input = fixture(true);
  try {
    const adapter = new CodeGraphAdapter(new CodeGraphCliProvider(input.root, input.binary, input.provider));
    const workspace = { root: input.root, repositoryId: "repo.fixture", headSha: "a".repeat(40) };
    input.setFacts({ ...input.facts, builtWithVersion: REQUIRED_CODEGRAPH_VERSION });
    await adapter.ensureReady(workspace);
    input.setFacts(input.facts);
    writeFileSync(input.calls, "");
    await expect(adapter.ensureReady(workspace)).rejects.toMatchObject({ code: "AC_CODE_FACTS_NOT_READY" });
    expect(readFileSync(input.calls, "utf8")).toBe("");
  } finally { input.cleanup(); }
});

for (const cached of [false, true]) {
  test.each([false, true])(`pending edits preserve cold sync and cached reads (cached=${cached}, clears=%s)`, async clearPending => {
    const input = fixture(true, clearPending);
    try {
      const adapter = new CodeGraphAdapter(new CodeGraphCliProvider(input.root, input.binary, input.provider));
      const workspace = { root: input.root, repositoryId: "repo.fixture", headSha: "a".repeat(40) };
      const ready = { ...input.facts, builtWithVersion: REQUIRED_CODEGRAPH_VERSION };
      input.setFacts(ready);
      if (cached) await adapter.ensureReady(workspace);
      input.setFacts({ ...ready, pending: { added: 1, modified: 0, removed: 0 } });
      writeFileSync(input.calls, "");
      await expect(adapter.ensureReady(workspace)).resolves.toMatchObject({ provider: "codegraph" });
      // Only the build starts CodeGraph; readiness reads the index in process.
      expect(readFileSync(input.calls, "utf8")).toBe(cached ? "" : "sync\n");
      if (cached) {
        await expect(adapter.sync({ workspace })).resolves.toMatchObject({ provider: "codegraph" });
        expect(readFileSync(input.calls, "utf8")).toBe("sync\n");
      }
    } finally { input.cleanup(); }
  });
}

/** Remove the default capability so projection inputs load instead of failing on a layout path first. */
function trimProjectionFixtureModel(root: string): void {
  rmSync(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"), { force: true });
  execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qam", "trim model"], { cwd: root });
}

/** The exact request shape `archctx projection run` accepts in read-only check mode. */
function projectionCheckRequest(root: string, requestId: string) {
  return {
    schemaVersion: "archcontext.projection-request/v1",
    requestId,
    profile: "repo-harness/v1",
    mode: "check",
    targets: ["agent-context", "architecture-docs"],
    changedPaths: [],
    expected: {
      repositoryId: repositoryFingerprint(root),
      workspaceId: `workspace.${digestJson({ root: canonicalRepositoryRoot(root) } as any).replace(/^sha256:/, "").slice(0, 16)}`,
      headSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      worktreeDigest: architectureDocumentationProjectionWorktreeDigest(root, loadNativeModelFromArchContext(root), listGitVisibleFiles(root))
    }
  };
}

test("projection snapshot preparation refuses an indexing version-mismatched index with the doctor issues", () => {
  const input = fixture();
  try {
    // The reported #425 state: an index still being built, with no compatible build version.
    input.setFacts({ ...input.facts, state: "indexing", pendingRefs: 128 });
    const doctor = inspectRepositoryCodeFacts(input.root, { provider: input.provider });
    expect("issues" in doctor && doctor.issues.map(issue => issue.code)).toEqual(["version-mismatch", "index-incomplete"]);
    let failure: unknown;
    try { prepareArchitectureDocumentationProjectionSnapshot(input.root, loadNativeModelFromArchContext(input.root), { binary: input.binary, readProvider: input.provider }); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({
      code: "AC_CODE_FACTS_NOT_READY", reasonCode: "code-facts-not-ready", retryable: false, action: "codegraph-index",
      details: { issues: "issues" in doctor ? doctor.issues : [] }
    });
    expect(failureIssues((failure as { failure?: any })?.failure)).toEqual([]);
    expect(JSON.stringify(failure)).not.toContain("private raw process output");
    expect(JSON.stringify(failure)).not.toContain(input.root);
    // The readiness gate starts no process: no version probe, status, sync, rebuild or retry.
    expect(readFileSync(input.calls, "utf8")).toBe("");
  } finally { input.cleanup(); }
});

test("CLI projection run check classifies an incomplete index instead of failing unclassified", async () => {
  const input = fixture();
  try {
    rmSync(join(input.root, ".codegraph"), { recursive: true, force: true });
    trimProjectionFixtureModel(input.root);
    // A real package-local index with no completed extraction stamps reproduces the reported
    // not-ready state: version-mismatch and index-incomplete, without a shim.
    incompleteCodeGraphFixture(input.root);
    const doctor = inspectRepositoryCodeFacts(input.root);
    const issueCodes = "issues" in doctor ? doctor.issues.map(issue => issue.code) : [];
    expect(doctor.state).toBe("not-ready");
    expect(issueCodes).toContain("version-mismatch");
    expect(issueCodes).toContain("index-incomplete");
    const result = await runCli("projection", ["run", "--request-json", JSON.stringify(projectionCheckRequest(input.root, "projection_request.code_facts_not_ready"))], input.root);
    expect(result).toMatchObject({ ok: false, error: {
      code: "AC_CODE_FACTS_NOT_READY", reasonCode: "code-facts-not-ready", retryable: false, action: "codegraph-index",
      // The gate reads compatibility only, so its issues omit the doctor's freshness issue.
      details: { issues: "issues" in doctor ? doctor.issues.filter(issue => issue.code !== "pending-source-changes") : [] }
    } });
    expect((result as { error?: { code?: string } }).error?.code).not.toBe("AC_UNCLASSIFIED_FAILURE");
    expect(JSON.stringify(result)).not.toContain(input.root);
  } finally { input.cleanup(); }
}, 60_000);

test("CLI projection run check keeps the missing-index unavailable contract", async () => {
  const input = fixture();
  try {
    rmSync(join(input.root, ".codegraph"), { recursive: true, force: true });
    trimProjectionFixtureModel(input.root);
    const result = await runCli("projection", ["run", "--request-json", JSON.stringify(projectionCheckRequest(input.root, "projection_request.code_facts_missing"))], input.root);
    expect(result).toMatchObject({ ok: false, error: {
      code: "AC_CODE_FACTS_UNAVAILABLE", reasonCode: "index-missing", retryable: true, action: "codegraph-init"
    } });
    // The missing-index contract still names the init command and never becomes the not-ready code.
    expect((result as { error?: { code?: string } }).error?.code).not.toBe("AC_CODE_FACTS_NOT_READY");
    expect(JSON.stringify(result)).not.toContain(input.root);
  } finally { input.cleanup(); }
}, 60_000);
