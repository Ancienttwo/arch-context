import { okEnvelope, type AcceptedArchitectureChangeReferenceV1, type Json, type JsonEnvelope, type ProjectionRequestV1 } from "@archcontext/contracts";
import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import {
  REPO_HARNESS_PROJECTION_PROFILE,
  architectureAdoptionReceipt,
  buildArchitectureDocumentationAdoptionPlan,
  type ArchitectureProjectionProfile
} from "@archcontext/core/projection-engine";
import { ProjectionCodeFactsUnavailableError } from "@archcontext/local-runtime/codegraph-adapter";
import { findRepositoryRoot, listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import {
  architectureDocsRenderProjectionOperations,
  architectureModelIgnoredEnvelope,
  buildArchitectureDocsProjection,
  committedArchitectureDocsProfile,
  docsProjectionChangeSetId,
  projectionFailureEnvelope,
  projectionOrphanDeleteOperations,
  projectionProtocolResult,
  projectionProtocolResultEnvelope,
  projectionReviewOrphans,
  projectionWriteFileResults,
  rebaselineUnvouchedWholeFileOutputs,
  simulatedProjectionFile,
  withProjectionMetadata,
  type BuiltArchitectureDocsProjection,
  type ProjectionServiceHost
} from "./projection-service";
import { publicFailureEnvelope, publicOperationFailure } from "./public-operation-failure";
import type { RuntimeDocsProjectionInput } from "./runtime-types";

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
    let projection: BuiltArchitectureDocsProjection;
    let acceptedChange: AcceptedArchitectureChangeReferenceV1 | undefined;
    try {
      profile = input.profile ?? committedArchitectureDocsProfile(root);
      acceptedChange = input.acceptedChange;
      projection = buildArchitectureDocsProjection(daemon, root, profile, undefined, acceptedChange, {
        rebaselineSupersededManifest: subcommand === "apply",
        ...(input.indexSynced ? { indexSynced: true } : {}),
        ...(input.includeInstructions === undefined ? {} : { includeInstructions: input.includeInstructions })
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
      const unvouched = subcommand === "apply" ? rebaselineUnvouchedWholeFileOutputs(projection) : [];
      if (unvouched.length === 0) return publicFailureEnvelope("docs.plan", "AC_PRECONDITION_FAILED", "projection-ownership-repair-required", { issueCount: projection.plan.rejected.length });
      const commands = [`git rm -- ${unvouched.join(" ")}`, `archctx docs apply --approved --profile ${profile}`];
      const paths = unvouched.filter(path => Buffer.byteLength(path, "utf8") <= 256).slice(0, 8);
      const safeCommands = commands.filter(command => Buffer.byteLength(command, "utf8") <= 1024).slice(0, 2);
      return publicFailureEnvelope("docs.plan", "AC_PRECONDITION_FAILED", "projection-ambiguous-ownership", {
        pathCount: unvouched.length, paths, action: "remove-whole-file-outputs-and-reapply", commands: safeCommands,
        omittedPathCount: unvouched.length - paths.length, omittedCommandCount: commands.length - safeCommands.length
      });
    }
    const reviewOrphans = projectionReviewOrphans(projection);
    if (reviewOrphans.length > 0) {
      return publicFailureEnvelope("docs.plan", "AC_PRECONDITION_FAILED", "projection-orphan-review-required", { issueCount: reviewOrphans.length });
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

export async function runArchitectureDocsAdoptionCommand(
  input: RuntimeDocsProjectionInput,
  root: string,
  daemon: ProjectionServiceHost,
  projection: BuiltArchitectureDocsProjection,
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
    return publicFailureEnvelope("docs.adopt", "AC_PRECONDITION_FAILED", "projection-adoption-refused", { issueCount: adoption.issues.length });
  }
  const reviewOrphans = projectionReviewOrphans(projection);
  if (reviewOrphans.length > 0) {
    return publicFailureEnvelope("docs.adopt", "AC_PRECONDITION_FAILED", "projection-orphan-review-required", { issueCount: reviewOrphans.length });
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
  const orphanDeletes = projectionOrphanDeleteOperations(projection);
  for (const orphan of orphanDeletes) simulatedByPath.delete(orphan.operation.path);
  for (const file of [...projection.files, ...adoption.files]) simulatedByPath.set(file.path, simulatedProjectionFile(file));
  const canonicalFirst = buildArchitectureDocsProjection(daemon, root, profile, [...simulatedByPath.values()]);
  const canonicalExistingByPath = new Map(simulatedByPath);
  for (const file of canonicalFirst.files) canonicalExistingByPath.set(file.path, simulatedProjectionFile(file));
  const canonicalBaseline = buildArchitectureDocsProjection(daemon, root, profile, [...canonicalExistingByPath.values()]);
  for (const file of canonicalBaseline.files) canonicalExistingByPath.set(file.path, simulatedProjectionFile(file));
  const canonical = buildArchitectureDocsProjection(daemon, root, profile, [...canonicalExistingByPath.values()]);
  if (!canonical.plan.drift.ok || canonical.plan.rejected.length > 0 || canonical.plan.projectionDigest !== canonicalFirst.plan.projectionDigest) {
    return publicFailureEnvelope("docs.adopt", "AC_PRECONDITION_FAILED", "projection-adoption-fixed-point-unproven", { driftCount: canonical.plan.drift.diffs.length, rejectedCount: canonical.plan.rejected.length, digestStable: canonical.plan.projectionDigest === canonicalFirst.plan.projectionDigest });
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

export async function applyProjectionProtocolFixedPoint(
  request: ProjectionRequestV1,
  input: BuiltArchitectureDocsProjection,
  fixedPoint: BuiltArchitectureDocsProjection,
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
