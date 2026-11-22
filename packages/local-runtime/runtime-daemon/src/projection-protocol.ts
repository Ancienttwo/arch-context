import type { JsonEnvelope, ProjectionRequestV1 } from "@archcontext/contracts";
import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import { REPO_HARNESS_PROJECTION_PROFILE } from "@archcontext/core/projection-engine";
import { findRepositoryRoot, listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { applyProjectionProtocolFixedPoint, runArchitectureDocsAdoptionCommand } from "./projection-adoption";
import { runProjectionCheckCommand } from "./projection-check";
import {
  architectureModelIgnoredEnvelope,
  assertProjectionExpectedSnapshot,
  buildArchitectureDocsProjection,
  docsProjectionChangeSetId,
  observedMajorChangeAcceptance,
  parseProjectionProtocolRequest,
  projectionFailureEnvelope,
  projectionPlannedStatus,
  projectionProtocolEnvelope,
  projectionProtocolHumanStatus,
  rerenderArchitectureDocsProjection,
  simulatedProjectionFile,
  type BuiltArchitectureDocsProjection,
  type ProjectionServiceHost
} from "./projection-service";
import { publicFailureEnvelope, publicOperationFailure } from "./public-operation-failure";
import type { RuntimeProjectionInvocation } from "./runtime-types";

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
    let observed: BuiltArchitectureDocsProjection | undefined;
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
    let projection: BuiltArchitectureDocsProjection;
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
      let fixedPointProjection: BuiltArchitectureDocsProjection;
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
