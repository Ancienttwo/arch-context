import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failureIssues } from "@archcontext/contracts";
import { CodeGraphAdapter, CodeGraphCliProvider, inspectRepositoryCodeFacts, REQUIRED_CODEGRAPH_VERSION } from "@archcontext/local-runtime/codegraph-adapter";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { ArchctxDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { runArchitectureDebtCommand } from "@archcontext/local-runtime/architecture-debt";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { runCli } from "../src/main";

function fixture(allowSync = false, clearPending = false) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-code-facts-not-ready-")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  initializeArchContextModel(root, "Code facts readiness");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", `core.hooksPath=${join(root, ".git/no-hooks")}`, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "fixture"], { cwd: root });
  mkdirSync(join(root, ".codegraph"));
  const calls = join(root, "calls.log");
  const binary = join(root, "codegraph-fixture.cjs");
  const status = {
    initialized: true, version: REQUIRED_CODEGRAPH_VERSION, projectPath: root,
    pendingChanges: { added: 0, modified: 0, removed: 0 }, worktreeMismatch: null,
    index: { builtWithVersion: "1.6.1", builtWithExtractionVersion: 24, currentExtractionVersion: 24, reindexRecommended: false, state: "complete", pendingRefs: 0 }
  };
  const statusPath = join(root, "codegraph-status.json");
  writeFileSync(statusPath, JSON.stringify(status));
  writeFileSync(binary, `
const {appendFileSync, readFileSync, writeFileSync} = require("node:fs");
const command = process.argv[2];
appendFileSync(${JSON.stringify(calls)}, command + "\\n");
if (command === "--version") { console.log(${JSON.stringify(REQUIRED_CODEGRAPH_VERSION)}); }
else if (command === "status") { process.stdout.write(readFileSync(${JSON.stringify(statusPath)}, "utf8")); }
else if (command === "sync" && ${allowSync}) {
  if (${clearPending}) {
    const status = JSON.parse(readFileSync(${JSON.stringify(statusPath)}, "utf8"));
    status.pendingChanges = {added: 0, modified: 0, removed: 0};
    writeFileSync(${JSON.stringify(statusPath)}, JSON.stringify(status));
  }
  process.exit(0);
}
else { console.error("private raw process output /outside/repository"); process.exit(1); }
`);
  return { root, calls, binary, status, statusPath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test.each(["complete", "prepare", "prepare-empty-budget", "complete-subdirectory", "prepare-subdirectory", "checkpoint"])("%s refuses a version-mismatched index with the doctor issues", async command => {
  const input = fixture();
  const store = new TestLocalStore();
  const daemon = new ArchctxDaemon({ localStore: store, codeFacts: new CodeGraphAdapter(new CodeGraphCliProvider(input.root, input.binary)) });
  try {
    const doctor = inspectRepositoryCodeFacts(input.root, { binary: input.binary });
    writeFileSync(input.calls, "");
    await daemon.start();
    const cwd = command.endsWith("subdirectory") ? join(input.root, "nested") : input.root;
    mkdirSync(cwd, { recursive: true });
    const result = command === "checkpoint"
      ? runArchitectureDebtCommand(input.root, {}, { binary: input.binary })
      : await runCli(command.startsWith("prepare") ? "prepare" : "complete",
        command === "prepare-empty-budget" ? ["--task", "Inspect readiness", "--max-items", "0"] : command.startsWith("prepare") ? ["--task", "Inspect readiness"] : [], cwd, { runtimeClient: daemon });
    expect(result).toMatchObject({ ok: false, error: {
      code: "AC_CODE_FACTS_NOT_READY", reasonCode: "code-facts-not-ready", retryable: false, action: "codegraph-index",
      details: { issues: "issues" in doctor ? doctor.issues : [] }
    } });
    expect(failureIssues("error" in result ? result.error : undefined)).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("private raw process output");
    expect(JSON.stringify(result)).not.toContain(input.root);
    expect(readFileSync(input.calls, "utf8")).toBe("--version\nstatus\n");
    expect(await store.listRepositorySessions()).toEqual([]);
  } finally { await daemon.stop(); input.cleanup(); }
});

test("CLI checkpoint refuses a present uninitialized index without a runtime", async () => {
  const input = fixture();
  try {
    const result = await runCli("checkpoint", [], input.root);
    const doctor = inspectRepositoryCodeFacts(input.root);
    expect("issues" in doctor && doctor.issues.map(issue => issue.code)).toContain("not-initialized");
    expect(result).toMatchObject({ ok: false, error: { code: "AC_CODE_FACTS_NOT_READY", details: {
      issues: "issues" in doctor ? doctor.issues : []
    } } });
    rmSync(join(input.root, ".codegraph"), { recursive: true });
    expect(await runCli("checkpoint", [], input.root)).toMatchObject({ ok: true });
  } finally { input.cleanup(); }
});

test("a cached code-facts snapshot cannot hide a later index version mismatch", async () => {
  const input = fixture(true);
  try {
    const adapter = new CodeGraphAdapter(new CodeGraphCliProvider(input.root, input.binary));
    const workspace = { root: input.root, repositoryId: "repo.fixture", headSha: "a".repeat(40) };
    const ready = { ...input.status, index: { ...input.status.index, builtWithVersion: REQUIRED_CODEGRAPH_VERSION } };
    writeFileSync(input.statusPath, JSON.stringify(ready));
    await adapter.ensureReady(workspace);
    writeFileSync(input.statusPath, JSON.stringify(input.status));
    writeFileSync(input.calls, "");
    await expect(adapter.ensureReady(workspace)).rejects.toMatchObject({ code: "AC_CODE_FACTS_NOT_READY" });
    expect(readFileSync(input.calls, "utf8")).toBe("--version\nstatus\n");
  } finally { input.cleanup(); }
});

for (const cached of [false, true]) {
  test.each([false, true])(`pending source changes use one sync and require ready afterwards (cached=${cached}, clears=%s)`, async clearPending => {
    const input = fixture(true, clearPending);
    try {
      const adapter = new CodeGraphAdapter(new CodeGraphCliProvider(input.root, input.binary));
      const workspace = { root: input.root, repositoryId: "repo.fixture", headSha: "a".repeat(40) };
      const ready = { ...input.status, index: { ...input.status.index, builtWithVersion: REQUIRED_CODEGRAPH_VERSION } };
      writeFileSync(input.statusPath, JSON.stringify(ready));
      if (cached) await adapter.ensureReady(workspace);
      writeFileSync(input.statusPath, JSON.stringify({ ...ready, pendingChanges: { added: 1, modified: 0, removed: 0 } }));
      writeFileSync(input.calls, "");
      if (clearPending) {
        await expect(adapter.ensureReady(workspace)).resolves.toMatchObject({ provider: "codegraph" });
      } else {
        await expect(adapter.ensureReady(workspace)).rejects.toMatchObject({ code: "AC_CODE_FACTS_NOT_READY", action: "codegraph-sync" });
      }
      expect(readFileSync(input.calls, "utf8").trim().split("\n")).toEqual([
        ...(cached ? ["--version", "status"] : []), "--version", "status", "sync", "--version", "status"
      ]);
    } finally { input.cleanup(); }
  });
}
