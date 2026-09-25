import {
  computeReviewWorktreeDigest
} from "@archcontext/core/architecture-domain";
import { completeTaskGate, type CompleteTaskInput } from "@archcontext/core/review-engine";
import { assertNoCallerProvidedAttestationFields, attestationV2Digest, canonicalAttestationV2, createAttestationV2, digestJson, productVersionManifest, type AttestationResult, type AttestationV2, type CodeFactsPort, type CodeFactsSnapshot, type DevicePrivateKeySignerPort, type Json, type ModelStorePort, type WorkspaceRef } from "@archcontext/contracts";
import { readTrackedTreeEntries, verifyDetachedReviewWorktree } from "@archcontext/local-runtime/git-adapter";
import { type RuntimeLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import type { ArchctxDaemon } from "./index";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, type Stats } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { ReviewChallengeV2 } from "@archcontext/contracts";
import { findRepositoryRoot, prepareDetachedReviewWorktree, removeDetachedReviewWorktree, removePathWithRetry, type DetachedReviewWorktree, type DetachedReviewWorktreePreparation } from "@archcontext/local-runtime/git-adapter";
import { defaultDeveloperReviewRunStateDir, isProcessAlive } from "./daemon-control";
import { decodeDeveloperReviewRunManifest } from "./developer-review-codec";

export type DeveloperReviewRunStatus = "preparing" | "running";

export interface DeveloperReviewRunManifest {
  schemaVersion: "archcontext.developer-review-run/v1";
  runId: string;
  challengeId: string;
  repositoryId: number;
  sourceRoot: string;
  runRoot: string;
  worktreeTempRoot: string;
  manifestPath: string;
  lockPath: string;
  pid: number;
  createdAt: string;
  status: DeveloperReviewRunStatus;
  codeGraphTemporaryState: {
    root: string;
    cleanup: "remove-run-root";
  };
  worktree?: DetachedReviewWorktree;
}

export interface DeveloperReviewRun extends DeveloperReviewRunManifest {
  status: "running";
  worktree: DetachedReviewWorktree;
}

export interface DeveloperReviewRunPreparation extends DetachedReviewWorktreePreparation {
  run?: DeveloperReviewRun;
  cleanup?: DeveloperReviewRunCleanup;
}

export interface DeveloperReviewRunCleanup {
  schemaVersion: "archcontext.developer-review-run-cleanup/v1";
  runId: string;
  challengeId: string;
  cleaned: boolean;
  removed: Array<"worktree" | "run-root" | "manifest" | "lock">;
  errors: string[];
}

export interface DeveloperReviewRunCleanupRequest {
  repositoryRoot: string;
  challengeId: string;
  runId: string;
}

export interface DeveloperReviewRunRecovery {
  schemaVersion: "archcontext.developer-review-run-recovery/v1";
  sourceRoot: string;
  stateDir: string;
  recovered: DeveloperReviewRunCleanup[];
  removedLocks: string[];
  skippedActive: string[];
  /** State-dir entries left untouched because they failed the daemon-ownership check. */
  rejected: string[];
}

export class DeveloperReviewRunService {
  constructor(private readonly assertRunning: () => void, private readonly clock: () => string) {}

  prepareDeveloperReviewWorktree(input: {
    repositoryRoot: string;
    challenge: ReviewChallengeV2;
    expectedHeadTreeOid?: string;
    tempRoot?: string;
  }): DetachedReviewWorktreePreparation {
    this.assertRunning();
    return prepareDetachedReviewWorktree({
      sourceRoot: input.repositoryRoot,
      headSha: input.challenge.headSha,
      expectedHeadTreeOid: input.expectedHeadTreeOid,
      tempRoot: input.tempRoot
    });
  }

  startDeveloperReviewRun(input: {
    repositoryRoot: string;
    challenge: ReviewChallengeV2;
    expectedHeadTreeOid?: string;
    /** In-process callers only; the production RPC contract does not accept a temp root. */
    tempRoot?: string;
  }): DeveloperReviewRunPreparation {
    this.assertRunning();
    const sourceRoot = findRepositoryRoot(input.repositoryRoot);
    const paths = createDeveloperReviewRunPaths({
      sourceRoot,
      challengeId: input.challenge.challengeId,
      tempRoot: input.tempRoot
    });
    mkdirSync(paths.stateDir, { recursive: true });
    mkdirSync(paths.runRoot, { recursive: true });
    mkdirSync(paths.worktreeTempRoot, { recursive: true });
    const createdAt = this.clock();
    writeDeveloperReviewRunOwnerMarker({
      runRoot: paths.runRoot,
      runId: paths.runId,
      challengeId: input.challenge.challengeId,
      stateDir: paths.stateDir,
      manifestPath: paths.manifestPath,
      lockPath: paths.lockPath,
      createdAt
    });
    const preparing: DeveloperReviewRunManifest = {
      schemaVersion: "archcontext.developer-review-run/v1",
      runId: paths.runId,
      challengeId: input.challenge.challengeId,
      repositoryId: input.challenge.repositoryId,
      sourceRoot,
      runRoot: paths.runRoot,
      worktreeTempRoot: paths.worktreeTempRoot,
      manifestPath: paths.manifestPath,
      lockPath: paths.lockPath,
      pid: process.pid,
      createdAt,
      status: "preparing",
      codeGraphTemporaryState: {
        root: paths.runRoot,
        cleanup: "remove-run-root"
      }
    };
    if (existsSync(paths.lockPath) || existsSync(paths.manifestPath)) {
      removePathWithRetry(paths.runRoot);
      throw new Error(`developer-review-run-already-active: ${input.challenge.challengeId}`);
    }
    let lockAcquired = false;
    try {
      writePrivateJson(paths.lockPath, {
        schemaVersion: "archcontext.developer-review-run-lock/v1",
        runId: paths.runId,
        challengeId: input.challenge.challengeId,
        pid: process.pid,
        createdAt: preparing.createdAt
      }, "wx");
      lockAcquired = true;
      writeDeveloperReviewRunManifest(preparing);
      const prepared = prepareDetachedReviewWorktree({
        sourceRoot,
        headSha: input.challenge.headSha,
        expectedHeadTreeOid: input.expectedHeadTreeOid,
        tempRoot: paths.worktreeTempRoot
      });
      if (!prepared.accepted || !prepared.worktree) {
        const cleanup = this.cleanupOwnedDeveloperReviewRun(preparing);
        return { ...prepared, cleanup };
      }
      const run: DeveloperReviewRun = {
        ...preparing,
        status: "running",
        worktree: prepared.worktree
      };
      writeDeveloperReviewRunManifest(run);
      return { ...prepared, run };
    } catch (error) {
      if (lockAcquired) {
        this.cleanupOwnedDeveloperReviewRun(preparing);
      } else {
        removePathWithRetry(paths.runRoot);
      }
      throw error;
    }
  }

  async withDeveloperReviewRun<T>(input: {
    repositoryRoot: string;
    challenge: ReviewChallengeV2;
    expectedHeadTreeOid?: string;
    /** In-process callers only; the production RPC contract does not accept a temp root. */
    tempRoot?: string;
  }, run: (developerReviewRun: DeveloperReviewRun) => Promise<T> | T): Promise<T> {
    const prepared = this.startDeveloperReviewRun(input);
    if (!prepared.accepted || !prepared.run) {
      throw new Error(`developer-review-run-prepare-failed: ${prepared.reasonCode ?? "UNKNOWN"}`);
    }
    try {
      return await run(prepared.run);
    } finally {
      this.cleanupOwnedDeveloperReviewRun(prepared.run);
    }
  }

  cleanupOwnedDeveloperReviewRun(run: DeveloperReviewRunManifest): DeveloperReviewRunCleanup {
    // Throws before anything is removed when the manifest names a path this daemon does not own.
    const targets = resolveOwnedDeveloperReviewRunTargets(run);
    const removed: DeveloperReviewRunCleanup["removed"] = [];
    const errors: string[] = [];
    if (targets.worktree) {
      try {
        const hadWorktree = existsSync(targets.worktree.worktreeRoot);
        removeDetachedReviewWorktree(targets.worktree);
        if (hadWorktree) removed.push("worktree");
      } catch (error) {
        errors.push(cleanupErrorMessage("worktree", error));
      }
    }
    for (const [kind, path] of [
      ["run-root", targets.runRoot],
      ["manifest", targets.manifestPath],
      ["lock", targets.lockPath]
    ] as const) {
      if (!path) continue;
      try {
        const existed = existsSync(path);
        removePathWithRetry(path);
        if (existed) removed.push(kind);
      } catch (error) {
        errors.push(cleanupErrorMessage(kind, error));
      }
    }
    return {
      schemaVersion: "archcontext.developer-review-run-cleanup/v1",
      runId: run.runId,
      challengeId: run.challengeId,
      cleaned: errors.length === 0,
      removed,
      errors
    };
  }

  cleanupDeveloperReviewRun(input: DeveloperReviewRunCleanupRequest): DeveloperReviewRunCleanup {
    this.assertRunning();
    const sourceRoot = findRepositoryRoot(input.repositoryRoot);
    const safeChallengeId = safeControlFileSegment(input.challengeId);
    const manifestPath = join(defaultDeveloperReviewRunStateDir(sourceRoot), `${safeChallengeId}.json`);
    const manifest = readDeveloperReviewRunManifest(manifestPath);
    if (!manifest) throw developerReviewRunNotOwned("persisted-manifest-missing");
    if (manifest.runId !== input.runId || manifest.challengeId !== input.challengeId || resolve(manifest.sourceRoot) !== sourceRoot) {
      throw developerReviewRunNotOwned("persisted-manifest-identity-mismatch");
    }
    return this.cleanupOwnedDeveloperReviewRun(manifest);
  }

  /**
   * Crash recovery scans one directory only: the daemon-owned developer-review state dir for the
   * caller's repository. There is no caller-selected scan root, and every manifest found there is
   * still re-validated against its own file location before its run is cleaned up.
   */
  recoverDeveloperReviewRuns(input: {
    repositoryRoot: string;
    force?: boolean;
  }): DeveloperReviewRunRecovery {
    this.assertRunning();
    const sourceRoot = findRepositoryRoot(input.repositoryRoot);
    const stateDir = defaultDeveloperReviewRunStateDir(sourceRoot);
    const recovery: DeveloperReviewRunRecovery = {
      schemaVersion: "archcontext.developer-review-run-recovery/v1",
      sourceRoot,
      stateDir,
      recovered: [],
      removedLocks: [],
      skippedActive: [],
      rejected: []
    };
    if (!existsSync(stateDir)) return recovery;

    for (const entry of readdirSync(stateDir).sort()) {
      if (!entry.endsWith(".json")) continue;
      const manifestPath = join(stateDir, entry);
      const stats = lstatIfExists(manifestPath);
      if (!stats || !stats.isFile()) {
        recovery.rejected.push(`${entry}: not-a-regular-file`);
        continue;
      }
      const manifest = readDeveloperReviewRunManifest(manifestPath);
      if (!manifest) {
        rmSync(manifestPath, { force: true });
        continue;
      }
      if (resolve(manifest.manifestPath) !== manifestPath) {
        recovery.rejected.push(`${entry}: manifest-path-mismatch`);
        continue;
      }
      if (!input.force && isDeveloperReviewPidAlive(manifest.pid)) {
        recovery.skippedActive.push(manifest.runId);
        continue;
      }
      try {
        recovery.recovered.push(this.cleanupOwnedDeveloperReviewRun(manifest));
      } catch (error) {
        recovery.rejected.push(`${entry}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    for (const entry of readdirSync(stateDir).sort()) {
      if (!entry.endsWith(".lock")) continue;
      const lockPath = join(stateDir, entry);
      const stats = lstatIfExists(lockPath);
      if (!stats || !stats.isFile()) {
        recovery.rejected.push(`${entry}: not-a-regular-file`);
        continue;
      }
      const lock = readJsonObject(lockPath);
      const pid = typeof lock?.pid === "number" ? lock.pid : undefined;
      const runId = typeof lock?.runId === "string" ? lock.runId : entry;
      if (!input.force && pid !== undefined && isDeveloperReviewPidAlive(pid)) {
        recovery.skippedActive.push(runId);
        continue;
      }
      rmSync(lockPath, { force: true });
      recovery.removedLocks.push(lockPath);
    }
    return recovery;
  }

}

const DEVELOPER_REVIEW_RUN_ROOT_PREFIX = "archctx-developer-review-";
const DEVELOPER_REVIEW_RUN_OWNER_MARKER_FILE = ".archctx-developer-review-run.json";
const DEVELOPER_REVIEW_RUN_OWNER_SCHEMA_VERSION = "archcontext.developer-review-run-owner/v1";
/** `mkdtempSync` appends exactly six random characters to the requested prefix. */
const DEVELOPER_REVIEW_RUN_ROOT_SUFFIX = /^[A-Za-z0-9]{6}$/;
/** `runId` is the safe challenge segment plus `randomBytes(6).toString("hex")`. */
const DEVELOPER_REVIEW_RUN_ID_SUFFIX = /^[0-9a-f]{12}$/;

interface DeveloperReviewRunOwnerMarkerV1 {
  schemaVersion: typeof DEVELOPER_REVIEW_RUN_OWNER_SCHEMA_VERSION;
  runId: string;
  challengeId: string;
  stateDir: string;
  manifestPath: string;
  lockPath: string;
  pid: number;
  createdAt: string;
}

/**
 * Deletion targets for one developer-review run, re-derived from daemon-owned state instead of
 * trusted from the caller-supplied manifest. `runRoot`/`worktree` are absent when the run root is
 * already gone, which leaves manifest and lock removal as the only remaining work — that is the
 * crash window between removing a run root and removing its manifest, not a caller-controlled
 * shortcut.
 */
interface OwnedDeveloperReviewRunTargets {
  stateDir: string;
  manifestPath: string;
  lockPath: string;
  runRoot?: string;
  worktree?: DetachedReviewWorktree;
}

function createDeveloperReviewRunPaths(input: {
  sourceRoot: string;
  challengeId: string;
  tempRoot?: string;
}): {
  runId: string;
  stateDir: string;
  runRoot: string;
  worktreeTempRoot: string;
  manifestPath: string;
  lockPath: string;
} {
  const safeChallengeId = safeControlFileSegment(input.challengeId);
  const runId = `${safeChallengeId}-${randomBytes(6).toString("hex")}`;
  const stateDir = defaultDeveloperReviewRunStateDir(input.sourceRoot);
  const tempParent = input.tempRoot ? resolve(input.tempRoot) : tmpdir();
  mkdirSync(tempParent, { recursive: true });
  const runRoot = mkdtempSync(join(tempParent, `${DEVELOPER_REVIEW_RUN_ROOT_PREFIX}${safeChallengeId.slice(0, 32)}-`));
  return {
    runId,
    stateDir,
    runRoot,
    worktreeTempRoot: join(runRoot, "worktrees"),
    manifestPath: join(stateDir, `${safeChallengeId}.json`),
    lockPath: join(stateDir, `${safeChallengeId}.lock`)
  };
}

/**
 * Written into a run root the moment the daemon creates it. Cleanup deletes a run root only when
 * this marker is present and matches the run being cleaned, which is what proves the daemon
 * created the directory it is about to remove — including after a crash, from a different process.
 */
function writeDeveloperReviewRunOwnerMarker(input: {
  runRoot: string;
  runId: string;
  challengeId: string;
  stateDir: string;
  manifestPath: string;
  lockPath: string;
  createdAt: string;
}): void {
  const marker: DeveloperReviewRunOwnerMarkerV1 = {
    schemaVersion: DEVELOPER_REVIEW_RUN_OWNER_SCHEMA_VERSION,
    runId: input.runId,
    challengeId: input.challengeId,
    stateDir: input.stateDir,
    manifestPath: input.manifestPath,
    lockPath: input.lockPath,
    pid: process.pid,
    createdAt: input.createdAt
  };
  writePrivateJson(join(input.runRoot, DEVELOPER_REVIEW_RUN_OWNER_MARKER_FILE), marker, "wx");
}

function readDeveloperReviewRunOwnerMarker(path: string): DeveloperReviewRunOwnerMarkerV1 | undefined {
  const stats = lstatIfExists(path);
  if (!stats || !stats.isFile()) return undefined;
  const parsed = readJsonObject(path);
  if (!parsed || parsed.schemaVersion !== DEVELOPER_REVIEW_RUN_OWNER_SCHEMA_VERSION) return undefined;
  if (typeof parsed.runId !== "string" || typeof parsed.challengeId !== "string") return undefined;
  if (typeof parsed.manifestPath !== "string" || typeof parsed.lockPath !== "string") return undefined;
  return parsed as unknown as DeveloperReviewRunOwnerMarkerV1;
}

function developerReviewRunNotOwned(reason: string): Error {
  return new Error(`developer-review-run-not-owned: ${reason}`);
}

/**
 * Fail-closed containment check for every developer-review deletion. Nothing here trusts a
 * caller-supplied path: the state directory comes from `runtimeStatePaths`, manifest and lock
 * names are re-derived from the challenge id, the run root must carry the daemon's mkdtemp naming
 * convention plus its ownership marker, and the worktree must sit inside that run root. Any
 * mismatch throws before a single unlink happens.
 */
function resolveOwnedDeveloperReviewRunTargets(run: DeveloperReviewRunManifest): OwnedDeveloperReviewRunTargets {
  const safeChallengeId = safeControlFileSegment(run.challengeId);
  const runIdSuffix = run.runId.startsWith(`${safeChallengeId}-`) ? run.runId.slice(safeChallengeId.length + 1) : undefined;
  if (!runIdSuffix || !DEVELOPER_REVIEW_RUN_ID_SUFFIX.test(runIdSuffix)) throw developerReviewRunNotOwned("run-id");

  const stateDir = defaultDeveloperReviewRunStateDir(run.sourceRoot);
  const manifestPath = join(stateDir, `${safeChallengeId}.json`);
  const lockPath = join(stateDir, `${safeChallengeId}.lock`);
  if (resolve(run.manifestPath) !== manifestPath) throw developerReviewRunNotOwned("manifest-path");
  if (resolve(run.lockPath) !== lockPath) throw developerReviewRunNotOwned("lock-path");

  const persisted = readDeveloperReviewRunManifest(manifestPath);
  if (!persisted) throw developerReviewRunNotOwned("persisted-manifest-missing");
  if (
    persisted.runId !== run.runId
    || persisted.challengeId !== run.challengeId
    || persisted.repositoryId !== run.repositoryId
    || resolve(persisted.sourceRoot) !== resolve(run.sourceRoot)
    || resolve(persisted.runRoot) !== resolve(run.runRoot)
    || resolve(persisted.worktreeTempRoot) !== resolve(run.worktreeTempRoot)
    || resolve(persisted.manifestPath) !== manifestPath
    || resolve(persisted.lockPath) !== lockPath
  ) {
    throw developerReviewRunNotOwned("persisted-manifest-mismatch");
  }
  const lockStats = lstatIfExists(lockPath);
  const lock = lockStats?.isFile() ? readJsonObject(lockPath) : undefined;
  if (
    !lock
    || lock.schemaVersion !== "archcontext.developer-review-run-lock/v1"
    || lock.runId !== run.runId
    || lock.challengeId !== run.challengeId
  ) {
    throw developerReviewRunNotOwned("persisted-lock-mismatch");
  }

  const runRoot = resolve(run.runRoot);
  const runRootPrefix = `${DEVELOPER_REVIEW_RUN_ROOT_PREFIX}${safeChallengeId.slice(0, 32)}-`;
  const runRootName = basename(runRoot);
  if (!runRootName.startsWith(runRootPrefix) || !DEVELOPER_REVIEW_RUN_ROOT_SUFFIX.test(runRootName.slice(runRootPrefix.length))) {
    throw developerReviewRunNotOwned("run-root-name");
  }
  const worktreeTempRoot = join(runRoot, "worktrees");
  if (resolve(run.worktreeTempRoot) !== worktreeTempRoot) throw developerReviewRunNotOwned("worktree-temp-root");
  if (resolve(run.codeGraphTemporaryState.root) !== runRoot) throw developerReviewRunNotOwned("codegraph-temporary-state-root");

  const runRootStats = lstatIfExists(runRoot);
  if (!runRootStats) return { stateDir, manifestPath, lockPath };
  if (!runRootStats.isDirectory()) throw developerReviewRunNotOwned("run-root-not-a-directory");
  const marker = readDeveloperReviewRunOwnerMarker(join(runRoot, DEVELOPER_REVIEW_RUN_OWNER_MARKER_FILE));
  if (!marker) throw developerReviewRunNotOwned("run-root-owner-marker-missing");
  if (marker.runId !== run.runId || marker.challengeId !== run.challengeId) throw developerReviewRunNotOwned("run-root-owner-marker-mismatch");
  if (marker.manifestPath !== manifestPath || marker.lockPath !== lockPath) throw developerReviewRunNotOwned("run-root-owner-marker-mismatch");
  if (!run.worktree) return { stateDir, manifestPath, lockPath, runRoot };

  const temporaryRoot = resolve(run.worktree.temporaryRoot);
  const worktreeRoot = resolve(run.worktree.worktreeRoot);
  if (!isContainedPath(worktreeTempRoot, temporaryRoot)) throw developerReviewRunNotOwned("worktree-temporary-root");
  if (!isContainedPath(temporaryRoot, worktreeRoot)) throw developerReviewRunNotOwned("worktree-root");
  if (defaultDeveloperReviewRunStateDir(run.worktree.sourceRoot) !== stateDir) throw developerReviewRunNotOwned("worktree-source-root");
  return { stateDir, manifestPath, lockPath, runRoot, worktree: { ...run.worktree, temporaryRoot, worktreeRoot } };
}

function isContainedPath(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

function lstatIfExists(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

function safeControlFileSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
  return sanitized.length > 0 ? sanitized : "developer-review";
}


function writeDeveloperReviewRunManifest(manifest: DeveloperReviewRunManifest): void {
  writePrivateJson(manifest.manifestPath, manifest);
}

function writePrivateJson(path: string, value: unknown, flag: "w" | "wx" = "w"): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600, flag });
  chmodSync(path, 0o600);
}

function readDeveloperReviewRunManifest(path: string): DeveloperReviewRunManifest | undefined {
  try {
    return decodeDeveloperReviewRunManifest(readJsonObject(path), "developer-review-run-manifest");
  } catch {
    return undefined;
  }
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function isDeveloperReviewPidAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false;
  return isProcessAlive(pid);
}

function cleanupErrorMessage(kind: string, error: unknown): string {
  return `${kind}: ${error instanceof Error ? error.message : String(error)}`;
}


export interface DeveloperReviewDigestBundle {
  schemaVersion: "archcontext.developer-review-digest-bundle/v1";
  challengeId: string;
  repositoryId: number;
  headSha: string;
  headTreeOid: string;
  worktreeDigest: string;
  modelDigest: string;
  policyDigest: string;
  codeFactsDigest: string;
  runtime: AttestationV2["runtime"];
}

export interface DeveloperReviewSession {
  schemaVersion: "archcontext.developer-review-session/v1";
  challengeId: string;
  taskSessionId: string;
  reviewId: string;
  reviewDigest: string;
  reviewResult: "pass" | "pass_with_warnings" | "fail_action_required";
  attestationResult: AttestationResult;
  summary: {
    errors: number;
    warnings: number;
    notices: number;
  };
  digests: DeveloperReviewDigestBundle;
}

export interface DeveloperReviewAttestation {
  schemaVersion: "archcontext.developer-review-attestation/v1";
  challengeId: string;
  reviewSession: DeveloperReviewSession;
  attestation: AttestationV2;
  attestationDigest: string;
  signingPayloadDigest: string;
}

interface DeveloperReviewSessionContext {
  assertRunning(): void;
  clock(): string;
  modelStore: Pick<ModelStorePort, "validateModel" | "loadModel">;
  codeFacts: Pick<CodeFactsPort, "sync">;
  localStore: Pick<RuntimeLocalStore, "saveReviewResult">;
  devicePrivateKeySigner?: DevicePrivateKeySignerPort;
  composition: ReturnType<ArchctxDaemon["compositionReport"]>;
  codeFactsDigest(snapshot: CodeFactsSnapshot): string;
  computeDeveloperReviewDigestBundle: ArchctxDaemon["computeDeveloperReviewDigestBundle"];
  runDeveloperReviewSession: ArchctxDaemon["runDeveloperReviewSession"];
}

export class DeveloperReviewSessionService {
  constructor(private readonly context: DeveloperReviewSessionContext) {}

  async computeDeveloperReviewDigestBundle(input: {
    challenge: ReviewChallengeV2;
    worktree: DetachedReviewWorktree;
    codeFactsSnapshot?: CodeFactsSnapshot;
    sparseScope?: string[];
  }): Promise<DeveloperReviewDigestBundle> {
    this.context.assertRunning();
    const verification = verifyDetachedReviewWorktree({
      worktreeRoot: input.worktree.worktreeRoot,
      expectedHeadSha: input.challenge.headSha,
      expectedHeadTreeOid: input.worktree.headTreeOid
    });
    if (!verification.accepted) throw new Error(`developer-review-worktree-invalid: ${verification.reasonCode ?? "UNKNOWN"}`);

    const workspace: WorkspaceRef = {
      root: input.worktree.worktreeRoot,
      repositoryId: `github.repository.${input.challenge.repositoryId}`,
      headSha: input.challenge.headSha
    };
    const model = await this.context.modelStore.validateModel(workspace);
    const modelFiles = await this.context.modelStore.loadModel(workspace);
    const codeFacts = input.codeFactsSnapshot ?? await this.context.codeFacts.sync({ workspace });
    return {
      schemaVersion: "archcontext.developer-review-digest-bundle/v1",
      challengeId: input.challenge.challengeId,
      repositoryId: input.challenge.repositoryId,
      headSha: input.challenge.headSha,
      headTreeOid: input.worktree.headTreeOid,
      worktreeDigest: computeReviewWorktreeDigest({
        repositoryNumericId: input.challenge.repositoryId,
        headSha: input.challenge.headSha,
        headTreeOid: input.worktree.headTreeOid,
        trackedTree: readTrackedTreeEntries(input.worktree.worktreeRoot),
        sparseScope: input.sparseScope
      }),
      modelDigest: model.modelDigest,
      policyDigest: policyDigestForModelFiles(modelFiles, input.challenge.policyProfileId),
      codeFactsDigest: this.context.codeFactsDigest(codeFacts),
      runtime: runtimeAttestationIdentity(codeFacts, this.context.composition)
    };
  }

  async runDeveloperReviewSession(input: {
    challenge: ReviewChallengeV2;
    worktree: DetachedReviewWorktree;
    taskSessionId?: string;
    posture?: CompleteTaskInput["posture"];
    compatibilityContract?: CompleteTaskInput["compatibilityContract"];
    compatibilityPathIntroduced?: boolean;
    cleanupRequired?: number;
    cleanupCompleted?: number;
  }): Promise<DeveloperReviewSession> {
    this.context.assertRunning();
    const digests = await this.context.computeDeveloperReviewDigestBundle({
      challenge: input.challenge,
      worktree: input.worktree
    });
    const review = completeTaskGate({
      taskSessionId: input.taskSessionId ?? `developer_review_${input.challenge.challengeId}`,
      posture: input.posture ?? "normal",
      headSha: input.challenge.headSha,
      currentHeadSha: input.challenge.headSha,
      worktreeDigest: digests.worktreeDigest,
      modelDigest: digests.modelDigest,
      codeFactsDigest: digests.codeFactsDigest,
      compatibilityContract: input.compatibilityContract,
      compatibilityPathIntroduced: input.compatibilityPathIntroduced,
      cleanupRequired: input.cleanupRequired,
      cleanupCompleted: input.cleanupCompleted
    });
    await this.context.localStore.saveReviewResult(review.reviewId, review);
    return {
      schemaVersion: "archcontext.developer-review-session/v1",
      challengeId: input.challenge.challengeId,
      taskSessionId: review.taskSessionId,
      reviewId: review.reviewId,
      reviewDigest: review.extensions.digest,
      reviewResult: review.result,
      attestationResult: review.result === "fail_action_required" ? "fail" : "pass",
      summary: review.summary,
      digests
    };
  }

  async runSignedDeveloperReviewAttestation(input: {
    challenge: ReviewChallengeV2;
    worktree: DetachedReviewWorktree;
    keyRef: string;
    principalId: string;
    publicKeyId: string;
    taskSessionId?: string;
    mergeBaseSha?: string;
    startedAt?: string;
    completedAt?: string;
  }): Promise<DeveloperReviewAttestation> {
    this.context.assertRunning();
    assertNoCallerProvidedAttestationFields(input, "developer-review-attestation");
    if (!this.context.devicePrivateKeySigner) throw new Error("device-private-key-signer-unavailable");
    const startedAt = input.startedAt ?? this.context.clock();
    const reviewSession = await this.context.runDeveloperReviewSession({
      challenge: input.challenge,
      worktree: input.worktree,
      taskSessionId: input.taskSessionId
    });
    const completedAt = input.completedAt ?? this.context.clock();
    const unsigned = createAttestationV2({
      challengeId: input.challenge.challengeId,
      installationId: input.challenge.installationId,
      repositoryId: input.challenge.repositoryId,
      pullRequestNumber: input.challenge.pullRequestNumber,
      headSha: input.challenge.headSha,
      baseSha: input.challenge.baseSha,
      mergeBaseSha: input.mergeBaseSha ?? input.challenge.baseSha,
      headTreeOid: reviewSession.digests.headTreeOid,
      worktreeDigest: reviewSession.digests.worktreeDigest,
      modelDigest: reviewSession.digests.modelDigest,
      policyDigest: reviewSession.digests.policyDigest,
      codeFactsDigest: reviewSession.digests.codeFactsDigest,
      reviewDigest: reviewSession.reviewDigest,
      result: reviewSession.attestationResult,
      execution: {
        trustLevel: "developer",
        source: "clean-commit-worktree",
        principalId: input.principalId,
        publicKeyId: input.publicKeyId
      },
      runtime: reviewSession.digests.runtime,
      nonce: input.challenge.nonce,
      startedAt,
      completedAt,
      expiresAt: input.challenge.expiresAt
    });
    const signingPayload = canonicalAttestationV2(unsigned);
    const signature = this.context.devicePrivateKeySigner.signWithDevicePrivateKey({
      keyRef: input.keyRef,
      payload: signingPayload
    });
    const attestation = createAttestationV2({
      ...unsigned,
      signature: { algorithm: "ed25519", value: signature }
    });
    return {
      schemaVersion: "archcontext.developer-review-attestation/v1",
      challengeId: input.challenge.challengeId,
      reviewSession,
      attestation,
      attestationDigest: attestationV2Digest(attestation),
      signingPayloadDigest: digestJson(signingPayload)
    };
  }

}

function policyDigestForModelFiles(modelFiles: unknown[], policyProfileId: string): string {
  const policyFiles = modelFiles
    .map(modelFileDigestSummary)
    .filter((file): file is { path: string; digest: string } => Boolean(file?.path.startsWith(".archcontext/policies/")))
    .sort((a, b) => a.path.localeCompare(b.path));
  const payload: Record<string, Json> = {
    schemaVersion: "archcontext.policy-digest/v1",
    policyProfileId
  };
  if (policyFiles.length > 0) {
    payload.files = policyFiles;
  } else {
    payload.fallbackDigest = digestJson(modelFiles as unknown as Json);
  }
  return digestJson(payload);
}

function modelFileDigestSummary(value: unknown): { path: string; digest: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as { path?: unknown; digest?: unknown };
  if (typeof record.path !== "string" || typeof record.digest !== "string") return undefined;
  return { path: record.path, digest: record.digest };
}

function runtimeAttestationIdentity(snapshot: CodeFactsSnapshot, composition: ReturnType<ArchctxDaemon["compositionReport"]>): AttestationV2["runtime"] {
  const product = productVersionManifest();
  return {
    version: product.product.version,
    buildDigest: digestJson({
      schemaVersion: "archcontext.runtime-build/v1",
      product: product.product,
      packageManager: product.packageManager,
      engines: product.engines,
      schemas: product.schemas,
      runtime: product.runtime
    } as unknown as Json),
    codeGraphVersion: snapshot.version,
    capabilitiesDigest: digestJson({
      schemaVersion: "archcontext.runtime-capabilities/v1",
      adapters: composition.adapters,
      codeFacts: {
        provider: snapshot.provider,
        version: snapshot.version
      },
      capabilities: [
        "detached-review-worktree",
        "tracked-worktree-digest",
        "model-digest",
        "policy-digest",
        "code-facts-digest",
        "deterministic-review-session"
      ]
    } as unknown as Json)
  };
}

