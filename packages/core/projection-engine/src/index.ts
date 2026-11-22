import {
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH,
  architectureDocsProjectionManifestSemanticState,
  architectureProjectionOutputsDigest,
  digestJson,
  type AcceptedArchitectureChangeReferenceV1,
  type ArchitectureHistory,
  type ArchitectureDigestSetV2,
  type ArchitectureDocumentationProjectionProvenanceV3,
  type Json,
  type StateMachineV1
} from "@archcontext/contracts";
import {
  ancestorChain,
  deepestOnOneParentChain,
  globLiteralPrefixLength,
  globRegExpCompilationCount,
  matchesGlob,
  modelSelectorIds,
  nativeNodeSource,
  nodeSubtreeIds,
  resolveArchitectureOwnerForPath,
  resolveArchitectureOwnersForPaths,
  sourceIncludeAnchors,
  type NativeModel,
  type NativeNode,
  type NativeNodeSource,
  type NativeRelation,
  type ResolveArchitectureOwnerResult
} from "@archcontext/core/architecture-domain";
import {
  architectureHistoryCarryForwardBlocker,
  resolveArchitectureDocumentationLayout,
  type ArchitectureProjectionProfile
} from "./layout";
import { compileSemanticCapabilityDiagrams, type ArchitectureSelectorEvidenceV1 } from "./semantic-diagrams";
import { classifyArchitectureMajorChange, compileArchitectureSemanticState } from "./major-change";
import { renderAgentContextProjection } from "./agent-context";
import { assertArchitectureDocsLanguage, semanticArchitectureNodes } from "./docs-inputs";
import { normalizeNativeModel } from "./exports-dsl";
import { architectureDocumentationTargetDrafts, projectionTarget, renderTargetGeneratedBody } from "./docs-renderer";
import {
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  type ArchitectureDecisionRecord,
  type ArchitectureDocsLanguage,
  type ArchitectureDocumentationExistingFile,
  type ArchitectureDocumentationProjectionFile,
  type ArchitectureDocumentationProjectionPlan,
  type CapabilityImportGraph,
  type CapabilitySourceScaleSignal
} from "./docs-types";
import {
  architectureCapabilityScale,
  architectureProjectionFootprintOwners,
  assertArchitectureDocumentationProjectionProvenance
} from "./footprints";
import { previousArchitectureDocsProjectionManifest } from "./freshness";
import { carriedArchitectureHistoryFile } from "./isolation";
import { assembleArchitectureDocumentationProjectionPlan } from "./plan-assembly";
import { mergeGeneratedRegion, wrapGeneratedRegion } from "./regions";

export * from "./document-regions";
export * from "./architecture-history";
export {
  ancestorChain,
  deepestOnOneParentChain,
  globLiteralPrefixLength,
  globRegExpCompilationCount,
  matchesGlob,
  modelSelectorIds,
  nativeNodeSource,
  nodeSubtreeIds,
  resolveArchitectureOwnerForPath,
  resolveArchitectureOwnersForPaths,
  sourceIncludeAnchors,
  type NativeModel,
  type NativeNode,
  type NativeNodeSource,
  type NativeRelation,
  type ResolveArchitectureOwnerResult
};
export * from "./adoption";
export * from "./layout";
export * from "./major-change";
export * from "./preview";
export * from "./prose-anchors";
export * from "./semantic-diagrams";
export * from "./agent-context";
export * from "./docs-types";
export {
  ProjectionFootprintUncoveredError,
  ProjectionManifestInvalidError,
  ProjectionManifestUpgradeRequiredError,
  ProjectionPreconditionError,
  architectureProjectionFreshnessWithoutBaseline,
  parseArchitectureDocsProjectionManifest,
  readCommittedArchitectureDocsProjectionManifest
} from "./freshness";
export {
  architectureDocumentationProjectionInputDigest,
  architectureDocumentationProjectionProvenance,
  architectureDocumentationProjectionWorktreeDigest,
  architectureDocumentationSourceTreeDigest,
  architectureProjectionFootprintOwners,
  digestArchitectureDocumentationSourceTree,
  digestCapabilitySourceFootprints,
  loadCapabilitySourceFootprintDigests,
  loadCapabilitySourceFootprints,
  loadCapabilitySourceScaleSignals,
  measureCapabilitySourceScaleSignals,
  projectionOwnedPaths,
  sourceContentDigest
} from "./footprints";
export {
  architectureDocumentationSourceDigest,
  checkArchitectureFlowSelectors,
  loadArchitectureDecisionRecords,
  loadArchitectureDocumentationFiles,
  loadArchitectureDocumentationInputs,
  loadArchitectureDocumentationLanguage,
  loadArchitectureDocumentationProfile,
  loadArchitectureProjectionInstructionsEnabled,
  parseArchitectureDocumentationProfile
} from "./docs-inputs";
export {
  architectureLayerGroups,
  architectureStructurizrElementType,
  exportDocumentationLikeC4Model,
  exportDocumentationStructurizrWorkspace,
  exportMermaidModel,
  likeC4ElementKind,
  likeC4IndexViewLines,
  likeC4SpecificationLines,
  mermaidId,
  nativeNodeLayer,
  normalizeNativeModel,
  type ArchitectureLayerGroup,
  type ArchitectureLayerGrouping,
  type ArchitectureStructurizrElementType
} from "./exports-dsl";
export * from "./runtime-topology";
export * from "./model-loader";
export { renderProjectionEntrypoints } from "./docs-sections";

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
  /**
   * When false (`--no-instructions` or `manifest.projection.instructions: false`, #642), omits
   * capability-local `agent-context` (`AGENTS.md` / `CLAUDE.md`) targets from the layout.
   */
  includeInstructions?: boolean;
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
  const layout = resolveArchitectureDocumentationLayout({
    nodes: model.nodes,
    relations: model.relations,
    profile: input.profile,
    includeInstructions: input.includeInstructions
  });
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
  // Index/diagram/decision/relation targets render no per-node measurement, so their
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
  return assembleArchitectureDocumentationProjectionPlan({
    model,
    layout,
    rendererVersion,
    sourceDigest: input.sourceDigest,
    projectionDigest,
    provenance,
    semanticState,
    architectureDigests,
    majorChange,
    previousManifest,
    rendered,
    targets,
    expectedByPath,
    existingByPath,
    existingFiles: input.existingFiles ?? [],
    selectorEvidence: input.selectorEvidence,
    footprintOwners,
    isolateBlockedCapabilities: input.isolateBlockedCapabilities,
    refreshContext: input.refreshContext
  });
}
