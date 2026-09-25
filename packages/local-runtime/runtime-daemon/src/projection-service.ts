import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeWorktreeDigest, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { findRepositoryRoot, readHeadSha } from "@archcontext/local-runtime/git-adapter";
import { prepareArchitectureDocumentationProjectionSnapshot } from "@archcontext/local-runtime/codegraph-adapter";
import { projectionWorkspaceId, readArchitectureProjectionVerifiedAgainst } from "./projection-inputs";
import type { RuntimeDaemonClient } from "./rpc-protocol";
import { PROJECTION_APPLY_RECOVERY_INTENT_SCHEMA_VERSION, PROJECTION_APPLY_RECOVERY_RESULT_SCHEMA_VERSION, PROJECTION_MODES, PROJECTION_REQUEST_SCHEMA_VERSION, PROJECTION_TARGETS, createProjectionApplyIdentity, digestJson, errorEnvelope, isRepoRelativePosixPath, okEnvelope, projectionApplyAbsenceInvariantIssues, projectionApplyReadbackRequestInvariantIssues, projectionApplyReadbackResultInvariantIssues, projectionApplyRecoveryIntentInvariantIssues, projectionApplyRecoveryResultInvariantIssues, projectionApplyLookupKey, projectionPriorCommittedAppliesIssues, projectionRequestInvariantIssues, projectionResultInvariantIssues, projectionResultReceiptDigest } from "@archcontext/contracts";
import type { AcceptedArchitectureChangeReferenceV1, ArchitectureRefreshSignalV1, Json, JsonEnvelope, ProjectionApplyAbsenceV1, ProjectionApplyReadbackResultV1, ProjectionApplyIdentityV1, ProjectionApplyReceiptV1, ProjectionApplyRecoveryBindingV1, ProjectionApplyRecoveryIntentV1, ProjectionApplyRecoveryProofV1, ProjectionApplyRecoveryResultV1, ProjectionPriorCommittedApplyV1, ProjectionRequestV1, ProjectionResultV2, ProjectionSnapshotV1, Sha256Digest } from "@archcontext/contracts";
import { REPO_HARNESS_PROJECTION_PROFILE, architectureAdoptionReceipt, architectureDocumentationSourceDigest, buildArchitectureDocumentationAdoptionPlan, loadAgentContextProjectionFiles, loadArchitectureDocumentationInputs, loadCapabilitySourceScaleSignals, loadNativeModelFromArchContext, renderAgentContextProjection, renderArchitectureDocumentationProjection, architectureDocumentationProjectionWorktreeDigest, type ArchitectureProjectionProfile, type ArchitectureMajorChangeClassificationV1, type ArchitectureDocumentationProjectionNotice, type ArchitectureDocumentationProjectionProvenanceV1 } from "@archcontext/core/projection-engine";

export interface RuntimeDocsProjectionInput {
  action: "plan" | "preview" | "apply" | "adopt" | "drift" | "clean";
  profile?: ArchitectureProjectionProfile;
  generatedAt?: string;
  acceptedChange?: AcceptedArchitectureChangeReferenceV1;
  id?: string;
  taskSessionId?: string;
  approved?: boolean;
  expectedWorktreeDigest?: string;
  adoptionPlanId?: string;
}
export interface RuntimeAgentContextProjectionInput {
  action: "plan" | "preview" | "apply";
  id?: string;
  taskSessionId?: string;
  approved?: boolean;
  expectedWorktreeDigest?: string;
}
export type RuntimeProjectionInvocation =
  | { action: "run" | "readback"; request: ProjectionRequestV1 }
  | { action: "recover"; request: ProjectionApplyRecoveryIntentV1 };
export type ProjectionServiceHost = Pick<RuntimeDaemonClient, "planUpdate" | "applyUpdate" | "listProjectionPriorCommittedApplies" | "inspectProjectionApplyReceipt" | "readbackProjectionApply" | "recoverProjectionApply"> & {
  loadCapabilitySourceChangesSinceStamps: typeof import("./index").loadCapabilitySourceChangesSinceStamps;
};

export async function runArchitectureDocsProjectionCommand(input: RuntimeDocsProjectionInput, cwd: string, daemon: ProjectionServiceHost) {
  const subcommand = input.action ?? "plan";
  const root = findRepositoryRoot(cwd);
  const generatedAt = input.generatedAt ?? new Date(0).toISOString();
  let profile: ArchitectureProjectionProfile;
  let projection: ReturnType<typeof buildArchitectureDocsProjection>;
  let acceptedChange: AcceptedArchitectureChangeReferenceV1 | undefined;
  try {
    profile = input.profile ?? "default";
    acceptedChange = input.acceptedChange;
    projection = buildArchitectureDocsProjection(daemon, root, generatedAt, profile, undefined, acceptedChange);
  } catch (error) {
    return errorEnvelope(`docs.${subcommand}`, "AC_PRECONDITION_FAILED", error instanceof Error ? error.message : String(error));
  }
  if (subcommand === "drift") {
    return okEnvelope("docs.drift", {
      schemaVersion: "archcontext.docs-drift/v1",
      ok: projection.plan.drift.ok,
      sourceDigest: projection.plan.sourceDigest,
      projectionDigest: projection.plan.projectionDigest,
      profile: projection.plan.profile,
      rendererVersion: projection.plan.rendererVersion,
      targetCount: projection.plan.targets.length,
      fileCount: projection.plan.files.length,
      drift: projection.plan.drift,
      rejected: projection.plan.rejected,
      majorChange: projection.plan.majorChange,
      refreshSignals: projection.plan.refreshSignals,
      receiptDigest: projection.plan.receiptDigest,
      notices: projection.plan.notices
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
    return runArchitectureDocsAdoptionCommand(input, root, daemon, projection, profile, generatedAt);
  }
  if (projection.plan.rejected.length > 0) {
    return errorEnvelope("docs.plan", "AC_PRECONDITION_FAILED", `Architecture documentation projection requires explicit adoption or ownership repair: ${projection.plan.rejected.map((diff) => `${diff.path} (${diff.reasonCode})`).join(", ")}`);
  }
  if (subcommand === "apply" && profile === REPO_HARNESS_PROJECTION_PROFILE && projection.plan.drift.ok) {
    return okEnvelope("docs.apply", {
      schemaVersion: "archcontext.docs-projection-apply/v1",
      status: "noop",
      profile,
      sourceDigest: projection.plan.sourceDigest,
      projectionDigest: projection.plan.projectionDigest,
      provenance: projection.plan.provenance,
      majorChange: projection.plan.majorChange,
      refreshSignals: projection.plan.refreshSignals,
      receiptDigest: projection.plan.receiptDigest,
      ...(projection.plan.notices.length === 0 ? {} : { notices: projection.plan.notices })
    } as unknown as Json);
  }
  const changeSetId = input.id ?? `changeset.docs-projection-${projection.plan.projectionDigest.replace(/^sha256:/, "").slice(0, 16)}`;
  const operations = [architectureDocsRenderProjectionOperation(root, projection.files)];
  const plan = await daemon.planUpdate(root, {
    id: changeSetId,
    reason: { taskSessionId: input.taskSessionId ?? "task_docs_projection" },
    operations
  });
  if (!plan.ok) return plan;
  if (subcommand === "apply") {
    const expectedWorktreeDigest = input.expectedWorktreeDigest ?? computeWorktreeDigest(root);
    const applied = await daemon.applyUpdate(root, {
      id: changeSetId,
      approved: input.approved === true,
      expectedWorktreeDigest
    });
    return withProjectionMetadata(
      applied,
      projection.plan.notices,
      projection.plan.provenance,
      projection.plan.majorChange,
      projection.plan.refreshSignals,
      projection.plan.receiptDigest
    );
  }
  return okEnvelope(subcommand === "preview" ? "docs.preview" : "docs.plan", {
    schemaVersion: "archcontext.docs-projection-change-set/v1",
    sourceDigest: projection.plan.sourceDigest,
    projectionDigest: projection.plan.projectionDigest,
    rendererVersion: projection.plan.rendererVersion,
    targetCount: projection.plan.targets.length,
    fileCount: projection.files.length,
    drift: projection.plan.drift,
    notices: projection.plan.notices,
    provenance: projection.plan.provenance,
    majorChange: projection.plan.majorChange,
    refreshSignals: projection.plan.refreshSignals,
    receiptDigest: projection.plan.receiptDigest,
    manifestPath: projection.manifest.path,
    draft: (plan.data as any).draft,
    preview: (plan.data as any).preview
  } as unknown as Json);
}

/**
 * Carries the renderer's non-blocking notices onto the `apply` envelope, which otherwise comes
 * straight from the daemon and would swallow them. A re-stamp the renderer could not corroborate
 * (rebased or missing stamp commit) must be visible on the surface that wrote the files, not only
 * on `plan`.
 */
function withProjectionMetadata(
  envelope: JsonEnvelope,
  notices: ArchitectureDocumentationProjectionNotice[],
  provenance: ArchitectureDocumentationProjectionProvenanceV1,
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
      majorChange: majorChange as unknown as Json,
      refreshSignals: refreshSignals as unknown as Json,
      receiptDigest,
      ...(notices.length === 0 ? {} : { notices: notices as unknown as Json })
    }
  };
}

export function buildArchitectureDocsProjection(
  daemon: ProjectionServiceHost,
  root: string,
  generatedAt: string,
  profile: ArchitectureProjectionProfile = "default",
  existingFilesOverride?: { path: string; body: string }[],
  acceptedChange?: AcceptedArchitectureChangeReferenceV1
) {
  const loadedFromDisk = loadArchitectureDocumentationInputs(root, profile);
  const loaded = { ...loadedFromDisk, existingFiles: existingFilesOverride ?? loadedFromDisk.existingFiles };
  const sourceDigest = architectureDocumentationSourceDigest({ model: loaded.model, profile, decisions: loaded.decisions });
  const codeGraphInputs = prepareArchitectureDocumentationProjectionSnapshot(root, loaded.model);
  const provenance = codeGraphInputs.provenance;
  const plan = renderArchitectureDocumentationProjection({
    model: loaded.model,
    profile,
    decisions: loaded.decisions,
    existingFiles: loaded.existingFiles,
    verifiedAgainst: readArchitectureProjectionVerifiedAgainst(root),
    sourceChangesSinceStamp: daemon.loadCapabilitySourceChangesSinceStamps(root, loaded.model),
    sourceScaleSignals: loadCapabilitySourceScaleSignals(root, loaded.model),
    importGraphs: codeGraphInputs.importGraphs,
    selectorEvidence: codeGraphInputs.selectorEvidence,
    provenance,
    sourceDigest,
    generatedAt,
    refreshContext: {
      repositoryId: repositoryFingerprint(root),
      workspaceId: projectionWorkspaceId(root),
      headSha: provenance.baseHeadSha,
      worktreeDigest: provenance.worktreeDigest,
      ...(acceptedChange ? { acceptedChange } : {})
    }
  });
  return {
    loaded,
    plan,
    manifest: plan.manifest,
    files: [...plan.files, plan.manifest]
  };
}



async function runArchitectureDocsAdoptionCommand(
  input: RuntimeDocsProjectionInput,
  root: string,
  daemon: ProjectionServiceHost,
  projection: ReturnType<typeof buildArchitectureDocsProjection>,
  profile: ArchitectureProjectionProfile,
  generatedAt: string,
  protocolRequest?: ProjectionRequestV1,
  priorCommittedApplies: ProjectionPriorCommittedApplyV1[] = []
) {
  if (profile !== REPO_HARNESS_PROJECTION_PROFILE) {
    return errorEnvelope("docs.adopt", "AC_SCHEMA_INVALID", `docs adopt requires --profile ${REPO_HARNESS_PROJECTION_PROFILE}`);
  }
  const currentWorktreeDigest = computeWorktreeDigest(root);
  const existingByPath = new Map(projection.loaded.existingFiles.map((file) => [file.path, file.body]));
  const missingCandidate = projection.plan.adoptionCandidates.find((file) => !existingByPath.has(file.path));
  if (missingCandidate) {
    return errorEnvelope("docs.adopt", "AC_PRECONDITION_FAILED", `projection-adoption-preimage-missing: ${missingCandidate.path}`);
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
    return errorEnvelope("docs.adopt", "AC_PRECONDITION_FAILED", adoption.issues.join(", "));
  }
  const expectedPlanId = input.adoptionPlanId;
  const expectedWorktreeDigest = input.expectedWorktreeDigest;
  if (!expectedPlanId || !expectedWorktreeDigest) {
    return errorEnvelope("docs.adopt", "AC_SCHEMA_INVALID", "approved docs adopt requires --adoption-plan-id and --expected-worktree-digest from preview");
  }
  if (expectedPlanId !== adoption.adoptionPlanId || expectedWorktreeDigest !== adoption.expectedWorktreeDigest) {
    return errorEnvelope("docs.adopt", "AC_PRECONDITION_FAILED", "projection-adoption-preview-mismatch");
  }
  const simulatedByPath = new Map(projection.loaded.existingFiles.map((file) => [file.path, file]));
  for (const file of [...projection.files, ...adoption.files]) simulatedByPath.set(file.path, file);
  const canonicalFirst = buildArchitectureDocsProjection(daemon, root, generatedAt, profile, [...simulatedByPath.values()]);
  const canonicalExistingByPath = new Map(simulatedByPath);
  for (const file of canonicalFirst.files) canonicalExistingByPath.set(file.path, file);
  // Adoption changes whole-document digests. Refresh signal IDs then settle against that
  // canonical baseline in the manifest before a final render can prove the fixed point.
  const canonicalBaseline = buildArchitectureDocsProjection(daemon, root, generatedAt, profile, [...canonicalExistingByPath.values()]);
  for (const file of canonicalBaseline.files) canonicalExistingByPath.set(file.path, file);
  const canonical = buildArchitectureDocsProjection(daemon, root, generatedAt, profile, [...canonicalExistingByPath.values()]);
  if (!canonical.plan.drift.ok || canonical.plan.rejected.length > 0 || canonical.plan.projectionDigest !== canonicalFirst.plan.projectionDigest) {
    const reasons = canonical.plan.rejected.map((entry) => entry.reasonCode).join(",") || "none";
    const drift = canonical.plan.drift.diffs.map((entry) => `${entry.path}:${entry.reasonCode}`).join(",") || "none";
    return errorEnvelope("docs.adopt", "AC_PRECONDITION_FAILED", `projection-adoption-fixed-point-unproven: drift=${drift}; rejected=${reasons}; digest=${canonical.plan.projectionDigest === canonicalFirst.plan.projectionDigest ? "stable" : "changed"}`);
  }
  if (protocolRequest) {
    return applyProjectionProtocolFixedPoint(protocolRequest, projection, canonical, adoption.changeSetId, root, daemon, priorCommittedApplies);
  }
  const filesByPath = new Map<string, { path: string; body: string }>();
  for (const file of canonical.files) filesByPath.set(file.path, file);
  const planned = await daemon.planUpdate(root, {
    id: adoption.changeSetId,
    reason: { taskSessionId: input.taskSessionId ?? "task_docs_adoption" },
    operations: [architectureDocsRenderProjectionOperation(root, [...filesByPath.values()])]
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
  priorCommittedApplies: ProjectionPriorCommittedApplyV1[]
): Promise<JsonEnvelope> {
  const committedFiles = projectionProtocolFilesForExpectedOutput(root, fixedPoint);
  const committedSignals = request.acceptedChange
    ? input.plan.refreshSignals.map((signal) => ({
        ...signal,
        resultingDigests: fixedPoint.plan.architectureDigests
      }))
    : fixedPoint.plan.refreshSignals;
  const applyIdentity = request.acceptedChange
    ? createProjectionApplyIdentity({
        repositoryId: request.expected.repositoryId,
        workspaceId: request.expected.workspaceId,
        acceptedChange: request.acceptedChange,
        changeSetId,
        idempotencyKey: `idem_${changeSetId}`,
        files: committedFiles,
        refreshSignals: committedSignals
      })
    : undefined;
  const appliedResult = projectionProtocolResult(request, input, "applied", fixedPoint, applyIdentity, {
    files: committedFiles,
    refreshSignals: committedSignals
  }, priorCommittedApplies);
  let recoveryBinding: ProjectionApplyRecoveryBindingV1 | undefined;
  if (applyIdentity) {
    try {
      recoveryBinding = createProjectionApplyRecoveryBinding(request, fixedPoint, appliedResult);
    } catch (error) {
      return errorEnvelope("projection.run", "AC_PRECONDITION_FAILED", error instanceof Error ? error.message : String(error));
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
  const planned = await daemon.planUpdate(root, {
    id: changeSetId,
    reason: { taskSessionId: request.requestId },
    operations: [architectureDocsRenderProjectionOperation(root, fixedPoint.files)],
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
    postApplyMatches = architectureDocumentationProjectionWorktreeDigest(root, loadNativeModelFromArchContext(root))
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
    return errorEnvelope("projection.run", "AC_PRECONDITION_FAILED", "committed projection apply receipt was not available for first delivery");
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
  const subcommand = invocation.action;
  if (subcommand === "readback") return runProjectionApplyReadbackCommand(invocation.request, cwd, daemon);
  if (subcommand === "recover") return runProjectionApplyRecoveryCommand(invocation.request, cwd, daemon);
  if (subcommand !== "run") return errorEnvelope("projection", "AC_SCHEMA_INVALID", "projection requires run|recover|readback --request-json <request>");
  const raw = JSON.stringify(invocation.request);

  let request: ProjectionRequestV1;
  try {
    request = parseProjectionProtocolRequest(raw);
  } catch (error) {
    return errorEnvelope("projection.run", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }

  const root = findRepositoryRoot(cwd);
  const generatedAt = new Date(0).toISOString();
  // Snapshot the journal before this command can write anything: whatever is committed under this
  // requestId now belongs to an earlier attempt by construction, so no changeSetId comparison is
  // needed against this run's own commit (the protocol changeSetId is derived from the projection
  // digest and repeats across attempts of the same request).
  let priorCommittedApplies: ProjectionPriorCommittedApplyV1[];
  try {
    const listed = await daemon.listProjectionPriorCommittedApplies(root, request.requestId);
    if (!listed.ok) return listed;
    priorCommittedApplies = parseProjectionPriorCommittedApplies(listed.data, request.requestId);
  } catch (error) {
    return errorEnvelope("projection.run", "AC_PRECONDITION_FAILED", `projection prior committed apply lookup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (request.mode === "apply" && request.acceptedChange) {
    try {
      assertProjectionExpectedSnapshotAgainstModel(request, root, loadNativeModelFromArchContext(root));
      const inspected = await daemon.inspectProjectionApplyReceipt(root, projectionApplyLookupKey({
        repositoryId: request.expected.repositoryId,
        workspaceId: request.expected.workspaceId,
        acceptedChange: request.acceptedChange
      }));
      if (!inspected.ok) return inspected;
      if ((inspected.data as { found?: boolean }).found === true) {
        return errorEnvelope("projection.run", "AC_PRECONDITION_FAILED", "committed projection receipt requires explicit projection recover");
      }
    } catch (error) {
      return errorEnvelope("projection.run", "AC_PRECONDITION_FAILED", error instanceof Error ? error.message : String(error));
    }
  }
  let projection: ReturnType<typeof buildArchitectureDocsProjection>;
  try {
    projection = buildArchitectureDocsProjection(daemon, root, generatedAt, REPO_HARNESS_PROJECTION_PROFILE, undefined, request.acceptedChange);
    assertProjectionExpectedSnapshot(request, root, projection);
  } catch (error) {
    return errorEnvelope("projection.run", "AC_PRECONDITION_FAILED", error instanceof Error ? error.message : String(error));
  }

  const blocked = projectionProtocolHumanStatus(request, projection);
  if (blocked) return projectionProtocolEnvelope(request, projection, blocked, projection, priorCommittedApplies);

  if (request.mode === "adopt") {
    const expectedWorktreeDigest = computeWorktreeDigest(root);
    const adopted = await runArchitectureDocsAdoptionCommand({
      action: "adopt", profile: REPO_HARNESS_PROJECTION_PROFILE, approved: true,
      adoptionPlanId: request.adoptionPlanId!, expectedWorktreeDigest,
      taskSessionId: request.requestId
    }, root, daemon, projection, REPO_HARNESS_PROJECTION_PROFILE, generatedAt, request, priorCommittedApplies);
    if (!adopted.ok) return adopted;
    return adopted;
  }

  if (request.mode === "apply" && !projection.plan.drift.ok) {
    const changeSetId = `changeset.docs-projection-${projection.plan.projectionDigest.replace(/^sha256:/, "").slice(0, 16)}`;
    // The accepted plan is the authorization boundary, but it is not the state that remains on
    // disk after the acceptance has been incorporated into the projection baseline. Render that
    // no-accepted-change state against the accepted plan's virtual outputs before writing, so the
    // committed receipt names a real clean fixed point rather than a one-shot approval view.
    let fixedPointProjection: ReturnType<typeof buildArchitectureDocsProjection>;
    try {
      fixedPointProjection = request.acceptedChange
        ? buildArchitectureDocsProjection(daemon, root, generatedAt, REPO_HARNESS_PROJECTION_PROFILE, projection.files)
        : projection;
      if (request.acceptedChange && (
        fixedPointProjection.plan.rejected.length > 0
        || fixedPointProjection.plan.majorChange.mode !== "none"
        || fixedPointProjection.plan.refreshSignals.length > 0
      )) {
        return errorEnvelope("projection.run", "AC_PRECONDITION_FAILED", "accepted projection did not produce a no-accepted-change semantic fixed point");
      }
    } catch (error) {
      return errorEnvelope("projection.run", "AC_PRECONDITION_FAILED", error instanceof Error ? error.message : String(error));
    }
    return applyProjectionProtocolFixedPoint(request, projection, fixedPointProjection, changeSetId, root, daemon, priorCommittedApplies);
  }

  const status: ProjectionResultV2["status"] = projection.plan.drift.ok ? "noop" : "planned";
  return projectionProtocolEnvelope(request, projection, status, projection, priorCommittedApplies);
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
    return errorEnvelope("projection.readback", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }
  try {
    const result = await daemon.readbackProjectionApply(findRepositoryRoot(cwd), request);
    if (!result.ok) return result;
    const issues = (result.data as any)?.schemaVersion === "archcontext.projection-apply-absence/v1"
      ? projectionApplyAbsenceInvariantIssues(result.data as unknown as ProjectionApplyAbsenceV1, request)
      : projectionApplyReadbackResultInvariantIssues(result.data as unknown as ProjectionApplyReadbackResultV1, request);
    return issues.length === 0 ? result : errorEnvelope("projection.readback", "AC_SCHEMA_INVALID", issues.join("; "));
  } catch (error) {
    return errorEnvelope("projection.readback", "AC_PRECONDITION_FAILED", error instanceof Error ? error.message : String(error));
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
    return errorEnvelope("projection.recover", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
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
    return errorEnvelope("projection.recover", "AC_PRECONDITION_FAILED", error instanceof Error ? error.message : String(error));
  }
  if (!recovered.ok) return recovered;
  const consumption = recovered.data as {
    found?: boolean;
    receipt?: ProjectionApplyReceiptV1;
    proof?: ProjectionApplyRecoveryProofV1;
    refreshSignalsDelivered?: boolean;
  };
  if (consumption.found !== true || !consumption.receipt || !consumption.proof) {
    return errorEnvelope("projection.recover", "AC_PRECONDITION_FAILED", "committed projection apply receipt was unavailable for recovery delivery");
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
    generatedFrom: provenance.generatedFrom as ProjectionApplyRecoveryBindingV1["generatedFrom"],
    ownedOutputDigest: projectionOwnedOutputDigest(projection),
    receiptDigest: result.receiptDigest
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
    : errorEnvelope("projection.recover", "AC_SCHEMA_INVALID", `projection recovery result invariant failed: ${issues.join("; ")}`);
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
  const workspaceId = projectionWorkspaceId(root);
  const actual = {
    repositoryId: repositoryFingerprint(root),
    workspaceId,
    headSha: readHeadSha(root),
    worktreeDigest: architectureDocumentationProjectionWorktreeDigest(root, model)
  };
  for (const field of ["repositoryId", "workspaceId", "headSha", "worktreeDigest"] as const) {
    if (request.expected[field] !== actual[field]) throw new Error(`projection request expected snapshot mismatch: ${field}`);
  }
}


function projectionProtocolHumanStatus(
  request: ProjectionRequestV1,
  projection: ReturnType<typeof buildArchitectureDocsProjection>
): ProjectionResultV2["status"] | null {
  const humanSignal = projection.plan.refreshSignals.some((signal) => signal.mode === "human-action-required");
  const adoption = projection.plan.rejected.some((diff) => diff.reasonCode === "projection-adoption-required");
  const otherRejection = projection.plan.rejected.some((diff) => diff.reasonCode !== "projection-adoption-required");
  if (request.mode === "adopt") {
    if (!adoption) return projection.plan.drift.ok ? "noop" : otherRejection || humanSignal ? "human-action-required" : null;
    return otherRejection || humanSignal ? "human-action-required" : null;
  }
  if (adoption) return "adoption-required";
  return otherRejection || humanSignal ? "human-action-required" : null;
}

function projectionProtocolEnvelope(
  request: ProjectionRequestV1,
  input: ReturnType<typeof buildArchitectureDocsProjection>,
  status: ProjectionResultV2["status"],
  output: ReturnType<typeof buildArchitectureDocsProjection>,
  priorCommittedApplies: ProjectionPriorCommittedApplyV1[]
): JsonEnvelope {
  return projectionProtocolResultEnvelope(projectionProtocolResult(request, input, status, output, undefined, undefined, priorCommittedApplies));
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
  priorCommittedApplies: ProjectionPriorCommittedApplyV1[] = []
): ProjectionResultV2 {
  const inputSnapshot = projectionProtocolSnapshot(request, input.plan.provenance);
  const outputSnapshot = projectionProtocolSnapshot(request, output.plan.provenance);
  const files = overrides?.files ?? projectionProtocolFiles(input);
  const affectedNodeIds = projectionProtocolAffectedNodes(input);
  const requestPayloadDigest = digestJson(request as unknown as Json) as Sha256Digest;
  const humanActions: ProjectionResultV2["humanActions"] = [];
  if (status === "adoption-required") {
    humanActions.push({ reasonCode: "adoption-required", affectedNodeIds, requestPayloadDigest });
  } else if (status === "human-action-required") {
    humanActions.push({
      reasonCode: input.plan.refreshSignals.some((signal) => signal.mode === "human-action-required")
        ? "unresolved-major-change"
        : "manual-region-conflict",
      affectedNodeIds,
      requestPayloadDigest
    });
  }
  const refreshSignals = [...(overrides?.refreshSignals ?? output.plan.refreshSignals)]
    .sort((left, right) => left.signalId < right.signalId ? -1 : left.signalId > right.signalId ? 1 : 0);
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
    ...(priorCommittedApplies.length > 0 ? { priorCommittedApplies } : {})
  };
  const receiptDigest = projectionResultReceiptDigest(withoutReceipt);
  const result: ProjectionResultV2 = {
    ...withoutReceipt,
    refreshSignals: refreshSignals.map((signal) => ({ ...signal, projectionReceiptDigest: receiptDigest })),
    receiptDigest
  };
  const issues = projectionResultInvariantIssues(result);
  if (issues.length > 0) throw new Error(`projection result invariant failed: ${issues.join("; ")}`);
  return result;
}

function projectionProtocolResultEnvelope(result: ProjectionResultV2): JsonEnvelope {
  const issues = projectionResultInvariantIssues(result);
  return issues.length === 0
    ? okEnvelope("projection.run", result as unknown as Json)
    : errorEnvelope("projection.run", "AC_SCHEMA_INVALID", `projection result invariant failed: ${issues.join("; ")}`);
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

function projectionProtocolSnapshot(
  request: ProjectionRequestV1,
  provenance: ArchitectureDocumentationProjectionProvenanceV1
): ProjectionSnapshotV1 {
  return {
    ...request.expected,
    baseHeadSha: provenance.baseHeadSha,
    sourceTreeDigest: provenance.sourceTreeDigest as Sha256Digest,
    modelDigest: provenance.modelDigest as Sha256Digest,
    codeGraphDigest: provenance.codeGraphDigest as Sha256Digest,
    indexedWorktreeDigest: provenance.indexedWorktreeDigest as Sha256Digest | null,
    projectionInputDigest: provenance.projectionInputDigest as Sha256Digest,
    rendererVersion: provenance.rendererVersion,
    layoutVersion: provenance.layoutVersion,
    generatedFrom: provenance.generatedFrom as ProjectionSnapshotV1["generatedFrom"]
  };
}

function projectionProtocolFiles(
  projection: ReturnType<typeof buildArchitectureDocsProjection>
): ProjectionResultV2["files"] {
  return projection.plan.drift.diffs.flatMap<ProjectionResultV2["files"][number]>((diff) => {
    const expected = projectionDigestOrNull(diff.expectedDigest);
    const actual = projectionDigestOrNull(diff.actualDigest);
    if ((diff.reasonCode === "projection-file-missing" || diff.reasonCode === "projection-manifest-missing") && expected) {
      return [{ path: diff.path, action: "create", preimageDigest: null, outputDigest: expected }];
    }
    if (diff.reasonCode === "projection-orphaned" && actual) {
      return [{ path: diff.path, action: "delete", preimageDigest: actual, outputDigest: null }];
    }
    if (expected && actual && expected !== actual) {
      return [{ path: diff.path, action: "update", preimageDigest: actual, outputDigest: expected }];
    }
    return [];
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

/** Committed apply receipts bind the physical preimage and the exact fixed-point output bytes. */
function projectionProtocolFilesForExpectedOutput(
  root: string,
  projection: ReturnType<typeof buildArchitectureDocsProjection>
): ProjectionResultV2["files"] {
  return projection.files.flatMap<ProjectionResultV2["files"][number]>((file) => {
    const preimageDigest = currentProjectionFileDigest(root, file.path);
    const outputDigest = digestJson({ path: file.path, body: file.body } as unknown as Json) as Sha256Digest;
    if (preimageDigest === outputDigest) return [];
    return preimageDigest === "missing"
      ? [{ path: file.path, action: "create" as const, preimageDigest: null, outputDigest }]
      : [{ path: file.path, action: "update" as const, preimageDigest: preimageDigest as Sha256Digest, outputDigest }];
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function currentProjectionFileDigest(root: string, path: string): string {
  const absolute = resolve(root, path);
  return existsSync(absolute)
    ? digestJson({ path, body: readFileSync(absolute, "utf8") } as unknown as Json)
    : "missing";
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
  const subcommand = input.action ?? "plan";
  if (!["plan", "preview", "apply"].includes(subcommand)) {
    return errorEnvelope("agent-context", "AC_SCHEMA_INVALID", "agent-context requires plan|preview|apply");
  }
  const channel = `agent-context.${subcommand}`;
  const root = findRepositoryRoot(cwd);
  let projection: ReturnType<typeof buildAgentContextProjection>;
  try {
    projection = buildAgentContextProjection(root);
  } catch (error) {
    return errorEnvelope(channel, "AC_PRECONDITION_FAILED", error instanceof Error ? error.message : String(error));
  }
  const changeSetId = input.id
    ?? `changeset.agent-context-${projection.sourceDigest.replace(/^sha256:/, "").slice(0, 16)}`;
  const plan = await daemon.planUpdate(root, {
    id: changeSetId,
    reason: { taskSessionId: input.taskSessionId ?? "task_agent_context_projection" },
    operations: [{
      op: "render_agent_context" as const,
      expectedHash: "missing",
      projectionFiles: projection.plan.files.map((file) => ({
        path: file.path,
        expectedHash: currentBodyHash(root, file.path),
        body: file.body
      }))
    }]
  });
  if (!plan.ok) return plan;
  if (subcommand === "apply") {
    return daemon.applyUpdate(root, {
      id: changeSetId,
      approved: input.approved === true,
      expectedWorktreeDigest: input.expectedWorktreeDigest ?? computeWorktreeDigest(root)
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
}

function buildAgentContextProjection(root: string) {
  const model = loadNativeModelFromArchContext(root);
  // Model-only digest: an ADR edit changes the architecture documentation projection, but it does
  // not change what a capability's contract file says about that capability.
  const sourceDigest = digestJson({ model } as unknown as Json);
  return {
    model,
    sourceDigest,
    plan: renderAgentContextProjection({
      model,
      sourceDigest,
      existingFiles: loadAgentContextProjectionFiles(root, model)
    })
  };
}

function architectureDocsRenderProjectionOperation(root: string, files: { path: string; body: string }[]) {
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
  for (const key of ["id", "taskSessionId", "expectedWorktreeDigest", "generatedAt", "adoptionPlanId"]) {
    if (input[key] !== undefined && typeof input[key] !== "string") throw new Error(`projection ${key} must be a string`);
  }
  if (input.approved !== undefined && typeof input.approved !== "boolean") throw new Error("projection approved must be a boolean");
}

export function validateDocsProjectionInput(value: unknown): asserts value is RuntimeDocsProjectionInput {
  const input = projectionInputRecord(value, ["action", "profile", "generatedAt", "acceptedChange", "id", "taskSessionId", "approved", "expectedWorktreeDigest", "adoptionPlanId"]);
  validateHumanProjectionInput(input, ["plan", "preview", "apply", "adopt", "drift", "clean"]);
  if (input.profile !== undefined && input.profile !== "default" && input.profile !== REPO_HARNESS_PROJECTION_PROFILE) throw new Error("projection profile is invalid");
  if (input.acceptedChange !== undefined) validateProjectionAcceptedChange(input.acceptedChange);
}

export function validateAgentContextProjectionInput(value: unknown): asserts value is RuntimeAgentContextProjectionInput {
  const input = projectionInputRecord(value, ["action", "id", "taskSessionId", "approved", "expectedWorktreeDigest"]);
  validateHumanProjectionInput(input, ["plan", "preview", "apply"]);
}
