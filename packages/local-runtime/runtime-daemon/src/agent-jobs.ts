import { isArchContextGeneratedProjectionPath } from "@archcontext/local-runtime/projection-paths";
import { randomBytes } from "node:crypto";
import {
  assertArchitectureLedgerPersistenceSafe,
  architectureLedgerStateDigest,
  type ArchitectureLedgerScope
} from "@archcontext/core/architecture-ledger";
import { buildInvestigationContextBundleFromLedgerQuery, createInvestigationAgentJob, investigationReportProposalValidationDigest, planRuntimeAgentQueueControls, type AgentInvestigationRunMetadata, type InvestigationReportProposalPlan } from "@archcontext/core/agent-orchestrator";
import { digestJson, errorEnvelope, okEnvelope, type AgentJobV1, type InvestigationContextRisk, type InvestigationContextUncertainty, type Json, type JsonEnvelope } from "@archcontext/contracts";
import { computeGitChangeFingerprint, findRepositoryRoot, readCommitChangeMetadata, readStagedChangeMetadata, readWorktreeChangeMetadata, type GitChangeMetadata, type GitChangeSource } from "@archcontext/local-runtime/git-adapter";
import { type RuntimeAgentJobRecord, type RuntimeLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import type { ArchctxDaemon } from "./index";

export interface RuntimeAgentJobEnqueueGitInput {
  source?: GitChangeSource;
  ref?: string;
  baseRef?: string;
  event?: string;
  taskSessionId?: string;
  analysisKind?: string;
  risk?: InvestigationContextRisk;
  uncertainty?: InvestigationContextUncertainty;
  policyRequestedInvestigation?: boolean;
  coalesceKey?: string;
  contextMaxItems?: number;
  cooldownMs?: number;
  debounceUntil?: string;
  maxAttempts?: number;
  priority?: number;
  maxQueuedJobs?: number;
  runnerPort?: AgentJobV1["runnerPort"];
  codeFactsDigest?: string;
  generatedProjection?: boolean;
  skipGeneratedProjection?: boolean;
}

export interface RuntimeAgentJobClaimRpcInput {
  workerId: string;
  leaseMs?: number;
  now?: string;
  maxRunningJobs?: number;
}

export interface RuntimeAgentJobCompleteRpcInput {
  jobId: string;
  status: Extract<AgentJobV1["status"], "succeeded" | "failed">;
  workerId?: string;
  outputDigest?: string;
  runMetadata?: AgentInvestigationRunMetadata;
  proposalPlan?: InvestigationReportProposalPlan;
  error?: string;
  now?: string;
}

export interface RuntimeAgentJobRetryRpcInput {
  jobId: string;
  reason?: string;
  now?: string;
}

export interface RuntimeAgentJobCancelRpcInput {
  jobId: string;
  status?: Extract<AgentJobV1["status"], "cancelled" | "superseded" | "expired">;
  reason?: string;
  supersededByJobId?: string;
  now?: string;
}

const RUNTIME_AGENT_HOOK_DEFAULT_MAX_QUEUED_JOBS = 32;
const RUNTIME_AGENT_HOOK_DEFAULT_PRIORITY = 0;
const RUNTIME_AGENT_JOB_DEFAULT_MAX_RUNNING_JOBS = 1;
interface AgentJobContext {
  assertRunning(): void;
  openSession: ArchctxDaemon["openSession"];
  architectureLedgerScope(root: string): Promise<ArchitectureLedgerScope>;
  clock(): string;
  localStore: Pick<RuntimeLocalStore, "readArchitectureLedgerState" | "cancelStaleRuntimeAgentJobs" | "enqueueRuntimeAgentJob" | "listRuntimeAgentJobs" | "queueStatsRuntimeAgentJobs" | "claimRuntimeAgentJob" | "cancelRuntimeAgentJob" | "completeRuntimeAgentJob" | "retryRuntimeAgentJob">;
}

export class AgentJobService {
  constructor(private readonly context: AgentJobContext) {}

  async jobsEnqueueGitHook(root: string, input: RuntimeAgentJobEnqueueGitInput = {}): Promise<JsonEnvelope> {
    this.context.assertRunning();
    const repositoryRoot = findRepositoryRoot(root);
    const session = await this.context.openSession(repositoryRoot);
    const scope = await this.context.architectureLedgerScope(repositoryRoot);
    const source = input.source ?? "worktree";
    const metadata = readGitChangeMetadata(repositoryRoot, source, input);
    const analysisKind = input.analysisKind ?? "architecture-delta";
    if (shouldSkipGeneratedProjectionJob(metadata, input)) {
      return okEnvelope("jobs.enqueueGitHook", {
        schemaVersion: "archcontext.runtime-agent-job-skip/v1",
        skipped: true,
        enqueued: false,
        reasonCode: "archcontext-generated-projection",
        event: input.event ?? source,
        source,
        change: metadata,
        analysisKind,
        expiredJobIds: [],
        hook: {
          failOpen: false,
          egress: "none",
          network: "forbidden"
        }
      } as unknown as Json);
    }
    if (metadata.paths.length === 0) {
      return okEnvelope("jobs.enqueueGitHook", {
        schemaVersion: "archcontext.runtime-agent-job-skip/v1",
        skipped: true,
        enqueued: false,
        reasonCode: "no-changed-paths",
        event: input.event ?? source,
        source,
        change: metadata,
        analysisKind,
        expiredJobIds: [],
        hook: {
          failOpen: false,
          egress: "none",
          network: "forbidden"
        }
      } as unknown as Json);
    }
    const now = this.context.clock();
    const codeFactsDigestValue = input.codeFactsDigest
      ?? session.codeFactsDigest
      ?? digestJson({
        schemaVersion: "archcontext.git-hook-codefacts-fallback/v1",
        source,
        headSha: metadata.headSha,
        metadataDigest: metadata.metadataDigest
      } as unknown as Json);
    const fingerprint = computeGitChangeFingerprint({
      repositoryId: scope.repository.storageRepositoryId,
      baseSha: metadata.baseSha ?? scope.worktree.headSha,
      headSha: metadata.headSha,
      paths: metadata.paths,
      codeFactsDigest: codeFactsDigestValue,
      analysisKind
    });
    const jobWorktree = {
      ...scope.worktree,
      headSha: metadata.headSha
    };
    const ledgerState = await this.context.localStore.readArchitectureLedgerState(scope);
    const taskSessionId = input.taskSessionId ?? "task_runtime_agent";
    const trigger = { source: "git_hook" as const, reason: input.event ?? source };
    const risk = runtimeInvestigationRisk(input.risk ?? (metadata.paths.length > 0 ? "medium" : "low"));
    const uncertainty = runtimeInvestigationUncertainty(input.uncertainty ?? "high");
    const context = buildInvestigationContextBundleFromLedgerQuery({
      repository: scope.repository,
      worktree: jobWorktree,
      taskSessionId,
      fingerprint,
      trigger,
      risk,
      uncertainty,
      summary: `${analysisKind} investigation for ${metadata.paths.length} changed path(s).`,
      ledger: {
        graphDigest: architectureLedgerStateDigest(ledgerState),
        entities: ledgerState.entities,
        relations: ledgerState.relations,
        constraints: ledgerState.constraints,
        evidenceBindings: [],
        candidateChanges: [],
        maxItems: input.contextMaxItems ?? 12
      },
      extensions: {
        gitChange: {
          source,
          event: input.event ?? source,
          metadataDigest: metadata.metadataDigest,
          pathCount: metadata.paths.length,
          changedPaths: metadata.paths
            .slice(0, input.contextMaxItems ?? 12)
            .map((path) => ({ path: path.path, status: path.status, rawStatus: path.rawStatus })),
          omittedPathCount: Math.max(0, metadata.paths.length - (input.contextMaxItems ?? 12))
        },
        codeFactsDigest: codeFactsDigestValue,
        analysisKind
      } as Record<string, Json>
    });
    const promptTemplateDigest = digestJson({
        schemaVersion: "archcontext.runtime-agent-job-prompt-template/v1",
        analysisKind
      } as unknown as Json);
    const job = createInvestigationAgentJob({
      repository: scope.repository,
      worktree: jobWorktree,
      taskSessionId,
      fingerprint,
      trigger,
      risk,
      uncertainty,
      deterministicAnalysisFound: metadata.paths.length > 0,
      policyRequestedInvestigation: input.policyRequestedInvestigation === true,
      documentationSynthesisUseful: true,
      budgetUsage: { taskRuns: 0, repositoryRunsToday: 0, totalRunsToday: 0 },
      now,
      policy: {
        adapterEnabled: true,
        maxRunsPerTask: 1,
        maxRunsPerRepositoryPerDay: 4,
        cooldownMs: input.cooldownMs ?? 0
      },
      jobId: runtimeAgentJobId(fingerprint, context.inputDigest, now),
      runnerPort: input.runnerPort ?? "codex",
      inputDigest: context.inputDigest,
      promptTemplateDigest
    });
    const queuePlan = planRuntimeAgentQueueControls({
      job,
      analysisKind,
      now,
      coalesceKey: input.coalesceKey,
      cooldownMs: input.cooldownMs,
      maxQueuedJobs: input.maxQueuedJobs ?? RUNTIME_AGENT_HOOK_DEFAULT_MAX_QUEUED_JOBS,
      priority: input.priority ?? RUNTIME_AGENT_HOOK_DEFAULT_PRIORITY
    });
    const jobWithContext: AgentJobV1 = {
      ...job,
      extensions: {
        ...(job.extensions ?? {}),
        investigationContext: context as unknown as Json,
        queuePlanDigest: digestJson(queuePlan as unknown as Json)
      }
    };
    const expired = await this.context.localStore.cancelStaleRuntimeAgentJobs({
      ...scope,
      headSha: scope.worktree.headSha,
      worktreeDigest: scope.worktree.worktreeDigest,
      now,
      reason: "enqueue-newer-git-hook-job"
    });
    const enqueue = await this.context.localStore.enqueueRuntimeAgentJob({
      job: jobWithContext,
      analysisKind: queuePlan.enqueue.analysisKind,
      coalesceKey: queuePlan.enqueue.coalesceKey,
      maxAttempts: input.maxAttempts,
      debounceUntil: input.debounceUntil ?? queuePlan.enqueue.debounceUntil,
      priority: queuePlan.enqueue.priority,
      maxQueuedJobs: queuePlan.enqueue.maxQueuedJobs
    });
    return okEnvelope("jobs.enqueueGitHook", {
      ...enqueue,
      change: metadata,
      codeFactsDigest: codeFactsDigestValue,
      analysisKind,
      expiredJobIds: expired.map((record) => record.job.jobId)
    } as unknown as Json);
  }

  async jobsList(root: string, input: { statuses?: AgentJobV1["status"][] } = {}): Promise<JsonEnvelope> {
    this.context.assertRunning();
    const scope = await this.context.architectureLedgerScope(findRepositoryRoot(root));
    const jobs = await this.context.localStore.listRuntimeAgentJobs({ ...scope, statuses: input.statuses });
    return okEnvelope("jobs.list", { jobs, count: jobs.length } as unknown as Json);
  }

  async jobsStats(root: string, input: { now?: string } = {}): Promise<JsonEnvelope> {
    this.context.assertRunning();
    const scope = await this.context.architectureLedgerScope(findRepositoryRoot(root));
    const stats = await this.context.localStore.queueStatsRuntimeAgentJobs({ ...scope, now: input.now ?? this.context.clock() });
    return okEnvelope("jobs.stats", stats as unknown as Json);
  }

  async jobsClaim(root: string, input: RuntimeAgentJobClaimRpcInput): Promise<JsonEnvelope> {
    this.context.assertRunning();
    if (!input.workerId) return errorEnvelope("jobs.claim", "AC_SCHEMA_INVALID", "jobs.claim requires workerId");
    const scope = await this.context.architectureLedgerScope(findRepositoryRoot(root));
    const job = await this.context.localStore.claimRuntimeAgentJob({
      ...scope,
      workerId: input.workerId,
      leaseMs: input.leaseMs ?? 60_000,
      now: input.now ?? this.context.clock(),
      maxRunningJobs: input.maxRunningJobs ?? RUNTIME_AGENT_JOB_DEFAULT_MAX_RUNNING_JOBS
    });
    return okEnvelope("jobs.claim", { job } as unknown as Json);
  }

  async jobsComplete(root: string, input: RuntimeAgentJobCompleteRpcInput): Promise<JsonEnvelope> {
    this.context.assertRunning();
    try {
      assertArchitectureLedgerPersistenceSafe({
        ...(input.runMetadata === undefined ? {} : { runMetadata: input.runMetadata }),
        ...(input.error === undefined ? {} : { error: input.error }),
        ...(input.proposalPlan === undefined ? {} : { proposalPlan: input.proposalPlan })
      } as unknown as Json, "jobs.complete");
    } catch (error) {
      return errorEnvelope("jobs.complete", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : "Unsafe job completion payload");
    }
    const repositoryRoot = findRepositoryRoot(root);
    const scope = await this.context.architectureLedgerScope(repositoryRoot);
    const jobs = await this.context.localStore.listRuntimeAgentJobs(scope);
    const record = jobs.find((candidate) => candidate.job.jobId === input.jobId);
    if (!record) return runtimeAgentJobOutOfScopeEnvelope("jobs.complete", input.jobId);
    if (record.job.status !== "running") {
      return errorEnvelope(
        "jobs.complete",
        "AC_PRECONDITION_FAILED",
        `runtime agent job completion requires a running job: ${input.jobId}`
      );
    }
    if (input.status === "succeeded") {
      // Mirrors cancelStaleRuntimeAgentJobs's own stalePolicy gate: a job that opted into
      // "advisory-only-on-stale" (e.g. archctx audit run's multi-minute investigation, which can
      // legitimately outlive a worktree digest shift from something as small as an untracked
      // .archcontext/ directory changing) must not be silently self-cancelled here either — this
      // check is a second, independent staleness enforcement point from that sweep, and both must
      // agree on the same policy or a stalePolicy override is only half-honored.
      if (record.job.stalePolicy === "cancel-on-head-change" && isRuntimeAgentJobCursorStale(record.job, scope)) {
        await this.context.localStore.cancelRuntimeAgentJob({
          ...scope,
          jobId: input.jobId,
          status: "expired",
          now: input.now ?? this.context.clock(),
          reason: "stale-head-or-worktree"
        });
        return errorEnvelope(
          "jobs.complete",
          "AC_CONTEXT_STALE",
          `runtime agent job is stale for current HEAD/worktree: ${input.jobId}`
        );
      }
    }
    if (input.proposalPlan) {
      const validation = validateRuntimeAgentProposalPlan({
        proposalPlan: input.proposalPlan,
        job: record.job,
        jobId: input.jobId,
        outputDigest: input.outputDigest
      });
      if (!validation.ok) return errorEnvelope("jobs.complete", "AC_SCHEMA_INVALID", validation.reason);
    }
    const runMetadata = input.proposalPlan
      ? {
        ...(input.runMetadata ?? {}),
        proposalPlan: input.proposalPlan
      } as unknown as Json
      : input.runMetadata as unknown as Json | undefined;
    const job = await this.context.localStore.completeRuntimeAgentJob({
      ...scope,
      jobId: input.jobId,
      status: input.status,
      workerId: input.workerId,
      outputDigest: input.outputDigest,
      runMetadata,
      error: input.error,
      now: input.now ?? this.context.clock()
    });
    return okEnvelope("jobs.complete", { job } as unknown as Json);
  }

  async jobsRetry(root: string, input: RuntimeAgentJobRetryRpcInput): Promise<JsonEnvelope> {
    this.context.assertRunning();
    const scope = await this.context.architectureLedgerScope(findRepositoryRoot(root));
    if (!(await this.runtimeAgentJobInScope(scope, input.jobId))) {
      return runtimeAgentJobOutOfScopeEnvelope("jobs.retry", input.jobId);
    }
    const job = await this.context.localStore.retryRuntimeAgentJob({
      ...scope,
      jobId: input.jobId,
      reason: input.reason,
      now: input.now ?? this.context.clock()
    });
    return okEnvelope("jobs.retry", { job } as unknown as Json);
  }

  async jobsCancel(root: string, input: RuntimeAgentJobCancelRpcInput): Promise<JsonEnvelope> {
    this.context.assertRunning();
    const scope = await this.context.architectureLedgerScope(findRepositoryRoot(root));
    if (!(await this.runtimeAgentJobInScope(scope, input.jobId))) {
      return runtimeAgentJobOutOfScopeEnvelope("jobs.cancel", input.jobId);
    }
    const job = await this.context.localStore.cancelRuntimeAgentJob({
      ...scope,
      jobId: input.jobId,
      status: input.status ?? "cancelled",
      reason: input.reason,
      supersededByJobId: input.supersededByJobId,
      now: input.now ?? this.context.clock()
    });
    return okEnvelope("jobs.cancel", { job } as unknown as Json);
  }

  /**
   * Resolves `jobId` inside the caller's own repository/worktree scope. The store rejects
   * out-of-scope mutations by throwing; resolving first lets the RPC surface answer with an error
   * envelope instead of an exception, and keeps a cross-repository job ID indistinguishable from an
   * unknown one.
   */
  private async runtimeAgentJobInScope(scope: ArchitectureLedgerScope, jobId: string): Promise<RuntimeAgentJobRecord | undefined> {
    const jobs = await this.context.localStore.listRuntimeAgentJobs(scope);
    return jobs.find((candidate) => candidate.job.jobId === jobId);
  }

}

function readGitChangeMetadata(root: string, source: GitChangeSource, input: RuntimeAgentJobEnqueueGitInput): GitChangeMetadata {
  const repositoryRoot = findRepositoryRoot(root);
  if (source === "commit") return readCommitChangeMetadata(repositoryRoot, input.ref ?? "HEAD");
  if (source === "staged") return readStagedChangeMetadata(repositoryRoot, input.baseRef ?? "HEAD");
  return readWorktreeChangeMetadata(repositoryRoot);
}

function shouldSkipGeneratedProjectionJob(metadata: GitChangeMetadata, input: RuntimeAgentJobEnqueueGitInput): boolean {
  if (input.skipGeneratedProjection === false) return false;
  if (input.generatedProjection === true) return true;
  return metadata.paths.length > 0 && metadata.paths.every((path) => isArchContextGeneratedProjectionPath(path.path));
}

function isRuntimeAgentJobCursorStale(job: AgentJobV1, scope: ArchitectureLedgerScope): boolean {
  return job.worktree.headSha !== scope.worktree.headSha
    || job.worktree.worktreeDigest !== scope.worktree.worktreeDigest;
}

/**
 * One reply for "this job ID is not yours" and "this job ID does not exist". Job IDs are unique
 * across every repository sharing one local store, so a stale, copied, or misrouted ID from another
 * repository or worktree must not be able to mutate — or even confirm the existence of — that
 * repository's queue state.
 */
function runtimeAgentJobOutOfScopeEnvelope(requestId: string, jobId: string): JsonEnvelope {
  return errorEnvelope(
    requestId,
    "AC_PRECONDITION_FAILED",
    `runtime agent job does not belong to this repository/worktree: ${jobId}`,
    "runtime-agent-job-out-of-scope"
  );
}

export function runtimeAgentJobId(fingerprint: string, inputDigest: string, queuedAt: string): string {
  return `agent_job.${digestJson({
    schemaVersion: "archcontext.runtime-agent-job-id/v1",
    fingerprint,
    inputDigest,
    queuedAt,
    nonce: randomBytes(6).toString("hex")
  } as unknown as Json).replace(/^sha256:/, "").slice(0, 32)}`;
}

export function runtimeInvestigationRisk(value: unknown): InvestigationContextRisk {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error("runtime-agent-risk-invalid");
}

export function runtimeInvestigationUncertainty(value: unknown): InvestigationContextUncertainty {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error("runtime-agent-uncertainty-invalid");
}

export function validateRuntimeAgentProposalPlan(input: {
  proposalPlan: InvestigationReportProposalPlan;
  job?: AgentJobV1;
  jobId: string;
  outputDigest?: string;
}): { ok: true } | { ok: false; reason: string } {
  const plan = input.proposalPlan;
  if (plan.schemaVersion !== "archcontext.investigation-report-proposal-plan/v1") {
    return { ok: false, reason: "proposalPlan schemaVersion mismatch" };
  }
  if (plan.jobId !== input.jobId) return { ok: false, reason: "proposalPlan jobId must match completed job" };
  if (input.job && plan.inputDigest !== input.job.inputDigest) {
    return { ok: false, reason: "proposalPlan inputDigest must match completed job" };
  }
  if (input.outputDigest && plan.outputDigest !== input.outputDigest) {
    return { ok: false, reason: "proposalPlan outputDigest must match completed job outputDigest" };
  }
  if (plan.directMutationAllowed !== false || plan.authority !== "advisory-only") {
    return { ok: false, reason: "proposalPlan must remain advisory-only and directMutationAllowed=false" };
  }
  const selectedDeltaDigests = new Set(plan.proposedDeltaDigests);
  for (const draft of plan.documentationDrafts ?? []) {
    if (draft.jobId !== plan.jobId) return { ok: false, reason: `documentation draft jobId mismatch: ${draft.draftId}` };
    if (draft.reportId !== plan.reportId) return { ok: false, reason: `documentation draft reportId mismatch: ${draft.draftId}` };
    if (draft.inputDigest !== plan.inputDigest) return { ok: false, reason: `documentation draft inputDigest mismatch: ${draft.draftId}` };
    if (draft.outputDigest !== plan.outputDigest) return { ok: false, reason: `documentation draft outputDigest mismatch: ${draft.draftId}` };
    if (draft.acceptedProjection !== false || draft.authority !== "advisory-only") {
      return { ok: false, reason: `documentation draft must not be an accepted projection: ${draft.draftId}` };
    }
    if (digestJson({ prose: draft.prose } as unknown as Json) !== draft.proseDigest) {
      return { ok: false, reason: `documentation draft proseDigest mismatch: ${draft.draftId}` };
    }
    if (draft.proposedDeltaDigests.length === 0 || draft.proposedDeltaDigests.some((digest) => !selectedDeltaDigests.has(digest))) {
      return { ok: false, reason: `documentation draft must reference selected deterministic deltas: ${draft.draftId}` };
    }
  }
  for (const draft of plan.githubIssueDrafts ?? []) {
    if (draft.jobId !== plan.jobId) return { ok: false, reason: `github issue draft jobId mismatch: ${draft.draftId}` };
    if (draft.reportId !== plan.reportId) return { ok: false, reason: `github issue draft reportId mismatch: ${draft.draftId}` };
    if (draft.inputDigest !== plan.inputDigest) return { ok: false, reason: `github issue draft inputDigest mismatch: ${draft.draftId}` };
    if (draft.outputDigest !== plan.outputDigest) return { ok: false, reason: `github issue draft outputDigest mismatch: ${draft.draftId}` };
    if (draft.authority !== "advisory-only") return { ok: false, reason: `github issue draft must be advisory-only: ${draft.draftId}` };
    if (digestJson({ bodyMarkdown: draft.bodyMarkdown } as unknown as Json) !== draft.bodyDigest) {
      return { ok: false, reason: `github issue draft bodyDigest mismatch: ${draft.draftId}` };
    }
    const { draftDigest, ...draftInput } = draft;
    if (digestJson(draftInput as unknown as Json) !== draftDigest) {
      return { ok: false, reason: `github issue draft draftDigest mismatch: ${draft.draftId}` };
    }
  }
  // plan.githubIssueDraftDigests (not plan.githubIssueDrafts) is what gets written to the
  // architecture ledger (see appendAuditRunToArchitectureLedger's issueDraftDigests), so it must be
  // exactly the digests of the accompanying drafts — otherwise the two could be tampered
  // independently and the ledger's audit trail would no longer reflect the actual draft content.
  const expectedGithubIssueDraftDigests = (plan.githubIssueDrafts ?? []).map((draft) => draft.draftDigest).sort();
  const actualGithubIssueDraftDigests = [...(plan.githubIssueDraftDigests ?? [])].sort();
  if (JSON.stringify(expectedGithubIssueDraftDigests) !== JSON.stringify(actualGithubIssueDraftDigests)) {
    return { ok: false, reason: "proposalPlan githubIssueDraftDigests must match the digests of githubIssueDrafts" };
  }
  // validationDigest and proposalDigest are claimed integrity digests over the plan; recompute
  // both rather than trust the claim. Checked last so a tampered plan that also fails one of the
  // more specific structural checks above still reports that more actionable reason first.
  const expectedValidationDigest = investigationReportProposalValidationDigest({
    jobId: plan.jobId,
    reportId: plan.reportId,
    inputDigest: plan.inputDigest,
    outputDigest: plan.outputDigest,
    proposedDeltaDigests: plan.proposedDeltaDigests,
    documentationDraftDigests: plan.documentationDraftDigests,
    githubIssueDraftDigests: plan.githubIssueDraftDigests ?? []
  });
  if (plan.validationDigest !== expectedValidationDigest) {
    return { ok: false, reason: "proposalPlan validationDigest mismatch" };
  }
  const { proposalDigest, ...proposalPlanWithoutDigest } = plan;
  if (digestJson(proposalPlanWithoutDigest as unknown as Json) !== proposalDigest) {
    return { ok: false, reason: "proposalPlan proposalDigest mismatch" };
  }
  return { ok: true };
}
