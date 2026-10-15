#!/usr/bin/env bun
import { LocalEgressPolicyError, localEgressAdmission, withLocalEgress } from "@archcontext/local-runtime/egress-admission";
import { runArchitectureDebtCommand, selectedProducerFailureEnvelope } from "@archcontext/local-runtime/architecture-debt";
import { runNativeContextCommand } from "./native-context";
import { isArchContextGeneratedProjectionPath } from "@archcontext/local-runtime/projection-paths";
import { assertNoCliSecretMaterial, defaultGithubDeveloperReviewStatePath, discardLegacyGithubDeveloperReviewState, readGithubDeveloperReviewState, sanitizeGithubDeveloperReviewState, writeGithubDeveloperReviewState, type GitHubDeveloperReviewState } from "./github-review-state";
import { localEgressStatus } from "@archcontext/local-runtime/egress";
import { spawn, spawnSync } from "node:child_process";
import { accessSync, closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHCONTEXT_NODE_RANGE, ARCHCONTEXT_PRODUCT_VERSION, ARCHITECTURE_MAJOR_CHANGE_REASON_CODES, CALLER_PROVIDED_ATTESTATION_FIELDS, EXPLORER_VIEW_IDS, REFACTOR_REQUEST_SCHEMA_VERSION, archctxCapabilities, digestJson, errorEnvelope, failureEnvelope, knownFailure, normalizeFailureResult, unclassifiedFailure, isRepoRelativePosixPath, nodeVersionSatisfiesRange, okEnvelope, productVersionManifest, refactorRequestInvariantIssues, refactorVerificationRequestInvariantIssues, validateJsonSchema } from "@archcontext/contracts";
import type { AcceptedArchitectureChangeReferenceV1, AgentJobV1, ArchctxCapabilitiesV1, ArchitectureMajorChangeReasonCode, AttestationV2, ExplorerProjectionQueryV2, GitHubGovernancePort, FailureEnvelope, Json, JsonEnvelope, RefactorRequestV1, RefactorVerificationRequestV1, ReviewChallengeV2 } from "@archcontext/contracts";
import { assertPathHasNoSymlinkSegments, planManifestFieldsOperation, type ChangeOperation } from "@archcontext/core/changeset-engine";
import { assertAllowedArchContextPath } from "@archcontext/core/policy-engine";
import { computeWorktreeDigest, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { DEFAULT_AGENT_ORCHESTRATION_POLICY, DEFAULT_AGENT_QUEUE_MAX_QUEUED_JOBS, DEFAULT_AGENT_QUEUE_MAX_RUNNING_JOBS_PER_REPOSITORY } from "@archcontext/core/agent-orchestrator";
import type { ArchitectureAuditRunV1 } from "@archcontext/core/architecture-ledger";
import { dependencyAudit, diagnostics, installMarker, secretScan, uninstallMarker } from "@archcontext/cloud/hardening";
import { completeRuntimeStateRecovery, defaultArchContextStateRoot, defaultLocalStorePath, inspectLegacyLocalStoreMigration, LOCAL_STORE_WRITER_OWNED_ERROR, inspectRuntimeStateRecovery, migrateLegacyLocalStoreIfNeeded, recoverRuntimeStateTarget, runtimeStatePaths, runtimeStateRecoveryWorktreeDigest } from "@archcontext/local-runtime/local-store-sqlite";
import { GitVisibleFilesUnavailableError, findRepositoryRoot, readHeadSha, listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { listWorkspaceStateDirs } from "@archcontext/local-runtime/runtime-state-paths";
import { ArchctxRuntimeRpcServer, runDocsAnchorsCommand, runProjectionCheckInvocation, runProjectionFreshnessCommand, runProjectionSnapshotCommand, AUDIT_APPROVE_GH_TOKEN_ENV, AUDIT_RUN_DEFAULT_TIMEOUT_MS, auditConsentRequiredEnvelope, grantAuditConsent, readAuditConsent, revokeAuditConsent, RUNTIME_RPC_VERSION, createRuntimeRpcClientFromConnectionFile, createRuntimeRpcClientFromWorkspaceStateDir, createStartedDaemon, createStartedProductionDaemon, defaultDaemonConnectionPath, defaultDaemonLockPath, listDaemonControlStates, liveDaemonLockOwnerPid, readRuntimeRpcConnectionFile, recoverStaleDaemonControlFiles, runtimeRpcCompatibilityIssue, type RuntimeRpcCompatibilityIssue, type RuntimeDaemonClient, type RuntimeDocsProjectionInput, type RuntimeProjectionInvocation, type RuntimeAgentContextProjectionInput, type RuntimeAgentJobEnqueueGitInput, type RuntimeAuditRunInput, type RuntimeRecommendationInput, type RuntimeDeps, runFlowSelectorCheckCommand, CapabilityDependenciesError, readCapabilityDependencies } from "@archcontext/local-runtime/runtime-daemon";
import { inspectRepositoryCodeFacts } from "@archcontext/local-runtime/codegraph-adapter";
import { RuntimeRpcTransportError, type RuntimeRpcClient } from "@archcontext/local-runtime/runtime-rpc-client";
import { exportLikeC4Model, importLikeC4InitialModel } from "@archcontext/surfaces/adapter-likec4";
import { exportStructurizrWorkspace, importStructurizrInitialModel } from "@archcontext/surfaces/adapter-structurizr";
import { MCP_PLAN_OPERATIONS_SCHEMA, runStdioMcpLoop } from "@archcontext/surfaces/mcp-local";
import { REPO_HARNESS_PROJECTION_PROFILE, exportMermaidModel, loadNativeModelFromArchContext, resolveArchitectureOwnerForPath, resolveArchitectureOwnersForPaths, type ArchitectureProjectionProfile, type ResolveArchitectureOwnerResult } from "@archcontext/surfaces/renderer";

const [, , command, ...args] = process.argv;
const CLI_ENTRY = fileURLToPath(import.meta.url);
const DAEMON_START_TIMEOUT_ENV = "ARCHCONTEXT_DAEMON_START_TIMEOUT_MS";
const DAEMON_START_TIMEOUT_MS = process.platform === "win32" ? 150_000 : 15_000;
/**
 * Exit code of a foreground `archctxd` that lost a concurrent cold start: another live process
 * already owns the local store (#160) or the daemon lock. Its starter keeps waiting for the winner's
 * connection file instead of reporting a failed start.
 */
const DAEMON_OWNED_ELSEWHERE_EXIT_CODE = 75;

function isDaemonOwnedElsewhereError(message: string): boolean {
  return message.startsWith(`${LOCAL_STORE_WRITER_OWNED_ERROR}:`) || message.startsWith("archctxd already running for ");
}
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

class RefactorFlagError extends Error {}

/** A CLI argument error. The process entry reports it as AC_SCHEMA_INVALID, not as a runtime outage. */
class CliUsageError extends Error {}

const AUDIT_RUN_STATUSES = ["pending", "issuing", "issued", "failed"] as const;

/**
 * Flags `audit run` and `audit approve` accept beyond `--help`/`-h` (checked separately) and
 * approve's own positional `<run-id>`. `--format` and `--json` are global rendering flags every
 * command's `args` may carry (`--format` is read once at the very top of this file; `--json` is
 * accepted CLI-wide as a JSON-output hint), so they're allowed here too even though neither
 * subcommand's own input builder reads them.
 *
 * The `if (import.meta.main)` entry block is the last statement of this file (#297), so these and
 * every other top-level constant are set before a command runs. See the comment on that block.
 */
const AUDIT_GLOBAL_VALUE_FLAGS = ["--format"] as const;
const AUDIT_GLOBAL_BOOLEAN_FLAGS = ["--json"] as const;
const AUDIT_RUN_VALUE_FLAGS = ["--task-session-id", "--reason", "--risk", "--uncertainty", "--context-max-items", "--model-id", "--timeout-ms", ...AUDIT_GLOBAL_VALUE_FLAGS];
const AUDIT_RUN_BOOLEAN_FLAGS = ["--no-wait", ...AUDIT_GLOBAL_BOOLEAN_FLAGS];
const AUDIT_APPROVE_VALUE_FLAGS = ["--run-id", "--confirm-public-repo", ...AUDIT_GLOBAL_VALUE_FLAGS];
const AUDIT_APPROVE_BOOLEAN_FLAGS = ["--resume", ...AUDIT_GLOBAL_BOOLEAN_FLAGS];

interface CliFlagSpec {
  value: readonly string[];
  boolean: readonly string[];
}

/**
 * Every flag each command accepts besides the global `--format <value>`, `--json` and `--help`/`-h`.
 * `preflightCliArguments` checks the whole command line against it before any handler runs, so
 * help and unknown flags never reach a handler or `runtime()` (#182, #322). A command whose
 * subcommands take different flags lists them under `subcommands`; its own `value`/`boolean`
 * apply to any other first token.
 */
export const CLI_COMMAND_FLAGS: Readonly<Record<string, CliFlagSpec & { subcommands?: Readonly<Record<string, CliFlagSpec>> }>> = {
  "debt": { value: ["--changed-path"], boolean: [] },
  "agent-context": { value: ["--expected-worktree-digest", "--id", "--task-session-id"], boolean: ["--approved"] },
  "agents": {
    value: [],
    boolean: [],
    subcommands: {
      status: { value: ["--now", "--status"], boolean: [] },
      budget: { value: ["--now"], boolean: [] }
    }
  },
  "apply": { value: ["--expected-worktree-digest", "--id"], boolean: ["--approved"] },
  "book": { value: ["--depth", "--from", "--id", "--max-bytes", "--max-items", "--query", "--since", "--task", "--to"], boolean: ["--explain", "--open"] },
  "checkpoint": { value: ["--changed-path"], boolean: [] },
  "complete": { value: ["--head-sha", "--posture", "--task", "--task-session-id"], boolean: [] },
  "config": { value: [], boolean: [] },
  "context": { value: ["--max-symbols", "--name", "--task"], boolean: ["--landscape"] },
  "deps": { value: ["--edge-limit", "--from", "--import-node-limit", "--into"], boolean: [] },
  "doctor": { value: [], boolean: ["--check-updates"] },
  "explore": {
    value: [],
    boolean: [],
    subcommands: {
      status: { value: [], boolean: [] },
      stop: { value: [], boolean: [] },
      revoke: { value: [], boolean: [] },
      contract: { value: ["--token-ttl-seconds"], boolean: [] },
      start: { value: ["--port", "--token-ttl-seconds"], boolean: ["--foreground"] },
      projection: { value: ["--depth", "--expand", "--expected-graph-digest", "--expected-head-sha", "--expected-observed-facts-digest", "--expected-worktree-digest", "--focus", "--level", "--max-nodes", "--max-relations", "--task-session-id", "--view"], boolean: [] },
      delta: { value: ["--base-event-id", "--base-projection-digest", "--head-event-id", "--head-projection-digest"], boolean: [] }
    }
  },
  "export": { value: [], boolean: [] },
  "flows": { value: [], boolean: [] },
  "github": {
    value: [],
    boolean: [],
    subcommands: {
      status: { value: [], boolean: [] },
      connect: { value: [], boolean: [] },
      disconnect: { value: [], boolean: [] },
      review: { value: ["--challenge-json", "--challenge-path", "--claimant-id", "--completed-at", "--expected-head-tree-oid", "--merge-base-sha", "--now", "--pr", "--principal-id", "--public-key-id", "--pull-request", "--started-at", "--task-session-id"], boolean: ["--force"] },
      "verify-head": { value: ["--challenge-json", "--challenge-path"], boolean: [] }
    }
  },
  "hash": { value: ["--path"], boolean: [] },
  "hook": {
    value: [],
    boolean: [],
    subcommands: {
      checkpoint: { value: ["--changed-path", "--event"], boolean: [] },
      enqueue: { value: ["--analysis-kind", "--base-ref", "--changed", "--coalesce-key", "--code-facts-digest", "--debounce-until", "--event", "--max-attempts", "--max-queued-jobs", "--path", "--priority", "--ref", "--risk", "--runner-port", "--source", "--uncertainty"], boolean: ["--generated-projection", "--no-generated-projection-guard", "--policy-requested"] }
    }
  },
  "hooks": { value: ["--host"], boolean: ["--generated-projection"] },
  "import": { value: ["--content"], boolean: [] },
  "init": { value: ["--name"], boolean: [] },
  "install": { value: ["--host"], boolean: [] },
  "investigate": { value: ["--analysis-kind", "--base-ref", "--coalesce-key", "--code-facts-digest", "--context-max-items", "--cooldown-ms", "--debounce-until", "--event", "--max-attempts", "--max-queued-jobs", "--priority", "--provider", "--ref", "--risk", "--runner-port", "--source", "--task-session-id", "--uncertainty"], boolean: ["--generated-projection", "--no-generated-projection-guard"] },
  "jobs": {
    value: [],
    boolean: [],
    subcommands: {
      list: { value: ["--status"], boolean: [] },
      stats: { value: ["--now"], boolean: [] },
      show: { value: ["--job-id", "--status"], boolean: [] },
      cancel: { value: ["--job-id", "--reason", "--status", "--superseded-by-job-id"], boolean: [] },
      retry: { value: ["--job-id", "--reason"], boolean: [] }
    }
  },
  "landscape": { value: [], boolean: [] },
  "ledger": {
    value: [],
    boolean: [],
    subcommands: {
      status: { value: [], boolean: [] },
      state: { value: [], boolean: [] },
      drift: { value: [], boolean: [] },
      "accept-committed": { value: ["--acceptance-plan-id", "--changeset-id", "--expected-worktree-digest", "--journal", "--journal-id"], boolean: ["--approved"] },
      promote: { value: ["--mode"], boolean: ["--apply", "--enable", "--preflight", "--rollback-plan", "--write"] },
      project: { value: ["--expected-worktree-digest"], boolean: ["--dry-run", "--to-git", "--write"] },
      rebuild: { value: ["--expected-worktree-digest"], boolean: ["--accept-external-projection", "--from-git"] },
      rollback: { value: ["--expected-worktree-digest"], boolean: ["--dry-run", "--to-yaml", "--write"] },
      migrate: { value: ["--expected-worktree-digest"], boolean: ["--dry-run", "--from-yaml", "--recommendation-v3", "--write"] }
    }
  },
  "manifest": { value: ["--decisions", "--id"], boolean: [] },
  "mcp": { value: ["--content", "--host"], boolean: [] },
  "paths": { value: [], boolean: [] },
  "plan": { value: ["--body", "--body-file", "--expected-hash", "--id", "--op", "--operations-file", "--path"], boolean: [] },
  "practices": {
    value: [],
    boolean: [],
    subcommands: {
      checkpoint: { value: ["--changed", "--event", "--expected-head-sha", "--expected-worktree-digest", "--head-sha", "--max-bytes", "--max-items", "--path", "--task", "--task-session-id", "--tool-call-id"], boolean: [] },
      list: { value: ["--category", "--source"], boolean: [] },
      show: { value: ["--id"], boolean: [] },
      validate: { value: [], boolean: ["--strict"] },
      sources: { value: [], boolean: [] },
      waivers: { value: [], boolean: [] },
      waive: { value: ["--check-id", "--created-at", "--evidence-digest", "--expires-at", "--id", "--owner", "--path-glob", "--practice-id", "--reason", "--review-at", "--subject", "--task-session-id", "--waiver-id"], boolean: [] }
    }
  },
  "prepare": { value: ["--max-bytes", "--max-items", "--task", "--task-session-id"], boolean: [] },
  "privacy-audit": { value: [], boolean: [] },
  "projection": {
    value: ["--request-json"],
    boolean: [],
    subcommands: {
      run: { value: ["--request-json"], boolean: [] },
      recover: { value: ["--request-json"], boolean: [] },
      readback: { value: ["--request-json"], boolean: [] },
      snapshot: { value: [], boolean: [] },
      freshness: { value: ["--changed-path"], boolean: [] }
    }
  },
  "recommendations": {
    value: [],
    boolean: [],
    subcommands: {
      metrics: { value: ["--now"], boolean: [] },
      show: { value: ["--id", "--import-node-limit", "--recommendation-id"], boolean: [] },
      list: { value: ["--status"], boolean: [] },
      acknowledge: { value: ["--actor", "--actor-kind", "--agent-job-id", "--evidence-digest", "--expected-worktree-digest", "--id", "--import-node-limit", "--now", "--reason", "--recommendation-id", "--source"], boolean: [] },
      accept: { value: ["--actor", "--actor-kind", "--agent-job-id", "--evidence-digest", "--expected-worktree-digest", "--id", "--import-node-limit", "--now", "--reason", "--recommendation-id", "--source"], boolean: [] },
      reject: { value: ["--actor", "--actor-kind", "--agent-job-id", "--evidence-digest", "--expected-worktree-digest", "--id", "--import-node-limit", "--now", "--reason", "--recommendation-id", "--source"], boolean: [] },
      defer: { value: ["--actor", "--actor-kind", "--agent-job-id", "--evidence-digest", "--expected-worktree-digest", "--id", "--import-node-limit", "--now", "--reason", "--recommendation-id", "--source"], boolean: [] },
      waive: { value: ["--actor", "--actor-kind", "--agent-job-id", "--evidence-digest", "--expected-worktree-digest", "--id", "--import-node-limit", "--now", "--reason", "--recommendation-id", "--source"], boolean: [] },
      resolve: { value: ["--actor", "--actor-kind", "--agent-job-id", "--evidence-digest", "--expected-worktree-digest", "--id", "--import-node-limit", "--now", "--reason", "--recommendation-id", "--source"], boolean: [] }
    }
  },
  "refactor": { value: ["--assessment-digest", "--expected-worktree-digest", "--import-node-limit", "--request-json"], boolean: ["--selection"] },
  "repo": { value: ["--name", "--repository-id", "--root"], boolean: [] },
  "resolve": { value: ["--path", "--paths-from"], boolean: [] },
  "review": { value: ["--head-sha", "--posture", "--task", "--task-session-id"], boolean: [] },
  "state": { value: ["--expected-target-fingerprint", "--expected-worktree-digest"], boolean: ["--accept-external-projection", "--dry-run", "--from-git", "--write"] },
  "status": { value: [], boolean: [] },
  "sync": { value: ["--changed"], boolean: [] },
  "tunnel": { value: [], boolean: ["--revoke"] },
  "uninstall": { value: ["--content", "--host"], boolean: [] },
  "update": { value: [], boolean: ["--check"] },
  "validate": { value: [], boolean: [] },
  // `runCli` runs its own stricter check after this one: at most one `--json`, nothing else.
  "capabilities": { value: [], boolean: [] },
  "audit": {
    value: [],
    boolean: [],
    subcommands: {
      run: { value: AUDIT_RUN_VALUE_FLAGS, boolean: AUDIT_RUN_BOOLEAN_FLAGS },
      approve: { value: AUDIT_APPROVE_VALUE_FLAGS, boolean: AUDIT_APPROVE_BOOLEAN_FLAGS },
      list: { value: ["--status"], boolean: [] },
      show: { value: ["--run-id"], boolean: [] },
      consent: { value: [], boolean: ["--revoke"] }
    }
  },
  "daemon": {
    value: [],
    boolean: [],
    subcommands: {
      status: { value: [], boolean: [] },
      start: { value: ["--port", "--idle-timeout-ms", "--timeout-ms"], boolean: ["--foreground"] },
      upgrade: { value: ["--port", "--idle-timeout-ms", "--timeout-ms"], boolean: [] },
      // The cwd's daemon by default, or one named by `daemon list` (#322).
      stop: { value: ["--state-dir", "--workspace-id"], boolean: [] },
      list: { value: [], boolean: [] }
    }
  },
  "docs": {
    value: ["--accepted-change-set-id", "--accepted-event-id", "--adoption-plan-id", "--affected-node", "--expected-worktree-digest", "--id", "--intent", "--library", "--library-id", "--major-reason", "--profile", "--query", "--task-session-id", "--version"],
    boolean: ["--all", "--allow-network", "--approved", "--force-refresh"],
    subcommands: { anchors: { value: ["--profile"], boolean: [] } }
  },
  "help": { value: [], boolean: [] }
};

/**
 * The task of `context` and `prepare`: `--task`, or the whole command line as task text when it
 * carries no option. An option without `--task` is refused rather than read as task text, which
 * would send `--max-bytes 4096` to CodeGraph as the task (#322).
 */
function cliTaskText(command: "context" | "prepare", args: string[]): { ok: true; task: string } | { ok: false; envelope: JsonEnvelope } {
  const task = readFlag(args, "--task");
  if (task !== undefined) return { ok: true, task };
  if (args.some(isCliFlagToken)) {
    return { ok: false, envelope: errorEnvelope(command, "AC_SCHEMA_INVALID", `${command} takes options only together with --task <text>; bare task text cannot contain options`) };
  }
  const text = args.join(" ").trim();
  if (!text) return { ok: false, envelope: errorEnvelope(command, "AC_SCHEMA_INVALID", `${command} requires --task or task text`) };
  return { ok: true, task: text };
}

/** `--x`, `-x` or `--x=y`; `-`, `---`, `-1` and `- item` are values. */
function isCliFlagToken(token: string): boolean {
  return /^--?[A-Za-z]/.test(token);
}

/**
 * The one argument check every command passes before its handler (#322): help is answered here,
 * daemon-owned review fields and unknown flags are rejected here, so no handler and no `runtime()`
 * ever sees them. A value flag must be followed by a value that is not itself flag-shaped, so
 * `--reason --bogus` cannot smuggle an unknown flag past the scan (#182). A command outside the
 * table falls through to the general help.
 */
function preflightCliArguments(command: string, args: string[]): JsonEnvelope | undefined {
  const spec = CLI_COMMAND_FLAGS[command];
  if (!spec) return undefined;
  if (args.includes("--help") || args.includes("-h")) return cliHelpEnvelope(command, args);
  if (command === "review" || command === "complete") {
    const forbidden = readForbiddenAttestationFlags(args);
    if (forbidden.length > 0) {
      return errorEnvelope(command, "AC_SCHEMA_INVALID", `Review attestation fields are daemon-owned and cannot be provided by CLI flags: ${forbidden.join(",")}`);
    }
  }
  const subcommand = args[0] !== undefined && !isCliFlagToken(args[0]) ? args[0] : undefined;
  const flags = (subcommand === undefined ? undefined : spec.subcommands?.[subcommand]) ?? spec;
  const valueFlags = [...flags.value, ...AUDIT_GLOBAL_VALUE_FLAGS];
  const booleanFlags = [...flags.boolean, ...AUDIT_GLOBAL_BOOLEAN_FLAGS];
  const name = flags === spec ? command : `${command} ${subcommand}`;
  const requestId = flags === spec ? command : `${command}.${subcommand}`;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (!isCliFlagToken(token)) {
      if ((command === "checkpoint" || (command === "hook" && subcommand === "checkpoint"))
        && !(command === "hook" && index === 0)) {
        return errorEnvelope(requestId, "AC_SCHEMA_INVALID", `${name} takes named options only`);
      }
      continue;
    }
    if (booleanFlags.includes(token)) continue;
    if (valueFlags.includes(token)) {
      const value = args[index + 1];
      if (value === undefined || isCliFlagToken(value)) return errorEnvelope(requestId, "AC_SCHEMA_INVALID", `${name} requires a value for ${token}`);
      index += 1;
      continue;
    }
    return errorEnvelope(requestId, "AC_SCHEMA_INVALID", `${name} does not recognize the flag ${token}`);
  }
  return undefined;
}
/** `docs anchors --help`; above the entry block for the same TDZ reason as the audit constants. */
const CLI_DOCS_ANCHORS_HELP = {
  usage: "archctx docs anchors [--profile default|repo-harness/v1] [--json]",
  description: "Read-only check of citations in human-owned module document regions and node summary/responsibilities. It reports missing-path, missing-symbol, unknown-selector, line-out-of-range and line-moved per node. It is a signal, not a gate: the result stays ok when it has findings.",
  options: {
    "--profile <profile>": "Layout whose module documents are read (default: the committed manifest profile; default without a manifest).",
    "--json": "Accepted for symmetry; output is always JSON.",
    "--help, -h": "Show help without reading the repository."
  },
  writes: "none; no daemon, no local store. Without a CodeGraph index, path and line checks still run and symbol checks are reported as unchecked (codegraph-unavailable).",
  capability: "docs-anchors-v1"
};

/** `projection freshness --help`; above the entry block for the same TDZ reason as the audit constants. */
const CLI_PROJECTION_FRESHNESS_HELP = {
  usage: "archctx projection freshness [--changed-path <path> ...] [--json]",
  description: "Read-only per-node freshness of the committed architecture projection: which stamped documents describe source that changed since they were verified. It compares the manifest's footprint stamps with the Git-visible files now, through the evaluator projection check uses, so on the same tree staleNodes equal check's for a repo-harness/v1 manifest, the only profile check renders. It needs no code facts and renders nothing.",
  options: {
    "--changed-path <path>": "Repeatable. Probe only the stamped nodes whose source.include selects one of these repository-relative POSIX paths and whose source.exclude does not. The declared source tree digest is not compared in this scope. A path under .archcontext/ widens the run to the whole tree, exactly as without --changed-path, and the output then carries scope: \"tree\" and scopeReason: \"model-path-changed\". Absolute, .. or non-normalized paths fail with AC_SCHEMA_INVALID.",
    "--json": "Accepted for symmetry; output is always JSON.",
    "--help, -h": "Show help without reading the repository."
  },
  writes: "none; no daemon, no local store, no CodeGraph sync. Outside a Git worktree it fails with AC_REPO_NOT_FOUND (git-worktree-required).",
  capability: "projection-freshness-v1"
};

/**
 * `readFlag` reads the next token whatever it is, so a bare trailing `--request-json` looks
 * exactly like an absent flag and a `--assessment-digest --json` swallows the next flag as its
 * value. On `refactor` both are a caller that meant to pass something, and running the default
 * scan or recording under a flag name would answer a question nobody asked.
 */
function refactorFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return refactorFlagValueAt(args, index, flag);
}

function refactorFlagValueAt(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new RefactorFlagError(`refactor ${flag} requires a value`);
  return value;
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
  /** Source of `plan --body -` and `resolve --paths-from -`; defaults to the process stdin. */
  readStdin?: () => string | Promise<string>;
  disableRpcDiscovery?: boolean;
  devicePrivateKeyStore?: {
    provisionDevicePrivateKey(input: { accountId: string; publicKeyId: string; createdAt?: string }): { reference: DeviceKeyCredentialReference };
    signWithDevicePrivateKey(input: { keyRef: string; payload: string | Uint8Array }): string;
    removeDevicePrivateKey(keyRef: string): void;
  };
  // The adapter must verify authorization, device registration and durable credential access.
  // A cached local JSON record is never connection authority.
  githubConnectionReader?: {
    readVerifiedConnection(input: { repositoryRoot: string }): Promise<GitHubConnectionRecord | undefined>;
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

export interface GitHubConnectionRecord {
  schemaVersion: "archcontext.github-connection/v1";
  status: "connected";
  accountId: string;
  githubUserId: string;
  issuer: string;
  deviceKey: DeviceKeyCredentialReference;
  connectedAt: string;
}

interface CliRuntimeHandle {
  client: RuntimeDaemonClient;
  close(): Promise<void>;
}

type AgentHost = "codex" | "claude" | "generic";

type CliCommandResult = Awaited<ReturnType<typeof runCliUnchecked>> | FailureEnvelope;

export function runCli(command: "capabilities", args?: string[], cwd?: string, deps?: CliRuntimeDeps): Promise<ArchctxCapabilitiesV1 | CliCommandResult>;
export function runCli(command?: string, args?: string[], cwd?: string, deps?: CliRuntimeDeps): Promise<CliCommandResult>;
export async function runCli(command = "help", args: string[] = [], cwd = process.cwd(), deps: CliRuntimeDeps = {}): Promise<ArchctxCapabilitiesV1 | CliCommandResult> {
  if (command === "capabilities") {
    const preflight = preflightCliArguments(command, args);
    if (preflight) return preflight;
    const jsonFlags = args.filter((arg) => arg === "--json");
    const unexpected = args.filter((arg) => arg !== "--json");
    if (jsonFlags.length > 1 || unexpected.length > 0) {
      return errorEnvelope("capabilities", "AC_SCHEMA_INVALID", "capabilities accepts only one optional --json flag");
    }
    return runCapabilitiesCommand();
  }
  const selected = ["debt", "checkpoint", "complete", "review"].includes(command)
    || (command === "practices" && args[0] === "checkpoint")
    || (command === "hook" && args[0] === "checkpoint");
  try {
    if (selected) {
      const preflight = preflightCliArguments(command, args);
      if (preflight) return preflight.ok ? preflight : failureEnvelope(command, knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"));
    }
    const result = await runCliUnchecked(command, args, cwd, deps);
    return selected ? normalizeFailureResult(result, "cli", command === "practices" ? "practices.checkpoint" : command === "hook" ? "hook.checkpoint" : command) : result;
  } catch (error) {
    if (selected) {
      if (error instanceof CliUsageError) return failureEnvelope(command, knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"));
      if (error instanceof RuntimeRpcTransportError) {
        try {
          const metadata = Object.fromEntries(["code", "method", "timeoutMs", "elapsedMs"].map(key => {
            const descriptor = Object.getOwnPropertyDescriptor(error, key);
            if (!descriptor || !("value" in descriptor)) throw new Error("Invalid selected transport metadata");
            return [key, descriptor.value];
          }));
          return failureEnvelope(command, knownFailure(metadata.code,
            metadata.code === "RPC_TIMEOUT" ? "rpc-timeout" : "rpc-aborted", {
              method: metadata.method, timeoutMs: metadata.timeoutMs, elapsedMs: metadata.elapsedMs, mutationOutcome: "unknown"
            }));
        }
        catch { return failureEnvelope(command, unclassifiedFailure("failure-metadata")); }
      }
      if (error instanceof LocalEgressPolicyError) return failureEnvelope(command, knownFailure("AC_POLICY_VIOLATION", "egress-policy-denied"));
      if (error instanceof RuntimeVersionUnsupportedError) return failureEnvelope(command, knownFailure("AC_RUNTIME_VERSION_UNSUPPORTED", "runtime-version-unsupported"));
      return selectedProducerFailureEnvelope(command, error, "cli");
    }
    if (error instanceof LocalEgressPolicyError) return errorEnvelope(command, "AC_POLICY_VIOLATION", error.message);
    // archctx requires a Git worktree; an embedded runtime throws this before any RPC envelope exists.
    if (error instanceof GitVisibleFilesUnavailableError) return errorEnvelope(command, error.code, error.message, error.reasonCode);
    if (error instanceof RuntimeVersionUnsupportedError) {
      return errorEnvelope(command ?? "cli", "AC_RUNTIME_VERSION_UNSUPPORTED", error.message);
    }
    throw error;
  }
}

export function runCapabilitiesCommand() {
  return archctxCapabilities(ARCHCONTEXT_PRODUCT_VERSION);
}

async function runCliUnchecked(command = "help", args: string[] = [], cwd: string, deps: CliRuntimeDeps = {}) {
  if (command === "export" && args[0] === "native") return runNativeContextCommand(args.slice(1), cwd);
  const preflight = preflightCliArguments(command, args);
  if (preflight) return preflight;
  if (command === "daemon") return runDaemonCommand(args, cwd);
  if (command === "github") return runGithubCommand(args, cwd, deps);
  // One runtime per command: over RPC every call reaches the same archctxd anyway, and an embedded
  // runtime owns the local store exclusively (#160), so a second one in the same command would be a
  // second writer on the same store.
  let runtimeHandle: Promise<CliRuntimeHandle> | undefined;
  const runtime = async () => {
    runtimeHandle ??= createCliRuntime(cwd, deps, command === "complete" || command === "review" || (command === "practices" && args[0] === "checkpoint"));
    return (await runtimeHandle).client;
  };
  // Commands may return an unsettled promise; it must settle before the runtime closes below.
  const execute = async () => {
    switch (command) {
    case "init":
      return (await runtime()).init(cwd, readFlag(args, "--name") ?? "ArchContext Project");
    case "sync":
      return (await runtime()).sync(cwd, readRepeatedFlag(args, "--changed"));
    case "validate":
      return (await runtime()).validate(cwd);
    case "context": {
      const taskText = cliTaskText("context", args);
      if (!taskText.ok) return taskText.envelope;
      const task = taskText.task;
      const daemon = await runtime();
      if (args.includes("--landscape")) {
        await daemon.repoAdd(cwd, readFlag(args, "--name") ?? "local");
        return daemon.contextLandscape(task, Number(readFlag(args, "--max-symbols") ?? 12));
      }
      return daemon.context(cwd, task, Number(readFlag(args, "--max-symbols") ?? 12));
    }
    case "status":
      return (await runtime()).runtimeStatus(cwd);
    case "projection":
      return await runProjectionProtocolCommand(args, cwd, runtime);
    case "flows":
      return runFlowsCommand(args, cwd);
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
    case "state":
      return runRuntimeStateCommand(args, cwd, runtime);
    case "ledger":
      return runLedgerCommand(args, cwd, runtime);
    case "book":
      return await runBookCommand(args, cwd, await runtime());
    case "recommendations":
      return runRecommendationsCommand(args, cwd, await runtime());
    case "refactor":
      return runRefactorCommand(args, cwd, runtime);
    case "explore": {
      const subcommand = args[0] ?? "status";
      const daemon = await runtime();
      if (subcommand === "projection") return daemon.explorerProjectionV2(cwd, explorerProjectionQueryV2FromCli(args));
      if (subcommand === "delta") {
        const baseEventId = readFlag(args, "--base-event-id");
        const headEventId = readFlag(args, "--head-event-id");
        const baseProjectionDigest = readFlag(args, "--base-projection-digest");
        const headProjectionDigest = readFlag(args, "--head-projection-digest");
        if (!baseEventId || !headEventId || !baseProjectionDigest || !headProjectionDigest) return errorEnvelope("explorer.delta", "AC_SCHEMA_INVALID", "explore delta requires --base-event-id, --head-event-id, --base-projection-digest and --head-projection-digest");
        return daemon.explorerProjectionDelta(cwd, {
          schemaVersion: "archcontext.explorer-delta-query/v2",
          base: { eventId: baseEventId, projectionDigest: baseProjectionDigest },
          head: { eventId: headEventId, projectionDigest: headProjectionDigest }
        });
      }
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
      return errorEnvelope("explore", "AC_SCHEMA_INVALID", "explore requires start|stop|status|revoke|projection|delta|contract");
    }
    case "prepare": {
      const taskText = cliTaskText("prepare", args);
      if (!taskText.ok) return taskText.envelope;
      const task = taskText.task;
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
      // `docs anchors` is read-only and answered in-process, before any runtime client exists, so
      // it never starts a daemon or opens the local store (#298).
      if (args[0] === "anchors") return runDocsAnchorsCliCommand(args.slice(1), cwd);
      return await runDocsCommand(args, cwd, await runtime());
    case "agent-context":
      return await runAgentContextProjectionCommand(args, cwd, await runtime());
    case "practices":
      return runPracticesCommand(args, cwd, await runtime());
    case "checkpoint":
      return runCheckpointCommand(args, cwd);
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
      // User-level consent is written by the CLI only (never MCP/RPC) and needs no daemon.
      if (args[0] === "consent") return runAuditConsentCommand(args, cwd);
      // Lazy runtime (like "hook" below): eagerly `await runtime()` here would start/connect to
      // archctxd — writing runtime.sqlite, locks, and archctxd.json — before runAuditCommand gets a
      // chance to refuse a disabled capability or missing consent with zero side effects (#182).
      return runAuditCommand(args, cwd, runtime);
    case "review":
    case "complete": {
      const result = await (await runtime()).completeTask(cwd, {
        taskSessionId: readFlag(args, "--task-session-id") ?? "task_cli",
        task: readFlag(args, "--task"),
        posture: (readFlag(args, "--posture") as any) ?? "normal",
        headSha: readFlag(args, "--head-sha")
      });
      return { ...result, requestId: command };
    }
    case "plan": {
      const operations = await readCliPlanOperations(args, cwd, deps);
      if (typeof operations === "string") return errorEnvelope("plan", "AC_SCHEMA_INVALID", operations);
      return (await runtime()).planUpdate(cwd, {
        id: readFlag(args, "--id") ?? "changeset.cli",
        operations
      });
    }
    case "hash":
      return runHashCommand(args, cwd);
    case "apply": {
      return (await runtime()).applyUpdate(cwd, {
        id: readFlag(args, "--id") ?? "changeset.cli",
        approved: args.includes("--approved"),
        expectedWorktreeDigest: requireFlag(args, "--expected-worktree-digest")
      });
    }
    case "manifest": {
      if (args[0] !== "plan") return errorEnvelope("manifest", "AC_SCHEMA_INVALID", "manifest requires plan; use --help");
      const seen = new Set<string>();
      for (let index = 1; index < args.length; index += 2) {
        const flag = args[index];
        if (!["--id", "--decisions"].includes(flag) || seen.has(flag) || !args[index + 1] || args[index + 1].startsWith("--")) {
          return errorEnvelope("manifest", "AC_SCHEMA_INVALID", "manifest plan accepts one --id and one --decisions value only");
        }
        seen.add(flag);
      }
      const id = requireFlag(args, "--id");
      const decisions = requireFlag(args, "--decisions");
      if (decisions !== "docs/adr") return errorEnvelope("manifest", "AC_SCHEMA_INVALID", "content.decisions supports only docs/adr");
      const root = findRepositoryRoot(cwd);
      const operation = planManifestFieldsOperation(root, { "content.decisions": decisions });
      return (await runtime()).planUpdate(root, { id, operations: [operation] });
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
    case "debt":
      return runArchitectureDebtCommand(cwd, { changedPaths: readRepeatedFlag(args, "--changed-path") });
    case "deps":
      return runDepsCommand(args, cwd);
    case "resolve": {
      if (args.includes("--path") && args.includes("--paths-from")) {
        return errorEnvelope("resolve", "AC_SCHEMA_INVALID", "resolve accepts exactly one of --path or --paths-from");
      }
      if (args.includes("--paths-from")) {
        const read = await readResolvePathsFrom(args, cwd, deps);
        if ("problem" in read) return errorEnvelope("resolve", "AC_SCHEMA_INVALID", read.problem);
        const model = loadNativeModelFromArchContext(cwd);
        const outcomes = resolveArchitectureOwnersForPaths(model.nodes, read.paths);
        return okEnvelope("resolve", { results: outcomes.map((outcome, index) => resolveResultData(read.paths[index], outcome)) } as unknown as Json);
      }
      const path = readFlag(args, "--path");
      if (!path) return errorEnvelope("resolve", "AC_SCHEMA_INVALID", "resolve requires --path or --paths-from");
      if (!isRepoRelativePosixPath(path)) {
        return errorEnvelope("resolve", "AC_SCHEMA_INVALID", "resolve --path must be a repository-relative POSIX path");
      }
      const model = loadNativeModelFromArchContext(cwd);
      return okEnvelope("resolve", resolveResultData(path, resolveArchitectureOwnerForPath(model.nodes, path)) as unknown as Json);
    }
    case "help":
    default:
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: true,
        requestId: "help",
        data: {
          commands: ["capabilities", "projection", "init", "sync", "validate", "context", "status", "daemon", "state", "repo", "landscape", "ledger", "book", "recommendations", "refactor", "explore", "prepare", "practices", "checkpoint", "hook", "hooks", "investigate", "agents", "jobs", "audit", "plan", "apply", "hash", "review", "complete", "github", "manifest", "config", "mcp", "install", "uninstall", "doctor", "update", "paths", "privacy-audit", "export", "import", "resolve", "tunnel", "flows", "deps", "debt"],
          examples: CLI_HELP_EXAMPLES
        }
      };
    }
  };
  try {
    return await execute();
  } finally {
    const handle = await runtimeHandle?.catch(() => undefined);
    await handle?.close();
  }
}

/**
 * `--help`/`-h` for every command, answered by `preflightCliArguments` before any handler runs, so
 * help never starts archctxd or performs the command (#182, #322). A command with no dedicated text
 * gets its examples from the general help.
 */
function cliHelpEnvelope(command: string, args: string[]): JsonEnvelope {
  const subcommand = args[0];
  switch (command) {
  case "init":
    return okEnvelope("help", {
      usage: "archctx init [--name <product-name>]",
      description: "Initialize the repository architecture model and generated projection.",
      options: {
        "--name <product-name>": "Product name (default: ArchContext Project).",
        "--help, -h": "Show help without initializing the repository."
      }
    });
  case "plan":
    return okEnvelope("plan", CLI_PLAN_HELP as unknown as Json);
  case "hash":
    return okEnvelope("hash", CLI_HASH_HELP as unknown as Json);
  case "manifest":
    return okEnvelope("manifest", {
      command: "archctx manifest plan --id <changeset.id> --decisions docs/adr",
      supportedFields: { "content.decisions": "docs/adr" },
      writes: "none; approve the returned ChangeSet with archctx apply"
    });
  case "resolve":
    return okEnvelope("resolve", CLI_RESOLVE_HELP as unknown as Json);
  case "practices":
    if (subcommand === "checkpoint") return okEnvelope("help", {
      usage: "archctx practices checkpoint [--task-session-id <id>] [--task <text>] [--event <event>] [--path <path>]... [--changed <path>]... [--expected-head-sha <sha>] [--expected-worktree-digest <digest>] [--tool-call-id <id>] [--max-bytes <bytes>] [--max-items <items>] [--json]",
      schemaVersion: "archcontext.practice-checkpoint/v1",
      writes: "daemon-owned practice baseline; prepare seeds the initial baseline",
      description: "Explicit practice writer. Preserves stale context, failure and event coalescing; edit-time debt reads use checkpoint instead."
    });
    break;
  case "hook":
    if (subcommand === "checkpoint") return okEnvelope("help", {
      usage: "archctx hook checkpoint [--event <event>] [--changed-path <path>]... [--json]",
      schemaVersion: "archcontext.hook-debt-checkpoint/v1",
      writes: "none; no runtime or baseline access on success or failure",
      description: "Read-only debt hook with redacted logging. Producer failures fail open with unknown coverage and a typed error; invalid arguments are rejected."
    });
    break;
  case "checkpoint":
  case "debt":
    return okEnvelope("help", {
      command: `archctx ${command}`,
      usage: `archctx ${command} [--changed-path <path>]... [--json]`,
      schemaVersion: "archcontext.architecture-debt/v1",
      description: "Edit-time ownership and human citation debt for changed paths. Dependency, flow and practice checks are explicit coverage gaps reserved for complete; no source byte stamp is debt.",
      writes: "none; no daemon, runtime state, rendering or CodeGraph sync"
    });
  case "deps":
    return okEnvelope("deps", CLI_DEPS_HELP as unknown as Json);
  case "flows":
    return okEnvelope("flows", {
      command: "archctx flows check [--json]",
      description: "Check every declared flow selector against the CodeGraph index without rendering a projection.",
      statuses: "Each selector reports proven, no-direct-call, only-references, false-builtin-call, ambiguous-symbol, evidence-missing or evidence-truncated. Only proven binds a flow step.",
      writes: "none; runs in-process with no daemon, local store or task session. Like projection check, it runs codegraph sync first."
    });
  case "docs":
    if (subcommand === "anchors") return okEnvelope("help", CLI_DOCS_ANCHORS_HELP as unknown as Json);
    break;
  case "projection":
    if (subcommand === "freshness") return okEnvelope("help", CLI_PROJECTION_FRESHNESS_HELP as unknown as Json);
    break;
  case "daemon":
    return okEnvelope("daemon", {
      usage: [
        "archctx daemon status",
        "archctx daemon start [--port <port>] [--idle-timeout-ms <ms>]",
        "archctx daemon stop [--state-dir <dir> | --workspace-id <ws.id>]",
        "archctx daemon list",
        "archctx daemon upgrade"
      ],
      description: "Manage the local archctxd for this worktree. daemon list reads every daemon's control files under the state root, including daemons whose worktree no longer exists; daemon stop --state-dir or --workspace-id stops one of them without its worktree.",
      options: {
        "--state-dir <dir>": "daemon stop: the daemon's state directory, as daemon list prints it.",
        "--workspace-id <ws.id>": "daemon stop: the daemon's storage workspace id, as daemon list prints it.",
        "--help, -h": "Show help without starting, stopping or reading a daemon."
      }
    } as unknown as Json);
  case "audit":
    return auditHelpEnvelope(subcommand);
  }
  return okEnvelope("help", {
    command: `archctx ${command}`,
    description: `archctx ${command} has no dedicated help text. --help never runs it or starts the local runtime; run archctx help for every command.`,
    examples: CLI_HELP_EXAMPLES.filter((example) => example === `archctx ${command}` || example.startsWith(`archctx ${command} `))
  });
}

function auditHelpEnvelope(subcommand: string | undefined): JsonEnvelope {
  if (subcommand === "list") {
    return okEnvelope("audit.list", {
      schemaVersion: "archcontext.audit-list-help/v1",
      usage: "archctx audit list [--status <status>[,<status>...]]",
      description: "List architecture audit runs, most recent first.",
      options: {
        "--status <status>": `Filter by run status; repeatable or comma-separated (${AUDIT_RUN_STATUSES.join("|")}).`,
        "--help, -h": "Show help without listing anything."
      }
    } as unknown as Json);
  }
  if (subcommand === "show") {
    return okEnvelope("audit.show", {
      schemaVersion: "archcontext.audit-show-help/v1",
      usage: "archctx audit show <run-id>",
      description: "Show one audit run's detail, including its drafted GitHub issues.",
      options: {
        "<run-id>": "The audit run to show; may also be passed as --run-id <id>.",
        "--help, -h": "Show help without reading anything."
      }
    } as unknown as Json);
  }
  if (subcommand === "approve") {
    return okEnvelope("audit.approve", {
      schemaVersion: "archcontext.audit-approve-help/v1",
      usage: "archctx audit approve <run-id> [--confirm-public-repo <token>] [--resume]",
      description: "Approve a pending audit run and publish its drafted GitHub issues. Requires audit.githubIssues.enabled in .archcontext/manifest.yaml and archctx audit consent.",
      options: {
        "<run-id>": "The audit run to approve; may also be passed as --run-id <id>.",
        "--confirm-public-repo <token>": "Required once, verbatim, when the run's repository resolves to non-private visibility.",
        "--resume": "Continue a run left in \"issuing\" status by a prior crashed/partial approve call.",
        "--help, -h": "Show help without approving or publishing anything."
      }
    } as unknown as Json);
  }
  if (subcommand === "consent") {
    return okEnvelope("audit.consent", {
      schemaVersion: "archcontext.audit-consent-help/v1",
      usage: ["archctx audit consent", "archctx audit consent --revoke"],
      description: "Grant (or revoke) user-level consent, stored in the user state directory, for archctx audit run/approve in this repository. The repository manifest only declares the capability."
    } as unknown as Json);
  }
  if (subcommand === "run") {
    return okEnvelope("audit.run", {
      schemaVersion: "archcontext.audit-run-help/v1",
      usage: "archctx audit run [--reason <text>] [--task-session-id <id>] [--risk <level>] [--uncertainty <level>] [--context-max-items <n>] [--model-id <id>] [--timeout-ms <ms>] [--no-wait]",
      description: "Start an architecture audit run. Requires audit.githubIssues.enabled in .archcontext/manifest.yaml and archctx audit consent.",
      options: {
        "--reason <text>": "Human-readable reason recorded with the run.",
        "--task-session-id <id>": "Correlate this run with an existing task session.",
        "--risk <level>": "Investigation risk hint passed to the daemon.",
        "--uncertainty <level>": "Investigation uncertainty hint passed to the daemon.",
        "--context-max-items <n>": "Cap on context items gathered for the run.",
        "--model-id <id>": "Override the model used for the run.",
        "--timeout-ms <ms>": `How long the CLI polls \`archctx audit list\` before returning (default: ${AUDIT_RUN_DEFAULT_TIMEOUT_MS}ms); ignored with --no-wait.`,
        "--no-wait": "Return immediately after the daemon accepts the run instead of polling audit list.",
        "--help, -h": "Show help without starting an audit run."
      }
    } as unknown as Json);
  }
  return okEnvelope("audit", {
    schemaVersion: "archcontext.audit-help/v1",
    usage: [
      "archctx audit run [options]",
      "archctx audit approve <run-id> [options]",
      "archctx audit list [--status <status>[,<status>...]]",
      "archctx audit show <run-id>",
      "archctx audit consent [--revoke]"
    ],
    description: "Manage architecture audit runs. Run `archctx audit <subcommand> --help` for a subcommand's own options."
  } as unknown as Json);
}

async function runRuntimeStateCommand(
  args: string[],
  cwd: string,
  runtime: () => Promise<RuntimeDaemonClient>
) {
  const subcommand = args[0] ?? "status";
  if (subcommand !== "recover" || !args.includes("--from-git")) {
    return errorEnvelope("state", "AC_SCHEMA_INVALID", "state requires recover --from-git");
  }
  const write = args.includes("--write");
  if (write && args.includes("--dry-run")) {
    return errorEnvelope("state.recover", "AC_SCHEMA_INVALID", "state recover accepts --dry-run or --write, not both");
  }
  const worktreeDigest = runtimeStateRecoveryWorktreeDigest(cwd);
  const inspection = inspectRuntimeStateRecovery(cwd);
  const writeCommand = inspection.status === "recovery-required" && inspection.targetFingerprint
    ? `archctx state recover --from-git --write --expected-worktree-digest ${worktreeDigest} --expected-target-fingerprint ${inspection.targetFingerprint}`
    : undefined;
  if (!write) {
    return okEnvelope("state.recover", {
      ...inspection,
      worktreeDigest,
      ...(writeCommand ? { writeCommand } : {})
    } as unknown as Json);
  }
  const expectedWorktreeDigest = readFlag(args, "--expected-worktree-digest");
  const expectedTargetFingerprint = readFlag(args, "--expected-target-fingerprint");
  if (!expectedWorktreeDigest || !expectedTargetFingerprint) {
    return errorEnvelope("state.recover", "AC_SCHEMA_INVALID", "state recover --write requires --expected-worktree-digest and --expected-target-fingerprint from dry-run");
  }
  if (expectedWorktreeDigest !== worktreeDigest) {
    return errorEnvelope("state.recover", "AC_PRECONDITION_FAILED", `state recover worktree digest mismatch: expected ${expectedWorktreeDigest}, current ${worktreeDigest}`);
  }
  if (inspection.status !== "recovery-required") {
    return errorEnvelope("state.recover", "AC_CAPABILITY_UNSUPPORTED", `state recovery is not available: ${inspection.reasonCode}`);
  }
  if (inspection.targetFingerprint !== expectedTargetFingerprint) {
    return errorEnvelope("state.recover", "AC_PRECONDITION_FAILED", `state recover target fingerprint mismatch: expected ${expectedTargetFingerprint}, current ${inspection.targetFingerprint ?? "missing"}`);
  }

  const recovery = recoverRuntimeStateTarget({
    root: cwd,
    expectedTargetFingerprint,
    expectedWorktreeDigest
  });
  const acceptExternalProjection = args.includes("--accept-external-projection");
  const rebuildWorktreeDigest = computeWorktreeDigest(cwd, listGitVisibleFiles(cwd));
  const rebuild = await (await runtime()).ledgerRebuild(cwd, {
    fromGit: true,
    expectedWorktreeDigest: rebuildWorktreeDigest,
    acceptExternalProjection
  });
  const rebuildSummary = {
    schemaVersion: "archcontext.runtime-state-recovery-rebuild-summary/v1",
    ok: rebuild.ok,
    requestId: rebuild.requestId,
    resultDigest: digestJson(rebuild as unknown as Json)
  };
  const retryCommand = `archctx ledger rebuild --from-git --expected-worktree-digest ${rebuildWorktreeDigest}${acceptExternalProjection ? " --accept-external-projection" : ""}`;
  if (!rebuild.ok) {
    return {
      ...rebuild,
      requestId: "state.recover",
      data: { recovery, rebuildSummary, retryCommand } as unknown as Json
    };
  }
  const completion = completeRuntimeStateRecovery({ recovery, rebuildResult: rebuild as unknown as Json });
  return okEnvelope("state.recover", {
    schemaVersion: "archcontext.runtime-state-recovery-command/v1",
    status: "recovered",
    recovery,
    rebuildSummary,
    completion,
    rebuildWorktreeDigest,
    retryCommand
  } as unknown as Json);
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
  if (subcommand === "accept-committed") {
    const usage = "ledger accept-committed requires --journal <journalId>=<changeSetId> (repeatable, in commit order) or --journal-id with --changeset-id; approve with --approved --acceptance-plan-id <id> --expected-worktree-digest <digest> from the preview";
    const pairs = readRepeatedFlag(args, "--journal");
    const journalId = readFlag(args, "--journal-id");
    const changeSetId = readFlag(args, "--changeset-id");
    if (args.filter((arg) => arg === "--journal").length !== pairs.length) return errorEnvelope("ledger.accept-committed", "AC_SCHEMA_INVALID", usage);
    if (pairs.length > 0 ? journalId !== undefined || changeSetId !== undefined : !journalId || !changeSetId) {
      return errorEnvelope("ledger.accept-committed", "AC_SCHEMA_INVALID", usage);
    }
    const journals = pairs.length > 0
      ? pairs.map((pair) => {
        const separator = pair.indexOf("=");
        return separator <= 0 ? { journalId: "", changeSetId: "" } : { journalId: pair.slice(0, separator), changeSetId: pair.slice(separator + 1) };
      })
      : [{ journalId: journalId!, changeSetId: changeSetId! }];
    if (journals.some((journal) => !journal.journalId || !journal.changeSetId)) return errorEnvelope("ledger.accept-committed", "AC_SCHEMA_INVALID", usage);
    const approved = args.includes("--approved");
    const acceptancePlanId = readFlag(args, "--acceptance-plan-id");
    const expectedWorktreeDigest = readFlag(args, "--expected-worktree-digest");
    if (approved ? !acceptancePlanId || !expectedWorktreeDigest : acceptancePlanId !== undefined || expectedWorktreeDigest !== undefined) {
      return errorEnvelope("ledger.accept-committed", "AC_SCHEMA_INVALID", usage);
    }
    const daemon = await requiredLedgerRuntime(runtime);
    return daemon.acceptCommittedChange(cwd, approved ? { journals, approved, acceptancePlanId, expectedWorktreeDigest } : { journals });
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
    const fromYaml = args.includes("--from-yaml");
    const recommendationV3 = args.includes("--recommendation-v3");
    if (fromYaml === recommendationV3) {
      return errorEnvelope("ledger.migrate", "AC_SCHEMA_INVALID", "ledger migrate requires exactly one of --from-yaml or --recommendation-v3");
    }
    const mode = fromYaml ? "--from-yaml" : "--recommendation-v3";
    const write = args.includes("--write");
    if (write && args.includes("--dry-run")) {
      return errorEnvelope("ledger.migrate", "AC_SCHEMA_INVALID", "ledger migrate accepts --dry-run or --write, not both");
    }
    const expectedWorktreeDigest = readFlag(args, "--expected-worktree-digest");
    if (write && !expectedWorktreeDigest) {
      return errorEnvelope("ledger.migrate", "AC_SCHEMA_INVALID", `ledger migrate ${mode} --write requires --expected-worktree-digest`);
    }
    const daemon = await requiredLedgerRuntime(runtime);
    return daemon.ledgerMigrate(cwd, {
      ...(fromYaml ? { fromYaml: true } : { recommendationV3: true }),
      dryRun: !write,
      expectedWorktreeDigest
    });
  }
  return errorEnvelope("ledger", "AC_SCHEMA_INVALID", "ledger requires status, state, drift --json, accept-committed, promote --mode authoritative --preflight --rollback-plan, migrate --from-yaml, migrate --recommendation-v3, rebuild --from-git, rollback --to-yaml, or project --to-git");
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
  if (subcommand === "show") {
    const recommendationId = readFlag(args, "--id") ?? readFlag(args, "--recommendation-id") ?? args[1];
    if (!recommendationId || recommendationId.startsWith("--")) {
      return errorEnvelope("recommendations.show", "AC_SCHEMA_INVALID", "recommendations show requires --id");
    }
    const importNodeLimit = recommendationsImportNodeLimit(args);
    if (importNodeLimit === null) return recommendationsImportNodeLimitError("show");
    return daemon.recommendations(cwd, { command: "show", recommendationId, ...(importNodeLimit === undefined ? {} : { importNodeLimit }) });
  }
  if (subcommand === "list") {
    // The daemon owns the status vocabulary and rejects anything outside it.
    const status = readFlag(args, "--status");
    return daemon.recommendations(cwd, { command: "list", ...(status === undefined ? {} : { status: status as RuntimeRecommendationInput["status"] }) });
  }
  if (!["acknowledge", "accept", "reject", "defer", "waive", "resolve"].includes(subcommand)) {
    return errorEnvelope("recommendations", "AC_SCHEMA_INVALID", "recommendations requires acknowledge|accept|reject|defer|waive|resolve|metrics|show|list");
  }
  const recommendationId = readFlag(args, "--id") ?? readFlag(args, "--recommendation-id") ?? args[1];
  if (!recommendationId || recommendationId.startsWith("--")) {
    return errorEnvelope(`recommendations.${subcommand}`, "AC_SCHEMA_INVALID", `recommendations ${subcommand} requires --id`);
  }
  const reason = readFlag(args, "--reason");
  if (!reason) return errorEnvelope(`recommendations.${subcommand}`, "AC_SCHEMA_INVALID", `recommendations ${subcommand} requires --reason`);
  const importNodeLimit = recommendationsImportNodeLimit(args);
  if (importNodeLimit === null) return recommendationsImportNodeLimitError(subcommand);
  const input: RuntimeRecommendationInput = {
    command: subcommand as RuntimeRecommendationInput["command"],
    recommendationId,
    reason,
    // The one-shot verb is the explicit, narrow approval of this single decision write (ADR-0046).
    approved: true,
    actor: readFlag(args, "--actor") ?? "developer",
    ...(readFlag(args, "--actor-kind") === undefined ? {} : { actorKind: readFlag(args, "--actor-kind")! as any }),
    ...(readFlag(args, "--source") === undefined ? {} : { source: readFlag(args, "--source")! as any }),
    ...(readFlag(args, "--expected-worktree-digest") === undefined ? {} : { expectedWorktreeDigest: readFlag(args, "--expected-worktree-digest")! }),
    ...(readFlag(args, "--evidence-digest") === undefined ? {} : { evidenceDigest: readFlag(args, "--evidence-digest")! }),
    ...(importNodeLimit === undefined ? {} : { importNodeLimit }),
    ...(readFlag(args, "--agent-job-id") === undefined ? {} : { agentJobId: readFlag(args, "--agent-job-id")! }),
    ...(readFlag(args, "--now") === undefined ? {} : { now: readFlag(args, "--now")! })
  };
  return daemon.recommendations(cwd, input);
}

/**
 * `--import-node-limit` on `recommendations show` and the decisions: the limit of the scan that
 * found the candidate. `null` is a flag without a valid value.
 */
function recommendationsImportNodeLimit(args: string[]): number | undefined | null {
  const index = args.indexOf("--import-node-limit");
  if (index === -1) return undefined;
  const raw = args[index + 1];
  return raw === undefined ? null : importNodeLimitValue(raw) ?? null;
}

function recommendationsImportNodeLimitError(subcommand: string) {
  return errorEnvelope(`recommendations.${subcommand}`, "AC_SCHEMA_INVALID", `recommendations ${subcommand} --import-node-limit must be a positive integer`);
}

/**
 * A positive integer, digits only: `Number("1e3")` or `Number(" 7 ")` would accept a value the
 * caller did not type.
 */
function importNodeLimitValue(raw: string): number | undefined {
  return /^[0-9]+$/.test(raw) && Number(raw) >= 1 ? Number(raw) : undefined;
}

/**
 * Thin adapter over `refactorScan` / `refactorRecord` / `refactorVerify`. The measured envelope is
 * returned exactly as the daemon produced it: sorting, trimming or re-keying it here would hide a
 * real source of nondeterminism behind the surface that is supposed to prove there is none.
 *
 * `runtime` is taken as a factory rather than an already-obtained client because obtaining one
 * starts a daemon: a connection file, a thirty-minute idle process, possibly a state migration.
 * A rejected invocation asked for none of that, so every subcommand finishes its flag, JSON and
 * invariant checks first and only then reaches for the handle. `AC_SCHEMA_INVALID` here is
 * produced without the daemon ever being touched.
 */
async function runRefactorCommand(args: string[], cwd: string, runtime: () => Promise<RuntimeDaemonClient>) {
  const subcommand = args[0] ?? "scan";
  if (subcommand !== "scan" && subcommand !== "record" && subcommand !== "verify") {
    return errorEnvelope("refactor", "AC_SCHEMA_INVALID", "refactor requires scan|record|verify");
  }
  const surface = `refactor.${subcommand}`;
  try {
    if (subcommand === "scan") {
      const raw = refactorFlagValue(args, "--request-json");
      const limitRaw = refactorFlagValue(args, "--import-node-limit");
      // No request is the repository-scope default, which is what the daemon already applies.
      if (raw === undefined && limitRaw === undefined) return (await runtime()).refactorScan(cwd, {});
      let request: unknown = { schemaVersion: REFACTOR_REQUEST_SCHEMA_VERSION, scope: { kind: "repository" } };
      if (raw !== undefined) {
        try {
          request = JSON.parse(raw);
        } catch (error) {
          return errorEnvelope(surface, "AC_SCHEMA_INVALID", `refactor scan --request-json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (typeof request !== "object" || request === null || Array.isArray(request)) {
        return errorEnvelope(surface, "AC_SCHEMA_INVALID", "refactor scan --request-json must be a RefactorRequestV1 object");
      }
      if (limitRaw !== undefined) {
        const importNodeLimit = importNodeLimitValue(limitRaw);
        if (importNodeLimit === undefined) {
          return errorEnvelope(surface, "AC_SCHEMA_INVALID", "refactor scan --import-node-limit must be a positive integer");
        }
        request = { ...request, importNodeLimit };
      }
      const issues = refactorRequestInvariantIssues(request as RefactorRequestV1);
      if (issues.length > 0) return errorEnvelope(surface, "AC_SCHEMA_INVALID", issues.join("; "));
      return (await runtime()).refactorScan(cwd, { request: request as RefactorRequestV1 });
    }
    if (subcommand === "verify") {
      // Unlike `scan`, verify has no repository-scope default: the subject is one recorded
      // recommendation, and inventing one would measure something nobody asked about.
      const raw = refactorFlagValue(args, "--request-json");
      if (raw === undefined) {
        return errorEnvelope(surface, "AC_SCHEMA_INVALID", "refactor verify --request-json is required");
      }
      let request: unknown;
      try {
        request = JSON.parse(raw);
      } catch (error) {
        return errorEnvelope(surface, "AC_SCHEMA_INVALID", `refactor verify --request-json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (typeof request !== "object" || request === null || Array.isArray(request)) {
        return errorEnvelope(surface, "AC_SCHEMA_INVALID", "refactor verify --request-json must be a RefactorVerificationRequestV1 object");
      }
      const limitRaw = refactorFlagValue(args, "--import-node-limit");
      if (limitRaw !== undefined) {
        const importNodeLimit = importNodeLimitValue(limitRaw);
        if (importNodeLimit === undefined) {
          return errorEnvelope(surface, "AC_SCHEMA_INVALID", "refactor verify --import-node-limit must be a positive integer");
        }
        request = { ...request, importNodeLimit };
      }
      const issues = refactorVerificationRequestInvariantIssues(request as RefactorVerificationRequestV1);
      if (issues.length > 0) return errorEnvelope(surface, "AC_SCHEMA_INVALID", issues.join("; "));
      return (await runtime()).refactorVerify(cwd, request as RefactorVerificationRequestV1);
    }
    const assessmentDigest = refactorFlagValue(args, "--assessment-digest");
    const expectedWorktreeDigest = refactorFlagValue(args, "--expected-worktree-digest");
    if (!assessmentDigest || !expectedWorktreeDigest) {
      return errorEnvelope(surface, "AC_SCHEMA_INVALID", "refactor record requires --assessment-digest and --expected-worktree-digest");
    }
    // Nothing consumes a selection yet, so accepting one and recording the whole proposal
    // would answer a narrower request than the caller typed. The daemon rejects it too.
    if (args.includes("--selection")) {
      return errorEnvelope(surface, "AC_SCHEMA_INVALID", "refactor record does not support the unknown flag --selection; every planned recommendation is recorded");
    }
    return (await runtime()).refactorRecord(cwd, { assessmentDigest, expectedWorktreeDigest });
  } catch (error) {
    if (error instanceof RefactorFlagError) return errorEnvelope(surface, "AC_SCHEMA_INVALID", error.message);
    throw error;
  }
}

async function runDocsCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  const subcommand = args[0] ?? "status";
  if (["plan", "apply", "adopt", "drift", "clean"].includes(subcommand)) {
    return runArchitectureDocsProjectionCommand(args, cwd, daemon);
  }
  if (!["status", "resolve", "pin", "fetch", "purge"].includes(subcommand)) {
    return errorEnvelope("docs", "AC_SCHEMA_INVALID", "docs requires status|resolve|pin|fetch|purge|plan|apply|adopt|drift|clean|anchors");
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

function runDocsAnchorsCliCommand(args: string[], cwd: string) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--json") continue;
    if (arg === "--profile" && args[index + 1] !== undefined && !args[index + 1]!.startsWith("--")) {
      index += 1;
      continue;
    }
    return errorEnvelope("docs.anchors", "AC_SCHEMA_INVALID", `docs anchors does not accept ${arg}; use --help`);
  }
  let profile: ArchitectureProjectionProfile | undefined;
  try {
    profile = architectureProjectionProfile(args);
  } catch (error) {
    return errorEnvelope("docs.anchors", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }
  return runDocsAnchorsCommand(cwd, profile ? { profile } : {});
}

async function runArchitectureDocsProjectionCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  const action = args[0] ?? "plan";
  try {
    return await daemon.docsProjection(findRepositoryRoot(cwd), {
      action: action as RuntimeDocsProjectionInput["action"],
      profile: architectureProjectionProfile(args),
      acceptedChange: acceptedArchitectureChange(args),
      id: readFlag(args, "--id"),
      taskSessionId: readFlag(args, "--task-session-id"),
      approved: args.includes("--approved"),
      expectedWorktreeDigest: readFlag(args, "--expected-worktree-digest"),
      adoptionPlanId: readFlag(args, "--adoption-plan-id")
    });
  } catch (error) {
    return errorEnvelope(`docs.${action}`, "AC_PRECONDITION_FAILED", error instanceof Error ? error.message : String(error));
  }
}

async function runAgentContextProjectionCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  return daemon.agentContextProjection(findRepositoryRoot(cwd), {
    action: (args[0] ?? "plan") as RuntimeAgentContextProjectionInput["action"],
    id: readFlag(args, "--id"),
    taskSessionId: readFlag(args, "--task-session-id"),
    approved: args.includes("--approved"),
    expectedWorktreeDigest: readFlag(args, "--expected-worktree-digest")
  });
}

async function runProjectionProtocolCommand(args: string[], cwd: string, runtime: () => Promise<RuntimeDaemonClient>): Promise<JsonEnvelope> {
  const action = args[0] ?? "run";
  // `snapshot` is read-only and answered in-process: the `expected` snapshot a request would be
  // checked against now, so consumers never compute the worktree digest themselves.
  if (action === "snapshot") {
    const unexpected = args.slice(1).filter((arg) => arg !== "--json");
    if (unexpected.length > 0) return errorEnvelope("projection.snapshot", "AC_SCHEMA_INVALID", "projection snapshot accepts only --json");
    return runProjectionSnapshotCommand(cwd);
  }
  // `freshness` is read-only and answered in-process: no code facts, no render, no daemon (#327).
  if (action === "freshness") return runProjectionFreshnessCliCommand(args.slice(1), cwd);
  if (!["run", "recover", "readback"].includes(action)) return errorEnvelope("projection", "AC_SCHEMA_INVALID", "projection requires run|recover|readback --request-json <request>, or snapshot|freshness [--json]");
  const raw = readFlag(args, "--request-json");
  if (!raw) return errorEnvelope(`projection.${action}`, "AC_SCHEMA_INVALID", `projection ${action} requires --request-json`);
  let request: RuntimeProjectionInvocation["request"];
  try { request = JSON.parse(raw); }
  catch { return errorEnvelope(`projection.${action}`, "AC_SCHEMA_INVALID", "projection request is not valid JSON"); }
  // `check` is read-only: it is answered in-process, before any runtime client exists, so it can
  // never start a daemon, open the local store or require a task session.
  if (action === "run" && (request as { mode?: unknown } | null)?.mode === "check") {
    return runProjectionCheckInvocation(request, cwd);
  }
  return (await runtime()).projection(findRepositoryRoot(cwd), { action, request } as RuntimeProjectionInvocation);
}

function runProjectionFreshnessCliCommand(args: string[], cwd: string): JsonEnvelope {
  const changedPaths: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--json") continue;
    // Global rendering flag (preflight guarantees it has a value); the process entry reads it, as `flows` does.
    if (arg === "--format") { index += 1; continue; }
    if (arg === "--changed-path") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) return errorEnvelope("projection.freshness", "AC_SCHEMA_INVALID", "projection freshness --changed-path requires a path");
      changedPaths.push(value);
      index += 1;
      continue;
    }
    return errorEnvelope("projection.freshness", "AC_SCHEMA_INVALID", `projection freshness does not accept ${arg}; use --help`);
  }
  return runProjectionFreshnessCommand(cwd, changedPaths.length > 0 ? { changedPaths } : {});
}

/** `flows check` is read-only and answered in-process, like `projection run` in `check` mode. */
function runFlowsCommand(args: string[], cwd: string): JsonEnvelope {
  const formatAt = args.indexOf("--format");
  const unexpected = args.slice(1).filter((arg, index) => arg !== "--json" && (formatAt < 0 || (index + 1 !== formatAt && index !== formatAt)));
  if (args[0] !== "check" || unexpected.length > 0) {
    return errorEnvelope("flows", "AC_SCHEMA_INVALID", "flows requires check [--json]; use --help");
  }
  return runFlowSelectorCheckCommand(cwd);
}

function acceptedArchitectureChange(args: string[]): AcceptedArchitectureChangeReferenceV1 | undefined {
  const changeSetId = readFlag(args, "--accepted-change-set-id");
  const eventId = readFlag(args, "--accepted-event-id");
  const reasonCodes = readRepeatedFlag(args, "--major-reason")
    .flatMap((value) => value.split(","))
    .filter((value) => value !== "")
    .sort() as ArchitectureMajorChangeReasonCode[];
  const affectedNodeIds = readRepeatedFlag(args, "--affected-node")
    .flatMap((value) => value.split(","))
    .filter((value) => value !== "")
    .sort();
  if (!changeSetId && !eventId && reasonCodes.length === 0 && affectedNodeIds.length === 0) return undefined;
  if (!changeSetId || !eventId || reasonCodes.length === 0 || affectedNodeIds.length === 0) {
    throw new Error("architecture-major-change-accepted-reference-incomplete");
  }
  const allowed = new Set<string>(ARCHITECTURE_MAJOR_CHANGE_REASON_CODES);
  const unsupported = reasonCodes.find((reason) => !allowed.has(reason));
  if (unsupported) throw new Error(`architecture-major-change-reason-unsupported: ${unsupported}`);
  return {
    changeSetId,
    eventId,
    reasonCodes: [...new Set(reasonCodes)],
    affectedNodeIds: [...new Set(affectedNodeIds)]
  };
}


/** Without `--profile`, the daemon uses the profile of the committed manifest (#293). */
function architectureProjectionProfile(args: string[]): ArchitectureProjectionProfile | undefined {
  const profile = readFlag(args, "--profile");
  if (profile === undefined) return undefined;
  if (profile !== "default" && profile !== REPO_HARNESS_PROJECTION_PROFILE) {
    throw new Error(`architecture-docs-profile-unsupported: ${profile}`);
  }
  return profile;
}


async function runPracticesCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  const subcommand = args[0] ?? "list";
  if (subcommand === "checkpoint") return runPracticeCheckpointCommand(args.slice(1), cwd, daemon);
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
  return errorEnvelope("practices", "AC_SCHEMA_INVALID", "practices requires checkpoint|list|show|validate|sources|waivers|waive");
}

function runCheckpointCommand(args: string[], cwd: string) {
  return { ...runArchitectureDebtCommand(cwd, { changedPaths: readRepeatedFlag(args, "--changed-path") }), requestId: "checkpoint" };
}

async function runPracticeCheckpointCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  const task = readFlag(args, "--task");
  const result = await daemon.practiceCheckpoint(cwd, {
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
  return { ...result, requestId: "practices.checkpoint" };
}

async function runHookCommand(args: string[], cwd: string, runtime: () => Promise<RuntimeDaemonClient>) {
  const subcommand = args[0] ?? "enqueue";
  if (subcommand === "checkpoint") return runHookCheckpointCommand(args.slice(1), cwd);
  if (subcommand === "enqueue") return runHookEnqueueCommand(args.slice(1), cwd, runtime);
  return errorEnvelope("hook", "AC_SCHEMA_INVALID", "hook requires enqueue|checkpoint");
}

function runHookCheckpointCommand(checkpointArgs: string[], cwd: string) {
  const started = Date.now();
  const event = readFlag(checkpointArgs, "--event") ?? "post-edit";
  if (event.length === 0 || event.length > 1024) return errorEnvelope("hook.checkpoint",
    "AC_SCHEMA_INVALID", "Hook event must contain 1 to 1024 characters", "hook-event-invalid");
  const changedPaths = readRepeatedFlag(checkpointArgs, "--changed-path");
  if (changedPaths.some(path => !isRepoRelativePosixPath(path))) return errorEnvelope("hook.checkpoint",
    "AC_SCHEMA_INVALID", "changedPaths must contain repository-relative POSIX paths", "changed-path-invalid");
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

/**
 * `archctx audit consent [--revoke]`: records (or removes) the user-level consent, outside the
 * repository, that `audit run` / `audit approve` require in addition to the repository manifest's
 * `audit.githubIssues.enabled` capability flag (issue #161).
 */
function runAuditConsentCommand(args: string[], cwd: string) {
  // args[0] is "consent". Parse strictly: anything unrecognized must never be read as a grant.
  const rest = args.slice(1);
  if (rest.length > 1 || (rest.length === 1 && rest[0] !== "--revoke")) {
    return errorEnvelope("audit.consent", "AC_SCHEMA_INVALID", `audit consent accepts no arguments (grant), --revoke, or --help; got: ${rest.join(" ")}`);
  }
  const root = auditManifestGateRoot(cwd);
  if (rest[0] === "--revoke") {
    const revoked = revokeAuditConsent(root);
    return okEnvelope("audit.consent", { schemaVersion: "archcontext.audit-consent-result/v1", status: "revoked", ...revoked } as unknown as Json);
  }
  const granted = grantAuditConsent(root);
  return okEnvelope("audit.consent", {
    schemaVersion: "archcontext.audit-consent-result/v1",
    status: "granted",
    path: granted.path,
    record: granted.record,
    egress: "archctx audit run in this repository may send repository content read by the `claude` runner to its configured model provider; archctx audit approve additionally requires its own GitHub PAT and confirmation gates",
    revokeCommand: "archctx audit consent --revoke"
  } as unknown as Json);
}

async function runAuditCommand(args: string[], cwd: string, runtime: () => Promise<RuntimeDaemonClient>) {
  const subcommand = args[0] ?? "run";
  if (subcommand === "list") {
    const statusResult = readAuditRunStatuses(args, "audit.list");
    if (!statusResult.ok) return statusResult.envelope;
    return (await runtime()).auditList(cwd, { ...(statusResult.statuses.length === 0 ? {} : { statuses: statusResult.statuses }) });
  }
  if (subcommand === "show") {
    const runId = readFlag(args, "--run-id") ?? args[1];
    if (!runId) return errorEnvelope("audit.show", "AC_SCHEMA_INVALID", "audit show requires <run-id> or --run-id");
    const result = await (await runtime()).auditShow(cwd, runId);
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
    const approveConsent = readAuditConsent(auditManifestGateRoot(cwd));
    if (!approveConsent.granted) return auditConsentRequiredEnvelope("audit.approve", approveConsent.reason);
    const confirmPublicToken = readFlag(args, "--confirm-public-repo");
    const daemon = await runtime();
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
    return errorEnvelope("audit", "AC_SCHEMA_INVALID", "audit requires run|list|show|approve|consent");
  }
  if (!auditGithubIssuesEnabled(cwd)) {
    return errorEnvelope(
      "audit.run",
      "AC_CAPABILITY_UNSUPPORTED",
      "archctx audit run is disabled; set audit.githubIssues.enabled: true in .archcontext/manifest.yaml to enable it"
    );
  }
  const runConsent = readAuditConsent(auditManifestGateRoot(cwd));
  if (!runConsent.granted) return auditConsentRequiredEnvelope("audit.run", runConsent.reason);
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
  const daemon = await runtime();
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
    const record = await deps.githubConnectionReader?.readVerifiedConnection({ repositoryRoot: cwd });
    return okEnvelope("github.status", record ? sanitizeGithubConnection(record, connectionPath) : {
      connected: false,
      status: "unavailable",
      reason: "Verified GitHub authorization, device registration and durable credential storage are not configured",
      connectionPath,
      ghCli: "not-used"
    } as any);
  }
  if (subcommand === "connect") {
    return errorEnvelope(
      "github.connect", "AC_CAPABILITY_UNSUPPORTED",
      "GitHub connection is unavailable: authorization exchange, device registration and durable credential storage are not implemented"
    );
  }
  if (subcommand === "disconnect") {
    const connection = await deps.githubConnectionReader?.readVerifiedConnection({ repositoryRoot: cwd });
    const localRecordRemoved = existsSync(connectionPath);
    rmSync(connectionPath, { force: true });
    return okEnvelope("github.disconnect", {
      connected: connection !== undefined,
      localRecordRemoved,
      remoteRevoked: false,
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
  const actions = new Set(["claim", "run", "submit", "status", "retry", "cancel", "discard-legacy-state"]);
  const explicitAction = actions.has(args[0] ?? "") ? args[0] : undefined;
  const action = explicitAction ?? "submit";
  const commandArgs = explicitAction ? args.slice(1) : args;
  const pullRequestNumber = readPullRequestNumber(commandArgs);
  const statePath = defaultGithubDeveloperReviewStatePath(cwd, pullRequestNumber);

  if (action === "discard-legacy-state") {
    return okEnvelope("github.review.discardLegacyState", { discarded: discardLegacyGithubDeveloperReviewState(statePath), statePath } as Json);
  }

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

  const connection = await deps.githubConnectionReader?.readVerifiedConnection({ repositoryRoot: cwd });
  if (!connection) {
    return errorEnvelope("github.review", "AC_RUNTIME_UNAVAILABLE", "github review requires verified authorization, device registration and durable credential access from a configured connection adapter");
  }
  const sanitizedConnection = sanitizeGithubConnection(connection, connectionPath);
  const existing = readGithubDeveloperReviewState(statePath);
  if (action === "retry" && existing?.status === "cancelled" && !commandArgs.includes("--force")) {
    return errorEnvelope("github.review.retry", "AC_SCHEMA_INVALID", "github review retry requires --force after cancel");
  }
  const challengeResult = await resolveGithubReviewChallenge(commandArgs, cwd, deps, sanitizedConnection);
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
  const reviewSecrets = [claimed.challenge.nonce];
  try {
    const prepared = await runtime.client.startDeveloperReviewRun({
      repositoryRoot: cwd,
      challenge: claimed.challenge,
      expectedHeadTreeOid: readFlag(commandArgs, "--expected-head-tree-oid")
    });
    if (!prepared.accepted || !prepared.run) {
      const failed = await writeGithubDeveloperReviewState(cwd, {
        ...claimed.state,
        status: "failed",
        reasonCode: prepared.reasonCode ?? "WORKTREE_PREPARE_FAILED",
        updatedAt: readFlag(commandArgs, "--now") ?? new Date().toISOString()
      }, reviewSecrets);
      return okEnvelope(`github.review.${action}`, sanitizeGithubDeveloperReviewState(failed.state, failed.path) as unknown as Json);
    }

    try {
      const signed = await runtime.client.runSignedDeveloperReviewAttestation({
        challenge: claimed.challenge,
        worktree: prepared.run.worktree,
        keyRef: connection.deviceKey.keyRef,
        principalId: readFlag(commandArgs, "--principal-id") ?? connection.githubUserId,
        publicKeyId: readFlag(commandArgs, "--public-key-id") ?? connection.deviceKey.publicKeyId,
        taskSessionId: readFlag(commandArgs, "--task-session-id") ?? `github_pr_${claimed.challenge.pullRequestNumber}`,
        mergeBaseSha: readFlag(commandArgs, "--merge-base-sha"),
        startedAt: readFlag(commandArgs, "--started-at"),
        completedAt: readFlag(commandArgs, "--completed-at") ?? readFlag(commandArgs, "--now")
      });
      reviewSecrets.push(signed.attestation.signature.value);
      cleanup = await runtime.client.cleanupDeveloperReviewRun({
        repositoryRoot: prepared.run.sourceRoot,
        challengeId: prepared.run.challengeId,
        runId: prepared.run.runId
      }) as unknown as Json;
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
        attestationDigest: signed.attestationDigest,
        updatedAt: readFlag(commandArgs, "--now") ?? new Date().toISOString()
      }, reviewSecrets);
      if (action === "run") {
        return okEnvelope("github.review.run", {
          ...sanitizeGithubDeveloperReviewState(ran.state, ran.path),
          cleanup
        } as unknown as Json);
      }
      const submitted = await submitGithubDeveloperReview(commandArgs, cwd, deps, ran.state, claimed.challenge, signed.attestation);
      return okEnvelope("github.review.submit", {
        ...sanitizeGithubDeveloperReviewState(submitted.state, submitted.path),
        cleanup
      } as unknown as Json);
    } catch (error) {
      if (!cleanup) cleanup = await Promise.resolve(runtime.client.cleanupDeveloperReviewRun({
        repositoryRoot: prepared.run.sourceRoot,
        challengeId: prepared.run.challengeId,
        runId: prepared.run.runId
      })).catch((cleanupError: unknown) => ({
        cleaned: false,
        errors: [cleanupError instanceof Error ? cleanupError.message : String(cleanupError)]
      })) as unknown as Json;
      const failed = await writeGithubDeveloperReviewState(cwd, {
        ...claimed.state,
        status: "failed",
        reasonCode: error instanceof Error ? error.message : String(error),
        updatedAt: readFlag(commandArgs, "--now") ?? new Date().toISOString()
      }, reviewSecrets);
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
  | { ok: true; state: GitHubDeveloperReviewState; path: string; challenge: ReviewChallengeV2 }
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
      schemaVersion: "archcontext.github-developer-review-state/v2",
      status: "failed",
      challenge: input.challenge,
      challengeDigest: digest,
      reasonCode: head.reasonCode ?? "HEAD_VERIFICATION_FAILED",
      updatedAt: now
    }, [input.challenge.nonce]);
    return { ok: false, envelope: okEnvelope("github.review.claim", sanitizeGithubDeveloperReviewState(failed.state, failed.path) as unknown as Json) };
  }
  const lease = controlPlane.claimReviewChallengeLease({
    challenge: input.challenge,
    claimantId: readFlag(input.args, "--claimant-id") ?? input.connection.deviceKey.publicKeyId,
    now,
    currentLease: input.existing?.lease as any
  });
  const state = await writeGithubDeveloperReviewState(input.cwd, {
    schemaVersion: "archcontext.github-developer-review-state/v2",
    status: lease.claimed ? "claimed" : "failed",
    challenge: lease.challenge,
    challengeDigest: await digestReviewChallenge(lease.challenge),
    lease: lease.lease as unknown as Json,
    reasonCode: lease.reasonCode,
    updatedAt: now
  }, [input.challenge.nonce]);
  if (!lease.claimed) {
    return { ok: false, envelope: okEnvelope("github.review.claim", sanitizeGithubDeveloperReviewState(state.state, state.path) as unknown as Json) };
  }
  return { ok: true, state: state.state, path: state.path, challenge: lease.challenge };
}

async function submitGithubDeveloperReview(args: string[], cwd: string, deps: CliRuntimeDeps, state: GitHubDeveloperReviewState, challenge: ReviewChallengeV2, attestation: AttestationV2): Promise<{ state: GitHubDeveloperReviewState; path: string }> {
  const reviewSecrets = [challenge.nonce, attestation.signature.value];
  if (!state.attestationDigest) {
    return writeGithubDeveloperReviewState(cwd, {
      ...state,
      status: "failed",
      reasonCode: "ATTESTATION_UNAVAILABLE",
      updatedAt: readFlag(args, "--now") ?? new Date().toISOString()
    }, reviewSecrets);
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
    }, reviewSecrets);
  }
  const submission = await deps.githubReviewSubmissionPort.submitDeveloperReview({
    challenge,
    attestation,
    attestationDigest: state.attestationDigest
  });
  return writeGithubDeveloperReviewState(cwd, {
    ...state,
    status: "submitted",
    submission,
    updatedAt: readFlag(args, "--now") ?? new Date().toISOString()
  }, reviewSecrets);
}

async function resolveGithubReviewChallenge(
  args: string[],
  cwd: string,
  deps: CliRuntimeDeps,
  connection: ReturnType<typeof sanitizeGithubConnection>
): Promise<{ ok: true; challenge: ReviewChallengeV2 } | { ok: false; message: string }> {
  const challengeInput = await readReviewChallengeV2Arg(args, cwd, "github review");
  if (challengeInput.ok) return challengeInput;
  const hasChallengeFlag = Boolean(readFlag(args, "--challenge-json") || readFlag(args, "--challenge-path"));
  if (hasChallengeFlag) return challengeInput;
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
  if (!Number.isInteger(value) || value < 1) throw new CliUsageError("--pr must be a positive integer");
  return value;
}

async function digestReviewChallenge(challenge: ReviewChallengeV2): Promise<string> {
  const attestation = await import("@archcontext/cloud/attestation");
  return attestation.reviewChallengeV2Digest(challenge);
}

function defaultGithubConnectionPath(cwd: string): string {
  return join(dirname(defaultDaemonConnectionPath(cwd)), "github-connection.json");
}

function sanitizeGithubConnection(record: GitHubConnectionRecord, connectionPath: string) {
  return {
    schemaVersion: record.schemaVersion,
    connected: true,
    status: record.status,
    accountId: record.accountId,
    githubUserId: record.githubUserId,
    issuer: record.issuer,
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
    readEntrypoint: {
      command: "archctx",
      args: ["hook", "checkpoint"],
      timeoutMs: HOOK_CHECKPOINT_TIMEOUT_MS,
      failOpen: true,
      egress: "none",
      network: "forbidden"
    },
    readInput: { eventFlag: "--event", changedPathFlag: "--changed-path" },
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
    changedPathDigest: digestJson({
      paths: [...new Set(input.changedPaths)].sort()
    }),
    reasonCode: input.reasonCode,
    failOpen: input.failOpen,
    egress: "none",
    network: "forbidden"
  } satisfies import("@archcontext/contracts").ArchitectureDebtHookLogV1;
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

function auditConsentGrantedForDoctor(root: string): boolean {
  try {
    return readAuditConsent(root).granted;
  } catch {
    return false;
  }
}

async function doctorReport(cwd: string, args: string[] = []) {
  const product = productVersionManifest();
  const paths = runtimePathsReport(cwd);
  const daemon = await doctorDaemon(cwd);
  const git = doctorGit(cwd);
  const sqlite = doctorSqlite(cwd);
  const permissions = doctorPermissions(cwd);
  // Informational: read-only `--version` + `status -j`, never part of `ok`.
  const codeFacts = inspectRepositoryCodeFacts(("root" in git && git.root) || cwd);
  const auditRoot = auditManifestGateRoot(cwd);
  const hardening = diagnostics(localEgressStatus(process.env, {
    auditEnabled: auditGithubIssuesEnabled(cwd),
    auditUserConsent: auditConsentGrantedForDoctor(auditRoot),
    githubIssuesTokenEnv: AUDIT_APPROVE_GH_TOKEN_ENV,
    updateCheckRequested: args.includes("--check-updates") || process.env[UPDATE_CHECK_ENV] === "1"
  }));
  const daemonEgress = "health" in daemon ? daemon.health?.egress : undefined;
  const egress = daemon.running
    ? daemonEgress ?? { ok: false, source: "daemon", effectiveOutbound: "unknown", warnings: ["Running daemon did not provide an egress report"] }
    : { ...hardening.egress, source: "cli-environment" };
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
    codeFacts,
    git,
    permissions,
    egress,
    hardening: { ...hardening, egress },
    ok: hardening.supportedNode && permissions.workspace.readable && permissions.workspace.writable && egress.ok
      && (daemon as { writable?: boolean }).writable !== false
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
      checkUpdates: "https://registry.npmjs.org/",
      admission: localEgressAdmission("npm-update-check", env),
      requested: opts.checkUpdates
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

  const result = withLocalEgress("npm-update-check", () => spawnSync("npm", ["view", RELEASE_PACKAGE_NAME, "version", "--json"], {
    encoding: "utf8",
    timeout: NPM_VIEW_TIMEOUT_MS,
    shell: false
  }), env);
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
  const health = await client.health({ includeEgress: true }).catch(() => undefined);
  const healthIssue = runtimeRpcCompatibilityIssueFromHealth(cwd, client, health);
  if (healthIssue) return incompatibleDaemonStatus(healthIssue);
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
    productVersionCompatible: (health as any)?.product?.product?.version === productVersionManifest().product.version,
    connection: client.connectionInfo(),
    health: (health as any)?.ok === true ? {
      composition: (health as any).composition,
      product: (health as any).product,
      egress: (health as any).egress
    } : undefined,
    // A live daemon whose startup recovery left ChangeSet journals unresolved refuses writes (#172).
    ...((health as any)?.ok === true && (health as any).changeSetRecovery
      ? { writable: false, changeSetRecovery: (health as any).changeSetRecovery }
      : {})
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

async function createCliRuntime(cwd: string, deps: CliRuntimeDeps, preserveHealthFailure = false): Promise<CliRuntimeHandle> {
  if (deps.runtimeClient) return { client: deps.runtimeClient, close: async () => undefined };
  if (!deps.disableRpcDiscovery && !hasEmbeddedRuntimeDeps(deps)) {
    return { client: await createOrStartRuntimeRpcClient(cwd, preserveHealthFailure), close: async () => undefined };
  }
  const {
    runtimeClient: _runtimeClient,
    disableRpcDiscovery: _disableRpcDiscovery,
    devicePrivateKeyStore,
    githubConnectionReader: _githubConnectionReader,
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

async function createOrStartRuntimeRpcClient(cwd: string, preserveHealthFailure = false): Promise<RuntimeDaemonClient> {
  const fileIssue = runtimeRpcCompatibilityIssue(cwd) ?? cliEntryStalenessIssue(cwd);
  if (fileIssue?.pidAlive) throw new RuntimeVersionUnsupportedError(fileIssue);
  const client = createRuntimeRpcClientFromConnectionFile(cwd);
  if (client) {
    const { health, unresponsivePid, transportFailure } = await probeDaemonHealth(client);
    const healthIssue = runtimeRpcCompatibilityIssueFromHealth(cwd, client, health);
    if (healthIssue) throw new RuntimeVersionUnsupportedError(healthIssue);
    if ((health as any)?.ok === true) return client;
    if (unresponsivePid !== undefined) {
      if (preserveHealthFailure && transportFailure) throw transportFailure;
      throw new Error(unresponsiveDaemonMessage(unresponsivePid));
    }
    recoverStaleDaemonControlFiles(cwd, { removeUnhealthyConnection: true });
  } else {
    recoverStaleDaemonControlFiles(cwd);
  }
  const started = await startBackgroundDaemon([], cwd);
  if (!started.ok) throw new Error(mcpDaemonStartRecoveryMessage(started.error?.message ?? "archctxd did not start"));
  const startedClient = createRuntimeRpcClientFromConnectionFile(cwd);
  if (startedClient) {
    const health = await startedClient.health().catch(() => undefined);
    const healthIssue = runtimeRpcCompatibilityIssueFromHealth(cwd, startedClient, health);
    if (healthIssue) throw new RuntimeVersionUnsupportedError(healthIssue);
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
      const lockOwnerPid = liveDaemonLockOwnerPid(cwd);
      return okEnvelope("daemon.status", {
        running: false,
        protocol: "http-loopback",
        connectionPath: defaultDaemonConnectionPath(cwd),
        ...(lockOwnerPid === undefined ? {} : { lockOwnerPid, action: orphanedDaemonMessage(lockOwnerPid) }),
        ...recoveryData(recovery)
      } as any);
    }
    const { health, unresponsivePid } = await probeDaemonHealth(client);
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
        productVersionCompatible: true,
        ...client.connectionInfo(),
        token: "stored-in-connection-file"
      } as any);
    }
    if (unresponsivePid !== undefined) {
      return okEnvelope("daemon.status", {
        running: true,
        responding: false,
        pid: unresponsivePid,
        protocol: "http-loopback",
        connectionPath: client.connectionInfo().connectionPath,
        action: unresponsiveDaemonMessage(unresponsivePid)
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
  if (subcommand === "list") {
    const stateRoot = defaultArchContextStateRoot().path;
    return okEnvelope("daemon.list", { stateRoot, daemons: listDaemonControlStates(stateRoot) } as unknown as Json);
  }
  if (subcommand === "stop") {
    const target = daemonStopStateDir(args, cwd);
    if (!target.ok) return target.envelope;
    if (target.stateDir === undefined) {
      const client = createRuntimeRpcClientFromConnectionFile(cwd);
      if (!client) return errorEnvelope("daemon.stop", "AC_RUNTIME_UNAVAILABLE", "No archctxd connection file found");
      return client.shutdown();
    }
    const client = createRuntimeRpcClientFromWorkspaceStateDir(target.stateDir);
    if (!client) return errorEnvelope("daemon.stop", "AC_RUNTIME_UNAVAILABLE", `No archctxd connection file found in ${target.stateDir}`);
    return client.shutdown();
  }
  return errorEnvelope("daemon", "AC_SCHEMA_INVALID", "daemon requires start|status|stop|list");
}

/**
 * The workspace state directory `daemon stop` targets: `--state-dir` as `daemon list` prints it, or
 * the one `--workspace-id` names under the current state root. Neither reads the worktree, so a
 * daemon whose worktree was deleted can still be stopped (#322). `undefined` means the cwd's daemon.
 */
function daemonStopStateDir(args: string[], cwd: string): { ok: true; stateDir?: string } | { ok: false; envelope: JsonEnvelope } {
  const stateDir = readFlag(args, "--state-dir");
  const workspaceId = readFlag(args, "--workspace-id");
  if (stateDir !== undefined && workspaceId !== undefined) {
    return { ok: false, envelope: errorEnvelope("daemon.stop", "AC_SCHEMA_INVALID", "daemon stop accepts at most one of --state-dir or --workspace-id") };
  }
  if (stateDir !== undefined) return { ok: true, stateDir: resolve(cwd, stateDir) };
  if (workspaceId === undefined) return { ok: true };
  if (!/^ws\.[0-9a-f]{16}$/.test(workspaceId)) {
    return { ok: false, envelope: errorEnvelope("daemon.stop", "AC_SCHEMA_INVALID", "daemon stop --workspace-id must be a storage workspace id (ws.<16 hex>) as daemon list prints it") };
  }
  const stateRoot = defaultArchContextStateRoot().path;
  const matches = listWorkspaceStateDirs(stateRoot).filter((entry) => entry.storageWorkspaceId === workspaceId);
  if (matches.length !== 1) {
    return { ok: false, envelope: errorEnvelope("daemon.stop", "AC_RUNTIME_UNAVAILABLE", `${matches.length === 0 ? "No" : "More than one"} archctxd state directory for ${workspaceId} under ${stateRoot}`) };
  }
  return { ok: true, stateDir: matches[0]!.workspaceStateDir };
}

async function startBackgroundDaemon(args: string[], cwd: string) {
  const compatibilityIssue = runtimeRpcCompatibilityIssue(cwd) ?? cliEntryStalenessIssue(cwd);
  if (compatibilityIssue?.pidAlive) {
    return errorEnvelope("daemon.start", "AC_RUNTIME_VERSION_UNSUPPORTED", runtimeVersionUnsupportedMessage(compatibilityIssue));
  }
  const discovered = await discoverRunningDaemonInfo(cwd, { recoverStale: true });
  if (discovered.compatibilityIssue?.pidAlive) {
    return errorEnvelope("daemon.start", "AC_RUNTIME_VERSION_UNSUPPORTED", runtimeVersionUnsupportedMessage(discovered.compatibilityIssue));
  }
  if (discovered.unresponsivePid !== undefined) {
    return errorEnvelope("daemon.start", "AC_RUNTIME_UNAVAILABLE", unresponsiveDaemonMessage(discovered.unresponsivePid));
  }
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
    // A child that exits because another live process owns the store is the losing side of a
    // concurrent cold start, not a failure: keep polling for the winner until the start deadline.
    const ready = await waitForDaemonReady(
      cwd,
      daemonStartTimeoutMs(args),
      () => childError !== undefined || (childExit !== undefined && childExit.code !== DAEMON_OWNED_ELSEWHERE_EXIT_CODE)
    );
    if (!ready) {
      return errorEnvelope("daemon.start", "AC_RUNTIME_UNAVAILABLE", daemonStartFailureMessage(cwd, logPath, child.pid, childExit, childError));
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
  const persistedIssue = runtimeRpcCompatibilityIssue(cwd) ?? cliEntryStalenessIssue(cwd);
  const issue = persistedIssue ?? (await discoverRunningDaemonInfo(cwd)).compatibilityIssue;
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
    : issue.reason === "product-version-mismatch"
      ? {
          previousProductVersion: issue.received,
          expectedProductVersion: issue.expected,
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
      compatibilityIssue: undefined,
      recovery: options.recoverStale ? recoverStaleDaemonControlFiles(cwd) : emptyRecovery(cwd)
    };
  }
  const { health, unresponsivePid } = await probeDaemonHealth(client);
  const compatibilityIssue = runtimeRpcCompatibilityIssueFromHealth(cwd, client, health)
    ?? cliEntryStalenessIssue(cwd);
  if (compatibilityIssue) {
    return {
      info: undefined,
      compatibilityIssue,
      recovery: emptyRecovery(cwd)
    };
  }
  if ((health as any)?.ok === true) {
    return { info: client.connectionInfo(), compatibilityIssue: undefined, recovery: emptyRecovery(cwd) };
  }
  if (unresponsivePid !== undefined) {
    return { info: undefined, compatibilityIssue: undefined, unresponsivePid, recovery: emptyRecovery(cwd) };
  }
  return {
    info: undefined,
    compatibilityIssue: undefined,
    recovery: options.recoverStale ? recoverStaleDaemonControlFiles(cwd, { removeUnhealthyConnection: true }) : emptyRecovery(cwd)
  };
}

function runtimeRpcCompatibilityIssueFromHealth(
  cwd: string,
  client: { connectionInfo(): { pid?: number; connectionPath?: string; lockPath?: string } },
  health: unknown
): RuntimeRpcCompatibilityIssue | undefined {
  if (!(health && typeof health === "object")) return undefined;
  const body = health as {
    ok?: unknown;
    error?: unknown;
    expected?: unknown;
    received?: unknown;
    product?: { product?: { version?: unknown } };
  };
  const connection = client.connectionInfo();
  const pid = typeof connection.pid === "number" ? connection.pid : undefined;
  const location = {
    connectionPath: connection.connectionPath ?? defaultDaemonConnectionPath(cwd),
    lockPath: connection.lockPath ?? defaultDaemonLockPath(cwd),
    pid,
    pidAlive: pid !== undefined ? isPidAlive(pid) : false,
    upgradeCommand: "archctx daemon upgrade" as const
  };
  if (body.ok === true) {
    const expected = productVersionManifest().product.version;
    const received = typeof body.product?.product?.version === "string" ? body.product.product.version : "unknown";
    return received === expected ? undefined : {
      reason: "product-version-mismatch",
      expected,
      received,
      ...location
    };
  }
  if (body.ok !== false || body.error !== "runtime RPC version mismatch") return undefined;
  return {
    reason: "rpc-version-mismatch",
    expected: RUNTIME_RPC_VERSION,
    received: typeof body.expected === "string" ? body.expected : "unknown",
    ...location
  };
}

function incompatibleDaemonStatus(issue: RuntimeRpcCompatibilityIssue) {
  return {
    running: issue.pidAlive,
    protocol: "http-loopback",
    rpcVersionCompatible: issue.reason === "product-version-mismatch",
    productVersionCompatible: issue.reason !== "product-version-mismatch",
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
  if (issue.reason === "product-version-mismatch") {
    return `archctxd product version ${issue.received} does not exactly match this CLI (${issue.expected}); run ${issue.upgradeCommand} to replace the local daemon.`;
  }
  return `archctxd RPC version ${issue.received} is incompatible with this CLI (${issue.expected}); run ${issue.upgradeCommand} to replace the local daemon.`;
}

/**
 * A health timeout means the daemon accepted the connection but did not answer in time: it is
 * busy, not gone. Its connection file must stay. Without it the live process keeps the store and
 * the lock, no client can reach it, and every new daemon start loses to it (#318).
 */
async function probeDaemonHealth(client: RuntimeRpcClient): Promise<{ health: unknown; unresponsivePid?: number; transportFailure?: RuntimeRpcTransportError }> {
  try {
    return { health: await client.health() };
  } catch (error) {
    const pid = client.connectionInfo().pid;
    const busy = error instanceof RuntimeRpcTransportError && error.code === "RPC_TIMEOUT" && typeof pid === "number" && isPidAlive(pid);
    return { health: undefined, ...(busy ? { unresponsivePid: pid, transportFailure: error as RuntimeRpcTransportError } : {}) };
  }
}

function stopProcessCommand(pid: number): string {
  return process.platform === "win32" ? `taskkill /PID ${pid}` : `kill -TERM ${pid}`;
}

function unresponsiveDaemonMessage(pid: number): string {
  return `archctxd pid ${pid} is alive but did not answer its health check in time; it is likely busy, so its connection file was kept. Retry later, or stop it with \`${stopProcessCommand(pid)}\` and run the command again.`;
}

function orphanedDaemonMessage(pid: number): string {
  return `the daemon lock names live pid ${pid}, but no connection file points to it; stop it with \`${stopProcessCommand(pid)}\`, then run the command again.`;
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
  cwd: string,
  logPath: string,
  childPid: number | undefined,
  childExit: { code: number | null; signal: NodeJS.Signals | null } | undefined,
  childError: Error | undefined
): string {
  const childState = childError
    ? `childError=${childError.message}`
    : childExit
      ? `childExit=${childExit.code ?? "null"}/${childExit.signal ?? "none"}`
      : "childState=still-running";
  // A slow child can still be starting at the deadline, so the lock owner is named whether or not
  // the child exited; only the child's own lock is not a foreign owner.
  const lockOwnerPid = existsSync(defaultDaemonConnectionPath(cwd)) ? undefined : liveDaemonLockOwnerPid(cwd);
  const owner = lockOwnerPid === undefined || lockOwnerPid === childPid ? "" : `; ${orphanedDaemonMessage(lockOwnerPid)}`;
  return `archctxd did not become ready; ${childState}${owner}; log=${logPath}; logTail=${readFileTail(logPath)}`;
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
  // A long-lived process must not keep its working directory inside the worktree: Windows refuses
  // to delete any process's current directory, so the deleted worktree would stay on disk and the
  // daemon would never see it gone (#322). Everything below already holds `cwd` as an explicit
  // root, and readiness is published only after this point, so a started daemon never pins it.
  process.chdir(parse(cwd).root);
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
  const codeFactsLine = result.requestId === "doctor" ? `${doctorCodeFactsLine(result.data?.codeFacts)}\n` : "";
  return `OK ${result.requestId}\n${codeFactsLine}${JSON.stringify(result.data, null, 2)}`;
}

function doctorCodeFactsLine(codeFacts: any): string {
  if (!codeFacts) return "code facts: not reported";
  if (codeFacts.state === "unavailable") return `code facts: unavailable (${codeFacts.message})`;
  if (codeFacts.state === "index-missing") return "code facts: index missing; run `codegraph init`";
  const issues = codeFacts.issues.length === 0 ? "" : ` (${codeFacts.issues.map((issue: { code: string }) => issue.code).join(", ")})`;
  return `code facts: ${codeFacts.state}${issues}; CodeGraph ${codeFacts.codeGraphVersion}`;
}

/**
 * ADR-0043: `archctx resolve --path` exit codes are 0=matched, 1=no-match, 2=ambiguous.
 * `archctx resolve --paths-from` exits 2 when any path is ambiguous and 0 otherwise: a path no node
 * owns is a normal batch result, so 1 there always means the batch itself failed.
 */
export function resolveCommandExitCode(result: { ok?: boolean; data?: unknown }): number {
  if (!result || result.ok !== true) return 1;
  const data = result.data as { matched?: boolean; ambiguous?: boolean; results?: { ambiguous?: boolean }[] } | undefined;
  if (Array.isArray(data?.results)) return data.results.some((entry) => entry.ambiguous === true) ? 2 : 0;
  if (data?.matched === true) return 0;
  if (data?.ambiguous === true) return 2;
  return 1;
}

const CLI_HELP_EXAMPLES = ["archctx init --name MyApp", "archctx projection run --request-json '{...}'", "archctx projection snapshot --json", "archctx projection freshness --json", "archctx projection freshness --changed-path src/app.ts --json", "archctx plan --id changeset.<id> --op update_entity_fields --path .archcontext/model/nodes/<node>.yaml --expected-hash sha256:<64-hex> --body '<complete YAML>'", "archctx plan --id changeset.<id> --op delete_entity --path .archcontext/model/flows/<flow>.yaml --expected-hash sha256:<64-hex>", "archctx hash --path .archcontext/model/nodes/<node>.yaml", "archctx plan --id changeset.<id> --operations-file <operations.json>", "archctx plan --id changeset.<id> --op update_entity_fields --path .archcontext/model/nodes/<node>.yaml --expected-hash sha256:<64-hex> --body-file <entity.yaml>", "archctx apply --id changeset.<id> --approved --expected-worktree-digest <draft.base.worktreeDigest>", "archctx state recover --from-git", "archctx ledger migrate --from-yaml --dry-run", "archctx ledger promote --mode authoritative --preflight --rollback-plan", "archctx book recommendations --open --explain", "archctx recommendations accept --id recommendation.<id> --reason 'Accepted after local readback.'", "archctx recommendations metrics", "archctx recommendations list --status rejected", "archctx refactor scan --json", "archctx refactor verify --request-json '{...}' --json", "archctx practices validate --strict", "archctx practices list --json", "archctx practices waivers", "archctx practices waive --practice-id modularity.no-new-cycle --owner team-architecture --reason 'External migration window requires this edge until cutover.' --review-at 2026-07-10T00:00:00.000Z --expires-at 2026-07-24T00:00:00.000Z --evidence-digest sha256:<64-hex> --subject module.a->module.b", "archctx checkpoint --changed-path src/app.ts", "archctx practices checkpoint --task-session-id task_cli", "archctx investigate --runner-port codex", "archctx agents status --status queued,running", "archctx agents budget", "archctx hook enqueue --event post-edit --path src/app.ts", "archctx jobs list --status queued", "archctx audit consent", "archctx audit consent --revoke", "archctx audit run --reason 'quarterly architecture audit'", "archctx audit run --no-wait", "archctx audit list --status pending", "archctx audit show audit_run.<id>", "archctx audit approve audit_run.<id>", "archctx audit approve audit_run.<id> --confirm-public-repo public:<host>/<owner>/<repo>:<baseSha>:<runId>", "archctx audit approve audit_run.<id> --resume", "archctx hooks install --host codex", "archctx paths", "archctx update --check", "archctx doctor --check-updates", "archctx github connect", "archctx github status", "archctx daemon start", "archctx explore start --foreground", "archctx docs anchors --json", "archctx export native --worktree --json", "archctx export native --ref HEAD --profile repo-harness/v1 --json", "archctx export likec4", "archctx import structurizr --content '<json>'", "archctx resolve --path packages/core/projection-engine/src/index.ts", "archctx tunnel", "archctx refactor scan --import-node-limit 100000 --json", "archctx resolve --paths-from changed-paths.txt", "archctx flows check --json", "archctx recommendations defer --id recommendation.<id> --import-node-limit 100000 --reason 'Scanned with the same limit.'", "archctx deps --json", "archctx deps --into capability.<id> --json"];

const CLI_RESOLVE_HELP = {
  command: "archctx resolve (--path <repo-relative path> | --paths-from <file> | --paths-from -)",
  rule: "ADR-0043. source.exclude applies first. When every matching node lies on one parent chain, the deepest node owns the path; refactor scan uses the same rule. When matching nodes lie on different chains, an ancestor yields to its own descendant, then the longest literal source.include prefix wins, and an equal-length tie is ambiguous.",
  batch: "--paths-from reads one repository-relative POSIX path per line from a file (relative to the current directory) or from stdin (-). Blank lines are ignored and surrounding whitespace is trimmed. The model loads once. data.results has one entry per input path, in input order. The command reads no daemon state and no CodeGraph index.",
  result: "Each result carries path, matched, ambiguous and owningCapabilityId. A match adds stableId, kind, name, source and extensions of the most specific node. An ambiguous result adds candidates. owningCapabilityId is the nearest kind: capability node on the owner's parent chain (the owner itself when it is a capability), or null. For an ambiguous result it is set only when all candidates share one owning capability.",
  exitCodes: "--path: 0 matched, 1 no match or error, 2 ambiguous. --paths-from: 0 when no path is ambiguous (unowned paths included), 2 when any path is ambiguous, 1 on error."
};

function resolveResultData(path: string, outcome: ResolveArchitectureOwnerResult): Record<string, Json> {
  if (outcome.status === "matched") {
    const node = outcome.node;
    return {
      path,
      matched: true,
      ambiguous: false,
      stableId: node.id,
      kind: node.kind,
      name: node.name,
      owningCapabilityId: outcome.owningCapabilityId,
      ...(node.source ? { source: node.source } : {}),
      ...(node.extensions ? { extensions: node.extensions } : {})
    };
  }
  if (outcome.status === "ambiguous") {
    return { path, matched: false, ambiguous: true, candidates: outcome.candidates.map((node) => node.id), owningCapabilityId: outcome.owningCapabilityId };
  }
  return { path, matched: false, ambiguous: false, owningCapabilityId: null };
}

/** `resolve --paths-from <file>` or `--paths-from -` (stdin): one path per line, blank lines ignored. */
async function readResolvePathsFrom(args: string[], cwd: string, deps: CliRuntimeDeps): Promise<{ paths: string[] } | { problem: string }> {
  const source = readFlag(args, "--paths-from");
  if (source === undefined || source.startsWith("--")) return { problem: "resolve --paths-from requires a file path or - for stdin" };
  let content: string;
  try {
    content = source === "-"
      ? await (deps.readStdin ? deps.readStdin() : readFileSync(0, "utf8"))
      : readFileSync(resolve(cwd, source), "utf8");
  } catch (error) {
    return { problem: `resolve --paths-from ${source} is not readable: ${error instanceof Error ? error.message : String(error)}` };
  }
  const paths: string[] = [];
  for (const [index, line] of content.split("\n").entries()) {
    const path = line.trim();
    if (path === "") continue;
    if (!isRepoRelativePosixPath(path)) return { problem: `resolve --paths-from line ${index + 1} must be a repository-relative POSIX path: ${path}` };
    paths.push(path);
  }
  return { paths };
}


const CLI_PLAN_ENTITY_FLAGS = ["--op", "--path", "--expected-hash", "--body", "--body-file"] as const;

const CLI_DEPS_HELP = {
  command: "archctx deps [--from <node-id>] [--into <node-id>] [--import-node-limit <n>] [--edge-limit <n>] [--json]",
  description: "Read-only capability x capability import matrix. The command reads the model files, the HEAD tree and the CodeGraph index. It writes nothing and needs no daemon.",
  rule: "Each file gets its owners from the parent-chain rule refactor scan uses. Each owner rolls up to the nearest kind: capability node on its parent chain. An edge counts in data.matrix only when both files roll up to exactly one capability. Other edges count in data.imports.unattributed by cause.",
  filters: "--from <node-id> keeps edges whose importing file the node or a descendant owns. --into <node-id> keeps edges whose imported file the node or a descendant owns. An unknown node id is AC_SCHEMA_INVALID.",
  imports: "data.imports reports coverage, reasonCodes, truncated, importNodeCount, importNodeLimit and importNodeLimitExceeded from the CodeGraph import read. A missing or stale index gives coverage unknown and an empty matrix. --import-node-limit raises the read cap (default 50000).",
  calls: "Call counts are not available in v1. data.calls.coverage is unknown with reason call-edges-not-exposed, and every cell has calls: null.",
  edges: "data.edges lists the attributed file-level edges behind the matrix, sorted by path, up to --edge-limit (default 200). data.edges.count is the full total."
};

/** `archctx deps`: in-process and read-only, like `resolve`, so it starts no daemon and writes no state. */
function runDepsCommand(args: string[], cwd: string) {
  const importNodeLimit = readOptionalPositiveIntegerFlag(args, "--import-node-limit", "deps");
  if (!importNodeLimit.ok) return importNodeLimit.envelope;
  const edgeLimit = readOptionalNonNegativeIntegerFlag(args, "--edge-limit", "deps");
  if (!edgeLimit.ok) return edgeLimit.envelope;
  const from = readFlag(args, "--from");
  const into = readFlag(args, "--into");
  for (const [flag, value] of [["--from", from], ["--into", into]] as const) {
    if (args.includes(flag) && (value === undefined || value.startsWith("--"))) {
      return errorEnvelope("deps", "AC_SCHEMA_INVALID", `deps ${flag} requires a node id`);
    }
  }
  try {
    return okEnvelope("deps", readCapabilityDependencies(findRepositoryRoot(cwd), {
      ...(from === undefined ? {} : { from }),
      ...(into === undefined ? {} : { into }),
      ...(importNodeLimit.value === undefined ? {} : { importNodeLimit: importNodeLimit.value }),
      ...(edgeLimit.value === undefined ? {} : { edgeLimit: edgeLimit.value })
    }) as unknown as Json);
  } catch (error) {
    if (error instanceof CapabilityDependenciesError) return errorEnvelope("deps", error.code, error.message, error.reasonCode);
    throw error;
  }
}

const CLI_PLAN_HELP = {
  command: "archctx plan --id <changeset.id> (--op <create_entity|update_entity_fields|delete_entity> --path <file> [--expected-hash sha256:<64-hex>] [--body <yaml> | --body - | --body-file <path>] | --operations-file <operations.json | ->)",
  operations: "--operations-file takes a repository-relative path to a JSON array of operations in the archcontext_plan_update MCP shape, or - to read that array from stdin, and plans them as one ChangeSet; it cannot be combined with --op, --path, --expected-hash, --body or --body-file.",
  body: "--body is the complete new YAML document, not a field patch. Give exactly one of --body <yaml>, --body - (stdin) or --body-file <path>. --body-file and --operations-file read only repository-relative files inside the repository (no absolute or .. paths, no symlinks); content from outside the repository must come through stdin (--body - or --operations-file -). delete_entity accepts no body.",
  expectedHash: "digestJson({ body }) of the file's current UTF-8 contents, not sha256sum of the file. Read it with `archctx hash --path <file>`; use `missing` (the create default) for a new file.",
  drafts: "A draft lives in daemon memory. Planning the same --id again replaces it, and a daemon restart between plan and apply drops it: apply then fails with `Unknown ChangeSet`; plan again.",
  ownershipDelta: "When the plan writes a node file, data.preview.ownershipDelta compares file ownership before and after the planned model over the files the HEAD tree carries, with the parent-chain rule refactor scan uses. becameOwned, becameContested, ownerChanged and becameUnowned each give count, up to 50 files with before and after owners, and omittedCount. status unavailable gives the reason, for example a planned body that does not parse. Read-only.",
  next: "archctx apply --id <changeset.id> --approved --expected-worktree-digest <draft.base.worktreeDigest>"
};

const CLI_HASH_HELP = {
  command: "archctx hash --path <repo-relative file>",
  formula: "digestJson({ body: <file contents read as UTF-8> }); this is the expected hash a plan operation must carry. It is not sha256sum of the file.",
  scope: "Read-only. The path must be one a ChangeSet may write (for example .archcontext/model/, .archcontext/manifest.yaml or docs/adr/ADR-NNNN-*.md) and the file must exist; symlinks are refused."
};

/**
 * The ChangeSet write boundary admits the manifest and ADR files only under their own operation
 * scopes (`update_manifest_fields`, `update_adr_references`), and those operations need an expectedHash.
 * Try the default scope first so its error is the one reported for a path no scope admits.
 */
function assertHashPathAllowed(cwd: string, path: string): void {
  const agentContextPaths: ReadonlySet<string> = new Set();
  try {
    assertAllowedArchContextPath(cwd, path);
  } catch (error) {
    for (const operation of ["manifest", "adr-reference"] as const) {
      try {
        assertAllowedArchContextPath(cwd, path, { operation, agentContextPaths });
        return;
      } catch { /* try the next scope */ }
    }
    throw error;
  }
}

/**
 * Reads a plan input file. Only repository-relative POSIX paths inside the repository are read: no
 * absolute or `..` paths and no symlink segments, so a flag cannot pull outside content into a
 * ChangeSet body. Content from outside the repository comes in through stdin (`--body -`).
 */
function readRepositoryInputFile(cwd: string, flag: string, file: string): { content: string } | { problem: string } {
  if (!isRepoRelativePosixPath(file)) return { problem: `plan ${flag} must be a repository-relative POSIX path inside the repository; use --body - to read stdin` };
  try {
    const absolute = assertPathHasNoSymlinkSegments(cwd, file);
    if (!statSync(absolute).isFile()) return { problem: `plan ${flag} ${file} is not a regular file` };
    return { content: readFileSync(absolute, "utf8") };
  } catch (error) {
    return { problem: `plan ${flag} ${file} is not readable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * `archctx hash`: prints the expected hash of one existing file exactly as the ChangeSet precondition
 * computes it (`digestJson({ body })`), under the same path boundary a write would face.
 */
function runHashCommand(args: string[], cwd: string) {
  const path = readFlag(args, "--path");
  if (!path) return errorEnvelope("hash", "AC_SCHEMA_INVALID", "hash requires --path");
  if (!isRepoRelativePosixPath(path)) return errorEnvelope("hash", "AC_SCHEMA_INVALID", "hash --path must be a repository-relative POSIX path");
  let absolute: string;
  try {
    assertHashPathAllowed(cwd, path);
    absolute = assertPathHasNoSymlinkSegments(cwd, path);
  } catch (error) {
    return errorEnvelope("hash", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    return errorEnvelope("hash", "AC_SCHEMA_INVALID", `hash --path is not an existing file: ${path}`);
  }
  return okEnvelope("hash", { path, hash: digestJson({ body: readFileSync(absolute, "utf8") }) } as unknown as Json);
}

/**
 * `archctx plan` operations: either `--operations-file` (a JSON array validated with the MCP
 * `archcontext_plan_update` operations schema, so both routes accept the same shapes) or one entity
 * operation from flags. Returns the schema problem as a string instead of guessing.
 */
async function readCliPlanOperations(args: string[], cwd: string, deps: CliRuntimeDeps): Promise<ChangeOperation[] | string> {
  if (args.includes("--operations-file")) {
    const conflicts = CLI_PLAN_ENTITY_FLAGS.filter((flag) => args.includes(flag));
    if (conflicts.length > 0) return `plan --operations-file cannot be combined with ${conflicts.join(", ")}`;
    const file = readFlag(args, "--operations-file");
    if (!file) return "plan --operations-file requires a path";
    const read = file === "-"
      ? { content: await (deps.readStdin ? deps.readStdin() : readFileSync(0, "utf8")) }
      : readRepositoryInputFile(cwd, "--operations-file", file);
    if ("problem" in read) return read.problem;
    let parsed: Json;
    try {
      parsed = JSON.parse(read.content) as Json;
    } catch (error) {
      return `plan --operations-file ${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
    }
    const validation = validateJsonSchema(MCP_PLAN_OPERATIONS_SCHEMA, parsed);
    if (!validation.valid) return `plan --operations-file ${file} is not a valid operations array: ${validation.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`;
    return parsed as unknown as ChangeOperation[];
  }
  const operation = await readCliEntityOperation(args, cwd, deps);
  return typeof operation === "string" ? operation : [operation];
}

/**
 * One entity file per flag-built ChangeSet, the same shape as the MCP `archcontext_plan_update`
 * entity operation. Update and delete name the exact current file hash; create defaults to `missing`.
 */
async function readCliEntityOperation(args: string[], cwd: string, deps: CliRuntimeDeps): Promise<ChangeOperation | string> {
  const CLI_ENTITY_OPERATIONS = ["create_entity", "update_entity_fields", "delete_entity"] as const;
  const requested = readFlag(args, "--op") ?? "create_entity";
  const op = CLI_ENTITY_OPERATIONS.find((candidate) => candidate === requested);
  if (!op) return `plan --op must be one of ${CLI_ENTITY_OPERATIONS.join("|")}`;
  const path = readFlag(args, "--path");
  if (!path) return "plan requires --path";
  const expectedHash = readFlag(args, "--expected-hash");
  const body = await readCliPlanBody(args, cwd, deps);
  if (typeof body === "object") return body.problem;
  if (op === "create_entity") return { op, path, expectedHash: expectedHash ?? "missing", body: body ?? "" };
  if (!expectedHash || !/^sha256:[a-f0-9]{64}$/.test(expectedHash)) return `plan --op ${op} requires --expected-hash sha256:<64-hex> of the current file`;
  if (op === "delete_entity") {
    if (body !== undefined) return "plan --op delete_entity does not accept --body or --body-file";
    return { op, path, expectedHash };
  }
  if (body === undefined) return "plan --op update_entity_fields requires --body, --body - or --body-file with the complete YAML document";
  return { op, path, expectedHash, body };
}

/** The single body source: `--body <yaml>`, `--body -` (stdin) or `--body-file <path>`; at most one is allowed. */
async function readCliPlanBody(args: string[], cwd: string, deps: CliRuntimeDeps): Promise<string | undefined | { problem: string }> {
  const hasBody = args.includes("--body");
  const hasBodyFile = args.includes("--body-file");
  if (hasBody && hasBodyFile) return { problem: "plan accepts exactly one body source: --body, --body - or --body-file" };
  if (hasBodyFile) {
    const file = readFlag(args, "--body-file");
    if (!file) return { problem: "plan --body-file requires a path" };
    const read = readRepositoryInputFile(cwd, "--body-file", file);
    return "problem" in read ? read : read.content;
  }
  if (!hasBody) return undefined;
  const inline = readFlag(args, "--body");
  if (inline === undefined) return { problem: "plan --body requires a value (use - to read stdin)" };
  if (inline !== "-") return inline;
  return deps.readStdin ? deps.readStdin() : readFileSync(0, "utf8");
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function requireFlag(args: string[], flag: string): string {
  const value = readFlag(args, flag);
  if (!value) throw new CliUsageError(`${flag} is required`);
  return value;
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

function explorerProjectionQueryV2FromCli(args: string[]): ExplorerProjectionQueryV2 {
  const expectedHeadSha = readFlag(args, "--expected-head-sha");
  const expectedWorktreeDigest = readFlag(args, "--expected-worktree-digest");
  const expectedGraphDigest = readFlag(args, "--expected-graph-digest");
  const expectedObservedFactsDigest = readFlag(args, "--expected-observed-facts-digest");
  const expectedRequired = [expectedHeadSha, expectedWorktreeDigest, expectedGraphDigest];
  if (expectedRequired.some(Boolean) && !expectedRequired.every(Boolean)) {
    throw new CliUsageError("--expected-head-sha, --expected-worktree-digest, and --expected-graph-digest must be provided together");
  }
  const viewId = readFlag(args, "--view") ?? "system-map";
  if (!(EXPLORER_VIEW_IDS as readonly string[]).includes(viewId)) throw new CliUsageError(`unsupported Explorer view: ${viewId}`);
  return {
    schemaVersion: "archcontext.explorer-projection-query/v2",
    viewId: viewId as ExplorerProjectionQueryV2["viewId"],
    semanticLevel: (readFlag(args, "--level") ?? "context") as NonNullable<ExplorerProjectionQueryV2["semanticLevel"]>,
    ...(readFlag(args, "--task-session-id") ? { taskSessionId: readFlag(args, "--task-session-id")! } : {}),
    ...(expectedRequired.every(Boolean) ? {
      expectedCursor: {
        headSha: expectedHeadSha!,
        worktreeDigest: expectedWorktreeDigest!,
        graphDigest: expectedGraphDigest!,
        ...(expectedObservedFactsDigest ? { observedFactsDigest: expectedObservedFactsDigest } : {})
      }
    } : {}),
    ...(readFlag(args, "--focus") ? { focus: { subjectId: readFlag(args, "--focus")! } } : {}),
    expandedOccurrenceIds: readRepeatedFlag(args, "--expand"),
    depth: Number(readFlag(args, "--depth") ?? 1) as 0 | 1 | 2,
    budget: {
      maxNodes: Number(readFlag(args, "--max-nodes") ?? 80),
      maxRelations: Number(readFlag(args, "--max-relations") ?? 160)
    }
  };
}

/**
 * The process entry runs every command, including `daemon start` and the daemon it spawns, only on
 * a Node.js inside ARCHCONTEXT_NODE_RANGE (#322). Bun reports its own Node compatibility level in
 * `process.versions.node`, which says nothing about the Node.js the range governs, so a Bun process
 * (the development runtime) is not checked.
 */
function nodeEngineErrorEnvelope(command: string, versions: { node: string; bun?: string }): JsonEnvelope | undefined {
  if (versions.bun !== undefined || nodeVersionSatisfiesRange(versions.node)) return undefined;
  return errorEnvelope(
    command,
    "AC_NODE_VERSION_UNSUPPORTED",
    `archctx requires Node.js ${ARCHCONTEXT_NODE_RANGE}; this process runs Node.js ${versions.node}`,
    undefined,
    { nodeVersion: versions.node, supportedRange: ARCHCONTEXT_NODE_RANGE }
  );
}

/**
 * A process-path failure as an envelope. A CLI argument error is the caller's to fix, so it is not
 * reported as a retryable runtime outage; every other throw still reads as one.
 */
function cliFailureEnvelope(error: unknown): JsonEnvelope {
  if (error instanceof CliUsageError) return errorEnvelope("cli", "AC_SCHEMA_INVALID", error.message);
  return errorEnvelope("cli", "AC_RUNTIME_UNAVAILABLE", error instanceof Error ? error.message : String(error));
}

/*
 * Process entry. Keep this block the last statement of the module (#297). Its top-level
 * `await runCli(...)` pauses module evaluation, so a top-level `const` below it is still
 * uninitialized while the command runs: TDZ under `bun main.ts`, and `undefined` in the bundled
 * `bin/archctx.mjs`, where `bun build` lowers `const` to `var`.
 */
if (import.meta.main) {
  const nodeEngineError = nodeEngineErrorEnvelope(command ?? "help", process.versions);
  if (nodeEngineError) {
    process.stdout.write(`${renderResult(nodeEngineError, command === "export" && args[0] === "native" ? "json" : readFlag(args, "--format") ?? "json")}\n`);
    process.exitCode = 1;
  } else if (command === "capabilities") {
    const result = await runCli(command, args, process.cwd());
    if ("ok" in result) {
      process.stdout.write(`${renderResult(result, "json")}\n`);
      if (result.ok === false) process.exitCode = 1;
    } else {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  } else if (command === "mcp" && args.length === 0) {
    await runStdioMcpLoop(
      stdinLines(),
      (line) => process.stdout.write(`${line}\n`),
      (line) => process.stderr.write(`${line}\n`),
      { runtimeResolver: (root, options) => createOrStartRuntimeRpcClient(root, options?.preserveHealthFailure) }
    );
  } else if (command === "daemon" && args[0] === "start" && args.includes("--foreground") && preflightCliArguments(command, args) === undefined) {
    await runForegroundDaemon(process.cwd(), args).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = isDaemonOwnedElsewhereError(message) ? DAEMON_OWNED_ELSEWHERE_EXIT_CODE : 1;
    });
  } else {
    const result = await runCli(command, args, process.cwd()).catch(cliFailureEnvelope);
    process.stdout.write(`${renderResult(result, command === "export" && args[0] === "native" ? "json" : readFlag(args, "--format") ?? "json")}\n`);
    if (result.ok === false) process.exitCode = 1;
    if (command === "resolve") process.exitCode = resolveCommandExitCode(result);
  }
}
