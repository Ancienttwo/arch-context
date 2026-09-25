#!/usr/bin/env bun
import { readPrivateControlFile } from "@archcontext/local-runtime/control-file-security";
import { runtimeStatePaths } from "@archcontext/local-runtime/runtime-state-paths";
import { spawnSync } from "node:child_process";
import { digestJson, type Json } from "@archcontext/contracts";
import { isArchContextGeneratedProjectionPath } from "@archcontext/local-runtime/projection-paths";

const RUNTIME_RPC_VERSION = "archcontext.runtime-rpc/v1";
const HOOK_LOG_SCHEMA_VERSION = "archcontext.hook-log/v1";

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
  try {
    const body = readPrivateControlFile(path);
    if (body === undefined) return undefined;
    const parsed = JSON.parse(body);
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

function findRepositoryRoot(root: string) {
  return readGitPath(root, ["rev-parse", "--show-toplevel"]) ?? root;
}

function readGitPath(root: string, args: string[]) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim() || undefined : undefined;
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
  return changedPaths.length > 0 && changedPaths.every(isArchContextGeneratedProjectionPath);
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
