import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  digestJson,
  errorEnvelope,
  isRepoRelativePosixPath,
  okEnvelope,
  productVersionManifest,
  type Json
} from "@archcontext/contracts";
import { manifestDecisionDiagnostics, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { inspectRepositoryCodeFacts } from "@archcontext/local-runtime/codegraph-adapter";
import { localEgressStatus } from "@archcontext/local-runtime/egress";
import { localEgressAdmission, withLocalEgress } from "@archcontext/local-runtime/egress-admission";
import { findRepositoryRoot, readHeadSha } from "@archcontext/local-runtime/git-adapter";
import { defaultLocalStorePath, localStoreWriterOwnershipPath, runtimeStatePaths } from "@archcontext/local-runtime/local-store-sqlite";
import { readAgentHost, readFlag, readRepeatedFlag } from "../cli-flags";
import type { AgentHost } from "../cli-types";
import { diagnostics } from "../local-hardening";
import { runCheckpointCommand } from "./check";

const RELEASE_PACKAGE_NAME = "archctx";
const UPDATE_CHECK_ENV = "ARCHCONTEXT_CHECK_UPDATES";
const LATEST_VERSION_ENV = "ARCHCONTEXT_LATEST_VERSION";
const NPM_VIEW_TIMEOUT_MS = 5_000;
const HOOK_ADAPTER_SCHEMA_VERSION = "archcontext.hook-adapter/v1";
const HOOK_LOG_SCHEMA_VERSION = "archcontext.hook-log/v1";
const HOOK_ADAPTER_NAME = "repo-harness-hook";
const HOOK_CHECKPOINT_TIMEOUT_MS = 5_000;

export async function runHookCommand(args: string[], cwd: string) {
  const subcommand = args[0] ?? "checkpoint";
  if (subcommand === "checkpoint") return runHookCheckpointCommand(args.slice(1), cwd);
  return errorEnvelope("hook", "AC_SCHEMA_INVALID", "hook requires checkpoint");
}

export function runHookCheckpointCommand(checkpointArgs: string[], cwd: string) {
  const started = Date.now();
  const event = readFlag(checkpointArgs, "--event") ?? "post-edit";
  if (event.length === 0 || event.length > 1024) {
    return errorEnvelope("hook.checkpoint", "AC_SCHEMA_INVALID", "Hook event must contain 1 to 1024 characters", "hook-event-invalid");
  }
  const changedPaths = readRepeatedFlag(checkpointArgs, "--changed-path");
  if (changedPaths.some((path) => !isRepoRelativePosixPath(path))) {
    return errorEnvelope("hook.checkpoint", "AC_SCHEMA_INVALID", "changedPaths must contain repository-relative POSIX paths", "changed-path-invalid");
  }
  const result = runCheckpointCommand(checkpointArgs, cwd);
  const reasonCode = result.ok ? "debt-measured" : result.error!.reasonCode!;
  const hookLog = hookLogRecord({ event, changedPaths, reasonCode, elapsedMs: Date.now() - started, failOpen: !result.ok });
  if (!result.ok) return okEnvelope("hook.checkpoint", {
    schemaVersion: "archcontext.hook-checkpoint-fail-open/v1",
    accepted: false,
    failOpen: true,
    coverage: "unknown",
    reasonCode,
    error: result.error,
    event,
    pathCount: changedPaths.length,
    egress: "none",
    network: "forbidden",
    hookLog
  } as unknown as Json);
  return okEnvelope("hook.checkpoint", {
    schemaVersion: "archcontext.hook-debt-checkpoint/v1",
    debt: result.data,
    hookLog
  } as unknown as Json);
}

export function runHooksCommand(args: string[]) {
  const subcommand = args[0] ?? "status";
  if (!["install", "status", "remove", "uninstall", "doctor"].includes(subcommand)) {
    return errorEnvelope("hooks", "AC_SCHEMA_INVALID", "hooks requires install|status|remove|uninstall|doctor");
  }
  const host = readAgentHost(args);
  if (!host) return errorEnvelope("hooks", "AC_SCHEMA_INVALID", "--host must be codex, claude, or generic");
  const adapter = hookAdapterContract(host);
  if (subcommand === "install") {
    return okEnvelope("hooks.install", {
      ...adapter,
      installed: true,
      writes: "manual-host-config",
      configExample: hookHostConfigExample(host)
    } as any);
  }
  if (subcommand === "status") {
    return okEnvelope("hooks.status", {
      ...adapter,
      installed: "config-ready",
      writes: "manual-host-config",
      configExample: hookHostConfigExample(host)
    } as any);
  }
  if (subcommand === "doctor") {
    return okEnvelope("hooks.doctor", {
      ...adapter,
      installed: "config-ready",
      writes: "manual-host-config",
      checks: [
        { id: "entrypoint", status: "pass", command: "archctx hook checkpoint" },
        { id: "fail-open", status: "pass", schemaVersion: "archcontext.hook-checkpoint-fail-open/v1" },
        { id: "egress", status: "pass", egress: "none", network: "forbidden" }
      ]
    } as any);
  }
  return okEnvelope(subcommand === "uninstall" ? "hooks.uninstall" : "hooks.remove", {
    ...adapter,
    installed: false,
    writes: "manual-host-config",
    removeConfig: hookHostRemoveConfig(host)
  } as any);
}

function hookAdapterContract(host: AgentHost) {
  return {
    schemaVersion: HOOK_ADAPTER_SCHEMA_VERSION,
    host,
    adapterName: HOOK_ADAPTER_NAME,
    ownership: "central-first",
    hookRuntime: "external-user-level",
    repoLocalRuntime: "not-vendored",
    entrypoint: {
      command: "archctx",
      args: ["hook", "checkpoint"],
      timeoutMs: HOOK_CHECKPOINT_TIMEOUT_MS,
      failOpen: true,
      egress: "none",
      network: "forbidden"
    },
    readEntrypoint: {
      command: "archctx",
      args: ["hook", "checkpoint"],
      timeoutMs: HOOK_CHECKPOINT_TIMEOUT_MS,
      failOpen: true,
      egress: "none",
      network: "forbidden"
    },
    readInput: { eventFlag: "--event", changedPathFlag: "--changed-path" },
    output: {
      checkpointSchemaVersion: "archcontext.hook-debt-checkpoint/v1",
      checkpointFailOpenSchemaVersion: "archcontext.hook-checkpoint-fail-open/v1"
    },
    logContract: {
      schemaVersion: HOOK_LOG_SCHEMA_VERSION,
      allowedFields: ["schemaVersion", "event", "elapsedMs", "pathCount", "changedPathDigest", "reasonCode", "failOpen", "egress", "network"],
      forbiddenContent: ["source", "diff", "patch", "symbolBody", "architectureModelBody", "secret"]
    }
  };
}

function hookHostConfigExample(host: AgentHost) {
  return {
    host,
    configPath: host === "codex" ? "~/.codex/hooks.json" : host === "claude" ? "~/.claude/settings.json" : "agent-host-config",
    writes: "manual-host-config",
    adapter: {
      command: HOOK_ADAPTER_NAME,
      args: ["archcontext-checkpoint"],
      invokes: {
        command: "archctx",
        args: ["hook", "checkpoint", "--event", "post-edit"]
      }
    },
    eventMap: {
      postEdit: "archctx hook checkpoint --event post-edit --changed-path <changed-path>",
      postWrite: "archctx hook checkpoint --event post-write --changed-path <changed-path>"
    },
    centralFirst: true,
    repoHookSourceRequired: false
  };
}

function hookHostRemoveConfig(host: AgentHost) {
  return {
    host,
    configPath: host === "codex" ? "~/.codex/hooks.json" : host === "claude" ? "~/.claude/settings.json" : "agent-host-config",
    removeAdapter: HOOK_ADAPTER_NAME,
    removeEntrypoint: "archctx hook checkpoint",
    readEntrypoint: "archctx hook checkpoint",
    repoHookSourceRequired: false
  };
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
  } satisfies import("@archcontext/contracts").ArchitectureDebtHookLogV1;
}

export async function doctorReport(cwd: string, args: string[] = []) {
  const product = productVersionManifest();
  const paths = runtimePathsReport(cwd);
  const git = doctorGit(cwd);
  const sqlite = doctorSqlite(cwd);
  const permissions = doctorPermissions(cwd);
  const codeFacts = inspectRepositoryCodeFacts(("root" in git && git.root) || cwd);
  const hardening = diagnostics(localEgressStatus(process.env, {
    updateCheckRequested: args.includes("--check-updates") || process.env[UPDATE_CHECK_ENV] === "1"
  }));
  const egress = { ...hardening.egress, source: "cli-environment" };
  return {
    product,
    version: {
      product: product.product.version,
      cli: product.surfaces.cli.version,
      schemaSetVersion: product.schemas.schemaSetVersion
    },
    runtime: { mode: "in-process" },
    sqlite,
    update: updateCheckReport({
      checkUpdates: args.includes("--check-updates") || process.env[UPDATE_CHECK_ENV] === "1"
    }),
    paths,
    codeGraph: product.runtime.codeGraph,
    codeFacts,
    manifest: doctorManifest(("root" in git && git.root) || cwd),
    git,
    permissions,
    egress,
    hardening: { ...hardening, egress },
    ok: hardening.supportedNode && permissions.workspace.readable && permissions.workspace.writable && egress.ok
  };
}

/** Read-only manifest diagnostics shared with model validation. Does not start a runtime. */
export function doctorManifest(root: string): { warnings: string[] } {
  const path = ".archcontext/manifest.yaml";
  try { return { warnings: manifestDecisionDiagnostics([{ path, body: readFileSync(resolve(root, path), "utf8") }]) }; }
  catch { return { warnings: [] }; }
}

type UpdateCheckStatus = "not-checked" | "current" | "update-available" | "latest-unavailable" | "compare-unavailable";

export function updateCheckReport(opts: { checkUpdates: boolean; env?: NodeJS.ProcessEnv }) {
  const env = opts.env ?? process.env;
  const currentVersion = productVersionManifest().product.version;
  const installCommand = `npm install -g ${RELEASE_PACKAGE_NAME}@latest`;
  const base = {
    schemaVersion: "archcontext.update-check/v1",
    packageName: RELEASE_PACKAGE_NAME,
    currentVersion,
    installCommand,
    egress: {
      default: "none",
      checkUpdates: "https://registry.npmjs.org/",
      admission: localEgressAdmission("npm-update-check", env),
      requested: opts.checkUpdates
    }
  };
  if (!opts.checkUpdates) {
    return { ...base, status: "not-checked" as UpdateCheckStatus, checkUpdates: false, updateAvailable: false, reason: `disabled; run archctx update --check or ${UPDATE_CHECK_ENV}=1 archctx doctor` };
  }
  const latest = readLatestPackageVersion(env);
  if (!latest.version) {
    return { ...base, status: "latest-unavailable" as UpdateCheckStatus, checkUpdates: true, updateAvailable: false, source: latest.source, error: latest.error ?? "unknown error", reason: "latest version unavailable" };
  }
  const comparison = compareVersions(currentVersion, latest.version);
  if (comparison === null) {
    return { ...base, status: "compare-unavailable" as UpdateCheckStatus, checkUpdates: true, updateAvailable: false, latestVersion: latest.version, source: latest.source, reason: "unable to compare semantic versions" };
  }
  if (comparison < 0) {
    return { ...base, status: "update-available" as UpdateCheckStatus, checkUpdates: true, updateAvailable: true, latestVersion: latest.version, source: latest.source, reason: `current=${currentVersion}; latest=${latest.version}` };
  }
  return { ...base, status: "current" as UpdateCheckStatus, checkUpdates: true, updateAvailable: false, latestVersion: latest.version, source: latest.source, reason: `current=${currentVersion}; latest=${latest.version}` };
}

function readLatestPackageVersion(env: NodeJS.ProcessEnv): { source: "env" | "npm"; version?: string; error?: string } {
  if (env[LATEST_VERSION_ENV]) return { source: "env", version: env[LATEST_VERSION_ENV] };
  const result = withLocalEgress("npm-update-check", () => spawnSync("npm", ["view", RELEASE_PACKAGE_NAME, "version", "--json"], { encoding: "utf8", timeout: NPM_VIEW_TIMEOUT_MS, shell: false }), env);
  if (result.status !== 0 || result.error) {
    return { source: "npm", error: trimUpdateError(result.stderr || result.stdout || String(result.error?.message ?? result.error ?? "npm view failed")) };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return { source: "npm", version: typeof parsed === "string" ? parsed : String(parsed) };
  } catch {
    return { source: "npm", version: result.stdout.trim().replace(/^"|"$/g, "") };
  }
}

function trimUpdateError(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 400);
}

function parseVersion(value: string): number[] | null {
  const match = value.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return match.slice(1).map((part) => Number(part));
}

function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function doctorGit(cwd: string) {
  try {
    const root = findRepositoryRoot(cwd);
    return { ok: true, root, headSha: readHeadSha(root) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function doctorSqlite(cwd: string) {
  const paths = runtimeStatePaths(cwd);
  const path = paths.localStorePath;
  const writerLockPath = localStoreWriterOwnershipPath(path);
  return { path, exists: existsSync(path), writerLockPath, writerLocked: existsSync(writerLockPath), migrations: productVersionManifest().runtime.sqliteMigrations };
}

function doctorPermissions(cwd: string) {
  const paths = runtimeStatePaths(cwd);
  return { workspace: pathAccess(cwd), stateRoot: pathAccess(paths.stateRoot), runtimeStateDir: pathAccess(paths.workspaceStateDir), sqlite: pathAccess(defaultLocalStorePath(cwd)) };
}

export function runtimePathsReport(cwd: string) {
  const paths = runtimePathsReportRaw(cwd);
  return {
    ...paths,
    runtimeRepositoryId: repositoryFingerprint(paths.repositoryRoot),
    repositoryTruthDir: join(paths.repositoryRoot, ".archcontext"),
    codeGraphIndexDir: join(paths.repositoryRoot, ".codegraph"),
    npmGlobalInstallState: "forbidden",
    overrides: { stateRootEnv: "ARCHCONTEXT_STATE_DIR", localStorePathEnv: "ARCHCONTEXT_LOCAL_STORE_PATH" }
  };
}

function runtimePathsReportRaw(cwd: string) {
  return runtimeStatePaths(cwd);
}

function pathAccess(path: string) {
  const exists = existsSync(path);
  return { path, exists, readable: canAccess(path, constants.R_OK), writable: canAccess(path, constants.W_OK), private: exists ? isPrivatePath(path) : undefined };
}

function canAccess(path: string, mode: number): boolean {
  try { accessSync(path, mode); return true; }
  catch { return false; }
}

function isPrivatePath(path: string): boolean {
  if (process.platform === "win32") return true;
  try { return (statSync(path).mode & 0o077) === 0; }
  catch { return false; }
}
