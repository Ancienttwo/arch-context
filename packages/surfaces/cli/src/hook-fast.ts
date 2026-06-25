#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const RUNTIME_RPC_VERSION = "archcontext.runtime-rpc/v1";
const HOOK_LOG_SCHEMA_VERSION = "archcontext.hook-log/v1";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface FastHookResult {
  handled: boolean;
  envelope?: unknown;
}

if (import.meta.main) {
  const result = await runFastHookEnqueue(process.argv.slice(2), process.cwd());
  if (!result.handled) process.exit(2);
  process.stdout.write(`${JSON.stringify(result.envelope, null, 2)}\n`);
}

export async function runFastHookEnqueue(args: string[], cwd = process.cwd()): Promise<FastHookResult> {
  if (args[0] !== "hook" || (args[1] ?? "enqueue") !== "enqueue") return { handled: false };
  const hookArgs = args.slice(args[0] === "hook" ? 2 : 0);
  const started = Date.now();
  const event = readFlag(hookArgs, "--event") ?? "post-edit";
  const changedPaths = [...readRepeatedFlag(hookArgs, "--path"), ...readRepeatedFlag(hookArgs, "--changed")];
  const source = readFlag(hookArgs, "--source") ?? defaultHookGitChangeSource(event);
  if (!["worktree", "staged", "commit"].includes(source)) {
    return { handled: true, envelope: errorEnvelope("hook.enqueue", "AC_SCHEMA_INVALID", "hook enqueue --source must be worktree, staged, or commit") };
  }
  const maxAttempts = optionalInteger(hookArgs, "--max-attempts", true);
  if (maxAttempts.error) return { handled: true, envelope: maxAttempts.error };
  const maxQueuedJobs = optionalInteger(hookArgs, "--max-queued-jobs", true);
  if (maxQueuedJobs.error) return { handled: true, envelope: maxQueuedJobs.error };
  const priority = optionalInteger(hookArgs, "--priority", false);
  if (priority.error) return { handled: true, envelope: priority.error };
  if (shouldSkipGeneratedProjectionHook(hookArgs, changedPaths)) {
    return {
      handled: true,
      envelope: okEnvelope("hook.enqueue", {
        schemaVersion: "archcontext.hook-enqueue-skipped/v1",
        accepted: false,
        enqueued: false,
        skipped: true,
        failOpen: false,
        reasonCode: "archcontext-generated-projection",
        event,
        source,
        pathCount: changedPaths.length,
        egress: "none",
        network: "forbidden",
        hookLog: hookLogRecord({ event, changedPaths, reasonCode: "archcontext-generated-projection", elapsedMs: Date.now() - started, failOpen: false })
      })
    };
  }

  const input = stripUndefined({
    source,
    event,
    analysisKind: readFlag(hookArgs, "--analysis-kind") ?? "architecture-delta",
    ref: readFlag(hookArgs, "--ref"),
    baseRef: readFlag(hookArgs, "--base-ref"),
    coalesceKey: readFlag(hookArgs, "--coalesce-key"),
    debounceUntil: readFlag(hookArgs, "--debounce-until"),
    maxAttempts: maxAttempts.value,
    maxQueuedJobs: maxQueuedJobs.value,
    priority: priority.value,
    runnerPort: readFlag(hookArgs, "--runner-port"),
    codeFactsDigest: readFlag(hookArgs, "--code-facts-digest"),
    generatedProjection: hookArgs.includes("--generated-projection"),
    skipGeneratedProjection: !hookArgs.includes("--no-generated-projection-guard")
  });

  try {
    const root = findRepositoryRoot(cwd);
    const connection = readRuntimeRpcConnection(root);
    if (!connection) throw new Error("No archctxd connection file found");
    const envelope = await callRuntimeRpc(connection, "jobsEnqueueGitHook", [root, input]);
    if (!isObject(envelope) || envelope.ok !== true || !isObject(envelope.data)) return { handled: true, envelope };
    return {
      handled: true,
      envelope: {
        ...envelope,
        requestId: "hook.enqueue",
        data: {
          ...envelope.data,
          hookLog: hookLogRecord({
            event,
            changedPaths,
            reasonCode: hookEnqueueReasonCode(envelope.data as Record<string, Json>),
            elapsedMs: Date.now() - started,
            failOpen: false
          })
        }
      }
    };
  } catch (error) {
    return {
      handled: true,
      envelope: okEnvelope("hook.enqueue", {
        schemaVersion: "archcontext.hook-enqueue-fail-open/v1",
        accepted: false,
        enqueued: false,
        failOpen: true,
        reasonCode: "runtime-unavailable",
        event,
        source,
        pathCount: changedPaths.length,
        egress: "none",
        network: "forbidden",
        hookLog: hookLogRecord({ event, changedPaths, reasonCode: "runtime-unavailable", elapsedMs: Date.now() - started, failOpen: true }),
        message: error instanceof Error ? error.message : String(error)
      })
    };
  }
}

function okEnvelope(requestId: string, data: Json) {
  return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId, data };
}

function errorEnvelope(requestId: string, code: string, message: string) {
  return { schemaVersion: "archcontext.envelope/v1", ok: false, requestId, error: { code, message } };
}

async function callRuntimeRpc(connection: Record<string, unknown>, method: string, params: unknown[]) {
  const response = await fetch(`${connection.url as string}rpc`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${connection.token as string}`,
      "Content-Type": "application/json",
      "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION
    },
    body: JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method, params })
  });
  return await response.json();
}

function readRuntimeRpcConnection(root: string) {
  const path = runtimeStatePaths(root).daemonConnectionPath;
  if (!isPrivateControlFile(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!isObject(parsed)) return undefined;
    if (parsed.schemaVersion !== RUNTIME_RPC_VERSION) return undefined;
    if (parsed.protocol !== "http-loopback" || parsed.version !== 1) return undefined;
    if (typeof parsed.url !== "string" || !parsed.url.startsWith("http://127.0.0.1:")) return undefined;
    if (typeof parsed.token !== "string" || parsed.token.length === 0) return undefined;
    if (typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function runtimeStatePaths(root: string) {
  const repositoryRoot = findRepositoryRoot(root);
  const canonicalRepositoryRoot = canonicalPath(repositoryRoot);
  const gitCommonDir = readGitPath(canonicalRepositoryRoot, ["rev-parse", "--git-common-dir"]);
  const repositoryAnchor = canonicalPath(gitCommonDir ? resolveMaybeRelative(canonicalRepositoryRoot, gitCommonDir) : canonicalRepositoryRoot);
  const workspaceAnchor = canonicalRepositoryRoot;
  const stateRoot = defaultArchContextStateRoot();
  const repositoryStateDir = join(stateRoot, "repositories", stableStorageId("repo", repositoryAnchor));
  const workspaceStateDir = join(repositoryStateDir, "worktrees", stableStorageId("ws", workspaceAnchor));
  return {
    daemonConnectionPath: join(workspaceStateDir, "archctxd.json")
  };
}

function defaultArchContextStateRoot() {
  const override = process.env.ARCHCONTEXT_STATE_DIR;
  if (override) return resolve(override);
  const home = homedir();
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "ArchContext");
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "ArchContext");
  return join(process.env.XDG_DATA_HOME ?? join(home, ".local", "share"), "archcontext");
}

function findRepositoryRoot(root: string) {
  return readGitPath(root, ["rev-parse", "--show-toplevel"]) ?? root;
}

function readGitPath(root: string, args: string[]) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

function isPrivateControlFile(path: string): boolean {
  if (!existsSync(path)) return false;
  if (process.platform === "win32") return true;
  try {
    return (statSync(path).mode & 0o077) === 0;
  } catch {
    return false;
  }
}

function resolveMaybeRelative(base: string, path: string) {
  return isAbsolute(path) ? resolve(path) : resolve(base, path);
}

function canonicalPath(path: string) {
  const resolved = resolve(path);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function stableStorageId(prefix: "repo" | "ws", value: string) {
  return `${prefix}.${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function digestJson(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(sortJson(value)), "utf8").digest("hex")}`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortJson(child)]));
  }
  return value;
}

function hookLogRecord(input: { event: string; changedPaths: string[]; reasonCode: string; elapsedMs: number; failOpen: boolean }) {
  return {
    schemaVersion: HOOK_LOG_SCHEMA_VERSION,
    event: input.event,
    elapsedMs: input.elapsedMs,
    pathCount: input.changedPaths.length,
    changedPathDigest: digestJson({ paths: [...new Set(input.changedPaths)].sort() }),
    reasonCode: input.reasonCode,
    failOpen: input.failOpen,
    egress: "none",
    network: "forbidden"
  };
}

function defaultHookGitChangeSource(event: string) {
  if (event === "post-commit") return "commit";
  if (event === "pre-commit") return "staged";
  return "worktree";
}

function readFlag(args: string[], flag: string) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function readRepeatedFlag(args: string[], flag: string) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]!);
  }
  return values;
}

function optionalInteger(args: string[], flag: string, positive: boolean): { value?: number; error?: unknown } {
  const raw = readFlag(args, flag);
  if (raw === undefined) return {};
  const value = Number(raw);
  if (!Number.isInteger(value) || (positive && value < 1)) {
    return { error: errorEnvelope("hook.enqueue", "AC_SCHEMA_INVALID", `${flag} must be ${positive ? "a positive integer" : "an integer"}`) };
  }
  return { value };
}

function shouldSkipGeneratedProjectionHook(args: string[], changedPaths: string[]) {
  if (args.includes("--no-generated-projection-guard")) return false;
  if (args.includes("--generated-projection")) return true;
  return changedPaths.length > 0 && changedPaths.every((path) => path.replace(/\\/g, "/").startsWith(".archcontext/generated/"));
}

function hookEnqueueReasonCode(data: Record<string, Json>) {
  if (data.reasonCode !== undefined) return String(data.reasonCode);
  if (data.skipped === true) return "skipped";
  if (data.deduplicated === true) return "deduplicated";
  if (data.enqueued === true) return "enqueued";
  if (data.rejected === true) return "rejected";
  return "unknown";
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
