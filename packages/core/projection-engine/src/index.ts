import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, posix, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { generatedMarkerAttributes, scanDocumentRegions } from "./document-regions";
import { globLiteralPrefixLength } from "./source-globs";
import { renderStateMachineSection } from "./state-machine-diagrams";
import { renderHistoryMarkdown } from "./architecture-history";
export * from "./document-regions";
export * from "./architecture-history";
export * from "./source-globs";
import {
  AGENT_CONTEXT_RENDERER_VERSION as CONTRACT_AGENT_CONTEXT_RENDERER_VERSION,
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_MIGRATION_GUIDE,
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH,
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION,
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_UPGRADE_COMMAND,
  ARCHITECTURE_DOCS_PROJECTION_PROVENANCE_SCHEMA_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION as CONTRACT_ARCHITECTURE_DOCS_RENDERER_VERSION,
  ARCHITECTURE_FLOW_SELECTOR_CHECK_SCHEMA_VERSION,
  PROJECTION_FOOTPRINT_UNCOVERED,
  PROJECTION_MANIFEST_INVALID,
  PROJECTION_MANIFEST_UPGRADE_REQUIRED,
  PROJECTION_TARGET_SCHEMA_VERSION,
  architectureDocsProjectionManifestDigests,
  architectureDocsProjectionCompatibilityIssues,
  FailureError,
  architectureDocsProjectionManifestIssues,
  architectureDocsProjectionManifestSchemaVersion,
  architectureDocsProjectionManifestSemanticState,
  architectureDocsProjectionProvenanceIssues,
  architectureProjectionOutputsDigest,
  architectureSourceTreeDigest,
  digestJson,
  orderedLayerIssues,
  NativeContextError,
  isRuntimeTopologyNodeKind,
  isSupersededArchitectureDocsProjectionManifestSchemaVersion,
  RUNTIME_TOPOLOGY_NODE_KINDS,
  runtimeTopologyModelIssues,
  serializeArchitectureDocsProjectionManifest,
  stableId,
  type AcceptedArchitectureChangeReferenceV1,
  type ArchitectureDigestSetV2,
  type ArchitectureDocsProjectionManifestCapabilityV4,
  type ArchitectureDocsProjectionManifestTargetV4,
  type ArchitectureDocsProjectionManifestV4,
  type ArchitectureDocumentationProjectionProvenanceV3,
  type ArchitectureFlowSelectorCheckV1,
  type ArchitectureFlowV1,
  type ArchitectureHistory,
  type ArchitectureNodeSourceV2,
  type ArchitectureProjectionProofEvidenceV2,
  type ArchitectureRefreshSignalV2,
  type ArchitectureSemanticStateV1,
  type Json,
  type ModelExportResult,
  type ProjectionCoverageReasonCode,
  type ProjectionCoverageV1,
  type ProjectionFreshnessReasonCode,
  type ProjectionFreshnessStaleTargetV2,
  type ProjectionMixedTargetV1,
  type ProjectionTargetV1,
  type StateMachineV1
} from "@archcontext/contracts";
import { assertRepoRelativePath, computeWorktreeDigest, parseArchitectureDecisionRecord, parseJsonOrStableYaml } from "@archcontext/core/architecture-domain";
import { assertPathHasNoSymlinkSegments } from "@archcontext/core/changeset-engine";
import {
  agentContextTargetId,
  agentContextTargetPaths,
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  committedAgentContextOutputs,
  REPO_HARNESS_PROJECTION_PROFILE,
  contractFilesForNode,
  entitySummaryTargetNodes,
  loadArchitectureFilesForLayout,
  primarySourceDirectory,
  readProjectionOwnedFile,
  committedGeneratedOutputs,
  architectureHistoryCarryForwardBlocker,
  type CommittedGeneratedOutput,
  type ProjectionOwnedFile,
  resolveArchitectureDocumentationLayout,
  RUNTIME_TOPOLOGY_DIAGRAM_PATH,
  RUNTIME_TOPOLOGY_SCOPE_ID,
  type ArchitectureDocumentationLayout,
  type ArchitectureProjectionProfile,
  type ProjectionLayoutTargetDraft
} from "./layout";
import {
  capabilityProofRelevantSelectorEvidence,
  checkSemanticFlowSelectors,
  compileSemanticCapabilityDiagrams,
  type ArchitectureSelectorEvidenceV1,
  type SemanticArchitectureNode,
  type SemanticCapabilityDiagramCompilation
} from "./semantic-diagrams";
import {
  classifyArchitectureMajorChange,
  compileArchitectureSemanticState,
  produceArchitectureRefreshSignals,
  type ArchitectureMajorChangeClassificationV1
} from "./major-change";

export * from "./adoption";
export * from "./layout";
export * from "./major-change";
export * from "./preview";
export * from "./prose-anchors";
export * from "./semantic-diagrams";

export type NativeNodeSource = ArchitectureNodeSourceV2;

export interface NativeNode extends Record<string, Json | undefined> {
  schemaVersion?: "archcontext.node/v2";
  id: string;
  kind: string;
  name: string;
  parent?: string;
  /** Optional layer slug (ADR-0049); the only authority the layered diagram views group by. */
  layer?: string;
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

/**
 * The ids a `<id>#symbol` selector may name in `model`: node ids, the entrypoint ids and sink ids
 * under `source.entrypoints`, and flow ids.
 */
export function modelSelectorIds(model: { nodes: readonly NativeNode[]; flows?: readonly { id: string }[] }): string[] {
  const ids = new Set<string>();
  for (const node of model.nodes) {
    ids.add(node.id);
    for (const entrypoint of nativeNodeSource(node)?.entrypoints ?? []) {
      ids.add(entrypoint.id);
      for (const symbol of entrypoint.symbols) for (const sink of symbol.sinks) ids.add(sink.id);
    }
  }
  for (const flow of model.flows ?? []) ids.add(flow.id);
  return [...ids].sort();
}

export interface NativeRelation extends Record<string, Json> {
  id: string;
  kind: string;
  source: string;
  target: string;
  intent: string;
}

export interface NativeModel {
  layers?: string[];
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
  | "projection-generated-file-stale"
  | "projection-generated-file-manually-edited"
  | "projection-ambiguous-ownership"
  | "projection-orphaned";

export interface ArchitectureDocumentationProjectionDrift {
  path: string;
  targetId?: string;
  reasonCode: ArchitectureDocumentationDriftReason;
  expectedDigest?: string;
  actualDigest?: string;
}

/**
 * A managed document whose generated region names a target the current model no longer renders.
 * `delete`: the file holds only an intact generated region, so removing it loses nothing a human
 * wrote and `apply` deletes it. `human-review`: text outside the region, or an edited region,
 * may carry human content, so only a human may remove or move it (#268).
 */
export interface ArchitectureDocumentationProjectionOrphan {
  path: string;
  targetId: string;
  actualDigest: string;
  disposition: "delete" | "human-review";
}

export interface ArchitectureDocumentationProjectionPlan {
  schemaVersion: "archcontext.architecture-docs-projection-plan/v1";
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  sourceDigest: string;
  projectionDigest: string;
  profile: ArchitectureProjectionProfile;
  provenance: ArchitectureDocumentationProjectionProvenanceV3;
  semanticState: ArchitectureSemanticStateV1;
  architectureDigests: ArchitectureDigestSetV2;
  majorChange: ArchitectureMajorChangeClassificationV1;
  refreshSignals: ArchitectureRefreshSignalV2[];
  receiptDigest: string;
  /** The non-model inputs the flow proofs were compiled from, per capability, as this run measured them. */
  proofEvidence: ArchitectureProjectionProofEvidenceV2;
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
  /** Every `projection-orphaned` drift entry, sorted by path, with what may remove it. */
  orphans: ArchitectureDocumentationProjectionOrphan[];
  /**
   * The committed current-format manifest this render classified against: its semantic baseline
   * and its target rows. Absent without one (no manifest, an unrecognized one, or a superseded one
   * a `docs apply` re-baselines).
   */
  committedManifest?: ArchitectureDocsProjectionManifestV4;
  /**
   * Every current target's manifest row as this render produced it, by targetId. An isolated plan
   * keeps the complete render's rows here, also for the targets whose committed rows its
   * `manifest` carries forward.
   */
  renderedTargets: ArchitectureDocsProjectionManifestV4["targets"];
  /**
   * Render-equivalent freshness of the committed projection (ADR-0056 §1), from the complete
   * render. An isolated plan keeps it, so `check`, `complete` and `projection freshness` read one
   * answer from one render.
   */
  freshness: ArchitectureProjectionFreshnessEvaluation;
  /**
   * Present only on a render that asked for `isolateBlockedCapabilities` and qualified for it
   * (Phase 1 capability isolation, #327). The plan then covers only the applied targets: `files`
   * omits the carried-forward documents, and `manifest` keeps their rows and their capabilities'
   * baseline entries byte for byte. Absent, the plan covers every target.
   */
  isolation?: ArchitectureProjectionIsolationV1;
}

/** What a partial plan covers; the result's `coverage` without its `complete: false`. */
export type ArchitectureProjectionIsolationV1 = Omit<ProjectionCoverageV1, "complete">;

export const ARCHITECTURE_DOCS_RENDERER_VERSION = CONTRACT_ARCHITECTURE_DOCS_RENDERER_VERSION;
export const ARCHITECTURE_DOCS_GENERATED_BEGIN_PREFIX = "<!-- BEGIN ARCHCONTEXT:generated";
export const ARCHITECTURE_DOCS_GENERATED_END_PREFIX = "<!-- END ARCHCONTEXT:generated";

/**
 * The repository and CodeGraph state one projection run read. Runtime-only — refresh signals and
 * protocol snapshots, receipts and recovery bindings bind it, the committed manifest does not,
 * because each value can differ between two machines projecting the same commit (#277).
 */
export interface ArchitectureDocumentationProjectionRuntimeSnapshot {
  headSha: string;
  worktreeDigest: string;
  /** Digest of the CodeGraph version and the code evidence (import graphs, selector evidence) this run read. */
  codeGraphDigest: string;
  /** Binds the index status (checkout path, index time) to the declared source tree; null without an index. */
  indexedWorktreeDigest: string | null;
  /** Whether this machine had a usable `.codegraph` index. */
  codeGraphStatus: "ready" | "unavailable";
}

/**
 * Content digest of one node's declared source footprint: the files `source.include` selects,
 * minus `source.exclude`, minus `projectionOwnedPaths`. Runtime provenance digests these into its
 * `sourceTreeDigest`; the committed manifest records none of them.
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
  /**
   * The index read returned a different number of import nodes than the index reported (the index
   * changed during the read), so `edges` may be incomplete. Printed, never hidden.
   */
  truncated: boolean;
  /**
   * Present only when the index holds more import nodes than the read limit. `edges` then come
   * from the first limit nodes. This is a configured limit, not an incomplete index, so
   * `truncated` stays false.
   */
  importNodeLimitExceeded?: true;
}

/** Compiles accepted node/relation/flow authority against an exact CodeGraph evidence snapshot. */
export function renderArchitectureDocumentationProjection(input: {
  model: NativeModel;
  stateMachines?: readonly StateMachineV1[];
  profile?: ArchitectureProjectionProfile;
  sourceDigest: string;
  provenance: ArchitectureDocumentationProjectionProvenanceV3;
  sourceScaleSignals: CapabilitySourceScaleSignal[];
  importGraphs: CapabilityImportGraph[];
  selectorEvidence: ArchitectureSelectorEvidenceV1[];
  decisions?: ArchitectureDecisionRecord[];
  timeline?: ArchitectureDocumentationTimelineEntry[];
  existingFiles?: ArchitectureDocumentationExistingFile[];
  /**
   * The complete architecture history at the projection base (ADR-0056 §8). Given, the
   * `architecture-history` target renders from it. Absent, the target carries its committed row and
   * bytes forward, which must be intact (`architectureHistoryCarryForwardBlocker`).
   */
  architectureHistory?: ArchitectureHistory;
  /**
   * `docs.language` (`loadArchitectureDocumentationLanguage`): the headings of a new module
   * document's skeleton. An existing document keeps its headings. Absent writes the legacy headings.
   */
  docsLanguage?: ArchitectureDocsLanguage;
  rendererVersion?: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  /**
   * `docs apply` only: an existing manifest of a superseded schema version (v1, v2) is not read,
   * and this render re-baselines as if no manifest existed. Every other caller is refused with
   * `projection-manifest-upgrade-required` (#327).
   */
  rebaselineSupersededManifest?: boolean;
  /**
   * Phase 1 capability isolation (#327): when the only reason this render needs a human is a
   * set of capabilities blocked by their flow proof alone (unprovable, or a proof change nobody
   * accepted, with an unchanged semantic fingerprint), return a plan that applies every other
   * target and carries the blocked ones forward unchanged (`plan.isolation`). Any other state
   * renders the complete plan, exactly as without the flag. Only `projection run` asks for it.
   */
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
  const rendererVersion = input.rendererVersion ?? ARCHITECTURE_DOCS_RENDERER_VERSION;
  assertArchitectureDocumentationProjectionProvenance(input.provenance, rendererVersion);
  const model = normalizeNativeModel(input.model);
  const layout = resolveArchitectureDocumentationLayout({ nodes: model.nodes, relations: model.relations, profile: input.profile });
  const existingByPath = new Map((input.existingFiles ?? []).map((file) => [file.path, file.body]));
  const previousManifest = previousArchitectureDocsProjectionManifest(
    existingByPath.get(ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH),
    input.rebaselineSupersededManifest === true
  );
  const provenance = input.provenance;
  const scaleSignalsByNodeId = new Map((input.sourceScaleSignals ?? []).map((signal) => [signal.nodeId, signal]));
  // One structured value per node: the module document prints it and the manifest records it.
  const scaleByNodeId = new Map([...scaleSignalsByNodeId].map(([nodeId, signal]) => [nodeId, architectureCapabilityScale(signal)]));
  const semanticNodes = semanticArchitectureNodes(model);
  const semanticCompilationsByNodeId = new Map(model.nodes.map((node) => [node.id, compileSemanticCapabilityDiagrams({
    capabilityId: node.id,
    nodes: semanticNodes,
    relations: model.relations,
    flows: model.flows ?? [],
    evidence: input.selectorEvidence
  })]));
  const semanticState = compileArchitectureSemanticState({
    model,
    compilations: [...semanticCompilationsByNodeId.values()]
  });
  const majorChange = classifyArchitectureMajorChange({
    base: previousManifest ? architectureDocsProjectionManifestSemanticState(previousManifest) : undefined,
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
  // entity target. The same digest is the target's freshness identity (ADR-0056 §1): no digest of
  // raw source reaches a body, a marker or a manifest row.
  //
  // The plan-wide `input.sourceDigest` (the moving tree) is deliberately not folded into the
  // per-entity key either: it would couple every entity document to unrelated commits. No body
  // prints a wall-clock or run time, so two runs over the same inputs render the same bytes.
  // Index/diagram/decision/relation/changelog targets render no per-node measurement, so their
  // runtime target records the plan-wide `input.sourceDigest`. Neither a marker nor a manifest row
  // carries it: a marker records only the target, the renderer version and the output digest of
  // its own body, and a row records the output digest.
  const docsLanguage = input.docsLanguage === undefined ? undefined : assertArchitectureDocsLanguage(input.docsLanguage);
  const targetDrafts = architectureDocumentationTargetDrafts(model, layout, docsLanguage);
  // Every declared footprint is documented by the entity-summary target of its nearest
  // ancestor-or-self that has one, or by both topology targets for a topology node; a footprint no
  // target documents is refused, never dropped.
  const footprintOwners = architectureProjectionFootprintOwners(model, layout.profile);
  const historyTarget = layout.targets.find((target) => target.type === "architecture-history");
  const historyBlocker = historyTarget === undefined || input.architectureHistory !== undefined
    ? undefined
    : architectureHistoryCarryForwardBlocker(existingByPath.get(ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH), existingByPath.get(historyTarget.path));
  if (historyBlocker !== undefined) {
    throw new Error(`architecture-history-input-missing: ${historyBlocker}, so the committed history row cannot be carried forward and this render must be given the architecture history`);
  }
  // Contract files render through the one agent-context renderer, which also backs the root-contract
  // canonical check, so the projection and that check agree byte for byte (ADR-0056 §9).
  const agentContextByTargetId = new Map((targetDrafts.some((draft) => draft.type === "agent-context")
    ? renderAgentContextProjection({ model, existingFiles: input.existingFiles ?? [] }).files
    : []).flatMap((file) => file.targets.map((target) => [target.targetId, { target, body: file.body }] as const)));
  const rendered = targetDrafts.map((draft): ArchitectureDocumentationProjectionFile => {
    if (draft.type === "agent-context") {
      const agentContext = agentContextByTargetId.get(draft.targetId);
      if (agentContext === undefined || agentContext.target.path !== draft.path) throw new Error(`agent-context-layout-render-mismatch: ${draft.targetId}`);
      return {
        path: draft.path,
        body: agentContext.body,
        target: agentContext.target,
        digest: digestJson({ path: draft.path, body: agentContext.body } as unknown as Json),
        generatedBodyDigest: agentContext.target.outputDigest
      };
    }
    const existing = existingByPath.get(draft.path);
    if (draft.type === "architecture-history" && input.architectureHistory === undefined) {
      return carriedArchitectureHistoryFile(draft, previousManifest!.targets[draft.targetId]!, existing!, rendererVersion, input.sourceDigest);
    }
    const nodeId = draft.type === "entity-summary" ? draft.scope.id : undefined;
    // A node that declares `source.include` with no measured scale signal throws
    // `architecture-docs-projection-scale-signal-missing` here.
    const generatedBody = renderTargetGeneratedBody(draft, model, {
      scaleSignalsByNodeId,
      scaleByNodeId,
      semanticCompilationsByNodeId,
      stateMachines: input.stateMachines ?? [],
      decisions: input.decisions ?? [],
      timeline: input.timeline ?? [],
      architectureHistory: input.architectureHistory,
      layout
    });
    // Targets that render no per-node measurement key on the plan-wide digest; an entity-summary
    // target keys on the digest of its own rendered body (see the comment above the render loop).
    const targetSourceDigest = nodeId !== undefined ? digestJson(generatedBody) : input.sourceDigest;
    const generatedBodyDigest = digestJson({ targetId: draft.targetId, body: generatedBody } as unknown as Json);
    const target = projectionTarget({
      ...draft,
      rendererVersion,
      sourceDigest: targetSourceDigest,
      outputDigest: generatedBodyDigest
    });
    // A `generated` target owns its whole file, so the file is exactly the rendered body: a JSON,
    // Mermaid or LikeC4 file stays valid in its own format and carries no ownership marker. The
    // manifest row's `outputDigest` is what proves the file is projection output.
    const body = target.ownership === "generated"
      ? generatedBody
      : mergeGeneratedRegion(target, wrapGeneratedRegion(target, generatedBody), existing, draft.skeleton);
    return {
      path: target.path,
      body,
      target,
      digest: digestJson({ path: target.path, body } as unknown as Json),
      generatedBodyDigest
    };
  });
  const targets = rendered.map((file) => file.target);
  const expectedByPath = new Map(rendered.map((file) => [file.path, file]));
  // The global digests are functions of the per-target rows, with the formulas a reader of the
  // committed manifest uses (`architectureDocsProjectionManifestDigests`), so the base digests
  // read back from a manifest and the resulting digests of a run compare like for like.
  const projectionDigest = architectureProjectionOutputsDigest({
    rendererVersion,
    profile: layout.profile,
    outputDigests: Object.fromEntries(rendered.map((file) => [file.target.targetId, file.target.outputDigest]))
  });
  const architectureDigests: ArchitectureDigestSetV2 = {
    modelDigest: provenance.modelDigest as ArchitectureDigestSetV2["modelDigest"],
    flowProofDigest: semanticState.flowProofFingerprint as ArchitectureDigestSetV2["flowProofDigest"],
    projectionDigest
  };
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

/** The agent-context targets of one contract file render one body, so the file is written once. */
function filesWithUniquePaths(files: ArchitectureDocumentationProjectionFile[]): ArchitectureDocumentationProjectionFile[] {
  const seen = new Set<string>();
  return files.filter((file) => !seen.has(file.path) && seen.add(file.path) !== undefined);
}

/**
 * The receipt binds the classification without its per-capability breakdown: the breakdown
 * explains reasonCodes and affectedNodeIds, and an unresolved capability's proofStatusBefore moves
 * from null to its status once a first baseline exists, which would keep the classification from
 * ever reaching a fixed point. The receipt digest is runtime only; the manifest does not record it.
 */
function architectureProjectionPlanReceiptDigest(input: {
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
function isolateBlockedCapabilityTargets(input: {
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
function carriedArchitectureHistoryFile(
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

/**
 * A projection precondition with its own reason code: the committed manifest or the model is in a
 * state the projection refuses, and the operator, not the runtime, resolves it (#327).
 */
export abstract class ProjectionPreconditionError extends Error {
  abstract readonly reasonCode: string;
}

/**
 * A committed manifest whose `schemaVersion` names a format an earlier release wrote. Only that
 * field was read; the manifest's baseline and rows are not translated. The operator
 * re-baselines once with `archctx docs apply --approved` (#327).
 */
export class ProjectionManifestUpgradeRequiredError extends ProjectionPreconditionError {
  readonly reasonCode = PROJECTION_MANIFEST_UPGRADE_REQUIRED;
  /**
   * The structured failure details every public surface registers with this reason: the committed
   * manifest, the superseded format it names, the format this release reads, and the one-time
   * re-baseline plus its runbook. Populated only for a schemaVersion this release recognizes as
   * superseded, because that is the only value the public fact vocabulary accepts; a forged value
   * keeps the typed refusal without widening the diagnostic.
   */
  readonly details: Readonly<Record<string, string>>;
  constructor(readonly schemaVersion: string) {
    super(`${PROJECTION_MANIFEST_UPGRADE_REQUIRED}: ${ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH} is ${schemaVersion}, and this archctx reads only ${ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION}; reach a clean projection on the earlier release first, then re-baseline once with ${ARCHITECTURE_DOCS_PROJECTION_MANIFEST_UPGRADE_COMMAND}; if that apply names whole-file outputs the earlier release wrote, remove them with git rm and run it again; ${ARCHITECTURE_DOCS_PROJECTION_MANIFEST_MIGRATION_GUIDE} lists the model and release preconditions`);
    this.details = isSupersededArchitectureDocsProjectionManifestSchemaVersion(schemaVersion) ? {
      manifestPath: ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH,
      foundSchemaVersion: schemaVersion,
      supportedSchemaVersion: ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION,
      upgradeCommand: ARCHITECTURE_DOCS_PROJECTION_MANIFEST_UPGRADE_COMMAND,
      migrationGuide: ARCHITECTURE_DOCS_PROJECTION_MANIFEST_MIGRATION_GUIDE
    } : {};
  }
}

/** Declared source footprints that no entity-summary or topology target documents. */
export class ProjectionFootprintUncoveredError extends ProjectionPreconditionError {
  readonly reasonCode = PROJECTION_FOOTPRINT_UNCOVERED;
  constructor(readonly nodeIds: string[], profile: ArchitectureProjectionProfile) {
    super(`${PROJECTION_FOOTPRINT_UNCOVERED}: ${nodeIds.join(", ")} declare source.include, but neither the node nor an ancestor has an entity-summary target under profile ${profile}`);
  }
}

/**
 * A committed manifest that names the current `schemaVersion` but fails its contract. Nothing in it
 * is read; the operator restores the committed file from Git.
 */
export class ProjectionManifestInvalidError extends ProjectionPreconditionError {
  readonly reasonCode = PROJECTION_MANIFEST_INVALID;
  constructor(readonly issues: string[]) {
    super(`${PROJECTION_MANIFEST_INVALID}: ${issues.join("; ")}; restore ${ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH} from Git`);
  }
}

/**
 * Reads a committed manifest strictly. A superseded `schemaVersion` is refused with
 * `projection-manifest-upgrade-required`; any other manifest that is not a valid current-format
 * manifest is refused with `projection-manifest-invalid`.
 */
export function parseArchitectureDocsProjectionManifest(body: string): ArchitectureDocsProjectionManifestV4 {
  const schemaVersion = architectureDocsProjectionManifestSchemaVersion(body);
  if (isSupersededArchitectureDocsProjectionManifestSchemaVersion(schemaVersion)) throw new ProjectionManifestUpgradeRequiredError(schemaVersion!);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new ProjectionManifestInvalidError([error instanceof Error ? error.message : String(error)]);
  }
  const issues = architectureDocsProjectionManifestIssues(parsed);
  if (issues.length > 0) throw new ProjectionManifestInvalidError(issues);
  return parsed as ArchitectureDocsProjectionManifestV4;
}

/**
 * The manifest the previous projection committed, which carries the semantic baseline this run is
 * classified against. No manifest, or one that is not JSON or declares no
 * `schemaVersion` and no floors, carries no baseline: the drift check reports it and `apply` rewrites it. A
 * superseded manifest is refused unless `docs apply` re-baselines; a current-format manifest that
 * fails its contract is refused. An unrecognized declared schema or unsupported floor is refused.
 */
function previousArchitectureDocsProjectionManifest(body: string | undefined, rebaselineSuperseded: boolean): ArchitectureDocsProjectionManifestV4 | undefined {
  if (body === undefined) return undefined;
  let candidate: unknown;
  try { candidate = JSON.parse(body); } catch { /* Existing malformed/missing-baseline handling remains below. */ }
  if (architectureDocsProjectionCompatibilityIssues(candidate).length) throw new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-incompatible");
  const schemaVersion = architectureDocsProjectionManifestSchemaVersion(body);
  if (isSupersededArchitectureDocsProjectionManifestSchemaVersion(schemaVersion)) {
    if (rebaselineSuperseded) return undefined;
    throw new ProjectionManifestUpgradeRequiredError(schemaVersion!);
  }
  if (schemaVersion !== ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION) return undefined;
  return parseArchitectureDocsProjectionManifest(body);
}

/**
 * Reads a committed manifest exactly as a projection render reads it, without rendering: a
 * superseded one throws `projection-manifest-upgrade-required` and a current-format one that fails
 * its contract throws `projection-manifest-invalid`. A manifest that is not JSON or names no
 * declared `schemaVersion` or floors carries no baseline and reads as undefined, as for a render.
 * `projection freshness` reads the committed profile through it.
 */
export function readCommittedArchitectureDocsProjectionManifest(body: string): ArchitectureDocsProjectionManifestV4 | undefined {
  return previousArchitectureDocsProjectionManifest(body, false);
}

/**
 * The scope id of the targets that document each declared source footprint under `profile`. Keys
 * are every node that declares `source.include`. A runtime topology node's footprint (its
 * configuration files, ADR-0049) belongs to both topology targets, `RUNTIME_TOPOLOGY_SCOPE_ID`,
 * which the layout adds whenever such a node exists. Any other footprint belongs to the nearest
 * ancestor-or-self of the declaring node that has an entity-summary target, by node id. A declared
 * footprint with no such node throws `ProjectionFootprintUncoveredError`, naming every uncovered
 * node.
 */
export function architectureProjectionFootprintOwners(model: NativeModel, profile: ArchitectureProjectionProfile = "default"): Map<string, string> {
  const targetNodeIds = new Set(entitySummaryTargetNodes(model.nodes, profile).map((node) => node.id));
  const nodesById = new Map(model.nodes.map((node) => [node.id, node]));
  const owners = new Map<string, string>();
  const uncovered: string[] = [];
  for (const node of [...model.nodes].sort((left, right) => compareStrings(left.id, right.id))) {
    if ((nativeNodeSource(node)?.include ?? []).length === 0) continue;
    if (isRuntimeTopologyNodeKind(node.kind)) {
      owners.set(node.id, RUNTIME_TOPOLOGY_SCOPE_ID);
      continue;
    }
    const seen = new Set<string>();
    let current: NativeNode | undefined = node;
    while (current && !targetNodeIds.has(current.id) && !seen.has(current.id)) {
      seen.add(current.id);
      current = typeof current.parent === "string" ? nodesById.get(current.parent) : undefined;
    }
    if (current && targetNodeIds.has(current.id)) owners.set(node.id, current.id);
    else uncovered.push(node.id);
  }
  if (uncovered.length > 0) throw new ProjectionFootprintUncoveredError(uncovered, profile);
  return owners;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function architectureDocumentationSourceTreeDigest(root: string, model: NativeModel, sourceFiles: readonly string[]): string {
  return digestArchitectureDocumentationSourceTree(root, model, loadCapabilitySourceFootprints(root, model, sourceFiles));
}

/**
 * The declared source tree digest over footprints the caller already resolved for this run
 * (`loadCapabilitySourceFootprints`), so one build matches the globs once (#324). It is the digest
 * of every node's footprint digest (`architectureSourceTreeDigest`). Runtime provenance only: it
 * binds the CodeGraph index and the expected snapshot to the measured tree and is never committed.
 */
export function digestArchitectureDocumentationSourceTree(root: string, model: NativeModel, footprints: readonly CapabilitySourceFootprint[]): string {
  return architectureSourceTreeDigest(Object.fromEntries(
    digestCapabilitySourceFootprints(root, model, footprints).map((footprint) => [footprint.nodeId, footprint.digest])
  ));
}

/**
 * Content digest of one declared source file with CRLF line endings normalized to LF. Checkouts
 * that apply `core.autocrlf` (Windows runners and developer machines) then measure the same
 * footprint as a Linux clone of the same commit, so footprint digests and the snapshot digest do not
 * depend on the platform that computed them. The latin1 round trip rewrites only `\r\n` pairs and
 * leaves every other byte as is.
 */
function sourceFileContentDigest(absolute: string): string {
  return sourceContentDigest(readFileSync(absolute));
}

/** The digest of `sourceFileContentDigest` over bytes the caller already read. */
export function sourceContentDigest(bytes: Buffer): string {
  const normalized = bytes.includes(0x0d) ? Buffer.from(bytes.toString("latin1").replaceAll("\r\n", "\n"), "latin1") : bytes;
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

/**
 * Fixed-point worktree digest: projection-owned outputs cannot hash the manifest that embeds it.
 * `files` is the repository's Git-visible universe (`listGitVisibleFiles`), the same one the source
 * footprints are measured over.
 */
export function architectureDocumentationProjectionWorktreeDigest(
  root: string,
  model: NativeModel,
  files: readonly string[]
): string {
  return computeWorktreeDigest(root, files, {
    ignore: [
      ".ai/harness",
      "docs/architecture",
      ...agentContextTargetPaths(model.nodes).map((target) => target.path)
    ]
  });
}

export function architectureDocumentationProjectionInputDigest(
  input: Omit<ArchitectureDocumentationProjectionProvenanceV3, "schemaVersion" | "projectionInputDigest">
): string {
  return digestJson(input as unknown as Json);
}

export function architectureDocumentationProjectionProvenance(
  input: Omit<ArchitectureDocumentationProjectionProvenanceV3, "schemaVersion" | "projectionInputDigest">
): ArchitectureDocumentationProjectionProvenanceV3 {
  return {
    schemaVersion: ARCHITECTURE_DOCS_PROJECTION_PROVENANCE_SCHEMA_VERSION,
    ...input,
    projectionInputDigest: architectureDocumentationProjectionInputDigest(input)
  };
}

function assertArchitectureDocumentationProjectionProvenance(
  provenance: ArchitectureDocumentationProjectionProvenanceV3,
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION
): void {
  const issues = architectureDocsProjectionProvenanceIssues(provenance);
  if (issues.length > 0) throw new Error(`architecture-docs-projection-provenance-schema-invalid: ${issues.join("; ")}`);
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
  existingFiles: ProjectionOwnedFile[];
  docsLanguage: ArchitectureDocsLanguage | undefined;
} {
  const model = loadNativeModelFromArchContext(root);
  const layout = resolveArchitectureDocumentationLayout({ nodes: model.nodes, relations: model.relations, profile });
  return {
    model,
    decisions: loadArchitectureDecisionRecords(root),
    existingFiles: loadArchitectureFilesForLayout(root, layout),
    docsLanguage: loadArchitectureDocumentationLanguage(root)
  };
}

/**
 * Measures the `source.include` minus `source.exclude` footprint of every node that declares one,
 * minus `projectionOwnedPaths`. Nodes without `source.include` are absent from the result on
 * purpose: the renderer prints an explicit "not derivable" note for them instead of a zero that
 * reads like a measurement.
 */
export function loadCapabilitySourceScaleSignals(root: string, model: NativeModel, sourceFiles: readonly string[]): CapabilitySourceScaleSignal[] {
  return measureCapabilitySourceScaleSignals(root, model, loadCapabilitySourceFootprints(root, model, sourceFiles));
}

/** `loadCapabilitySourceScaleSignals` over footprints the caller already resolved for this run. */
export function measureCapabilitySourceScaleSignals(root: string, model: NativeModel, footprints: readonly CapabilitySourceFootprint[]): CapabilitySourceScaleSignal[] {
  const ownedPathPatterns = projectionOwnedPaths(model);
  return footprints.map((footprint) => {
    const files = footprint.files.filter((path) => !ownedPathPatterns.some((pattern) => matchesGlob(path, pattern)));
    return {
      nodeId: footprint.nodeId,
      fileCount: files.length,
      lineCount: files.reduce((total, path) => total + countFileLines(resolve(root, path)), 0),
      includePatterns: footprint.includePatterns,
      excludePatterns: footprint.excludePatterns
    };
  });
}

/** Never capability source, even when tracked: Git metadata and vendored dependency trees. */
const FOOTPRINT_SKIPPED_SEGMENTS = new Set([".git", "node_modules"]);

/** One node's declared source footprint, resolved to repo-relative files. */
export interface CapabilitySourceFootprint {
  nodeId: string;
  files: string[];
  includePatterns: string[];
  excludePatterns: string[];
}

/**
 * Resolves every node's `source.include` minus `source.exclude` to the repo-relative files it
 * selects. Shared by the scale signal loader, the footprint digests, the source tree digest and the
 * code-index adapter that measures import edges, so all of them answer "which files belong to this
 * capability" the same way.
 *
 * `sourceFiles` is the universe the globs are matched against: the repository's Git-visible files
 * (tracked plus untracked, non-ignored), listed by the local runtime's Git adapter
 * (`listGitVisibleFiles`). Core never walks the filesystem for it, so a gitignored file under
 * a declared include — a build artifact, a cache, a local secret — can never enter a footprint, a
 * digest or a scale signal. Every listed path must be a readable regular file under `root`.
 */
export function loadCapabilitySourceFootprints(root: string, model: NativeModel, sourceFiles: readonly string[]): CapabilitySourceFootprint[] {
  const nodes = model.nodes.filter((node) => (nativeNodeSource(node)?.include ?? []).length > 0);
  if (nodes.length === 0) return [];
  const scanned = [...new Set(sourceFiles)]
    .filter((path) => !path.split("/").some((segment) => FOOTPRINT_SKIPPED_SEGMENTS.has(segment)))
    .sort((left, right) => left.localeCompare(right));
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

function countFileLines(absolute: string): number {
  const content = readFileSync(absolute, "utf8");
  if (content === "") return 0;
  const newlines = content.split("\n").length - 1;
  return content.endsWith("\n") ? newlines : newlines + 1;
}

/**
 * One 1–2–5 magnitude bucket: the half-open range `[lower, upper)` that contains a measured count.
 * `{ lower: 0, upper: 1 }` holds only zero; otherwise `lower` is `1`, `2` or `5` times a power of ten
 * and `upper` is the next step on that ladder.
 */
interface ArchitectureScaleBucketV1 {
  lower: number;
  upper: number;
}

/** The measured size of a node's footprint, as buckets. The module document prints exactly these. */
interface ArchitectureCapabilityScaleV1 {
  fileCountBucket: ArchitectureScaleBucketV1;
  lineCountBucket: ArchitectureScaleBucketV1;
}

/**
 * The 1–2–5 magnitude bucket that contains a measured count (`537` → `{ lower: 500, upper: 1000 }`,
 * `172275` → `{ lower: 100000, upper: 200000 }`, `0` → `{ lower: 0, upper: 1 }`).
 *
 * The projection records the bucket, never the count. A capability's declared footprint is measured
 * against the working tree, so an exact count in a Git-tracked document rewrites that document on
 * every edit anywhere under the footprint — for a capability covering `tests/**` that is several
 * commits a day, and it drowns the diffs that mean an architecture assertion changed.
 * The bucket carries the whole decision the signal exists to support ("how big is this capability")
 * at a resolution ordinary edits cannot move.
 *
 * A bucket is a half-open range `[lower, upper)`; reporting both ends states the resolution instead
 * of implying a point estimate the renderer does not have.
 */
function scaleMagnitudeBucket(value: number): ArchitectureScaleBucketV1 {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`architecture-docs-projection-scale-signal-not-a-count: ${value}`);
  }
  if (value === 0) return { lower: 0, upper: 1 };
  const mantissas = [1, 2, 5];
  let index = 0;
  let magnitude = 1;
  let lower = 1;
  for (;;) {
    const nextIndex = (index + 1) % mantissas.length;
    const nextMagnitude = nextIndex === 0 ? magnitude * 10 : magnitude;
    const upper = mantissas[nextIndex] * nextMagnitude;
    if (upper > value) return { lower, upper };
    index = nextIndex;
    magnitude = nextMagnitude;
    lower = upper;
  }
}

/** The structured scale of one measured footprint; the module document prints exactly this value. */
function architectureCapabilityScale(signal: CapabilitySourceScaleSignal): ArchitectureCapabilityScaleV1 {
  return {
    fileCountBucket: scaleMagnitudeBucket(signal.fileCount),
    lineCountBucket: scaleMagnitudeBucket(signal.lineCount)
  };
}

/** Prints a bucket as `500–1000` or `100k–200k`; both ends share the unit chosen from the lower bound. */
function scaleMagnitudeBucketLabel(bucket: ArchitectureScaleBucketV1): string {
  if (bucket.lower === 0) return "0";
  const unit = bucket.lower >= 1_000_000 ? 1_000_000 : bucket.lower >= 10_000 ? 1_000 : 1;
  const suffix = unit === 1_000_000 ? "M" : unit === 1_000 ? "k" : "";
  return `${bucket.lower / unit}${suffix}–${bucket.upper / unit}${suffix}`;
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
  const body = readFileSync(resolve(root, ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH), "utf8");
  // A superseded manifest is read for its schemaVersion only, so it names no profile.
  const schemaVersion = architectureDocsProjectionManifestSchemaVersion(body);
  if (isSupersededArchitectureDocsProjectionManifestSchemaVersion(schemaVersion)) throw new ProjectionManifestUpgradeRequiredError(schemaVersion!);
  const manifest = JSON.parse(body);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || (manifest.profile !== "default" && manifest.profile !== REPO_HARNESS_PROJECTION_PROFILE)) {
    throw new Error("projection-manifest-profile-invalid: regenerate docs with an explicit supported --profile");
  }
  return manifest.profile;
}

/** Languages of the module-document skeleton headings (#302). */
export const ARCHITECTURE_DOCS_LANGUAGES = ["zh-Hant", "zh-Hans", "en"] as const;
export type ArchitectureDocsLanguage = typeof ARCHITECTURE_DOCS_LANGUAGES[number];

const ARCHCONTEXT_MANIFEST_PATH = ".archcontext/manifest.yaml";

/**
 * `docs.language` from `.archcontext/manifest.yaml`. It selects the headings of a new module
 * document's skeleton only. Without the setting the renderer writes the legacy headings. A missing
 * or unreadable manifest declares nothing here, as for `codeFacts.required`; manifest shape is
 * `archctx validate`'s concern. A value that is not a supported language fails closed.
 */
export function loadArchitectureDocumentationLanguage(root: string): ArchitectureDocsLanguage | undefined {
  const path = resolve(root, ARCHCONTEXT_MANIFEST_PATH);
  if (!existsSync(path)) return undefined;
  let manifest: Json;
  try {
    manifest = parseJsonOrStableYaml(readFileSync(path, "utf8"), ARCHCONTEXT_MANIFEST_PATH);
  } catch {
    return undefined;
  }
  const docs = manifest && typeof manifest === "object" && !Array.isArray(manifest) ? manifest.docs : undefined;
  const language = docs && typeof docs === "object" && !Array.isArray(docs) ? docs.language : undefined;
  return language === undefined ? undefined : assertArchitectureDocsLanguage(language);
}

function assertArchitectureDocsLanguage(value: unknown): ArchitectureDocsLanguage {
  if (!(ARCHITECTURE_DOCS_LANGUAGES as readonly unknown[]).includes(value)) {
    throw new Error(`architecture-docs-language-invalid: docs.language must be one of ${ARCHITECTURE_DOCS_LANGUAGES.join(", ")} (got ${JSON.stringify(value)})`);
  }
  return value as ArchitectureDocsLanguage;
}

export function loadArchitectureDecisionRecords(root: string): ArchitectureDecisionRecord[] {
  const dir = resolve(root, "docs/adr");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /^ADR-\d{4}-.+\.md$/.test(file))
    .sort()
    .map((file) => {
      const path = `docs/adr/${file}`;
      const metadata = parseArchitectureDecisionRecord(path, readFileSync(resolve(root, path), "utf8"));
      return { id: basename(file, ".md"), title: metadata.title, path, ...(metadata.status ? { status: metadata.status } : {}) };
    });
}

export function loadArchitectureDocumentationFiles(
  root: string,
  model: NativeModel = loadNativeModelFromArchContext(root),
  profile: ArchitectureProjectionProfile = "default"
): ProjectionOwnedFile[] {
  return loadArchitectureFilesForLayout(
    root,
    resolveArchitectureDocumentationLayout({ nodes: model.nodes, relations: model.relations, profile })
  );
}

// --- Projection freshness: would the committed documents render differently? (ADR-0056 §1) ---
//
// Drift answers "do the files on disk match this render?", including integrity, adoption,
// ownership and orphans. Freshness answers the narrower question over the committed record only:
// does each target render the output its committed row records, and would the manifest the render
// writes equal the committed bytes? Both sides are render outputs, so freshness covers every render
// input without listing it and never reads Git history. Freshness that is not ok implies drift that
// is not ok.

/** The contract's reason codes, so the `check` result's `freshness` field can carry them verbatim. */
export type ArchitectureProjectionFreshnessReasonCode = ProjectionFreshnessReasonCode;

export interface ArchitectureProjectionFreshnessEvaluation {
  schemaVersion: "archcontext.projection-freshness/v3";
  ok: boolean;
  reasonCodes: ArchitectureProjectionFreshnessReasonCode[];
  detail: string;
  /** Sorted by targetId. Non-empty exactly when `projection-output-changed` is reported. */
  staleTargets: ProjectionFreshnessStaleTargetV2[];
}

/**
 * The one freshness evaluator. It compares the complete render's rows with the committed manifest
 * the render classified against, so a hand-edited document stays a drift finding and is not a
 * freshness one. A committed body that names no current-format manifest is unreadable; a superseded
 * or invalid one never reaches here, because the render refuses it first.
 */
function evaluateArchitectureProjectionFreshness(input: {
  committedManifestBody: string | undefined;
  committedManifest: ArchitectureDocsProjectionManifestV4 | undefined;
  renderedTargets: ArchitectureDocsProjectionManifestV4["targets"];
  renderedManifestBody: string;
}): ArchitectureProjectionFreshnessEvaluation {
  if (input.committedManifest === undefined) return architectureProjectionFreshnessWithoutBaseline(input.committedManifestBody);
  const committed = input.committedManifest.targets;
  const staleTargets: ProjectionFreshnessStaleTargetV2[] = [];
  for (const targetId of [...new Set([...Object.keys(committed), ...Object.keys(input.renderedTargets)])].sort(compareStrings)) {
    const before = committed[targetId];
    const after = input.renderedTargets[targetId];
    if (before?.outputDigest === after?.outputDigest) continue;
    staleTargets.push({
      targetId,
      path: (after ?? before)!.path,
      committedOutputDigest: (before?.outputDigest ?? null) as ProjectionFreshnessStaleTargetV2["committedOutputDigest"],
      renderedOutputDigest: (after?.outputDigest ?? null) as ProjectionFreshnessStaleTargetV2["renderedOutputDigest"]
    });
  }
  if (staleTargets.length > 0) {
    return freshnessEvaluation(["projection-output-changed"], `${staleTargets.length} target(s) render differently from the committed manifest: ${staleTargets.map((target) => target.targetId).join(", ")}`, staleTargets);
  }
  if (input.committedManifestBody !== input.renderedManifestBody) {
    return freshnessEvaluation(["projection-manifest-changed"], "every output matches its committed row, but the manifest this render writes differs from the committed bytes", []);
  }
  return freshnessEvaluation([], "every target renders the output its committed row records", []);
}

/**
 * Freshness when no current-format committed manifest exists, so nothing can be compared and no
 * render is needed to answer: the manifest is absent, or its body names no current-format manifest.
 */
export function architectureProjectionFreshnessWithoutBaseline(committedManifestBody: string | undefined): ArchitectureProjectionFreshnessEvaluation {
  return committedManifestBody === undefined
    ? freshnessEvaluation(["projection-manifest-missing"], `${ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH} is absent; nothing records what the projection rendered`, [])
    : freshnessEvaluation(["projection-manifest-unreadable"], `${ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH} is not a ${ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION} manifest`, []);
}

function freshnessEvaluation(
  reasonCodes: ArchitectureProjectionFreshnessReasonCode[],
  detail: string,
  staleTargets: ProjectionFreshnessStaleTargetV2[]
): ArchitectureProjectionFreshnessEvaluation {
  return { schemaVersion: "archcontext.projection-freshness/v3", ok: reasonCodes.length === 0, reasonCodes, detail, staleTargets };
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
 * Scale signals subtract them too (ADR-0056 §6), so no render input reads a projection output and
 * an apply reaches its fixed point in one step. Single point of truth: every consumer that needs to
 * know "did the projection write this?" derives it here, so they can never disagree.
 */
export function projectionOwnedPaths(model: NativeModel): string[] {
  return [
    "docs/architecture/**",
    ...agentContextProjectionTargetPaths(model).map((target) => target.path)
  ].sort((left, right) => left.localeCompare(right));
}

/**
 * Per-node footprint digests: for every node that declares `source.include`, the content digest of
 * the files it selects (the same include/exclude predicate `loadCapabilitySourceFootprints` feeds
 * the renderer) minus `projectionOwnedPaths`. Paths and bytes both enter the digest, so adding,
 * removing, renaming or editing a covered file moves it and nothing outside the footprint can.
 * Only Git-visible files count (`sourceFiles`); the digest reads file contents, never Git history.
 */
export function loadCapabilitySourceFootprintDigests(root: string, model: NativeModel, sourceFiles: readonly string[]): CapabilitySourceFootprintDigest[] {
  return digestCapabilitySourceFootprints(root, model, loadCapabilitySourceFootprints(root, model, sourceFiles));
}

/** `loadCapabilitySourceFootprintDigests` over footprints the caller already resolved for this run. */
export function digestCapabilitySourceFootprints(root: string, model: NativeModel, footprints: readonly CapabilitySourceFootprint[]): CapabilitySourceFootprintDigest[] {
  const ownedPathPatterns = projectionOwnedPaths(model);
  // Footprints nest (a capability's include covers its components'), so one file is read once per call.
  const fileDigests = new Map<string, string>();
  const fileDigest = (path: string) => {
    let digest = fileDigests.get(path);
    if (digest === undefined) {
      digest = sourceFileContentDigest(resolve(root, path));
      fileDigests.set(path, digest);
    }
    return digest;
  };
  return footprints.map((footprint) => {
    const files = footprint.files.filter((path) => !ownedPathPatterns.some((pattern) => matchesGlob(path, pattern)));
    return {
      nodeId: footprint.nodeId,
      fileCount: files.length,
      digest: digestJson({
        schemaVersion: "archcontext.capability-source-footprint/v1",
        files: files.map((path) => ({
          path,
          digest: fileDigest(path)
        }))
      } as unknown as Json)
    };
  });
}

/** The node shape the semantic proof reads. Projection and `flows check` both build it here. */
function semanticArchitectureNodes(model: NativeModel): SemanticArchitectureNode[] {
  return model.nodes.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    ...(entry.parent ? { parent: entry.parent } : {}),
    ...(nativeNodeSource(entry) ? { source: nativeNodeSource(entry) } : {})
  }));
}

/**
 * `archctx flows check`: every declared selector's proof status and the P2 proof of every
 * capability that declares a flow, from the same model normalization and proof code a projection
 * uses, without rendering anything.
 */
export function checkArchitectureFlowSelectors(input: {
  model: NativeModel;
  selectorEvidence: ArchitectureSelectorEvidenceV1[];
  codeGraph: ArchitectureFlowSelectorCheckV1["codeGraph"];
}): ArchitectureFlowSelectorCheckV1 {
  const model = normalizeNativeModel(input.model);
  return {
    schemaVersion: ARCHITECTURE_FLOW_SELECTOR_CHECK_SCHEMA_VERSION,
    codeGraph: input.codeGraph,
    ...checkSemanticFlowSelectors({
      nodes: semanticArchitectureNodes(model),
      relations: model.relations,
      flows: model.flows ?? [],
      evidence: input.selectorEvidence
    })
  };
}

export function normalizeNativeModel(model: NativeModel): NativeModel {
  assertOrderedLayers(model.layers, model.nodes);
  return {
    ...(model.layers === undefined ? {} : { layers: [...model.layers] }),
    nodes: [...model.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    relations: [...model.relations].sort((a, b) => a.id.localeCompare(b.id)),
    flows: [...(model.flows ?? [])].sort((a, b) => a.id.localeCompare(b.id))
  };
}

/** Mirrors the `layer` pattern in `schemas/repo/architecture-node.schema.json`. */
const ARCHITECTURE_NODE_LAYER_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Reads `node.layer` (ADR-0049). An absent layer is `undefined`; a present value that is not a
 * layer slug fails closed instead of being dropped or coerced into a group.
 */
export function nativeNodeLayer(node: Pick<NativeNode, "id" | "layer">): string | undefined {
  const layer: unknown = node.layer;
  if (layer === undefined) return undefined;
  if (typeof layer !== "string" || !ARCHITECTURE_NODE_LAYER_PATTERN.test(layer)) {
    throw new Error(`architecture-node-layer-invalid: ${node.id} (${JSON.stringify(layer)})`);
  }
  return layer;
}

export interface ArchitectureLayerGroup<TNode extends NativeNode = NativeNode> {
  layer: string;
  /** Nodes in this layer, sorted by id (`normalizeNativeModel` order). */
  nodes: TNode[];
}

export interface ArchitectureLayerGrouping<TNode extends NativeNode = NativeNode> {
  /** Layers in manifest order when declared, otherwise by name; empty with no layered nodes. */
  layers: ArchitectureLayerGroup<TNode>[];
  /** Nodes without a layer, sorted by id (`normalizeNativeModel` order). */
  ungroupedNodes: TNode[];
  layerByNodeId: ReadonlyMap<string, string>;
}

/**
 * The one layer grouping every diagram exporter renders (ADR-0049), so Mermaid, LikeC4 and
 * Structurizr cannot disagree about which node sits in which layer. Layers come only from the
 * explicit `layer` field, never from ids, names or `parent`.
 */
export function architectureLayerGroups<TNode extends NativeNode>(model: { nodes: readonly TNode[]; layers?: string[] }): ArchitectureLayerGrouping<TNode> {
  assertOrderedLayers(model.layers, model.nodes);
  const nodesByLayer = new Map<string, TNode[]>();
  const ungroupedNodes: TNode[] = [];
  const layerByNodeId = new Map<string, string>();
  for (const node of [...model.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    const layer = nativeNodeLayer(node);
    if (layer === undefined) {
      ungroupedNodes.push(node);
      continue;
    }
    const members = nodesByLayer.get(layer);
    if (members) members.push(node);
    else nodesByLayer.set(layer, [node]);
    layerByNodeId.set(node.id, layer);
  }
  const layers = [...nodesByLayer.entries()]
    .sort(([left], [right]) => model.layers ? model.layers.indexOf(left) - model.layers.indexOf(right) : left.localeCompare(right))
    .map(([layer, nodes]) => ({ layer, nodes }));
  return { layers, ungroupedNodes, layerByNodeId };
}

/**
 * Mermaid id of a layer subgraph. `mermaidId` output never contains `__` (`stableId` collapses
 * every run of separators into one), so the `layer__` prefix cannot collide with a node id.
 */
function mermaidLayerId(layer: string): string {
  return `layer__${layer.replace(/-/g, "_")}`;
}

export function exportMermaidModel(model: NativeModel): ModelExportResult {
  const normalized = normalizeNativeModel(model);
  const grouping = architectureLayerGroups(normalized);
  const nodeLine = (indent: string, node: NativeNode) => `${indent}${mermaidId(node.id)}["${escapeMermaid(node.name)}"]`;
  const lines = ["%% Generated by ArchContext. Native model remains source of truth.", "flowchart LR"];
  for (const group of grouping.layers) {
    lines.push(`  subgraph ${mermaidLayerId(group.layer)}["${escapeMermaid(group.layer)}"]`);
    for (const node of group.nodes) lines.push(nodeLine("    ", node));
    lines.push("  end");
  }
  for (const node of grouping.ungroupedNodes) lines.push(nodeLine("  ", node));
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
    ...likeC4SpecificationLines(normalized.nodes),
    "",
    "model {"
  ];
  for (const node of normalized.nodes) lines.push(`  ${mermaidId(node.id)} = ${likeC4ElementKind(node.kind)} "${escapeDsl(node.name)}"`);
  for (const relation of normalized.relations) lines.push(`  ${mermaidId(relation.source)} -> ${mermaidId(relation.target)} "${escapeDsl(relation.kind)}"`);
  lines.push("}", "", ...likeC4IndexViewLines(architectureLayerGroups(normalized), mermaidId));
  const content = `${lines.join("\n")}\n`;
  return {
    format: "likec4",
    digest: digestJson({ format: "likec4", content } as unknown as Json),
    files: [{ path: "docs/architecture/diagrams/architecture.likec4", content }]
  };
}

/**
 * The `specification` block of a LikeC4 export. A runtime topology kind (ADR-0049) is declared only
 * when the model has a node of that kind, so a model without topology keeps its exact bytes.
 */
export function likeC4SpecificationLines(nodes: readonly { kind: string }[]): string[] {
  const topologyKinds = RUNTIME_TOPOLOGY_NODE_KINDS.filter((kind) => nodes.some((node) => node.kind === kind));
  return [
    "specification {",
    "  element capability",
    "  element module",
    "  element component",
    "  element interface",
    "  element datastore",
    "  element external_system",
    ...topologyKinds.map((kind) => `  element ${kind}`),
    "}"
  ];
}

/** The LikeC4 element kind of a node kind, shared by the documentation export and `adapter-likec4`. */
export function likeC4ElementKind(kind: string): string {
  if (kind === "external-system") return "external_system";
  if (kind === "datastore") return "datastore";
  if (["capability", "module", "component", "interface"].includes(kind)) return kind;
  if (isRuntimeTopologyNodeKind(kind)) return kind;
  return "component";
}

export type ArchitectureStructurizrElementType =
  | "Software System"
  | "Container"
  | "Component"
  | "Database"
  | "External System"
  | "Deployment Node"
  | "Container Instance"
  | "Infrastructure Node";

/**
 * The Structurizr element type of a node kind, shared by the documentation export and
 * `adapter-structurizr`. A namespace nests like a deployment node, a process is a running
 * container instance and a mount is infrastructure the process sees (ADR-0049).
 */
export function architectureStructurizrElementType(kind: string): ArchitectureStructurizrElementType {
  if (kind === "capability") return "Software System";
  if (kind === "module") return "Container";
  if (kind === "datastore") return "Database";
  if (kind === "external-system") return "External System";
  if (kind === "namespace") return "Deployment Node";
  if (kind === "process") return "Container Instance";
  if (kind === "mount") return "Infrastructure Node";
  return "Component";
}

/**
 * The `views` block of a LikeC4 export. Each layer becomes a view `group` (LikeC4 grammar
 * `'group' title=String? '{' ... '}'`); groups precede `include *` because an element stays in
 * the first group that includes it. Without layers the block is the original flat view.
 */
export function likeC4IndexViewLines(grouping: ArchitectureLayerGrouping, elementId: (nodeId: string) => string): string[] {
  const groupLines = grouping.layers.flatMap((group) => [
    `    group "${escapeDsl(group.layer)}" {`,
    ...group.nodes.map((node) => `      include ${elementId(node.id)}`),
    "    }"
  ]);
  return ["views {", "  view index {", ...groupLines, "    include *", "    autoLayout TopBottom", "  }", "}"];
}

export function exportDocumentationStructurizrWorkspace(model: NativeModel): ModelExportResult {
  const normalized = normalizeNativeModel(model);
  const { layerByNodeId } = architectureLayerGroups(normalized);
  const workspace = {
    schemaVersion: "archcontext.structurizr-export/v1",
    name: "ArchContext Architecture",
    model: {
      elements: normalized.nodes.map((node) => {
        const layer = layerByNodeId.get(node.id);
        return {
          id: node.id,
          name: node.name,
          type: architectureStructurizrElementType(node.kind),
          tags: [node.kind],
          ...(layer === undefined ? {} : { group: layer })
        };
      }),
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

// --- Runtime topology view (ADR-0049) ---

/** Mirrors `namespace.type` in `schemas/repo/architecture-node.schema.json`. */
const RUNTIME_TOPOLOGY_NAMESPACE_TYPES = ["host", "container", "pod", "kubernetes", "pid", "mount", "net", "user"] as const;
export type RuntimeTopologyNamespaceType = (typeof RUNTIME_TOPOLOGY_NAMESPACE_TYPES)[number];
/** Mirrors `mount.target` in the node schema: an absolute path with no empty segment. */
const RUNTIME_TOPOLOGY_MOUNT_TARGET_PATTERN = /^\/([^/\u0000]+(\/[^/\u0000]+)*)?$/;

export interface RuntimeTopologyNamespace {
  node: NativeNode;
  type: RuntimeTopologyNamespaceType;
  /** The enclosing namespace (`parent`); validation guarantees it is a namespace. */
  parentId?: string;
  /** Directly nested namespaces, sorted by id. */
  namespaceIds: string[];
  /** Processes that `runs-in` this namespace, sorted by id. */
  processIds: string[];
}

export interface RuntimeTopologyProcess {
  node: NativeNode;
  /** The one namespace the process `runs-in`; absent for a process with none. */
  namespaceId?: string;
}

export interface RuntimeTopologyMount {
  node: NativeNode;
  source?: string;
  target: string;
  mode: "ro" | "rw";
  order: number;
}

export interface RuntimeTopologyMountStack {
  /** The process or namespace that `mounts` every mount of the stack. */
  mounterId: string;
  /** Sorted by `mount.order`, then by id. */
  mounts: RuntimeTopologyMount[];
}

/**
 * The one reading of the model both runtime topology renderers draw (ADR-0049), so the Mermaid
 * diagram and the summary page cannot disagree. Every list is sorted by id unless it says otherwise.
 */
export interface RuntimeTopologyView {
  nodesById: ReadonlyMap<string, NativeNode>;
  namespaces: RuntimeTopologyNamespace[];
  /** Namespaces without a parent. */
  rootNamespaceIds: string[];
  processes: RuntimeTopologyProcess[];
  /** One stack per mounting process or namespace, sorted by mounter id. */
  mountStacks: RuntimeTopologyMountStack[];
  /** Mounts no process or namespace mounts. */
  unmountedMounts: RuntimeTopologyMount[];
  spawns: NativeRelation[];
  mounts: NativeRelation[];
  /** `deployed-on` relations whose target is a topology node: the links to the capability view. */
  deployments: NativeRelation[];
  /** The non-topology sources of `deployments`, drawn so those links have both ends. */
  linkedNodes: NativeNode[];
}

/**
 * Reads the runtime topology of `model`. A model the shared cross-entity check
 * (`runtimeTopologyModelIssues`) reports on, or a topology node whose `namespace` or `mount` object
 * is malformed, fails closed instead of rendering a guessed placement.
 */
export function runtimeTopologyView(model: NativeModel): RuntimeTopologyView {
  const issues = runtimeTopologyModelIssues(model);
  if (issues.length > 0) {
    throw new Error(`runtime-topology-model-invalid: ${issues.map((issue) => `${issue.entityId} ${issue.field} ${issue.invariant}`).join("; ")}`);
  }
  const byId = (left: { id: string }, right: { id: string }) => compareStrings(left.id, right.id);
  const nodes = [...model.nodes].sort(byId);
  const relations = [...model.relations].sort(byId);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const namespaces = nodes.filter((node) => node.kind === "namespace").map((node): RuntimeTopologyNamespace => ({
    node,
    type: runtimeTopologyNamespaceType(node),
    ...(typeof node.parent === "string" ? { parentId: node.parent } : {}),
    namespaceIds: [],
    processIds: []
  }));
  const namespaceById = new Map(namespaces.map((namespace) => [namespace.node.id, namespace]));
  for (const namespace of namespaces) {
    if (namespace.parentId !== undefined) namespaceById.get(namespace.parentId)!.namespaceIds.push(namespace.node.id);
  }
  const namespaceByProcessId = new Map(relations.filter((relation) => relation.kind === "runs-in").map((relation) => [relation.source, relation.target]));
  const processes = nodes.filter((node) => node.kind === "process").map((node): RuntimeTopologyProcess => {
    const namespaceId = namespaceByProcessId.get(node.id);
    return namespaceId === undefined ? { node } : { node, namespaceId };
  });
  for (const topologyProcess of processes) {
    if (topologyProcess.namespaceId !== undefined) namespaceById.get(topologyProcess.namespaceId)!.processIds.push(topologyProcess.node.id);
  }
  const mounts = nodes.filter((node) => node.kind === "mount").map(runtimeTopologyMount);
  const mounterByMountId = new Map(relations.filter((relation) => relation.kind === "mounts").map((relation) => [relation.target, relation.source]));
  const stacksByMounterId = new Map<string, RuntimeTopologyMount[]>();
  for (const mount of mounts) {
    const mounterId = mounterByMountId.get(mount.node.id);
    if (mounterId === undefined) continue;
    stacksByMounterId.set(mounterId, [...(stacksByMounterId.get(mounterId) ?? []), mount]);
  }
  const mountStacks = [...stacksByMounterId.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([mounterId, stack]) => ({
      mounterId,
      mounts: stack.sort((left, right) => left.order - right.order || compareStrings(left.node.id, right.node.id))
    }));
  const deployments = relations.filter((relation) => relation.kind === "deployed-on" && isRuntimeTopologyNodeKind(nodesById.get(relation.target)?.kind));
  const linkedNodeIds = new Set<string>();
  for (const relation of deployments) {
    const source = nodesById.get(relation.source);
    if (!source) throw new Error(`runtime-topology-relation-endpoint-missing: ${relation.id} (${relation.source})`);
    if (!isRuntimeTopologyNodeKind(source.kind)) linkedNodeIds.add(source.id);
  }
  return {
    nodesById,
    namespaces,
    rootNamespaceIds: namespaces.filter((namespace) => namespace.parentId === undefined).map((namespace) => namespace.node.id),
    processes,
    mountStacks,
    unmountedMounts: mounts.filter((mount) => !mounterByMountId.has(mount.node.id)),
    spawns: relations.filter((relation) => relation.kind === "spawns"),
    mounts: relations.filter((relation) => relation.kind === "mounts"),
    deployments,
    linkedNodes: nodes.filter((node) => linkedNodeIds.has(node.id))
  };
}

function runtimeTopologyNamespaceType(node: NativeNode): RuntimeTopologyNamespaceType {
  const value = node.namespace;
  const type = value !== null && typeof value === "object" && !Array.isArray(value) ? value.type : undefined;
  if (typeof type !== "string" || !(RUNTIME_TOPOLOGY_NAMESPACE_TYPES as readonly string[]).includes(type)) {
    throw new Error(`runtime-topology-namespace-invalid: ${node.id}`);
  }
  return type as RuntimeTopologyNamespaceType;
}

function runtimeTopologyMount(node: NativeNode): RuntimeTopologyMount {
  const value = node.mount;
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`runtime-topology-mount-invalid: ${node.id}`);
  const { source, target, mode, order } = value;
  if ((source !== undefined && (typeof source !== "string" || source === ""))
    || typeof target !== "string" || !RUNTIME_TOPOLOGY_MOUNT_TARGET_PATTERN.test(target)
    || (mode !== "ro" && mode !== "rw")
    || typeof order !== "number" || !Number.isInteger(order) || order < 0) {
    throw new Error(`runtime-topology-mount-invalid: ${node.id}`);
  }
  return { node, ...(source === undefined ? {} : { source: source as string }), target, mode, order };
}

/** Mermaid id of a mount stack subgraph. `mermaidId` output never contains `__`, so it cannot collide with a node id. */
function runtimeTopologyMountStackId(mounterId: string): string {
  return `mounts__${mermaidId(mounterId)}`;
}

/** No leading `<n>.`: Mermaid reads a label that starts like a numbered list as unsupported Markdown. */
function runtimeTopologyMountLabel(mount: RuntimeTopologyMount): string {
  return `${mount.node.name} (${mount.target}, ${mount.mode}, order ${mount.order})`;
}

/**
 * The runtime topology diagram (ADR-0049): a `flowchart` whose namespaces are nested subgraphs
 * holding the processes that run in them, with one ordered stack subgraph per mounting process or
 * namespace, then `spawns`, `mounts` and topology `deployed-on` edges. Invisible links keep each
 * stack in mount order. The same model always renders the same bytes.
 */
export function exportRuntimeTopologyMermaid(model: NativeModel): ModelExportResult {
  const view = runtimeTopologyView(model);
  const namespaceById = new Map(view.namespaces.map((namespace) => [namespace.node.id, namespace]));
  const nodeLine = (indent: string, node: NativeNode, label: string = node.name) => `${indent}${mermaidId(node.id)}["${escapeMermaid(label)}"]`;
  const lines = ["%% Generated by ArchContext. Native model remains source of truth.", "flowchart TB"];
  const pushNamespace = (namespaceId: string, depth: number) => {
    const namespace = namespaceById.get(namespaceId)!;
    const indent = "  ".repeat(depth);
    lines.push(`${indent}subgraph ${mermaidId(namespaceId)}["${escapeMermaid(`${namespace.node.name} (${namespace.type})`)}"]`);
    for (const processId of namespace.processIds) lines.push(nodeLine(`${indent}  `, view.nodesById.get(processId)!));
    for (const childId of namespace.namespaceIds) pushNamespace(childId, depth + 1);
    lines.push(`${indent}end`);
  };
  for (const namespaceId of view.rootNamespaceIds) pushNamespace(namespaceId, 1);
  for (const topologyProcess of view.processes) if (topologyProcess.namespaceId === undefined) lines.push(nodeLine("  ", topologyProcess.node));
  for (const stack of view.mountStacks) {
    const mounter = view.nodesById.get(stack.mounterId)!;
    lines.push(`  subgraph ${runtimeTopologyMountStackId(stack.mounterId)}["${escapeMermaid(`Mounts: ${mounter.name}`)}"]`, "    direction TB");
    for (const mount of stack.mounts) lines.push(nodeLine("    ", mount.node, runtimeTopologyMountLabel(mount)));
    for (let index = 1; index < stack.mounts.length; index += 1) {
      lines.push(`    ${mermaidId(stack.mounts[index - 1]!.node.id)} ~~~ ${mermaidId(stack.mounts[index]!.node.id)}`);
    }
    lines.push("  end");
  }
  for (const mount of view.unmountedMounts) lines.push(nodeLine("  ", mount.node, runtimeTopologyMountLabel(mount)));
  for (const node of view.linkedNodes) lines.push(nodeLine("  ", node));
  for (const relation of [...view.spawns, ...view.mounts, ...view.deployments].sort((left, right) => compareStrings(left.id, right.id))) {
    lines.push(`  ${mermaidId(relation.source)} -->|"${escapeMermaid(relation.kind)}"| ${mermaidId(relation.target)}`);
  }
  const content = `${lines.join("\n")}\n`;
  return {
    format: "mermaid",
    digest: digestJson({ format: "mermaid", content } as unknown as Json),
    files: [{ path: RUNTIME_TOPOLOGY_DIAGRAM_PATH, content }]
  };
}

/**
 * The runtime topology summary page (ADR-0049): namespaces with their type, the processes in each,
 * every mount stack in order, the `spawns` and `deployed-on` links, and each topology node's source
 * anchors (the `source.include` patterns a reader checks by hand; no command reports a change to
 * those files, because topology rows carry no source digest, ADR-0056 §7). It links the
 * diagram the way the architecture index links the other diagrams.
 */
export function renderRuntimeTopologySummary(model: NativeModel, summaryPath: string): string {
  const view = runtimeTopologyView(model);
  const cell = (value: string) => value.replaceAll("|", "\\|");
  const named = (id: string) => {
    const node = view.nodesById.get(id);
    return `\`${id}\`${node ? ` ${cell(node.name)}` : ""}`;
  };
  const list = (ids: readonly string[]) => ids.length === 0 ? "none" : ids.map((id) => `\`${id}\``).join(", ");
  const lines = [
    "# Runtime Topology",
    "",
    "The architecture model declares this topology. No code facts verify it: archctx never reads the configuration it describes. Each node lists its `source.include` patterns for a reader to check; no command reports a change to those files.",
    "",
    `- Diagram: [Mermaid](${posix.relative(posix.dirname(summaryPath), RUNTIME_TOPOLOGY_DIAGRAM_PATH)})`,
    "",
    "## Namespaces",
    ""
  ];
  if (view.namespaces.length === 0) lines.push("- No namespaces recorded.");
  else {
    lines.push("| Namespace | Type | Parent | Namespaces | Processes |", "| --- | --- | --- | --- | --- |");
    for (const namespace of view.namespaces) {
      lines.push(`| ${named(namespace.node.id)} | ${namespace.type} | ${namespace.parentId === undefined ? "none" : `\`${namespace.parentId}\``} | ${list(namespace.namespaceIds)} | ${list(namespace.processIds)} |`);
    }
  }
  lines.push("", "## Processes", "");
  if (view.processes.length === 0) lines.push("- No processes recorded.");
  else {
    lines.push("| Process | Namespace | Spawns | Deployed here |", "| --- | --- | --- | --- |");
    for (const topologyProcess of view.processes) {
      const id = topologyProcess.node.id;
      const spawned = view.spawns.filter((relation) => relation.source === id).map((relation) => relation.target);
      const deployed = view.deployments.filter((relation) => relation.target === id).map((relation) => relation.source);
      lines.push(`| ${named(id)} | ${topologyProcess.namespaceId === undefined ? "none" : `\`${topologyProcess.namespaceId}\``} | ${list([...new Set(spawned)].sort(compareStrings))} | ${list([...new Set(deployed)].sort(compareStrings))} |`);
    }
  }
  lines.push("", "## Mount Stacks", "");
  const mountRows = (stack: readonly RuntimeTopologyMount[]) => [
    "| Order | Mount | Source | Target | Mode |",
    "| --- | --- | --- | --- | --- |",
    ...stack.map((mount) => `| ${mount.order} | ${named(mount.node.id)} | ${mount.source === undefined ? "none" : `\`${cell(mount.source)}\``} | \`${cell(mount.target)}\` | ${mount.mode} |`)
  ];
  if (view.mountStacks.length === 0 && view.unmountedMounts.length === 0) lines.push("- No mounts recorded.");
  for (const [index, stack] of view.mountStacks.entries()) {
    if (index > 0) lines.push("");
    lines.push(`### ${named(stack.mounterId)}`, "", ...mountRows(stack.mounts));
  }
  if (view.unmountedMounts.length > 0) {
    if (view.mountStacks.length > 0) lines.push("");
    lines.push("### Not mounted", "", ...mountRows(view.unmountedMounts));
  }
  const otherDeployments = view.deployments.filter((relation) => view.nodesById.get(relation.target)?.kind !== "process");
  if (otherDeployments.length > 0) {
    lines.push("", "## Other Deployments", "");
    for (const relation of otherDeployments) lines.push(`- \`${relation.source}\` -> \`${relation.target}\` — ${relation.intent}`);
  }
  lines.push("", "## Source Anchors", "", "| Node | Source |", "| --- | --- |");
  for (const node of [...view.nodesById.values()].filter((entry) => isRuntimeTopologyNodeKind(entry.kind)).sort((left, right) => compareStrings(left.id, right.id))) {
    const include = nativeNodeSource(node)?.include ?? [];
    lines.push(`| ${named(node.id)} | ${include.length === 0 ? "model-authored, no source anchor" : include.map((pattern) => `\`${cell(pattern)}\``).join(", ")} |`);
  }
  return `${lines.join("\n")}\n`;
}

export function loadNativeModelFromArchContext(root: string): NativeModel {
  const manifestPath = resolve(root, ".archcontext/manifest.yaml");
  const manifest = existsSync(manifestPath) ? parseYaml(readFileSync(manifestPath, "utf8")) as { model?: { layers?: unknown } } : undefined;
  return nativeModelFromYamlObjects({
    layers: manifest?.model?.layers,
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
  const body = files.get(".archcontext/manifest.yaml");
  const manifest = body === undefined ? undefined : parseYaml(body) as { model?: { layers?: unknown } };
  return nativeModelFromYamlObjects({ layers: manifest?.model?.layers, nodes: objects("nodes"), relations: objects("relations"), flows: objects("flows") });
}

function assertOrderedLayers(layers: unknown, nodes: readonly { id?: unknown; layer?: unknown }[]): asserts layers is string[] | undefined {
  const issues = orderedLayerIssues(layers, nodes);
  if (issues.length) throw new NativeContextError("native-context-model-invalid", { path: ".archcontext/manifest.yaml", invariant: issues[0] });
}

function nativeModelFromYamlObjects(input: { layers?: unknown; nodes: Record<string, Json>[]; relations: Record<string, Json>[]; flows: Record<string, Json>[] }): NativeModel {
  const nodes = input.nodes as NativeNode[];
  assertOrderedLayers(input.layers, nodes);
  for (const node of nodes) {
    if (node.schemaVersion !== "archcontext.node/v2") {
      throw new Error(`architecture-node-schema-version-unsupported: ${node.id || "unknown"} (${String(node.schemaVersion)})`);
    }
    assertArchitectureNodeSourceV2(node);
    nativeNodeLayer(node);
  }
  const flows = input.flows;
  for (const flow of flows) assertArchitectureFlowV1(flow);
  return {
    ...(input.layers === undefined ? {} : { layers: [...input.layers] }),
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

function architectureDocumentationTargetDrafts(
  model: NativeModel,
  layout: ArchitectureDocumentationLayout,
  docsLanguage: ArchitectureDocsLanguage | undefined
): ProjectionTargetDraft[] {
  return layout.targets.map((target) => target.type === "entity-summary"
    ? { ...target, skeleton: entitySummarySkeleton(model.nodes.find((node) => node.id === target.scope.id)!, docsLanguage) }
    : target);
}

function projectionTarget(input: ProjectionTargetDraft & {
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  sourceDigest: string;
  outputDigest: string;
}): ProjectionTargetV1 {
  const common = {
    schemaVersion: PROJECTION_TARGET_SCHEMA_VERSION,
    targetId: input.targetId,
    type: input.type,
    scope: input.scope,
    path: input.path,
    rendererVersion: input.rendererVersion,
    format: input.format,
    sourceDigest: input.sourceDigest,
    outputDigest: input.outputDigest
  };
  if (input.ownership === "generated") return { ...common, ownership: "generated" };
  return {
    ...common,
    ownership: "mixed",
    generatedRegion: {
      startMarker: generatedStartMarker(input.targetId, input.rendererVersion, input.outputDigest),
      endMarker: generatedEndMarker(input.targetId)
    }
  };
}

function renderTargetGeneratedBody(
  target: ProjectionTargetDraft,
  model: NativeModel,
  input: {
    scaleSignalsByNodeId: Map<string, CapabilitySourceScaleSignal>;
    scaleByNodeId: Map<string, ArchitectureCapabilityScaleV1>;
    semanticCompilationsByNodeId: Map<string, SemanticCapabilityDiagramCompilation>;
    stateMachines: readonly StateMachineV1[];
    decisions: ArchitectureDecisionRecord[];
    timeline: ArchitectureDocumentationTimelineEntry[];
    architectureHistory: ArchitectureHistory | undefined;
    layout: ArchitectureDocumentationLayout;
  }
): string {
  if (target.type === "architecture-index") return renderArchitectureIndex(model, input.layout);
  if (target.type === "entity-summary") {
    const node = model.nodes.find((entry) => entry.id === target.scope.id)!;
    return renderEntitySummary(node, model, {
      scaleSignal: input.scaleSignalsByNodeId.get(node.id),
      scale: input.scaleByNodeId.get(node.id),
      scaleByNodeId: input.scaleByNodeId,
      semanticCompilation: input.semanticCompilationsByNodeId.get(node.id)!,
      stateMachines: input.stateMachines.filter((machine) => machine.capabilityId === node.id)
    });
  }
  if (target.type === "relation-summary") return renderRelationSummary(model.relations.find((relation) => relation.id === target.scope.id)!, model);
  if (target.type === "decision-index") return renderDecisionIndex(input.decisions, target.path);
  if (target.type === "architecture-changelog") return renderArchitectureChangelog(input.timeline);
  if (target.type === "diagram-mermaid") return exportMermaidModel(model).files[0].content;
  if (target.type === "diagram-structurizr") return exportDocumentationStructurizrWorkspace(model).files[0].content;
  if (target.type === "diagram-likec4") return exportDocumentationLikeC4Model(model).files[0].content;
  if (target.type === "diagram-runtime-topology") return exportRuntimeTopologyMermaid(model).files[0].content;
  if (target.type === "runtime-topology-summary") return renderRuntimeTopologySummary(model, target.path);
  if (target.type === "architecture-history") return renderHistoryMarkdown(input.architectureHistory!);
  return "";
}

/** A link from `docs/architecture/index.md` to another file under `docs/architecture/`. */
function architectureIndexLink(path: string): string {
  return path.replace(/^docs\/architecture\//, "");
}

function renderArchitectureIndex(model: NativeModel, layout: ArchitectureDocumentationLayout): string {
  const lines = [
    "# Architecture Index",
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
    // Only a layout with topology targets links them, so every other index keeps its bytes (ADR-0049).
    ...layout.targets.flatMap((target) => target.type === "diagram-runtime-topology"
      ? [`- [Runtime topology Mermaid](${architectureIndexLink(target.path)})`]
      : target.type === "runtime-topology-summary" ? [`- [Runtime topology](${architectureIndexLink(target.path)})`] : []),
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
 * changed.
 */
function renderEntitySummary(
  node: NativeNode,
  model: NativeModel,
  input: {
    scaleSignal?: CapabilitySourceScaleSignal;
    /** `architectureCapabilityScale(scaleSignal)`, the buckets the document prints for this node. */
    scale?: ArchitectureCapabilityScaleV1;
    /** The measured scale of every node that declares `source.include`; components read theirs here. */
    scaleByNodeId: ReadonlyMap<string, ArchitectureCapabilityScaleV1>;
    semanticCompilation: SemanticCapabilityDiagramCompilation;
    stateMachines: readonly StateMachineV1[];
  }
): string {
  const source = nativeNodeSource(node);
  const include = source?.include ?? [];
  const entrypoints = source?.entrypoints ?? [];
  if (include.length > 0 && (!input.scaleSignal || !input.scale)) {
    throw new Error(`architecture-docs-projection-scale-signal-missing: ${node.id}`);
  }
  const incoming = model.relations.filter((relation) => relation.target === node.id);
  const outgoing = model.relations.filter((relation) => relation.source === node.id);
  const localContracts = contractFilesForNode(node);
  // Direct `component` children (#299). A node without them renders exactly as before.
  const components = model.nodes.filter((entry) => entry.parent === node.id && entry.kind === "component");
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
    ...renderComponentEntrypoints(components),
    "",
    "### 1.3 規模信號",
    "",
    ...(input.scaleSignal && input.scale
      ? [
        `- 規模量級:\`${scaleMagnitudeBucketLabel(input.scale.fileCountBucket)}\` 個文件 / \`${scaleMagnitudeBucketLabel(input.scale.lineCountBucket)}\` 行`,
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
    ...renderComponentOutboundRelations(components, model.relations),
    ...renderComponentTable(components, input.scaleByNodeId),
    "",
    "## 2. P2:端到端數據流",
    "",
    ...renderSemanticP2Section(input.semanticCompilation),
    ...renderStateMachineSection(input.stateMachines)
  ];
  return `${lines.join("\n")}\n`;
}

/** §1.2 addition for a node with components: the entrypoints each component declares (#299). */
function renderComponentEntrypoints(components: readonly NativeNode[]): string[] {
  if (components.length === 0) return [];
  const rows = components.flatMap((component) => (nativeNodeSource(component)?.entrypoints ?? []).flatMap((entry) => entry.symbols.map((symbol) =>
    `| \`${component.id}\` | \`${entry.id}\` | \`${entry.path}#${symbol.name}\` | ${symbol.sinks.map((sink) => `\`${sink.id}\` → \`${sink.path}#${sink.symbol}\``).join("、")} |`
  )));
  return [
    "",
    "組件入口:",
    "",
    ...(rows.length > 0
      ? ["| 組件 | 宣告入口 | 錨點 | 職責 |", "| --- | --- | --- | --- |", ...rows]
      : ["- 組件均未宣告 `source.entrypoints`。"])
  ];
}

/** §1.4 addition for a node with components: each component's outbound relations, grouped by component (#299). */
function renderComponentOutboundRelations(components: readonly NativeNode[], relations: readonly NativeRelation[]): string[] {
  if (components.length === 0) return [];
  return [
    "",
    "組件出向關係:",
    "",
    ...components.flatMap((component) => {
      const outgoing = relations.filter((relation) => relation.source === component.id);
      return [
        `- \`${component.id}\`:`,
        ...(outgoing.length === 0 ? ["  - 無。"] : outgoing.map((relation) => `  - \`${relation.kind}\` → \`${relation.target}\` — ${relation.intent}`))
      ];
    })
  ];
}

/**
 * §1.5 for a node with components: id, name, the 1–2–5 scale buckets of the component's own
 * declared footprint (the same measurement and buckets as §1.3) and its entrypoint ids (#299).
 */
function renderComponentTable(components: readonly NativeNode[], scaleByNodeId: ReadonlyMap<string, ArchitectureCapabilityScaleV1>): string[] {
  if (components.length === 0) return [];
  return [
    "",
    "### 1.5 組件結構",
    "",
    "| 組件 | 名稱 | 規模量級 | 宣告入口 |",
    "| --- | --- | --- | --- |",
    ...components.map((component) => {
      const source = nativeNodeSource(component);
      let scaleCell = "未宣告 `source.include`";
      if ((source?.include ?? []).length > 0) {
        const scale = scaleByNodeId.get(component.id);
        if (!scale) throw new Error(`architecture-docs-projection-scale-signal-missing: ${component.id}`);
        scaleCell = `\`${scaleMagnitudeBucketLabel(scale.fileCountBucket)}\` 個文件 / \`${scaleMagnitudeBucketLabel(scale.lineCountBucket)}\` 行`;
      }
      const entrypointIds = (source?.entrypoints ?? []).map((entry) => `\`${entry.id}\``);
      return `| \`${component.id}\` | ${component.name.replaceAll("|", "\\|")} | ${scaleCell} | ${entrypointIds.length > 0 ? entrypointIds.join("、") : "未宣告"} |`;
    })
  ];
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
function entitySummaryTitle(node: Pick<NativeNode, "id">): string {
  const segments = node.id.replace(/^capability\./, "").split(".").filter((segment) => segment !== "");
  return segments.length > 0 ? segments.join("/") : node.id;
}

/**
 * Skeleton headings per `docs.language`. The `legacy` entry is the text every release before #302
 * wrote; a repository that sets no language keeps it byte for byte. `Optimization Backlog` stays
 * the same in every language because agents and tools find the section by that heading.
 */
const ENTITY_SUMMARY_SKELETON_TEXT: Record<ArchitectureDocsLanguage | "legacy", { titleSuffix: string; p3: string; history: string }> = {
  legacy: { titleSuffix: " 架構文檔", p3: "## 3. P3:設計決策與不變量", history: "## 4. 歷史決策記錄(append-only)" },
  "zh-Hant": { titleSuffix: " 架構文檔", p3: "## 3. P3：設計決策與不變量", history: "## 4. 歷史決策記錄（append-only）" },
  "zh-Hans": { titleSuffix: " 架构文档", p3: "## 3. P3：设计决策与不变量", history: "## 4. 历史决策记录（append-only）" },
  en: { titleSuffix: " Architecture", p3: "## 3. P3: Design Decisions and Invariants", history: "## 4. Decision History (append-only)" }
};

/**
 * The scaffold of a new module document. Only a file that does not exist yet gets it, so changing
 * `docs.language` never rewrites the headings of an existing document (#302).
 */
function entitySummarySkeleton(node: Pick<NativeNode, "id">, docsLanguage: ArchitectureDocsLanguage | undefined): { prefix: string; suffix: string } {
  const text = ENTITY_SUMMARY_SKELETON_TEXT[docsLanguage ?? "legacy"];
  return {
    prefix: `# ${entitySummaryTitle(node)}${text.titleSuffix}\n\n`,
    suffix: [
      "",
      text.p3,
      "",
      text.history,
      "",
      "## Optimization Backlog",
      ""
    ].join("\n")
  };
}

/** Every skeleton the renderer can have written for one node, whatever `docs.language` was then. */
function entitySummarySkeletonVariants(node: Pick<NativeNode, "id">): { prefix: string; suffix: string }[] {
  return [undefined, ...ARCHITECTURE_DOCS_LANGUAGES].map((language) => entitySummarySkeleton(node, language));
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

function wrapGeneratedRegion(target: ProjectionMixedTargetV1, generatedBody: string): string {
  return [
    target.generatedRegion.startMarker,
    generatedBody.trimEnd(),
    target.generatedRegion.endMarker,
    ""
  ].join("\n");
}

function mergeGeneratedRegion(
  target: ProjectionMixedTargetV1,
  wrapped: string,
  existing?: string,
  skeleton?: { prefix: string; suffix: string }
): string {
  if (!existing) return skeleton ? `${skeleton.prefix}${wrapped}${skeleton.suffix}` : wrapped;
  const region = findGeneratedRegion(existing, target.targetId);
  if (!region) return `${existing.trimEnd()}\n\n${wrapped}`;
  return `${existing.slice(0, region.start)}${wrapped}${existing.slice(region.end)}`;
}

function architectureDocumentationProjectionDrift(input: {
  targets: ProjectionTargetV1[];
  expectedFiles: ArchitectureDocumentationProjectionFile[];
  expectedManifest: ArchitectureDocumentationExistingFile & { digest: string };
  /** The committed manifest the render classified against, when it is a current-format manifest. */
  previousManifest: ArchitectureDocsProjectionManifestV4 | undefined;
  existingFiles: ArchitectureDocumentationExistingFile[];
}): {
  ok: boolean;
  reasonCodes: ArchitectureDocumentationDriftReason[];
  diffs: ArchitectureDocumentationProjectionDrift[];
  orphans: ArchitectureDocumentationProjectionOrphan[];
} {
  const existingByPath = new Map(input.existingFiles.map((file) => [file.path, file]));
  const expectedByPath = new Map(input.expectedFiles.map((file) => [file.path, file]));
  const targetIds = new Set(input.targets.map((target) => target.targetId));
  const diffs: ArchitectureDocumentationProjectionDrift[] = [];
  const orphans: ArchitectureDocumentationProjectionOrphan[] = [];

  const existingManifest = existingByPath.get(input.expectedManifest.path);
  const committedEntityTargets = committedEntitySummaryTargets(input.previousManifest);
  const committedGenerated = committedGeneratedOutputs(input.previousManifest);
  const committedGeneratedByTargetId = new Map(committedGenerated.map((output) => [output.targetId, output]));
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
      // Bytes, not parsed values: the line layout is what keeps two capabilities' changes on
      // disjoint lines (`serializeArchitectureDocsProjectionManifest`), so a reformatted manifest is stale.
      if (existingManifest.body !== input.expectedManifest.body) {
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
    if (expected.target.ownership === "generated") {
      const diff = generatedFileDrift(expected, existing, committedGeneratedByTargetId.get(expected.target.targetId));
      if (diff) diffs.push(diff);
      continue;
    }
    if (expected.target.type === "agent-context") {
      const diff = agentContextRegionDrift(expected, existing);
      if (diff) diffs.push(diff);
      continue;
    }
    const region = findGeneratedRegion(existing.body, expected.target.targetId);
    if (!region) {
      diffs.push({
        path: expected.path,
        targetId: expected.target.targetId,
        reasonCode: "projection-adoption-required",
        expectedDigest: expected.digest,
        actualDigest: digestJson({ path: existing.path, body: existing.body } as unknown as Json)
      });
      continue;
    }
    // Integrity first: a region whose body no longer digests to the output its own marker records
    // holds machine text someone edited, whatever this run renders.
    const metadata = parseGeneratedRegionMetadata(region.startMarker);
    const actualGeneratedBodyDigest = digestJson({
      targetId: expected.target.targetId,
      body: `${region.body.trimEnd()}\n`
    } as unknown as Json);
    if (actualGeneratedBodyDigest !== metadata.outputDigest) {
      diffs.push({
        path: expected.path,
        targetId: expected.target.targetId,
        reasonCode: "projection-generated-region-manually-edited",
        expectedDigest: expected.generatedBodyDigest,
        actualDigest: actualGeneratedBodyDigest
      });
      continue;
    }
    // Intact, but not the marker this run writes: another renderer version, or an output this run
    // no longer renders. A document awaiting re-verification, not a hand edit.
    if (region.startMarker !== expected.target.generatedRegion.startMarker) {
      diffs.push({
        path: expected.path,
        targetId: expected.target.targetId,
        reasonCode: "projection-generated-region-stale",
        expectedDigest: expected.generatedBodyDigest,
        actualDigest: actualGeneratedBodyDigest
      });
    }
  }

  const currentPathByTargetId = new Map(input.targets.map((target) => [target.targetId, target.path]));
  const committedGeneratedByPath = new Map(committedGenerated.map((output) => [output.path, output]));
  for (const existing of input.existingFiles) {
    if (existing.path === input.expectedManifest.path || expectedByPath.has(existing.path)) continue;
    // A whole-file output is an orphan when the committed manifest records it and the current
    // layout no longer renders that target at that path. Its manifest row, not a marker, says so.
    const generated = committedGeneratedByPath.get(existing.path);
    if (generated && currentPathByTargetId.get(generated.targetId) !== generated.path) {
      const actualDigest = digestJson({ path: existing.path, body: existing.body } as unknown as Json);
      diffs.push({ path: existing.path, targetId: generated.targetId, reasonCode: "projection-orphaned", actualDigest });
      orphans.push({
        path: existing.path,
        targetId: generated.targetId,
        actualDigest,
        disposition: generatedOutputDigest(generated.targetId, existing.body) === generated.outputDigest ? "delete" : "human-review"
      });
      continue;
    }
    if (!isManagedArchitectureDocumentationMarkdownPath(existing.path)) continue;
    const region = findAnyGeneratedRegion(existing.body);
    if (region && !targetIds.has(region.targetId)) {
      const actualDigest = digestJson({ path: existing.path, body: existing.body } as unknown as Json);
      diffs.push({ path: existing.path, targetId: region.targetId, reasonCode: "projection-orphaned", actualDigest });
      orphans.push({
        path: existing.path,
        targetId: region.targetId,
        actualDigest,
        disposition: orphanHoldsOnlyIntactGeneratedRegion(existing.body, region.targetId, orphanSkeletons(committedEntityTargets, existing.path, region.targetId)) ? "delete" : "human-review"
      });
    }
  }

  // A committed agent-context row the current layout no longer renders leaves its region behind in
  // a contract file outside `docs/architecture/`. The projection writes only paths the model
  // designates, so only a human removes that region; the next apply then drops the row.
  for (const output of committedAgentContextOutputs(input.previousManifest)) {
    if (currentPathByTargetId.get(output.targetId) === output.path) continue;
    const existing = existingByPath.get(output.path);
    if (existing === undefined || findAgentContextRegion(existing.body, output.nodeId) === undefined) continue;
    const actualDigest = digestJson({ path: existing.path, body: existing.body } as unknown as Json);
    diffs.push({ path: existing.path, targetId: output.targetId, reasonCode: "projection-orphaned", actualDigest });
    orphans.push({ path: existing.path, targetId: output.targetId, actualDigest, disposition: "human-review" });
  }

  const reasonCodes = [...new Set(diffs.map((diff) => diff.reasonCode))].sort() as ArchitectureDocumentationDriftReason[];
  return {
    ok: diffs.length === 0,
    reasonCodes,
    diffs: diffs.sort((left, right) => left.path.localeCompare(right.path) || (left.targetId ?? "").localeCompare(right.targetId ?? "")),
    orphans: orphans.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  };
}

/**
 * The mixed-target rules of ADR-0047 for one node's region in a contract file, read with the
 * agent-context marker parser: a missing region is appended, an edited or stale one is rewritten.
 * A duplicate, overlapping or malformed marker throws.
 */
function agentContextRegionDrift(expected: ArchitectureDocumentationProjectionFile, existing: ArchitectureDocumentationExistingFile): ArchitectureDocumentationProjectionDrift | undefined {
  const target = expected.target as AgentContextProjectionTarget;
  const region = findAgentContextRegion(existing.body, target.scope.id);
  const base = { path: expected.path, targetId: target.targetId, expectedDigest: expected.generatedBodyDigest };
  if (region === undefined) return { ...base, reasonCode: "projection-generated-region-missing" };
  const actualDigest = agentContextRegionBodyDigest(existing.body, region, target.scope.id);
  if (actualDigest !== agentContextMarkerOutputDigest(region.startMarker)) return { ...base, reasonCode: "projection-generated-region-manually-edited", actualDigest };
  if (region.startMarker !== target.generatedRegion.startMarker) return { ...base, reasonCode: "projection-generated-region-stale", actualDigest };
  return undefined;
}

/** The digest a manifest row records for a whole-file output: the same shape as a region's `outputDigest`. */
function generatedOutputDigest(targetId: string, body: string): string {
  return digestJson({ targetId, body } as unknown as Json);
}

/**
 * Drift of one `generated` (whole-file) target. The file carries no marker, so ownership and state
 * come from the bytes and the committed manifest row: bytes equal to this run's render are fresh;
 * bytes equal to the committed row are the projection's own earlier output, stale; any other bytes
 * under a committed row were edited by hand. Without a committed row for the target at this path,
 * nothing proves the projection wrote the file, so it is not overwritten.
 */
function generatedFileDrift(
  expected: ArchitectureDocumentationProjectionFile,
  existing: ArchitectureDocumentationExistingFile,
  committed: CommittedGeneratedOutput | undefined
): ArchitectureDocumentationProjectionDrift | undefined {
  if (existing.body === expected.body) return undefined;
  const targetId = expected.target.targetId;
  const actualOutputDigest = generatedOutputDigest(targetId, existing.body);
  if (!committed || committed.path !== expected.path) {
    return {
      path: expected.path,
      targetId,
      reasonCode: "projection-ambiguous-ownership",
      expectedDigest: expected.digest,
      actualDigest: digestJson({ path: existing.path, body: existing.body } as unknown as Json)
    };
  }
  return {
    path: expected.path,
    targetId,
    reasonCode: actualOutputDigest === committed.outputDigest ? "projection-generated-file-stale" : "projection-generated-file-manually-edited",
    expectedDigest: expected.generatedBodyDigest,
    actualDigest: actualOutputDigest
  };
}

/**
 * The entity-summary targets the committed manifest records, by targetId: their path and the node
 * they document. A removed node is gone from the model, so this is where its skeleton is derived
 * from. No current-format manifest records none.
 */
function committedEntitySummaryTargets(manifest: ArchitectureDocsProjectionManifestV4 | undefined): Map<string, { path: string; nodeId: string }> {
  const targets = new Map<string, { path: string; nodeId: string }>();
  for (const [targetId, row] of Object.entries(manifest?.targets ?? {})) {
    if (row.type === "entity-summary" && typeof row.scope.id === "string") targets.set(targetId, { path: row.path, nodeId: row.scope.id });
  }
  return targets;
}

/**
 * The skeletons the renderer can have written around an orphan's region, when the manifest records
 * it as that path's entity summary: one per `docs.language`, because the document may predate a
 * change of the setting.
 */
function orphanSkeletons(
  committedEntityTargets: Map<string, { path: string; nodeId: string }>,
  path: string,
  targetId: string
): { prefix: string; suffix: string }[] {
  const committed = committedEntityTargets.get(targetId);
  return committed && committed.path === path ? entitySummarySkeletonVariants({ id: committed.nodeId }) : [];
}

/**
 * True only when deleting the orphan cannot lose human text: everything outside its one generated
 * region is whitespace or exactly one of the renderer's own skeletons for that target (title and
 * empty §3/§4/Backlog headings, #276), and the region still digests to the output its own marker
 * records (an edited region is human content). Anything else, including a missing end marker or
 * one human line in a skeleton section, is human review.
 */
function orphanHoldsOnlyIntactGeneratedRegion(body: string, targetId: string, skeletons: { prefix: string; suffix: string }[]): boolean {
  const region = findGeneratedRegion(body, targetId);
  if (!region) return false;
  const before = body.slice(0, region.start);
  const after = body.slice(region.end);
  const generatedOnly = `${before}${after}`.trim() === ""
    || skeletons.some((skeleton) => before === skeleton.prefix && after === skeleton.suffix);
  if (!generatedOnly) return false;
  const metadata = parseGeneratedRegionMetadata(region.startMarker);
  return metadata.outputDigest !== undefined
    && digestJson({ targetId, body: `${region.body.trimEnd()}\n` } as unknown as Json) === metadata.outputDigest;
}

function findGeneratedRegion(body: string, targetId: string): { start: number; end: number; startMarker: string; body: string } | undefined {
  const region = scanDocumentRegions(body, { generatedBodyLiterals: false }).generatedRegions.find(region => region.targetId === targetId && region.closed);
  if (!region) return undefined;
  const endMarker = generatedEndMarker(targetId);
  const endIndex = region.bodyEnd;
  if (!body.startsWith(endMarker, endIndex)) return undefined;
  const regionStart = region.start;
  const regionEnd = endIndex + endMarker.length + (body[endIndex + endMarker.length] === "\n" ? 1 : 0);
  const generatedBody = body.slice(region.bodyStart, endIndex).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  return { start: regionStart, end: regionEnd, startMarker: region.startMarker, body: generatedBody };
}

function findAnyGeneratedRegion(body: string): { targetId: string } | undefined {
  const region = scanDocumentRegions(body, { generatedBodyLiterals: false }).generatedRegions.find(region => region.targetId !== undefined);
  return region ? { targetId: region.targetId! } : undefined;
}

function parseGeneratedRegionMetadata(marker: string): { outputDigest?: string } {
  return { outputDigest: generatedMarkerAttributes(marker).attributes.outputDigest };
}

/**
 * Marker attributes are limited to what identifies the region and what a reader can verify against
 * the body in front of them: the target, the renderer version and the digest of the region body.
 * No source digest enters it. The model-wide digest would rewrite every repository-wide document on
 * each model change although its output did not change, and a source-footprint digest would
 * rewrite a module document every time the code under the node's footprint moved.
 */
function generatedStartMarker(
  targetId: string,
  rendererVersion: string,
  outputDigest: string
): string {
  return `${ARCHITECTURE_DOCS_GENERATED_BEGIN_PREFIX} target="${targetId}" rendererVersion="${rendererVersion}" outputDigest="${outputDigest}" -->`;
}

function generatedEndMarker(targetId: string): string {
  return `${ARCHITECTURE_DOCS_GENERATED_END_PREFIX} target="${targetId}" -->`;
}

/** The Markdown documents a `mixed` target can own a marked region in; only these are scanned for markers. */
function isManagedArchitectureDocumentationMarkdownPath(path: string): boolean {
  return /^docs\/architecture\/(modules|relations)\/.+\.md$/.test(path)
    || path === "docs/architecture/index.md"
    || path === "docs/architecture/changelog.md"
    || path === "docs/architecture/decisions/index.md";
}

function pathSegment(id: string): string {
  return stableId(id).replace(/\./g, "-");
}

function escapeDsl(value: string): string {
  return value.replace(/"/g, "'");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Agent Context Provider (ADR-0043, ADR-0056 §9) ---
//
// Projects one capability node's identity/source/extensions into a marker-owned region of each
// contract file the node designates (CLAUDE.md and AGENTS.md). This one renderer serves the
// repo-harness/v1 projection, the root-contract canonical check and `archctx agent-context`.

export const AGENT_CONTEXT_RENDERER_VERSION = CONTRACT_AGENT_CONTEXT_RENDERER_VERSION;
export const AGENT_CONTEXT_BEGIN_PREFIX = "<!-- BEGIN ARCHCONTEXT AGENT CONTEXT";
export const AGENT_CONTEXT_END_PREFIX = "<!-- END ARCHCONTEXT AGENT CONTEXT";

export interface AgentContextProjectionTargetScope {
  kind: "entity";
  id: string;
  entityKind: string;
}

export interface AgentContextProjectionTarget extends ProjectionMixedTargetV1 {
  type: "agent-context";
  scope: AgentContextProjectionTargetScope;
  format: "markdown";
}

export interface AgentContextProjectionFile {
  path: string;
  body: string;
  targets: AgentContextProjectionTarget[];
}

export interface AgentContextProjectionPlan {
  schemaVersion: "archcontext.agent-context-projection-plan/v1";
  rendererVersion: typeof AGENT_CONTEXT_RENDERER_VERSION;
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
export function loadAgentContextProjectionFiles(root: string, model: NativeModel): ProjectionOwnedFile[] {
  const paths = [...new Set(agentContextProjectionTargetPaths(model).map((target) => target.path))]
    .sort((left, right) => left.localeCompare(right));
  return paths
    .filter((path) => existsSync(resolve(root, path)))
    .map((path) => readProjectionOwnedFile(assertPathHasNoSymlinkSegments(root, path), path));
}

export function renderAgentContextProjection(input: {
  model: NativeModel;
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
    // The region reads only its node's model facts, so its body digest is both the marker's and
    // the manifest row's `outputDigest`, and the target's runtime source digest.
    const outputDigest = digestJson({ id: node.id, body: generatedBody } as unknown as Json);

    for (const { path } of derivedPaths) {
      const target: AgentContextProjectionTarget = {
        schemaVersion: PROJECTION_TARGET_SCHEMA_VERSION,
        targetId: agentContextTargetId(path, node.id),
        type: "agent-context",
        scope: { kind: "entity", id: node.id, entityKind: node.kind },
        path,
        ownership: "mixed",
        generatedRegion: {
          startMarker: agentContextStartMarker(node.id, rendererVersion, outputDigest),
          endMarker: agentContextEndMarker(node.id)
        },
        rendererVersion,
        format: "markdown",
        sourceDigest: outputDigest,
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

/**
 * The marker names the node, the renderer and the digest of the region body; no model-wide digest
 * enters it, so a model edit that leaves the body unchanged leaves the file byte-identical.
 */
function agentContextStartMarker(nodeId: string, rendererVersion: string, outputDigest: string): string {
  return `${AGENT_CONTEXT_BEGIN_PREFIX} id="${nodeId}" rendererVersion="${rendererVersion}" outputDigest="${outputDigest}" -->`;
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
  // A hand-edited region is drift the projection reports and rewrites, not an error.
  return `${existing.slice(0, region.start)}${wrapped}${existing.slice(region.end)}`;
}

/**
 * The comparison form of an agent-context target file's human text: the file with each marker-owned
 * region of `nodeIds` replaced by a fixed placeholder naming its node, through the same region parser
 * the projection writes with. Keeping the placeholder means moving a human line from one side of a
 * region to the other changes the result. A missing, duplicate, overlapping or malformed region
 * throws, so a caller can never compare text it could not delimit.
 */
export function agentContextTextOutsideRegions(body: string, nodeIds: readonly string[]): string {
  let text = body;
  for (const nodeId of [...new Set(nodeIds)].sort()) {
    const region = findAgentContextRegion(text, nodeId);
    if (!region) throw new Error(`agent-context-marker-missing: ${nodeId}`);
    text = `${text.slice(0, region.start)}\u0000archcontext-agent-context-region:${nodeId}\u0000${text.slice(region.end)}`;
  }
  return text;
}

function agentContextMarkerOutputDigest(startMarker: string): string | undefined {
  return /\boutputDigest="([^"]+)"/.exec(startMarker)?.[1];
}

/** The digest of a region's body as its marker records it: `digestJson({ id, body })`. */
function agentContextRegionBodyDigest(body: string, region: { contentStart: number; contentEnd: number }, nodeId: string): string {
  return digestJson({ id: nodeId, body: `${body.slice(region.contentStart, region.contentEnd).trimEnd()}\n` } as unknown as Json);
}

/**
 * Every agent-context marker in the file is well-formed and paired before any one node's region is
 * read: each BEGIN carries `id`, `rendererVersion` and a SHA-256 `outputDigest` (a v1 marker may also
 * carry `sourceDigest`, so it reads as stale) and is closed by the END of that id before the next
 * marker, and no id has two regions. A stray, id-less, unpaired or incomplete marker of any node
 * therefore fails closed instead of reading as a missing region or surviving a rewrite.
 */
function assertAgentContextMarkers(body: string): void {
  const marker = /<!-- (BEGIN|END) ARCHCONTEXT AGENT CONTEXT/g;
  const seen = new Set<string>();
  let open: string | undefined;
  for (let match = marker.exec(body); match !== null; match = marker.exec(body)) {
    const rest = body.slice(match.index);
    if (match[1] === "BEGIN") {
      const id = agentContextBeginMarkerId(rest);
      if (open !== undefined) throw new Error(`agent-context-marker-overlap: ${open}`);
      if (seen.has(id)) throw new Error(`agent-context-marker-duplicate: ${id}`);
      seen.add(id);
      open = id;
    } else {
      const id = /^<!-- END ARCHCONTEXT AGENT CONTEXT id="([^"]+)" -->/.exec(rest)?.[1];
      if (id === undefined || id !== open) throw new Error(`agent-context-marker-malformed: ${id ?? "an END marker names no id"}`);
      open = undefined;
    }
  }
  if (open !== undefined) throw new Error(`agent-context-marker-malformed: ${open}`);
}

const AGENT_CONTEXT_MARKER_ATTRIBUTES = new Set(["id", "sourceDigest", "rendererVersion", "outputDigest"]);

/** The id of the BEGIN marker at the start of `text`; throws unless its required attributes are present and well-formed. */
function agentContextBeginMarkerId(text: string): string {
  const marker = /^<!-- BEGIN ARCHCONTEXT AGENT CONTEXT((?: [A-Za-z]+="[^"]*")*) -->/.exec(text);
  const attributes = new Map([...(marker?.[1] ?? "").matchAll(/ ([A-Za-z]+)="([^"]*)"/g)].map((entry) => [entry[1]!, entry[2]!]));
  const id = attributes.get("id");
  if (marker === null || !id || !attributes.get("rendererVersion") || !/^sha256:[a-f0-9]{64}$/.test(attributes.get("outputDigest") ?? "")
    || [...attributes.keys()].some((key) => !AGENT_CONTEXT_MARKER_ATTRIBUTES.has(key))) {
    throw new Error(`agent-context-marker-malformed: ${id ?? "a BEGIN marker names no id"}`);
  }
  return id;
}

function findAgentContextRegion(body: string, nodeId: string): {
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  startMarker: string;
} | undefined {
  assertAgentContextMarkers(body);
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

// --- Path Ownership Resolution (ADR-0043 tie-break, parent-chain amendment) ---
//
// Single implementation of the ADR-0043 path-ownership rule, in this order:
// 1. Apply `source.exclude` first; a node with no `source.include` never participates.
// 2. Parent chain: when every candidate lies on one `parent` chain, the deepest candidate owns the
//    path. This is `deepestOnOneParentChain`, the same function the module-statistics ownership
//    index (and so `refactor scan`) calls, so the two resolvers cannot disagree on this case.
// 3. Different chains: a candidate that is an ancestor of another candidate yields to it. Among the
//    rest, the longest literal `source.include` prefix wins, and an equal-specificity tie is
//    rejected as ambiguous.
// `archctx resolve --path` and `archctx resolve --paths-from` (packages/surfaces/cli/src/main.ts)
// call this; a repo-harness adapter is expected to call the CLI rather than re-deriving it.

export type ResolveArchitectureOwnerResult =
  | { status: "matched"; node: NativeNode; owningCapabilityId: string | null }
  | { status: "no-match"; owningCapabilityId: null }
  | { status: "ambiguous"; candidates: NativeNode[]; owningCapabilityId: string | null };

export function resolveArchitectureOwnerForPath(nodes: NativeNode[], path: string): ResolveArchitectureOwnerResult {
  return resolveArchitectureOwnersForPaths(nodes, [path])[0];
}

/**
 * Resolves many paths against one node set, in input order. The globs are compiled once, so a
 * batch costs one model load instead of one process per path.
 *
 * `owningCapabilityId` is the nearest `kind: capability` node on the owner's parent chain (the
 * owner itself when it is a capability). For an ambiguous path it is set only when every
 * candidate has the same owning capability; otherwise it is `null`.
 */
export function resolveArchitectureOwnersForPaths(nodes: NativeNode[], paths: readonly string[]): ResolveArchitectureOwnerResult[] {
  const declaring = nodes.flatMap((node) => {
    const source = nativeNodeSource(node);
    const include = source?.include ?? [];
    if (include.length === 0) return [];
    return [{
      node,
      include: include.map((pattern) => ({ regex: globToRegExp(pattern), specificity: globLiteralPrefixLength(pattern) })),
      exclude: (source?.exclude ?? []).map(globToRegExp)
    }];
  });
  const parents = new Map<string, string | undefined>(nodes.map((node) => [node.id, node.parent]));
  const kinds = new Map(nodes.map((node) => [node.id, node.kind]));
  const owningCapabilityOf = (id: string): string | null => {
    for (const ancestor of ancestorChain(id, parents)) if (kinds.get(ancestor) === "capability") return ancestor;
    return null;
  };

  return paths.map((path): ResolveArchitectureOwnerResult => {
    const candidates: { node: NativeNode; specificity: number }[] = [];
    for (const entry of declaring) {
      if (entry.exclude.some((regex) => regex.test(path))) continue;
      const specificity = entry.include
        .filter((pattern) => pattern.regex.test(path))
        .reduce((max, pattern) => Math.max(max, pattern.specificity), -1);
      if (specificity >= 0) candidates.push({ node: entry.node, specificity });
    }
    if (candidates.length === 0) return { status: "no-match", owningCapabilityId: null };

    const chainOwner = deepestOnOneParentChain(candidates.map((candidate) => candidate.node.id), parents);
    if (chainOwner !== undefined) {
      const node = candidates.find((candidate) => candidate.node.id === chainOwner)!.node;
      return { status: "matched", node, owningCapabilityId: owningCapabilityOf(node.id) };
    }

    const chains = new Map(candidates.map((candidate) => [candidate.node.id, ancestorChain(candidate.node.id, parents)]));
    const isStrictAncestorOf = (ancestor: string, descendant: string): boolean =>
      ancestor !== descendant && chains.get(descendant)!.has(ancestor) && !chains.get(ancestor)!.has(descendant);
    const leaves = candidates.filter((candidate) => !candidates.some((other) => isStrictAncestorOf(candidate.node.id, other.node.id)));
    // Only a `parent` cycle (which `validate` reports) can leave no leaf; then every candidate competes.
    const contenders = leaves.length > 0 ? leaves : candidates;
    const maxSpecificity = contenders.reduce((max, candidate) => Math.max(max, candidate.specificity), -1);
    const winners = contenders.filter((candidate) => candidate.specificity === maxSpecificity).map((candidate) => candidate.node);
    if (winners.length === 1) return { status: "matched", node: winners[0], owningCapabilityId: owningCapabilityOf(winners[0].id) };
    const capabilities = new Set(winners.map((node) => owningCapabilityOf(node.id)));
    return { status: "ambiguous", candidates: winners, owningCapabilityId: capabilities.size === 1 ? [...capabilities][0] : null };
  });
}

/**
 * The parent-chain ownership rule, shared by `resolveArchitectureOwnersForPaths` and the
 * module-statistics ownership index behind `refactor scan`: when every candidate lies on one
 * `parent` chain, the deepest candidate (lowest id on a depth tie) owns the path. Returns
 * `undefined` when the candidates sit on more than one chain.
 */
export function deepestOnOneParentChain(candidateIds: readonly string[], parents: ReadonlyMap<string, string | undefined>): string | undefined {
  if (candidateIds.length === 0) return undefined;
  const depthOf = (id: string): number => ancestorChain(id, parents).size - 1;
  const deepest = candidateIds.reduce((best, id) => {
    const bestDepth = depthOf(best);
    const depth = depthOf(id);
    if (depth !== bestDepth) return depth > bestDepth ? id : best;
    return id < best ? id : best;
  });
  // Two distinct nodes at the same depth can never both sit on one chain, so the ancestor-set
  // test below already covers the depth-tie case; it needs no separate branch.
  const chain = ancestorChain(deepest, parents);
  return candidateIds.every((id) => chain.has(id)) ? deepest : undefined;
}

/** The node plus every ancestor reachable through `parent`, nearest first. A cycle or dangling parent ends the walk. */
export function ancestorChain(id: string, parents: ReadonlyMap<string, string | undefined>): Set<string> {
  const chain = new Set<string>();
  let current: string | undefined = id;
  while (current !== undefined && parents.has(current) && !chain.has(current)) {
    chain.add(current);
    current = parents.get(current);
  }
  return chain;
}

export function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(path);
}

/**
 * Compiled globs by pattern, so each distinct pattern is compiled once per process instead of once
 * per (node, file, pattern) match: recompiling dominated a projection build (#324). The regexes have
 * no `g`/`y` flag, so `test` keeps no state and one instance is safe to share. Patterns come from
 * repository models (`source.include`/`exclude`) and the paths derived from them, which a
 * long-lived daemon re-reads as they change, so the cache drops its oldest entry past a fixed size
 * instead of growing with every pattern it has ever seen.
 */
const GLOB_REGEXP_CACHE_LIMIT = 4096;
const globRegExpCache = new Map<string, RegExp>();
let globRegExpCompilations = 0;

/** Test seam: how many globs this process has compiled (cache misses), never a cache hit. */
export function globRegExpCompilationCount(): number {
  return globRegExpCompilations;
}

function globToRegExp(pattern: string): RegExp {
  const cached = globRegExpCache.get(pattern);
  if (cached !== undefined) return cached;
  const compiled = compileGlob(pattern);
  globRegExpCompilations += 1;
  if (globRegExpCache.size >= GLOB_REGEXP_CACHE_LIMIT) globRegExpCache.delete(globRegExpCache.keys().next().value!);
  globRegExpCache.set(pattern, compiled);
  return compiled;
}

function compileGlob(pattern: string): RegExp {
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
