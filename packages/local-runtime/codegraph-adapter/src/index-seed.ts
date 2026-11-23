import { FailureError, INDEX_SEED_SCHEMA_VERSION, digestJson, type IndexSeedResultV1, type Json } from "@archcontext/contracts";
import { findRepositoryRoot, readOnlyGit, decodeUtf8, stripGitLineTerminator } from "@archcontext/local-runtime/git-adapter";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { DEFAULT_CODEGRAPH_BINARY, initCodeGraphIndex, syncCodeGraphIndex } from "./cli-invocation";
import { codeGraphBaseDirectory, refreshCodeGraphBase, seedCodeGraphIndexFromBase } from "./index-base";
import { assertRepositoryCodeFactsReady, inspectRepositoryCodeFacts } from "./repository-code-facts";
import type { CodeGraphReadProvider } from "./read-session";

export interface CodeGraphIndexSeedOptions {
  timeoutMs?: number;
  binary?: string;
  readProvider?: CodeGraphReadProvider;
  syncFn?: (root: string) => Promise<void> | void;
  initFn?: (root: string) => Promise<void> | void;
}

/**
 * Determines whether a Git worktree is the primary checkout or a linked worktree (#641).
 */
export function readGitWorktreeRole(root: string): "primary" | "linked" {
  const repositoryRoot = findRepositoryRoot(root);
  const rawGitDir = stripGitLineTerminator(decodeUtf8(readOnlyGit(repositoryRoot, "rev-parse", ["--git-dir"])));
  const rawCommonDir = stripGitLineTerminator(decodeUtf8(readOnlyGit(repositoryRoot, "rev-parse", ["--git-common-dir"])));
  const resolvedGitDir = realpathSync.native(isAbsolute(rawGitDir) ? rawGitDir : resolve(repositoryRoot, rawGitDir));
  const resolvedCommonDir = realpathSync.native(isAbsolute(rawCommonDir) ? rawCommonDir : resolve(repositoryRoot, rawCommonDir));
  return resolvedGitDir === resolvedCommonDir ? "primary" : "linked";
}

function digestDatabaseFile(path: string): `sha256:${string}` | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
    return `sha256:${hash}`;
  } catch {
    return undefined;
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pathExistsNoFollow(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== "ENOENT" && code !== "ENOTDIR";
  }
}

/**
 * Standalone multi-worktree CodeGraph shared-base seeding command (#641), cleanly decoupled from
 * documentation projection (`archctx sync`).
 * - Primary checkout: builds/syncs `.codegraph/codegraph.db` and atomically publishes the shared base snapshot.
 * - Linked worktree: non-destructively preserves an existing ready `.codegraph`, or hardlink-seeds from shared base.
 */
export async function runCodeGraphIndexSeed(root: string, options: CodeGraphIndexSeedOptions = {}): Promise<IndexSeedResultV1> {
  const startedAt = Date.now();
  const repositoryRoot = findRepositoryRoot(root);
  const role = readGitWorktreeRole(repositoryRoot);
  const binary = options.binary ?? DEFAULT_CODEGRAPH_BINARY;
  const dbPath = join(repositoryRoot, ".codegraph", "codegraph.db");

  if (role === "primary") {
    const hadDb = pathExistsNoFollow(dbPath);
    const indexDir = join(repositoryRoot, ".codegraph");
    const hadDir = pathExistsNoFollow(indexDir);
    if (!hadDb) {
      if (hadDir) {
        let dirIsLocal = false;
        try { dirIsLocal = lstatSync(indexDir).isDirectory(); } catch { dirIsLocal = false; }
        if (!dirIsLocal) throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-open-failed");
        const ignorePath = join(indexDir, ".gitignore");
        if (pathExistsNoFollow(ignorePath)) {
          let ignoreIsFile = false;
          try { ignoreIsFile = lstatSync(ignorePath).isFile(); } catch { ignoreIsFile = false; }
          if (!ignoreIsFile) throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-open-failed");
        }
      } else {
        mkdirSync(indexDir, { recursive: true });
      }
      if (!pathExistsNoFollow(join(indexDir, ".gitignore"))) {
        writeFileSync(join(indexDir, ".gitignore"), "*\n", "utf8");
      }
      try {
        if (options.initFn) await options.initFn(repositoryRoot);
        else await initCodeGraphIndex(repositoryRoot, { binary, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
      } catch (error) {
        if (!hadDir) rmSync(indexDir, { recursive: true, force: true });
        throw error;
      }
    } else if (options.syncFn) {
      await options.syncFn(repositoryRoot);
    } else {
      assertRepositoryCodeFactsReady(repositoryRoot, options.readProvider ? { provider: options.readProvider } : {});
      syncCodeGraphIndex(repositoryRoot, { binary, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
    }
    assertRepositoryCodeFactsReady(repositoryRoot, options.readProvider ? { provider: options.readProvider } : {});
    const refresh = refreshCodeGraphBase(repositoryRoot, options.readProvider ? { provider: options.readProvider } : {});
    if (refresh === "skipped-busy") {
      throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-base-building");
    }
    const indexDigest = digestDatabaseFile(dbPath) ?? (digestJson({ root: repositoryRoot, refresh } as unknown as Json) as `sha256:${string}`);
    return {
      schemaVersion: INDEX_SEED_SCHEMA_VERSION,
      mode: "primary-refresh",
      worktreeRole: "primary",
      seededFromBase: false,
      hardlinkedFiles: 0,
      copiedFiles: refresh === "published" ? 1 : 0,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      indexDigest
    };
  }

  // Linked worktree: non-destructive guard first (#641)
  if (pathExistsNoFollow(dbPath)) {
    const facts = inspectRepositoryCodeFacts(repositoryRoot, options.readProvider ? { provider: options.readProvider } : {});
    if (facts.state === "ready") {
      return {
        schemaVersion: INDEX_SEED_SCHEMA_VERSION,
        mode: "already-present",
        worktreeRole: "linked",
        seededFromBase: false,
        hardlinkedFiles: 0,
        copiedFiles: 0,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        ...(digestDatabaseFile(dbPath) ? { indexDigest: digestDatabaseFile(dbPath) } : {})
      };
    }
    if (facts.state === "unavailable") {
      throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", facts.reasonCode === "index-open-failed" ? "index-open-failed" : "code-facts-unavailable");
    }
    // Pre-existing `.codegraph` exists cleanly: refuse overwriting rather than clobbering it
    throw new FailureError("AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", {
      issues: "issues" in facts ? facts.issues : []
    });
  }

  const deadline = startedAt + (options.timeoutMs ?? 0);
  let outcome = seedCodeGraphIndexFromBase(repositoryRoot, { binary, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
  while (outcome === "base-building" && Date.now() < deadline) {
    sleepSync(Math.min(100, Math.max(10, deadline - Date.now())));
    outcome = seedCodeGraphIndexFromBase(repositoryRoot, { binary, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
  }

  if (outcome === "present") {
    return {
      schemaVersion: INDEX_SEED_SCHEMA_VERSION,
      mode: "already-present",
      worktreeRole: "linked",
      seededFromBase: false,
      hardlinkedFiles: 0,
      copiedFiles: 0,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      ...(digestDatabaseFile(dbPath) ? { indexDigest: digestDatabaseFile(dbPath) } : {})
    };
  }
  if (outcome === "seeded") {
    return {
      schemaVersion: INDEX_SEED_SCHEMA_VERSION,
      mode: "worktree-seed",
      worktreeRole: "linked",
      seededFromBase: true,
      hardlinkedFiles: 1,
      copiedFiles: 0,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      ...(digestDatabaseFile(dbPath) ? { indexDigest: digestDatabaseFile(dbPath) } : {})
    };
  }
  if (outcome === "base-building") {
    throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-base-building");
  }
  const commonDir = stripGitLineTerminator(decodeUtf8(readOnlyGit(repositoryRoot, "rev-parse", ["--git-common-dir"])));
  const baseDir = codeGraphBaseDirectory(isAbsolute(commonDir) ? commonDir : resolve(repositoryRoot, commonDir));
  throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-missing", {
    baseDirectoryPresent: existsSync(baseDir)
  });
}
