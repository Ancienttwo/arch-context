import { FailureError, failureEnvelope, knownFailure, PROJECTION_RECOVERY_DETAILS_LIMIT_BYTES, projectionApplyCommittedDetails, projectionApplyManualOnlyDetails, projectionApplyRecoveryDetailsBytes, projectionApplyRecoveryDetailsFit } from "@archcontext/contracts";
import { publicFailureEnvelope, publicOperationErrorEnvelope, publicOperationFailure, publicOperationResult } from "./public-operation-failure";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { computeWorktreeDigest, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { GitVisibleFilesUnavailableError, findRepositoryRoot, readHeadSha, listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { ProjectionCodeFactsUnavailableError, assertProjectionCodeFactsAvailable, prepareArchitectureDocumentationProjectionSnapshot } from "@archcontext/local-runtime/codegraph-adapter";
import { projectionProtocolGeneratedFrom, projectionWorkspaceId } from "./projection-inputs";
import { ProjectionFreshnessChangedPathError, evaluateProjectionFreshness, measureProjectionFreshness, projectionFreshnessContract } from "./projection-freshness";
import { projectionArchitectureDebt } from "./projection-architecture-debt";
import { classifyProjectionTargetChanges } from "./projection-target-changes";
import type { RuntimeDaemonClient } from "./rpc-protocol";
import { ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH, architectureDocsProjectionManifestSchemaVersion, isSupersededArchitectureDocsProjectionManifestSchemaVersion, PROJECTION_APPLY_READBACK_RESULT_SCHEMA_VERSION, PROJECTION_APPLY_RECOVERY_INTENT_SCHEMA_VERSION, PROJECTION_APPLY_RECOVERY_RESULT_SCHEMA_VERSION, PROJECTION_MODES, PROJECTION_REQUEST_SCHEMA_VERSION, PROJECTION_TARGETS, createProjectionApplyIdentity, digestJson, errorEnvelope, isRepoRelativePosixPath, okEnvelope, projectionApplyAbsenceInvariantIssues, projectionApplyReadbackRequestFromReceipt, projectionApplyReadbackRequestInvariantIssues, projectionApplyReadbackResultInvariantIssues, projectionApplyRecoveryIntentInvariantIssues, projectionApplyRecoveryResultInvariantIssues, projectionApplyLookupKey, projectionFreshnessIssues, projectionPriorCommittedAppliesIssues, projectionRequestInvariantIssues, projectionResultInvariantIssues, projectionResultReceiptDigest, projectionResultRequestModeIssues } from "@archcontext/contracts";
import type { AcceptedArchitectureChangeReferenceV1, ArchitectureDocumentationProjectionProvenanceV3, ArchitectureRefreshSignalV1, Json, JsonEnvelope, ProjectionApplyAbsenceV1, ProjectionApplyReadbackResultV1, ProjectionApplyIdentityV1, ProjectionApplyReceiptV1, ProjectionApplyRecoveryBindingV1, ProjectionApplyRecoveryIntentV1, ProjectionApplyRecoveryProofV1, ProjectionApplyRecoveryResultV1, ProjectionFreshnessV1, ProjectionCoverageV1, ProjectionPriorCommittedApplyV1, ProjectionRequestV1, ProjectionResultV2, ProjectionSnapshotV1, ProjectionExpectedSnapshotV1, ProjectionTargetChangeV1, Sha256Digest } from "@archcontext/contracts";
import { REPO_HARNESS_PROJECTION_PROFILE, architectureAdoptionReceipt, architectureProjectionFilePreviews, architectureDocumentationSourceDigest, ProjectionPreconditionError, buildArchitectureDocumentationAdoptionPlan, loadAgentContextProjectionFiles, loadArchitectureDocumentationInputs, loadArchitectureDocumentationProfile, loadArchitectureProjectionManifestStamps, digestCapabilitySourceFootprints, measureCapabilitySourceScaleSignals, loadNativeModelFromArchContext, projectionOwnedWriteBody, renderAgentContextProjection, renderArchitectureDocumentationProjection, architectureDocumentationProjectionWorktreeDigest, type ArchitectureProjectionProfile, type ProjectionOwnedFile, type ArchitectureMajorChangeClassificationV1, type ArchitectureDocumentationProjectionRuntimeSnapshot } from "@archcontext/core/projection-engine";
import type { RuntimeDocsProjectionInput, RuntimeAgentContextProjectionInput, RuntimeProjectionInvocation } from "./rpc-types";
export type { RuntimeDocsProjectionInput, RuntimeAgentContextProjectionInput, RuntimeProjectionInvocation } from "./rpc-types";

export type ProjectionServiceHost = Pick<RuntimeDaemonClient, "planUpdate" | "applyUpdate" | "listProjectionPriorCommittedApplies" | "inspectProjectionApplyReceipt" | "readbackProjectionApply" | "recoverProjectionApply">;

export async function runArchitectureDocsProjectionCommand(input: RuntimeDocsProjectionInput, cwd: string, daemon: ProjectionServiceHost) {
  try {
  const subcommand = input.action ?? "plan";
  const root = findRepositoryRoot(cwd);
  let profile: ArchitectureProjectionProfile;
  let projection: ReturnType<typeof buildArchitectureDocsProjection>;
  let acceptedChange: AcceptedArchitectureChangeReferenceV1 | undefined;
  try {
    profile = input.profile ?? committedArchitectureDocsProfile(root);
    acceptedChange = input.acceptedChange;
    // `docs apply` is the one re-baseline of a superseded manifest (#327); every other surface refuses it.
    projection = buildArchitectureDocsProjection(daemon, root, profile, undefined, acceptedChange, { rebaselineSupersededManifest: subcommand === "apply" });
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
  const operations = [architectureDocsRenderProjectionOperation(projection.loaded.existingFiles, projection.files, projectionOrphanDeleteOperations(projection).map((orphan) => orphan.operation))];
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
  refreshSignals: ArchitectureRefreshSignalV1[],
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
type ArchitectureDocsRenderOptions = { rebaselineSupersededManifest?: boolean; isolateBlockedCapabilities?: boolean };

export function buildArchitectureDocsProjection(
  _host: ProjectionServiceHost | undefined,
  root: string,
  profile: ArchitectureProjectionProfile = "default",
  existingFilesOverride?: ProjectionOwnedFile[],
  acceptedChange?: AcceptedArchitectureChangeReferenceV1,
  options: ArchitectureDocsRenderOptions = {}
) {
  const inputs = measureArchitectureDocsProjectionInputs(root, profile);
  return renderArchitectureDocsProjectionFromInputs(root, inputs, existingFilesOverride ?? inputs.loaded.existingFiles, acceptedChange, options);
}

/**
 * A docs projection ChangeSet is named after the projection-owned output bytes it writes, the
 * manifest included, so equal ids mean equal writes and a stamp-only apply gets its own id.
 */
function docsProjectionChangeSetId(projection: ReturnType<typeof buildArchitectureDocsProjection>): string {
  return `changeset.docs-projection-${projectionOwnedOutputDigest(projection).replace(/^sha256:/, "").slice(0, 16)}`;
}

/**
 * Everything a projection build reads from the repository before it renders: the model, decisions
 * and existing documents, the CodeGraph snapshot, and the footprint digests and scale signals of
 * that snapshot's footprints. The render is a function of these, the existing documents it is
 * given and the accepted change.
 */
function measureArchitectureDocsProjectionInputs(root: string, profile: ArchitectureProjectionProfile) {
  const loaded = loadArchitectureDocumentationInputs(root, profile);
  const sourceDigest = architectureDocumentationSourceDigest({ model: loaded.model, profile, decisions: loaded.decisions });
  const codeGraphInputs = prepareArchitectureDocumentationProjectionSnapshot(root, loaded.model);
  assertProjectionCodeFactsAvailable(root, codeGraphInputs);
  return {
    profile,
    loaded,
    sourceDigest,
    codeGraphInputs,
    sourceFootprints: digestCapabilitySourceFootprints(root, loaded.model, codeGraphInputs.footprints),
    sourceScaleSignals: measureCapabilitySourceScaleSignals(root, codeGraphInputs.footprints)
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
  const { profile, sourceDigest, codeGraphInputs, sourceFootprints } = inputs;
  const loaded = { ...inputs.loaded, existingFiles };
  const provenance = codeGraphInputs.provenance;
  const plan = renderArchitectureDocumentationProjection({
    model: loaded.model,
    profile,
    decisions: loaded.decisions,
    existingFiles: loaded.existingFiles,
    docsLanguage: loaded.docsLanguage,
    sourceFootprints,
    sourceScaleSignals: inputs.sourceScaleSignals,
    importGraphs: codeGraphInputs.importGraphs,
    selectorEvidence: codeGraphInputs.selectorEvidence,
    provenance,
    sourceDigest,
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
    sourceFootprints,
    /** The declared source tree digest this render measured. */
    currentSourceTreeDigest: codeGraphInputs.provenance.sourceTreeDigest,
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
  priorCommittedApplies: ProjectionPriorCommittedApplyV1[] = [],
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
    return applyProjectionProtocolFixedPoint(protocolRequest, projection, canonical, adoption.changeSetId, root, daemon, priorCommittedApplies, acceptedChange);
  }
  const filesByPath = new Map<string, { path: string; body: string }>();
  for (const file of canonical.files) filesByPath.set(file.path, file);
  const planned = await daemon.planUpdate(root, {
    id: adoption.changeSetId,
    reason: { taskSessionId: input.taskSessionId ?? "task_docs_adoption" },
    operations: [architectureDocsRenderProjectionOperation(projection.loaded.existingFiles, [...filesByPath.values()], orphanDeletes.map((orphan) => orphan.operation))]
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
  priorCommittedApplies: ProjectionPriorCommittedApplyV1[],
  /** The caller's `acceptedChange`, or the one derived for `acceptObservedMajorChange`. */
  acceptedChange: AcceptedArchitectureChangeReferenceV1 | undefined
): Promise<JsonEnvelope> {
  // Generated-only orphans are deleted by this write; human-review orphans stopped the request
  // before it reached here (projectionProtocolHumanStatus), so `apply` never reports a delete it
  // does not perform (#268).
  const orphanDeletes = projectionOrphanDeleteOperations(input);
  const committedFiles = projectionWriteFileResults(input.loaded.existingFiles, fixedPoint.files, orphanDeletes);
  const committedSignals = acceptedChange
    ? input.plan.refreshSignals.map((signal) => ({
        ...signal,
        resultingDigests: fixedPoint.plan.architectureDigests
      }))
    : fixedPoint.plan.refreshSignals;
  const applyIdentity = acceptedChange
    ? createProjectionApplyIdentity({
        repositoryId: request.expected.repositoryId,
        workspaceId: request.expected.workspaceId,
        acceptedChange,
        changeSetId,
        idempotencyKey: `idem_${changeSetId}`,
        files: committedFiles,
        refreshSignals: committedSignals
      })
    : undefined;
  // A partial plan has no accepted change, so it never reaches a receipt (#327, Phase 1).
  const appliedResult = projectionProtocolResult(request, input, fixedPoint.plan.isolation ? "applied-partial" : "applied", fixedPoint, applyIdentity, {
    files: committedFiles,
    refreshSignals: committedSignals
  }, priorCommittedApplies);
  let recoveryBinding: ProjectionApplyRecoveryBindingV1 | undefined;
  if (applyIdentity) {
    try {
      recoveryBinding = createProjectionApplyRecoveryBinding(request, fixedPoint, appliedResult);
    } catch (error) {
      return projectionFailureEnvelope("projection.run", error);
    }
  }
  const applyReceipt: ProjectionApplyReceiptV1 | undefined = applyIdentity
    ? {
        schemaVersion: "archcontext.projection-apply-receipt/v1",
        identity: applyIdentity,
        result: appliedResult,
        recovery: recoveryBinding
      }
    : undefined;
  if (applyReceipt && !projectionApplyRecoveryDetailsFit(applyReceipt)) {
    return failureEnvelope("projection.run", knownFailure("AC_PRECONDITION_FAILED", "projection-apply-recovery-metadata-too-large", {
      measuredBytes: projectionApplyRecoveryDetailsBytes(applyReceipt), limitBytes: PROJECTION_RECOVERY_DETAILS_LIMIT_BYTES
    })) as JsonEnvelope;
  }
  const planned = await daemon.planUpdate(root, {
    id: changeSetId,
    reason: { taskSessionId: request.requestId },
    operations: [architectureDocsRenderProjectionOperation(
      input.loaded.existingFiles,
      fixedPoint.files,
      orphanDeletes.map((orphan) => orphan.operation),
      // A partial apply's manifest keeps the blocked rows only while their documents are unchanged.
      fixedPoint.plan.isolation?.blockedTargets.map((target) => target.path) ?? []
    )],
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
    worktreeDigestProfile: "architecture-documentation-projection",
    ...(applyReceipt ? { projectionApplyReceipt: applyReceipt } : {})
  });
  if (!applied.ok) return applied;
  if (!applyReceipt) return projectionProtocolResultEnvelope(appliedResult);

  // Accepted semantic changes are consumed by the input projection. The committed fixed point is
  // intentionally rebuilt without that approval, so the post-write check only compares authority
  // inputs and can distinguish a concurrent mutation from the already-applied semantic delta.
  let postApplyMatches = false;
  try {
    postApplyMatches = architectureDocumentationProjectionWorktreeDigest(root, loadNativeModelFromArchContext(root), listGitVisibleFiles(root))
      === request.expected.worktreeDigest;
    if (!postApplyMatches) {
      process.stderr.write("warning: projection post-apply worktree digest diverged from the accepted snapshot; refresh delivery deferred to reconcile\n");
    }
  } catch (error) {
    process.stderr.write(`warning: projection post-apply verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
    postApplyMatches = false;
  }
  if (!postApplyMatches) {
    return projectionProtocolResultEnvelope(projectionResultDelivery(appliedResult, "applied-reconcile-required", []));
  }
  const delivery = await daemon.recoverProjectionApply(root, {
    schemaVersion: PROJECTION_APPLY_RECOVERY_INTENT_SCHEMA_VERSION,
    requestId: request.requestId,
    profile: REPO_HARNESS_PROJECTION_PROFILE,
    receipt: {
      lookupKey: applyReceipt.identity.lookupKey,
      applyId: applyReceipt.identity.applyId
    }
  });
  if (!delivery.ok) return delivery;
  const delivered = delivery.data as any;
  if (delivered.found !== true || delivered.refreshSignalsDelivered !== true) {
    return publicFailureEnvelope("projection.run", "AC_PRECONDITION_FAILED", "projection-apply-first-delivery-unavailable", {lookupKey:applyReceipt.identity.lookupKey,applyId:applyReceipt.identity.applyId});
  }
  return projectionProtocolResultEnvelope(projectionResultDelivery(
    appliedResult,
    "applied",
    (delivered.receipt as ProjectionApplyReceiptV1).result.refreshSignals,
    request.requestId
  ));
}

/**
 * Stable cross-repository projection protocol. Unlike the human-oriented `docs` surface, this
 * command accepts one ProjectionRequestV1 and returns one ProjectionResultV2. The request snapshot
 * is checked before any ChangeSet is planned, and every successful response is validated against
 * the contracts package before it crosses the process boundary.
 */
export async function runProjectionProtocolCommand(invocation: RuntimeProjectionInvocation, cwd: string, daemon: ProjectionServiceHost): Promise<JsonEnvelope> {
  try {
  const subcommand = invocation.action;
  if (subcommand === "readback") return await runProjectionApplyReadbackCommand(invocation.request, cwd, daemon);
  if (subcommand === "recover") return await runProjectionApplyRecoveryCommand(invocation.request, cwd, daemon);
  if (subcommand !== "run") return publicFailureEnvelope("projection", "AC_SCHEMA_INVALID", "projection-input-invalid", {});
  const raw = JSON.stringify(invocation.request);

  let request: ProjectionRequestV1;
  try {
    request = parseProjectionProtocolRequest(raw);
  } catch (error) {
    return publicFailureEnvelope("projection.run", "AC_SCHEMA_INVALID", "projection-input-invalid", {});
  }

  if (request.mode === "check") return runProjectionCheckCommand(request, findRepositoryRoot(cwd));

  const root = findRepositoryRoot(cwd);
  // Snapshot the journal before this command can write anything: whatever is committed under this
  // requestId now belongs to an earlier attempt by construction, so no changeSetId comparison is
  // needed against this run's own commit (the protocol changeSetId is derived from the owned-output
  // byte digest and repeats across attempts of the same request).
  let priorCommittedApplies: ProjectionPriorCommittedApplyV1[];
  try {
    const listed = await daemon.listProjectionPriorCommittedApplies(root, request.requestId);
    if (!listed.ok) return listed;
    priorCommittedApplies = parseProjectionPriorCommittedApplies(listed.data, request.requestId);
  } catch (error) {
    return projectionFailureEnvelope("projection.run", error);
  }
  if (request.mode === "apply" || request.mode === "adopt") {
    let replay: JsonEnvelope | undefined;
    try {
      replay = await replayCommittedProjectionApply(request, root, daemon, priorCommittedApplies);
    } catch (error) {
      return projectionFailureEnvelope("projection.run", error);
    }
    if (replay) return replay;
  }
  // With acceptObservedMajorChange the accepted change is the one this run observes at `expected`.
  // It is derived once, then authorizes exactly what a caller-supplied acceptedChange would: the
  // same render, fixed point and write, bound to the same expected snapshot that the daemon
  // re-checks under its writer lock before the ChangeSet touches a file (#261).
  let observed: ReturnType<typeof buildArchitectureDocsProjection> | undefined;
  let acceptedChange = request.acceptedChange;
  let declinedUnprovableNodeIds: string[] | undefined;
  if (request.acceptObservedMajorChange === true) {
    try {
      observed = buildArchitectureDocsProjection(daemon, root, REPO_HARNESS_PROJECTION_PROFILE);
      assertProjectionExpectedSnapshot(request, root, observed);
    } catch (error) {
      return projectionFailureEnvelope("projection.run", error);
    }
    const acceptance = observedMajorChangeAcceptance(request, observed);
    if (acceptance && "acceptedChange" in acceptance) acceptedChange = acceptance.acceptedChange;
    else if (acceptance) declinedUnprovableNodeIds = acceptance.unprovableNodeIds;
  }
  if (request.mode === "apply" && acceptedChange) {
    try {
      assertProjectionExpectedSnapshotAgainstModel(request, root, loadNativeModelFromArchContext(root));
      const inspected = await daemon.inspectProjectionApplyReceipt(root, projectionApplyLookupKey({
        repositoryId: request.expected.repositoryId,
        workspaceId: request.expected.workspaceId,
        acceptedChange
      }));
      if (!inspected.ok) return inspected;
      const existing = inspected.data as { found?: boolean; receipt?: ProjectionApplyReceiptV1 };
      if (existing.found === true) {
        if (!existing.receipt) throw new Error("committed projection apply receipt lookup returned no receipt");
        // Another request already applied this exact accepted change. Its outputs are proven, or
        // restored under the original receipt, before the refusal points the caller at readback (#325).
        if (!projectionApplyRecoveryDetailsFit(existing.receipt)) return projectionApplyCommittedEnvelope("projection.run", existing.receipt, "projection-accepted-change-committed", false);
        const outputs = await proveOrRestoreCommittedProjectionApply(existing.receipt, root, daemon);
        if (outputs.kind === "failed") return outputs.envelope;
        return projectionApplyCommittedEnvelope("projection.run", existing.receipt, "projection-accepted-change-committed", outputs.kind === "restored");
      }
    } catch (error) {
      return projectionFailureEnvelope("projection.run", error);
    }
  }
  // The flag path renders the accepted change against the documents it classified. The semantic
  // baseline is in the projection manifest, which the expected worktree digest does not cover, so
  // re-reading it here could apply a broader change than the one the receipt records.
  // Without an accepted change, `plan` and `apply` isolate capabilities blocked by their proof
  // alone (#327, Phase 1); `adopt` always covers every target.
  const isolation: { isolateBlockedCapabilities?: boolean } = request.mode !== "adopt" && acceptedChange === undefined ? { isolateBlockedCapabilities: true } : {};
  let projection: ReturnType<typeof buildArchitectureDocsProjection>;
  try {
    projection = observed === undefined
      ? buildArchitectureDocsProjection(daemon, root, REPO_HARNESS_PROJECTION_PROFILE, undefined, acceptedChange, isolation)
      // A declined flag renders once more with isolation; nothing else in `observed` can isolate.
      : acceptedChange === undefined && (isolation.isolateBlockedCapabilities !== true || observed.plan.majorChange.mode !== "human-action-required")
        ? observed
        : rerenderArchitectureDocsProjection(root, observed, observed.loaded.existingFiles, acceptedChange, isolation);
    assertProjectionExpectedSnapshot(request, root, projection);
  } catch (error) {
    return projectionFailureEnvelope("projection.run", error);
  }

  const blocked = projectionProtocolHumanStatus(request, projection);
  if (blocked) return projectionProtocolEnvelope(request, projection, blocked, projection, priorCommittedApplies, undefined, declinedUnprovableNodeIds);

  if (request.mode === "adopt") {
    const expectedWorktreeDigest = computeWorktreeDigest(root, listGitVisibleFiles(root));
    const adopted = await runArchitectureDocsAdoptionCommand({
      action: "adopt", profile: REPO_HARNESS_PROJECTION_PROFILE, approved: true,
      adoptionPlanId: request.adoptionPlanId!, expectedWorktreeDigest,
      taskSessionId: request.requestId
    }, root, daemon, projection, REPO_HARNESS_PROJECTION_PROFILE, request, priorCommittedApplies, acceptedChange);
    if (!adopted.ok) return adopted;
    return adopted;
  }

  if (request.mode === "apply" && !projection.plan.drift.ok) {
    // The accepted plan is the authorization boundary, but it is not the state that remains on
    // disk after the acceptance has been incorporated into the projection baseline. Render that
    // no-accepted-change state against the accepted plan's virtual outputs before writing, so the
    // committed receipt names a real clean fixed point rather than a one-shot approval view.
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
    return applyProjectionProtocolFixedPoint(request, projection, fixedPointProjection, docsProjectionChangeSetId(fixedPointProjection), root, daemon, priorCommittedApplies, acceptedChange);
  }

  return projectionProtocolEnvelope(request, projection, projectionPlannedStatus(projection), projection, priorCommittedApplies);
  } catch (error) { throw publicOperationFailure(error); }
}

/** `check` and `plan` without a human action: nothing to write, a complete plan, or a partial one. */
function projectionPlannedStatus(projection: ReturnType<typeof buildArchitectureDocsProjection>): ProjectionResultV2["status"] {
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
export function runProjectionCheckCommand(request: ProjectionRequestV1, root: string): JsonEnvelope {
  try { return publicOperationResult("projection.run", runProjectionCheckCommandUnchecked(request, root)) as JsonEnvelope; }
  catch (error) { throw publicOperationFailure(error); }
}

function runProjectionCheckCommandUnchecked(request: ProjectionRequestV1, root: string): JsonEnvelope {
  if (request.mode !== "check") {
    return publicFailureEnvelope("projection.run", "AC_SCHEMA_INVALID", "projection-check-mode-invalid");
  }
  let projection: ReturnType<typeof buildArchitectureDocsProjection>;
  try {
    projection = buildArchitectureDocsProjection(undefined, root, REPO_HARNESS_PROJECTION_PROFILE, undefined, request.acceptedChange,
      request.acceptedChange === undefined ? { isolateBlockedCapabilities: true } : {});
    assertProjectionExpectedSnapshot(request, root, projection);
  } catch (error) {
    if (error instanceof ProjectionExpectedSnapshotMismatchError) return publicFailureEnvelope("projection.run", "AC_PRECONDITION_FAILED", "projection-snapshot-mismatch", {field: error.field});
    return publicOperationErrorEnvelope("projection.run", error);
  }
  const freshness = projectionCheckFreshness(root, projection);
  const status = projectionProtocolHumanStatus(request, projection) ?? projectionPlannedStatus(projection);
  const result = projectionProtocolEnvelope(request, projection, status, projection, [], freshness);
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
 * A repeated apply or adopt whose requestId already committed an accepted apply. The same request
 * (requestId and request digest) gets the committed ProjectionResultV2 back, marked `replayed`,
 * without applying again; a different request under that requestId is refused with
 * AC_PROJECTION_APPLY_COMMITTED and the committed lookup key (#265). The key is the caller's
 * requestId and request digest, never the accepted-change ids a provider may have generated.
 * Undefined when this requestId committed no receipt-bearing apply.
 */
async function replayCommittedProjectionApply(
  request: ProjectionRequestV1,
  root: string,
  daemon: ProjectionServiceHost,
  priorCommittedApplies: ProjectionPriorCommittedApplyV1[]
): Promise<JsonEnvelope | undefined> {
  const committed: Array<{ committedAt: string; receipt: ProjectionApplyReceiptV1; delivered: boolean }> = [];
  for (const entry of priorCommittedApplies) {
    if (entry.lookupKey === undefined) continue;
    const inspected = await daemon.inspectProjectionApplyReceipt(root, entry.lookupKey);
    if (!inspected.ok) return inspected;
    const data = inspected.data as { found?: boolean; receipt?: ProjectionApplyReceiptV1; deliveryStatus?: string };
    if (data.found !== true || !data.receipt || (data.deliveryStatus !== "delivered" && data.deliveryStatus !== "pending")) {
      throw new Error(`committed projection apply receipt is unreadable: ${entry.lookupKey}`);
    }
    committed.push({ committedAt: entry.committedAt, receipt: data.receipt, delivered: data.deliveryStatus === "delivered" });
  }
  if (committed.length === 0) return undefined;
  const requestDigest = digestJson(request as unknown as Json);
  const match = committed.find(({ receipt }) => receipt.recovery?.requestDigest === requestDigest
    && receipt.result.requestId === request.requestId
    && receipt.identity.repositoryId === request.expected.repositoryId
    && receipt.identity.workspaceId === request.expected.workspaceId);
  if (!match) {
    const latest = [...committed].sort((left, right) => left.committedAt < right.committedAt ? -1 : left.committedAt > right.committedAt ? 1 : 0).at(-1)!;
    return projectionApplyCommittedEnvelope(
      "projection.run",
      latest.receipt,
      latest.receipt.recovery?.requestDigest === undefined ? "projection-apply-request-digest-unrecorded" : "projection-apply-request-differs"
    );
  }
  if (!projectionApplyRecoveryDetailsFit(match.receipt)) return projectionApplyCommittedEnvelope("projection.run", match.receipt, "projection-accepted-change-committed", false);
  const outputs = await proveOrRestoreCommittedProjectionApply(match.receipt, root, daemon);
  if (outputs.kind === "failed") return outputs.envelope;
  // A receipt whose refresh signals were never delivered answers as the first run would have
  // without its delivery: applied, reconcile required, recover with the receipt to deliver.
  const committedResult = match.delivered
    ? match.receipt.result
    : projectionResultDelivery(match.receipt.result, "applied-reconcile-required", []);
  return projectionProtocolResultEnvelope({ ...committedResult, replayed: true, written: outputs.kind === "restored" });
}

type CommittedProjectionApplyOutputs =
  /** The receipt has no recovery binding, so its outputs can be neither proven nor restored. */
  | { kind: "unprovable" }
  /** HEAD or the projection worktree digest moved since the approval; nothing is proven or written. */
  | { kind: "snapshot-moved" }
  /** The readback proof passed: the projection-owned outputs are the committed fixed point. */
  | { kind: "proven" }
  /** The outputs differed at the approved snapshot and the committed fixed point was written again. */
  | { kind: "restored" }
  | { kind: "failed"; envelope: JsonEnvelope };

/**
 * Before a replay or a repeated accepted change answers with a committed apply, its
 * projection-owned outputs go through the proof `projection readback` runs (#325). When the
 * current snapshot still equals the approved one and the proof fails, the outputs were changed
 * after the commit (a restored `docs/architecture/`, a lost response followed by a checkout). The
 * approved request is then rendered again, and its fixed point is written through the ordinary
 * ChangeSet path under the daemon writer lock, but only after it reproduces the receipt's recorded
 * resulting digests and owned-output digest byte for byte. Anything else fails closed: a human
 * edit inside `docs/architecture/`, another renderer, or a moved snapshot is never overwritten.
 * The receipt, its delivery checkpoint and its refresh signals are not touched; the write is an
 * own journal entry (`changeset.docs-projection-restore-<applyId>`) under the receipt's requestId.
 */
async function proveOrRestoreCommittedProjectionApply(
  receipt: ProjectionApplyReceiptV1,
  root: string,
  daemon: ProjectionServiceHost
): Promise<CommittedProjectionApplyOutputs> {
  const binding = receipt.recovery;
  const readbackRequest = projectionApplyReadbackRequestFromReceipt(receipt);
  if (!binding || !readbackRequest?.acceptedChange) return { kind: "unprovable" };
  const model = loadNativeModelFromArchContext(root);
  try {
    assertProjectionExpectedSnapshotAgainstModel(readbackRequest, root, model);
  } catch (error) {
    // Only a snapshot that was read and differs is a moved snapshot; a failed read is an error.
    if (error instanceof ProjectionExpectedSnapshotMismatchError) return { kind: "snapshot-moved" };
    throw error;
  }
  const readback = await daemon.readbackProjectionApply(root, readbackRequest);
  if (readback.ok) {
    if ((readback.data as { schemaVersion?: unknown } | undefined)?.schemaVersion !== PROJECTION_APPLY_READBACK_RESULT_SCHEMA_VERSION) {
      return { kind: "failed", envelope: publicFailureEnvelope("projection.run", "AC_PRECONDITION_FAILED", "projection-apply-readback-proof-unavailable", {lookupKey:receipt.identity.lookupKey,applyId:receipt.identity.applyId}) };
    }
    return { kind: "proven" };
  }
  if (readback.error?.code !== "AC_PRECONDITION_FAILED") return { kind: "failed", envelope: readback };

  let input: ReturnType<typeof buildArchitectureDocsProjection>;
  let fixedPoint: ReturnType<typeof buildArchitectureDocsProjection>;
  try {
    input = buildArchitectureDocsProjection(daemon, root, REPO_HARNESS_PROJECTION_PROFILE, undefined, readbackRequest.acceptedChange);
    assertProjectionExpectedSnapshot(readbackRequest, root, input);
    // Like the first apply, the fixed point reuses the input render's measured inputs (#324) and
    // simulates the post-write state from the rendered outputs. The write below binds its
    // preconditions to `input.loaded.existingFiles`, the real read of the reverted files.
    fixedPoint = rerenderArchitectureDocsProjection(root, input, input.files.map(simulatedProjectionFile));
  } catch (error) {
    return { kind: "failed", envelope: projectionFailureEnvelope("projection.run", error) };
  }
  // No drift against the approved render means the proof failed on something the outputs do not
  // decide (provenance, CodeGraph); a write cannot repair that, so the proof failure stands.
  if (input.plan.drift.ok) return { kind: "failed", envelope: readback };
  const issues: string[] = [];
  if (projectionProtocolHumanStatus(readbackRequest, input) !== null) issues.push("the approved change no longer renders without a human action");
  if (fixedPoint.plan.rejected.length > 0 || fixedPoint.plan.majorChange.mode !== "none" || fixedPoint.plan.refreshSignals.length > 0) {
    issues.push("the approved change no longer renders a no-accepted-change semantic fixed point");
  }
  if (fixedPoint.plan.provenance.rendererVersion !== binding.rendererVersion || fixedPoint.plan.provenance.layoutVersion !== binding.layoutVersion) {
    issues.push("the current renderer or layout differs from the approved result");
  }
  if (digestJson(fixedPoint.plan.architectureDigests as unknown as Json) !== digestJson(binding.expectedResultingDigests as unknown as Json)) {
    issues.push("the rendered model, source, flow-proof, or projection digest differs from the approved result");
  }
  if (projectionOwnedOutputDigest(fixedPoint) !== binding.ownedOutputDigest) {
    issues.push("the rendered projection-owned output bytes differ from the approved result");
  }
  if (issues.length > 0) {
    return {
      kind: "failed",
      envelope: publicFailureEnvelope("projection.run", "AC_PRECONDITION_FAILED", "projection-apply-restore-unproven", {lookupKey:receipt.identity.lookupKey,applyId:receipt.identity.applyId,issueCount:issues.length})
    };
  }
  const orphanDeletes = projectionOrphanDeleteOperations(input);
  const changeSetId = `changeset.docs-projection-restore-${receipt.identity.applyId.replace(/^sha256:/, "").slice(0, 16)}`;
  const planned = await daemon.planUpdate(root, {
    id: changeSetId,
    reason: { taskSessionId: receipt.result.requestId },
    operations: [architectureDocsRenderProjectionOperation(input.loaded.existingFiles, fixedPoint.files, orphanDeletes.map((orphan) => orphan.operation))],
    worktreeDigestPrecondition: {
      profile: "architecture-documentation-projection",
      expectedDigest: binding.originalExpectedSnapshot.worktreeDigest
    }
  });
  if (!planned.ok) return { kind: "failed", envelope: planned };
  const applied = await daemon.applyUpdate(root, {
    id: changeSetId,
    approved: true,
    expectedWorktreeDigest: binding.originalExpectedSnapshot.worktreeDigest,
    worktreeDigestProfile: "architecture-documentation-projection"
  });
  if (!applied.ok) return { kind: "failed", envelope: applied };
  // The restore counts only once readback proves the receipt again against what is now on disk.
  const proven = await daemon.readbackProjectionApply(root, readbackRequest);
  if (!proven.ok) return { kind: "failed", envelope: proven };
  if ((proven.data as { schemaVersion?: unknown } | undefined)?.schemaVersion !== PROJECTION_APPLY_READBACK_RESULT_SCHEMA_VERSION) {
    return { kind: "failed", envelope: publicFailureEnvelope("projection.run", "AC_PRECONDITION_FAILED", "projection-apply-restored-proof-unavailable", {lookupKey:receipt.identity.lookupKey,applyId:receipt.identity.applyId}) };
  }
  return { kind: "restored" };
}

/**
 * AC_PROJECTION_APPLY_COMMITTED carries everything needed to read the committed apply back: the
 * receipt's own readback request (`details.readbackRequest`, sent unchanged to `projection
 * readback`) and, when recorded, the original request digest. A caller that applied with
 * `acceptObservedMajorChange` never held the accepted change, so it cannot rebuild that request
 * itself (#278). A receipt without a request digest cannot be proven equal to any request, so its
 * requestId is never reused: the caller must pick a new one. `written` is set by `projection run`
 * after it proved the committed outputs (`false`) or restored them under the original receipt
 * (`true`, #325); the writer-time guard refuses before any write, so it passes `false`.
 */
export function projectionApplyCommittedEnvelope(
  envelopeRequestId: string,
  receipt: ProjectionApplyReceiptV1,
  reasonCode: "projection-accepted-change-committed" | "projection-apply-request-differs" | "projection-apply-request-digest-unrecorded",
  written?: boolean
): JsonEnvelope {
  const fits = projectionApplyRecoveryDetailsFit(receipt);
  return failureEnvelope(envelopeRequestId, knownFailure("AC_PROJECTION_APPLY_COMMITTED",
    fits ? reasonCode : "projection-apply-committed-manual-only",
    fits ? projectionApplyCommittedDetails(receipt, written) : projectionApplyManualOnlyDetails(receipt, written)
  )) as JsonEnvelope;
}

/**
 * The accepted change `acceptObservedMajorChange` authorizes: exactly the major change this run
 * classified. Undefined when there is none. When a capability proof is unprovable no observed
 * change can be accepted, and the flag is declined with those capability ids: the result reports
 * `unprovable-required-flow` and `majorChangeAcceptance: "declined-unprovable-proof"` instead of
 * the `unresolved-major-change` an absent flag gets (#275). The provider-generated ids are
 * content-addressed over the expected snapshot and the observed change, so one observation always
 * yields one reference and one lookup key.
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

/**
 * `check`'s read-only freshness answer: the committed manifest's per-node stamps against the
 * footprints this run measured, through the shared evaluator (`evaluateProjectionFreshness`) the
 * `complete` gate and `projection freshness` use. It reads repository files only — no daemon call,
 * no runtime state.
 */
function projectionCheckFreshness(root: string, projection: ReturnType<typeof buildArchitectureDocsProjection>): ProjectionFreshnessV1 {
  return projectionFreshnessContract(evaluateProjectionFreshness({
    model: projection.loaded.model,
    profile: projection.plan.profile,
    manifest: loadArchitectureProjectionManifestStamps(root),
    sourceFootprints: projection.sourceFootprints,
    scope: { kind: "tree", currentSourceTreeDigest: projection.currentSourceTreeDigest }
  }));
}

/** Strict decoder for the daemon reply; an unreadable answer must fail the run, never omit the field. */
function parseProjectionPriorCommittedApplies(value: unknown, requestId: string): ProjectionPriorCommittedApplyV1[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("prior committed apply reply must be an object");
  const applies = (value as { applies?: unknown }).applies;
  if (!Array.isArray(applies)) throw new Error("prior committed apply reply must carry an applies array");
  if (applies.length === 0) return [];
  const issues = projectionPriorCommittedAppliesIssues(applies as ProjectionPriorCommittedApplyV1[], requestId);
  if (issues.length > 0) throw new Error(`prior committed apply invariant failed: ${issues.join("; ")}`);
  return applies as ProjectionPriorCommittedApplyV1[];
}

/** Readback verifies the original apply without changing its delivery checkpoint. */
async function runProjectionApplyReadbackCommand(input: ProjectionRequestV1, cwd: string, daemon: ProjectionServiceHost): Promise<JsonEnvelope> {
  const raw = JSON.stringify(input);
  let request: ProjectionRequestV1;
  try {
    request = parseProjectionProtocolRequest(raw);
    const issues = projectionApplyReadbackRequestInvariantIssues(request);
    if (issues.length > 0) throw new Error(issues.join("; "));
  } catch (error) {
    return publicFailureEnvelope("projection.readback", "AC_SCHEMA_INVALID", "projection-readback-input-invalid", {});
  }
  try {
    const result = await daemon.readbackProjectionApply(findRepositoryRoot(cwd), request);
    if (!result.ok) return result;
    const issues = (result.data as any)?.schemaVersion === "archcontext.projection-apply-absence/v1"
      ? projectionApplyAbsenceInvariantIssues(result.data as unknown as ProjectionApplyAbsenceV1, request)
      : projectionApplyReadbackResultInvariantIssues(result.data as unknown as ProjectionApplyReadbackResultV1, request);
    return issues.length === 0 ? result : publicFailureEnvelope("projection.readback", "AC_SCHEMA_INVALID", "projection-readback-result-invalid", {issueCount:issues.length});
  } catch (error) {
    return projectionFailureEnvelope("projection.readback", error);
  }
}

/**
 * `projection recover` is deliberately separate from `projection run apply`: a later request may
 * deliver a committed receipt only after this command proves the current fixed point is still the
 * exact result covered by the original approval.
 */
async function runProjectionApplyRecoveryCommand(input: ProjectionApplyRecoveryIntentV1, cwd: string, daemon: ProjectionServiceHost): Promise<JsonEnvelope> {
  const raw = JSON.stringify(input);
  let intent: ProjectionApplyRecoveryIntentV1;
  try {
    intent = parseProjectionApplyRecoveryIntent(raw);
  } catch (error) {
    return publicFailureEnvelope("projection.recover", "AC_SCHEMA_INVALID", "projection-recovery-input-invalid", {});
  }
  return recoverProjectionApplyIntent(intent, findRepositoryRoot(cwd), daemon);
}

async function recoverProjectionApplyIntent(
  intent: ProjectionApplyRecoveryIntentV1,
  root: string,
  daemon: ProjectionServiceHost
): Promise<JsonEnvelope> {
  let recovered: JsonEnvelope;
  try {
    recovered = await daemon.recoverProjectionApply(root, intent);
  } catch (error) {
    return projectionFailureEnvelope("projection.recover", error);
  }
  if (!recovered.ok) return recovered;
  const consumption = recovered.data as {
    found?: boolean;
    receipt?: ProjectionApplyReceiptV1;
    proof?: ProjectionApplyRecoveryProofV1;
    refreshSignalsDelivered?: boolean;
  };
  if (consumption.found !== true || !consumption.receipt || !consumption.proof) {
    return publicFailureEnvelope("projection.recover", "AC_PRECONDITION_FAILED", "projection-recovery-delivery-unavailable", {lookupKey:intent.receipt.lookupKey,applyId:intent.receipt.applyId});
  }
  return projectionApplyRecoveryResultEnvelope({
    schemaVersion: PROJECTION_APPLY_RECOVERY_RESULT_SCHEMA_VERSION,
    proof: consumption.proof,
    refreshSignals: consumption.refreshSignalsDelivered ? consumption.receipt.result.refreshSignals : []
  });
}

function createProjectionApplyRecoveryBinding(
  request: ProjectionRequestV1,
  projection: ReturnType<typeof buildArchitectureDocsProjection>,
  result: ProjectionResultV2
): ProjectionApplyRecoveryBindingV1 {
  const provenance = projection.plan.provenance;
  return {
    schemaVersion: "archcontext.projection-apply-recovery-binding/v1",
    targets: [...request.targets],
    changedPaths: [...request.changedPaths],
    originalExpectedSnapshot: { ...request.expected },
    expectedResultingDigests: projection.plan.architectureDigests as ProjectionApplyRecoveryBindingV1["expectedResultingDigests"],
    rendererVersion: provenance.rendererVersion,
    layoutVersion: provenance.layoutVersion,
    generatedFrom: projectionProtocolGeneratedFrom(provenance, projection.runtimeSnapshot),
    ownedOutputDigest: projectionOwnedOutputDigest(projection),
    receiptDigest: result.receiptDigest,
    requestDigest: digestJson(request as unknown as Json) as Sha256Digest
  };
}

function projectionOwnedOutputDigest(projection: ReturnType<typeof buildArchitectureDocsProjection>): Sha256Digest {
  return digestJson({
    schemaVersion: "archcontext.projection-owned-output/v1",
    files: projection.files.map((file) => ({ path: file.path, body: file.body }))
      .sort((left, right) => left.path.localeCompare(right.path))
  } as unknown as Json) as Sha256Digest;
}

function projectionApplyRecoveryResultEnvelope(result: ProjectionApplyRecoveryResultV1): JsonEnvelope {
  const issues = projectionApplyRecoveryResultInvariantIssues(result);
  return issues.length === 0
    ? okEnvelope("projection.recover", result as unknown as Json)
    : publicFailureEnvelope("projection.recover", "AC_SCHEMA_INVALID", "projection-recovery-result-invalid", {issueCount:issues.length});
}

function parseProjectionApplyRecoveryIntent(raw: string): ProjectionApplyRecoveryIntentV1 {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("projection recovery intent is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("projection recovery intent must be an object");
  const input = value as Record<string, unknown>;
  const allowedKeys = new Set(["schemaVersion", "requestId", "profile", "receipt"]);
  const unsupported = Object.keys(input).find((key) => !allowedKeys.has(key));
  if (unsupported) throw new Error(`projection recovery intent contains unsupported property: ${unsupported}`);
  if (input.schemaVersion !== PROJECTION_APPLY_RECOVERY_INTENT_SCHEMA_VERSION) throw new Error("projection recovery intent schemaVersion mismatch");
  if (input.profile !== REPO_HARNESS_PROJECTION_PROFILE) throw new Error(`projection recovery intent profile must be ${REPO_HARNESS_PROJECTION_PROFILE}`);
  if (typeof input.requestId !== "string") throw new Error("projection recovery intent requestId is required");
  const receipt = input.receipt;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error("projection recovery intent receipt must be an object");
  const receiptInput = receipt as Record<string, unknown>;
  const receiptUnsupported = Object.keys(receiptInput).find((key) => key !== "lookupKey" && key !== "applyId");
  if (receiptUnsupported) throw new Error(`projection recovery intent receipt contains unsupported property: ${receiptUnsupported}`);
  for (const field of ["lookupKey", "applyId"] as const) {
    if (typeof receiptInput[field] !== "string" || !/^sha256:[a-f0-9]{64}$/.test(receiptInput[field] as string)) {
      throw new Error(`projection recovery intent receipt.${field} is invalid`);
    }
  }
  const intent = input as unknown as ProjectionApplyRecoveryIntentV1;
  const issues = projectionApplyRecoveryIntentInvariantIssues(intent);
  if (issues.length > 0) throw new Error(`projection recovery intent invariant failed: ${issues.join("; ")}`);
  return intent;
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
  model: ReturnType<typeof loadNativeModelFromArchContext>
): ProjectionExpectedSnapshotV1 {
  return {
    repositoryId: repositoryFingerprint(root),
    workspaceId: projectionWorkspaceId(root),
    headSha: readHeadSha(root),
    worktreeDigest: architectureDocumentationProjectionWorktreeDigest(root, model, listGitVisibleFiles(root)) as Sha256Digest
  };
}

/**
 * `projection snapshot`: the `expected` snapshot a `projection run` request would be checked
 * against right now, from `currentProjectionExpectedSnapshot`. Read-only and in-process like
 * `check`: no daemon, no local store, no task session, no CodeGraph sync and no render. A root
 * that is not a Git worktree fails with `AC_REPO_NOT_FOUND` (`git-worktree-required`).
 */
export function runProjectionSnapshotCommand(cwd: string): JsonEnvelope {
  try { return publicOperationResult("projection.snapshot", runProjectionSnapshotCommandUnchecked(cwd)) as JsonEnvelope; }
  catch (error) { return publicOperationErrorEnvelope("projection.snapshot", error); }
}

function runProjectionSnapshotCommandUnchecked(cwd: string): JsonEnvelope {
  let root: string;
  try {
    root = findRepositoryRoot(cwd);
  } catch (error) {
    return publicFailureEnvelope("projection.snapshot", "AC_REPO_NOT_FOUND", "git-worktree-required");
  }
  try {
    return okEnvelope("projection.snapshot", {
      expected: currentProjectionExpectedSnapshot(root, loadNativeModelFromArchContext(root))
    } as unknown as Json);
  } catch (error) {
    return publicOperationErrorEnvelope("projection.snapshot", error);
  }
}

/**
 * `projection freshness` (#327): which stamped documents describe code that moved since they were
 * verified, from the committed manifest, the model and the Git-visible files only. It answers with
 * the evaluator `check` uses, so on the same tree its `staleNodes` equal `check`'s, but it needs no
 * code facts, renders nothing, starts no daemon, opens no local store and writes nothing.
 * `changedPaths` limits the probe to the stamped nodes whose footprint selects one of the paths,
 * unless one is under `.archcontext/`: the model decides every footprint and stamp, so that run
 * evaluates the whole tree and reports `scope: "tree"`, `scopeReason: "model-path-changed"`. A
 * root that is not a Git worktree fails with `AC_REPO_NOT_FOUND` (`git-worktree-required`).
 */
export function runProjectionFreshnessCommand(cwd: string, options: { changedPaths?: readonly string[] } = {}): JsonEnvelope {
  try { return publicOperationResult("projection.freshness", runProjectionFreshnessCommandUnchecked(cwd, options)) as JsonEnvelope; }
  catch (error) { return publicOperationErrorEnvelope("projection.freshness", error); }
}

function runProjectionFreshnessCommandUnchecked(cwd: string, options: { changedPaths?: readonly string[] } = {}): JsonEnvelope {
  let root: string;
  try {
    root = findRepositoryRoot(cwd);
  } catch (error) {
    return publicFailureEnvelope("projection.freshness", "AC_REPO_NOT_FOUND", "git-worktree-required");
  }
  try {
    const measured = measureProjectionFreshness(root, options.changedPaths === undefined ? {} : { changedPaths: options.changedPaths });
    const freshness = projectionFreshnessContract(measured.evaluation);
    const issues = projectionFreshnessIssues(freshness);
    if (issues.length > 0) throw new Error(`projection-freshness-invalid: ${issues.join("; ")}`);
    return okEnvelope("projection.freshness", {
      profile: measured.profile,
      changedPaths: measured.changedPaths,
      evaluatedNodeIds: measured.evaluatedNodeIds,
      ...(measured.scope === undefined ? {} : { scope: measured.scope, scopeReason: measured.scopeReason }),
      freshness
    } as unknown as Json);
  } catch (error) {
    if (error instanceof ProjectionFreshnessChangedPathError) {
      return errorEnvelope("projection.freshness", error.code, error.message, error.reasonCode, { changedPath: error.changedPath });
    }
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
): ProjectionResultV2["status"] | null {
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

function projectionReviewOrphans(projection: ReturnType<typeof buildArchitectureDocsProjection>) {
  return projection.plan.orphans.filter((orphan) => orphan.disposition === "human-review");
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
  result: ProjectionResultV2["files"][number];
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
  status: ProjectionResultV2["status"],
  output: ReturnType<typeof buildArchitectureDocsProjection>,
  priorCommittedApplies: ProjectionPriorCommittedApplyV1[],
  freshness?: ProjectionFreshnessV1,
  declinedUnprovableNodeIds?: string[]
): JsonEnvelope {
  return projectionProtocolResultEnvelope(projectionProtocolResult(request, input, status, output, undefined, undefined, priorCommittedApplies, freshness, declinedUnprovableNodeIds));
}

function projectionProtocolResult(
  request: ProjectionRequestV1,
  input: ReturnType<typeof buildArchitectureDocsProjection>,
  status: ProjectionResultV2["status"],
  output: ReturnType<typeof buildArchitectureDocsProjection> = input,
  applyReceipt?: ProjectionApplyIdentityV1,
  overrides?: {
    files: ProjectionResultV2["files"];
    refreshSignals: ArchitectureRefreshSignalV1[];
  },
  priorCommittedApplies: ProjectionPriorCommittedApplyV1[] = [],
  freshness?: ProjectionFreshnessV1,
  declinedUnprovableNodeIds?: string[]
): ProjectionResultV2 {
  const inputSnapshot = projectionProtocolSnapshot(request, input);
  const outputSnapshot = projectionProtocolSnapshot(request, output);
  const plannedFiles = overrides?.files ?? projectionProtocolFiles(input);
  const files = request.mode === "plan" ? withProjectionPlanPreviews(input, plannedFiles) : plannedFiles;
  const affectedNodeIds = projectionProtocolAffectedNodes(input);
  const requestPayloadDigest = digestJson(request as unknown as Json) as Sha256Digest;
  const humanActions: ProjectionResultV2["humanActions"] = [];
  if (status === "adoption-required") {
    humanActions.push({ reasonCode: "adoption-required", affectedNodeIds, requestPayloadDigest });
  } else if (status === "human-action-required") {
    if (declinedUnprovableNodeIds) {
      // The flag was declined: name the capabilities whose proof blocks acceptance, so the caller
      // does not retry the flag against the same unresolved change.
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
  // Debt is reported, never acted on: it is read from the input render and changes no status or file.
  const architectureDebt = request.mode === "check" || request.mode === "plan"
    ? projectionArchitectureDebt(input.loaded.model, {
      ...input.importEvidence,
      codeGraphStatus: input.runtimeSnapshot.codeGraphStatus,
      worktreeDigest: input.runtimeSnapshot.worktreeDigest
    })
    : undefined;
  // Classification is reported, never acted on: it reads the input render and the files this
  // result reports, and changes no status, file or gate (#327).
  const changes = request.mode === "check" || request.mode === "plan" ? projectionTargetChanges(input, plannedFiles) : undefined;
  const withoutReceipt: Omit<ProjectionResultV2, "receiptDigest"> = {
    schemaVersion: "archcontext.projection-result/v2",
    requestId: request.requestId,
    status,
    inputSnapshot,
    outputSnapshot,
    affectedNodeIds,
    files,
    humanActions,
    refreshSignals,
    ...(applyReceipt ? { applyReceipt } : {}),
    ...(priorCommittedApplies.length > 0 ? { priorCommittedApplies } : {}),
    ...(freshness ? { freshness } : {}),
    ...(architectureDebt ? { architectureDebt } : {}),
    ...(changes ? { changes } : {}),
    ...(declinedUnprovableNodeIds && status === "human-action-required" ? { majorChangeAcceptance: "declined-unprovable-proof" as const } : {}),
    ...(status === "planned-partial" || status === "applied-partial" ? { coverage: projectionCoverage(input) } : {})
  };
  const receiptDigest = projectionResultReceiptDigest(withoutReceipt);
  const result: ProjectionResultV2 = {
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
  files: ProjectionResultV2["files"]
): ProjectionTargetChangeV1[] {
  return classifyProjectionTargetChanges({
    committed: projection.plan.committedManifest,
    renderedTargets: projection.plan.renderedTargets,
    modelDigest: projection.plan.provenance.modelDigest,
    capabilities: projection.plan.semanticState.capabilities,
    selectorEvidenceDigests: projection.plan.proofEvidence.selectorEvidenceDigests,
    files,
    rejected: projection.plan.rejected,
    orphans: projection.plan.orphans,
    blockedTargets: projection.plan.isolation?.blockedTargets ?? []
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

function projectionProtocolResultEnvelope(result: ProjectionResultV2): JsonEnvelope {
  const issues = projectionResultInvariantIssues(result);
  return issues.length === 0
    ? okEnvelope("projection.run", result as unknown as Json)
    : publicFailureEnvelope("projection.run", "AC_SCHEMA_INVALID", "projection-result-invalid", {});
}

function projectionResultDelivery(
  source: ProjectionResultV2,
  status: ProjectionResultV2["status"],
  refreshSignals: ArchitectureRefreshSignalV1[],
  requestId = source.requestId
): ProjectionResultV2 {
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
): ProjectionResultV2["files"] {
  if (projection.plan.drift.ok) return [];
  const rejected = projection.plan.rejected.flatMap<ProjectionResultV2["files"][number]>((diff) => {
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
): ProjectionResultV2["files"] {
  const readByPath = new Map(renderInput.map((file) => [file.path, file.onDisk]));
  const writes = projectionFilesBoundToRenderInput(renderInput, files).flatMap<ProjectionResultV2["files"][number]>((write) => {
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
  files: ProjectionResultV2["files"]
): ProjectionResultV2["files"] {
  const rendered = new Map(projection.files.map((file) => [file.path, file.body]));
  const current = new Map(projection.loaded.existingFiles.map((file) => [file.path, file.body]));
  const rejected = new Set(projection.plan.rejected.map((diff) => diff.path));
  const previewable = files.filter((file): file is ProjectionResultV2["files"][number] & { action: "create" | "delete" | "update" } =>
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
    sourceDigest: projection.plan.sourceDigest,
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

/**
 * Among `paths`, the agent-context target files whose bytes differ from what `agent-context apply`
 * would write at `root` now, or that the model no longer renders. Read-only: the same render and
 * write-body binding as the apply, with no ChangeSet. `projection run` does not render agent
 * context, so a reader that must prove a contract file is rendered output asks here.
 */
export function agentContextProjectionDifferingPaths(root: string, paths: readonly string[]): string[] {
  const wanted = new Set(paths);
  if (wanted.size === 0) return [];
  const projection = buildAgentContextProjection(root);
  const onDisk = new Map(projection.existingFiles.map((file) => [file.path, file.onDisk]));
  const written = projectionFilesBoundToRenderInput(projection.existingFiles, projection.plan.files);
  const rendered = new Set(written.map((file) => file.path));
  return [...new Set([
    ...written.filter((file) => wanted.has(file.path) && onDisk.get(file.path) !== file.body).map((file) => file.path),
    ...[...wanted].filter((path) => !rendered.has(path))
  ])].sort();
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
    plan: renderAgentContextProjection({ model, sourceDigest, existingFiles })
  };
}

/**
 * Each write's precondition hashes the raw bytes (`onDisk`) of the render's own read, never a
 * fresh disk read: the render preserves human text outside generated markers from exactly those
 * bytes, so an edit made after that read fails the ChangeSet hash recheck under the daemon writer
 * lock instead of being overwritten by a body rendered without it. The written body keeps the
 * line endings of those bytes.
 */
function architectureDocsRenderProjectionOperation(
  renderInput: readonly ProjectionOwnedFile[],
  files: { path: string; body: string }[],
  deletes: { path: string; expectedHash: string; delete: true }[] = [],
  carriedPaths: readonly string[] = []
) {
  return {
    op: "render_projection" as const,
    expectedHash: "missing",
    projectionFiles: [
      ...projectionFilesBoundToRenderInput(renderInput, files),
      ...deletes,
      ...projectionGuardsBoundToRenderInput(renderInput, carriedPaths)
    ]
  };
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
  if (input.action === "recover") {
    parseProjectionApplyRecoveryIntent(JSON.stringify(input.request));
  } else if (input.action === "run" || input.action === "readback") {
    const request = parseProjectionProtocolRequest(JSON.stringify(input.request));
    if (input.action === "readback") {
      const issues = projectionApplyReadbackRequestInvariantIssues(request);
      if (issues.length) throw new Error(issues.join("; "));
    }
  } else throw new Error("projection action must be run, readback or recover");
}

export function projectionInvocationWrites(input: RuntimeProjectionInvocation): boolean {
  return input.action === "recover" || (input.action === "run" && ["apply", "adopt"].includes(input.request.mode));
}

export function assertProjectionInvocationSnapshot(root: string, input: RuntimeProjectionInvocation): void {
  if (input.action !== "recover") assertProjectionExpectedSnapshotAgainstModel(input.request, findRepositoryRoot(root), loadNativeModelFromArchContext(root));
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
