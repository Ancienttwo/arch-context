import { isProcessAlive } from "@archcontext/local-runtime/process-liveness";
export { isProcessAlive } from "@archcontext/local-runtime/process-liveness";
import { RUNTIME_RPC_VERSION, type RuntimeRpcCompatibilityIssue, type RuntimeRpcConnection, type RuntimeRpcConnectionFile } from "./rpc-protocol";
import { RuntimeRpcClient } from "./rpc-client";
import { existsSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { runtimeStatePaths } from "@archcontext/local-runtime/runtime-state-paths";

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
    if (!isPrivateControlFile(path)) return undefined;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as RuntimeRpcConnectionFile;
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
  const path = defaultDaemonConnectionPath(root);
  try {
    if (!isPrivateControlFile(path)) return undefined;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as RuntimeRpcConnection;
    return isValidRuntimeRpcConnection(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function createRuntimeRpcClientFromConnectionFile(root = process.cwd()): RuntimeRpcClient | undefined {
  const connection = readRuntimeRpcConnection(root);
  return connection ? new RuntimeRpcClient(connection) : undefined;
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
    const fd = openSync(lockPath, "wx", 0o600);
    writeFileSync(fd, JSON.stringify({ pid: process.pid, root, startedAt: new Date().toISOString() }, null, 2), "utf8");
    return fd;
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
    if (!isPrivateControlFile(path)) return "insecure-connection-file";
    const parsed = JSON.parse(readFileSync(path, "utf8")) as RuntimeRpcConnection;
    if (!isValidRuntimeRpcConnection(parsed)) return "invalid-connection-file";
    if (!isProcessAlive(parsed.pid)) return "dead-connection-pid";
    return removeUnhealthyConnection ? "unhealthy-connection-file" : undefined;
  } catch {
    return "invalid-connection-file";
  }
}

function isPrivateControlFile(path: string): boolean {
  if (process.platform === "win32") return true;
  const mode = statSync(path).mode & 0o777;
  return (mode & 0o077) === 0;
}

function isStaleLock(lockPath: string): boolean {
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number };
    if (typeof lock.pid !== "number" || lock.pid <= 0) return true;
    return !isProcessAlive(lock.pid);
  } catch {
    return true;
  }
}
