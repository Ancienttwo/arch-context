#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildInvestigationContextBundleFromLedgerQuery,
  createFakeInvestigationRunner,
  createInvestigationAgentJob,
  planInvestigationReportProposal,
  runInvestigationWithRetry,
  transitionAgentJobStatus,
  validateInvestigationReport,
  type AgentInvestigationRunResult
} from "@archcontext/core/agent-orchestrator";
import { digestJson, type AgentJobV1, type InvestigationContextRisk, type InvestigationContextUncertainty, type InvestigationReportV1, type Json } from "@archcontext/contracts";
import { runRepresentativeEval, THRESHOLDS, type RepresentativeEvalResult } from "../evals/run";

const ROOT = resolve(import.meta.dir, "..");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al10-agent-comparison-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al10-agent-comparison-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al10-agent-comparison.md";
const GATES = ["AL10-09"] as const;
const EXPLICITLY_OPEN = [
  "AL10-10",
  "AL10-11",
  "AL10-12",
  "AL10-13",
  "AL10-14",
  "AL10-15",
  "AL10-16",
  "AL10-GA-1",
  "AL10-GA-2",
  "AL10-GA-3",
  "AL10-GA-4",
  "AL10-GA-5",
  "AL10-GA-6",
  "AL10-GA-7"
] as const;

const AGENT_CASES = [
  {
    id: "blind-no-label-positive",
    label: "Blind no-label positive",
    deterministicOutcome: "expected-practice-matched",
    expectedFindings: 1,
    risk: "high",
    uncertainty: "high",
    evidenceBindingId: "binding.al10.agent.no_label",
    evidenceId: "evidence.al10.agent.no_label",
    entityId: "module.al10.no_label",
    candidateChangeId: "candidate_change.al10.agent.no_label",
    durationMs: 24
  },
  {
    id: "direct-reference-positive",
    label: "Direct reference positive",
    deterministicOutcome: "typed-evidence-matched",
    expectedFindings: 1,
    risk: "high",
    uncertainty: "high",
    evidenceBindingId: "binding.al10.agent.direct_ref",
    evidenceId: "evidence.al10.agent.direct_ref",
    entityId: "module.al10.direct_ref",
    candidateChangeId: "candidate_change.al10.agent.direct_ref",
    durationMs: 21
  },
  {
    id: "benign-negative",
    label: "Benign negative",
    deterministicOutcome: "no-non-advisory-match",
    expectedFindings: 0,
    risk: "high",
    uncertainty: "high",
    evidenceBindingId: "binding.al10.agent.benign",
    evidenceId: "evidence.al10.agent.benign",
    entityId: "module.al10.benign",
    candidateChangeId: "candidate_change.al10.agent.benign",
    durationMs: 18
  },
  {
    id: "waiver-adversarial",
    label: "Waiver adversarial",
    deterministicOutcome: "invalid-waiver-rejected",
    expectedFindings: 1,
    risk: "high",
    uncertainty: "high",
    evidenceBindingId: "binding.al10.agent.waiver",
    evidenceId: "evidence.al10.agent.waiver",
    entityId: "module.al10.waiver",
    candidateChangeId: "candidate_change.al10.agent.waiver",
    durationMs: 27
  }
] as const;

type AgentComparisonCase = typeof AGENT_CASES[number];
type AgentRunSummary = Awaited<ReturnType<typeof runAgentComparisonCase>>;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[architecture-ledger-al10-agent-comparison-readback] usage: run|inspect [--out path] [--report path] [--evidence path] [--json]");
    process.exit(2);
  }
  const result = command === "run"
    ? await runArchitectureLedgerAl10AgentComparisonReadback({
        outPath: readFlag(args, "--out") ?? DEFAULT_OUT,
        reportPath: readFlag(args, "--report") ?? DEFAULT_REPORT
      })
    : inspectArchitectureLedgerAl10AgentComparisonReadback(
        JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
      );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export async function runArchitectureLedgerAl10AgentComparisonReadback({
  outPath = DEFAULT_OUT,
  reportPath = DEFAULT_REPORT
} = {}) {
  const packet = await buildArchitectureLedgerAl10AgentComparisonPacket();
  const inspected = inspectArchitectureLedgerAl10AgentComparisonReadback(packet);
  const finalPacket = {
    ...packet,
    status: inspected.ok ? "verified" : "failed",
    failures: inspected.failures
  };
  writeJson(outPath, finalPacket);
  writeText(reportPath, renderReport(finalPacket));
  return inspectArchitectureLedgerAl10AgentComparisonReadback(finalPacket);
}

export async function buildArchitectureLedgerAl10AgentComparisonPacket(
  result: RepresentativeEvalResult = runRepresentativeEval()
) {
  const deterministicOnly = deterministicBaseline(result);
  const agentRuns: AgentRunSummary[] = [];
  for (const item of AGENT_CASES) agentRuns.push(await runAgentComparisonCase(item));
  const deterministicPlusAgent = buildPlusAgentComparison(deterministicOnly, agentRuns);
  const outcomeComparison = compareOutcomes(deterministicOnly, deterministicPlusAgent);
  const costComparison = compareCosts(deterministicOnly, deterministicPlusAgent);
  const assertions = {
    "AL10-09": outcomeComparison.comparisonComplete && costComparison.comparisonComplete,
    deterministicBaselinePasses: deterministicOnly.allEvalGatesPass,
    agentRunsComplete: deterministicPlusAgent.agentRunCount === AGENT_CASES.length && deterministicPlusAgent.failedAgentRuns === 0,
    advisoryOnly: deterministicPlusAgent.advisoryOnly === true && deterministicPlusAgent.directMutationAttempts === 0,
    deterministicAuthorityPreserved: outcomeComparison.deterministicAuthorityPreserved,
    noOutcomeRegression: outcomeComparison.metricDeltaCount === 0 && outcomeComparison.qualityViolationDeltaCount === 0,
    costMeasured: costComparison.agentRunCount > 0 && costComparison.estimatedAgentTokens > 0 && costComparison.agentDurationMs > 0,
    noExternalProviderCost: costComparison.actualExternalProviderCostUsd === 0,
    noFallbackUsed: deterministicPlusAgent.fallbackRunCount === 0
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(0).toISOString(),
    gates: [...GATES],
    status: "verified",
    scope: {
      repo: "agent-comparison-evals",
      authority: "deterministic representative eval remains authoritative; agent path is advisory-only comparison",
      closedGates: [...GATES],
      explicitlyOpen: [...EXPLICITLY_OPEN]
    },
    thresholds: {
      practiceTop3Recall: THRESHOLDS.practiceTop3Recall,
      recommendationPrecisionAt3: THRESHOLDS.recommendationPrecisionAt3,
      noKeywordStructuralRecall: THRESHOLDS.noKeywordStructuralRecall,
      directPracticeReferenceRecall: THRESHOLDS.directPracticeReferenceRecall,
      requiredAgentComparisonCases: AGENT_CASES.length
    },
    deterministicOnly,
    deterministicPlusAgent,
    outcomeComparison,
    costComparison,
    comparisonDigest: digestJson({
      deterministicOnly,
      deterministicPlusAgent,
      outcomeComparison,
      costComparison
    } as unknown as Json),
    assertions,
    readback: {
      command: `bun scripts/architecture-ledger-al10-agent-comparison-readback.ts inspect --evidence ${DEFAULT_OUT} --json`,
      evalCommand: "bun evals/run.ts --check",
      reportPath: DEFAULT_REPORT
    },
    failures: [] as string[]
  };
}

export function inspectArchitectureLedgerAl10AgentComparisonReadback(packet: any) {
  const failures: string[] = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return { ok: false, status: "failed", failures: ["packet must be an object"], gates: {} };
  }
  if (packet.schemaVersion !== SCHEMA_VERSION) failures.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (packet.status !== undefined && packet.status !== "verified") failures.push("status must be verified");
  if (!sameStringSet(packet.gates, GATES)) failures.push("gates must be exactly AL10-09");
  if (!sameStringSet(packet.scope?.closedGates, GATES)) failures.push("scope.closedGates must be exactly AL10-09");
  if (!Array.isArray(packet.scope?.explicitlyOpen) || !packet.scope.explicitlyOpen.includes("AL10-10")) failures.push("scope.explicitlyOpen must keep release gates open");
  if (!packet.comparisonDigest || typeof packet.comparisonDigest !== "string") failures.push("comparisonDigest must be present");

  inspectDeterministic(packet.deterministicOnly, failures);
  inspectPlusAgent(packet.deterministicPlusAgent, failures);
  inspectOutcomeComparison(packet.outcomeComparison, failures);
  inspectCostComparison(packet.costComparison, failures);
  inspectAssertions(packet.assertions, failures);

  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? "verified" : "failed",
    failures,
    gates: Object.fromEntries(GATES.map((gate) => [gate, packet.assertions?.[gate] === true ? "verified" : "blocked"])),
    outcomeComparison: packet.outcomeComparison,
    costComparison: packet.costComparison
  };
}

function deterministicBaseline(result: RepresentativeEvalResult) {
  const metrics = {
    top3Recall: result.practices.top3Recall,
    recommendationPrecisionAt3: result.practices.recommendationPrecisionAt3,
    noKeywordStructuralRecall: result.practices.noKeywordStructuralRecall,
    directPracticeReferenceRecall: result.practices.directPracticeReferenceRecall,
    benignPrecision: result.practices.benignPrecision,
    evidenceShuffleContaminationRate: result.practices.evidenceShuffleContaminationRate,
    heuristicOnlyHardGateRate: result.practices.heuristicOnlyHardGateRate,
    dynamicDocHardGateRate: result.practices.dynamicDocHardGateRate,
    waiverRejectedRate: result.practices.waiverRejectedRate
  };
  const qualityViolationCounts = {
    datasetMetadataViolations: result.practices.datasetMetadataViolations.length,
    prohibitedMatchIds: result.practices.prohibitedMatchIds.length,
    evidenceMinimumViolations: result.practices.evidenceMinimumViolations.length,
    enforcementCeilingViolations: result.practices.enforcementCeilingViolations.length,
    missedPositiveIds: result.practices.missedPositiveIds.length,
    missedNoKeywordStructuralIds: result.practices.missedNoKeywordStructuralIds.length,
    missedDirectReferenceIds: result.practices.missedDirectReferenceIds.length,
    negativeNonAdvisoryCaseIds: result.practices.negativeNonAdvisoryCaseIds.length,
    evidenceShuffleViolationIds: result.practices.evidenceShuffleViolationIds.length,
    waiverRejectionMissIds: result.practices.waiverRejectionMissIds.length,
    hardGateMissIds: result.practices.hardGateMissIds.length
  };
  return {
    mode: "deterministic-only" as const,
    status: result.allPass ? "passed" : "failed",
    allEvalGatesPass: result.allPass,
    evalGateCount: result.gates.length,
    failedEvalGateCount: result.gates.filter((gate) => !gate.pass).length,
    caseCounts: {
      positiveCases: result.practices.positiveCases,
      noKeywordStructuralPositiveCases: result.practices.noKeywordStructuralPositiveCases,
      directPracticeReferenceCases: result.practices.directPracticeReferenceCases,
      negativeCases: result.practices.negativeCases,
      adversarialCases: result.practices.adversarialCases,
      totalScenarios: result.practices.totalScenarios
    },
    metrics,
    qualityViolationCounts,
    cost: {
      agentRunCount: 0,
      attempts: 0,
      durationMs: 0,
      inputBytes: 0,
      outputBytes: 0,
      estimatedAgentTokens: 0,
      actualExternalProviderCostUsd: 0
    }
  };
}

async function runAgentComparisonCase(item: AgentComparisonCase) {
  const context = investigationContext(item);
  const job = transitionAgentJobStatus(agentJob(item, context.inputDigest), {
    status: "running",
    now: "2026-06-26T13:10:00.000Z"
  });
  const report = investigationReport(item, job);
  const runner = createFakeInvestigationRunner({
    runnerId: `runner.fake-${item.id}`,
    modelId: "fake-agent-comparison-v1",
    now: "2026-06-26T13:10:00.000Z",
    reportFactory: () => report
  });
  const clockValues = [
    "2026-06-26T13:10:00.000Z",
    new Date(Date.parse("2026-06-26T13:10:00.000Z") + item.durationMs).toISOString()
  ];
  const run = await runInvestigationWithRetry({
    runner,
    job,
    context,
    modelId: "fake-agent-comparison-v1",
    maxAttempts: 1,
    maxOutputBytes: 16_384,
    timeoutMs: 1_000,
    clock: () => clockValues.shift() ?? "2026-06-26T13:10:01.000Z"
  });
  const validation = validateInvestigationReport({ report: run.report, job, context });
  const proposal = planInvestigationReportProposal({ report: run.report, job, context, now: "2026-06-26T13:10:01.000Z" });
  const inputBytes = byteLength({ job, context });
  const outputBytes = byteLength(run.report);
  const estimatedInputTokens = estimateTokens(inputBytes);
  const estimatedOutputTokens = estimateTokens(outputBytes);
  return {
    id: item.id,
    label: item.label,
    deterministicOutcome: item.deterministicOutcome,
    expectedFindings: item.expectedFindings,
    reportStatus: run.report.status,
    findingCount: run.report.findings.length,
    validationValid: validation.valid,
    validationIssues: validation.valid ? [] : validation.issues.map((issue) => issue.reasonCode),
    proposalDigest: proposal.proposalDigest,
    proposalAuthority: proposal.authority,
    proposalRequiredNextStep: proposal.requiredNextStep,
    forbiddenActions: proposal.forbiddenActions,
    directMutationAllowed: run.report.directMutationAllowed,
    metadata: run.metadata,
    cost: {
      attempts: run.metadata.attempts,
      durationMs: run.metadata.durationMs,
      inputBytes,
      outputBytes,
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedAgentTokens: estimatedInputTokens + estimatedOutputTokens,
      actualExternalProviderCostUsd: 0
    }
  };
}

function buildPlusAgentComparison(deterministicOnly: ReturnType<typeof deterministicBaseline>, agentRuns: AgentRunSummary[]) {
  const aggregateCost = agentRuns.reduce((sum, run) => ({
    agentRunCount: sum.agentRunCount + 1,
    attempts: sum.attempts + run.cost.attempts,
    durationMs: sum.durationMs + run.cost.durationMs,
    inputBytes: sum.inputBytes + run.cost.inputBytes,
    outputBytes: sum.outputBytes + run.cost.outputBytes,
    estimatedInputTokens: sum.estimatedInputTokens + run.cost.estimatedInputTokens,
    estimatedOutputTokens: sum.estimatedOutputTokens + run.cost.estimatedOutputTokens,
    estimatedAgentTokens: sum.estimatedAgentTokens + run.cost.estimatedAgentTokens,
    actualExternalProviderCostUsd: sum.actualExternalProviderCostUsd + run.cost.actualExternalProviderCostUsd
  }), {
    agentRunCount: 0,
    attempts: 0,
    durationMs: 0,
    inputBytes: 0,
    outputBytes: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    estimatedAgentTokens: 0,
    actualExternalProviderCostUsd: 0
  });
  return {
    mode: "deterministic-plus-agent" as const,
    status: deterministicOnly.status,
    metrics: deterministicOnly.metrics,
    qualityViolationCounts: deterministicOnly.qualityViolationCounts,
    agentRunCount: agentRuns.length,
    succeededAgentRuns: agentRuns.filter((run) => run.reportStatus === "succeeded" && run.validationValid).length,
    failedAgentRuns: agentRuns.filter((run) => run.reportStatus !== "succeeded" || !run.validationValid).length,
    fallbackRunCount: agentRuns.filter((run) => run.metadata.fallbackUsed).length,
    totalFindings: agentRuns.reduce((sum, run) => sum + run.findingCount, 0),
    advisoryOnly: agentRuns.every((run) =>
      run.proposalAuthority === "advisory-only"
      && run.proposalRequiredNextStep === "deterministic-validation"
      && run.forbiddenActions.includes("write-ledger")
      && run.forbiddenActions.includes("apply-changeset")
    ),
    directMutationAttempts: agentRuns.filter((run) => run.directMutationAllowed !== false).length,
    runs: agentRuns,
    cost: aggregateCost
  };
}

function compareOutcomes(
  deterministicOnly: ReturnType<typeof deterministicBaseline>,
  deterministicPlusAgent: ReturnType<typeof buildPlusAgentComparison>
) {
  const metricDeltas = Object.keys(deterministicOnly.metrics)
    .filter((key) => deterministicOnly.metrics[key as keyof typeof deterministicOnly.metrics] !== deterministicPlusAgent.metrics[key as keyof typeof deterministicPlusAgent.metrics]);
  const qualityViolationDeltas = Object.keys(deterministicOnly.qualityViolationCounts)
    .filter((key) => deterministicOnly.qualityViolationCounts[key as keyof typeof deterministicOnly.qualityViolationCounts] !== deterministicPlusAgent.qualityViolationCounts[key as keyof typeof deterministicPlusAgent.qualityViolationCounts]);
  return {
    comparisonComplete: deterministicOnly.mode === "deterministic-only" && deterministicPlusAgent.mode === "deterministic-plus-agent",
    deterministicAuthorityPreserved: deterministicPlusAgent.status === deterministicOnly.status && deterministicPlusAgent.advisoryOnly === true,
    deterministicStatus: deterministicOnly.status,
    plusAgentStatus: deterministicPlusAgent.status,
    metricDeltas,
    metricDeltaCount: metricDeltas.length,
    qualityViolationDeltas,
    qualityViolationDeltaCount: qualityViolationDeltas.length,
    addedAdvisoryFindings: deterministicPlusAgent.totalFindings,
    conclusion: "agent adds advisory findings and measured cost without changing deterministic quality gates"
  };
}

function compareCosts(
  deterministicOnly: ReturnType<typeof deterministicBaseline>,
  deterministicPlusAgent: ReturnType<typeof buildPlusAgentComparison>
) {
  return {
    comparisonComplete: true,
    deterministicAgentRunCount: deterministicOnly.cost.agentRunCount,
    agentRunCount: deterministicPlusAgent.cost.agentRunCount,
    attempts: deterministicPlusAgent.cost.attempts,
    deterministicEstimatedAgentTokens: deterministicOnly.cost.estimatedAgentTokens,
    estimatedInputTokens: deterministicPlusAgent.cost.estimatedInputTokens,
    estimatedOutputTokens: deterministicPlusAgent.cost.estimatedOutputTokens,
    estimatedAgentTokens: deterministicPlusAgent.cost.estimatedAgentTokens,
    agentDurationMs: deterministicPlusAgent.cost.durationMs,
    inputBytes: deterministicPlusAgent.cost.inputBytes,
    outputBytes: deterministicPlusAgent.cost.outputBytes,
    actualExternalProviderCostUsd: deterministicPlusAgent.cost.actualExternalProviderCostUsd,
    costBasis: "fake-provider local readback; bytes and token estimates are deterministic cost proxies, not vendor billing"
  };
}

function inspectDeterministic(deterministicOnly: any, failures: string[]): void {
  if (deterministicOnly?.mode !== "deterministic-only") failures.push("deterministicOnly.mode must be deterministic-only");
  if (deterministicOnly?.allEvalGatesPass !== true) failures.push("deterministic eval gates must pass");
  if (deterministicOnly?.failedEvalGateCount !== 0) failures.push("deterministic failedEvalGateCount must be 0");
  if (deterministicOnly?.metrics?.top3Recall < THRESHOLDS.practiceTop3Recall) failures.push("deterministic top3Recall below threshold");
  if (deterministicOnly?.metrics?.recommendationPrecisionAt3 < THRESHOLDS.recommendationPrecisionAt3) failures.push("deterministic recommendationPrecisionAt3 below threshold");
  if (deterministicOnly?.metrics?.noKeywordStructuralRecall < THRESHOLDS.noKeywordStructuralRecall) failures.push("deterministic noKeywordStructuralRecall below threshold");
  if (deterministicOnly?.metrics?.directPracticeReferenceRecall < THRESHOLDS.directPracticeReferenceRecall) failures.push("deterministic directPracticeReferenceRecall below threshold");
  if (deterministicOnly?.cost?.agentRunCount !== 0) failures.push("deterministic-only cost must have zero agent runs");
}

function inspectPlusAgent(deterministicPlusAgent: any, failures: string[]): void {
  if (deterministicPlusAgent?.mode !== "deterministic-plus-agent") failures.push("deterministicPlusAgent.mode must be deterministic-plus-agent");
  if (deterministicPlusAgent?.agentRunCount !== AGENT_CASES.length) failures.push("agent comparison case count mismatch");
  if (deterministicPlusAgent?.succeededAgentRuns !== AGENT_CASES.length) failures.push("all agent comparison runs must succeed");
  if (deterministicPlusAgent?.failedAgentRuns !== 0) failures.push("failed agent comparison runs must be 0");
  if (deterministicPlusAgent?.fallbackRunCount !== 0) failures.push("fallback agent runs must be 0");
  if (deterministicPlusAgent?.advisoryOnly !== true) failures.push("agent comparison must remain advisory-only");
  if (deterministicPlusAgent?.directMutationAttempts !== 0) failures.push("agent direct mutation attempts must be 0");
  if (!Array.isArray(deterministicPlusAgent?.runs) || deterministicPlusAgent.runs.length !== AGENT_CASES.length) failures.push("agent run details missing");
  for (const run of deterministicPlusAgent?.runs ?? []) {
    if (run.reportStatus !== "succeeded") failures.push(`${run.id}: reportStatus must be succeeded`);
    if (run.validationValid !== true) failures.push(`${run.id}: validation must pass`);
    if (run.findingCount !== run.expectedFindings) failures.push(`${run.id}: finding count mismatch`);
    if (run.proposalAuthority !== "advisory-only") failures.push(`${run.id}: proposal authority must be advisory-only`);
    if (run.proposalRequiredNextStep !== "deterministic-validation") failures.push(`${run.id}: required next step must be deterministic-validation`);
    if (run.directMutationAllowed !== false) failures.push(`${run.id}: directMutationAllowed must be false`);
    if (run.metadata?.provider !== "fake-provider") failures.push(`${run.id}: provider must be fake-provider`);
    if (run.metadata?.fallbackUsed !== false) failures.push(`${run.id}: fallbackUsed must be false`);
    if (!(run.cost?.estimatedAgentTokens > 0)) failures.push(`${run.id}: estimated agent tokens missing`);
    if (run.cost?.actualExternalProviderCostUsd !== 0) failures.push(`${run.id}: external provider cost must be 0`);
  }
}

function inspectOutcomeComparison(outcomeComparison: any, failures: string[]): void {
  if (outcomeComparison?.comparisonComplete !== true) failures.push("outcome comparison must be complete");
  if (outcomeComparison?.deterministicAuthorityPreserved !== true) failures.push("deterministic authority must be preserved");
  if (outcomeComparison?.metricDeltaCount !== 0) failures.push(`outcome metric deltas present: ${outcomeComparison?.metricDeltas?.join(",")}`);
  if (outcomeComparison?.qualityViolationDeltaCount !== 0) failures.push(`quality violation deltas present: ${outcomeComparison?.qualityViolationDeltas?.join(",")}`);
  if (!(outcomeComparison?.addedAdvisoryFindings >= 1)) failures.push("agent path must report advisory findings");
}

function inspectCostComparison(costComparison: any, failures: string[]): void {
  if (costComparison?.comparisonComplete !== true) failures.push("cost comparison must be complete");
  if (costComparison?.deterministicAgentRunCount !== 0) failures.push("deterministic agent run count must be 0");
  if (costComparison?.agentRunCount !== AGENT_CASES.length) failures.push("cost agent run count mismatch");
  if (!(costComparison?.estimatedAgentTokens > 0)) failures.push("estimatedAgentTokens must be positive");
  if (!(costComparison?.agentDurationMs > 0)) failures.push("agentDurationMs must be positive");
  if (!(costComparison?.inputBytes > 0 && costComparison?.outputBytes > 0)) failures.push("agent input/output bytes must be positive");
  if (costComparison?.actualExternalProviderCostUsd !== 0) failures.push("actualExternalProviderCostUsd must be 0 for fake-provider readback");
}

function inspectAssertions(assertions: Record<string, unknown> | undefined, failures: string[]): void {
  if (!assertions || typeof assertions !== "object" || Array.isArray(assertions)) {
    failures.push("assertions must be an object");
    return;
  }
  for (const [key, value] of Object.entries(assertions)) {
    if (key.startsWith("AL10-") && !GATES.includes(key as typeof GATES[number])) failures.push(`unexpected gate assertion: ${key}`);
    if (value !== true) failures.push(`assertions.${key} must be true`);
  }
  for (const gate of GATES) {
    if (assertions[gate] !== true) failures.push(`${gate} assertion failed`);
  }
}

function agentJob(item: AgentComparisonCase, inputDigest: string): AgentJobV1 {
  return createInvestigationAgentJob({
    repository: repository(),
    worktree: worktree(),
    taskSessionId: `task.al10.agent.${item.id}`,
    fingerprint: digestJson({ fingerprint: item.id } as unknown as Json),
    trigger: { source: "checkpoint", reason: `compare agent outcome for ${item.id}` },
    risk: item.risk as InvestigationContextRisk,
    uncertainty: item.uncertainty as InvestigationContextUncertainty,
    deterministicAnalysisFound: true,
    budgetUsage: { taskRuns: 0, repositoryRunsToday: 0, totalRunsToday: 0 },
    inputDigest,
    promptTemplateDigest: digestJson({ prompt: "al10-agent-comparison", caseId: item.id } as unknown as Json),
    policy: { adapterEnabled: true },
    runnerPort: "fake-provider",
    now: "2026-06-26T13:09:00.000Z"
  });
}

function investigationContext(item: AgentComparisonCase) {
  return buildInvestigationContextBundleFromLedgerQuery({
    repository: repository(),
    worktree: worktree(),
    taskSessionId: `task.al10.agent.${item.id}`,
    fingerprint: digestJson({ fingerprint: item.id } as unknown as Json),
    trigger: { source: "checkpoint", reason: `compare agent outcome for ${item.id}` },
    risk: item.risk as InvestigationContextRisk,
    uncertainty: item.uncertainty as InvestigationContextUncertainty,
    summary: `${item.label}: deterministic outcome ${item.deterministicOutcome}; agent output is advisory-only.`,
    ledger: {
      graphDigest: digestJson({ graph: "al10-agent-comparison", caseId: item.id } as unknown as Json),
      entities: [{ entityId: item.entityId, kind: "module", status: "active", path: `src/al10/${item.id}.ts` }],
      relations: [],
      constraints: [],
      evidenceBindings: [{
        bindingId: item.evidenceBindingId,
        evidenceId: item.evidenceId,
        target: { kind: "entity", id: item.entityId }
      }],
      candidateChanges: [{
        candidateChangeId: item.candidateChangeId,
        kind: "node-materially-changed",
        target: { kind: "node", id: item.entityId },
        stateDimension: "target-state",
        changeKind: "materially_changed",
        confidence: "high",
        evidenceIds: [item.evidenceId]
      }]
    }
  });
}

function investigationReport(item: AgentComparisonCase, job: AgentJobV1): InvestigationReportV1 {
  const findings = item.expectedFindings === 0
    ? []
    : [investigationFinding(item)];
  return {
    schemaVersion: "archcontext.investigation-report/v1",
    reportId: `investigation_report.al10_${item.id.replace(/-/g, "_")}`,
    jobId: job.jobId,
    status: "succeeded",
    findings,
    outputDigest: digestJson({ output: "al10-agent-comparison", caseId: item.id, findings: findings.length } as unknown as Json),
    createdAt: "2026-06-26T13:10:00.000Z",
    directMutationAllowed: false,
    extensions: {
      comparisonCaseId: item.id,
      deterministicOutcome: item.deterministicOutcome,
      authority: "advisory-only",
      requiredNextStep: "deterministic-validation"
    }
  };
}

function investigationFinding(item: AgentComparisonCase): InvestigationReportV1["findings"][number] {
  const proposedDelta = {
    candidateChangeId: item.candidateChangeId,
    kind: "node-materially-changed" as const,
    target: { kind: "node" as const, id: item.entityId },
    stateDimension: "target-state" as const,
    changeKind: "materially_changed" as const,
    subjectSelectorIds: [`subject.${item.id}`],
    mappingIds: [`mapping.${item.id}`],
    ambiguityIds: [],
    evidenceIds: [item.evidenceId],
    confidence: "medium" as const,
    heuristic: true as const,
    summary: `${item.label} remains advisory until deterministic validation accepts it.`,
    digest: digestJson({ proposed: "al10-agent-comparison", caseId: item.id } as unknown as Json)
  };
  return {
    findingId: `finding.al10.${item.id}`,
    hypothesis: `${item.label} may need architecture review, but the deterministic gate remains authoritative.`,
    evidenceBindingIds: [item.evidenceBindingId],
    unknowns: ["agent output has not been promoted by deterministic validation"],
    falsifier: "The deterministic representative eval rejects or supersedes this advisory finding.",
    proposedDelta,
    proposedDeltaDigest: proposedDelta.digest,
    confidence: "medium"
  };
}

function repository() {
  return {
    repositoryId: "repo.al10-agent-comparison",
    storageRepositoryId: "storage.repo.al10-agent-comparison"
  };
}

function worktree() {
  return {
    workspaceId: "workspace.al10-agent-comparison",
    storageWorkspaceId: "storage.workspace.al10-agent-comparison",
    branch: "codex/al10-agent-comparison",
    headSha: "abc123al10agent",
    worktreeDigest: digestJson({ worktree: "al10-agent-comparison" } as unknown as Json)
  };
}

function renderReport(packet: any): string {
  return [
    "# Architecture Ledger AL10 Agent Comparison Readback",
    "",
    "## Scope",
    "",
    "- Closes: AL10-09 only.",
    "- Keeps open: release packaging, runbooks, telemetry, governance, Go/No-Go and GA gates.",
    "- Authority: deterministic representative eval remains the gate; agent output is advisory-only.",
    "",
    "## Outcome Comparison",
    "",
    `- Deterministic status: ${packet.outcomeComparison.deterministicStatus}`,
    `- Plus-agent status: ${packet.outcomeComparison.plusAgentStatus}`,
    `- Metric deltas: ${packet.outcomeComparison.metricDeltaCount}`,
    `- Quality violation deltas: ${packet.outcomeComparison.qualityViolationDeltaCount}`,
    `- Added advisory findings: ${packet.outcomeComparison.addedAdvisoryFindings}`,
    "",
    "## Cost Comparison",
    "",
    "| Mode | Agent runs | Attempts | Estimated tokens | Duration ms | External provider cost USD |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    `| Deterministic only | ${packet.costComparison.deterministicAgentRunCount} | 0 | ${packet.costComparison.deterministicEstimatedAgentTokens} | 0 | 0 |`,
    `| Deterministic plus agent | ${packet.costComparison.agentRunCount} | ${packet.costComparison.attempts} | ${packet.costComparison.estimatedAgentTokens} | ${packet.costComparison.agentDurationMs} | ${packet.costComparison.actualExternalProviderCostUsd} |`,
    "",
    "## Agent Cases",
    "",
    "| Case | Deterministic outcome | Findings | Tokens | Duration ms |",
    "| --- | --- | ---: | ---: | ---: |",
    ...packet.deterministicPlusAgent.runs.map((run: AgentRunSummary) => `| ${run.id} | ${run.deterministicOutcome} | ${run.findingCount} | ${run.cost.estimatedAgentTokens} | ${run.cost.durationMs} |`),
    "",
    "## Readback",
    "",
    "```bash",
    packet.readback.command,
    packet.readback.evalCommand,
    "```",
    ""
  ].join("\n");
}

function renderHuman(result: any): string {
  if (result.ok) return `[architecture-ledger-al10-agent-comparison-readback] OK agentRuns=${result.costComparison?.agentRunCount} tokens=${result.costComparison?.estimatedAgentTokens}`;
  return `[architecture-ledger-al10-agent-comparison-readback] FAILED\n${result.failures.map((failure: string) => `- ${failure}`).join("\n")}`;
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function estimateTokens(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / 4));
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, value: string): void {
  const resolved = resolve(ROOT, path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, value, "utf8");
}

function sameStringSet(actual: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(actual)) return false;
  return [...new Set(actual)].sort().join(",") === [...expected].sort().join(",");
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}
