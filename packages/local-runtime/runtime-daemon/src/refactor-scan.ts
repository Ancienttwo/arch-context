import {
  REFACTOR_DECISION_DIRECTORY,
  REFACTOR_OBSERVATION_EVIDENCE_LIMIT,
  digestJson,
  refactorRequestInvariantIssues,
  type ArchitectureRepositoryIdentityV1,
  type ArchitectureWorktreeIdentityV1,
  type DependencyConstraintV1,
  type EvidenceBindingV1,
  type EvidenceItemV2,
  type Json,
  type ModuleStatisticsSnapshotV1,
  type RecommendationV3,
  type RefactorAssessmentV1,
  type RefactorProposalV1,
  type RefactorRequestV1
} from "@archcontext/contracts";
import { refactorSubjectSelectorId } from "@archcontext/core/architecture-delta";
import { computeWorktreeDigests, readDependencyConstraints } from "@archcontext/core/architecture-domain";
import type { RecommendationLedgerRecordV1 } from "@archcontext/core/architecture-ledger";
import {
  measureModuleStatistics,
  resolveOwnership,
  resolveWorkspaceSpecifier,
  type ModuleStatisticsIndexAvailability
} from "@archcontext/core/module-statistics";
import { loadNativeModelFromArchContext, nodeSubtreeIds, type NativeNode } from "@archcontext/core/projection-engine";
import { refactorRecommendationSubjectKey, type RecommendationSuppression, type RefactorCandidateBudget } from "@archcontext/core/recommendation-engine";
import { assessRefactor } from "@archcontext/core/refactor-assessment";
import {
  CODEGRAPH_IMPORT_NODE_READ_LIMIT,
  codeGraphIndexAvailable,
  packagedCodeGraphRuntimeDigest,
  pinnedCodeGraphProvider,
  readRepositoryStructuralFacts,
  repositoryImportPairs
} from "@archcontext/local-runtime/codegraph-adapter";
import {
  readGitCoChangeHistory,
  readHeadCommitterDate,
  readTrackedSourceFiles,
  readTrackedTreeEntries
} from "@archcontext/local-runtime/git-adapter";
import { listModelFiles, listNativeModelPaths } from "@archcontext/local-runtime/model-store-yaml";
import { isRefactorRecommendation, refactorStatusView, type RefactorDecisionSetV1 } from "./refactor-decisions";
import { latestRecommendationsById, planRefactorRunWithRecording, previousRecommendationsFromAuthority, type RefactorRunRecordingV1 } from "./refactor-recording";
import {
  RefactorScanError,
  declaredWorkspacePackages,
  readWorktreeFiles,
  type WorkspacePackage
} from "./refactor-scan-constraints";

export * from "./refactor-scan-constraints";

export interface RefactorScanInputV1 {
  /** The repository root; every measurement below is taken against its `HEAD`. */
  root: string;
  request: RefactorRequestV1;
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  /** The Git-visible files (`listGitVisibleFiles`) that `worktree.worktreeDigest` was computed over. */
  sourceFiles: readonly string[];
  previousRecommendations: readonly RecommendationLedgerRecordV1[];
  decisions: RefactorDecisionSetV1;
  catalogDigest: string;
}

export interface RefactorScanResultV1 {
  requestId: string;
  namespace: string;
  modelNodes: NativeNode[];
  snapshot: ModuleStatisticsSnapshotV1;
  assessment: RefactorAssessmentV1;
  proposal?: RefactorProposalV1;
  proposedRecommendations: RecommendationV3[];
  openRecommendations: RecommendationV3[];
  evidenceItems: EvidenceItemV2[];
  evidenceBindings: EvidenceBindingV1[];
  suppressed: RecommendationSuppression[];
  recording: RefactorRunRecordingV1;
  limits: RefactorScanLimitsV1;
  trackedFileCount: number;
  untrackedExcludedCount: number;
}

export interface RefactorScanLimitsV1 extends RefactorCandidateBudget {
  evidenceSampleLimit: number;
  maxEvidenceSampleLimit: number;
}

/** ADR-0046 decisions can change independently of the source and model used by an assessment. */
export function refactorWorktreeDigests(root: string, gitVisibleFiles: readonly string[]): [string, string] {
  return computeWorktreeDigests(root, gitVisibleFiles, {
    files: [...gitVisibleFiles, ...listNativeModelPaths(root)],
    options: { ignore: [REFACTOR_DECISION_DIRECTORY] }
  });
}

export function refactorRequestId(request: RefactorRequestV1): string {
  return `refactor_request.${digestJson(request as unknown as Json).slice("sha256:".length, "sha256:".length + 16)}`;
}

export function runRefactorScan(input: RefactorScanInputV1): RefactorScanResultV1 {
  const issues = refactorRequestInvariantIssues(input.request);
  if (issues.length > 0) throw new RefactorScanError("AC_SCHEMA_INVALID", issues.join("; "), "refactor-input-invalid");
  assertRequestedStateIsCurrent(input.request, input.worktree);

  const model = loadModel(input.root);
  const namespace = input.decisions.namespace;
  const constraints = readDependencyConstraints(listModelFiles(input.root)).constraints;
  const createdAt = readHeadCommitterDate(input.root);
  const requestId = refactorRequestId(input.request);
  const edgeLimit = input.request.importNodeLimit ?? CODEGRAPH_IMPORT_NODE_READ_LIMIT;

  const scope = input.request.scope.kind === "repository" ? undefined : input.request.scope;
  const workspacePackages = declaredWorkspacePackages(input.root);
  const measured = measureRefactorSnapshot({
    root: input.root,
    repository: input.repository,
    worktree: input.worktree,
    sourceFiles: input.sourceFiles,
    model,
    constraints,
    workspacePackages,
    scope,
    edgeLimit,
    createdAt
  });
  const { snapshot, structure, trackedFiles } = measured;

  let assessed: ReturnType<typeof assessRefactor>;
  try {
    assessed = assessRefactor({
      snapshot,
      structure,
      model,
      constraints,
      trackedFiles: trackedFiles.map((file) => file.path),
      request: input.request,
      requestId,
      createdAt
    });
  } catch (error) {
    throw new RefactorScanError("AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }

  let planned: ReturnType<typeof planRefactorRunWithRecording>;
  try {
    planned = planRefactorRunWithRecording({
      repository: input.repository,
      worktree: input.worktree,
      snapshot,
      assessment: assessed.assessment,
      ...(assessed.proposal ? { proposal: assessed.proposal } : {}),
      recommendationNamespace: namespace,
      decisionSetDigest: input.decisions.digest,
      previousRecommendations: previousRecommendationsFromAuthority(input.previousRecommendations, input.decisions),
      catalogDigest: input.catalogDigest,
      now: createdAt
    });
  } catch (error) {
    throw new RefactorScanError("AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }
  const { plan, recording } = planned;

  return {
    requestId,
    namespace,
    modelNodes: model.nodes,
    snapshot,
    assessment: assessed.assessment,
    ...(assessed.proposal ? { proposal: assessed.proposal } : {}),
    proposedRecommendations: plan.recommendations,
    openRecommendations: openRefactorRecommendations(input.previousRecommendations, input.decisions, measured.targetNodeIds),
    evidenceItems: plan.evidenceItems,
    evidenceBindings: plan.evidenceBindings,
    suppressed: plan.suppressed,
    recording,
    limits: {
      evidenceSampleLimit: plan.evidenceSampleLimit,
      maxEvidenceSampleLimit: REFACTOR_OBSERVATION_EVIDENCE_LIMIT,
      ...plan.candidateBudget
    },
    trackedFileCount: trackedFiles.length,
    untrackedExcludedCount: countFilesOutsideHead(input.root)
  };
}

function scanScope(
  root: string,
  nodes: NativeNode[],
  scope: NonNullable<ModuleStatisticsSnapshotV1["scope"]>,
  workspacePackages: WorkspacePackage[]
) {
  const trackedPaths = readTrackedTreeEntries(root).filter((entry) => entry.type === "blob").map((entry) => entry.path);
  const tracked = new Set(trackedPaths);
  if (scope.kind === "node" && !nodes.some((node) => node.id === scope.nodeId)) {
    throw new RefactorScanError("AC_SCHEMA_INVALID", `refactor scope node is not declared: ${scope.nodeId}`, "refactor-input-invalid");
  }
  const ownership = resolveOwnership(nodes, scope.kind === "node" ? trackedPaths : scope.paths.filter((path) => tracked.has(path)));
  const targetNodeIds = scope.kind === "node" ? nodeSubtreeIds(nodes, scope.nodeId) : new Set(ownership.filesByNode.keys());
  const paths = new Set(scope.kind === "node"
    ? [...targetNodeIds].flatMap((nodeId) => ownership.filesByNode.get(nodeId) ?? [])
    : ownership.byPath.keys());
  const incomingWorkspaceSpecifiers = workspacePackages.flatMap((pkg) => Object.keys(pkg.exports)
    .map((subpath) => subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`)
    .filter((specifier) => resolveWorkspaceSpecifier(specifier, workspacePackages, paths) !== null));
  return {
    trackedPaths,
    targetNodeIds,
    imports: {
      paths,
      incomingWorkspaceSpecifiers,
      resolveWorkspaceTarget: (specifier: string) => resolveWorkspaceSpecifier(specifier, workspacePackages, tracked)
    }
  };
}

function openRefactorRecommendations(
  recommendations: readonly RecommendationLedgerRecordV1[],
  decisions: RefactorDecisionSetV1,
  targetNodeIds: ReadonlySet<string> | undefined
): RecommendationV3[] {
  return latestRecommendationsById(recommendations).filter(isRefactorRecommendation).filter((record) => {
    const view = refactorStatusView(record, decisions);
    if (view.authority === "ledger-audit" || view.record.status !== "open") return false;
    const { affectedNodeIds } = record.payload as { affectedNodeIds: string[] };
    if (targetNodeIds && !affectedNodeIds.some((nodeId) => targetNodeIds.has(nodeId))) return false;
    const key = refactorRecommendationSubjectKey(record.category, record.subject, affectedNodeIds);
    return record.subjectSelectorId === refactorSubjectSelectorId(key.selectorKind, decisions.namespace, key.stableKey);
  });
}

function countFilesOutsideHead(root: string): number {
  const head = new Set(readTrackedTreeEntries(root).map((entry) => entry.path));
  return readWorktreeFiles(root).filter((path) => !head.has(path)).length;
}

function assertRequestedStateIsCurrent(request: RefactorRequestV1, worktree: ArchitectureWorktreeIdentityV1): void {
  if (request.expectedHeadSha !== undefined && request.expectedHeadSha !== worktree.headSha) {
    throw new RefactorScanError(
      "AC_REFACTOR_STALE",
      `refactor scan expected HEAD ${request.expectedHeadSha}, current ${worktree.headSha}`,
      "refactor-request-head-changed", { expectedHeadSha: request.expectedHeadSha, actualHeadSha: worktree.headSha }
    );
  }
  if (request.expectedWorktreeDigest !== undefined && request.expectedWorktreeDigest !== worktree.worktreeDigest) {
    throw new RefactorScanError(
      "AC_REFACTOR_STALE",
      `refactor scan expected worktree digest ${request.expectedWorktreeDigest}, current ${worktree.worktreeDigest}`,
      "refactor-request-worktree-changed", { expectedWorktreeDigest: request.expectedWorktreeDigest, actualWorktreeDigest: worktree.worktreeDigest }
    );
  }
}

function loadModel(root: string): ReturnType<typeof loadNativeModelFromArchContext> {
  let model: ReturnType<typeof loadNativeModelFromArchContext>;
  try {
    model = loadNativeModelFromArchContext(root);
  } catch (error) {
    throw new RefactorScanError(
      "AC_MODEL_ADOPTION_REQUIRED",
      `architecture model is unreadable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (model.nodes.length === 0) {
    throw new RefactorScanError("AC_MODEL_ADOPTION_REQUIRED", "architecture model declares no nodes; run archctx init");
  }
  return model;
}

interface RefactorScanCodeFactsV1 {
  pairs: { from: string; specifier: string; to: string | null; line?: number }[];
  truncated: boolean;
  importNodeCount: number | null;
  importNodeLimitExceeded: boolean;
  availability: ModuleStatisticsIndexAvailability;
  indexedWorktreeDigest: string | null;
  version: string;
  binaryDigest: string;
}

function readCodeFacts(
  root: string,
  worktreeDigest: string,
  sourceFiles: readonly string[],
  edgeLimit: number,
  scope?: NonNullable<Parameters<typeof repositoryImportPairs>[4]>["scope"]
): RefactorScanCodeFactsV1 {
  const indexed = codeGraphIndexAvailable(root);
  const imports = repositoryImportPairs(root, edgeLimit, worktreeDigest, sourceFiles, { scope });
  const attestation = indexed ? attestCodeGraphRuntime() : { version: "", binaryDigest: "" };
  return {
    pairs: imports.pairs,
    truncated: imports.truncated,
    importNodeCount: imports.importNodeCount,
    importNodeLimitExceeded: imports.importNodeLimitExceeded,
    availability: imports.availability,
    indexedWorktreeDigest: imports.indexedWorktreeDigest,
    ...attestation
  };
}

/** Shared measurement builder reused by v1 scan, v2 scan, v2 verify, and simulate without SQLite. */
export function measureRefactorSnapshot(input: {
  root: string;
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  sourceFiles: readonly string[];
  model?: ReturnType<typeof loadNativeModelFromArchContext>;
  constraints?: DependencyConstraintV1[];
  workspacePackages?: ReturnType<typeof declaredWorkspacePackages>;
  scope?: NonNullable<ModuleStatisticsSnapshotV1["scope"]>;
  edgeLimit?: number;
  createdAt?: string;
}) {
  const model = input.model ?? loadModel(input.root);
  const constraints = input.constraints ?? readDependencyConstraints(listModelFiles(input.root)).constraints;
  const workspacePackages = input.workspacePackages ?? declaredWorkspacePackages(input.root);
  const edgeLimit = input.edgeLimit ?? CODEGRAPH_IMPORT_NODE_READ_LIMIT;
  const createdAt = input.createdAt ?? readHeadCommitterDate(input.root);
  const scoped = input.scope === undefined ? undefined : scanScope(input.root, model.nodes, input.scope, workspacePackages);
  const codeFacts = readCodeFacts(input.root, input.worktree.worktreeDigest, scoped?.trackedPaths ?? input.sourceFiles, edgeLimit, scoped?.imports);
  const directImports = codeFacts.availability === "ready" ? codeFacts.pairs : [];
  const trackedFiles = readTrackedSourceFiles(input.root, scoped === undefined ? {} : {
    paths: new Set([
      ...scoped.imports.paths,
      ...directImports.flatMap((pair) => pair.to === null ? [pair.from] : [pair.from, pair.to])
    ])
  });
  const structuralFacts = codeFacts.availability === "ready" && codeFacts.indexedWorktreeDigest === input.worktree.worktreeDigest
    ? readRepositoryStructuralFacts(input.root, trackedFiles.map((file) => file.path))
    : undefined;
  const gitHistory = readGitCoChangeHistory(input.root);

  const { snapshot, structure } = measureModuleStatistics({
    model,
    scope: input.scope,
    repository: input.repository,
    worktree: input.worktree,
    trackedFiles,
    importEdges: codeFacts.pairs,
    workspacePackages,
    truncated: codeFacts.truncated,
    edgeLimit,
    importNodeCount: codeFacts.importNodeCount,
    importNodeLimitExceeded: codeFacts.importNodeLimitExceeded,
    codeFacts: {
      version: codeFacts.version,
      binaryDigest: codeFacts.binaryDigest,
      availability: codeFacts.availability,
      indexedWorktreeDigest: codeFacts.indexedWorktreeDigest
    },
    constraints,
    ...(structuralFacts ? { structuralFacts } : {}),
    gitHistory,
    createdAt
  });

  return {
    model,
    constraints,
    workspacePackages,
    codeFacts,
    trackedFiles,
    edgeLimit,
    createdAt,
    snapshot,
    structure,
    targetNodeIds: scoped?.targetNodeIds
  };
}

function attestCodeGraphRuntime(): { version: string; binaryDigest: string } {
  return { version: pinnedCodeGraphProvider().version, binaryDigest: packagedCodeGraphRuntimeDigest() };
}
