import { afterEach, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { architectureDebtReportIssues, digestJson, stableYaml, type ArchitectureDebtDeltaReportV1, type ArchitectureDebtReportV1 } from "@archcontext/contracts";
import { loadNativeModelFromArchContext, resolveArchitectureDocumentationLayout } from "@archcontext/core/projection-engine";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { readArchitectureDebt } from "@archcontext/local-runtime/architecture-debt";
import type { RuntimeDaemonClient } from "@archcontext/local-runtime/runtime-daemon";
import { publishedSchemaIssues } from "../../../contracts/test/published-schemas";
import * as codegraphAdapter from "@archcontext/local-runtime/codegraph-adapter";
import { CodeGraphSdkProvider, codeGraphBaseDirectory } from "@archcontext/local-runtime/codegraph-adapter";
import { indexCodeGraphFixture } from "../../../local-runtime/codegraph-adapter/test/real-index";
import { runArchitectureDebtDeltaCommand } from "../src/architecture-debt-delta";
import { runCli } from "../src/main";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const noRuntime = new Proxy({}, { get: (_target, key) => { throw new Error(`debt reached runtime: ${String(key)}`); } }) as RuntimeDaemonClient;
function git(root: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: root, stdio: "pipe", encoding: "utf8" });
}
function write(root: string, path: string, body: string) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body); }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "archctx-debt-")); roots.push(root);
  git(root, "init", "-q");
  initializeArchContextModel(root, "Debt App");
  write(root, ".gitignore", ".codegraph/\n.archcontext/.local/\n");
  write(root, "src/a/main.ts", "export const value = 1;\n");
  write(root, "src/b/main.ts", "export const other = 2;\n");
  for (const name of ["a", "b"]) write(root, `.archcontext/model/nodes/capability.${name}.yaml`, stableYaml({
    schemaVersion: "archcontext.node/v2", id: `capability.${name}`, kind: "capability", name, status: "active",
    summary: `Owns ${name}.`, source: { include: [`src/${name}/**`], exclude: [`src/${name}/ignored/**`] }
  }));
  const model = loadNativeModelFromArchContext(root);
  const paths = resolveArchitectureDocumentationLayout({ nodes: model.nodes, relations: model.relations }).entityPathByNodeId;
  const document = paths.get("capability.b")!;
  write(root, document, "# B\n\nCitation: `src/a/main.ts:1`.\n");
  git(root, "add", "-A"); git(root, "commit", "-qm", "fixture");
  return { root, document };
}
function tree(root: string): string {
  const walk = (path: string): unknown => readdirSync(join(root, path), { withFileTypes: true }).filter(e => e.name !== ".git")
    .sort((a,b)=>a.name.localeCompare(b.name)).map(e => [e.name, e.isDirectory() ? walk(join(path,e.name)) : digestJson({ body: readFileSync(join(root,path,e.name),"utf8") })]);
  return JSON.stringify(walk(""));
}
async function read(root: string, paths: string[]) {
  const before = tree(root);
  const state = mkdtempSync(join(tmpdir(), "archctx-debt-state-")); roots.push(state);
  write(state, "sentinel", "preserve\n");
  const previous = process.env.ARCHCONTEXT_STATE_DIR;
  process.env.ARCHCONTEXT_STATE_DIR = state;
  try {
    const args = ["--json", ...paths.flatMap(path => ["--changed-path",path])];
    const result = await runCli("checkpoint", args, root, { runtimeClient: noRuntime });
    expect(result.requestId).toBe("checkpoint");
    const debt = await runCli("debt", args, root, { runtimeClient: noRuntime });
    expect(debt.data).toEqual(result.data);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(tree(root)).toBe(before);
    expect(readdirSync(state)).toEqual(["sentinel"]);
    expect(existsSync(join(root,".codegraph"))).toBe(false);
    const report = result.data as unknown as ArchitectureDebtReportV1;
    expect(architectureDebtReportIssues(report)).toEqual([]);
    expect(publishedSchemaIssues("runtime/architecture-debt.schema.json", report)).toEqual([]);
    return report;
  } finally {
    if (previous === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previous;
  }
}

async function withDebtSandbox(run: (paths: { state: string; scratch: string }) => Promise<void>) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "archctx-debt-test-")));
  roots.push(sandbox);
  const state = join(sandbox, "state");
  const scratch = join(sandbox, "scratch");
  mkdirSync(state);
  mkdirSync(scratch);
  const tempEnv = process.platform === "win32" ? "TEMP" : "TMPDIR";
  const previousState = process.env.ARCHCONTEXT_STATE_DIR;
  const previousTemp = process.env[tempEnv];
  const previousCompileCache = process.env.NODE_DISABLE_COMPILE_CACHE;
  process.env.ARCHCONTEXT_STATE_DIR = state;
  process.env[tempEnv] = scratch;
  process.env.NODE_DISABLE_COMPILE_CACHE = "1";
  try {
    await run({ state, scratch });
  } finally {
    if (previousCompileCache === undefined) delete process.env.NODE_DISABLE_COMPILE_CACHE;
    else process.env.NODE_DISABLE_COMPILE_CACHE = previousCompileCache;
    if (previousTemp === undefined) delete process.env[tempEnv];
    else process.env[tempEnv] = previousTemp;
    if (previousState === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previousState;
  }
}

async function readDelta(root: string, ref: string, ...flags: string[]): Promise<ArchitectureDebtDeltaReportV1> {
  const result = await runCli("debt", ["--base", ref, "--json", ...flags], root, { runtimeClient: noRuntime });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  // SAFETY: The CLI's successful --base command returns this result contract.
  const report = result.data as unknown as ArchitectureDebtDeltaReportV1;
  expect(report.schemaVersion).toBe("archcontext.architecture-debt-delta/v1");
  expect(publishedSchemaIssues("runtime/architecture-debt-delta.schema.json", report)).toEqual([]);
  return report;
}

test("debt delta reports worktree changes and sorts introduced and resolved item identities", async () => {
  const { root } = fixture();
  write(root, "src/old-one.ts", "export const oldOne = 1;\n");
  write(root, "src/old-two.ts", "export const oldTwo = 2;\n");
  git(root, "add", "-A"); git(root, "commit", "-qm", "base debt");
  git(root, "tag", "-a", "base-debt", "-m", "base debt");
  const baseSha = git(root, "rev-parse", "HEAD").trim();
  const base = readArchitectureDebt(root);
  expect(base.items).toHaveLength(2);
  rmSync(join(root, "src/old-one.ts"));
  rmSync(join(root, "src/old-two.ts"));
  write(root, "src/new-one.ts", "export const newOne = 1;\n");
  write(root, "src/new-two.ts", "export const newTwo = 2;\n");
  const head = readArchitectureDebt(root);
  expect(head.items).toHaveLength(2);
  const before = tree(root);
  await withDebtSandbox(async ({ scratch }) => {
    const worktrees = git(root, "worktree", "list", "--porcelain");
    expect(await readDelta(root, "base-debt")).toEqual({
      schemaVersion: "archcontext.architecture-debt-delta/v1",
      head: { sha: baseSha, debt: head },
      base: { ref: "base-debt", sha: baseSha, debtDigest: base.digest, coverage: base.coverage, coverageReasonCodes: base.coverageReasonCodes },
      introduced: head.items,
      resolvedIds: base.items.map(item => item.id)
    });
    expect(tree(root)).toBe(before);
    expect(git(root, "worktree", "list", "--porcelain")).toBe(worktrees);
    expect(readdirSync(scratch)).toEqual([]);
  });
});

test("debt delta refuses sparse head omissions and distinguishes full-checkout deletions", async () => {
  const { root } = fixture();
  const hidden = "src/unowned.ts";
  write(root, hidden, "export const value = 1;\n");
  git(root, "add", hidden);
  git(root, "commit", "-qm", "add unchanged debt");
  const sha = git(root, "rev-parse", "HEAD").trim();
  await withDebtSandbox(async () => {
    const full = await readDelta(root, sha);
    expect(full.head.debt.items.map(item => item.kind)).toEqual(["unowned-path"]);
    const debtId = full.head.debt.items[0]!.id;
    expect(full.base.debtDigest).toBe(full.head.debt.digest);
    git(root, "sparse-checkout", "set", "--no-cone", "/.archcontext/", "/docs/", "/src/a/", "/src/b/", "/.gitignore");
    expect(git(root, "ls-files", "-t", "--", hidden).trim()).toBe(`S ${hidden}`);
    expect(existsSync(join(root, hidden))).toBe(false);
    const worktrees = git(root, "worktree", "list", "--porcelain");
    const index = readFileSync(join(root, ".git", "index"));
    for (const flags of [[], ["--complete"]]) {
      const result = await runCli("debt", ["--base", sha, "--json", ...flags], root, { runtimeClient: noRuntime });
      expect(result).toMatchObject({ ok: false, error: { code: "AC_PRECONDITION_FAILED", reasonCode: "debt-head-sparse-checkout" } });
    }
    expect(git(root, "worktree", "list", "--porcelain")).toBe(worktrees);
    expect(readFileSync(join(root, ".git", "index"))).toEqual(index);

    git(root, "sparse-checkout", "disable");
    rmSync(join(root, hidden));
    const deleted = await readDelta(root, sha);
    expect(deleted.base.debtDigest).toBe(full.base.debtDigest);
    expect(deleted.resolvedIds).toEqual([debtId]);
  });
});

for (const profiles of [["edit-time", "complete"], ["complete", "edit-time"]] as const) {
  // The shared CodeGraph seeder is disabled on Windows.
  test.skipIf(process.platform === "win32")(`debt cache isolates ${profiles.join(" then ")} and hits on same-profile reruns`, async () => {
    const { root } = fixture();
    write(root, "src/a/main.ts", "import { other } from '../b/main';\nexport const value = other;\n");
    git(root, "add", "-A"); git(root, "commit", "-qm", "base dependency");
    git(root, "tag", "base");
    const baseSha = git(root, "rev-parse", "HEAD").trim();
    write(root, "src/b/main.ts", "import { value } from '../a/main';\nexport const other = () => value;\n");
    git(root, "add", "-A"); git(root, "commit", "-qm", "head adds a reverse dependency");
    indexCodeGraphFixture(root);
    expect((await new CodeGraphSdkProvider().indexAll(root)).codeGraphBase).toBe("published");
    const sharedBase = codeGraphBaseDirectory(join(root, ".git"));
    const pointer = readFileSync(join(sharedBase, "current.json"), "utf8");
    const worktrees = git(root, "worktree", "list", "--porcelain");
    await withDebtSandbox(async ({ scratch }) => {
      const deltas = new Map<string, ArchitectureDebtDeltaReportV1>();
      for (const profile of profiles) {
        const complete = profile === "complete";
        const delta = await readDelta(root, "base", ...(complete ? ["--complete"] : []));
        expect(delta.base.sha).toBe(baseSha);
        const dependencies = delta.head.debt.checks.find(check => check.check === "dependencies");
        expect(dependencies?.coverage).toBe(complete ? "complete" : "unknown");
        expect(delta.head.debt.items.filter(item => item.kind === "undeclared-dependency")).toHaveLength(complete ? 2 : 0);
        expect(delta.base.coverageReasonCodes.filter(reason => reason.startsWith("dependencies:"))).toEqual(
          complete ? [] : ["dependencies:deferred-to-complete", "dependencies:not-evaluated"]);
        expect(delta.introduced).toEqual(complete ? [expect.objectContaining({
          kind: "undeclared-dependency", details: expect.objectContaining({ fromCapabilityId: "capability.b", toCapabilityId: "capability.a" })
        })] : []);
        expect(delta.resolvedIds).toEqual([]);
        deltas.set(profile, delta);
      }
      expect(deltas.get("complete")?.base.debtDigest).not.toBe(deltas.get("edit-time")?.base.debtDigest);
      expect(readFileSync(join(sharedBase, "current.json"), "utf8")).toBe(pointer);
      expect(readdirSync(scratch)).toEqual([]);
      // A cache miss would fail before Git can create the worktree under this missing temp root.
      rmdirSync(scratch);
      for (const profile of profiles) {
        const repeat = await readDelta(root, baseSha, ...(profile === "complete" ? ["--complete"] : []));
        const first = deltas.get(profile)!;
        expect(repeat).toEqual({ ...first, base: { ...first.base, ref: baseSha } });
      }
      expect(git(root, "worktree", "list", "--porcelain")).toBe(worktrees);
    });
  }, 60_000);
}

test("missing CodeGraph evidence on either side does not manufacture a dependency delta", async () => {
  const { root } = fixture();
  write(root, "src/a/main.ts", "import { other } from '../b/main';\nexport const value = other;\n");
  git(root, "add", "-A"); git(root, "commit", "-qm", "same dependency");
  indexCodeGraphFixture(root);
  await withDebtSandbox(async ({ scratch }) => {
    const worktrees = git(root, "worktree", "list", "--porcelain");
    const initSpy = spyOn(codegraphAdapter, "initCodeGraphIndex").mockRejectedValueOnce(new Error("simulated cold-index failure"));
    try {
      const noBaseIndex = await readDelta(root, "HEAD", "--complete");
      expect(noBaseIndex.head.debt.items.some(item => item.kind === "undeclared-dependency")).toBe(true);
      expect(noBaseIndex.base.coverage).toBe("partial");
      expect(noBaseIndex.base.coverageReasonCodes).toContain("dependencies:index-missing");
      expect(noBaseIndex.introduced).toEqual([]);
      expect(git(root, "worktree", "list", "--porcelain")).toBe(worktrees);
      expect(readdirSync(scratch)).toEqual([]);
    } finally {
      initSpy.mockRestore();
    }
    rmSync(join(root, ".codegraph"), { recursive: true });
    const noHeadIndex = await readDelta(root, "HEAD", "--complete");
    expect(noHeadIndex.base.coverageReasonCodes.filter(reason => reason.startsWith("dependencies:"))).toEqual([]);
    expect(noHeadIndex.head.debt.coverageReasonCodes).toContain("dependencies:index-missing");
    expect(noHeadIndex.resolvedIds).toEqual([]);
    expect(git(root, "worktree", "list", "--porcelain")).toBe(worktrees);
    expect(readdirSync(scratch)).toEqual([]);
  });
}, 60_000);

test("debt --base --complete cold-indexes detached base from a linked worktree without a shared base pointer (#632)", async () => {
  const { root } = fixture();
  // Remove `.codegraph/` from root `.gitignore` to prove cold-indexing never leaks `.codegraph/.gitignore` as unowned debt.
  write(root, ".gitignore", ".archcontext/.local/\n");
  write(root, "src/a/main.ts", "import { other } from '../b/main';\nexport const value = other;\n");
  write(root, ".archcontext/model/state-machines/value.yaml", stableYaml({
    schemaVersion: "archcontext.state-machine/v1", id: "state-machine.a.value", capabilityId: "capability.a", name: "Value",
    regions: [{ id: "value", label: "Value", initial: "new", states: [{ id: "new", label: "New" }, { id: "set", label: "Set", terminal: true }], source: { kind: "code", path: "src/a/main.ts" } }],
    events: [{ id: "assign", label: "Assign", source: { kind: "code", path: "src/a/main.ts", symbol: "value" }, steps: [{ when: { value: ["new"] }, then: { value: "set" } }] }],
    rules: []
  }));
  git(root, "add", "-A"); git(root, "commit", "-qm", "base with dependency and symbol anchor");
  const baseSha = git(root, "rev-parse", "HEAD").trim();
  write(root, "src/b/main.ts", "import { value } from '../a/main';\nexport const other = () => value;\n");
  git(root, "add", "-A"); git(root, "commit", "-qm", "head adds reverse dependency");

  const linkedParent = mkdtempSync(join(tmpdir(), "archctx-debt-linked-"));
  roots.push(linkedParent);
  const linked = join(linkedParent, "wt");
  git(root, "worktree", "add", "-q", linked, "HEAD");
  indexCodeGraphFixture(linked);
  const sharedBase = codeGraphBaseDirectory(join(root, ".git"));
  expect(existsSync(join(sharedBase, "current.json"))).toBe(false);

  const hooksDir = join(root, ".git", "hooks");
  const hooksBefore = existsSync(hooksDir) ? readdirSync(hooksDir).sort() : [];
  await withDebtSandbox(async ({ scratch }) => {
    const worktrees = git(root, "worktree", "list", "--porcelain");
    const delta = await readDelta(linked, baseSha, "--complete");
    expect(delta.base.sha).toBe(baseSha);
    expect(delta.base.coverageReasonCodes.filter(reason =>
      reason.startsWith("dependencies:") || reason.startsWith("flows:") || reason.startsWith("state-machines:") || reason.startsWith("anchors:")
    )).toEqual([]);
    expect(delta.introduced).toEqual([expect.objectContaining({
      kind: "undeclared-dependency",
      details: expect.objectContaining({ fromCapabilityId: "capability.b", toCapabilityId: "capability.a" })
    })]);
    expect(delta.resolvedIds).toEqual([]);
    expect(git(root, "worktree", "list", "--porcelain")).toBe(worktrees);
    expect(readdirSync(scratch)).toEqual([]);
    expect(existsSync(hooksDir) ? readdirSync(hooksDir).sort() : []).toEqual(hooksBefore);
    // Cache hit: removing scratch proves the complete base measurement was stored in SQLite.
    rmdirSync(scratch);
    expect(await readDelta(linked, baseSha, "--complete")).toEqual(delta);
  });
}, 120_000);

test("debt --base --complete cold-indexes detached base when seeding is declined (native Windows path, #632)", async () => {
  const { root } = fixture();
  write(root, "src/a/main.ts", "import { other } from '../b/main';\nexport const value = other;\n");
  git(root, "add", "-A"); git(root, "commit", "-qm", "base dependency");
  const baseSha = git(root, "rev-parse", "HEAD").trim();
  write(root, "src/b/main.ts", "import { value } from '../a/main';\nexport const other = () => value;\n");
  git(root, "add", "-A"); git(root, "commit", "-qm", "head adds reverse dependency");
  indexCodeGraphFixture(root);

  const seedSpy = spyOn(codegraphAdapter, "seedCodeGraphIndexFromBase").mockReturnValue("declined");
  try {
    await withDebtSandbox(async ({ scratch }) => {
      const worktrees = git(root, "worktree", "list", "--porcelain");
      const delta = await readDelta(root, baseSha, "--complete");
      expect(seedSpy).toHaveBeenCalled();
      expect(delta.base.coverageReasonCodes.filter(reason =>
        reason.startsWith("dependencies:") || reason.startsWith("flows:") || reason.startsWith("state-machines:") || reason.startsWith("anchors:")
      )).toEqual([]);
      expect(delta.introduced).toEqual([expect.objectContaining({
        kind: "undeclared-dependency",
        details: expect.objectContaining({ fromCapabilityId: "capability.b", toCapabilityId: "capability.a" })
      })]);
      expect(git(root, "worktree", "list", "--porcelain")).toBe(worktrees);
      expect(readdirSync(scratch)).toEqual([]);
      rmdirSync(scratch);
      expect(await readDelta(root, baseSha, "--complete")).toEqual(delta);
    });
  } finally {
    seedSpy.mockRestore();
  }
}, 120_000);

test("aborting during detached base cold-index cleans up the worktree and local .codegraph state (#632)", async () => {
  const { root } = fixture();
  const baseSha = git(root, "rev-parse", "HEAD").trim();
  const { FailureError } = await import("@archcontext/contracts");
  const controller = new AbortController();
  const seedSpy = spyOn(codegraphAdapter, "seedCodeGraphIndexFromBase").mockReturnValue("declined");
  const initSpy = spyOn(codegraphAdapter, "initCodeGraphIndex").mockImplementation(async (worktree, options) => {
    expect(existsSync(join(worktree, ".codegraph", ".gitignore"))).toBe(true);
    controller.abort(new FailureError("AC_RUNTIME_UNAVAILABLE", "debt-measurement-interrupted"));
    options?.signal?.throwIfAborted();
  });
  try {
    await withDebtSandbox(async ({ state, scratch }) => {
      const worktrees = git(root, "worktree", "list", "--porcelain");
      const result = await runArchitectureDebtDeltaCommand(root, baseSha, true, controller.signal);
      expect(result).toMatchObject({ ok: false, error: { reasonCode: "debt-measurement-interrupted" } });
      expect(git(root, "worktree", "list", "--porcelain")).toBe(worktrees);
      expect(readdirSync(state)).toEqual([]);
      expect(readdirSync(scratch)).toEqual([]);
    });
  } finally {
    initSpy.mockRestore();
    seedSpy.mockRestore();
  }
});

test("an unadopted base reports unknown coverage without classifying existing debt as introduced", async () => {
  const { root } = fixture();
  rmSync(join(root, ".archcontext/manifest.yaml"));
  git(root, "add", "-A"); git(root, "commit", "-qm", "unadopted base");
  git(root, "checkout", "HEAD^", "--", ".archcontext/manifest.yaml");
  write(root, "src/unowned.ts", "export const current = 1;\n");
  await withDebtSandbox(async () => {
    const delta = await readDelta(root, "HEAD");
    expect(delta.base.coverage).toBe("unknown");
    expect(delta.base.coverageReasonCodes).toContain("ownership:model-not-adopted");
    expect(delta.head.debt.items.some(item => item.kind === "unowned-path")).toBe(true);
    expect(delta.introduced).toEqual([]);
    expect(delta.resolvedIds).toEqual([]);
  });
});

test("unresolvable debt base returns a typed error before touching Git or runtime state", async () => {
  const { root } = fixture();
  await withDebtSandbox(async ({ state, scratch }) => {
    const gitState = () => [git(root, "for-each-ref"), git(root, "worktree", "list", "--porcelain"),
      readFileSync(join(root, ".git", "HEAD"), "utf8"), readFileSync(join(root, ".git", "index"))];
    const before = gitState();
    const contents = tree(root);
    const result = await runCli("debt", ["--base", "no-such-revision", "--complete", "--json"], root, { runtimeClient: noRuntime });
    expect(result).toMatchObject({ ok: false, requestId: "debt", error: { code: "AC_PRECONDITION_FAILED", reasonCode: "native-context-ref-unavailable" } });
    expect(gitState()).toEqual(before);
    expect(tree(root)).toBe(contents);
    expect(readdirSync(state)).toEqual([]);
    expect(readdirSync(scratch)).toEqual([]);
  });
});

test("a base measurement failure removes its checkout without starting a daemon", async () => {
  const { root } = fixture();
  const manifest = "docs/architecture/.projection-manifest.json";
  write(root, manifest, JSON.stringify({ schemaVersion: "archcontext.architecture-docs-projection-manifest/v2", profile: "default" }));
  git(root, "add", "-A"); git(root, "commit", "-qm", "base with old projection manifest");
  rmSync(join(root, manifest));
  git(root, "add", "-A"); git(root, "commit", "-qm", "remove old manifest");
  await withDebtSandbox(async ({ state, scratch }) => {
    const worktrees = git(root, "worktree", "list", "--porcelain");
    const result = await runCli("debt", ["--base", "HEAD^", "--json"], root, { runtimeClient: noRuntime });
    expect(result).toMatchObject({ ok: false, error: { reasonCode: "projection-manifest-upgrade-required" } });
    expect(git(root, "worktree", "list", "--porcelain")).toBe(worktrees);
    expect(readdirSync(state)).toEqual([]);
    expect(readdirSync(scratch)).toEqual([]);
  });
});

test.skipIf(process.platform === "win32")("SIGINT during debt checkout leaves no worktree or daemon", async () => {
  const { root } = fixture();
  await withDebtSandbox(async ({ state, scratch }) => {
    const worktrees = git(root, "worktree", "list", "--porcelain");
    const realGit = Bun.which("git")!;
    const bin = join(dirname(scratch), "bin");
    const release = join(bin, "release");
    const ready = join(bin, "ready");
    write(bin, "git", `#!/bin/sh
case " $* " in
  *" worktree add "*)
    "$DEBT_TEST_GIT" "$@" || exit $?
    : > "$DEBT_TEST_READY"
    while [ ! -f "$DEBT_TEST_RELEASE" ]; do sleep 0.02; done
    ;;
  *) exec "$DEBT_TEST_GIT" "$@" ;;
esac
`);
    chmodSync(join(bin, "git"), 0o700);
    const cli = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/main.ts"), "debt", "--base", "HEAD", "--json"], {
      cwd: root,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DEBT_TEST_GIT: realGit, DEBT_TEST_READY: ready, DEBT_TEST_RELEASE: release },
      stdout: "pipe", stderr: "pipe"
    });
    try {
      const deadline = performance.now() + 5_000;
      while (!existsSync(ready) && cli.exitCode === null && performance.now() < deadline) await Bun.sleep(20);
      expect(existsSync(ready)).toBe(true);
      expect(git(root, "worktree", "list", "--porcelain")).not.toBe(worktrees);
      cli.kill("SIGINT");
    } finally {
      writeFileSync(release, "");
      await cli.exited;
    }
    expect(cli.exitCode).toBe(1);
    expect(await new Response(cli.stdout).json()).toMatchObject({ ok: false, error: { reasonCode: "debt-measurement-interrupted" } });
    expect(git(root, "worktree", "list", "--porcelain")).toBe(worktrees);
    expect(readdirSync(state)).toEqual([]);
    expect(readdirSync(scratch)).toEqual([]);
  });
}, 15_000);

test("former checkpoint fields are rejected before any runtime access", async () => {
  const { root } = fixture();
  for (const flag of ["--task-session-id", "--task", "--event", "--tool-call-id", "--expected-head-sha", "--head-sha", "--expected-worktree-digest", "--max-bytes", "--max-items", "--path", "--changed"]) {
    expect(await runCli("checkpoint", [flag, "old"], root, { runtimeClient: noRuntime })).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
    if (flag !== "--event") expect(await runCli("hook", ["checkpoint", flag, "old"], root, { runtimeClient: noRuntime })).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
  }
  const missing = await runCli("checkpoint", ["--changed-path", "../outside"], join(root, "absent"), { runtimeClient: noRuntime });
  expect(missing).toMatchObject({ ok: false });
});

test("hook read preserves the debt report and a typed unknown failure without state access", async () => {
  const { root } = fixture();
  const before = tree(root);
  const result = await runCli("hook", ["checkpoint", "--event", "post-edit", "--changed-path", "src/a/main.ts"], root, { runtimeClient: noRuntime });
  expect(result.ok).toBe(true);
  expect((result.data as any).debt).toEqual(readArchitectureDebt(root, { changedPaths: ["src/a/main.ts"] }));
  expect(publishedSchemaIssues("runtime/hook-debt-checkpoint.schema.json", result.data)).toEqual([]);
  expect(tree(root)).toBe(before);
  expect(await runCli("hook", ["checkpoint", "--changed-path", "../outside"], root, { runtimeClient: noRuntime }))
    .toMatchObject({ ok: false, error: { reasonCode: "changed-path-invalid" } });
  expect(await runCli("hook", ["checkpoint", "--event", ""], root, { runtimeClient: noRuntime }))
    .toMatchObject({ ok: false, error: { reasonCode: "hook-event-invalid" } });
  rmSync(join(root, ".archcontext/manifest.yaml"));
  const missingModelTree = tree(root);
  const failure = await runCli("hook", ["checkpoint"], root, { runtimeClient: noRuntime });
  const producer = await runCli("checkpoint", [], root, { runtimeClient: noRuntime });
  expect(failure.ok).toBe(true);
  expect(failure.data).toMatchObject({ accepted: false, failOpen: true, coverage: "unknown", error: "error" in producer ? producer.error : undefined });
  expect((failure.data as any).debt).toBeUndefined();
  expect(tree(root)).toBe(missingModelTree);
});

test("invalid hook changed-path rejects before repository discovery even outside Git", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-hook-non-git-")); roots.push(root);
  const state = mkdtempSync(join(tmpdir(), "archctx-hook-non-git-state-")); roots.push(state);
  write(root, "sentinel", "preserve worktree\n");
  write(state, "sentinel", "preserve state\n");
  const before = tree(root);
  const stateBefore = tree(state);
  let runtimeAccesses = 0;
  let storeAccesses = 0;
  const forbiddenRuntime = new Proxy({}, { get: () => { runtimeAccesses++; throw new Error("runtime accessed"); } });
  const forbiddenStore = new Proxy({}, { get: () => { storeAccesses++; throw new Error("store accessed"); } });
  const previous = process.env.ARCHCONTEXT_STATE_DIR;
  process.env.ARCHCONTEXT_STATE_DIR = state;
  try {
    const result = await runCli("hook", ["checkpoint", "--changed-path", "../outside"], root, {
      runtimeClient: forbiddenRuntime as RuntimeDaemonClient, localStore: forbiddenStore as any
    });
    expect(result).toMatchObject({ ok: false, requestId: "hook.checkpoint",
      error: { code: "AC_SCHEMA_INVALID", reasonCode: "changed-path-invalid" } });
    expect(result.data).toBeUndefined();
    expect(runtimeAccesses).toBe(0);
    expect(storeAccesses).toBe(0);
    expect(tree(root)).toBe(before);
    expect(tree(state)).toBe(stateBefore);
  } finally {
    if (previous === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previous;
  }
});

test("a logic-only edit owes no task and the process writes no worktree or runtime state", async () => {
  const { root } = fixture();
  const before = await read(root,["src/a/main.ts"]);
  write(root,"src/a/main.ts","export const value = 42;\n");
  const after = await read(root,["src/a/main.ts"]);
  expect(after).toEqual(before);
  expect(after.items).toEqual([]);
  expect(after.coverage).toBe("partial");
  expect(after.checks).toContainEqual({ check:"dependencies",coverage:"unknown",reasonCodes:["deferred-to-complete","not-evaluated"] });
  // SM-S22: a model with no state machine still reports the check, complete and without items.
  expect(after.checks.map(check => check.check)).toEqual(["ownership","anchors","dependencies","flows","state-machines","practices"]);
  expect(after.checks).toContainEqual({ check:"state-machines",coverage:"complete",reasonCodes:[] });
});

test("without a CodeGraph index a symbol anchor is a coverage gap, and a file anchor on the changed path is still debt (SM-S21)", async () => {
  const { root } = fixture();
  write(root,".archcontext/model/state-machines/value.yaml",stableYaml({ schemaVersion:"archcontext.state-machine/v1", id:"state-machine.a.value", capabilityId:"capability.a", name:"Value",
    regions:[{ id:"value", label:"Value", initial:"new", states:[{ id:"new", label:"New" },{ id:"set", label:"Set", terminal:true }], source:{ kind:"code", path:"src/a/main.ts" } }],
    events:[{ id:"assign", label:"Assign", source:{ kind:"code", path:"src/a/main.ts", symbol:"value" }, steps:[{ when:{ value:["new"] }, then:{ value:"set" } }] }], rules:[] }));
  git(root,"add","-A"); git(root,"commit","-qm","machine");
  const report = await read(root,["src/a/main.ts"]);
  expect(report.checks).toContainEqual({ check:"state-machines",coverage:"partial",reasonCodes:["index-missing"] });
  expect(report.items.map(item => [item.kind,item.reasonCode,item.paths,item.details])).toEqual([
    ["state-machine-stale","anchor-unconfirmed",["src/a/main.ts"],{ stateMachineId:"state-machine.a.value", owner:"region", ownerId:"value" }]
  ]);
});

test("a shortened source reports the human citation in another capability and its repair removes that debt", async () => {
  const {root,document}=fixture();
  write(root,"src/a/main.ts","");
  const report=await read(root,["src/a/main.ts"]);
  expect(report.items).toHaveLength(1);
  expect(report.items[0]!.kind).toBe("stale-anchor");
  expect(report.items[0]!.capabilityIds).toEqual(["capability.b"]);
  expect(report.items[0]!.paths).toEqual([document,"src/a/main.ts"].sort());
  write(root,document,"# B\n\nCitation: `src/a/main.ts`.\n");
  expect((await read(root,["src/a/main.ts"])).items).toEqual([]);
});

test("a real ambiguous source owner is debt, and non-source or excluded files are not", async () => {
  const {root}=fixture();
  write(root,".archcontext/model/nodes/capability.c.yaml",stableYaml({schemaVersion:"archcontext.node/v2",id:"capability.c",kind:"capability",name:"C",status:"active",source:{include:["src/a/**"]}}));
  expect((await read(root,["src/a/main.ts"])).items.some(item=>item.kind==="ambiguous-owner")).toBe(true);
  write(root,"notes.md","Human notes.\n");
  write(root,"src/b/ignored/test.ts","ignored\n");
  expect((await read(root,["notes.md","src/b/ignored/test.ts"])).items).toEqual([]);
});

test("deleted cited files still produce anchor debt, without inventing an unowned existing file", async () => {
  const {root}=fixture();
  rmSync(join(root,"src/a/main.ts"));
  const report=await read(root,["src/a/main.ts"]);
  expect(report.items.map(item=>item.kind)).toEqual(["stale-anchor"]);
  expect(report.items[0]!.reasonCode).toBe("missing-path");
});

test("a new file under a declared source root without a matching owner is actionable", async () => {
  const {root}=fixture();
  write(root,".archcontext/model/nodes/capability.a.yaml",stableYaml({schemaVersion:"archcontext.node/v2",id:"capability.a",kind:"capability",name:"A",status:"active",source:{include:["src/a/*.ts"]}}));
  write(root,"src/a/new/tool.ts","export const newFile = 1;\n");
  const report=await read(root,["src/a/new/tool.ts"]);
  expect(report.items.map(item=>item.kind)).toEqual(["unowned-path"]);
  expect(report.items[0]!.paths).toEqual(["src/a/new/tool.ts"]);
});

test("invalid inputs, a non-Git directory and a missing model refuse without a daemon", async () => {
  const {root}=fixture();
  for (const args of [["--changed-path"],["--changed-path","../escape"],["--bogus"]]) {
    expect(await runCli("debt",args,root,{runtimeClient:noRuntime})).toMatchObject({ok:false,error:{code:"AC_SCHEMA_INVALID"}});
  }
  expect(()=>readArchitectureDebt(root,{changedPaths:"src/a.ts" as unknown as string[]})).toThrow("must be an array");
  const empty=mkdtempSync(join(tmpdir(),"archctx-debt-empty-")); roots.push(empty);
  expect(await runCli("debt",[],empty,{runtimeClient:noRuntime})).toMatchObject({ok:false,error:{code:"AC_REPO_NOT_FOUND"}});
  git(empty,"init","-q");
  expect(await runCli("debt",[],empty,{runtimeClient:noRuntime})).toMatchObject({ok:false,error:{code:"AC_MODEL_ADOPTION_REQUIRED"}});
  expect((await runCli("debt",["--help"],empty,{runtimeClient:noRuntime})).ok).toBe(true);
});

test("D6-A anchors refusal retains code/action/reason/details through raw, CLI, MCP and hook", async () => {
  const { FailureError, failureIssues } = await import("@archcontext/contracts");
  const { root } = fixture();
  write(root, "docs/architecture/.projection-manifest.json", JSON.stringify({ schemaVersion: "archcontext.architecture-docs-projection-manifest/v2", profile: "default" }));
  const before = tree(root);
  let raw: unknown;
  try { readArchitectureDebt(root); } catch (error) { raw = error; }
  expect(raw).toBeInstanceOf(FailureError);
  const producer = (raw as InstanceType<typeof FailureError>).failure;
  expect(producer).toMatchObject({
    code: "AC_PRECONDITION_FAILED",
    reasonCode: "projection-manifest-upgrade-required",
    action: "rebuild-plan",
    details: {
      manifestPath: "docs/architecture/.projection-manifest.json",
      foundSchemaVersion: "archcontext.architecture-docs-projection-manifest/v2",
      supportedSchemaVersion: "archcontext.architecture-docs-projection-manifest/v4",
      upgradeCommand: "archctx docs apply --approved --profile <default|repo-harness/v1>",
      migrationGuide: "docs/runbooks/architecture-documentation-projections.md"
    }
  });
  expect(failureIssues(producer)).toEqual([]);
  for (const command of ["debt", "checkpoint"]) {
    const result = await runCli(command, [], root, { runtimeClient: noRuntime });
    expect("error" in result ? result.error : undefined).toEqual(producer);
  }
  const hook = await runCli("hook", ["checkpoint"], root, { runtimeClient: noRuntime });
  expect(hook).toMatchObject({ ok: true, data: { accepted: false, failOpen: true, coverage: "unknown", error: producer } });
  expect(tree(root)).toBe(before);
});
