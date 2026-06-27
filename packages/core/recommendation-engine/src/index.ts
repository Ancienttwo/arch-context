import {
  RECOMMENDATION_FEEDBACK_SCHEMA_VERSION,
  RECOMMENDATION_RUN_SCHEMA_VERSION,
  RECOMMENDATION_SCHEMA_VERSION,
  digestJson,
  type ArchitectureEventSource,
  type ArchitectureActorKind,
  type ArchitectureRepositoryIdentityV1,
  type ArchitectureWorktreeIdentityV1,
  type Json,
  type PracticeRecommendationSchedulerPolicyV1,
  type RecommendationFeedbackV1,
  type RecommendationRunV1,
  type RecommendationV2
} from "@archcontext/contracts";

export const RECOMMENDATION_SCHEDULER_ENGINE_VERSION = "archcontext.recommendation-scheduler/v1" as const;
export const RECOMMENDATION_EXPLANATION_TREE_SCHEMA_VERSION = "archcontext.recommendation-explanation-tree/v1" as const;

export type RecommendationSchedulerLevel = RecommendationRunV1["trigger"]["level"];
export type RecommendationPolicyMode = RecommendationRunV1["policyMode"];
export type RecommendationStatus = RecommendationV2["status"];
export type RecommendationRisk = RecommendationV2["risk"];
export type RecommendationUncertainty = RecommendationV2["uncertainty"];

export type RecommendationRiskSignal =
  | "boundary-change"
  | "ownership-change"
  | "persistence-change"
  | "external-contract-change"
  | "security-domain-change"
  | "payment-domain-change"
  | "cycle-detected"
  | "migration-state-progress"
  | "hotspot-growth";

export type RecommendationUncertaintySignal =
  | "low-confidence"
  | "mapping-ambiguity"
  | "missing-evidence"
  | "partial-evidence"
  | "low-coverage"
  | "subagent-report-needed";

export interface RecommendationSchedulerCandidate {
  subject: string;
  practiceId?: string;
  confidence: RecommendationV2["confidence"];
  enforcement: RecommendationV2["enforcement"];
  evidenceBindingIds: string[];
  explanation: string[];
  baselineDigest?: string;
  riskSignals?: RecommendationRiskSignal[];
  uncertaintySignals?: RecommendationUncertaintySignal[];
  score?: number;
}

export interface RecommendationCooldownState {
  practiceId?: string;
  subject?: string;
  lastRecommendedAt: string;
  cooldownUntil?: string;
}

export interface PreviousRecommendation {
  recommendationId: string;
  fingerprint: string;
  subject: string;
  practiceId?: string;
  status: RecommendationStatus;
  updatedAt: string;
}

export interface RecommendationSuppression {
  reasonCode: "duplicate-active-fingerprint" | "cooldown-active";
  fingerprint: string;
  subject: string;
  practiceId?: string;
  previousRecommendationId?: string;
  cooldownUntil?: string;
}

export interface RecommendationRunInputCursor {
  source: "candidate-delta" | "practice-match" | "architecture-delta" | "manual";
  baseDigest?: string;
  headDigest: string;
  headSha?: string;
  changedPathDigest?: string;
  candidateDeltaDigest?: string;
}

export interface PlanRecommendationRunInput {
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  triggerSource: ArchitectureEventSource;
  triggerLevel?: RecommendationSchedulerLevel;
  policyMode?: RecommendationPolicyMode;
  schedulerPolicy?: PracticeRecommendationSchedulerPolicyV1;
  catalogDigest: string;
  inputCursor: RecommendationRunInputCursor;
  candidates: RecommendationSchedulerCandidate[];
  previousRecommendations?: PreviousRecommendation[];
  cooldowns?: RecommendationCooldownState[];
  now?: string;
  engineVersion?: string;
}

export interface RecommendationExplanationTree {
  schemaVersion: typeof RECOMMENDATION_EXPLANATION_TREE_SCHEMA_VERSION;
  trigger: {
    level: RecommendationSchedulerLevel;
    source: ArchitectureEventSource;
  };
  subject: string;
  practiceId?: string;
  evidenceBindingIds: string[];
  baselineDigest?: string;
  score: number;
  risk: {
    level: RecommendationRisk;
    signals: RecommendationRiskSignal[];
    reasonCodes: string[];
  };
  uncertainty: {
    level: RecommendationUncertainty;
    signals: RecommendationUncertaintySignal[];
    reasonCodes: string[];
  };
  policyOutcome: {
    enforcement: RecommendationV2["enforcement"];
    l3InvestigationEligible: boolean;
  };
}

export interface RecommendationRunPlan {
  run: RecommendationRunV1;
  recommendations: RecommendationV2[];
  suppressed: RecommendationSuppression[];
  investigationEligibleRecommendationIds: string[];
  inputDigest: string;
  outputDigest: string;
}

export type RecommendationLifecycleAction =
  | "acknowledge"
  | "accept"
  | "reject"
  | "defer"
  | "waive"
  | "resolve"
  | "supersede"
  | "expire"
  | "reopen";

export interface RecommendationLifecycleTransitionInput {
  action: RecommendationLifecycleAction;
  now: string;
  actor?: string;
  reason?: string;
}

export type RecommendationFeedbackAction = RecommendationFeedbackV1["action"];
export type RecommendationFeedbackSource = RecommendationFeedbackV1["actor"]["source"];

export interface CreateRecommendationFeedbackInput {
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  previous: RecommendationV2;
  next: RecommendationV2;
  action: RecommendationFeedbackAction;
  now: string;
  actorId: string;
  actorKind?: ArchitectureActorKind;
  source?: RecommendationFeedbackSource;
  reason: string;
  agentJobId?: string;
}

export interface RecommendationLifecycleMetrics {
  schemaVersion: "archcontext.recommendation-lifecycle-metrics/v1";
  generatedAt: string;
  recommendationCount: number;
  feedbackCount: number;
  activeRecommendationCount: number;
  outcomeRecommendationCount: number;
  repeatedNoiseRate: number;
  acceptedRecommendationRate: number;
  agentAssistedResolutionRate: number;
  timeToResolution: {
    resolvedRecommendationCount: number;
    averageMs: number | null;
    p50Ms: number | null;
    maxMs: number | null;
  };
  statusCounts: Record<RecommendationStatus, number>;
  signalCounts: {
    totalRecommendationSignals: number;
    repeatedNoiseSignals: number;
    acceptedRecommendations: number;
    agentAssistedResolvedRecommendations: number;
  };
  reasonCodes: string[];
}

export interface NormalizedRecommendationSchedulerPolicy {
  enabled: boolean;
  policyMode: RecommendationPolicyMode;
  frequency: {
    minIntervalMs: number;
    cooldownMs: number;
  };
  budgets: {
    maxRecommendationsPerRun: number;
    maxL3InvestigationsPerRun: number;
    maxRunsPerTask: number;
    maxRunsPerRepositoryPerDay: number;
    maxRunsPerDay: number;
  };
  reasonCodes: string[];
}

const ACTIVE_RECOMMENDATION_STATUSES = new Set<RecommendationStatus>(["open", "acknowledged", "deferred"]);
const OUTCOME_RECOMMENDATION_STATUSES = new Set<RecommendationStatus>([
  "accepted",
  "rejected",
  "waived",
  "resolved",
  "superseded",
  "expired"
]);
const DEFAULT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_RECOMMENDATION_SCHEDULER_POLICY: NormalizedRecommendationSchedulerPolicy = {
  enabled: true,
  policyMode: "advisory",
  frequency: {
    minIntervalMs: 0,
    cooldownMs: DEFAULT_COOLDOWN_MS
  },
  budgets: {
    maxRecommendationsPerRun: 25,
    maxL3InvestigationsPerRun: 1,
    maxRunsPerTask: 1,
    maxRunsPerRepositoryPerDay: 25,
    maxRunsPerDay: 100
  },
  reasonCodes: ["safe-defaults"]
};

export function normalizeRecommendationSchedulerPolicy(policy?: PracticeRecommendationSchedulerPolicyV1): NormalizedRecommendationSchedulerPolicy {
  const reasonCodes = [policy ? "repo-local-policy" : "safe-defaults"];
  const normalized = {
    enabled: policy?.enabled ?? DEFAULT_RECOMMENDATION_SCHEDULER_POLICY.enabled,
    policyMode: policy?.policyMode ?? DEFAULT_RECOMMENDATION_SCHEDULER_POLICY.policyMode,
    frequency: {
      minIntervalMs: policy?.frequency?.minIntervalMs ?? DEFAULT_RECOMMENDATION_SCHEDULER_POLICY.frequency.minIntervalMs,
      cooldownMs: policy?.frequency?.cooldownMs ?? DEFAULT_RECOMMENDATION_SCHEDULER_POLICY.frequency.cooldownMs
    },
    budgets: {
      maxRecommendationsPerRun: policy?.budgets?.maxRecommendationsPerRun ?? DEFAULT_RECOMMENDATION_SCHEDULER_POLICY.budgets.maxRecommendationsPerRun,
      maxL3InvestigationsPerRun: policy?.budgets?.maxL3InvestigationsPerRun ?? DEFAULT_RECOMMENDATION_SCHEDULER_POLICY.budgets.maxL3InvestigationsPerRun,
      maxRunsPerTask: policy?.budgets?.maxRunsPerTask ?? DEFAULT_RECOMMENDATION_SCHEDULER_POLICY.budgets.maxRunsPerTask,
      maxRunsPerRepositoryPerDay: policy?.budgets?.maxRunsPerRepositoryPerDay ?? DEFAULT_RECOMMENDATION_SCHEDULER_POLICY.budgets.maxRunsPerRepositoryPerDay,
      maxRunsPerDay: policy?.budgets?.maxRunsPerDay ?? DEFAULT_RECOMMENDATION_SCHEDULER_POLICY.budgets.maxRunsPerDay
    },
    reasonCodes
  };
  for (const [name, value] of Object.entries(normalized.frequency)) assertNonNegativeInteger(value, `frequency.${name}`);
  for (const [name, value] of Object.entries(normalized.budgets)) assertNonNegativeInteger(value, `budgets.${name}`);
  return normalized;
}

export function recommendationFingerprint(input: {
  practiceId?: string;
  subject: string;
  evidenceBindingIds: string[];
  baselineDigest?: string;
}): string {
  return digestJson({
    schemaVersion: "archcontext.recommendation-fingerprint/v1",
    practiceId: input.practiceId ?? null,
    subject: input.subject,
    evidenceBindingIds: [...input.evidenceBindingIds].sort(),
    baselineDigest: input.baselineDigest ?? null
  });
}

export function computeRecommendationRisk(signals: readonly RecommendationRiskSignal[] = []): {
  risk: RecommendationRisk;
  reasonCodes: string[];
} {
  const unique = [...new Set(signals)].sort();
  const highSignals = new Set<RecommendationRiskSignal>([
    "security-domain-change",
    "payment-domain-change",
    "external-contract-change",
    "persistence-change",
    "cycle-detected"
  ]);
  const mediumSignals = new Set<RecommendationRiskSignal>([
    "boundary-change",
    "ownership-change",
    "migration-state-progress",
    "hotspot-growth"
  ]);
  const risk = unique.some((signal) => highSignals.has(signal))
    ? "high"
    : unique.some((signal) => mediumSignals.has(signal))
      ? "medium"
      : "low";
  return {
    risk,
    reasonCodes: unique.length === 0 ? ["risk:no-material-risk-signal"] : unique.map((signal) => `risk:${signal}`)
  };
}

export function computeRecommendationUncertainty(input: {
  confidence: RecommendationV2["confidence"];
  evidenceBindingIds: readonly string[];
  uncertaintySignals?: readonly RecommendationUncertaintySignal[];
}): {
  uncertainty: RecommendationUncertainty;
  reasonCodes: string[];
} {
  const signals = new Set(input.uncertaintySignals ?? []);
  if (input.confidence === "low") signals.add("low-confidence");
  if (input.evidenceBindingIds.length === 0) signals.add("missing-evidence");
  const unique = [...signals].sort();
  const highSignals = new Set<RecommendationUncertaintySignal>([
    "low-confidence",
    "mapping-ambiguity",
    "missing-evidence",
    "subagent-report-needed"
  ]);
  const mediumSignals = new Set<RecommendationUncertaintySignal>(["partial-evidence", "low-coverage"]);
  const uncertainty = unique.some((signal) => highSignals.has(signal))
    ? "high"
    : unique.some((signal) => mediumSignals.has(signal))
      ? "medium"
      : "low";
  return {
    uncertainty,
    reasonCodes: unique.length === 0 ? ["uncertainty:evidence-bound"] : unique.map((signal) => `uncertainty:${signal}`)
  };
}

export function scheduleRecommendationLevel(input: {
  source: ArchitectureEventSource;
  risk: RecommendationRisk;
  uncertainty: RecommendationUncertainty;
  policyMode?: RecommendationPolicyMode;
}): RecommendationSchedulerLevel {
  if (input.source === "manual") return "L4";
  if (input.risk === "high" && input.uncertainty === "high") return "L3";
  if (input.risk === "high" || input.policyMode === "checkpoint") return "L2";
  if (input.source === "git_hook" || input.source === "checkpoint" || input.source === "apply_update") return "L1";
  return "L0";
}

export function isL3InvestigationEligible(input: {
  level: RecommendationSchedulerLevel;
  risk: RecommendationRisk;
  uncertainty: RecommendationUncertainty;
}): boolean {
  return input.level === "L3" && input.risk === "high" && input.uncertainty === "high";
}

export function planRecommendationRun(input: PlanRecommendationRunInput): RecommendationRunPlan {
  const now = input.now ?? new Date().toISOString();
  const engineVersion = input.engineVersion ?? RECOMMENDATION_SCHEDULER_ENGINE_VERSION;
  const schedulerPolicy = normalizeRecommendationSchedulerPolicy(input.schedulerPolicy);
  const policyMode = input.policyMode ?? schedulerPolicy.policyMode;
  const selectedCandidates = schedulerPolicy.enabled
    ? budgetRecommendationCandidates(input.candidates, schedulerPolicy.budgets.maxRecommendationsPerRun)
    : [];
  const annotated = selectedCandidates.map((candidate) => {
    const fingerprint = recommendationFingerprint(candidate);
    const risk = computeRecommendationRisk(candidate.riskSignals);
    const uncertainty = computeRecommendationUncertainty(candidate);
    const level = input.triggerLevel ?? scheduleRecommendationLevel({
      source: input.triggerSource,
      risk: risk.risk,
      uncertainty: uncertainty.uncertainty,
      policyMode
    });
    const explanationTree = buildRecommendationExplanationTree({
      candidate,
      fingerprint,
      triggerSource: input.triggerSource,
      level,
      risk,
      uncertainty
    });
    return { candidate, fingerprint, risk, uncertainty, level, explanationTree };
  });
  const highestLevel = input.triggerLevel ?? (annotated.length === 0 ? "L0" : selectHighestLevel(annotated.map((item) => item.level)));
  const inputDigest = digestJson({
    schemaVersion: "archcontext.recommendation-run-input/v1",
    engineVersion,
    trigger: { level: highestLevel, source: input.triggerSource },
    policyMode,
    schedulerPolicy,
    catalogDigest: input.catalogDigest,
    inputCursor: input.inputCursor,
    candidates: input.candidates,
    previousRecommendations: (input.previousRecommendations ?? []).map((recommendation) => ({
      fingerprint: recommendation.fingerprint,
      subject: recommendation.subject,
      practiceId: recommendation.practiceId ?? null,
      status: recommendation.status,
      updatedAt: recommendation.updatedAt
    })),
    cooldowns: input.cooldowns ?? []
  } as unknown as Json);
  const runId = `recommendation_run.${digestSuffix(inputDigest)}`;
  const previousActiveByFingerprint = new Map(
    (input.previousRecommendations ?? [])
      .filter((recommendation) => ACTIVE_RECOMMENDATION_STATUSES.has(recommendation.status))
      .map((recommendation) => [recommendation.fingerprint, recommendation])
  );
  const recommendations: RecommendationV2[] = [];
  const suppressed: RecommendationSuppression[] = [];
  const eligibleRecommendationIds: string[] = [];

  for (const item of annotated) {
    const duplicate = previousActiveByFingerprint.get(item.fingerprint);
    if (duplicate) {
      suppressed.push({
        reasonCode: "duplicate-active-fingerprint",
        fingerprint: item.fingerprint,
        subject: item.candidate.subject,
        ...(item.candidate.practiceId ? { practiceId: item.candidate.practiceId } : {}),
        previousRecommendationId: duplicate.recommendationId
      });
      continue;
    }
    const cooldown = findActiveCooldown(input.cooldowns ?? [], item.candidate, now, schedulerPolicy.frequency.cooldownMs);
    if (cooldown) {
      suppressed.push({
        reasonCode: "cooldown-active",
        fingerprint: item.fingerprint,
        subject: item.candidate.subject,
        ...(item.candidate.practiceId ? { practiceId: item.candidate.practiceId } : {}),
        cooldownUntil: cooldown
      });
      continue;
    }
    const recommendationId = `recommendation.${digestSuffix(item.fingerprint)}`;
    const rawL3Eligible = isL3InvestigationEligible({
      level: item.level,
      risk: item.risk.risk,
      uncertainty: item.uncertainty.uncertainty
    });
    const l3Eligible = rawL3Eligible && eligibleRecommendationIds.length < schedulerPolicy.budgets.maxL3InvestigationsPerRun;
    const explanationTree = l3Eligible === rawL3Eligible
      ? item.explanationTree
      : {
          ...item.explanationTree,
          policyOutcome: {
            ...item.explanationTree.policyOutcome,
            l3InvestigationEligible: false
          }
        };
    if (l3Eligible) eligibleRecommendationIds.push(recommendationId);
    recommendations.push({
      schemaVersion: RECOMMENDATION_SCHEMA_VERSION,
      recommendationId,
      runId,
      fingerprint: item.fingerprint,
      subject: item.candidate.subject,
      ...(item.candidate.practiceId ? { practiceId: item.candidate.practiceId } : {}),
      status: "open",
      confidence: item.candidate.confidence,
      enforcement: item.candidate.enforcement,
      risk: item.risk.risk,
      uncertainty: item.uncertainty.uncertainty,
      evidenceBindingIds: [...item.candidate.evidenceBindingIds].sort(),
      explanation: [...item.candidate.explanation],
      createdAt: now,
      updatedAt: now,
      extensions: {
        baselineDigest: item.candidate.baselineDigest ?? null,
        riskSignals: explanationTree.risk.signals,
        uncertaintySignals: explanationTree.uncertainty.signals,
        explanationTree: explanationTree as unknown as Json,
        l3InvestigationEligible: l3Eligible,
        l3InvestigationSuppressedByBudget: rawL3Eligible && !l3Eligible
      }
    });
  }

  const outputDigest = digestJson({
    schemaVersion: "archcontext.recommendation-run-output/v1",
    recommendationIds: recommendations.map((recommendation) => recommendation.recommendationId).sort(),
    fingerprints: recommendations.map((recommendation) => recommendation.fingerprint).sort(),
    suppressed: suppressed.map((entry) => ({
      reasonCode: entry.reasonCode,
      fingerprint: entry.fingerprint,
      subject: entry.subject,
      practiceId: entry.practiceId ?? null
    })),
    budget: {
      maxRecommendationsPerRun: schedulerPolicy.budgets.maxRecommendationsPerRun,
      inputCandidateCount: input.candidates.length,
      selectedCandidateCount: selectedCandidates.length,
      omittedCandidateCount: Math.max(0, input.candidates.length - selectedCandidates.length),
      maxL3InvestigationsPerRun: schedulerPolicy.budgets.maxL3InvestigationsPerRun,
      l3InvestigationEligibleCount: eligibleRecommendationIds.length
    }
  } as Json);
  const run: RecommendationRunV1 = {
    schemaVersion: RECOMMENDATION_RUN_SCHEMA_VERSION,
    runId,
    repository: input.repository,
    worktree: input.worktree,
    trigger: {
      level: highestLevel,
      source: input.triggerSource
    },
    engineVersion,
    catalogDigest: input.catalogDigest,
    inputDigest,
    outputDigest,
    policyMode,
    status: "succeeded",
    startedAt: now,
    completedAt: now,
    recommendationIds: recommendations.map((recommendation) => recommendation.recommendationId),
    metrics: {
      matchCount: input.candidates.length,
      evidenceBindingCount: input.candidates.reduce((sum, candidate) => sum + candidate.evidenceBindingIds.length, 0),
      unboundEvidenceCount: input.candidates.filter((candidate) => candidate.evidenceBindingIds.length === 0).length
    },
    extensions: {
      inputCursor: input.inputCursor as unknown as Json,
      suppressed: suppressed as unknown as Json,
      investigationEligibleRecommendationIds: eligibleRecommendationIds,
      schedulerLevelMatrix: "L0=status,L1=hook,L2=high-risk,L3=high-risk-high-uncertainty,L4=manual",
      cooldownMs: schedulerPolicy.frequency.cooldownMs,
      schedulerPolicy: schedulerPolicy as unknown as Json,
      schedulerBudget: {
        maxRecommendationsPerRun: schedulerPolicy.budgets.maxRecommendationsPerRun,
        inputCandidateCount: input.candidates.length,
        selectedCandidateCount: selectedCandidates.length,
        omittedCandidateCount: Math.max(0, input.candidates.length - selectedCandidates.length),
        maxL3InvestigationsPerRun: schedulerPolicy.budgets.maxL3InvestigationsPerRun,
        l3InvestigationEligibleCount: eligibleRecommendationIds.length,
        enabled: schedulerPolicy.enabled
      }
    }
  };
  return {
    run,
    recommendations,
    suppressed,
    investigationEligibleRecommendationIds: eligibleRecommendationIds,
    inputDigest,
    outputDigest
  };
}

export function transitionRecommendationLifecycle(
  recommendation: RecommendationV2,
  input: RecommendationLifecycleTransitionInput
): RecommendationV2 {
  const nextStatus = lifecycleStatus(recommendation.status, input.action);
  return {
    ...recommendation,
    status: nextStatus,
    updatedAt: input.now,
    extensions: {
      ...(recommendation.extensions ?? {}),
      lifecycle: {
        previousStatus: recommendation.status,
        status: nextStatus,
        action: input.action,
        actor: input.actor ?? null,
        reason: input.reason ?? null,
        transitionedAt: input.now
      }
    }
  };
}

export function createRecommendationFeedback(input: CreateRecommendationFeedbackInput): RecommendationFeedbackV1 {
  const idDigest = digestJson({
    schemaVersion: "archcontext.recommendation-feedback-id/v1",
    recommendationId: input.previous.recommendationId,
    runId: input.previous.runId,
    action: input.action,
    previousStatus: input.previous.status,
    nextStatus: input.next.status,
    reason: input.reason,
    actorId: input.actorId,
    actorKind: input.actorKind ?? "cli",
    createdAt: input.now,
    worktreeDigest: input.worktree.worktreeDigest
  } as unknown as Json);
  return {
    schemaVersion: RECOMMENDATION_FEEDBACK_SCHEMA_VERSION,
    feedbackId: `recommendation_feedback.${digestSuffix(idDigest)}`,
    recommendationId: input.previous.recommendationId,
    runId: input.previous.runId,
    action: input.action,
    previousStatus: input.previous.status,
    nextStatus: input.next.status,
    actor: {
      kind: input.actorKind ?? "cli",
      id: input.actorId,
      source: input.source ?? "cli"
    },
    reason: input.reason,
    explicit: true,
    implicitAcceptance: false,
    repository: input.repository,
    worktree: input.worktree,
    createdAt: input.now,
    ...(input.agentJobId ? { extensions: { agentJobId: input.agentJobId } } : {})
  };
}

export function recommendationLifecycleLedgerPayload(input: {
  recommendation: RecommendationV2;
  feedback: RecommendationFeedbackV1;
}): Record<string, Json> {
  return {
    recommendationRuns: [],
    recommendations: [input.recommendation as unknown as Json],
    feedback: [input.feedback as unknown as Json],
    waivers: []
  };
}

export function aggregateRecommendationLifecycleMetrics(input: {
  recommendationRuns?: readonly RecommendationRunV1[];
  recommendations: readonly RecommendationV2[];
  feedback?: readonly RecommendationFeedbackV1[];
  generatedAt: string;
}): RecommendationLifecycleMetrics {
  const latestRecommendations = latestRecommendationsById(input.recommendations);
  const feedback = input.feedback ?? [];
  const statusCounts = emptyStatusCounts();
  for (const recommendation of latestRecommendations) statusCounts[recommendation.status] += 1;

  const totalRecommendationSignals = recommendationSignalCount(input.recommendationRuns ?? [], latestRecommendations.length);
  const repeatedNoiseSignals =
    repeatedSuppressionCount(input.recommendationRuns ?? [])
    + feedback.filter((entry) => isRepeatedNoiseFeedback(entry)).length;
  const acceptedRecommendations = latestRecommendations.filter((recommendation) => recommendation.status === "accepted").length;
  const outcomeRecommendations = latestRecommendations.filter((recommendation) => OUTCOME_RECOMMENDATION_STATUSES.has(recommendation.status));
  const resolutionDurations = outcomeRecommendations
    .map((recommendation) => Date.parse(recommendation.updatedAt) - Date.parse(recommendation.createdAt))
    .filter((duration) => Number.isFinite(duration) && duration >= 0)
    .sort((left, right) => left - right);
  const agentAssistedResolvedIds = new Set(
    feedback
      .filter((entry) => OUTCOME_RECOMMENDATION_STATUSES.has(entry.nextStatus))
      .filter((entry) => entry.actor.kind === "subagent" || entry.actor.source === "subagent" || typeof entry.extensions?.agentJobId === "string")
      .map((entry) => entry.recommendationId)
  );
  const reasonCodes = [
    "explicit-feedback-only",
    "local-ledger-replay",
    totalRecommendationSignals === 0 ? "no-recommendation-signals" : "recommendation-signals-present",
    resolutionDurations.length === 0 ? "no-resolved-recommendations" : "resolved-recommendations-present"
  ];

  return {
    schemaVersion: "archcontext.recommendation-lifecycle-metrics/v1",
    generatedAt: input.generatedAt,
    recommendationCount: latestRecommendations.length,
    feedbackCount: feedback.length,
    activeRecommendationCount: latestRecommendations.filter((recommendation) => ACTIVE_RECOMMENDATION_STATUSES.has(recommendation.status)).length,
    outcomeRecommendationCount: outcomeRecommendations.length,
    repeatedNoiseRate: rate(repeatedNoiseSignals, totalRecommendationSignals),
    acceptedRecommendationRate: rate(acceptedRecommendations, latestRecommendations.length),
    agentAssistedResolutionRate: rate(agentAssistedResolvedIds.size, outcomeRecommendations.length),
    timeToResolution: {
      resolvedRecommendationCount: resolutionDurations.length,
      averageMs: average(resolutionDurations),
      p50Ms: percentile(resolutionDurations, 0.5),
      maxMs: resolutionDurations.at(-1) ?? null
    },
    statusCounts,
    signalCounts: {
      totalRecommendationSignals,
      repeatedNoiseSignals,
      acceptedRecommendations,
      agentAssistedResolvedRecommendations: agentAssistedResolvedIds.size
    },
    reasonCodes
  };
}

export function recommendationRunLedgerPayload(plan: RecommendationRunPlan): Record<string, Json> {
  return {
    recommendationRuns: [plan.run as unknown as Json],
    recommendations: plan.recommendations as unknown as Json,
    feedback: [],
    waivers: []
  };
}

export function isActiveRecommendationStatus(status: RecommendationStatus): boolean {
  return ACTIVE_RECOMMENDATION_STATUSES.has(status);
}

function buildRecommendationExplanationTree(input: {
  candidate: RecommendationSchedulerCandidate;
  fingerprint: string;
  triggerSource: ArchitectureEventSource;
  level: RecommendationSchedulerLevel;
  risk: ReturnType<typeof computeRecommendationRisk>;
  uncertainty: ReturnType<typeof computeRecommendationUncertainty>;
}): RecommendationExplanationTree {
  return {
    schemaVersion: RECOMMENDATION_EXPLANATION_TREE_SCHEMA_VERSION,
    trigger: {
      level: input.level,
      source: input.triggerSource
    },
    subject: input.candidate.subject,
    ...(input.candidate.practiceId ? { practiceId: input.candidate.practiceId } : {}),
    evidenceBindingIds: [...input.candidate.evidenceBindingIds].sort(),
    ...(input.candidate.baselineDigest ? { baselineDigest: input.candidate.baselineDigest } : {}),
    score: input.candidate.score ?? scoreRecommendation(input.risk.risk, input.uncertainty.uncertainty),
    risk: {
      level: input.risk.risk,
      signals: [...new Set(input.candidate.riskSignals ?? [])].sort(),
      reasonCodes: input.risk.reasonCodes
    },
    uncertainty: {
      level: input.uncertainty.uncertainty,
      signals: [...new Set(input.candidate.uncertaintySignals ?? [])].sort(),
      reasonCodes: input.uncertainty.reasonCodes
    },
    policyOutcome: {
      enforcement: input.candidate.enforcement,
      l3InvestigationEligible: isL3InvestigationEligible({
        level: input.level,
        risk: input.risk.risk,
        uncertainty: input.uncertainty.uncertainty
      })
    }
  };
}

function scoreRecommendation(risk: RecommendationRisk, uncertainty: RecommendationUncertainty): number {
  const riskScore = risk === "high" ? 3 : risk === "medium" ? 2 : 1;
  const uncertaintyScore = uncertainty === "high" ? 3 : uncertainty === "medium" ? 2 : 1;
  return riskScore * 10 + uncertaintyScore;
}

function selectHighestLevel(levels: readonly RecommendationSchedulerLevel[]): RecommendationSchedulerLevel {
  const order: RecommendationSchedulerLevel[] = ["L0", "L1", "L2", "L3", "L4"];
  return levels.reduce<RecommendationSchedulerLevel>(
    (highest, level) => order.indexOf(level) > order.indexOf(highest) ? level : highest,
    "L0"
  );
}

function budgetRecommendationCandidates(
  candidates: readonly RecommendationSchedulerCandidate[],
  maxRecommendationsPerRun: number
): RecommendationSchedulerCandidate[] {
  if (maxRecommendationsPerRun <= 0) return [];
  return [...candidates]
    .sort((left, right) =>
      (right.score ?? 0) - (left.score ?? 0)
      || left.subject.localeCompare(right.subject)
      || (left.practiceId ?? "").localeCompare(right.practiceId ?? "")
      || recommendationFingerprint(left).localeCompare(recommendationFingerprint(right))
    )
    .slice(0, maxRecommendationsPerRun);
}

function findActiveCooldown(
  cooldowns: readonly RecommendationCooldownState[],
  candidate: RecommendationSchedulerCandidate,
  now: string,
  defaultCooldownMs = DEFAULT_COOLDOWN_MS
): string | undefined {
  const nowMs = Date.parse(now);
  for (const cooldown of cooldowns) {
    if (cooldown.practiceId && cooldown.practiceId !== candidate.practiceId) continue;
    if (cooldown.subject && cooldown.subject !== candidate.subject) continue;
    const until = cooldown.cooldownUntil ?? new Date(Date.parse(cooldown.lastRecommendedAt) + defaultCooldownMs).toISOString();
    if (Date.parse(until) > nowMs) return until;
  }
  return undefined;
}

function assertNonNegativeInteger(value: number, path: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`recommendation-scheduler-policy-invalid:${path}`);
}

function lifecycleStatus(current: RecommendationStatus, action: RecommendationLifecycleAction): RecommendationStatus {
  if (action === "reopen") return "open";
  if (["resolved", "superseded", "expired"].includes(current)) {
    throw new Error(`recommendation-lifecycle-terminal-status: ${current}`);
  }
  const next: Record<Exclude<RecommendationLifecycleAction, "reopen">, RecommendationStatus> = {
    acknowledge: "acknowledged",
    accept: "accepted",
    reject: "rejected",
    defer: "deferred",
    waive: "waived",
    resolve: "resolved",
    supersede: "superseded",
    expire: "expired"
  };
  return next[action];
}

function latestRecommendationsById(recommendations: readonly RecommendationV2[]): RecommendationV2[] {
  const latest = new Map<string, RecommendationV2>();
  for (const recommendation of recommendations) {
    const current = latest.get(recommendation.recommendationId);
    if (!current || recommendation.updatedAt.localeCompare(current.updatedAt) >= 0) {
      latest.set(recommendation.recommendationId, recommendation);
    }
  }
  return [...latest.values()].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt) || left.recommendationId.localeCompare(right.recommendationId)
  );
}

function emptyStatusCounts(): Record<RecommendationStatus, number> {
  return {
    open: 0,
    acknowledged: 0,
    accepted: 0,
    rejected: 0,
    deferred: 0,
    waived: 0,
    resolved: 0,
    superseded: 0,
    expired: 0
  };
}

function recommendationSignalCount(runs: readonly RecommendationRunV1[], fallback: number): number {
  const total = runs.reduce((sum, run) => sum + run.metrics.matchCount, 0);
  return total > 0 ? total : fallback;
}

function repeatedSuppressionCount(runs: readonly RecommendationRunV1[]): number {
  let count = 0;
  for (const run of runs) {
    const suppressed = Array.isArray(run.extensions?.suppressed) ? run.extensions.suppressed : [];
    count += suppressed.filter((entry) =>
      typeof entry === "object"
      && entry !== null
      && (entry as { reasonCode?: unknown }).reasonCode === "duplicate-active-fingerprint"
    ).length;
  }
  return count;
}

function isRepeatedNoiseFeedback(feedback: RecommendationFeedbackV1): boolean {
  return (feedback.action === "reject" || feedback.action === "waive")
    && /\b(noise|duplicate|repeated)\b/i.test(feedback.reason);
}

function rate(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : Number((numerator / denominator).toFixed(6));
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values: readonly number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * percentileValue)));
  return values[index] ?? null;
}

function digestSuffix(digest: string): string {
  return digest.replace(/^sha256:/, "").slice(0, 16);
}
