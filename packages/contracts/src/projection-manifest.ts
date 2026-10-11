import type { ProjectionTargetFormat, ProjectionTargetOwnership, ProjectionTargetScopeKind, ProjectionTargetType } from "./ledger";
import {
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  ARCHITECTURE_SEMANTIC_FACETS,
  isArchitectureCapabilityProofStatus,
  type ArchitectureCapabilityProofStatusV1,
  type ArchitectureDigestSetV1,
  type ArchitectureSemanticFacet,
  type Sha256Digest
} from "./projection";
import { isRepoRelativePosixPath } from "./schema";

/**
 * The committed projection manifest, `docs/architecture/.projection-manifest.json` (#264). The
 * projection engine writes it and reads its semantic baseline and provenance back; this module is
 * the only definition of its shape.
 */
export const ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH = "docs/architecture/.projection-manifest.json" as const;
export const ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION = "archcontext.architecture-docs-projection-manifest/v2" as const;
export const ARCHITECTURE_DOCS_PROJECTION_PROVENANCE_SCHEMA_VERSION = "archcontext.architecture-docs-projection-provenance/v3" as const;
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

export interface ArchitectureProofEvidenceDigestsV1 {
  /** Declared source footprint identity, the same value the committed provenance records. */
  sourceTreeDigest: string;
  /** Digest of the selector-evidence facts the P1/P2 compilation reads. */
  selectorEvidenceDigest: string;
  /** The renderer version that compiled the proofs, so a compiler change is never credited to journals. */
  rendererVersion: string;
}

export interface ArchitectureProjectionSemanticBaselineV1 {
  semanticState: ArchitectureSemanticStateV1;
  digests: ArchitectureDigestSetV1;
  /**
   * The non-model proof inputs this baseline was rendered from, recorded fresh on every render.
   * Absent in manifests written before it existed.
   */
  evidence?: ArchitectureProofEvidenceDigestsV1;
}

/**
 * Committed projection provenance. It records machine-independent values only: content digests of
 * the model and the declared sources, plus renderer, layout and CodeGraph versions, so two machines
 * projecting the same commit write the same bytes (#277). HEAD, the full-worktree digest, the
 * CodeGraph evidence digest, the indexed-worktree digest and the CodeGraph status depend on the
 * checkout path, the index build time, the platform or whether `codegraph init` ran; they are runtime
 * facts (the projection runtime snapshot) and never reach the committed manifest. A provenance of
 * any other schemaVersion is not read as this one; the next projection rewrites it.
 */
export interface ArchitectureDocumentationProjectionProvenanceV3 {
  schemaVersion: typeof ARCHITECTURE_DOCS_PROJECTION_PROVENANCE_SCHEMA_VERSION;
  sourceTreeDigest: string;
  modelDigest: string;
  projectionInputDigest: string;
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  layoutVersion: "archcontext.docs-layout/v1";
  /** Reproducible CodeGraph identity only: package name and version (#266, #277). */
  generatedFrom: {
    codeGraphPackage: string;
    codeGraphVersion: string;
  };
}

/**
 * One 1–2–5 magnitude bucket: the half-open range `[lower, upper)` that contains a measured count.
 * `{ lower: 0, upper: 1 }` holds only zero; otherwise `lower` is `1`, `2` or `5` times a power of ten
 * and `upper` is the next step on that ladder.
 */
export interface ArchitectureScaleBucketV1 {
  lower: number;
  upper: number;
}

/**
 * The measured size of a node's declared `source.include` minus `source.exclude` footprint, as
 * buckets. The module document prints exactly these buckets; the exact counts are never committed.
 */
export interface ArchitectureCapabilityScaleV1 {
  fileCountBucket: ArchitectureScaleBucketV1;
  lineCountBucket: ArchitectureScaleBucketV1;
}

export interface ArchitectureDocsProjectionManifestTargetV2 {
  targetId: string;
  type: ProjectionTargetType;
  scope: { kind: ProjectionTargetScopeKind; id?: string; entityKind?: string };
  path: string;
  ownership: ProjectionTargetOwnership;
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  format: ProjectionTargetFormat;
  sourceDigest: string;
  outputDigest: string;
  /**
   * `entity-summary` targets of a node that declares `source.include` only: the content digest of
   * that footprint the document was verified against. Present exactly when `scale` is.
   */
  sourceFootprintDigest?: string;
  /** `entity-summary` targets of a node that declares `source.include` only (#264). */
  scale?: ArchitectureCapabilityScaleV1;
}

export interface ArchitectureDocsProjectionManifestV2 {
  schemaVersion: typeof ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION;
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  profile: ArchitectureDocsProjectionProfile;
  sourceDigest: string;
  provenance: ArchitectureDocumentationProjectionProvenanceV3;
  projectionDigest: string;
  semanticBaseline: ArchitectureProjectionSemanticBaselineV1;
  receiptDigest: string;
  targetCount: number;
  fileCount: number;
  targets: ArchitectureDocsProjectionManifestTargetV2[];
}

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const TARGET_TYPES: Record<ProjectionTargetType, true> = {
  "architecture-index": true,
  "entity-summary": true,
  "relation-summary": true,
  "decision-index": true,
  "architecture-changelog": true,
  "diagram-mermaid": true,
  "diagram-structurizr": true,
  "diagram-likec4": true,
  "agent-context": true
};
const SCOPE_KINDS: Record<ProjectionTargetScopeKind, true> = { repository: true, entity: true, relation: true, decision: true, diagram: true, changelog: true };
const OWNERSHIPS: Record<ProjectionTargetOwnership, true> = { generated: true, mixed: true };
const FORMATS: Record<ProjectionTargetFormat, true> = { markdown: true, mermaid: true, "structurizr-json": true, likec4: true };

/** Every reason the value is not a current-format projection manifest; empty when it is one. */
export function architectureDocsProjectionManifestIssues(value: unknown): string[] {
  const issues: string[] = [];
  const manifest = record(value);
  if (!manifest) return ["manifest must be an object"];
  issues.push(...exactKeys(manifest, ["schemaVersion", "rendererVersion", "profile", "sourceDigest", "provenance", "projectionDigest", "semanticBaseline", "receiptDigest", "targetCount", "fileCount", "targets"], [], "manifest"));
  if (manifest.schemaVersion !== ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION) issues.push("manifest.schemaVersion is unsupported");
  if (manifest.rendererVersion !== ARCHITECTURE_DOCS_RENDERER_VERSION) issues.push(`manifest.rendererVersion must be ${ARCHITECTURE_DOCS_RENDERER_VERSION}`);
  if (!(ARCHITECTURE_DOCS_PROJECTION_PROFILES as readonly unknown[]).includes(manifest.profile)) issues.push("manifest.profile is unsupported");
  for (const field of ["sourceDigest", "projectionDigest", "receiptDigest"] as const) {
    if (!isDigest(manifest[field])) issues.push(`manifest.${field} must be a SHA-256 digest`);
  }
  issues.push(...architectureDocsProjectionProvenanceIssues(manifest.provenance, "manifest.provenance"));
  issues.push(...architectureProjectionSemanticBaselineIssues(manifest.semanticBaseline, "manifest.semanticBaseline"));
  const targets = manifest.targets;
  if (!Array.isArray(targets)) {
    issues.push("manifest.targets must be an array");
    return issues;
  }
  if (manifest.targetCount !== targets.length) issues.push("manifest.targetCount must equal the number of targets");
  if (manifest.fileCount !== targets.length) issues.push("manifest.fileCount must equal the number of targets");
  const targetIds = targets.map((target) => record(target)?.targetId);
  if (new Set(targetIds).size !== targetIds.length) issues.push("manifest.targets.targetId must be unique");
  targets.forEach((target, index) => issues.push(...manifestTargetIssues(target, `manifest.targets[${index}]`)));
  return issues;
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
  if (provenance.layoutVersion !== "archcontext.docs-layout/v1") issues.push(`${prefix}.layoutVersion is unsupported`);
  const generatedFrom = record(provenance.generatedFrom);
  if (!generatedFrom) {
    issues.push(`${prefix}.generatedFrom must be an object`);
    return issues;
  }
  issues.push(...exactKeys(generatedFrom, ["codeGraphPackage", "codeGraphVersion"], [], `${prefix}.generatedFrom`));
  for (const field of ["codeGraphPackage", "codeGraphVersion"] as const) {
    if (!isNonEmptyString(generatedFrom[field])) issues.push(`${prefix}.generatedFrom.${field} must be a non-empty string`);
  }
  return issues;
}

export function architectureProjectionSemanticBaselineIssues(value: unknown, prefix = "semanticBaseline"): string[] {
  const baseline = record(value);
  if (!baseline) return [`${prefix} must be an object`];
  const issues = exactKeys(baseline, ["semanticState", "digests"], ["evidence"], prefix);
  issues.push(...architectureSemanticStateIssues(baseline.semanticState, `${prefix}.semanticState`));
  issues.push(...architectureDigestSetIssues(baseline.digests, `${prefix}.digests`));
  if (baseline.evidence !== undefined) {
    const evidence = record(baseline.evidence);
    if (!evidence) issues.push(`${prefix}.evidence must be an object`);
    else {
      issues.push(...exactKeys(evidence, ["sourceTreeDigest", "selectorEvidenceDigest", "rendererVersion"], [], `${prefix}.evidence`));
      if (!isDigest(evidence.sourceTreeDigest)) issues.push(`${prefix}.evidence.sourceTreeDigest must be a SHA-256 digest`);
      if (!isDigest(evidence.selectorEvidenceDigest)) issues.push(`${prefix}.evidence.selectorEvidenceDigest must be a SHA-256 digest`);
      if (!isNonEmptyString(evidence.rendererVersion)) issues.push(`${prefix}.evidence.rendererVersion must be a non-empty string`);
    }
  }
  return issues;
}

export function architectureDigestSetIssues(value: unknown, prefix = "digests"): string[] {
  const digests = record(value);
  if (!digests) return [`${prefix} must be an object`];
  const fields = ["modelDigest", "sourceTreeDigest", "flowProofDigest", "projectionDigest"] as const;
  const issues = exactKeys(digests, fields, [], prefix);
  for (const field of fields) if (!isDigest(digests[field])) issues.push(`${prefix}.${field} must be a SHA-256 digest`);
  return issues;
}

export function architectureSemanticStateIssues(value: unknown, prefix = "semanticState"): string[] {
  const state = record(value);
  if (!state) return [`${prefix} must be an object`];
  const issues = exactKeys(state, ["schemaVersion", "capabilities", "semanticFingerprint", "flowProofFingerprint"], [], prefix);
  if (state.schemaVersion !== ARCHITECTURE_SEMANTIC_STATE_SCHEMA_VERSION) issues.push(`${prefix}.schemaVersion is unsupported`);
  if (!isDigest(state.semanticFingerprint)) issues.push(`${prefix}.semanticFingerprint must be a SHA-256 digest`);
  if (!isDigest(state.flowProofFingerprint)) issues.push(`${prefix}.flowProofFingerprint must be a SHA-256 digest`);
  if (!Array.isArray(state.capabilities)) {
    issues.push(`${prefix}.capabilities must be an array`);
    return issues;
  }
  const ids = state.capabilities.map((entry) => record(entry)?.capabilityId);
  if (!isSortedUniqueStrings(ids)) issues.push(`${prefix}.capabilities must be sorted and unique by capabilityId`);
  state.capabilities.forEach((entry, index) => {
    const entryPrefix = `${prefix}.capabilities[${index}]`;
    const capability = record(entry);
    if (!capability) {
      issues.push(`${entryPrefix} must be an object`);
      return;
    }
    issues.push(...exactKeys(capability, ["capabilityId", "memberNodeIds", "semanticFingerprint", "flowProofFingerprint", "proofStatus", "facets"], [], entryPrefix));
    if (!isNonEmptyString(capability.capabilityId)) issues.push(`${entryPrefix}.capabilityId must be a non-empty string`);
    if (!Array.isArray(capability.memberNodeIds) || !isSortedUniqueStrings(capability.memberNodeIds)) issues.push(`${entryPrefix}.memberNodeIds must be sorted and unique`);
    if (!isDigest(capability.semanticFingerprint)) issues.push(`${entryPrefix}.semanticFingerprint must be a SHA-256 digest`);
    if (!isDigest(capability.flowProofFingerprint)) issues.push(`${entryPrefix}.flowProofFingerprint must be a SHA-256 digest`);
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

/** True when the value is a valid 1–2–5 magnitude bucket (see ArchitectureScaleBucketV1). */
export function isArchitectureScaleBucket(value: unknown): value is ArchitectureScaleBucketV1 {
  const bucket = record(value);
  if (!bucket || Object.keys(bucket).length !== 2) return false;
  const { lower, upper } = bucket;
  if (typeof lower !== "number" || typeof upper !== "number" || !Number.isSafeInteger(lower) || !Number.isSafeInteger(upper)) return false;
  if (lower === 0) return upper === 1;
  let magnitude = 1;
  while (magnitude * 10 <= lower) magnitude *= 10;
  const mantissa = lower / magnitude;
  if (mantissa === 1) return upper === 2 * magnitude;
  if (mantissa === 2) return upper === 5 * magnitude;
  if (mantissa === 5) return upper === 10 * magnitude;
  return false;
}

function manifestTargetIssues(value: unknown, prefix: string): string[] {
  const target = record(value);
  if (!target) return [`${prefix} must be an object`];
  const issues = exactKeys(target, ["targetId", "type", "scope", "path", "ownership", "rendererVersion", "format", "sourceDigest", "outputDigest"], ["sourceFootprintDigest", "scale"], prefix);
  if (!isNonEmptyString(target.targetId)) issues.push(`${prefix}.targetId must be a non-empty string`);
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
  if (target.rendererVersion !== ARCHITECTURE_DOCS_RENDERER_VERSION) issues.push(`${prefix}.rendererVersion must be ${ARCHITECTURE_DOCS_RENDERER_VERSION}`);
  if (typeof target.format !== "string" || !Object.hasOwn(FORMATS, target.format)) issues.push(`${prefix}.format is unsupported`);
  if (!isDigest(target.sourceDigest)) issues.push(`${prefix}.sourceDigest must be a SHA-256 digest`);
  if (!isDigest(target.outputDigest)) issues.push(`${prefix}.outputDigest must be a SHA-256 digest`);
  if (target.sourceFootprintDigest !== undefined && !isDigest(target.sourceFootprintDigest)) issues.push(`${prefix}.sourceFootprintDigest must be a SHA-256 digest`);
  if ((target.sourceFootprintDigest !== undefined || target.scale !== undefined) && target.type !== "entity-summary") {
    issues.push(`${prefix}.sourceFootprintDigest and scale are only allowed on entity-summary targets`);
  }
  if ((target.sourceFootprintDigest === undefined) !== (target.scale === undefined)) issues.push(`${prefix}.sourceFootprintDigest and scale must be present together`);
  if (target.scale !== undefined) {
    const scale = record(target.scale);
    if (!scale) issues.push(`${prefix}.scale must be an object`);
    else {
      issues.push(...exactKeys(scale, ["fileCountBucket", "lineCountBucket"], [], `${prefix}.scale`));
      for (const field of ["fileCountBucket", "lineCountBucket"] as const) {
        if (!isArchitectureScaleBucket(scale[field])) issues.push(`${prefix}.scale.${field} must be a 1-2-5 magnitude bucket`);
      }
    }
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
