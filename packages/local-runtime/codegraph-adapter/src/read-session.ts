import { productVersionManifest } from "@archcontext/contracts";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import type { CodeGraph } from "@colbymchenry/codegraph";

/**
 * ADR-0058: every CodeGraph read goes through one in-process, read-only handle. A read starts no
 * CodeGraph command, runs no `git status` or `git diff`, never opens the index writable and never
 * copies it. SQLite may create the `-wal` and `-shm` sidecars of `.codegraph/codegraph.db`; nothing
 * else is written. Building the index stays with the CodeGraph CLI (`init`, `sync`).
 */

export const REQUIRED_CODEGRAPH_PACKAGE = "@colbymchenry/codegraph";
export const REQUIRED_CODEGRAPH_VERSION: string = productVersionManifest().runtime.codeGraph.requiredVersion;

export type CodeGraphSdk = typeof import("@colbymchenry/codegraph");
export type CodeGraphIndexHandle = CodeGraph;

/**
 * The provider-internal modules and exports of the pinned bundle that freshness calls (ADR-0058
 * Decision 7). The bump-guard test pins exactly this table, so a provider bump that moves or renames
 * one fails at test time. A public git-free change API (colbymchenry/codegraph#3287) replaces it.
 */
export const CODEGRAPH_PROVIDER_INTERNAL_EXPORTS = Object.freeze({
  "extraction/index.js": Object.freeze(["scanDirectory", "hashContent"] as const),
  "file-limits.js": Object.freeze(["readBoundedSourceSync", "oversizeStamp"] as const),
  "extraction/extraction-version.js": Object.freeze(["EXTRACTION_VERSION"] as const)
});

/** The pinned provider as the read session uses it. Tests inject one to reach every branch. */
export interface CodeGraphReadProvider {
  /** Version of the platform bundle this process loaded; the same manifest `codegraph --version` prints. */
  version: string;
  /** The extraction version the loaded provider writes. */
  extractionVersion: number;
  /** `CodeGraph.openSync(root, { readOnly: true })`. */
  openReadOnly(root: string): CodeGraphIndexHandle;
  /** The provider's own source enumeration (repository-relative paths). */
  scanSourceFiles(root: string): string[];
  /**
   * The value CodeGraph's change detection compares with a file record's `contentHash`: the hash
   * of the UTF-8 text under the size limit, of the size stamp above it.
   */
  changeHash(path: string): string;
}

export interface CodeGraphBundle {
  sdk: CodeGraphSdk;
  /** `lib/dist` of the provider-selected platform bundle the SDK re-exports. */
  dist: string;
  /** Root of that platform bundle, which holds its `package.json` and its `node` executable. */
  platformRoot: string;
}

const requireFromSession = createRequire(import.meta.url);
let loadedBundle: CodeGraphBundle | undefined;
let pinnedProvider: CodeGraphReadProvider | undefined;

export class CodeGraphProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeGraphProviderUnavailableError";
  }
}

/** The SDK and the platform bundle it re-exports, resolved once and only when a read needs them. */
export function codeGraphBundle(): CodeGraphBundle {
  if (loadedBundle) return loadedBundle;
  let sdk: CodeGraphSdk;
  try { sdk = requireFromSession(REQUIRED_CODEGRAPH_PACKAGE) as CodeGraphSdk; }
  catch { throw new CodeGraphProviderUnavailableError("CodeGraph SDK could not be loaded"); }
  // The thin npm facade re-exports the platform bundle; reuse its platform/cache resolution.
  const entry = Object.values(requireFromSession.cache).find(module => module?.exports === sdk && basename(module.filename) === "index.js");
  if (!entry) throw new CodeGraphProviderUnavailableError("CodeGraph platform bundle could not be located");
  const dist = dirname(entry.filename);
  return loadedBundle = { sdk, dist, platformRoot: dirname(dirname(dist)) };
}

function providerExport<T>(dist: string, module: keyof typeof CODEGRAPH_PROVIDER_INTERNAL_EXPORTS, name: string): T {
  let loaded: Record<string, unknown>;
  try { loaded = requireFromSession(join(dist, module)) as Record<string, unknown>; }
  catch { throw new CodeGraphProviderUnavailableError(`CodeGraph provider module ${module} is missing`); }
  if (!(name in loaded)) throw new CodeGraphProviderUnavailableError(`CodeGraph provider export ${module}#${name} is missing`);
  return loaded[name] as T;
}

/** The pinned provider of this installation. Throws `CodeGraphProviderUnavailableError` when it cannot load. */
export function pinnedCodeGraphProvider(): CodeGraphReadProvider {
  if (pinnedProvider) return pinnedProvider;
  const { sdk, dist, platformRoot } = codeGraphBundle();
  let version: unknown;
  try { version = (JSON.parse(readFileSync(join(platformRoot, "package.json"), "utf8")) as { version?: unknown }).version; }
  catch { throw new CodeGraphProviderUnavailableError("CodeGraph platform manifest is unreadable"); }
  if (typeof version !== "string" || version === "") throw new CodeGraphProviderUnavailableError("CodeGraph platform manifest has no version");
  const scanDirectory = providerExport<(root: string) => string[]>(dist, "extraction/index.js", "scanDirectory");
  const hashContent = providerExport<(content: string) => string>(dist, "extraction/index.js", "hashContent");
  const readBoundedSourceSync = providerExport<(path: string) => { stats: { size: number }; bytes: Buffer | null }>(dist, "file-limits.js", "readBoundedSourceSync");
  const oversizeStamp = providerExport<(size: number) => string>(dist, "file-limits.js", "oversizeStamp");
  const extractionVersion = providerExport<number>(dist, "extraction/extraction-version.js", "EXTRACTION_VERSION");
  return pinnedProvider = {
    version,
    extractionVersion,
    openReadOnly: (root) => sdk.CodeGraph.openSync(root, { readOnly: true }),
    scanSourceFiles: (root) => scanDirectory(root),
    changeHash: (path) => {
      const read = readBoundedSourceSync(path);
      return hashContent(read.bytes === null ? oversizeStamp(read.stats.size) : read.bytes.toString("utf8"));
    }
  };
}

/**
 * `.codegraph/codegraph.lock` is the provider's cross-process writer lock, held for a whole
 * `codegraph init`, `index` or `sync` build. While it names a live process the index is mid-build,
 * so no reader reports its facts (#426).
 */
export function codeGraphIndexBuildInProgress(workspaceRoot: string): boolean {
  let raw: string;
  try {
    raw = readFileSync(join(workspaceRoot, ".codegraph", "codegraph.lock"), "utf8").trim();
  } catch {
    return false;
  }
  const pid = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(pid) || pid <= 0 || String(pid) !== raw) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The compatibility facts of an open index, read from the handle. */
export interface CodeGraphIndexCompatibilityV1 {
  /** The loaded provider bundle version. */
  version: string;
  projectPath: string;
  lastIndexed: string | null;
  builtWithVersion: string | null;
  builtWithExtractionVersion: number | null;
  currentExtractionVersion: number;
  reindexRecommended: boolean;
  state: string | null;
  pendingRefs: number;
}

/** CodeGraph's own change test against the worktree: sources it would add, re-extract or drop. */
export interface CodeGraphIndexFreshnessV1 {
  added: number;
  modified: number;
  removed: number;
}

/** The cheapest marker of a moved index: last index time and file count. */
export interface CodeGraphIndexRevisionV1 {
  lastIndexedAt: number | null;
  fileCount: number;
}

export interface CodeGraphReadSession {
  readonly root: string;
  /** The read-only handle. Valid until `close()`. */
  readonly graph: CodeGraphIndexHandle;
  version(): string;
  compatibility(): CodeGraphIndexCompatibilityV1;
  /** Computed once per session; the session reads one worktree state. */
  freshness(): CodeGraphIndexFreshnessV1;
  revision(): CodeGraphIndexRevisionV1;
  close(): void;
}

export type CodeGraphReadSessionOpenV1 =
  | { state: "open"; session: CodeGraphReadSession }
  /** No `.codegraph` directory. */
  | { state: "index-missing" }
  /** A `.codegraph` directory without `codegraph.db`. */
  | { state: "not-initialized" }
  /** A live provider build holds the writer lock. */
  | { state: "build-in-progress" }
  /** The read-only open failed, or `.codegraph` is a symbolic link. */
  | { state: "index-open-failed" };

/**
 * Opens the index of `root` read-only for one operation. The caller closes the session; prefer
 * `withCodeGraphReadSession`, which closes it in `finally`. Throws only
 * `CodeGraphProviderUnavailableError`, when the pinned provider cannot load.
 */
export function openCodeGraphReadSession(root: string, options: { provider?: CodeGraphReadProvider } = {}): CodeGraphReadSessionOpenV1 {
  const provider = options.provider ?? pinnedCodeGraphProvider();
  const indexDir = join(root, ".codegraph");
  if (!existsSync(indexDir)) return { state: "index-missing" };
  // A linked `.codegraph` could carry another worktree's index; it is not this root's index.
  if (lstatSync(indexDir).isSymbolicLink()) return { state: "index-open-failed" };
  if (!existsSync(join(indexDir, "codegraph.db"))) return { state: "not-initialized" };
  if (codeGraphIndexBuildInProgress(root)) return { state: "build-in-progress" };
  // The session owns the only reference to the handle, so close() can release it (see below).
  const handle: { graph?: CodeGraphIndexHandle } = {};
  try { handle.graph = provider.openReadOnly(root); }
  catch { return { state: "index-open-failed" }; }
  return { state: "open", session: readSession(root, handle, provider) };
}

/** Runs one read against a session that is closed when the read returns or throws. */
export function withCodeGraphReadSession<T>(root: string, read: (opened: CodeGraphReadSessionOpenV1) => T, options: { provider?: CodeGraphReadProvider } = {}): T {
  const opened = openCodeGraphReadSession(root, options);
  try { return read(opened); }
  finally { if (opened.state === "open") opened.session.close(); }
}

function readSession(root: string, handle: { graph?: CodeGraphIndexHandle }, provider: CodeGraphReadProvider): CodeGraphReadSession {
  let freshness: CodeGraphIndexFreshnessV1 | undefined;
  const open = (): CodeGraphIndexHandle => {
    if (handle.graph === undefined) throw new Error("CodeGraph read session is closed");
    return handle.graph;
  };
  return {
    root,
    get graph() { return open(); },
    version: () => provider.version,
    compatibility: () => {
      const graph = open();
      const build = graph.getIndexBuildInfo();
      const lastIndexed = graph.getLastIndexedAt();
      return {
        version: provider.version,
        projectPath: graph.getProjectRoot(),
        lastIndexed: lastIndexed === null ? null : new Date(lastIndexed).toISOString(),
        builtWithVersion: build.version,
        builtWithExtractionVersion: build.extractionVersion,
        currentExtractionVersion: provider.extractionVersion,
        reindexRecommended: graph.isIndexStale(),
        state: graph.getIndexState(),
        pendingRefs: graph.getPendingReferenceCount()
      };
    },
    freshness: () => freshness ??= indexFreshness(root, open(), provider),
    revision: () => {
      const { lastIndexedAt, fileCount } = open().getIndexRevision();
      return { lastIndexedAt, fileCount };
    },
    close: () => {
      if (handle.graph === undefined) return;
      handle.graph.close();
      handle.graph = undefined;
      // Bun keeps the SDK's cached prepared statements, and with them the database file, open until
      // GC finalizes them, which it can do only once the handle is unreachable; Windows cannot
      // delete or replace an open file.
      if (process.versions.bun !== undefined && process.platform === "win32") Bun.gc(true);
    }
  };
}

/**
 * The provider's full-scan change detection, without its `git status` candidate step: the source
 * population is the provider's own enumeration, and a file is modified when CodeGraph's change
 * hash differs from its record. An indexed file that left the enumeration or the disk is removed.
 * A file that exists but cannot be read cannot be attested, so it counts as modified, not fresh.
 */
function indexFreshness(root: string, graph: CodeGraphIndexHandle, provider: CodeGraphReadProvider): CodeGraphIndexFreshnessV1 {
  const current = new Set(provider.scanSourceFiles(root));
  const indexed = new Map(graph.getFiles().map(file => [file.path, file.contentHash] as const));
  let added = 0, modified = 0, removed = 0;
  for (const [path, contentHash] of indexed) {
    const absolute = join(root, path);
    if (!current.has(path) || !existsSync(absolute)) { removed++; continue; }
    let hash: string | undefined;
    try { hash = provider.changeHash(absolute); } catch { hash = undefined; }
    if (hash !== contentHash) modified++;
  }
  // A tracked file deleted from the worktree stays in the enumeration but is not a new source.
  for (const path of current) if (!indexed.has(path) && existsSync(join(root, path))) added++;
  return { added, modified, removed };
}
