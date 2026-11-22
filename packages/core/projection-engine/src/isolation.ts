import {
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH,
  PROJECTION_TARGET_SCHEMA_VERSION,
  architectureDocsProjectionManifestDigests,
  architectureDocsProjectionManifestIssues,
  serializeArchitectureDocsProjectionManifest,
  digestJson,
  type AcceptedArchitectureChangeReferenceV1,
  type ArchitectureDocsProjectionManifestCapabilityV4,
  type ArchitectureDocsProjectionManifestTargetV4,
  type ArchitectureDocsProjectionManifestV4,
  type ArchitectureDocumentationProjectionProvenanceV3,
  type ArchitectureDigestSetV2,
  type Json,
  type ProjectionCoverageReasonCode,
  type ProjectionTargetV1
} from "@archcontext/contracts";
import type { ArchitectureProjectionProfile } from "./layout";
import type { ArchitectureMajorChangeClassificationV1 } from "./major-change";
import {
  type ARCHITECTURE_DOCS_RENDERER_VERSION,
  type ArchitectureDocumentationExistingFile,
  type ArchitectureDocumentationProjectionFile,
  type ArchitectureDocumentationProjectionPlan
} from "./docs-types";
import { projectionTarget, type ProjectionTargetDraft } from "./docs-renderer";
import { architectureDocumentationProjectionDrift } from "./drift";
import { compareStrings } from "./exports-dsl";
import { findGeneratedRegion, generatedOutputDigest, generatedStartMarker } from "./regions";

/** The agent-context targets of one contract file render one body, so the file is written once. */
export function filesWithUniquePaths(files: ArchitectureDocumentationProjectionFile[]): ArchitectureDocumentationProjectionFile[] {
  const seen = new Set<string>();
  return files.filter((file) => !seen.has(file.path) && seen.add(file.path) !== undefined);
}

/**
 * The receipt binds the classification without its per-capability breakdown: the breakdown
 * explains reasonCodes and affectedNodeIds, and an unresolved capability's proofStatusBefore moves
 * from null to its status once a first baseline exists, which would keep the classification from
 * ever reaching a fixed point. The receipt digest is runtime only; the manifest does not record it.
 */
export function architectureProjectionPlanReceiptDigest(input: {
  rendererVersion: string;
  profile: ArchitectureProjectionProfile;
  provenance: ArchitectureDocumentationProjectionProvenanceV3;
  architectureDigests: ArchitectureDigestSetV2;
  majorChange: ArchitectureMajorChangeClassificationV1;
}): string {
  const { capabilities: _capabilities, ...majorChangeReceipt } = input.majorChange;
  return digestJson({
    schemaVersion: "archcontext.architecture-docs-projection-receipt/v1",
    rendererVersion: input.rendererVersion,
    profile: input.profile,
    provenance: input.provenance,
    architectureDigests: input.architectureDigests,
    majorChange: majorChangeReceipt
  } as unknown as Json);
}

/**
 * Phase 1 capability isolation (#327). The blocked set is every capability the major change
 * names: each is unprovable, or its flow proof moved since the committed baseline without an
 * accepted change. Isolation applies only when every one of them kept its semantic fingerprint,
 * so they are blocked by their proof alone and every other capability classifies as `none`. A
 * target is blocked when its node, or a node whose footprint it documents
 * (`architectureProjectionFootprintOwners`), is a member of a blocked capability; a
 * target that depends on a blocked and on a clean capability is blocked.
 *
 * The blocked targets are carried forward: their documents are not written, and the manifest
 * keeps their committed rows and the blocked capabilities' committed baseline entries, so those
 * lines keep their bytes. Every other target is rendered as usual, as a drift repair without an
 * accepted change. Undefined, and so the complete plan with its human action, whenever anything
 * else stands in the way: an accepted change, no current-format baseline, a semantic change, an
 * adoption or ownership rejection, an orphan that needs review, a manifest header that differs
 * from this run (renderer, profile, layout, CodeGraph), a blocked target whose committed document
 * is not exactly the output its row records, or nothing else to write. Global failures (an
 * invalid or superseded manifest, an invalid model, missing code facts, a moved snapshot) throw
 * before this point or in the caller, and block the whole run as before.
 */
export function isolateBlockedCapabilityTargets(input: {
  plan: ArchitectureDocumentationProjectionPlan;
  rendered: ArchitectureDocumentationProjectionFile[];
  manifestValue: ArchitectureDocsProjectionManifestV4;
  previousManifest: ArchitectureDocsProjectionManifestV4 | undefined;
  existingFiles: ArchitectureDocumentationExistingFile[];
  acceptedChange: AcceptedArchitectureChangeReferenceV1 | undefined;
  footprintOwners: ReadonlyMap<string, string>;
}): ArchitectureDocumentationProjectionPlan | undefined {
  const { plan, previousManifest, manifestValue } = input;
  if (input.acceptedChange !== undefined || previousManifest === undefined || plan.majorChange.mode !== "human-action-required") return undefined;
  if (plan.rejected.length > 0 || plan.orphans.some((orphan) => orphan.disposition === "human-review")) return undefined;
  if (previousManifest.rendererVersion !== manifestValue.rendererVersion
    || previousManifest.profile !== manifestValue.profile
    || previousManifest.layoutVersion !== manifestValue.layoutVersion
    || previousManifest.generatedFrom.codeGraphPackage !== manifestValue.generatedFrom.codeGraphPackage
    || previousManifest.generatedFrom.codeGraphVersion !== manifestValue.generatedFrom.codeGraphVersion) return undefined;

  const baseById = new Map(previousManifest.semanticBaseline.capabilities.map((capability) => [capability.capabilityId, capability]));
  const currentById = new Map(plan.semanticState.capabilities.map((capability) => [capability.capabilityId, capability]));
  const blockedCapabilityIds = plan.majorChange.capabilities.map((change) => change.capabilityId).sort(compareStrings);
  if (blockedCapabilityIds.length === 0) return undefined;
  const reasonsByCapability = new Map<string, ProjectionCoverageReasonCode[]>();
  for (const capabilityId of blockedCapabilityIds) {
    const before = baseById.get(capabilityId);
    const after = currentById.get(capabilityId);
    if (before === undefined || after === undefined || before.semanticFingerprint !== after.semanticFingerprint) return undefined;
    const reasons: ProjectionCoverageReasonCode[] = [];
    if (after.proofStatus.p1 === "unprovable" || after.proofStatus.p2 === "unprovable") reasons.push("unprovable-required-flow");
    if (before.flowProofFingerprint !== after.flowProofFingerprint) reasons.push("verified-flow-proof-changed");
    if (reasons.length === 0) return undefined;
    reasonsByCapability.set(capabilityId, reasons);
  }

  const existingByPath = new Map(input.existingFiles.map((file) => [file.path, file.body]));
  const blockedMembers = blockedCapabilityIds.map((capabilityId) => [capabilityId, new Set(currentById.get(capabilityId)!.memberNodeIds)] as const);
  const carried = new Map<string, { file: ArchitectureDocumentationProjectionFile; capabilityIds: string[] }>();
  for (const file of input.rendered) {
    if (file.target.type !== "entity-summary" || typeof file.target.scope.id !== "string") continue;
    const row = previousManifest.targets[file.target.targetId];
    const scopeId = file.target.scope.id;
    const nodeIds = [scopeId, ...[...input.footprintOwners].filter(([, owner]) => owner === scopeId).map(([nodeId]) => nodeId)];
    const capabilityIds = blockedMembers.filter(([, members]) => nodeIds.some((nodeId) => members.has(nodeId))).map(([capabilityId]) => capabilityId);
    if (capabilityIds.length === 0) continue;
    const existing = existingByPath.get(file.path);
    if (row === undefined || existing === undefined || !committedRowDescribesTarget(row, file.target)
      || !committedOutputIsIntact(file.target, existing, row.outputDigest, manifestValue.rendererVersion)) return undefined;
    const target = projectionTarget({
      targetId: file.target.targetId,
      type: file.target.type,
      scope: file.target.scope,
      path: file.target.path,
      ownership: file.target.ownership,
      format: file.target.format,
      rendererVersion: plan.rendererVersion,
      sourceDigest: file.target.sourceDigest,
      outputDigest: row.outputDigest
    });
    carried.set(file.target.targetId, {
      file: {
        path: file.path,
        body: existing,
        target,
        digest: digestJson({ path: file.path, body: existing } as unknown as Json),
        generatedBodyDigest: row.outputDigest
      },
      capabilityIds
    });
  }
  // A blocked capability that blocks no target has nothing to carry forward; its state could not
  // be told apart from an applied one, so the run stays blocked as a whole.
  const blockingCapabilityIds = new Set([...carried.values()].flatMap((entry) => entry.capabilityIds));
  if (blockedCapabilityIds.some((capabilityId) => !blockingCapabilityIds.has(capabilityId))) return undefined;

  const blockedCapabilities = new Set(blockedCapabilityIds);
  const isolatedManifestValue: ArchitectureDocsProjectionManifestV4 = {
    ...manifestValue,
    semanticBaseline: {
      modelDigest: manifestValue.semanticBaseline.modelDigest,
      capabilities: manifestValue.semanticBaseline.capabilities.map((capability): ArchitectureDocsProjectionManifestCapabilityV4 =>
        blockedCapabilities.has(capability.capabilityId) ? baseById.get(capability.capabilityId)! : capability)
    },
    targets: Object.fromEntries(Object.entries(manifestValue.targets).map(([targetId, row]) =>
      [targetId, carried.has(targetId) ? previousManifest.targets[targetId]! : row]))
  };
  if (architectureDocsProjectionManifestIssues(isolatedManifestValue).length > 0) return undefined;
  const manifest = {
    path: ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH,
    body: serializeArchitectureDocsProjectionManifest(isolatedManifestValue),
    digest: digestJson(isolatedManifestValue as unknown as Json)
  };
  const expectedFiles = input.rendered.map((file) => carried.get(file.target.targetId)?.file ?? file);
  const targets = expectedFiles.map((file) => file.target);
  const drift = architectureDocumentationProjectionDrift({
    targets,
    expectedFiles,
    expectedManifest: manifest,
    previousManifest,
    existingFiles: input.existingFiles
  });
  // Nothing outside the blocked capabilities to write: the run is the blocked capabilities alone.
  if (drift.ok) return undefined;
  if (drift.diffs.some((diff) => diff.reasonCode === "projection-ambiguous-ownership" || diff.reasonCode === "projection-adoption-required")) return undefined;
  const expectedByPath = new Map(expectedFiles.map((file) => [file.path, file]));
  const architectureDigests = architectureDocsProjectionManifestDigests(isolatedManifestValue);
  return {
    ...plan,
    projectionDigest: architectureDigests.projectionDigest,
    architectureDigests,
    // The blocked capabilities are named by the isolation; no refresh is signalled for a partial run.
    refreshSignals: [],
    receiptDigest: architectureProjectionPlanReceiptDigest({
      rendererVersion: plan.rendererVersion,
      profile: plan.profile,
      provenance: plan.provenance,
      architectureDigests,
      majorChange: plan.majorChange
    }),
    targets,
    files: filesWithUniquePaths(input.rendered.filter((file) => !carried.has(file.target.targetId))),
    manifest,
    drift: {
      ok: drift.ok,
      reasonCodes: drift.reasonCodes,
      diffs: drift.diffs.map((diff) => ({ ...diff, expectedDigest: diff.expectedDigest ?? expectedByPath.get(diff.path)?.digest }))
    },
    rejected: [],
    adoptionCandidates: [],
    orphans: drift.orphans,
    isolation: {
      blockedCapabilityIds,
      blockedTargets: [...carried.values()]
        .map(({ file, capabilityIds }) => ({
          targetId: file.target.targetId,
          path: file.path,
          capabilityIds,
          reasonCodes: [...new Set(capabilityIds.flatMap((capabilityId) => reasonsByCapability.get(capabilityId)!))].sort(compareStrings) as ProjectionCoverageReasonCode[]
        }))
        .sort((left, right) => compareStrings(left.targetId, right.targetId)),
      appliedTargetIds: targets.map((target) => target.targetId).filter((targetId) => !carried.has(targetId)).sort(compareStrings)
    }
  };
}

/**
 * The `architecture-history` target of a render given no history (ADR-0056 §8): its intact
 * committed row and bytes (`architectureHistoryCarryForwardBlocker`), not rendered again.
 */
export function carriedArchitectureHistoryFile(
  draft: ProjectionTargetDraft,
  row: ArchitectureDocsProjectionManifestTargetV4,
  body: string,
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION,
  sourceDigest: string
): ArchitectureDocumentationProjectionFile {
  return {
    path: draft.path,
    body,
    target: projectionTarget({ ...draft, rendererVersion, sourceDigest, outputDigest: row.outputDigest }),
    digest: digestJson({ path: draft.path, body } as unknown as Json),
    generatedBodyDigest: row.outputDigest
  };
}

/** The committed row was written for this target: same path, type, ownership, format and scope. */
function committedRowDescribesTarget(row: ArchitectureDocsProjectionManifestTargetV4, target: ProjectionTargetV1): boolean {
  return row.path === target.path
    && row.type === target.type
    && row.ownership === target.ownership
    && row.format === target.format
    && row.scope.kind === target.scope.kind
    && row.scope.id === target.scope.id
    && row.scope.entityKind === target.scope.entityKind;
}

/**
 * The committed bytes at the target's path are exactly the output its row records: a whole file
 * whose digest is the row's `outputDigest`, or an intact region whose marker this renderer wrote
 * for that digest. Only such a document can be carried forward unchanged.
 */
function committedOutputIsIntact(target: ProjectionTargetV1, existing: string, outputDigest: string, rendererVersion: string): boolean {
  if (target.ownership === "generated") return generatedOutputDigest(target.targetId, existing) === outputDigest;
  const region = findGeneratedRegion(existing, target.targetId);
  return region !== undefined
    && region.startMarker === generatedStartMarker(target.targetId, rendererVersion, outputDigest)
    && digestJson({ targetId: target.targetId, body: `${region.body.trimEnd()}\n` } as unknown as Json) === outputDigest;
}
