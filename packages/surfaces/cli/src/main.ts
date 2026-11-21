#!/usr/bin/env bun
import { LocalEgressPolicyError, localEgressAdmission, withLocalEgress } from "@archcontext/local-runtime/egress-admission";
import { runArchitectureDebtCommand, selectedProducerFailureEnvelope } from "@archcontext/local-runtime/architecture-debt";
import { runArchitectureDebtDeltaCommand } from "./architecture-debt-delta";
import { runNativeContextCommand } from "./native-context";
import { runRefImpactCommand } from "./ref-impact";
import { runArchitectureHistoryCommand } from "./architecture-history";
import { runConstraintCheckCommand, runRuntimeVerifyCommand } from "@archcontext/local-runtime/runtime-daemon";
import { localEgressStatus } from "@archcontext/local-runtime/egress";
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, parse, posix, resolve } from "node:path";
import { FailureError, NativeContextError, toEnvelope, ARCHCONTEXT_NODE_RANGE, ARCHCONTEXT_PRODUCT_VERSION, ARCHITECTURE_MAJOR_CHANGE_REASON_CODES, CALLER_PROVIDED_ATTESTATION_FIELDS, EXPLORER_VIEW_IDS, REFACTOR_REQUEST_SCHEMA_VERSION, archctxCapabilities, digestJson, errorEnvelope, failureEnvelope, knownFailure, normalizeFailureResult, unclassifiedFailure, isRepoRelativePosixPath, nodeVersionSatisfiesRange, okEnvelope, productVersionManifest, refactorRequestInvariantIssues, refactorVerificationRequestInvariantIssues, validateJsonSchema } from "@archcontext/contracts";
import type { AcceptedArchitectureChangeReferenceV1, ArchctxCapabilitiesV1, ArchitectureMajorChangeReasonCode, ExplorerProjectionQueryV2, FailureEnvelope, Json, JsonEnvelope, RefactorRequestV1, RefactorVerificationRequestV1 } from "@archcontext/contracts";
import { assertPathHasNoSymlinkSegments, planManifestFieldsOperation, PLAN_OPERATIONS_SCHEMA, type ChangeOperation } from "@archcontext/core/changeset-engine";
import { assertAllowedArchContextPath } from "@archcontext/core/policy-engine";
import { computeWorktreeDigest, manifestDecisionDiagnostics, repositoryFingerprint, resolveArchitectureOwnerForPath, resolveArchitectureOwnersForPaths, type ResolveArchitectureOwnerResult } from "@archcontext/core/architecture-domain";
import { diagnostics, installMarker, uninstallMarker } from "./local-hardening";
import { defaultArchContextStateRoot, defaultLocalStorePath, localStoreWriterOwnershipPath, runtimeStatePaths } from "@archcontext/local-runtime/local-store-sqlite";
import { GitVisibleFilesUnavailableError, findRepositoryRoot, readHeadSha, listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { runDocsAnchorsCommand, runProjectionCheckInvocation, runProjectionFreshnessCommand, runProjectionSliceCommand, runProjectionSnapshotCommand, createStartedDaemon, runCodeGraphIndexSeed, type RuntimeDaemonClient, type RuntimeDocsProjectionInput, type RuntimeProjectionInvocation, type RuntimeAgentContextProjectionInput, type RuntimeRecommendationInput, type RuntimeDeps, runFlowSelectorCheckCommand, runStateMachineCheckCommand, CapabilityDependenciesError, readCapabilityDependencies, createCommandProjectionPublisher, createGhProjectionPublisher, createNoneProjectionPublisher, runProjectionPublishCommand, runProjectionPublishFollow, runProjectionPublishStatusCommand, runProjectionVerifyPrCommand, type ProjectionPublisherPort } from "@archcontext/local-runtime/runtime-daemon";
import { inspectRepositoryCodeFacts } from "@archcontext/local-runtime/codegraph-adapter";
import { REPO_HARNESS_PROJECTION_PROFILE, exportMermaidModel, loadNativeModelFromArchContext, type ArchitectureProjectionProfile } from "@archcontext/core/projection-engine";
import nodeSchema from "../../../../schemas/repo/architecture-node.schema.json";

const [, , command, ...args] = process.argv;
const RELEASE_PACKAGE_NAME = "archctx";
const UPDATE_CHECK_ENV = "ARCHCONTEXT_CHECK_UPDATES";
const LATEST_VERSION_ENV = "ARCHCONTEXT_LATEST_VERSION";
const NPM_VIEW_TIMEOUT_MS = 5_000;
const HOOK_ADAPTER_SCHEMA_VERSION = "archcontext.hook-adapter/v1";
const HOOK_LOG_SCHEMA_VERSION = "archcontext.hook-log/v1";
const HOOK_ADAPTER_NAME = "repo-harness-hook";
const HOOK_CHECKPOINT_TIMEOUT_MS = 5_000;

class RefactorFlagError extends Error {}

/** A CLI argument error. The process entry reports it as AC_SCHEMA_INVALID, not as a runtime outage. */
class CliUsageError extends Error {}

const GLOBAL_VALUE_FLAGS = ["--format"] as const;
const GLOBAL_BOOLEAN_FLAGS = ["--json"] as const;

/** `projection publish|publish-status|verify-pr` flags (#379); the writer CLI handlers scan against these. */
const PROJECTION_PUBLISH_VALUE_FLAGS = ["--base", "--base-sha", "--branch", "--interval", "--publisher", "--publisher-command", "--remote"] as const;
const PROJECTION_PUBLISH_BOOLEAN_FLAGS = ["--accept-observed-major-change", "--follow"] as const;
const PROJECTION_PUBLISH_STATUS_VALUE_FLAGS = ["--base", "--remote"] as const;
const PROJECTION_VERIFY_PR_VALUE_FLAGS = ["--base"] as const;
const PROJECTION_PUBLISH_DEFAULT_INTERVAL_SECONDS = 300;
const PROJECTION_PUBLISH_MIN_INTERVAL_SECONDS = 30;

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
  "debt": { value: ["--changed-path", "--base"], boolean: ["--complete"] },
  "agent-context": { value: ["--expected-worktree-digest", "--id", "--task-session-id"], boolean: ["--approved"] },
  "apply": { value: ["--expected-worktree-digest", "--id"], boolean: ["--approved"] },
  "checkpoint": { value: ["--changed-path"], boolean: [] },
  "complete": { value: ["--head-sha", "--posture", "--task", "--task-session-id"], boolean: [] },
  "constraints": { value: [], boolean: [] },
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
  "flows": { value: [], boolean: ["--no-sync"] },
  "hash": { value: ["--path"], boolean: [] },
  "hook": {
    value: [],
    boolean: [],
    subcommands: {
      checkpoint: { value: ["--changed-path", "--event"], boolean: [] }
    }
  },
  "hooks": { value: ["--host"], boolean: ["--generated-projection"] },
  "init": { value: ["--name"], boolean: [] },
  "install": { value: ["--host"], boolean: [] },
  "landscape": { value: [], boolean: [] },
  "manifest": { value: ["--decisions", "--id", "--layers"], boolean: [] },
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
  "projection": {
    value: ["--request-json"],
    boolean: [],
    subcommands: {
      run: { value: ["--request-json"], boolean: [] },
      snapshot: { value: [], boolean: [] },
      freshness: { value: [], boolean: [] },
      slice: { value: ["--base", "--changed-path"], boolean: [] },
      publish: { value: PROJECTION_PUBLISH_VALUE_FLAGS, boolean: PROJECTION_PUBLISH_BOOLEAN_FLAGS },
      "publish-status": { value: PROJECTION_PUBLISH_STATUS_VALUE_FLAGS, boolean: [] },
      "verify-pr": { value: PROJECTION_VERIFY_PR_VALUE_FLAGS, boolean: [] }
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
      accept: { value: ["--actor", "--actor-kind", "--agent-job-id", "--evidence-digest", "--expected-worktree-digest", "--id", "--import-node-limit", "--now", "--reason", "--recommendation-id", "--snapshot-digest", "--source"], boolean: [] },
      reject: { value: ["--actor", "--actor-kind", "--agent-job-id", "--evidence-digest", "--expected-worktree-digest", "--id", "--import-node-limit", "--now", "--reason", "--recommendation-id", "--snapshot-digest", "--source"], boolean: [] },
      defer: { value: ["--actor", "--actor-kind", "--agent-job-id", "--evidence-digest", "--expected-worktree-digest", "--id", "--import-node-limit", "--now", "--reason", "--recommendation-id", "--snapshot-digest", "--source"], boolean: [] },
      waive: { value: ["--actor", "--actor-kind", "--agent-job-id", "--evidence-digest", "--expected-worktree-digest", "--id", "--import-node-limit", "--now", "--reason", "--recommendation-id", "--source"], boolean: [] },
      resolve: { value: ["--actor", "--actor-kind", "--agent-job-id", "--evidence-digest", "--expected-worktree-digest", "--id", "--import-node-limit", "--now", "--reason", "--recommendation-id", "--source"], boolean: [] }
    }
  },
  "refactor": {
    value: ["--assessment-digest", "--expected-worktree-digest", "--import-node-limit", "--request-json"],
    boolean: ["--selection"],
    subcommands: { scan: { value: ["--import-node-limit", "--node", "--path", "--request-json"], boolean: [] } }
  },
  "repo": { value: ["--name", "--repository-id", "--root"], boolean: [] },
  "resolve": { value: ["--path", "--paths-from"], boolean: [] },
  "impact": { value: ["--base", "--head", "--depth", "--paths-from"], boolean: [] },
  "history": { value: ["--ref", "--format", "--offset", "--limit"], boolean: [] },
  "review": { value: ["--head-sha", "--posture", "--task", "--task-session-id"], boolean: [] },
  "index": { value: [], boolean: [], subcommands: { seed: { value: ["--timeout-ms"], boolean: [] } } },
  "state-machines": { value: [], boolean: [] },
  "status": { value: [], boolean: [] },
  "sync": { value: ["--changed"], boolean: [] },
  "uninstall": { value: ["--content", "--host"], boolean: [] },
  "update": { value: [], boolean: ["--check"] },
  "validate": { value: [], boolean: [] },
  // `runCli` runs its own stricter check after this one: at most one `--json`, nothing else.
  "capabilities": { value: [], boolean: [] },
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
  const valueFlags = [...flags.value, ...GLOBAL_VALUE_FLAGS];
  const booleanFlags = [...flags.boolean, ...GLOBAL_BOOLEAN_FLAGS];
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
  usage: "archctx projection freshness [--json]",
  description: "Render-equivalent freshness of the committed architecture projection: whether any target would render an output other than its committed manifest row, or the manifest itself would change. It runs the projection build that projection check runs, over the committed manifest's profile, so on the same tree it reports check's and complete's answer.",
  options: {
    "--json": "Accepted for symmetry; output is always JSON.",
    "--help, -h": "Show help without reading the repository."
  },
  writes: "no repository file; no daemon, no local store. It may sync the CodeGraph index, as flows check does. Outside a Git worktree it fails with AC_REPO_NOT_FOUND (git-worktree-required).",
  capability: "projection-freshness-v2"
};

/** `index seed --help` (#641). */
const CLI_INDEX_SEED_HELP = {
  usage: "archctx index seed [--timeout-ms <ms>] [--json]",
  description: "Explicitly seeds or refreshes the workspace CodeGraph index (.codegraph) decoupled from archctx sync. In the primary worktree, initializes or syncs .codegraph; in a linked worktree, reuses an existing .codegraph non-destructively (already-present) or hardlink-copies the primary worktree's .codegraph (worktree-seed).",
  options: {
    "--timeout-ms <ms>": "Maximum time in milliseconds to wait if the primary worktree .codegraph build is active.",
    "--json": "Accepted for symmetry; output is always JSON.",
    "--help, -h": "Show help without touching .codegraph."
  },
  writes: ".codegraph/ only; touches no YAML model, no docs, and no SQLite lock.",
  capability: "index-seed-v1"
};

/** `projection publish --help` (#379); above the entry block for the same TDZ reason as the audit constants. */
const CLI_PROJECTION_PUBLISH_HELP = {
  usage: "archctx projection publish [--base <branch>] [--base-sha <sha>] [--remote <name>] [--branch <archctx/...>] [--publisher gh|command|none] [--publisher-command <executable>] [--accept-observed-major-change] [--follow [--interval <seconds>]] [--json]",
  description: "Projection writer mode. Fetches the remote base tip, resets a writer-owned worktree to it, applies the projection in-process in that worktree, and pushes the result as exactly one commit on top of the base tip to a rolling archctx/* branch, then opens or updates its pull request. Only paths the apply wrote that are projection-owned outputs may change; anything else fails before a commit. One run per remote and base at a time (busy otherwise); the same base SHA is a no-op once published or up to date; a base that moves during the run is re-evaluated and the stale commit is never pushed.",
  options: {
    "--base <branch>": "The branch the projection is computed for (default: main).",
    "--base-sha <sha>": "Publish only for this base commit (40 lowercase hex characters), ending with projection-writer-base-moved when the remote base points elsewhere.",
    "--remote <name>": "The remote to fetch the base from and push the rolling branch to (default: origin).",
    "--branch <archctx/...>": "The rolling branch (default: archctx/projection). It must start with archctx/ and differ from --base; the writer never pushes to any other ref.",
    "--publisher gh|command|none": "gh (default): the operator's own gh lists, then edits or creates the pull request. command: run --publisher-command. none: push only.",
    "--publisher-command <executable>": "With --publisher command: an executable run with no shell or arguments in the owned worktree, with PATH, HOME and ARCHCTX_PUBLISH_REMOTE/BASE/BRANCH/BASE_SHA/COMMIT/TITLE/BODY_FILE only (on Windows also SystemRoot, windir, ComSpec, PATHEXT, TEMP, TMP, USERPROFILE; #! scripts run through their interpreter on PATH; .cmd/.bat are rejected). Optional stdout: a JSON object {url?, number?}.",
    "--accept-observed-major-change": "Accept the major change the run observes (ProjectionRequestV1.acceptObservedMajorChange). Without it a major change stops at human-action-required and nothing is pushed.",
    "--follow": "Run as a foreground loop: one publish per --interval, one JSON envelope line per run on stdout, until SIGINT or SIGTERM. For launchd/systemd KeepAlive on an always-on host.",
    "--interval <seconds>": `With --follow: seconds between runs (default ${PROJECTION_PUBLISH_DEFAULT_INTERVAL_SECONDS}, minimum ${PROJECTION_PUBLISH_MIN_INTERVAL_SECONDS}).`,
    "--json": "Accepted for symmetry; output is always JSON.",
    "--help, -h": "Show help without fetching, pushing or starting a daemon."
  },
  results: "published, up-to-date, already-processed, human-action-required, busy (ok) or failed (ok: false with the run as data).",
  writes: "the writer state, lock and owned worktree under the repository runtime state directory; one commit on the owned worktree; a push to refs/heads/<--branch> only. Outbound: the projection-publishing egress channel (git fetch/ls-remote/push, gh, the publisher command); ARCHCONTEXT_EGRESS_MODE=local-only refuses it with AC_POLICY_VIOLATION. archctx stores no credentials. It never runs codegraph init; when code facts are required, run codegraph init <worktreePath> once (see projection publish-status).",
  capability: "projection-publish-v1"
};

/** `projection publish-status --help` (#379). */
const CLI_PROJECTION_PUBLISH_STATUS_HELP = {
  usage: "archctx projection publish-status [--base <branch>] [--remote <name>] [--json]",
  description: "Read-only state of the projection writer for one remote and base: the owned worktree path, a running writer's pid, the last processed and last successful base SHAs and the last run.",
  options: {
    "--base <branch>": "Default: main.",
    "--remote <name>": "Default: origin.",
    "--json": "Accepted for symmetry; output is always JSON.",
    "--help, -h": "Show help without reading anything."
  },
  writes: "none; no fetch, no daemon.",
  capability: "projection-publish-v1"
};

/** `projection verify-pr --help` (#379). */
const CLI_PROJECTION_VERIFY_PR_HELP = {
  usage: "archctx projection verify-pr --base <ref> [--json]",
  description: "Checks the checked-out pull request head (HEAD, clean tracked worktree) against --base. A changed path is generated only when it is the projection manifest or a manifest target path at HEAD or at the merge base, and, for a mixed-ownership target, its text outside the generated regions is unchanged (otherwise it is listed in humanEditedPaths); an agent-context row's generated text is its node's region. Only a generated-only diff is rendered (projection check). verdict is no-changes, touches-non-generated (answered from the diff alone, nothing rendered), generated-only-render-equivalent (generated files and regions equal a fresh render and no text outside them changed) or generated-only-not-render-equivalent. A mixed target that is added or deleted, or whose markers do not parse, is conservatively a human edit. The envelope is ok for every valid evaluation; the verdict carries the decision.",
  options: {
    "--base <ref>": "Required. The pull request base, for example origin/main.",
    "--json": "Accepted for symmetry; output is always JSON.",
    "--help, -h": "Show help without reading the repository."
  },
  writes: "none; no daemon, no local store. A dirty tracked worktree fails with AC_PRECONDITION_FAILED. A generated-only diff renders in-process like projection check, so it needs code facts when the manifest requires them.",
  capability: "projection-verify-pr-v1"
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

function refactorScanScopeFlags(args: string[], raw: string | undefined): RefactorRequestV1["scope"] {
  const nodeId = refactorFlagValue(args, "--node");
  const paths = args.flatMap((arg, index) => arg === "--path" ? [refactorFlagValueAt(args, index, arg)] : []);
  if (args.lastIndexOf("--node") !== args.indexOf("--node")
    || (nodeId !== undefined && paths.length > 0)
    || (raw !== undefined && (nodeId !== undefined || paths.length > 0))) {
    throw new RefactorFlagError("refactor scan accepts one --node, repeatable --path, or --request-json");
  }
  if (nodeId !== undefined) return { kind: "node", nodeId };
  if (paths.length === 0) return { kind: "repository" };
  if (paths.some((path) => !isRepoRelativePosixPath(path) || !path.trim() || /^[A-Za-z]:/.test(path) || posix.normalize(path) === ".")) {
    throw new RefactorFlagError("refactor scan --path requires a repo-relative file path");
  }
  return { kind: "paths", paths: [...new Set(paths.map((path) => posix.normalize(path).replace(/\/$/, "")))].sort() };
}

export interface CliRuntimeDeps extends RuntimeDeps {
  runtimeClient?: RuntimeDaemonClient;
  /** Source of `plan --body -` and `resolve --paths-from -`; defaults to the process stdin. */
  readStdin?: () => string | Promise<string>;
  disableRpcDiscovery?: boolean;
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
  if (command === "--version") {
    if (args.some(arg => arg !== "--json") || args.length > 1) return cliArgumentFailure("version", "--version accepts only an optional --json flag");
    return okEnvelope("version", { version: ARCHCONTEXT_PRODUCT_VERSION });
  }
  if (command === "resolve") {
    const preflight = preflightCliArguments(command, args);
    if (preflight) return preflight.ok ? preflight : cliArgumentFailure("resolve", preflight.error!.message);
  }
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
  const readerStage = command === "docs" && args[0] === "anchors" ? "docs-anchors"
    : command === "flows" ? "flows-check"
    : command === "state-machines" ? "state-machines-check" : undefined;
  const readerRequestId = readerStage === "docs-anchors" ? "docs.anchors" : readerStage === "flows-check" ? "flows.check"
    : readerStage === "state-machines-check" ? "state-machines.check" : undefined;
  const selectedRequestId = readerRequestId ?? command;
  const selected = readerStage !== undefined || ["debt", "checkpoint", "complete", "review"].includes(command)
    || (command === "practices" && args[0] === "checkpoint")
    || (command === "hook" && args[0] === "checkpoint");
  try {
    if (selected) {
      const preflight = preflightCliArguments(command, args);
      if (preflight) return preflight.ok ? preflight : failureEnvelope(selectedRequestId, knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"));
    }
    const result = await runCliUnchecked(command, args, cwd, deps);
    return selected ? normalizeFailureResult(result, readerStage ?? "cli", readerRequestId ?? (command === "practices" ? "practices.checkpoint" : command === "hook" ? "hook.checkpoint" : command)) : result;
  } catch (error) {
    if (selected) {
      if (error instanceof CliUsageError) return failureEnvelope(selectedRequestId, knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"));
      if (error instanceof LocalEgressPolicyError) return failureEnvelope(selectedRequestId, knownFailure("AC_POLICY_VIOLATION", "egress-policy-denied"));
      return selectedProducerFailureEnvelope(selectedRequestId, error, readerStage ?? "cli");
    }
    if (error instanceof LocalEgressPolicyError) return errorEnvelope(command, "AC_POLICY_VIOLATION", error.message);
    if (error instanceof GitVisibleFilesUnavailableError) return errorEnvelope(command, error.code, error.message, error.reasonCode);
    if (error instanceof FailureError) return toEnvelope(command, error, "cli");
    throw error;
  }
}

export function runCapabilitiesCommand() {
  return archctxCapabilities(ARCHCONTEXT_PRODUCT_VERSION);
}

async function runCliUnchecked(command = "help", args: string[] = [], cwd: string, deps: CliRuntimeDeps = {}) {
  if (command === "impact") return runRefImpactCommand(args, cwd);
  if (command === "verify") return runRuntimeVerifyCliCommand(args, cwd);
  if (command === "history") return runArchitectureHistoryCommand(args, cwd);
  if (command === "export" && args[0] === "native") return runNativeContextCommand(args.slice(1), cwd);
  const preflight = preflightCliArguments(command, args);
  if (preflight) return preflight;
  if (command === "index") return runIndexCommand(args, cwd);
  // One in-process runtime per command, serialized by the SQLite cache writer lock (#160).
  let runtimeHandle: Promise<CliRuntimeHandle> | undefined;
  const runtime = async () => {
    runtimeHandle ??= createCliRuntime(cwd, deps);
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
      return await runProjectionProtocolCommand(args, cwd, runtime, deps);
    case "flows":
      return runFlowsCommand(args, cwd);
    case "state-machines":
      return runStateMachinesCommand(args, cwd);
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
      return runHookCommand(args, cwd);
    case "hooks":
      return runHooksCommand(args);
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
        if (!["--id", "--decisions", "--layers"].includes(flag) || seen.has(flag) || !args[index + 1] || args[index + 1].startsWith("--")) {
          return errorEnvelope("manifest", "AC_SCHEMA_INVALID", "manifest plan accepts one --id and optional --decisions / --layers values only");
        }
        seen.add(flag);
      }
      const id = requireFlag(args, "--id");
      const decisions = readFlag(args, "--decisions");
      const layerValue = readFlag(args, "--layers");
      const layers = layerValue?.split(",");
      if (decisions === undefined && layers === undefined) return errorEnvelope("manifest", "AC_SCHEMA_INVALID", "manifest plan requires --decisions or --layers");
      if (layers && (layers.length === 0 || new Set(layers).size !== layers.length || layers.some(layer => !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(layer)))) return errorEnvelope("manifest", "AC_SCHEMA_INVALID", "--layers must be a comma-separated unique ordered list of layer slugs");
      if (decisions !== undefined && decisions !== "docs/adr") return errorEnvelope("manifest", "AC_SCHEMA_INVALID", "content.decisions supports only docs/adr");
      const root = findRepositoryRoot(cwd);
      const operation = planManifestFieldsOperation(root, { ...(decisions === undefined ? {} : { "content.decisions": decisions }), ...(layers === undefined ? {} : { "model.layers": layers }) });
      return (await runtime()).planUpdate(root, { id, operations: [operation] });
    }
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
    case "export": {
      const format = args[0] ?? readFlag(args, "--format") ?? "mermaid";
      const model = loadNativeModelFromArchContext(cwd);
      const result = format === "mermaid" ? exportMermaidModel(model) : undefined;
      if (!result) return errorEnvelope("export", "AC_SCHEMA_INVALID", "export requires native or mermaid");
      return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "export", data: result as any };
    }
    case "debt":
      return runDebtCommand(args, cwd);
    case "deps":
      return runDepsCommand(args, cwd);
    case "constraints":
      return runConstraintsCommand(args, cwd);
    case "resolve": {
      if (args.includes("--path") && args.includes("--paths-from")) {
        return cliArgumentFailure("resolve", "resolve accepts exactly one of --path or --paths-from");
      }
      if (args.includes("--paths-from")) {
        const read = await readResolvePathsFrom(args, cwd, deps);
        if ("problem" in read) return cliArgumentFailure("resolve", read.problem);
        const model = loadResolveModel(cwd);
        const outcomes = resolveArchitectureOwnersForPaths(model.nodes, read.paths);
        return okEnvelope("resolve", { results: outcomes.map((outcome, index) => resolveResultData(read.paths[index], outcome)) } as unknown as Json);
      }
      const path = readFlag(args, "--path");
      if (!path) return cliArgumentFailure("resolve", "resolve requires --path or --paths-from");
      if (!isRepoRelativePosixPath(path)) {
        return cliArgumentFailure("resolve", "resolve --path must be a repository-relative POSIX path");
      }
      const model = loadResolveModel(cwd);
      return okEnvelope("resolve", resolveResultData(path, resolveArchitectureOwnerForPath(model.nodes, path)) as unknown as Json);
    }
    case "help":
    default:
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: true,
        requestId: "help",
        data: {
          commands: ["capabilities", "projection", "init", "index", "sync", "validate", "context", "status", "repo", "landscape", "recommendations", "refactor", "explore", "prepare", "practices", "checkpoint", "hook", "hooks", "plan", "apply", "hash", "review", "complete", "manifest", "install", "uninstall", "doctor", "update", "paths", "export", "resolve", "impact", "verify", "history", "flows", "state-machines", "deps", "constraints", "debt"],
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
      command: "archctx manifest plan --id <changeset.id> [--decisions docs/adr] [--layers cli,effects,core]",
      supportedFields: { "content.decisions": "docs/adr", "model.layers": "non-empty unique ordered layer slugs, top layer first" },
      writes: "none; approve the returned ChangeSet with archctx apply"
    });
  case "resolve":
    return okEnvelope("resolve", CLI_RESOLVE_HELP as unknown as Json);
  case "index":
    if (subcommand === "seed") return okEnvelope("help", CLI_INDEX_SEED_HELP as unknown as Json);
    break;
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
  case "debt":
    return okEnvelope("help", {
      command: "archctx debt",
      usage: ["archctx debt [--changed-path <path>]... [--json]", "archctx debt [--base <ref>] [--complete] [--json]"],
      schemaVersion: "archcontext.architecture-debt/v1",
      deltaSchemaVersion: "archcontext.architecture-debt-delta/v1",
      description: "Measure the current working tree. --base compares it with a committed Git revision. --complete also reads dependency and flow evidence from CodeGraph. Coverage gaps are reported for each side. Use a full head checkout for delta measurements.",
      writes: "With --base, caches the committed measurement in local SQLite and uses a temporary detached worktree on a cache miss. Runs without starting a daemon."
    });
  case "checkpoint":
    return okEnvelope("help", {
      command: `archctx ${command}`,
      usage: `archctx ${command} [--changed-path <path>]... [--json]`,
      schemaVersion: "archcontext.architecture-debt/v1",
      description: "Edit-time ownership and human citation debt for changed paths. Dependency, flow and practice checks are explicit coverage gaps reserved for complete; no source byte stamp is debt.",
      writes: "none; no daemon, runtime state, rendering or CodeGraph sync"
    });
  case "refactor":
    if (subcommand === "scan") return okEnvelope("help", {
      usage: "archctx refactor scan [--node <nodeId> | --path <repo-relative-file> ... | --request-json <request>] [--import-node-limit <n>] [--json]",
      description: "Measure structure and return fresh candidates alongside open refactor recommendations. Node scans include descendants. Node and path scans read selected files and their direct import neighbors.",
      snapshotDigest: "Pass data.snapshotDigest to recommendations accept, defer or reject while the snapshot is available in the daemon."
    });
    break;
  case "recommendations":
    if (subcommand === "accept" || subcommand === "defer" || subcommand === "reject") return okEnvelope("help", {
      usage: `archctx recommendations ${subcommand} --id <recommendationId> --reason <text> [--snapshot-digest <sha256:digest>]`,
      snapshotDigest: "The top-level digest from refactor scan. For a fresh candidate, reuse the scan scope and import limit without re-measuring."
    });
    break;
  case "deps":
    return okEnvelope("deps", CLI_DEPS_HELP as unknown as Json);
  case "constraints":
    return okEnvelope("constraints.check", {
      command: "archctx constraints check --json",
      description: "Evaluate declared dependency constraints in-process using the current model and existing CodeGraph index. No daemon or runtime-state writes.",
      result: "data.status is pass, violated, undetermined or not-applicable. Missing or incomplete code facts remain undetermined; unsupported rules appear in data.warnings.",
      exitCode: "0 means the query succeeded; inspect data.status for the constraint verdict. Invalid input or model declarations exit 1."
    });
  case "flows":
    return okEnvelope("flows", {
      command: "archctx flows check [--no-sync] [--json]",
      description: "Check every declared flow selector against the CodeGraph index without rendering a projection.",
      statuses: "Each selector reports proven, no-direct-call, only-references, false-builtin-call, ambiguous-symbol, evidence-missing or evidence-truncated. Only proven binds a flow step.",
      writes: "Default: runs codegraph sync and writes the .codegraph index. With --no-sync: no checkout or index writes; the existing index is read in-process through one read-only session (ADR-0058). Neither mode starts a daemon or task session.",
      noSync: "Requires a complete existing index matching the source population. A missing, unreadable, stale or partial index, or one a build is still writing, fails closed with AC_CODE_FACTS_UNAVAILABLE."
    });
  case "state-machines":
    return okEnvelope("state-machines", {
      command: "archctx state-machines check [--json]",
      description: "Check every state machine declared as a direct child of .archcontext/model/state-machines/ (archctx validate rejects a model file in a subdirectory): each never and final rule, unreachable states, dead steps and deadlocks, and the code anchor of every region and event source.",
      result: "Each broken rule carries its shortest path from the initial state; each holding rule lists the guards that protect it. A rule with a finding reports finding-open or finding-resolved. Each anchor reports its status against the current file.",
      writes: "None. Reads the model and the files that a source names; starts no daemon or task session. An anchor that names a symbol reads the CodeGraph index read-only and reports unchecked when no index is available."
    });
  case "docs":
    if (subcommand === "anchors") return okEnvelope("help", CLI_DOCS_ANCHORS_HELP as unknown as Json);
    break;
  case "projection":
    if (subcommand === "freshness") return okEnvelope("help", CLI_PROJECTION_FRESHNESS_HELP as unknown as Json);
    if (subcommand === "slice") return okEnvelope("help", {
      usage: "archctx projection slice --base <ref> [--changed-path <path>...] [--format json|markdown]",
      description: "Compare the merge base and HEAD. Print highlighted capability diagrams and entrypoint anchors for a pull request.",
      schemaVersion: "archcontext.projection-slice/v1",
      requirements: "A clean tracked worktree and a ready existing CodeGraph index. Extra changed paths only select scope. The command writes no files."
    });
    if (subcommand === "publish") return okEnvelope("help", CLI_PROJECTION_PUBLISH_HELP as unknown as Json);
    if (subcommand === "publish-status") return okEnvelope("help", CLI_PROJECTION_PUBLISH_STATUS_HELP as unknown as Json);
    if (subcommand === "verify-pr") return okEnvelope("help", CLI_PROJECTION_VERIFY_PR_HELP as unknown as Json);
    break;
  }
  return okEnvelope("help", {
    command: `archctx ${command}`,
    description: `archctx ${command} has no dedicated help text. --help never runs it or starts the local runtime; run archctx help for every command.`,
    examples: CLI_HELP_EXAMPLES.filter((example) => example === `archctx ${command}` || example.startsWith(`archctx ${command} `))
  });
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
  const snapshotDigest = readFlag(args, "--snapshot-digest");
  if (snapshotDigest !== undefined && (args.lastIndexOf("--snapshot-digest") !== args.indexOf("--snapshot-digest") || !/^sha256:[a-f0-9]{64}$/.test(snapshotDigest))) {
    return errorEnvelope(`recommendations.${subcommand}`, "AC_SCHEMA_INVALID", "--snapshot-digest requires one sha256:<64-hex> value");
  }
  const input: RuntimeRecommendationInput = {
    ...(snapshotDigest === undefined ? {} : { snapshotDigest }),
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
      const scope = refactorScanScopeFlags(args, raw);
      // No request is the repository-scope default, which is what the daemon already applies.
      if (scope.kind === "repository" && raw === undefined && limitRaw === undefined) return (await runtime()).refactorScan(cwd, {});
      let request: unknown = { schemaVersion: REFACTOR_REQUEST_SCHEMA_VERSION, scope };
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
    return failureEnvelope("docs.anchors", knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"));
  }
  let profile: ArchitectureProjectionProfile | undefined;
  try {
    profile = architectureProjectionProfile(args);
  } catch (error) {
    return failureEnvelope("docs.anchors", knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"));
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
    if (error instanceof FailureError) return toEnvelope(`docs.${action}`, error, "cli");
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

async function runProjectionProtocolCommand(args: string[], cwd: string, runtime: () => Promise<RuntimeDaemonClient>, deps: CliRuntimeDeps): Promise<JsonEnvelope> {
  const action = args[0] ?? "run";
  // Projection writer mode (#379): a client of the protocol that drives its own worktree's daemon.
  if (action === "publish" || action === "publish-status" || action === "verify-pr") return runProjectionWriterCliCommand(action, args.slice(1), cwd, deps);
  // `snapshot` is read-only and answered in-process: the `expected` snapshot a request would be
  // checked against now, so consumers never compute the worktree digest themselves.
  if (action === "snapshot") {
    const unexpected = args.slice(1).filter((arg) => arg !== "--json");
    if (unexpected.length > 0) return errorEnvelope("projection.snapshot", "AC_SCHEMA_INVALID", "projection snapshot accepts only --json");
    return runProjectionSnapshotCommand(cwd);
  }
  // `freshness` runs check's projection build in-process, with no daemon and no repository write
  // (ADR-0056 §2).
  if (action === "freshness") return runProjectionFreshnessCliCommand(args.slice(1), cwd);
  if (action === "slice") return runProjectionSliceCliCommand(args.slice(1), cwd);
  if (action !== "run") return errorEnvelope("projection", "AC_SCHEMA_INVALID", "projection requires run --request-json <request>, snapshot|freshness [--json], slice --base <ref>, or publish|publish-status|verify-pr");
  const raw = readFlag(args, "--request-json");
  if (!raw) return errorEnvelope(`projection.${action}`, "AC_SCHEMA_INVALID", `projection ${action} requires --request-json`);
  let request: RuntimeProjectionInvocation["request"];
  try { request = JSON.parse(raw); }
  catch { return errorEnvelope(`projection.${action}`, "AC_SCHEMA_INVALID", "projection request is not valid JSON"); }
  // `check` is read-only: it is answered in-process, before any runtime client exists, so it can
  // never open the local store or require a task session.
  if ((request as { mode?: unknown } | null)?.mode === "check") {
    return runProjectionCheckInvocation(request, cwd);
  }
  return (await runtime()).projection(findRepositoryRoot(cwd), { action: "run", request } as RuntimeProjectionInvocation);
}

async function runIndexCommand(args: string[], cwd: string): Promise<JsonEnvelope | FailureEnvelope> {
  const subcommand = args[0];
  if (subcommand !== "seed") {
    return errorEnvelope("index", "AC_SCHEMA_INVALID", "index requires seed [--timeout-ms <ms>] [--json]");
  }
  for (let index = 1; index < args.length; index += 1) {
    const token = args[index]!;
    if (token === "--timeout-ms" || token === "--format") { index += 1; continue; }
    if (token === "--json") continue;
    return errorEnvelope("index.seed", "AC_SCHEMA_INVALID", `index seed does not accept ${token}; use --help`);
  }
  const timeout = readOptionalPositiveIntegerFlag(args.slice(1), "--timeout-ms", "index.seed");
  if (!timeout.ok) return timeout.envelope;
  try {
    const result = await runCodeGraphIndexSeed(cwd, { timeoutMs: timeout.value });
    return okEnvelope("index.seed", result as unknown as Json);
  } catch (error) {
    if (error instanceof GitVisibleFilesUnavailableError) {
      return errorEnvelope("index.seed", error.code, error.message, error.reasonCode);
    }
    if (error instanceof FailureError) {
      return toEnvelope("index.seed", error, "cli");
    }
    throw error;
  }
}

function runProjectionSliceCliCommand(args: string[], cwd: string): JsonEnvelope {
  const requestId = "projection.slice";
  const stray = projectionWriterStrayToken(args, ["--base", "--changed-path"]);
  if (stray !== undefined) return cliArgumentFailure(requestId, `projection slice does not accept ${stray}; use --help`);
  const base = readFlag(args, "--base");
  if (!base || readRepeatedFlag(args, "--base").length !== 1) return cliArgumentFailure(requestId, "projection slice requires exactly one --base <ref>");
  const format = readFlag(args, "--format") ?? "json";
  if (format !== "json" && format !== "markdown") return cliArgumentFailure(requestId, "projection slice --format must be json or markdown");
  if (args.some((arg, index) => arg === "--changed-path" && args[index + 1] === "")) {
    return cliArgumentFailure(requestId, "projection slice --changed-path requires a nonempty path");
  }
  return runProjectionSliceCommand({ cwd, base, changedPaths: readRepeatedFlag(args, "--changed-path") });
}

function runProjectionFreshnessCliCommand(args: string[], cwd: string): JsonEnvelope {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--json") continue;
    // Global rendering flag (preflight guarantees it has a value); the process entry reads it, as `flows` does.
    if (arg === "--format") { index += 1; continue; }
    return errorEnvelope("projection.freshness", "AC_SCHEMA_INVALID", `projection freshness does not accept ${arg}; use --help`);
  }
  return runProjectionFreshnessCommand(cwd);
}

type ProjectionWriterCliAction = "publish" | "publish-status" | "verify-pr";

interface ProjectionPublishCliInput {
  remote?: string;
  base?: string;
  baseSha?: string;
  branch?: string;
  publisher: ProjectionPublisherPort;
  acceptObservedMajorChange: boolean;
  follow: boolean;
  intervalSeconds: number;
}

/**
 * `projection publish|publish-status|verify-pr` (#379). Positional tokens are refused, and every
 * flag the preflight let through is read here, so a stray token never changes what runs.
 */
async function runProjectionWriterCliCommand(action: ProjectionWriterCliAction, args: string[], cwd: string, deps: CliRuntimeDeps): Promise<JsonEnvelope> {
  const requestId = `projection.${action}`;
  const valueFlags: readonly string[] = action === "publish" ? PROJECTION_PUBLISH_VALUE_FLAGS : action === "publish-status" ? PROJECTION_PUBLISH_STATUS_VALUE_FLAGS : PROJECTION_VERIFY_PR_VALUE_FLAGS;
  const stray = projectionWriterStrayToken(args, valueFlags);
  if (stray !== undefined) return errorEnvelope(requestId, "AC_SCHEMA_INVALID", `projection ${action} does not accept ${stray}; use --help`, "cli-input-invalid");
  if (action === "verify-pr") {
    const base = readFlag(args, "--base");
    if (!base) return errorEnvelope(requestId, "AC_SCHEMA_INVALID", "projection verify-pr requires --base <ref>", "cli-input-invalid");
    return runProjectionVerifyPrCommand({ cwd, base });
  }
  if (action === "publish-status") {
    return runProjectionPublishStatusCommand({ cwd, base: readFlag(args, "--base"), remote: readFlag(args, "--remote") });
  }
  const parsed = parseProjectionPublishCliInput(args, cwd);
  if (!parsed.ok) return parsed.envelope;
  if (parsed.input.follow) {
    return errorEnvelope(requestId, "AC_SCHEMA_INVALID", "projection publish --follow is a foreground process loop of the archctx executable; without --follow this command runs once", "cli-input-invalid");
  }
  return runProjectionPublishOnce(parsed.input, cwd, deps);
}

/** The first token that is neither a known flag nor the value of one; `--json` and `--format <v>` are global. */
function projectionWriterStrayToken(args: string[], valueFlags: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (valueFlags.includes(token) || token === "--format") { index += 1; continue; }
    if (isCliFlagToken(token)) continue;
    return token;
  }
  return undefined;
}

function parseProjectionPublishCliInput(args: string[], cwd: string): { ok: true; input: ProjectionPublishCliInput } | { ok: false; envelope: JsonEnvelope } {
  const invalid = (message: string) => ({ ok: false as const, envelope: errorEnvelope("projection.publish", "AC_SCHEMA_INVALID", message, "cli-input-invalid") });
  const publisherKind = readFlag(args, "--publisher") ?? "gh";
  const publisherCommand = readFlag(args, "--publisher-command");
  const follow = args.includes("--follow");
  const baseSha = readFlag(args, "--base-sha");
  if (baseSha !== undefined && follow) return invalid("projection publish --base-sha cannot be used with --follow");
  const intervalFlag = readFlag(args, "--interval");
  if (intervalFlag !== undefined && !follow) return invalid("projection publish --interval requires --follow");
  const intervalSeconds = intervalFlag === undefined ? PROJECTION_PUBLISH_DEFAULT_INTERVAL_SECONDS : Number(intervalFlag);
  if (!/^\d+$/.test(intervalFlag ?? "0") || !Number.isSafeInteger(intervalSeconds) || intervalSeconds < PROJECTION_PUBLISH_MIN_INTERVAL_SECONDS) {
    return invalid(`projection publish --interval must be an integer number of seconds, at least ${PROJECTION_PUBLISH_MIN_INTERVAL_SECONDS}`);
  }
  let publisher: ProjectionPublisherPort;
  if (publisherKind === "gh" || publisherKind === "none") {
    if (publisherCommand !== undefined) return invalid("projection publish --publisher-command requires --publisher command");
    publisher = publisherKind === "gh" ? createGhProjectionPublisher() : createNoneProjectionPublisher();
  } else if (publisherKind === "command") {
    if (!publisherCommand) return invalid("projection publish --publisher command requires --publisher-command <executable>");
    const command = resolve(cwd, publisherCommand);
    if (!existsSync(command) || !statSync(command).isFile()) return invalid(`projection publish --publisher-command is not a file: ${command}`);
    publisher = createCommandProjectionPublisher({ command });
  } else {
    return invalid("projection publish --publisher must be gh, command or none");
  }
  return {
    ok: true,
    input: {
      remote: readFlag(args, "--remote"),
      base: readFlag(args, "--base"),
      baseSha,
      branch: readFlag(args, "--branch"),
      publisher,
      acceptObservedMajorChange: args.includes("--accept-observed-major-change"),
      follow,
      intervalSeconds
    }
  };
}

/**
 * One publish. The apply runs in-process inside the writer-owned worktree (ADR-0005: one writer
 * per worktree); tests inject `deps.runtimeClient`.
 */
function runProjectionPublishOnce(input: ProjectionPublishCliInput, cwd: string, deps: CliRuntimeDeps): Promise<JsonEnvelope> {
  return runProjectionPublishCommand({
    cwd,
    remote: input.remote,
    base: input.base,
    baseSha: input.baseSha,
    branch: input.branch,
    publisher: input.publisher,
    acceptObservedMajorChange: input.acceptObservedMajorChange,
    apply: async (worktree, request) => {
      if (deps.runtimeClient) return deps.runtimeClient.projection(worktree, { action: "run", request });
      const daemon = await createStartedDaemon({ localStorePath: defaultLocalStorePath(worktree) });
      try {
        return await daemon.projection(worktree, { action: "run", request });
      } finally {
        await daemon.stop();
      }
    }
  });
}

/**
 * `projection publish --follow`, run by the process entry: one publish per interval, one compact
 * JSON envelope line per run, until SIGINT or SIGTERM. A signal during a run lets it finish (and
 * release its lock) before the loop stops. Returns the process exit code.
 */
async function runProjectionPublishFollowEntry(args: string[], cwd: string): Promise<number> {
  const stray = projectionWriterStrayToken(args, PROJECTION_PUBLISH_VALUE_FLAGS);
  const parsed = stray === undefined
    ? parseProjectionPublishCliInput(args, cwd)
    : { ok: false as const, envelope: errorEnvelope("projection.publish", "AC_SCHEMA_INVALID", `projection publish does not accept ${stray}; use --help`, "cli-input-invalid") };
  if (!parsed.ok) {
    process.stdout.write(`${JSON.stringify(parsed.envelope)}\n`);
    return 1;
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await runProjectionPublishFollow({
      runOnce: () => runProjectionPublishOnce(parsed.input, cwd, {}),
      intervalMs: parsed.input.intervalSeconds * 1000,
      sleep: (ms) => sleepUnlessAborted(ms, controller.signal),
      shouldStop: () => controller.signal.aborted,
      onResult: (envelope) => { process.stdout.write(`${JSON.stringify(envelope)}\n`); }
    });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
  return 0;
}

function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolvePromise) => {
    if (signal.aborted) { resolvePromise(); return; }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolvePromise();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** `check [--json] [--format <value>]` plus the listed boolean flags; any other argument is refused. */
function isCheckInvocation(args: string[], booleanFlags: readonly string[] = []): boolean {
  const formatAt = args.indexOf("--format");
  const unexpected = args.slice(1).filter((arg, index) => arg !== "--json" && !booleanFlags.includes(arg) && (formatAt < 0 || (index + 1 !== formatAt && index !== formatAt)));
  return args[0] === "check" && unexpected.length === 0;
}

function runConstraintsCommand(args: string[], cwd: string): JsonEnvelope {
  if (!isCheckInvocation(args)) return failureEnvelope("constraints.check", knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"));
  return runConstraintCheckCommand(cwd);
}

/** In-process flow proofs; only the explicit no-sync mode preserves the checkout index. */
function runFlowsCommand(args: string[], cwd: string): JsonEnvelope {
  if (!isCheckInvocation(args, ["--no-sync"])) return failureEnvelope("flows.check", knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"));
  return runFlowSelectorCheckCommand(cwd, { noSync: args.includes("--no-sync") });
}

/** Stateless read of the model and of the files that a source names; no daemon or store. */
function runStateMachinesCommand(args: string[], cwd: string): JsonEnvelope {
  if (!isCheckInvocation(args)) return failureEnvelope("state-machines.check", knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"));
  return runStateMachineCheckCommand(cwd);
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

async function runHookCommand(args: string[], cwd: string) {
  const subcommand = args[0] ?? "checkpoint";
  if (subcommand === "checkpoint") return runHookCheckpointCommand(args.slice(1), cwd);
  return errorEnvelope("hook", "AC_SCHEMA_INVALID", "hook requires checkpoint");
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
    changedPathDigest: digestJson({
      paths: [...new Set(input.changedPaths)].sort()
    }),
    reasonCode: input.reasonCode,
    failOpen: input.failOpen,
    egress: "none",
    network: "forbidden"
  } satisfies import("@archcontext/contracts").ArchitectureDebtHookLogV1;
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

function readAgentHost(args: string[]): AgentHost | undefined {
  const host = readFlag(args, "--host") ?? "generic";
  return host === "codex" || host === "claude" || host === "generic" ? host : undefined;
}

async function doctorReport(cwd: string, args: string[] = []) {
  const product = productVersionManifest();
  const paths = runtimePathsReport(cwd);
  const git = doctorGit(cwd);
  const sqlite = doctorSqlite(cwd);
  const permissions = doctorPermissions(cwd);
  // Informational: one read-only session on the index (ADR-0058), never part of `ok`.
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
    runtime: {
      mode: "in-process"
    },
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
  const writerLockPath = localStoreWriterOwnershipPath(path);
  return {
    path,
    exists: existsSync(path),
    writerLockPath,
    writerLocked: existsSync(writerLockPath),
    migrations: productVersionManifest().runtime.sqliteMigrations
  };
}

function doctorPermissions(cwd: string) {
  const paths = runtimeStatePaths(cwd);
  return {
    workspace: pathAccess(cwd),
    stateRoot: pathAccess(paths.stateRoot),
    runtimeStateDir: pathAccess(paths.workspaceStateDir),
    sqlite: pathAccess(defaultLocalStorePath(cwd))
  };
}

function runtimePathsReport(cwd: string) {
  const paths = runtimeStatePaths(cwd);
  return {
    ...paths,
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
  const {
    runtimeClient: _runtimeClient,
    disableRpcDiscovery: _disableRpcDiscovery,
    ...runtimeDeps
  } = deps;
  const daemon = await createStartedDaemon({
    localStorePath: defaultLocalStorePath(cwd),
    ...runtimeDeps
  });
  return { client: daemon, close: () => daemon.stop() };
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
  if (format === "markdown" && result.requestId === "projection.slice" && result.ok) return result.data.markdown.trimEnd();
  if (format !== "human") return JSON.stringify(result, null, 2);
  if (!result.ok) return `ERROR ${result.error?.code}: ${result.error?.message}`;
  const codeFactsLine = result.requestId === "doctor" ? `${doctorCodeFactsLine(result.data?.codeFacts)}\n` : "";
  return `OK ${result.requestId}\n${codeFactsLine}${JSON.stringify(result.data, null, 2)}`;
}

function doctorCodeFactsLine(codeFacts: any): string {
  if (!codeFacts) return "code facts: not reported";
  if (codeFacts.state === "unavailable") return `code facts: unavailable (${codeFacts.message})`;
  if (codeFacts.state === "index-missing") return "code facts: index missing; run `codegraph init`, or `archctx index seed` in a linked worktree once the primary checkout has published a base index";
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

const CLI_HELP_EXAMPLES = ["archctx verify --base origin/main --json", "archctx impact --batch-file paths.json --json", "archctx impact --base HEAD~1 --head HEAD --json", "archctx init --name MyApp", "archctx index seed --json", "archctx sync --json", "archctx projection run --request-json '{...}'", "archctx projection snapshot --json", "archctx projection freshness --json", "archctx projection publish --json", "archctx projection publish --publisher none --json", "archctx projection publish --follow --interval 300", "archctx projection publish-status --json", "archctx projection verify-pr --base origin/main --json", "archctx plan --id changeset.<id> --op update_entity_fields --path .archcontext/model/nodes/<node>.yaml --expected-hash sha256:<64-hex> --body '<complete YAML>'", "archctx plan --id changeset.<id> --op delete_entity --path .archcontext/model/flows/<flow>.yaml --expected-hash sha256:<64-hex>", "archctx hash --path .archcontext/model/nodes/<node>.yaml", "archctx plan --id changeset.<id> --operations-file <operations.json>", "archctx plan --id changeset.<id> --op update_entity_fields --path .archcontext/model/nodes/<node>.yaml --expected-hash sha256:<64-hex> --body-file <entity.yaml>", "archctx apply --id changeset.<id> --approved --expected-worktree-digest <draft.base.worktreeDigest>", "archctx recommendations accept --id recommendation.<id> --reason 'Accepted after local review.'", "archctx recommendations metrics", "archctx recommendations list --status rejected", "archctx refactor scan --json", "archctx refactor verify --request-json '{...}' --json", "archctx practices validate --strict", "archctx practices list --json", "archctx practices waivers", "archctx practices waive --practice-id modularity.no-new-cycle --owner team-architecture --reason 'External migration window requires this edge until cutover.' --review-at 2026-07-10T00:00:00.000Z --expires-at 2026-07-24T00:00:00.000Z --evidence-digest sha256:<64-hex> --subject module.a->module.b", "archctx checkpoint --changed-path src/app.ts", "archctx practices checkpoint --task-session-id task_cli", "archctx hook checkpoint --event post-edit --changed-path src/app.ts", "archctx hooks install --host codex", "archctx paths", "archctx update --check", "archctx doctor --check-updates", "archctx explore start --foreground", "archctx docs anchors --json", "archctx export native --worktree --json", "archctx export native --ref HEAD --profile repo-harness/v1 --json", "archctx resolve --path packages/core/projection-engine/src/index.ts", "archctx refactor scan --import-node-limit 100000 --json", "archctx resolve --paths-from changed-paths.txt", "archctx flows check --json", "archctx state-machines check --json", "archctx recommendations defer --id recommendation.<id> --import-node-limit 100000 --reason 'Scanned with the same limit.'", "archctx deps --json", "archctx deps --into capability.<id> --json"];

const CLI_RESOLVE_HELP = {
  command: "archctx resolve (--path <repo-relative path> | --paths-from <file> | --paths-from -)",
  rule: "ADR-0043. source.exclude applies first. When every matching node lies on one parent chain, the deepest node owns the path; refactor scan uses the same rule. When matching nodes lie on different chains, an ancestor yields to its own descendant, then the longest literal source.include prefix wins, and an equal-length tie is ambiguous.",
  batch: "--paths-from reads one repository-relative POSIX path per line from a file (relative to the current directory) or from stdin (-). Blank lines are ignored and surrounding whitespace is trimmed. The model loads once. data.results has one entry per input path, in input order. The command reads no daemon state and no CodeGraph index.",
  result: "Each result carries path, matched, ambiguous and owningCapabilityId. A match adds stableId, kind, name, source and extensions of the most specific node. An ambiguous result adds candidates. owningCapabilityId is the nearest kind: capability node on the owner's parent chain (the owner itself when it is a capability), or null. For an ambiguous result it is set only when all candidates share one owning capability.",
  exitCodes: "--path: 0 matched, 1 no match or error, 2 ambiguous. --paths-from: 0 when no path is ambiguous (unowned paths included), 2 when any path is ambiguous, 1 on error."
};

function runRuntimeVerifyCliCommand(args: string[], cwd: string): JsonEnvelope {
  if (args.includes("--help") || args.includes("-h")) return okEnvelope("verify", { usage: "archctx verify --base <ref> --json" });
  const flags = args.filter(arg => arg !== "--json");
  if (flags.length !== 2 || flags[0] !== "--base" || args.length > 3) {
    return failureEnvelope("verify", knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"));
  }
  return runRuntimeVerifyCommand(cwd, flags[1]!);
}

async function runDebtCommand(args: string[], cwd: string): Promise<JsonEnvelope> {
  const base = readFlag(args, "--base");
  const complete = args.includes("--complete");
  const changedPaths = readRepeatedFlag(args, "--changed-path");
  if ((base !== undefined || complete) && changedPaths.length > 0) {
    return cliArgumentFailure("debt", "--changed-path cannot be combined with --base or --complete");
  }
  if (base === undefined) return runArchitectureDebtCommand(cwd, { changedPaths, complete });
  if (readRepeatedFlag(args, "--base").length > 1) return cliArgumentFailure("debt", "Provide only one --base revision");

  // Let in-flight Git and CodeGraph operations settle, then remove the private worktree on interrupt.
  const controller = new AbortController();
  const stop = () => controller.abort(new FailureError("AC_RUNTIME_UNAVAILABLE", "debt-measurement-interrupted"));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    return await runArchitectureDebtDeltaCommand(cwd, base, complete, controller.signal);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

function cliArgumentFailure(requestId: string, message: string): JsonEnvelope {
  // Local CLI diagnostics retain the specific flag or input line, with canonical recovery policy.
  return { schemaVersion: "archcontext.envelope/v1", ok: false, requestId,
    error: { ...knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"), message } };
}

/** Validate the same core node schema as native export, without its profile or document reads. */
function loadResolveModel(cwd: string) {
  if (!existsSync(join(cwd, ".archcontext/manifest.yaml"))) {
    throw new NativeContextError("native-context-model-missing", { path: ".archcontext/manifest.yaml" });
  }
  let model: ReturnType<typeof loadNativeModelFromArchContext>;
  try {
    model = loadNativeModelFromArchContext(cwd);
  } catch (error) {
    const cause = error as NodeJS.ErrnoException;
    if (typeof cause?.code === "string") {
      throw new NativeContextError("native-context-input-unreadable", {
        category: "open-or-read",
        ...(typeof cause.path === "string" ? { path: cause.path } : {})
      });
    }
    throw new NativeContextError("native-context-model-invalid", { invariant: "model-parse" });
  }
  if (model.nodes.length === 0) {
    throw new NativeContextError("native-context-model-missing", { category: "no-native-nodes" });
  }
  for (const node of model.nodes) {
    const { issues } = validateJsonSchema(nodeSchema, node as unknown as Json);
    if (issues.length > 0) {
      throw new NativeContextError("native-context-model-invalid", {
        issues: issues.slice(0, 32).map(issue => ({ entityId: typeof node.id === "string" ? node.id : "(undeclared)", field: issue.path, invariant: issue.message })),
        omittedDiagnosticCount: Math.max(0, issues.length - 32)
      });
    }
  }
  return model;
}

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
  imports: "data.imports reports coverage, reasonCodes, truncated, importNodeCount, importNodeLimit and importNodeLimitExceeded from the CodeGraph import read. A missing or stale index gives coverage unknown and an empty matrix. --import-node-limit sets the read cap (default 64000).",
  calls: "Call counts are not available in v1. data.calls.coverage is unknown with reason call-edges-not-exposed, and every cell has calls: null.",
  edges: "data.edges lists the attributed file-level edges behind the matrix, sorted by path, up to --edge-limit (default 200). data.edges.count is the full total."
};

/** `archctx deps`: in-process and read-only, like `resolve`, so it starts no daemon and writes no state. */
function runDepsCommand(args: string[], cwd: string) {
  const importNodeLimit = readOptionalPositiveIntegerFlag(args, "--import-node-limit", "deps");
  if (!importNodeLimit.ok) return failureEnvelope("deps", knownFailure("AC_SCHEMA_INVALID", "deps-input-invalid", {field: "importNodeLimit", issue: "invalid-limit"}));
  const edgeLimit = readOptionalNonNegativeIntegerFlag(args, "--edge-limit", "deps");
  if (!edgeLimit.ok) return failureEnvelope("deps", knownFailure("AC_SCHEMA_INVALID", "deps-input-invalid", {field: "edgeLimit", issue: "invalid-limit"}));
  const from = readFlag(args, "--from");
  const into = readFlag(args, "--into");
  for (const [flag, value] of [["--from", from], ["--into", into]] as const) {
    if (args.includes(flag) && (value === undefined || value.startsWith("--"))) {
      return failureEnvelope("deps", knownFailure("AC_SCHEMA_INVALID", "deps-input-invalid", {field: flag === "--from" ? "from" : "into", issue: "missing-value"}));
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
    if (error instanceof CapabilityDependenciesError) return selectedProducerFailureEnvelope("deps", error, "cli");
    throw error;
  }
}

const CLI_PLAN_HELP = {
  command: "archctx plan --id <changeset.id> (--op <create_entity|update_entity_fields|delete_entity> --path <file> [--expected-hash sha256:<64-hex>] [--body <yaml> | --body - | --body-file <path>] | --operations-file <operations.json | ->)",
  operations: "--operations-file takes a repository-relative path to a JSON array of operations in the archcontext_plan_update MCP shape, or - to read that array from stdin, and plans them as one ChangeSet; it cannot be combined with --op, --path, --expected-hash, --body or --body-file.",
  body: "--body is the complete new YAML document, not a field patch. Give exactly one of --body <yaml>, --body - (stdin) or --body-file <path>. --body-file and --operations-file read only repository-relative files inside the repository (no absolute or .. paths, no symlinks); content from outside the repository must come through stdin (--body - or --operations-file -). delete_entity accepts no body.",
  expectedHash: "digestJson({ body }) of the file's current UTF-8 contents, not sha256sum of the file. Read it with `archctx hash --path <file>`; use `missing` (the create default) for a new file.",
  drafts: "A draft is cached in the workspace local SQLite cache until applied. Planning the same --id again replaces it.",
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
    const validation = validateJsonSchema(PLAN_OPERATIONS_SCHEMA, parsed);
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
 * reported as a retryable runtime outage. Typed producer failures retain their contract; other
 * throws keep the existing runtime-outage fallback.
 */
function cliFailureEnvelope(error: unknown): JsonEnvelope | FailureEnvelope {
  if (error instanceof CliUsageError) return errorEnvelope("cli", "AC_SCHEMA_INVALID", error.message);
  if (error instanceof FailureError) return toEnvelope("cli", error, "cli");
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
  } else if (command === "projection" && args[0] === "publish" && args.includes("--follow") && preflightCliArguments(command, args) === undefined) {
    process.exitCode = await runProjectionPublishFollowEntry(args.slice(1), process.cwd());
  } else {
    const result = await runCli(command, args, process.cwd()).catch(cliFailureEnvelope);
    process.stdout.write(`${renderResult(result, command === "export" && args[0] === "native" ? "json" : readFlag(args, "--format") ?? "json")}\n`);
    if (result.ok === false) process.exitCode = 1;
    if (command === "validate" && result.ok && (result.data as { valid?: boolean } | undefined)?.valid === false) process.exitCode = 1;
    if (command === "resolve") process.exitCode = resolveCommandExitCode(result);
  }
}
