import { describe, expect, test } from "bun:test";
import {
  digestJson,
  type AgentJobV1,
  type InvestigationReportV1,
  type InvestigationRunnerPort,
  type Json
} from "@archcontext/contracts";
import {
  DEFAULT_AGENT_ORCHESTRATION_POLICY,
  buildInvestigationContextBundleFromLedgerQuery,
  createInvestigationAgentJob,
  evaluateInvestigationSpawn,
  investigationContextBundle,
  planRuntimeAgentQueueControls,
  runInvestigationThroughPort,
  transitionAgentJobStatus,
  validateInvestigationReport
} from "../src/index";

const repository = {
  repositoryId: "repo.al6",
  storageRepositoryId: "storage.repo.al6"
};

const worktree = {
  workspaceId: "workspace.al6",
  storageWorkspaceId: "storage.workspace.al6",
  branch: "main",
  headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  worktreeDigest: digestJson({ worktree: "al6" } as unknown as Json)
};

const now = "2026-06-26T08:00:00.000Z";
const fingerprint = digestJson({ fingerprint: "medium-risk-boundary" } as unknown as Json);

describe("@archcontext/core/agent-orchestrator", () => {
  test("safe defaults cap automatic investigation to one per task and zero for low-risk changes", () => {
    expect(DEFAULT_AGENT_ORCHESTRATION_POLICY.maxRunsPerTask).toBe(1);
    expect(DEFAULT_AGENT_ORCHESTRATION_POLICY.maxAutomaticRunsForLowRisk).toBe(0);

    const lowRisk = evaluateInvestigationSpawn({
      ...spawnInput(),
      risk: "low",
      uncertainty: "high",
      policy: { adapterEnabled: true }
    });
    expect(lowRisk.allowed).toBe(false);
    expect(lowRisk.reasonCodes).toEqual([
      "low-risk-automatic-spawn-disabled",
      "risk-below-investigation-threshold"
    ]);

    const mediumRisk = evaluateInvestigationSpawn({
      ...spawnInput(),
      risk: "medium",
      uncertainty: "high",
      policy: { adapterEnabled: true }
    });
    expect(mediumRisk).toMatchObject({
      allowed: true,
      budget: {
        maxRunsPerTask: 1,
        maxRunsPerRepositoryPerDay: 3,
        maxRunsPerDay: 10
      }
    });

    const taskBudgetExhausted = evaluateInvestigationSpawn({
      ...spawnInput(),
      budgetUsage: { taskRuns: 1, repositoryRunsToday: 0, totalRunsToday: 0 },
      policy: { adapterEnabled: true }
    });
    expect(taskBudgetExhausted.allowed).toBe(false);
    expect(taskBudgetExhausted.reasonCodes).toEqual(["task-budget-exhausted"]);
  });

  test("enforces per-repository and daily budgets before creating a job", () => {
    const repositoryBudget = evaluateInvestigationSpawn({
      ...spawnInput(),
      budgetUsage: { taskRuns: 0, repositoryRunsToday: 3, totalRunsToday: 0 },
      policy: { adapterEnabled: true }
    });
    expect(repositoryBudget.allowed).toBe(false);
    expect(repositoryBudget.reasonCodes).toEqual(["repository-daily-budget-exhausted"]);

    const dailyBudget = evaluateInvestigationSpawn({
      ...spawnInput(),
      budgetUsage: { taskRuns: 0, repositoryRunsToday: 0, totalRunsToday: 10 },
      policy: { adapterEnabled: true }
    });
    expect(dailyBudget.allowed).toBe(false);
    expect(dailyBudget.reasonCodes).toEqual(["daily-budget-exhausted"]);

    expect(() => createInvestigationAgentJob({
      ...spawnInput(),
      budgetUsage: { taskRuns: 1, repositoryRunsToday: 0, totalRunsToday: 0 },
      runnerPort: "fake-provider",
      inputDigest: digestJson({ input: "budget-denied" } as unknown as Json),
      promptTemplateDigest: digestJson({ prompt: "al6" } as unknown as Json),
      policy: { adapterEnabled: true }
    })).toThrow("agent-spawn-not-eligible: task-budget-exhausted");
  });

  test("deduplicates equivalent active or completed jobs for the same fingerprint", () => {
    const activeDuplicate = evaluateInvestigationSpawn({
      ...spawnInput(),
      existingJobs: [{ fingerprint, status: "running" }],
      policy: { adapterEnabled: true }
    });
    expect(activeDuplicate.allowed).toBe(false);
    expect(activeDuplicate.reasonCodes).toEqual(["equivalent-job-exists"]);

    const supersededDuplicate = evaluateInvestigationSpawn({
      ...spawnInput(),
      existingJobs: [{ fingerprint, status: "superseded" }],
      policy: { adapterEnabled: true }
    });
    expect(supersededDuplicate.allowed).toBe(true);
  });

  test("creates provider-neutral queued jobs that cannot directly mutate architecture authority", () => {
    const job = createInvestigationAgentJob({
      ...spawnInput(),
      runnerPort: "fake-provider",
      inputDigest: digestJson({ input: "agent-job" } as unknown as Json),
      promptTemplateDigest: digestJson({ prompt: "al6" } as unknown as Json),
      policy: { adapterEnabled: true }
    });

    expect(job).toMatchObject({
      schemaVersion: "archcontext.agent-job/v1",
      status: "queued",
      runnerPort: "fake-provider",
      directMutationAllowed: false,
      budget: {
        maxRunsPerTask: 1,
        maxRunsPerRepositoryPerDay: 3,
        maxRunsPerDay: 10
      }
    });
    expect(job.jobId).toMatch(/^agent_job\.task_al6_/);
    expect(JSON.stringify(job)).not.toContain("diff --git");
    expect(JSON.stringify(job)).not.toContain("sourceBody");
  });

  test("applies the job state machine and rejects impossible terminal transitions", () => {
    const queued = agentJob();
    const running = transitionAgentJobStatus(queued, { status: "running", now: "2026-06-26T08:01:00.000Z" });
    const succeeded = transitionAgentJobStatus(running, {
      status: "succeeded",
      now: "2026-06-26T08:02:00.000Z",
      outputDigest: digestJson({ output: "report" } as unknown as Json)
    });

    expect(running.status).toBe("running");
    expect(succeeded.status).toBe("succeeded");
    expect(succeeded.outputDigest).toBe(digestJson({ output: "report" } as unknown as Json));
    expect(() => transitionAgentJobStatus(queued, { status: "succeeded", now })).toThrow(
      "agent-job-invalid-transition: queued->succeeded"
    );
    expect(() => transitionAgentJobStatus(succeeded, { status: "running", now })).toThrow(
      "agent-job-invalid-transition: succeeded->running"
    );
  });

  test("runs through a provider-neutral port and rejects direct-mutation reports", async () => {
    const running = transitionAgentJobStatus(agentJob(), { status: "running", now: "2026-06-26T08:01:00.000Z" });
    const context = validInvestigationContext();
    const report = investigationReport(running);
    const runner: InvestigationRunnerPort = {
      runnerId: "runner.fake",
      capabilities: {
        provider: "fake-provider",
        supportsCancellation: true,
        canReadRepositoryText: false,
        canMutateRepository: false
      },
      runInvestigation: async () => report
    };

    await expect(runInvestigationThroughPort({ runner, job: running, context })).resolves.toEqual(report);

    const mutatingRunner: InvestigationRunnerPort = {
      ...runner,
      runInvestigation: async () => ({
        ...report,
        directMutationAllowed: true
      } as unknown as InvestigationReportV1)
    };
    await expect(runInvestigationThroughPort({ runner: mutatingRunner, job: running, context })).rejects.toThrow(
      "investigation-report-invalid: direct-mutation-forbidden"
    );
  });

  test("validates typed investigation reports against context evidence and ledger refs", () => {
    const running = transitionAgentJobStatus(agentJob(), { status: "running", now: "2026-06-26T08:01:00.000Z" });
    const context = validInvestigationContext();
    const report = investigationReport(running);

    expect(validateInvestigationReport({ report, job: running, context })).toEqual({ valid: true, issues: [] });

    expect(validateInvestigationReport({
      report: {
        ...report,
        findings: [{ ...report.findings[0], proposedDelta: undefined }]
      },
      job: running,
      context
    }).issues.map((issue) => issue.reasonCode)).toContain("proposed-delta-required");

    expect(validateInvestigationReport({
      report: {
        ...report,
        findings: [{ ...report.findings[0], evidenceBindingIds: ["binding.evidence.al6.unknown"] }]
      },
      job: running,
      context
    }).issues.map((issue) => issue.reasonCode)).toContain("evidence-binding-reference-unverifiable");

    expect(validateInvestigationReport({
      report: {
        ...report,
        findings: [{
          ...report.findings[0],
          proposedDelta: {
            ...report.findings[0].proposedDelta,
            target: { kind: "node" as const, id: "module.unknown" }
          }
        }]
      },
      job: running,
      context
    }).issues.map((issue) => issue.reasonCode)).toContain("proposed-delta-target-unknown");

    expect(validateInvestigationReport({
      report: {
        ...report,
        findings: [{
          ...report.findings[0],
          proposedDelta: {
            ...report.findings[0].proposedDelta,
            evidenceIds: ["evidence.al6.unknown"]
          }
        }]
      },
      job: running,
      context
    }).issues.map((issue) => issue.reasonCode)).toContain("proposed-delta-evidence-reference-unverifiable");
  });

  test("builds a bounded investigation context from ledger refs without repository body or diff payloads", () => {
    const context = buildInvestigationContextBundleFromLedgerQuery({
      repository,
      worktree,
      taskSessionId: "task.al6",
      fingerprint,
      trigger: { source: "git_hook", reason: "post-edit" },
      risk: "medium",
      uncertainty: "high",
      summary: "Investigate a persistence boundary change.",
      ledger: {
        graphDigest: digestJson({ graph: "al6" } as unknown as Json),
        maxItems: 1,
        entities: [
          { entityId: "module.z", kind: "module", status: "active", path: "src/z" },
          { entityId: "module.a", kind: "module", status: "active", path: "src/a" }
        ],
        relations: [
          { relationId: "relation.a-z", kind: "imports", sourceEntityId: "module.a", targetEntityId: "module.z", status: "active" }
        ],
        constraints: [
          { constraintId: "constraint.persistence", kind: "owner-required", subjectId: "module.a", status: "active", severity: "warning" }
        ],
        evidenceBindings: [
          { bindingId: "binding.evidence.z", evidenceId: "evidence.z", target: { kind: "entity", id: "module.z" } },
          { bindingId: "binding.evidence.a", evidenceId: "evidence.a", target: { kind: "entity", id: "module.a" } }
        ],
        candidateChanges: [
          {
            candidateChangeId: "candidate_change.z",
            kind: "node-materially-changed",
            target: { kind: "node", id: "module.z" },
            stateDimension: "target-state",
            changeKind: "materially_changed",
            confidence: "medium",
            evidenceIds: ["evidence.z"]
          },
          {
            candidateChangeId: "candidate_change.a",
            kind: "node-materially-changed",
            target: { kind: "node", id: "module.a" },
            stateDimension: "target-state",
            changeKind: "materially_changed",
            confidence: "medium",
            evidenceIds: ["evidence.a"]
          }
        ]
      }
    });

    expect(context.evidenceBindingIds).toEqual(["binding.evidence.a"]);
    expect(context.candidateChangeIds).toEqual(["candidate_change.a"]);
    expect((context.extensions?.ledgerContext as any).selected.entities).toEqual([
      { entityId: "module.a", kind: "module", status: "active", path: "src/a" }
    ]);
    expect((context.extensions?.ledgerContext as any).omitted).toMatchObject({
      entities: 1,
      evidenceBindings: 1,
      candidateChanges: 1
    });
    expect(JSON.stringify(context)).not.toContain("export const");
    expect(JSON.stringify(context)).not.toContain("diff --git");
  });

  test("rejects raw repository payload fields in investigation context extensions", () => {
    expect(() => investigationContextBundle({
      repository,
      worktree,
      taskSessionId: "task.al6",
      fingerprint,
      trigger: { source: "checkpoint", reason: "raw context regression" },
      risk: "medium",
      uncertainty: "high",
      summary: "Invalid context",
      extensions: {
        sourceBody: "export const leaked = true;"
      }
    })).toThrow("investigation-context-raw-field-forbidden");
    expect(() => investigationContextBundle({
      repository,
      worktree,
      taskSessionId: "task.al6",
      fingerprint,
      trigger: { source: "checkpoint", reason: "raw diff regression" },
      risk: "medium",
      uncertainty: "high",
      summary: "Invalid context",
      extensions: {
        safeKey: "diff --git a/src/a.ts b/src/a.ts"
      }
    })).toThrow("investigation-context-raw-diff-forbidden");
  });

  test("plans runtime queue controls with one concurrent job per repository and cooldown debounce", () => {
    const job = agentJob();
    const plan = planRuntimeAgentQueueControls({
      job,
      analysisKind: "architecture-delta",
      now,
      cooldownMs: 5_000,
      priority: 7
    });

    expect(plan).toMatchObject({
      schemaVersion: "archcontext.runtime-agent-queue-control-plan/v1",
      enqueue: {
        analysisKind: "architecture-delta",
        maxQueuedJobs: 32,
        priority: 7,
        debounceUntil: "2026-06-26T08:00:05.000Z"
      },
      claim: { maxRunningJobs: 1 },
      staleCancellation: {
        headSha: worktree.headSha,
        worktreeDigest: worktree.worktreeDigest,
        reason: "stale-head-or-worktree"
      }
    });
    expect(plan.enqueue.coalesceKey).toContain(job.fingerprint);
  });
});

function spawnInput() {
  return {
    repository,
    worktree,
    taskSessionId: "task.al6",
    fingerprint,
    trigger: { source: "checkpoint" as const, reason: "medium risk with unresolved evidence" },
    risk: "medium" as const,
    uncertainty: "high" as const,
    deterministicAnalysisFound: true,
    budgetUsage: { taskRuns: 0, repositoryRunsToday: 0, totalRunsToday: 0 },
    now
  };
}

function agentJob(): AgentJobV1 {
  return createInvestigationAgentJob({
    ...spawnInput(),
    runnerPort: "fake-provider",
    inputDigest: digestJson({ input: "agent-job" } as unknown as Json),
    promptTemplateDigest: digestJson({ prompt: "al6" } as unknown as Json),
    policy: { adapterEnabled: true }
  });
}

function validInvestigationContext() {
  return buildInvestigationContextBundleFromLedgerQuery({
    repository,
    worktree,
    taskSessionId: "task.al6",
    fingerprint,
    trigger: { source: "checkpoint", reason: "medium risk with unresolved evidence" },
    risk: "medium",
    uncertainty: "high",
    summary: "Investigate a boundary change from typed evidence.",
    ledger: {
      graphDigest: digestJson({ graph: "al6.report" } as unknown as Json),
      entities: [
        { entityId: "module.al6.boundary", kind: "module", status: "active", path: "src/al6/boundary.ts" }
      ],
      relations: [],
      constraints: [],
      evidenceBindings: [
        {
          bindingId: "binding.evidence.al6.boundary",
          evidenceId: "evidence.al6.boundary",
          target: { kind: "entity", id: "module.al6.boundary" }
        }
      ],
      candidateChanges: [
        {
          candidateChangeId: "candidate_change.al6.boundary",
          kind: "node-materially-changed",
          target: { kind: "node", id: "module.al6.boundary" },
          stateDimension: "target-state",
          changeKind: "materially_changed",
          confidence: "medium",
          evidenceIds: ["evidence.al6.boundary"]
        }
      ]
    }
  });
}

function investigationReport(job: AgentJobV1): InvestigationReportV1 {
  const proposedDelta = {
    candidateChangeId: "candidate_change.al6.boundary",
    kind: "node-materially-changed" as const,
    target: { kind: "node" as const, id: "module.al6.boundary" },
    stateDimension: "target-state" as const,
    changeKind: "materially_changed" as const,
    subjectSelectorIds: ["subject.path.src-al6-boundary"],
    mappingIds: ["mapping.al6.boundary"],
    ambiguityIds: [],
    evidenceIds: ["evidence.al6.boundary"],
    confidence: "medium" as const,
    heuristic: true as const,
    summary: "Declared architecture node module.al6.boundary may be materially changed by the investigated code.",
    digest: digestJson({ proposed: "delta" } as unknown as Json)
  };
  const report = {
    schemaVersion: "archcontext.investigation-report/v1" as const,
    reportId: "investigation_report.al6",
    jobId: job.jobId,
    status: "succeeded" as const,
    findings: [
      {
        findingId: "finding.al6.boundary",
        hypothesis: "The changed dependency may cross a declared architecture boundary.",
        evidenceBindingIds: ["binding.evidence.al6.boundary"],
        unknowns: ["Whether the declared relation already allows this edge."],
        falsifier: "The ledger contains an allowed relation for this dependency at the same HEAD.",
        proposedDelta,
        proposedDeltaDigest: proposedDelta.digest,
        confidence: "medium" as const
      }
    ],
    outputDigest: digestJson({ output: job.jobId } as unknown as Json),
    createdAt: "2026-06-26T08:02:00.000Z",
    directMutationAllowed: false as const
  };
  return report;
}
