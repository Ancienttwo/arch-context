import { FailureError, type AcceptedArchitectureChangeReferenceV1 } from "@archcontext/contracts";
import { repositoryFingerprint } from "@archcontext/core/architecture-domain";
import {
  architectureDocumentationProjectionWorktreeDigest,
  architectureDocumentationSourceDigest,
  loadArchitectureDocumentationInputs,
  loadArchitectureProjectionInstructionsEnabled,
  loadNativeModelFromArchContext,
  measureCapabilitySourceScaleSignals,
  renderArchitectureDocumentationProjection,
  type ArchitectureProjectionProfile,
  type ProjectionOwnedFile
} from "@archcontext/core/projection-engine";
import { loadStateMachinesFromArchContext } from "@archcontext/core/state-machine-engine";
import { assertProjectionCodeFactsAvailable, prepareArchitectureDocumentationProjectionSnapshot } from "@archcontext/local-runtime/codegraph-adapter";
import { listGitVisibleFiles, readHeadSha } from "@archcontext/local-runtime/git-adapter";
import { architectureHistoryRenderInput, type BuiltArchitectureDocsProjection } from "./projection-docs-helpers";
import { projectionWorkspaceId } from "./projection-inputs";

export * from "./projection-agent-context";
export * from "./projection-docs-helpers";
export * from "./projection-protocol-format";
export * from "./projection-slice";
export * from "./projection-validation";
export type { RuntimeAgentContextProjectionInput, RuntimeDocsProjectionInput, RuntimeProjectionInvocation } from "./runtime-types";

export type ArchitectureDocsRenderOptions = {
  rebaselineSupersededManifest?: boolean;
  isolateBlockedCapabilities?: boolean;
  indexSynced?: boolean;
  includeInstructions?: boolean;
};

export interface ProjectionCheckReadInputs {
  model(): ReturnType<typeof loadNativeModelFromArchContext>;
  machines(): ReturnType<typeof loadStateMachinesFromArchContext>;
  prepareCodeGraph(): ReturnType<typeof prepareArchitectureDocumentationProjectionSnapshot>;
}

export function buildArchitectureDocsProjection(
  _host: unknown,
  root: string,
  profile: ArchitectureProjectionProfile = "default",
  existingFilesOverride?: ProjectionOwnedFile[],
  acceptedChange?: AcceptedArchitectureChangeReferenceV1,
  options: ArchitectureDocsRenderOptions & { historyTargetNamed?: boolean } = {},
  readInputs?: ProjectionCheckReadInputs
): BuiltArchitectureDocsProjection {
  const includeInstructions = options.includeInstructions ?? loadArchitectureProjectionInstructionsEnabled(root);
  const inputs = measureArchitectureDocsProjectionInputs(
    root,
    profile,
    existingFilesOverride,
    options.historyTargetNamed === true,
    options.rebaselineSupersededManifest === true,
    readInputs,
    options.indexSynced === true,
    includeInstructions
  );
  return renderArchitectureDocsProjectionFromInputs(root, inputs, existingFilesOverride ?? inputs.loaded.existingFiles, acceptedChange, options);
}

function measureArchitectureDocsProjectionInputs(
  root: string,
  profile: ArchitectureProjectionProfile,
  existingFilesOverride: ProjectionOwnedFile[] | undefined,
  historyTargetNamed: boolean,
  rebaselineSupersededManifest: boolean,
  readInputs?: ProjectionCheckReadInputs,
  indexSynced = false,
  includeInstructions = true
) {
  const loaded = loadArchitectureDocumentationInputs(root, profile, { rebaselineSupersededManifest, model: readInputs?.model(), includeInstructions });
  const sourceDigest = architectureDocumentationSourceDigest({ model: loaded.model, profile, decisions: loaded.decisions });
  const codeGraphInputs = readInputs ? readInputs.prepareCodeGraph() : prepareArchitectureDocumentationProjectionSnapshot(root, loaded.model, indexSynced ? { indexSynced: true } : {});
  assertProjectionCodeFactsAvailable(root, codeGraphInputs);
  return {
    profile,
    includeInstructions,
    loaded,
    stateMachines: readInputs?.machines() ?? loadStateMachinesFromArchContext(root, loaded.model.nodes),
    sourceDigest,
    codeGraphInputs,
    sourceScaleSignals: measureCapabilitySourceScaleSignals(root, loaded.model, codeGraphInputs.footprints),
    ...architectureHistoryRenderInput(root, profile, existingFilesOverride ?? loaded.existingFiles, historyTargetNamed)
  };
}

export function rerenderArchitectureDocsProjection(
  root: string,
  previous: BuiltArchitectureDocsProjection,
  existingFiles: ProjectionOwnedFile[],
  acceptedChange?: AcceptedArchitectureChangeReferenceV1,
  options: ArchitectureDocsRenderOptions = {}
): BuiltArchitectureDocsProjection {
  const { inputs } = previous;
  const measured = inputs.codeGraphInputs;
  const sourceFiles = listGitVisibleFiles(root);
  if (readHeadSha(root) !== measured.runtimeSnapshot.headSha) throw new FailureError("AC_PRECONDITION_FAILED", "projection-inputs-changed-during-run", { field: "headSha" });
  if (architectureDocumentationProjectionWorktreeDigest(root, inputs.loaded.model, sourceFiles) !== measured.runtimeSnapshot.worktreeDigest) {
    throw new FailureError("AC_PRECONDITION_FAILED", "projection-inputs-changed-during-run", { field: "worktreeDigest" });
  }
  if (sourceFiles.length !== measured.sourceFiles.length || sourceFiles.some((path, index) => path !== measured.sourceFiles[index])) {
    throw new FailureError("AC_PRECONDITION_FAILED", "projection-inputs-changed-during-run", { field: "sourceFiles" });
  }
  return renderArchitectureDocsProjectionFromInputs(root, inputs, existingFiles, acceptedChange, options);
}

function renderArchitectureDocsProjectionFromInputs(
  root: string,
  inputs: ReturnType<typeof measureArchitectureDocsProjectionInputs>,
  existingFiles: ProjectionOwnedFile[],
  acceptedChange: AcceptedArchitectureChangeReferenceV1 | undefined,
  options: ArchitectureDocsRenderOptions = {}
): BuiltArchitectureDocsProjection {
  const { profile, sourceDigest, codeGraphInputs } = inputs;
  const loaded = { ...inputs.loaded, existingFiles };
  const provenance = codeGraphInputs.provenance;
  const plan = renderArchitectureDocumentationProjection({
    model: loaded.model,
    stateMachines: inputs.stateMachines,
    profile,
    decisions: loaded.decisions,
    existingFiles: loaded.existingFiles,
    docsLanguage: loaded.docsLanguage,
    sourceScaleSignals: inputs.sourceScaleSignals,
    importGraphs: codeGraphInputs.importGraphs,
    selectorEvidence: codeGraphInputs.selectorEvidence,
    provenance,
    sourceDigest,
    includeInstructions: options.includeInstructions ?? inputs.includeInstructions,
    ...(inputs.architectureHistory ? { architectureHistory: inputs.architectureHistory } : {}),
    ...(options.rebaselineSupersededManifest ? { rebaselineSupersededManifest: true } : {}),
    ...(options.isolateBlockedCapabilities ? { isolateBlockedCapabilities: true } : {}),
    refreshContext: {
      repositoryId: repositoryFingerprint(root),
      workspaceId: projectionWorkspaceId(root),
      headSha: codeGraphInputs.runtimeSnapshot.headSha,
      worktreeDigest: codeGraphInputs.runtimeSnapshot.worktreeDigest,
      ...(acceptedChange ? { acceptedChange } : {})
    }
  });
  return {
    inputs,
    loaded,
    plan,
    importEvidence: { root, sourceFiles: codeGraphInputs.sourceFiles, population: codeGraphInputs.importPopulation },
    runtimeSnapshot: codeGraphInputs.runtimeSnapshot,
    manifest: plan.manifest,
    files: [...plan.files, plan.manifest],
    snapshotEvidence: plan.proofEvidence
  };
}
