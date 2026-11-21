import { productVersionManifest } from "@archcontext/contracts";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import type { CodeGraph } from "@colbymchenry/codegraph";

/**
 * ADR-0058: every CodeGraph read goes through one in-process, read-only handle. A read starts no
 * CodeGraph command, runs no `git status` or `git diff`, and never opens the index writable.
 * SQLite may create the `-wal` and `-shm` sidecars beside the opened database. Building the index
 * stays with the CodeGraph CLI (`init`, `sync`).
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
 * The identity (`dev:ino:ctimeNs`) of the database the pinned SDK opens for `root` in this process,
 * resolved by the SDK itself. `undefined` when there is no such file, the SDK cannot load, or the SDK
 * resolves another directory than `<root>/.codegraph` (a `CODEGRAPH_DIR` override, or the WSL
 * `.codegraph-wsl` choice): archctx's lock and link checks cover only `.codegraph`, so that layout
 * cannot be verified. `ctimeNs` changes on every write, link or re-create of the file.
 */
export function codeGraphIndexIdentity(root: string): string | undefined {
  try {
    const { sdk } = codeGraphBundle();
    const database = sdk.getDatabasePath(root);
    if (dirname(database) !== join(root, ".codegraph") || sdk.getCodeGraphDir(root) !== join(root, ".codegraph")) return undefined;
    const stat = lstatSync(database, { bigint: true });
    return stat.isFile() ? `${stat.dev}:${stat.ino}:${stat.ctimeNs}` : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `.codegraph/codegraph.lock` is the provider's cross-process writer lock, held for a whole
 * `codegraph init`, `index` or `sync` build. While it names a live process the index is mid-build,
 * so no reader reports its facts (#426).
 */
export function codeGraphIndexBuildInProgress(workspaceRoot: string): boolean {
  return pidLockLive(join(workspaceRoot, ".codegraph", "codegraph.lock"));
}

/**
 * True while the pid file at `path` names a live process. A missing, unreadable or malformed file,
 * or a dead holder, is not a live lock.
 */
export function pidLockLive(path: string): boolean {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8").trim();
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
  /** Cached per session. Pass refresh when certifying the worktree again after a shared read. */
  freshness(refresh?: boolean): CodeGraphIndexFreshnessV1;
  revision(): CodeGraphIndexRevisionV1;
  /**
   * Design G4: true when no provider build holds the writer lock now and the index revision equals
   * the one taken at open. Reads that span a sync are only usable when this holds after them.
   */
  unchangedSinceOpen(): boolean;
  close(): void;
}

export type CodeGraphReadSessionOpenV1 =
  | { state: "open"; session: CodeGraphReadSession }
  /** No `.codegraph` directory, or one without `codegraph.db`. */
  | { state: "index-missing" }
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
  let linked: boolean;
  try { linked = lstatSync(indexDir).isSymbolicLink(); }
  catch (error) { return { state: absenceOrUnreadable(error) }; }
  // A linked `.codegraph`, dangling or not, could carry another worktree's index; it is not this root's.
  if (linked) return { state: "index-open-failed" };
  try { statSync(join(indexDir, "codegraph.db")); }
  catch (error) { return { state: absenceOrUnreadable(error) }; }
  if (codeGraphIndexBuildInProgress(root)) return { state: "build-in-progress" };
  const handle: { graph?: CodeGraphIndexHandle } = {};
  let atOpen: CodeGraphIndexRevisionV1;
  try {
    handle.graph = provider.openReadOnly(root);
    atOpen = revisionOf(handle.graph);
  } catch {
    handle.graph?.close();
    return { state: "index-open-failed" };
  }
  return { state: "open", session: readSession(root, handle, provider, atOpen) };
}

/** Only absence proves there is no index; any other failure (permission, I/O) is an unreadable one. */
function absenceOrUnreadable(error: unknown): "index-missing" | "index-open-failed" {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR" ? "index-missing" : "index-open-failed";
}

function revisionOf(graph: CodeGraphIndexHandle): CodeGraphIndexRevisionV1 {
  const { lastIndexedAt, fileCount } = graph.getIndexRevision();
  return { lastIndexedAt, fileCount };
}

/** Runs one read against a session that is closed when the read returns or throws. */
export function withCodeGraphReadSession<T>(root: string, read: (opened: CodeGraphReadSessionOpenV1) => T, options: { provider?: CodeGraphReadProvider } = {}): T {
  const opened = openCodeGraphReadSession(root, options);
  try { return read(opened); }
  finally { if (opened.state === "open") opened.session.close(); }
}

/** The staged graph still attests to the original worktree and its original index identity. */
export function isolatedCodeGraphReadSession(root: string, graph: CodeGraphIndexHandle, provider: CodeGraphReadProvider, indexIsCurrent: () => boolean): CodeGraphReadSession {
  return readSession(root, { graph }, provider, revisionOf(graph), indexIsCurrent);
}

function readSession(root: string, handle: { graph?: CodeGraphIndexHandle }, provider: CodeGraphReadProvider, atOpen: CodeGraphIndexRevisionV1, indexIsCurrent?: () => boolean): CodeGraphReadSession {
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
        projectPath: indexIsCurrent ? root : graph.getProjectRoot(),
        lastIndexed: lastIndexed === null ? null : new Date(lastIndexed).toISOString(),
        builtWithVersion: build.version,
        builtWithExtractionVersion: build.extractionVersion,
        currentExtractionVersion: provider.extractionVersion,
        reindexRecommended: graph.isIndexStale(),
        state: graph.getIndexState(),
        pendingRefs: graph.getPendingReferenceCount()
      };
    },
    freshness: (refresh = false) => {
      if (refresh || freshness === undefined) freshness = measureCodeGraphIndexFreshness(root, open(), provider);
      return freshness;
    },
    revision: () => revisionOf(open()),
    unchangedSinceOpen: () => {
      if (codeGraphIndexBuildInProgress(root) || (indexIsCurrent && !indexIsCurrent())) return false;
      const now = revisionOf(open());
      return now.lastIndexedAt === atOpen.lastIndexedAt && now.fileCount === atOpen.fileCount;
    },
    close: () => {
      if (handle.graph === undefined) return;
      handle.graph.close();
      handle.graph = undefined;
    }
  };
}

/**
 * The provider's full-scan change detection, without its `git status` candidate step: the source
 * population is the provider's own enumeration, and a file is modified when CodeGraph's change
 * hash differs from its record. An indexed file that left the enumeration or the disk is removed.
 * A file that exists but cannot be read cannot be attested, so it counts as modified, not fresh.
 */
export function measureCodeGraphIndexFreshness(root: string, graph: CodeGraphIndexHandle, provider: CodeGraphReadProvider): CodeGraphIndexFreshnessV1 {
  return codeGraphChangeCounts(graph.getFiles(), provider.scanSourceFiles(root), {
    exists: (path) => existsSync(join(root, path)),
    changeHash: (path) => provider.changeHash(join(root, path))
  });
}

/**
 * The counting rule of `measureCodeGraphIndexFreshness`. The staged-index check of the base-index seed runs this
 * function's own source in a child process (index-base.ts), so it reads nothing but its arguments.
 */
export function codeGraphChangeCounts(
  indexedFiles: ReadonlyArray<{ path: string; contentHash: string }>,
  currentPaths: readonly string[],
  source: { exists(path: string): boolean; changeHash(path: string): string }
): CodeGraphIndexFreshnessV1 {
  const current = new Set(currentPaths);
  const indexed = new Map(indexedFiles.map((file) => [file.path, file.contentHash] as const));
  let added = 0, modified = 0, removed = 0;
  for (const [path, contentHash] of indexed) {
    if (!current.has(path) || !source.exists(path)) { removed++; continue; }
    let hash: string | undefined;
    try { hash = source.changeHash(path); } catch { hash = undefined; }
    if (hash !== contentHash) modified++;
  }
  // A tracked file deleted from the worktree stays in the enumeration but is not a new source.
  for (const path of current) if (!indexed.has(path) && source.exists(path)) added++;
  return { added, modified, removed };
}
