import {
  AGENT_JOB_SCHEMA_VERSION,
  INVESTIGATION_REPORT_SCHEMA_VERSION,
  digestJson,
  type AgentJobV1,
  type ArchitectureCandidateChangeV1,
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
export const INVESTIGATION_REPORT_PROPOSAL_PLAN_SCHEMA_VERSION = "archcontext.investigation-report-proposal-plan/v1" as const;

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

export type InvestigationReportValidationReasonCode =
  | "report-not-object"
  | "schema-version-invalid"
  | "report-id-invalid"
  | "report-job-mismatch"
  | "status-invalid"
  | "direct-mutation-forbidden"
  | "findings-invalid"
  | "finding-not-object"
  | "finding-id-invalid"
  | "hypothesis-invalid"
  | "evidence-binding-reference-required"
  | "evidence-binding-reference-unverifiable"
  | "unknowns-invalid"
  | "falsifier-invalid"
  | "proposed-delta-required"
  | "proposed-delta-id-invalid"
  | "proposed-delta-target-unknown"
  | "proposed-delta-parent-unknown"
  | "proposed-delta-evidence-reference-required"
  | "proposed-delta-evidence-reference-unverifiable"
  | "proposed-delta-digest-mismatch"
  | "confidence-invalid"
  | "output-digest-invalid"
  | "created-at-invalid"
  | "raw-report-payload-forbidden"
  | "tool-escape-forbidden";

export interface InvestigationReportValidationIssue {
  reasonCode: InvestigationReportValidationReasonCode;
  path: string;
  message: string;
}

export type InvestigationReportValidationResult =
  | { valid: true; issues: [] }
  | { valid: false; issues: InvestigationReportValidationIssue[] };

export interface ValidateInvestigationReportInput {
  report: unknown;
  job: AgentJobV1;
  context: InvestigationContextBundle;
}

export type InvestigationReportProposalRequiredNextStep = "deterministic-validation";
export type InvestigationReportProposalForbiddenAction =
  | "write-ledger"
  | "write-yaml"
  | "write-docs"
  | "apply-changeset"
  | "run-tool"
  | "execute-command";

export interface PlanInvestigationReportProposalInput extends ValidateInvestigationReportInput {
  now?: string;
}

export interface InvestigationReportProposalPlan {
  schemaVersion: typeof INVESTIGATION_REPORT_PROPOSAL_PLAN_SCHEMA_VERSION;
  proposalId: string;
  jobId: string;
  reportId: string;
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  inputDigest: string;
  outputDigest: string;
  proposedDeltaDigests: string[];
  proposedDeltas: ArchitectureCandidateChangeV1[];
  evidenceBindingIds: string[];
  evidenceIds: string[];
  validationDigest: string;
  directMutationAllowed: false;
  requiredNextStep: InvestigationReportProposalRequiredNextStep;
  forbiddenActions: InvestigationReportProposalForbiddenAction[];
  authority: "advisory-only";
  retention: "no-raw-source-or-diff-bodies";
  createdAt: string;
  proposalDigest: string;
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
export const INVESTIGATION_REPORT_PROPOSAL_FORBIDDEN_ACTIONS: InvestigationReportProposalForbiddenAction[] = [
  "write-ledger",
  "write-yaml",
  "write-docs",
  "apply-changeset",
  "run-tool",
  "execute-command"
];

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

export function validateInvestigationReport(input: ValidateInvestigationReportInput): InvestigationReportValidationResult {
  const issues: InvestigationReportValidationIssue[] = [];
  const references = investigationReportReferenceSet(input.context);
  try {
    assertNoRawRepositoryPayload(input.report);
  } catch (error) {
    issues.push({
      reasonCode: untrustedPayloadReasonCode(error),
      path: "$",
      message: error instanceof Error ? error.message : String(error)
    });
  }
  if (!isRecord(input.report)) {
    issues.push({ reasonCode: "report-not-object", path: "$", message: "Investigation report must be an object." });
    return invalidIfNeeded(issues);
  }

  if (input.report.schemaVersion !== INVESTIGATION_REPORT_SCHEMA_VERSION) {
    issues.push({ reasonCode: "schema-version-invalid", path: "$.schemaVersion", message: "Unsupported investigation report schema version." });
  }
  if (!matchesPattern(input.report.reportId, /^investigation_report\.[a-zA-Z0-9_-]+$/)) {
    issues.push({ reasonCode: "report-id-invalid", path: "$.reportId", message: "Investigation report ID is invalid." });
  }
  if (input.report.jobId !== input.job.jobId) {
    issues.push({ reasonCode: "report-job-mismatch", path: "$.jobId", message: "Investigation report job ID does not match the running job." });
  }
  if (!["succeeded", "failed", "partial"].includes(String(input.report.status))) {
    issues.push({ reasonCode: "status-invalid", path: "$.status", message: "Investigation report status is invalid." });
  }
  if (input.report.directMutationAllowed !== false) {
    issues.push({ reasonCode: "direct-mutation-forbidden", path: "$.directMutationAllowed", message: "Investigation report cannot request direct mutation." });
  }
  if (!matchesDigest(input.report.outputDigest)) {
    issues.push({ reasonCode: "output-digest-invalid", path: "$.outputDigest", message: "Investigation report output digest is invalid." });
  }
  if (typeof input.report.createdAt !== "string" || Number.isNaN(Date.parse(input.report.createdAt))) {
    issues.push({ reasonCode: "created-at-invalid", path: "$.createdAt", message: "Investigation report timestamp is invalid." });
  }

  if (!Array.isArray(input.report.findings)) {
    issues.push({ reasonCode: "findings-invalid", path: "$.findings", message: "Investigation report findings must be an array." });
    return invalidIfNeeded(issues);
  }
  input.report.findings.forEach((finding, index) => validateInvestigationFinding({
    finding,
    index,
    references,
    issues
  }));

  return invalidIfNeeded(issues);
}

export function planInvestigationReportProposal(input: PlanInvestigationReportProposalInput): InvestigationReportProposalPlan {
  const validation = validateInvestigationReport(input);
  if (!validation.valid) {
    throw new Error(`investigation-report-proposal-invalid: ${validation.issues.map((issue) => issue.reasonCode).join(",")}`);
  }

  const report = input.report as InvestigationReportV1;
  const proposedDeltas = [...report.findings.map((finding) => finding.proposedDelta)]
    .sort((left, right) => left.candidateChangeId.localeCompare(right.candidateChangeId));
  const proposedDeltaDigests = proposedDeltas.map((delta) => delta.digest);
  const evidenceBindingIds = uniqueSorted(report.findings.flatMap((finding) => finding.evidenceBindingIds));
  const evidenceIds = uniqueSorted(proposedDeltas.flatMap((delta) => delta.evidenceIds));
  const validationDigest = digestJson({
    status: "valid",
    jobId: input.job.jobId,
    reportId: report.reportId,
    inputDigest: input.context.inputDigest,
    outputDigest: report.outputDigest,
    proposedDeltaDigests
  } as unknown as Json);
  const proposalInputDigest = digestJson({
    kind: "investigation-report-proposal",
    jobId: input.job.jobId,
    reportId: report.reportId,
    inputDigest: input.context.inputDigest,
    outputDigest: report.outputDigest,
    validationDigest
  } as unknown as Json);
  const draft = {
    schemaVersion: INVESTIGATION_REPORT_PROPOSAL_PLAN_SCHEMA_VERSION,
    proposalId: `investigation_proposal.${shortDigest(proposalInputDigest)}`,
    jobId: input.job.jobId,
    reportId: report.reportId,
    repository: input.job.repository,
    worktree: input.job.worktree,
    inputDigest: input.context.inputDigest,
    outputDigest: report.outputDigest,
    proposedDeltaDigests,
    proposedDeltas,
    evidenceBindingIds,
    evidenceIds,
    validationDigest,
    directMutationAllowed: false as const,
    requiredNextStep: "deterministic-validation" as const,
    forbiddenActions: [...INVESTIGATION_REPORT_PROPOSAL_FORBIDDEN_ACTIONS],
    authority: "advisory-only" as const,
    retention: "no-raw-source-or-diff-bodies" as const,
    createdAt: input.now ?? report.createdAt
  };
  return {
    ...draft,
    proposalDigest: digestJson(draft as unknown as Json)
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
  const validation = validateInvestigationReport({ report, job: input.job, context: input.context });
  if (!validation.valid) {
    throw new Error(`investigation-report-invalid: ${validation.issues.map((issue) => issue.reasonCode).join(",")}`);
  }
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

function validateInvestigationFinding(input: {
  finding: unknown;
  index: number;
  references: InvestigationReportReferenceSet;
  issues: InvestigationReportValidationIssue[];
}): void {
  const path = `$.findings[${input.index}]`;
  if (!isRecord(input.finding)) {
    input.issues.push({ reasonCode: "finding-not-object", path, message: "Investigation finding must be an object." });
    return;
  }
  if (typeof input.finding.findingId !== "string" || input.finding.findingId.trim().length === 0) {
    input.issues.push({ reasonCode: "finding-id-invalid", path: `${path}.findingId`, message: "Investigation finding ID is invalid." });
  }
  if (typeof input.finding.hypothesis !== "string" || input.finding.hypothesis.trim().length === 0) {
    input.issues.push({ reasonCode: "hypothesis-invalid", path: `${path}.hypothesis`, message: "Investigation finding hypothesis is required." });
  }
  const evidenceBindingIds = input.finding.evidenceBindingIds;
  if (!Array.isArray(evidenceBindingIds) || evidenceBindingIds.length === 0 || evidenceBindingIds.some((id) => typeof id !== "string")) {
    input.issues.push({
      reasonCode: "evidence-binding-reference-required",
      path: `${path}.evidenceBindingIds`,
      message: "Investigation finding must reference at least one evidence binding."
    });
  } else {
    for (const bindingId of evidenceBindingIds) {
      if (!input.references.evidenceBindingIds.has(bindingId)) {
        input.issues.push({
          reasonCode: "evidence-binding-reference-unverifiable",
          path: `${path}.evidenceBindingIds`,
          message: `Evidence binding is not present in the investigation context: ${bindingId}`
        });
      }
    }
  }
  if (!Array.isArray(input.finding.unknowns) || input.finding.unknowns.some((unknown) => typeof unknown !== "string")) {
    input.issues.push({ reasonCode: "unknowns-invalid", path: `${path}.unknowns`, message: "Investigation finding unknowns must be strings." });
  }
  if (typeof input.finding.falsifier !== "string" || input.finding.falsifier.trim().length === 0) {
    input.issues.push({ reasonCode: "falsifier-invalid", path: `${path}.falsifier`, message: "Investigation finding falsifier is required." });
  }
  if (!["low", "medium", "high"].includes(String(input.finding.confidence))) {
    input.issues.push({ reasonCode: "confidence-invalid", path: `${path}.confidence`, message: "Investigation finding confidence is invalid." });
  }
  validateProposedDelta({
    proposedDelta: input.finding.proposedDelta,
    proposedDeltaDigest: input.finding.proposedDeltaDigest,
    path: `${path}.proposedDelta`,
    references: input.references,
    issues: input.issues
  });
}

function validateProposedDelta(input: {
  proposedDelta: unknown;
  proposedDeltaDigest: unknown;
  path: string;
  references: InvestigationReportReferenceSet;
  issues: InvestigationReportValidationIssue[];
}): void {
  if (!isRecord(input.proposedDelta)) {
    input.issues.push({ reasonCode: "proposed-delta-required", path: input.path, message: "Investigation finding must include a typed proposed delta." });
    return;
  }
  const proposed = input.proposedDelta as Partial<ArchitectureCandidateChangeV1>;
  if (!matchesPattern(proposed.candidateChangeId, /^candidate_change\.[a-zA-Z0-9_.-]+$/)) {
    input.issues.push({ reasonCode: "proposed-delta-id-invalid", path: `${input.path}.candidateChangeId`, message: "Proposed delta ID is invalid." });
  }
  if (typeof input.proposedDeltaDigest !== "string" || input.proposedDeltaDigest !== proposed.digest || !matchesDigest(proposed.digest)) {
    input.issues.push({
      reasonCode: "proposed-delta-digest-mismatch",
      path: `${input.path}Digest`,
      message: "Proposed delta digest must match the typed proposed delta digest."
    });
  }
  validateProposedDeltaTarget(proposed, input.path, input.references, input.issues);
  const evidenceIds = proposed.evidenceIds;
  if (!Array.isArray(evidenceIds) || evidenceIds.length === 0 || evidenceIds.some((id) => typeof id !== "string")) {
    input.issues.push({
      reasonCode: "proposed-delta-evidence-reference-required",
      path: `${input.path}.evidenceIds`,
      message: "Proposed delta must reference at least one evidence item."
    });
  } else {
    for (const evidenceId of evidenceIds) {
      if (!input.references.evidenceIds.has(evidenceId)) {
        input.issues.push({
          reasonCode: "proposed-delta-evidence-reference-unverifiable",
          path: `${input.path}.evidenceIds`,
          message: `Proposed delta evidence is not present in the investigation context: ${evidenceId}`
        });
      }
    }
  }
}

function validateProposedDeltaTarget(
  proposed: Partial<ArchitectureCandidateChangeV1>,
  path: string,
  references: InvestigationReportReferenceSet,
  issues: InvestigationReportValidationIssue[]
): void {
  if (!isRecord(proposed.target) || typeof proposed.target.id !== "string" || typeof proposed.target.kind !== "string") {
    issues.push({ reasonCode: "proposed-delta-target-unknown", path: `${path}.target`, message: "Proposed delta target is invalid." });
    return;
  }
  const targetIds = targetReferenceIds(proposed.target.kind, references);
  if (!targetIds.has(proposed.target.id)) {
    issues.push({
      reasonCode: "proposed-delta-target-unknown",
      path: `${path}.target.id`,
      message: `Proposed delta target is not present in the investigation context: ${proposed.target.id}`
    });
  }
  if (proposed.target.parentId && !references.entityIds.has(proposed.target.parentId)) {
    issues.push({
      reasonCode: "proposed-delta-parent-unknown",
      path: `${path}.target.parentId`,
      message: `Proposed delta parent is not present in the investigation context: ${proposed.target.parentId}`
    });
  }
}

interface InvestigationReportReferenceSet {
  entityIds: Set<string>;
  relationIds: Set<string>;
  constraintIds: Set<string>;
  evidenceBindingIds: Set<string>;
  evidenceIds: Set<string>;
}

function investigationReportReferenceSet(context: InvestigationContextBundle): InvestigationReportReferenceSet {
  const selected = isRecord(context.extensions?.ledgerContext)
    && isRecord(context.extensions.ledgerContext.selected)
    ? context.extensions.ledgerContext.selected
    : {};
  const evidenceBindings = recordsFromUnknown(selected.evidenceBindings);
  return {
    entityIds: new Set(recordsFromUnknown(selected.entities).map((entity) => entity.entityId).filter(isString)),
    relationIds: new Set(recordsFromUnknown(selected.relations).map((relation) => relation.relationId).filter(isString)),
    constraintIds: new Set(recordsFromUnknown(selected.constraints).map((constraint) => constraint.constraintId).filter(isString)),
    evidenceBindingIds: new Set([
      ...context.evidenceBindingIds,
      ...evidenceBindings.map((binding) => binding.bindingId).filter(isString)
    ]),
    evidenceIds: new Set(evidenceBindings.map((binding) => binding.evidenceId).filter(isString))
  };
}

function targetReferenceIds(targetKind: string, references: InvestigationReportReferenceSet): Set<string> {
  if (targetKind === "relation") return references.relationIds;
  if (targetKind === "constraint") return references.constraintIds;
  return references.entityIds;
}

function invalidIfNeeded(issues: InvestigationReportValidationIssue[]): InvestigationReportValidationResult {
  return issues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues };
}

function matchesPattern(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

function matchesDigest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordsFromUnknown(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
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
    const normalizedKey = normalizePayloadKey(key);
    if (RAW_REPOSITORY_PAYLOAD_KEYS.has(key) || RAW_REPOSITORY_PAYLOAD_KEYS.has(normalizedKey)) {
      throw new Error(`investigation-context-raw-field-forbidden: ${path}.${key}`);
    }
    if (UNTRUSTED_TOOL_ESCAPE_KEYS.has(normalizedKey)) {
      throw new Error(`investigation-context-tool-escape-field-forbidden: ${path}.${key}`);
    }
    assertNoRawRepositoryPayload(child, `${path}.${key}`);
  }
}

function normalizePayloadKey(key: string): string {
  return key.replace(/[-_]/g, "").toLowerCase();
}

function untrustedPayloadReasonCode(error: unknown): InvestigationReportValidationReasonCode {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("tool-escape") ? "tool-escape-forbidden" : "raw-report-payload-forbidden";
}

const RAW_REPOSITORY_PAYLOAD_KEYS = new Set([
  "body",
  "sourceBody",
  "sourcebody",
  "sourceCode",
  "sourcecode",
  "rawSource",
  "rawsource",
  "diff",
  "diffBody",
  "diffbody",
  "patch",
  "prompt",
  "completion"
]);

const UNTRUSTED_TOOL_ESCAPE_KEYS = new Set([
  "toolcall",
  "toolcalls",
  "functioncall",
  "command",
  "commands",
  "shell",
  "exec",
  "process",
  "writefile",
  "filewrite",
  "filesystemwrite",
  "ledgerwrite",
  "databasewrite",
  "dbwrite",
  "sql",
  "applypatch",
  "changesetapply",
  "applychangeset",
  "mutation",
  "directwrite"
]);
