#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { digestJson, type Json } from "@archcontext/contracts";

const ROOT = resolve(import.meta.dir, "..");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al10-telemetry-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al10-telemetry-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al10-telemetry.md";
const GATES = ["AL10-13"] as const;
const EXPLICITLY_OPEN = [
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

const SOURCE_EVIDENCE = [
  {
    id: "rollout-workflow",
    path: "docs/verification/architecture-ledger-al10-rollout-workflow-readback.json",
    expectedGates: ["AL10-01", "AL10-02"],
    requiredTerms: ["phaseFlags", "writeVerified", "rollbackCommand"]
  },
  {
    id: "representative-benchmark",
    path: "docs/verification/architecture-ledger-al10-representative-benchmark-readback.json",
    expectedGates: ["AL10-03", "AL10-04", "AL10-BETA-1"],
    requiredTerms: ["dualModeDriftCount", "hookEnqueueP95Ms", "fixtureCount"]
  },
  {
    id: "hardening",
    path: "docs/verification/architecture-ledger-al10-hardening-readback.json",
    expectedGates: ["AL10-07", "AL10-BETA-2", "AL10-BETA-3", "AL10-BETA-5", "AL10-BETA-6"],
    requiredTerms: ["stress", "defaultHook", "overallClean", "fullRollbackToYaml"]
  },
  {
    id: "chaos-security",
    path: "docs/verification/architecture-ledger-al10-chaos-security-readback.json",
    expectedGates: ["AL10-05", "AL10-06"],
    requiredTerms: ["chaos", "security", "stale-replay"]
  },
  {
    id: "recommendation-quality",
    path: "docs/verification/architecture-ledger-al10-recommendation-quality-readback.json",
    expectedGates: ["AL10-08", "AL10-BETA-4"],
    requiredTerms: ["metrics", "supportSummary", "noLabel", "qualityViolations"]
  },
  {
    id: "agent-comparison",
    path: "docs/verification/architecture-ledger-al10-agent-comparison-readback.json",
    expectedGates: ["AL10-09"],
    requiredTerms: ["deterministicPlusAgent", "costComparison", "advisoryOnly"]
  },
  {
    id: "release-packaging",
    path: "docs/verification/architecture-ledger-al10-release-packaging-readback.json",
    expectedGates: ["AL10-10", "AL10-11"],
    requiredTerms: ["migrationMatrix", "releasePackage", "bundleSignatures"]
  },
  {
    id: "runbooks",
    path: "docs/verification/architecture-ledger-al10-runbooks-readback.json",
    expectedGates: ["AL10-12"],
    requiredTerms: ["sectionCoverage", "sourceReadbacks", "architecture-ledger-operations.md"]
  }
] as const;

const SECRET_PATTERNS = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /secret:\/\//i
] as const;

const RAW_CONTENT_PATTERNS = [
  /diff\s+--git/i,
  /^@@\s/m,
  /"patch"\s*:/i,
  /"sourceBody"\s*:/i,
  /"diffBody"\s*:/i,
  /promptBody/i,
  /completionBody/i
] as const;

type SourceEvidence = typeof SOURCE_EVIDENCE[number];
type SourcePacket = {
  source: SourceEvidence;
  raw: string;
  packet: Record<string, any>;
};

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[architecture-ledger-al10-telemetry-readback] usage: run|inspect [--out path] [--report path] [--evidence path] [--json]");
    process.exit(2);
  }
  const result = command === "run"
    ? runArchitectureLedgerAl10TelemetryReadback({
        outPath: readFlag(args, "--out") ?? DEFAULT_OUT,
        reportPath: readFlag(args, "--report") ?? DEFAULT_REPORT
      })
    : inspectArchitectureLedgerAl10TelemetryReadback(
        JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
      );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export function runArchitectureLedgerAl10TelemetryReadback({
  outPath = DEFAULT_OUT,
  reportPath = DEFAULT_REPORT
} = {}) {
  const packet = buildArchitectureLedgerAl10TelemetryPacket();
  const inspected = inspectArchitectureLedgerAl10TelemetryReadback(packet);
  const finalPacket = {
    ...packet,
    status: inspected.ok ? "verified" : "failed",
    failures: inspected.failures
  };
  writeJson(outPath, finalPacket);
  writeText(reportPath, renderReport(finalPacket));
  return inspectArchitectureLedgerAl10TelemetryReadback(finalPacket);
}

export function buildArchitectureLedgerAl10TelemetryPacket() {
  const sourcePackets = SOURCE_EVIDENCE.map(loadSourcePacket);
  const sourceReadbacks = sourcePackets.map(inspectSourceEvidence);
  const sources = Object.fromEntries(sourcePackets.map(({ source, packet }) => [source.id, packet])) as Record<string, any>;
  const runs = summarizeRuns(sources, sourceReadbacks);
  const drift = summarizeDrift(sources);
  const recommendations = summarizeRecommendations(sources);
  const agentSpawn = summarizeAgentSpawn(sources);
  const resolution = summarizeResolution(sources);
  const failureTelemetry = summarizeFailuresAndRisks(sources, sourceReadbacks, recommendations);
  const privacy = inspectPrivacy({
    sourceReadbacks,
    runs,
    drift,
    recommendations,
    agentSpawn,
    resolution,
    failureTelemetry
  });
  const assertions = {
    "AL10-13": sourceReadbacks.every((source) => source.verified)
      && runs.telemetrySourceCount === SOURCE_EVIDENCE.length
      && drift.knownUnresolvedDriftCount === 0
      && recommendations.qualityViolationCount === 0
      && recommendations.failedEvalGateCount === 0
      && agentSpawn.defaultPathZeroSpawn
      && resolution.rollbackDemonstrated
      && failureTelemetry.sourceReadbackFailureCount === 0
      && privacy.clean,
    sourceReadbacksVerified: sourceReadbacks.every((source) => source.verified),
    runTelemetryCovered: runs.telemetrySourceCount === SOURCE_EVIDENCE.length
      && runs.representativeFixtureCount >= 3
      && runs.stressEventCount >= 1000
      && runs.agentComparisonRunCount >= 4,
    driftTelemetryClean: drift.knownUnresolvedDriftCount === 0
      && drift.dualModeDriftCount === 0
      && drift.fixtureDriftCleanCount === drift.representativeFixtureCount,
    recommendationTelemetryCovered: recommendations.supportComplete
      && recommendations.top3Recall >= recommendations.thresholds.practiceTop3Recall
      && recommendations.recommendationPrecisionAt3 >= recommendations.thresholds.recommendationPrecisionAt3
      && recommendations.noKeywordStructuralRecall >= recommendations.thresholds.noKeywordStructuralRecall
      && recommendations.directPracticeReferenceRecall >= recommendations.thresholds.directPracticeReferenceRecall
      && recommendations.evidenceShuffleContaminationRate === 0
      && recommendations.hardGateFalsePositiveRate === 0,
    agentSpawnTelemetryCovered: agentSpawn.defaultPathZeroSpawn
      && agentSpawn.agentComparisonRunCount > 0
      && agentSpawn.estimatedAgentTokens > 0
      && agentSpawn.advisoryOnly
      && agentSpawn.directMutationAttempts === 0,
    resolutionTelemetryCovered: resolution.rollbackDemonstrated
      && resolution.chaosCaseOkCount === resolution.chaosCaseCount
      && resolution.securityCaseOkCount === resolution.securityCaseCount
      && resolution.runbookSectionsVerified >= 5,
    failureTelemetryCovered: failureTelemetry.sourceReadbackFailureCount === 0
      && failureTelemetry.failedEvalGateCount === 0
      && failureTelemetry.qualityViolationCount === 0
      && failureTelemetry.privacyLeakCount === 0
      && failureTelemetry.stressLostEventCount === 0,
    performanceRiskCaptured: !failureTelemetry.hookEnqueueP95AboveBetaBudget
      || failureTelemetry.activeBetaRisks.some((risk) => risk.id === "hook-enqueue-p95-beta-budget"),
    openGatesPreserved: sameStringSet(resolution.remainingOpenGates, EXPLICITLY_OPEN),
    noPrivateContent: privacy.clean
  };
  const readbackDigest = digestJson({
    schemaVersion: SCHEMA_VERSION,
    sourceReadbacks,
    runs,
    drift,
    recommendations,
    agentSpawn,
    resolution,
    failureTelemetry,
    privacy,
    assertions
  } as unknown as Json);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(0).toISOString(),
    gates: [...GATES],
    status: "verified",
    scope: {
      repo: "architecture-ledger-local-beta-telemetry",
      authority: "local opt-in beta report from existing verified AL10 readback evidence",
      closedGates: [...GATES],
      explicitlyOpen: [...EXPLICITLY_OPEN],
      reportMode: "local-opt-in-readback",
      nonClaims: [
        "not production telemetry",
        "not beta-user interview evidence",
        "not independent governance approval",
        "not final Go/No-Go"
      ]
    },
    sources: SOURCE_EVIDENCE.map(({ id, path, expectedGates }) => ({ id, path, expectedGates: [...expectedGates] })),
    sourceReadbacks,
    runs,
    drift,
    recommendations,
    agentSpawn,
    resolution,
    failureTelemetry,
    privacy,
    readbackDigest,
    assertions,
    readback: {
      command: `bun scripts/architecture-ledger-al10-telemetry-readback.ts inspect --evidence ${DEFAULT_OUT} --json`,
      recordCommand: `bun scripts/architecture-ledger-al10-telemetry-readback.ts run --out ${DEFAULT_OUT} --report ${DEFAULT_REPORT} --json`,
      reportPath: DEFAULT_REPORT
    },
    failures: [] as string[]
  };
}

export function inspectArchitectureLedgerAl10TelemetryReadback(packet: any) {
  const failures: string[] = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return { ok: false, status: "failed", failures: ["packet must be an object"], gates: {} };
  }
  if (packet.schemaVersion !== SCHEMA_VERSION) failures.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (packet.status !== undefined && packet.status !== "verified") failures.push("status must be verified");
  if (!sameStringSet(packet.gates, GATES)) failures.push("gates must be exactly AL10-13");
  if (!sameStringSet(packet.scope?.closedGates, GATES)) failures.push("scope.closedGates must be exactly AL10-13");
  if (!Array.isArray(packet.scope?.explicitlyOpen) || !packet.scope.explicitlyOpen.includes("AL10-14")) failures.push("scope.explicitlyOpen must keep AL10-14 open");
  if (!Array.isArray(packet.scope?.explicitlyOpen) || !packet.scope.explicitlyOpen.includes("AL10-GA-1")) failures.push("scope.explicitlyOpen must keep GA gates open");
  if (!packet.readbackDigest || typeof packet.readbackDigest !== "string") failures.push("readbackDigest must be present");

  inspectSources(packet.sourceReadbacks, failures);
  inspectRuns(packet.runs, failures);
  inspectDrift(packet.drift, failures);
  inspectRecommendations(packet.recommendations, failures);
  inspectAgentSpawn(packet.agentSpawn, failures);
  inspectResolution(packet.resolution, failures);
  inspectFailureTelemetry(packet.failureTelemetry, failures);
  inspectPrivacyPacket(packet.privacy, failures);
  inspectAssertions(packet.assertions, failures);

  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? "verified" : "failed",
    failures,
    gates: Object.fromEntries(GATES.map((gate) => [gate, packet.assertions?.[gate] === true ? "verified" : "blocked"])),
    runs: packet.runs,
    drift: packet.drift,
    recommendations: packet.recommendations,
    agentSpawn: packet.agentSpawn,
    failureTelemetry: packet.failureTelemetry
  };
}

function loadSourcePacket(source: SourceEvidence): SourcePacket {
  const raw = readText(source.path);
  return { source, raw, packet: JSON.parse(raw) as Record<string, any> };
}

function inspectSourceEvidence({ source, raw, packet }: SourcePacket) {
  const serialized = raw;
  const status = String(packet.status ?? "");
  const ok = packet.ok === undefined ? status === "verified" : packet.ok === true;
  const gates = Array.isArray(packet.gates) ? packet.gates.map(String) : [];
  const missingGates = source.expectedGates.filter((gate) => !gates.includes(gate));
  const requiredTermsPresent = source.requiredTerms.filter((term) => serialized.includes(term));
  const missingTerms = source.requiredTerms.filter((term) => !serialized.includes(term));
  return {
    id: source.id,
    path: source.path,
    sha256: sha256(raw),
    schemaVersion: String(packet.schemaVersion ?? ""),
    status,
    ok,
    gates,
    missingGates,
    requiredTermsPresent,
    missingTerms,
    failureCount: Array.isArray(packet.failures) ? packet.failures.length : 0,
    verified: status === "verified" && ok && missingGates.length === 0 && missingTerms.length === 0
  };
}

function summarizeRuns(sources: Record<string, any>, sourceReadbacks: any[]) {
  const benchmark = sources["representative-benchmark"] ?? {};
  const hardening = sources.hardening ?? {};
  const chaosSecurity = sources["chaos-security"] ?? {};
  const recommendation = sources["recommendation-quality"] ?? {};
  const agent = sources["agent-comparison"] ?? {};
  const release = sources["release-packaging"] ?? {};
  const runbooks = sources.runbooks ?? {};
  const closedGateIds = new Set(sourceReadbacks.flatMap((source) => Array.isArray(source.gates) ? source.gates : []));
  return {
    telemetrySourceCount: sourceReadbacks.length,
    verifiedSourceCount: sourceReadbacks.filter((source) => source.verified).length,
    closedGateEvidenceCount: closedGateIds.size,
    representativeFixtureCount: numberValue(benchmark.benchmark?.fixtureCount),
    fullLoopReplayCount: Array.isArray(benchmark.fixtures) ? benchmark.fixtures.length : 0,
    totalEntities: numberValue(benchmark.benchmark?.totalEntities),
    totalRelations: numberValue(benchmark.benchmark?.totalRelations),
    totalConstraints: numberValue(benchmark.benchmark?.totalConstraints),
    stressEventCount: numberValue(hardening.stress?.eventCount),
    stressReplayEventCount: numberValue(hardening.stress?.replayEventCount),
    chaosCaseCount: objectValues(chaosSecurity.chaos).length,
    securityCaseCount: objectValues(chaosSecurity.security).length,
    recommendationScenarioCount: numberValue(recommendation.summary?.totalScenarios),
    recommendationPracticeCount: numberValue(recommendation.supportSummary?.practiceCount),
    agentComparisonRunCount: numberValue(agent.deterministicPlusAgent?.agentRunCount),
    releaseMigrationStateCount: Array.isArray(release.migrationMatrix) ? release.migrationMatrix.length : 0,
    runbookSectionCount: Array.isArray(runbooks.sectionCoverage) ? runbooks.sectionCoverage.length : 0
  };
}

function summarizeDrift(sources: Record<string, any>) {
  const rollout = sources["rollout-workflow"] ?? {};
  const benchmark = sources["representative-benchmark"] ?? {};
  const hardening = sources.hardening ?? {};
  const fixtures = Array.isArray(benchmark.fixtures) ? benchmark.fixtures : [];
  const fixtureDriftCleanCount = fixtures.filter((fixture: any) => fixture.loop?.drift?.afterMigrate === true && fixture.loop?.drift?.afterReplay === true && fixture.loop?.drift?.docsAfterProjection === true).length;
  const dualModeDriftCount = numberValue(benchmark.benchmark?.dualModeDriftCount);
  const rolloutDriftClean = rollout.workflow?.driftCleanAfterMigrate === true;
  const rollbackAuthority = String(hardening.rollback?.targetAuthority ?? "");
  return {
    representativeFixtureCount: fixtures.length,
    fixtureDriftCleanCount,
    dualModeDriftCount,
    rolloutDriftClean,
    rollbackAuthority,
    rollbackRestoresYaml: rollbackAuthority === "yaml" && hardening.rollback?.fullRollbackToYaml === true,
    knownUnresolvedDriftCount: dualModeDriftCount + (fixtureDriftCleanCount === fixtures.length ? 0 : fixtures.length - fixtureDriftCleanCount) + (rolloutDriftClean ? 0 : 1)
  };
}

function summarizeRecommendations(sources: Record<string, any>) {
  const recommendation = sources["recommendation-quality"] ?? {};
  const metrics = recommendation.metrics ?? {};
  const thresholds = recommendation.thresholds ?? {};
  const supportSummary = recommendation.supportSummary ?? {};
  const qualityViolationCount = countQualityViolations(recommendation.qualityViolations);
  const failedEvalGateCount = Array.isArray(recommendation.failedEvalGates) ? recommendation.failedEvalGates.length : 0;
  return {
    scenarioCount: numberValue(recommendation.summary?.totalScenarios),
    positiveCases: numberValue(recommendation.summary?.positiveCases),
    noKeywordStructuralPositiveCases: numberValue(recommendation.summary?.noKeywordStructuralPositiveCases),
    directPracticeReferenceCases: numberValue(recommendation.summary?.directPracticeReferenceCases),
    negativeCases: numberValue(recommendation.summary?.negativeCases),
    adversarialCases: numberValue(recommendation.summary?.adversarialCases),
    practiceCount: numberValue(supportSummary.practiceCount),
    expectedSupportTotal: numberValue(supportSummary.expectedTotal),
    matchedSupportTotal: numberValue(supportSummary.matchedTotal),
    minPracticeRecall: numberValue(supportSummary.minRecall),
    supportComplete: Array.isArray(supportSummary.incompletePracticeIds) && supportSummary.incompletePracticeIds.length === 0,
    top3Recall: numberValue(metrics.top3Recall),
    recommendationPrecisionAt3: numberValue(metrics.recommendationPrecisionAt3),
    noKeywordStructuralRecall: numberValue(metrics.noKeywordStructuralRecall),
    directPracticeReferenceRecall: numberValue(metrics.directPracticeReferenceRecall),
    benignPrecision: numberValue(metrics.benignPrecision),
    evidenceShuffleContaminationRate: numberValue(metrics.evidenceShuffleContaminationRate),
    hardGateFalsePositiveRate: numberValue(metrics.heuristicOnlyHardGateRate) + numberValue(metrics.dynamicDocHardGateRate),
    waiverRejectedRate: numberValue(metrics.waiverRejectedRate),
    qualityViolationCount,
    failedEvalGateCount,
    thresholds: {
      practiceTop3Recall: numberValue(thresholds.practiceTop3Recall),
      recommendationPrecisionAt3: numberValue(thresholds.recommendationPrecisionAt3),
      noKeywordStructuralRecall: numberValue(thresholds.noKeywordStructuralRecall),
      directPracticeReferenceRecall: numberValue(thresholds.directPracticeReferenceRecall),
      benignPrecision: numberValue(thresholds.benignPrecision)
    }
  };
}

function summarizeAgentSpawn(sources: Record<string, any>) {
  const hardening = sources.hardening ?? {};
  const agent = sources["agent-comparison"] ?? {};
  const defaultHook = hardening.defaultHook ?? {};
  const plusAgent = agent.deterministicPlusAgent ?? {};
  const cost = agent.costComparison ?? plusAgent.cost ?? {};
  return {
    defaultHookSampleCount: numberValue(defaultHook.sampleCount),
    defaultMedianSpawnCount: numberValue(defaultHook.medianSpawnCount),
    defaultTotalSpawnedJobs: numberValue(defaultHook.totalSpawnedJobs),
    defaultHookAllZeroSpawn: defaultHook.defaultHookAllZeroSpawn === true,
    defaultPathZeroSpawn: numberValue(defaultHook.medianSpawnCount) === 0
      && numberValue(defaultHook.totalSpawnedJobs) === 0
      && defaultHook.defaultHookAllZeroSpawn === true,
    explicitHighRiskEnqueued: defaultHook.explicitHighRiskEnqueued === true,
    agentComparisonRunCount: numberValue(plusAgent.agentRunCount),
    succeededAgentRuns: numberValue(plusAgent.succeededAgentRuns),
    failedAgentRuns: numberValue(plusAgent.failedAgentRuns),
    fallbackRunCount: numberValue(plusAgent.fallbackRunCount),
    advisoryFindings: numberValue(plusAgent.totalFindings),
    advisoryOnly: plusAgent.advisoryOnly === true,
    directMutationAttempts: numberValue(plusAgent.directMutationAttempts),
    attempts: numberValue(cost.attempts),
    durationMs: numberValue(cost.agentDurationMs ?? cost.durationMs),
    estimatedAgentTokens: numberValue(cost.estimatedAgentTokens),
    actualExternalProviderCostUsd: numberValue(cost.actualExternalProviderCostUsd)
  };
}

function summarizeResolution(sources: Record<string, any>) {
  const hardening = sources.hardening ?? {};
  const chaosSecurity = sources["chaos-security"] ?? {};
  const release = sources["release-packaging"] ?? {};
  const runbooks = sources.runbooks ?? {};
  const chaosCases = objectValues(chaosSecurity.chaos);
  const securityCases = objectValues(chaosSecurity.security);
  const migrationMatrix = Array.isArray(release.migrationMatrix) ? release.migrationMatrix : [];
  const runbookSections = Array.isArray(runbooks.sectionCoverage) ? runbooks.sectionCoverage : [];
  return {
    rollbackDemonstrated: hardening.rollback?.fullRollbackToYaml === true
      && hardening.rollback?.rollbackBackupCreated === true
      && hardening.rollback?.rollbackCommandPresent === true,
    rollbackTargetAuthority: String(hardening.rollback?.targetAuthority ?? ""),
    chaosCaseCount: chaosCases.length,
    chaosCaseOkCount: chaosCases.filter((item: any) => item?.ok === true).length,
    securityCaseCount: securityCases.length,
    securityCaseOkCount: securityCases.filter((item: any) => item?.ok === true).length,
    privacySurfacesClean: hardening.privacy?.overallClean === true
      && chaosSecurity.privacy?.clean === true
      && runbooks.privacy?.clean === true,
    privacySurfaceCount: numberValue(hardening.privacy?.scannedSurfaceCount),
    releaseMigrationStateCount: migrationMatrix.length,
    releaseMigrationStatesVerified: migrationMatrix.filter((item: any) => item?.passed === true).length,
    runbookSectionsVerified: runbookSections.filter((section: any) => section?.complete === true).length,
    remainingOpenGates: [...EXPLICITLY_OPEN]
  };
}

function summarizeFailuresAndRisks(sources: Record<string, any>, sourceReadbacks: any[], recommendations: ReturnType<typeof summarizeRecommendations>) {
  const benchmark = sources["representative-benchmark"] ?? {};
  const hardening = sources.hardening ?? {};
  const hookP95 = numberValue(benchmark.benchmark?.hookEnqueueP95Ms);
  const hookBudget = numberValue(benchmark.thresholds?.hookEnqueueP95Ms);
  const hookEnqueueP95AboveBetaBudget = hookBudget > 0 && hookP95 > hookBudget;
  const stressLostEventCount = Math.max(0, numberValue(hardening.stress?.eventCount) - numberValue(hardening.stress?.uniqueEventIds));
  const privacyLeakCount = countPrivacyLeaks(sources);
  const activeBetaRisks = hookEnqueueP95AboveBetaBudget
    ? [{
        id: "hook-enqueue-p95-beta-budget",
        severity: "tracked-beta-risk",
        metric: "hookEnqueueP95Ms",
        actualMs: hookP95,
        budgetMs: hookBudget,
        impact: "AL10-04 measured the path, but the beta telemetry report keeps the p95 over-budget observation visible for follow-up."
      }]
    : [];
  return {
    sourceReadbackFailureCount: sourceReadbacks.reduce((sum, source) => sum + numberValue(source.failureCount), 0),
    failedSourceReadbackCount: sourceReadbacks.filter((source) => !source.verified).length,
    failedEvalGateCount: recommendations.failedEvalGateCount,
    qualityViolationCount: recommendations.qualityViolationCount,
    privacyLeakCount,
    stressLostEventCount,
    unexpectedDuplicateEventCount: numberValue(hardening.stress?.duplicateAppendCount) === 1 ? 0 : numberValue(hardening.stress?.duplicateAppendCount),
    hookEnqueueP95AboveBetaBudget,
    activeBetaRiskCount: activeBetaRisks.length,
    activeBetaRisks,
    remainingOpenGateCount: EXPLICITLY_OPEN.length
  };
}

function inspectSources(sources: any, failures: string[]): void {
  if (!Array.isArray(sources)) {
    failures.push("sourceReadbacks must be an array");
    return;
  }
  if (sources.length !== SOURCE_EVIDENCE.length) failures.push(`sourceReadbacks must include ${SOURCE_EVIDENCE.length} evidence sources`);
  for (const expected of SOURCE_EVIDENCE) {
    const actual = sources.find((source: any) => source?.id === expected.id);
    if (!actual) {
      failures.push(`source readback missing: ${expected.id}`);
      continue;
    }
    if (actual.status !== "verified") failures.push(`${expected.id}: source status must be verified`);
    if (actual.ok !== true) failures.push(`${expected.id}: source ok must be true`);
    if (Array.isArray(actual.missingGates) && actual.missingGates.length > 0) failures.push(`${expected.id}: missing gates ${actual.missingGates.join(",")}`);
    if (Array.isArray(actual.missingTerms) && actual.missingTerms.length > 0) failures.push(`${expected.id}: missing terms ${actual.missingTerms.join(",")}`);
    if (actual.verified !== true) failures.push(`${expected.id}: source readback must be verified`);
  }
}

function inspectRuns(runs: any, failures: string[]): void {
  if (runs?.telemetrySourceCount !== SOURCE_EVIDENCE.length) failures.push("runs.telemetrySourceCount must include all AL10 source readbacks");
  if (runs?.verifiedSourceCount !== SOURCE_EVIDENCE.length) failures.push("runs.verifiedSourceCount must include all AL10 source readbacks");
  if (runs?.representativeFixtureCount < 3) failures.push("runs.representativeFixtureCount must be at least 3");
  if (runs?.fullLoopReplayCount < 3) failures.push("runs.fullLoopReplayCount must be at least 3");
  if (runs?.stressEventCount < 1000) failures.push("runs.stressEventCount must be at least 1000");
  if (runs?.agentComparisonRunCount < 4) failures.push("runs.agentComparisonRunCount must be at least 4");
  if (runs?.releaseMigrationStateCount < 5) failures.push("runs.releaseMigrationStateCount must be at least 5");
}

function inspectDrift(drift: any, failures: string[]): void {
  if (drift?.dualModeDriftCount !== 0) failures.push("drift.dualModeDriftCount must be 0");
  if (drift?.fixtureDriftCleanCount !== drift?.representativeFixtureCount) failures.push("drift fixture clean count must equal representative fixture count");
  if (drift?.rolloutDriftClean !== true) failures.push("drift rollout path must be clean");
  if (drift?.rollbackRestoresYaml !== true) failures.push("drift rollback must restore YAML authority");
  if (drift?.knownUnresolvedDriftCount !== 0) failures.push("drift.knownUnresolvedDriftCount must be 0");
}

function inspectRecommendations(recommendations: any, failures: string[]): void {
  if (recommendations?.scenarioCount < 190) failures.push("recommendations.scenarioCount must cover the representative eval suite");
  if (recommendations?.practiceCount < 1) failures.push("recommendations.practiceCount must be positive");
  if (recommendations?.supportComplete !== true) failures.push("recommendations support must be complete");
  if (recommendations?.top3Recall < recommendations?.thresholds?.practiceTop3Recall) failures.push("recommendations.top3Recall below threshold");
  if (recommendations?.recommendationPrecisionAt3 < recommendations?.thresholds?.recommendationPrecisionAt3) failures.push("recommendations.recommendationPrecisionAt3 below threshold");
  if (recommendations?.noKeywordStructuralRecall < recommendations?.thresholds?.noKeywordStructuralRecall) failures.push("recommendations.noKeywordStructuralRecall below threshold");
  if (recommendations?.directPracticeReferenceRecall < recommendations?.thresholds?.directPracticeReferenceRecall) failures.push("recommendations.directPracticeReferenceRecall below threshold");
  if (recommendations?.evidenceShuffleContaminationRate !== 0) failures.push("recommendations.evidenceShuffleContaminationRate must be 0");
  if (recommendations?.hardGateFalsePositiveRate !== 0) failures.push("recommendations.hardGateFalsePositiveRate must be 0");
  if (recommendations?.qualityViolationCount !== 0) failures.push("recommendations.qualityViolationCount must be 0");
  if (recommendations?.failedEvalGateCount !== 0) failures.push("recommendations.failedEvalGateCount must be 0");
}

function inspectAgentSpawn(agentSpawn: any, failures: string[]): void {
  if (agentSpawn?.defaultHookSampleCount < 9) failures.push("agentSpawn.defaultHookSampleCount must be at least 9");
  if (agentSpawn?.defaultMedianSpawnCount !== 0) failures.push("agentSpawn.defaultMedianSpawnCount must be 0");
  if (agentSpawn?.defaultTotalSpawnedJobs !== 0) failures.push("agentSpawn.defaultTotalSpawnedJobs must be 0");
  if (agentSpawn?.defaultPathZeroSpawn !== true) failures.push("agentSpawn.defaultPathZeroSpawn must be true");
  if (agentSpawn?.explicitHighRiskEnqueued !== true) failures.push("agentSpawn.explicitHighRiskEnqueued must be true");
  if (agentSpawn?.agentComparisonRunCount < 4) failures.push("agentSpawn.agentComparisonRunCount must be at least 4");
  if (agentSpawn?.failedAgentRuns !== 0) failures.push("agentSpawn.failedAgentRuns must be 0");
  if (agentSpawn?.advisoryOnly !== true) failures.push("agentSpawn.advisoryOnly must be true");
  if (agentSpawn?.directMutationAttempts !== 0) failures.push("agentSpawn.directMutationAttempts must be 0");
  if (agentSpawn?.estimatedAgentTokens <= 0) failures.push("agentSpawn.estimatedAgentTokens must be positive");
  if (agentSpawn?.actualExternalProviderCostUsd !== 0) failures.push("agentSpawn.actualExternalProviderCostUsd must be 0");
}

function inspectResolution(resolution: any, failures: string[]): void {
  if (resolution?.rollbackDemonstrated !== true) failures.push("resolution.rollbackDemonstrated must be true");
  if (resolution?.rollbackTargetAuthority !== "yaml") failures.push("resolution.rollbackTargetAuthority must be yaml");
  if (resolution?.chaosCaseCount < 6 || resolution?.chaosCaseOkCount !== resolution?.chaosCaseCount) failures.push("resolution chaos matrix must be fully ok");
  if (resolution?.securityCaseCount < 6 || resolution?.securityCaseOkCount !== resolution?.securityCaseCount) failures.push("resolution security matrix must be fully ok");
  if (resolution?.privacySurfacesClean !== true) failures.push("resolution privacy surfaces must be clean");
  if (resolution?.releaseMigrationStateCount < 5 || resolution?.releaseMigrationStatesVerified !== resolution?.releaseMigrationStateCount) failures.push("resolution migration matrix must be fully verified");
  if (resolution?.runbookSectionsVerified < 5) failures.push("resolution runbook sections must be verified");
  if (!Array.isArray(resolution?.remainingOpenGates) || !resolution.remainingOpenGates.includes("AL10-14")) failures.push("resolution must keep AL10-14 open");
}

function inspectFailureTelemetry(failureTelemetry: any, failures: string[]): void {
  if (failureTelemetry?.sourceReadbackFailureCount !== 0) failures.push("failureTelemetry.sourceReadbackFailureCount must be 0");
  if (failureTelemetry?.failedSourceReadbackCount !== 0) failures.push("failureTelemetry.failedSourceReadbackCount must be 0");
  if (failureTelemetry?.failedEvalGateCount !== 0) failures.push("failureTelemetry.failedEvalGateCount must be 0");
  if (failureTelemetry?.qualityViolationCount !== 0) failures.push("failureTelemetry.qualityViolationCount must be 0");
  if (failureTelemetry?.privacyLeakCount !== 0) failures.push("failureTelemetry.privacyLeakCount must be 0");
  if (failureTelemetry?.stressLostEventCount !== 0) failures.push("failureTelemetry.stressLostEventCount must be 0");
  if (failureTelemetry?.unexpectedDuplicateEventCount !== 0) failures.push("failureTelemetry.unexpectedDuplicateEventCount must be 0");
  if (failureTelemetry?.hookEnqueueP95AboveBetaBudget === true && !failureTelemetry.activeBetaRisks?.some((risk: any) => risk?.id === "hook-enqueue-p95-beta-budget")) {
    failures.push("failureTelemetry must record the hook enqueue p95 beta risk");
  }
  if (failureTelemetry?.remainingOpenGateCount !== EXPLICITLY_OPEN.length) failures.push("failureTelemetry.remainingOpenGateCount must preserve open gates");
}

function inspectPrivacyPacket(privacy: any, failures: string[]): void {
  if (!privacy || typeof privacy !== "object" || Array.isArray(privacy)) {
    failures.push("privacy must be an object");
    return;
  }
  if (privacy.forbiddenSecretHitCount !== 0) failures.push("privacy forbiddenSecretHitCount must be 0");
  if (privacy.forbiddenRawContentHitCount !== 0) failures.push("privacy forbiddenRawContentHitCount must be 0");
  if (privacy.clean !== true) failures.push("privacy must be clean");
}

function inspectAssertions(assertions: Record<string, unknown> | undefined, failures: string[]): void {
  if (!assertions || typeof assertions !== "object") {
    failures.push("assertions must be present");
    return;
  }
  const allowed = new Set([
    ...GATES,
    "sourceReadbacksVerified",
    "runTelemetryCovered",
    "driftTelemetryClean",
    "recommendationTelemetryCovered",
    "agentSpawnTelemetryCovered",
    "resolutionTelemetryCovered",
    "failureTelemetryCovered",
    "performanceRiskCaptured",
    "openGatesPreserved",
    "noPrivateContent"
  ]);
  for (const key of Object.keys(assertions)) {
    if (!allowed.has(key)) failures.push(`unexpected gate assertion: ${key}`);
  }
  for (const key of allowed) {
    if (assertions[key] !== true) failures.push(`assertions.${key} must be true`);
  }
}

function inspectPrivacy(value: unknown) {
  const serialized = JSON.stringify(value);
  const secretHits = SECRET_PATTERNS.filter((pattern) => pattern.test(serialized)).map(String);
  const rawContentHits = RAW_CONTENT_PATTERNS.filter((pattern) => pattern.test(serialized)).map(String);
  return {
    forbiddenSecretHitCount: secretHits.length,
    forbiddenRawContentHitCount: rawContentHits.length,
    secretHits,
    rawContentHits,
    clean: secretHits.length === 0 && rawContentHits.length === 0
  };
}

function countQualityViolations(value: any): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  return (Object.values(value) as unknown[]).reduce((sum: number, item: unknown) => sum + (Array.isArray(item) ? item.length : 0), 0);
}

function countPrivacyLeaks(sources: Record<string, any>): number {
  const hardening = sources.hardening ?? {};
  const chaosSecurity = sources["chaos-security"] ?? {};
  const runbooks = sources.runbooks ?? {};
  const hardeningForbidden = (hardening.privacy?.forbiddenKeyHits?.length ?? 0) + (hardening.privacy?.forbiddenTokenHits?.length ?? 0);
  const chaosForbidden = (chaosSecurity.privacy?.forbiddenKeyHits?.length ?? 0) + (chaosSecurity.privacy?.forbiddenTokenHits?.length ?? 0);
  const runbookForbidden = numberValue(runbooks.privacy?.forbiddenSecretHitCount) + numberValue(runbooks.privacy?.forbiddenRawContentHitCount);
  return hardeningForbidden + chaosForbidden + runbookForbidden;
}

function renderReport(packet: any): string {
  return [
    "# Architecture Ledger AL10 Telemetry Readback",
    "",
    "## Scope",
    "",
    "- Closes: AL10-13 only.",
    "- Mode: local opt-in beta report assembled from verified AL10 readback packets.",
    "- Keeps open: product interviews, independent reviewer, final Go/No-Go and all GA gates.",
    "- Non-claim: this is not production telemetry and does not promote ledger authority.",
    "",
    "## Source Readbacks",
    "",
    "| Source | Status | Gates | Verified |",
    "| --- | --- | --- | --- |",
    ...packet.sourceReadbacks.map((source: any) => `| ${source.id} | ${source.status} | ${source.gates.join(", ")} | ${source.verified ? "yes" : "no"} |`),
    "",
    "## Runs",
    "",
    `- Verified telemetry sources: ${packet.runs.verifiedSourceCount}/${packet.runs.telemetrySourceCount}`,
    `- Representative fixtures: ${packet.runs.representativeFixtureCount}; entities/relations/constraints: ${packet.runs.totalEntities}/${packet.runs.totalRelations}/${packet.runs.totalConstraints}`,
    `- Stress events: ${packet.runs.stressEventCount}; replayed: ${packet.runs.stressReplayEventCount}`,
    `- Recommendation scenarios/practices: ${packet.runs.recommendationScenarioCount}/${packet.runs.recommendationPracticeCount}`,
    `- Agent comparison runs: ${packet.runs.agentComparisonRunCount}; release migration states: ${packet.runs.releaseMigrationStateCount}`,
    "",
    "## Drift",
    "",
    `- Dual-mode drift count: ${packet.drift.dualModeDriftCount}`,
    `- Clean fixture drift: ${packet.drift.fixtureDriftCleanCount}/${packet.drift.representativeFixtureCount}`,
    `- Rollback restores YAML authority: ${packet.drift.rollbackRestoresYaml ? "yes" : "no"}`,
    "",
    "## Recommendations",
    "",
    `- Top-3 recall: ${percent(packet.recommendations.top3Recall)}`,
    `- Precision@3: ${percent(packet.recommendations.recommendationPrecisionAt3)}`,
    `- No-label structural recall: ${percent(packet.recommendations.noKeywordStructuralRecall)}`,
    `- Per-practice support: ${packet.recommendations.matchedSupportTotal}/${packet.recommendations.expectedSupportTotal}; violations: ${packet.recommendations.qualityViolationCount}`,
    "",
    "## Agent Spawn",
    "",
    `- Default hook samples: ${packet.agentSpawn.defaultHookSampleCount}; median spawns: ${packet.agentSpawn.defaultMedianSpawnCount}; total spawns: ${packet.agentSpawn.defaultTotalSpawnedJobs}`,
    `- Explicit high-risk audit enqueue: ${packet.agentSpawn.explicitHighRiskEnqueued ? "yes" : "no"}`,
    `- Plus-agent comparison: ${packet.agentSpawn.agentComparisonRunCount} runs, ${packet.agentSpawn.estimatedAgentTokens} estimated tokens, external cost $${packet.agentSpawn.actualExternalProviderCostUsd}`,
    "",
    "## Resolution And Failures",
    "",
    `- Rollback demonstrated: ${packet.resolution.rollbackDemonstrated ? "yes" : "no"}`,
    `- Chaos/security cases OK: ${packet.resolution.chaosCaseOkCount}/${packet.resolution.chaosCaseCount} and ${packet.resolution.securityCaseOkCount}/${packet.resolution.securityCaseCount}`,
    `- Privacy leak count: ${packet.failureTelemetry.privacyLeakCount}`,
    `- Eval failures / quality violations: ${packet.failureTelemetry.failedEvalGateCount}/${packet.failureTelemetry.qualityViolationCount}`,
    `- Active beta risks: ${packet.failureTelemetry.activeBetaRisks.map((risk: any) => `${risk.id} actual=${risk.actualMs}ms budget=${risk.budgetMs}ms`).join("; ") || "none"}`,
    "",
    "## Readback",
    "",
    "```bash",
    packet.readback.command,
    packet.readback.recordCommand,
    "```",
    ""
  ].join("\n");
}

function renderHuman(result: any): string {
  if (result.ok) {
    return `[architecture-ledger-al10-telemetry-readback] OK sources=${result.runs.telemetrySourceCount} drift=${result.drift.knownUnresolvedDriftCount} agentDefaultSpawns=${result.agentSpawn.defaultTotalSpawnedJobs}`;
  }
  return `[architecture-ledger-al10-telemetry-readback] FAILED\n${result.failures.map((failure: string) => `- ${failure}`).join("\n")}`;
}

function objectValues(value: any): any[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.values(value);
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function readText(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
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
