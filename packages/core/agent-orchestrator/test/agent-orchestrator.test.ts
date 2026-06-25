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
  createInvestigationAgentJob,
  evaluateInvestigationSpawn,
  investigationContextBundle,
  runInvestigationThroughPort,
  transitionAgentJobStatus
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
    const context = investigationContextBundle({
      repository,
      worktree,
      taskSessionId: "task.al6",
      fingerprint,
      trigger: { source: "checkpoint", reason: "medium risk with unresolved evidence" },
      risk: "medium",
      uncertainty: "high",
      summary: "Investigate a boundary change from typed evidence.",
      evidenceBindingIds: ["binding.evidence.al6.boundary"],
      candidateChangeIds: ["candidate_change.al6.boundary"]
    });
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
      "investigation-report-direct-mutation-forbidden"
    );
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

function investigationReport(job: AgentJobV1): InvestigationReportV1 {
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
        proposedDeltaDigest: digestJson({ proposed: "delta" } as unknown as Json),
        confidence: "medium" as const
      }
    ],
    outputDigest: digestJson({ output: job.jobId } as unknown as Json),
    createdAt: "2026-06-26T08:02:00.000Z",
    directMutationAllowed: false as const
  };
  return report;
}
