import { createPrivateControlFile, readPrivateControlFile } from "@archcontext/local-runtime/control-file-security";
import { isProcessAlive } from "@archcontext/local-runtime/process-liveness";
export { isProcessAlive } from "@archcontext/local-runtime/process-liveness";
import { RUNTIME_RPC_VERSION, type RuntimeRpcCompatibilityIssue, type RuntimeRpcConnection, type RuntimeRpcConnectionFile } from "./rpc-protocol";
import { RuntimeRpcClient } from "./rpc-client";
import { daemonReadiness, type DaemonReadiness } from "./daemon-readiness";
import { existsSync, openSync, rmSync } from "node:fs";
import { daemonControlPaths, defaultArchContextStateRoot, listWorkspaceStateDirs, runtimeStatePaths } from "@archcontext/local-runtime/runtime-state-paths";

export type DaemonControlRecoveryReason =
  | "insecure-connection-file"
  | "invalid-connection-file"
  | "dead-connection-pid"
  | "unhealthy-connection-file"
  | "stale-lock-file";

export interface DaemonControlRecovery {
  connectionPath: string;
  lockPath: string;
  removed: DaemonControlRecoveryReason[];
}

export function defaultDaemonControlDir(root = process.cwd()): string {
  return runtimeStatePaths(root).workspaceStateDir;
}

export function defaultDeveloperReviewRunStateDir(root = process.cwd()): string {
  return runtimeStatePaths(root).developerReviewRunStateDir;
}

export function defaultDaemonConnectionPath(root = process.cwd()): string {
  return runtimeStatePaths(root).daemonConnectionPath;
}

export function defaultDaemonLockPath(root = process.cwd()): string {
  return runtimeStatePaths(root).daemonLockPath;
}

export function readRuntimeRpcConnectionFile(root = process.cwd()): RuntimeRpcConnectionFile | undefined {
  const path = defaultDaemonConnectionPath(root);
  try {
    const body = readPrivateControlFile(path);
    if (body === undefined) return undefined;
    const parsed = JSON.parse(body) as RuntimeRpcConnectionFile;
    if (!parsed || typeof parsed !== "object") return undefined;
    return {
      ...parsed,
      connectionPath: typeof parsed.connectionPath === "string" ? parsed.connectionPath : path,
      lockPath: typeof parsed.lockPath === "string" ? parsed.lockPath : defaultDaemonLockPath(root)
    };
  } catch {
    return undefined;
  }
}

export function runtimeRpcCompatibilityIssue(root = process.cwd()): RuntimeRpcCompatibilityIssue | undefined {
  const connection = readRuntimeRpcConnectionFile(root);
  if (!connection) return undefined;
  const received = typeof connection.schemaVersion === "string" ? connection.schemaVersion : "unknown";
  if (received === RUNTIME_RPC_VERSION) return undefined;
  const pid = typeof connection.pid === "number" ? connection.pid : undefined;
  return {
    reason: "rpc-version-mismatch",
    expected: RUNTIME_RPC_VERSION,
    received,
    connectionPath: connection.connectionPath ?? defaultDaemonConnectionPath(root),
    lockPath: connection.lockPath ?? defaultDaemonLockPath(root),
    pid,
    pidAlive: pid !== undefined ? isProcessAlive(pid) : false,
    upgradeCommand: "archctx daemon upgrade"
  };
}

export function readRuntimeRpcConnection(root = process.cwd()): RuntimeRpcConnection | undefined {
  return readRuntimeRpcConnectionAt(defaultDaemonConnectionPath(root));
}

function readRuntimeRpcConnectionAt(path: string): RuntimeRpcConnection | undefined {
  try {
    const body = readPrivateControlFile(path);
    if (body === undefined) return undefined;
    const parsed = JSON.parse(body) as RuntimeRpcConnection;
    return isValidRuntimeRpcConnection(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function createRuntimeRpcClientFromConnectionFile(root = process.cwd()): RuntimeRpcClient | undefined {
  const connection = readRuntimeRpcConnection(root);
  return connection ? new RuntimeRpcClient(connection) : undefined;
}

/**
 * A client for the daemon whose control files live in `workspaceStateDir`, found without the
 * worktree: after the worktree is deleted, its state directory is the only way to reach it (#322).
 */
export function createRuntimeRpcClientFromWorkspaceStateDir(workspaceStateDir: string): RuntimeRpcClient | undefined {
  const connection = readRuntimeRpcConnectionAt(daemonControlPaths(workspaceStateDir).daemonConnectionPath);
  return connection ? new RuntimeRpcClient(connection) : undefined;
}

export interface DaemonControlListing {
  storageRepositoryId: string;
  storageWorkspaceId: string;
  stateDir: string;
  connectionPath: string;
  /** `invalid` covers an unreadable, insecure or malformed connection file. */
  connection: "valid" | "invalid" | "missing";
  root?: string;
  rootExists?: boolean;
  readiness?: DaemonReadiness;
  pid?: number;
  pidAlive?: boolean;
  startedAt?: string;
  lockOwnerPid?: number;
}

/**
 * Every workspace state directory under `stateRoot` that holds a daemon connection or lock file,
 * read from the control files alone, so daemons whose worktree was deleted are listed too (#322).
 */
export function listDaemonControlStates(stateRoot = defaultArchContextStateRoot().path): DaemonControlListing[] {
  return listWorkspaceStateDirs(stateRoot).flatMap(({ storageRepositoryId, storageWorkspaceId, workspaceStateDir }) => {
    const { daemonConnectionPath, daemonLockPath } = daemonControlPaths(workspaceStateDir);
    const listed = listedConnectionAt(daemonConnectionPath);
    const lockOwnerPid = liveLockOwnerPidAt(daemonLockPath);
    if (listed.state === "missing" && !existsSync(daemonLockPath)) return [];
    const connection = listed.state === "valid" ? listed.connection : undefined;
    return [{
      storageRepositoryId,
      storageWorkspaceId,
      stateDir: workspaceStateDir,
      connectionPath: daemonConnectionPath,
      connection: listed.state,
      ...(connection ? {
        root: connection.root,
        rootExists: existsSync(connection.root),
        readiness: daemonReadiness(connection.root),
        pid: connection.pid,
        pidAlive: isProcessAlive(connection.pid),
        startedAt: connection.startedAt
      } : {}),
      ...(lockOwnerPid === undefined ? {} : { lockOwnerPid })
    } satisfies DaemonControlListing];
  });
}

export function recoverStaleDaemonControlFiles(
  root = process.cwd(),
  options: { removeUnhealthyConnection?: boolean } = {}
): DaemonControlRecovery {
  const connectionPath = defaultDaemonConnectionPath(root);
  const lockPath = defaultDaemonLockPath(root);
  const removed: DaemonControlRecoveryReason[] = [];
  const connectionReason = staleConnectionFileReason(connectionPath, options.removeUnhealthyConnection ?? false);
  if (connectionReason) {
    rmSync(connectionPath, { force: true });
    removed.push(connectionReason);
  }
  if (existsSync(lockPath) && isStaleLock(lockPath)) {
    rmSync(lockPath, { force: true });
    removed.push("stale-lock-file");
  }
  return { connectionPath, lockPath, removed };
}

export function acquireDaemonLock(lockPath: string, root: string): number {
  try {
    createPrivateControlFile(lockPath, JSON.stringify({ pid: process.pid, root, startedAt: new Date().toISOString() }, null, 2));
    try { return openSync(lockPath, "r"); } catch (error) { rmSync(lockPath, { force: true }); throw error; }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
    if (isStaleLock(lockPath)) {
      rmSync(lockPath, { force: true });
      return acquireDaemonLock(lockPath, root);
    }
    throw new Error(`archctxd already running for ${root}; lock=${lockPath}`);
  }
}

/**
 * The live pid the daemon lock names, if any. With no connection file, such a process still owns
 * the store and the lock, so every new daemon start loses to it (#318).
 */
export function liveDaemonLockOwnerPid(root = process.cwd()): number | undefined {
  return liveLockOwnerPidAt(defaultDaemonLockPath(root));
}

/**
 * A daemon removes its connection file when it exits and creates it when it starts, and on
 * Windows one read takes a native process launch, so a read can fail because the file is being
 * removed or written. A failed read is judged by a second look: a file that is gone by then is
 * `missing`, a file that now reads is `valid`, and a file that fails twice is `invalid`.
 */
function listedConnectionAt(path: string): { state: "valid"; connection: RuntimeRpcConnection } | { state: "invalid" | "missing" } {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!existsSync(path)) return { state: "missing" };
    const connection = readRuntimeRpcConnectionAt(path);
    if (connection) return { state: "valid", connection };
  }
  return { state: "invalid" };
}

function liveLockOwnerPidAt(lockPath: string): number | undefined {
  try {
    const body = readPrivateControlFile(lockPath);
    if (body === undefined) return undefined;
    const pid = (JSON.parse(body) as { pid?: unknown }).pid;
    return typeof pid === "number" && pid > 0 && isProcessAlive(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isValidRuntimeRpcConnection(value: RuntimeRpcConnection): value is RuntimeRpcConnection {
  return value.schemaVersion === RUNTIME_RPC_VERSION
    && value.protocol === "http-loopback"
    && value.version === 1
    && typeof value.url === "string"
    && value.url.startsWith("http://127.0.0.1:")
    && typeof value.token === "string"
    && value.token.length > 0
    && typeof value.pid === "number"
    && typeof value.connectionPath === "string"
    && typeof value.lockPath === "string";
}

function staleConnectionFileReason(path: string, removeUnhealthyConnection: boolean): DaemonControlRecoveryReason | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const body = readPrivateControlFile(path);
    if (body === undefined) return "insecure-connection-file";
    const parsed = JSON.parse(body) as RuntimeRpcConnection;
    if (!isValidRuntimeRpcConnection(parsed)) return "invalid-connection-file";
    if (!isProcessAlive(parsed.pid)) return "dead-connection-pid";
    return removeUnhealthyConnection ? "unhealthy-connection-file" : undefined;
  } catch {
    return "invalid-connection-file";
  }
}

function isStaleLock(lockPath: string): boolean {
  const body = readPrivateControlFile(lockPath);
  if (body === undefined) throw new Error("Refusing unverified daemon lock permissions");
  try {
    const lock = JSON.parse(body) as { pid?: number };
    if (typeof lock.pid !== "number" || lock.pid <= 0) return true;
    return !isProcessAlive(lock.pid);
  } catch {
    return true;
  }
}
