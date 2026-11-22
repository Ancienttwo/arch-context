import {
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH,
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION,
  architectureDocsProjectionManifestDigests,
  architectureDocsProjectionManifestIssues,
  digestJson,
  serializeArchitectureDocsProjectionManifest,
  type AcceptedArchitectureChangeReferenceV1,
  type ArchitectureDigestSetV2,
  type ArchitectureDocsProjectionManifestTargetV4,
  type ArchitectureDocsProjectionManifestV4,
  type ArchitectureDocumentationProjectionProvenanceV3,
  type ArchitectureProjectionProofEvidenceV2,
  type ArchitectureSemanticStateV1,
  type Json,
  type ProjectionTargetV1
} from "@archcontext/contracts";
import type { NativeModel } from "@archcontext/core/architecture-domain";
import type { ArchitectureDocumentationLayout } from "./layout";
import { produceArchitectureRefreshSignals, type ArchitectureMajorChangeClassificationV1 } from "./major-change";
import { capabilityProofRelevantSelectorEvidence, type ArchitectureSelectorEvidenceV1 } from "./semantic-diagrams";
import {
  type ARCHITECTURE_DOCS_RENDERER_VERSION,
  type ArchitectureDocumentationExistingFile,
  type ArchitectureDocumentationProjectionFile,
  type ArchitectureDocumentationProjectionPlan
} from "./docs-types";
import { architectureDocumentationProjectionDrift } from "./drift";
import { evaluateArchitectureProjectionFreshness } from "./freshness";
import {
  architectureProjectionPlanReceiptDigest,
  filesWithUniquePaths,
  isolateBlockedCapabilityTargets
} from "./isolation";

export function assembleArchitectureDocumentationProjectionPlan(input: {
  model: NativeModel;
  layout: ArchitectureDocumentationLayout;
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  sourceDigest: string;
  projectionDigest: string;
  provenance: ArchitectureDocumentationProjectionProvenanceV3;
  semanticState: ArchitectureSemanticStateV1;
  architectureDigests: ArchitectureDigestSetV2;
  majorChange: ArchitectureMajorChangeClassificationV1;
  previousManifest: ArchitectureDocsProjectionManifestV4 | undefined;
  rendered: ArchitectureDocumentationProjectionFile[];
  targets: ProjectionTargetV1[];
  expectedByPath: Map<string, ArchitectureDocumentationProjectionFile>;
  existingByPath: Map<string, string>;
  existingFiles: ArchitectureDocumentationExistingFile[];
  selectorEvidence: ArchitectureSelectorEvidenceV1[];
  footprintOwners: Map<string, string>;
  isolateBlockedCapabilities?: boolean;
  refreshContext?: {
    repositoryId: string;
    workspaceId: string;
    headSha: string;
    worktreeDigest: string;
    acceptedChange?: AcceptedArchitectureChangeReferenceV1;
    expected?: { repositoryId: string; workspaceId: string; headSha: string; worktreeDigest: string };
  };
}): ArchitectureDocumentationProjectionPlan {
  const {
    model,
    layout,
    rendererVersion,
    projectionDigest,
    provenance,
    footprintOwners,
    semanticState,
    architectureDigests,
    majorChange,
    previousManifest,
    rendered,
    targets,
    expectedByPath,
    existingByPath
  } = input;
  const baseDigests = previousManifest ? architectureDocsProjectionManifestDigests(previousManifest) : architectureDigests;
  const receiptDigest = architectureProjectionPlanReceiptDigest({ rendererVersion, profile: layout.profile, provenance, architectureDigests, majorChange });
  const refreshSignals = input.refreshContext
    ? produceArchitectureRefreshSignals({
      classification: majorChange,
      repositoryId: input.refreshContext.repositoryId,
      workspaceId: input.refreshContext.workspaceId,
      headSha: input.refreshContext.headSha,
      worktreeDigest: input.refreshContext.worktreeDigest,
      expected: input.refreshContext.expected,
      baseDigests,
      resultingDigests: architectureDigests,
      projectionReceiptDigest: receiptDigest
    })
    : [];
  const proofEvidence: ArchitectureProjectionProofEvidenceV2 = {
    rendererVersion,
    selectorEvidenceDigests: Object.fromEntries(semanticState.capabilities.map((capability) => [
      capability.capabilityId,
      digestJson(capabilityProofRelevantSelectorEvidence({ capabilityId: capability.capabilityId, flows: model.flows ?? [], evidence: input.selectorEvidence }) as unknown as Json)
    ]))
  };
  const manifestValue: ArchitectureDocsProjectionManifestV4 = {
    schemaVersion: ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION,
    rendererVersion,
    ...(previousManifest?.minimumRendererVersion === undefined ? {} : { minimumRendererVersion: previousManifest.minimumRendererVersion }),
    ...(previousManifest?.minimumProtocolVersion === undefined ? {} : { minimumProtocolVersion: previousManifest.minimumProtocolVersion }),
    profile: layout.profile,
    layoutVersion: provenance.layoutVersion,
    generatedFrom: provenance.generatedFrom,
    semanticBaseline: {
      modelDigest: provenance.modelDigest,
      capabilities: semanticState.capabilities.map((capability) => ({
        ...capability,
        selectorEvidenceDigest: proofEvidence.selectorEvidenceDigests[capability.capabilityId]!
      }))
    },
    // Per-target rows. Freshness compares each row's `outputDigest` with the next render's and
    // never reads Git history, so it holds after squash merges, rebases and in shallow clones.
    targets: Object.fromEntries(rendered.map((file) => [file.target.targetId, {
      type: file.target.type,
      scope: file.target.scope,
      path: file.target.path,
      ownership: file.target.ownership,
      format: file.target.format,
      outputDigest: file.target.outputDigest
    } satisfies ArchitectureDocsProjectionManifestTargetV4]))
  };
  // The writer holds itself to the published contract: a manifest it cannot vouch for is never written.
  const manifestIssues = architectureDocsProjectionManifestIssues(manifestValue);
  if (manifestIssues.length > 0) throw new Error(`architecture-docs-projection-manifest-invalid: ${manifestIssues.join("; ")}`);
  const manifest = {
    path: ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH,
    body: serializeArchitectureDocsProjectionManifest(manifestValue),
    digest: digestJson(manifestValue as unknown as Json)
  };
  const drift = architectureDocumentationProjectionDrift({
    targets,
    expectedFiles: rendered,
    expectedManifest: manifest,
    previousManifest,
    existingFiles: input.existingFiles ?? []
  });
  const rejected = drift.diffs.filter((diff) =>
    diff.reasonCode === "projection-ambiguous-ownership" || diff.reasonCode === "projection-adoption-required"
  );
  const adoptionCandidates = rendered.filter((file) => rejected.some((diff) =>
    diff.reasonCode === "projection-adoption-required" && diff.path === file.path && diff.targetId === file.target.targetId
  ));

  const plan: ArchitectureDocumentationProjectionPlan = {
    schemaVersion: "archcontext.architecture-docs-projection-plan/v1",
    rendererVersion,
    sourceDigest: input.sourceDigest,
    projectionDigest,
    profile: layout.profile,
    provenance,
    semanticState,
    architectureDigests,
    majorChange,
    refreshSignals,
    receiptDigest,
    proofEvidence,
    targets,
    files: filesWithUniquePaths(rendered.filter((file) => !rejected.some((diff) => diff.path === file.path && diff.targetId === file.target.targetId))),
    manifest,
    drift: {
      ...drift,
      diffs: drift.diffs.map((diff) => ({
        ...diff,
        expectedDigest: diff.expectedDigest ?? expectedByPath.get(diff.path)?.digest
      }))
    },
    rejected,
    adoptionCandidates,
    orphans: drift.orphans,
    ...(previousManifest ? { committedManifest: previousManifest } : {}),
    renderedTargets: manifestValue.targets,
    freshness: evaluateArchitectureProjectionFreshness({
      committedManifestBody: existingByPath.get(ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH),
      committedManifest: previousManifest,
      renderedTargets: manifestValue.targets,
      renderedManifestBody: manifest.body
    })
  };
  if (input.isolateBlockedCapabilities !== true) return plan;
  return isolateBlockedCapabilityTargets({
    plan,
    rendered,
    manifestValue,
    previousManifest,
    existingFiles: input.existingFiles ?? [],
    acceptedChange: input.refreshContext?.acceptedChange,
    footprintOwners
  }) ?? plan;
}
