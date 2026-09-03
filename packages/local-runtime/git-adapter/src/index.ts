import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { bindRepository, type GitTrackedTreeEntry, type RepositoryBinding } from "@archcontext/core/architecture-domain";
import { matchesGlob } from "@archcontext/core/projection-engine";
import { digestJson, type Json } from "@archcontext/contracts";

/** One `git cat-file --batch` carries every measured blob; a repository-sized tree needs the headroom. */
const GIT_CAT_FILE_MAX_BYTES = 512 * 1024 * 1024;

export function findRepositoryRoot(start: string): string {
  try {
    return resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: start,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim());
  } catch {
    let cursor = resolve(start);
    while (true) {
      if (existsSync(resolve(cursor, ".git"))) return cursor;
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    throw new Error(`Repository root not found from ${start}`);
  }
}

export function readHeadSha(root: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "unborn";
  }
}

/**
 * The committer date of `HEAD`, normalized to UTC ISO-8601.
 *
 * This is the honest deterministic clock for anything measured at a commit: a measurement of
 * `HEAD` is dated by the commit it measured, so two runs at the same `HEAD` agree byte for byte
 * while still naming a real instant. An unborn or unreadable `HEAD` has no date to report and
 * fails closed rather than substituting the wall clock.
 */
export function readHeadCommitterDate(root: string): string {
  const raw = runGit(root, ["show", "-s", "--format=%cI", "HEAD"]).trim();
  const parsed = new Date(raw);
  if (raw === "" || Number.isNaN(parsed.getTime())) {
    throw new Error(`git-head-committer-date-unreadable: ${root}`);
  }
  return parsed.toISOString();
}

export function readRepositoryBinding(start: string): RepositoryBinding {
  const root = findRepositoryRoot(start);
  return bindRepository(root, readHeadSha(root));
}

export type GitChangeSource = "commit" | "staged" | "worktree";
export type GitPathChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "typechanged" | "unmerged" | "unknown";

export interface GitPathChange {
  path: string;
  previousPath?: string;
  status: GitPathChangeStatus;
  rawStatus: string;
}

export interface GitChangeMetadata {
  schemaVersion: "archcontext.git-change-metadata/v1";
  source: GitChangeSource;
  baseSha?: string;
  headSha: string;
  paths: GitPathChange[];
  pathCount: number;
  metadataDigest: string;
}

export interface GitChangeFingerprintInput {
  schemaVersion?: "archcontext.git-change-fingerprint-input/v1";
  repositoryId: string;
  baseSha: string;
  headSha: string;
  paths: Array<string | GitPathChange>;
  codeFactsDigest: string;
  analysisKind?: string;
}

export function readCommitChangeMetadata(root: string, ref = "HEAD"): GitChangeMetadata {
  const headSha = runGit(root, ["rev-parse", ref]).trim();
  const parentLine = runGit(root, ["rev-list", "--parents", "-n", "1", ref]).trim();
  const baseSha = parentLine.split(/\s+/)[1] ?? "root";
  const paths = parseNameStatusZ(runGit(root, ["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-z", ref]));
  return gitChangeMetadata({ source: "commit", baseSha, headSha, paths });
}

export function readStagedChangeMetadata(root: string, baseRef = "HEAD"): GitChangeMetadata {
  const headSha = readHeadSha(root);
  const baseSha = gitSucceeds(root, ["rev-parse", "--verify", baseRef])
    ? runGit(root, ["rev-parse", baseRef]).trim()
    : "unborn";
  const paths = parseNameStatusZ(runGit(root, ["diff", "--cached", "--name-status", "-z", "--"]));
  return gitChangeMetadata({ source: "staged", baseSha, headSha, paths });
}

export function readWorktreeChangeMetadata(root: string): GitChangeMetadata {
  const headSha = readHeadSha(root);
  const tracked = parseNameStatusZ(runGit(root, ["diff", "--name-status", "-z", "--"]));
  const untracked = runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .map((path) => ({ path, status: "added" as const, rawStatus: "??" }));
  return gitChangeMetadata({ source: "worktree", baseSha: headSha, headSha, paths: dedupeGitPathChanges([...tracked, ...untracked]) });
}

export function computeGitChangeFingerprint(input: GitChangeFingerprintInput): string {
  const paths = input.paths
    .map((item) => typeof item === "string" ? item : item.path)
    .filter(Boolean)
    .sort();
  return digestJson({
    schemaVersion: "archcontext.git-change-fingerprint-input/v1",
    repositoryId: input.repositoryId,
    baseSha: input.baseSha,
    headSha: input.headSha,
    paths: [...new Set(paths)],
    codeFactsDigest: input.codeFactsDigest,
    analysisKind: input.analysisKind ?? "architecture-change"
  } as unknown as Json);
}

export type DetachedReviewWorktreeReason =
  | "HEAD_UNAVAILABLE"
  | "HEAD_SHA_MISMATCH"
  | "TREE_OID_MISMATCH"
  | "WORKTREE_NOT_DETACHED"
  | "WORKTREE_NOT_CLEAN";

export interface DetachedReviewWorktree {
  schemaVersion: "archcontext.detached-review-worktree/v1";
  sourceRoot: string;
  worktreeRoot: string;
  temporaryRoot: string;
  headSha: string;
  headTreeOid: string;
  detached: true;
  clean: true;
}

export interface DetachedReviewWorktreeVerification {
  schemaVersion: "archcontext.detached-review-worktree-verification/v1";
  accepted: boolean;
  reasonCode?: DetachedReviewWorktreeReason;
  expected: {
    headSha: string;
    headTreeOid?: string;
  };
  observed: {
    headSha?: string;
    headTreeOid?: string;
    detached?: boolean;
    clean?: boolean;
  };
}

export interface DetachedReviewWorktreePreparation extends DetachedReviewWorktreeVerification {
  worktree?: DetachedReviewWorktree;
}

export function readHeadTreeOid(root: string, ref = "HEAD"): string {
  return runGit(root, ["rev-parse", `${ref}^{tree}`]).trim();
}

export function readTrackedTreeEntries(root: string, ref = "HEAD"): GitTrackedTreeEntry[] {
  const output = runGit(root, ["ls-tree", "-rz", "-r", ref]);
  if (output.length === 0) return [];
  return output.split("\0")
    .filter(Boolean)
    .map(parseLsTreeEntry)
    .sort((a, b) => a.path.localeCompare(b.path));
}

export interface TrackedSourceFileV1 {
  path: string;
  lineCount: number;
}

export interface WorkspacePackageV1 {
  name: string;
  /** Repo-relative package directory. */
  root: string;
  /** The manifest `exports` map verbatim: subpath -> package-relative target. */
  exports: Record<string, string>;
}

/**
 * Git-tracked source files with their line counts, measured from the HEAD blobs.
 *
 * Both halves matter. The population is `git ls-tree`, so an untracked build output inside an
 * include glob can never enter the footprint; and the bytes are the committed blobs, so editing a
 * tracked file without committing does not move the measurement either. A snapshot therefore
 * describes a commit, not whatever happens to be on disk, which is what makes two scans at the
 * same HEAD comparable. `listScaleScanFiles` in the projection engine deliberately keeps the
 * opposite (working-tree) semantics; it is fixture-pinned and stays untouched.
 *
 * A blob Git cannot hand back makes the footprint unmeasurable, so this fails closed naming the
 * paths rather than reporting a smaller footprint than the commit actually has.
 */
export function readTrackedSourceFiles(root: string, options: { include?: string[] } = {}): TrackedSourceFileV1[] {
  const entries = readTrackedTreeEntries(root)
    .filter((entry) => entry.type === "blob")
    .filter((entry) => options.include === undefined || options.include.some((pattern) => matchesGlob(entry.path, pattern)))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  if (entries.length === 0) return [];
  const batch = execFileSync("git", ["cat-file", "--batch"], {
    cwd: root,
    input: `${entries.map((entry) => entry.objectId).join("\n")}\n`,
    maxBuffer: GIT_CAT_FILE_MAX_BYTES,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const files: TrackedSourceFileV1[] = [];
  const unreadable: string[] = [];
  let offset = 0;
  for (const entry of entries) {
    const headerEnd = batch.indexOf(0x0a, offset);
    const header = headerEnd === -1 ? "" : batch.toString("utf8", offset, headerEnd);
    const [, kind, size] = header.split(" ");
    if (kind !== "blob" || !Number.isInteger(Number(size))) {
      unreadable.push(entry.path);
      break;
    }
    const start = headerEnd + 1;
    files.push({ path: entry.path, lineCount: countLines(batch.subarray(start, start + Number(size))) });
    offset = start + Number(size) + 1;
  }
  if (unreadable.length > 0) throw new Error(`git-tracked-blob-unreadable: ${unreadable.join(", ")}`);
  return files;
}

/**
 * Workspace manifests as declared by the root `package.json`, so a consumer can resolve a bare
 * workspace specifier through the owning package's `exports` map. Workspace entries are read as
 * literal directories; a glob entry would fail loudly here rather than silently measure nothing.
 */
export function readWorkspacePackages(root: string): WorkspacePackageV1[] {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { workspaces?: string[] };
  return (manifest.workspaces ?? [])
    .map((directory) => {
      const path = join(root, ...directory.split("/"), "package.json");
      const packageManifest = JSON.parse(readFileSync(path, "utf8")) as { name: string; exports?: Record<string, string> };
      return { name: packageManifest.name, root: directory, exports: packageManifest.exports ?? {} };
    })
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

export function isDetachedHead(root: string): boolean {
  return runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() === "HEAD";
}

export function isTrackedWorktreeClean(root: string): boolean {
  return gitSucceeds(root, ["diff", "--quiet", "--ignore-submodules=none", "--"])
    && gitSucceeds(root, ["diff", "--cached", "--quiet", "--ignore-submodules=none", "--"]);
}

export function verifyDetachedReviewWorktree(input: {
  worktreeRoot: string;
  expectedHeadSha: string;
  expectedHeadTreeOid?: string;
}): DetachedReviewWorktreeVerification {
  const observed = readDetachedWorktreeObserved(input.worktreeRoot);
  const base = {
    schemaVersion: "archcontext.detached-review-worktree-verification/v1" as const,
    expected: {
      headSha: input.expectedHeadSha,
      headTreeOid: input.expectedHeadTreeOid
    },
    observed
  };

  if (!observed.headSha || !observed.headTreeOid) return { ...base, accepted: false, reasonCode: "HEAD_UNAVAILABLE" };
  if (observed.headSha !== input.expectedHeadSha) return { ...base, accepted: false, reasonCode: "HEAD_SHA_MISMATCH" };
  if (input.expectedHeadTreeOid && observed.headTreeOid !== input.expectedHeadTreeOid) {
    return { ...base, accepted: false, reasonCode: "TREE_OID_MISMATCH" };
  }
  if (observed.detached !== true) return { ...base, accepted: false, reasonCode: "WORKTREE_NOT_DETACHED" };
  if (observed.clean !== true) return { ...base, accepted: false, reasonCode: "WORKTREE_NOT_CLEAN" };
  return { ...base, accepted: true };
}

export function prepareDetachedReviewWorktree(input: {
  sourceRoot: string;
  headSha: string;
  expectedHeadTreeOid?: string;
  tempRoot?: string;
}): DetachedReviewWorktreePreparation {
  const sourceRoot = findRepositoryRoot(input.sourceRoot);
  const expectedHeadTreeOid = input.expectedHeadTreeOid ?? readCommitTreeOid(sourceRoot, input.headSha);
  if (!expectedHeadTreeOid) {
    return {
      schemaVersion: "archcontext.detached-review-worktree-verification/v1",
      accepted: false,
      reasonCode: "HEAD_UNAVAILABLE",
      expected: { headSha: input.headSha, headTreeOid: input.expectedHeadTreeOid },
      observed: {}
    };
  }

  const parent = input.tempRoot ? resolve(input.tempRoot) : tmpdir();
  mkdirSync(parent, { recursive: true });
  const temporaryRoot = mkdtempSync(join(parent, "archctx-review-worktree-"));
  const worktreeRoot = join(temporaryRoot, "worktree");
  try {
    runGit(sourceRoot, ["worktree", "add", "--detach", worktreeRoot, input.headSha]);
    const verification = verifyDetachedReviewWorktree({
      worktreeRoot,
      expectedHeadSha: input.headSha,
      expectedHeadTreeOid
    });
    if (!verification.accepted) {
      removeDetachedReviewWorktree({ sourceRoot, worktreeRoot, temporaryRoot });
      return verification;
    }
    const observedHeadSha = verification.observed.headSha;
    const observedHeadTreeOid = verification.observed.headTreeOid;
    if (!observedHeadSha || !observedHeadTreeOid) throw new Error("detached-worktree-verification-invariant");
    return {
      ...verification,
      worktree: {
        schemaVersion: "archcontext.detached-review-worktree/v1",
        sourceRoot,
        worktreeRoot,
        temporaryRoot,
        headSha: observedHeadSha,
        headTreeOid: observedHeadTreeOid,
        detached: true,
        clean: true
      }
    };
  } catch (error) {
    removePathWithRetry(temporaryRoot);
    if (isGitWorktreeError(error)) {
      return {
        schemaVersion: "archcontext.detached-review-worktree-verification/v1",
        accepted: false,
        reasonCode: "HEAD_UNAVAILABLE",
        expected: { headSha: input.headSha, headTreeOid: input.expectedHeadTreeOid },
        observed: {}
      };
    }
    throw error;
  }
}

export function removeDetachedReviewWorktree(worktree: Pick<DetachedReviewWorktree, "sourceRoot" | "worktreeRoot" | "temporaryRoot">): void {
  try {
    runGit(worktree.sourceRoot, ["worktree", "remove", "--force", worktree.worktreeRoot]);
  } catch {
    removePathWithRetry(worktree.worktreeRoot);
  } finally {
    removePathWithRetry(worktree.temporaryRoot || dirname(worktree.worktreeRoot));
  }
}

export function removePathWithRetry(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
}

/** Same counting rule as the projection engine's footprint scan: a trailing newline is a terminator, not a line. */
function countLines(content: Buffer): number {
  if (content.length === 0) return 0;
  let newlines = 0;
  for (const byte of content) if (byte === 0x0a) newlines += 1;
  return content[content.length - 1] === 0x0a ? newlines : newlines + 1;
}

function readCommitTreeOid(root: string, headSha: string): string | undefined {
  if (!gitSucceeds(root, ["cat-file", "-e", `${headSha}^{commit}`])) return undefined;
  try {
    return readHeadTreeOid(root, headSha);
  } catch {
    return undefined;
  }
}

function parseLsTreeEntry(entry: string): GitTrackedTreeEntry {
  const match = entry.match(/^(\d{6}) (blob|tree|commit) ([a-f0-9]{40,64})\t(.+)$/);
  if (!match) throw new Error(`git-ls-tree-entry-invalid: ${entry}`);
  return {
    mode: match[1],
    type: match[2] as GitTrackedTreeEntry["type"],
    objectId: match[3],
    path: match[4]
  };
}

function parseNameStatusZ(output: string): GitPathChange[] {
  const tokens = output.split("\0").filter(Boolean);
  const changes: GitPathChange[] = [];
  for (let index = 0; index < tokens.length;) {
    const rawStatus = tokens[index++] ?? "";
    if (!rawStatus) continue;
    if (rawStatus.startsWith("R") || rawStatus.startsWith("C")) {
      const previousPath = tokens[index++];
      const path = tokens[index++];
      if (!path || !previousPath) throw new Error(`git-name-status-invalid: ${rawStatus}`);
      changes.push({ path, previousPath, rawStatus, status: statusFromNameStatus(rawStatus) });
      continue;
    }
    const path = tokens[index++];
    if (!path) throw new Error(`git-name-status-invalid: ${rawStatus}`);
    changes.push({ path, rawStatus, status: statusFromNameStatus(rawStatus) });
  }
  return dedupeGitPathChanges(changes);
}

function statusFromNameStatus(status: string): GitPathChangeStatus {
  const code = status[0];
  if (code === "A") return "added";
  if (code === "M") return "modified";
  if (code === "D") return "deleted";
  if (code === "R") return "renamed";
  if (code === "C") return "copied";
  if (code === "T") return "typechanged";
  if (code === "U") return "unmerged";
  return "unknown";
}

function gitChangeMetadata(input: {
  source: GitChangeSource;
  baseSha?: string;
  headSha: string;
  paths: GitPathChange[];
}): GitChangeMetadata {
  const paths = dedupeGitPathChanges(input.paths);
  const payload = {
    schemaVersion: "archcontext.git-change-metadata/v1" as const,
    source: input.source,
    baseSha: input.baseSha,
    headSha: input.headSha,
    paths,
    pathCount: paths.length
  };
  return {
    ...payload,
    metadataDigest: digestJson(payload as unknown as Json)
  };
}

function dedupeGitPathChanges(changes: GitPathChange[]): GitPathChange[] {
  return [...new Map(changes
    .sort((left, right) =>
      left.path.localeCompare(right.path)
      || (left.previousPath ?? "").localeCompare(right.previousPath ?? "")
      || left.rawStatus.localeCompare(right.rawStatus))
    .map((change) => [`${change.rawStatus}\0${change.previousPath ?? ""}\0${change.path}`, change])).values()];
}

function readDetachedWorktreeObserved(worktreeRoot: string): DetachedReviewWorktreeVerification["observed"] {
  try {
    return {
      headSha: runGit(worktreeRoot, ["rev-parse", "HEAD"]).trim(),
      headTreeOid: readHeadTreeOid(worktreeRoot),
      detached: isDetachedHead(worktreeRoot),
      clean: isTrackedWorktreeClean(worktreeRoot)
    };
  } catch {
    return {};
  }
}

function runGit(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function gitSucceeds(root: string, args: string[]): boolean {
  const result = spawnSync("git", args, {
    cwd: root,
    stdio: ["ignore", "ignore", "ignore"]
  });
  return result.status === 0;
}

function isGitWorktreeError(error: unknown): boolean {
  return error instanceof Error && /git|Command failed/.test(error.message);
}
