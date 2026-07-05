#!/usr/bin/env bun
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { accessSync, chmodSync, closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CALLER_PROVIDED_ATTESTATION_FIELDS, digestJson, errorEnvelope, okEnvelope, productVersionManifest } from "@archcontext/contracts";
import type { AgentJobV1, AttestationV2, GitHubGovernancePort, Json, ReviewChallengeV2 } from "@archcontext/contracts";
import { computeWorktreeDigest, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { DEFAULT_AGENT_ORCHESTRATION_POLICY, DEFAULT_AGENT_QUEUE_MAX_QUEUED_JOBS, DEFAULT_AGENT_QUEUE_MAX_RUNNING_JOBS_PER_REPOSITORY } from "@archcontext/core/agent-orchestrator";
import type { ArchitectureAuditRunV1 } from "@archcontext/core/architecture-ledger";
import { dependencyAudit, diagnostics, installMarker, secretScan, uninstallMarker } from "@archcontext/cloud/hardening";
import { defaultLocalStorePath, inspectLegacyLocalStoreMigration, migrateLegacyLocalStoreIfNeeded, runtimeStatePaths } from "@archcontext/local-runtime/local-store-sqlite";
import { findRepositoryRoot, readHeadSha } from "@archcontext/local-runtime/git-adapter";
import {
  ArchctxRuntimeRpcServer,
  AUDIT_RUN_DEFAULT_TIMEOUT_MS,
  RUNTIME_RPC_VERSION,
  createRuntimeRpcClientFromConnectionFile,
  createStartedDaemon,
  createStartedProductionDaemon,
  defaultDaemonConnectionPath,
  defaultDaemonLockPath,
  readRuntimeRpcConnectionFile,
  recoverStaleDaemonControlFiles,
  runtimeRpcCompatibilityIssue,
  type RuntimeRpcCompatibilityIssue,
  type RuntimeDaemonClient,
  type RuntimeAgentJobEnqueueGitInput,
  type RuntimeAuditRunInput,
  type RuntimeRecommendationInput,
  type RuntimeDeps
} from "@archcontext/local-runtime/runtime-daemon";
import { exportLikeC4Model, importLikeC4InitialModel } from "@archcontext/surfaces/adapter-likec4";
import { exportStructurizrWorkspace, importStructurizrInitialModel } from "@archcontext/surfaces/adapter-structurizr";
import { runStdioMcpLoop } from "@archcontext/surfaces/mcp-local";
import {
  exportMermaidModel,
  loadArchitectureDocumentationInputs,
  loadNativeModelFromArchContext,
  renderArchitectureDocumentationProjection,
  type ArchitectureDocumentationProjectionFile
} from "@archcontext/surfaces/renderer";

const [, , command, ...args] = process.argv;
const CLI_ENTRY = fileURLToPath(import.meta.url);
const DAEMON_START_TIMEOUT_ENV = "ARCHCONTEXT_DAEMON_START_TIMEOUT_MS";
const DAEMON_START_TIMEOUT_MS = process.platform === "win32" ? 150_000 : 15_000;
const RELEASE_PACKAGE_NAME = "archctx";
const UPDATE_CHECK_ENV = "ARCHCONTEXT_CHECK_UPDATES";
const LATEST_VERSION_ENV = "ARCHCONTEXT_LATEST_VERSION";
const NPM_VIEW_TIMEOUT_MS = 5_000;
const HOOK_ADAPTER_SCHEMA_VERSION = "archcontext.hook-adapter/v1";
const HOOK_LOG_SCHEMA_VERSION = "archcontext.hook-log/v1";
const HOOK_ADAPTER_NAME = "repo-harness-hook";
const HOOK_CHECKPOINT_TIMEOUT_MS = 5_000;
const HOOK_ENQUEUE_TIMEOUT_MS = 5_000;
const RUNTIME_AGENT_JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled", "superseded", "expired"] as const;
type RuntimeAgentJobStatus = AgentJobV1["status"];

class RuntimeVersionUnsupportedError extends Error {
  constructor(readonly issue: RuntimeRpcCompatibilityIssue) {
    super(runtimeVersionUnsupportedMessage(issue));
  }
}

if (import.meta.main) {
  if (command === "mcp" && args.length === 0) {
    await runStdioMcpLoop(
      stdinLines(),
      (line) => process.stdout.write(`${line}\n`),
      (line) => process.stderr.write(`${line}\n`),
      { runtimeResolver: (root) => createOrStartRuntimeRpcClient(root) }
    );
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
    if (result.ok === false) process.exitCode = 1;
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
    case "ledger":
      return runLedgerCommand(args, cwd, runtime);
    case "book":
      return runBookCommand(args, cwd, await runtime());
    case "recommendations":
      return runRecommendationsCommand(args, cwd, await runtime());
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
    case "docs":
      return runDocsCommand(args, cwd, await runtime());
    case "practices":
      return runPracticesCommand(args, cwd, await runtime());
    case "checkpoint":
      return runCheckpointCommand(args, cwd, await runtime(), "checkpoint");
    case "hook":
      return runHookCommand(args, cwd, runtime);
    case "hooks":
      return runHooksCommand(args);
    case "investigate":
      return runInvestigateCommand(args, cwd, await runtime());
    case "agents":
      return runAgentsCommand(args, cwd, await runtime());
    case "jobs":
      return runJobsCommand(args, cwd, await runtime());
    case "audit":
      return runAuditCommand(args, cwd, await runtime());
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
          commands: ["init", "sync", "validate", "context", "status", "daemon", "repo", "landscape", "ledger", "book", "recommendations", "explore", "prepare", "practices", "checkpoint", "hook", "hooks", "investigate", "agents", "jobs", "audit", "plan", "apply", "review", "complete", "github", "config", "mcp", "install", "uninstall", "doctor", "update", "paths", "privacy-audit", "export", "import", "tunnel"],
          examples: ["archctx init --name MyApp", "archctx ledger migrate --from-yaml --dry-run", "archctx ledger promote --mode authoritative --preflight --rollback-plan", "archctx book recommendations --open --explain", "archctx recommendations accept --id recommendation.<id> --reason 'Accepted after local readback.'", "archctx recommendations metrics", "archctx practices validate --strict", "archctx practices list --json", "archctx practices waivers", "archctx practices waive --practice-id modularity.no-new-cycle --owner team-architecture --reason 'External migration window requires this edge until cutover.' --review-at 2026-07-10T00:00:00.000Z --expires-at 2026-07-24T00:00:00.000Z --evidence-digest sha256:<64-hex> --subject module.a->module.b", "archctx checkpoint --task-session-id task_cli", "archctx investigate --runner-port codex", "archctx agents status --status queued,running", "archctx agents budget", "archctx hook enqueue --event post-edit --path src/app.ts", "archctx jobs list --status queued", "archctx audit run --reason 'quarterly architecture audit'", "archctx audit run --no-wait", "archctx audit list --status pending", "archctx audit show audit_run.<id>", "archctx audit approve audit_run.<id>", "archctx audit approve audit_run.<id> --confirm-public-repo public:<owner/repo>:<baseSha>:<runId>", "archctx audit approve audit_run.<id> --resume", "archctx hooks install --host codex", "archctx paths", "archctx update --check", "archctx doctor --check-updates", "archctx github connect", "archctx github status", "archctx daemon start", "archctx explore start --foreground", "archctx export likec4", "archctx import structurizr --content '<json>'", "archctx tunnel"]
        }
      };
    }
  } finally {
    for (const handle of runtimeHandles.reverse()) await handle.close();
  }
}

async function runLedgerCommand(args: string[], cwd: string, runtime?: () => Promise<RuntimeDaemonClient>) {
  const subcommand = args[0] ?? "status";
  if (subcommand === "status" || subcommand === "state") {
    const daemon = await requiredLedgerRuntime(runtime);
    return daemon.ledgerState(cwd);
  }
  if (subcommand === "drift") {
    const daemon = await requiredLedgerRuntime(runtime);
    return daemon.ledgerDrift(cwd);
  }
  if (subcommand === "promote") {
    if (args.includes("--write") || args.includes("--enable") || args.includes("--apply")) {
      return errorEnvelope("ledger.promote", "AC_SCHEMA_INVALID", "ledger promote is preflight-only; it does not write runtime config or enable authority");
    }
    const mode = readFlag(args, "--mode") ?? args[1];
    const targetMode = normalizeLedgerPromotionTargetMode(mode);
    if (!targetMode) {
      return errorEnvelope("ledger.promote", "AC_SCHEMA_INVALID", "ledger promote requires --mode authoritative");
    }
    if (!args.includes("--preflight")) {
      return errorEnvelope("ledger.promote", "AC_SCHEMA_INVALID", "ledger promote requires --preflight");
    }
    if (!args.includes("--rollback-plan")) {
      return errorEnvelope("ledger.promote", "AC_SCHEMA_INVALID", "ledger promote requires --rollback-plan");
    }
    const daemon = await requiredLedgerRuntime(runtime);
    return runLedgerPromotionPreflight(cwd, daemon, targetMode);
  }
  if (subcommand === "project") {
    if (!args.includes("--to-git")) {
      return errorEnvelope("ledger.project", "AC_SCHEMA_INVALID", "ledger project currently requires --to-git");
    }
    const write = args.includes("--write");
    if (write && args.includes("--dry-run")) {
      return errorEnvelope("ledger.project", "AC_SCHEMA_INVALID", "ledger project accepts --dry-run or --write, not both");
    }
    const expectedWorktreeDigest = readFlag(args, "--expected-worktree-digest");
    if (write && !expectedWorktreeDigest) {
      return errorEnvelope("ledger.project", "AC_SCHEMA_INVALID", "ledger project --to-git --write requires --expected-worktree-digest");
    }
    const daemon = await requiredLedgerRuntime(runtime);
    return daemon.ledgerProject(cwd, { dryRun: !write, expectedWorktreeDigest });
  }
  if (subcommand === "rebuild") {
    if (!args.includes("--from-git")) {
      return errorEnvelope("ledger.rebuild", "AC_SCHEMA_INVALID", "ledger rebuild currently requires --from-git");
    }
    const expectedWorktreeDigest = readFlag(args, "--expected-worktree-digest");
    if (!expectedWorktreeDigest) {
      return errorEnvelope("ledger.rebuild", "AC_SCHEMA_INVALID", "ledger rebuild --from-git requires --expected-worktree-digest");
    }
    const daemon = await requiredLedgerRuntime(runtime);
    return daemon.ledgerRebuild(cwd, {
      fromGit: true,
      expectedWorktreeDigest,
      acceptExternalProjection: args.includes("--accept-external-projection")
    });
  }
  if (subcommand === "rollback") {
    if (!args.includes("--to-yaml")) {
      return errorEnvelope("ledger.rollback", "AC_SCHEMA_INVALID", "ledger rollback currently requires --to-yaml");
    }
    const write = args.includes("--write");
    if (write && args.includes("--dry-run")) {
      return errorEnvelope("ledger.rollback", "AC_SCHEMA_INVALID", "ledger rollback accepts --dry-run or --write, not both");
    }
    const expectedWorktreeDigest = readFlag(args, "--expected-worktree-digest");
    if (write && !expectedWorktreeDigest) {
      return errorEnvelope("ledger.rollback", "AC_SCHEMA_INVALID", "ledger rollback --to-yaml --write requires --expected-worktree-digest");
    }
    const daemon = await requiredLedgerRuntime(runtime);
    return daemon.ledgerRollback(cwd, {
      toYaml: true,
      dryRun: !write,
      expectedWorktreeDigest
    });
  }
  if (subcommand === "migrate") {
    if (!args.includes("--from-yaml")) {
      return errorEnvelope("ledger.migrate", "AC_SCHEMA_INVALID", "ledger migrate currently requires --from-yaml");
    }
    const write = args.includes("--write");
    if (write && args.includes("--dry-run")) {
      return errorEnvelope("ledger.migrate", "AC_SCHEMA_INVALID", "ledger migrate accepts --dry-run or --write, not both");
    }
    const expectedWorktreeDigest = readFlag(args, "--expected-worktree-digest");
    if (write && !expectedWorktreeDigest) {
      return errorEnvelope("ledger.migrate", "AC_SCHEMA_INVALID", "ledger migrate --from-yaml --write requires --expected-worktree-digest");
    }
    const daemon = await requiredLedgerRuntime(runtime);
    return daemon.ledgerMigrate(cwd, {
      fromYaml: true,
      dryRun: !write,
      expectedWorktreeDigest
    });
  }
  return errorEnvelope("ledger", "AC_SCHEMA_INVALID", "ledger requires status, state, drift --json, promote --mode authoritative --preflight --rollback-plan, migrate --from-yaml, rebuild --from-git, rollback --to-yaml, or project --to-git");
}

async function requiredLedgerRuntime(runtime: (() => Promise<RuntimeDaemonClient>) | undefined): Promise<RuntimeDaemonClient> {
  if (!runtime) throw new Error("ledger command requires runtime daemon");
  return runtime();
}

function normalizeLedgerPromotionTargetMode(value: string | undefined): "ledger-authoritative" | undefined {
  if (value === "authoritative" || value === "ledger-authoritative" || value === "ledger") return "ledger-authoritative";
  return undefined;
}

async function runLedgerPromotionPreflight(cwd: string, daemon: RuntimeDaemonClient, targetMode: "ledger-authoritative") {
  const stateEnvelope = await daemon.ledgerState(cwd);
  if (!stateEnvelope.ok) return stateEnvelope;
  const driftEnvelope = await daemon.ledgerDrift(cwd);
  if (!driftEnvelope.ok) return driftEnvelope;
  const state = readObject(stateEnvelope.data);
  const driftData = readObject(driftEnvelope.data);
  const architectureLedger = readObject(state.architectureLedger);
  const phaseFlags = readObject(architectureLedger.phaseFlags);
  const currentPhase = String(phaseFlags.activePhase ?? architectureLedger.rolloutMode ?? "unknown");
  const worktree = readObject(state.worktree);
  const ledger = readObject(state.ledger);
  const yaml = readObject(state.yaml);
  const drift = readObject(driftData.drift ?? state.drift);
  const reconcile = readObject(driftData.reconcile ?? state.reconcile);
  const worktreeDigest = typeof worktree.worktreeDigest === "string" ? worktree.worktreeDigest : "<current>";
  const nextRequiredPhase = nextLedgerPromotionPhase(currentPhase);
  const preconditions = {
    currentPhase,
    targetMode,
    noModeSkip: currentPhase === "ledger-shadow" || currentPhase === targetMode,
    driftClean: drift.ok === true,
    reconcileClean: reconcile.ok === true,
    unsupportedYamlFilesAbsent: Number(yaml.unsupportedFileCount ?? 0) === 0,
    ledgerStatePresent: Number(ledger.entityCount ?? 0) + Number(ledger.relationCount ?? 0) + Number(ledger.constraintCount ?? 0) > 0,
    rollbackPlanPresent: true,
    hardEnforcementUnchanged: true
  };
  const alreadyActive = currentPhase === targetMode;
  const ready = !alreadyActive && Object.values(preconditions).every((value) => value === true || typeof value === "string");
  const reasonCodes = [
    ...(alreadyActive ? ["already-ledger-authoritative"] : []),
    ...(preconditions.noModeSkip ? [] : [`mode-sequence-not-ready:${currentPhase}->${nextRequiredPhase ?? "ledger-shadow"}`]),
    ...(preconditions.driftClean ? [] : ["ledger-yaml-drift-not-clean"]),
    ...(preconditions.reconcileClean ? [] : ["ledger-reconcile-not-clean"]),
    ...(preconditions.unsupportedYamlFilesAbsent ? [] : ["unsupported-yaml-files-present"]),
    ...(preconditions.ledgerStatePresent ? [] : ["ledger-state-empty"])
  ];
  return okEnvelope("ledger.promote", {
    schemaVersion: "archcontext.runtime-architecture-ledger-promotion-preflight/v1",
    targetMode,
    status: alreadyActive ? "already-active" : ready ? "ready" : "blocked",
    ready,
    writes: "none",
    sideEffects: {
      ledgerModeChanged: false,
      hardEnforcementChanged: false,
      sqliteMutated: false,
      yamlMutated: false
    },
    repository: state.repository,
    worktree: state.worktree,
    current: {
      phase: currentPhase,
      readMode: architectureLedger.readMode,
      writeMode: architectureLedger.writeMode,
      readAuthority: architectureLedger.readAuthority,
      writeAuthority: architectureLedger.writeAuthority,
      graphDigest: state.graphDigest,
      ledgerGraphDigest: ledger.graphDigest,
      yamlGraphDigest: yaml.graphDigest
    },
    preconditions,
    reasonCodes,
    nextRequiredPhase,
    recommendedEnvironment: {
      ARCHCONTEXT_LEDGER_MODE: targetMode,
      ARCHCONTEXT_LEDGER_READ_MODE: "ledger",
      ARCHCONTEXT_LEDGER_WRITE_MODE: "ledger-with-projection"
    },
    rollbackPlan: {
      required: true,
      targetAuthority: "yaml",
      dryRunCommand: "archctx ledger rollback --to-yaml --dry-run",
      command: `archctx ledger rollback --to-yaml --write --expected-worktree-digest ${worktreeDigest}`,
      commandTemplate: "archctx ledger rollback --to-yaml --write --expected-worktree-digest <current>",
      environment: {
        ARCHCONTEXT_LEDGER_MODE: "yaml",
        ARCHCONTEXT_LEDGER_READ_MODE: "yaml",
        ARCHCONTEXT_LEDGER_WRITE_MODE: "yaml"
      }
    },
    boundary: {
      advisoryDefaultPreserved: true,
      productionGaClaimed: false,
      hardEnforcementEnabled: false,
      operatorActionRequired: true
    }
  } as unknown as Json);
}

function nextLedgerPromotionPhase(currentPhase: string): string | null {
  if (currentPhase === "yaml") return "dual";
  if (currentPhase === "dual") return "ledger-shadow";
  if (currentPhase === "ledger-shadow") return "ledger-authoritative";
  if (currentPhase === "ledger-authoritative") return null;
  return "yaml";
}

function readObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

async function runBookCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  const subcommand = args[0] ?? "status";
  const maxItems = readOptionalNonNegativeIntegerFlag(args, "--max-items", "book");
  if (!maxItems.ok) return maxItems.envelope;
  const maxBytes = readOptionalPositiveIntegerFlag(args, "--max-bytes", "book");
  if (!maxBytes.ok) return maxBytes.envelope;
  const budget = {
    ...(maxItems.value === undefined ? {} : { maxItems: maxItems.value }),
    ...(maxBytes.value === undefined ? {} : { maxBytes: maxBytes.value })
  };
  if (subcommand === "status") return daemon.book(cwd, { command: "status", ...budget });
  if (subcommand === "query") {
    const task = readFlag(args, "--task") ?? readFlag(args, "--query") ?? args.slice(1).filter((arg) => !arg.startsWith("--")).join(" ").trim();
    if (!task) return errorEnvelope("book.query", "AC_SCHEMA_INVALID", "book query requires --task, --query, or query text");
    return daemon.book(cwd, { command: "query", task, explain: args.includes("--explain"), ...budget });
  }
  if (subcommand === "show") {
    const id = readFlag(args, "--id") ?? args[1];
    if (!id) return errorEnvelope("book.show", "AC_SCHEMA_INVALID", "book show requires <entity-id> or --id");
    return daemon.book(cwd, { command: "show", id, ...budget });
  }
  if (subcommand === "neighbors") {
    const id = readFlag(args, "--id") ?? args[1];
    if (!id) return errorEnvelope("book.neighbors", "AC_SCHEMA_INVALID", "book neighbors requires <entity-id> or --id");
    const depth = readOptionalNonNegativeIntegerFlag(args, "--depth", "book.neighbors");
    if (!depth.ok) return depth.envelope;
    return daemon.book(cwd, { command: "neighbors", id, ...(depth.value === undefined ? {} : { depth: depth.value }), ...budget });
  }
  if (subcommand === "timeline") {
    const id = readFlag(args, "--id") ?? (args[1]?.startsWith("--") ? undefined : args[1]);
    return daemon.book(cwd, {
      command: "timeline",
      ...(id === undefined ? {} : { id }),
      ...(readFlag(args, "--since") === undefined ? {} : { sinceRef: readFlag(args, "--since") }),
      ...budget
    });
  }
  if (subcommand === "diff") {
    return daemon.book(cwd, {
      command: "diff",
      fromRef: readFlag(args, "--from") ?? "empty",
      toRef: readFlag(args, "--to") ?? "current",
      ...budget
    });
  }
  if (subcommand === "evidence") {
    const id = readFlag(args, "--id") ?? args[1];
    if (!id) return errorEnvelope("book.evidence", "AC_SCHEMA_INVALID", "book evidence requires <finding-or-entity-id> or --id");
    return daemon.book(cwd, { command: "evidence", id, ...budget });
  }
  if (subcommand === "recommendations") {
    return daemon.book(cwd, { command: "recommendations", openOnly: args.includes("--open"), explain: args.includes("--explain"), ...budget });
  }
  if (subcommand === "export") {
    const format = readFlag(args, "--format") ?? "json";
    if (format !== "json" && format !== "yaml" && format !== "markdown") {
      return errorEnvelope("book.export", "AC_SCHEMA_INVALID", "book export --format must be json, yaml, or markdown");
    }
    return daemon.book(cwd, { command: "export", format, ...budget });
  }
  return errorEnvelope("book", "AC_SCHEMA_INVALID", "book requires status|query|show|neighbors|timeline|diff|evidence|recommendations|export");
}

async function runRecommendationsCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  const subcommand = args[0] ?? "metrics";
  if (subcommand === "metrics") {
    return daemon.recommendations(cwd, {
      command: "metrics",
      ...(readFlag(args, "--now") === undefined ? {} : { now: readFlag(args, "--now")! })
    });
  }
  if (!["acknowledge", "accept", "reject", "defer", "waive", "resolve"].includes(subcommand)) {
    return errorEnvelope("recommendations", "AC_SCHEMA_INVALID", "recommendations requires acknowledge|accept|reject|defer|waive|resolve|metrics");
  }
  const recommendationId = readFlag(args, "--id") ?? readFlag(args, "--recommendation-id") ?? args[1];
  if (!recommendationId || recommendationId.startsWith("--")) {
    return errorEnvelope(`recommendations.${subcommand}`, "AC_SCHEMA_INVALID", `recommendations ${subcommand} requires --id`);
  }
  const reason = readFlag(args, "--reason");
  if (!reason) return errorEnvelope(`recommendations.${subcommand}`, "AC_SCHEMA_INVALID", `recommendations ${subcommand} requires --reason`);
  const input: RuntimeRecommendationInput = {
    command: subcommand as RuntimeRecommendationInput["command"],
    recommendationId,
    reason,
    actor: readFlag(args, "--actor") ?? "developer",
    ...(readFlag(args, "--actor-kind") === undefined ? {} : { actorKind: readFlag(args, "--actor-kind")! as any }),
    ...(readFlag(args, "--source") === undefined ? {} : { source: readFlag(args, "--source")! as any }),
    ...(readFlag(args, "--expected-worktree-digest") === undefined ? {} : { expectedWorktreeDigest: readFlag(args, "--expected-worktree-digest")! }),
    ...(readFlag(args, "--agent-job-id") === undefined ? {} : { agentJobId: readFlag(args, "--agent-job-id")! }),
    ...(readFlag(args, "--now") === undefined ? {} : { now: readFlag(args, "--now")! })
  };
  return daemon.recommendations(cwd, input);
}

async function runDocsCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  const subcommand = args[0] ?? "status";
  if (["plan", "preview", "apply", "drift", "clean"].includes(subcommand)) {
    return runArchitectureDocsProjectionCommand(args, cwd, daemon);
  }
  if (!["status", "resolve", "pin", "fetch", "purge"].includes(subcommand)) {
    return errorEnvelope("docs", "AC_SCHEMA_INVALID", "docs requires status|resolve|pin|fetch|purge|plan|preview|apply|drift|clean");
  }
  if (subcommand === "status") {
    return daemon.docs(cwd, { command: "status", provider: "context7" });
  }
  if (subcommand === "resolve") {
    return daemon.docs(cwd, {
      command: "resolve",
      provider: "context7",
      libraryName: readFlag(args, "--library") ?? args[1],
      query: readFlag(args, "--query"),
      allowNetwork: args.includes("--allow-network")
    });
  }
  if (subcommand === "pin") {
    return daemon.docs(cwd, {
      command: "pin",
      provider: "context7",
      libraryId: readFlag(args, "--library-id") ?? args[1],
      version: readFlag(args, "--version"),
      approved: args.includes("--approved")
    });
  }
  if (subcommand === "fetch") {
    return daemon.docs(cwd, {
      command: "fetch",
      provider: "context7",
      libraryId: readFlag(args, "--library-id") ?? args[1],
      intent: readFlag(args, "--intent") ?? readFlag(args, "--query"),
      query: readFlag(args, "--query"),
      allowNetwork: args.includes("--allow-network"),
      forceRefresh: args.includes("--force-refresh")
    });
  }
  return daemon.docs(cwd, {
    command: "purge",
    provider: "context7",
    libraryId: readFlag(args, "--library-id"),
    all: args.includes("--all")
  });
}

async function runArchitectureDocsProjectionCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  const subcommand = args[0] ?? "plan";
  const root = findRepositoryRoot(cwd);
  const generatedAt = readFlag(args, "--generated-at") ?? new Date(0).toISOString();
  const projection = buildArchitectureDocsProjection(root, generatedAt);
  if (subcommand === "drift") {
    return okEnvelope("docs.drift", {
      schemaVersion: "archcontext.docs-drift/v1",
      ok: projection.plan.drift.ok,
      sourceDigest: projection.plan.sourceDigest,
      projectionDigest: projection.plan.projectionDigest,
      rendererVersion: projection.plan.rendererVersion,
      targetCount: projection.plan.targets.length,
      fileCount: projection.plan.files.length,
      drift: projection.plan.drift,
      rejected: projection.plan.rejected
    } as unknown as Json);
  }
  if (subcommand === "clean") {
    const orphaned = projection.plan.drift.diffs.filter((diff) => diff.reasonCode === "projection-orphaned");
    return okEnvelope("docs.clean", {
      schemaVersion: "archcontext.docs-clean-plan/v1",
      ok: orphaned.length === 0,
      orphanedCount: orphaned.length,
      orphaned,
      action: orphaned.length === 0 ? "none" : "manual-review-required-before-tombstone"
    } as unknown as Json);
  }
  if (projection.plan.rejected.length > 0) {
    return errorEnvelope("docs.plan", "AC_PRECONDITION_FAILED", `Architecture documentation projection rejected ambiguous ownership: ${projection.plan.rejected.map((diff) => diff.path).join(", ")}`);
  }
  const changeSetId = readFlag(args, "--id") ?? `changeset.docs-projection-${projection.plan.projectionDigest.replace(/^sha256:/, "").slice(0, 16)}`;
  const operations = [architectureDocsRenderProjectionOperation(root, projection.files)];
  const plan = await daemon.planUpdate(root, {
    id: changeSetId,
    reason: { taskSessionId: readFlag(args, "--task-session-id") ?? "task_docs_projection" },
    operations
  });
  if (!plan.ok) return plan;
  if (subcommand === "apply") {
    const expectedWorktreeDigest = readFlag(args, "--expected-worktree-digest") ?? computeWorktreeDigest(root);
    return daemon.applyUpdate(root, {
      id: changeSetId,
      approved: args.includes("--approved"),
      expectedWorktreeDigest
    });
  }
  return okEnvelope(subcommand === "preview" ? "docs.preview" : "docs.plan", {
    schemaVersion: "archcontext.docs-projection-change-set/v1",
    sourceDigest: projection.plan.sourceDigest,
    projectionDigest: projection.plan.projectionDigest,
    rendererVersion: projection.plan.rendererVersion,
    targetCount: projection.plan.targets.length,
    fileCount: projection.files.length,
    drift: projection.plan.drift,
    manifestPath: projection.manifest.path,
    draft: (plan.data as any).draft,
    preview: (plan.data as any).preview
  } as unknown as Json);
}

function buildArchitectureDocsProjection(root: string, generatedAt: string) {
  const loaded = loadArchitectureDocumentationInputs(root);
  const sourceDigest = digestJson({
    model: loaded.model,
    decisions: loaded.decisions.map((decision) => ({ id: decision.id, path: decision.path, title: decision.title, status: decision.status }))
  } as unknown as Json);
  const plan = renderArchitectureDocumentationProjection({
    model: loaded.model,
    decisions: loaded.decisions,
    existingFiles: loaded.existingFiles,
    sourceDigest,
    generatedAt
  });
  const manifestBody = `${JSON.stringify({
    schemaVersion: "archcontext.architecture-docs-projection-manifest/v1",
    rendererVersion: plan.rendererVersion,
    sourceDigest: plan.sourceDigest,
    projectionDigest: plan.projectionDigest,
    targetCount: plan.targets.length,
    fileCount: plan.files.length,
    targets: plan.targets.map((target) => ({
      targetId: target.targetId,
      type: target.type,
      scope: target.scope,
      path: target.path,
      ownership: target.ownership,
      rendererVersion: target.rendererVersion,
      format: target.format,
      sourceDigest: target.sourceDigest,
      outputDigest: target.outputDigest
    }))
  }, null, 2)}\n`;
  const manifest = {
    path: "docs/architecture/.projection-manifest.json",
    body: manifestBody,
    digest: digestJson({ path: "docs/architecture/.projection-manifest.json", body: manifestBody } as unknown as Json),
    target: plan.targets[0]!,
    generatedBodyDigest: digestJson({ body: manifestBody } as unknown as Json)
  } satisfies ArchitectureDocumentationProjectionFile;
  return {
    plan,
    manifest,
    files: [...plan.files, manifest]
  };
}

function architectureDocsRenderProjectionOperation(root: string, files: ArchitectureDocumentationProjectionFile[]) {
  return {
    op: "render_projection" as const,
    expectedHash: "missing",
    projectionFiles: files.map((file) => ({
      path: file.path,
      expectedHash: currentBodyHash(root, file.path),
      body: file.body
    }))
  };
}

function currentBodyHash(root: string, path: string): string {
  const absolute = resolve(root, path);
  return existsSync(absolute) ? digestJson({ body: readFileSync(absolute, "utf8") } as unknown as Json) : "missing";
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
    const required = ["--practice-id", "--owner", "--reason", "--review-at", "--expires-at", "--evidence-digest"];
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
      reviewAt: readFlag(args, "--review-at")!,
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
  const subcommand = args[0] ?? "enqueue";
  if (subcommand === "checkpoint") return runHookCheckpointCommand(args.slice(1), cwd, runtime);
  if (subcommand === "enqueue") return runHookEnqueueCommand(args.slice(1), cwd, runtime);
  return errorEnvelope("hook", "AC_SCHEMA_INVALID", "hook requires enqueue|checkpoint");
}

async function runHookCheckpointCommand(checkpointArgs: string[], cwd: string, runtime: () => Promise<RuntimeDaemonClient>) {
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

async function runHookEnqueueCommand(enqueueArgs: string[], cwd: string, runtime: () => Promise<RuntimeDaemonClient>) {
  const started = Date.now();
  const event = readFlag(enqueueArgs, "--event") ?? "post-edit";
  const changedPaths = [...readRepeatedFlag(enqueueArgs, "--path"), ...readRepeatedFlag(enqueueArgs, "--changed")];
  const sourceResult = readHookGitChangeSource(enqueueArgs, event);
  if (!sourceResult.ok) return sourceResult.envelope;
  const maxAttemptsResult = readOptionalPositiveIntegerFlag(enqueueArgs, "--max-attempts", "hook.enqueue");
  if (!maxAttemptsResult.ok) return maxAttemptsResult.envelope;
  const maxQueuedJobsResult = readOptionalPositiveIntegerFlag(enqueueArgs, "--max-queued-jobs", "hook.enqueue");
  if (!maxQueuedJobsResult.ok) return maxQueuedJobsResult.envelope;
  const priorityResult = readOptionalIntegerFlag(enqueueArgs, "--priority", "hook.enqueue");
  if (!priorityResult.ok) return priorityResult.envelope;
  const generatedProjection = enqueueArgs.includes("--generated-projection");
  if (shouldSkipGeneratedProjectionHook(enqueueArgs, changedPaths)) {
    return okEnvelope("hook.enqueue", {
      schemaVersion: "archcontext.hook-enqueue-skipped/v1",
      accepted: false,
      enqueued: false,
      skipped: true,
      failOpen: false,
      reasonCode: "archcontext-generated-projection",
      event,
      source: sourceResult.source,
      pathCount: changedPaths.length,
      egress: "none",
      network: "forbidden",
      hookLog: hookLogRecord({
        event,
        changedPaths,
        reasonCode: "archcontext-generated-projection",
        elapsedMs: Date.now() - started,
        failOpen: false
      })
    } as Json);
  }

  const input: RuntimeAgentJobEnqueueGitInput = {
    source: sourceResult.source,
    event,
    analysisKind: readFlag(enqueueArgs, "--analysis-kind") ?? "architecture-delta",
    ...(readFlag(enqueueArgs, "--risk") === undefined ? {} : { risk: readFlag(enqueueArgs, "--risk")! as any }),
    ...(readFlag(enqueueArgs, "--uncertainty") === undefined ? {} : { uncertainty: readFlag(enqueueArgs, "--uncertainty")! as any }),
    ...(enqueueArgs.includes("--policy-requested") ? { policyRequestedInvestigation: true } : {}),
    ...(readFlag(enqueueArgs, "--ref") === undefined ? {} : { ref: readFlag(enqueueArgs, "--ref")! }),
    ...(readFlag(enqueueArgs, "--base-ref") === undefined ? {} : { baseRef: readFlag(enqueueArgs, "--base-ref")! }),
    ...(readFlag(enqueueArgs, "--coalesce-key") === undefined ? {} : { coalesceKey: readFlag(enqueueArgs, "--coalesce-key")! }),
    ...(readFlag(enqueueArgs, "--debounce-until") === undefined ? {} : { debounceUntil: readFlag(enqueueArgs, "--debounce-until")! }),
    ...(maxAttemptsResult.value === undefined ? {} : { maxAttempts: maxAttemptsResult.value }),
    ...(maxQueuedJobsResult.value === undefined ? {} : { maxQueuedJobs: maxQueuedJobsResult.value }),
    ...(priorityResult.value === undefined ? {} : { priority: priorityResult.value }),
    ...(readFlag(enqueueArgs, "--runner-port") === undefined ? {} : { runnerPort: readFlag(enqueueArgs, "--runner-port")! as any }),
    ...(readFlag(enqueueArgs, "--code-facts-digest") === undefined ? {} : { codeFactsDigest: readFlag(enqueueArgs, "--code-facts-digest")! }),
    generatedProjection,
    skipGeneratedProjection: !enqueueArgs.includes("--no-generated-projection-guard")
  };

  try {
    const result = await (await runtime()).jobsEnqueueGitHook(cwd, input);
    if (!result.ok || typeof result.data !== "object" || result.data === null) return result;
    const data = result.data as Record<string, Json>;
    return {
      ...result,
      requestId: "hook.enqueue",
      data: {
        ...data,
        hookLog: hookLogRecord({
          event,
          changedPaths,
          reasonCode: hookEnqueueReasonCode(data),
          elapsedMs: Date.now() - started,
          failOpen: false
        })
      } as Json
    };
  } catch (error) {
    return okEnvelope("hook.enqueue", {
      schemaVersion: "archcontext.hook-enqueue-fail-open/v1",
      accepted: false,
      enqueued: false,
      failOpen: true,
      reasonCode: "runtime-unavailable",
      event,
      source: sourceResult.source,
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
        { id: "entrypoint", status: "pass", command: "archctx hook enqueue" },
        { id: "fail-open", status: "pass", schemaVersion: "archcontext.hook-enqueue-fail-open/v1" },
        { id: "egress", status: "pass", egress: "none", network: "forbidden" },
        { id: "recursion-guard", status: "pass", generatedProjectionFlag: "--generated-projection" }
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

async function runJobsCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  const subcommand = args[0] ?? "list";
  if (subcommand === "list") {
    const statusResult = readRuntimeAgentJobStatuses(args, "jobs.list");
    if (!statusResult.ok) return statusResult.envelope;
    return daemon.jobsList(cwd, { ...(statusResult.statuses.length === 0 ? {} : { statuses: statusResult.statuses }) });
  }
  if (subcommand === "stats") {
    return daemon.jobsStats(cwd, { ...(readFlag(args, "--now") === undefined ? {} : { now: readFlag(args, "--now")! }) });
  }
  if (subcommand === "show") {
    const jobId = readFlag(args, "--job-id") ?? args[1];
    if (!jobId) return errorEnvelope("jobs.show", "AC_SCHEMA_INVALID", "jobs show requires <job-id> or --job-id");
    const statusResult = readRuntimeAgentJobStatuses(args, "jobs.show");
    if (!statusResult.ok) return statusResult.envelope;
    const list = await daemon.jobsList(cwd, { ...(statusResult.statuses.length === 0 ? {} : { statuses: statusResult.statuses }) });
    if (!list.ok || typeof list.data !== "object" || list.data === null) return list;
    const jobs = Array.isArray((list.data as any).jobs) ? (list.data as any).jobs : [];
    const job = jobs.find((record: any) => record?.job?.jobId === jobId);
    if (!job) return errorEnvelope("jobs.show", "AC_SCHEMA_INVALID", `runtime agent job not found: ${jobId}`);
    return okEnvelope("jobs.show", { job, found: true } as unknown as Json);
  }
  if (subcommand === "cancel") {
    const jobId = readFlag(args, "--job-id") ?? args[1];
    if (!jobId) return errorEnvelope("jobs.cancel", "AC_SCHEMA_INVALID", "jobs cancel requires <job-id> or --job-id");
    const status = readFlag(args, "--status");
    if (status !== undefined && !["cancelled", "superseded", "expired"].includes(status)) {
      return errorEnvelope("jobs.cancel", "AC_SCHEMA_INVALID", "jobs cancel --status must be cancelled, superseded, or expired");
    }
    return daemon.jobsCancel(cwd, {
      jobId,
      ...(status === undefined ? {} : { status: status as Extract<RuntimeAgentJobStatus, "cancelled" | "superseded" | "expired"> }),
      ...(readFlag(args, "--reason") === undefined ? {} : { reason: readFlag(args, "--reason")! }),
      ...(readFlag(args, "--superseded-by-job-id") === undefined ? {} : { supersededByJobId: readFlag(args, "--superseded-by-job-id")! })
    });
  }
  if (subcommand === "retry") {
    const jobId = readFlag(args, "--job-id") ?? args[1];
    if (!jobId) return errorEnvelope("jobs.retry", "AC_SCHEMA_INVALID", "jobs retry requires <job-id> or --job-id");
    return daemon.jobsRetry(cwd, {
      jobId,
      ...(readFlag(args, "--reason") === undefined ? {} : { reason: readFlag(args, "--reason")! })
    });
  }
  return errorEnvelope("jobs", "AC_SCHEMA_INVALID", "jobs requires list|stats|show|cancel|retry");
}

const AUDIT_RUN_STATUSES = ["pending", "issuing", "issued", "failed"] as const;
type AuditRunStatus = ArchitectureAuditRunV1["status"];

function readAuditRunStatuses(args: string[], requestId: string):
  | { ok: true; statuses: AuditRunStatus[] }
  | { ok: false; envelope: ReturnType<typeof errorEnvelope> } {
  const statuses = readRepeatedFlag(args, "--status")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const invalid = statuses.find((status) => !(AUDIT_RUN_STATUSES as readonly string[]).includes(status));
  if (invalid) {
    return { ok: false, envelope: errorEnvelope(requestId, "AC_SCHEMA_INVALID", `unknown audit run status: ${invalid}`) };
  }
  return { ok: true, statuses: statuses as AuditRunStatus[] };
}

function auditManifestGateRoot(cwd: string): string {
  try {
    return findRepositoryRoot(cwd);
  } catch {
    // No Git repository found from cwd; keep this gate's pre-existing fail-closed behavior by
    // falling back to cwd itself (manifest lookup below then fails closed to disabled).
    return cwd;
  }
}

function auditGithubIssuesEnabled(cwd: string): boolean {
  const manifestPath = resolve(auditManifestGateRoot(cwd), ".archcontext/manifest.yaml");
  if (!existsSync(manifestPath)) return false;
  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch {
    return false;
  }
  let inAudit = false;
  let inGithubIssues = false;
  for (const rawLine of raw.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    if (indent === 0) {
      inAudit = trimmed === "audit:";
      inGithubIssues = false;
      continue;
    }
    if (indent === 2 && inAudit) {
      inGithubIssues = trimmed === "githubIssues:";
      continue;
    }
    if (indent === 4 && inAudit && inGithubIssues && trimmed === "enabled: true") {
      return true;
    }
  }
  return false;
}

async function runAuditCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  const subcommand = args[0] ?? "run";
  if (subcommand === "list") {
    const statusResult = readAuditRunStatuses(args, "audit.list");
    if (!statusResult.ok) return statusResult.envelope;
    return daemon.auditList(cwd, { ...(statusResult.statuses.length === 0 ? {} : { statuses: statusResult.statuses }) });
  }
  if (subcommand === "show") {
    const runId = readFlag(args, "--run-id") ?? args[1];
    if (!runId) return errorEnvelope("audit.show", "AC_SCHEMA_INVALID", "audit show requires <run-id> or --run-id");
    const result = await daemon.auditShow(cwd, runId);
    if (!result.ok) return result;
    return { ...result, data: auditShowDataWithFiledSummary(result.data) };
  }
  if (subcommand === "approve") {
    const runId = readFlag(args, "--run-id") ?? args[1];
    if (!runId) return errorEnvelope("audit.approve", "AC_SCHEMA_INVALID", "audit approve requires <run-id> or --run-id");
    if (!auditGithubIssuesEnabled(cwd)) {
      return errorEnvelope(
        "audit.approve",
        "AC_CAPABILITY_UNSUPPORTED",
        "archctx audit approve is disabled; set audit.githubIssues.enabled: true in .archcontext/manifest.yaml to enable it"
      );
    }
    const confirmPublicToken = readFlag(args, "--confirm-public-repo");
    const result = await daemon.auditApprove(cwd, {
      runId,
      ...(confirmPublicToken === undefined ? {} : { confirmPublicToken }),
      ...(args.includes("--resume") ? { resume: true } : {})
    });
    // CLI is a pure trigger here (no gh, no PAT, no body files): the daemon already composed the
    // full copy-pasteable rerun command into error.message, this just surfaces it as a warning
    // alongside the normal envelope rather than requiring the caller to dig it out of JSON.
    if (!result.ok && result.error?.code === "AC_USER_CONFIRMATION_REQUIRED") {
      process.stderr.write(`warning: ${result.error.message}\n`);
    }
    return { ...result, requestId: "audit.approve" };
  }
  if (subcommand !== "run") {
    return errorEnvelope("audit", "AC_SCHEMA_INVALID", "audit requires run|list|show|approve");
  }
  if (!auditGithubIssuesEnabled(cwd)) {
    return errorEnvelope(
      "audit.run",
      "AC_CAPABILITY_UNSUPPORTED",
      "archctx audit run is disabled; set audit.githubIssues.enabled: true in .archcontext/manifest.yaml to enable it"
    );
  }
  const contextMaxItemsResult = readOptionalPositiveIntegerFlag(args, "--context-max-items", "audit.run");
  if (!contextMaxItemsResult.ok) return contextMaxItemsResult.envelope;
  const timeoutMsResult = readOptionalPositiveIntegerFlag(args, "--timeout-ms", "audit.run");
  if (!timeoutMsResult.ok) return timeoutMsResult.envelope;
  const input: RuntimeAuditRunInput = {
    ...(readFlag(args, "--task-session-id") === undefined ? {} : { taskSessionId: readFlag(args, "--task-session-id")! }),
    ...(readFlag(args, "--reason") === undefined ? {} : { reason: readFlag(args, "--reason")! }),
    ...(readFlag(args, "--risk") === undefined ? {} : { risk: readFlag(args, "--risk")! as any }),
    ...(readFlag(args, "--uncertainty") === undefined ? {} : { uncertainty: readFlag(args, "--uncertainty")! as any }),
    ...(contextMaxItemsResult.value === undefined ? {} : { contextMaxItems: contextMaxItemsResult.value }),
    ...(readFlag(args, "--model-id") === undefined ? {} : { modelId: readFlag(args, "--model-id")! }),
    ...(timeoutMsResult.value === undefined ? {} : { timeoutMs: timeoutMsResult.value })
  };
  const started = await daemon.auditRun(cwd, input);
  if (!started.ok) return { ...started, requestId: "audit.run" };
  const startedData = started.data as { status?: string; jobId?: string } | undefined;
  // The daemon defaults to async ("started" + jobId, driven to completion in the background) so
  // this RPC call itself never has to stay open for the run's full 10-25 minute duration. Anything
  // other than "started" (a `--no-wait` request, or a daemon that already returned a terminal
  // status directly) is already final — nothing to poll for.
  if (args.includes("--no-wait") || startedData?.status !== "started" || !startedData.jobId) {
    return { ...started, requestId: "audit.run" };
  }
  const jobId = startedData.jobId;
  const pollTimeoutMs = timeoutMsResult.value ?? AUDIT_RUN_DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + pollTimeoutMs;
  // How often this poll loop re-checks `audit list` while waiting for a "started" run to reach a
  // terminal status. Scoped to this function (not module-level) so it can never be reached through
  // a module-evaluation-order path that hasn't finished initializing it yet.
  const pollIntervalMs = 5_000;
  process.stderr.write(`archctx audit run: ${jobId} started, polling \`archctx audit list\` every ${Math.round(pollIntervalMs / 1000)}s (pass --no-wait to return immediately instead)...\n`);
  // Check before sleeping (so an already-finished run — or a tiny --timeout-ms in tests — is
  // reported without an unnecessary trailing wait), then sleep only if the deadline hasn't
  // already passed, so this always makes at least one `audit list` attempt.
  for (;;) {
    const list = await daemon.auditList(cwd, {});
    if (list.ok) {
      const runs = (list.data as { runs?: { runId: string; jobId: string; status: AuditRunStatus; reportId: string; issueDraftDigests?: string[] }[] } | undefined)?.runs ?? [];
      const match = runs.find((run) => run.jobId === jobId);
      if (match && (match.status === "pending" || match.status === "failed")) {
        return okEnvelope("audit.run", {
          schemaVersion: "archcontext.audit-run-result/v1",
          runId: match.runId,
          status: match.status,
          jobId: match.jobId,
          reportId: match.reportId,
          pendingDraftCount: match.status === "pending" ? (match.issueDraftDigests?.length ?? 0) : 0
        } as unknown as Json);
      }
    }
    if (Date.now() >= deadline) break;
    const elapsedSeconds = Math.round((Date.now() - (deadline - pollTimeoutMs)) / 1000);
    process.stderr.write(`archctx audit run: ${jobId} is still running (${elapsedSeconds}s elapsed)...\n`);
    await sleep(pollIntervalMs);
  }
  // A poll timeout is not a run failure: the daemon may well still be driving the investigation to
  // completion in the background past this CLI call's own patience budget.
  return errorEnvelope(
    "audit.run",
    "AC_PRECONDITION_FAILED",
    `archctx audit run: job ${jobId} has not reached a terminal status after ${Math.round(pollTimeoutMs / 1000)}s; this is not a failure, the daemon may still be running it — check later with: archctx audit list`
  );
}

/**
 * Presentation-only reshaping of `audit.show`'s already-fetched data (the same kind of shaping
 * `paginate` does for `prepare`), not a new read or decision: joins each returned draft against
 * `run.issuedIssues` by `draftDigest` so a human can see which drafts are already filed without
 * cross-referencing two arrays by hand, and adds a `filed: "N/M"` summary.
 */
function auditShowDataWithFiledSummary(data: unknown): Json {
  const record = (data ?? {}) as {
    run?: { issueDraftDigests?: string[]; issuedIssues?: { draftDigest?: string; number: number; url: string }[] };
    githubIssueDrafts?: { draftDigest?: string }[];
  };
  const total = record.githubIssueDrafts?.length ?? record.run?.issueDraftDigests?.length ?? 0;
  const issuedByDraftDigest = new Map(
    (record.run?.issuedIssues ?? [])
      .filter((issue): issue is { draftDigest: string; number: number; url: string } => typeof issue.draftDigest === "string")
      .map((issue) => [issue.draftDigest, { number: issue.number, url: issue.url }])
  );
  const githubIssueDrafts = (record.githubIssueDrafts ?? []).map((draft) => {
    const issued = typeof draft.draftDigest === "string" ? issuedByDraftDigest.get(draft.draftDigest) : undefined;
    return issued ? { ...draft, issued } : draft;
  });
  const issuedCount = githubIssueDrafts.filter((draft) => "issued" in draft).length;
  return { ...record, githubIssueDrafts, filed: `${issuedCount}/${total}` } as unknown as Json;
}

async function runInvestigateCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  const sourceResult = readCliGitChangeSource(args, "investigate", "worktree");
  if (!sourceResult.ok) return sourceResult.envelope;
  const runnerPortResult = readAgentRunnerPort(args, "investigate");
  if (!runnerPortResult.ok) return runnerPortResult.envelope;
  const maxAttemptsResult = readOptionalPositiveIntegerFlag(args, "--max-attempts", "investigate");
  if (!maxAttemptsResult.ok) return maxAttemptsResult.envelope;
  const maxQueuedJobsResult = readOptionalPositiveIntegerFlag(args, "--max-queued-jobs", "investigate");
  if (!maxQueuedJobsResult.ok) return maxQueuedJobsResult.envelope;
  const contextMaxItemsResult = readOptionalPositiveIntegerFlag(args, "--context-max-items", "investigate");
  if (!contextMaxItemsResult.ok) return contextMaxItemsResult.envelope;
  const priorityResult = readOptionalIntegerFlag(args, "--priority", "investigate");
  if (!priorityResult.ok) return priorityResult.envelope;
  const cooldownMsResult = readOptionalNonNegativeIntegerFlag(args, "--cooldown-ms", "investigate");
  if (!cooldownMsResult.ok) return cooldownMsResult.envelope;

  const event = readFlag(args, "--event") ?? "manual";
  const input: RuntimeAgentJobEnqueueGitInput = {
    source: sourceResult.source,
    event,
    analysisKind: readFlag(args, "--analysis-kind") ?? "architecture-delta",
    ...(readFlag(args, "--risk") === undefined ? {} : { risk: readFlag(args, "--risk")! as any }),
    ...(readFlag(args, "--uncertainty") === undefined ? {} : { uncertainty: readFlag(args, "--uncertainty")! as any }),
    policyRequestedInvestigation: true,
    ...(readFlag(args, "--task-session-id") === undefined ? {} : { taskSessionId: readFlag(args, "--task-session-id")! }),
    ...(readFlag(args, "--ref") === undefined ? {} : { ref: readFlag(args, "--ref")! }),
    ...(readFlag(args, "--base-ref") === undefined ? {} : { baseRef: readFlag(args, "--base-ref")! }),
    ...(readFlag(args, "--coalesce-key") === undefined ? {} : { coalesceKey: readFlag(args, "--coalesce-key")! }),
    ...(readFlag(args, "--debounce-until") === undefined ? {} : { debounceUntil: readFlag(args, "--debounce-until")! }),
    ...(maxAttemptsResult.value === undefined ? {} : { maxAttempts: maxAttemptsResult.value }),
    ...(maxQueuedJobsResult.value === undefined ? {} : { maxQueuedJobs: maxQueuedJobsResult.value }),
    ...(contextMaxItemsResult.value === undefined ? {} : { contextMaxItems: contextMaxItemsResult.value }),
    ...(cooldownMsResult.value === undefined ? {} : { cooldownMs: cooldownMsResult.value }),
    ...(priorityResult.value === undefined ? {} : { priority: priorityResult.value }),
    ...(runnerPortResult.runnerPort === undefined ? {} : { runnerPort: runnerPortResult.runnerPort }),
    ...(readFlag(args, "--code-facts-digest") === undefined ? {} : { codeFactsDigest: readFlag(args, "--code-facts-digest")! }),
    generatedProjection: args.includes("--generated-projection"),
    skipGeneratedProjection: !args.includes("--no-generated-projection-guard")
  };
  const result = await daemon.jobsEnqueueGitHook(cwd, input);
  if (!result.ok || typeof result.data !== "object" || result.data === null) return { ...result, requestId: "investigate" };
  return {
    ...result,
    requestId: "investigate",
    data: {
      schemaVersion: "archcontext.investigate-enqueue/v1",
      ...(result.data as Record<string, Json>),
      runnerPort: input.runnerPort ?? "codex",
      analysisKind: input.analysisKind,
      source: input.source,
      event
    } as unknown as Json
  };
}

async function runAgentsCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  const subcommand = args[0] ?? "status";
  if (subcommand === "status") {
    const statusResult = readRuntimeAgentJobStatuses(args, "agents.status");
    if (!statusResult.ok) return statusResult.envelope;
    const statuses = statusResult.statuses.length === 0 ? ["queued", "running"] as RuntimeAgentJobStatus[] : statusResult.statuses;
    const stats = await daemon.jobsStats(cwd, { ...(readFlag(args, "--now") === undefined ? {} : { now: readFlag(args, "--now")! }) });
    if (!stats.ok) return { ...stats, requestId: "agents.status" };
    const list = await daemon.jobsList(cwd, { statuses });
    if (!list.ok || typeof list.data !== "object" || list.data === null) return { ...list, requestId: "agents.status" };
    const jobs = Array.isArray((list.data as any).jobs) ? (list.data as any).jobs : [];
    return okEnvelope("agents.status", {
      schemaVersion: "archcontext.agent-status/v1",
      statuses,
      stats: stats.data as Json,
      jobs,
      count: jobs.length
    } as unknown as Json);
  }
  if (subcommand === "budget") {
    const stats = await daemon.jobsStats(cwd, { ...(readFlag(args, "--now") === undefined ? {} : { now: readFlag(args, "--now")! }) });
    if (!stats.ok) return { ...stats, requestId: "agents.budget" };
    return okEnvelope("agents.budget", {
      schemaVersion: "archcontext.agent-budget/v1",
      spawnPolicy: {
        maxRunsPerTask: DEFAULT_AGENT_ORCHESTRATION_POLICY.maxRunsPerTask,
        maxRunsPerRepositoryPerDay: 4,
        maxRunsPerDay: DEFAULT_AGENT_ORCHESTRATION_POLICY.maxRunsPerDay,
        maxAutomaticRunsForLowRisk: DEFAULT_AGENT_ORCHESTRATION_POLICY.maxAutomaticRunsForLowRisk,
        adapterEnabledByRuntimeEnqueue: true
      },
      queuePolicy: {
        maxQueuedJobs: DEFAULT_AGENT_QUEUE_MAX_QUEUED_JOBS,
        maxRunningJobsPerRepository: DEFAULT_AGENT_QUEUE_MAX_RUNNING_JOBS_PER_REPOSITORY
      },
      stats: stats.data as Json,
      authority: "local-runtime-daemon"
    } as unknown as Json);
  }
  return errorEnvelope("agents", "AC_SCHEMA_INVALID", "agents requires status|budget");
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
      args: ["hook", "enqueue"],
      timeoutMs: HOOK_ENQUEUE_TIMEOUT_MS,
      failOpen: true,
      egress: "none",
      network: "forbidden"
    },
    fallbackEntrypoint: {
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
      sourceFlag: "--source",
      generatedProjectionFlag: "--generated-projection",
      toolCallIdFlag: "--tool-call-id",
      taskSessionIdFlag: "--task-session-id"
    },
    output: {
      successRequestId: "hook.enqueue",
      queueRequestId: "jobs.enqueueGitHook",
      successData: "runtime-agent-job-record",
      skipSchemaVersion: "archcontext.hook-enqueue-skipped/v1",
      failOpenSchemaVersion: "archcontext.hook-enqueue-fail-open/v1",
      checkpointSchemaVersion: "archcontext.practice-checkpoint/v1",
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
      args: ["archcontext-enqueue"],
      invokes: {
        command: "archctx",
        args: ["hook", "enqueue", "--event", "post-edit"]
      }
    },
    eventMap: {
      postEdit: "archctx hook enqueue --event post-edit --path <changed-path>",
      postWrite: "archctx hook enqueue --event post-write --path <changed-path>",
      generatedProjection: "archctx hook enqueue --event post-write --generated-projection --path .archcontext/generated/<file>"
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
    removeEntrypoint: "archctx hook enqueue",
    compatibilityEntrypoint: "archctx hook checkpoint",
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

function readHookGitChangeSource(args: string[], event: string):
  | { ok: true; source: NonNullable<RuntimeAgentJobEnqueueGitInput["source"]> }
  | { ok: false; envelope: ReturnType<typeof errorEnvelope> } {
  const requested = readFlag(args, "--source") ?? defaultHookGitChangeSource(event);
  if (requested === "worktree" || requested === "staged" || requested === "commit") {
    return { ok: true, source: requested };
  }
  return {
    ok: false,
    envelope: errorEnvelope("hook.enqueue", "AC_SCHEMA_INVALID", "hook enqueue --source must be worktree, staged, or commit")
  };
}

function readCliGitChangeSource(args: string[], requestId: string, defaultSource: NonNullable<RuntimeAgentJobEnqueueGitInput["source"]>):
  | { ok: true; source: NonNullable<RuntimeAgentJobEnqueueGitInput["source"]> }
  | { ok: false; envelope: ReturnType<typeof errorEnvelope> } {
  const requested = readFlag(args, "--source") ?? defaultSource;
  if (requested === "worktree" || requested === "staged" || requested === "commit") {
    return { ok: true, source: requested };
  }
  return {
    ok: false,
    envelope: errorEnvelope(requestId, "AC_SCHEMA_INVALID", `${requestId} --source must be worktree, staged, or commit`)
  };
}

function readAgentRunnerPort(args: string[], requestId: string):
  | { ok: true; runnerPort?: AgentJobV1["runnerPort"] }
  | { ok: false; envelope: ReturnType<typeof errorEnvelope> } {
  const raw = readFlag(args, "--runner-port") ?? readFlag(args, "--provider");
  if (raw === undefined) return { ok: true };
  const normalized = raw === "claude" ? "claude-code" : raw;
  if (normalized === "codex" || normalized === "claude-code" || normalized === "fake-provider") {
    return { ok: true, runnerPort: normalized };
  }
  return {
    ok: false,
    envelope: errorEnvelope(requestId, "AC_SCHEMA_INVALID", `${requestId} --runner-port must be codex, claude-code, claude, or fake-provider`)
  };
}

function defaultHookGitChangeSource(event: string): NonNullable<RuntimeAgentJobEnqueueGitInput["source"]> {
  if (event === "post-commit") return "commit";
  if (event === "pre-commit") return "staged";
  return "worktree";
}

function readOptionalPositiveIntegerFlag(args: string[], flag: string, requestId: string):
  | { ok: true; value?: number }
  | { ok: false; envelope: ReturnType<typeof errorEnvelope> } {
  const raw = readFlag(args, flag);
  if (raw === undefined) return { ok: true };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    return { ok: false, envelope: errorEnvelope(requestId, "AC_SCHEMA_INVALID", `${flag} must be a positive integer`) };
  }
  return { ok: true, value };
}

function readOptionalIntegerFlag(args: string[], flag: string, requestId: string):
  | { ok: true; value?: number }
  | { ok: false; envelope: ReturnType<typeof errorEnvelope> } {
  const raw = readFlag(args, flag);
  if (raw === undefined) return { ok: true };
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    return { ok: false, envelope: errorEnvelope(requestId, "AC_SCHEMA_INVALID", `${flag} must be an integer`) };
  }
  return { ok: true, value };
}

function readOptionalNonNegativeIntegerFlag(args: string[], flag: string, requestId: string):
  | { ok: true; value?: number }
  | { ok: false; envelope: ReturnType<typeof errorEnvelope> } {
  const raw = readFlag(args, flag);
  if (raw === undefined) return { ok: true };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    return { ok: false, envelope: errorEnvelope(requestId, "AC_SCHEMA_INVALID", `${flag} must be a non-negative integer`) };
  }
  return { ok: true, value };
}

function shouldSkipGeneratedProjectionHook(args: string[], changedPaths: string[]): boolean {
  if (args.includes("--no-generated-projection-guard")) return false;
  if (args.includes("--generated-projection")) return true;
  return changedPaths.length > 0 && changedPaths.every(isArchContextGeneratedProjectionPath);
}

function isArchContextGeneratedProjectionPath(path: string): boolean {
  return path.replace(/\\/g, "/").startsWith(".archcontext/generated/");
}

function hookEnqueueReasonCode(data: Record<string, Json>): string {
  if (data.reasonCode !== undefined) return String(data.reasonCode);
  if (data.skipped === true) return "skipped";
  if (data.deduplicated === true) return "deduplicated";
  if (data.enqueued === true) return "enqueued";
  return "unknown";
}

function readRuntimeAgentJobStatuses(args: string[], requestId: string):
  | { ok: true; statuses: RuntimeAgentJobStatus[] }
  | { ok: false; envelope: ReturnType<typeof errorEnvelope> } {
  const statuses = readRepeatedFlag(args, "--status")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const invalid = statuses.find((status) => !(RUNTIME_AGENT_JOB_STATUSES as readonly string[]).includes(status));
  if (invalid) {
    return { ok: false, envelope: errorEnvelope(requestId, "AC_SCHEMA_INVALID", `unknown runtime agent job status: ${invalid}`) };
  }
  return { ok: true, statuses: statuses as RuntimeAgentJobStatus[] };
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
  if ((health as any)?.ok === true) {
    // Mirrors `runDaemonCommand("status")`'s healthy branch: the RPC wire schema alone cannot
    // rule out a stale already-running daemon (see `cliEntryStalenessIssue`), so `doctor` must not
    // report a stale daemon as simply running/compatible either.
    const stalenessIssue = cliEntryStalenessIssue(cwd);
    if (stalenessIssue?.pidAlive) return incompatibleDaemonStatus(stalenessIssue);
  }
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
    return { client: await createOrStartRuntimeRpcClient(cwd), close: async () => undefined };
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

async function createOrStartRuntimeRpcClient(cwd: string): Promise<RuntimeDaemonClient> {
  const fileIssue = runtimeRpcCompatibilityIssue(cwd) ?? cliEntryStalenessIssue(cwd);
  if (fileIssue?.pidAlive) throw new RuntimeVersionUnsupportedError(fileIssue);
  const client = createRuntimeRpcClientFromConnectionFile(cwd);
  if (client) {
    const health = await client.health().catch(() => undefined);
    const healthIssue = runtimeRpcCompatibilityIssueFromHealth(cwd, client, health);
    if (healthIssue) throw new RuntimeVersionUnsupportedError(healthIssue);
    if ((health as any)?.ok === true) return client;
    recoverStaleDaemonControlFiles(cwd, { removeUnhealthyConnection: true });
  } else {
    recoverStaleDaemonControlFiles(cwd);
  }
  const started = await startBackgroundDaemon([], cwd);
  if (!started.ok) throw new Error(mcpDaemonStartRecoveryMessage(started.error?.message ?? "archctxd did not start"));
  const startedClient = createRuntimeRpcClientFromConnectionFile(cwd);
  if (startedClient) {
    const health = await startedClient.health().catch(() => undefined);
    if ((health as any)?.ok === true) return startedClient;
  }
  throw new Error(mcpDaemonStartRecoveryMessage("archctxd started but no healthy runtime RPC connection was available"));
}

/**
 * `createOrStartRuntimeRpcClient`'s reuse-if-healthy fast path only ever checked the RPC wire
 * schema version (`runtimeRpcCompatibilityIssue`), which stays constant across source edits that
 * change daemon-resident *behavior* without touching the wire schema (e.g. the clock-composition
 * fix this check ships alongside). `archctxd` is spawned `detached`+`unref()`'d with no idle
 * shutdown, so a daemon started from an older on-disk copy of `CLI_ENTRY` keeps running — and gets
 * silently reused via this same fast path — until something notices and restarts it. That silent
 * reuse of a stale process (not a branch-selection bug) is what produced epoch-clock audit runs
 * and a non-exiting `--no-wait` CLI during manual verification: a leftover `archctxd` from before
 * this fix landed was still bound to the target repo's connection file and got reused instead of a
 * fresh, correctly-composed one. This closes that gap using data already on disk: every connection
 * file already records a real wall-clock `startedAt` (`ArchctxRuntimeRpcServer.start`, independent
 * of the daemon's own possibly-frozen `clock`), so comparing it against `CLI_ENTRY`'s current mtime
 * is enough to detect "the code has moved on since this daemon was spawned" without adding any new
 * persisted state, mirroring the existing rpc-version-mismatch check rather than inventing a new
 * mechanism.
 */
function cliEntryStalenessIssue(cwd: string): RuntimeRpcCompatibilityIssue | undefined {
  const connection = readRuntimeRpcConnectionFile(cwd);
  if (!connection) return undefined;
  let entryMtimeIso: string;
  try {
    entryMtimeIso = statSync(CLI_ENTRY).mtime.toISOString();
  } catch {
    return undefined;
  }
  return daemonEntryStalenessIssue(connection, entryMtimeIso, cwd);
}

function daemonEntryStalenessIssue(
  connection: { startedAt?: string; pid?: number; connectionPath?: string; lockPath?: string },
  entryMtimeIso: string,
  cwd: string
): RuntimeRpcCompatibilityIssue | undefined {
  if (typeof connection.startedAt !== "string") return undefined;
  const startedAtMs = Date.parse(connection.startedAt);
  const entryMtimeMs = Date.parse(entryMtimeIso);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(entryMtimeMs)) return undefined;
  if (entryMtimeMs <= startedAtMs) return undefined;
  const pid = typeof connection.pid === "number" ? connection.pid : undefined;
  return {
    reason: "stale-daemon-entry",
    expected: entryMtimeIso,
    received: connection.startedAt,
    connectionPath: connection.connectionPath ?? defaultDaemonConnectionPath(cwd),
    lockPath: connection.lockPath ?? defaultDaemonLockPath(cwd),
    pid,
    pidAlive: pid !== undefined ? isPidAlive(pid) : false,
    upgradeCommand: "archctx daemon upgrade"
  };
}

function mcpDaemonStartRecoveryMessage(message: string): string {
  return message.includes("archctx daemon") ? message : `${message}; run \`archctx daemon start\` before using the local MCP surface`;
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
    "devicePrivateKeyStore",
    "externalDocumentation"
  ].some((key) => key in deps);
}

async function runDaemonCommand(args: string[], cwd: string) {
  const subcommand = args[0] ?? "status";
  if (subcommand === "status") {
    const client = createRuntimeRpcClientFromConnectionFile(cwd);
    if (!client) {
      const compatibilityIssue = runtimeRpcCompatibilityIssue(cwd) ?? cliEntryStalenessIssue(cwd);
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
      // The RPC wire schema can stay unchanged across a source edit that only touches
      // daemon-resident behavior, so a healthy version-compatible response alone does not rule
      // out talking to a stale already-running daemon (see `cliEntryStalenessIssue`).
      const stalenessIssue = cliEntryStalenessIssue(cwd);
      if (stalenessIssue?.pidAlive) {
        return okEnvelope("daemon.status", incompatibleDaemonStatus(stalenessIssue) as any);
      }
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
  const compatibilityIssue = runtimeRpcCompatibilityIssue(cwd) ?? cliEntryStalenessIssue(cwd);
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
    let childExit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    let childError: Error | undefined;
    const idleTimeoutFlag = readFlag(args, "--idle-timeout-ms");
    const child = spawn(process.execPath, [
      CLI_ENTRY,
      "daemon",
      "start",
      "--foreground",
      "--port",
      readFlag(args, "--port") ?? "0",
      ...(idleTimeoutFlag === undefined ? [] : ["--idle-timeout-ms", idleTimeoutFlag])
    ], {
      cwd,
      detached: true,
      env: process.env,
      stdio: ["ignore", logFd, logFd]
    });
    child.once("exit", (code, signal) => {
      childExit = { code, signal };
    });
    child.once("error", (error) => {
      childError = error;
    });
    child.unref();
    const ready = await waitForDaemonReady(cwd, daemonStartTimeoutMs(args), () => childExit !== undefined || childError !== undefined);
    if (!ready) {
      return errorEnvelope("daemon.start", "AC_RUNTIME_UNAVAILABLE", daemonStartFailureMessage(logPath, childExit, childError));
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
  const issue = runtimeRpcCompatibilityIssue(cwd) ?? cliEntryStalenessIssue(cwd);
  if (!issue) {
    const started = await startBackgroundDaemon(args, cwd);
    return started.ok ? { ...started, requestId: "daemon.upgrade", data: { ...(started.data as any), upgraded: false, reason: "runtime-compatible" } } : started;
  }
  if (issue.pidAlive && issue.pid === undefined) {
    return errorEnvelope("daemon.upgrade", "AC_RUNTIME_VERSION_UNSUPPORTED", runtimeVersionUnsupportedMessage(issue));
  }
  if (issue.pidAlive && issue.pid !== undefined) {
    process.kill(issue.pid, "SIGTERM");
    const stopped = await waitForPidExit(issue.pid, daemonStartTimeoutMs(args));
    if (!stopped) {
      return errorEnvelope("daemon.upgrade", "AC_RUNTIME_VERSION_UNSUPPORTED", `Incompatible archctxd pid ${issue.pid} did not stop; stop it manually, then run archctx daemon upgrade.`);
    }
  }
  const recovery = recoverStaleDaemonControlFiles(cwd, { removeUnhealthyConnection: true });
  const started = await startBackgroundDaemon(args, cwd);
  const replacedRuntime = issue.reason === "stale-daemon-entry"
    ? {
        previousStartedAt: issue.received,
        entrypointMtime: issue.expected,
        previousPid: issue.pid
      }
    : {
        previousRpcSchemaVersion: issue.received,
        expectedRpcSchemaVersion: issue.expected,
        previousPid: issue.pid
      };
  return started.ok
    ? {
        ...started,
        requestId: "daemon.upgrade",
        data: {
          ...(started.data as any),
          upgraded: true,
          replacedRuntime,
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
  if (issue.reason === "stale-daemon-entry") {
    return `archctxd (pid ${issue.pid ?? "unknown"}, started ${issue.received}) was spawned from an older copy of the archctx entrypoint than the one running this command (modified ${issue.expected}); run ${issue.upgradeCommand} to replace the local daemon.`;
  }
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

function daemonStartTimeoutMs(args: string[]): number {
  const configured = readFlag(args, "--timeout-ms") ?? process.env[DAEMON_START_TIMEOUT_ENV];
  if (configured === undefined) return DAEMON_START_TIMEOUT_MS;
  const parsed = Number(configured);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DAEMON_START_TIMEOUT_MS;
}

function daemonStartFailureMessage(
  logPath: string,
  childExit: { code: number | null; signal: NodeJS.Signals | null } | undefined,
  childError: Error | undefined
): string {
  const childState = childError
    ? `childError=${childError.message}`
    : childExit
      ? `childExit=${childExit.code ?? "null"}/${childExit.signal ?? "none"}`
      : "childState=still-running";
  return `archctxd did not become ready; ${childState}; log=${logPath}; logTail=${readFileTail(logPath)}`;
}

async function waitForDaemonReady(cwd: string, timeoutMs: number, shouldStop?: () => boolean) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await runningDaemonInfo(cwd);
    if (ready) return ready;
    if (shouldStop?.()) return undefined;
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
  const idleTimeoutFlag = readFlag(args, "--idle-timeout-ms");
  const server = new ArchctxRuntimeRpcServer(daemon, {
    root: cwd,
    port: Number(readFlag(args, "--port") ?? 0),
    idleTimeoutMs: idleTimeoutFlag === undefined ? undefined : Number(idleTimeoutFlag),
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

function readCurrentBranch(root: string): string {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return branch === "HEAD" ? "detached" : branch;
  } catch {
    return "unknown";
  }
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
