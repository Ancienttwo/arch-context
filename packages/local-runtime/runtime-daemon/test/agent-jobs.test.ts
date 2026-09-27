import { createGitRepo, rmSync, removeTempRepo, createStartedTestDaemon } from "./runtime-test-fixtures";
import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson } from "@archcontext/contracts";
import { investigationReportProposalValidationDigest } from "@archcontext/core/agent-orchestrator";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";

const PREVIOUS_ARCHCONTEXT_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const RUNTIME_TEST_STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-agent-job-state-"));
process.env.ARCHCONTEXT_STATE_DIR = RUNTIME_TEST_STATE_ROOT;
afterAll(() => {
  if (PREVIOUS_ARCHCONTEXT_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_ARCHCONTEXT_STATE_DIR;
  rmSync(RUNTIME_TEST_STATE_ROOT, { recursive: true, force: true });
});

describe("daemon agent jobs", () => {
  test("runtime jobs enqueue Git metadata through daemon boundary and claim a lease", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:00:00.000Z"
      });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "changed.ts"), "export const changed = true;\n", "utf8");

      const first = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-edit",
        taskSessionId: "task.runtime-agent",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.runtime-test",
        maxAttempts: 2,
        cooldownMs: 1_000,
        contextMaxItems: 2
      });
      const duplicate = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-edit",
        taskSessionId: "task.runtime-agent",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.runtime-test",
        maxAttempts: 2,
        cooldownMs: 1_000,
        contextMaxItems: 2
      });
      expect(first.ok).toBe(true);
      expect(duplicate.ok).toBe(true);
      expect((first.data as any).enqueued).toBe(true);
      expect((first.data as any).backpressure).toMatchObject({ accepted: true, maxQueuedJobs: 32, priority: 0 });
      expect((duplicate.data as any).deduplicated).toBe(true);
      expect((first.data as any).change.paths).toEqual([{ path: "src/changed.ts", status: "added", rawStatus: "??" }]);
      expect(JSON.stringify(first.data)).not.toContain("export const changed");

      const list = await daemon.jobsList(root, { statuses: ["queued"] });
      expect((list.data as any).count).toBe(1);
      const queued = (list.data as any).jobs[0];
      expect(queued.job.trigger).toMatchObject({ source: "git_hook", reason: "post-edit" });
      expect(queued.debounceUntil).toBe("2026-06-25T02:00:01.000Z");
      expect(queued.job.inputDigest).toBe(queued.job.extensions.investigationContext.inputDigest);
      expect(queued.job.extensions.investigationContext).toMatchObject({
        schemaVersion: "archcontext.investigation-context-bundle/v1",
        taskSessionId: "task.runtime-agent",
        fingerprint: queued.job.fingerprint,
        extensions: {
          ledgerContext: {
            schemaVersion: "archcontext.investigation-ledger-context/v1",
            selected: {
              entities: [],
              relations: [],
              constraints: [],
              evidenceBindings: [],
              candidateChanges: []
            }
          },
          gitChange: {
            pathCount: 1,
            changedPaths: [{ path: "src/changed.ts", status: "added", rawStatus: "??" }]
          },
          analysisKind: "architecture-delta"
        }
      });
      expect(queued.job.extensions.queuePlanDigest).toMatch(/^sha256:/);
      expect(JSON.stringify(queued.job.extensions)).not.toContain("export const changed");
      expect(JSON.stringify(queued.job.extensions)).not.toContain("diff --git");

      const claim = await daemon.jobsClaim(root, {
        workerId: "worker.al4",
        leaseMs: 30_000,
        now: "2026-06-25T02:00:01.000Z"
      });
      expect((claim.data as any).job).toMatchObject({
        job: { status: "running" },
        attemptCount: 1,
        leaseOwner: "worker.al4"
      });
      const secondClaim = await daemon.jobsClaim(root, {
        workerId: "worker.al4-second",
        leaseMs: 30_000,
        now: "2026-06-25T02:00:02.000Z"
      });
      expect((secondClaim.data as any).job).toBeUndefined();

      const stats = await daemon.jobsStats(root, { now: "2026-06-25T02:00:03.000Z" });
      expect((stats.data as any)).toMatchObject({
        schemaVersion: "archcontext.runtime-agent-job-queue-stats/v1",
        queuedDepth: 0,
        runningDepth: 1,
        activeDepth: 1,
        totalJobCount: 1
      });
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime jobs reject stale successful completion before worker side effects", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:20:00.000Z"
      });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "changed.ts"), "export const changed = true;\n", "utf8");

      const enqueue = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-edit",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.runtime-stale-complete"
      });
      const jobId = (enqueue.data as any).record.job.jobId;
      const claim = await daemon.jobsClaim(root, {
        workerId: "worker.stale",
        leaseMs: 30_000,
        now: "2026-06-25T02:20:01.000Z"
      });
      expect((claim.data as any).job.job.jobId).toBe(jobId);

      execFileSync("git", ["add", "src/changed.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "advance-head"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      const complete = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.stale",
        status: "succeeded",
        outputDigest: digestJson({ staleWorkerOutput: true } as any),
        now: "2026-06-25T02:20:02.000Z"
      });

      expect(complete.ok).toBe(false);
      expect((complete as any).error.code).toBe("AC_CONTEXT_STALE");
      const expired = await daemon.jobsList(root, { statuses: ["expired"] });
      expect((expired.data as any).jobs).toHaveLength(1);
      expect((expired.data as any).jobs[0].job.jobId).toBe(jobId);
      expect((expired.data as any).jobs[0].lastError).toBe("stale-head-or-worktree");
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime jobs reject duplicate terminal completion before replacing output", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:25:00.000Z"
      });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "changed.ts"), "export const changed = true;\n", "utf8");

      const enqueue = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-edit",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.runtime-duplicate-complete"
      });
      const jobId = (enqueue.data as any).record.job.jobId;
      await daemon.jobsClaim(root, {
        workerId: "worker.duplicate",
        leaseMs: 30_000,
        now: "2026-06-25T02:25:01.000Z"
      });
      const outputDigest = digestJson({ workerOutput: "first-completion" } as any);
      const firstComplete = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.duplicate",
        status: "succeeded",
        outputDigest,
        now: "2026-06-25T02:25:02.000Z"
      });
      expect(firstComplete.ok).toBe(true);

      const duplicateComplete = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.duplicate",
        status: "succeeded",
        outputDigest: digestJson({ workerOutput: "duplicate-completion" } as any),
        now: "2026-06-25T02:25:03.000Z"
      });
      expect(duplicateComplete.ok).toBe(false);
      expect((duplicateComplete as any).error.code).toBe("AC_PRECONDITION_FAILED");

      const succeeded = await daemon.jobsList(root, { statuses: ["succeeded"] });
      expect((succeeded.data as any).jobs).toHaveLength(1);
      expect((succeeded.data as any).jobs[0].job.outputDigest).toBe(outputDigest);
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime jobs refuse completion, retry, and cancellation issued from another repository", async () => {
    const owner = createGitRepo();
    const foreign = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:40:00.000Z"
      });
      mkdirSync(join(owner, "src"), { recursive: true });
      writeFileSync(join(owner, "src", "changed.ts"), "export const changed = true;\n", "utf8");
      mkdirSync(join(foreign, "src"), { recursive: true });
      writeFileSync(join(foreign, "src", "changed.ts"), "export const changed = true;\n", "utf8");

      const enqueue = await daemon.jobsEnqueueGitHook(owner, {
        source: "worktree",
        event: "post-edit",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.runtime-cross-repository"
      });
      const jobId = (enqueue.data as any).record.job.jobId;
      const claim = await daemon.jobsClaim(owner, {
        workerId: "worker.owner",
        leaseMs: 30_000,
        now: "2026-06-25T02:40:01.000Z"
      });
      expect((claim.data as any).job.job.jobId).toBe(jobId);

      const crossComplete = await daemon.jobsComplete(foreign, {
        jobId,
        workerId: "worker.owner",
        status: "succeeded",
        outputDigest: digestJson({ workerOutput: "cross-repository" } as any),
        now: "2026-06-25T02:40:02.000Z"
      });
      expect(crossComplete.ok).toBe(false);
      expect((crossComplete as any).error.code).toBe("AC_PRECONDITION_FAILED");
      expect((crossComplete as any).error.reasonCode).toBe("runtime-agent-job-out-of-scope");

      const crossRetry = await daemon.jobsRetry(foreign, {
        jobId,
        reason: "cross-repository-retry",
        now: "2026-06-25T02:40:03.000Z"
      });
      expect(crossRetry.ok).toBe(false);
      expect((crossRetry as any).error.reasonCode).toBe("runtime-agent-job-out-of-scope");

      const crossCancel = await daemon.jobsCancel(foreign, {
        jobId,
        reason: "cross-repository-cancel",
        now: "2026-06-25T02:40:04.000Z"
      });
      expect(crossCancel.ok).toBe(false);
      expect((crossCancel as any).error.reasonCode).toBe("runtime-agent-job-out-of-scope");

      const stillRunning = await daemon.jobsList(owner, { statuses: ["running"] });
      expect((stillRunning.data as any).jobs).toHaveLength(1);
      expect((stillRunning.data as any).jobs[0]).toMatchObject({
        job: { jobId, status: "running" },
        leaseOwner: "worker.owner"
      });

      const complete = await daemon.jobsComplete(owner, {
        jobId,
        workerId: "worker.owner",
        status: "failed",
        error: "owner-failure",
        now: "2026-06-25T02:40:05.000Z"
      });
      expect(complete.ok).toBe(true);
      const retry = await daemon.jobsRetry(owner, { jobId, reason: "owner-retry", now: "2026-06-25T02:40:06.000Z" });
      expect(retry.ok).toBe(true);
      const cancel = await daemon.jobsCancel(owner, { jobId, reason: "owner-cancel", now: "2026-06-25T02:40:07.000Z" });
      expect(cancel.ok).toBe(true);
      expect((cancel.data as any).job.job.status).toBe("cancelled");
    } finally {
      removeTempRepo(owner);
      removeTempRepo(foreign);
    }
  });

  test("issue #169: runtime jobs reject unsafe completion metadata without changing the running job", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({ localStore: store });
      writeFileSync(join(root, "changed.ts"), "export const changed = true;\n");
      const enqueue = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree", event: "post-edit", analysisKind: "architecture-delta",
        risk: "high", uncertainty: "high", coalesceKey: "privacy-regression"
      });
      const jobId = (enqueue.data as any).record.job.jobId;
      await daemon.jobsClaim(root, { workerId: "privacy-test" });
      const before = await daemon.jobsList(root);
      const forbidden = [
        "-----BEGIN PRIVATE KEY-----",
        "ghp_" + "x".repeat(24),
        "github_pat_" + "x".repeat(24),
        "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-before\n+after",
        "x".repeat(8193)
      ];
      for (const value of forbidden) {
        for (const field of ["runMetadata", "error"]) {
          const result = await daemon.jobsComplete(root, {
            jobId, workerId: "privacy-test", status: "failed",
            [field]: field === "runMetadata" ? { summary: value } : value
          } as any);
          expect(result.ok).toBe(false);
          expect(result.error?.code).toBe("AC_SCHEMA_INVALID");
          expect(await daemon.jobsList(root)).toEqual(before);
        }
      }
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime jobs persist provider run metadata on completion", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:30:00.000Z"
      });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "changed.ts"), "export const changed = true;\n", "utf8");

      const enqueue = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-edit",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.runtime-metadata"
      });
      const jobId = (enqueue.data as any).record.job.jobId;
      const claim = await daemon.jobsClaim(root, {
        workerId: "worker.metadata",
        leaseMs: 30_000,
        now: "2026-06-25T02:30:01.000Z"
      });
      const claimedJob = (claim.data as any).job.job;
      const outputDigest = digestJson({ workerOutput: "metadata" } as any);

      const complete = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.metadata",
        status: "succeeded",
        outputDigest,
        runMetadata: {
          schemaVersion: "archcontext.agent-investigation-run-metadata/v1",
          runnerId: "runner.codex",
          provider: "codex",
          modelId: "codex-test",
          promptTemplateDigest: claimedJob.promptTemplateDigest,
          inputDigest: claimedJob.inputDigest,
          outputDigest,
          startedAt: "2026-06-25T02:30:01.000Z",
          completedAt: "2026-06-25T02:30:04.000Z",
          durationMs: 3_000,
          outcome: "succeeded",
          attempts: 1,
          maxAttempts: 1,
          fallbackUsed: false
        },
        now: "2026-06-25T02:30:04.000Z"
      });

      expect(complete.ok).toBe(true);
      expect((complete.data as any).job.job.extensions.agentRun).toMatchObject({
        schemaVersion: "archcontext.agent-investigation-run-metadata/v1",
        runnerId: "runner.codex",
        provider: "codex",
        modelId: "codex-test",
        outputDigest,
        outcome: "succeeded",
        attempts: 1,
        fallbackUsed: false
      });
      const succeeded = await daemon.jobsList(root, { statuses: ["succeeded"] });
      expect((succeeded.data as any).jobs[0].job.extensions.agentRun).toMatchObject({
        provider: "codex",
        durationMs: 3_000,
        outputDigest
      });
      expect(JSON.stringify((succeeded.data as any).jobs[0].job.extensions.agentRun)).not.toContain("export const changed");
      expect(JSON.stringify((succeeded.data as any).jobs[0].job.extensions.agentRun)).not.toContain("diff --git");
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime jobs store agent documentation drafts only inside advisory proposal metadata", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:35:00.000Z"
      });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "changed.ts"), "export const changed = true;\n", "utf8");

      const enqueue = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-edit",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.runtime-proposal-plan"
      });
      const jobId = (enqueue.data as any).record.job.jobId;
      const claim = await daemon.jobsClaim(root, {
        workerId: "worker.proposal",
        leaseMs: 30_000,
        now: "2026-06-25T02:35:01.000Z"
      });
      const claimedJob = (claim.data as any).job.job;
      const outputDigest = digestJson({ workerOutput: "proposal-plan" } as any);
      const proposedDeltaDigest = digestJson({ delta: "selected" } as any);
      const prose = "## Context\n\nThe deterministic delta selected module.runtime.proposal for review.\n";
      const proseDigest = digestJson({ prose } as any);
      const documentationDraftInput = {
        schemaVersion: "archcontext.agent-documentation-draft/v1",
        draftId: "agent_doc_draft.runtime_proposal",
        jobId,
        reportId: "investigation_report.runtime_proposal",
        kind: "adr-prose",
        title: "Runtime proposal ADR prose",
        prose,
        proseDigest,
        targetPath: "docs/adr/ADR-0041-runtime-proposal.md",
        proposedDeltaDigests: [proposedDeltaDigest],
        evidenceBindingIds: ["binding.runtime.proposal"],
        inputDigest: claimedJob.inputDigest,
        outputDigest,
        promptTemplateDigest: claimedJob.promptTemplateDigest,
        acceptedProjection: false,
        authority: "advisory-only",
        requiredNextStep: "deterministic-validation",
        createdAt: "2026-06-25T02:35:03.000Z"
      };
      const proposalPlanInput = {
        schemaVersion: "archcontext.investigation-report-proposal-plan/v1",
        proposalId: "investigation_proposal.runtime_proposal",
        jobId,
        reportId: "investigation_report.runtime_proposal",
        repository: claimedJob.repository,
        worktree: claimedJob.worktree,
        inputDigest: claimedJob.inputDigest,
        outputDigest,
        proposedDeltaDigests: [proposedDeltaDigest],
        proposedDeltas: [],
        documentationDraftDigests: [digestJson(documentationDraftInput as any)],
        documentationDrafts: [{
          ...documentationDraftInput,
          draftDigest: digestJson(documentationDraftInput as any)
        }],
        evidenceBindingIds: ["binding.runtime.proposal"],
        evidenceIds: ["evidence.runtime.proposal"],
        validationDigest: investigationReportProposalValidationDigest({
          jobId,
          reportId: "investigation_report.runtime_proposal",
          inputDigest: claimedJob.inputDigest,
          outputDigest,
          proposedDeltaDigests: [proposedDeltaDigest],
          documentationDraftDigests: [digestJson(documentationDraftInput as any)],
          githubIssueDraftDigests: []
        }),
        directMutationAllowed: false,
        requiredNextStep: "deterministic-validation",
        forbiddenActions: ["write-ledger", "write-yaml", "write-docs", "apply-changeset", "run-tool", "execute-command"],
        authority: "advisory-only",
        retention: "no-raw-source-or-diff-bodies",
        createdAt: "2026-06-25T02:35:03.000Z"
      };
      const proposalPlan = {
        ...proposalPlanInput,
        proposalDigest: digestJson(proposalPlanInput as any)
      } as any;

      const invalid = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.proposal",
        status: "succeeded",
        outputDigest,
        proposalPlan: {
          ...proposalPlan,
          documentationDrafts: [{
            ...proposalPlan.documentationDrafts[0],
            acceptedProjection: true
          }]
        },
        now: "2026-06-25T02:35:03.500Z"
      } as any);
      expect(invalid.ok).toBe(false);
      expect((invalid as any).error.code).toBe("AC_SCHEMA_INVALID");

      const complete = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.proposal",
        status: "succeeded",
        outputDigest,
        proposalPlan,
        now: "2026-06-25T02:35:04.000Z"
      });

      expect(complete.ok).toBe(true);
      expect((complete.data as any).job.job.extensions.agentRun.proposalPlan.documentationDrafts[0]).toMatchObject({
        draftId: "agent_doc_draft.runtime_proposal",
        acceptedProjection: false,
        authority: "advisory-only",
        inputDigest: claimedJob.inputDigest,
        outputDigest
      });
      expect(existsSync(join(root, "docs/adr/ADR-0041-runtime-proposal.md"))).toBe(false);
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime jobs reject tampered github issue drafts inside advisory proposal metadata", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:45:00.000Z"
      });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "changed.ts"), "export const changed = true;\n", "utf8");

      const enqueue = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-edit",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.runtime-issue-draft-proposal"
      });
      const jobId = (enqueue.data as any).record.job.jobId;
      const claim = await daemon.jobsClaim(root, {
        workerId: "worker.issue-draft",
        leaseMs: 30_000,
        now: "2026-06-25T02:45:01.000Z"
      });
      const claimedJob = (claim.data as any).job.job;
      const outputDigest = digestJson({ workerOutput: "issue-draft-plan" } as any);
      const bodyMarkdown = "## Problem\n\nThe legacy wrapper still duplicates the v2 fallback path.\n";
      const bodyDigest = digestJson({ bodyMarkdown } as any);
      const githubIssueDraftInput = {
        schemaVersion: "archcontext.github-issue-draft/v1",
        draftId: "github_issue_draft.runtime_proposal",
        jobId,
        reportId: "investigation_report.runtime_proposal",
        kind: "task",
        priority: "P2",
        title: "Remove legacy wrapper v1 duplication",
        bodyMarkdown,
        bodyDigest,
        labels: ["architecture"],
        evidence: [{ path: "src/billing/legacy-wrapper-v1.ts", startLine: 1, note: "duplicate of v2 fallback" }],
        acceptance: ["legacy wrapper removed"],
        verificationCommands: ["bun test"],
        baseSha: claimedJob.worktree.headSha,
        inputDigest: claimedJob.inputDigest,
        outputDigest,
        promptTemplateDigest: claimedJob.promptTemplateDigest,
        authority: "advisory-only",
        requiredNextStep: "deterministic-validation",
        createdAt: "2026-06-25T02:45:03.000Z"
      };
      const githubIssueDraft = {
        ...githubIssueDraftInput,
        draftDigest: digestJson(githubIssueDraftInput as any)
      };
      const proposalPlanInput = {
        schemaVersion: "archcontext.investigation-report-proposal-plan/v1",
        proposalId: "investigation_proposal.runtime_issue_draft",
        jobId,
        reportId: "investigation_report.runtime_proposal",
        repository: claimedJob.repository,
        worktree: claimedJob.worktree,
        inputDigest: claimedJob.inputDigest,
        outputDigest,
        proposedDeltaDigests: [],
        proposedDeltas: [],
        documentationDraftDigests: [],
        documentationDrafts: [],
        githubIssueDraftDigests: [githubIssueDraft.draftDigest],
        githubIssueDrafts: [githubIssueDraft],
        evidenceBindingIds: [],
        evidenceIds: [],
        validationDigest: investigationReportProposalValidationDigest({
          jobId,
          reportId: "investigation_report.runtime_proposal",
          inputDigest: claimedJob.inputDigest,
          outputDigest,
          proposedDeltaDigests: [],
          documentationDraftDigests: [],
          githubIssueDraftDigests: [githubIssueDraft.draftDigest]
        }),
        directMutationAllowed: false,
        requiredNextStep: "deterministic-validation",
        forbiddenActions: ["write-ledger", "write-yaml", "write-docs", "apply-changeset", "run-tool", "execute-command"],
        authority: "advisory-only",
        retention: "no-raw-source-or-diff-bodies",
        createdAt: "2026-06-25T02:45:03.000Z"
      };
      const proposalPlan = {
        ...proposalPlanInput,
        proposalDigest: digestJson(proposalPlanInput as any)
      } as any;

      const tamperedBodyDigest = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.issue-draft",
        status: "succeeded",
        outputDigest,
        proposalPlan: {
          ...proposalPlan,
          githubIssueDrafts: [{ ...proposalPlan.githubIssueDrafts[0], bodyDigest: `sha256:${"0".repeat(64)}` }]
        },
        now: "2026-06-25T02:45:03.500Z"
      } as any);
      expect(tamperedBodyDigest.ok).toBe(false);
      expect((tamperedBodyDigest as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((tamperedBodyDigest as any).error.message).toContain("bodyDigest mismatch");

      const tamperedAuthority = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.issue-draft",
        status: "succeeded",
        outputDigest,
        proposalPlan: {
          ...proposalPlan,
          githubIssueDrafts: [{ ...proposalPlan.githubIssueDrafts[0], authority: "direct-mutation" }]
        },
        now: "2026-06-25T02:45:03.600Z"
      } as any);
      expect(tamperedAuthority.ok).toBe(false);
      expect((tamperedAuthority as any).error.message).toContain("advisory-only");

      // A draft's own draftDigest is recomputed from its full content (not just bodyDigest), so
      // tampering the digest label itself is caught even though every other field is untouched.
      const tamperedDraftDigest = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.issue-draft",
        status: "succeeded",
        outputDigest,
        proposalPlan: {
          ...proposalPlan,
          githubIssueDrafts: [{ ...proposalPlan.githubIssueDrafts[0], draftDigest: `sha256:${"1".repeat(64)}` }]
        },
        now: "2026-06-25T02:45:03.700Z"
      } as any);
      expect(tamperedDraftDigest.ok).toBe(false);
      expect((tamperedDraftDigest as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((tamperedDraftDigest as any).error.message).toContain("draftDigest mismatch");

      // plan.githubIssueDraftDigests (what actually gets written to the architecture ledger) must
      // match the digests of plan.githubIssueDrafts, even though the drafts themselves are untouched.
      const tamperedDigestsArray = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.issue-draft",
        status: "succeeded",
        outputDigest,
        proposalPlan: {
          ...proposalPlan,
          githubIssueDraftDigests: []
        },
        now: "2026-06-25T02:45:03.800Z"
      } as any);
      expect(tamperedDigestsArray.ok).toBe(false);
      expect((tamperedDigestsArray as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((tamperedDigestsArray as any).error.message).toContain("githubIssueDraftDigests must match");

      // plan.validationDigest is a claimed top-level integrity digest over the plan's own digests
      // (proposedDeltaDigests/documentationDraftDigests/githubIssueDraftDigests); the daemon must
      // recompute it rather than trust the claim, so forging it must be caught even though every
      // array it covers is untouched.
      const tamperedValidationDigest = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.issue-draft",
        status: "succeeded",
        outputDigest,
        proposalPlan: {
          ...proposalPlan,
          validationDigest: digestJson({ validation: "forged" } as any)
        },
        now: "2026-06-25T02:45:03.850Z"
      } as any);
      expect(tamperedValidationDigest.ok).toBe(false);
      expect((tamperedValidationDigest as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((tamperedValidationDigest as any).error.message).toContain("validationDigest mismatch");

      // plan.proposalDigest is recomputed as digestJson(plan minus proposalDigest) and must cover
      // the whole plan; forging just the digest label, with every other field untouched, must
      // still be caught.
      const tamperedProposalDigest = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.issue-draft",
        status: "succeeded",
        outputDigest,
        proposalPlan: {
          ...proposalPlan,
          proposalDigest: `sha256:${"2".repeat(64)}`
        },
        now: "2026-06-25T02:45:03.900Z"
      } as any);
      expect(tamperedProposalDigest.ok).toBe(false);
      expect((tamperedProposalDigest as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((tamperedProposalDigest as any).error.message).toContain("proposalDigest mismatch");

      const complete = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.issue-draft",
        status: "succeeded",
        outputDigest,
        proposalPlan,
        now: "2026-06-25T02:45:04.000Z"
      });
      expect(complete.ok).toBe(true);
      expect((complete.data as any).job.job.extensions.agentRun.proposalPlan.githubIssueDrafts[0]).toMatchObject({
        draftId: "github_issue_draft.runtime_proposal",
        authority: "advisory-only",
        priority: "P2"
      });
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime jobs skip generated projection hook changes without enqueueing", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:10:00.000Z"
      });
      mkdirSync(join(root, ".archcontext", "generated"), { recursive: true });
      writeFileSync(join(root, ".archcontext", "generated", "ARCHITECTURE.md"), "<!-- Generated by ArchContext. Do not edit by hand. -->\n", "utf8");

      const skipped = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-write"
      });
      expect(skipped.ok).toBe(true);
      expect((skipped.data as any)).toMatchObject({
        schemaVersion: "archcontext.runtime-agent-job-skip/v1",
        skipped: true,
        enqueued: false,
        reasonCode: "archcontext-generated-projection",
        source: "worktree"
      });
      expect((skipped.data as any).change.paths).toEqual([
        { path: ".archcontext/generated/ARCHITECTURE.md", status: "added", rawStatus: "??" }
      ]);
      expect(JSON.stringify(skipped.data)).not.toContain("Do not edit by hand");

      const list = await daemon.jobsList(root);
      expect((list.data as any).count).toBe(0);
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime jobs skip clean hook changes without enqueueing", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:11:00.000Z"
      });

      const skipped = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-write"
      });
      expect(skipped.ok).toBe(true);
      expect((skipped.data as any)).toMatchObject({
        schemaVersion: "archcontext.runtime-agent-job-skip/v1",
        skipped: true,
        enqueued: false,
        reasonCode: "no-changed-paths",
        source: "worktree",
        analysisKind: "architecture-delta"
      });

      const list = await daemon.jobsList(root);
      expect((list.data as any).count).toBe(0);
    } finally {
      removeTempRepo(root);
    }
  });

});
