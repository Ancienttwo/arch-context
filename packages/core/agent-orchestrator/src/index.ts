import {
  AGENT_JOB_SCHEMA_VERSION,
  digestJson,
  type AgentJobV1,
  type ArchitectureEventSource,
  type ArchitectureRepositoryIdentityV1,
  type ArchitectureWorktreeIdentityV1,
  type InvestigationContextBundle,
  type InvestigationContextRisk,
  type InvestigationContextUncertainty,
  type InvestigationReportV1,
  type InvestigationRunnerPort,
  type Json
} from "@archcontext/contracts";

export const AGENT_ORCHESTRATION_POLICY_SCHEMA_VERSION = "archcontext.agent-orchestration-policy/v1" as const;

export type AgentJobStatus = AgentJobV1["status"];
export type AgentRunnerPortId = AgentJobV1["runnerPort"];
export type AgentTriggerMode = "automatic" | "manual";

export type AgentSpawnBlockReason =
  | "policy-disabled"
  | "deterministic-analysis-missing"
  | "risk-below-investigation-threshold"
  | "low-risk-automatic-spawn-disabled"
  | "uncertainty-below-investigation-threshold"
  | "equivalent-job-exists"
  | "task-budget-exhausted"
  | "repository-daily-budget-exhausted"
  | "daily-budget-exhausted"
  | "cooldown-active"
  | "adapter-disabled";

export interface AgentOrchestrationPolicy {
  schemaVersion: typeof AGENT_ORCHESTRATION_POLICY_SCHEMA_VERSION;
  enabled: boolean;
  adapterEnabled: boolean;
  maxRunsPerTask: number;
  maxRunsPerRepositoryPerDay: number;
  maxRunsPerDay: number;
  maxAutomaticRunsForLowRisk: number;
  cooldownMs: number;
}

export interface AgentSpawnBudgetUsage {
  taskRuns: number;
  repositoryRunsToday: number;
  totalRunsToday: number;
  automaticLowRiskRunsForTask?: number;
}

export interface EquivalentAgentJob {
  fingerprint: string;
  status: AgentJobStatus;
}

export interface AgentSpawnEligibilityInput {
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  taskSessionId: string;
  fingerprint: string;
  trigger: {
    source: ArchitectureEventSource;
    reason: string;
  };
  risk: InvestigationContextRisk;
  uncertainty: InvestigationContextUncertainty;
  deterministicAnalysisFound: boolean;
  policyRequestedInvestigation?: boolean;
  documentationSynthesisUseful?: boolean;
  triggerMode?: AgentTriggerMode;
  existingJobs?: EquivalentAgentJob[];
  budgetUsage: AgentSpawnBudgetUsage;
  lastSpawnedAt?: string;
  now: string;
  policy?: Partial<AgentOrchestrationPolicy>;
}

export type AgentSpawnDecision =
  | {
      allowed: true;
      reasonCodes: [];
      policy: AgentOrchestrationPolicy;
      budget: AgentJobV1["budget"];
    }
  | {
      allowed: false;
      reasonCodes: AgentSpawnBlockReason[];
      policy: AgentOrchestrationPolicy;
      budget: AgentJobV1["budget"];
    };

export interface CreateInvestigationAgentJobInput extends AgentSpawnEligibilityInput {
  jobId?: string;
  runnerPort: AgentRunnerPortId;
  inputDigest: string;
  promptTemplateDigest: string;
}

export interface AgentJobStatusTransition {
  status: AgentJobStatus;
  now: string;
  outputDigest?: string;
}

export interface InvestigationLedgerContextEntityRef {
  entityId: string;
  kind: string;
  status: string;
  path?: string;
  summary?: string;
}

export interface InvestigationLedgerContextRelationRef {
  relationId: string;
  kind: string;
  sourceEntityId: string;
  targetEntityId: string;
  status: string;
  summary?: string;
}

export interface InvestigationLedgerContextConstraintRef {
  constraintId: string;
  kind: string;
  subjectId: string;
  status: string;
  severity?: string;
  summary?: string;
}

export interface InvestigationLedgerContextEvidenceBindingRef {
  bindingId: string;
  evidenceId: string;
  target: {
    kind: string;
    id: string;
  };
}

export interface InvestigationLedgerContextCandidateChangeRef {
  candidateChangeId: string;
  kind: string;
  target: {
    kind: string;
    id: string;
    parentId?: string;
  };
  stateDimension: string;
  changeKind: string;
  confidence: "low" | "medium" | "high";
  evidenceIds: string[];
  summary?: string;
}

export interface InvestigationLedgerContextQueryResult {
  graphDigest: string;
  entities?: InvestigationLedgerContextEntityRef[];
  relations?: InvestigationLedgerContextRelationRef[];
  constraints?: InvestigationLedgerContextConstraintRef[];
  evidenceBindings?: InvestigationLedgerContextEvidenceBindingRef[];
  candidateChanges?: InvestigationLedgerContextCandidateChangeRef[];
  maxItems?: number;
}

export interface BuildInvestigationContextBundleFromLedgerQueryInput {
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  taskSessionId: string;
  fingerprint: string;
  trigger: AgentSpawnEligibilityInput["trigger"];
  risk: InvestigationContextRisk;
  uncertainty: InvestigationContextUncertainty;
  summary: string;
  ledger: InvestigationLedgerContextQueryResult;
  extensions?: Record<string, Json>;
}

export interface RuntimeAgentQueueControlPlan {
  schemaVersion: "archcontext.runtime-agent-queue-control-plan/v1";
  enqueue: {
    analysisKind: string;
    coalesceKey: string;
    debounceUntil?: string;
    maxQueuedJobs: number;
    priority: number;
  };
  claim: {
    maxRunningJobs: number;
  };
  staleCancellation: {
    headSha: string;
    worktreeDigest: string;
    reason: string;
  };
}

export interface PlanRuntimeAgentQueueControlsInput {
  job: AgentJobV1;
  analysisKind: string;
  now: string;
  coalesceKey?: string;
  cooldownMs?: number;
  maxQueuedJobs?: number;
  maxRunningJobs?: number;
  priority?: number;
}

export const DEFAULT_AGENT_ORCHESTRATION_POLICY: AgentOrchestrationPolicy = {
  schemaVersion: AGENT_ORCHESTRATION_POLICY_SCHEMA_VERSION,
  enabled: true,
  adapterEnabled: false,
  maxRunsPerTask: 1,
  maxRunsPerRepositoryPerDay: 3,
  maxRunsPerDay: 10,
  maxAutomaticRunsForLowRisk: 0,
  cooldownMs: 0
};

export const DEFAULT_AGENT_QUEUE_MAX_RUNNING_JOBS_PER_REPOSITORY = 1;
export const DEFAULT_AGENT_QUEUE_MAX_QUEUED_JOBS = 32;
export const DEFAULT_AGENT_QUEUE_PRIORITY = 0;

export const AGENT_JOB_STATE_TRANSITIONS: Record<AgentJobStatus, AgentJobStatus[]> = {
  queued: ["running", "cancelled", "superseded", "expired"],
  running: ["succeeded", "failed", "cancelled", "expired"],
  succeeded: [],
  failed: [],
  cancelled: [],
  superseded: [],
  expired: []
};

export function normalizeAgentOrchestrationPolicy(input: Partial<AgentOrchestrationPolicy> = {}): AgentOrchestrationPolicy {
  const policy = {
    ...DEFAULT_AGENT_ORCHESTRATION_POLICY,
    ...input,
    schemaVersion: AGENT_ORCHESTRATION_POLICY_SCHEMA_VERSION
  };
  return {
    ...policy,
    maxRunsPerTask: nonNegativeInteger(policy.maxRunsPerTask, "maxRunsPerTask"),
    maxRunsPerRepositoryPerDay: nonNegativeInteger(policy.maxRunsPerRepositoryPerDay, "maxRunsPerRepositoryPerDay"),
    maxRunsPerDay: nonNegativeInteger(policy.maxRunsPerDay, "maxRunsPerDay"),
    maxAutomaticRunsForLowRisk: nonNegativeInteger(policy.maxAutomaticRunsForLowRisk, "maxAutomaticRunsForLowRisk"),
    cooldownMs: nonNegativeInteger(policy.cooldownMs, "cooldownMs")
  };
}

export function canTransitionAgentJobStatus(from: AgentJobStatus, to: AgentJobStatus): boolean {
  return AGENT_JOB_STATE_TRANSITIONS[from].includes(to);
}

export function transitionAgentJobStatus(job: AgentJobV1, transition: AgentJobStatusTransition): AgentJobV1 {
  if (!canTransitionAgentJobStatus(job.status, transition.status)) {
    throw new Error(`agent-job-invalid-transition: ${job.status}->${transition.status}`);
  }
  return {
    ...job,
    status: transition.status,
    updatedAt: transition.now,
    ...(transition.outputDigest ? { outputDigest: transition.outputDigest } : {})
  };
}

export function evaluateInvestigationSpawn(input: AgentSpawnEligibilityInput): AgentSpawnDecision {
  const policy = normalizeAgentOrchestrationPolicy(input.policy);
  const reasonCodes: AgentSpawnBlockReason[] = [];
  const automatic = (input.triggerMode ?? "automatic") === "automatic";
  const policyRequested = input.policyRequestedInvestigation === true;

  if (!policy.enabled) reasonCodes.push("policy-disabled");
  if (!policy.adapterEnabled) reasonCodes.push("adapter-disabled");
  if (!input.deterministicAnalysisFound && !policyRequested) reasonCodes.push("deterministic-analysis-missing");

  if (input.risk === "low" && automatic && !policyRequested) {
    const lowRiskRuns = nonNegativeInteger(input.budgetUsage.automaticLowRiskRunsForTask ?? 0, "automaticLowRiskRunsForTask");
    if (lowRiskRuns >= policy.maxAutomaticRunsForLowRisk) reasonCodes.push("low-risk-automatic-spawn-disabled");
  }

  if (input.risk === "low" && !policyRequested) reasonCodes.push("risk-below-investigation-threshold");
  if (input.uncertainty === "low" && !policyRequested && input.documentationSynthesisUseful !== true) {
    reasonCodes.push("uncertainty-below-investigation-threshold");
  }
  if (hasEquivalentJob(input.fingerprint, input.existingJobs ?? [])) reasonCodes.push("equivalent-job-exists");

  if (nonNegativeInteger(input.budgetUsage.taskRuns, "taskRuns") >= policy.maxRunsPerTask) {
    reasonCodes.push("task-budget-exhausted");
  }
  if (nonNegativeInteger(input.budgetUsage.repositoryRunsToday, "repositoryRunsToday") >= policy.maxRunsPerRepositoryPerDay) {
    reasonCodes.push("repository-daily-budget-exhausted");
  }
  if (nonNegativeInteger(input.budgetUsage.totalRunsToday, "totalRunsToday") >= policy.maxRunsPerDay) {
    reasonCodes.push("daily-budget-exhausted");
  }
  if (input.lastSpawnedAt && Date.parse(input.now) - Date.parse(input.lastSpawnedAt) < policy.cooldownMs) {
    reasonCodes.push("cooldown-active");
  }

  const budget: AgentJobV1["budget"] = {
    maxRunsPerTask: policy.maxRunsPerTask,
    maxRunsPerRepositoryPerDay: policy.maxRunsPerRepositoryPerDay,
    maxRunsPerDay: policy.maxRunsPerDay
  };
  const uniqueReasonCodes = [...new Set(reasonCodes)];
  if (uniqueReasonCodes.length === 0) return { allowed: true, reasonCodes: [], policy, budget };
  return { allowed: false, reasonCodes: uniqueReasonCodes, policy, budget };
}

export function createInvestigationAgentJob(input: CreateInvestigationAgentJobInput): AgentJobV1 {
  const decision = evaluateInvestigationSpawn(input);
  if (!decision.allowed) {
    throw new Error(`agent-spawn-not-eligible: ${decision.reasonCodes.join(",")}`);
  }
  return {
    schemaVersion: AGENT_JOB_SCHEMA_VERSION,
    jobId: input.jobId ?? investigationJobId(input.taskSessionId, input.fingerprint),
    status: "queued",
    runnerPort: input.runnerPort,
    repository: input.repository,
    worktree: input.worktree,
    fingerprint: input.fingerprint,
    trigger: input.trigger,
    budget: decision.budget,
    inputDigest: input.inputDigest,
    promptTemplateDigest: input.promptTemplateDigest,
    stalePolicy: "cancel-on-head-change",
    directMutationAllowed: false,
    queuedAt: input.now,
    updatedAt: input.now,
    extensions: {
      taskSessionId: input.taskSessionId,
      triggerMode: input.triggerMode ?? "automatic",
      risk: input.risk,
      uncertainty: input.uncertainty,
      policyDigest: digestJson(decision.policy as unknown as Json)
    }
  };
}

export function buildInvestigationContextBundleFromLedgerQuery(input: BuildInvestigationContextBundleFromLedgerQueryInput): InvestigationContextBundle {
  const maxItems = Math.max(1, Math.trunc(input.ledger.maxItems ?? 12));
  const entities = [...(input.ledger.entities ?? [])].sort((left, right) => left.entityId.localeCompare(right.entityId)).slice(0, maxItems);
  const relations = [...(input.ledger.relations ?? [])].sort((left, right) => left.relationId.localeCompare(right.relationId)).slice(0, maxItems);
  const constraints = [...(input.ledger.constraints ?? [])].sort((left, right) => left.constraintId.localeCompare(right.constraintId)).slice(0, maxItems);
  const evidenceBindings = [...(input.ledger.evidenceBindings ?? [])]
    .sort((left, right) => left.bindingId.localeCompare(right.bindingId))
    .slice(0, maxItems);
  const candidateChanges = [...(input.ledger.candidateChanges ?? [])]
    .sort((left, right) => left.candidateChangeId.localeCompare(right.candidateChangeId))
    .slice(0, maxItems);
  const ledgerContext = {
    schemaVersion: "archcontext.investigation-ledger-context/v1" as const,
    graphDigest: input.ledger.graphDigest,
    selected: {
      entities,
      relations,
      constraints,
      evidenceBindings,
      candidateChanges
    },
    omitted: {
      entities: Math.max(0, (input.ledger.entities?.length ?? 0) - entities.length),
      relations: Math.max(0, (input.ledger.relations?.length ?? 0) - relations.length),
      constraints: Math.max(0, (input.ledger.constraints?.length ?? 0) - constraints.length),
      evidenceBindings: Math.max(0, (input.ledger.evidenceBindings?.length ?? 0) - evidenceBindings.length),
      candidateChanges: Math.max(0, (input.ledger.candidateChanges?.length ?? 0) - candidateChanges.length)
    }
  };
  return investigationContextBundle({
    repository: input.repository,
    worktree: input.worktree,
    taskSessionId: input.taskSessionId,
    fingerprint: input.fingerprint,
    trigger: input.trigger,
    risk: input.risk,
    uncertainty: input.uncertainty,
    summary: input.summary,
    evidenceBindingIds: evidenceBindings.map((binding) => binding.bindingId),
    candidateChangeIds: candidateChanges.map((change) => change.candidateChangeId),
    extensions: {
      ...(input.extensions ?? {}),
      ledgerContext: ledgerContext as unknown as Json
    }
  });
}

export function investigationContextBundle(input: {
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  taskSessionId: string;
  fingerprint: string;
  trigger: AgentSpawnEligibilityInput["trigger"];
  risk: InvestigationContextRisk;
  uncertainty: InvestigationContextUncertainty;
  summary: string;
  evidenceBindingIds?: string[];
  candidateChangeIds?: string[];
  inputDigest?: string;
  extensions?: Record<string, Json>;
}): InvestigationContextBundle {
  const context = {
    schemaVersion: "archcontext.investigation-context-bundle/v1" as const,
    repository: input.repository,
    worktree: input.worktree,
    taskSessionId: input.taskSessionId,
    fingerprint: input.fingerprint,
    trigger: input.trigger,
    risk: input.risk,
    uncertainty: input.uncertainty,
    summary: input.summary,
    evidenceBindingIds: [...(input.evidenceBindingIds ?? [])].sort(),
    candidateChangeIds: [...(input.candidateChangeIds ?? [])].sort(),
    inputDigest: input.inputDigest ?? digestJson({
      repository: input.repository,
      worktree: input.worktree,
      taskSessionId: input.taskSessionId,
      fingerprint: input.fingerprint,
      trigger: input.trigger,
      risk: input.risk,
      uncertainty: input.uncertainty,
      summary: input.summary,
      evidenceBindingIds: [...(input.evidenceBindingIds ?? [])].sort(),
      candidateChangeIds: [...(input.candidateChangeIds ?? [])].sort()
    } as unknown as Json),
    ...(input.extensions ? { extensions: input.extensions } : {})
  };
  assertNoRawRepositoryPayload(context);
  return context;
}

export function planRuntimeAgentQueueControls(input: PlanRuntimeAgentQueueControlsInput): RuntimeAgentQueueControlPlan {
  const maxQueuedJobs = input.maxQueuedJobs ?? DEFAULT_AGENT_QUEUE_MAX_QUEUED_JOBS;
  const maxRunningJobs = input.maxRunningJobs ?? DEFAULT_AGENT_QUEUE_MAX_RUNNING_JOBS_PER_REPOSITORY;
  const cooldownMs = input.cooldownMs ?? 0;
  return {
    schemaVersion: "archcontext.runtime-agent-queue-control-plan/v1",
    enqueue: {
      analysisKind: input.analysisKind,
      coalesceKey: input.coalesceKey ?? agentJobCoalesceKey(input.job, input.analysisKind),
      ...(cooldownMs > 0 ? { debounceUntil: new Date(Date.parse(input.now) + cooldownMs).toISOString() } : {}),
      maxQueuedJobs: positiveInteger(maxQueuedJobs, "maxQueuedJobs"),
      priority: integer(input.priority ?? DEFAULT_AGENT_QUEUE_PRIORITY, "priority")
    },
    claim: {
      maxRunningJobs: positiveInteger(maxRunningJobs, "maxRunningJobs")
    },
    staleCancellation: {
      headSha: input.job.worktree.headSha,
      worktreeDigest: input.job.worktree.worktreeDigest,
      reason: "stale-head-or-worktree"
    }
  };
}

export async function runInvestigationThroughPort(input: {
  runner: InvestigationRunnerPort;
  job: AgentJobV1;
  context: InvestigationContextBundle;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}): Promise<InvestigationReportV1> {
  if (input.job.directMutationAllowed !== false) throw new Error("agent-job-direct-mutation-forbidden");
  if (input.job.status !== "running") throw new Error("agent-job-run-requires-running-status");
  if (input.runner.capabilities.canMutateRepository !== false) throw new Error("investigation-runner-mutation-capability-forbidden");

  const report = await input.runner.runInvestigation({
    job: input.job,
    context: input.context,
    maxOutputBytes: input.maxOutputBytes,
    signal: input.signal
  });
  if (report.jobId !== input.job.jobId) throw new Error(`investigation-report-job-mismatch: ${report.jobId}`);
  if (report.directMutationAllowed !== false) throw new Error("investigation-report-direct-mutation-forbidden");
  return report;
}

function hasEquivalentJob(fingerprint: string, jobs: EquivalentAgentJob[]): boolean {
  return jobs.some((job) =>
    job.fingerprint === fingerprint
    && !["expired", "superseded"].includes(job.status));
}

function agentJobCoalesceKey(job: AgentJobV1, analysisKind: string): string {
  return [
    job.repository.storageRepositoryId,
    job.worktree.storageWorkspaceId,
    analysisKind,
    job.fingerprint
  ].join("\0");
}

function investigationJobId(taskSessionId: string, fingerprint: string): string {
  return `agent_job.${sanitizeJobIdPart(taskSessionId)}_${shortDigest(fingerprint)}`;
}

function sanitizeJobIdPart(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 48) : "task";
}

function shortDigest(digest: string): string {
  return digest.replace(/^sha256:/, "").slice(0, 16);
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`agent-orchestration-${field}-invalid`);
  return Math.trunc(value);
}

function positiveInteger(value: number, field: string): number {
  const next = integer(value, field);
  if (next < 1) throw new Error(`agent-orchestration-${field}-invalid`);
  return next;
}

function integer(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`agent-orchestration-${field}-invalid`);
  return Math.trunc(value);
}

function assertNoRawRepositoryPayload(value: unknown, path = "$"): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (value.includes("diff --git")) throw new Error(`investigation-context-raw-diff-forbidden: ${path}`);
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRawRepositoryPayload(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (RAW_REPOSITORY_PAYLOAD_KEYS.has(key)) {
      throw new Error(`investigation-context-raw-field-forbidden: ${path}.${key}`);
    }
    assertNoRawRepositoryPayload(child, `${path}.${key}`);
  }
}

const RAW_REPOSITORY_PAYLOAD_KEYS = new Set([
  "body",
  "sourceBody",
  "sourceCode",
  "rawSource",
  "diff",
  "diffBody",
  "patch",
  "prompt",
  "completion"
]);
