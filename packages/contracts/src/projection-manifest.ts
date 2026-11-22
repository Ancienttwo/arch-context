import type { ProjectionTargetFormat, ProjectionTargetOwnership, ProjectionTargetScopeKind, ProjectionTargetType } from "./ledger-records";
import {
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  PROJECTION_REQUEST_SCHEMA_VERSION,
  ARCHITECTURE_SEMANTIC_FACETS,
  type Sha256Digest
} from "./projection-constants";
import { isArchitectureCapabilityProofStatus } from "./projection-apply-validators";
import { isRepoRelativePosixPath } from "./schema";
import {
  ARCHITECTURE_DOCS_LAYOUT_VERSION_V1,
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION,
  ARCHITECTURE_DOCS_PROJECTION_PROFILES,
  ARCHITECTURE_DOCS_PROJECTION_PROVENANCE_SCHEMA_VERSION,
  isSupersededArchitectureDocsProjectionManifestSchemaVersion
} from "./projection-manifest-types";

export * from "./projection-manifest-types";

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
