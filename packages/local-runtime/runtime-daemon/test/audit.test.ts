import { expectSameExistingPath, createGitRepo, rmSync, removeTempRepo, createStartedTestDaemon } from "./runtime-test-fixtures";
import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { digestJson, INVESTIGATION_REPORT_SCHEMA_VERSION, type Json, type JsonEnvelope } from "@archcontext/contracts";
import { type CommandInvestigationRunnerTransportInput, type CommandInvestigationRunnerTransportResult } from "@archcontext/core/agent-orchestrator";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { AUDIT_CONSENT_REQUIRED_REASON_CODE, AUDIT_EGRESS_POLICY, grantAuditConsent, readAuditConsent, revokeAuditConsent } from "../src/audit-consent";
import { createNodeGithubIssueExecutor, githubIssueFooterMarker, type GithubIssueCreatedRecord, type GithubIssueExecutorPort, type GithubIssueListedRecord } from "../src/github-issue-executor";

const PREVIOUS_ARCHCONTEXT_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const RUNTIME_TEST_STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-audit-state-"));
process.env.ARCHCONTEXT_STATE_DIR = RUNTIME_TEST_STATE_ROOT;
afterAll(() => {
  if (PREVIOUS_ARCHCONTEXT_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_ARCHCONTEXT_STATE_DIR;
  rmSync(RUNTIME_TEST_STATE_ROOT, { recursive: true, force: true });
});

describe("daemon audit service", () => {
  test("local-only denies audit before queue or publisher effects despite manifest and consent", async () => {
    const root = createGitRepo();
    enableAuditWithConsent(root);
    const store = new TestLocalStore();
    let transportCalls = 0;
    let publisherCalls = 0;
    const previousMode = process.env.ARCHCONTEXT_EGRESS_MODE;
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        investigationTransport: async () => { transportCalls++; throw new Error("unexpected investigator"); },
        githubIssueExecutor: {
          repoView: async () => { publisherCalls++; throw new Error("unexpected repo probe"); },
          listRecentIssues: async () => { publisherCalls++; return []; },
          createIssue: async () => { publisherCalls++; throw new Error("unexpected publish"); }
        }
      });
      const eventCount = store.architectureEvents.length;
      process.env.ARCHCONTEXT_EGRESS_MODE = "local-only";
      await expect(daemon.auditRun(root, { wait: true })).rejects.toThrow("egress-denied: agent-audit");
      await expect(daemon.auditApprove(root, { runId: "audit_run.not_enqueued" })).rejects.toThrow("egress-denied: github-issue-publishing");
      expect(transportCalls).toBe(0);
      expect(publisherCalls).toBe(0);
      expect(store.architectureEvents.length).toBe(eventCount);
      expect(((await daemon.auditList(root)).data as any).count).toBe(0);
    } finally {
      if (previousMode === undefined) delete process.env.ARCHCONTEXT_EGRESS_MODE;
      else process.env.ARCHCONTEXT_EGRESS_MODE = previousMode;
      removeTempRepo(root);
    }
  });

  test("audit run records pending drafts without external side-effect", async () => {
    const root = createGitRepo();
    enableAuditWithConsent(root);
    const store = new TestLocalStore();
    const draftRecords = [
      {
        kind: "spec",
        priority: "P1",
        title: "Split the daemon god-file",
        bodyMarkdown: "## Problem\n\nThe daemon module mixes RPC dispatch with ledger writes in one file.\n",
        labels: ["architecture"],
        evidence: [{ path: "packages/local-runtime/runtime-daemon/src/index.ts", startLine: 1, note: "single-file daemon module" }],
        acceptance: ["daemon RPC handlers live in a dedicated module"],
        verificationCommands: ["bun run typecheck"]
      },
      {
        kind: "task",
        priority: "P2",
        title: "Add direct sqlite coverage for audit_runs reads",
        bodyMarkdown: "## Task\n\nCover listAuditRuns/getAuditRun with a dedicated sqlite test.\n",
        labels: [],
        evidence: [{ path: "packages/local-runtime/local-store-sqlite/src/index.ts", startLine: 1, note: "audit run read path" }],
        acceptance: ["listAuditRuns and getAuditRun have direct sqlite coverage"],
        verificationCommands: []
      }
    ];
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:40:00.000Z",
        investigationTransport: async (input: CommandInvestigationRunnerTransportInput) => {
          const separatorIndex = input.stdin.lastIndexOf("\n\n");
          const runnerInput = JSON.parse(separatorIndex === -1 ? input.stdin : input.stdin.slice(separatorIndex + 2));
          const jobId = runnerInput.job.jobId as string;
          const report = {
            schemaVersion: INVESTIGATION_REPORT_SCHEMA_VERSION,
            reportId: `investigation_report.audit_test_${jobId.slice(-8)}`,
            jobId,
            status: "succeeded",
            findings: [],
            outputDigest: digestJson({ jobId, draftRecords } as unknown as Json),
            createdAt: "2026-06-25T02:40:03.000Z",
            directMutationAllowed: false,
            extensions: { githubIssueDrafts: draftRecords }
          };
          return { exitCode: 0, stdout: JSON.stringify({ report }) };
        }
      });

      const run = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(run.ok).toBe(true);
      expect((run.data as any).status).toBe("pending");
      expect((run.data as any).pendingDraftCount).toBe(2);
      const runId = (run.data as any).runId;

      const list = await daemon.auditList(root);
      expect((list.data as any).count).toBe(1);
      const [ledgerRun] = (list.data as any).runs;
      expect(ledgerRun.runId).toBe(runId);
      expect(ledgerRun.status).toBe("pending");
      expect(ledgerRun.issueDraftDigests).toHaveLength(2);
      expect(ledgerRun.repoNameWithOwner).toBe("local/unknown");
      expect(ledgerRun.repoVisibility).toBe("private");

      const show = await daemon.auditShow(root, runId);
      expect(show.ok).toBe(true);
      expect((show.data as any).run.runId).toBe(runId);
      expect((show.data as any).githubIssueDrafts).toHaveLength(2);
      expect((show.data as any).githubIssueDrafts.map((draft: any) => draft.priority).sort()).toEqual(["P1", "P2"]);

      const pendingOnly = await daemon.auditList(root, { statuses: ["pending"] });
      expect((pendingOnly.data as any).count).toBe(1);
      const failedOnly = await daemon.auditList(root, { statuses: ["failed"] });
      expect((failedOnly.data as any).count).toBe(0);

      // Zero external side-effect: no gh calls (the fake transport never shells out), and no
      // repository files were written by this advisory-only flow beyond the manifest fixture the
      // test itself seeded (auditRun never scaffolds/writes generated docs or model files).
      expect(existsSync(join(root, ".archcontext", "generated"))).toBe(false);
      const appendedEvent = store.architectureEvents.find((event) => event.eventType === "architecture.agent_audit.run_pending");
      expect(appendedEvent).toBeDefined();
      const serializedEvent = JSON.stringify(appendedEvent);
      expect(serializedEvent).not.toContain("https://github.com");
      expect(serializedEvent).not.toContain("issuedIssues");
      expect(serializedEvent).not.toContain("bodyMarkdown");
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit run records a failed run without pending drafts when the investigation fails", async () => {
    const root = createGitRepo();
    enableAuditWithConsent(root);
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:41:00.000Z",
        investigationTransport: async () => ({ exitCode: 1, stdout: "", stderr: "claude not installed" })
      });

      const run = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(run.ok).toBe(true);
      expect((run.data as any).status).toBe("failed");
      expect((run.data as any).pendingDraftCount).toBe(0);

      const list = await daemon.auditList(root);
      expect((list.data as any).count).toBe(1);
      expect((list.data as any).runs[0].status).toBe("failed");
      expect((list.data as any).runs[0].issueDraftDigests).toEqual([]);
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit run is gated by audit.githubIssues.enabled at the daemon layer, not only at the CLI", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    let transportCalls = 0;
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:52:00.000Z",
        investigationTransport: async () => {
          transportCalls += 1;
          return { exitCode: 1, stdout: "", stderr: "should never run while the gate is closed" };
        }
      });

      // No .archcontext/manifest.yaml at all: fails closed (disabled), matching the CLI default.
      const disabledByDefault = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(disabledByDefault.ok).toBe(false);
      expect((disabledByDefault as any).error.code).toBe("AC_CAPABILITY_UNSUPPORTED");
      expect(transportCalls).toBe(0);

      // Explicit `enabled: false` is also rejected before anything is spawned or enqueued.
      writeAuditManifest(root, false);
      const disabledExplicitly = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(disabledExplicitly.ok).toBe(false);
      expect((disabledExplicitly as any).error.code).toBe("AC_CAPABILITY_UNSUPPORTED");
      expect(transportCalls).toBe(0);
      const listWhileDisabled = await daemon.auditList(root);
      expect((listWhileDisabled.data as any).count).toBe(0);

      // Issue #161: a manifest that enables audit (as in a freshly cloned third-party repository)
      // is only a capability declaration; without user-level consent the run still fails closed.
      writeAuditManifest(root, true);
      const withoutConsent = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(withoutConsent.ok).toBe(false);
      expect((withoutConsent as any).error.code).toBe("AC_USER_CONFIRMATION_REQUIRED");
      expect((withoutConsent as any).error.reasonCode).toBe(AUDIT_CONSENT_REQUIRED_REASON_CODE);
      expect((withoutConsent as any).error.message).toContain("archctx audit consent");
      expect(transportCalls).toBe(0);
      expect(((await daemon.auditList(root)).data as any).count).toBe(0);

      // Manifest capability plus user-level consent allows the run to reach the (fake) transport.
      grantAuditConsent(root);
      const enabled = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(enabled.ok).toBe(true);
      expect(transportCalls).toBe(1);
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit run claims only its own enqueued job and never steals an unrelated queued job's lease", async () => {
    const root = createGitRepo();
    enableAuditWithConsent(root);
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:55:00.000Z",
        investigationTransport: async (input: CommandInvestigationRunnerTransportInput) => {
          const separatorIndex = input.stdin.lastIndexOf("\n\n");
          const runnerInput = JSON.parse(separatorIndex === -1 ? input.stdin : input.stdin.slice(separatorIndex + 2));
          const jobId = runnerInput.job.jobId as string;
          const report = {
            schemaVersion: INVESTIGATION_REPORT_SCHEMA_VERSION,
            reportId: `investigation_report.claim_isolation_test_${jobId.slice(-8)}`,
            jobId,
            status: "succeeded",
            findings: [],
            outputDigest: digestJson({ jobId } as unknown as Json),
            createdAt: "2026-06-25T02:55:03.000Z",
            directMutationAllowed: false,
            extensions: {}
          };
          return { exitCode: 0, stdout: JSON.stringify({ report }) };
        }
      });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "changed.ts"), "export const changed = true;\n", "utf8");

      // Pre-seed a higher-priority queued job (e.g. a normal git-hook-triggered
      // architecture-delta job) in the same repository/workspace scope that is still waiting in
      // the queue when auditRun enqueues and claims its own job.
      const preseedEnqueue = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-edit",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.claim-isolation-preseed",
        priority: 100
      });
      expect((preseedEnqueue.data as any).enqueued).toBe(true);
      const preseedJobId = (preseedEnqueue.data as any).record.job.jobId;

      const run = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(run.ok).toBe(true);
      expect((run.data as any).status).toBe("pending");
      const auditJobId = (run.data as any).jobId;
      expect(auditJobId).not.toBe(preseedJobId);

      const jobs = await daemon.jobsList(root);
      const preseedRecord = (jobs.data as any).jobs.find((record: any) => record.job.jobId === preseedJobId);
      expect(preseedRecord).toBeDefined();
      // The pre-seeded job must be untouched: still queued, never leased by the audit claim.
      expect(preseedRecord.job.status).toBe("queued");
      expect(preseedRecord.leaseOwner).toBeUndefined();

      const auditRecord = (jobs.data as any).jobs.find((record: any) => record.job.jobId === auditJobId);
      expect(auditRecord).toBeDefined();
      expect(auditRecord.job.status).toBe("succeeded");
      expect(auditRecord.leaseOwner).toBeUndefined();
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit run binds the investigation transport's cwd to the audited repository root", async () => {
    const root = createGitRepo();
    enableAuditWithConsent(root);
    const store = new TestLocalStore();
    let capturedCwd: string | undefined;
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:57:00.000Z",
        investigationTransport: async (input: CommandInvestigationRunnerTransportInput) => {
          capturedCwd = input.cwd;
          const separatorIndex = input.stdin.lastIndexOf("\n\n");
          const runnerInput = JSON.parse(separatorIndex === -1 ? input.stdin : input.stdin.slice(separatorIndex + 2));
          const jobId = runnerInput.job.jobId as string;
          const report = {
            schemaVersion: INVESTIGATION_REPORT_SCHEMA_VERSION,
            reportId: `investigation_report.cwd_test_${jobId.slice(-8)}`,
            jobId,
            status: "succeeded",
            findings: [],
            outputDigest: digestJson({ jobId } as unknown as Json),
            createdAt: "2026-06-25T02:57:03.000Z",
            directMutationAllowed: false,
            extensions: {}
          };
          return { exitCode: 0, stdout: JSON.stringify({ report }) };
        }
      });

      const run = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(run.ok).toBe(true);
      expect(capturedCwd).toBeDefined();
      expectSameExistingPath(capturedCwd!, root);
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit run defaults to async: returns started immediately and the run reaches pending in the background, observable via audit list", async () => {
    const root = createGitRepo();
    enableAuditWithConsent(root);
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-07-05T06:00:00.000Z",
        investigationTransport: async (input: CommandInvestigationRunnerTransportInput) => {
          const separatorIndex = input.stdin.lastIndexOf("\n\n");
          const runnerInput = JSON.parse(separatorIndex === -1 ? input.stdin : input.stdin.slice(separatorIndex + 2));
          const jobId = runnerInput.job.jobId as string;
          const report = {
            schemaVersion: INVESTIGATION_REPORT_SCHEMA_VERSION,
            reportId: `investigation_report.async_test_${jobId.slice(-8)}`,
            jobId,
            status: "succeeded",
            findings: [],
            outputDigest: digestJson({ jobId } as unknown as Json),
            createdAt: "2026-07-05T06:00:03.000Z",
            directMutationAllowed: false,
            extensions: {}
          };
          return { exitCode: 0, stdout: JSON.stringify({ report }) };
        }
      });

      // No `wait: true`: the RPC call itself must resolve immediately with "started", never
      // blocking for the full (here fake, but in production 10-25 minute) investigation.
      const started = await daemon.auditRun(root, { timeoutMs: 5_000 });
      expect(started.ok).toBe(true);
      expect((started.data as any).status).toBe("started");
      expect((started.data as any).jobId).toBeDefined();
      // No runId yet: a runId is only assigned once the ledger append happens, which only
      // happens after the (still in-flight, backgrounded) investigation completes.
      expect((started.data as any).runId).toBeUndefined();
      const jobId = (started.data as any).jobId as string;

      // Poll audit list the same way the CLI does, until the detached background drive settles.
      let match: any;
      for (let attempt = 0; attempt < 200 && !match; attempt += 1) {
        const list = await daemon.auditList(root);
        match = ((list.data as any)?.runs ?? []).find((run: any) => run.jobId === jobId);
        if (!match) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(match).toBeDefined();
      expect(match.status).toBe("pending");

      const show = await daemon.auditShow(root, match.runId);
      expect(show.ok).toBe(true);
      expect((show.data as any).run.jobId).toBe(jobId);
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit run with wait: true keeps the original fully-synchronous contract", async () => {
    const root = createGitRepo();
    enableAuditWithConsent(root);
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-07-05T06:10:00.000Z",
        investigationTransport: async () => ({ exitCode: 1, stdout: "", stderr: "claude not installed" })
      });

      const run = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(run.ok).toBe(true);
      // Resolves directly to a terminal status, not "started" — wait: true never leaves anything
      // to poll for.
      expect((run.data as any).status).toBe("failed");
      expect((run.data as any).runId).toBeDefined();
    } finally {
      removeTempRepo(root);
    }
  });

  test("daemon stop aborts an in-flight audit run's investigation transport signal", async () => {
    const root = createGitRepo();
    enableAuditWithConsent(root);
    const store = new TestLocalStore();
    let capturedSignal: AbortSignal | undefined;
    let notifyTransportStarted: (() => void) | undefined;
    const transportStarted = new Promise<void>((resolve) => {
      notifyTransportStarted = resolve;
    });
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-07-05T07:00:00.000Z",
        investigationTransport: (input: CommandInvestigationRunnerTransportInput) => {
          capturedSignal = input.signal;
          notifyTransportStarted?.();
          // Simulates a real long-running `claude` subprocess: never resolves on its own, only in
          // response to the daemon aborting it (exactly what `stop()` below is expected to do).
          return new Promise<CommandInvestigationRunnerTransportResult>((_resolve, reject) => {
            input.signal?.addEventListener("abort", () => reject(new Error("investigation-runner-aborted")), { once: true });
          });
        }
      });

      const started = await daemon.auditRun(root, { timeoutMs: 60_000 });
      expect(started.ok).toBe(true);
      expect((started.data as any).status).toBe("started");

      await transportStarted;
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal!.aborted).toBe(false);

      await daemon.stop();

      // The one property `stop()` guarantees unconditionally: every in-flight audit's transport
      // signal is aborted (which, in the real node transport, kills the child process), so nothing
      // is ever left running orphaned past the daemon's own lifetime. Whether the resulting failed
      // run finishes being recorded before the store closes is a separate, best-effort race (see
      // the comment on `stop()` in src/index.ts) and is intentionally not asserted here.
      expect(capturedSignal!.aborted).toBe(true);
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit run job survives a concurrent stale-cancel sweep via advisory-only-on-stale, while a default-policy hook job in the same sweep still gets cancelled", async () => {
    const root = createGitRepo();
    enableAuditWithConsent(root);
    const store = new TestLocalStore();
    let sweepExpiredJobIds: string[] = [];
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-07-05T05:00:00.000Z",
        investigationTransport: async (input: CommandInvestigationRunnerTransportInput) => {
          // Simulate a concurrent git-hook enqueue racing in while the audit job is still
          // "running" — e.g. the audited repository's own untracked .archcontext/ content
          // shifting mid-flight (the exact e2e-observed trigger for F2). This bumps the worktree
          // digest and drives jobsEnqueueGitHook's own cancelStaleRuntimeAgentJobs sweep against
          // every queued/running job in scope, including the in-flight audit job itself.
          mkdirSync(join(root, "src"), { recursive: true });
          writeFileSync(join(root, "src", "concurrent-change.ts"), "export const concurrent = true;\n", "utf8");
          const sweep = await daemon.jobsEnqueueGitHook(root, {
            source: "worktree",
            event: "concurrent-sweep",
            analysisKind: "architecture-delta",
            risk: "high",
            uncertainty: "high",
            coalesceKey: "coalesce.stale-cancel-sweep"
          });
          expect((sweep.data as any).enqueued).toBe(true);
          sweepExpiredJobIds = (sweep.data as any).expiredJobIds as string[];

          const separatorIndex = input.stdin.lastIndexOf("\n\n");
          const runnerInput = JSON.parse(separatorIndex === -1 ? input.stdin : input.stdin.slice(separatorIndex + 2));
          const jobId = runnerInput.job.jobId as string;
          const report = {
            schemaVersion: INVESTIGATION_REPORT_SCHEMA_VERSION,
            reportId: `investigation_report.stale_cancel_test_${jobId.slice(-8)}`,
            jobId,
            status: "succeeded",
            findings: [],
            outputDigest: digestJson({ jobId } as unknown as Json),
            createdAt: "2026-07-05T05:00:03.000Z",
            directMutationAllowed: false,
            extensions: {}
          };
          return { exitCode: 0, stdout: JSON.stringify({ report }) };
        }
      });

      // Pre-seed a normal git-hook job (default stalePolicy: cancel-on-head-change) so it is
      // still "queued" — and already stale relative to the repository state at the time of the
      // concurrent sweep above — when that sweep runs.
      mkdirSync(join(root, "docs"), { recursive: true });
      writeFileSync(join(root, "docs", "pre-existing-change.md"), "# pre-existing\n", "utf8");
      const preseedEnqueue = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-edit",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.stale-cancel-preseed"
      });
      expect((preseedEnqueue.data as any).enqueued).toBe(true);
      const hookJobId = (preseedEnqueue.data as any).record.job.jobId as string;

      const run = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(run.ok).toBe(true);
      expect((run.data as any).status).toBe("pending");
      const auditJobId = (run.data as any).jobId as string;

      // The audit job must survive the concurrent sweep (advisory-only-on-stale)...
      expect(sweepExpiredJobIds).not.toContain(auditJobId);
      // ...while the pre-seeded hook job (default cancel-on-head-change) is cancelled by the same
      // sweep, proving this is a policy-specific fix, not a blanket "never cancel" regression.
      expect(sweepExpiredJobIds).toContain(hookJobId);

      const jobs = await daemon.jobsList(root);
      const hookRecord = (jobs.data as any).jobs.find((record: any) => record.job.jobId === hookJobId);
      expect(hookRecord).toBeDefined();
      expect(hookRecord.job.status).toBe("expired");
      const auditRecord = (jobs.data as any).jobs.find((record: any) => record.job.jobId === auditJobId);
      expect(auditRecord).toBeDefined();
      expect(auditRecord.job.status).toBe("succeeded");
    } finally {
      removeTempRepo(root);
    }
  });

  test("ADR-0042 red line: the investigation runner never has a path to the github issue executor; only audit approve does", async () => {
    const { executor, calls } = fakeGithubIssueExecutor();
    const transportCalls: CommandInvestigationRunnerTransportInput[] = [];
    const root = createGitRepo();
    addGitRemote(root, "https://github.com/acme/widgets.git");
    enableAuditWithConsent(root);
    const store = new TestLocalStore();
    const draftRecords = [auditDraftRecord()];
    const now = "2026-07-05T01:00:00.000Z";
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => now,
        githubIssueExecutor: executor,
        investigationTransport: async (input: CommandInvestigationRunnerTransportInput) => {
          transportCalls.push(input);
          return auditInvestigationTransportWithDrafts(draftRecords, now)(input);
        }
      });

      const run = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(run.ok).toBe(true);
      expect((run.data as any).status).toBe("pending");
      const runId = (run.data as any).runId as string;

      // The runner's own transport call used the exact ADR-0041 read-only claude invocation shape
      // (proving this really went through the same locked-down subagent path this codebase always
      // uses), and throughout the entire auditRun call the gh executor was never touched at all —
      // it is a separate injected dependency the investigation runner has no reference to.
      expect(transportCalls).toHaveLength(1);
      expect(transportCalls[0]!.command).toBe("claude");
      expect(transportCalls[0]!.args).toContain("--strict-mcp-config");
      expect(calls.repoView).toHaveLength(0);
      expect(calls.listRecentIssues).toHaveLength(0);
      expect(calls.createIssue).toHaveLength(0);

      // Reading the pending run back (list/show) is also gh-free: an unapproved run never
      // touches the executor no matter how many times it is read.
      await daemon.auditList(root);
      await daemon.auditShow(root, runId);
      expect(calls.repoView).toHaveLength(0);
      expect(calls.listRecentIssues).toHaveLength(0);
      expect(calls.createIssue).toHaveLength(0);

      // Only auditApprove reaches the executor.
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const approve = await daemon.auditApprove(root, { runId });
        expect(approve.ok).toBe(true);
      });
      expect(calls.repoView.length).toBeGreaterThan(0);
      expect(calls.createIssue.length).toBeGreaterThan(0);
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit approve is gated by audit.githubIssues.enabled, distinct from audit run's own gate, zero gh calls when disabled", async () => {
    const { executor, calls } = fakeGithubIssueExecutor();
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({ localStore: store, githubIssueExecutor: executor });
      const result = await daemon.auditApprove(root, { runId: "audit_run.does_not_matter" });
      expect(result.ok).toBe(false);
      expect((result as any).error.code).toBe("AC_CAPABILITY_UNSUPPORTED");
      expect(calls.repoView).toHaveLength(0);
      expect(calls.createIssue).toHaveLength(0);
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit approve fails closed without user-level consent even when the manifest enables audit, zero gh calls", async () => {
    const { executor, calls } = fakeGithubIssueExecutor();
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git" });
    try {
      // Revoking after the run landed models a user withdrawing consent before publishing.
      expect(revokeAuditConsent(fixture.root).revoked).toBe(true);
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const result = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(result.ok).toBe(false);
        expect((result as any).error.code).toBe("AC_USER_CONFIRMATION_REQUIRED");
        expect((result as any).error.reasonCode).toBe(AUDIT_CONSENT_REQUIRED_REASON_CODE);
      });
      expect(calls.repoView).toHaveLength(0);
      expect(calls.createIssue).toHaveLength(0);
      expect(((await fixture.daemon.auditShow(fixture.root, fixture.runId)).data as any).run.status).toBe("pending");
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("audit consent lives in the user state dir and is bound to the repository identity and origin", () => {
    const first = createGitRepo();
    const second = createGitRepo();
    try {
      expect(readAuditConsent(first)).toMatchObject({ granted: false, reason: "not-granted" });
      const granted = grantAuditConsent(first);
      expect(granted.path.startsWith(resolve(RUNTIME_TEST_STATE_ROOT))).toBe(true);
      expect(granted.path.startsWith(realpathSync.native(first))).toBe(false);
      expect(existsSync(join(first, ".archcontext"))).toBe(false);
      expect(readAuditConsent(first).granted).toBe(true);
      // Another repository never inherits it.
      expect(readAuditConsent(second)).toMatchObject({ granted: false, reason: "not-granted" });
      // Re-pointing origin (e.g. a different repository cloned into the same path) invalidates it.
      addGitRemote(first, "https://github.com/attacker/other.git");
      expect(readAuditConsent(first)).toMatchObject({ granted: false, reason: "origin-mismatch" });
      grantAuditConsent(first);
      expect(readAuditConsent(first).granted).toBe(true);
      // A record copied from another repository is rejected.
      const secondPath = readAuditConsent(second).path;
      mkdirSync(dirname(secondPath), { recursive: true });
      writeFileSync(secondPath, readFileSync(granted.path, "utf8"), "utf8");
      expect(readAuditConsent(second)).toMatchObject({ granted: false, reason: "repository-mismatch" });
      // A record granted under a different egress policy is rejected.
      const record = JSON.parse(readFileSync(granted.path, "utf8"));
      writeFileSync(granted.path, JSON.stringify({ ...record, egressPolicyDigest: `sha256:${"0".repeat(64)}` }), "utf8");
      expect(readAuditConsent(first)).toMatchObject({ granted: false, reason: "egress-policy-changed" });
      expect(revokeAuditConsent(first).revoked).toBe(true);
      expect(readAuditConsent(first)).toMatchObject({ granted: false, reason: "not-granted" });
    } finally {
      revokeAuditConsent(second);
      removeTempRepo(first);
      removeTempRepo(second);
    }
  });

  test("audit consent never stores or returns credentials embedded in the origin URL", () => {
    const root = createGitRepo();
    const secret = "ghp_FAKE0123456789abcdefghijklmnopqrstuv";
    addGitRemote(root, `https://x-access-token:${secret}@github.com/acme/widgets.git`);
    try {
      const granted = grantAuditConsent(root);
      expect(granted.record.origin).toBe("https://github.com/acme/widgets.git");
      expect(JSON.stringify(granted)).not.toContain(secret);
      expect(readFileSync(granted.path, "utf8")).not.toContain(secret);
      expect(readFileSync(granted.path, "utf8")).not.toContain("x-access-token");
      const status = readAuditConsent(root);
      expect(status.granted).toBe(true);
      expect(JSON.stringify(status)).not.toContain(secret);
      // Rotating only the embedded credential keeps the same repository binding.
      execFileSync("git", ["remote", "set-url", "origin", "https://x-access-token:ghp_ROTATED@github.com/acme/widgets.git"], { cwd: root, stdio: "ignore" });
      expect(readAuditConsent(root).granted).toBe(true);
      // scp-style remotes keep host:path only.
      execFileSync("git", ["remote", "set-url", "origin", "git@github.com:acme/widgets.git"], { cwd: root, stdio: "ignore" });
      expect(grantAuditConsent(root).record.origin).toBe("github.com:acme/widgets.git");
    } finally {
      revokeAuditConsent(root);
      removeTempRepo(root);
    }
  });

  test("the audit egress policy digest covers every forwarded env name, including Bedrock/Vertex conditionals", () => {
    const policyText = JSON.stringify(AUDIT_EGRESS_POLICY);
    for (const name of ["PATH", "ANTHROPIC_", "ADMIN", "AWS_SECRET_ACCESS_KEY", "AWS_CONTAINER_AUTHORIZATION_TOKEN", "CLOUDSDK_CONFIG", "VERTEX_REGION_CLAUDE_", "DISABLE_TELEMETRY"]) {
      expect(policyText).toContain(name);
    }
  });

  test("audit consent is written atomically with 0600 and replaces a symlink instead of following it", () => {
    const root = createGitRepo();
    const decoyDir = mkdtempSync(join(tmpdir(), "archctx-consent-decoy-"));
    const decoy = join(decoyDir, "decoy.json");
    writeFileSync(decoy, "decoy\n", "utf8");
    try {
      const target = readAuditConsent(root).path;
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(decoy, target);
      // A symlinked record is not trusted as consent.
      expect(readAuditConsent(root)).toMatchObject({ granted: false, reason: "unreadable" });
      grantAuditConsent(root);
      expect(readFileSync(decoy, "utf8")).toBe("decoy\n");
      expect(lstatSync(target).isSymbolicLink()).toBe(false);
      expect(readAuditConsent(root).granted).toBe(true);
      if (process.platform !== "win32") {
        expect(statSync(target).mode & 0o777).toBe(0o600);
        chmodSync(target, 0o644);
        grantAuditConsent(root);
        expect(statSync(target).mode & 0o777).toBe(0o600);
      }
      // No temp files are left behind next to the record.
      expect(readdirSync(dirname(target)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    } finally {
      revokeAuditConsent(root);
      removeTempRepo(root);
      rmSync(decoyDir, { recursive: true, force: true });
    }
  });

  test("audit approve rejects a repository with no resolvable git remote before any gh call", async () => {
    const { executor, calls } = fakeGithubIssueExecutor();
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor });
    try {
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const result = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(result.ok).toBe(false);
        expect((result as any).error.code).toBe("AC_PRECONDITION_FAILED");
        expect((result as any).error.message).toContain("resolvable GitHub owner/repo");
      });
      expect(calls.repoView).toHaveLength(0);
      expect(calls.createIssue).toHaveLength(0);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("audit approve requires ARCHCONTEXT_GH_ISSUES_TOKEN and never falls back to ambient gh auth", async () => {
    const { executor, calls } = fakeGithubIssueExecutor();
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git" });
    try {
      await withAuditApproveToken(undefined, async () => {
        const result = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(result.ok).toBe(false);
        expect((result as any).error.code).toBe("AC_PRECONDITION_FAILED");
        expect((result as any).error.message).toContain("ARCHCONTEXT_GH_ISSUES_TOKEN");
      });
      expect(calls.repoView).toHaveLength(0);
      expect(calls.createIssue).toHaveLength(0);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("audit approve fails closed when the repository visibility probe fails, zero issues created", async () => {
    const { executor, calls } = fakeGithubIssueExecutor({ repoViewError: new Error("gh repo view: network unreachable") });
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git" });
    try {
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const result = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(result.ok).toBe(false);
        expect((result as any).error.code).toBe("AC_PRECONDITION_FAILED");
        expect((result as any).error.message).toContain("visibility");
      });
      expect(calls.createIssue).toHaveLength(0);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("ADR-0042 red line: publishing to a public repository without a valid confirmation token never files an issue", async () => {
    const { executor, calls } = fakeGithubIssueExecutor({ visibility: "public" });
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git" });
    try {
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const withoutToken = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(withoutToken.ok).toBe(false);
        expect((withoutToken as any).error.code).toBe("AC_USER_CONFIRMATION_REQUIRED");
        expect((withoutToken as any).error.message).toContain("archctx audit approve");
        expect((withoutToken as any).error.message).toContain("--confirm-public-repo");

        const wrongToken = await fixture.daemon.auditApprove(fixture.root, {
          runId: fixture.runId,
          confirmPublicToken: "public:wrong/repo:0000000000000000000000000000000000000000:audit_run.wrong"
        });
        expect(wrongToken.ok).toBe(false);
        expect((wrongToken as any).error.code).toBe("AC_USER_CONFIRMATION_REQUIRED");
      });
      expect(calls.createIssue).toHaveLength(0);
      expect(calls.listRecentIssues).toHaveLength(0);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("audit approve publishes to a public repository once the exact confirmation token from the error message is supplied", async () => {
    const { executor, calls } = fakeGithubIssueExecutor({ visibility: "public" });
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git" });
    try {
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const rejected = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(rejected.ok).toBe(false);
        const tokenMatch = /--confirm-public-repo (\S+)/.exec((rejected as any).error.message);
        expect(tokenMatch).not.toBeNull();
        const token = tokenMatch![1]!;
        expect(token).toMatch(/^public:github\.com\/acme\/widgets:[0-9a-f]+:audit_run\./);

        const approved = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId, confirmPublicToken: token });
        expect(approved.ok).toBe(true);
        expect((approved.data as any).status).toBe("issued");
        expect((approved.data as any).issuedCount).toBe(fixture.draftRecords.length);
      });
      expect(calls.createIssue).toHaveLength(fixture.draftRecords.length);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("audit approve rejects a run whose drafts no longer match the recorded ledger digests, zero gh calls", async () => {
    const { executor, calls } = fakeGithubIssueExecutor();
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git" });
    try {
      const pendingEvent = fixture.store.architectureEvents.find((event) => event.eventType === "architecture.agent_audit.run_pending");
      expect(pendingEvent).toBeDefined();
      // Directly corrupt the ledger's recorded digest set (simulating drift between what the
      // ledger recorded at "audit run" time and what the completed job's proposal plan currently
      // says) rather than tamper the plan itself, so this exercises auditApprove's own
      // cross-check rather than validateRuntimeAgentProposalPlan's pre-existing digest checks.
      (pendingEvent!.payload as any).auditRuns[0].issueDraftDigests = [`sha256:${"9".repeat(64)}`];

      await withAuditApproveToken("gh_pat_test_token", async () => {
        const result = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(result.ok).toBe(false);
        expect((result as any).error.code).toBe("AC_SCHEMA_INVALID");
        expect((result as any).error.message).toContain("no longer match");
      });
      expect(calls.repoView).toHaveLength(0);
      expect(calls.createIssue).toHaveLength(0);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  for (const [label, bodyMarkdown, expectedMessage] of [
    ["secret", "Rotate ghp_" + "x".repeat(24), "secret-shaped"],
    ["oversized body", "x".repeat(70_000), "size limit"],
    ["unified diff", "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-before\n+after", "forbidden raw"]
  ]) {
    test(`issue #169: audit run rejects ${label} drafts before persistence or publishing`, async () => {
      const { executor, calls } = fakeGithubIssueExecutor();
      const root = createGitRepo();
      enableAuditWithConsent(root);
      const store = new TestLocalStore();
      try {
        const now = "2026-07-05T00:00:00.000Z";
        const daemon = await createStartedTestDaemon({
          localStore: store, clock: () => now, githubIssueExecutor: executor,
          investigationTransport: auditInvestigationTransportWithDrafts([
            auditDraftRecord({ title: "Draft One" }), auditDraftRecord({ title: "Rejected draft", bodyMarkdown })
          ], now)
        });
        const run = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
        expect(run.ok).toBe(false);
        expect(run.error?.code).toBe("AC_SCHEMA_INVALID");
        expect(run.error?.message).toContain(expectedMessage);
        expect(JSON.stringify(await daemon.jobsList(root))).not.toContain(JSON.stringify(bodyMarkdown).slice(1, -1));
        const jobs = (await daemon.jobsList(root)).data as any;
        expect(jobs.jobs).toHaveLength(1);
        expect(jobs.jobs[0].job.status).toBe("failed");
        expect(store.architectureEvents.some((event) => event.eventType === "architecture.agent_audit.run_pending")).toBe(false);
        expect(calls.createIssue).toHaveLength(0);
        expect(calls.repoView).toHaveLength(0);
      } finally {
        removeTempRepo(root);
      }
    });
  }

  // Issue #117 end-to-end: a benign JWT/installation-token architecture finding is publishable.
  test("audit approve publishes benign JWT and installation-token findings instead of aborting the batch", async () => {
    const { executor, calls } = fakeGithubIssueExecutor();
    const draftRecords = [
      auditDraftRecord({ title: "Validate JWT audience and issuer checks", bodyMarkdown: "## Task\n\nThe jwt verifier never checks the audience claim.\n", labels: ["area/jwt"] }),
      auditDraftRecord({ title: "Rotate installation-token credentials safely", bodyMarkdown: "## Task\n\nDocument the `installation_token` lifecycle.\n" })
    ];
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git", draftRecords });
    try {
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const result = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(result.ok).toBe(true);
        expect((result.data as any).status).toBe("issued");
      });
      expect(calls.createIssue).toHaveLength(2);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  // Issue #110: the remote host is part of the publish target's identity. A non-github.com remote
  // must never be reinterpreted as the same-named repository on github.com.
  const nonGithubRemotes = [
    "git@gitlab.com:acme/widgets.git",
    "https://bitbucket.org/acme/widgets.git",
    "git@github.acme-corp.com:acme/widgets.git",
    "ssh://git@localhost:2222/acme/widgets.git"
  ];
  for (const remoteUrl of nonGithubRemotes) {
    test(`audit approve rejects the non-github.com remote ${remoteUrl} before any gh call`, async () => {
      const { executor, calls } = fakeGithubIssueExecutor();
      const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl });
      try {
        await withAuditApproveToken("gh_pat_test_token", async () => {
          const result = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
          expect(result.ok).toBe(false);
          expect((result as any).error.code).toBe("AC_PRECONDITION_FAILED");
          expect((result as any).error.message).toContain("github.com");
        });
        expect(calls.repoView).toHaveLength(0);
        expect(calls.listRecentIssues).toHaveLength(0);
        expect(calls.createIssue).toHaveLength(0);
      } finally {
        removeTempRepo(fixture.root);
      }
    });
  }

  const canonicalGithubRemotes = [
    "https://github.com/acme/widgets.git",
    "git@github.com:acme/widgets.git",
    "git@GitHub.COM:acme/widgets.git",
    "https://github.com:443/acme/widgets"
  ];
  for (const remoteUrl of canonicalGithubRemotes) {
    test(`audit approve resolves ${remoteUrl} to the same canonical github.com target in its confirmation token`, async () => {
      const { executor } = fakeGithubIssueExecutor({ visibility: "public" });
      const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl });
      try {
        await withAuditApproveToken("gh_pat_test_token", async () => {
          const rejected = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
          expect(rejected.ok).toBe(false);
          const tokenMatch = /--confirm-public-repo (\S+)/.exec((rejected as any).error.message);
          expect(tokenMatch).not.toBeNull();
          expect(tokenMatch![1]!).toMatch(/^public:github\.com\/acme\/widgets:[0-9a-f]+:audit_run\./);
        });
      } finally {
        removeTempRepo(fixture.root);
      }
    });
  }

  test("audit approve rejects a run whose investigation failed, zero gh calls", async () => {
    const { executor, calls } = fakeGithubIssueExecutor();
    const root = createGitRepo();
    addGitRemote(root, "https://github.com/acme/widgets.git");
    enableAuditWithConsent(root);
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        githubIssueExecutor: executor,
        clock: () => "2026-07-05T02:00:00.000Z",
        investigationTransport: async () => ({ exitCode: 1, stdout: "", stderr: "claude not installed" })
      });
      const run = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect((run.data as any).status).toBe("failed");
      const runId = (run.data as any).runId as string;

      await withAuditApproveToken("gh_pat_test_token", async () => {
        const result = await daemon.auditApprove(root, { runId });
        expect(result.ok).toBe(false);
        expect((result as any).error.code).toBe("AC_PRECONDITION_FAILED");
        expect((result as any).error.message).toContain("failed during investigation");
      });
      expect(calls.repoView).toHaveLength(0);
      expect(calls.createIssue).toHaveLength(0);
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit approve publishes every draft to a private repository in one call, records the footer marker, and is idempotent once issued", async () => {
    const { executor, calls } = fakeGithubIssueExecutor({ visibility: "private" });
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git" });
    try {
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const approve = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(approve.ok).toBe(true);
        expect(approve.data).toMatchObject({ runId: fixture.runId, status: "issued", issuedCount: 2, totalCount: 2 });
      });

      expect(calls.createIssue).toHaveLength(2);
      for (const call of calls.createIssue) {
        expect(call.bodyText).toContain("Filed by archctx audit");
        expect(call.bodyText).toContain(fixture.runId);
      }

      const show = await fixture.daemon.auditShow(fixture.root, fixture.runId);
      expect((show.data as any).run.status).toBe("issued");
      expect((show.data as any).run.issuedIssues).toHaveLength(2);

      const list = await fixture.daemon.auditList(fixture.root, { statuses: ["issued"] });
      expect((list.data as any).count).toBe(1);

      // Idempotent no-op: calling approve again on an already-issued run touches gh zero times.
      const repoViewCountBefore = calls.repoView.length;
      const createCountBefore = calls.createIssue.length;
      const again = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
      expect(again.ok).toBe(true);
      expect((again.data as any).status).toBe("issued");
      expect(calls.createIssue.length).toBe(createCountBefore);
      expect(calls.repoView.length).toBe(repoViewCountBefore);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("two concurrent audit approve calls on the same run never both publish: the daemon's single-writer lock rejects the loser before it reads run state", async () => {
    const draftRecords = [auditDraftRecord({ title: "Draft Alpha" }), auditDraftRecord({ title: "Draft Beta" })];
    const { executor, calls } = fakeGithubIssueExecutor({ visibility: "private" });
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git", draftRecords });
    try {
      await withAuditApproveToken("gh_pat_test_token", async () => {
        // Both calls are issued back-to-back with no `await` between them, so (per the ordinary
        // synchronous-prefix-of-an-async-function evaluation order the JS spec guarantees) the
        // first call always reaches the daemon's writer lock before the second call is even
        // constructed. Without a lock serializing auditApprove, both would race past the "pending"
        // read and each call createIssue once per draft (4 calls total for 2 drafts instead of 2).
        const [first, second] = await Promise.allSettled([
          fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId }),
          fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId })
        ]);

        const settled = [first, second];
        const fulfilled = settled.filter((entry): entry is PromiseFulfilledResult<JsonEnvelope> => entry.status === "fulfilled");
        const rejected = settled.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");

        // Exactly one caller gets to run the approve flow; the other is rejected outright by the
        // writer lock (a clear, retryable failure) rather than silently reading stale state.
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(fulfilled[0]!.value.ok).toBe(true);
        expect(fulfilled[0]!.value.data).toMatchObject({ status: "issued", issuedCount: 2, totalCount: 2 });
        expect(String(rejected[0]!.reason)).toContain("runtime writer is locked");
      });

      // The concurrency bug this test guards against would have created every draft twice (once
      // per racing call); with the lock, each draft is published exactly once.
      expect(calls.createIssue).toHaveLength(draftRecords.length);
      const titles = calls.createIssue.map((call) => call.title);
      expect(new Set(titles).size).toBe(titles.length);

      const show = await fixture.daemon.auditShow(fixture.root, fixture.runId);
      expect((show.data as any).run.status).toBe("issued");
      expect((show.data as any).run.issuedIssues).toHaveLength(2);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("audit approve stops in issuing after a mid-flight failure, recording already-published drafts, and --resume completes the run", async () => {
    const draftRecords = [
      auditDraftRecord({ title: "Draft Alpha" }),
      auditDraftRecord({ title: "Draft Beta" }),
      auditDraftRecord({ title: "Draft Gamma" })
    ];
    // githubIssueDraftsFromReport canonicalizes draft processing order by content-addressed
    // draftId, not by this array's input order, so which title ends up "first"/"second" is not
    // knowable ahead of time. Fail the second `createIssue` attempt overall (whichever draft that
    // turns out to be) rather than matching by title, so this test is independent of that
    // canonical ordering.
    let attemptsSoFar = 0;
    const { executor, calls } = fakeGithubIssueExecutor({
      createIssueImpl: async () => {
        attemptsSoFar += 1;
        if (attemptsSoFar === 2) throw new Error("gh issue create: temporary failure");
        const number = 6000 + calls.createIssue.length;
        return { number, url: `https://github.com/acme/widgets/issues/${number}` };
      }
    });
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git", draftRecords });
    try {
      let firstSucceededTitle = "";
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const firstAttempt = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(firstAttempt.ok).toBe(false);
        expect((firstAttempt as any).error.code).toBe("AC_PRECONDITION_FAILED");
        expect((firstAttempt as any).error.message).toContain("--resume");
        expect(calls.createIssue).toHaveLength(2);
        firstSucceededTitle = calls.createIssue[0]!.title;

        const stuck = await fixture.daemon.auditShow(fixture.root, fixture.runId);
        expect((stuck.data as any).run.status).toBe("issuing");
        expect((stuck.data as any).run.issuedIssues).toHaveLength(1);

        const withoutResume = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(withoutResume.ok).toBe(false);
        expect((withoutResume as any).error.code).toBe("AC_PRECONDITION_FAILED");
        expect((withoutResume as any).error.message).toContain("--resume");
        expect(calls.createIssue).toHaveLength(2);

        const resumed = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId, resume: true });
        expect(resumed.ok).toBe(true);
        expect(resumed.data).toMatchObject({ status: "issued", issuedCount: 3, totalCount: 3 });
      });

      const finalShow = await fixture.daemon.auditShow(fixture.root, fixture.runId);
      expect((finalShow.data as any).run.status).toBe("issued");
      expect((finalShow.data as any).run.issuedIssues).toHaveLength(3);
      // The draft that succeeded before the crash point was never re-created on resume.
      const firstDraftCreateCalls = calls.createIssue.filter((call) => call.title === firstSucceededTitle).length;
      expect(firstDraftCreateCalls).toBe(1);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("audit approve reuses an already-filed issue found via footer-marker dedup instead of re-publishing", async () => {
    const draftRecords = [auditDraftRecord({ title: "Draft Solo" })];
    const { executor, calls, existingIssues } = fakeGithubIssueExecutor();
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git", draftRecords });
    try {
      const show = await fixture.daemon.auditShow(fixture.root, fixture.runId);
      const draftDigest = (show.data as any).githubIssueDrafts[0].draftDigest as string;
      // Simulate a prior daemon crash: gh issue create already succeeded (issue #7777) but the
      // ledger progress event was never appended, so run.issuedIssues going into this call is
      // still empty; only the footer marker on the already-filed issue proves it was published.
      existingIssues.push({
        number: 7777,
        url: "https://github.com/acme/widgets/issues/7777",
        body: `Some existing body.\n\n${githubIssueFooterMarker(fixture.runId, draftDigest)}\n`
      });

      await withAuditApproveToken("gh_pat_test_token", async () => {
        const approve = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(approve.ok).toBe(true);
        expect((approve.data as any).issuedIssues[0]).toMatchObject({ number: 7777, url: "https://github.com/acme/widgets/issues/7777" });
      });
      expect(calls.createIssue).toHaveLength(0);
      expect(calls.listRecentIssues.length).toBeGreaterThan(0);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("audit approve rejects when the crash-recovery dedup listing itself fails (fail-closed, inconclusive)", async () => {
    const { executor, calls } = fakeGithubIssueExecutor({ listRecentIssuesError: new Error("gh issue list: rate limited") });
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git" });
    try {
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const result = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(result.ok).toBe(false);
        expect((result as any).error.code).toBe("AC_PRECONDITION_FAILED");
        expect((result as any).error.message).toContain("inconclusive");
      });
      expect(calls.createIssue).toHaveLength(0);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

});

// Matches the exact indentation shape the daemon's auditGithubIssuesEnabledInManifestText (and the
// CLI's auditGithubIssuesEnabled) scan for: `audit:` at indent 0, `githubIssues:` at indent 2,
// `enabled: <bool>` at indent 4.
function writeAuditManifest(root: string, enabled: boolean): void {
  mkdirSync(join(root, ".archcontext"), { recursive: true });
  writeFileSync(
    join(root, ".archcontext", "manifest.yaml"),
    `schemaVersion: archcontext.manifest/v1\naudit:\n  githubIssues:\n    enabled: ${enabled}\n`,
    "utf8"
  );
}

/** Manifest capability plus user-level consent: what a user who opted in to audit has (#161). */
function enableAuditWithConsent(root: string): void {
  writeAuditManifest(root, true);
  grantAuditConsent(root);
}

function addGitRemote(root: string, url: string): void {
  execFileSync("git", ["remote", "add", "origin", url], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

/** ADR-0042 test double: never shells out, records every call for assertions. */
interface FakeGithubIssueExecutorOptions {
  visibility?: string;
  repoViewError?: Error;
  listRecentIssuesError?: Error;
  existingIssues?: GithubIssueListedRecord[];
  createIssueImpl?: (input: { repo: string; title: string; bodyFile: string }) => Promise<GithubIssueCreatedRecord>;
}

interface FakeGithubIssueExecutorCreateCall {
  repo: string;
  title: string;
  bodyFile: string;
  bodyText: string;
}

interface FakeGithubIssueExecutorCalls {
  repoView: { repo: string; env: { GH_TOKEN: string } }[];
  listRecentIssues: { repo: string; env: { GH_TOKEN: string } }[];
  createIssue: FakeGithubIssueExecutorCreateCall[];
}

function fakeGithubIssueExecutor(options: FakeGithubIssueExecutorOptions = {}): {
  executor: GithubIssueExecutorPort;
  calls: FakeGithubIssueExecutorCalls;
  existingIssues: GithubIssueListedRecord[];
} {
  const calls: FakeGithubIssueExecutorCalls = { repoView: [], listRecentIssues: [], createIssue: [] };
  const existingIssues: GithubIssueListedRecord[] = options.existingIssues ? [...options.existingIssues] : [];
  let nextNumber = 5000;
  const executor: GithubIssueExecutorPort = {
    async repoView(repo, env) {
      calls.repoView.push({ repo, env });
      if (options.repoViewError) throw options.repoViewError;
      return { visibility: options.visibility ?? "private" };
    },
    async listRecentIssues(repo, env) {
      calls.listRecentIssues.push({ repo, env });
      if (options.listRecentIssuesError) throw options.listRecentIssuesError;
      return existingIssues;
    },
    async createIssue(input) {
      const bodyText = readFileSync(input.bodyFile, "utf8");
      calls.createIssue.push({ repo: input.repo, title: input.title, bodyFile: input.bodyFile, bodyText });
      if (options.createIssueImpl) return options.createIssueImpl(input);
      nextNumber += 1;
      return { number: nextNumber, url: `https://github.com/${input.repo}/issues/${nextNumber}` };
    }
  };
  return { executor, calls, existingIssues };
}

function auditDraftRecord(overrides: Partial<{
  kind: string;
  priority: string;
  title: string;
  bodyMarkdown: string;
  labels: string[];
  evidence: unknown[];
  acceptance: string[];
  verificationCommands: string[];
}> = {}) {
  return {
    kind: "task",
    priority: "P2",
    title: "Add direct sqlite coverage for audit_runs reads",
    bodyMarkdown: "## Task\n\nCover listAuditRuns/getAuditRun with a dedicated sqlite test.\n",
    labels: [],
    evidence: [{ path: "packages/local-runtime/local-store-sqlite/src/index.ts", startLine: 1, note: "audit run read path" }],
    acceptance: ["listAuditRuns and getAuditRun have direct sqlite coverage"],
    verificationCommands: [],
    ...overrides
  };
}

function auditInvestigationTransportWithDrafts(draftRecords: unknown[], now: string) {
  return async (input: CommandInvestigationRunnerTransportInput) => {
    const separatorIndex = input.stdin.lastIndexOf("\n\n");
    const runnerInput = JSON.parse(separatorIndex === -1 ? input.stdin : input.stdin.slice(separatorIndex + 2));
    const jobId = runnerInput.job.jobId as string;
    const report = {
      schemaVersion: INVESTIGATION_REPORT_SCHEMA_VERSION,
      reportId: `investigation_report.approve_test_${jobId.slice(-8)}`,
      jobId,
      status: "succeeded",
      findings: [],
      outputDigest: digestJson({ jobId, draftRecords } as unknown as Json),
      createdAt: now,
      directMutationAllowed: false,
      extensions: { githubIssueDrafts: draftRecords }
    };
    return { exitCode: 0, stdout: JSON.stringify({ report }) };
  };
}

/**
 * Stands up a daemon and drives a real `auditRun` to completion (2 drafts by default) so
 * `auditApprove` tests exercise the actual pending-run/proposal-plan shape the daemon produces,
 * rather than a hand-built fixture. `githubIssueExecutor` is always an explicit fake (never the
 * real `createNodeGithubIssueExecutor` default) so no test in this suite can accidentally shell
 * out to a real `gh` binary.
 */
async function createPendingApproveFixture(options: {
  draftRecords?: unknown[];
  remoteUrl?: string;
  githubIssueExecutor: GithubIssueExecutorPort;
} ): Promise<{ root: string; store: TestLocalStore; daemon: Awaited<ReturnType<typeof createStartedTestDaemon>>; runId: string; draftRecords: unknown[] }> {
  const root = createGitRepo();
  if (options.remoteUrl) addGitRemote(root, options.remoteUrl);
  enableAuditWithConsent(root);
  const store = new TestLocalStore();
  const draftRecords = options.draftRecords ?? [auditDraftRecord({ title: "Draft One" }), auditDraftRecord({ title: "Draft Two" })];
  const now = "2026-07-05T00:00:00.000Z";
  const daemon = await createStartedTestDaemon({
    localStore: store,
    clock: () => now,
    githubIssueExecutor: options.githubIssueExecutor,
    investigationTransport: auditInvestigationTransportWithDrafts(draftRecords, now)
  });
  const run = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
  if (!run.ok) throw new Error(`fixture audit run failed: ${JSON.stringify(run)}`);
  const runId = (run.data as any).runId as string;
  return { root, store, daemon, runId, draftRecords };
}

async function withAuditApproveToken<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.ARCHCONTEXT_GH_ISSUES_TOKEN;
  if (value === undefined) delete process.env.ARCHCONTEXT_GH_ISSUES_TOKEN;
  else process.env.ARCHCONTEXT_GH_ISSUES_TOKEN = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.ARCHCONTEXT_GH_ISSUES_TOKEN;
    else process.env.ARCHCONTEXT_GH_ISSUES_TOKEN = previous;
  }
}

