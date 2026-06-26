import {
  RECOMMENDATION_RUN_SCHEMA_VERSION,
  RECOMMENDATION_SCHEMA_VERSION,
  digestJson,
  type ArchitectureEventSource,
  type ArchitectureRepositoryIdentityV1,
  type ArchitectureWorktreeIdentityV1,
  type Json,
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

const ACTIVE_RECOMMENDATION_STATUSES = new Set<RecommendationStatus>(["open", "acknowledged", "deferred"]);
const DEFAULT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

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
  const annotated = input.candidates.map((candidate) => {
    const fingerprint = recommendationFingerprint(candidate);
    const risk = computeRecommendationRisk(candidate.riskSignals);
    const uncertainty = computeRecommendationUncertainty(candidate);
    const level = input.triggerLevel ?? scheduleRecommendationLevel({
      source: input.triggerSource,
      risk: risk.risk,
      uncertainty: uncertainty.uncertainty,
      policyMode: input.policyMode
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
  const highestLevel = input.triggerLevel ?? selectHighestLevel(annotated.map((item) => item.level));
  const inputDigest = digestJson({
    schemaVersion: "archcontext.recommendation-run-input/v1",
    engineVersion,
    trigger: { level: highestLevel, source: input.triggerSource },
    policyMode: input.policyMode ?? "advisory",
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
    const cooldown = findActiveCooldown(input.cooldowns ?? [], item.candidate, now);
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
    const l3Eligible = isL3InvestigationEligible({
      level: item.level,
      risk: item.risk.risk,
      uncertainty: item.uncertainty.uncertainty
    });
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
        riskSignals: item.explanationTree.risk.signals,
        uncertaintySignals: item.explanationTree.uncertainty.signals,
        explanationTree: item.explanationTree as unknown as Json,
        l3InvestigationEligible: l3Eligible
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
    }))
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
    policyMode: input.policyMode ?? "advisory",
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
      cooldownMs: DEFAULT_COOLDOWN_MS
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

export function recommendationRunLedgerPayload(plan: RecommendationRunPlan): Record<string, Json> {
  return {
    recommendationRuns: [plan.run as unknown as Json],
    recommendations: plan.recommendations as unknown as Json,
    feedback: [],
    waivers: []
  };
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

function findActiveCooldown(
  cooldowns: readonly RecommendationCooldownState[],
  candidate: RecommendationSchedulerCandidate,
  now: string
): string | undefined {
  const nowMs = Date.parse(now);
  for (const cooldown of cooldowns) {
    if (cooldown.practiceId && cooldown.practiceId !== candidate.practiceId) continue;
    if (cooldown.subject && cooldown.subject !== candidate.subject) continue;
    const until = cooldown.cooldownUntil ?? new Date(Date.parse(cooldown.lastRecommendedAt) + DEFAULT_COOLDOWN_MS).toISOString();
    if (Date.parse(until) > nowMs) return until;
  }
  return undefined;
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

function digestSuffix(digest: string): string {
  return digest.replace(/^sha256:/, "").slice(0, 16);
}
