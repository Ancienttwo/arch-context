import { isRepoRelativePosixPath } from "@archcontext/contracts";
import { decodeUtf8, readOnlyGit } from "./blob-reader";

export type GitCoChangeCoverageStatus = "complete" | "shallow" | "insufficient-history" | "unavailable";

export interface GitCoChangeCommitV1 {
  commitSha: string;
  paths: string[];
}

export interface GitCoChangeHistoryV1 {
  coverageStatus: GitCoChangeCoverageStatus;
  windowLimit: number;
  minHistoryCommits: number;
  maxFilesPerCommit: number;
  observedCommitCount: number;
  skippedBulkCommitCount: number;
  commits: GitCoChangeCommitV1[];
}

export interface ReadGitCoChangeOptions {
  windowLimit?: number;
  maxFilesPerCommit?: number;
  minHistoryCommits?: number;
}

const DEFAULT_WINDOW_LIMIT = 200;
const DEFAULT_MAX_FILES_PER_COMMIT = 20;
const DEFAULT_MIN_HISTORY_COMMITS = 5;
const COMMIT_PREFIX = "COMMIT:";
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/;

function isShallowRepository(root: string): boolean | undefined {
  try {
    const out = decodeUtf8(readOnlyGit(root, "rev-parse", ["--is-shallow-repository"])).trim();
    if (out === "true") return true;
    if (out === "false") return false;
    return undefined;
  } catch {
    return undefined;
  }
}

export function parseCoChangeLogBuffer(buffer: Buffer, maxFilesPerCommit: number): {
  observedCommitCount: number;
  skippedBulkCommitCount: number;
  commits: GitCoChangeCommitV1[];
} {
  const tokens = decodeUtf8(buffer).split("\0");
  const commits: GitCoChangeCommitV1[] = [];
  let currentSha: string | undefined;
  let currentPaths = new Set<string>();
  let observedCommitCount = 0;
  let skippedBulkCommitCount = 0;

  const flush = (): void => {
    if (!currentSha) return;
    observedCommitCount += 1;
    const paths = [...currentPaths].sort();
    if (paths.length > maxFilesPerCommit) {
      skippedBulkCommitCount += 1;
    } else if (paths.length > 0) {
      commits.push({ commitSha: currentSha, paths });
    }
    currentSha = undefined;
    currentPaths = new Set<string>();
  };

  for (const rawToken of tokens) {
    const token = rawToken.replace(/^\n+/, "");
    if (token === "") continue;
    if (token.startsWith(COMMIT_PREFIX)) {
      const sha = token.slice(COMMIT_PREFIX.length).trim();
      if (COMMIT_SHA_PATTERN.test(sha)) {
        flush();
        currentSha = sha;
        continue;
      }
    }
    if (!currentSha) continue;
    const normalized = token.replaceAll("\\", "/");
    if (isRepoRelativePosixPath(normalized)) {
      currentPaths.add(normalized);
    }
  }
  flush();

  return { observedCommitCount, skippedBulkCommitCount, commits };
}

/**
 * Bounded, read-only Git co-change history reader (#637 P2 Invariant #2).
 * Never fetches remotely; refuses shallow clones with `coverageStatus: "shallow"`.
 */
export function readGitCoChangeHistory(root: string, options: ReadGitCoChangeOptions = {}): GitCoChangeHistoryV1 {
  const windowLimit = Math.max(1, Math.trunc(options.windowLimit ?? DEFAULT_WINDOW_LIMIT));
  const maxFilesPerCommit = Math.max(2, Math.trunc(options.maxFilesPerCommit ?? DEFAULT_MAX_FILES_PER_COMMIT));
  const minHistoryCommits = Math.max(1, Math.trunc(options.minHistoryCommits ?? DEFAULT_MIN_HISTORY_COMMITS));

  const shallow = isShallowRepository(root);
  if (shallow === undefined) {
    return {
      coverageStatus: "unavailable",
      windowLimit,
      minHistoryCommits,
      maxFilesPerCommit,
      observedCommitCount: 0,
      skippedBulkCommitCount: 0,
      commits: []
    };
  }
  if (shallow) {
    return {
      coverageStatus: "shallow",
      windowLimit,
      minHistoryCommits,
      maxFilesPerCommit,
      observedCommitCount: 0,
      skippedBulkCommitCount: 0,
      commits: []
    };
  }

  let logBytes: Buffer;
  try {
    logBytes = readOnlyGit(
      root,
      "log",
      ["--no-merges", "-n", String(windowLimit), "-z", "--name-only", "--format=COMMIT:%H", "HEAD"],
      { maxBytes: 64 * 1024 * 1024 }
    );
  } catch {
    return {
      coverageStatus: "unavailable",
      windowLimit,
      minHistoryCommits,
      maxFilesPerCommit,
      observedCommitCount: 0,
      skippedBulkCommitCount: 0,
      commits: []
    };
  }

  const parsed = parseCoChangeLogBuffer(logBytes, maxFilesPerCommit);
  const coverageStatus: GitCoChangeCoverageStatus =
    parsed.observedCommitCount < minHistoryCommits ? "insufficient-history" : "complete";

  return {
    coverageStatus,
    windowLimit,
    minHistoryCommits,
    maxFilesPerCommit,
    observedCommitCount: parsed.observedCommitCount,
    skippedBulkCommitCount: parsed.skippedBulkCommitCount,
    commits: parsed.commits
  };
}
