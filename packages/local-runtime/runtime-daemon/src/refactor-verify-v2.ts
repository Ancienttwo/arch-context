import { execFileSync } from "node:child_process";
import {
  FailureError,
  REFACTOR_VERIFY_V2_SCHEMA_VERSION,
  digestJson,
  isCanonicalRepoRelativePosixPath,
  type Json,
  type ModuleStatisticsSnapshotV1,
  type RefactorDecisionV1,
  type RefactorObservationKind,
  type RefactorScopeV1,
  type RefactorTargetOutcomeV1,
  type RefactorVerifyV2
} from "@archcontext/contracts";
import { ancestorChain, bindRepository, type NativeNode } from "@archcontext/core/architecture-domain";
import { resolveOwnership } from "@archcontext/core/module-statistics";
import { deriveObservationOutcomes, readSnapshotMetric, type RefactorResolutionMetric } from "@archcontext/core/refactor-assessment";
import { verifySymbolKillList } from "@archcontext/local-runtime/codegraph-adapter";
import { listGitVisibleFiles, readCurrentBranch, readGitBlobTree, readHeadSha, resolveNativeGitSnapshot } from "@archcontext/local-runtime/git-adapter";
import { runtimeStatePaths } from "@archcontext/local-runtime/local-store-sqlite";
import { readRefactorDecisionSet } from "./refactor-decisions";
import { measureRefactorSnapshot, refactorWorktreeDigests } from "./refactor-scan";

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isGitCaseInsensitive(root: string): boolean {
  try {
    return execFileSync("git", ["config", "--bool", "--get", "core.ignorecase"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() === "true";
  } catch {
    return false;
  }
}

export function pureGitScope(root: string, scope: RefactorScopeV1 = { kind: "repository" }) {
  const sourceFiles = listGitVisibleFiles(root);
  const headSha = readHeadSha(root);
  const [worktreeDigest] = refactorWorktreeDigests(root, sourceFiles);
  const paths = runtimeStatePaths(root);
  const bound = bindRepository(root, headSha, sourceFiles);
  return {
    sourceFiles,
    repository: {
      repositoryId: bound.repositoryId,
      storageRepositoryId: paths.storageRepositoryId
    },
    worktree: {
      workspaceId: paths.workspaceId,
      storageWorkspaceId: paths.storageWorkspaceId,
      branch: readCurrentBranch(root),
      headSha,
      worktreeDigest
    },
    scope
  };
}

function outcomeSatisfied(outcome: RefactorTargetOutcomeV1, observed: number | null): boolean {
  switch (outcome.operator) {
    case "absent": return observed === null || observed === 0;
    case "present": return observed !== null && observed !== 0;
    case "equals": return observed !== null && outcome.value !== null && observed === outcome.value;
    case "greater_than": return observed !== null && outcome.value !== null && observed > outcome.value;
    case "less_than": return observed !== null && outcome.value !== null && observed < outcome.value;
  }
}

function baselineMetricValue(decision: RefactorDecisionV1, metric: string): number | null {
  const obs = decision.observationMetrics;
  if (!obs) return null;
  if (metric === "moduleDependencies.pairThinDirectionEdgeCount") return obs.thinDirectionEdgeCount ?? null;
  if (metric === "moduleDependencies.residualCycleMemberCount") return obs.memberCount ?? null;
  if (metric === "module.dependencyGraph.directionViolationCount") return obs.directionViolationCount ?? null;
  if (metric === "module.entrypointBypassCount") return obs.entrypointBypassCount ?? null;
  if (metric === "module.cohesion.flaggedFileCount") return obs.flaggedFileCount ?? null;
  if (metric === "module.dependencyGraph.unstableDependencyCount") return obs.unstableDependencyCount ?? null;
  if (metric === "moduleDependencies.coChangePairCount") return obs.coChangePairCount ?? null;
  if (metric === "repositorySummary.unownedFileCount") return obs.unownedFileCount ?? null;
  if (metric === "repositorySummary.unresolvedImportCount") return obs.unresolvedImportCount ?? null;
  return null;
}

function affectedModulesBlobSignature(
  root: string,
  commitSha: string,
  nodes: NativeNode[],
  memberIds: ReadonlySet<string>
): string[] | null {
  try {
    const { treeOid } = resolveNativeGitSnapshot(root, commitSha);
    const entries = readGitBlobTree(root, treeOid, { trees: false, sizes: false });
    const parents = new Map(nodes.map((node) => [node.id, node.parent]));
    const ownership = resolveOwnership(nodes, entries.map((entry) => entry.path));
    const ownedSignatures: string[] = [];
    for (const entry of entries) {
      const owners = ownership.byPath.get(entry.path)?.owners ?? [];
      const belongs = owners.some((owner) => [...ancestorChain(owner, parents)].some((id) => memberIds.has(id)));
      if (belongs) ownedSignatures.push(`${entry.path}\0${entry.objectId}`);
    }
    return ownedSignatures.sort(compareText);
  } catch {
    return null;
  }
}

function isCoChangeWindowDecay(
  root: string,
  decision: RefactorDecisionV1,
  snapshot: ModuleStatisticsSnapshotV1,
  nodes: NativeNode[]
): boolean {
  const memberIds = new Set(decision.affectedNodeIds);
  const allPresent = decision.affectedNodeIds.every((id) => snapshot.modules.some((mod) => mod.nodeId === id));
  if (!allPresent) return false;

  const afterPairEdges = snapshot.moduleDependencies
    .filter((edge) => memberIds.has(edge.fromNodeId) && memberIds.has(edge.toNodeId))
    .reduce((sum, edge) => sum + edge.distinctFileEdgeCount, 0);
  const beforePairEdges = decision.observationMetrics?.modulePairEdgeCount ?? null;
  if (beforePairEdges !== null && beforePairEdges > 0 && afterPairEdges >= beforePairEdges) {
    return true;
  }

  const baselineSig = affectedModulesBlobSignature(root, decision.provenance.headSha, nodes, memberIds);
  const currentSig = affectedModulesBlobSignature(root, snapshot.worktree.headSha, nodes, memberIds);
  const affectedFilesUnchanged =
    baselineSig === null ||
    currentSig === null ||
    (baselineSig.length === currentSig.length && baselineSig.every((value, idx) => value === currentSig[idx]));
  return affectedFilesUnchanged && afterPairEdges >= (beforePairEdges ?? 0);
}

/**
 * Pure-Git clean-clone resolution verification (`archctx verify <id> --json`, #643 Comment 1).
 * Always re-measures current HEAD live even if `.archcontext/refactor-decisions/<id>.json` already
 * claims `resolved`, keeping prior status in `historicalReceipt` and failing closed on missing baseline
 * metadata, sparse/unindexed symbol killLists, shallow git clones, or sliding-window co-change decay.
 */
export function runVerifyV2(root: string, recommendationId: string, options: { importNodeLimit?: number } = {}): RefactorVerifyV2 {
  const decisions = readRefactorDecisionSet(root);
  const decision = decisions.byId.get(recommendationId);
  if (!decision) {
    throw new FailureError("AC_REFACTOR_STALE", "recommendation-not-found", {
      recommendationId,
      searched: "recorded"
    });
  }
  const historicalReceipt = {
    status: decision.status,
    headSha: decision.provenance.headSha,
    resolutionDigest: decision.resolutionDigest ?? null
  };

  const gitScope = pureGitScope(root, decision.scope ?? { kind: "repository" });
  const hasBaselineMetadata =
    (decision.targetOutcomes !== undefined && decision.targetOutcomes.length > 0) ||
    (decision.killList !== undefined && decision.killList.length > 0) ||
    (decision.observationMetrics !== null && Object.keys(decision.observationMetrics).length > 0);

  if (!hasBaselineMetadata) {
    const blockingReasons = ["baseline-metadata-missing"];
    const body = {
      schemaVersion: REFACTOR_VERIFY_V2_SCHEMA_VERSION,
      recommendationId,
      headSha: gitScope.worktree.headSha,
      snapshotDigest: gitScope.worktree.worktreeDigest,
      disposition: "stale" as const,
      killListChecks: [],
      metricChecks: [],
      blockingReasons,
      historicalReceipt
    };
    return { ...body, resolutionDigest: digestJson(body as unknown as Json) };
  }

  const scope = decision.scope && decision.scope.kind !== "repository" ? decision.scope : undefined;
  const limit = options.importNodeLimit ?? decision.importNodeLimit;
  const measured = measureRefactorSnapshot({
    root,
    repository: gitScope.repository,
    worktree: gitScope.worktree,
    sourceFiles: gitScope.sourceFiles,
    scope,
    edgeLimit: limit
  });
  const snapshot = measured.snapshot;
  const blockingReasons = new Set<string>();

  if (snapshot.codeFacts.coverage !== "complete") {
    blockingReasons.add("after-coverage-incomplete");
  }
  if (snapshot.codeFacts.indexedWorktreeDigest !== snapshot.worktree.worktreeDigest) {
    blockingReasons.add("after-index-stale");
  }

  const outcomes: RefactorTargetOutcomeV1[] = decision.targetOutcomes && decision.targetOutcomes.length > 0
    ? decision.targetOutcomes
    : decision.kind !== null && decision.category === "structural_observation"
      ? deriveObservationOutcomes({
        kind: decision.kind as RefactorObservationKind,
        subjectSelectorId: decision.subject.subjectSelectorId,
        affectedNodeIds: decision.affectedNodeIds
      })
      : [];

  const metricChecks = outcomes.map((outcome) => {
    const after = readSnapshotMetric(
      snapshot,
      outcome.metric as RefactorResolutionMetric,
      outcome.nodeId,
      outcome.memberNodeIds
    );
    const before = baselineMetricValue(decision, outcome.metric);
    const satisfied = outcomeSatisfied(outcome, after);
    return { metric: outcome.metric, before, after, satisfied };
  });

  if (decision.kind === "co-change-coupling") {
    if (!snapshot.gitHistory || snapshot.gitHistory.coverageStatus !== "complete") {
      blockingReasons.add("git-history-incomplete");
    } else if (metricChecks.every((check) => check.after === 0) && isCoChangeWindowDecay(root, decision, snapshot, measured.model.nodes)) {
      blockingReasons.add("co-change-window-decay-without-structural-closure");
    }
  }

  const caseInsensitive = isGitCaseInsensitive(root);
  const trackedSet = new Set(measured.trackedFiles.map((file) => file.path));
  const trackedLowerSet = caseInsensitive ? new Set(measured.trackedFiles.map((file) => file.path.toLowerCase())) : undefined;
  const killList = decision.killList ?? [];
  const symbolTargets = killList.filter((entry) => entry.kind === "symbol").map((entry) => entry.target);
  const codeFactsReady =
    snapshot.codeFacts.coverage !== "unknown" &&
    snapshot.codeFacts.indexedWorktreeDigest === snapshot.worktree.worktreeDigest;
  const symbolResults = new Map(
    verifySymbolKillList(root, symbolTargets, { codeFactsReady, trackedFiles: trackedSet, caseInsensitive })
      .map((entry) => [entry.target, entry])
  );

  const killListChecks: RefactorVerifyV2["killListChecks"] = killList.map((entry) => {
    if (entry.kind === "path") {
      if (!isCanonicalRepoRelativePosixPath(entry.target)) {
        if (entry.required) blockingReasons.add("kill-list-path-noncanonical");
        return {
          kind: "path",
          target: entry.target,
          required: entry.required,
          status: "uncheckable"
        };
      }
      const present = trackedSet.has(entry.target) || (trackedLowerSet?.has(entry.target.toLowerCase()) ?? false);
      return {
        kind: "path",
        target: entry.target,
        required: entry.required,
        status: present ? "still-present" : "removed"
      };
    }
    if (entry.kind === "relation") {
      return {
        kind: "relation",
        target: entry.target,
        required: entry.required,
        status: measured.model.relations.some((relation) => relation.id === entry.target) ? "still-present" : "removed"
      };
    }
    const sym = symbolResults.get(entry.target);
    const status = sym?.status === "present" ? "still-present" : sym?.status === "absent" ? "removed" : "uncheckable";
    if (status === "uncheckable" && entry.required) {
      blockingReasons.add("kill-list-symbol-unverifiable");
    }
    return { kind: "symbol", target: entry.target, required: entry.required, status };
  });

  const requiredMetrics = metricChecks.filter((_, index) => outcomes[index]?.required !== false);
  const requiredKills = killListChecks.filter((entry) => entry.required);
  for (const check of requiredMetrics) {
    if (!check.satisfied) blockingReasons.add(`metric-unsatisfied:${check.metric}`);
  }
  for (const check of requiredKills) {
    if (check.status === "still-present") blockingReasons.add(`kill-list-present:${check.target}`);
  }

  const hasStaleReason =
    blockingReasons.has("after-coverage-incomplete") ||
    blockingReasons.has("after-index-stale") ||
    blockingReasons.has("git-history-incomplete") ||
    blockingReasons.has("co-change-window-decay-without-structural-closure") ||
    blockingReasons.has("kill-list-path-noncanonical") ||
    blockingReasons.has("kill-list-symbol-unverifiable");

  const satisfiedCount =
    requiredMetrics.filter((check) => check.satisfied).length +
    requiredKills.filter((check) => check.status === "removed").length;
  const totalRequired = requiredMetrics.length + requiredKills.length;

  let disposition: RefactorVerifyV2["disposition"];
  if (hasStaleReason || totalRequired === 0) {
    disposition = "stale";
  } else if (satisfiedCount === totalRequired) {
    disposition = "resolved";
  } else if (satisfiedCount > 0) {
    disposition = "partially_resolved";
  } else {
    disposition = "unresolved";
  }

  const sortedReasons = [...blockingReasons].sort(compareText);
  const resolutionDigest = digestJson({
    recommendationId,
    headSha: snapshot.worktree.headSha,
    snapshotDigest: snapshot.snapshotDigest,
    disposition,
    killListChecks,
    metricChecks,
    blockingReasons: sortedReasons
  } as unknown as Json);

  return {
    schemaVersion: REFACTOR_VERIFY_V2_SCHEMA_VERSION,
    recommendationId,
    headSha: snapshot.worktree.headSha,
    snapshotDigest: snapshot.snapshotDigest,
    disposition,
    resolutionDigest,
    killListChecks,
    metricChecks,
    blockingReasons: sortedReasons,
    historicalReceipt
  };
}
