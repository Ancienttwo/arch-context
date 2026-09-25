import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const ARCHCONTEXT_STATE_DIR_ENV = "ARCHCONTEXT_STATE_DIR";

export const ARCHCONTEXT_LOCAL_STORE_PATH_ENV = "ARCHCONTEXT_LOCAL_STORE_PATH";

export interface RuntimeStatePaths {
  schemaVersion: "archcontext.runtime-state-paths/v1";
  stateRoot: string;
  source: "os-user-data" | "environment";
  repositoryRoot: string;
  repositoryAnchor: string;
  workspaceAnchor: string;
  storageRepositoryId: string;
  storageWorkspaceId: string;
  /** @deprecated Use storageRepositoryId for runtime-state storage partition identity. */
  repositoryId: string;
  /** @deprecated Use storageWorkspaceId for runtime-state storage partition identity. */
  workspaceId: string;
  repositoryStateDir: string;
  workspaceStateDir: string;
  sharedCacheDir: string;
  localStorePath: string;
  daemonConnectionPath: string;
  daemonLockPath: string;
  daemonLogPath: string;
  developerReviewRunStateDir: string;
  legacyControlDir: string;
  legacyLocalStorePath: string;
}

export function defaultArchContextStateRoot(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir()
): { path: string; source: "os-user-data" | "environment" } {
  const override = env[ARCHCONTEXT_STATE_DIR_ENV];
  if (override) return { path: resolve(override), source: "environment" };
  if (platform === "darwin") return { path: join(home, "Library", "Application Support", "ArchContext"), source: "os-user-data" };
  if (platform === "win32") return { path: join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "ArchContext"), source: "os-user-data" };
  return { path: join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "archcontext"), source: "os-user-data" };
}

export function runtimeStatePaths(root = process.cwd(), env: Record<string, string | undefined> = process.env): RuntimeStatePaths {
  const repositoryRoot = readGitPath(root, ["rev-parse", "--show-toplevel"]) ?? root;
  const canonicalRepositoryRoot = canonicalPath(repositoryRoot);
  const gitCommonDir = readGitPath(canonicalRepositoryRoot, ["rev-parse", "--git-common-dir"]);
  const repositoryAnchor = canonicalPath(gitCommonDir ? resolveMaybeRelative(canonicalRepositoryRoot, gitCommonDir) : canonicalRepositoryRoot);
  const workspaceAnchor = canonicalRepositoryRoot;
  const storageRepositoryId = stableStorageId("repo", repositoryAnchor);
  const storageWorkspaceId = stableStorageId("ws", workspaceAnchor);
  const stateRoot = defaultArchContextStateRoot(env);
  const repositoryStateDir = join(stateRoot.path, "repositories", storageRepositoryId);
  const workspaceStateDir = join(repositoryStateDir, "worktrees", storageWorkspaceId);
  const legacyControlDir = resolve(canonicalRepositoryRoot, ".archcontext", ".local");
  return {
    schemaVersion: "archcontext.runtime-state-paths/v1",
    stateRoot: stateRoot.path,
    source: stateRoot.source,
    repositoryRoot: canonicalRepositoryRoot,
    repositoryAnchor,
    workspaceAnchor,
    storageRepositoryId,
    storageWorkspaceId,
    repositoryId: storageRepositoryId,
    workspaceId: storageWorkspaceId,
    repositoryStateDir,
    workspaceStateDir,
    sharedCacheDir: join(repositoryStateDir, "shared", "cache"),
    localStorePath: env[ARCHCONTEXT_LOCAL_STORE_PATH_ENV] ?? join(workspaceStateDir, "runtime.sqlite"),
    daemonConnectionPath: join(workspaceStateDir, "archctxd.json"),
    daemonLockPath: join(workspaceStateDir, "archctxd.lock"),
    daemonLogPath: join(workspaceStateDir, "archctxd.log"),
    developerReviewRunStateDir: join(workspaceStateDir, "developer-review-runs"),
    legacyControlDir,
    legacyLocalStorePath: join(legacyControlDir, "runtime.sqlite")
  };
}

function readGitPath(root: string, args: string[]): string | undefined {
  try {
    const value = execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function resolveMaybeRelative(base: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(base, path);
}

function canonicalPath(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function stableStorageId(prefix: "repo" | "ws", value: string): string {
  return `${prefix}.${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}
