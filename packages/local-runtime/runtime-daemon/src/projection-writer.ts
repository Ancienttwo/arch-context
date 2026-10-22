import { execFile, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { assertLocalEgressAllowed, LocalEgressPolicyError, withLocalEgress } from "@archcontext/local-runtime/egress-admission";
import { createPrivateControlFile, readPrivateControlFile } from "@archcontext/local-runtime/control-file-security";
import { isProcessAlive } from "@archcontext/local-runtime/process-liveness";
import { acquireLocalStoreWriterOwnership } from "@archcontext/local-runtime/local-store-sqlite";
import { runtimeStatePaths } from "@archcontext/local-runtime/runtime-state-paths";
import { findRepositoryRoot, isGitRevisionArgument, isTrackedWorktreeClean } from "@archcontext/local-runtime/git-adapter";
import { agentContextProjectionTargetPaths, agentContextTextOutsideRegions, loadNativeModelFromArchContext, loadNativeModelFromModelFiles, projectionOwnedPaths, scanDocumentRegions } from "@archcontext/core/projection-engine";
import {
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH,
  PROJECTION_PR_VERIFICATION_SCHEMA_VERSION,
  PROJECTION_PUBLISH_RUN_SCHEMA_VERSION,
  PROJECTION_PUBLISH_STATUS_SCHEMA_VERSION,
  PROJECTION_REQUEST_SCHEMA_VERSION,
  PROJECTION_WRITER_BRANCH_PREFIX,
  PROJECTION_WRITER_DEFAULT_BRANCH,
  FailureError,
  errorEnvelope,
  okEnvelope,
  type ArchContextErrorCode,
  type Json,
  type JsonEnvelope,
  type ProjectionExpectedSnapshotV1,
  type ProjectionPrVerdict,
  type ProjectionPrVerificationV1,
  type ProjectionPublishHumanActionV1,
  type ProjectionPublishPullRequestV1,
  type ProjectionPublishResult,
  type ProjectionPublishRunV1,
  type ProjectionPublishStatusV1,
  type ProjectionPublisherKind,
  type ProjectionRequestV1,
  type ProjectionResultV2
} from "@archcontext/contracts";
import { publicOperationErrorEnvelope } from "./public-operation-failure";
import { agentContextProjectionDifferingPaths, runProjectionCheckInvocation, runProjectionSnapshotCommand } from "./projection-service";

/**
 * Projection writer mode (issue #379, ADR-0048). `archctx projection publish` is a client of the
 * projection protocol: it owns a detached worktree under the repository's runtime state directory,
 * resets it to the remote base tip, asks that worktree's own archctxd to apply the projection
 * (the same `projection run` an agent would send, so there is no second write path), and pushes
 * the result as exactly one commit on top of the base tip to an `archctx/*` rolling branch.
 *
 * Invariants:
 * - The writer pushes to `refs/heads/archctx/*` only, never to the base or any other ref.
 * - The pushed branch is always the base tip plus one commit, and that commit touches only paths
 *   the apply reported writing that are also projection-owned outputs (`projectionOwnedPaths`).
 * - One run per (remote, base) at a time, across every checkout of the repository (OS-backed SQLite lock).
 * - archctx stores no credentials: git uses the operator's ambient configuration, `gh` its own auth.
 */

export const PROJECTION_PUBLISH_REQUEST_ID = "projection.publish";
export const PROJECTION_PUBLISH_STATUS_REQUEST_ID = "projection.publish-status";
export const PROJECTION_VERIFY_PR_REQUEST_ID = "projection.verify-pr";
export const PROJECTION_WRITER_DEFAULT_BASE = "main";
export const PROJECTION_WRITER_DEFAULT_REMOTE = "origin";
export const PROJECTION_PR_BODY_MARKER = "<!-- archctx-projection-writer -->";

const PROJECTION_WRITER_STATE_SCHEMA_VERSION = "archcontext.projection-writer-state/v1";
const PROJECTION_WRITER_MAX_ITERATIONS = 3;
const PROJECTION_WRITER_TARGETS: ProjectionRequestV1["targets"] = ["agent-context", "architecture-docs"];
const PUBLISHER_TIMEOUT_MS = 120_000;
const PR_BODY_MAX_LISTED_PATHS = 200;

type Env = Record<string, string | undefined>;

export interface ProjectionPublisherInput {
  worktree: string;
  remote: string;
  base: string;
  branch: string;
  baseSha: string;
  commitSha: string;
  title: string;
  bodyFile: string;
}

/** Opens or updates the rolling pull request. archctx holds no credentials for it. */
export interface ProjectionPublisherPort {
  readonly kind: ProjectionPublisherKind;
  /** Stable publisher configuration identity, used only for successful-run reuse. */
  readonly identity?: string;
  ensurePullRequest(input: ProjectionPublisherInput): Promise<ProjectionPublishPullRequestV1>;
}

/** A child process call with no shell. Tests inject a fake so `gh` and publisher commands never run. */
export type ProjectionPublisherExec = (
  file: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; timeoutMs: number }
) => Promise<{ stdout: string }>;

/** One `projection run` apply against the owned worktree, through that worktree's archctxd. */
export type ProjectionWriterApplyPort = (worktree: string, request: ProjectionRequestV1) => Promise<JsonEnvelope>;

export interface ProjectionPublishOptions {
  /** Any checkout of the repository; the writer resolves its root and the shared state from it. */
  cwd: string;
  remote?: string;
  base?: string;
  branch?: string;
  publisher: ProjectionPublisherPort;
  apply: ProjectionWriterApplyPort;
  acceptObservedMajorChange?: boolean;
  /** Admission and state-root environment; git children always inherit the process environment. */
  env?: Env;
  now?: () => Date;
}

interface ProjectionWriterPaths {
  dir: string;
  baseRef: string;
  worktree: string;
  state: string;
  lock: string;
}

interface ProjectionWriterPublisherPending {
  baseSha: string;
  branch: string;
  commitSha: string;
  files: string[];
}

interface ProjectionWriterStateV1 {
  schemaVersion: typeof PROJECTION_WRITER_STATE_SCHEMA_VERSION;
  remote: string;
  base: string;
  branch: string | null;
  runSequence: number;
  lastProcessedSha: string | null;
  lastSuccessfulSha: string | null;
  lastSuccessfulCommit: string | null;
  lastSuccessfulBranch: string | null;
  lastSuccessfulPublisher: string | null;
  lastSuccessfulFiles: string[];
  publisherPending: ProjectionWriterPublisherPending | null;
  lastRun: ProjectionPublishRunV1 | null;
}

/** A typed stop inside a locked run; it becomes the run's recorded `error`. */
class ProjectionWriterFailure extends Error {
  constructor(readonly code: ArchContextErrorCode, readonly reasonCode: string, message: string) {
    super(message);
    this.name = "ProjectionWriterFailure";
  }
}

/**
 * The writer's state directory for one (remote, base): shared by every checkout of the repository,
 * because the repository state directory is keyed by the Git common dir.
 */
export function projectionWriterPaths(repositoryRoot: string, remote: string, base: string, env: Env = process.env): ProjectionWriterPaths {
  const key = createHash("sha256").update(`${remote}\0${base}`, "utf8").digest("hex").slice(0, 16);
  const dir = join(runtimeStatePaths(repositoryRoot, env).repositoryStateDir, "projection-writer", key);
  return { dir, baseRef: `refs/archctx/projection-writer/${key}/base`, worktree: join(dir, "worktree"), state: join(dir, "state.json"), lock: join(dir, "lock") };
}

// ---------------------------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------------------------

/**
 * `archctx projection publish`, one shot: validate, take the single-flight lock, then evaluate the
 * remote base tip (latest wins, same-SHA no-op) and publish. Every result except `failed` is an
 * `ok` envelope; `failed` is `ok: false` with the run as `data` and its error code.
 */
export async function runProjectionPublishCommand(options: ProjectionPublishOptions): Promise<JsonEnvelope> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const remote = options.remote ?? PROJECTION_WRITER_DEFAULT_REMOTE;
  const base = options.base ?? PROJECTION_WRITER_DEFAULT_BASE;
  const branch = options.branch ?? PROJECTION_WRITER_DEFAULT_BRANCH;
  let repositoryRoot: string;
  try {
    repositoryRoot = findRepositoryRoot(options.cwd);
  } catch {
    return errorEnvelope(PROJECTION_PUBLISH_REQUEST_ID, "AC_REPO_NOT_FOUND", `projection publish requires a Git worktree at ${options.cwd}`, "git-worktree-required");
  }
  const invalid = projectionWriterTargetIssue(repositoryRoot, { remote, base, branch });
  if (invalid) return errorEnvelope(PROJECTION_PUBLISH_REQUEST_ID, "AC_SCHEMA_INVALID", invalid, "projection-writer-input-invalid");
  try {
    assertLocalEgressAllowed("projection-publishing", env);
  } catch (error) {
    return errorEnvelope(PROJECTION_PUBLISH_REQUEST_ID, "AC_POLICY_VIOLATION", errorMessage(error), "egress-policy-denied");
  }

  const startedAt = now().toISOString();
  const paths = projectionWriterPaths(repositoryRoot, remote, base, env);
  const blank = (): ProjectionPublishRunV1 => ({
    schemaVersion: PROJECTION_PUBLISH_RUN_SCHEMA_VERSION,
    result: "failed",
    remote,
    base,
    branch,
    baseSha: null,
    publishedCommit: null,
    pushed: false,
    pullRequest: null,
    publisher: options.publisher.kind,
    files: [],
    projectionStatus: null,
    humanActions: [],
    error: null,
    startedAt,
    finishedAt: startedAt,
    iterations: 0
  });

  let lock: { kind: "acquired"; record: string; release(): void } | { kind: "busy"; pid: number };
  try {
    mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    lock = acquireProjectionWriterLock(paths.lock, startedAt);
  } catch (error) {
    const failure = asWriterFailure(error);
    return projectionPublishEnvelope({ ...blank(), finishedAt: now().toISOString(), error: writerError(failure) });
  }
  // A live owner is running this (remote, base) right now; its run owns the state file.
  if (lock.kind === "busy") {
    return projectionPublishEnvelope({ ...blank(), result: "busy", holderPid: lock.pid, finishedAt: now().toISOString() });
  }

  try {
    let state: ProjectionWriterStateV1;
    try {
      state = readProjectionWriterState(paths.state, remote, base);
    } catch (error) {
      // A state file archctx cannot read is left in place for the operator (runbook: delete the writer directory).
      return projectionPublishEnvelope({ ...blank(), finishedAt: now().toISOString(), error: writerError(asWriterFailure(error)) });
    }
    const outcome = await runLockedProjectionPublish({ options, env, now, repositoryRoot, paths, remote, base, branch, state, assertOwner: () => assertProjectionWriterOwner(paths.lock, lock.record), blank: blank() });
    const next = nextProjectionWriterState(state, outcome);
    try {
      writeProjectionWriterState(paths.state, next);
    } catch (error) {
      return projectionPublishEnvelope({
        ...outcome.run,
        result: "failed",
        error: writerError(new ProjectionWriterFailure("AC_PRECONDITION_FAILED", "projection-writer-state-unwritable", errorMessage(error)))
      });
    }
    return projectionPublishEnvelope(outcome.run);
  } finally {
    lock.release();
  }
}

interface LockedRunInput {
  options: ProjectionPublishOptions;
  env: Env;
  now: () => Date;
  repositoryRoot: string;
  paths: ProjectionWriterPaths;
  remote: string;
  base: string;
  branch: string;
  state: ProjectionWriterStateV1;
  blank: ProjectionPublishRunV1;
  assertOwner(): void;
}

interface LockedRunOutcome {
  publisherIdentity: string;
  run: ProjectionPublishRunV1;
  runSequence: number;
  /** The publish is pushed but its publisher failed: a rerun at the same base retries the publisher only. */
  publisherPending?: ProjectionWriterPublisherPending;
}

async function runLockedProjectionPublish(input: LockedRunInput): Promise<LockedRunOutcome> {
  const { options, env, now, repositoryRoot, paths, remote, base, branch, state } = input;
  const runSequence = state.runSequence + 1;
  const publisherIdentity = options.publisher.identity ?? options.publisher.kind;
  let iterations = 0;
  let baseSha: string | null = null;
  const finish = (result: ProjectionPublishResult, fields: Partial<ProjectionPublishRunV1> = {}, extra: Partial<LockedRunOutcome> = {}): LockedRunOutcome => ({
    run: { ...input.blank, ...fields, result, baseSha, iterations, finishedAt: now().toISOString() },
    runSequence,
    publisherIdentity,
    ...extra
  });
  const failed = (failure: ProjectionWriterFailure, fields: Partial<ProjectionPublishRunV1> = {}, extra: Partial<LockedRunOutcome> = {}) =>
    finish("failed", { ...fields, error: writerError(failure) }, extra);

  try {
    const pushRemote = projectionWriterPushUrl(repositoryRoot, remote);
    const fetchUrls = git(repositoryRoot, ["remote", "get-url", "--all", "--", remote]).trim().split("\n").filter(Boolean);
    const tracksPublication = fetchUrls.length === 1 && fetchUrls[0] === pushRemote;
    while (iterations < PROJECTION_WRITER_MAX_ITERATIONS) {
      iterations += 1;
      // 1. The publication base has one source. Refresh the fetch-side cache only for that same URL.
      remoteGit(repositoryRoot, ["fetch", "--no-tags", "--no-write-fetch-head", "--", pushRemote,
        `+refs/heads/${base}:${paths.baseRef}`,
        ...(tracksPublication ? [`+refs/heads/${base}:refs/remotes/${remote}/${base}`] : [])], env);
      baseSha = git(repositoryRoot, ["rev-parse", "--verify", `${paths.baseRef}^{commit}`]).trim();

      const successMatches = state.lastSuccessfulBranch === branch && state.lastSuccessfulSha === baseSha;
      const pending = state.publisherPending?.branch === branch && state.publisherPending.baseSha === baseSha
        ? state.publisherPending
        : successMatches && state.lastSuccessfulCommit && state.lastSuccessfulPublisher !== publisherIdentity
          ? { branch, baseSha, commitSha: state.lastSuccessfulCommit, files: state.lastSuccessfulFiles }
          : null;
      // A pending publisher is recovered before any success-cache decision. A failed branch switch
      // never changes the identity attached to the last successful result.
      if (!pending && successMatches && state.lastSuccessfulPublisher === publisherIdentity
        && (state.lastSuccessfulCommit === null || lsRemoteBranch(repositoryRoot, pushRemote, branch, env) === state.lastSuccessfulCommit)) {
        return finish("already-processed", { publishedCommit: state.lastSuccessfulCommit });
      }

      input.assertOwner();
      prepareProjectionWriterWorktree(repositoryRoot, paths.worktree, baseSha);
      if (pending && lsRemoteBranch(repositoryRoot, pushRemote, branch, env) === pending.commitSha) {
        input.assertOwner();
        const published = await publishPullRequest(options.publisher, { worktree: paths.worktree, remote, base, branch, baseSha, commitSha: pending.commitSha, files: pending.files });
        if (!published.ok) {
          return failed(published.failure, { publishedCommit: pending.commitSha, files: pending.files }, { publisherPending: pending });
        }
        return finish("published", { publishedCommit: pending.commitSha, files: pending.files, pullRequest: published.pullRequest });
      }

      // 3. Apply through the owned worktree's daemon.
      const ownedPatterns = projectionOwnedPaths(loadNativeModelFromArchContext(paths.worktree));
      const snapshot = runProjectionSnapshotCommand(paths.worktree);
      if (!snapshot.ok) throw envelopeFailure(snapshot, "projection-writer-snapshot-failed");
      const expected = (snapshot.data as unknown as { expected: ProjectionExpectedSnapshotV1 }).expected;
      const request: ProjectionRequestV1 = {
        schemaVersion: PROJECTION_REQUEST_SCHEMA_VERSION,
        requestId: `projection_publish.${baseSha.slice(0, 12)}.${runSequence}-${iterations}`,
        profile: "repo-harness/v1",
        mode: "apply",
        targets: [...PROJECTION_WRITER_TARGETS],
        changedPaths: [],
        expected,
        ...(options.acceptObservedMajorChange ? { acceptObservedMajorChange: true as const } : {})
      };
      const applied = await options.apply(paths.worktree, request);
      input.assertOwner();
      if (!applied.ok) {
        const failure = envelopeFailure(applied, "projection-apply-failed");
        if (failure.code === "AC_CODE_FACTS_UNAVAILABLE") {
          throw new ProjectionWriterFailure(failure.code, failure.reasonCode,
            `${failure.message}; the writer never initializes CodeGraph itself: run \`codegraph init ${paths.worktree}\` once, then publish again`);
        }
        throw failure;
      }
      const result = applied.data as unknown as ProjectionResultV2;
      const projectionStatus = result.status;
      if (projectionStatus === "human-action-required" || projectionStatus === "adoption-required") {
        return finish("human-action-required", { projectionStatus, humanActions: publishHumanActions(result) });
      }
      if (!["noop", "applied", "applied-partial"].includes(projectionStatus)) {
        throw new ProjectionWriterFailure("AC_PRECONDITION_FAILED", "projection-apply-status-unsupported", `projection apply ended with status ${projectionStatus}; the writer publishes only noop, applied and applied-partial results`);
      }

      // 4. Every changed path must be a file the apply wrote and a projection-owned output.
      const changed = worktreeChangedPaths(paths.worktree);
      if (changed.length === 0) {
        // A no-op proves freshness only for the tip we rendered. The base can advance
        // during apply even when there is no commit to send through the pre-push fence.
        const tip = lsRemoteBranch(repositoryRoot, pushRemote, base, env);
        if (tip === null) {
          return failed(new ProjectionWriterFailure("AC_PRECONDITION_FAILED", "projection-writer-base-missing", `${remote} has no branch ${base}`), { projectionStatus });
        }
        if (tip !== baseSha) continue;
        return finish("up-to-date", { projectionStatus });
      }
      const written = new Set(result.files.filter((file) => file.action !== "unchanged").map((file) => file.path));
      const offending = changed.filter((path) => !written.has(path) || !isProjectionOwnedPath(path, ownedPatterns));
      if (offending.length > 0) {
        return failed(new ProjectionWriterFailure("AC_POLICY_VIOLATION", "projection-writer-non-owned-change",
          `projection apply changed paths the writer may not publish: ${offending.join(", ")}`), { projectionStatus });
      }

      // 5. One commit on top of the base tip.
      input.assertOwner();
      git(paths.worktree, ["add", "-A", "--", ...changed]);
      const title = projectionPublishTitle(base, baseSha);
      try {
        git(paths.worktree, ["commit", "--no-verify", "-q", "-m", title, "-m", `Archctx-Projection-Source: ${baseSha}`]);
      } catch (error) {
        return failed(new ProjectionWriterFailure("AC_PRECONDITION_FAILED", "projection-writer-commit-failed",
          `git commit failed in the writer worktree; configure a git identity (user.name, user.email) for the repository or set GIT_AUTHOR_*/GIT_COMMITTER_*: ${errorMessage(error)}`), { projectionStatus, files: changed });
      }
      const commitSha = git(paths.worktree, ["rev-parse", "HEAD"]).trim();

      // 6. Latest wins: never push a projection of a base tip that has already moved.
      const tip = lsRemoteBranch(repositoryRoot, pushRemote, base, env);
      if (tip === null) {
        return failed(new ProjectionWriterFailure("AC_PRECONDITION_FAILED", "projection-writer-base-missing", `${remote} has no branch ${base}`), { projectionStatus, files: changed });
      }
      if (tip !== baseSha) continue;

      // 7. Push the rolling branch, unless it already carries this exact tree on this base.
      const lease = lsRemoteBranch(repositoryRoot, pushRemote, branch, env);
      let publishedCommit = commitSha;
      let pushed = false;
      if (lease !== null && carriesSameProjection(paths.worktree, lease, commitSha, baseSha)) {
        publishedCommit = lease;
      } else {
        input.assertOwner();
        remoteGit(paths.worktree, ["push", "--no-verify", `--force-with-lease=refs/heads/${branch}:${lease ?? ""}`, "--", pushRemote, `${commitSha}:refs/heads/${branch}`], env);
        pushed = true;
      }

      // 8. Pull request.
      input.assertOwner();
      const published = await publishPullRequest(options.publisher, { worktree: paths.worktree, remote, base, branch, baseSha, commitSha: publishedCommit, files: changed });
      if (!published.ok) {
        const pendingPublish = { baseSha, branch, commitSha: publishedCommit, files: changed };
        return failed(published.failure, { projectionStatus, files: changed, publishedCommit, pushed }, { publisherPending: pendingPublish });
      }
      return finish("published", { projectionStatus, files: changed, publishedCommit, pushed, pullRequest: published.pullRequest });
    }
    return failed(new ProjectionWriterFailure("AC_PRECONDITION_FAILED", "projection-writer-base-unstable",
      `${remote}/${base} moved during each of ${PROJECTION_WRITER_MAX_ITERATIONS} attempts; nothing was pushed`));
  } catch (error) {
    return failed(asWriterFailure(error));
  }
}

function nextProjectionWriterState(state: ProjectionWriterStateV1, outcome: LockedRunOutcome): ProjectionWriterStateV1 {
  const run = outcome.run;
  const next: ProjectionWriterStateV1 = { ...state, branch: run.branch, runSequence: outcome.runSequence, lastRun: run };
  if (run.result === "already-processed") return next;
  if (run.baseSha !== null) next.lastProcessedSha = run.baseSha;
  if (run.result === "published" || run.result === "up-to-date") {
    next.lastSuccessfulSha = run.baseSha;
    next.lastSuccessfulBranch = run.branch;
    next.lastSuccessfulPublisher = outcome.publisherIdentity;
    next.lastSuccessfulFiles = run.files;
    next.lastSuccessfulCommit = run.result === "published" ? run.publishedCommit : null;
    next.publisherPending = null;
  } else if (outcome.publisherPending) {
    next.publisherPending = outcome.publisherPending;
  } else if (run.result === "human-action-required") {
    next.publisherPending = null;
  }
  return next;
}

function projectionPublishEnvelope(run: ProjectionPublishRunV1): JsonEnvelope {
  if (run.result !== "failed") return okEnvelope(PROJECTION_PUBLISH_REQUEST_ID, run as unknown as Json);
  const error = run.error ?? { code: "AC_UNCLASSIFIED_FAILURE", message: "projection publish failed" };
  return {
    ...errorEnvelope(PROJECTION_PUBLISH_REQUEST_ID, error.code as ArchContextErrorCode, error.message, error.reasonCode),
    data: run as unknown as Json
  };
}

function publishHumanActions(result: ProjectionResultV2): ProjectionPublishHumanActionV1[] {
  return result.humanActions.map((action) => ({ reasonCode: action.reasonCode, ...(action.path ? { path: action.path } : {}) }));
}

export function projectionPublishTitle(base: string, baseSha: string): string {
  return `chore(projection): refresh generated architecture outputs for ${base}@${baseSha.slice(0, 12)}`;
}

/** The pull request body: paths only, never file contents. */
export function projectionPublishBody(input: { base: string; baseSha: string; commitSha: string; files: string[] }): string {
  const listed = input.files.slice(0, PR_BODY_MAX_LISTED_PATHS).map((path) => `- \`${path}\``);
  if (input.files.length > PR_BODY_MAX_LISTED_PATHS) listed.push(`- … and ${input.files.length - PR_BODY_MAX_LISTED_PATHS} more`);
  return [
    PROJECTION_PR_BODY_MARKER,
    "",
    `Base: \`${input.base}\` at \`${input.baseSha}\``,
    `Commit: \`${input.commitSha}\``,
    "",
    "Changed generated paths:",
    "",
    ...listed,
    "",
    `Generated by \`archctx projection publish\`; touches generated paths only. Verify with \`archctx projection verify-pr --base ${input.base}\`.`,
    ""
  ].join("\n");
}

async function publishPullRequest(
  publisher: ProjectionPublisherPort,
  input: { worktree: string; remote: string; base: string; branch: string; baseSha: string; commitSha: string; files: string[] }
): Promise<{ ok: true; pullRequest: ProjectionPublishPullRequestV1 | null } | { ok: false; failure: ProjectionWriterFailure }> {
  if (publisher.kind === "none") return { ok: true, pullRequest: null };
  const dir = mkdtempSync(join(tmpdir(), "archctx-projection-pr-body-"));
  try {
    const bodyFile = join(dir, "body.md");
    writeFileSync(bodyFile, projectionPublishBody(input), { mode: 0o600 });
    const pullRequest = await publisher.ensurePullRequest({
      worktree: input.worktree,
      remote: input.remote,
      base: input.base,
      branch: input.branch,
      baseSha: input.baseSha,
      commitSha: input.commitSha,
      title: projectionPublishTitle(input.base, input.baseSha),
      bodyFile
    });
    return { ok: true, pullRequest: { ...(pullRequest.url ? { url: pullRequest.url } : {}), ...(pullRequest.number !== undefined ? { number: pullRequest.number } : {}) } };
  } catch (error) {
    if (error instanceof LocalEgressPolicyError) return { ok: false, failure: new ProjectionWriterFailure("AC_POLICY_VIOLATION", "egress-policy-denied", error.message) };
    return { ok: false, failure: new ProjectionWriterFailure("AC_PRECONDITION_FAILED", "projection-publisher-failed", `${publisher.kind} publisher failed: ${errorMessage(error)}`) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// publish-status
// ---------------------------------------------------------------------------------------------

/** `archctx projection publish-status`: the writer state for one (remote, base). Read-only. */
export function runProjectionPublishStatusCommand(options: { cwd: string; remote?: string; base?: string; env?: Env }): JsonEnvelope {
  const env = options.env ?? process.env;
  const remote = options.remote ?? PROJECTION_WRITER_DEFAULT_REMOTE;
  const base = options.base ?? PROJECTION_WRITER_DEFAULT_BASE;
  let repositoryRoot: string;
  try {
    repositoryRoot = findRepositoryRoot(options.cwd);
  } catch {
    return errorEnvelope(PROJECTION_PUBLISH_STATUS_REQUEST_ID, "AC_REPO_NOT_FOUND", `projection publish-status requires a Git worktree at ${options.cwd}`, "git-worktree-required");
  }
  const invalid = refNameIssue(repositoryRoot, "--base", base) ?? remoteNameIssue(remote);
  if (invalid) return errorEnvelope(PROJECTION_PUBLISH_STATUS_REQUEST_ID, "AC_SCHEMA_INVALID", invalid, "projection-writer-input-invalid");
  try {
    const paths = projectionWriterPaths(repositoryRoot, remote, base, env);
    const state = readProjectionWriterState(paths.state, remote, base);
    const holder = readProjectionWriterLock(paths.lock);
    const status: ProjectionPublishStatusV1 = {
      schemaVersion: PROJECTION_PUBLISH_STATUS_SCHEMA_VERSION,
      remote,
      base,
      branch: state.branch,
      worktreePath: paths.worktree,
      running: holder && isProcessAlive(holder.pid) ? holder : null,
      lastProcessedSha: state.lastProcessedSha,
      lastSuccessfulSha: state.lastSuccessfulSha,
      lastRun: state.lastRun
    };
    return okEnvelope(PROJECTION_PUBLISH_STATUS_REQUEST_ID, status as unknown as Json);
  } catch (error) {
    if (error instanceof ProjectionWriterFailure) return errorEnvelope(PROJECTION_PUBLISH_STATUS_REQUEST_ID, error.code, error.message, error.reasonCode);
    return publicOperationErrorEnvelope(PROJECTION_PUBLISH_STATUS_REQUEST_ID, error);
  }
}

// ---------------------------------------------------------------------------------------------
// --follow
// ---------------------------------------------------------------------------------------------

/**
 * The foreground `--follow` loop: one one-shot publish per interval until stopped. It has no
 * scheduler of its own beyond this sleep, so launchd/systemd `KeepAlive` can own its lifetime.
 * Returns the number of runs it made.
 */
export async function runProjectionPublishFollow(options: {
  runOnce: () => Promise<JsonEnvelope>;
  intervalMs: number;
  sleep: (ms: number) => Promise<void>;
  shouldStop: () => boolean;
  onResult: (envelope: JsonEnvelope) => void;
}): Promise<number> {
  let runs = 0;
  while (!options.shouldStop()) {
    let envelope: JsonEnvelope;
    try {
      envelope = await options.runOnce();
    } catch (error) {
      envelope = publicOperationErrorEnvelope(PROJECTION_PUBLISH_REQUEST_ID, error);
    }
    runs += 1;
    options.onResult(envelope);
    if (options.shouldStop()) break;
    await options.sleep(options.intervalMs);
  }
  return runs;
}

// ---------------------------------------------------------------------------------------------
// verify-pr
// ---------------------------------------------------------------------------------------------

export type ProjectionVerifyPrCheckPort = (request: ProjectionRequestV1, root: string) => JsonEnvelope;

/**
 * `archctx projection verify-pr --base <ref>`: does the checked-out pull request (HEAD) change
 * generated projection output only, and is that output exactly what the projection renders? A
 * path is generated only when it is the projection manifest, a manifest target or an agent-context
 * target at HEAD or at the merge base; a mixed-ownership target also needs its text outside the
 * generated regions unchanged. Any other change is answered from the diff alone, with no render.
 *
 * This is deliberately narrower than `projectionOwnedPaths` (the writer's commit filter): that
 * glob covers all of `docs/architecture/**`, where hand-written documents the renderer never
 * touches also live, and whose edits a `check` would never see.
 */
export function runProjectionVerifyPrCommand(options: { cwd: string; base: string; check?: ProjectionVerifyPrCheckPort }): JsonEnvelope {
  const requestId = PROJECTION_VERIFY_PR_REQUEST_ID;
  let root: string;
  try {
    root = findRepositoryRoot(options.cwd);
  } catch {
    return errorEnvelope(requestId, "AC_REPO_NOT_FOUND", `projection verify-pr requires a Git worktree at ${options.cwd}`, "git-worktree-required");
  }
  if (!isGitRevisionArgument(options.base)) return errorEnvelope(requestId, "AC_SCHEMA_INVALID", `projection verify-pr --base is not a usable revision: ${JSON.stringify(options.base)}`, "projection-verify-pr-input-invalid");
  try {
    if (!isTrackedWorktreeClean(root)) {
      return errorEnvelope(requestId, "AC_PRECONDITION_FAILED", "projection verify-pr requires a clean tracked worktree; HEAD is the pull request head", "projection-verify-pr-worktree-dirty");
    }
    let baseSha: string;
    let mergeBase: string;
    const headSha = git(root, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
    try {
      baseSha = git(root, ["rev-parse", "--verify", `${options.base}^{commit}`]).trim();
      mergeBase = git(root, ["merge-base", baseSha, headSha]).trim();
    } catch (error) {
      return errorEnvelope(requestId, "AC_PRECONDITION_FAILED", `projection verify-pr cannot resolve ${options.base} against HEAD: ${errorMessage(error)}`, "projection-verify-pr-base-unresolved");
    }
    // No rename detection: a rename out of a non-generated path must report that path too.
    const changedPaths = [...new Set(git(root, ["diff", "--name-only", "-z", "--no-renames", `${mergeBase}..${headSha}`, "--"]).split("\0").filter(Boolean))].sort();
    const verification = (fields: Partial<ProjectionPrVerificationV1> & { verdict: ProjectionPrVerdict }): JsonEnvelope => okEnvelope(requestId, {
      schemaVersion: PROJECTION_PR_VERIFICATION_SCHEMA_VERSION,
      base: options.base,
      baseSha,
      headSha,
      mergeBase,
      changedPaths,
      nonGeneratedPaths: [],
      humanEditedPaths: [],
      generatedOnly: false,
      renderEquivalent: null,
      differingPaths: [],
      projectionStatus: null,
      ...fields
    } satisfies ProjectionPrVerificationV1 as unknown as Json);
    if (changedPaths.length === 0) return verification({ verdict: "no-changes" });
    const classified = classifyPullRequestPaths(root, mergeBase, headSha, changedPaths);
    if (classified.nonGeneratedPaths.length > 0) {
      return verification({ verdict: "touches-non-generated", nonGeneratedPaths: classified.nonGeneratedPaths, humanEditedPaths: classified.humanEditedPaths });
    }

    const snapshot = runProjectionSnapshotCommand(root);
    if (!snapshot.ok) return { ...snapshot, requestId };
    const request: ProjectionRequestV1 = {
      schemaVersion: PROJECTION_REQUEST_SCHEMA_VERSION,
      requestId: `projection_verify_pr.${headSha.slice(0, 12)}`,
      profile: "repo-harness/v1",
      mode: "check",
      targets: [...PROJECTION_WRITER_TARGETS],
      changedPaths: [],
      expected: (snapshot.data as unknown as { expected: ProjectionExpectedSnapshotV1 }).expected
    };
    const checked = (options.check ?? runProjectionCheckInvocation)(request, root);
    if (!checked.ok) return { ...checked, requestId };
    const result = checked.data as unknown as ProjectionResultV2;
    // `check` renders the architecture documentation only; a changed agent-context file is compared
    // with the agent-context render, so its generated region is proven too.
    let agentContextDiffering: string[];
    try {
      agentContextDiffering = agentContextProjectionDifferingPaths(root, classified.agentContextPaths);
    } catch {
      // A contract file whose region the render refuses (for example a tampered marker digest) is not rendered output.
      agentContextDiffering = [...classified.agentContextPaths];
    }
    const differingPaths = [...new Set([
      ...result.files.filter((file) => file.action !== "unchanged").map((file) => file.path),
      ...agentContextDiffering
    ])].sort();
    const renderEquivalent = result.status === "noop" && agentContextDiffering.length === 0;
    return verification({
      verdict: renderEquivalent ? "generated-only-render-equivalent" : "generated-only-not-render-equivalent",
      generatedOnly: true,
      renderEquivalent,
      differingPaths,
      projectionStatus: result.status
    });
  } catch (error) {
    return publicOperationErrorEnvelope(requestId, error);
  }
}


type PullRequestTargetOwnership = { whole: boolean; mixedDocument: boolean; agentNodeIds: string[] };

/**
 * Splits the changed paths into generated outputs and everything else. Mixed-ownership targets are
 * generated only when their text outside the generated regions is byte-identical between the merge
 * base and HEAD, parsed with the projection's own region readers; an added or deleted mixed target,
 * or one whose regions cannot be delimited, counts as a human edit (conservative by design).
 *
 * A path that is a target only at the merge base (no HEAD manifest row, no HEAD agent-context
 * target) is generated only when HEAD deletes it: HEAD's render never looks at a file it no longer
 * targets, so a rewrite of such a file would otherwise pass as render-equivalent.
 */
function classifyPullRequestPaths(root: string, mergeBase: string, headSha: string, changedPaths: readonly string[]): { nonGeneratedPaths: string[]; humanEditedPaths: string[]; agentContextPaths: string[] } {
  const baseTargets = projectionTargetsAtRevision(root, mergeBase);
  const headTargets = projectionTargetsAtRevision(root, headSha);
  const nonGenerated: string[] = [];
  const humanEdited: string[] = [];
  const agentContext: string[] = [];
  for (const path of changedPaths) {
    if (path === ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH) continue;
    const atBase = baseTargets.get(path);
    const atHead = headTargets.get(path);
    if (!atBase && !atHead) { nonGenerated.push(path); continue; }
    const before = readFileAtRevision(root, mergeBase, path);
    const after = readFileAtRevision(root, headSha, path);
    if (!atHead && after !== null) { nonGenerated.push(path); continue; }
    const target: PullRequestTargetOwnership = {
      whole: (atBase?.whole ?? false) || (atHead?.whole ?? false),
      mixedDocument: (atBase?.mixedDocument ?? false) || (atHead?.mixedDocument ?? false),
      agentNodeIds: [...new Set([...(atBase?.agentNodeIds ?? []), ...(atHead?.agentNodeIds ?? [])])].sort()
    };
    if (!target.mixedDocument && target.agentNodeIds.length === 0) continue;
    if (!mixedTargetTextUnchanged(before, after, target)) {
      humanEdited.push(path);
      nonGenerated.push(path);
    } else if (target.agentNodeIds.length > 0) {
      agentContext.push(path);
    }
  }
  return { nonGeneratedPaths: nonGenerated.sort(), humanEditedPaths: humanEdited.sort(), agentContextPaths: agentContext.sort() };
}

/** Manifest target rows and agent-context target paths at one revision; an unreadable side contributes nothing. */
function projectionTargetsAtRevision(root: string, revision: string): Map<string, PullRequestTargetOwnership> {
  const targets = new Map<string, PullRequestTargetOwnership>();
  const add = (path: string, ownership: Partial<PullRequestTargetOwnership>) => {
    const known = targets.get(path) ?? { whole: false, mixedDocument: false, agentNodeIds: [] };
    targets.set(path, {
      whole: known.whole || ownership.whole === true,
      mixedDocument: known.mixedDocument || ownership.mixedDocument === true,
      agentNodeIds: [...known.agentNodeIds, ...(ownership.agentNodeIds ?? [])]
    });
  };
  try {
    const manifest = readFileAtRevision(root, revision, ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH);
    const rows = manifest === null ? {} : (JSON.parse(manifest) as { targets?: unknown }).targets;
    if (rows && typeof rows === "object" && !Array.isArray(rows)) {
      for (const row of Object.values(rows as Record<string, { path?: unknown; ownership?: unknown }>)) {
        if (!row || typeof row.path !== "string") continue;
        // Anything but whole-file `generated` is compared as mixed: unknown ownership is never trusted.
        add(row.path, row.ownership === "generated" ? { whole: true } : { mixedDocument: true });
      }
    }
  } catch {
    // An unreadable manifest names no target on this side; its paths stay non-generated.
  }
  try {
    const listed = git(root, ["ls-tree", "-r", "-z", "--name-only", revision, "--", ".archcontext/model"]).split("\0").filter(Boolean);
    const files = new Map(listed.map((path) => [path, readFileAtRevision(root, revision, path) ?? ""] as const));
    for (const target of agentContextProjectionTargetPaths(loadNativeModelFromModelFiles(files))) add(target.path, { agentNodeIds: [target.nodeId] });
  } catch {
    // A model that does not load at this revision designates no agent-context target on this side.
  }
  return targets;
}

function mixedTargetTextUnchanged(before: string | null, after: string | null, target: PullRequestTargetOwnership): boolean {
  if (before === null || after === null) return false;
  try {
    return JSON.stringify(textOutsideGeneratedRegions(before, target)) === JSON.stringify(textOutsideGeneratedRegions(after, target));
  } catch {
    return false;
  }
}

/** The human-owned slices of a mixed target, in order; throws when its regions cannot be delimited. */
function textOutsideGeneratedRegions(body: string, target: PullRequestTargetOwnership): string[] {
  const text = target.agentNodeIds.length > 0 ? agentContextTextOutsideRegions(body, target.agentNodeIds) : body;
  if (!target.mixedDocument) return [text];
  const scan = scanDocumentRegions(text);
  if (scan.diagnostics.length > 0 || scan.generatedRegions.some((region) => !region.closed)) throw new Error("projection-generated-regions-unbalanced");
  return scan.humanRegions.map((region) => region.text);
}

/** The bytes of `path` at `revision` as UTF-8 text, or null when the path is absent there. */
function readFileAtRevision(root: string, revision: string, path: string): string | null {
  if (!gitSucceeds(root, ["cat-file", "-e", `${revision}:${path}`])) return null;
  return git(root, ["cat-file", "blob", `${revision}:${path}`]);
}

// ---------------------------------------------------------------------------------------------
// publishers
// ---------------------------------------------------------------------------------------------

export function createNoneProjectionPublisher(): ProjectionPublisherPort {
  return { kind: "none", ensurePullRequest: async () => ({}) };
}

/**
 * The default publisher: the operator's own `gh` (ambient `gh auth`), no shell, run in the owned
 * worktree. An open pull request from the rolling branch is edited, otherwise one is created.
 */
export function createGhProjectionPublisher(options: { exec?: ProjectionPublisherExec; env?: Env; timeoutMs?: number } = {}): ProjectionPublisherPort {
  const exec = options.exec ?? nodeProjectionPublisherExec;
  const admissionEnv = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? PUBLISHER_TIMEOUT_MS;
  return {
    kind: "gh",
    async ensurePullRequest(input) {
      assertLocalEgressAllowed("projection-publishing", admissionEnv);
      const repository = projectionPublisherRepository(input.worktree, input.remote);
      const env: Record<string, string> = { ...stringEnv(process.env), GH_PROMPT_DISABLED: "1" };
      delete env.GH_REPO;
      const gh = (args: string[]) => withLocalEgress("projection-publishing", () => exec("gh", [...args, "--repo", repository], { cwd: input.worktree, env, timeoutMs }), admissionEnv);
      const listed = await gh(["pr", "list", "--head", input.branch, "--base", input.base, "--state", "open", "--json", "number,url,isCrossRepository,headRefName,baseRefName", "--limit", "100"]);
      const open = parseGhPullRequestList(listed.stdout, input.branch, input.base);
      if (open) {
        await gh(["pr", "edit", String(open.number), "--title", input.title, "--body-file", input.bodyFile]);
        return { number: open.number, ...(open.url ? { url: open.url } : {}) };
      }
      const created = await gh(["pr", "create", "--base", input.base, "--head", input.branch, "--title", input.title, "--body-file", input.bodyFile]);
      const url = created.stdout.trim().split("\n").map((line) => line.trim()).filter(Boolean).pop() ?? "";
      const number = /\/pull\/(\d+)(?:[/?#]|$)/.exec(url)?.[1];
      return { ...(url ? { url } : {}), ...(number ? { number: Number(number) } : {}) };
    }
  };
}

/** One publication has one destination. Use this URL for the base, lease and push. */
function projectionWriterPushUrl(worktree: string, remote: string): string {
  const urls = git(worktree, ["remote", "get-url", "--push", "--all", "--", remote]).trim().split("\n").filter(Boolean);
  if (urls.length !== 1) {
    throw new ProjectionWriterFailure("AC_SCHEMA_INVALID", "projection-writer-push-target-ambiguous", "projection publish requires exactly one push URL for the selected remote");
  }
  return urls[0]!;
}

/** Bind the PR to the one selected push repository, including fork remotes. Never infer upstream. */
function projectionPublisherRepository(worktree: string, remote: string): string {
  const source = projectionWriterPushUrl(worktree, remote);
  const scp = /^[^/@:]+@([A-Za-z0-9.-]+):([^?#]+)$/.exec(source);
  let host: string;
  let path: string;
  if (scp) { host = scp[1]!; path = scp[2]!; }
  else {
    const url = new URL(source);
    if (!["https:", "ssh:"].includes(url.protocol) || url.search || url.hash || url.password || (url.protocol === "https:" && url.username)) {
      throw new Error("the selected remote must be an SSH or HTTPS GitHub repository URL");
    }
    host = url.protocol === "ssh:" ? url.hostname : url.host;
    path = url.pathname.replace(/^\//, "");
  }
  path = path.replace(/\.git$/, "");
  if (!/^[A-Za-z0-9.-]+(?::[0-9]+)?$/.test(host) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(path)
    || path.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("the selected remote must identify one GitHub host, owner, and repository");
  }
  return `${host.toLowerCase()}/${path}`;
}

/**
 * An operator-supplied executable: run with no shell and no arguments in the owned worktree. Its
 * optional stdout is a JSON object `{url?, number?}`; any other output is ignored. A non-zero exit
 * is a failure.
 *
 * The child environment is PATH, HOME and the `ARCHCTX_PUBLISH_*` inputs only. On Windows it also
 * carries, when present, the variables a Windows process needs to start (SystemRoot, windir,
 * ComSpec, PATHEXT, TEMP, TMP, USERPROFILE), matched case-insensitively with the first spelling
 * forwarded.
 *
 * Windows cannot execute a `#!` script directly, so on win32 a command whose first line is a
 * shebang runs as `<interpreter> [interpreter args] <command>`: the interpreter is the basename of
 * the shebang's first token (without `.exe`), or the following token for `/usr/bin/env`, and it is
 * resolved on PATH; an interpreter that cannot be found is a clear failure, never a search of
 * other locations. A command without a shebang runs directly. `.cmd`/`.bat` commands are rejected
 * on Windows because they only run through cmd.exe, which would reintroduce a shell.
 */
export function createCommandProjectionPublisher(options: {
  command: string;
  exec?: ProjectionPublisherExec;
  env?: Env;
  sourceEnv?: Env;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
}): ProjectionPublisherPort {
  const exec = options.exec ?? nodeProjectionPublisherExec;
  const admissionEnv = options.env ?? process.env;
  const sourceEnv = options.sourceEnv ?? process.env;
  const platform = options.platform ?? process.platform;
  const timeoutMs = options.timeoutMs ?? PUBLISHER_TIMEOUT_MS;
  return {
    kind: "command",
    identity: `command:${resolve(options.command)}`,
    async ensurePullRequest(input) {
      const env: Record<string, string> = {
        ...commandPublisherBaseEnv(sourceEnv, platform),
        ARCHCTX_PUBLISH_REMOTE: input.remote,
        ARCHCTX_PUBLISH_BASE: input.base,
        ARCHCTX_PUBLISH_BRANCH: input.branch,
        ARCHCTX_PUBLISH_BASE_SHA: input.baseSha,
        ARCHCTX_PUBLISH_COMMIT: input.commitSha,
        ARCHCTX_PUBLISH_TITLE: input.title,
        ARCHCTX_PUBLISH_BODY_FILE: input.bodyFile
      };
      const { stdout } = await withLocalEgress("projection-publishing", async () => {
        const invocation = commandPublisherInvocation(options.command, platform);
        try {
          return await exec(invocation.file, invocation.args, { cwd: input.worktree, env, timeoutMs });
        } catch (error) {
          if (invocation.interpreter !== undefined && (error as { code?: unknown }).code === "ENOENT") {
            throw new Error(`publisher command ${options.command} needs the interpreter "${invocation.interpreter}" from its #! line, which was not found on PATH`);
          }
          throw error;
        }
      }, admissionEnv);
      return parsePublisherCommandOutput(stdout);
    }
  };
}

const COMMAND_PUBLISHER_POSIX_ENV = ["PATH", "HOME"] as const;
const COMMAND_PUBLISHER_WINDOWS_ENV = ["PATH", "HOME", "SystemRoot", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP", "USERPROFILE"] as const;

function commandPublisherBaseEnv(source: Env, platform: NodeJS.Platform): Record<string, string> {
  const env: Record<string, string> = {};
  if (platform !== "win32") {
    for (const name of COMMAND_PUBLISHER_POSIX_ENV) {
      const value = source[name];
      if (value) env[name] = value;
    }
    return env;
  }
  // Windows names are case-insensitive (`Path`, `SYSTEMROOT`, ...): match upper-cased, keep the
  // original spelling, and forward only the first spelling so the child never sees duplicates.
  const allowed = new Set<string>(COMMAND_PUBLISHER_WINDOWS_ENV.map((name) => name.toUpperCase()));
  const forwarded = new Set<string>();
  for (const [name, value] of Object.entries(source)) {
    const key = name.toUpperCase();
    if (!value || !allowed.has(key) || forwarded.has(key)) continue;
    forwarded.add(key);
    env[name] = value;
  }
  return env;
}

function commandPublisherInvocation(command: string, platform: NodeJS.Platform): { file: string; args: string[]; interpreter?: string } {
  if (platform !== "win32") return { file: command, args: [] };
  const extension = extname(command).toLowerCase();
  if (extension === ".cmd" || extension === ".bat") {
    throw new Error(`publisher command ${command} is a ${extension} script, which only runs through cmd.exe; the command publisher runs without a shell, so use an executable or a #! script`);
  }
  const firstLine = readCommandFirstLine(command);
  if (!firstLine.startsWith("#!")) return { file: command, args: [] };
  const tokens = firstLine.slice(2).trim().split(/\s+/).filter((token) => token !== "");
  if (tokens.length === 0) throw new Error(`publisher command ${command} has an empty #! line`);
  let interpreter = commandBasename(tokens[0]!);
  let interpreterArgs = tokens.slice(1);
  if (interpreter === "env") {
    const next = interpreterArgs[0];
    if (next === undefined || next.startsWith("-")) {
      throw new Error(`publisher command ${command} has an unsupported #! line "${firstLine}": /usr/bin/env must be followed by an interpreter name`);
    }
    interpreter = commandBasename(next);
    interpreterArgs = interpreterArgs.slice(1);
  }
  return { file: interpreter, args: [...interpreterArgs, command], interpreter };
}

function commandBasename(token: string): string {
  const name = token.split(/[\\/]/).pop() ?? token;
  return name.toLowerCase().endsWith(".exe") ? name.slice(0, -4) : name;
}

function readCommandFirstLine(command: string): string {
  let fd: number;
  try {
    fd = openSync(command, "r");
  } catch (error) {
    throw new Error(`publisher command ${command} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const buffer = Buffer.alloc(1024);
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, length).toString("utf8");
    const newline = head.indexOf("\n");
    return (newline === -1 ? head : head.slice(0, newline)).replace(/\r$/, "");
  } finally {
    closeSync(fd);
  }
}

function parseGhPullRequestList(stdout: string, branch: string, base: string): { number: number; url?: string } | undefined {
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) throw new Error("gh pr list returned an unexpected shape");
  // A capped response cannot prove absence or uniqueness; never mutate from incomplete evidence.
  if (parsed.length >= 100) throw new Error("gh pr list reached the 100-result limit; resolve rolling PR ambiguity manually");
  const matches: { number: number; url?: string }[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object" || Array.isArray(row)
      || typeof row.isCrossRepository !== "boolean" || row.headRefName !== branch || row.baseRefName !== base
      || typeof row.number !== "number" || !Number.isInteger(row.number) || row.number <= 0) {
      throw new Error("gh pr list returned a pull request without verified identity");
    }
    if (!row.isCrossRepository) {
      matches.push({ number: row.number, ...(typeof row.url === "string" && row.url !== "" ? { url: row.url } : {}) });
    }
  }
  if (matches.length > 1) throw new Error("gh pr list returned multiple same-repository rolling pull requests");
  return matches[0];
}

function parsePublisherCommandOutput(stdout: string): ProjectionPublishPullRequestV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const value = parsed as { url?: unknown; number?: unknown };
  return {
    ...(typeof value.url === "string" && value.url !== "" ? { url: value.url } : {}),
    ...(typeof value.number === "number" && Number.isInteger(value.number) && value.number > 0 ? { number: value.number } : {})
  };
}

const nodeProjectionPublisherExec: ProjectionPublisherExec = (file, args, options) => new Promise((resolvePromise, rejectPromise) => {
  execFile(file, args, { cwd: options.cwd, env: options.env, timeout: options.timeoutMs, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      // Keep the spawn error code (ENOENT etc.) so callers can name a missing executable.
      rejectPromise(Object.assign(new Error(`${[file, ...args.slice(0, 2)].join(" ")} failed: ${(stderr ?? "").trim() || error.message}`), { code: error.code }));
      return;
    }
    resolvePromise({ stdout });
  });
});

function stringEnv(env: Env): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

// ---------------------------------------------------------------------------------------------
// validation, lock, state
// ---------------------------------------------------------------------------------------------

/** The writer's push target is checked before any Git operation that leaves the machine. */
function projectionWriterTargetIssue(repositoryRoot: string, input: { remote: string; base: string; branch: string }): string | undefined {
  const issue = refNameIssue(repositoryRoot, "--base", input.base) ?? refNameIssue(repositoryRoot, "--branch", input.branch) ?? remoteNameIssue(input.remote);
  if (issue) return issue;
  if (!input.branch.startsWith(PROJECTION_WRITER_BRANCH_PREFIX)) return `projection publish --branch must start with ${PROJECTION_WRITER_BRANCH_PREFIX}; the writer never pushes to any other ref`;
  if (input.branch === input.base) return "projection publish --branch must differ from --base";
  if (!gitSucceeds(repositoryRoot, ["remote", "get-url", "--", input.remote])) return `projection publish --remote names no configured remote: ${input.remote}`;
  return undefined;
}

function refNameIssue(repositoryRoot: string, flag: string, name: string): string | undefined {
  if (name === "" || name.startsWith("-") || name.includes("@{") || !gitSucceeds(repositoryRoot, ["check-ref-format", "--branch", name])) {
    return `${flag} is not a valid branch name: ${JSON.stringify(name)}`;
  }
  return undefined;
}

function remoteNameIssue(remote: string): string | undefined {
  if (remote === "" || remote.startsWith("-") || !/^[A-Za-z0-9._-]+$/.test(remote)) return `--remote is not a valid remote name: ${JSON.stringify(remote)}`;
  return undefined;
}

/**
 * SQLite owns the exclusion, using the same OS-backed lock as the runtime store. The sidecar is
 * separate from every ledger DB and is never renamed or removed. The JSON record is diagnostic.
 * A lost record stops this run but cannot admit another writer while the OS lock is held.
 */
function acquireProjectionWriterLock(lockPath: string, startedAt: string): { kind: "acquired"; record: string; release(): void } | { kind: "busy"; pid: number } {
  let ownership: { release(): void };
  try {
    ownership = acquireLocalStoreWriterOwnership(`${lockPath}.coordination`);
  } catch (error) {
    if (error instanceof FailureError && error.reasonCode === "runtime-writer-owned") {
      const holder = readProjectionWriterLock(lockPath);
      if (holder && isProcessAlive(holder.pid)) return { kind: "busy", pid: holder.pid };
      throw new ProjectionWriterFailure("AC_PRECONDITION_FAILED", "projection-writer-lock-unavailable", "another writer holds the OS lock; its diagnostic owner record is unavailable");
    }
    throw error;
  }
  try {
    // Refuse a live record from an earlier build, which did not take the OS lock.
    const body = readPrivateControlFile(lockPath);
    if (body === undefined && existsSync(lockPath)) {
      throw new ProjectionWriterFailure("AC_PRECONDITION_FAILED", "projection-writer-lock-unverified", "the writer owner record has unverified permissions");
    }
    const holder = body === undefined ? undefined : parseProjectionWriterLock(body);
    if (holder && isProcessAlive(holder.pid)) {
      ownership.release();
      return { kind: "busy", pid: holder.pid };
    }
    // All current writers hold the OS lock before changing this record. No stale-record rename.
    rmSync(lockPath, { force: true });
    const record = JSON.stringify({ pid: process.pid, startedAt, token: randomUUID() }, null, 2);
    createPrivateControlFile(lockPath, record);
    return { kind: "acquired", record, release() {
      try { if (readPrivateControlFile(lockPath) === record) rmSync(lockPath, { force: true }); }
      finally { ownership.release(); }
    } };
  } catch (error) {
    ownership.release();
    throw error;
  }
}

function assertProjectionWriterOwner(lockPath: string, record: string): void {
  if (readPrivateControlFile(lockPath) !== record) {
    throw new ProjectionWriterFailure("AC_PRECONDITION_FAILED", "projection-writer-lock-lost", "the writer owner record changed; publication stopped");
  }
}

function readProjectionWriterLock(lockPath: string): { pid: number; startedAt: string } | undefined {
  const body = readPrivateControlFile(lockPath);
  return body === undefined ? undefined : parseProjectionWriterLock(body);
}

function parseProjectionWriterLock(body: string): { pid: number; startedAt: string } | undefined {
  try {
    const value = JSON.parse(body) as { pid?: unknown; startedAt?: unknown };
    if (typeof value.pid !== "number" || !Number.isInteger(value.pid) || value.pid <= 0) return undefined;
    return { pid: value.pid, startedAt: typeof value.startedAt === "string" ? value.startedAt : "" };
  } catch {
    return undefined;
  }
}

function emptyProjectionWriterState(remote: string, base: string): ProjectionWriterStateV1 {
  return {
    schemaVersion: PROJECTION_WRITER_STATE_SCHEMA_VERSION,
    remote,
    base,
    branch: null,
    runSequence: 0,
    lastProcessedSha: null,
    lastSuccessfulSha: null,
    lastSuccessfulCommit: null,
    lastSuccessfulBranch: null,
    lastSuccessfulPublisher: null,
    lastSuccessfulFiles: [],
    publisherPending: null,
    lastRun: null
  };
}

function readProjectionWriterState(path: string, remote: string, base: string): ProjectionWriterStateV1 {
  if (!existsSync(path)) return emptyProjectionWriterState(remote, base);
  let value: Partial<ProjectionWriterStateV1>;
  try {
    value = JSON.parse(readFileSync(path, "utf8")) as Partial<ProjectionWriterStateV1>;
  } catch (error) {
    throw new ProjectionWriterFailure("AC_PRECONDITION_FAILED", "projection-writer-state-invalid", `projection writer state is unreadable at ${path}: ${errorMessage(error)}`);
  }
  if (value?.schemaVersion !== PROJECTION_WRITER_STATE_SCHEMA_VERSION || value.remote !== remote || value.base !== base || typeof value.runSequence !== "number") {
    throw new ProjectionWriterFailure("AC_PRECONDITION_FAILED", "projection-writer-state-invalid", `projection writer state at ${path} does not belong to ${remote}/${base}`);
  }
  return { ...emptyProjectionWriterState(remote, base), ...value } as ProjectionWriterStateV1;
}

function writeProjectionWriterState(path: string, state: ProjectionWriterStateV1): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

// ---------------------------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------------------------

/**
 * The owned worktree at `sha`, detached and clean. It is reused across runs; `clean` keeps ignored
 * files (no `-x`) so a gitignored CodeGraph index survives. A path that is not a registered
 * worktree of this repository is archctx-owned debris and is recreated.
 */
function prepareProjectionWriterWorktree(repositoryRoot: string, worktree: string, sha: string): void {
  git(repositoryRoot, ["worktree", "prune"]);
  if (!isRegisteredWorktree(repositoryRoot, worktree)) {
    rmSync(worktree, { recursive: true, force: true });
    git(repositoryRoot, ["worktree", "add", "--detach", worktree, sha]);
  }
  git(worktree, ["checkout", "-q", "--force", "--detach", sha]);
  git(worktree, ["reset", "-q", "--hard", sha]);
  git(worktree, ["clean", "-ffdq"]);
}

function isRegisteredWorktree(repositoryRoot: string, worktree: string): boolean {
  if (!existsSync(join(worktree, ".git"))) return false;
  const wanted = canonical(worktree);
  return git(repositoryRoot, ["worktree", "list", "--porcelain", "-z"])
    .split("\0")
    .filter((line) => line.startsWith("worktree "))
    .some((line) => canonical(line.slice("worktree ".length)) === wanted);
}

function canonical(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

/** Tracked and untracked (non-ignored) changes in the worktree, as repository-relative paths. */
function worktreeChangedPaths(worktree: string): string[] {
  const tokens = git(worktree, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0");
  const paths = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const entry = tokens[index]!;
    if (entry.length < 4) continue;
    paths.add(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") {
      const source = tokens[index + 1];
      if (source) paths.add(source);
      index += 1;
    }
  }
  return [...paths].sort();
}

/** `docs/architecture/**` style directory patterns and exact paths, as `projectionOwnedPaths` lists them. */
function isProjectionOwnedPath(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => pattern.endsWith("/**") ? path.startsWith(pattern.slice(0, -2)) : path === pattern);
}

function carriesSameProjection(worktree: string, remoteTip: string, commitSha: string, baseSha: string): boolean {
  if (!gitSucceeds(worktree, ["cat-file", "-e", `${remoteTip}^{commit}`])) return false;
  const parents = git(worktree, ["rev-list", "--parents", "-n", "1", remoteTip]).trim().split(/\s+/).slice(1);
  if (parents.length !== 1 || parents[0] !== baseSha) return false;
  return git(worktree, ["rev-parse", `${remoteTip}^{tree}`]).trim() === git(worktree, ["rev-parse", `${commitSha}^{tree}`]).trim();
}

function lsRemoteBranch(repositoryRoot: string, remote: string, branch: string, env: Env): string | null {
  const line = remoteGit(repositoryRoot, ["ls-remote", "--", remote, `refs/heads/${branch}`], env).split("\n").find((entry) => entry.endsWith(`\trefs/heads/${branch}`));
  return line ? line.split("\t")[0]! : null;
}

/** A Git command that talks to the remote: admitted on the `projection-publishing` channel, never prompting. */
function remoteGit(cwd: string, args: string[], env: Env): string {
  return withLocalEgress("projection-publishing", () => git(cwd, args, { GIT_TERMINAL_PROMPT: "0" }), env);
}

function git(cwd: string, args: string[], extraEnv: Record<string, string> = {}): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024
  });
  if (result.error) throw new ProjectionWriterFailure("AC_PRECONDITION_FAILED", "projection-writer-git-failed", `git ${args[0]} could not run: ${result.error.message}`);
  if (result.status !== 0) {
    throw new ProjectionWriterFailure("AC_PRECONDITION_FAILED", "projection-writer-git-failed", `git ${args[0]} failed: ${(result.stderr ?? "").trim() || `exit ${result.status}`}`);
  }
  return result.stdout ?? "";
}

function gitSucceeds(cwd: string, args: string[]): boolean {
  return spawnSync("git", args, { cwd, stdio: ["ignore", "ignore", "ignore"] }).status === 0;
}

// ---------------------------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------------------------

function envelopeFailure(envelope: JsonEnvelope, fallbackReason: string): ProjectionWriterFailure {
  const error = envelope.error;
  return new ProjectionWriterFailure(error?.code ?? "AC_UNCLASSIFIED_FAILURE", error?.reasonCode ?? fallbackReason, error?.message ?? fallbackReason);
}

function asWriterFailure(error: unknown): ProjectionWriterFailure {
  if (error instanceof ProjectionWriterFailure) return error;
  if (error instanceof LocalEgressPolicyError) return new ProjectionWriterFailure("AC_POLICY_VIOLATION", "egress-policy-denied", error.message);
  const envelope = publicOperationErrorEnvelope(PROJECTION_PUBLISH_REQUEST_ID, error);
  return envelopeFailure(envelope, "projection-writer-failed");
}

function writerError(failure: ProjectionWriterFailure): NonNullable<ProjectionPublishRunV1["error"]> {
  return { code: failure.code, reasonCode: failure.reasonCode, message: failure.message };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
