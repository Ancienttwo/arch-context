import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateArchitectureProjectionFreshness, loadCapabilitySourceFootprintDigests, type NativeModel } from "@archcontext/core/projection-engine";
import { architectureSourceStampsDigest } from "@archcontext/contracts";
import {
  computeGitChangeFingerprint,
  readCommitChangeMetadata,
  readTrackedSourceFiles,
  readWorkspacePackages,
  normalizePackageExports,
  readTrackedTreeEntries,
  readRepositoryBinding,
  readHeadSha,
  readStagedChangeMetadata,
  readWorktreeChangeMetadata,
  findRepositoryRoot,
  listGitVisibleFiles,
  ignoredRepositoryPaths,
  GitVisibleFilesUnavailableError
} from "../src/index";

describe("@archcontext/local-runtime/git-adapter", () => {
  test("discovers the current repository root and HEAD binding", () => {
    const root = findRepositoryRoot(process.cwd());
    expect(root.length).toBeGreaterThan(0);
    expect(findRepositoryRoot(root)).toBe(root);

    const headSha = readHeadSha(root);
    expect(headSha).toMatch(/^[a-f0-9]{40}$/);

    const binding = readRepositoryBinding(process.cwd());
    expect(binding.root).toBe(root);
    expect(binding.headSha).toBe(headSha);
    expect(binding.repositoryId).toMatch(/^repo\.[a-f0-9]{16}$/);
    expect(binding.worktreeDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test("non-repository roots fail without walking past the filesystem root", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-git-adapter-nonrepo-"));
    try {
      expect(() => findRepositoryRoot(root)).toThrow("Repository root not found");
    } finally {
      removeTempRoot(root);
    }
  });

  test("reads commit, staged, and worktree change metadata without source or diff bodies", () => {
    const root = createGitFixture();
    try {
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const commit = readCommitChangeMetadata(root);
      expect(commit).toMatchObject({
        source: "commit",
        baseSha: "root",
        headSha,
        pathCount: 1,
        paths: [{ path: "tracked.txt", status: "added", rawStatus: "A" }]
      });

      writeFileSync(join(root, "staged.ts"), "export const staged = true;\n");
      git(root, "add", "staged.ts");
      const staged = readStagedChangeMetadata(root);
      expect(staged).toMatchObject({
        source: "staged",
        baseSha: headSha,
        headSha,
        paths: [{ path: "staged.ts", status: "added", rawStatus: "A" }]
      });

      writeFileSync(join(root, "tracked.txt"), "dirty source checkout\n");
      writeFileSync(join(root, "untracked.ts"), "export const untracked = true;\n");
      const worktree = readWorktreeChangeMetadata(root);
      expect(worktree.source).toBe("worktree");
      expect(worktree.headSha).toBe(headSha);
      expect(worktree.paths).toEqual([
        { path: "tracked.txt", rawStatus: "M", status: "modified" },
        { path: "untracked.ts", rawStatus: "??", status: "added" }
      ]);

      const encoded = JSON.stringify({ commit, staged, worktree });
      expect(encoded).not.toContain("dirty source checkout");
      expect(encoded).not.toContain("export const");
      expect(commit.metadataDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(staged.metadataDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(worktree.metadataDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    } finally {
      removeTempRoot(root);
    }
  });

  test("computes stable change fingerprints from repository, revisions, paths, analysis kind, and CodeGraph digest", () => {
    const first = computeGitChangeFingerprint({
      repositoryId: "repo.test",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      paths: ["src/b.ts", "src/a.ts", "src/a.ts"],
      codeFactsDigest: `sha256:${"1".repeat(64)}`,
      analysisKind: "architecture-delta"
    });
    const reordered = computeGitChangeFingerprint({
      repositoryId: "repo.test",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      paths: [{ path: "src/a.ts", status: "modified", rawStatus: "M" }, { path: "src/b.ts", status: "added", rawStatus: "A" }],
      codeFactsDigest: `sha256:${"1".repeat(64)}`,
      analysisKind: "architecture-delta"
    });
    const differentFacts = computeGitChangeFingerprint({
      repositoryId: "repo.test",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      paths: ["src/a.ts", "src/b.ts"],
      codeFactsDigest: `sha256:${"2".repeat(64)}`,
      analysisKind: "architecture-delta"
    });

    expect(first).toBe(reordered);
    expect(first).not.toBe(differentFacts);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("measures Git-tracked source files only, so an untracked build output cannot inflate the footprint", () => {
    const root = createGitFixture();
    try {
      mkdirSync(join(root, "src/dist"), { recursive: true });
      mkdirSync(join(root, "docs"), { recursive: true });
      writeFileSync(join(root, "src/a.ts"), "export const a = 1;\nexport const b = 2;\n");
      writeFileSync(join(root, "src/no-trailing-newline.ts"), "export const c = 3;");
      writeFileSync(join(root, "src/empty.ts"), "");
      writeFileSync(join(root, "docs/guide.md"), "# guide\n");
      commitAll(root, "sources");

      // Exists on disk inside the include glob, but was never committed.
      writeFileSync(join(root, "src/dist/x.ts"), "export const generated = true;\n".repeat(40));

      const measured = readTrackedSourceFiles(root, { include: ["src/**"] });

      expect(measured).toEqual([
        { path: "src/a.ts", lineCount: 2 },
        { path: "src/empty.ts", lineCount: 0 },
        { path: "src/no-trailing-newline.ts", lineCount: 1 }
      ]);
      expect(measured.some((file) => file.path === "src/dist/x.ts")).toBe(false);
      // Tracking it is what changes the measurement, not its presence on disk.
      git(root, "add", "src/dist/x.ts");
      commitAll(root, "generated");
      expect(readTrackedSourceFiles(root, { include: ["src/**"] })).toHaveLength(4);

      // No include filter measures the whole tracked tree.
      expect(readTrackedSourceFiles(root).map((file) => file.path)).toEqual([
        "docs/guide.md",
        "src/a.ts",
        "src/dist/x.ts",
        "src/empty.ts",
        "src/no-trailing-newline.ts",
        "tracked.txt"
      ]);
    } finally {
      removeTempRoot(root);
    }
  });

  test("counts the committed blob, so an uncommitted edit or deletion does not move the measurement", () => {
    const root = createGitFixture();
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
      writeFileSync(join(root, "src/b.ts"), "export const b = 2;\n");
      commitAll(root, "sources");
      const committed = readTrackedSourceFiles(root, { include: ["src/**"] });
      expect(committed).toEqual([{ path: "src/a.ts", lineCount: 1 }, { path: "src/b.ts", lineCount: 1 }]);

      // Grow one tracked file by 40 lines and delete another, without committing either.
      writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n".repeat(41));
      rmSync(join(root, "src/b.ts"));

      // The snapshot describes a commit, not whatever happens to be on disk, so two scans at the
      // same HEAD stay comparable.
      expect(readTrackedSourceFiles(root, { include: ["src/**"] })).toEqual(committed);
    } finally {
      removeTempRoot(root);
    }
  });

  test("a blob Git cannot hand back fails closed naming the path", () => {
    const root = createGitFixture();
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
      commitAll(root, "sources");
      const objectId = gitOut(root, "rev-parse", "HEAD:src/a.ts");
      rmSync(join(root, ".git/objects", objectId.slice(0, 2), objectId.slice(2)));

      // Reporting a smaller footprint than the commit actually has would be a silent wrong answer.
      expect(() => readTrackedSourceFiles(root, { include: ["src/**"] })).toThrow("git-tracked-blob-unreadable: src/a.ts");
    } finally {
      removeTempRoot(root);
    }
  });

  test("reads workspace manifests so bare workspace specifiers can be resolved downstream", () => {
    const root = createGitFixture();
    try {
      mkdirSync(join(root, "packages/alpha"), { recursive: true });
      mkdirSync(join(root, "packages/beta"), { recursive: true });
      mkdirSync(join(root, "packages/gamma"), { recursive: true });
      mkdirSync(join(root, "packages/delta"), { recursive: true });
      writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/beta", "packages/alpha", "packages/gamma", "packages/delta"] }));
      writeFileSync(join(root, "packages/alpha/package.json"), JSON.stringify({
        name: "@fixture/alpha",
        exports: { ".": "./src/index.ts", "./sub": "./sub/src/index.ts" }
      }));
      writeFileSync(join(root, "packages/beta/package.json"), JSON.stringify({ name: "@fixture/beta" }));
      // Condition objects (#445): `types` wins by the fixed order, not by key order.
      writeFileSync(join(root, "packages/gamma/package.json"), JSON.stringify({
        name: "@fixture/gamma",
        exports: { "./sub": { default: "./dist/sub.js", types: "./src/sub.ts" } }
      }));
      writeFileSync(join(root, "packages/delta/package.json"), JSON.stringify({
        name: "@fixture/delta",
        exports: { types: "./src/index.ts", import: "./dist/index.js" }
      }));

      expect(readWorkspacePackages(root)).toEqual([
        { name: "@fixture/alpha", root: "packages/alpha", exports: { ".": "./src/index.ts", "./sub": "./sub/src/index.ts" } },
        // A manifest without `exports` contributes no resolvable subpath rather than a guess.
        { name: "@fixture/beta", root: "packages/beta", exports: {} },
        { name: "@fixture/delta", root: "packages/delta", exports: { ".": "./src/index.ts" } },
        { name: "@fixture/gamma", root: "packages/gamma", exports: { "./sub": "./src/sub.ts" } }
      ]);
    } finally {
      removeTempRoot(root);
    }
  });

  test("normalizes the remaining exports shapes and fails closed on unsupported ones", () => {
    expect(normalizePackageExports(null, "p/package.json")).toEqual({});
    expect(normalizePackageExports("./index.js", "p/package.json")).toEqual({ ".": "./index.js" });
    expect(normalizePackageExports({
      "./array": [null, { node: "./node.js" }, { import: { types: "./nested.d.ts" } }],
      "./unresolved": { node: "./node.js" },
      "./null": null,
      "./require": { require: "./index.cjs" }
    }, "p/package.json")).toEqual({ "./array": "./nested.d.ts", "./require": "./index.cjs" });

    const failure = (exportsField: unknown) => {
      try {
        normalizePackageExports(exportsField, "packages/p/package.json");
      } catch (error) {
        return error;
      }
      throw new Error("expected a failure");
    };
    expect(failure({ ".": "./index.js", "./sub": { types: 5 } })).toMatchObject({
      code: "AC_SCHEMA_INVALID",
      reasonCode: "workspace-exports-unsupported",
      details: { manifestPath: "packages/p/package.json", subpath: "./sub" }
    });
    // Node rejects a map that mixes subpaths and conditions too.
    expect(failure({ ".": "./index.js", import: "./index.mjs" })).toMatchObject({ details: { subpath: "." } });
  });

  test("expands a dir/* workspace entry and refuses other glob shapes", () => {
    const root = createGitFixture();
    try {
      mkdirSync(join(root, "packages/alpha"), { recursive: true });
      mkdirSync(join(root, "packages/no-manifest"), { recursive: true });
      mkdirSync(join(root, "tools/cli"), { recursive: true });
      writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*", "tools/cli"] }));
      writeFileSync(join(root, "packages/alpha/package.json"), JSON.stringify({ name: "@fixture/alpha" }));
      writeFileSync(join(root, "tools/cli/package.json"), JSON.stringify({ name: "@fixture/cli" }));

      // A subdirectory without a package.json is not a workspace package.
      expect(readWorkspacePackages(root)).toEqual([
        { name: "@fixture/alpha", root: "packages/alpha", exports: {} },
        { name: "@fixture/cli", root: "tools/cli", exports: {} }
      ]);

      writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/**"] }));
      expect(() => readWorkspacePackages(root)).toThrow("workspace-glob-unsupported: packages/**");
    } finally {
      removeTempRoot(root);
    }
  });

  test("refuses option-shaped revisions before any Git process can read them as flags (#159)", () => {
    const root = createGitFixture();
    try {
      const hostile = "--output=trap";
      expect(() => readCommitChangeMetadata(root, hostile)).toThrow("invalid git revision argument");
      expect(() => readStagedChangeMetadata(root, hostile)).toThrow("invalid git revision argument");
      expect(() => readTrackedTreeEntries(root, hostile)).toThrow("invalid git revision argument");
      expect(() => readCommitChangeMetadata(root, "")).toThrow("invalid git revision argument");
      expect(existsSync(join(root, "trap"))).toBe(false);
    } finally {
      removeTempRoot(root);
    }
  });

});

describe("projection source files (#257)", () => {
  const nodeId = "capability.app";
  const model: NativeModel = {
    nodes: [{ id: nodeId, kind: "capability", name: "App", source: { include: ["app/**"], exclude: ["app/test/**"] } }],
    relations: []
  };
  const footprint = (root: string) => loadCapabilitySourceFootprintDigests(root, model, listGitVisibleFiles(root))
    .find((entry) => entry.nodeId === nodeId)!;

  function createFootprintFixture(): string {
    const root = mkdtempSync(join(tmpdir(), "archctx-projection-source-files-"));
    mkdirSync(join(root, "app/src"), { recursive: true });
    mkdirSync(join(root, "app/test"), { recursive: true });
    writeFileSync(join(root, ".gitignore"), "app/dist/\n*.log\n");
    writeFileSync(join(root, "app/src/index.ts"), "export const app = 1;\n");
    writeFileSync(join(root, "app/test/index.test.ts"), "test('app');\n");
    git(root, "init");
    commitAll(root, "footprint fixture");
    return root;
  }

  test("lists tracked and untracked non-ignored regular files, never ignored or deleted ones", () => {
    const root = createFootprintFixture();
    try {
      mkdirSync(join(root, "app/dist"), { recursive: true });
      writeFileSync(join(root, "app/dist/bundle.js"), "ignored build output\n");
      writeFileSync(join(root, "app/src/debug.log"), "ignored log\n");
      writeFileSync(join(root, "app/src/新規.ts"), "export const fresh = 1;\n");
      writeFileSync(join(root, "app/test/removed.test.ts"), "test('removed');\n");
      commitAll(root, "track a file that is then deleted locally");
      rmSync(join(root, "app/test/removed.test.ts"));

      expect(listGitVisibleFiles(root)).toEqual([
        ".gitignore",
        "app/src/index.ts",
        "app/src/新規.ts",
        "app/test/index.test.ts"
      ]);
    } finally {
      removeTempRoot(root);
    }
  });

  test("an ignored file under source.include never moves the footprint digest; a tracked edit makes the node stale", () => {
    const root = createFootprintFixture();
    try {
      const stamped = footprint(root);
      expect(stamped.fileCount).toBe(1);
      const manifest = { status: "present" as const, nodes: [{ nodeId, sourceFootprintDigest: stamped.digest }], sourceTreeDigest: architectureSourceStampsDigest({ [nodeId]: stamped.digest }) };

      // Build output and logs matched by `app/**` but gitignored: same digest, still fresh.
      mkdirSync(join(root, "app/dist"), { recursive: true });
      writeFileSync(join(root, "app/dist/bundle.js"), "console.log('built');\n");
      writeFileSync(join(root, "app/src/build.log"), "built\n");
      expect(footprint(root)).toEqual(stamped);
      expect(evaluateArchitectureProjectionFreshness({ model, manifest, sourceFootprints: [footprint(root)] }).ok).toBe(true);

      // An edit to a tracked file inside the footprint — uncommitted, then committed — is stale.
      writeFileSync(join(root, "app/src/index.ts"), "export const app = 2;\n");
      const edited = footprint(root);
      expect(edited.digest).not.toBe(stamped.digest);
      commitAll(root, "edit tracked footprint file");
      expect(footprint(root)).toEqual(edited);
      const stale = evaluateArchitectureProjectionFreshness({ model, manifest, sourceFootprints: [footprint(root)] });
      expect(stale.ok).toBe(false);
      expect(stale.reasonCodes).toEqual(["projection-source-changed-since-stamp"]);
      expect(stale.staleNodes).toEqual([{ nodeId, stampedDigest: stamped.digest, currentDigest: edited.digest }]);
    } finally {
      removeTempRoot(root);
    }
  });

  test("a shallow clone measures the same footprint without reading history", () => {
    const root = createFootprintFixture();
    const cloneParent = mkdtempSync(join(tmpdir(), "archctx-projection-source-files-clone-"));
    try {
      writeFileSync(join(root, "app/src/second.ts"), "export const second = 1;\n");
      commitAll(root, "second commit");
      const clone = join(cloneParent, "clone");
      execFileSync("git", ["clone", "--quiet", "--depth", "1", `file://${root}`, clone], { stdio: ["ignore", "pipe", "pipe"] });
      expect(gitOut(clone, "rev-parse", "--is-shallow-repository")).toBe("true");
      expect(footprint(clone)).toEqual(footprint(root));
    } finally {
      rmSync(cloneParent, { recursive: true, force: true });
      removeTempRoot(root);
    }
  });

  test("outside a Git worktree it fails closed with a typed error instead of walking the filesystem", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-projection-source-files-no-git-"));
    try {
      writeFileSync(join(root, "README.md"), "# not a repository\n");
      let caught: unknown;
      try {
        listGitVisibleFiles(root);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GitVisibleFilesUnavailableError);
      expect(caught).toMatchObject({ code: "AC_REPO_NOT_FOUND", reasonCode: "git-worktree-required" });
    } finally {
      removeTempRoot(root);
    }
  });
});

describe("ignored repository paths (#399)", () => {
  const modelPaths = [".archcontext/manifest.yaml", ".archcontext/model/nodes/", ".archcontext/decisions/"];
  const negations = ".archcontext/*\n!.archcontext/manifest.yaml\n!.archcontext/model/\n.archcontext/model/*\n!.archcontext/model/nodes/\n!.archcontext/decisions/\n";

  function createIgnoreFixture(gitignore: string): string {
    const root = mkdtempSync(join(tmpdir(), "archctx-ignored-paths-"));
    writeFileSync(join(root, ".gitignore"), gitignore);
    git(root, "init");
    return root;
  }

  test("negations that re-include the model leave no path ignored", () => {
    const root = createIgnoreFixture(negations);
    try {
      expect(ignoredRepositoryPaths(root, modelPaths)).toEqual([]);
    } finally {
      removeTempRoot(root);
    }
  });

  test("a later blanket directory rule cancels the negations and is reported with its rule", () => {
    const root = createIgnoreFixture(`${negations}/.archcontext/\n`);
    try {
      expect(ignoredRepositoryPaths(root, modelPaths)).toEqual(modelPaths.map((path) => ({ path, source: ".gitignore", line: 7, pattern: "/.archcontext/" })));
    } finally {
      removeTempRoot(root);
    }
  });

  test("rules alone decide: a force-added model file does not hide its ignored directory", () => {
    const root = createIgnoreFixture("/.archcontext/\n");
    try {
      mkdirSync(join(root, ".archcontext/model/nodes"), { recursive: true });
      writeFileSync(join(root, ".archcontext/model/nodes/app.yaml"), "id: capability.app\n");
      git(root, "add", "--force", ".archcontext/model/nodes/app.yaml");
      expect(ignoredRepositoryPaths(root, [".archcontext/model/nodes/", ".archcontext/model/nodes/app.yaml"]).map((entry) => entry.path))
        .toEqual([".archcontext/model/nodes/", ".archcontext/model/nodes/app.yaml"]);
    } finally {
      removeTempRoot(root);
    }
  });

  test("outside a Git worktree it fails closed with the typed Git error", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-ignored-paths-no-git-"));
    try {
      expect(() => ignoredRepositoryPaths(root, modelPaths)).toThrow(GitVisibleFilesUnavailableError);
    } finally {
      removeTempRoot(root);
    }
  });
});

function createGitFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-git-adapter-"));
  writeFileSync(join(root, "tracked.txt"), "committed\n");
  git(root, "init");
  git(root, "add", ".");
  git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture");
  return root;
}

function commitAll(root: string, message: string): void {
  git(root, "add", ".");
  git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", message);
}

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function gitOut(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function removeTempRoot(root: string): void {
  rmSync(root, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
}
