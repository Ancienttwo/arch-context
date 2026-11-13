import type { ProjectionTargetFormat, ProjectionTargetOwnership, ProjectionTargetScopeKind, ProjectionTargetType } from "./ledger";
import {
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  PROJECTION_REQUEST_SCHEMA_VERSION,
  ARCHITECTURE_SEMANTIC_FACETS,
  isArchitectureCapabilityProofStatus,
  type ArchitectureCapabilityProofStatusV1,
  type ArchitectureDigestSetV2,
  type ArchitectureSemanticFacet,
  type Sha256Digest
} from "./projection";
import { digestJson, isRepoRelativePosixPath, type Json } from "./schema";

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

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const TARGET_TYPES: Record<ProjectionTargetType, true> = {
  "architecture-index": true,
  "entity-summary": true,
  "relation-summary": true,
  "decision-index": true,
  "diagram-mermaid": true,
  "diagram-structurizr": true,
  "diagram-likec4": true,
  "diagram-runtime-topology": true,
  "runtime-topology-summary": true,
  "architecture-history": true,
  "agent-context": true
};
/** The whole-model targets that render the runtime topology (ADR-0049); they document its nodes' footprints. */
export const RUNTIME_TOPOLOGY_TARGET_TYPES = ["diagram-runtime-topology", "runtime-topology-summary"] as const satisfies readonly ProjectionTargetType[];
export function isRuntimeTopologyTargetType(type: unknown): type is (typeof RUNTIME_TOPOLOGY_TARGET_TYPES)[number] {
  return typeof type === "string" && (RUNTIME_TOPOLOGY_TARGET_TYPES as readonly string[]).includes(type);
}
const SCOPE_KINDS: Record<ProjectionTargetScopeKind, true> = { repository: true, entity: true, relation: true, decision: true, diagram: true };
const OWNERSHIPS: Record<ProjectionTargetOwnership, true> = { generated: true, mixed: true };
const FORMATS: Record<ProjectionTargetFormat, true> = { markdown: true, mermaid: true, "structurizr-json": true, likec4: true };

/** Every reason the value is not a current-format projection manifest; empty when it is one. */
export function architectureDocsProjectionManifestIssues(value: unknown): string[] {
  const issues: string[] = [];
  const manifest = record(value);
  if (!manifest) return ["manifest must be an object"];
  issues.push(...exactKeys(manifest, ["schemaVersion", "rendererVersion", "profile", "layoutVersion", "generatedFrom", "semanticBaseline", "targets"], ["minimumRendererVersion", "minimumProtocolVersion"], "manifest"));
  if (manifest.schemaVersion !== ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION) issues.push("manifest.schemaVersion is unsupported");
  if (!isNonEmptyString(manifest.rendererVersion)) issues.push("manifest.rendererVersion must be a non-empty string");
  for (const [key, family] of [["minimumRendererVersion", "archcontext.docs-renderer/v"], ["minimumProtocolVersion", "archcontext.projection-request/v"]] as const) {
    if (Object.hasOwn(manifest, key) && versionNumber(manifest[key], family) === undefined) issues.push(`manifest.${key} must name a supported version family`);
  }
  if (!(ARCHITECTURE_DOCS_PROJECTION_PROFILES as readonly unknown[]).includes(manifest.profile)) issues.push("manifest.profile is unsupported");
  if (manifest.layoutVersion !== ARCHITECTURE_DOCS_LAYOUT_VERSION_V1) issues.push("manifest.layoutVersion is unsupported");
  issues.push(...generatedFromIssues(manifest.generatedFrom, "manifest.generatedFrom"));
  const baseline = record(manifest.semanticBaseline);
  if (!baseline) issues.push("manifest.semanticBaseline must be an object");
  else {
    issues.push(...exactKeys(baseline, ["modelDigest", "capabilities"], [], "manifest.semanticBaseline"));
    if (!isDigest(baseline.modelDigest)) issues.push("manifest.semanticBaseline.modelDigest must be a SHA-256 digest");
    issues.push(...capabilityEntriesIssues(baseline.capabilities, "manifest.semanticBaseline.capabilities", true));
  }
  const targets = record(manifest.targets);
  if (!targets) {
    issues.push("manifest.targets must be an object keyed by targetId");
    return issues;
  }
  // Every path appears in one row, except that agent-context rows share a contract file when their
  // nodes differ: each row owns only its node's region (ADR-0056 §9).
  const rowsByPath = new Map<string, { agentContext: boolean; scopeId: unknown }[]>();
  for (const [targetId, row] of Object.entries(targets)) {
    const prefix = `manifest.targets[${JSON.stringify(targetId)}]`;
    if (!isNonEmptyString(targetId)) issues.push("manifest.targets keys must be non-empty targetIds");
    issues.push(...manifestTargetIssues(row, prefix));
    const target = record(row);
    const path = target?.path;
    if (typeof path === "string") {
      const current = { agentContext: target!.type === "agent-context", scopeId: record(target!.scope)?.id };
      const others = rowsByPath.get(path) ?? [];
      if (others.some((other) => !current.agentContext || !other.agentContext || other.scopeId === current.scopeId)) {
        issues.push(`${prefix}.path is recorded by another target`);
      }
      rowsByPath.set(path, [...others, current]);
    }
  }
  return issues;
}

/**
 * Reads only the `schemaVersion` of a manifest body: the one field this release reads from a
 * manifest it does not write. Undefined when the body is not a JSON object or carries no string
 * `schemaVersion`.
 */
export function architectureDocsProjectionManifestSchemaVersion(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  const schemaVersion = record(parsed)?.schemaVersion;
  return typeof schemaVersion === "string" ? schemaVersion : undefined;
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
 *
 * - Header lines (`schemaVersion`, `rendererVersion`, `profile`, `layoutVersion`, `generatedFrom`)
 *   change only on a protocol upgrade.
 * - `semanticBaseline.modelDigest` is the one shared line a model change rewrites; two concurrent
 *   model changes conflict there, as they should.
 * - Each capability entry is indented JSON and starts with its own `capabilityId` line.
 * - Each target row is one line, after a line holding its `targetId` key, in canonical key order.
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

export function architectureDocsProjectionProvenanceIssues(value: unknown, prefix = "provenance"): string[] {
  const provenance = record(value);
  if (!provenance) return [`${prefix} must be an object`];
  const issues = exactKeys(provenance, ["schemaVersion", "sourceTreeDigest", "modelDigest", "projectionInputDigest", "rendererVersion", "layoutVersion", "generatedFrom"], [], prefix);
  if (provenance.schemaVersion !== ARCHITECTURE_DOCS_PROJECTION_PROVENANCE_SCHEMA_VERSION) issues.push(`${prefix}.schemaVersion is unsupported`);
  for (const field of ["sourceTreeDigest", "modelDigest", "projectionInputDigest"] as const) {
    if (!isDigest(provenance[field])) issues.push(`${prefix}.${field} must be a SHA-256 digest`);
  }
  if (provenance.rendererVersion !== ARCHITECTURE_DOCS_RENDERER_VERSION) issues.push(`${prefix}.rendererVersion must be ${ARCHITECTURE_DOCS_RENDERER_VERSION}`);
  if (provenance.layoutVersion !== ARCHITECTURE_DOCS_LAYOUT_VERSION_V1) issues.push(`${prefix}.layoutVersion is unsupported`);
  issues.push(...generatedFromIssues(provenance.generatedFrom, `${prefix}.generatedFrom`));
  return issues;
}

function capabilityEntriesIssues(value: unknown, prefix: string, withSelectorEvidence: boolean): string[] {
  if (!Array.isArray(value)) return [`${prefix} must be an array`];
  const issues: string[] = [];
  const ids = value.map((entry) => record(entry)?.capabilityId);
  if (!isSortedUniqueStrings(ids)) issues.push(`${prefix} must be sorted and unique by capabilityId`);
  value.forEach((entry, index) => {
    const entryPrefix = `${prefix}[${index}]`;
    const capability = record(entry);
    if (!capability) {
      issues.push(`${entryPrefix} must be an object`);
      return;
    }
    const required = ["capabilityId", "memberNodeIds", "semanticFingerprint", "flowProofFingerprint", "proofStatus", "facets", ...(withSelectorEvidence ? ["selectorEvidenceDigest"] : [])];
    issues.push(...exactKeys(capability, required, [], entryPrefix));
    if (!isNonEmptyString(capability.capabilityId)) issues.push(`${entryPrefix}.capabilityId must be a non-empty string`);
    if (!Array.isArray(capability.memberNodeIds) || !isSortedUniqueStrings(capability.memberNodeIds)) issues.push(`${entryPrefix}.memberNodeIds must be sorted and unique`);
    if (!isDigest(capability.semanticFingerprint)) issues.push(`${entryPrefix}.semanticFingerprint must be a SHA-256 digest`);
    if (!isDigest(capability.flowProofFingerprint)) issues.push(`${entryPrefix}.flowProofFingerprint must be a SHA-256 digest`);
    if (withSelectorEvidence && !isDigest(capability.selectorEvidenceDigest)) issues.push(`${entryPrefix}.selectorEvidenceDigest must be a SHA-256 digest`);
    if (!isArchitectureCapabilityProofStatus(capability.proofStatus)) issues.push(`${entryPrefix}.proofStatus must be a P1/P2 proof status`);
    const facets = record(capability.facets);
    if (!facets) issues.push(`${entryPrefix}.facets must be an object`);
    else {
      issues.push(...exactKeys(facets, [...ARCHITECTURE_SEMANTIC_FACETS], [], `${entryPrefix}.facets`));
      for (const facet of ARCHITECTURE_SEMANTIC_FACETS) {
        if (!isDigest(facets[facet])) issues.push(`${entryPrefix}.facets.${facet} must be a SHA-256 digest`);
      }
    }
  });
  return issues;
}

function generatedFromIssues(value: unknown, prefix: string): string[] {
  const generatedFrom = record(value);
  if (!generatedFrom) return [`${prefix} must be an object`];
  const issues = exactKeys(generatedFrom, ["codeGraphPackage", "codeGraphVersion"], [], prefix);
  for (const field of ["codeGraphPackage", "codeGraphVersion"] as const) {
    if (!isNonEmptyString(generatedFrom[field])) issues.push(`${prefix}.${field} must be a non-empty string`);
  }
  return issues;
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

function manifestTargetIssues(value: unknown, prefix: string): string[] {
  const target = record(value);
  if (!target) return [`${prefix} must be an object`];
  const issues = exactKeys(target, ["type", "scope", "path", "ownership", "format", "outputDigest"], [], prefix);
  if (typeof target.type !== "string" || !Object.hasOwn(TARGET_TYPES, target.type)) issues.push(`${prefix}.type is unsupported`);
  const scope = record(target.scope);
  if (!scope || typeof scope.kind !== "string" || !Object.hasOwn(SCOPE_KINDS, scope.kind)) issues.push(`${prefix}.scope.kind is unsupported`);
  else {
    issues.push(...exactKeys(scope, ["kind"], ["id", "entityKind"], `${prefix}.scope`));
    for (const field of ["id", "entityKind"] as const) {
      if (scope[field] !== undefined && typeof scope[field] !== "string") issues.push(`${prefix}.scope.${field} must be a string`);
    }
  }
  if (typeof target.path !== "string" || !isRepoRelativePosixPath(target.path)) issues.push(`${prefix}.path must be a repository-relative POSIX path`);
  if (typeof target.ownership !== "string" || !Object.hasOwn(OWNERSHIPS, target.ownership)) issues.push(`${prefix}.ownership is unsupported`);
  if (typeof target.format !== "string" || !Object.hasOwn(FORMATS, target.format)) issues.push(`${prefix}.format is unsupported`);
  if (!isDigest(target.outputDigest)) issues.push(`${prefix}.outputDigest must be a SHA-256 digest`);
  if (target.type === "agent-context"
    && (target.ownership !== "mixed" || target.format !== "markdown" || scope?.kind !== "entity" || !isNonEmptyString(scope.id))) {
    issues.push(`${prefix} agent-context rows must be mixed, markdown and entity-scoped with an id`);
  }
  return issues;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], prefix: string): string[] {
  const issues = required.filter((key) => !(key in value)).map((key) => `${prefix}.${key} is required`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) issues.push(`${prefix}.${key} is not allowed`);
  return issues;
}

function isDigest(value: unknown): value is Sha256Digest {
  return typeof value === "string" && SHA256.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isSortedUniqueStrings(values: readonly unknown[]): boolean {
  return values.every((value, index) => typeof value === "string" && (index === 0 || (values[index - 1] as string) < value));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function versionNumber(value: unknown, family: string): number | undefined {
  if (typeof value !== "string" || !value.startsWith(family)) return undefined;
  const suffix = value.slice(family.length);
  if (!/^[1-9][0-9]*$/.test(suffix)) return undefined;
  const version = Number(suffix);
  return Number.isSafeInteger(version) ? version : undefined;
}

/**
 * Pure engine compatibility; absent floors retain the v3 behavior. Future formats never rebaseline.
 * Floors require a current or superseded declared schema. A superseded manifest's floors are
 * evaluated against this engine, as v4 floors are; they only decide whether this engine may replace it.
 */
export function architectureDocsProjectionCompatibilityIssues(value: unknown, engine: { rendererVersion: string; protocolVersion: string } = {
  rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION, protocolVersion: PROJECTION_REQUEST_SCHEMA_VERSION
}): string[] {
  const manifest = record(value);
  if (!manifest) return [];
  const issues: string[] = [];
  if (["minimumRendererVersion", "minimumProtocolVersion"].some(key => Object.hasOwn(manifest, key))
    && manifest.schemaVersion !== ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION
    && !(typeof manifest.schemaVersion === "string" && isSupersededArchitectureDocsProjectionManifestSchemaVersion(manifest.schemaVersion))) {
    issues.push("projection manifest floors require a current or superseded schema");
  }
  if (typeof manifest.schemaVersion === "string" && manifest.schemaVersion !== ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION
    && !isSupersededArchitectureDocsProjectionManifestSchemaVersion(manifest.schemaVersion)) issues.push("projection manifest schema is unsupported by this engine");
  for (const [key, family, current] of [
    ["minimumRendererVersion", "archcontext.docs-renderer/v", engine.rendererVersion],
    ["minimumProtocolVersion", "archcontext.projection-request/v", engine.protocolVersion]
  ] as const) {
    if (!Object.hasOwn(manifest, key)) continue;
    const required = versionNumber(manifest[key], family);
    const supported = versionNumber(current, family);
    if (required === undefined || supported === undefined || supported < required) issues.push(`projection manifest ${key} is unsupported by this engine`);
  }
  return issues;
}
