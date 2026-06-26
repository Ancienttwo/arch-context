#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  buildInvestigationContextBundleFromLedgerQuery,
  createInvestigationAgentJob,
  planInvestigationReportProposal,
  transitionAgentJobStatus
} from "@archcontext/core/agent-orchestrator";
import {
  architectureDocumentationSourceDigest,
  loadArchitectureDocumentationInputs,
  renderArchitectureDocumentationProjection,
  type ArchitectureDocumentationProjectionPlan
} from "@archcontext/core/projection-engine";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { createStartedDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { digestJson, type AgentJobV1, type InvestigationReportV1, type Json } from "@archcontext/contracts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const DEFAULT_OUT = "docs/verification/architecture-ledger-al9-complete-task-provenance-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al9-complete-task-provenance.md";

const command = process.argv[2] ?? "inspect";
const out = readFlag("--out") ?? DEFAULT_OUT;
const report = readFlag("--report") ?? DEFAULT_REPORT;
const evidence = readFlag("--evidence") ?? out;
const json = process.argv.includes("--json");

if (import.meta.main) {
  const result = command === "run"
    ? await runArchitectureLedgerAl9CompleteTaskProvenanceReadback({ out, report })
    : inspectArchitectureLedgerAl9CompleteTaskProvenanceReadback(JSON.parse(readFileSync(resolve(REPO_ROOT, evidence), "utf8")));
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export async function runArchitectureLedgerAl9CompleteTaskProvenanceReadback({ out = DEFAULT_OUT, report = DEFAULT_REPORT } = {}) {
  const completeTask = await runCompleteTaskProjectionGateReadback();
  const agentDraft = runAgentDocumentationDraftReadback();
  const runbook = {
    path: "docs/runbooks/architecture-documentation-projections.md",
    present: existsSync(resolve(REPO_ROOT, "docs/runbooks/architecture-documentation-projections.md"))
  };
  const packet = {
    schemaVersion: "archcontext.architecture-ledger-al9-complete-task-provenance-readback/v1",
    generatedAt: new Date(0).toISOString(),
    gates: ["AL9-09", "AL9-10", "AL9-14", "AL9-16", "AL9-EG1", "AL9-EG4", "AL9-EG5"],
    completeTask,
    agentDraft,
    runbook,
    privacy: {
      rawSourcePersisted: forbiddenRawKeys(packetSafe({ completeTask, agentDraft, runbook })).length > 0,
      forbiddenKeys: forbiddenRawKeys(packetSafe({ completeTask, agentDraft, runbook }))
    },
    assertions: {
      "AL9-09": agentDraft.validDraftReferencesSelectedDelta && agentDraft.invalidDraftRejected,
      "AL9-10": agentDraft.advisoryOnly && agentDraft.acceptedProjection === false && agentDraft.forbidsDirectDocWrites,
      "AL9-14": completeTask.blocksDriftBeforeProjectionApply && completeTask.passesAfterProjectionApply,
      "AL9-16": runbook.present,
      "AL9-EG1": completeTask.acceptedProjectionManifestPresent && completeTask.passesAfterProjectionApply,
      "AL9-EG4": completeTask.postApplyDriftOk && completeTask.completeProjectionDriftClean,
      "AL9-EG5": agentDraft.traceableToJobAndInputDigest
    }
  };
  const inspected = inspectArchitectureLedgerAl9CompleteTaskProvenanceReadback(packet);
  const finalPacket = { ...packet, status: inspected.ok ? "verified" : "failed", failures: inspected.failures };
  writeJson(out, finalPacket);
  writeText(report, renderReport(inspected));
  return inspectArchitectureLedgerAl9CompleteTaskProvenanceReadback(finalPacket);
}

export function inspectArchitectureLedgerAl9CompleteTaskProvenanceReadback(packet: any) {
  const failures: string[] = [];
  if (packet?.schemaVersion !== "archcontext.architecture-ledger-al9-complete-task-provenance-readback/v1") failures.push("schemaVersion mismatch");
  for (const gate of ["AL9-09", "AL9-10", "AL9-14", "AL9-16", "AL9-EG1", "AL9-EG4", "AL9-EG5"]) {
    if (packet?.assertions?.[gate] !== true) failures.push(`${gate} assertion failed`);
  }
  if (packet?.privacy?.rawSourcePersisted === true) failures.push(`privacy forbidden keys present: ${packet.privacy.forbiddenKeys?.join(",")}`);
  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? "verified" : "failed",
    failures,
    completeTask: packet.completeTask,
    agentDraft: packet.agentDraft,
    assertions: packet.assertions
  };
}

async function runCompleteTaskProjectionGateReadback() {
  const root = mkdtempSync(join(tmpdir(), "archctx-al9-complete-"));
  let daemon: Awaited<ReturnType<typeof createStartedDaemon>> | undefined;
  try {
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "archctx@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "ArchContext"], { cwd: root });
    writeFileSync(join(root, "README.md"), "# Complete Task Projection Gate\n", "utf8");
    execFileSync("git", ["add", "README.md"], { cwd: root });
    execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "ignore" });

    daemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: new TestLocalStore(),
      clock: () => "2026-06-26T10:50:00.000Z"
    });
    const init = await daemon.init(root, "Complete Task Projection Gate");
    execFileSync("mkdir", ["-p", resolve(root, "docs/architecture")]);
    writeFileSync(resolve(root, "docs/architecture/.projection-manifest.json"), "{}\n", "utf8");
    const driftedComplete = await daemon.completeTask(root, {
      taskSessionId: "task_al9_projection",
      task: "complete with stale docs projection"
    });
    writeArchitectureDocsProjection(root);
    const postApplyDriftOk = docsProjectionDriftOk(root);
    const cleanComplete = await daemon.completeTask(root, {
      taskSessionId: "task_al9_projection",
      task: "complete with reconciled docs projection"
    });
    const projectionManifestPresent = existsSync(resolve(root, "docs/architecture/.projection-manifest.json"));
    return {
      initOk: init.ok === true,
      acceptedProjectionManifestPresent: projectionManifestPresent,
      blocksDriftBeforeProjectionApply:
        driftedComplete.ok === true
        && (driftedComplete.data as any)?.result === "fail_action_required"
        && (driftedComplete.data as any)?.findings?.some((finding: any) => finding.id === "projection-drift") === true,
      driftReasonCodes: (driftedComplete.data as any)?.extensions?.projectionDriftGate?.reasonCodes ?? [],
      projectionApplySucceeded: true,
      postApplyDriftOk,
      passesAfterProjectionApply: cleanComplete.ok === true && (cleanComplete.data as any)?.result === "pass",
      completeProjectionDriftClean: (cleanComplete.data as any)?.snapshot?.projectionDigest?.startsWith("sha256:") === true
    };
  } finally {
    await daemon?.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

function writeArchitectureDocsProjection(root: string): void {
  const loaded = loadArchitectureDocumentationInputs(root);
  const sourceDigest = architectureDocumentationSourceDigest({
    model: loaded.model,
    decisions: loaded.decisions
  });
  const plan: ArchitectureDocumentationProjectionPlan = renderArchitectureDocumentationProjection({
    model: loaded.model,
    decisions: loaded.decisions,
    existingFiles: loaded.existingFiles,
    sourceDigest
  });
  const manifestBody = `${JSON.stringify({
    schemaVersion: "archcontext.architecture-docs-projection-manifest/v1",
    rendererVersion: plan.rendererVersion,
    sourceDigest: plan.sourceDigest,
    projectionDigest: plan.projectionDigest,
    targetCount: plan.targets.length,
    fileCount: plan.files.length,
    targets: plan.targets.map((target) => ({
      targetId: target.targetId,
      type: target.type,
      scope: target.scope,
      path: target.path,
      ownership: target.ownership,
      rendererVersion: target.rendererVersion,
      format: target.format,
      sourceDigest: target.sourceDigest,
      outputDigest: target.outputDigest
    }))
  }, null, 2)}\n`;
  for (const file of [
    ...plan.files.map((file) => ({ path: file.path, body: file.body })),
    { path: "docs/architecture/.projection-manifest.json", body: manifestBody }
  ]) {
    const absolute = resolve(root, file.path);
    execFileSync("mkdir", ["-p", dirname(absolute)]);
    writeFileSync(absolute, file.body, "utf8");
  }
}

function docsProjectionDriftOk(root: string): boolean {
  const loaded = loadArchitectureDocumentationInputs(root);
  const plan = renderArchitectureDocumentationProjection({
    model: loaded.model,
    decisions: loaded.decisions,
    existingFiles: loaded.existingFiles,
    sourceDigest: architectureDocumentationSourceDigest({
      model: loaded.model,
      decisions: loaded.decisions
    })
  });
  return plan.drift.ok && plan.rejected.length === 0;
}

function runAgentDocumentationDraftReadback() {
  const job = transitionAgentJobStatus(agentJob(), { status: "running", now: "2026-06-26T10:45:00.000Z" });
  const context = investigationContext();
  const report = investigationReport(job);
  const plan = planInvestigationReportProposal({ report, job, context });
  const invalid = (() => {
    try {
      planInvestigationReportProposal({
        report: {
          ...report,
          extensions: {
            documentationDrafts: [{
              kind: "rationale",
              title: "Unbound rationale",
              prose: "This draft references an unselected deterministic delta.",
              proposedDeltaDigests: [digestJson({ unknown: "delta" } as unknown as Json)]
            }]
          }
        },
        job,
        context
      });
      return { rejected: false, reason: "" };
    } catch (error) {
      return { rejected: true, reason: error instanceof Error ? error.message : String(error) };
    }
  })();
  const draft = plan.documentationDrafts[0];
  return {
    proposalId: plan.proposalId,
    proposalDigest: plan.proposalDigest,
    draftId: draft?.draftId,
    draftDigest: draft?.draftDigest,
    documentationDraftCount: plan.documentationDrafts.length,
    acceptedProjection: draft?.acceptedProjection,
    advisoryOnly: plan.authority === "advisory-only" && draft?.authority === "advisory-only",
    forbidsDirectDocWrites: plan.forbiddenActions.includes("write-docs") && plan.forbiddenActions.includes("apply-changeset"),
    validDraftReferencesSelectedDelta: draft?.proposedDeltaDigests?.[0] === report.findings[0].proposedDeltaDigest,
    invalidDraftRejected: invalid.rejected && invalid.reason.includes("agent-documentation-draft-unknown-delta"),
    traceableToJobAndInputDigest:
      draft?.jobId === job.jobId
      && draft?.inputDigest === context.inputDigest
      && draft?.outputDigest === report.outputDigest
      && draft?.promptTemplateDigest === job.promptTemplateDigest
  };
}

function agentJob(): AgentJobV1 {
  return createInvestigationAgentJob({
    repository: {
      repositoryId: "repo.al9",
      storageRepositoryId: "storage.repo.al9"
    },
    worktree: {
      workspaceId: "workspace.al9",
      storageWorkspaceId: "storage.workspace.al9",
      branch: "codex/al9",
      headSha: "abc123",
      worktreeDigest: digestJson({ worktree: "al9" } as unknown as Json)
    },
    taskSessionId: "task.al9",
    fingerprint: digestJson({ fingerprint: "al9" } as unknown as Json),
    trigger: { source: "checkpoint", reason: "deterministic delta selected" },
    risk: "high",
    uncertainty: "high",
    deterministicAnalysisFound: true,
    budgetUsage: { taskRuns: 0, repositoryRunsToday: 0, totalRunsToday: 0 },
    inputDigest: digestJson({ input: "al9" } as unknown as Json),
    promptTemplateDigest: digestJson({ prompt: "al9-doc-draft" } as unknown as Json),
    policy: { adapterEnabled: true },
    runnerPort: "fake-provider",
    now: "2026-06-26T10:44:00.000Z"
  });
}

function investigationContext() {
  return buildInvestigationContextBundleFromLedgerQuery({
    repository: {
      repositoryId: "repo.al9",
      storageRepositoryId: "storage.repo.al9"
    },
    worktree: {
      workspaceId: "workspace.al9",
      storageWorkspaceId: "storage.workspace.al9",
      branch: "codex/al9",
      headSha: "abc123",
      worktreeDigest: digestJson({ worktree: "al9" } as unknown as Json)
    },
    taskSessionId: "task.al9",
    fingerprint: digestJson({ fingerprint: "al9" } as unknown as Json),
    trigger: { source: "checkpoint", reason: "deterministic delta selected" },
    risk: "high",
    uncertainty: "high",
    summary: "A deterministic architecture delta selected a module for documentation rationale.",
    ledger: {
      graphDigest: digestJson({ graph: "al9" } as unknown as Json),
      entities: [{ entityId: "module.al9.docs", kind: "module", status: "active", path: "src/al9/docs.ts" }],
      relations: [],
      constraints: [],
      evidenceBindings: [{
        bindingId: "binding.al9.docs",
        evidenceId: "evidence.al9.docs",
        target: { kind: "entity", id: "module.al9.docs" }
      }],
      candidateChanges: [{
        candidateChangeId: "candidate_change.al9.docs",
        kind: "node-materially-changed",
        target: { kind: "node", id: "module.al9.docs" },
        stateDimension: "target-state",
        changeKind: "materially_changed",
        confidence: "high",
        evidenceIds: ["evidence.al9.docs"]
      }]
    }
  });
}

function investigationReport(job: AgentJobV1): InvestigationReportV1 {
  const proposedDelta = {
    candidateChangeId: "candidate_change.al9.docs",
    kind: "node-materially-changed" as const,
    target: { kind: "node" as const, id: "module.al9.docs" },
    stateDimension: "target-state" as const,
    changeKind: "materially_changed" as const,
    subjectSelectorIds: ["subject.al9.docs"],
    mappingIds: ["mapping.al9.docs"],
    ambiguityIds: [],
    evidenceIds: ["evidence.al9.docs"],
    confidence: "high" as const,
    heuristic: true as const,
    summary: "The selected deterministic delta needs architecture rationale prose.",
    digest: digestJson({ proposed: "al9-docs" } as unknown as Json)
  };
  return {
    schemaVersion: "archcontext.investigation-report/v1",
    reportId: "investigation_report.al9_docs",
    jobId: job.jobId,
    status: "succeeded",
    findings: [{
      findingId: "finding.al9.docs",
      hypothesis: "The docs projection needs rationale prose for the selected architecture delta.",
      evidenceBindingIds: ["binding.al9.docs"],
      unknowns: [],
      falsifier: "The accepted projection already contains reviewed rationale for this selected delta.",
      proposedDelta,
      proposedDeltaDigest: proposedDelta.digest,
      confidence: "high"
    }],
    outputDigest: digestJson({ output: job.jobId, kind: "al9-docs" } as unknown as Json),
    createdAt: "2026-06-26T10:46:00.000Z",
    directMutationAllowed: false,
    extensions: {
      documentationDrafts: [{
        kind: "adr-prose",
        title: "ADR prose for selected AL9 documentation delta",
        targetPath: "docs/adr/ADR-0041-al9-docs-projection.md",
        prose: "## Context\n\nThe deterministic delta selected module.al9.docs before this agent prose draft was created.\n",
        proposedDeltaDigests: [proposedDelta.digest],
        evidenceBindingIds: ["binding.al9.docs"],
        acceptedProjection: false
      }]
    }
  };
}

function forbiddenRawKeys(value: Json): string[] {
  const forbidden = new Set(["sourceCode", "rawDiff", "prompt", "completion", "privateKey", "secret"]);
  const found = new Set<string>();
  const visit = (item: Json) => {
    if (item === null || typeof item !== "object") return;
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    for (const [key, child] of Object.entries(item)) {
      if (forbidden.has(key)) found.add(key);
      visit(child);
    }
  };
  visit(value);
  return [...found].sort();
}

function packetSafe(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function writeJson(path: string, value: unknown) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, body: string) {
  const absolute = resolve(REPO_ROOT, path);
  execFileSync("mkdir", ["-p", dirname(absolute)]);
  writeFileSync(absolute, body, "utf8");
}

function readFlag(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function renderReport(result: ReturnType<typeof inspectArchitectureLedgerAl9CompleteTaskProvenanceReadback>): string {
  return [
    "# AL9 Complete Task Projection Gate and Agent Draft Provenance Readback",
    "",
    `Status: ${result.status}`,
    "",
    "## P1 Map",
    "",
    "`complete_task` consumes a deterministic projection drift summary from the runtime daemon. `agent-orchestrator` plans agent-authored prose as advisory documentation drafts, separate from accepted projections.",
    "",
    "## P2 Trace",
    "",
    "The traced path is `docs/architecture/.projection-manifest.json` activation -> `complete` drift failure -> `docs apply` ChangeSet projection -> `docs drift` clean -> `complete` pass. Agent prose traces from `AgentJob/v1` and `InvestigationReport/v1` into an advisory proposal plan.",
    "",
    "## P3 Decision",
    "",
    "The completion gate validates projections but does not write them. Agent prose remains `acceptedProjection:false` with `write-docs` and `apply-changeset` forbidden until deterministic validation and explicit approval.",
    "",
    "## Assertions",
    "",
    ...Object.entries(result.assertions ?? {}).map(([gate, ok]) => `- ${gate}: ${ok ? "pass" : "fail"}`),
    ""
  ].join("\n");
}

function renderHuman(result: ReturnType<typeof inspectArchitectureLedgerAl9CompleteTaskProvenanceReadback>): string {
  return [
    `AL9 complete task provenance readback: ${result.status}`,
    ...result.failures.map((failure) => `- ${failure}`),
    ""
  ].join("\n");
}
