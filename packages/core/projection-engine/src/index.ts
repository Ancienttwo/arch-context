import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, posix, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  AGENT_CONTEXT_RENDERER_VERSION as CONTRACT_AGENT_CONTEXT_RENDERER_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION as CONTRACT_ARCHITECTURE_DOCS_RENDERER_VERSION,
  PROJECTION_TARGET_SCHEMA_VERSION,
  digestJson,
  stableId,
  type AcceptedArchitectureChangeReferenceV1,
  type ArchitectureDigestSetV1,
  type ArchitectureFlowV1,
  type ArchitectureNodeSourceV2,
  type ArchitectureRefreshSignalV1,
  type Json,
  type ModelExportResult,
  type ProjectionFreshnessReasonCode,
  type ProjectionTargetV1
} from "@archcontext/contracts";
import { assertRepoRelativePath, computeWorktreeDigest, parseJsonOrStableYaml } from "@archcontext/core/architecture-domain";
import { assertPathHasNoSymlinkSegments } from "@archcontext/core/changeset-engine";
import {
  agentContextTargetPaths,
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  REPO_HARNESS_PROJECTION_PROFILE,
  contractFilesForNode,
  loadArchitectureFilesForLayout,
  primarySourceDirectory,
  resolveArchitectureDocumentationLayout,
  type ArchitectureDocumentationLayout,
  type ArchitectureProjectionProfile,
  type ProjectionLayoutTargetDraft
} from "./layout";
import {
  compileSemanticCapabilityDiagrams,
  type ArchitectureSelectorEvidenceV1,
  type SemanticCapabilityDiagramCompilation
} from "./semantic-diagrams";
import {
  architectureProofEvidenceDigests,
  classifyArchitectureMajorChange,
  compileArchitectureSemanticState,
  produceArchitectureRefreshSignals,
  type ArchitectureMajorChangeClassificationV1,
  type ArchitectureProjectionSemanticBaselineV1,
  type ArchitectureSemanticStateV1
} from "./major-change";

export * from "./adoption";
export * from "./layout";
export * from "./major-change";
export * from "./semantic-diagrams";

export type NativeNodeSource = ArchitectureNodeSourceV2;

export interface NativeNode extends Record<string, Json | undefined> {
  schemaVersion?: "archcontext.node/v2";
  id: string;
  kind: string;
  name: string;
  parent?: string;
  status?: string;
  summary?: string;
  // Typed as Json (not NativeNodeSource) so this interface still satisfies its own
  // Record<string, Json | undefined> index signature; use nativeNodeSource(node) to read
  // this field with the NativeNodeSource shape.
  source?: Json;
  extensions?: Record<string, Json>;
}

/** Reads `node.source` (ADR-0043 `source.include`/`source.exclude`/`entrypoints`) as NativeNodeSource. */
export function nativeNodeSource(node: NativeNode): NativeNodeSource | undefined {
  const value = node.source;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as unknown as NativeNodeSource;
}

export interface NativeRelation extends Record<string, Json> {
  id: string;
  kind: string;
  source: string;
  target: string;
  intent: string;
}

export interface NativeModel {
  nodes: NativeNode[];
  relations: NativeRelation[];
  flows?: ArchitectureFlowV1[];
}

export interface ArchitectureDecisionRecord {
  id: string;
  title: string;
  path: string;
  status?: string;
}

export interface ArchitectureDocumentationTimelineEntry {
  eventId: string;
  timestamp: string;
  title?: string;
  summary?: string;
  affectedSubjects?: string[];
}

export interface ArchitectureDocumentationExistingFile {
  path: string;
  body: string;
}

export interface ArchitectureDocumentationProjectionFile extends ArchitectureDocumentationExistingFile {
  target: ProjectionTargetV1;
  digest: string;
  generatedBodyDigest: string;
  /**
   * Present on `entity-summary` targets of nodes that declare `source.include`: the content digest
   * of the node's declared source footprint this render verified the document against
   * (`loadCapabilitySourceFootprintDigests`). Content-addressed, so it survives squash merges,
   * rebases and shallow clones, and a change outside the footprint leaves it untouched.
   */
  sourceFootprintDigest?: string;
}

export type ArchitectureDocumentationDriftReason =
  | "projection-file-missing"
  | "projection-manifest-missing"
  | "projection-manifest-invalid"
  | "projection-manifest-stale"
  | "projection-adoption-required"
  | "projection-generated-region-missing"
  | "projection-generated-region-stale"
  | "projection-generated-region-manually-edited"
  | "projection-ambiguous-ownership"
  | "projection-orphaned";

export interface ArchitectureDocumentationProjectionDrift {
  path: string;
  targetId?: string;
  reasonCode: ArchitectureDocumentationDriftReason;
  expectedDigest?: string;
  actualDigest?: string;
}

export interface ArchitectureDocumentationProjectionPlan {
  schemaVersion: "archcontext.architecture-docs-projection-plan/v1";
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  sourceDigest: string;
  projectionDigest: string;
  profile: ArchitectureProjectionProfile;
  provenance: ArchitectureDocumentationProjectionProvenanceV2;
  semanticState: ArchitectureSemanticStateV1;
  architectureDigests: ArchitectureDigestSetV1;
  majorChange: ArchitectureMajorChangeClassificationV1;
  refreshSignals: ArchitectureRefreshSignalV1[];
  receiptDigest: string;
  targets: ProjectionTargetV1[];
  files: ArchitectureDocumentationProjectionFile[];
  manifest: ArchitectureDocumentationExistingFile & { digest: string };
  drift: {
    ok: boolean;
    reasonCodes: ArchitectureDocumentationDriftReason[];
    diffs: ArchitectureDocumentationProjectionDrift[];
  };
  rejected: ArchitectureDocumentationProjectionDrift[];
  adoptionCandidates: ArchitectureDocumentationProjectionFile[];
}

/**
 * Committed projection provenance. It records content identities only: the HEAD and full-worktree
 * snapshot a projection ran against are runtime facts (`ArchitectureDocumentationProjectionRuntimeSnapshot`)
 * and never reach the committed manifest, where a branch commit would dangle after a squash merge.
 */
export interface ArchitectureDocumentationProjectionProvenanceV2 {
  schemaVersion: "archcontext.architecture-docs-projection-provenance/v2";
  sourceTreeDigest: string;
  modelDigest: string;
  codeGraphDigest: string;
  indexedWorktreeDigest: string | null;
  projectionInputDigest: string;
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  layoutVersion: typeof ARCHITECTURE_DOCS_LAYOUT_VERSION;
  generatedFrom: {
    codeGraphPackage: string;
    codeGraphVersion: string;
    codeGraphBinaryDigest: string;
    codeGraphStatus: "ready" | "unavailable";
  };
}

export const ARCHITECTURE_DOCS_RENDERER_VERSION = CONTRACT_ARCHITECTURE_DOCS_RENDERER_VERSION;
export const ARCHITECTURE_DOCS_GENERATED_BEGIN_PREFIX = "<!-- BEGIN ARCHCONTEXT:generated";
export const ARCHITECTURE_DOCS_GENERATED_END_PREFIX = "<!-- END ARCHCONTEXT:generated";

/**
 * The repository state one projection run read: the HEAD it ran on and the projection worktree
 * digest. Runtime-only — refresh signals and protocol receipts bind it, the committed manifest
 * does not.
 */
export interface ArchitectureDocumentationProjectionRuntimeSnapshot {
  headSha: string;
  worktreeDigest: string;
}

/**
 * Content digest of one node's declared source footprint: the files `source.include` selects,
 * minus `source.exclude`, minus `projectionOwnedPaths`. This is the per-node projection stamp.
 */
export interface CapabilitySourceFootprintDigest {
  nodeId: string;
  digest: string;
  fileCount: number;
}

/**
 * Measured scale of one node's declared `source.include` (minus `source.exclude`) footprint.
 * Produced by `loadCapabilitySourceScaleSignals`; the renderer refuses to project a node that
 * declares `source.include` without a matching measurement rather than printing a guess.
 */
export interface CapabilitySourceScaleSignal {
  nodeId: string;
  fileCount: number;
  lineCount: number;
  includePatterns: string[];
  excludePatterns: string[];
}

/** One real `imports` edge between two repo-relative files, as resolved by the code index. */
export interface CapabilityImportEdge {
  from: string;
  to: string;
}

/**
 * One node's measured import footprint: the files `source.include` (minus `source.exclude`)
 * selects, plus the real `imports` edges the code index resolved out of those files. Produced
 * outside `@archcontext/core` because the index query needs a child process. This remains an
 * explicitly measured diagnostic surface; semantic P1 comes only from accepted nodes and
 * relations and never promotes these raw path edges into architecture truth.
 */
export interface CapabilityImportGraph {
  nodeId: string;
  /** Repo-relative files inside the node's declared footprint, sorted. */
  files: string[];
  /** Edges whose `from` is one of `files`; `to` may sit outside the footprint. */
  edges: CapabilityImportEdge[];
  /** The index dump hit its budget, so `edges` may be incomplete. Printed, never hidden. */
  truncated: boolean;
}

const SOURCE_FOOTPRINT_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

/** Compiles accepted node/relation/flow authority against an exact CodeGraph evidence snapshot. */
export function renderArchitectureDocumentationProjection(input: {
  model: NativeModel;
  profile?: ArchitectureProjectionProfile;
  sourceDigest: string;
  provenance: ArchitectureDocumentationProjectionProvenanceV2;
  /**
   * Per node that declares `source.include`: the content digest of its footprint
   * (`loadCapabilitySourceFootprintDigests`). It becomes the node's stamp in the manifest; a node
   * that declares a footprint without a matching digest is refused, never stamped with a guess.
   */
  sourceFootprints: CapabilitySourceFootprintDigest[];
  sourceScaleSignals: CapabilitySourceScaleSignal[];
  importGraphs: CapabilityImportGraph[];
  selectorEvidence: ArchitectureSelectorEvidenceV1[];
  generatedAt?: string;
  decisions?: ArchitectureDecisionRecord[];
  timeline?: ArchitectureDocumentationTimelineEntry[];
  existingFiles?: ArchitectureDocumentationExistingFile[];
  rendererVersion?: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  refreshContext?: {
    repositoryId: string;
    workspaceId: string;
    headSha: string;
    worktreeDigest: string;
    acceptedChange?: AcceptedArchitectureChangeReferenceV1;
    expected?: { repositoryId: string; workspaceId: string; headSha: string; worktreeDigest: string };
  };
}): ArchitectureDocumentationProjectionPlan {
  const rendererVersion = input.rendererVersion ?? ARCHITECTURE_DOCS_RENDERER_VERSION;
  assertArchitectureDocumentationProjectionProvenance(input.provenance, rendererVersion);
  const model = normalizeNativeModel(input.model);
  const layout = resolveArchitectureDocumentationLayout({ nodes: model.nodes, relations: model.relations, profile: input.profile });
  const existingByPath = new Map((input.existingFiles ?? []).map((file) => [file.path, file.body]));
  const provenance = stickyArchitectureDocumentationProjectionProvenance(
    input.provenance,
    existingByPath.get("docs/architecture/.projection-manifest.json")
  );
  const generatedAt = input.generatedAt ?? "1970-01-01T00:00:00.000Z";
  const scaleSignalsByNodeId = new Map((input.sourceScaleSignals ?? []).map((signal) => [signal.nodeId, signal]));
  const semanticCompilationsByNodeId = new Map(model.nodes.map((node) => [node.id, compileSemanticCapabilityDiagrams({
    capabilityId: node.id,
    nodes: model.nodes.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      name: entry.name,
      ...(entry.parent ? { parent: entry.parent } : {}),
      ...(nativeNodeSource(entry) ? { source: nativeNodeSource(entry) } : {})
    })),
    relations: model.relations,
    flows: model.flows ?? [],
    evidence: input.selectorEvidence
  })]));
  const semanticState = compileArchitectureSemanticState({
    model,
    compilations: [...semanticCompilationsByNodeId.values()]
  });
  const previousSemanticBaseline = architectureProjectionSemanticBaseline(
    existingByPath.get("docs/architecture/.projection-manifest.json")
  );
  const majorChange = classifyArchitectureMajorChange({
    base: previousSemanticBaseline?.semanticState,
    resulting: semanticState,
    acceptedChange: input.refreshContext?.acceptedChange
  });
  // Each entity-summary target keys its marker on the digest of *its own rendered body*, so the key
  // is a total function of every render input of that body: status, summary,
  // `extensions.localContracts`, `source.include`/`source.entrypoints`, both relation lists, the
  // bucketed scale signal, and the semantic P1/P2 compilation. Because the key is the rendered
  // string rather than an enumeration of inputs, a future body input is covered automatically
  // instead of having to be remembered. A re-measured footprint is therefore reported as
  // `projection-generated-region-stale` on the one document that carries it instead of every
  // entity target.
  //
  // The source-footprint stamp is not a body input at all: it lives in the projection manifest and
  // never reaches the rendered document or its marker attributes. A document body that printed it
  // would churn whenever anything under the node's footprint moved even though no architecture
  // assertion changed. Keeping the stamp in the manifest gives one machine-owned file that churn and
  // lets every `.md` diff mean "the architecture this document asserts changed". The freshness gate
  // reads the stamp from the manifest (`loadArchitectureProjectionManifestStamps`).
  //
  // The plan-wide `input.sourceDigest` (the moving tree) is deliberately not folded into the
  // per-entity key either: it would couple every entity document to unrelated commits. `generatedAt`
  // does not enter entity bodies (only architecture-index prints it), so it cannot perturb the key.
  // Index/diagram/decision/relation/changelog targets render no per-node measurement, so they keep
  // recording the plan-wide `input.sourceDigest`.
  const targetDrafts = architectureDocumentationTargetDrafts(model, layout);
  const declaresSourceByNodeId = new Map(model.nodes.map((node) => [node.id, (nativeNodeSource(node)?.include ?? []).length > 0]));
  const footprintDigestByNodeId = new Map(input.sourceFootprints.map((entry) => [entry.nodeId, entry.digest]));
  const rendered = targetDrafts.map((draft) => {
    const existing = existingByPath.get(draft.path);
    const nodeId = draft.type === "entity-summary" ? draft.scope.id : undefined;
    // Rendering the body up front also keeps the fail-closed error paths in front of the stamp
    // — a node that declares `source.include` with no measured scale signal throws
    // `architecture-docs-projection-scale-signal-missing` here.
    const generatedBody = renderTargetGeneratedBody(draft, model, {
      generatedAt,
      scaleSignalsByNodeId,
      semanticCompilationsByNodeId,
      decisions: input.decisions ?? [],
      timeline: input.timeline ?? [],
      layout
    });
    // Targets that render no per-node measurement key on the plan-wide digest; an entity-summary
    // target keys on the digest of its own rendered body (see the comment above the render loop).
    let targetSourceDigest = input.sourceDigest;
    let sourceFootprintDigest: string | undefined;
    if (nodeId !== undefined) {
      targetSourceDigest = digestJson(generatedBody);
      if (declaresSourceByNodeId.get(nodeId) === true) {
        // The stamp is the footprint this render read, so re-projecting is what re-verifies a
        // document and an unchanged footprint keeps the manifest byte-identical.
        sourceFootprintDigest = footprintDigestByNodeId.get(nodeId);
        if (sourceFootprintDigest === undefined || !SOURCE_FOOTPRINT_DIGEST_PATTERN.test(sourceFootprintDigest)) {
          throw new Error(`architecture-docs-projection-source-footprint-missing: ${nodeId}`);
        }
      }
    }
    const generatedBodyDigest = digestJson({ targetId: draft.targetId, body: generatedBody } as unknown as Json);
    const target = projectionTarget({
      ...draft,
      rendererVersion,
      sourceDigest: targetSourceDigest,
      outputDigest: generatedBodyDigest
    });
    const wrapped = wrapGeneratedRegion(target, generatedBody);
    const body = mergeGeneratedRegion(target, wrapped, existing, draft.skeleton);
    return {
      path: target.path,
      body,
      target,
      digest: digestJson({ path: target.path, body } as unknown as Json),
      generatedBodyDigest,
      ...(sourceFootprintDigest ? { sourceFootprintDigest } : {})
    };
  });
  const targets = rendered.map((file) => file.target);
  const expectedByPath = new Map(rendered.map((file) => [file.path, file]));
  const projectionDigest = digestJson({
    rendererVersion,
    profile: layout.profile,
    sourceDigest: input.sourceDigest,
    projectionInputDigest: provenance.projectionInputDigest,
    files: rendered.map((file) => ({
      path: file.path,
      targetId: file.target.targetId,
      digest: file.digest,
      generatedBodyDigest: file.generatedBodyDigest
    })).sort((left, right) => left.path.localeCompare(right.path))
  } as unknown as Json);
  const architectureDigests: ArchitectureDigestSetV1 = {
    modelDigest: provenance.modelDigest as ArchitectureDigestSetV1["modelDigest"],
    sourceTreeDigest: provenance.sourceTreeDigest as ArchitectureDigestSetV1["sourceTreeDigest"],
    flowProofDigest: semanticState.flowProofFingerprint as ArchitectureDigestSetV1["flowProofDigest"],
    projectionDigest: projectionDigest as ArchitectureDigestSetV1["projectionDigest"]
  };
  const baseDigests = previousSemanticBaseline?.digests ?? architectureDigests;
  const receiptDigest = digestJson({
    schemaVersion: "archcontext.architecture-docs-projection-receipt/v1",
    rendererVersion,
    profile: layout.profile,
    provenance,
    architectureDigests,
    majorChange
  } as unknown as Json);
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
  const manifestValue = {
    schemaVersion: "archcontext.architecture-docs-projection-manifest/v1",
    rendererVersion,
    profile: layout.profile,
    sourceDigest: input.sourceDigest,
    provenance,
    projectionDigest,
    semanticBaseline: {
      semanticState,
      digests: architectureDigests,
      // From this render's inputs, not the sticky `provenance` above: the reuse key of that copy
      // excludes CodeGraph evidence, so it cannot say what this baseline's proofs were built from.
      evidence: architectureProofEvidenceDigests({ sourceTreeDigest: input.provenance.sourceTreeDigest, selectorEvidence: input.selectorEvidence, rendererVersion })
    },
    receiptDigest,
    targetCount: targets.length,
    fileCount: rendered.length,
    // Per-node stamps: each entity-summary target of a node with a declared footprint records that
    // footprint's content digest. The freshness check (`evaluateArchitectureProjectionFreshness`)
    // compares it with the current digest and never reads Git history, so it holds after squash
    // merges, rebases and in shallow clones.
    targets: rendered.map((file) => ({
      targetId: file.target.targetId,
      type: file.target.type,
      scope: file.target.scope,
      path: file.target.path,
      ownership: file.target.ownership,
      rendererVersion: file.target.rendererVersion,
      format: file.target.format,
      sourceDigest: file.target.sourceDigest,
      outputDigest: file.target.outputDigest,
      ...(file.sourceFootprintDigest ? { sourceFootprintDigest: file.sourceFootprintDigest } : {})
    }))
  } as unknown as Json;
  const manifest = {
    path: "docs/architecture/.projection-manifest.json",
    body: `${JSON.stringify(manifestValue, null, 2)}\n`,
    digest: digestJson(manifestValue)
  };
  const drift = architectureDocumentationProjectionDrift({
    targets,
    expectedFiles: rendered,
    expectedManifest: manifest,
    existingFiles: input.existingFiles ?? []
  });
  const rejected = drift.diffs.filter((diff) =>
    diff.reasonCode === "projection-ambiguous-ownership" || diff.reasonCode === "projection-adoption-required"
  );
  const adoptionCandidates = rendered.filter((file) => rejected.some((diff) =>
    diff.reasonCode === "projection-adoption-required" && diff.path === file.path && diff.targetId === file.target.targetId
  ));

  return {
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
    targets,
    files: rendered.filter((file) => !rejected.some((diff) => diff.path === file.path && diff.targetId === file.target.targetId)),
    manifest,
    drift: {
      ...drift,
      diffs: drift.diffs.map((diff) => ({
        ...diff,
        expectedDigest: diff.expectedDigest ?? expectedByPath.get(diff.path)?.digest
      }))
    },
    rejected,
    adoptionCandidates
  };
}

function architectureProjectionSemanticBaseline(body: string | undefined): ArchitectureProjectionSemanticBaselineV1 | undefined {
  if (body === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const baseline = (parsed as Record<string, unknown>).semanticBaseline;
  if (baseline === undefined) return undefined;
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) {
    throw new Error("architecture-major-change-semantic-baseline-invalid");
  }
  const value = baseline as ArchitectureProjectionSemanticBaselineV1;
  if (!value.semanticState || !value.digests) throw new Error("architecture-major-change-semantic-baseline-invalid");
  return value;
}

export function architectureDocumentationSourceTreeDigest(root: string, model: NativeModel): string {
  const agentContextOutputs = new Set(agentContextTargetPaths(model.nodes).map((target) => target.path));
  const files = loadCapabilitySourceFootprints(root, model)
    .flatMap((footprint) => footprint.files)
    .filter((path) => path !== "docs/architecture" && !path.startsWith("docs/architecture/") && !agentContextOutputs.has(path))
    .filter((path, index, all) => all.indexOf(path) === index)
    .sort((left, right) => left.localeCompare(right));
  return digestJson(files.map((path) => ({
    path,
    digest: sourceFileContentDigest(resolve(root, path))
  })) as unknown as Json);
}

/**
 * Content digest of one declared source file with CRLF line endings normalized to LF. Checkouts
 * that apply `core.autocrlf` (Windows runners and developer machines) then measure the same
 * footprint as a Linux clone of the same commit, so source stamps and the snapshot digest do not
 * depend on the platform that computed them. The latin1 round trip rewrites only `\r\n` pairs and
 * leaves every other byte as is.
 */
function sourceFileContentDigest(absolute: string): string {
  const bytes = readFileSync(absolute);
  const normalized = bytes.includes(0x0d) ? Buffer.from(bytes.toString("latin1").replaceAll("\r\n", "\n"), "latin1") : bytes;
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

/** Fixed-point worktree digest: projection-owned outputs cannot hash the manifest that embeds it. */
export function architectureDocumentationProjectionWorktreeDigest(
  root: string,
  model: NativeModel
): string {
  return computeWorktreeDigest(root, {
    ignore: [
      ".ai/harness",
      "docs/architecture",
      ...agentContextTargetPaths(model.nodes).map((target) => target.path)
    ]
  });
}

export function architectureDocumentationProjectionInputDigest(
  input: Omit<ArchitectureDocumentationProjectionProvenanceV2, "schemaVersion" | "projectionInputDigest">
): string {
  return digestJson(input as unknown as Json);
}

export function architectureDocumentationProjectionProvenance(
  input: Omit<ArchitectureDocumentationProjectionProvenanceV2, "schemaVersion" | "projectionInputDigest">
): ArchitectureDocumentationProjectionProvenanceV2 {
  return {
    schemaVersion: "archcontext.architecture-docs-projection-provenance/v2",
    ...input,
    projectionInputDigest: architectureDocumentationProjectionInputDigest(input)
  };
}

/**
 * Preserve the prior generation snapshot while the declared architecture source, model, CodeGraph
 * runtime, and layout inputs are unchanged, so re-indexing alone never rewrites the manifest. CodeGraph's
 * indexed status digest can legitimately advance when it notices projection-owned docs; that is
 * not an architecture input and must not make the manifest chase its own output. A malformed or
 * internally inconsistent prior provenance is never reused and is surfaced by the ordinary
 * manifest drift check.
 */
function stickyArchitectureDocumentationProjectionProvenance(
  current: ArchitectureDocumentationProjectionProvenanceV2,
  existingManifestBody: string | undefined
): ArchitectureDocumentationProjectionProvenanceV2 {
  if (!existingManifestBody) return current;
  try {
    const parsed = JSON.parse(existingManifestBody) as { provenance?: ArchitectureDocumentationProjectionProvenanceV2 };
    const prior = parsed.provenance;
    if (!prior) return current;
    assertArchitectureDocumentationProjectionProvenance(prior, current.rendererVersion);
    return architectureDocumentationStickyProvenanceDigest(prior) === architectureDocumentationStickyProvenanceDigest(current)
      ? prior
      : current;
  } catch {
    return current;
  }
}

function architectureDocumentationStickyProvenanceDigest(
  provenance: ArchitectureDocumentationProjectionProvenanceV2
): string {
  return digestJson({
    // `sourceTreeDigest` is the authoritative declared-source boundary. Do not use the full
    // worktree snapshot here: unrelated files and projection-owned outputs must not invalidate a
    // renderer fixed point merely because CodeGraph reindexed them.
    sourceTreeDigest: provenance.sourceTreeDigest,
    modelDigest: provenance.modelDigest,
    rendererVersion: provenance.rendererVersion,
    layoutVersion: provenance.layoutVersion,
    generatedFrom: provenance.generatedFrom
  } as unknown as Json);
}

function assertArchitectureDocumentationProjectionProvenance(
  provenance: ArchitectureDocumentationProjectionProvenanceV2,
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION
): void {
  if (provenance.schemaVersion !== "archcontext.architecture-docs-projection-provenance/v2") {
    throw new Error("architecture-docs-projection-provenance-schema-invalid");
  }
  if (provenance.rendererVersion !== rendererVersion || provenance.layoutVersion !== ARCHITECTURE_DOCS_LAYOUT_VERSION) {
    throw new Error("architecture-docs-projection-provenance-version-mismatch");
  }
  const { schemaVersion: _schemaVersion, projectionInputDigest: _projectionInputDigest, ...payload } = provenance;
  if (architectureDocumentationProjectionInputDigest(payload) !== provenance.projectionInputDigest) {
    throw new Error("architecture-docs-projection-input-digest-mismatch");
  }
}

export function loadArchitectureDocumentationInputs(root: string, profile: ArchitectureProjectionProfile = "default"): {
  model: NativeModel;
  decisions: ArchitectureDecisionRecord[];
  existingFiles: ArchitectureDocumentationExistingFile[];
} {
  const model = loadNativeModelFromArchContext(root);
  const layout = resolveArchitectureDocumentationLayout({ nodes: model.nodes, relations: model.relations, profile });
  return {
    model,
    decisions: loadArchitectureDecisionRecords(root),
    existingFiles: loadArchitectureFilesForLayout(root, layout)
  };
}

/**
 * Measures the `source.include` minus `source.exclude` footprint of every node that declares one.
 * Nodes without `source.include` are absent from the result on purpose: the renderer prints an
 * explicit "not derivable" note for them instead of a zero that reads like a measurement.
 */
export function loadCapabilitySourceScaleSignals(root: string, model: NativeModel): CapabilitySourceScaleSignal[] {
  return loadCapabilitySourceFootprints(root, model).map((footprint) => ({
    nodeId: footprint.nodeId,
    fileCount: footprint.files.length,
    lineCount: footprint.files.reduce((total, path) => total + countFileLines(resolve(root, path)), 0),
    includePatterns: footprint.includePatterns,
    excludePatterns: footprint.excludePatterns
  }));
}

/** One node's declared source footprint, resolved to repo-relative files. */
export interface CapabilitySourceFootprint {
  nodeId: string;
  files: string[];
  includePatterns: string[];
  excludePatterns: string[];
}

/**
 * Resolves every node's `source.include` minus `source.exclude` to the repo-relative files it
 * selects. Shared by the scale signal loader and by the code-index adapter that measures import
 * edges, so both answer "which files belong to this capability" the same way.
 */
export function loadCapabilitySourceFootprints(root: string, model: NativeModel): CapabilitySourceFootprint[] {
  const nodes = model.nodes.filter((node) => (nativeNodeSource(node)?.include ?? []).length > 0);
  if (nodes.length === 0) return [];
  const scanned = listScaleScanFiles(root);
  return nodes
    .map((node) => {
      const source = nativeNodeSource(node)!;
      const includePatterns = [...(source.include ?? [])];
      const excludePatterns = [...(source.exclude ?? [])];
      const files = scanned
        .filter((path) =>
          !excludePatterns.some((pattern) => matchesGlob(path, pattern))
          && includePatterns.some((pattern) => matchesGlob(path, pattern))
        )
        .sort((left, right) => left.localeCompare(right));
      return { nodeId: node.id, files, includePatterns, excludePatterns };
    })
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

const SCALE_SCAN_SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

function listScaleScanFiles(root: string, prefix = "", out: string[] = []): string[] {
  const dir = prefix === "" ? resolve(root) : resolve(root, prefix);
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (SCALE_SCAN_SKIPPED_DIRECTORIES.has(entry.name)) continue;
      listScaleScanFiles(root, path, out);
      continue;
    }
    if (entry.isFile()) out.push(path);
  }
  return out;
}

function countFileLines(absolute: string): number {
  const content = readFileSync(absolute, "utf8");
  if (content === "") return 0;
  const newlines = content.split("\n").length - 1;
  return content.endsWith("\n") ? newlines : newlines + 1;
}

/**
 * Renders a measured count as the 1–2–5 magnitude bucket that contains it (`537` → `500–1000`,
 * `172275` → `100k–200k`).
 *
 * The projection prints the bucket, never the count. A capability's declared footprint is measured
 * against the working tree, so an exact count in a Git-tracked document rewrites that document on
 * every edit anywhere under the footprint — for a capability covering `tests/**` that is several
 * stamp-only commits a day, and it drowns the diffs that mean an architecture assertion changed.
 * The bucket carries the whole decision the signal exists to support ("how big is this capability")
 * at a resolution ordinary edits cannot move.
 *
 * A bucket is a half-open range `[lower, upper)`; rendering both ends states the resolution instead
 * of implying a point estimate the renderer does not have.
 */
function scaleMagnitudeBucketLabel(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`architecture-docs-projection-scale-signal-not-a-count: ${value}`);
  }
  if (value === 0) return "0";
  const mantissas = [1, 2, 5];
  let index = 0;
  let magnitude = 1;
  let lower = 1;
  for (;;) {
    const nextIndex = (index + 1) % mantissas.length;
    const nextMagnitude = nextIndex === 0 ? magnitude * 10 : magnitude;
    const upper = mantissas[nextIndex] * nextMagnitude;
    if (upper > value) {
      // Both ends share the unit chosen from the lower bound, so a label never mixes `500–1k`.
      const unit = lower >= 1_000_000 ? 1_000_000 : lower >= 10_000 ? 1_000 : 1;
      const suffix = unit === 1_000_000 ? "M" : unit === 1_000 ? "k" : "";
      return `${lower / unit}${suffix}–${upper / unit}${suffix}`;
    }
    index = nextIndex;
    magnitude = nextMagnitude;
    lower = upper;
  }
}

export function architectureDocumentationSourceDigest(input: {
  model: NativeModel;
  profile?: ArchitectureProjectionProfile;
  decisions: ArchitectureDecisionRecord[];
}): string {
  return digestJson({
    model: input.model,
    profile: input.profile ?? "default",
    decisions: input.decisions.map((decision) => ({
      id: decision.id,
      path: decision.path,
      title: decision.title,
      status: decision.status
    }))
  } as unknown as Json);
}

/** The applied manifest selects the layout to verify; never guess a missing profile. */
export function loadArchitectureDocumentationProfile(root: string): ArchitectureProjectionProfile {
  const manifest = JSON.parse(readFileSync(resolve(root, "docs/architecture/.projection-manifest.json"), "utf8"));
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || (manifest.profile !== "default" && manifest.profile !== REPO_HARNESS_PROJECTION_PROFILE)) {
    throw new Error("projection-manifest-profile-invalid: regenerate docs with an explicit supported --profile");
  }
  return manifest.profile;
}

export function loadArchitectureDecisionRecords(root: string): ArchitectureDecisionRecord[] {
  const dir = resolve(root, "docs/adr");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /^ADR-\d{4}-.+\.md$/.test(file))
    .sort()
    .map((file) => {
      const path = `docs/adr/${file}`;
      const body = readFileSync(resolve(root, path), "utf8").replace(/^\uFEFF/, "");
      const frontmatter = body.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
      if (!frontmatter) throw new Error(`${path}: ADR frontmatter is required`);
      const metadata = parseYaml(frontmatter[1]!) as unknown;
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        throw new Error(`${path}: ADR frontmatter must be an object`);
      }
      const { title, status } = metadata as Record<string, unknown>;
      if (typeof title !== "string" || !title.trim()) throw new Error(`${path}: ADR frontmatter title is required`);
      if (/[\r\n]/.test(title)) throw new Error(`${path}: ADR frontmatter title must be a single line`);
      if (status !== undefined && (typeof status !== "string" || !status.trim() || /[\r\n]/.test(status))) {
        throw new Error(`${path}: ADR frontmatter status must be a non-empty single-line string`);
      }
      return {
        id: basename(file, ".md"),
        title: title.trim(),
        path,
        ...(status ? { status: status.trim() } : {})
      };
    });
}

export function loadArchitectureDocumentationFiles(
  root: string,
  model: NativeModel = loadNativeModelFromArchContext(root),
  profile: ArchitectureProjectionProfile = "default"
): ArchitectureDocumentationExistingFile[] {
  return loadArchitectureFilesForLayout(
    root,
    resolveArchitectureDocumentationLayout({ nodes: model.nodes, relations: model.relations, profile })
  );
}

// --- Projection freshness (code moved, projection did not) ---
//
// `architectureDocumentationProjectionDrift` answers "does the file on disk still match what the
// renderer would emit from the current model?" — a digest question over the projection's own
// inputs. Freshness answers a different one: "has the code the projection describes changed since
// its document was verified?". Neither subsumes the other; a projection can be digest-clean and
// describe a footprint whose code has since moved.
//
// Both sides of the comparison are content digests: the per-node stamp the manifest records and
// the footprint digest measured now. Git history is never read, so the answer is the same after a
// squash merge, a rebase or in a shallow CI clone.

/** The contract's reason codes, so the `check` result's `freshness` field can carry them verbatim. */
export type ArchitectureProjectionFreshnessReasonCode = ProjectionFreshnessReasonCode;

export interface ArchitectureProjectionFreshnessStaleNode {
  nodeId: string;
  /** The footprint digest this node's projected document is stamped with. */
  stampedDigest: string;
  /** The footprint digest measured now. */
  currentDigest: string;
}

export interface ArchitectureProjectionFreshnessEvaluation {
  schemaVersion: "archcontext.projection-freshness/v2";
  ok: boolean;
  reasonCodes: ArchitectureProjectionFreshnessReasonCode[];
  /** Names the trigger source so a consumer can tell this apart from a HEAD-snapshot mismatch. */
  detail: string;
  staleNodes: ArchitectureProjectionFreshnessStaleNode[];
}

/**
 * Repo-relative path patterns the projection itself writes: the architecture documentation tree
 * (including its manifest) and every agent-context contract file the model designates.
 *
 * Footprint digests subtract these. An agent-context target lands inside its own capability's
 * declared `source.include` footprint, so counting the projection's own output as capability
 * source would make every projection report the capability stale, which would demand another
 * projection producing the same bytes — a loop with no fixed point.
 *
 * Single point of truth: the stamp, the freshness gate and any consumer that needs to know "did
 * the projection write this?" derive it here, so they can never disagree.
 */
export function projectionOwnedPaths(model: NativeModel): string[] {
  return [
    "docs/architecture/**",
    ...agentContextProjectionTargetPaths(model).map((target) => target.path)
  ].sort((left, right) => left.localeCompare(right));
}

/**
 * Per-node projection stamps: for every node that declares `source.include`, the content digest of
 * the files it selects (the same include/exclude predicate `loadCapabilitySourceFootprints` feeds
 * the renderer) minus `projectionOwnedPaths`. Paths and bytes both enter the digest, so adding,
 * removing, renaming or editing a covered file moves it and nothing outside the footprint can.
 */
export function loadCapabilitySourceFootprintDigests(root: string, model: NativeModel): CapabilitySourceFootprintDigest[] {
  const ownedPathPatterns = projectionOwnedPaths(model);
  return loadCapabilitySourceFootprints(root, model).map((footprint) => {
    const files = footprint.files.filter((path) => !ownedPathPatterns.some((pattern) => matchesGlob(path, pattern)));
    return {
      nodeId: footprint.nodeId,
      fileCount: files.length,
      digest: digestJson({
        schemaVersion: "archcontext.capability-source-footprint/v1",
        files: files.map((path) => ({
          path,
          digest: sourceFileContentDigest(resolve(root, path))
        }))
      } as unknown as Json)
    };
  });
}

/**
 * Decides whether the architecture documentation projection is still verified against the current
 * tree: a node whose current footprint digest differs from the digest its document is stamped with
 * was rendered from code that has since moved.
 *
 * Every node that declares `source.include` is probed, including nodes whose globs overlap: an
 * ambiguous owner must not silently drop the signal. A node without a stamp, or with a stamp that
 * is not a footprint digest (a manifest written before content stamps), fails closed — re-running
 * the projection once migrates it.
 */
export function evaluateArchitectureProjectionFreshness(input: {
  model: NativeModel;
  /** Manifest readback; every raw stamp is validated here, never trusted. */
  manifest: ArchitectureProjectionManifestStampReadback;
  /** `loadCapabilitySourceFootprintDigests` for the same model, measured now. */
  sourceFootprints: CapabilitySourceFootprintDigest[];
}): ArchitectureProjectionFreshnessEvaluation {
  if (input.manifest.status === "manifest-missing") {
    return freshnessEvaluation(
      ["projection-manifest-missing"],
      ["docs/architecture/.projection-manifest.json is absent; nothing records what the projection was verified against"],
      []
    );
  }
  if (input.manifest.status === "manifest-unreadable") {
    return freshnessEvaluation(
      ["projection-manifest-unreadable"],
      [`projection manifest could not be read: ${input.manifest.reason}`],
      []
    );
  }

  const reasonCodes: ArchitectureProjectionFreshnessReasonCode[] = [];
  const details: string[] = [];
  const stampsByNodeId = new Map(input.manifest.nodes.map((entry) => [entry.nodeId, entry.sourceFootprintDigest]));
  const currentByNodeId = new Map(input.sourceFootprints.map((entry) => [entry.nodeId, entry.digest]));
  const staleNodes: ArchitectureProjectionFreshnessStaleNode[] = [];
  for (const node of [...input.model.nodes].sort((left, right) => left.id.localeCompare(right.id))) {
    if ((nativeNodeSource(node)?.include ?? []).length === 0) continue;
    const currentDigest = currentByNodeId.get(node.id);
    if (currentDigest === undefined) throw new Error(`architecture-projection-freshness-footprint-unmeasured: ${node.id}`);
    const stamp = stampsByNodeId.get(node.id);
    if (stamp === undefined || stamp === null) {
      reasonCodes.push("projection-source-stamp-missing");
      details.push(`projection manifest records no sourceFootprintDigest for ${node.id}; re-run the documentation projection`);
      continue;
    }
    if (typeof stamp !== "string" || !SOURCE_FOOTPRINT_DIGEST_PATTERN.test(stamp)) {
      reasonCodes.push("projection-source-stamp-invalid");
      details.push(`projection manifest sourceFootprintDigest for ${node.id} is not a footprint digest: ${JSON.stringify(stamp)}`);
      continue;
    }
    if (stamp !== currentDigest) staleNodes.push({ nodeId: node.id, stampedDigest: stamp, currentDigest });
  }
  if (staleNodes.length > 0) {
    reasonCodes.push("projection-source-changed-since-stamp");
    details.push(`${staleNodes.length} node(s) changed after their document was verified: ${staleNodes.map((entry) => entry.nodeId).join(", ")}`);
  }

  return freshnessEvaluation(
    [...new Set(reasonCodes)],
    details,
    staleNodes,
    "no declared capability source changed since its documentation was verified"
  );
}

/** Dirty-worktree freshness authority layered over the per-node footprint stamps. */
export function evaluateArchitectureProjectionSnapshotFreshness(input: {
  model: NativeModel;
  manifest: ArchitectureProjectionManifestStampReadback;
  sourceFootprints: CapabilitySourceFootprintDigest[];
  currentSourceTreeDigest: string;
}): ArchitectureProjectionFreshnessEvaluation {
  const nodeEvaluation = evaluateArchitectureProjectionFreshness(input);
  if (input.manifest.status !== "present" || !input.manifest.provenance) {
    return freshnessEvaluation(
      [...new Set([...nodeEvaluation.reasonCodes, "projection-snapshot-provenance-missing" as const])],
      [nodeEvaluation.detail, "projection manifest has no snapshot provenance"],
      nodeEvaluation.staleNodes
    );
  }
  if (input.manifest.provenance.sourceTreeDigest !== input.currentSourceTreeDigest) {
    return freshnessEvaluation(
      [...new Set([...nodeEvaluation.reasonCodes, "projection-source-tree-digest-mismatch" as const])],
      [nodeEvaluation.detail, "declared source tree digest differs from the accepted projection snapshot"],
      nodeEvaluation.staleNodes
    );
  }
  return nodeEvaluation;
}

function freshnessEvaluation(
  reasonCodes: ArchitectureProjectionFreshnessReasonCode[],
  details: string[],
  staleNodes: ArchitectureProjectionFreshnessStaleNode[],
  cleanDetail = "no projection freshness signal available"
): ArchitectureProjectionFreshnessEvaluation {
  return {
    schemaVersion: "archcontext.projection-freshness/v2",
    ok: reasonCodes.length === 0,
    reasonCodes,
    detail: details.length > 0 ? details.join("; ") : cleanDetail,
    staleNodes
  };
}

/** One entity-summary target's recorded stamp, as read back out of the projection manifest. */
export interface ArchitectureProjectionManifestNodeStamp {
  nodeId: string;
  /** Raw manifest value; validated by `evaluateArchitectureProjectionFreshness`, never trusted here. */
  sourceFootprintDigest: unknown;
}

export type ArchitectureProjectionManifestStampReadback =
  | { status: "manifest-missing" }
  | { status: "manifest-unreadable"; reason: string }
  | {
      status: "present";
      nodes: ArchitectureProjectionManifestNodeStamp[];
      provenance?: ArchitectureDocumentationProjectionProvenanceV2;
    };

/**
 * Reads the per-target `sourceFootprintDigest` stamps back out of the projection manifest, keyed by
 * the node each `entity-summary` target documents. A repository with no manifest has no projection
 * to keep fresh (`manifest-missing`); a manifest that cannot be parsed is reported, never treated
 * as a set of absent entries.
 */
export function loadArchitectureProjectionManifestStamps(
  root: string
): ArchitectureProjectionManifestStampReadback {
  const absolute = resolve(root, "docs/architecture/.projection-manifest.json");
  if (!existsSync(absolute)) return { status: "manifest-missing" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    return { status: "manifest-unreadable", reason: error instanceof Error ? error.message : String(error) };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "manifest-unreadable", reason: "projection manifest is not a JSON object" };
  }
  const targets = (parsed as Record<string, unknown>).targets;
  if (targets !== undefined && !Array.isArray(targets)) {
    return { status: "manifest-unreadable", reason: "projection manifest targets is not an array" };
  }
  const nodes: ArchitectureProjectionManifestNodeStamp[] = [];
  for (const entry of (targets ?? []) as unknown[]) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (record.type !== "entity-summary") continue;
    const scope = record.scope;
    const nodeId = scope && typeof scope === "object" && !Array.isArray(scope)
      ? (scope as Record<string, unknown>).id
      : undefined;
    if (typeof nodeId !== "string" || nodeId === "") continue;
    nodes.push({ nodeId, sourceFootprintDigest: record.sourceFootprintDigest });
  }
  const provenance = (parsed as Record<string, unknown>).provenance;
  return {
    status: "present",
    nodes,
    ...(provenance && typeof provenance === "object" && !Array.isArray(provenance)
      ? { provenance: provenance as unknown as ArchitectureDocumentationProjectionProvenanceV2 }
      : {})
  };
}

export function normalizeNativeModel(model: NativeModel): NativeModel {
  return {
    nodes: [...model.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    relations: [...model.relations].sort((a, b) => a.id.localeCompare(b.id)),
    flows: [...(model.flows ?? [])].sort((a, b) => a.id.localeCompare(b.id))
  };
}

export function exportMermaidModel(model: NativeModel): ModelExportResult {
  const normalized = normalizeNativeModel(model);
  const lines = ["%% Generated by ArchContext. Native model remains source of truth.", "flowchart LR"];
  for (const node of normalized.nodes) {
    lines.push(`  ${mermaidId(node.id)}["${escapeMermaid(node.name)}"]`);
  }
  for (const relation of normalized.relations) {
    lines.push(`  ${mermaidId(relation.source)} -->|"${escapeMermaid(relation.kind)}"| ${mermaidId(relation.target)}`);
  }
  const content = `${lines.join("\n")}\n`;
  return {
    format: "mermaid",
    digest: digestJson({ format: "mermaid", content } as unknown as Json),
    files: [{ path: ".archcontext/generated/architecture.mmd", content }]
  };
}

export function exportDocumentationLikeC4Model(model: NativeModel): ModelExportResult {
  const normalized = normalizeNativeModel(model);
  const lines = [
    "// Generated by ArchContext. Native model remains source of truth.",
    "specification {",
    "  element capability",
    "  element module",
    "  element component",
    "  element interface",
    "  element datastore",
    "  element external_system",
    "}",
    "",
    "model {"
  ];
  for (const node of normalized.nodes) lines.push(`  ${mermaidId(node.id)} = ${documentationLikeC4Kind(node.kind)} "${escapeDsl(node.name)}"`);
  for (const relation of normalized.relations) lines.push(`  ${mermaidId(relation.source)} -> ${mermaidId(relation.target)} "${escapeDsl(relation.kind)}"`);
  lines.push("}", "", "views {", "  view index {", "    include *", "    autoLayout TopBottom", "  }", "}");
  const content = `${lines.join("\n")}\n`;
  return {
    format: "likec4",
    digest: digestJson({ format: "likec4", content } as unknown as Json),
    files: [{ path: "docs/architecture/diagrams/architecture.likec4", content }]
  };
}

export function exportDocumentationStructurizrWorkspace(model: NativeModel): ModelExportResult {
  const normalized = normalizeNativeModel(model);
  const workspace = {
    schemaVersion: "archcontext.structurizr-export/v1",
    name: "ArchContext Architecture",
    model: {
      elements: normalized.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        type: documentationStructurizrElementType(node.kind),
        tags: [node.kind]
      })),
      relationships: normalized.relations.map((relation) => ({
        id: relation.id,
        sourceId: relation.source,
        destinationId: relation.target,
        description: relation.kind
      }))
    },
    views: {
      systemLandscape: {
        key: "archcontext-landscape",
        include: normalized.nodes.map((node) => node.id)
      }
    }
  };
  const content = `${JSON.stringify(workspace, null, 2)}\n`;
  return {
    format: "structurizr",
    digest: digestJson(workspace as unknown as Json),
    files: [{ path: "docs/architecture/diagrams/architecture.structurizr.json", content }]
  };
}

export function loadNativeModelFromArchContext(root: string): NativeModel {
  return nativeModelFromYamlObjects({
    nodes: readYamlObjects(resolve(root, ".archcontext/model/nodes")),
    relations: readYamlObjects(resolve(root, ".archcontext/model/relations")),
    flows: readYamlObjects(resolve(root, ".archcontext/model/flows"))
  });
}

/**
 * The same model `loadNativeModelFromArchContext` builds, from bytes the caller already read: keys
 * are repo-relative paths, and only direct YAML children of the model directories count. Lets a
 * caller hash and parse one snapshot instead of re-reading the tree between the two.
 */
export function loadNativeModelFromModelFiles(files: ReadonlyMap<string, string>): NativeModel {
  const objects = (directory: "nodes" | "relations" | "flows") => [...files.entries()]
    .map(([path, body]) => ({ path, body, name: path.slice(`.archcontext/model/${directory}/`.length) }))
    .filter((file) => file.path.startsWith(`.archcontext/model/${directory}/`) && !file.name.includes("/") && /\.ya?ml$/.test(file.name))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    .map((file) => parseJsonOrStableYaml(file.body, file.path) as Record<string, Json>);
  return nativeModelFromYamlObjects({ nodes: objects("nodes"), relations: objects("relations"), flows: objects("flows") });
}

function nativeModelFromYamlObjects(input: { nodes: Record<string, Json>[]; relations: Record<string, Json>[]; flows: Record<string, Json>[] }): NativeModel {
  const nodes = input.nodes as NativeNode[];
  for (const node of nodes) {
    if (node.schemaVersion !== "archcontext.node/v2") {
      throw new Error(`architecture-node-schema-version-unsupported: ${node.id || "unknown"} (${String(node.schemaVersion)})`);
    }
    assertArchitectureNodeSourceV2(node);
  }
  const flows = input.flows;
  for (const flow of flows) assertArchitectureFlowV1(flow);
  return {
    nodes,
    relations: input.relations as unknown as NativeRelation[],
    flows: flows as unknown as ArchitectureFlowV1[]
  };
}

function assertArchitectureNodeSourceV2(node: NativeNode): void {
  if (node.source === undefined) return;
  const source = architectureRecord(node.source, `architecture-node-source-invalid: ${node.id}`);
  architectureExactKeys(source, ["include", "exclude", "entrypoints"], `architecture-node-source-invalid: ${node.id}`);
  for (const key of ["include", "exclude"] as const) {
    if (source[key] !== undefined) architectureStringArray(source[key], `architecture-node-source-invalid: ${node.id}.${key}`);
  }
  if (source.entrypoints === undefined) return;
  const entrypoints = architectureArray(source.entrypoints, `architecture-node-source-invalid: ${node.id}.entrypoints`);
  for (const [entrypointIndex, value] of entrypoints.entries()) {
    const entrypoint = architectureRecord(value, `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}]`);
    architectureExactKeys(entrypoint, ["id", "path", "symbols"], `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}]`);
    architectureNonEmptyString(entrypoint.id, `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].id`);
    architectureNonEmptyString(entrypoint.path, `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].path`);
    const symbols = architectureArray(entrypoint.symbols, `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].symbols`, true);
    for (const [symbolIndex, symbolValue] of symbols.entries()) {
      const symbol = architectureRecord(symbolValue, `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].symbols[${symbolIndex}]`);
      architectureExactKeys(symbol, ["name", "sinks"], `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].symbols[${symbolIndex}]`);
      architectureNonEmptyString(symbol.name, `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].symbols[${symbolIndex}].name`);
      const sinks = architectureArray(symbol.sinks, `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].symbols[${symbolIndex}].sinks`, true);
      for (const [sinkIndex, sinkValue] of sinks.entries()) {
        const sink = architectureRecord(sinkValue, `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].symbols[${symbolIndex}].sinks[${sinkIndex}]`);
        architectureExactKeys(sink, ["id", "path", "symbol"], `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].symbols[${symbolIndex}].sinks[${sinkIndex}]`);
        for (const key of ["id", "path", "symbol"] as const) {
          architectureNonEmptyString(sink[key], `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].symbols[${symbolIndex}].sinks[${sinkIndex}].${key}`);
        }
      }
    }
  }
}

function assertArchitectureFlowV1(value: Record<string, Json>): void {
  const flow = architectureRecord(value, "architecture-flow-invalid");
  if (flow.schemaVersion !== "archcontext.flow/v1") {
    throw new Error(`architecture-flow-schema-version-unsupported: ${String(flow.id ?? "unknown")} (${String(flow.schemaVersion)})`);
  }
  for (const key of ["id", "capabilityId", "name", "applicability"] as const) {
    architectureNonEmptyString(flow[key], `architecture-flow-invalid: ${String(flow.id ?? "unknown")}.${key}`);
  }
  const flowId = String(flow.id);
  if (flow.applicability === "not-applicable") {
    architectureExactKeys(flow, ["schemaVersion", "id", "capabilityId", "name", "applicability", "rationale"], `architecture-flow-invalid: ${flowId}`);
    architectureNonEmptyString(flow.rationale, `architecture-flow-invalid: ${flowId}.rationale`);
    return;
  }
  if (flow.applicability !== "required") throw new Error(`architecture-flow-invalid: ${flowId}.applicability`);
  architectureExactKeys(flow, ["schemaVersion", "id", "capabilityId", "name", "applicability", "participants", "steps", "outcomes"], `architecture-flow-invalid: ${flowId}`);
  const participants = architectureArray(flow.participants, `architecture-flow-invalid: ${flowId}.participants`, true);
  for (const [index, participantValue] of participants.entries()) {
    const participant = architectureRecord(participantValue, `architecture-flow-invalid: ${flowId}.participants[${index}]`);
    architectureExactKeys(participant, ["id", "nodeId"], `architecture-flow-invalid: ${flowId}.participants[${index}]`);
    architectureNonEmptyString(participant.id, `architecture-flow-invalid: ${flowId}.participants[${index}].id`);
    architectureNonEmptyString(participant.nodeId, `architecture-flow-invalid: ${flowId}.participants[${index}].nodeId`);
  }
  const steps = architectureArray(flow.steps, `architecture-flow-invalid: ${flowId}.steps`, true);
  steps.forEach((step, index) => assertArchitectureFlowStep(step, `${flowId}.steps[${index}]`));
  const outcomes = architectureArray(flow.outcomes, `architecture-flow-invalid: ${flowId}.outcomes`, true);
  if (!outcomes.some((value) => architectureRecord(value, `architecture-flow-invalid: ${flowId}.outcomes`).kind === "success")
    || !outcomes.some((value) => architectureRecord(value, `architecture-flow-invalid: ${flowId}.outcomes`).kind === "error")) {
    throw new Error(`architecture-flow-invalid: ${flowId}.outcomes requires success and error`);
  }
  for (const [index, outcomeValue] of outcomes.entries()) {
    const outcome = architectureRecord(outcomeValue, `architecture-flow-invalid: ${flowId}.outcomes[${index}]`);
    architectureExactKeys(outcome, ["id", "kind", "label", "steps", "terminal"], `architecture-flow-invalid: ${flowId}.outcomes[${index}]`);
    architectureNonEmptyString(outcome.id, `architecture-flow-invalid: ${flowId}.outcomes[${index}].id`);
    architectureNonEmptyString(outcome.label, `architecture-flow-invalid: ${flowId}.outcomes[${index}].label`);
    if (outcome.kind !== "success" && outcome.kind !== "error") throw new Error(`architecture-flow-invalid: ${flowId}.outcomes[${index}].kind`);
    architectureArray(outcome.steps, `architecture-flow-invalid: ${flowId}.outcomes[${index}].steps`, true)
      .forEach((step, stepIndex) => assertArchitectureFlowStep(step, `${flowId}.outcomes[${index}].steps[${stepIndex}]`));
    const terminal = architectureRecord(outcome.terminal, `architecture-flow-invalid: ${flowId}.outcomes[${index}].terminal`);
    architectureExactKeys(terminal, ["participant", "label"], `architecture-flow-invalid: ${flowId}.outcomes[${index}].terminal`);
    architectureNonEmptyString(terminal.participant, `architecture-flow-invalid: ${flowId}.outcomes[${index}].terminal.participant`);
    architectureNonEmptyString(terminal.label, `architecture-flow-invalid: ${flowId}.outcomes[${index}].terminal.label`);
  }
}

function assertArchitectureFlowStep(value: unknown, path: string): void {
  const step = architectureRecord(value, `architecture-flow-invalid: ${path}`);
  architectureExactKeys(step, ["id", "from", "to", "label", "evidence"], `architecture-flow-invalid: ${path}`);
  for (const key of ["id", "from", "to", "label"] as const) architectureNonEmptyString(step[key], `architecture-flow-invalid: ${path}.${key}`);
  const evidence = architectureRecord(step.evidence, `architecture-flow-invalid: ${path}.evidence`);
  architectureExactKeys(evidence, ["entrypointId", "sourceSymbol", "sinkId"], `architecture-flow-invalid: ${path}.evidence`);
  for (const key of ["entrypointId", "sourceSymbol", "sinkId"] as const) architectureNonEmptyString(evidence[key], `architecture-flow-invalid: ${path}.evidence.${key}`);
}

function architectureRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function architectureArray(value: unknown, message: string, nonEmpty = false): unknown[] {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) throw new Error(message);
  return value;
}

function architectureStringArray(value: unknown, message: string): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new Error(message);
}

function architectureNonEmptyString(value: unknown, message: string): void {
  if (typeof value !== "string" || value.length === 0) throw new Error(message);
}

function architectureExactKeys(value: Record<string, unknown>, allowed: string[], message: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${message}.unknown-field:${unknown.sort().join(",")}`);
}

export function mermaidId(id: string): string {
  return stableId(id).replace(/-/g, "_").replace(/\./g, "_");
}

function readYamlObjects(dir: string): Record<string, Json>[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort()
    .map((file) => {
      const path = resolve(dir, file);
      return parseJsonOrStableYaml(readFileSync(path, "utf8"), path) as Record<string, Json>;
    });
}

function escapeMermaid(value: string): string {
  return value.replace(/"/g, "'");
}

interface ProjectionTargetDraft extends ProjectionLayoutTargetDraft {
  /**
   * Human-owned scaffold written only when the target file does not exist yet. The projection
   * never rewrites it afterwards: the title and the §3/§4/Backlog headings live outside the
   * generated region, so every later projection splices the region and leaves them untouched.
   */
  skeleton?: { prefix: string; suffix: string };
}

function architectureDocumentationTargetDrafts(model: NativeModel, layout: ArchitectureDocumentationLayout): ProjectionTargetDraft[] {
  return layout.targets.map((target) => target.type === "entity-summary"
    ? { ...target, skeleton: entitySummarySkeleton(model.nodes.find((node) => node.id === target.scope.id)!) }
    : target);
}

function projectionTarget(input: ProjectionTargetDraft & {
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  sourceDigest: string;
  outputDigest: string;
}): ProjectionTargetV1 {
  return {
    schemaVersion: PROJECTION_TARGET_SCHEMA_VERSION,
    targetId: input.targetId,
    type: input.type,
    scope: input.scope,
    path: input.path,
    ownership: input.ownership,
    generatedRegion: {
      startMarker: generatedStartMarker(input.targetId, input.sourceDigest, input.rendererVersion, input.outputDigest),
      endMarker: generatedEndMarker(input.targetId)
    },
    rendererVersion: input.rendererVersion,
    format: input.format,
    sourceDigest: input.sourceDigest,
    outputDigest: input.outputDigest
  };
}

function renderTargetGeneratedBody(
  target: ProjectionTargetDraft,
  model: NativeModel,
  input: {
    generatedAt: string;
    scaleSignalsByNodeId: Map<string, CapabilitySourceScaleSignal>;
    semanticCompilationsByNodeId: Map<string, SemanticCapabilityDiagramCompilation>;
    decisions: ArchitectureDecisionRecord[];
    timeline: ArchitectureDocumentationTimelineEntry[];
    layout: ArchitectureDocumentationLayout;
  }
): string {
  if (target.type === "architecture-index") return renderArchitectureIndex(model, input.generatedAt, input.layout);
  if (target.type === "entity-summary") {
    const node = model.nodes.find((entry) => entry.id === target.scope.id)!;
    return renderEntitySummary(node, model, {
      scaleSignal: input.scaleSignalsByNodeId.get(node.id),
      semanticCompilation: input.semanticCompilationsByNodeId.get(node.id)!
    });
  }
  if (target.type === "relation-summary") return renderRelationSummary(model.relations.find((relation) => relation.id === target.scope.id)!, model);
  if (target.type === "decision-index") return renderDecisionIndex(input.decisions, target.path);
  if (target.type === "architecture-changelog") return renderArchitectureChangelog(input.timeline);
  if (target.type === "diagram-mermaid") return exportMermaidModel(model).files[0].content;
  if (target.type === "diagram-structurizr") return exportDocumentationStructurizrWorkspace(model).files[0].content;
  if (target.type === "diagram-likec4") return exportDocumentationLikeC4Model(model).files[0].content;
  return "";
}

function renderArchitectureIndex(model: NativeModel, generatedAt: string, layout: ArchitectureDocumentationLayout): string {
  const lines = [
    "# Architecture Index",
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Entities",
    "",
    ...model.nodes.filter((node) => layout.entityPathByNodeId.has(node.id)).map((node) => {
      const path = layout.entityPathByNodeId.get(node.id);
      if (!path) throw new Error(`projection-layout-entity-target-missing: ${node.id}`);
      return `- [${node.name}](${path.replace(/^docs\/architecture\//, "")}) — ${node.kind}${node.status ? ` / ${node.status}` : ""}`;
    }),
    ...(layout.entityPathByNodeId.size === 0 ? ["- No architecture entities recorded."] : []),
    "",
    "## Relations",
    "",
    ...model.relations.map((relation) => layout.profile === REPO_HARNESS_PROJECTION_PROFILE
      ? `- ${relation.source} -> ${relation.target} — ${relation.kind}`
      : `- [${relation.source} -> ${relation.target}](relations/${pathSegment(relation.id)}.md) — ${relation.kind}`),
    ...(model.relations.length === 0 ? ["- No architecture relations recorded."] : []),
    "",
    "## Projections",
    "",
    "- [Mermaid](diagrams/architecture.mmd)",
    "- [Structurizr JSON](diagrams/architecture.structurizr.json)",
    "- [LikeC4](diagrams/architecture.likec4)",
    "- [Decision index](decisions/index.md)",
    "- [Architecture changelog](changelog.md)"
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Machine-owned region of a capability module document: the intro block plus `## 1` and the
 * `## 2` structural slot. Everything the renderer cannot derive from the model or the measured
 * scale signal is printed as an explicit "not derivable" note — never as an empty diagram fence, a
 * synthesised edge, or an invented line anchor.
 *
 * Nothing here is a function of the repository ref. Every value printed is derived from the
 * architecture model or from a measurement bucketed coarsely enough that ordinary edits under the
 * node's footprint do not move it, so a diff on this document means an architecture assertion
 * changed. Provenance (the source-footprint stamp) lives in the projection manifest for exactly this reason.
 */
function renderEntitySummary(
  node: NativeNode,
  model: NativeModel,
  input: {
    scaleSignal?: CapabilitySourceScaleSignal;
    semanticCompilation: SemanticCapabilityDiagramCompilation;
  }
): string {
  const source = nativeNodeSource(node);
  const include = source?.include ?? [];
  const entrypoints = source?.entrypoints ?? [];
  if (include.length > 0 && !input.scaleSignal) {
    throw new Error(`architecture-docs-projection-scale-signal-missing: ${node.id}`);
  }
  const incoming = model.relations.filter((relation) => relation.target === node.id);
  const outgoing = model.relations.filter((relation) => relation.source === node.id);
  const localContracts = contractFilesForNode(node);
  const lines = [
    `> **狀態**:${node.status ? `\`${node.status}\`` : "未宣告(`status` 缺失)"}`,
    `> **Capability ID**:\`${node.id}\`(kind \`${node.kind}\`)`,
    `> **Matched Prefixes**:${include.length > 0 ? include.map((pattern) => `\`${pattern}\``).join("、") : "未宣告(`source.include` 缺失)"}`,
    `> **Local Contracts**:${localContracts.length > 0 ? localContracts.map((entry) => `\`${entry}\``).join("、") : "未宣告(`extensions.localContracts` 缺失)"}`,
    "> **事實優先級**:倉庫當前狀態 > 本文檔機器區 > 本文檔人工區。機器區(引言、§1、§2)由 ArchContext 從架構模型與源碼度量投影生成,手改會在下次投影被覆蓋。本文檔不記錄出處;本次投影所驗證的 commit 見 `docs/architecture/.projection-manifest.json`。",
    ...(node.summary ? ["", node.summary] : []),
    "",
    "## 1. P1:能力架構地圖",
    "",
    "### 1.1 架構圖",
    "",
    ...renderSemanticP1Section(input.semanticCompilation),
    "",
    "### 1.2 模組職責表",
    "",
    ...(entrypoints.length > 0
      ? [
        "| 宣告入口 | 錨點 | 職責 |",
        "| --- | --- | --- |",
        ...entrypoints.flatMap((entry) => entry.symbols.map((symbol) =>
          `| \`${entry.id}\` | \`${entry.path}#${symbol.name}\` | ${symbol.sinks.map((sink) => `\`${sink.id}\` → \`${sink.path}#${sink.symbol}\``).join("、")} |`
        ))
      ]
      : ["- 未宣告 `source.entrypoints`,入口清單無法從架構模型推導。"]),
    "",
    "### 1.3 規模信號",
    "",
    ...(input.scaleSignal
      ? [
        `- 規模量級:\`${scaleMagnitudeBucketLabel(input.scaleSignal.fileCount)}\` 個文件 / \`${scaleMagnitudeBucketLabel(input.scaleSignal.lineCount)}\` 行`,
        `- 匹配前綴:${input.scaleSignal.includePatterns.map((pattern) => `\`${pattern}\``).join("、")}`,
        ...(input.scaleSignal.excludePatterns.length > 0
          ? [`- 排除前綴:${input.scaleSignal.excludePatterns.map((pattern) => `\`${pattern}\``).join("、")}`]
          : []),
        "- 推導:掃描 `source.include` 減 `source.exclude`,跳過 `.git/` 與 `node_modules/`,再按 1–2–5 階梯分桶。精確計數不入本文檔:量級足以回答「這個能力有多大」,而逐行計數會讓覆蓋範圍內任何一次源碼改動都改寫本文檔。"
      ]
      : ["- 未宣告 `source.include`,規模信號無法推導。"]),
    "",
    "### 1.4 依賴邊界",
    "",
    "出向關係:",
    "",
    ...(outgoing.length === 0 ? ["- 無。"] : outgoing.map((relation) => `- \`${relation.kind}\` → \`${relation.target}\` — ${relation.intent}`)),
    "",
    "入向關係:",
    "",
    ...(incoming.length === 0 ? ["- 無。"] : incoming.map((relation) => `- \`${relation.kind}\` ← \`${relation.source}\` — ${relation.intent}`)),
    "",
    "## 2. P2:端到端數據流",
    "",
    ...renderSemanticP2Section(input.semanticCompilation)
  ];
  return `${lines.join("\n")}\n`;
}

function renderSemanticP1Section(compilation: SemanticCapabilityDiagramCompilation): string[] {
  if (compilation.p1.status === "proven") {
    return [
      compilation.p1.mermaid!,
      "",
      `- Proof: \`proven\` (\`${compilation.proofDigest}\`).`,
      `- Semantic nodes: \`${compilation.p1.nodes.length}\`; declared relations: \`${compilation.p1.edges.length}\`.`
    ];
  }
  return [
    "> **human-action-required**: P1 semantic authority is unprovable; no diagram was generated.",
    ...compilation.p1.diagnostics.map((diagnostic) => `- \`${diagnostic.code}\`: ${renderDiagnosticDetail(diagnostic.detail)}`)
  ];
}

function renderSemanticP2Section(compilation: SemanticCapabilityDiagramCompilation): string[] {
  if (compilation.p2.status === "proven") {
    return [
      `> **Proof**: \`proven\` (\`${compilation.proofDigest}\`); selectors \`${compilation.evidenceCoverage.provenSelectors}/${compilation.evidenceCoverage.requiredSelectors}\`.`,
      "",
      ...compilation.p2.mermaid.flatMap((diagram, index) => [
        ...(index === 0 ? [] : [""]),
        diagram
      ])
    ];
  }
  if (compilation.p2.status === "not-applicable") {
    return [`> **not-applicable**: ${compilation.p2.rationale}`];
  }
  return [
    "> **human-action-required**: P2 flow evidence is unprovable; no sequence diagram was generated.",
    ...compilation.p2.diagnostics.map((diagnostic) => `- \`${diagnostic.code}\`: ${renderDiagnosticDetail(diagnostic.detail)}`)
  ];
}

function renderDiagnosticDetail(detail: string): string {
  return detail.replaceAll("\0", " :: ");
}

/**
 * Handoff title form `<domain>/<name>`: the node id with its `capability.` prefix dropped and the
 * remaining dotted segments joined by `/`. A single remaining segment is used on its own. The id is
 * used rather than `node.name` because the title is the document's stable address, and ids are the
 * only part of the model guaranteed to be unique and path-shaped.
 */
function entitySummaryTitle(node: NativeNode): string {
  const segments = node.id.replace(/^capability\./, "").split(".").filter((segment) => segment !== "");
  return segments.length > 0 ? segments.join("/") : node.id;
}

function entitySummarySkeleton(node: NativeNode): { prefix: string; suffix: string } {
  return {
    prefix: `# ${entitySummaryTitle(node)} 架構文檔\n\n`,
    suffix: [
      "",
      "## 3. P3:設計決策與不變量",
      "",
      "## 4. 歷史決策記錄(append-only)",
      "",
      "## Optimization Backlog",
      ""
    ].join("\n")
  };
}

function renderRelationSummary(relation: NativeRelation, model: NativeModel): string {
  const source = model.nodes.find((node) => node.id === relation.source);
  const target = model.nodes.find((node) => node.id === relation.target);
  const lines = [
    `# ${relation.source} -> ${relation.target}`,
    "",
    `- ID: \`${relation.id}\``,
    `- Kind: \`${relation.kind}\``,
    `- Source: \`${relation.source}\`${source ? ` (${source.name})` : ""}`,
    `- Target: \`${relation.target}\`${target ? ` (${target.name})` : ""}`,
    `- Intent: ${relation.intent}`
  ];
  return `${lines.join("\n")}\n`;
}

function renderDecisionIndex(decisions: ArchitectureDecisionRecord[], indexPath: string): string {
  const lines = [
    "# Architecture Decision Index",
    "",
    ...(decisions.length === 0
      ? ["- No ADRs selected for this projection."]
      : decisions.map((decision) => `- [${decision.title}](${posix.relative(posix.dirname(indexPath), decision.path)})${decision.status ? ` — ${decision.status}` : ""}`))
  ];
  return `${lines.join("\n")}\n`;
}

function renderArchitectureChangelog(timeline: ArchitectureDocumentationTimelineEntry[]): string {
  const lines = [
    "# Architecture Changelog",
    "",
    ...(timeline.length === 0
      ? ["- No accepted architecture ledger events selected for this projection."]
      : timeline.map((entry) => {
        const affected = entry.affectedSubjects && entry.affectedSubjects.length > 0 ? ` (${entry.affectedSubjects.join(", ")})` : "";
        return `- ${entry.timestamp} — ${entry.title ?? entry.eventId}${affected}${entry.summary ? `: ${entry.summary}` : ""}`;
      }))
  ];
  return `${lines.join("\n")}\n`;
}

function wrapGeneratedRegion(target: ProjectionTargetV1, generatedBody: string): string {
  return [
    target.generatedRegion.startMarker,
    generatedBody.trimEnd(),
    target.generatedRegion.endMarker,
    ""
  ].join("\n");
}

function mergeGeneratedRegion(
  target: ProjectionTargetV1,
  wrapped: string,
  existing?: string,
  skeleton?: { prefix: string; suffix: string }
): string {
  if (!existing) return skeleton ? `${skeleton.prefix}${wrapped}${skeleton.suffix}` : wrapped;
  const region = findGeneratedRegion(existing, target.targetId);
  if (!region) {
    if (target.ownership === "mixed") {
      return `${existing.trimEnd()}\n\n${wrapped}`;
    }
    return wrapped;
  }
  return `${existing.slice(0, region.start)}${wrapped}${existing.slice(region.end)}`;
}

/**
 * Renderers that predate `semanticBaseline.evidence` (e.g. a pinned published archctx) write a
 * manifest without it, and the two renderers would otherwise re-stamp each other forever. Only
 * this staleness check tolerates the absent key: every other field, and any present evidence
 * value, still compares exactly. Acceptance reads the manifest separately and keeps refusing
 * proof-only changes against an evidence-less baseline.
 */
function comparableExpectedManifestDigest(expected: ArchitectureDocumentationExistingFile & { digest: string }, actual: Json): string {
  const baseline = actual && typeof actual === "object" && !Array.isArray(actual) ? actual.semanticBaseline : undefined;
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline) || "evidence" in baseline) return expected.digest;
  const value = JSON.parse(expected.body) as { semanticBaseline: Record<string, Json> };
  const { evidence: _evidence, ...semanticBaseline } = value.semanticBaseline;
  return digestJson({ ...value, semanticBaseline } as unknown as Json);
}

function architectureDocumentationProjectionDrift(input: {
  targets: ProjectionTargetV1[];
  expectedFiles: ArchitectureDocumentationProjectionFile[];
  expectedManifest: ArchitectureDocumentationExistingFile & { digest: string };
  existingFiles: ArchitectureDocumentationExistingFile[];
}): { ok: boolean; reasonCodes: ArchitectureDocumentationDriftReason[]; diffs: ArchitectureDocumentationProjectionDrift[] } {
  const existingByPath = new Map(input.existingFiles.map((file) => [file.path, file]));
  const expectedByPath = new Map(input.expectedFiles.map((file) => [file.path, file]));
  const targetIds = new Set(input.targets.map((target) => target.targetId));
  const diffs: ArchitectureDocumentationProjectionDrift[] = [];

  const existingManifest = existingByPath.get(input.expectedManifest.path);
  if (!existingManifest) {
    diffs.push({
      path: input.expectedManifest.path,
      reasonCode: "projection-manifest-missing",
      expectedDigest: input.expectedManifest.digest
    });
  } else {
    try {
      const parsed = JSON.parse(existingManifest.body) as Json;
      const actualDigest = digestJson(parsed);
      if (actualDigest !== comparableExpectedManifestDigest(input.expectedManifest, parsed)) {
        diffs.push({
          path: input.expectedManifest.path,
          reasonCode: "projection-manifest-stale",
          expectedDigest: input.expectedManifest.digest,
          actualDigest
        });
      }
    } catch {
      diffs.push({
        path: input.expectedManifest.path,
        reasonCode: "projection-manifest-invalid",
        expectedDigest: input.expectedManifest.digest,
        actualDigest: digestJson({ path: existingManifest.path, body: existingManifest.body } as unknown as Json)
      });
    }
  }

  for (const expected of input.expectedFiles) {
    const existing = existingByPath.get(expected.path);
    if (!existing) {
      diffs.push({ path: expected.path, targetId: expected.target.targetId, reasonCode: "projection-file-missing", expectedDigest: expected.digest });
      continue;
    }
    const region = findGeneratedRegion(existing.body, expected.target.targetId);
    if (!region) {
      diffs.push({
        path: expected.path,
        targetId: expected.target.targetId,
        reasonCode: expected.target.ownership === "generated" ? "projection-ambiguous-ownership" : "projection-adoption-required",
        expectedDigest: expected.digest,
        actualDigest: digestJson({ path: existing.path, body: existing.body } as unknown as Json)
      });
      continue;
    }
    const metadata = parseGeneratedRegionMetadata(region.startMarker);
    if (metadata.sourceDigest !== expected.target.sourceDigest || metadata.rendererVersion !== expected.target.rendererVersion) {
      diffs.push({ path: expected.path, targetId: expected.target.targetId, reasonCode: "projection-generated-region-stale", expectedDigest: expected.digest, actualDigest: digestJson({ path: existing.path, body: existing.body } as unknown as Json) });
      continue;
    }
    const actualGeneratedBodyDigest = digestJson({
      targetId: expected.target.targetId,
      body: `${region.body.trimEnd()}\n`
    } as unknown as Json);
    if (actualGeneratedBodyDigest !== metadata.outputDigest) {
      // The region body no longer digests to what its own marker records: someone edited machine text.
      diffs.push({
        path: expected.path,
        targetId: expected.target.targetId,
        reasonCode: "projection-generated-region-manually-edited",
        expectedDigest: expected.generatedBodyDigest,
        actualDigest: actualGeneratedBodyDigest
      });
      continue;
    }
    if (metadata.outputDigest !== expected.generatedBodyDigest) {
      // Internally consistent, but not what this run renders. Entity targets key their marker on
      // the canonical body digest, so a moved body input (status flip, summary edit, re-measured
      // footprint) is already caught by the sourceDigest check above; what survives to here is a
      // region whose inputs match but whose stamp decision moved the body. Either way this is a
      // document awaiting re-verification, a stale projection, not a hand edit.
      diffs.push({
        path: expected.path,
        targetId: expected.target.targetId,
        reasonCode: "projection-generated-region-stale",
        expectedDigest: expected.generatedBodyDigest,
        actualDigest: actualGeneratedBodyDigest
      });
    }
  }

  for (const existing of input.existingFiles) {
    if (existing.path === input.expectedManifest.path) continue;
    if (!isManagedArchitectureDocumentationPath(existing.path) || expectedByPath.has(existing.path)) continue;
    const region = findAnyGeneratedRegion(existing.body);
    if (region && !targetIds.has(region.targetId)) {
      diffs.push({
        path: existing.path,
        targetId: region.targetId,
        reasonCode: "projection-orphaned",
        actualDigest: digestJson({ path: existing.path, body: existing.body } as unknown as Json)
      });
    }
  }

  const reasonCodes = [...new Set(diffs.map((diff) => diff.reasonCode))].sort() as ArchitectureDocumentationDriftReason[];
  return { ok: diffs.length === 0, reasonCodes, diffs: diffs.sort((left, right) => left.path.localeCompare(right.path) || (left.targetId ?? "").localeCompare(right.targetId ?? "")) };
}

function findGeneratedRegion(body: string, targetId: string): { start: number; end: number; startMarker: string; body: string } | undefined {
  const startPattern = new RegExp(`<!-- BEGIN ARCHCONTEXT:generated target="${escapeRegExp(targetId)}"[^>]*-->`);
  const startMatch = startPattern.exec(body);
  if (!startMatch || startMatch.index === undefined) return undefined;
  const endMarker = generatedEndMarker(targetId);
  const endIndex = body.indexOf(endMarker, startMatch.index + startMatch[0].length);
  if (endIndex < 0) return undefined;
  const regionStart = startMatch.index;
  const regionEnd = endIndex + endMarker.length + (body[endIndex + endMarker.length] === "\n" ? 1 : 0);
  const generatedBody = body.slice(startMatch.index + startMatch[0].length, endIndex).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  return { start: regionStart, end: regionEnd, startMarker: startMatch[0], body: generatedBody };
}

function findAnyGeneratedRegion(body: string): { targetId: string } | undefined {
  const match = body.match(/<!-- BEGIN ARCHCONTEXT:generated target="([^"]+)"/);
  return match ? { targetId: match[1] } : undefined;
}

function parseGeneratedRegionMetadata(marker: string): {
  sourceDigest?: string;
  rendererVersion?: string;
  outputDigest?: string;
} {
  return {
    sourceDigest: marker.match(/sourceDigest="([^"]+)"/)?.[1],
    rendererVersion: marker.match(/rendererVersion="([^"]+)"/)?.[1],
    outputDigest: marker.match(/outputDigest="([^"]+)"/)?.[1]
  };
}

/**
 * Marker attributes are limited to what identifies the region and what a reader can verify against
 * the body in front of them. The source-footprint stamp is deliberately absent: a marker that
 * carried it would rewrite the document every time the code under the node's footprint moved. The
 * stamp of record is the projection manifest.
 */
function generatedStartMarker(
  targetId: string,
  sourceDigest: string,
  rendererVersion: string,
  outputDigest: string
): string {
  return `${ARCHITECTURE_DOCS_GENERATED_BEGIN_PREFIX} target="${targetId}" sourceDigest="${sourceDigest}" rendererVersion="${rendererVersion}" outputDigest="${outputDigest}" -->`;
}

function generatedEndMarker(targetId: string): string {
  return `${ARCHITECTURE_DOCS_GENERATED_END_PREFIX} target="${targetId}" -->`;
}

function isManagedArchitectureDocumentationPath(path: string): boolean {
  return /^docs\/architecture\/(modules|relations)\/.+\.md$/.test(path)
    || /^docs\/architecture\/diagrams\/architecture\.(mmd|likec4|structurizr\.json)$/.test(path)
    || path === "docs/architecture/index.md"
    || path === "docs/architecture/changelog.md"
    || path === "docs/architecture/decisions/index.md"
    || path === "docs/architecture/.projection-manifest.json";
}

function pathSegment(id: string): string {
  return stableId(id).replace(/\./g, "-");
}

function documentationLikeC4Kind(kind: string): string {
  if (kind === "external-system") return "external_system";
  if (kind === "datastore") return "datastore";
  if (["capability", "module", "component", "interface"].includes(kind)) return kind;
  return "component";
}

function documentationStructurizrElementType(kind: string): "Software System" | "Container" | "Component" | "Database" | "External System" {
  if (kind === "capability") return "Software System";
  if (kind === "module") return "Container";
  if (kind === "datastore") return "Database";
  if (kind === "external-system") return "External System";
  return "Component";
}

function escapeDsl(value: string): string {
  return value.replace(/"/g, "'");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Agent Context Provider (ADR-0043) ---
//
// Projects one capability node's identity/source/extensions into a marker-owned region
// inside that capability's own primary source directory (CLAUDE.md and AGENTS.md).
// `type: "agent-context"` is a new `ProjectionTarget` target type (see
// schemas/runtime/projection-target.schema.json); the shape below intentionally does not
// import the strict `ProjectionTargetV1`/`ProjectionTargetType` TS union from
// @archcontext/contracts, whose `packages/contracts/src` is out of scope for this change.

export const AGENT_CONTEXT_RENDERER_VERSION = CONTRACT_AGENT_CONTEXT_RENDERER_VERSION;
export const AGENT_CONTEXT_BEGIN_PREFIX = "<!-- BEGIN ARCHCONTEXT AGENT CONTEXT";
export const AGENT_CONTEXT_END_PREFIX = "<!-- END ARCHCONTEXT AGENT CONTEXT";

const AGENT_CONTEXT_FILE_NAMES = [
  { fileName: "CLAUDE.md", slug: "claude" },
  { fileName: "AGENTS.md", slug: "agents" }
] as const;

export interface AgentContextProjectionTargetScope {
  kind: "entity";
  id: string;
  entityKind: string;
}

export interface AgentContextProjectionTarget {
  schemaVersion: typeof PROJECTION_TARGET_SCHEMA_VERSION;
  targetId: string;
  type: "agent-context";
  scope: AgentContextProjectionTargetScope;
  path: string;
  ownership: "mixed";
  generatedRegion: { startMarker: string; endMarker: string };
  rendererVersion: string;
  format: "markdown";
  sourceDigest: string;
  outputDigest: string;
}

export interface AgentContextProjectionFile {
  path: string;
  body: string;
  targets: AgentContextProjectionTarget[];
}

export interface AgentContextProjectionPlan {
  schemaVersion: "archcontext.agent-context-projection-plan/v1";
  rendererVersion: typeof AGENT_CONTEXT_RENDERER_VERSION;
  sourceDigest: string;
  targets: AgentContextProjectionTarget[];
  files: AgentContextProjectionFile[];
}

/**
 * Directory root of a `source.include` glob (ADR-0043): the literal prefix before the
 * first wildcard, with any trailing partial path segment dropped. A literal entry with no
 * wildcard is treated as an entrypoint file and resolves to its containing directory.
 */
export function primarySourceDirectoryFromInclude(pattern: string): string {
  assertRepoRelativePath(pattern);
  return primarySourceDirectory(pattern);
}

/** One file the agent-context projection writes, and the capability node that owns it. */
export interface AgentContextProjectionTargetPath {
  nodeId: string;
  primarySourceDir: string;
  path: string;
}

/**
 * The exact set of repo paths the agent-context projection is allowed to write, derived from the
 * model alone. This is the single derivation: `renderAgentContextProjection` consumes it, the
 * ChangeSet write scope is built from it, and `projectionOwnedPaths` folds it in — so the write
 * allowlist and the renderer can never drift apart.
 *
 * A capability whose primary source directory resolves to the repository root is rejected rather
 * than inferred. Explicit contractFiles may designate existing root contracts; ChangeSetEngine
 * requires exact preimage hashes and canonical marker-only content for those writes.
 */
export function agentContextProjectionTargetPaths(model: NativeModel): AgentContextProjectionTargetPath[] {
  return agentContextTargetPaths(model.nodes).map(({ nodeId, path }) => {
    const slash = path.lastIndexOf("/");
    return { nodeId, path, primarySourceDir: slash < 0 ? "." : path.slice(0, slash) };
  });
}

/** Reads back whatever already exists at the derived agent-context target paths. */
export function loadAgentContextProjectionFiles(root: string, model: NativeModel): ArchitectureDocumentationExistingFile[] {
  const paths = [...new Set(agentContextProjectionTargetPaths(model).map((target) => target.path))]
    .sort((left, right) => left.localeCompare(right));
  return paths
    .filter((path) => existsSync(resolve(root, path)))
    .map((path) => ({ path, body: readFileSync(assertPathHasNoSymlinkSegments(root, path), "utf8") }));
}

export function renderAgentContextProjection(input: {
  model: NativeModel;
  sourceDigest: string;
  existingFiles?: ArchitectureDocumentationExistingFile[];
  rendererVersion?: typeof AGENT_CONTEXT_RENDERER_VERSION;
}): AgentContextProjectionPlan {
  const rendererVersion = input.rendererVersion ?? AGENT_CONTEXT_RENDERER_VERSION;
  const existingByPath = new Map((input.existingFiles ?? []).map((file) => [file.path, file.body]));
  const targets: AgentContextProjectionTarget[] = [];
  const targetsByPath = new Map<string, AgentContextProjectionTarget[]>();
  const bodyByPath = new Map<string, string>();
  const nodesById = new Map(input.model.nodes.map((node) => [node.id, node]));
  const derivedByNodeId = new Map<string, AgentContextProjectionTargetPath[]>();
  for (const derived of agentContextProjectionTargetPaths(input.model)) {
    derivedByNodeId.set(derived.nodeId, [...(derivedByNodeId.get(derived.nodeId) ?? []), derived]);
  }

  for (const [nodeId, derivedPaths] of derivedByNodeId) {
    const node = nodesById.get(nodeId)!;
    const generatedBody = renderAgentContextBody(node);
    const outputDigest = digestJson({ id: node.id, body: generatedBody } as unknown as Json);

    for (const { path } of derivedPaths) {
      const slug = agentContextSlugForPath(path);
      const target: AgentContextProjectionTarget = {
        schemaVersion: PROJECTION_TARGET_SCHEMA_VERSION,
        targetId: `projection_target.agent-context.${slug}.${stableId(node.id)}`,
        type: "agent-context",
        scope: { kind: "entity", id: node.id, entityKind: node.kind },
        path,
        ownership: "mixed",
        generatedRegion: {
          startMarker: agentContextStartMarker(node.id, input.sourceDigest, rendererVersion, outputDigest),
          endMarker: agentContextEndMarker(node.id)
        },
        rendererVersion,
        format: "markdown",
        sourceDigest: input.sourceDigest,
        outputDigest
      };
      const wrapped = wrapAgentContextRegion(target, generatedBody);
      const body = mergeAgentContextRegion(target, wrapped, bodyByPath.get(path) ?? existingByPath.get(path));
      targets.push(target);
      targetsByPath.set(path, [...(targetsByPath.get(path) ?? []), target]);
      bodyByPath.set(path, body);
    }
  }

  const files = [...bodyByPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, body]) => ({ path, body, targets: targetsByPath.get(path) ?? [] }));

  return {
    schemaVersion: "archcontext.agent-context-projection-plan/v1",
    rendererVersion,
    sourceDigest: input.sourceDigest,
    targets,
    files
  };
}

function renderAgentContextBody(node: NativeNode): string {
  const source = nativeNodeSource(node);
  const extensions = node.extensions;
  const lspProfile = extensions?.lspProfile;
  const verification = extensions?.verification;
  const lines = [
    `# Agent Context: ${node.name}`,
    "",
    `- id: \`${node.id}\``,
    `- kind: \`${node.kind}\``,
    ...(node.summary ? [`- summary: ${node.summary}`] : []),
    ...(source?.include?.length ? [`- source.include: ${source.include.map((entry) => `\`${entry}\``).join(", ")}`] : []),
    ...(source?.exclude?.length ? [`- source.exclude: ${source.exclude.map((entry) => `\`${entry}\``).join(", ")}`] : []),
    ...(typeof lspProfile === "string" ? [`- extensions.lspProfile: \`${lspProfile}\``] : []),
    ...(Array.isArray(verification) && verification.length > 0
      ? [`- extensions.verification: ${verification.map((entry) => `\`${String(entry)}\``).join(", ")}`]
      : []),
    ...(extensions ? [`- extensions digest: ${digestJson(extensions as Json)}`] : [])
  ];
  return `${lines.join("\n")}\n`;
}

/** Target-id slug for a derived agent-context path, keyed off its file name. */
function agentContextSlugForPath(path: string): string {
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  const entry = AGENT_CONTEXT_FILE_NAMES.find((candidate) => candidate.fileName === fileName);
  if (!entry) throw new Error(`agent-context-unknown-target-file: ${path}`);
  return entry.slug;
}

function agentContextStartMarker(nodeId: string, sourceDigest: string, rendererVersion: string, outputDigest: string): string {
  return `${AGENT_CONTEXT_BEGIN_PREFIX} id="${nodeId}" sourceDigest="${sourceDigest}" rendererVersion="${rendererVersion}" outputDigest="${outputDigest}" -->`;
}

function agentContextEndMarker(nodeId: string): string {
  return `${AGENT_CONTEXT_END_PREFIX} id="${nodeId}" -->`;
}

function wrapAgentContextRegion(target: AgentContextProjectionTarget, generatedBody: string): string {
  return [target.generatedRegion.startMarker, generatedBody.trimEnd(), target.generatedRegion.endMarker, ""].join("\n");
}

function mergeAgentContextRegion(target: AgentContextProjectionTarget, wrapped: string, existing?: string): string {
  if (!existing) return wrapped;
  const region = findAgentContextRegion(existing, target.scope.id);
  if (!region) {
    if (target.path === "AGENTS.md" || target.path === "CLAUDE.md") {
      return `${existing}${existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n"}${wrapped}`;
    }
    return `${existing.trimEnd()}\n\n${wrapped}`;
  }
  const markerDigest = /\boutputDigest="([^"]+)"/.exec(region.startMarker)?.[1];
  if (!markerDigest) {
    throw new Error(`agent-context-marker-output-digest-missing: ${target.path} (node ${target.scope.id})`);
  }
  const generatedBody = `${existing.slice(region.contentStart, region.contentEnd).trimEnd()}\n`;
  const actualDigest = digestJson({ id: target.scope.id, body: generatedBody } as unknown as Json);
  if (markerDigest !== actualDigest) {
    throw new Error(
      `agent-context-marker-output-digest-mismatch: ${target.path} (node ${target.scope.id}; marker records ${markerDigest}, region body digests to ${actualDigest})`
    );
  }
  return `${existing.slice(0, region.start)}${wrapped}${existing.slice(region.end)}`;
}

function findAgentContextRegion(body: string, nodeId: string): {
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  startMarker: string;
} | undefined {
  const startPattern = new RegExp(`<!-- BEGIN ARCHCONTEXT AGENT CONTEXT id="${escapeRegExp(nodeId)}"[^>]*-->`);
  const startMatch = startPattern.exec(body);
  const endMarker = agentContextEndMarker(nodeId);
  if (!startMatch || startMatch.index === undefined) {
    if (body.includes(endMarker) || body.includes(`${AGENT_CONTEXT_BEGIN_PREFIX} id="${nodeId}"`)) throw new Error(`agent-context-marker-malformed: ${nodeId}`);
    return undefined;
  }
  if (startPattern.test(body.slice(startMatch.index + startMatch[0].length))) throw new Error(`agent-context-marker-duplicate: ${nodeId}`);
  const endIndex = body.indexOf(endMarker, startMatch.index + startMatch[0].length);
  if (endIndex < 0 || body.indexOf(endMarker) !== endIndex || body.indexOf(endMarker, endIndex + endMarker.length) >= 0) throw new Error(`agent-context-marker-malformed: ${nodeId}`);
  const interior = body.slice(startMatch.index + startMatch[0].length, endIndex);
  if (interior.includes(AGENT_CONTEXT_BEGIN_PREFIX) || interior.includes(AGENT_CONTEXT_END_PREFIX)) throw new Error(`agent-context-marker-overlap: ${nodeId}`);
  const regionEnd = endIndex + endMarker.length + (body[endIndex + endMarker.length] === "\n" ? 1 : 0);
  const afterMarker = startMatch.index + startMatch[0].length;
  const contentStart = afterMarker + (body[afterMarker] === "\n" ? 1 : 0);
  return {
    start: startMatch.index,
    end: regionEnd,
    contentStart,
    contentEnd: endIndex,
    startMarker: startMatch[0]
  };
}

// --- Path Ownership Resolution (ADR-0043 tie-break) ---
//
// Single implementation of the ADR-0043 tie-break: apply `source.exclude` first, then the
// most-specific (longest literal prefix) matching `source.include` wins, and an equal-
// specificity tie is rejected as ambiguous. `archctx resolve --path`
// (packages/surfaces/cli/src/main.ts) is the only caller today; a future repo-harness
// adapter is expected to call the CLI rather than re-deriving this glob semantics.

export type ResolveArchitectureOwnerResult =
  | { status: "matched"; node: NativeNode }
  | { status: "no-match" }
  | { status: "ambiguous"; candidates: NativeNode[] };

export function resolveArchitectureOwnerForPath(nodes: NativeNode[], path: string): ResolveArchitectureOwnerResult {
  const candidates: { node: NativeNode; specificity: number }[] = [];
  for (const node of nodes) {
    const source = nativeNodeSource(node);
    const include = source?.include ?? [];
    if (include.length === 0) continue;
    const excluded = (source?.exclude ?? []).some((pattern) => matchesGlob(path, pattern));
    if (excluded) continue;
    const specificity = include
      .filter((pattern) => matchesGlob(path, pattern))
      .reduce((max, pattern) => Math.max(max, globLiteralPrefixLength(pattern)), -1);
    if (specificity >= 0) candidates.push({ node, specificity });
  }
  if (candidates.length === 0) return { status: "no-match" };
  const maxSpecificity = candidates.reduce((max, candidate) => Math.max(max, candidate.specificity), -1);
  const winners = candidates.filter((candidate) => candidate.specificity === maxSpecificity).map((candidate) => candidate.node);
  if (winners.length > 1) return { status: "ambiguous", candidates: winners };
  return { status: "matched", node: winners[0] };
}

export function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(path);
}

/** Length of the glob's literal prefix (before its first `*`/`?`); used as the ADR-0043 specificity score. */
export function globLiteralPrefixLength(pattern: string): number {
  const index = pattern.search(/[*?]/);
  return index === -1 ? pattern.length : index;
}

function globToRegExp(pattern: string): RegExp {
  let out = "";
  let index = 0;
  while (index < pattern.length) {
    if (pattern.startsWith("**/", index)) {
      out += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (pattern.startsWith("**", index)) {
      out += ".*";
      index += 2;
      continue;
    }
    const char = pattern[index];
    if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += escapeRegExp(char);
    }
    index += 1;
  }
  return new RegExp(`^${out}$`);
}
