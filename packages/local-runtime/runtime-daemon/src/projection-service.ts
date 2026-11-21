import { FailureError, failureEnvelope, knownFailure, PROJECTION_RECOVERY_DETAILS_LIMIT_BYTES, projectionApplyCommittedDetails, projectionApplyManualOnlyDetails, projectionApplyRecoveryDetailsBytes, projectionApplyRecoveryDetailsFit } from "@archcontext/contracts";
import { publicFailureEnvelope, publicOperationErrorEnvelope, publicOperationFailure, publicOperationResult } from "./public-operation-failure";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeWorktreeDigest, manifestDecisionDiagnostics, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { GitVisibleFilesUnavailableError, findRepositoryRoot, ignoredRepositoryPaths, readHeadSha, listGitVisibleFiles, type IgnoredRepositoryPath } from "@archcontext/local-runtime/git-adapter";
import { decodeUtf8, isGitRevisionArgument, localGitEnv, readGitBlobTree, readGitBlobs, readNativeGitRoot, readOnlyGit, resolveNativeGitSnapshot } from "@archcontext/local-runtime/git-adapter";
import { architectureModelIgnoreProbePaths, readArchitectureHistory } from "@archcontext/local-runtime/model-store-yaml";
import { ProjectionCodeFactsUnavailableError, assertProjectionCodeFactsAvailable, prepareArchitectureDocumentationProjectionSnapshot } from "@archcontext/local-runtime/codegraph-adapter";
import { assertReadyCodeGraphIndexWithoutWorktreeWrites } from "@archcontext/local-runtime/codegraph-adapter";
import { isSemanticModelPath } from "@archcontext/core/projection-engine";
import { projectionProtocolGeneratedFrom, projectionWorkspaceId } from "./projection-inputs";
import { projectionFreshnessContract } from "./projection-freshness";
import { projectionArchitectureDebt } from "./projection-architecture-debt";
import { classifyProjectionTargetChanges } from "./projection-target-changes";
import type { RuntimeDaemonClient } from "./runtime-types";
import { ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH, PROJECTION_RESULT_SCHEMA_VERSION, architectureDocsProjectionManifestSchemaVersion, isSupersededArchitectureDocsProjectionManifestSchemaVersion, PROJECTION_MODES, PROJECTION_REQUEST_SCHEMA_VERSION, PROJECTION_SLICE_SCHEMA_VERSION, PROJECTION_TARGETS, digestJson, isRepoRelativePosixPath, okEnvelope, projectionFreshnessIssues, projectionRequestInvariantIssues, projectionResultInvariantIssues, projectionResultReceiptDigest, projectionResultRequestModeIssues } from "@archcontext/contracts";
import type { AcceptedArchitectureChangeReferenceV1, ArchitectureDocumentationProjectionProvenanceV3, ArchitectureHistory, ArchitectureRefreshSignalV2, Json, JsonEnvelope, ProjectionFreshnessV2, ProjectionCoverageV1, ProjectionRequestV1, ProjectionResultV3, ProjectionSliceV1, ProjectionSnapshotV1, ProjectionExpectedSnapshotV1, ProjectionTargetChangeV2, Sha256Digest } from "@archcontext/contracts";
import { REPO_HARNESS_PROJECTION_PROFILE, ARCHITECTURE_HISTORY_TARGET, architectureAdoptionReceipt, architectureHistoryCarryForwardBlocker, architectureProjectionFilePreviews, architectureDocumentationSourceDigest, ProjectionPreconditionError, buildArchitectureDocumentationAdoptionPlan, loadAgentContextProjectionFiles, loadArchitectureDocumentationInputs, architectureProjectionFootprintOwners, architectureProjectionFreshnessWithoutBaseline, loadArchitectureDocumentationProfile, readCommittedArchitectureDocsProjectionManifest, measureCapabilitySourceScaleSignals, loadNativeModelFromArchContext, loadNativeModelFromModelFiles, parseArchitectureDocumentationProfile, projectionOwnedWriteBody, renderAgentContextProjection, renderArchitectureProjectionSlice, renderArchitectureDocumentationProjection, architectureDocumentationProjectionWorktreeDigest, type ArchitectureProjectionProfile, type ProjectionOwnedFile, type ArchitectureMajorChangeClassificationV1, type ArchitectureDocumentationProjectionRuntimeSnapshot } from "@archcontext/core/projection-engine";
import { loadStateMachinesFromArchContext } from "@archcontext/core/state-machine-engine";
import type { RuntimeDocsProjectionInput, RuntimeAgentContextProjectionInput, RuntimeProjectionInvocation } from "./runtime-types";
export type { RuntimeDocsProjectionInput, RuntimeAgentContextProjectionInput, RuntimeProjectionInvocation } from "./runtime-types";

export type ProjectionServiceHost = Pick<RuntimeDaemonClient, "planUpdate" | "applyUpdate">;

/** Git model snapshots are read directly from objects. CodeGraph is a read-only readiness gate. */
export function runProjectionSliceCommand(options: { cwd: string; base: string; changedPaths: string[] }): JsonEnvelope {
  const requestId = "projection.slice";
  if (!isGitRevisionArgument(options.base) || options.changedPaths.some((path) => !isRepoRelativePosixPath(path))) {
    return publicFailureEnvelope(requestId, "AC_SCHEMA_INVALID", "projection-input-invalid");
  }
  let root: string;
  try { root = readNativeGitRoot(options.cwd); }
  catch { return publicFailureEnvelope(requestId, "AC_REPO_NOT_FOUND", "git-worktree-required"); }
  try {
    const gitArgs = ["-c", "core.fsmonitor=false"];
    const gitOptions = { cwd: root, env: localGitEnv(), encoding: "utf8" as const, timeout: 10_000 };
    const git = (...args: string[]) => execFileSync("git", [...gitArgs, ...args], { ...gitOptions, stdio: ["ignore", "pipe", "pipe"] });
    let head: ReturnType<typeof resolveNativeGitSnapshot>;
    let baseSha: string;
    let mergeBase: string;
    try {
      head = resolveNativeGitSnapshot(root, "HEAD");
      baseSha = resolveNativeGitSnapshot(root, options.base).commitSha;
      mergeBase = git("merge-base", baseSha, head.commitSha).trim();
    } catch {
      return publicFailureEnvelope(requestId, "AC_PRECONDITION_FAILED", "projection-slice-base-unresolved");
    }
    const headSha = head.commitSha;
    const assertClean = () => {
      const diff = ["diff", "--quiet", "--no-ext-diff", "--no-textconv", "--ignore-submodules=none"];
      for (const args of [["--"], ["--cached", headSha, "--"]]) {
        const result = spawnSync("git", [...gitArgs, ...diff, ...args], { ...gitOptions, stdio: "ignore" });
        if (result.status !== 0) throw new FailureError("AC_PRECONDITION_FAILED", "projection-slice-worktree-dirty");
      }
      if (decodeUtf8(readOnlyGit(root, "rev-parse", ["--verify", "--end-of-options", "HEAD^{commit}"])).trim() !== headSha) {
        throw new FailureError("AC_PRECONDITION_FAILED", "projection-inputs-changed-during-run", { field: "headSha" });
      }
    };
    assertClean();
    const diffPaths = git("diff", "--name-only", "-z", "--no-renames", `${mergeBase}..${headSha}`, "--").split("\0").filter(Boolean);
    const changedPaths = [...new Set([...diffPaths, ...options.changedPaths])].sort();
    assertReadyCodeGraphIndexWithoutWorktreeWrites(root);
    assertClean();
    const after = readProjectionSliceModel(root, head.treeOid);
    const before = mergeBase === headSha ? after : readProjectionSliceModel(root, mergeBase);
    const data: ProjectionSliceV1 = {
      schemaVersion: PROJECTION_SLICE_SCHEMA_VERSION,
      base: options.base,
      baseSha,
      mergeBase,
      headSha,
      changedPaths,
      ...renderArchitectureProjectionSlice({ before, after, changedPaths })
    };
    // SAFETY: The slice consists solely of JSON data.
    return okEnvelope(requestId, data as unknown as Json);
  } catch (error) {
    return publicOperationErrorEnvelope(requestId, error);
  }
}

function readProjectionSliceModel(root: string, tree: string) {
  const entries = readGitBlobTree(root, tree).filter(({ path }) => isSemanticModelPath(path)
    || path === ".archcontext/manifest.yaml" || path === ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH);
  if (entries.some(({ utf8Valid, mode }) => !utf8Valid || (mode !== "100644" && mode !== "100755"))) {
    throw new FailureError("AC_PRECONDITION_FAILED", "projection-slice-model-entry-invalid");
  }
  const blobs = readGitBlobs(root, entries);
  const files = new Map(entries.map((entry, index) => [entry.path, decodeUtf8(blobs[index]!)]));
  const manifest = files.get(ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH);
  return {
    model: loadNativeModelFromModelFiles(files),
    profile: manifest === undefined ? "default" as const : parseArchitectureDocumentationProfile(manifest)
  };
}

export interface RuntimeDocsProjectionCommandOptions extends RuntimeDocsProjectionInput {
  indexSynced?: boolean;
}

export async function runArchitectureDocsProjectionCommand(input: RuntimeDocsProjectionCommandOptions, cwd: string, daemon: ProjectionServiceHost) {
  try {
  const subcommand = input.action ?? "plan";
  const root = findRepositoryRoot(cwd);
  if (subcommand === "adopt") {
    const ignored = architectureModelIgnoredEnvelope("docs.adopt", root);
    if (ignored) return ignored;
  }
  let profile: ArchitectureProjectionProfile;
  let projection: ReturnType<typeof buildArchitectureDocsProjection>;
  let acceptedChange: AcceptedArchitectureChangeReferenceV1 | undefined;
  try {
    profile = input.profile ?? committedArchitectureDocsProfile(root);
    acceptedChange = input.acceptedChange;
    // `docs apply` is the one re-baseline of a superseded manifest (#327); every other surface refuses it.
    projection = buildArchitectureDocsProjection(daemon, root, profile, undefined, acceptedChange, {
      rebaselineSupersededManifest: subcommand === "apply",
      ...(input.indexSynced ? { indexSynced: true } : {})
    });
  } catch (error) {
    return projectionFailureEnvelope(`docs.${subcommand}`, error);
  }
  if (subcommand === "drift") {
    return okEnvelope("docs.drift", {
      schemaVersion: "archcontext.docs-drift/v1",
      ok: projection.plan.drift.ok,
      sourceDigest: projection.plan.sourceDigest,
      projectionDigest: projection.plan.projectionDigest,
      profile: projection.plan.profile,
      runtimeSnapshot: projection.runtimeSnapshot,
      rendererVersion: projection.plan.rendererVersion,
      targetCount: projection.plan.targets.length,
      fileCount: projection.plan.files.length,
      drift: projection.plan.drift,
      rejected: projection.plan.rejected,
      majorChange: projection.plan.majorChange,
      refreshSignals: projection.plan.refreshSignals,
      receiptDigest: projection.plan.receiptDigest
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
  if (subcommand === "adopt") {
    return await runArchitectureDocsAdoptionCommand(input, root, daemon, projection, profile);
  }
  if (projection.plan.rejected.length > 0) {
    const repair = `Architecture documentation projection requires explicit adoption or ownership repair: ${projection.plan.rejected.map((diff) => `${diff.path} (${diff.reasonCode})`).join(", ")}`;
    const unvouched = subcommand === "apply" ? rebaselineUnvouchedWholeFileOutputs(projection) : [];
    if (unvouched.length === 0) return publicFailureEnvelope("docs.plan", "AC_PRECONDITION_FAILED", "projection-ownership-repair-required", {issueCount: projection.plan.rejected.length});
    const commands = [`git rm -- ${unvouched.join(" ")}`, `archctx docs apply --approved --profile ${profile}`];
    const paths = unvouched.filter(path => Buffer.byteLength(path,"utf8") <= 256).slice(0, 8);
    const safeCommands = commands.filter(command => Buffer.byteLength(command,"utf8") <= 1024).slice(0, 2);
    return publicFailureEnvelope("docs.plan", "AC_PRECONDITION_FAILED", "projection-ambiguous-ownership", {
      pathCount: unvouched.length, paths, action: "remove-whole-file-outputs-and-reapply", commands: safeCommands,
      omittedPathCount: unvouched.length-paths.length, omittedCommandCount: commands.length-safeCommands.length
    });
  }
  // An orphan that may hold human text stops `plan` and `apply` before any write, as it stops the
  // protocol (#268). Writing the new manifest would drop the row that keeps a whole-file orphan
  // visible, so the file would silently stop being projection output (#327).
  const reviewOrphans = projectionReviewOrphans(projection);
  if (reviewOrphans.length > 0) {
    return publicFailureEnvelope("docs.plan", "AC_PRECONDITION_FAILED", "projection-orphan-review-required", {issueCount: reviewOrphans.length});
  }
  if (subcommand === "apply" && profile === REPO_HARNESS_PROJECTION_PROFILE && projection.plan.drift.ok) {
    return okEnvelope("docs.apply", {
      schemaVersion: "archcontext.docs-projection-apply/v1",
      status: "noop",
      profile,
      sourceDigest: projection.plan.sourceDigest,
      projectionDigest: projection.plan.projectionDigest,
      provenance: projection.plan.provenance,
      runtimeSnapshot: projection.runtimeSnapshot,
      majorChange: projection.plan.majorChange,
      refreshSignals: projection.plan.refreshSignals,
      receiptDigest: projection.plan.receiptDigest
    } as unknown as Json);
  }
  const changeSetId = input.id ?? docsProjectionChangeSetId(projection);
  // Generated-only orphans are deleted in the same ChangeSet that writes the manifest without their rows.
  const operations = architectureDocsRenderProjectionOperations(projection, projection.files, projectionOrphanDeleteOperations(projection).map((orphan) => orphan.operation));
  const plan = await daemon.planUpdate(root, {
    id: changeSetId,
    reason: { taskSessionId: input.taskSessionId ?? "task_docs_projection" },
    operations
  });
  if (!plan.ok) return plan;
  if (subcommand === "apply") {
    const expectedWorktreeDigest = input.expectedWorktreeDigest ?? computeWorktreeDigest(root, listGitVisibleFiles(root));
    const applied = await daemon.applyUpdate(root, {
      id: changeSetId,
      approved: input.approved === true,
      expectedWorktreeDigest
    });
    return withProjectionMetadata(
      applied,
      projection.plan.provenance,
      projection.runtimeSnapshot,
      projection.plan.majorChange,
      projection.plan.refreshSignals,
      projection.plan.receiptDigest
    );
  }
  return okEnvelope("docs.plan", {
    schemaVersion: "archcontext.docs-projection-change-set/v1",
    sourceDigest: projection.plan.sourceDigest,
    projectionDigest: projection.plan.projectionDigest,
    rendererVersion: projection.plan.rendererVersion,
    targetCount: projection.plan.targets.length,
    fileCount: projection.files.length,
    drift: projection.plan.drift,
    provenance: projection.plan.provenance,
    runtimeSnapshot: projection.runtimeSnapshot,
    majorChange: projection.plan.majorChange,
    refreshSignals: projection.plan.refreshSignals,
    receiptDigest: projection.plan.receiptDigest,
    manifestPath: projection.manifest.path,
    draft: (plan.data as any).draft,
    preview: (plan.data as any).preview
  } as unknown as Json);
  } catch (error) { throw publicOperationFailure(error); }
}

/**
 * Model paths that Git ignore rules exclude, each with its deciding rule. A file under an ignored
 * directory is not repeated, so a blanket `/.archcontext/` rule reports the committed paths only.
 */
export function ignoredArchitectureModelPaths(root: string): IgnoredRepositoryPath[] {
  const ignored = ignoredRepositoryPaths(root, architectureModelIgnoreProbePaths(root));
  const directories = ignored.filter((entry) => entry.path.endsWith("/")).map((entry) => entry.path);
  return ignored.filter((entry) => entry.path.endsWith("/") || !directories.some((directory) => entry.path.startsWith(directory)));
}

/**
 * Adoption commits documents and a manifest that name the model only by digest. When Git ignore
 * rules exclude the model, it lives in this checkout alone and is lost with it (#399), so adoption
 * refuses before it renders. The diagnostic command lets Git print each deciding rule.
 */
function architectureModelIgnoredEnvelope(requestId: string, root: string): JsonEnvelope | undefined {
  const ignored = ignoredArchitectureModelPaths(root);
  if (ignored.length === 0) return undefined;
  const paths = ignored.map((entry) => entry.path).slice(0, 8);
  return publicFailureEnvelope(requestId, "AC_PRECONDITION_FAILED", "architecture-model-ignored", {
    pathCount: ignored.length,
    paths,
    commands: [`git check-ignore --verbose --no-index -- ${paths.join(" ")}`],
    omittedPathCount: ignored.length - paths.length
  });
}

/**
 * The profile a `docs` command uses when the caller names none: the one the committed manifest
 * records, so `drift`, `plan` and `apply` keep the layout the repository already has (#293). A
 * repository without a manifest uses `default`. An invalid manifest profile fails closed.
 */
export function committedArchitectureDocsProfile(root: string): ArchitectureProjectionProfile {
  return existsSync(resolve(root, ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH)) ? loadArchitectureDocumentationProfile(root) : "default";
}

/**
 * Carries the projection metadata onto the `apply` envelope, which otherwise comes straight from
 * the daemon and would only describe the ChangeSet.
 */
function withProjectionMetadata(
  envelope: JsonEnvelope,
  provenance: ArchitectureDocumentationProjectionProvenanceV3,
  runtimeSnapshot: ArchitectureDocumentationProjectionRuntimeSnapshot,
  majorChange: ArchitectureMajorChangeClassificationV1,
  refreshSignals: ArchitectureRefreshSignalV2[],
  receiptDigest: string
): JsonEnvelope {
  if (!envelope.ok) return envelope;
  return {
    ...envelope,
    data: {
      ...(envelope.data as Record<string, Json>),
      provenance: provenance as unknown as Json,
      runtimeSnapshot: runtimeSnapshot as unknown as Json,
      majorChange: majorChange as unknown as Json,
      refreshSignals: refreshSignals as unknown as Json,
      receiptDigest
    }
  };
}

/**
 * `isolateBlockedCapabilities`: `projection run` only (check, plan and apply without an accepted
 * change). See `renderArchitectureDocumentationProjection`.
 */
type ArchitectureDocsRenderOptions = { rebaselineSupersededManifest?: boolean; isolateBlockedCapabilities?: boolean; indexSynced?: boolean };

/**
 * The architecture history a render is given (ADR-0056 §8), read only when the request names the
 * `architecture-history` target or the committed row cannot be carried forward: there is none, or
 * `history.md` is missing or does not digest to it. Every other render carries the intact row and
 * bytes forward and reads no Git history, so it works in a shallow clone. A read in a shallow clone
 * fails with `history-shallow-repository`, whose `historyReadReason` says why history was read.
 */
export function architectureHistoryRenderInput(
  root: string,
  profile: ArchitectureProjectionProfile,
  existingFiles: readonly ProjectionOwnedFile[],
  historyTargetNamed: boolean
): { architectureHistory?: ArchitectureHistory } {
  if (profile !== REPO_HARNESS_PROJECTION_PROFILE) return {};
  const body = (path: string) => existingFiles.find((file) => file.path === path)?.body;
  const readReason = historyTargetNamed ? "target-named" : architectureHistoryCarryForwardBlocker(body(ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH), body(ARCHITECTURE_HISTORY_TARGET.path));
  if (readReason === undefined) return {};
  // The engine selects the window, so the whole history is read.
  return { architectureHistory: readArchitectureHistory(root, { limit: Number.MAX_SAFE_INTEGER, readReason }) };
}

export function buildArchitectureDocsProjection(
  _host: ProjectionServiceHost | undefined,
  root: string,
  profile: ArchitectureProjectionProfile = "default",
  existingFilesOverride?: ProjectionOwnedFile[],
  acceptedChange?: AcceptedArchitectureChangeReferenceV1,
  options: ArchitectureDocsRenderOptions & { historyTargetNamed?: boolean } = {},
  readInputs?: ProjectionCheckReadInputs
) {
  const inputs = measureArchitectureDocsProjectionInputs(root, profile, existingFilesOverride, options.historyTargetNamed === true, options.rebaselineSupersededManifest === true, readInputs, options.indexSynced === true);
  return renderArchitectureDocsProjectionFromInputs(root, inputs, existingFilesOverride ?? inputs.loaded.existingFiles, acceptedChange, options);
}

/**
 * A docs projection ChangeSet is named after the projection-owned output bytes it writes, the
 * manifest included, so equal ids mean equal writes.
 */
function docsProjectionChangeSetId(projection: ReturnType<typeof buildArchitectureDocsProjection>): string {
  return `changeset.docs-projection-${projectionOwnedOutputDigest(projection).replace(/^sha256:/, "").slice(0, 16)}`;
}

function projectionOwnedOutputDigest(projection: ReturnType<typeof buildArchitectureDocsProjection>): Sha256Digest {
  return digestJson({
    schemaVersion: "archcontext.projection-owned-output/v1",
    files: projection.files.map((file) => ({ path: file.path, body: file.body }))
      .sort((left, right) => left.path.localeCompare(right.path))
  } as unknown as Json) as Sha256Digest;
}

/**
 * Everything a projection build reads from the repository before it renders: the model, decisions
 * and existing documents, the CodeGraph snapshot, and the scale signals of that snapshot's
 * footprints. The render is a function of these, the existing documents it is
 * given and the accepted change.
 */
interface ProjectionCheckReadInputs {
  model(): ReturnType<typeof loadNativeModelFromArchContext>;
  machines(): ReturnType<typeof loadStateMachinesFromArchContext>;
  prepareCodeGraph(): ReturnType<typeof prepareArchitectureDocumentationProjectionSnapshot>;
}

function measureArchitectureDocsProjectionInputs(root: string, profile: ArchitectureProjectionProfile, existingFilesOverride: ProjectionOwnedFile[] | undefined, historyTargetNamed: boolean, rebaselineSupersededManifest: boolean, readInputs?: ProjectionCheckReadInputs, indexSynced = false) {
  const loaded = loadArchitectureDocumentationInputs(root, profile, { rebaselineSupersededManifest, model: readInputs?.model() });
  const sourceDigest = architectureDocumentationSourceDigest({ model: loaded.model, profile, decisions: loaded.decisions });
  const codeGraphInputs = readInputs ? readInputs.prepareCodeGraph() : prepareArchitectureDocumentationProjectionSnapshot(root, loaded.model, indexSynced ? { indexSynced: true } : {});
  assertProjectionCodeFactsAvailable(root, codeGraphInputs);
  return {
    profile,
    loaded,
    stateMachines: readInputs?.machines() ?? loadStateMachinesFromArchContext(root, loaded.model.nodes),
    sourceDigest,
    codeGraphInputs,
    sourceScaleSignals: measureCapabilitySourceScaleSignals(root, loaded.model, codeGraphInputs.footprints),
    ...architectureHistoryRenderInput(root, profile, existingFilesOverride ?? loaded.existingFiles, historyTargetNamed)
  };
}

/**
 * Renders `previous`'s measured inputs again against other existing documents or another accepted
 * change, without measuring the repository a second time (#324). The inputs are reused only when
 * they are provably equal: HEAD, the projection worktree digest (the bytes of every Git-visible
 * file outside projection outputs and harness state) and the whole Git-visible file list (which
 * also covers the paths that digest skips) must all equal what `previous` measured. Otherwise this
 * throws; it never renders over inputs it cannot prove current. The existing documents are always
 * passed in: they are projection-owned outputs outside the worktree digest, so no digest proves
 * them unchanged.
 */
function rerenderArchitectureDocsProjection(
  root: string,
  previous: ReturnType<typeof buildArchitectureDocsProjection>,
  existingFiles: ProjectionOwnedFile[],
  acceptedChange?: AcceptedArchitectureChangeReferenceV1,
  options: ArchitectureDocsRenderOptions = {}
) {
  const { inputs } = previous;
  const measured = inputs.codeGraphInputs;
  const sourceFiles = listGitVisibleFiles(root);
  if (readHeadSha(root) !== measured.runtimeSnapshot.headSha) throw new FailureError("AC_PRECONDITION_FAILED", "projection-inputs-changed-during-run", {field:"headSha"});
  if (architectureDocumentationProjectionWorktreeDigest(root, inputs.loaded.model, sourceFiles) !== measured.runtimeSnapshot.worktreeDigest) {
    throw new FailureError("AC_PRECONDITION_FAILED", "projection-inputs-changed-during-run", {field:"worktreeDigest"});
  }
  if (sourceFiles.length !== measured.sourceFiles.length || sourceFiles.some((path, index) => path !== measured.sourceFiles[index])) {
    throw new FailureError("AC_PRECONDITION_FAILED", "projection-inputs-changed-during-run", {field:"sourceFiles"});
  }
  return renderArchitectureDocsProjectionFromInputs(root, inputs, existingFiles, acceptedChange, options);
}

function renderArchitectureDocsProjectionFromInputs(
  root: string,
  inputs: ReturnType<typeof measureArchitectureDocsProjectionInputs>,
  existingFiles: ProjectionOwnedFile[],
  acceptedChange: AcceptedArchitectureChangeReferenceV1 | undefined,
  options: ArchitectureDocsRenderOptions = {}
) {
  const { profile, sourceDigest, codeGraphInputs } = inputs;
  const loaded = { ...inputs.loaded, existingFiles };
  const provenance = codeGraphInputs.provenance;
  const plan = renderArchitectureDocumentationProjection({
    model: loaded.model,
    stateMachines: inputs.stateMachines,
    profile,
    decisions: loaded.decisions,
    existingFiles: loaded.existingFiles,
    docsLanguage: loaded.docsLanguage,
    sourceScaleSignals: inputs.sourceScaleSignals,
    importGraphs: codeGraphInputs.importGraphs,
    selectorEvidence: codeGraphInputs.selectorEvidence,
    provenance,
    sourceDigest,
    ...(inputs.architectureHistory ? { architectureHistory: inputs.architectureHistory } : {}),
    ...(options.rebaselineSupersededManifest ? { rebaselineSupersededManifest: true } : {}),
    ...(options.isolateBlockedCapabilities ? { isolateBlockedCapabilities: true } : {}),
    refreshContext: {
      repositoryId: repositoryFingerprint(root),
      workspaceId: projectionWorkspaceId(root),
      headSha: codeGraphInputs.runtimeSnapshot.headSha,
      worktreeDigest: codeGraphInputs.runtimeSnapshot.worktreeDigest,
      ...(acceptedChange ? { acceptedChange } : {})
    }
  });
  return {
    /** What this render measured; `rerenderArchitectureDocsProjection` reuses it when it is still current. */
    inputs,
    loaded,
    plan,
    importEvidence: { root, sourceFiles: codeGraphInputs.sourceFiles, population: codeGraphInputs.importPopulation },
    runtimeSnapshot: codeGraphInputs.runtimeSnapshot,
    manifest: plan.manifest,
    files: [...plan.files, plan.manifest],
    /** This render's measured per-capability proof evidence, which committed acceptance compares with the manifest's. */
    snapshotEvidence: plan.proofEvidence
  };
}



async function runArchitectureDocsAdoptionCommand(
  input: RuntimeDocsProjectionInput,
  root: string,
  daemon: ProjectionServiceHost,
  projection: ReturnType<typeof buildArchitectureDocsProjection>,
  profile: ArchitectureProjectionProfile,
  protocolRequest?: ProjectionRequestV1,
  acceptedChange?: AcceptedArchitectureChangeReferenceV1
) {
  if (profile !== REPO_HARNESS_PROJECTION_PROFILE) {
    return publicFailureEnvelope("docs.adopt", "AC_SCHEMA_INVALID", "projection-adoption-profile-invalid", {});
  }
  const currentWorktreeDigest = computeWorktreeDigest(root, listGitVisibleFiles(root));
  const existingByPath = new Map(projection.loaded.existingFiles.map((file) => [file.path, file.body]));
  const missingCandidate = projection.plan.adoptionCandidates.find((file) => !existingByPath.has(file.path));
  if (missingCandidate) {
    return publicFailureEnvelope("docs.adopt", "AC_PRECONDITION_FAILED", "projection-adoption-preimage-missing", {});
  }
  const adoption = buildArchitectureDocumentationAdoptionPlan({
    profile,
    expectedWorktreeDigest: currentWorktreeDigest,
    candidates: projection.plan.adoptionCandidates.map((file) => ({
      path: file.path,
      existingBody: existingByPath.get(file.path)!,
      renderedBody: file.body,
      target: file.target
    }))
  });
  const publicPlan = {
    ...adoption,
    files: adoption.files.map(({ body: _body, ...file }) => file)
  };
  if (input.approved !== true) {
    return okEnvelope("docs.adopt", publicPlan as unknown as Json);
  }
  if (!adoption.allowed) {
    return publicFailureEnvelope("docs.adopt", "AC_PRECONDITION_FAILED", "projection-adoption-refused", {issueCount: adoption.issues.length});
  }
  const reviewOrphans = projectionReviewOrphans(projection);
  if (reviewOrphans.length > 0) {
    return publicFailureEnvelope("docs.adopt", "AC_PRECONDITION_FAILED", "projection-orphan-review-required", {issueCount: reviewOrphans.length});
  }
  const expectedPlanId = input.adoptionPlanId;
  const expectedWorktreeDigest = input.expectedWorktreeDigest;
  if (!expectedPlanId || !expectedWorktreeDigest) {
    return publicFailureEnvelope("docs.adopt", "AC_SCHEMA_INVALID", "projection-adoption-approval-input-invalid", {});
  }
  if (expectedPlanId !== adoption.adoptionPlanId || expectedWorktreeDigest !== adoption.expectedWorktreeDigest) {
    return publicFailureEnvelope("docs.adopt", "AC_PRECONDITION_FAILED", "projection-adoption-preview-mismatch", {});
  }
  const simulatedByPath = new Map(projection.loaded.existingFiles.map((file) => [file.path, file]));
  // The adoption write also deletes generated-only orphans, so the fixed point is proven without them.
  const orphanDeletes = projectionOrphanDeleteOperations(projection);
  for (const orphan of orphanDeletes) simulatedByPath.delete(orphan.operation.path);
  for (const file of [...projection.files, ...adoption.files]) simulatedByPath.set(file.path, simulatedProjectionFile(file));
  const canonicalFirst = buildArchitectureDocsProjection(daemon, root, profile, [...simulatedByPath.values()]);
  const canonicalExistingByPath = new Map(simulatedByPath);
  for (const file of canonicalFirst.files) canonicalExistingByPath.set(file.path, simulatedProjectionFile(file));
  // Adoption changes whole-document digests. Refresh signal IDs then settle against that
  // canonical baseline in the manifest before a final render can prove the fixed point.
  const canonicalBaseline = buildArchitectureDocsProjection(daemon, root, profile, [...canonicalExistingByPath.values()]);
  for (const file of canonicalBaseline.files) canonicalExistingByPath.set(file.path, simulatedProjectionFile(file));
  const canonical = buildArchitectureDocsProjection(daemon, root, profile, [...canonicalExistingByPath.values()]);
  if (!canonical.plan.drift.ok || canonical.plan.rejected.length > 0 || canonical.plan.projectionDigest !== canonicalFirst.plan.projectionDigest) {
    const reasons = canonical.plan.rejected.map((entry) => entry.reasonCode).join(",") || "none";
    const drift = canonical.plan.drift.diffs.map((entry) => `${entry.path}:${entry.reasonCode}`).join(",") || "none";
    return publicFailureEnvelope("docs.adopt", "AC_PRECONDITION_FAILED", "projection-adoption-fixed-point-unproven", {driftCount: canonical.plan.drift.diffs.length, rejectedCount: canonical.plan.rejected.length, digestStable: canonical.plan.projectionDigest === canonicalFirst.plan.projectionDigest});
  }
  if (protocolRequest) {
    return applyProjectionProtocolFixedPoint(protocolRequest, projection, canonical, adoption.changeSetId, root, daemon, acceptedChange);
  }
  const filesByPath = new Map<string, { path: string; body: string }>();
  for (const file of canonical.files) filesByPath.set(file.path, file);
  const planned = await daemon.planUpdate(root, {
    id: adoption.changeSetId,
    reason: { taskSessionId: input.taskSessionId ?? "task_docs_adoption" },
    operations: architectureDocsRenderProjectionOperations(projection, [...filesByPath.values()], orphanDeletes.map((orphan) => orphan.operation))
  });
  if (!planned.ok) return planned;
  const applied = await daemon.applyUpdate(root, {
    id: adoption.changeSetId,
    approved: true,
    expectedWorktreeDigest
  });
  if (!applied.ok) return applied;
  return okEnvelope("docs.adopt", {
    ...architectureAdoptionReceipt(adoption),
    apply: applied.data
  } as unknown as Json);
}

async function applyProjectionProtocolFixedPoint(
  request: ProjectionRequestV1,
  input: ReturnType<typeof buildArchitectureDocsProjection>,
  fixedPoint: ReturnType<typeof buildArchitectureDocsProjection>,
  changeSetId: string,
  root: string,
  daemon: ProjectionServiceHost,
  acceptedChange: AcceptedArchitectureChangeReferenceV1 | undefined
): Promise<JsonEnvelope> {
  const orphanDeletes = projectionOrphanDeleteOperations(input);
  const committedFiles = projectionWriteFileResults(input.loaded.existingFiles, fixedPoint.files, orphanDeletes);
  const committedSignals = acceptedChange
    ? input.plan.refreshSignals.map((signal) => ({
        ...signal,
        resultingDigests: fixedPoint.plan.architectureDigests
      }))
    : fixedPoint.plan.refreshSignals;
  if (acceptedChange && fixedPoint.runtimeSnapshot.codeGraphStatus !== "ready") {
    return projectionFailureEnvelope("projection.run", new ProjectionCodeFactsUnavailableError(fixedPoint.inputs.codeGraphInputs.handshake.reasonCode ?? "index-missing"));
  }
  const appliedResult = projectionProtocolResult(request, input, fixedPoint.plan.isolation ? "applied-partial" : "applied", fixedPoint, undefined, {
    files: committedFiles,
    refreshSignals: committedSignals
  });
  const planned = await daemon.planUpdate(root, {
    id: changeSetId,
    reason: { taskSessionId: request.requestId },
    operations: architectureDocsRenderProjectionOperations(
      input,
      fixedPoint.files,
      orphanDeletes.map((orphan) => orphan.operation),
      fixedPoint.plan.isolation?.blockedTargets.map((target) => target.path) ?? []
    ),
    worktreeDigestPrecondition: {
      profile: "architecture-documentation-projection",
      expectedDigest: request.expected.worktreeDigest
    }
  });
  if (!planned.ok) return planned;
  const applied = await daemon.applyUpdate(root, {
    id: changeSetId,
    approved: true,
    expectedWorktreeDigest: request.expected.worktreeDigest,
    worktreeDigestProfile: "architecture-documentation-projection"
  });
  if (!applied.ok) return applied;
  return projectionProtocolResultEnvelope(appliedResult);
}

/**
 * Stable cross-repository projection protocol (in-process v2).
 */
export async function runProjectionProtocolCommand(invocation: RuntimeProjectionInvocation, cwd: string, daemon: ProjectionServiceHost): Promise<JsonEnvelope> {
  try {
  if (invocation.action !== "run") return publicFailureEnvelope("projection", "AC_SCHEMA_INVALID", "projection-input-invalid", {});
  const raw = JSON.stringify(invocation.request);

  let request: ProjectionRequestV1;
  try {
    request = parseProjectionProtocolRequest(raw);
  } catch {
    return publicFailureEnvelope("projection.run", "AC_SCHEMA_INVALID", "projection-input-invalid", {});
  }

  if (request.mode === "check") return runProjectionCheckCommand(request, findRepositoryRoot(cwd));

  const root = findRepositoryRoot(cwd);
  const historyTargetNamed = request.targets.includes("architecture-history");
  if (request.mode === "adopt") {
    const ignored = architectureModelIgnoredEnvelope("projection.run", root);
    if (ignored) return ignored;
  }
  let observed: ReturnType<typeof buildArchitectureDocsProjection> | undefined;
  let acceptedChange = request.acceptedChange;
  let declinedUnprovableNodeIds: string[] | undefined;
  if (request.acceptObservedMajorChange === true) {
    try {
      observed = buildArchitectureDocsProjection(daemon, root, REPO_HARNESS_PROJECTION_PROFILE, undefined, undefined, { historyTargetNamed });
      assertProjectionExpectedSnapshot(request, root, observed);
    } catch (error) {
      return projectionFailureEnvelope("projection.run", error);
    }
    const acceptance = observedMajorChangeAcceptance(request, observed);
    if (acceptance && "acceptedChange" in acceptance) acceptedChange = acceptance.acceptedChange;
    else if (acceptance) declinedUnprovableNodeIds = acceptance.unprovableNodeIds;
  }
  const isolation: { isolateBlockedCapabilities?: boolean } = request.mode !== "adopt" && acceptedChange === undefined ? { isolateBlockedCapabilities: true } : {};
  let projection: ReturnType<typeof buildArchitectureDocsProjection>;
  try {
    projection = observed === undefined
      ? buildArchitectureDocsProjection(daemon, root, REPO_HARNESS_PROJECTION_PROFILE, undefined, acceptedChange, { ...isolation, historyTargetNamed })
      : acceptedChange === undefined && (isolation.isolateBlockedCapabilities !== true || observed.plan.majorChange.mode !== "human-action-required")
        ? observed
        : rerenderArchitectureDocsProjection(root, observed, observed.loaded.existingFiles, acceptedChange, isolation);
    assertProjectionExpectedSnapshot(request, root, projection);
  } catch (error) {
    return projectionFailureEnvelope("projection.run", error);
  }

  const blocked = projectionProtocolHumanStatus(request, projection);
  if (blocked) return projectionProtocolEnvelope(request, projection, blocked, projection, undefined, declinedUnprovableNodeIds);

  if (request.mode === "adopt") {
    const expectedWorktreeDigest = computeWorktreeDigest(root, listGitVisibleFiles(root));
    const adopted = await runArchitectureDocsAdoptionCommand({
      action: "adopt", profile: REPO_HARNESS_PROJECTION_PROFILE, approved: true,
      adoptionPlanId: request.adoptionPlanId!, expectedWorktreeDigest,
      taskSessionId: request.requestId
    }, root, daemon, projection, REPO_HARNESS_PROJECTION_PROFILE, request, acceptedChange);
    if (!adopted.ok) return adopted;
    return adopted;
  }

  if (request.mode === "apply" && !projection.plan.drift.ok) {
    let fixedPointProjection: ReturnType<typeof buildArchitectureDocsProjection>;
    try {
      fixedPointProjection = acceptedChange
        ? rerenderArchitectureDocsProjection(root, projection, projection.files.map(simulatedProjectionFile))
        : projection;
      if (acceptedChange && (
        fixedPointProjection.plan.rejected.length > 0
        || fixedPointProjection.plan.majorChange.mode !== "none"
        || fixedPointProjection.plan.refreshSignals.length > 0
      )) {
        return publicFailureEnvelope("projection.run", "AC_PRECONDITION_FAILED", "projection-accepted-fixed-point-unproven", {});
      }
    } catch (error) {
      return projectionFailureEnvelope("projection.run", error);
    }
    return applyProjectionProtocolFixedPoint(request, projection, fixedPointProjection, docsProjectionChangeSetId(fixedPointProjection), root, daemon, acceptedChange);
  }

  return projectionProtocolEnvelope(request, projection, projectionPlannedStatus(projection), projection);
  } catch (error) { throw publicOperationFailure(error); }
}

/** `check` and `plan` without a human action: nothing to write, a complete plan, or a partial one. */
function projectionPlannedStatus(projection: ReturnType<typeof buildArchitectureDocsProjection>): ProjectionResultV3["status"] {
  if (projection.plan.isolation) return "planned-partial";
  return projection.plan.drift.ok ? "noop" : "planned";
}

/**
 * `projection run` in `check` mode, computed in-process and read-only end to end: it reads
 * repository files and the committed manifest, and never reaches the daemon. No runtime client is
 * started, no journal is read, no runtime state is written and no task session is opened, so a CI
 * job or a hook can ask "is the projection current?" without a daemon. A check never commits, so
 * it has no prior committed applies to report; `apply` and `readback` own that journal.
 */
export function runProjectionCheckCommand(request: ProjectionRequestV1, root: string, readInputs?: ProjectionCheckReadInputs): JsonEnvelope {
  try { return publicOperationResult("projection.run", runProjectionCheckCommandUnchecked(request, root, readInputs)) as JsonEnvelope; }
  catch (error) { throw publicOperationFailure(error); }
}

function runProjectionCheckCommandUnchecked(request: ProjectionRequestV1, root: string, readInputs?: ProjectionCheckReadInputs): JsonEnvelope {
  if (request.mode !== "check") {
    return publicFailureEnvelope("projection.run", "AC_SCHEMA_INVALID", "projection-check-mode-invalid");
  }
  const manifestPath = ".archcontext/manifest.yaml";
  if (existsSync(resolve(root, manifestPath))) {
    const diagnostics = manifestDecisionDiagnostics([{ path: manifestPath, body: readFileSync(resolve(root, manifestPath), "utf8") }]);
    if (diagnostics.length) return publicFailureEnvelope("projection.run", "AC_SCHEMA_INVALID", "native-context-model-invalid", { path: manifestPath, invariant: diagnostics[0]! });
  }
  let projection: ReturnType<typeof buildArchitectureDocsProjection>;
  try {
    projection = buildArchitectureDocsProjection(undefined, root, REPO_HARNESS_PROJECTION_PROFILE, undefined, request.acceptedChange, {
      ...(request.acceptedChange === undefined ? { isolateBlockedCapabilities: true } : {}),
      historyTargetNamed: request.targets.includes("architecture-history")
    }, readInputs);
    assertProjectionExpectedSnapshot(request, root, projection);
  } catch (error) {
    if (error instanceof ProjectionExpectedSnapshotMismatchError) return publicFailureEnvelope("projection.run", "AC_PRECONDITION_FAILED", "projection-snapshot-mismatch", {field: error.field});
    return publicOperationErrorEnvelope("projection.run", error);
  }
  const freshness = projectionFreshnessContract(projection.plan.freshness);
  const status = projectionProtocolHumanStatus(request, projection) ?? projectionPlannedStatus(projection);
  const result = projectionProtocolEnvelope(request, projection, status, projection, freshness);
  return result.ok ? result : publicFailureEnvelope("projection.run", "AC_SCHEMA_INVALID", "projection-result-invalid");
}

/**
 * The CLI's daemonless entry for `projection run --request-json` in `check` mode: the raw request
 * is decoded and validated here, before any runtime client exists.
 */
export function runProjectionCheckInvocation(rawRequest: unknown, cwd: string): JsonEnvelope {
  try { return publicOperationResult("projection.run", runProjectionCheckInvocationUnchecked(rawRequest, cwd)) as JsonEnvelope; }
  catch (error) { throw publicOperationFailure(error); }
}

function runProjectionCheckInvocationUnchecked(rawRequest: unknown, cwd: string): JsonEnvelope {
  let request: ProjectionRequestV1;
  try {
    request = parseProjectionProtocolRequest(JSON.stringify(rawRequest));
  } catch (error) {
    return publicFailureEnvelope("projection.run", "AC_SCHEMA_INVALID", "projection-check-input-invalid");
  }
  return runProjectionCheckCommand(request, findRepositoryRoot(cwd));
}

/**
 * The accepted change `acceptObservedMajorChange` authorizes: exactly the major change this run
 * classified. Undefined when there is none.
 */
function observedMajorChangeAcceptance(
  request: ProjectionRequestV1,
  observed: ReturnType<typeof buildArchitectureDocsProjection>
): { acceptedChange: AcceptedArchitectureChangeReferenceV1 } | { unprovableNodeIds: string[] } | undefined {
  const majorChange = observed.plan.majorChange;
  if (majorChange.mode !== "human-action-required") return undefined;
  const unprovableNodeIds = observed.plan.semanticState.capabilities
    .filter((capability) => capability.proofStatus.p1 === "unprovable" || capability.proofStatus.p2 === "unprovable")
    .map((capability) => capability.capabilityId)
    .sort();
  if (unprovableNodeIds.length > 0) return { unprovableNodeIds };
  const key = digestJson({
    schemaVersion: "archcontext.observed-major-change-acceptance/v1",
    expected: request.expected,
    reasonCodes: majorChange.reasonCodes,
    affectedNodeIds: majorChange.affectedNodeIds,
    resultingDigests: observed.plan.architectureDigests
  } as unknown as Json).replace(/^sha256:/, "").slice(0, 16);
  return {
    acceptedChange: {
      changeSetId: `changeset.observed-major-change-${key}`,
      eventId: `projection_event.observed_major_change.${key}`,
      reasonCodes: [...majorChange.reasonCodes],
      affectedNodeIds: [...majorChange.affectedNodeIds]
    }
  };
}

/**
 * The whole-file (`generated`) outputs a `docs apply` re-baseline of a superseded manifest refuses
 * as `projection-ambiguous-ownership`: the superseded rows are never read, so no current-format
 * row proves the projection wrote them (#327). Only the operator removes them; nothing here
 * deletes a file. Outside a re-baseline the generic ownership repair applies.
 */
function rebaselineUnvouchedWholeFileOutputs(projection: ReturnType<typeof buildArchitectureDocsProjection>): string[] {
  const committedManifest = projection.loaded.existingFiles.find((file) => file.path === ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH);
  if (!committedManifest || !isSupersededArchitectureDocsProjectionManifestSchemaVersion(architectureDocsProjectionManifestSchemaVersion(committedManifest.body))) return [];
  const wholeFileTargetIds = new Set(projection.plan.targets.filter((target) => target.ownership === "generated").map((target) => target.targetId));
  return [...new Set(projection.plan.rejected
    .filter((diff) => diff.reasonCode === "projection-ambiguous-ownership" && diff.targetId !== undefined && wholeFileTargetIds.has(diff.targetId))
    .map((diff) => diff.path))]
    .sort();
}

/**
 * A projection that cannot be built fails its precondition, except for two environment states with
 * their own typed codes, so a consumer can tell them apart from a real architecture change:
 * required code facts are missing (`AC_CODE_FACTS_UNAVAILABLE`), or the root is not a Git worktree
 * whose files footprints could be measured over (`AC_REPO_NOT_FOUND`, `git-worktree-required`).
 */
export function projectionFailureEnvelope(requestId: string, error: unknown): JsonEnvelope {
  return publicOperationErrorEnvelope(requestId, error);
}

function parseProjectionProtocolRequest(raw: string): ProjectionRequestV1 {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("projection request is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("projection request must be an object");
  const input = value as Record<string, unknown>;
  const expected = input.expected;
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) throw new Error("projection request.expected must be an object");
  const snapshot = expected as Record<string, unknown>;
  if (input.schemaVersion !== PROJECTION_REQUEST_SCHEMA_VERSION) throw new Error("projection request schemaVersion mismatch");
  if (input.profile !== REPO_HARNESS_PROJECTION_PROFILE) throw new Error(`projection request profile must be ${REPO_HARNESS_PROJECTION_PROFILE}`);
  if (typeof input.mode !== "string" || !(PROJECTION_MODES as readonly string[]).includes(input.mode)) throw new Error("projection request mode is invalid");
  if (!Array.isArray(input.targets) || input.targets.some((target) => typeof target !== "string" || !(PROJECTION_TARGETS as readonly string[]).includes(target))) throw new Error("projection request targets are invalid");
  if (!Array.isArray(input.changedPaths) || input.changedPaths.some((path) => typeof path !== "string" || !isRepoRelativePosixPath(path))) throw new Error("projection request changedPaths must be repository-relative POSIX paths");
  if (typeof input.requestId !== "string") throw new Error("projection request requestId is required");
  if (typeof snapshot.repositoryId !== "string" || typeof snapshot.workspaceId !== "string") throw new Error("projection request repository/workspace identity is required");
  if (typeof snapshot.headSha !== "string" || !/^[a-f0-9]{40}$/.test(snapshot.headSha)) throw new Error("projection request expected.headSha is invalid");
  if (typeof snapshot.worktreeDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(snapshot.worktreeDigest)) throw new Error("projection request expected.worktreeDigest is invalid");
  if (input.acceptedChange !== undefined) validateProjectionAcceptedChange(input.acceptedChange);
  const request = input as unknown as ProjectionRequestV1;
  const issues = projectionRequestInvariantIssues(request);
  if (issues.length > 0) throw new Error(`projection request invariant failed: ${issues.join("; ")}`);
  return request;
}

function validateProjectionAcceptedChange(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("projection request acceptedChange must be an object");
  }
  const accepted = value as Record<string, unknown>;
  const supportedKeys = new Set(["changeSetId", "eventId", "reasonCodes", "affectedNodeIds"]);
  const unsupportedKey = Object.keys(accepted).find((key) => !supportedKeys.has(key));
  if (unsupportedKey) throw new Error(`projection request acceptedChange contains unsupported property: ${unsupportedKey}`);
  if (typeof accepted.changeSetId !== "string" || typeof accepted.eventId !== "string") {
    throw new Error("projection request acceptedChange changeSetId and eventId are required");
  }
  if (!Array.isArray(accepted.reasonCodes) || accepted.reasonCodes.some((reason) => typeof reason !== "string")) {
    throw new Error("projection request acceptedChange reasonCodes must be a string array");
  }
  if (!Array.isArray(accepted.affectedNodeIds) || accepted.affectedNodeIds.some((nodeId) => typeof nodeId !== "string")) {
    throw new Error("projection request acceptedChange affectedNodeIds must be a string array");
  }
}

/**
 * The `ProjectionRequestV1.expected` snapshot a projection request is checked against, observed
 * now. It is the only computation of that snapshot: every `projection run` mode compares the
 * request's `expected` with it field by field, and `projection snapshot` returns it to consumers,
 * so no consumer re-implements the worktree digest.
 */
export function currentProjectionExpectedSnapshot(
  root: string,
  model: ReturnType<typeof loadNativeModelFromArchContext>,
  files = listGitVisibleFiles(root)
): ProjectionExpectedSnapshotV1 {
  return {
    repositoryId: repositoryFingerprint(root),
    workspaceId: projectionWorkspaceId(root),
    headSha: readHeadSha(root),
    worktreeDigest: architectureDocumentationProjectionWorktreeDigest(root, model, files) as Sha256Digest
  };
}

/**
 * `projection snapshot`: the `expected` snapshot a `projection run` request would be checked
 * against right now, from `currentProjectionExpectedSnapshot`. Read-only and in-process like
 * `check`: no daemon, no local store, no task session, no CodeGraph sync and no render. A root
 * that is not a Git worktree fails with `AC_REPO_NOT_FOUND` (`git-worktree-required`).
 */
export function runProjectionSnapshotCommand(cwd: string, inputs?: { model: ProjectionCheckReadInputs["model"]; files(): string[] }): JsonEnvelope {
  try { return publicOperationResult("projection.snapshot", runProjectionSnapshotCommandUnchecked(cwd, inputs)) as JsonEnvelope; }
  catch (error) { return publicOperationErrorEnvelope("projection.snapshot", error); }
}

function runProjectionSnapshotCommandUnchecked(cwd: string, inputs?: { model: ProjectionCheckReadInputs["model"]; files(): string[] }): JsonEnvelope {
  let root: string;
  try {
    root = findRepositoryRoot(cwd);
  } catch (error) {
    return publicFailureEnvelope("projection.snapshot", "AC_REPO_NOT_FOUND", "git-worktree-required");
  }
  try {
    return okEnvelope("projection.snapshot", {
      expected: currentProjectionExpectedSnapshot(root, inputs?.model() ?? loadNativeModelFromArchContext(root), inputs?.files())
    } as unknown as Json);
  } catch (error) {
    return publicOperationErrorEnvelope("projection.snapshot", error);
  }
}

/**
 * `projection freshness` (ADR-0056 §2): would the committed documents render differently? It runs
 * the projection build `check` runs, over the committed manifest's profile, and reports that
 * render's `freshness`, so on the same tree it equals `check`'s and the `complete` gate's. It may
 * sync CodeGraph, as `flows check` does, but starts no daemon, opens no local store and writes no
 * repository file. Without a current-format manifest there is no profile to render and nothing to
 * compare, and `profile` is null. A root that is not a Git worktree fails with `AC_REPO_NOT_FOUND`
 * (`git-worktree-required`).
 */
export function runProjectionFreshnessCommand(cwd: string): JsonEnvelope {
  try { return publicOperationResult("projection.freshness", runProjectionFreshnessCommandUnchecked(cwd)) as JsonEnvelope; }
  catch (error) { return publicOperationErrorEnvelope("projection.freshness", error); }
}

function runProjectionFreshnessCommandUnchecked(cwd: string): JsonEnvelope {
  let root: string;
  try {
    root = findRepositoryRoot(cwd);
  } catch (error) {
    return publicFailureEnvelope("projection.freshness", "AC_REPO_NOT_FOUND", "git-worktree-required");
  }
  try {
    const manifestPath = resolve(root, ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH);
    const body = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : undefined;
    const committed = body === undefined ? undefined : readCommittedArchitectureDocsProjectionManifest(body);
    const evaluation = committed === undefined
      ? architectureProjectionFreshnessWithoutBaseline(body)
      : buildArchitectureDocsProjection(undefined, root, committed.profile).plan.freshness;
    const freshness = projectionFreshnessContract(evaluation);
    const issues = projectionFreshnessIssues(freshness);
    if (issues.length > 0) throw new Error(`projection-freshness-invalid: ${issues.join("; ")}`);
    return okEnvelope("projection.freshness", { profile: committed?.profile ?? null, freshness } as unknown as Json);
  } catch (error) {
    return publicOperationErrorEnvelope("projection.freshness", error);
  }
}

function assertProjectionExpectedSnapshot(
  request: ProjectionRequestV1,
  root: string,
  projection: ReturnType<typeof buildArchitectureDocsProjection>
): void {
  assertProjectionExpectedSnapshotAgainstModel(request, root, projection.loaded.model);
}

function assertProjectionExpectedSnapshotAgainstModel(
  request: ProjectionRequestV1,
  root: string,
  model: ReturnType<typeof loadNativeModelFromArchContext>
): void {
  const actual = currentProjectionExpectedSnapshot(root, model);
  for (const field of ["repositoryId", "workspaceId", "headSha", "worktreeDigest"] as const) {
    if (request.expected[field] !== actual[field]) throw new ProjectionExpectedSnapshotMismatchError(field);
  }
}

/** The current snapshot was read and differs from the expected one; any other failure is not a mismatch. */
class ProjectionExpectedSnapshotMismatchError extends FailureError<"AC_PRECONDITION_FAILED"> {
  constructor(readonly field: "repositoryId" | "workspaceId" | "headSha" | "worktreeDigest") {
    super("AC_PRECONDITION_FAILED", "projection-snapshot-mismatch", {field});
    this.name = "ProjectionExpectedSnapshotMismatchError";
  }
}


function projectionProtocolHumanStatus(
  request: ProjectionRequestV1,
  projection: ReturnType<typeof buildArchitectureDocsProjection>
): ProjectionResultV3["status"] | null {
  const humanSignal = projection.plan.refreshSignals.some((signal) => signal.mode === "human-action-required");
  const adoption = projection.plan.rejected.some((diff) => diff.reasonCode === "projection-adoption-required");
  const otherRejection = projection.plan.rejected.some((diff) => diff.reasonCode !== "projection-adoption-required");
  // An orphan that may hold human text stops every mode before any write, so `check`, `plan` and
  // `apply` all describe the same human action instead of a delete `apply` would never perform.
  const orphanReview = projectionReviewOrphans(projection).length > 0;
  const human = otherRejection || humanSignal || orphanReview;
  if (request.mode === "adopt") {
    if (!adoption) return projection.plan.drift.ok ? "noop" : human ? "human-action-required" : null;
    return human ? "human-action-required" : null;
  }
  if (adoption) return "adoption-required";
  return human ? "human-action-required" : null;
}

/**
 * One review orphan per path: two nodes' regions left in one shared contract file are one document
 * for a human to review (ADR-0056 §9).
 */
function projectionReviewOrphans(projection: ReturnType<typeof buildArchitectureDocsProjection>) {
  const seen = new Set<string>();
  return projection.plan.orphans.filter((orphan) => orphan.disposition === "human-review" && !seen.has(orphan.path) && seen.add(orphan.path) !== undefined);
}

function projectionDeletableOrphans(projection: ReturnType<typeof buildArchitectureDocsProjection>) {
  return projection.plan.orphans.filter((orphan) => orphan.disposition === "delete");
}

/**
 * Binds each generated-only orphan delete to the exact bytes the projection classified, so a
 * human edit made after classification fails the ChangeSet hash precondition instead of being
 * deleted.
 */
function projectionOrphanDeleteOperations(projection: ReturnType<typeof buildArchitectureDocsProjection>): Array<{
  operation: { path: string; expectedHash: string; delete: true };
  result: ProjectionResultV3["files"][number];
}> {
  const existingByPath = new Map(projection.loaded.existingFiles.map((file) => [file.path, file.onDisk]));
  return projectionDeletableOrphans(projection).map((orphan) => {
    const onDisk = existingByPath.get(orphan.path);
    if (onDisk === undefined) throw new Error(`projection orphan was classified without its on-disk bytes: ${orphan.path}`);
    return {
      operation: { path: orphan.path, expectedHash: digestJson({ body: onDisk } as unknown as Json), delete: true as const },
      // The physical preimage, like the update entries: `orphan.actualDigest` hashes the LF-normalized body.
      result: { path: orphan.path, action: "delete" as const, preimageDigest: digestJson({ path: orphan.path, body: onDisk } as unknown as Json) as Sha256Digest, outputDigest: null }
    };
  });
}

function projectionProtocolEnvelope(
  request: ProjectionRequestV1,
  input: ReturnType<typeof buildArchitectureDocsProjection>,
  status: ProjectionResultV3["status"],
  output: ReturnType<typeof buildArchitectureDocsProjection>,
  freshness?: ProjectionFreshnessV2,
  declinedUnprovableNodeIds?: string[]
): JsonEnvelope {
  return projectionProtocolResultEnvelope(projectionProtocolResult(request, input, status, output, undefined, undefined, freshness, declinedUnprovableNodeIds));
}

function projectionProtocolResult(
  request: ProjectionRequestV1,
  input: ReturnType<typeof buildArchitectureDocsProjection>,
  status: ProjectionResultV3["status"],
  output: ReturnType<typeof buildArchitectureDocsProjection> = input,
  _unusedApplyReceipt?: undefined,
  overrides?: {
    files: ProjectionResultV3["files"];
    refreshSignals: ArchitectureRefreshSignalV2[];
  },
  freshness?: ProjectionFreshnessV2,
  declinedUnprovableNodeIds?: string[]
): ProjectionResultV3 {
  const inputSnapshot = projectionProtocolSnapshot(request, input);
  const outputSnapshot = projectionProtocolSnapshot(request, output);
  const reviewOrphanPaths = status === "adoption-required" || status === "human-action-required"
    ? new Set(projectionReviewOrphans(input).map((orphan) => orphan.path))
    : new Set<string>();
  const plannedFiles = (overrides?.files ?? projectionProtocolFiles(input)).filter((file) => !reviewOrphanPaths.has(file.path));
  const files = request.mode === "plan" ? withProjectionPlanPreviews(input, plannedFiles) : plannedFiles;
  const affectedNodeIds = projectionProtocolAffectedNodes(input);
  const requestPayloadDigest = digestJson(request as unknown as Json) as Sha256Digest;
  const humanActions: ProjectionResultV3["humanActions"] = [];
  if (status === "adoption-required") {
    humanActions.push({ reasonCode: "adoption-required", affectedNodeIds, requestPayloadDigest });
  } else if (status === "human-action-required") {
    if (declinedUnprovableNodeIds) {
      humanActions.push({ reasonCode: "unprovable-required-flow", affectedNodeIds: declinedUnprovableNodeIds, requestPayloadDigest });
    } else if (input.plan.refreshSignals.some((signal) => signal.mode === "human-action-required")) {
      humanActions.push({ reasonCode: "unresolved-major-change", affectedNodeIds, requestPayloadDigest });
    } else if (input.plan.rejected.some((diff) => diff.reasonCode !== "projection-adoption-required")) {
      humanActions.push({ reasonCode: "manual-region-conflict", affectedNodeIds, requestPayloadDigest });
    }
  }
  if (status === "adoption-required" || status === "human-action-required") {
    for (const orphan of projectionReviewOrphans(input)) {
      humanActions.push({ reasonCode: "orphaned-document-review", affectedNodeIds: [], path: orphan.path, requestPayloadDigest });
    }
  }
  const refreshSignals = [...(overrides?.refreshSignals ?? output.plan.refreshSignals)]
    .sort((left, right) => left.signalId < right.signalId ? -1 : left.signalId > right.signalId ? 1 : 0);
  const architectureDebt = request.mode === "check" || request.mode === "plan"
    ? projectionArchitectureDebt(input.loaded.model, {
      ...input.importEvidence,
      codeGraphStatus: input.runtimeSnapshot.codeGraphStatus,
      worktreeDigest: input.runtimeSnapshot.worktreeDigest
    })
    : undefined;
  const changes = request.mode === "check" || request.mode === "plan" ? projectionTargetChanges(input, plannedFiles) : undefined;
  const withoutReceipt: Omit<ProjectionResultV3, "receiptDigest"> = {
    schemaVersion: PROJECTION_RESULT_SCHEMA_VERSION,
    requestId: request.requestId,
    status,
    inputSnapshot,
    outputSnapshot,
    affectedNodeIds,
    files,
    humanActions,
    refreshSignals,
    ...(freshness ? { freshness } : {}),
    ...(architectureDebt ? { architectureDebt } : {}),
    ...(changes ? { changes } : {}),
    ...(declinedUnprovableNodeIds && status === "human-action-required" ? { majorChangeAcceptance: "declined-unprovable-proof" as const } : {}),
    ...(status === "planned-partial" || status === "applied-partial" ? { coverage: projectionCoverage(input) } : {})
  };
  const receiptDigest = projectionResultReceiptDigest(withoutReceipt);
  const result: ProjectionResultV3 = {
    ...withoutReceipt,
    refreshSignals: refreshSignals.map((signal) => ({ ...signal, projectionReceiptDigest: receiptDigest })),
    receiptDigest
  };
  const issues = [...projectionResultInvariantIssues(result), ...projectionResultRequestModeIssues(result, request.mode)];
  if (issues.length > 0) throw new Error(`projection result invariant failed: ${issues.join("; ")}`);
  return result;
}

/**
 * The per-target change classification of a `check` or `plan` result (#327): the render's committed
 * baseline, its complete rows and semantic state, and `files`, the result's own write decision
 * (`projectionProtocolFiles`), so the targets with a planned action are exactly the documents an
 * apply of this render writes or deletes. Blocked targets come from the isolation's carried-forward
 * set, the review orphans and the adoption or ownership rejections.
 */
function projectionTargetChanges(
  projection: ReturnType<typeof buildArchitectureDocsProjection>,
  files: ProjectionResultV3["files"]
): ProjectionTargetChangeV2[] {
  return classifyProjectionTargetChanges({
    committed: projection.plan.committedManifest,
    renderedTargets: projection.plan.renderedTargets,
    modelDigest: projection.plan.provenance.modelDigest,
    capabilities: projection.plan.semanticState.capabilities,
    selectorEvidenceDigests: projection.plan.proofEvidence.selectorEvidenceDigests,
    files,
    rejected: projection.plan.rejected,
    orphans: projection.plan.orphans,
    blockedTargets: projection.plan.isolation?.blockedTargets ?? [],
    footprintOwners: architectureProjectionFootprintOwners(projection.loaded.model, projection.plan.profile)
  });
}

/** A partial result's coverage: what the isolated plan carried forward and what it applies. */
function projectionCoverage(projection: ReturnType<typeof buildArchitectureDocsProjection>): ProjectionCoverageV1 {
  const isolation = projection.plan.isolation;
  if (!isolation) throw new Error("projection-partial-result-without-isolation");
  return {
    complete: false,
    blockedCapabilityIds: [...isolation.blockedCapabilityIds],
    blockedTargets: isolation.blockedTargets.map((target) => ({ ...target, capabilityIds: [...target.capabilityIds], reasonCodes: [...target.reasonCodes] })),
    appliedTargetIds: [...isolation.appliedTargetIds]
  };
}

function projectionProtocolResultEnvelope(result: ProjectionResultV3): JsonEnvelope {
  const issues = projectionResultInvariantIssues(result);
  return issues.length === 0
    ? okEnvelope("projection.run", result as unknown as Json)
    : publicFailureEnvelope("projection.run", "AC_SCHEMA_INVALID", "projection-result-invalid", {});
}

function projectionResultDelivery(
  source: ProjectionResultV3,
  status: ProjectionResultV3["status"],
  refreshSignals: ArchitectureRefreshSignalV2[],
  requestId = source.requestId
): ProjectionResultV3 {
  const { receiptDigest: _receiptDigest, ...payload } = source;
  const withoutReceipt = { ...payload, requestId, status, refreshSignals };
  const receiptDigest = projectionResultReceiptDigest(withoutReceipt);
  return {
    ...withoutReceipt,
    refreshSignals: refreshSignals.map((signal) => ({ ...signal, projectionReceiptDigest: receiptDigest })),
    receiptDigest
  };
}

/**
 * `baseHeadSha`, `codeGraphDigest`, `indexedWorktreeDigest` and the CodeGraph status are what this
 * run read (runtime snapshot), not committed values: the projection manifest records neither a
 * commit nor anything else that differs between machines (#277).
 */
function projectionProtocolSnapshot(
  request: ProjectionRequestV1,
  projection: ReturnType<typeof buildArchitectureDocsProjection>
): ProjectionSnapshotV1 {
  const provenance = projection.plan.provenance;
  return {
    ...request.expected,
    baseHeadSha: projection.runtimeSnapshot.headSha,
    sourceTreeDigest: provenance.sourceTreeDigest as Sha256Digest,
    modelDigest: provenance.modelDigest as Sha256Digest,
    codeGraphDigest: projection.runtimeSnapshot.codeGraphDigest as Sha256Digest,
    indexedWorktreeDigest: projection.runtimeSnapshot.indexedWorktreeDigest as Sha256Digest | null,
    projectionInputDigest: provenance.projectionInputDigest as Sha256Digest,
    rendererVersion: provenance.rendererVersion,
    layoutVersion: provenance.layoutVersion,
    generatedFrom: projectionProtocolGeneratedFrom(provenance, projection.runtimeSnapshot)
  };
}

/**
 * The files `plan` and `check` report: exactly what `apply` would write, decided by the same
 * comparison `apply` commits (`projectionWriteFileResults`), so a write the drift digests do not see
 * — a marker-only renderer upgrade, a CRLF preimage — is never left out of the preview (#327). An
 * apply over a drift-free projection writes nothing. A path the projection rejected for adoption or
 * ownership repair is written only by an approved adoption; it is reported from its drift entry.
 */
function projectionProtocolFiles(
  projection: ReturnType<typeof buildArchitectureDocsProjection>
): ProjectionResultV3["files"] {
  if (projection.plan.drift.ok) return [];
  const rejected = projection.plan.rejected.flatMap<ProjectionResultV3["files"][number]>((diff) => {
    const expected = projectionDigestOrNull(diff.expectedDigest);
    const actual = projectionDigestOrNull(diff.actualDigest);
    return expected && actual && expected !== actual
      ? [{ path: diff.path, action: "update", preimageDigest: actual, outputDigest: expected }]
      : [];
  });
  return [
    ...projectionWriteFileResults(projection.loaded.existingFiles, projection.files, projectionOrphanDeleteOperations(projection)),
    ...rejected
  ].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

/**
 * The one decision of which files a projection write changes. Each rendered file is compared as the
 * bytes the ChangeSet writes (`projectionFilesBoundToRenderInput`: the full owned body, in the line
 * endings of the bytes the render read) against those read bytes; equal bytes are no file action.
 * Digests bind the physical preimage and the written output. Orphan deletes are the operations the
 * same ChangeSet carries.
 */
function projectionWriteFileResults(
  renderInput: readonly ProjectionOwnedFile[],
  files: readonly { path: string; body: string }[],
  orphanDeletes: ReturnType<typeof projectionOrphanDeleteOperations>
): ProjectionResultV3["files"] {
  const readByPath = new Map(renderInput.map((file) => [file.path, file.onDisk]));
  const writes = projectionFilesBoundToRenderInput(renderInput, files).flatMap<ProjectionResultV3["files"][number]>((write) => {
    const onDisk = readByPath.get(write.path);
    if (onDisk === write.body) return [];
    const outputDigest = digestJson({ path: write.path, body: write.body } as unknown as Json) as Sha256Digest;
    return onDisk === undefined
      ? [{ path: write.path, action: "create", preimageDigest: null, outputDigest }]
      : [{ path: write.path, action: "update", preimageDigest: digestJson({ path: write.path, body: onDisk } as unknown as Json) as Sha256Digest, outputDigest }];
  });
  return [...writes, ...orphanDeletes.map((orphan) => orphan.result)]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

/**
 * `plan` is the one preview authority (#264): every file entry gains the rendered body (`create`) or
 * a unified diff from the bytes on disk (`update`, `delete`), bounded per file and per result. The
 * bodies are generated architecture documents and travel in this response only; no ChangeSet is
 * planned and nothing is persisted. An entry whose path the projection rejected for adoption or
 * ownership repair carries none, because no apply writes that rendered body.
 */
function withProjectionPlanPreviews(
  projection: ReturnType<typeof buildArchitectureDocsProjection>,
  files: ProjectionResultV3["files"]
): ProjectionResultV3["files"] {
  const rendered = new Map(projection.files.map((file) => [file.path, file.body]));
  const current = new Map(projection.loaded.existingFiles.map((file) => [file.path, file.body]));
  const rejected = new Set(projection.plan.rejected.map((diff) => diff.path));
  const previewable = files.filter((file): file is ProjectionResultV3["files"][number] & { action: "create" | "delete" | "update" } =>
    file.action !== "unchanged" && !rejected.has(file.path));
  const previews = architectureProjectionFilePreviews(previewable.map((file) => ({
    path: file.path,
    action: file.action,
    ...(file.action === "create" ? {} : { before: current.get(file.path) }),
    ...(file.action === "delete" ? {} : { after: rendered.get(file.path) })
  })));
  const previewByPath = new Map(previewable.map((file, index) => [file.path, previews[index]!]));
  return files.map((file) => {
    const preview = previewByPath.get(file.path);
    return preview ? { ...file, preview } : file;
  });
}

function projectionProtocolAffectedNodes(
  projection: ReturnType<typeof buildArchitectureDocsProjection>
): string[] {
  const targetNodes = new Map(projection.plan.targets.flatMap((target) =>
    target.scope.kind === "entity" ? [[target.targetId, target.scope.id] as const] : []
  ));
  return [...new Set([
    ...projection.plan.refreshSignals.flatMap((signal) => signal.affectedNodeIds),
    ...projection.plan.drift.diffs.flatMap((diff) => diff.targetId && targetNodes.has(diff.targetId) ? [targetNodes.get(diff.targetId)!] : [])
  ])].sort();
}

function projectionDigestOrNull(value: string | undefined): Sha256Digest | null {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value) ? value as Sha256Digest : null;
}

/**
 * `archctx agent-context plan|preview|apply` — the ADR-0043 capability contract files, projected
 * through the same ChangeSet path as `docs`. `plan` and `preview` are pure reads: they render, plan
 * the ChangeSet, and report it; only `apply` writes.
 *
 * Every write goes through `render_agent_context`, the one operation kind whose write allowlist is
 * widened by the model-derived path set, so a plan can never reach a file the model does not
 * designate — and a mistakenly-kinded operation carrying the same path is still denied.
 */
export async function runAgentContextProjectionCommand(input: RuntimeAgentContextProjectionInput, cwd: string, daemon: ProjectionServiceHost) {
  try {
  const subcommand = input.action ?? "plan";
  if (!["plan", "preview", "apply"].includes(subcommand)) {
    return publicFailureEnvelope("agent-context", "AC_SCHEMA_INVALID", "agent-context-input-invalid", {});
  }
  const channel = `agent-context.${subcommand}`;
  const root = findRepositoryRoot(cwd);
  let projection: ReturnType<typeof buildAgentContextProjection>;
  try {
    // The committed manifest decides, as for every projection command: a superseded one needs its
    // re-baseline first, and under `repo-harness/v1` the projection is the one contract-file writer
    // and a root contract file carries no region (ADR-0056 §9).
    if (committedArchitectureDocsProfile(root) === REPO_HARNESS_PROJECTION_PROFILE) return publicFailureEnvelope(channel, "AC_PRECONDITION_FAILED", "agent-context-owned-by-projection", {});
    projection = buildAgentContextProjection(root);
  } catch (error) {
    return projectionFailureEnvelope(channel, error);
  }
  const changeSetId = input.id
    ?? `changeset.agent-context-${projection.sourceDigest.replace(/^sha256:/, "").slice(0, 16)}`;
  const plan = await daemon.planUpdate(root, {
    id: changeSetId,
    reason: { taskSessionId: input.taskSessionId ?? "task_agent_context_projection" },
    operations: [{
      op: "render_agent_context" as const,
      expectedHash: "missing",
      projectionFiles: projectionFilesBoundToRenderInput(projection.existingFiles, projection.plan.files)
    }]
  });
  if (!plan.ok) return plan;
  if (subcommand === "apply") {
    return daemon.applyUpdate(root, {
      id: changeSetId,
      approved: input.approved === true,
      expectedWorktreeDigest: input.expectedWorktreeDigest ?? computeWorktreeDigest(root, listGitVisibleFiles(root))
    });
  }
  return okEnvelope(channel, {
    schemaVersion: "archcontext.agent-context-projection-change-set/v1",
    sourceDigest: projection.sourceDigest,
    rendererVersion: projection.plan.rendererVersion,
    targetCount: projection.plan.targets.length,
    fileCount: projection.plan.files.length,
    targets: projection.plan.targets.map((target) => ({
      targetId: target.targetId,
      nodeId: target.scope.id,
      path: target.path,
      outputDigest: target.outputDigest
    })),
    draft: (plan.data as any).draft,
    preview: (plan.data as any).preview
  } as unknown as Json);
  } catch (error) { throw publicOperationFailure(error); }
}

function buildAgentContextProjection(root: string) {
  const model = loadNativeModelFromArchContext(root);
  // Model-only digest: an ADR edit changes the architecture documentation projection, but it does
  // not change what a capability's contract file says about that capability.
  const sourceDigest = digestJson({ model } as unknown as Json);
  const existingFiles = loadAgentContextProjectionFiles(root, model);
  return {
    model,
    sourceDigest,
    existingFiles,
    plan: renderAgentContextProjection({ model, existingFiles })
  };
}

/**
 * Each write's precondition hashes the raw bytes (`onDisk`) of the render's own read, never a
 * fresh disk read: the render preserves human text outside generated markers from exactly those
 * bytes, so an edit made after that read fails the ChangeSet hash recheck under the daemon writer
 * lock instead of being overwritten by a body rendered without it. The written body keeps the
 * line endings of those bytes.
 */
function architectureDocsRenderProjectionOperations(
  projection: ReturnType<typeof buildArchitectureDocsProjection>,
  files: { path: string; body: string }[],
  deletes: { path: string; expectedHash: string; delete: true }[] = [],
  carriedPaths: readonly string[] = []
) {
  const renderInput = projection.loaded.existingFiles;
  // Contract files go through `render_agent_context`, whose model-derived write scope applies to
  // them; they render on every run and are never carried as guards (ADR-0056 §9).
  const agentContextPaths = new Set(projection.plan.targets.filter((target) => target.type === "agent-context").map((target) => target.path));
  const agentContextFiles = files.filter((file) => agentContextPaths.has(file.path));
  return [
    {
      op: "render_projection" as const,
      expectedHash: "missing",
      projectionFiles: [
        ...projectionFilesBoundToRenderInput(renderInput, files.filter((file) => !agentContextPaths.has(file.path))),
        ...deletes,
        ...projectionGuardsBoundToRenderInput(renderInput, carriedPaths)
      ]
    },
    ...(agentContextFiles.length === 0 ? [] : [{
      op: "render_agent_context" as const,
      expectedHash: "missing",
      projectionFiles: projectionFilesBoundToRenderInput(renderInput, agentContextFiles)
    }])
  ];
}

/**
 * A carried-forward document is written by no operation, and the request's worktree digest leaves
 * projection-owned outputs out, so only a guard binds it: the commit requires the raw bytes the
 * render read (`onDisk`) at that path, and an edit or delete since fails the whole apply.
 */
function projectionGuardsBoundToRenderInput(
  renderInput: readonly ProjectionOwnedFile[],
  paths: readonly string[]
): { path: string; expectedHash: string; guard: true }[] {
  const readByPath = new Map(renderInput.map((file) => [file.path, file]));
  return paths.map((path) => {
    const read = readByPath.get(path);
    if (read?.onDisk === undefined) throw new Error(`projection render input carries no on-disk bytes for a carried file: ${path}`);
    return { path, expectedHash: digestJson({ body: read.onDisk } as unknown as Json), guard: true as const };
  });
}

/**
 * `missing` when the render read no body at that path, so a file created since fails closed too.
 * The precondition hashes the raw bytes the render read and the written body keeps those bytes'
 * line endings (see `projectionOwnedWriteBody`), so a `core.autocrlf` checkout re-projects in place.
 */
/**
 * A rendered file standing in for the post-apply state in an adoption fixed-point simulation. No
 * ChangeSet precondition is ever built from these, so `onDisk` is the rendered body itself.
 */
function simulatedProjectionFile<T extends { path: string; body: string }>(file: T): T & ProjectionOwnedFile {
  return { ...file, onDisk: file.body };
}

export function projectionFilesBoundToRenderInput(
  renderInput: readonly ProjectionOwnedFile[],
  files: readonly { path: string; body: string }[]
): { path: string; expectedHash: string; body: string }[] {
  const readByPath = new Map(renderInput.map((file) => [file.path, file]));
  return files.map((file) => {
    const read = readByPath.get(file.path);
    if (read === undefined) return { path: file.path, expectedHash: "missing", body: file.body };
    // The type requires `onDisk`; this guards untyped callers, because a hash of anything else would not bind to the read bytes.
    if (read.onDisk === undefined) throw new Error(`projection render input carries no on-disk bytes: ${file.path}`);
    return {
      path: file.path,
      expectedHash: digestJson({ body: read.onDisk } as unknown as Json),
      body: projectionOwnedWriteBody(file.body, read.onDisk)
    };
  });
}

function projectionInputRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("projection input must be an object");
  const record = value as Record<string, unknown>;
  const extra = Object.keys(record).find((key) => !allowed.includes(key));
  if (extra) throw new Error(`projection input contains unsupported property: ${extra}`);
  return record;
}

export function validateProjectionInvocation(value: unknown): asserts value is RuntimeProjectionInvocation {
  const input = projectionInputRecord(value, ["action", "request"]);
  if (input.action !== "run") throw new Error("projection action must be run");
  parseProjectionProtocolRequest(JSON.stringify(input.request));
}

export function projectionInvocationWrites(input: RuntimeProjectionInvocation): boolean {
  return input.action === "run" && ["apply", "adopt"].includes(input.request.mode);
}

export function assertProjectionInvocationSnapshot(root: string, input: RuntimeProjectionInvocation): void {
  assertProjectionExpectedSnapshotAgainstModel(input.request, findRepositoryRoot(root), loadNativeModelFromArchContext(root));
}

function validateHumanProjectionInput(input: Record<string, unknown>, actions: readonly string[]): void {
  if (typeof input.action !== "string" || !actions.includes(input.action)) throw new Error(`projection action must be ${actions.join("|")}`);
  for (const key of ["id", "taskSessionId", "expectedWorktreeDigest", "adoptionPlanId"]) {
    if (input[key] !== undefined && typeof input[key] !== "string") throw new Error(`projection ${key} must be a string`);
  }
  if (input.approved !== undefined && typeof input.approved !== "boolean") throw new Error("projection approved must be a boolean");
}

export function validateDocsProjectionInput(value: unknown): asserts value is RuntimeDocsProjectionInput {
  const input = projectionInputRecord(value, ["action", "profile", "acceptedChange", "id", "taskSessionId", "approved", "expectedWorktreeDigest", "adoptionPlanId"]);
  validateHumanProjectionInput(input, ["plan", "apply", "adopt", "drift", "clean"]);
  if (input.profile !== undefined && input.profile !== "default" && input.profile !== REPO_HARNESS_PROJECTION_PROFILE) throw new Error("projection profile is invalid");
  if (input.acceptedChange !== undefined) validateProjectionAcceptedChange(input.acceptedChange);
}

export function validateAgentContextProjectionInput(value: unknown): asserts value is RuntimeAgentContextProjectionInput {
  const input = projectionInputRecord(value, ["action", "id", "taskSessionId", "approved", "expectedWorktreeDigest"]);
  validateHumanProjectionInput(input, ["plan", "preview", "apply"]);
}
