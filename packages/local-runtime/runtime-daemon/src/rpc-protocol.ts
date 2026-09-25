import type { RuntimeDaemonMethods } from "./rpc-methods";
import { LOCAL_RUNTIME_RPC_SCHEMA_VERSION } from "@archcontext/contracts";

export const RUNTIME_RPC_VERSION = LOCAL_RUNTIME_RPC_SCHEMA_VERSION;

export interface RuntimeRpcConnection {
  schemaVersion: typeof RUNTIME_RPC_VERSION;
  protocol: "http-loopback";
  version: 1;
  root: string;
  url: string;
  token: string;
  pid: number;
  lockPath: string;
  connectionPath: string;
  startedAt: string;
}

export interface RuntimeRpcConnectionFile {
  schemaVersion?: string;
  protocol?: string;
  version?: number;
  root?: string;
  url?: string;
  token?: string;
  pid?: number;
  lockPath?: string;
  connectionPath?: string;
  startedAt?: string;
}

export interface RuntimeRpcCompatibilityIssue {
  reason: "rpc-version-mismatch" | "product-version-mismatch" | "stale-daemon-entry";
  expected: string;
  received: string;
  connectionPath: string;
  lockPath: string;
  pid?: number;
  pidAlive: boolean;
  upgradeCommand: "archctx daemon upgrade";
}

export interface RuntimeDaemonClient extends RuntimeDaemonMethods {}
