import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH,
  digestJson,
  type AcceptedArchitectureChangeReferenceV1,
  type ArchitectureDocumentationProjectionProvenanceV3,
  type ArchitectureHistory,
  type ArchitectureRefreshSignalV2,
  type Json,
  type JsonEnvelope,
  type ProjectionRequestV1,
  type ProjectionResultV3,
  type Sha256Digest,
  type StateMachineV1
} from "@archcontext/contracts";
import {
  ARCHITECTURE_HISTORY_TARGET,
  REPO_HARNESS_PROJECTION_PROFILE,
  architectureHistoryCarryForwardBlocker,
  loadArchitectureDocumentationProfile,
  projectionOwnedWriteBody,
  type ArchitectureDocumentationProjectionRuntimeSnapshot,
  type ArchitectureMajorChangeClassificationV1,
  type ArchitectureProjectionProfile,
  type ProjectionOwnedFile,
  type loadArchitectureDocumentationInputs,
  type renderArchitectureDocumentationProjection
} from "@archcontext/core/projection-engine";
import { ignoredRepositoryPaths, type IgnoredRepositoryPath } from "@archcontext/local-runtime/git-adapter";
import { architectureModelIgnoreProbePaths, readArchitectureHistory } from "@archcontext/local-runtime/model-store-yaml";
import { publicFailureEnvelope, publicOperationErrorEnvelope } from "./public-operation-failure";
import type { prepareArchitectureDocumentationProjectionSnapshot } from "@archcontext/local-runtime/codegraph-adapter";

export interface BuiltArchitectureDocsProjection {
  inputs: {
    profile: ArchitectureProjectionProfile;
    includeInstructions: boolean;
    loaded: {
      model: Parameters<typeof renderArchitectureDocumentationProjection>[0]["model"];
      decisions: ReturnType<typeof loadArchitectureDocumentationInputs>["decisions"];
      existingFiles: ProjectionOwnedFile[];
      docsLanguage: Parameters<typeof renderArchitectureDocumentationProjection>[0]["docsLanguage"];
    };
    stateMachines: StateMachineV1[];
    sourceDigest: string;
    codeGraphInputs: ReturnType<typeof prepareArchitectureDocumentationProjectionSnapshot>;
    sourceScaleSignals: Parameters<typeof renderArchitectureDocumentationProjection>[0]["sourceScaleSignals"];
    architectureHistory?: ArchitectureHistory;
  };
  loaded: {
    model: Parameters<typeof renderArchitectureDocumentationProjection>[0]["model"];
    decisions: ReturnType<typeof loadArchitectureDocumentationInputs>["decisions"];
    existingFiles: ProjectionOwnedFile[];
    docsLanguage: Parameters<typeof renderArchitectureDocumentationProjection>[0]["docsLanguage"];
  };
  plan: ReturnType<typeof renderArchitectureDocumentationProjection>;
  importEvidence: {
    root: string;
    sourceFiles: string[];
    population: ReturnType<typeof prepareArchitectureDocumentationProjectionSnapshot>["importPopulation"];
  };
  runtimeSnapshot: ArchitectureDocumentationProjectionRuntimeSnapshot;
  manifest: ReturnType<typeof renderArchitectureDocumentationProjection>["manifest"];
  files: Array<{ path: string; body: string }>;
  snapshotEvidence: ReturnType<typeof renderArchitectureDocumentationProjection>["proofEvidence"];
}

export function ignoredArchitectureModelPaths(root: string): IgnoredRepositoryPath[] {
  const ignored = ignoredRepositoryPaths(root, architectureModelIgnoreProbePaths(root));
  const directories = ignored.filter((entry) => entry.path.endsWith("/")).map((entry) => entry.path);
  return ignored.filter((entry) => entry.path.endsWith("/") || !directories.some((directory) => entry.path.startsWith(directory)));
}

export function architectureModelIgnoredEnvelope(requestId: string, root: string): JsonEnvelope | undefined {
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

export function committedArchitectureDocsProfile(root: string): ArchitectureProjectionProfile {
  return existsSync(resolve(root, ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH)) ? loadArchitectureDocumentationProfile(root) : "default";
}

export function withProjectionMetadata(
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
  return { architectureHistory: readArchitectureHistory(root, { limit: Number.MAX_SAFE_INTEGER, readReason }) };
}

export function docsProjectionChangeSetId(projection: BuiltArchitectureDocsProjection): string {
  return `changeset.docs-projection-${projectionOwnedOutputDigest(projection).replace(/^sha256:/, "").slice(0, 16)}`;
}

export function projectionOwnedOutputDigest(projection: BuiltArchitectureDocsProjection): Sha256Digest {
  return digestJson({
    schemaVersion: "archcontext.projection-owned-output/v1",
    files: projection.files.map((file) => ({ path: file.path, body: file.body }))
      .sort((left, right) => left.path.localeCompare(right.path))
  } as unknown as Json) as Sha256Digest;
}

export function observedMajorChangeAcceptance(
  request: ProjectionRequestV1,
  observed: BuiltArchitectureDocsProjection
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

export function projectionFailureEnvelope(requestId: string, error: unknown): JsonEnvelope {
  return publicOperationErrorEnvelope(requestId, error);
}

export function projectionReviewOrphans(projection: BuiltArchitectureDocsProjection) {
  const seen = new Set<string>();
  return projection.plan.orphans.filter((orphan) => orphan.disposition === "human-review" && !seen.has(orphan.path) && seen.add(orphan.path) !== undefined);
}

export function projectionDeletableOrphans(projection: BuiltArchitectureDocsProjection) {
  return projection.plan.orphans.filter((orphan) => orphan.disposition === "delete");
}

export function projectionOrphanDeleteOperations(projection: BuiltArchitectureDocsProjection): Array<{
  operation: { path: string; expectedHash: string; delete: true };
  result: ProjectionResultV3["files"][number];
}> {
  const existingByPath = new Map(projection.loaded.existingFiles.map((file) => [file.path, file.onDisk]));
  return projectionDeletableOrphans(projection).map((orphan) => {
    const onDisk = existingByPath.get(orphan.path);
    if (onDisk === undefined) throw new Error(`projection orphan was classified without its on-disk bytes: ${orphan.path}`);
    return {
      operation: { path: orphan.path, expectedHash: digestJson({ body: onDisk } as unknown as Json), delete: true as const },
      result: { path: orphan.path, action: "delete" as const, preimageDigest: digestJson({ path: orphan.path, body: onDisk } as unknown as Json) as Sha256Digest, outputDigest: null }
    };
  });
}

export function architectureDocsRenderProjectionOperations(
  projection: BuiltArchitectureDocsProjection,
  files: { path: string; body: string }[],
  deletes: { path: string; expectedHash: string; delete: true }[] = [],
  carriedPaths: readonly string[] = []
) {
  const renderInput = projection.loaded.existingFiles;
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

export function projectionGuardsBoundToRenderInput(
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

export function simulatedProjectionFile<T extends { path: string; body: string }>(file: T): T & ProjectionOwnedFile {
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
    if (read.onDisk === undefined) throw new Error(`projection render input carries no on-disk bytes: ${file.path}`);
    return {
      path: file.path,
      expectedHash: digestJson({ body: read.onDisk } as unknown as Json),
      body: projectionOwnedWriteBody(file.body, read.onDisk)
    };
  });
}
