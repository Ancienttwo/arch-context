import type { ProjectionTargetFormat, ProjectionTargetOwnership, ProjectionTargetScopeKind, ProjectionTargetType } from "./ledger-records";
import type {
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  ArchitectureSemanticFacet,
  Sha256Digest
} from "./projection-constants";
import type {
  ArchitectureCapabilityProofStatusV1,
  ArchitectureDigestSetV2
} from "./projection-types";
import { digestJson, type Json } from "./schema";

/**
 * The committed projection manifest, `docs/architecture/.projection-manifest.json` (#264). The
 * projection engine writes it and reads its semantic baseline and per-target rows back; this module
 * is the only definition of its shape, of its byte layout and of every value derived from it.
 *
 * `schemaVersion` is `v4` (ADR-0056). The file records no digest of raw source: a target row holds
 * only what the render produced, so a source edit that changes no output, no proof evidence and no
 * header line leaves the file byte-identical. Header lines change only on a protocol upgrade, the
 * one Git-visible anchor is `semanticBaseline.modelDigest`, and every other line belongs to one
 * capability or one target. Two pull requests that touch different capabilities therefore rewrite
 * disjoint lines. The global digests a run still needs (flow proof, projection) are computed from
 * the rows when the manifest is read (`architectureDocsProjectionManifestDigests`).
 *
 * A `v1`, `v2` or `v3` manifest is read only for its `schemaVersion` and refused with
 * `projection-manifest-upgrade-required`; nothing else in it is read.
 */
export const ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION = "archcontext.architecture-docs-projection-manifest/v4" as const;
/** Manifest versions earlier releases wrote. Only their `schemaVersion` is read, to refuse them. */
export const SUPERSEDED_ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSIONS = [
  "archcontext.architecture-docs-projection-manifest/v1",
  "archcontext.architecture-docs-projection-manifest/v2",
  "archcontext.architecture-docs-projection-manifest/v3"
] as const;
/**
 * The one-time re-baseline an operator runs after the migration preconditions in the runbook are
 * met. The profile comes from the repository, not from a superseded manifest, so the command names
 * both supported profiles instead of guessing.
 */
export const ARCHITECTURE_DOCS_PROJECTION_MANIFEST_UPGRADE_COMMAND = "archctx docs apply --approved --profile <default|repo-harness/v1>" as const;
/** The operator runbook that pairs a re-baseline with its prerequisites (model restoration, upgrade path, receipt drain). */
export const ARCHITECTURE_DOCS_PROJECTION_MANIFEST_MIGRATION_GUIDE = "docs/runbooks/architecture-documentation-projections.md" as const;
/** The reason code of a refused superseded manifest; the operator re-baselines once with `archctx docs apply --approved`. */
export const PROJECTION_MANIFEST_UPGRADE_REQUIRED = "projection-manifest-upgrade-required" as const;
/** The reason code of a current-format manifest that fails its contract; restore it from Git. */
export const PROJECTION_MANIFEST_INVALID = "projection-manifest-invalid" as const;
/** The reason code of a declared source footprint that no entity-summary or topology target documents. */
export const PROJECTION_FOOTPRINT_UNCOVERED = "projection-footprint-uncovered" as const;
export const ARCHITECTURE_DOCS_PROJECTION_PROVENANCE_SCHEMA_VERSION = "archcontext.architecture-docs-projection-provenance/v3" as const;
export const ARCHITECTURE_DOCS_LAYOUT_VERSION_V1 = "archcontext.docs-layout/v1" as const;
export const ARCHITECTURE_SEMANTIC_STATE_SCHEMA_VERSION = "archcontext.architecture-semantic-state/v1" as const;
export const ARCHITECTURE_DOCS_PROJECTION_PROFILES = ["default", "repo-harness/v1"] as const;

export type ArchitectureDocsProjectionProfile = (typeof ARCHITECTURE_DOCS_PROJECTION_PROFILES)[number];

export interface ArchitectureCapabilitySemanticStateV1 {
  capabilityId: string;
  memberNodeIds: string[];
  semanticFingerprint: string;
  flowProofFingerprint: string;
  proofStatus: ArchitectureCapabilityProofStatusV1;
  facets: Record<ArchitectureSemanticFacet, string>;
}

export interface ArchitectureSemanticStateV1 {
  schemaVersion: typeof ARCHITECTURE_SEMANTIC_STATE_SCHEMA_VERSION;
  capabilities: ArchitectureCapabilitySemanticStateV1[];
  semanticFingerprint: string;
  flowProofFingerprint: string;
}

/**
 * The inputs besides the model that the flow proofs of one projection were compiled from, per
 * capability. Committed acceptance compares the manifest's value with a fresh measurement: a
 * capability whose proof moved while its semantic fingerprint held is explained by the journaled
 * model only when its selector-evidence digest and the renderer are unchanged (ADR-0056 §5).
 */
export interface ArchitectureProjectionProofEvidenceV2 {
  rendererVersion: string;
  /** Per capability: digest of the proof-relevant selector evidence its flows cite. */
  selectorEvidenceDigests: Record<string, string>;
}

/**
 * Projection provenance of one run. Runtime only: receipts, recovery bindings and envelopes carry
 * it, the committed manifest does not (#327). It records machine-independent values only: content
 * digests of the model and the declared sources, plus renderer, layout and CodeGraph versions.
 * HEAD, the full-worktree digest, the CodeGraph evidence digest, the indexed-worktree digest and
 * the CodeGraph status are runtime snapshot facts (#277).
 */
export interface ArchitectureDocumentationProjectionProvenanceV3 {
  schemaVersion: typeof ARCHITECTURE_DOCS_PROJECTION_PROVENANCE_SCHEMA_VERSION;
  sourceTreeDigest: string;
  modelDigest: string;
  projectionInputDigest: string;
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  layoutVersion: typeof ARCHITECTURE_DOCS_LAYOUT_VERSION_V1;
  /** Reproducible CodeGraph identity only: package name and version (#266, #277). */
  generatedFrom: ArchitectureDocsProjectionGeneratedFromV1;
}

export type ArchitectureDocsProjectionGeneratedFromV1 = {
  codeGraphPackage: string;
  codeGraphVersion: string;
};

/**
 * One target row of the committed manifest, keyed by `targetId`. The targetId and the renderer
 * version are not repeated in the row: the key and the manifest header carry them. A row records
 * no source state; its `outputDigest` is the target's freshness identity (ADR-0056 §1).
 */
export interface ArchitectureDocsProjectionManifestTargetV4 {
  type: ProjectionTargetType;
  scope: { kind: ProjectionTargetScopeKind; id?: string; entityKind?: string };
  path: string;
  ownership: ProjectionTargetOwnership;
  format: ProjectionTargetFormat;
  /** `digestJson({ targetId, body })` of the generated body: the region of a `mixed` target, the whole file of a `generated` one. */
  outputDigest: string;
}

/** One capability of the committed semantic baseline. */
export interface ArchitectureDocsProjectionManifestCapabilityV4 extends ArchitectureCapabilitySemanticStateV1 {
  /** Digest of the proof-relevant selector evidence for the selectors this capability's flows cite. */
  selectorEvidenceDigest: string;
}

export interface ArchitectureDocsProjectionManifestV4 {
  schemaVersion: typeof ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION;
  /**
   * The renderer that wrote this manifest. Any renderer is readable: a renderer bump re-renders
   * the owned outputs (drift reports them stale) and the per-capability proof check compares it.
   */
  rendererVersion: string;
  /** Optional repository-declared engine floors; preserved by every render. */
  minimumRendererVersion?: string;
  minimumProtocolVersion?: string;
  profile: ArchitectureDocsProjectionProfile;
  layoutVersion: typeof ARCHITECTURE_DOCS_LAYOUT_VERSION_V1;
  generatedFrom: ArchitectureDocsProjectionGeneratedFromV1;
  semanticBaseline: {
    /** The one Git-visible anchor: the digest of the model this baseline was compiled from. */
    modelDigest: string;
    /** Sorted and unique by capabilityId. */
    capabilities: ArchitectureDocsProjectionManifestCapabilityV4[];
  };
  targets: Record<string, ArchitectureDocsProjectionManifestTargetV4>;
}

/** The whole-model targets that render the runtime topology (ADR-0049); they document its nodes' footprints. */
export const RUNTIME_TOPOLOGY_TARGET_TYPES = ["diagram-runtime-topology", "runtime-topology-summary"] as const satisfies readonly ProjectionTargetType[];
export function isRuntimeTopologyTargetType(type: unknown): type is (typeof RUNTIME_TOPOLOGY_TARGET_TYPES)[number] {
  return typeof type === "string" && (RUNTIME_TOPOLOGY_TARGET_TYPES as readonly string[]).includes(type);
}

/** True for a manifest version an earlier release wrote; such a manifest is refused, never read. */
export function isSupersededArchitectureDocsProjectionManifestSchemaVersion(schemaVersion: string | undefined): boolean {
  return (SUPERSEDED_ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSIONS as readonly (string | undefined)[]).includes(schemaVersion);
}

/**
 * The committed byte layout. JSON, with one rule beyond `JSON.stringify`: every value that one
 * capability or one target owns sits on lines no other capability or target shares, and an
 * unchanged line separates the lines of any two owners. Git merges two branches that touch
 * different owners without a conflict, because a merge conflicts on adjacent changed lines too.
 */
export function serializeArchitectureDocsProjectionManifest(manifest: ArchitectureDocsProjectionManifestV4): string {
  const capabilities = [...manifest.semanticBaseline.capabilities]
    .sort((left, right) => compareStrings(left.capabilityId, right.capabilityId))
    .map(canonicalCapability);
  const capabilityBlock = JSON.stringify(capabilities, null, 2).split("\n").map((line, index) => index === 0 ? line : `    ${line}`).join("\n");
  const targetIds = Object.keys(manifest.targets).sort(compareStrings);
  const targetLines = targetIds.length === 0
    ? ["  \"targets\": {}"]
    : [
        "  \"targets\": {",
        ...targetIds.flatMap((targetId, index) => [
          `    ${JSON.stringify(targetId)}:`,
          `      ${JSON.stringify(canonicalTargetRow(manifest.targets[targetId]!))}${index === targetIds.length - 1 ? "" : ","}`
        ]),
        "  }"
      ];
  return [
    "{",
    `  "schemaVersion": ${JSON.stringify(manifest.schemaVersion)},`,
    `  "rendererVersion": ${JSON.stringify(manifest.rendererVersion)},`,
    ...(manifest.minimumRendererVersion === undefined ? [] : [`  "minimumRendererVersion": ${JSON.stringify(manifest.minimumRendererVersion)},`]),
    ...(manifest.minimumProtocolVersion === undefined ? [] : [`  "minimumProtocolVersion": ${JSON.stringify(manifest.minimumProtocolVersion)},`]),
    `  "profile": ${JSON.stringify(manifest.profile)},`,
    `  "layoutVersion": ${JSON.stringify(manifest.layoutVersion)},`,
    `  "generatedFrom": ${JSON.stringify({ codeGraphPackage: manifest.generatedFrom.codeGraphPackage, codeGraphVersion: manifest.generatedFrom.codeGraphVersion })},`,
    "  \"semanticBaseline\": {",
    `    "modelDigest": ${JSON.stringify(manifest.semanticBaseline.modelDigest)},`,
    `    "capabilities": ${capabilityBlock}`,
    "  },",
    ...targetLines,
    "}",
    ""
  ].join("\n");
}

/** The runtime semantic state the baseline records: capability entries without their evidence, plus the two aggregates. */
export function architectureDocsProjectionManifestSemanticState(manifest: ArchitectureDocsProjectionManifestV4): ArchitectureSemanticStateV1 {
  return architectureSemanticStateFromCapabilities(manifest.semanticBaseline.capabilities.map(({ selectorEvidenceDigest: _selectorEvidenceDigest, ...capability }) => capability));
}

/**
 * Assembles a semantic state from its capability entries. The two aggregates are a function of
 * the entries, so the committed manifest records only the entries and every reader recomputes them.
 */
export function architectureSemanticStateFromCapabilities(capabilities: readonly ArchitectureCapabilitySemanticStateV1[]): ArchitectureSemanticStateV1 {
  const sorted = [...capabilities].sort((left, right) => compareStrings(left.capabilityId, right.capabilityId));
  return {
    schemaVersion: ARCHITECTURE_SEMANTIC_STATE_SCHEMA_VERSION,
    capabilities: sorted,
    semanticFingerprint: digestJson(sorted.map(({ capabilityId, semanticFingerprint }) => ({ capabilityId, semanticFingerprint })) as unknown as Json),
    flowProofFingerprint: digestJson(sorted.map(({ capabilityId, flowProofFingerprint }) => ({ capabilityId, flowProofFingerprint })) as unknown as Json)
  };
}

/** The proof evidence the baseline was compiled from, as `ArchitectureProjectionProofEvidenceV2`. */
export function architectureDocsProjectionManifestProofEvidence(manifest: ArchitectureDocsProjectionManifestV4): ArchitectureProjectionProofEvidenceV2 {
  return {
    rendererVersion: manifest.rendererVersion,
    selectorEvidenceDigests: Object.fromEntries(manifest.semanticBaseline.capabilities.map((capability) => [capability.capabilityId, capability.selectorEvidenceDigest]))
  };
}

/**
 * The declared source tree digest of runtime provenance: the digest of every node's footprint
 * digest, by node id. It binds the CodeGraph index and the expected snapshot to the measured tree
 * and is never committed (ADR-0056 §4).
 */
export function architectureSourceTreeDigest(footprintDigests: Readonly<Record<string, string>>): Sha256Digest {
  return digestJson({
    schemaVersion: "archcontext.architecture-source-stamps/v1",
    stamps: Object.keys(footprintDigests).sort(compareStrings).map((nodeId) => ({ nodeId, digest: footprintDigests[nodeId]! }))
  } as unknown as Json) as Sha256Digest;
}

/** The projection digest: renderer, profile and every target's output digest. */
export function architectureProjectionOutputsDigest(input: {
  rendererVersion: string;
  profile: string;
  outputDigests: Readonly<Record<string, string>>;
}): Sha256Digest {
  return digestJson({
    schemaVersion: "archcontext.architecture-projection-outputs/v1",
    rendererVersion: input.rendererVersion,
    profile: input.profile,
    outputs: Object.keys(input.outputDigests).sort(compareStrings).map((targetId) => ({ targetId, outputDigest: input.outputDigests[targetId]! }))
  } as unknown as Json) as Sha256Digest;
}

/** The global digests of a committed manifest, computed from its rows at read time. */
export function architectureDocsProjectionManifestDigests(manifest: ArchitectureDocsProjectionManifestV4): ArchitectureDigestSetV2 {
  return {
    modelDigest: manifest.semanticBaseline.modelDigest as Sha256Digest,
    flowProofDigest: architectureDocsProjectionManifestSemanticState(manifest).flowProofFingerprint as Sha256Digest,
    projectionDigest: architectureProjectionOutputsDigest({
      rendererVersion: manifest.rendererVersion,
      profile: manifest.profile,
      outputDigests: Object.fromEntries(Object.entries(manifest.targets).map(([targetId, row]) => [targetId, row.outputDigest]))
    })
  };
}

function canonicalCapability(capability: ArchitectureDocsProjectionManifestCapabilityV4): ArchitectureDocsProjectionManifestCapabilityV4 {
  return {
    capabilityId: capability.capabilityId,
    memberNodeIds: [...capability.memberNodeIds],
    semanticFingerprint: capability.semanticFingerprint,
    flowProofFingerprint: capability.flowProofFingerprint,
    proofStatus: { p1: capability.proofStatus.p1, p2: capability.proofStatus.p2 },
    facets: Object.fromEntries(Object.keys(capability.facets).sort(compareStrings).map((facet) => [facet, capability.facets[facet as ArchitectureSemanticFacet]])) as Record<ArchitectureSemanticFacet, string>,
    selectorEvidenceDigest: capability.selectorEvidenceDigest
  };
}

function canonicalTargetRow(row: ArchitectureDocsProjectionManifestTargetV4): ArchitectureDocsProjectionManifestTargetV4 {
  return {
    type: row.type,
    scope: {
      kind: row.scope.kind,
      ...(row.scope.id !== undefined ? { id: row.scope.id } : {}),
      ...(row.scope.entityKind !== undefined ? { entityKind: row.scope.entityKind } : {})
    },
    path: row.path,
    ownership: row.ownership,
    format: row.format,
    outputDigest: row.outputDigest
  };
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
