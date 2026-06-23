#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { accessSync, chmodSync, closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CALLER_PROVIDED_ATTESTATION_FIELDS, digestJson, errorEnvelope, okEnvelope, productVersionManifest } from "@archcontext/contracts";
import type { AttestationV2, GitHubGovernancePort, Json, ReviewChallengeV2 } from "@archcontext/contracts";
import { repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { dependencyAudit, diagnostics, installMarker, secretScan, uninstallMarker } from "@archcontext/cloud/hardening";
import { defaultLocalStorePath, inspectLegacyLocalStoreMigration, migrateLegacyLocalStoreIfNeeded, runtimeStatePaths } from "@archcontext/local-runtime/local-store-sqlite";
import { findRepositoryRoot, readHeadSha } from "@archcontext/local-runtime/git-adapter";
import {
  ArchctxRuntimeRpcServer,
  RUNTIME_RPC_VERSION,
  createRuntimeRpcClientFromConnectionFile,
  createStartedDaemon,
  createStartedProductionDaemon,
  defaultDaemonConnectionPath,
  defaultDaemonLockPath,
  recoverStaleDaemonControlFiles,
  runtimeRpcCompatibilityIssue,
  type RuntimeRpcCompatibilityIssue,
  type RuntimeDaemonClient,
  type RuntimeDeps
} from "@archcontext/local-runtime/runtime-daemon";
import { exportLikeC4Model, importLikeC4InitialModel } from "@archcontext/surfaces/adapter-likec4";
import { exportStructurizrWorkspace, importStructurizrInitialModel } from "@archcontext/surfaces/adapter-structurizr";
import { runStdioMcpLoop } from "@archcontext/surfaces/mcp-local";
import { exportMermaidModel, loadNativeModelFromArchContext } from "@archcontext/surfaces/renderer";

const [, , command, ...args] = process.argv;
const CLI_ENTRY = fileURLToPath(import.meta.url);
const DAEMON_START_TIMEOUT_MS = 15_000;
const RELEASE_PACKAGE_NAME = "archctx";
const UPDATE_CHECK_ENV = "ARCHCONTEXT_CHECK_UPDATES";
const LATEST_VERSION_ENV = "ARCHCONTEXT_LATEST_VERSION";
const NPM_VIEW_TIMEOUT_MS = 5_000;
const HOOK_ADAPTER_SCHEMA_VERSION = "archcontext.hook-adapter/v1";
const HOOK_LOG_SCHEMA_VERSION = "archcontext.hook-log/v1";
const HOOK_ADAPTER_NAME = "repo-harness-hook";
const HOOK_CHECKPOINT_TIMEOUT_MS = 5_000;

class RuntimeVersionUnsupportedError extends Error {
  constructor(readonly issue: RuntimeRpcCompatibilityIssue) {
    super(runtimeVersionUnsupportedMessage(issue));
  }
}

if (import.meta.main) {
  if (command === "mcp" && args.length === 0) {
    await runStdioMcpLoop(stdinLines(), (line) => process.stdout.write(`${line}\n`));
  } else if (command === "daemon" && args[0] === "start" && args.includes("--foreground")) {
    await runForegroundDaemon(process.cwd(), args).catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  } else {
    const result = await runCli(command, args, process.cwd()).catch((error) =>
      errorEnvelope("cli", "AC_RUNTIME_UNAVAILABLE", error instanceof Error ? error.message : String(error))
    );
    process.stdout.write(`${renderResult(result, readFlag(args, "--format") ?? "json")}\n`);
  }
}

async function* stdinLines(): AsyncIterable<string> {
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield line;
      newline = buffer.indexOf("\n");
    }
  }
  const trailing = buffer.trim();
  if (trailing) yield trailing;
}

export interface CliRuntimeDeps extends RuntimeDeps {
  runtimeClient?: RuntimeDaemonClient;
  disableRpcDiscovery?: boolean;
  devicePrivateKeyStore?: {
    provisionDevicePrivateKey(input: { accountId: string; publicKeyId: string; createdAt?: string }): { reference: DeviceKeyCredentialReference };
    signWithDevicePrivateKey(input: { keyRef: string; payload: string | Uint8Array }): string;
    removeDevicePrivateKey(keyRef: string): void;
  };
  tokenStore?: {
    saveRefreshToken(accountId: string, refreshToken: string): string;
    clear(ref: string): void;
  };
  githubGovernancePort?: Pick<GitHubGovernancePort, "getPullHeadMetadata">;
  githubReviewChallengePort?: {
    fetchReviewChallenge(input: {
      pullRequestNumber: number;
      connection: ReturnType<typeof sanitizeGithubConnection>;
    }): Promise<ReviewChallengeV2> | ReviewChallengeV2;
  };
  githubReviewSubmissionPort?: {
    submitDeveloperReview(input: {
      challenge: ReviewChallengeV2;
      attestation: AttestationV2;
      attestationDigest: string;
    }): Promise<Json> | Json;
  };
}

interface DeviceKeyCredentialReference {
  schemaVersion: "archcontext.device-key-credential-ref/v1";
  accountId: string;
  publicKeyId: string;
  publicKeyFingerprint: string;
  keyRef: string;
  createdAt: string;
}

interface GitHubConnectionRecord {
  schemaVersion: "archcontext.github-connection/v1";
  status: "connected";
  accountId: string;
  githubUserId: string;
  issuer: string;
  clientId: string;
  scopes: string[];
  authorizationUrl: string;
  codeVerifierRef: string;
  refreshTokenRef: string;
  deviceKey: DeviceKeyCredentialReference;
  connectedAt: string;
}

type GitHubDeveloperReviewStatus = "claimed" | "ran" | "ready_for_submit" | "submitted" | "cancelled" | "failed";

interface GitHubDeveloperReviewState {
  schemaVersion: "archcontext.github-developer-review-state/v1";
  status: GitHubDeveloperReviewStatus;
  challenge: ReviewChallengeV2;
  challengeDigest: string;
  lease?: Json;
  review?: {
    reviewId: string;
    reviewDigest: string;
    result: string;
    attestationResult: string;
    worktreeDigest: string;
    modelDigest: string;
    codeFactsDigest: string;
  };
  attestation?: AttestationV2;
  attestationDigest?: string;
  submission?: Json;
  reasonCode?: string;
  updatedAt: string;
}

interface CliRuntimeHandle {
  client: RuntimeDaemonClient;
  close(): Promise<void>;
}

type AgentHost = "codex" | "claude" | "generic";

export async function runCli(command = "help", args: string[] = [], cwd: string, deps: CliRuntimeDeps = {}) {
  try {
    return await runCliUnchecked(command, args, cwd, deps);
  } catch (error) {
    if (error instanceof RuntimeVersionUnsupportedError) {
      return errorEnvelope(command ?? "cli", "AC_RUNTIME_VERSION_UNSUPPORTED", error.message);
    }
    throw error;
  }
}

async function runCliUnchecked(command = "help", args: string[] = [], cwd: string, deps: CliRuntimeDeps = {}) {
  if (command === "daemon") return runDaemonCommand(args, cwd);
  if (command === "github") return runGithubCommand(args, cwd, deps);
  const runtimeHandles: CliRuntimeHandle[] = [];
  const runtime = async () => {
    const handle = await createCliRuntime(cwd, deps);
    runtimeHandles.push(handle);
    return handle.client;
  };
  try {
    switch (command) {
    case "init":
      return (await runtime()).init(cwd, readFlag(args, "--name") ?? "ArchContext Project");
    case "sync":
      return (await runtime()).sync(cwd, readRepeatedFlag(args, "--changed"));
    case "validate":
      return (await runtime()).validate(cwd);
    case "context": {
      const task = readFlag(args, "--task") ?? args.join(" ").trim();
      if (!task) return errorEnvelope("context", "AC_SCHEMA_INVALID", "context requires --task or task text");
      const daemon = await runtime();
      if (args.includes("--landscape")) {
        await daemon.repoAdd(cwd, readFlag(args, "--name") ?? "local");
        return daemon.contextLandscape(task, Number(readFlag(args, "--max-symbols") ?? 12));
      }
      return daemon.context(cwd, task, Number(readFlag(args, "--max-symbols") ?? 12));
    }
    case "status":
      return (await runtime()).runtimeStatus(cwd);
    case "repo": {
      const subcommand = args[0] ?? "list";
      if (subcommand === "add") {
        const root = readFlag(args, "--root") ?? cwd;
        if (resolve(root) !== resolve(cwd)) {
          return errorEnvelope("repo.add", "AC_CAPABILITY_UNSUPPORTED", "Multi-repo architecture context is outside the Local Core MVP; run archctx inside one Git repository.");
        }
        const daemon = await runtime();
        return daemon.repoAdd(root, readFlag(args, "--name"));
      }
      const daemon = await runtime();
      if (subcommand === "remove") {
        const repositoryId = readFlag(args, "--repository-id") ?? args[1];
        if (!repositoryId) return errorEnvelope("repo.remove", "AC_SCHEMA_INVALID", "repo remove requires --repository-id");
        return daemon.repoRemove(repositoryId);
      }
      return daemon.repoList();
    }
    case "landscape":
      return (await runtime()).landscapeStatus();
    case "explore": {
      const subcommand = args[0] ?? "status";
      const daemon = await runtime();
      if (subcommand === "projection") return daemon.explorerProjection(cwd, readFlag(args, "--query"));
      if (subcommand === "contract") return daemon.explorerServiceContract(Number(readFlag(args, "--token-ttl-seconds") ?? 900));
      if (subcommand === "status") return daemon.explorerStatus();
      if (subcommand === "stop") return daemon.stopExplorer();
      if (subcommand === "revoke") return daemon.revokeExplorerToken();
      if (subcommand === "start") {
        if (args.includes("--foreground")) {
          return daemon.startExplorer(cwd, {
            port: Number(readFlag(args, "--port") ?? 0),
            tokenTtlSeconds: Number(readFlag(args, "--token-ttl-seconds") ?? 900)
          });
        }
        return {
          schemaVersion: "archcontext.envelope/v1",
          ok: true,
          requestId: "explorer.start",
          data: {
            command: "archctx explore start --foreground",
            bindHost: "127.0.0.1",
            defaultEnabled: false,
            readOnly: true,
            egress: "none",
            tokenRequired: true
          }
        };
      }
      return errorEnvelope("explore", "AC_SCHEMA_INVALID", "explore requires start|stop|status|revoke|projection|contract");
    }
    case "prepare": {
      const task = readFlag(args, "--task") ?? args.join(" ").trim();
      if (!task) return errorEnvelope("prepare", "AC_SCHEMA_INVALID", "prepare requires --task or task text");
      const result = await (await runtime()).prepare(
        cwd,
        task,
        Number(readFlag(args, "--max-bytes") ?? 12288),
        Number(readFlag(args, "--max-items") ?? 12),
        readFlag(args, "--task-session-id") ?? "task_cli"
      );
      return result.ok ? { ...result, data: paginate(result.data, args) } : result;
    }
    case "practices":
      return runPracticesCommand(args, cwd, await runtime());
    case "checkpoint":
      return runCheckpointCommand(args, cwd, await runtime(), "checkpoint");
    case "hook":
      return runHookCommand(args, cwd, runtime);
    case "hooks":
      return runHooksCommand(args);
    case "review":
    case "complete": {
      const forbidden = readForbiddenAttestationFlags(args);
      if (forbidden.length > 0) {
        return errorEnvelope(command, "AC_SCHEMA_INVALID", `Review attestation fields are daemon-owned and cannot be provided by CLI flags: ${forbidden.join(",")}`);
      }
      const result = await (await runtime()).completeTask(cwd, {
        taskSessionId: readFlag(args, "--task-session-id") ?? "task_cli",
        task: readFlag(args, "--task"),
        posture: (readFlag(args, "--posture") as any) ?? "normal",
        headSha: readFlag(args, "--head-sha")
      });
      return { ...result, requestId: command };
    }
    case "plan": {
      const path = readFlag(args, "--path");
      if (!path) return errorEnvelope("plan", "AC_SCHEMA_INVALID", "plan requires --path");
      return (await runtime()).planUpdate(cwd, {
        id: readFlag(args, "--id") ?? "changeset.cli",
        operations: [{ op: "create_entity", path, expectedHash: readFlag(args, "--expected-hash") ?? "missing", body: readFlag(args, "--body") ?? "" }]
      });
    }
    case "apply": {
      return (await runtime()).applyUpdate(cwd, {
        id: readFlag(args, "--id") ?? "changeset.cli",
        approved: args.includes("--approved"),
        expectedWorktreeDigest: requireFlag(args, "--expected-worktree-digest")
      });
    }
    case "config":
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: true,
        requestId: "config",
        data: {
          codex: agentHostConfig("codex"),
          claude: agentHostConfig("claude"),
          generic: agentHostConfig("generic")
        }
      };
    case "mcp":
      return runMcpCommand(args);
    case "install":
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: true,
        requestId: "install",
        data: { marker: installMarker((readFlag(args, "--host") as any) ?? "generic") }
      };
    case "uninstall":
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: true,
        requestId: "uninstall",
        data: { content: uninstallMarker(readFlag(args, "--content") ?? "", (readFlag(args, "--host") as any) ?? "generic") }
      };
    case "doctor":
      return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "doctor", data: await doctorReport(cwd, args) };
    case "update": {
      if (!args.includes("--check")) {
        return errorEnvelope("update", "AC_CAPABILITY_UNSUPPORTED", "update only supports read-only checks; run archctx update --check");
      }
      return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "update.check", data: updateCheckReport({ checkUpdates: true }) };
    }
    case "paths":
      return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "paths", data: runtimePathsReport(cwd) };
    case "privacy-audit":
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: true,
        requestId: "privacy-audit",
        data: { dependencyAudit: dependencyAudit(cwd), secretScan: secretScan(cwd) }
      };
    case "export": {
      const format = args[0] ?? readFlag(args, "--format") ?? "mermaid";
      const model = loadNativeModelFromArchContext(cwd);
      const result =
        format === "likec4" ? exportLikeC4Model(model) :
        format === "structurizr" ? exportStructurizrWorkspace(model) :
        format === "mermaid" ? exportMermaidModel(model) :
        undefined;
      if (!result) return errorEnvelope("export", "AC_SCHEMA_INVALID", "export requires likec4, structurizr, or mermaid");
      return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "export", data: result as any };
    }
    case "import": {
      const format = args[0] ?? readFlag(args, "--format");
      const content = readFlag(args, "--content");
      if (!format || !content) return errorEnvelope("import", "AC_SCHEMA_INVALID", "import requires likec4|structurizr and --content");
      const result =
        format === "likec4" ? importLikeC4InitialModel(content) :
        format === "structurizr" ? importStructurizrInitialModel(content) :
        undefined;
      if (!result) return errorEnvelope("import", "AC_SCHEMA_INVALID", "import requires likec4 or structurizr");
      return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "import", data: { ...result, mode: "initialization-only" } as any };
    }
    case "tunnel":
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: true,
        requestId: "tunnel",
        data: {
          command: "archctx mcp",
          bindHost: "127.0.0.1",
          scopes: ["context:read", "changeset:preview"],
          writes: "disabled-by-default-local-confirmation-required",
          revocation: "archctx tunnel --revoke"
        }
      };
    case "help":
    default:
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: true,
        requestId: "help",
        data: {
          commands: ["init", "sync", "validate", "context", "status", "daemon", "repo", "landscape", "explore", "prepare", "practices", "checkpoint", "hook", "hooks", "plan", "apply", "review", "complete", "github", "config", "mcp", "install", "uninstall", "doctor", "update", "paths", "privacy-audit", "export", "import", "tunnel"],
          examples: ["archctx init --name MyApp", "archctx practices validate --strict", "archctx practices list --json", "archctx practices waivers", "archctx practices waive --practice-id modularity.no-new-cycle --owner team-architecture --reason 'External migration window requires this edge until cutover.' --expires-at 2026-07-24T00:00:00.000Z --evidence-digest sha256:<64-hex> --subject module.a->module.b", "archctx checkpoint --task-session-id task_cli", "archctx hook checkpoint --event post-edit --path src/app.ts", "archctx hooks install --host codex", "archctx paths", "archctx update --check", "archctx doctor --check-updates", "archctx github connect", "archctx github status", "archctx daemon start", "archctx explore start --foreground", "archctx export likec4", "archctx import structurizr --content '<json>'", "archctx tunnel"]
        }
      };
    }
  } finally {
    for (const handle of runtimeHandles.reverse()) await handle.close();
  }
}

async function runPracticesCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  const subcommand = args[0] ?? "list";
  if (subcommand === "list") {
    return daemon.practices(cwd, {
      action: "list",
      category: readFlag(args, "--category"),
      source: readFlag(args, "--source")
    });
  }
  if (subcommand === "show") {
    const id = args[1] ?? readFlag(args, "--id");
    if (!id) return errorEnvelope("practices.show", "AC_SCHEMA_INVALID", "practices show requires <id> or --id");
    return daemon.practices(cwd, { action: "show", id });
  }
  if (subcommand === "validate") {
    return daemon.practices(cwd, { action: "validate", strict: args.includes("--strict") });
  }
  if (subcommand === "sources") {
    return daemon.practices(cwd, { action: "sources" });
  }
  if (subcommand === "waivers") {
    return daemon.practiceWaivers(cwd);
  }
  if (subcommand === "waive") {
    const required = ["--practice-id", "--owner", "--reason", "--expires-at", "--evidence-digest"];
    const missing = required.filter((flag) => !readFlag(args, flag));
    if (missing.length > 0) return errorEnvelope("practices.waive", "AC_SCHEMA_INVALID", `practices waive requires ${missing.join(", ")}`);
    const subjects = readRepeatedFlag(args, "--subject");
    const pathGlobs = readRepeatedFlag(args, "--path-glob");
    if (subjects.length === 0 && pathGlobs.length === 0) {
      return errorEnvelope("practices.waive", "AC_SCHEMA_INVALID", "practices waive requires --subject or --path-glob");
    }
    return daemon.planPracticeWaiver(cwd, {
      ...(readFlag(args, "--id") === undefined ? {} : { id: readFlag(args, "--id")! }),
      ...(readFlag(args, "--waiver-id") === undefined ? {} : { waiverId: readFlag(args, "--waiver-id")! }),
      ...(readFlag(args, "--task-session-id") === undefined ? {} : { taskSessionId: readFlag(args, "--task-session-id")! }),
      practiceId: readFlag(args, "--practice-id")!,
      ...(readFlag(args, "--check-id") === undefined ? {} : { checkId: readFlag(args, "--check-id")! }),
      owner: readFlag(args, "--owner")!,
      reason: readFlag(args, "--reason")!,
      ...(readFlag(args, "--created-at") === undefined ? {} : { createdAt: readFlag(args, "--created-at")! }),
      expiresAt: readFlag(args, "--expires-at")!,
      evidenceDigest: readFlag(args, "--evidence-digest")!,
      ...(subjects.length === 0 ? {} : { subjects }),
      ...(pathGlobs.length === 0 ? {} : { pathGlobs })
    });
  }
  return errorEnvelope("practices", "AC_SCHEMA_INVALID", "practices requires list|show|validate|sources|waivers|waive");
}

async function runCheckpointCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient, requestId: string) {
  const task = readFlag(args, "--task");
  const result = await daemon.checkpoint(cwd, {
    taskSessionId: readFlag(args, "--task-session-id") ?? "task_cli",
    ...(task === undefined ? {} : { task }),
    event: (readFlag(args, "--event") as any) ?? "manual",
    changedPaths: [...readRepeatedFlag(args, "--path"), ...readRepeatedFlag(args, "--changed")],
    toolCallId: readFlag(args, "--tool-call-id"),
    expectedHeadSha: readFlag(args, "--expected-head-sha") ?? readFlag(args, "--head-sha"),
    expectedWorktreeDigest: readFlag(args, "--expected-worktree-digest"),
    maxBytes: Number(readFlag(args, "--max-bytes") ?? 12_288),
    maxItems: Number(readFlag(args, "--max-items") ?? 12)
  });
  return { ...result, requestId };
}

async function runHookCommand(args: string[], cwd: string, runtime: () => Promise<RuntimeDaemonClient>) {
  const subcommand = args[0] ?? "status";
  if (subcommand !== "checkpoint") return errorEnvelope("hook", "AC_SCHEMA_INVALID", "hook requires checkpoint");
  const checkpointArgs = args.slice(1);
  const started = Date.now();
  const event = readFlag(checkpointArgs, "--event") ?? "post-edit";
  const changedPaths = [...readRepeatedFlag(checkpointArgs, "--path"), ...readRepeatedFlag(checkpointArgs, "--changed")];
  try {
    const result = await runCheckpointCommand(
      [
        "--event", event,
        "--task-session-id", readFlag(checkpointArgs, "--task-session-id") ?? "task_cli",
        ...copyOptionalFlag(checkpointArgs, "--task"),
        ...copyOptionalFlag(checkpointArgs, "--tool-call-id"),
        ...copyOptionalFlag(checkpointArgs, "--expected-head-sha"),
        ...copyOptionalFlag(checkpointArgs, "--expected-worktree-digest"),
        ...copyOptionalFlag(checkpointArgs, "--max-bytes"),
        ...copyOptionalFlag(checkpointArgs, "--max-items"),
        ...readRepeatedFlag(checkpointArgs, "--path").flatMap((path) => ["--path", path]),
        ...readRepeatedFlag(checkpointArgs, "--changed").flatMap((path) => ["--changed", path])
      ],
      cwd,
      await runtime(),
      "hook.checkpoint"
    );
    if (!result.ok || typeof result.data !== "object" || result.data === null) return result;
    return {
      ...result,
      data: {
        ...(result.data as Record<string, Json>),
        hookLog: hookLogRecord({
          event,
          changedPaths,
          reasonCode: String((result.data as any).reasonCode ?? "unknown"),
          elapsedMs: Date.now() - started,
          failOpen: false
        })
      } as Json
    };
  } catch (error) {
    return okEnvelope("hook.checkpoint", {
      schemaVersion: "archcontext.hook-checkpoint-fail-open/v1",
      accepted: false,
      failOpen: true,
      reasonCode: "runtime-unavailable",
      event,
      pathCount: changedPaths.length,
      egress: "none",
      network: "forbidden",
      hookLog: hookLogRecord({
        event,
        changedPaths,
        reasonCode: "runtime-unavailable",
        elapsedMs: Date.now() - started,
        failOpen: true
      }),
      message: error instanceof Error ? error.message : String(error)
    } as Json);
  }
}

function runHooksCommand(args: string[]) {
  const subcommand = args[0] ?? "status";
  if (!["install", "status", "remove"].includes(subcommand)) {
    return errorEnvelope("hooks", "AC_SCHEMA_INVALID", "hooks requires install|status|remove");
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
  return okEnvelope("hooks.remove", {
    ...adapter,
    installed: false,
    writes: "manual-host-config",
    removeConfig: hookHostRemoveConfig(host)
  } as any);
}

async function runGithubCommand(args: string[], cwd: string, deps: CliRuntimeDeps) {
  const subcommand = args[0] ?? "status";
  const connectionPath = defaultGithubConnectionPath(cwd);
  if (subcommand === "status") {
    const record = readGithubConnection(connectionPath);
    return okEnvelope("github.status", record ? sanitizeGithubConnection(record, connectionPath) : {
      connected: false,
      connectionPath,
      ghCli: "not-used"
    } as any);
  }
  if (subcommand === "connect") {
    const accountId = readFlag(args, "--account-id") ?? "acct_local";
    const githubUserId = readFlag(args, "--github-user-id") ?? "local";
    const publicKeyId = readFlag(args, "--public-key-id") ?? `key_device_${githubUserId}`;
    const issuer = readFlag(args, "--issuer") ?? "https://archcontext.repoharness.com";
    const clientId = readFlag(args, "--client-id") ?? "archctx";
    const redirectUri = readFlag(args, "--redirect-uri") ?? "http://127.0.0.1:8787/oauth/callback";
    const scopes = readRepeatedFlag(args, "--scope");
    const requestedScopes = scopes.length > 0 ? scopes : ["account:read", "device:write", "entitlement:read"];
    const connectedAt = readFlag(args, "--now") ?? new Date().toISOString();
    const {
      DevicePrivateKeyStore,
      KeychainTokenStore,
      createPkceAuthorizationRequest
    } = await import("@archcontext/cloud/control-plane-client");
    const tokenStore = deps.tokenStore ?? new KeychainTokenStore();
    const keyStore = deps.devicePrivateKeyStore ?? new DevicePrivateKeyStore();
    const pkce = createPkceAuthorizationRequest({
      issuer,
      clientId,
      redirectUri,
      scopes: requestedScopes,
      state: readFlag(args, "--state") ?? `archctx-${accountId}`,
      verifier: readFlag(args, "--verifier")
    });
    const codeVerifierRef = tokenStore.saveRefreshToken(`${accountId}/github-pkce`, pkce.codeVerifier);
    const refreshTokenRef = tokenStore.saveRefreshToken(`${accountId}/github-refresh`, `refresh_${accountId}_${Date.parse(connectedAt)}`);
    const deviceKey = keyStore.provisionDevicePrivateKey({
      accountId,
      publicKeyId,
      createdAt: connectedAt
    });
    const record: GitHubConnectionRecord = {
      schemaVersion: "archcontext.github-connection/v1",
      status: "connected",
      accountId,
      githubUserId,
      issuer,
      clientId,
      scopes: requestedScopes,
      authorizationUrl: pkce.authorizationUrl,
      codeVerifierRef,
      refreshTokenRef,
      deviceKey: deviceKey.reference,
      connectedAt
    };
    assertNoCliSecretMaterial(record);
    writeGithubConnection(connectionPath, record);
    return okEnvelope("github.connect", sanitizeGithubConnection(record, connectionPath) as any);
  }
  if (subcommand === "disconnect") {
    const record = readGithubConnection(connectionPath);
    if (!record) {
      return okEnvelope("github.disconnect", {
        disconnected: false,
        connected: false,
        connectionPath,
        ghCli: "not-used"
      } as any);
    }
    const { DevicePrivateKeyStore, KeychainTokenStore } = await import("@archcontext/cloud/control-plane-client");
    const tokenStore = deps.tokenStore ?? new KeychainTokenStore();
    const keyStore = deps.devicePrivateKeyStore ?? new DevicePrivateKeyStore();
    tokenStore.clear(record.codeVerifierRef);
    tokenStore.clear(record.refreshTokenRef);
    keyStore.removeDevicePrivateKey(record.deviceKey.keyRef);
    rmSync(connectionPath, { force: true });
    return okEnvelope("github.disconnect", {
      disconnected: true,
      connected: false,
      accountId: record.accountId,
      githubUserId: record.githubUserId,
      revokedDeviceKeyRef: record.deviceKey.keyRef,
      connectionPath,
      ghCli: "not-used"
    } as any);
  }
  if (subcommand === "review") {
    return runGithubReviewCommand(args.slice(1), cwd, deps, connectionPath);
  }
  if (subcommand === "verify-head") {
    const challengeResult = await readReviewChallengeV2Arg(args, cwd, "github verify-head");
    if (!challengeResult.ok) return errorEnvelope("github.verify-head", "AC_SCHEMA_INVALID", challengeResult.message);
    if (!deps.githubGovernancePort) {
      return errorEnvelope("github.verify-head", "AC_RUNTIME_UNAVAILABLE", "github verify-head requires a configured GitHub governance metadata port");
    }
    const { ControlPlane } = await import("@archcontext/cloud/control-plane");
    const result = await new ControlPlane().fetchAndVerifyReviewChallengePullHead({
      challenge: challengeResult.challenge,
      github: deps.githubGovernancePort
    });
    const data = { ...result, ghCli: "not-used" };
    assertNoCliSecretMaterial(data);
    return okEnvelope("github.verify-head", data as unknown as Json);
  }
  return errorEnvelope("github", "AC_SCHEMA_INVALID", "github requires connect|status|disconnect|review|verify-head");
}

async function runGithubReviewCommand(args: string[], cwd: string, deps: CliRuntimeDeps, connectionPath: string) {
  const actions = new Set(["claim", "run", "submit", "status", "retry", "cancel"]);
  const explicitAction = actions.has(args[0] ?? "") ? args[0] : undefined;
  const action = explicitAction ?? "submit";
  const commandArgs = explicitAction ? args.slice(1) : args;
  const pullRequestNumber = readPullRequestNumber(commandArgs);
  const statePath = defaultGithubDeveloperReviewStatePath(cwd, pullRequestNumber);

  if (action === "status") {
    const state = readGithubDeveloperReviewState(statePath);
    return okEnvelope("github.review.status", state
      ? sanitizeGithubDeveloperReviewState(state, statePath)
      : { status: "not_started", statePath, ghCli: "not-used" } as any);
  }

  if (action === "cancel") {
    const state = readGithubDeveloperReviewState(statePath);
    if (!state) return okEnvelope("github.review.cancel", { cancelled: false, status: "not_started", statePath, ghCli: "not-used" } as any);
    const cancelled = await writeGithubDeveloperReviewState(cwd, {
      ...state,
      status: "cancelled",
      updatedAt: readFlag(commandArgs, "--now") ?? new Date().toISOString()
    });
    return okEnvelope("github.review.cancel", { ...sanitizeGithubDeveloperReviewState(cancelled.state, cancelled.path), cancelled: true } as any);
  }

  const connection = readGithubConnection(connectionPath);
  if (!connection) {
    return errorEnvelope("github.review", "AC_RUNTIME_UNAVAILABLE", "github review requires archctx github connect first");
  }
  const sanitizedConnection = sanitizeGithubConnection(connection, connectionPath);
  const existing = readGithubDeveloperReviewState(statePath);
  if (action === "retry" && existing?.status === "cancelled" && !commandArgs.includes("--force")) {
    return errorEnvelope("github.review.retry", "AC_SCHEMA_INVALID", "github review retry requires --force after cancel");
  }
  const challengeResult = await resolveGithubReviewChallenge(commandArgs, cwd, deps, sanitizedConnection, action === "claim" ? undefined : existing?.challenge);
  if (!challengeResult.ok) return errorEnvelope(`github.review.${action}`, "AC_SCHEMA_INVALID", challengeResult.message);

  if (action === "claim") {
    return claimGithubDeveloperReview({
      args: commandArgs,
      cwd,
      deps,
      challenge: challengeResult.challenge,
      connection,
      existing
    });
  }

  const claimed = await claimGithubDeveloperReviewState({
    args: commandArgs,
    cwd,
    deps,
    challenge: challengeResult.challenge,
    connection,
    existing
  });
  if (!claimed.ok) return claimed.envelope;

  const runtime = await createCliRuntime(cwd, deps);
  let cleanup: Json | undefined;
  try {
    const prepared = await runtime.client.startDeveloperReviewRun({
      repositoryRoot: cwd,
      challenge: claimed.state.challenge,
      expectedHeadTreeOid: readFlag(commandArgs, "--expected-head-tree-oid")
    });
    if (!prepared.accepted || !prepared.run) {
      const failed = await writeGithubDeveloperReviewState(cwd, {
        ...claimed.state,
        status: "failed",
        reasonCode: prepared.reasonCode ?? "WORKTREE_PREPARE_FAILED",
        updatedAt: readFlag(commandArgs, "--now") ?? new Date().toISOString()
      });
      return okEnvelope(`github.review.${action}`, sanitizeGithubDeveloperReviewState(failed.state, failed.path) as unknown as Json);
    }

    try {
      const signed = await runtime.client.runSignedDeveloperReviewAttestation({
        challenge: claimed.state.challenge,
        worktree: prepared.run.worktree,
        keyRef: connection.deviceKey.keyRef,
        principalId: readFlag(commandArgs, "--principal-id") ?? connection.githubUserId,
        publicKeyId: readFlag(commandArgs, "--public-key-id") ?? connection.deviceKey.publicKeyId,
        taskSessionId: readFlag(commandArgs, "--task-session-id") ?? `github_pr_${claimed.state.challenge.pullRequestNumber}`,
        mergeBaseSha: readFlag(commandArgs, "--merge-base-sha"),
        startedAt: readFlag(commandArgs, "--started-at"),
        completedAt: readFlag(commandArgs, "--completed-at") ?? readFlag(commandArgs, "--now")
      });
      cleanup = await runtime.client.cleanupDeveloperReviewRun(prepared.run) as unknown as Json;
      const ran = await writeGithubDeveloperReviewState(cwd, {
        ...claimed.state,
        status: action === "run" ? "ran" : "ready_for_submit",
        review: {
          reviewId: signed.reviewSession.reviewId,
          reviewDigest: signed.reviewSession.reviewDigest,
          result: signed.reviewSession.reviewResult,
          attestationResult: signed.reviewSession.attestationResult,
          worktreeDigest: signed.reviewSession.digests.worktreeDigest,
          modelDigest: signed.reviewSession.digests.modelDigest,
          codeFactsDigest: signed.reviewSession.digests.codeFactsDigest
        },
        attestation: signed.attestation,
        attestationDigest: signed.attestationDigest,
        updatedAt: readFlag(commandArgs, "--now") ?? new Date().toISOString()
      });
      if (action === "run") {
        return okEnvelope("github.review.run", {
          ...sanitizeGithubDeveloperReviewState(ran.state, ran.path),
          cleanup
        } as unknown as Json);
      }
      const submitted = await submitGithubDeveloperReview(commandArgs, cwd, deps, ran.state);
      return okEnvelope("github.review.submit", {
        ...sanitizeGithubDeveloperReviewState(submitted.state, submitted.path),
        cleanup
      } as unknown as Json);
    } catch (error) {
      if (!cleanup) cleanup = await Promise.resolve(runtime.client.cleanupDeveloperReviewRun(prepared.run)).catch((cleanupError: unknown) => ({
        cleaned: false,
        errors: [cleanupError instanceof Error ? cleanupError.message : String(cleanupError)]
      })) as unknown as Json;
      const failed = await writeGithubDeveloperReviewState(cwd, {
        ...claimed.state,
        status: "failed",
        reasonCode: error instanceof Error ? error.message : String(error),
        updatedAt: readFlag(commandArgs, "--now") ?? new Date().toISOString()
      });
      return okEnvelope(`github.review.${action}`, {
        ...sanitizeGithubDeveloperReviewState(failed.state, failed.path),
        cleanup
      } as unknown as Json);
    }
  } finally {
    await runtime.close();
  }
}

async function claimGithubDeveloperReview(input: {
  args: string[];
  cwd: string;
  deps: CliRuntimeDeps;
  challenge: ReviewChallengeV2;
  connection: GitHubConnectionRecord;
  existing?: GitHubDeveloperReviewState;
}) {
  const claimed = await claimGithubDeveloperReviewState(input);
  return claimed.ok ? okEnvelope("github.review.claim", sanitizeGithubDeveloperReviewState(claimed.state, claimed.path) as unknown as Json) : claimed.envelope;
}

async function claimGithubDeveloperReviewState(input: {
  args: string[];
  cwd: string;
  deps: CliRuntimeDeps;
  challenge: ReviewChallengeV2;
  connection: GitHubConnectionRecord;
  existing?: GitHubDeveloperReviewState;
}): Promise<
  | { ok: true; state: GitHubDeveloperReviewState; path: string }
  | { ok: false; envelope: ReturnType<typeof errorEnvelope> | ReturnType<typeof okEnvelope> }
> {
  if (!input.deps.githubGovernancePort) {
    return { ok: false, envelope: errorEnvelope("github.review.claim", "AC_RUNTIME_UNAVAILABLE", "github review claim requires a configured GitHub governance metadata port") };
  }
  const { ControlPlane } = await import("@archcontext/cloud/control-plane");
  const controlPlane = new ControlPlane();
  const head = await controlPlane.fetchAndVerifyReviewChallengePullHead({
    challenge: input.challenge,
    github: input.deps.githubGovernancePort
  });
  const now = readFlag(input.args, "--now") ?? new Date().toISOString();
  const digest = await digestReviewChallenge(input.challenge);
  if (!head.accepted) {
    const failed = await writeGithubDeveloperReviewState(input.cwd, {
      schemaVersion: "archcontext.github-developer-review-state/v1",
      status: "failed",
      challenge: input.challenge,
      challengeDigest: digest,
      reasonCode: head.reasonCode ?? "HEAD_VERIFICATION_FAILED",
      updatedAt: now
    });
    return { ok: false, envelope: okEnvelope("github.review.claim", sanitizeGithubDeveloperReviewState(failed.state, failed.path) as unknown as Json) };
  }
  const lease = controlPlane.claimReviewChallengeLease({
    challenge: input.challenge,
    claimantId: readFlag(input.args, "--claimant-id") ?? input.connection.deviceKey.publicKeyId,
    now,
    currentLease: input.existing?.lease as any
  });
  const state = await writeGithubDeveloperReviewState(input.cwd, {
    schemaVersion: "archcontext.github-developer-review-state/v1",
    status: lease.claimed ? "claimed" : "failed",
    challenge: lease.challenge,
    challengeDigest: await digestReviewChallenge(lease.challenge),
    lease: lease.lease as unknown as Json,
    reasonCode: lease.reasonCode,
    updatedAt: now
  });
  if (!lease.claimed) {
    return { ok: false, envelope: okEnvelope("github.review.claim", sanitizeGithubDeveloperReviewState(state.state, state.path) as unknown as Json) };
  }
  return { ok: true, state: state.state, path: state.path };
}

async function submitGithubDeveloperReview(args: string[], cwd: string, deps: CliRuntimeDeps, state: GitHubDeveloperReviewState): Promise<{ state: GitHubDeveloperReviewState; path: string }> {
  if (!state.attestation || !state.attestationDigest) {
    return writeGithubDeveloperReviewState(cwd, {
      ...state,
      status: "failed",
      reasonCode: "ATTESTATION_UNAVAILABLE",
      updatedAt: readFlag(args, "--now") ?? new Date().toISOString()
    });
  }
  if (!deps.githubReviewSubmissionPort) {
    return writeGithubDeveloperReviewState(cwd, {
      ...state,
      status: "ready_for_submit",
      submission: {
        submitted: false,
        reasonCode: "SUBMISSION_TRANSPORT_UNAVAILABLE"
      } as Json,
      updatedAt: readFlag(args, "--now") ?? new Date().toISOString()
    });
  }
  const submission = await deps.githubReviewSubmissionPort.submitDeveloperReview({
    challenge: state.challenge,
    attestation: state.attestation,
    attestationDigest: state.attestationDigest
  });
  return writeGithubDeveloperReviewState(cwd, {
    ...state,
    status: "submitted",
    submission,
    updatedAt: readFlag(args, "--now") ?? new Date().toISOString()
  });
}

async function resolveGithubReviewChallenge(
  args: string[],
  cwd: string,
  deps: CliRuntimeDeps,
  connection: ReturnType<typeof sanitizeGithubConnection>,
  fallback?: ReviewChallengeV2
): Promise<{ ok: true; challenge: ReviewChallengeV2 } | { ok: false; message: string }> {
  const challengeInput = await readReviewChallengeV2Arg(args, cwd, "github review");
  if (challengeInput.ok) return challengeInput;
  const hasChallengeFlag = Boolean(readFlag(args, "--challenge-json") || readFlag(args, "--challenge-path"));
  if (hasChallengeFlag) return challengeInput;
  if (fallback) return { ok: true, challenge: fallback };
  const pullRequestNumber = readPullRequestNumber(args);
  if (pullRequestNumber && deps.githubReviewChallengePort) {
    return {
      ok: true,
      challenge: await deps.githubReviewChallengePort.fetchReviewChallenge({
        pullRequestNumber,
        connection
      })
    };
  }
  return { ok: false, message: "github review requires --challenge-json, --challenge-path, or --pr with a configured Challenge fetch port" };
}

function readPullRequestNumber(args: string[]): number | undefined {
  const raw = readFlag(args, "--pr") ?? readFlag(args, "--pull-request");
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error("--pr must be a positive integer");
  return value;
}

async function digestReviewChallenge(challenge: ReviewChallengeV2): Promise<string> {
  const attestation = await import("@archcontext/cloud/attestation");
  return attestation.reviewChallengeV2Digest(challenge);
}

function defaultGithubDeveloperReviewStatePath(cwd: string, pullRequestNumber?: number): string {
  const suffix = pullRequestNumber ? `github-developer-review-pr-${pullRequestNumber}.json` : "github-developer-review.json";
  return join(dirname(defaultDaemonConnectionPath(cwd)), suffix);
}

async function writeGithubDeveloperReviewState(cwd: string, state: GitHubDeveloperReviewState): Promise<{ state: GitHubDeveloperReviewState; path: string }> {
  const path = defaultGithubDeveloperReviewStatePath(cwd, state.challenge.pullRequestNumber);
  mkdirSync(dirname(path), { recursive: true });
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  assertNoCliSecretMaterial(serialized);
  writeFileSync(path, serialized, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(path, 0o600);
  return { state, path };
}

function readGithubDeveloperReviewState(path: string): GitHubDeveloperReviewState | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as GitHubDeveloperReviewState;
    if (parsed.schemaVersion !== "archcontext.github-developer-review-state/v1") return undefined;
    if (!parsed.challenge || typeof parsed.challenge.pullRequestNumber !== "number") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function sanitizeGithubDeveloperReviewState(state: GitHubDeveloperReviewState, statePath: string) {
  const data = {
    schemaVersion: state.schemaVersion,
    status: state.status,
    statePath,
    challenge: {
      challengeId: state.challenge.challengeId,
      installationId: state.challenge.installationId,
      repositoryId: state.challenge.repositoryId,
      pullRequestNumber: state.challenge.pullRequestNumber,
      headSha: state.challenge.headSha,
      baseSha: state.challenge.baseSha,
      requiredTrust: state.challenge.requiredTrust,
      policyProfileId: state.challenge.policyProfileId,
      status: state.challenge.status,
      createdAt: state.challenge.createdAt,
      expiresAt: state.challenge.expiresAt
    },
    challengeDigest: state.challengeDigest,
    lease: state.lease,
    review: state.review,
    attestationDigest: state.attestationDigest,
    submission: state.submission,
    reasonCode: state.reasonCode,
    updatedAt: state.updatedAt,
    ghCli: "not-used"
  };
  const serialized = JSON.stringify(data);
  assertNoCliSecretMaterial(serialized);
  if (serialized.includes(state.challenge.nonce)) throw new Error("github-review-nonce-output-forbidden");
  if (state.attestation?.signature.value && serialized.includes(state.attestation.signature.value)) throw new Error("github-review-signature-output-forbidden");
  return data;
}

function defaultGithubConnectionPath(cwd: string): string {
  return join(dirname(defaultDaemonConnectionPath(cwd)), "github-connection.json");
}

function readGithubConnection(path: string): GitHubConnectionRecord | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as GitHubConnectionRecord;
    if (parsed.schemaVersion !== "archcontext.github-connection/v1" || parsed.status !== "connected") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function writeGithubConnection(path: string, record: GitHubConnectionRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  assertNoCliSecretMaterial(serialized);
  writeFileSync(path, serialized, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(path, 0o600);
}

function sanitizeGithubConnection(record: GitHubConnectionRecord, connectionPath: string) {
  return {
    schemaVersion: record.schemaVersion,
    connected: true,
    status: record.status,
    accountId: record.accountId,
    githubUserId: record.githubUserId,
    issuer: record.issuer,
    clientId: record.clientId,
    scopes: record.scopes,
    authorizationUrl: record.authorizationUrl,
    codeVerifierRef: record.codeVerifierRef,
    refreshTokenRef: record.refreshTokenRef,
    deviceKey: record.deviceKey,
    connectedAt: record.connectedAt,
    connectionPath,
    ghCli: "not-used"
  };
}

async function readReviewChallengeV2Arg(args: string[], cwd: string, commandName = "github verify-head"): Promise<
  | { ok: true; challenge: ReviewChallengeV2 }
  | { ok: false; message: string }
> {
  const inline = readFlag(args, "--challenge-json");
  const challengePath = readFlag(args, "--challenge-path");
  if (inline && challengePath) return { ok: false, message: `${commandName} accepts only one of --challenge-json or --challenge-path` };
  if (!inline && !challengePath) return { ok: false, message: `${commandName} requires --challenge-json or --challenge-path` };
  try {
    const raw = inline ?? readFileSync(resolve(cwd, challengePath!), "utf8");
    const parsed = JSON.parse(raw);
    const attestation = await import("@archcontext/cloud/attestation");
    const assertReviewChallengeV2: (value: unknown) => asserts value is ReviewChallengeV2 = attestation.assertReviewChallengeV2;
    assertReviewChallengeV2(parsed);
    return { ok: true, challenge: parsed };
  } catch (error) {
    return { ok: false, message: `invalid ReviewChallenge v2: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function assertNoCliSecretMaterial(value: unknown): void {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (!serialized) return;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(serialized)) throw new Error("device-private-key-material-forbidden");
  if (/(^|["'\s])(?:file:\/\/|\/|\.\/|\.\.\/|~\/)[^"'\s]*(?:private|device|key)[^"'\s]*/i.test(serialized)) {
    throw new Error("device-private-key-file-ref-forbidden");
  }
  if (/(access|refresh|token)_[A-Za-z0-9_-]+/.test(serialized)) throw new Error("github-token-material-forbidden");
}

function runMcpCommand(args: string[]) {
  const subcommand = args[0] ?? "serve";
  if (subcommand === "serve" || subcommand === "start") {
    return okEnvelope("mcp", {
      command: "archctx mcp",
      stdout: "protocol-only",
      logs: "stderr"
    } as any);
  }
  if (!["install", "status", "remove"].includes(subcommand)) {
    return errorEnvelope("mcp", "AC_SCHEMA_INVALID", "mcp requires install|status|remove");
  }
  const host = readAgentHost(args);
  if (!host) return errorEnvelope("mcp", "AC_SCHEMA_INVALID", "--host must be codex, claude, or generic");
  if (subcommand === "install") {
    return okEnvelope("mcp.install", {
      host,
      installed: true,
      writes: "manual-host-config",
      serverName: "archcontext",
      config: agentHostConfig(host),
      marker: installMarker(host)
    } as any);
  }
  if (subcommand === "status") {
    return okEnvelope("mcp.status", {
      host,
      installed: "config-ready",
      serverName: "archcontext",
      config: agentHostConfig(host),
      command: "archctx mcp",
      transport: "stdio"
    } as any);
  }
  return okEnvelope("mcp.remove", {
    host,
    installed: false,
    writes: "manual-host-config",
    serverName: "archcontext",
    removeConfig: agentHostRemoveConfig(host),
    markerRemovedFrom: uninstallMarker(readFlag(args, "--content") ?? "", host)
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
    acceptedInput: {
      eventFlag: "--event",
      changedPathFlags: ["--path", "--changed"],
      toolCallIdFlag: "--tool-call-id",
      taskSessionIdFlag: "--task-session-id"
    },
    output: {
      checkpointSchemaVersion: "archcontext.practice-checkpoint/v1",
      failOpenSchemaVersion: "archcontext.hook-checkpoint-fail-open/v1"
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
      postEdit: "archctx hook checkpoint --event post-edit --path <changed-path>",
      postWrite: "archctx hook checkpoint --event post-write --path <changed-path>"
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
    repoHookSourceRequired: false
  };
}

function hookLogRecord(input: { event: string; changedPaths: string[]; reasonCode: string; elapsedMs: number; failOpen: boolean }) {
  return {
    schemaVersion: HOOK_LOG_SCHEMA_VERSION,
    event: input.event,
    elapsedMs: input.elapsedMs,
    pathCount: input.changedPaths.length,
    changedPathDigest: digestJson({
      paths: [...new Set(input.changedPaths)].sort()
    }),
    reasonCode: input.reasonCode,
    failOpen: input.failOpen,
    egress: "none",
    network: "forbidden"
  };
}

function readAgentHost(args: string[]): AgentHost | undefined {
  const host = readFlag(args, "--host") ?? "generic";
  return host === "codex" || host === "claude" || host === "generic" ? host : undefined;
}

function agentHostConfig(host: AgentHost) {
  const server = { command: "archctx", args: ["mcp"] };
  if (host === "generic") return { command: "archctx", args: ["mcp"], transport: "stdio" };
  return { mcpServers: { archcontext: server } };
}

function agentHostRemoveConfig(host: AgentHost) {
  if (host === "generic") return { command: null, args: [], transport: "stdio", remove: true };
  return { mcpServers: { archcontext: null } };
}

async function doctorReport(cwd: string, args: string[] = []) {
  const product = productVersionManifest();
  const paths = runtimePathsReport(cwd);
  const daemon = await doctorDaemon(cwd);
  const git = doctorGit(cwd);
  const sqlite = doctorSqlite(cwd);
  const permissions = doctorPermissions(cwd);
  const hardening = diagnostics();
  return {
    product,
    version: {
      product: product.product.version,
      cli: product.surfaces.cli.version,
      daemon: product.surfaces.daemon.version,
      mcp: product.surfaces.mcp.version,
      rpcSchemaVersion: product.runtime.localRpc.schemaVersion,
      schemaSetVersion: product.schemas.schemaSetVersion
    },
    daemon,
    sqlite,
    update: updateCheckReport({
      checkUpdates: args.includes("--check-updates") || process.env[UPDATE_CHECK_ENV] === "1"
    }),
    paths,
    codeGraph: product.runtime.codeGraph,
    git,
    permissions,
    egress: hardening.egress,
    hardening,
    ok: hardening.supportedNode && permissions.workspace.readable && permissions.workspace.writable && hardening.egress.ok
  };
}

type UpdateCheckStatus = "not-checked" | "current" | "update-available" | "latest-unavailable" | "compare-unavailable";

function updateCheckReport(opts: { checkUpdates: boolean; env?: NodeJS.ProcessEnv }) {
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
      checkUpdates: "https://registry.npmjs.org/"
    }
  };

  if (!opts.checkUpdates) {
    return {
      ...base,
      status: "not-checked" as UpdateCheckStatus,
      checkUpdates: false,
      updateAvailable: false,
      reason: `disabled; run archctx update --check or ${UPDATE_CHECK_ENV}=1 archctx doctor`
    };
  }

  const latest = readLatestPackageVersion(env);
  if (!latest.version) {
    return {
      ...base,
      status: "latest-unavailable" as UpdateCheckStatus,
      checkUpdates: true,
      updateAvailable: false,
      source: latest.source,
      error: latest.error ?? "unknown error",
      reason: "latest version unavailable"
    };
  }

  const comparison = compareVersions(currentVersion, latest.version);
  if (comparison === null) {
    return {
      ...base,
      status: "compare-unavailable" as UpdateCheckStatus,
      checkUpdates: true,
      updateAvailable: false,
      latestVersion: latest.version,
      source: latest.source,
      reason: "unable to compare semantic versions"
    };
  }

  if (comparison < 0) {
    return {
      ...base,
      status: "update-available" as UpdateCheckStatus,
      checkUpdates: true,
      updateAvailable: true,
      latestVersion: latest.version,
      source: latest.source,
      reason: `current=${currentVersion}; latest=${latest.version}`
    };
  }

  return {
    ...base,
    status: "current" as UpdateCheckStatus,
    checkUpdates: true,
    updateAvailable: false,
    latestVersion: latest.version,
    source: latest.source,
    reason: `current=${currentVersion}; latest=${latest.version}`
  };
}

function readLatestPackageVersion(env: NodeJS.ProcessEnv): { source: "env" | "npm"; version?: string; error?: string } {
  if (env[LATEST_VERSION_ENV]) {
    return { source: "env", version: env[LATEST_VERSION_ENV] };
  }

  const result = spawnSync("npm", ["view", RELEASE_PACKAGE_NAME, "version", "--json"], {
    encoding: "utf8",
    timeout: NPM_VIEW_TIMEOUT_MS,
    shell: false
  });
  if (result.status !== 0 || result.error) {
    return {
      source: "npm",
      error: trimUpdateError(result.stderr || result.stdout || String(result.error?.message ?? result.error ?? "npm view failed"))
    };
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

async function doctorDaemon(cwd: string) {
  const client = createRuntimeRpcClientFromConnectionFile(cwd);
  if (!client) {
    return {
      running: false,
      connectionPath: defaultDaemonConnectionPath(cwd),
      lockPath: defaultDaemonLockPath(cwd)
    };
  }
  const health = await client.health().catch(() => undefined);
  return {
    running: (health as any)?.ok === true,
    staleConnection: (health as any)?.ok !== true,
    rpcVersionCompatible: (health as any)?.schemaVersion === productVersionManifest().runtime.localRpc.schemaVersion,
    connection: client.connectionInfo(),
    health: (health as any)?.ok === true ? {
      composition: (health as any).composition,
      product: (health as any).product
    } : undefined
  };
}

function doctorGit(cwd: string) {
  try {
    const root = findRepositoryRoot(cwd);
    return {
      ok: true,
      root,
      headSha: readHeadSha(root)
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function doctorSqlite(cwd: string) {
  const paths = runtimeStatePaths(cwd);
  const path = paths.localStorePath;
  const legacyLocalStore = inspectLegacyLocalStoreMigration(cwd);
  return {
    path,
    exists: existsSync(path),
    migrations: productVersionManifest().runtime.sqliteMigrations,
    legacyPath: paths.legacyLocalStorePath,
    legacyExists: existsSync(paths.legacyLocalStorePath),
    legacyLocalStore
  };
}

function doctorPermissions(cwd: string) {
  const paths = runtimeStatePaths(cwd);
  const controlDir = dirname(defaultDaemonConnectionPath(cwd));
  return {
    workspace: pathAccess(cwd),
    stateRoot: pathAccess(paths.stateRoot),
    runtimeStateDir: pathAccess(paths.workspaceStateDir),
    controlDir: pathAccess(controlDir),
    sqlite: pathAccess(defaultLocalStorePath(cwd))
  };
}

function runtimePathsReport(cwd: string) {
  const paths = runtimeStatePaths(cwd);
  return {
    ...paths,
    legacyLocalStore: inspectLegacyLocalStoreMigration(cwd),
    runtimeRepositoryId: repositoryFingerprint(paths.repositoryRoot),
    repositoryTruthDir: join(paths.repositoryRoot, ".archcontext"),
    codeGraphIndexDir: join(paths.repositoryRoot, ".codegraph"),
    npmGlobalInstallState: "forbidden",
    overrides: {
      stateRootEnv: "ARCHCONTEXT_STATE_DIR",
      localStorePathEnv: "ARCHCONTEXT_LOCAL_STORE_PATH"
    }
  };
}

function pathAccess(path: string) {
  const exists = existsSync(path);
  return {
    path,
    exists,
    readable: canAccess(path, constants.R_OK),
    writable: canAccess(path, constants.W_OK),
    private: exists ? isPrivatePath(path) : undefined
  };
}

function canAccess(path: string, mode: number): boolean {
  try {
    accessSync(path, mode);
    return true;
  } catch {
    return false;
  }
}

function isPrivatePath(path: string): boolean {
  if (process.platform === "win32") return true;
  try {
    return (statSync(path).mode & 0o077) === 0;
  } catch {
    return false;
  }
}

async function createCliRuntime(cwd: string, deps: CliRuntimeDeps): Promise<CliRuntimeHandle> {
  if (deps.runtimeClient) return { client: deps.runtimeClient, close: async () => undefined };
  if (!deps.disableRpcDiscovery && !hasEmbeddedRuntimeDeps(deps)) {
    const fileIssue = runtimeRpcCompatibilityIssue(cwd);
    if (fileIssue?.pidAlive) throw new RuntimeVersionUnsupportedError(fileIssue);
    const client = createRuntimeRpcClientFromConnectionFile(cwd);
    if (client) {
      const health = await client.health().catch(() => undefined);
      const healthIssue = runtimeRpcCompatibilityIssueFromHealth(cwd, client, health);
      if (healthIssue) throw new RuntimeVersionUnsupportedError(healthIssue);
      if ((health as any)?.ok === true) return { client, close: async () => undefined };
      recoverStaleDaemonControlFiles(cwd, { removeUnhealthyConnection: true });
    } else {
      recoverStaleDaemonControlFiles(cwd);
    }
    const started = await startBackgroundDaemon([], cwd);
    if (!started.ok) throw new Error(started.error?.message ?? "archctxd did not start");
    const startedClient = createRuntimeRpcClientFromConnectionFile(cwd);
    if (startedClient) {
      const health = await startedClient.health().catch(() => undefined);
      if ((health as any)?.ok === true) return { client: startedClient, close: async () => undefined };
    }
    throw new Error("archctxd started but no healthy runtime RPC connection was available");
  }
  const {
    runtimeClient: _runtimeClient,
    disableRpcDiscovery: _disableRpcDiscovery,
    devicePrivateKeyStore,
    tokenStore: _tokenStore,
    githubGovernancePort: _githubGovernancePort,
    githubReviewChallengePort: _githubReviewChallengePort,
    githubReviewSubmissionPort: _githubReviewSubmissionPort,
    ...runtimeDeps
  } = deps;
  if (!runtimeDeps.localStorePath) migrateLegacyLocalStoreIfNeeded(cwd);
  const daemon = await createStartedDaemon({
    localStorePath: defaultLocalStorePath(cwd),
    ...runtimeDeps,
    devicePrivateKeySigner: runtimeDeps.devicePrivateKeySigner ?? devicePrivateKeyStore
  });
  return { client: daemon, close: () => daemon.stop() };
}

function hasEmbeddedRuntimeDeps(deps: CliRuntimeDeps): boolean {
  return [
    "codeFacts",
    "codeGraphProviderFactory",
    "modelStore",
    "localStore",
    "changeSetEngine",
    "localStorePath",
    "clock",
    "maxRepoSessions",
    "devicePrivateKeySigner",
    "devicePrivateKeyStore"
  ].some((key) => key in deps);
}

async function runDaemonCommand(args: string[], cwd: string) {
  const subcommand = args[0] ?? "status";
  if (subcommand === "status") {
    const client = createRuntimeRpcClientFromConnectionFile(cwd);
    if (!client) {
      const compatibilityIssue = runtimeRpcCompatibilityIssue(cwd);
      if (compatibilityIssue?.pidAlive) {
        return okEnvelope("daemon.status", incompatibleDaemonStatus(compatibilityIssue) as any);
      }
      const recovery = recoverStaleDaemonControlFiles(cwd);
      return okEnvelope("daemon.status", {
        running: false,
        protocol: "http-loopback",
        connectionPath: defaultDaemonConnectionPath(cwd),
        ...recoveryData(recovery)
      } as any);
    }
    const health = await client.health().catch(() => undefined);
    const healthIssue = runtimeRpcCompatibilityIssueFromHealth(cwd, client, health);
    if (healthIssue) {
      return okEnvelope("daemon.status", incompatibleDaemonStatus(healthIssue) as any);
    }
    if ((health as any)?.ok === true) {
      return okEnvelope("daemon.status", {
        running: true,
        product: (health as any).product,
        rpcVersionCompatible: (health as any).schemaVersion === RUNTIME_RPC_VERSION,
        ...client.connectionInfo(),
        token: "stored-in-connection-file"
      } as any);
    }
    const recovery = recoverStaleDaemonControlFiles(cwd, { removeUnhealthyConnection: true });
    return okEnvelope("daemon.status", {
      running: false,
      staleConnection: true,
      connectionPath: client.connectionInfo().connectionPath,
      ...recoveryData(recovery)
    } as any);
  }
  if (subcommand === "start") {
    if (args.includes("--foreground")) {
      return okEnvelope("daemon.start", {
        command: "archctx daemon start --foreground",
        protocol: "http-loopback",
        bindHost: "127.0.0.1",
        connectionPath: defaultDaemonConnectionPath(cwd),
        note: "foreground process writes the bearer token to the local connection file"
      } as any);
    }
    return startBackgroundDaemon(args, cwd);
  }
  if (subcommand === "upgrade") return upgradeDaemon(args, cwd);
  if (subcommand === "stop") {
    const client = createRuntimeRpcClientFromConnectionFile(cwd);
    if (!client) return errorEnvelope("daemon.stop", "AC_RUNTIME_UNAVAILABLE", "No archctxd connection file found");
    return client.shutdown();
  }
  return errorEnvelope("daemon", "AC_SCHEMA_INVALID", "daemon requires start|status|stop");
}

async function startBackgroundDaemon(args: string[], cwd: string) {
  const compatibilityIssue = runtimeRpcCompatibilityIssue(cwd);
  if (compatibilityIssue?.pidAlive) {
    return errorEnvelope("daemon.start", "AC_RUNTIME_VERSION_UNSUPPORTED", runtimeVersionUnsupportedMessage(compatibilityIssue));
  }
  const discovered = await discoverRunningDaemonInfo(cwd, { recoverStale: true });
  if (discovered.info) {
    return okEnvelope("daemon.start", {
      running: true,
      alreadyRunning: true,
      ...discovered.info,
      token: "stored-in-connection-file"
    } as any);
  }
  const recovery = discovered.recovery;

  const connectionPath = defaultDaemonConnectionPath(cwd);
  const controlDir = dirname(connectionPath);
  const logPath = join(controlDir, "archctxd.log");
  mkdirSync(controlDir, { recursive: true });
  const logFd = openSync(logPath, "a", 0o600);
  try {
    const child = spawn(process.execPath, [
      CLI_ENTRY,
      "daemon",
      "start",
      "--foreground",
      "--port",
      readFlag(args, "--port") ?? "0"
    ], {
      cwd,
      detached: true,
      env: process.env,
      stdio: ["ignore", logFd, logFd]
    });
    child.unref();
    const ready = await waitForDaemonReady(cwd, Number(readFlag(args, "--timeout-ms") ?? DAEMON_START_TIMEOUT_MS));
    if (!ready) {
      return errorEnvelope("daemon.start", "AC_RUNTIME_UNAVAILABLE", `archctxd did not become ready; log=${logPath}; logTail=${readFileTail(logPath)}`);
    }
    return okEnvelope("daemon.start", {
      running: true,
      background: true,
      childPid: child.pid,
      ...ready,
      logPath,
      token: "stored-in-connection-file",
      ...recoveryData(recovery)
    } as any);
  } finally {
    closeSync(logFd);
  }
}

async function upgradeDaemon(args: string[], cwd: string) {
  const issue = runtimeRpcCompatibilityIssue(cwd);
  if (!issue) {
    const started = await startBackgroundDaemon(args, cwd);
    return started.ok ? { ...started, requestId: "daemon.upgrade", data: { ...(started.data as any), upgraded: false, reason: "runtime-compatible" } } : started;
  }
  if (issue.pidAlive && issue.pid === undefined) {
    return errorEnvelope("daemon.upgrade", "AC_RUNTIME_VERSION_UNSUPPORTED", runtimeVersionUnsupportedMessage(issue));
  }
  if (issue.pidAlive && issue.pid !== undefined) {
    process.kill(issue.pid, "SIGTERM");
    const stopped = await waitForPidExit(issue.pid, Number(readFlag(args, "--timeout-ms") ?? DAEMON_START_TIMEOUT_MS));
    if (!stopped) {
      return errorEnvelope("daemon.upgrade", "AC_RUNTIME_VERSION_UNSUPPORTED", `Incompatible archctxd pid ${issue.pid} did not stop; stop it manually, then run archctx daemon upgrade.`);
    }
  }
  const recovery = recoverStaleDaemonControlFiles(cwd, { removeUnhealthyConnection: true });
  const started = await startBackgroundDaemon(args, cwd);
  return started.ok
    ? {
        ...started,
        requestId: "daemon.upgrade",
        data: {
          ...(started.data as any),
          upgraded: true,
          replacedRuntime: {
            previousRpcSchemaVersion: issue.received,
            expectedRpcSchemaVersion: issue.expected,
            previousPid: issue.pid
          },
          ...recoveryData(recovery)
        }
      }
    : started;
}

async function runningDaemonInfo(cwd: string) {
  return (await discoverRunningDaemonInfo(cwd)).info;
}

async function discoverRunningDaemonInfo(cwd: string, options: { recoverStale?: boolean } = {}) {
  const client = createRuntimeRpcClientFromConnectionFile(cwd);
  if (!client) {
    return {
      info: undefined,
      recovery: options.recoverStale ? recoverStaleDaemonControlFiles(cwd) : emptyRecovery(cwd)
    };
  }
  const health = await client.health().catch(() => undefined);
  if ((health as any)?.ok === true) {
    return { info: client.connectionInfo(), recovery: emptyRecovery(cwd) };
  }
  return {
    info: undefined,
    recovery: options.recoverStale ? recoverStaleDaemonControlFiles(cwd, { removeUnhealthyConnection: true }) : emptyRecovery(cwd)
  };
}

function runtimeRpcCompatibilityIssueFromHealth(
  cwd: string,
  client: { connectionInfo(): { pid?: number; connectionPath?: string; lockPath?: string } },
  health: unknown
): RuntimeRpcCompatibilityIssue | undefined {
  if (!(health && typeof health === "object")) return undefined;
  const body = health as { ok?: unknown; error?: unknown; expected?: unknown; received?: unknown };
  if (body.ok !== false || body.error !== "runtime RPC version mismatch") return undefined;
  const connection = client.connectionInfo();
  const pid = typeof connection.pid === "number" ? connection.pid : undefined;
  return {
    reason: "rpc-version-mismatch",
    expected: RUNTIME_RPC_VERSION,
    received: typeof body.expected === "string" ? body.expected : "unknown",
    connectionPath: connection.connectionPath ?? defaultDaemonConnectionPath(cwd),
    lockPath: connection.lockPath ?? defaultDaemonLockPath(cwd),
    pid,
    pidAlive: pid !== undefined ? isPidAlive(pid) : false,
    upgradeCommand: "archctx daemon upgrade"
  };
}

function incompatibleDaemonStatus(issue: RuntimeRpcCompatibilityIssue) {
  return {
    running: issue.pidAlive,
    protocol: "http-loopback",
    rpcVersionCompatible: false,
    connectionPath: issue.connectionPath,
    lockPath: issue.lockPath,
    pid: issue.pid,
    versionUnsupported: {
      reason: issue.reason,
      expected: issue.expected,
      received: issue.received,
      action: "upgrade-archctx-runtime",
      command: issue.upgradeCommand
    }
  };
}

function runtimeVersionUnsupportedMessage(issue: RuntimeRpcCompatibilityIssue): string {
  return `archctxd RPC version ${issue.received} is incompatible with this CLI (${issue.expected}); run ${issue.upgradeCommand} to replace the local daemon.`;
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await sleep(50);
  }
  return !isPidAlive(pid);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function emptyRecovery(cwd: string) {
  return {
    connectionPath: defaultDaemonConnectionPath(cwd),
    lockPath: defaultDaemonLockPath(cwd),
    removed: []
  };
}

function recoveryData(recovery: { removed: string[] }) {
  return recovery.removed.length > 0 ? { recoveredStaleControlFiles: recovery.removed } : {};
}

async function waitForDaemonReady(cwd: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await runningDaemonInfo(cwd);
    if (ready) return ready;
    await sleep(50);
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readFileTail(path: string, maxBytes = 4_096): string {
  try {
    const content = readFileSync(path, "utf8");
    return content.slice(Math.max(0, content.length - maxBytes)).replace(/\s+/g, " ").trim();
  } catch {
    return "<unavailable>";
  }
}

export async function runForegroundDaemon(cwd: string, args: string[]): Promise<void> {
  const daemon = await createStartedProductionDaemon({ root: cwd });
  let resolveStopped!: () => void;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  const server = new ArchctxRuntimeRpcServer(daemon, {
    root: cwd,
    port: Number(readFlag(args, "--port") ?? 0),
    onStop: resolveStopped
  });
  const connection = await server.start();
  const result = okEnvelope("daemon.start", {
    running: true,
    protocol: connection.protocol,
    version: connection.version,
    url: connection.url,
    pid: connection.pid,
    connectionPath: connection.connectionPath,
    lockPath: connection.lockPath,
    token: "stored-in-connection-file"
  } as any);
  process.stdout.write(`${renderResult(result, readFlag(args, "--format") ?? "json")}\n`);
  const stop = async () => {
    await server.stop();
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  await stopped;
}

function paginate(value: any, args: string[]) {
  const maxItems = Number(readFlag(args, "--max-items") ?? 0);
  if (!maxItems || !Array.isArray(value?.context?.relevantNodes)) return value;
  return {
    ...value,
    context: {
      ...value.context,
      relevantNodes: value.context.relevantNodes.slice(0, maxItems),
      page: { maxItems, hasMore: value.context.relevantNodes.length > maxItems }
    }
  };
}

function renderResult(result: any, format: string): string {
  if (format !== "human") return JSON.stringify(result, null, 2);
  if (!result.ok) return `ERROR ${result.error?.code}: ${result.error?.message}`;
  return `OK ${result.requestId}\n${JSON.stringify(result.data, null, 2)}`;
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function requireFlag(args: string[], flag: string): string {
  const value = readFlag(args, flag);
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function copyOptionalFlag(args: string[], flag: string): string[] {
  const value = readFlag(args, flag);
  return value === undefined ? [] : [flag, value];
}

function readForbiddenAttestationFlags(args: string[]): string[] {
  return CALLER_PROVIDED_ATTESTATION_FIELDS
    .map((field) => `--${field.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`)
    .filter((flag) => args.includes(flag) || args.some((arg) => arg.startsWith(`${flag}=`)));
}

function readRepeatedFlag(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}
