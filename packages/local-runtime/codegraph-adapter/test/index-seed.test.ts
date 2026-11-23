import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  INDEX_SEED_SCHEMA_VERSION,
  IndexSeedResultSchema,
  validateJsonSchema,
  type CodeFactsPort,
  type Json
} from "@archcontext/contracts";
import { readOnlyGit, decodeUtf8 } from "@archcontext/local-runtime/git-adapter";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import {
  REQUIRED_CODEGRAPH_VERSION,
  codeGraphBaseDirectory,
  inspectRepositoryCodeFacts,
  readGitWorktreeRole,
  runCodeGraphIndexSeed
} from "../src/index";
import { createStartedDaemon } from "../../runtime-daemon/src/index";
import { indexCodeGraphFixture, syncCodeGraphFixture } from "./real-index";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    try {
      execFileSync("git", ["worktree", "prune"], { cwd: root, stdio: "ignore" });
    } catch {}
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function createGitPrimaryRepo(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-index-seed-")));
  tempRoots.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "index.ts"), "export function greet(name: string) { return `hi ${name}`; }\n", "utf8");
  initializeArchContextModel(root, "Index Seed Fixture");
  git(root, "init");
  git(root, "add", ".");
  git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=test@archcontext.dev", "commit", "-m", "initial commit");
  return root;
}

function addLinkedWorktree(primaryRoot: string, branch: string): string {
  const linked = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-index-seed-wt-")));
  rmSync(linked, { recursive: true, force: true });
  tempRoots.push(linked);
  git(primaryRoot, "worktree", "add", "-b", branch, linked);
  return linked;
}

describe("@archcontext/local-runtime/codegraph-adapter #641 index seed", () => {
  test("primary-refresh invokes initFn when .codegraph is missing and syncFn when present", async () => {
    const primary = createGitPrimaryRepo();
    expect(readGitWorktreeRole(primary)).toBe("primary");

    let initCalls = 0;
    let syncCalls = 0;

    const first = await runCodeGraphIndexSeed(primary, {
      initFn: (root) => {
        initCalls += 1;
        indexCodeGraphFixture(root);
      },
      syncFn: (root) => {
        syncCalls += 1;
        syncCodeGraphFixture(root);
      }
    });

    expect(initCalls).toBe(1);
    expect(syncCalls).toBe(0);
    expect(first).toMatchObject({
      schemaVersion: INDEX_SEED_SCHEMA_VERSION,
      mode: "primary-refresh",
      worktreeRole: "primary",
      seededFromBase: false
    });
    expect(validateJsonSchema(IndexSeedResultSchema, first as unknown as Json).issues).toEqual([]);

    const second = await runCodeGraphIndexSeed(primary, {
      initFn: (root) => {
        initCalls += 1;
        indexCodeGraphFixture(root);
      },
      syncFn: (root) => {
        syncCalls += 1;
        syncCodeGraphFixture(root);
      }
    });

    expect(initCalls).toBe(1);
    expect(syncCalls).toBe(1);
    expect(second).toMatchObject({
      schemaVersion: INDEX_SEED_SCHEMA_VERSION,
      mode: "primary-refresh",
      worktreeRole: "primary",
      seededFromBase: false
    });
  }, 60_000);

  // Shared-base seeding is disabled on Windows (`seedBundle` in `index-base.ts`, #608).
  test.skipIf(process.platform === "win32")("seeds linked worktree from primary base and preserves existing .codegraph non-destructively", async () => {
    const primary = createGitPrimaryRepo();
    const linked = addLinkedWorktree(primary, "feat/worktree-seed");
    expect(readGitWorktreeRole(primary)).toBe("primary");
    expect(readGitWorktreeRole(linked)).toBe("linked");

    // Primary seed builds real CodeGraph index and publishes shared base snapshot
    const primaryResult = await runCodeGraphIndexSeed(primary);
    expect(primaryResult).toMatchObject({
      schemaVersion: INDEX_SEED_SCHEMA_VERSION,
      mode: "primary-refresh",
      worktreeRole: "primary",
      seededFromBase: false
    });
    expect(existsSync(join(primary, ".codegraph", "codegraph.db"))).toBe(true);
    expect(readdirSync(join(primary, ".codegraph")).sort()).toEqual([".gitignore", "codegraph.db"]);
    expect(existsSync(join(linked, ".codegraph"))).toBe(false);

    // Linked worktree seed materializes .codegraph from shared base without cold init
    const seeded = await runCodeGraphIndexSeed(linked);
    expect(seeded).toMatchObject({
      schemaVersion: INDEX_SEED_SCHEMA_VERSION,
      mode: "worktree-seed",
      worktreeRole: "linked",
      seededFromBase: true,
      hardlinkedFiles: 1
    });
    expect(validateJsonSchema(IndexSeedResultSchema, seeded as unknown as Json).issues).toEqual([]);
    expect(existsSync(join(linked, ".codegraph", "codegraph.db"))).toBe(true);
    expect(inspectRepositoryCodeFacts(linked).state).toBe("ready");
    expect(readdirSync(join(linked, ".codegraph")).sort()).toEqual([".gitignore", "codegraph.db"]);

    // Non-destructive re-run keeps pre-existing .codegraph content intact
    const sentinelPath = join(linked, ".codegraph", "custom-sentinel.txt");
    writeFileSync(sentinelPath, "keep-me\n", "utf8");
    const dbBytesBefore = readFileSync(join(linked, ".codegraph", "codegraph.db"));

    const alreadyPresent = await runCodeGraphIndexSeed(linked);
    expect(alreadyPresent).toMatchObject({
      schemaVersion: INDEX_SEED_SCHEMA_VERSION,
      mode: "already-present",
      worktreeRole: "linked",
      seededFromBase: false,
      hardlinkedFiles: 0,
      copiedFiles: 0
    });
    expect(readFileSync(sentinelPath, "utf8")).toBe("keep-me\n");
    expect(readFileSync(join(linked, ".codegraph", "codegraph.db"))).toEqual(dbBytesBefore);
  }, 60_000);

  // Shared-base seeding (and its `refresh.lock` check) is disabled on Windows (`seedBundle`, #608).
  test.skipIf(process.platform === "win32")("linked worktree fails retryably with index-base-building when primary refresh.lock is active", async () => {
    const primary = createGitPrimaryRepo();
    const linked = addLinkedWorktree(primary, "feat/base-building");
    const commonRaw = decodeUtf8(readOnlyGit(linked, "rev-parse", ["--git-common-dir"])).trim();
    const commonDir = isAbsolute(commonRaw) ? commonRaw : resolve(linked, commonRaw);
    const baseDir = codeGraphBaseDirectory(commonDir);
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(join(baseDir, "refresh.lock"), String(process.pid), "utf8");

    const preExistingSentinelDir = join(linked, ".codegraph");
    mkdirSync(preExistingSentinelDir, { recursive: true });
    const sentinel = join(preExistingSentinelDir, "keep-sentinel.txt");
    writeFileSync(sentinel, "untouched\n", "utf8");

    let caught: unknown;
    try {
      await runCodeGraphIndexSeed(linked, { timeoutMs: 50 });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeTruthy();
    expect((caught as { code?: string; reasonCode?: string; failure?: { retryable?: boolean } })).toMatchObject({
      code: "AC_CODE_FACTS_UNAVAILABLE",
      reasonCode: "index-base-building",
      failure: { retryable: true }
    });
    expect(readFileSync(sentinel, "utf8")).toBe("untouched\n");
    expect(existsSync(join(linked, ".codegraph", "codegraph.db"))).toBe(false);
  });

  test("ArchctxDaemon.sync does not initialize or seed .codegraph in a linked worktree", async () => {
    const primary = createGitPrimaryRepo();
    const linked = addLinkedWorktree(primary, "feat/decoupled-sync");
    let codeFactsSyncCalls = 0;
    const snapshot = {
      provider: "codegraph" as const,
      version: REQUIRED_CODEGRAPH_VERSION,
      schemaDigest: "sha256:" + "0".repeat(64),
      indexedAt: "2026-11-22T00:00:00.000Z",
      workspaceDigest: "sha256:" + "1".repeat(64)
    };
    const codeFacts: CodeFactsPort = {
      async ensureReady() { return snapshot; },
      async sync() {
        codeFactsSyncCalls += 1;
        return snapshot;
      },
      async buildTaskContext({ task }) {
        return { task, symbols: [], edges: [], evidence: [], digest: snapshot.schemaDigest };
      },
      async findSymbols() { return []; },
      async resolveEvidence() { return []; }
    };

    const daemon = await createStartedDaemon({
      localStore: new TestLocalStore(),
      codeFacts
    });
    try {
      const synced = await daemon.sync(linked);
      expect(synced.ok).toBe(true);
      expect(codeFactsSyncCalls).toBe(0);
      expect(existsSync(join(linked, ".codegraph"))).toBe(false);
    } finally {
      await daemon.stop();
    }
  });
});
