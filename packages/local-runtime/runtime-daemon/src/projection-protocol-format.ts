import {
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH,
  PROJECTION_RESULT_SCHEMA_VERSION,
  architectureDocsProjectionManifestSchemaVersion,
  digestJson,
  isSupersededArchitectureDocsProjectionManifestSchemaVersion,
  okEnvelope,
  projectionResultInvariantIssues,
  projectionResultReceiptDigest,
  projectionResultRequestModeIssues,
  type ArchitectureRefreshSignalV2,
  type Json,
  type JsonEnvelope,
  type ProjectionCoverageV1,
  type ProjectionFreshnessV2,
  type ProjectionRequestV1,
  type ProjectionResultV3,
  type ProjectionSnapshotV1,
  type ProjectionTargetChangeV2,
  type Sha256Digest
} from "@archcontext/contracts";
import {
  architectureProjectionFilePreviews,
  architectureProjectionFootprintOwners,
  type ProjectionOwnedFile
} from "@archcontext/core/projection-engine";
import { projectionProtocolGeneratedFrom } from "./projection-inputs";
import { projectionArchitectureDebt } from "./projection-architecture-debt";
import { classifyProjectionTargetChanges } from "./projection-target-changes";
import {
  type BuiltArchitectureDocsProjection,
  projectionFilesBoundToRenderInput,
  projectionOrphanDeleteOperations,
  projectionReviewOrphans
} from "./projection-docs-helpers";
import { publicFailureEnvelope } from "./public-operation-failure";

export function projectionPlannedStatus(projection: BuiltArchitectureDocsProjection): ProjectionResultV3["status"] {
  if (projection.plan.isolation) return "planned-partial";
  return projection.plan.drift.ok ? "noop" : "planned";
}

export function rebaselineUnvouchedWholeFileOutputs(projection: BuiltArchitectureDocsProjection): string[] {
  const committedManifest = projection.loaded.existingFiles.find((file) => file.path === ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH);
  if (!committedManifest || !isSupersededArchitectureDocsProjectionManifestSchemaVersion(architectureDocsProjectionManifestSchemaVersion(committedManifest.body))) return [];
  const wholeFileTargetIds = new Set(projection.plan.targets.filter((target) => target.ownership === "generated").map((target) => target.targetId));
  return [...new Set(projection.plan.rejected
    .filter((diff) => diff.reasonCode === "projection-ambiguous-ownership" && diff.targetId !== undefined && wholeFileTargetIds.has(diff.targetId))
    .map((diff) => diff.path))]
    .sort();
}

export function projectionProtocolHumanStatus(
  request: ProjectionRequestV1,
  projection: BuiltArchitectureDocsProjection
): ProjectionResultV3["status"] | null {
  const humanSignal = projection.plan.refreshSignals.some((signal) => signal.mode === "human-action-required");
  const adoption = projection.plan.rejected.some((diff) => diff.reasonCode === "projection-adoption-required");
  const otherRejection = projection.plan.rejected.some((diff) => diff.reasonCode !== "projection-adoption-required");
  const orphanReview = projectionReviewOrphans(projection).length > 0;
  const human = otherRejection || humanSignal || orphanReview;
  if (request.mode === "adopt") {
    if (!adoption) return projection.plan.drift.ok ? "noop" : human ? "human-action-required" : null;
    return human ? "human-action-required" : null;
  }
  if (adoption) return "adoption-required";
  return human ? "human-action-required" : null;
}

export function projectionProtocolEnvelope(
  request: ProjectionRequestV1,
  input: BuiltArchitectureDocsProjection,
  status: ProjectionResultV3["status"],
  output: BuiltArchitectureDocsProjection,
  freshness?: ProjectionFreshnessV2,
  declinedUnprovableNodeIds?: string[]
): JsonEnvelope {
  return projectionProtocolResultEnvelope(projectionProtocolResult(request, input, status, output, undefined, undefined, freshness, declinedUnprovableNodeIds));
}

export function projectionProtocolResult(
  request: ProjectionRequestV1,
  input: BuiltArchitectureDocsProjection,
  status: ProjectionResultV3["status"],
  output: BuiltArchitectureDocsProjection = input,
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

function projectionTargetChanges(
  projection: BuiltArchitectureDocsProjection,
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

function projectionCoverage(projection: BuiltArchitectureDocsProjection): ProjectionCoverageV1 {
  const isolation = projection.plan.isolation;
  if (!isolation) throw new Error("projection-partial-result-without-isolation");
  return {
    complete: false,
    blockedCapabilityIds: [...isolation.blockedCapabilityIds],
    blockedTargets: isolation.blockedTargets.map((target) => ({ ...target, capabilityIds: [...target.capabilityIds], reasonCodes: [...target.reasonCodes] })),
    appliedTargetIds: [...isolation.appliedTargetIds]
  };
}

export function projectionProtocolResultEnvelope(result: ProjectionResultV3): JsonEnvelope {
  const issues = projectionResultInvariantIssues(result);
  return issues.length === 0
    ? okEnvelope("projection.run", result as unknown as Json)
    : publicFailureEnvelope("projection.run", "AC_SCHEMA_INVALID", "projection-result-invalid", {});
}

function projectionProtocolSnapshot(
  request: ProjectionRequestV1,
  projection: BuiltArchitectureDocsProjection
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

function projectionProtocolFiles(projection: BuiltArchitectureDocsProjection): ProjectionResultV3["files"] {
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

export function projectionWriteFileResults(
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

function withProjectionPlanPreviews(
  projection: BuiltArchitectureDocsProjection,
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

function projectionProtocolAffectedNodes(projection: BuiltArchitectureDocsProjection): string[] {
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
