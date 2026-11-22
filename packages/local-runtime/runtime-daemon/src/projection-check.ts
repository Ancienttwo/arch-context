import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH,
  SYNC_CHECK_SCHEMA_VERSION,
  okEnvelope,
  projectionFreshnessIssues,
  type Json,
  type JsonEnvelope,
  type ProjectionRequestV1,
  type Sha256Digest,
  type SyncCheckOutputV1
} from "@archcontext/contracts";
import { manifestDecisionDiagnostics } from "@archcontext/core/architecture-domain";
import {
  REPO_HARNESS_PROJECTION_PROFILE,
  architectureProjectionFreshnessWithoutBaseline,
  loadArchitectureProjectionInstructionsEnabled,
  readCommittedArchitectureDocsProjectionManifest
} from "@archcontext/core/projection-engine";
import { findRepositoryRoot } from "@archcontext/local-runtime/git-adapter";
import { listModelFiles, planGeneratedProjection, validateModelFiles } from "@archcontext/local-runtime/model-store-yaml";
import { projectionFreshnessContract } from "./projection-freshness";
import {
  ProjectionExpectedSnapshotMismatchError,
  assertProjectionExpectedSnapshot,
  buildArchitectureDocsProjection,
  committedArchitectureDocsProfile,
  parseProjectionProtocolRequest,
  projectionFailureEnvelope,
  projectionPlannedStatus,
  projectionProtocolEnvelope,
  projectionProtocolHumanStatus,
  type BuiltArchitectureDocsProjection,
  type ProjectionCheckReadInputs
} from "./projection-service";
import { publicFailureEnvelope, publicOperationErrorEnvelope, publicOperationFailure, publicOperationResult } from "./public-operation-failure";

/** Read-only in-process `archctx sync --check` (#640 / #642). */
export function runSyncCheckCommand(cwd: string, options: { noInstructions?: boolean } = {}): JsonEnvelope {
  try {
    let root: string;
    try {
      root = findRepositoryRoot(cwd);
    } catch {
      return publicFailureEnvelope("sync", "AC_REPO_NOT_FOUND", "git-worktree-required");
    }
    const validation = validateModelFiles(listModelFiles(root));
    if (!validation.valid) {
      if (validation.allowedTargetErrors?.length) {
        return publicFailureEnvelope("validate", "AC_SCHEMA_INVALID", "constraint-model-invalid", { issueCount: validation.allowedTargetErrors.length });
      }
      return okEnvelope("validate", validation as unknown as Json);
    }
    const pendingGeneratedPaths = planGeneratedProjection(root).map((operation) => operation.path).sort();
    const profile = committedArchitectureDocsProfile(root);
    const includeInstructions = options.noInstructions === true ? false : loadArchitectureProjectionInstructionsEnabled(root);
    let drift: BuiltArchitectureDocsProjection["plan"]["drift"] | undefined;
    let projectionPending = false;
    if (profile === REPO_HARNESS_PROJECTION_PROFILE || existsSync(resolve(root, ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH))) {
      let projection: BuiltArchitectureDocsProjection;
      try {
        projection = buildArchitectureDocsProjection(undefined, root, profile, undefined, undefined, {
          includeInstructions,
          indexSynced: true
        });
      } catch (error) {
        return projectionFailureEnvelope("sync", error);
      }
      drift = projection.plan.drift;
      projectionPending = !projection.plan.drift.ok || projection.plan.rejected.length > 0 || projection.plan.orphans.length > 0;
    }
    const fresh = pendingGeneratedPaths.length === 0 && !projectionPending;
    const payload: SyncCheckOutputV1 = {
      schemaVersion: SYNC_CHECK_SCHEMA_VERSION,
      check: true,
      fresh,
      profile,
      includeInstructions,
      modelDigest: validation.modelDigest as Sha256Digest,
      pendingGeneratedPaths,
      ...(drift ? { drift: drift as unknown as Record<string, Json> } : {})
    };
    return okEnvelope("sync", payload as unknown as Json);
  } catch (error) {
    return publicOperationErrorEnvelope("sync", error);
  }
}

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
  let projection: BuiltArchitectureDocsProjection;
  try {
    projection = buildArchitectureDocsProjection(undefined, root, REPO_HARNESS_PROJECTION_PROFILE, undefined, request.acceptedChange, {
      ...(request.acceptedChange === undefined ? { isolateBlockedCapabilities: true } : {}),
      historyTargetNamed: request.targets.includes("architecture-history")
    }, readInputs);
    assertProjectionExpectedSnapshot(request, root, projection);
  } catch (error) {
    if (error instanceof ProjectionExpectedSnapshotMismatchError) return publicFailureEnvelope("projection.run", "AC_PRECONDITION_FAILED", "projection-snapshot-mismatch", { field: error.field });
    return publicOperationErrorEnvelope("projection.run", error);
  }
  const freshness = projectionFreshnessContract(projection.plan.freshness);
  const status = projectionProtocolHumanStatus(request, projection) ?? projectionPlannedStatus(projection);
  const result = projectionProtocolEnvelope(request, projection, status, projection, freshness);
  return result.ok ? result : publicFailureEnvelope("projection.run", "AC_SCHEMA_INVALID", "projection-result-invalid");
}

export function runProjectionCheckInvocation(rawRequest: unknown, cwd: string): JsonEnvelope {
  try { return publicOperationResult("projection.run", runProjectionCheckInvocationUnchecked(rawRequest, cwd)) as JsonEnvelope; }
  catch (error) { throw publicOperationFailure(error); }
}

function runProjectionCheckInvocationUnchecked(rawRequest: unknown, cwd: string): JsonEnvelope {
  let request: ProjectionRequestV1;
  try {
    request = parseProjectionProtocolRequest(JSON.stringify(rawRequest));
  } catch {
    return publicFailureEnvelope("projection.run", "AC_SCHEMA_INVALID", "projection-check-input-invalid");
  }
  return runProjectionCheckCommand(request, findRepositoryRoot(cwd));
}

export function runProjectionFreshnessCommand(cwd: string): JsonEnvelope {
  try { return publicOperationResult("projection.freshness", runProjectionFreshnessCommandUnchecked(cwd)) as JsonEnvelope; }
  catch (error) { return publicOperationErrorEnvelope("projection.freshness", error); }
}

function runProjectionFreshnessCommandUnchecked(cwd: string): JsonEnvelope {
  let root: string;
  try {
    root = findRepositoryRoot(cwd);
  } catch {
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
