#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { digestJson, type Json } from "@archcontext/contracts";
import { runRepresentativeEval, THRESHOLDS, type RepresentativeEvalResult } from "../evals/run";

const ROOT = resolve(import.meta.dir, "..");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al10-recommendation-quality-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al10-recommendation-quality-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al10-recommendation-quality.md";
const GATES = ["AL10-08", "AL10-BETA-4"] as const;
const EXPLICITLY_OPEN = [
  "AL10-09",
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

const DATASET_FILES = [
  { id: "structural-positive", role: "labeled-positive", path: "evals/practices/structural-positive.jsonl" },
  { id: "no-keyword-structural-positive", role: "blind-no-label-positive", path: "evals/practices/no-keyword-structural-positive.jsonl" },
  { id: "direct-practice-reference", role: "typed-evidence-reference", path: "evals/practices/direct-practice-reference.jsonl" },
  { id: "benign-negative", role: "benign-negative", path: "evals/practices/benign-negative.jsonl" },
  { id: "keyword-heavy-benign-negative", role: "keyword-heavy-negative", path: "evals/practices/keyword-heavy-benign-negative.jsonl" },
  { id: "budget-irrelevant-resource", role: "context-budget-negative", path: "evals/practices/budget-irrelevant-resource.jsonl" },
  { id: "enforcement-waiver-adversarial", role: "adversarial-waiver-negative", path: "evals/practices/enforcement-waiver-adversarial.jsonl" }
] as const;

const NO_LABEL_DATASET_PATH = "evals/practices/no-keyword-structural-positive.jsonl";

type FrozenDataset = ReturnType<typeof inspectFrozenDataset>;
type SupportRow = {
  practiceId: string;
  expected: number;
  matched: number;
  recall: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
};

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[architecture-ledger-al10-recommendation-quality-readback] usage: run|inspect [--out path] [--report path] [--evidence path] [--json]");
    process.exit(2);
  }
  const result = command === "run"
    ? runArchitectureLedgerAl10RecommendationQualityReadback({
        outPath: readFlag(args, "--out") ?? DEFAULT_OUT,
        reportPath: readFlag(args, "--report") ?? DEFAULT_REPORT
      })
    : inspectArchitectureLedgerAl10RecommendationQualityReadback(
        JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
      );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export function runArchitectureLedgerAl10RecommendationQualityReadback({
  outPath = DEFAULT_OUT,
  reportPath = DEFAULT_REPORT
} = {}) {
  const packet = buildArchitectureLedgerAl10RecommendationQualityPacket();
  const inspected = inspectArchitectureLedgerAl10RecommendationQualityReadback(packet);
  const finalPacket = {
    ...packet,
    status: inspected.ok ? "verified" : "failed",
    failures: inspected.failures
  };
  writeJson(outPath, finalPacket);
  writeText(reportPath, renderReport(finalPacket));
  return inspectArchitectureLedgerAl10RecommendationQualityReadback(finalPacket);
}

export function buildArchitectureLedgerAl10RecommendationQualityPacket(
  result: RepresentativeEvalResult = runRepresentativeEval()
) {
  const frozenDatasets = DATASET_FILES.map((dataset) => inspectFrozenDataset(ROOT, dataset));
  const noLabel = inspectNoLabelDataset(ROOT, result);
  const perPracticeSupport = buildPerPracticeSupport(result);
  const supportSummary = summarizeSupport(perPracticeSupport);
  const summary = {
    positiveCases: result.practices.positiveCases,
    noKeywordStructuralPositiveCases: result.practices.noKeywordStructuralPositiveCases,
    directPracticeReferenceCases: result.practices.directPracticeReferenceCases,
    negativeCases: result.practices.negativeCases,
    adversarialCases: result.practices.adversarialCases,
    totalScenarios: result.practices.totalScenarios,
    chineseCases: result.practices.chineseCases,
    chineseRatio: result.practices.chineseRatio,
    keywordHeavyBenignNegativeCases: result.practices.keywordHeavyBenignNegativeCases,
    budgetIrrelevantResourceCases: result.practices.budgetIrrelevantResourceCases,
    enforcementWaiverAdversarialCases: result.practices.enforcementWaiverAdversarialCases
  };
  const metrics = {
    top3Recall: result.practices.top3Recall,
    recommendationPrecisionAt3: result.practices.recommendationPrecisionAt3,
    recommendationRecallAt3: result.practices.recommendationRecallAt3,
    benignPrecision: result.practices.benignPrecision,
    noKeywordStructuralRecall: result.practices.noKeywordStructuralRecall,
    directPracticeReferenceRecall: result.practices.directPracticeReferenceRecall,
    evidenceShuffleContaminationRate: result.practices.evidenceShuffleContaminationRate,
    heuristicOnlyHardGateRate: result.practices.heuristicOnlyHardGateRate,
    dynamicDocHardGateRate: result.practices.dynamicDocHardGateRate,
    waiverRejectedRate: result.practices.waiverRejectedRate
  };
  const qualityViolations = {
    datasetMetadataViolations: result.practices.datasetMetadataViolations,
    prohibitedMatchIds: result.practices.prohibitedMatchIds,
    evidenceMinimumViolations: result.practices.evidenceMinimumViolations,
    enforcementCeilingViolations: result.practices.enforcementCeilingViolations,
    missedPositiveIds: result.practices.missedPositiveIds,
    missedNoKeywordStructuralIds: result.practices.missedNoKeywordStructuralIds,
    missedDirectReferenceIds: result.practices.missedDirectReferenceIds,
    negativeNonAdvisoryCaseIds: result.practices.negativeNonAdvisoryCaseIds,
    evidenceShuffleViolationIds: result.practices.evidenceShuffleViolationIds,
    waiverRejectionMissIds: result.practices.waiverRejectionMissIds,
    hardGateMissIds: result.practices.hardGateMissIds
  };
  const failedEvalGates = result.gates.filter((gate) => !gate.pass);
  const assertions = {
    "AL10-08": noLabel.verified && frozenDatasets.length === DATASET_FILES.length && supportSummary.incompletePracticeIds.length === 0,
    "AL10-BETA-4": result.allPass && metrics.top3Recall >= THRESHOLDS.practiceTop3Recall && metrics.recommendationPrecisionAt3 >= THRESHOLDS.recommendationPrecisionAt3 && metrics.noKeywordStructuralRecall >= THRESHOLDS.noKeywordStructuralRecall && metrics.directPracticeReferenceRecall >= THRESHOLDS.directPracticeReferenceRecall && metrics.evidenceShuffleContaminationRate === THRESHOLDS.evidenceShuffleContaminationRate && metrics.heuristicOnlyHardGateRate === THRESHOLDS.heuristicOnlyHardGateRate && metrics.dynamicDocHardGateRate === THRESHOLDS.dynamicDocHardGateRate,
    frozenDatasetDigestsPresent: frozenDatasets.every((dataset) => dataset.sha256.startsWith("sha256:") && dataset.caseCount > 0),
    noLabelCaseMinimum: noLabel.caseCount >= THRESHOLDS.noKeywordStructuralPositiveCases,
    noLabelTaskAndEvidenceLeakFree: noLabel.noEvidence && noLabel.noPracticeBindings && noLabel.practiceIdTaskHitCaseIds.length === 0,
    noLabelDatasetMetadataClean: noLabel.datasetMetadataViolationCount === 0,
    perPracticeSupportPublished: perPracticeSupport.length > 0,
    perPracticeSupportComplete: supportSummary.incompletePracticeIds.length === 0,
    al1PracticeTop3Recall: metrics.top3Recall >= THRESHOLDS.practiceTop3Recall,
    al1RecommendationPrecisionAt3: metrics.recommendationPrecisionAt3 >= THRESHOLDS.recommendationPrecisionAt3,
    al1NoKeywordStructuralRecall: metrics.noKeywordStructuralRecall >= THRESHOLDS.noKeywordStructuralRecall,
    al1DirectPracticeReferenceRecall: metrics.directPracticeReferenceRecall >= THRESHOLDS.directPracticeReferenceRecall,
    al1EvidenceShuffleClean: metrics.evidenceShuffleContaminationRate === THRESHOLDS.evidenceShuffleContaminationRate,
    hardGateFalsePositiveClean: metrics.heuristicOnlyHardGateRate === THRESHOLDS.heuristicOnlyHardGateRate && metrics.dynamicDocHardGateRate === THRESHOLDS.dynamicDocHardGateRate,
    qualityViolationArraysEmpty: Object.values(qualityViolations).every((value) => Array.isArray(value) && value.length === 0),
    noFailedEvalGates: failedEvalGates.length === 0
  };
  const evalDigest = digestJson({
    schemaVersion: SCHEMA_VERSION,
    datasetDigests: frozenDatasets.map((dataset) => ({ path: dataset.path, sha256: dataset.sha256, caseCount: dataset.caseCount })),
    summary,
    metrics,
    supportSummary,
    qualityViolations
  } as unknown as Json);

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(0).toISOString(),
    gates: [...GATES],
    status: "verified",
    scope: {
      repo: "practice-recommendation-evals",
      authority: "evals/run.ts representative recommendation suite plus frozen JSONL digests",
      closedGates: [...GATES],
      explicitlyOpen: [...EXPLICITLY_OPEN]
    },
    thresholds: {
      practiceTop3Recall: THRESHOLDS.practiceTop3Recall,
      recommendationPrecisionAt3: THRESHOLDS.recommendationPrecisionAt3,
      benignPrecision: THRESHOLDS.benignPrecision,
      noKeywordStructuralRecall: THRESHOLDS.noKeywordStructuralRecall,
      directPracticeReferenceRecall: THRESHOLDS.directPracticeReferenceRecall,
      evidenceShuffleContaminationRate: THRESHOLDS.evidenceShuffleContaminationRate,
      heuristicOnlyHardGateRate: THRESHOLDS.heuristicOnlyHardGateRate,
      dynamicDocHardGateRate: THRESHOLDS.dynamicDocHardGateRate,
      waiverRejectedRate: THRESHOLDS.waiverRejectedRate,
      noKeywordStructuralPositiveCases: THRESHOLDS.noKeywordStructuralPositiveCases,
      directPracticeReferenceCases: THRESHOLDS.directPracticeReferenceCases,
      negativePracticeCases: THRESHOLDS.negativePracticeCases,
      enforcementWaiverAdversarialCases: THRESHOLDS.enforcementWaiverAdversarialCases
    },
    evalDigest,
    summary,
    metrics,
    frozenDatasets,
    noLabel,
    supportSummary,
    perPracticeSupport,
    qualityViolations,
    failedEvalGates,
    assertions,
    readback: {
      command: `bun scripts/architecture-ledger-al10-recommendation-quality-readback.ts inspect --evidence ${DEFAULT_OUT} --json`,
      evalCommand: "bun evals/run.ts --check",
      reportPath: DEFAULT_REPORT
    },
    failures: [] as string[]
  };
}

export function inspectArchitectureLedgerAl10RecommendationQualityReadback(packet: any) {
  const failures: string[] = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return { ok: false, status: "failed", failures: ["packet must be an object"], gates: {} };
  }
  if (packet.schemaVersion !== SCHEMA_VERSION) failures.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (packet.status !== undefined && packet.status !== "verified") failures.push("status must be verified");
  if (!packet.evalDigest || typeof packet.evalDigest !== "string") failures.push("evalDigest must be present");
  if (!sameStringSet(packet.gates, GATES)) failures.push("gates must be exactly AL10-08 and AL10-BETA-4");
  if (!sameStringSet(packet.scope?.closedGates, GATES)) failures.push("scope.closedGates must be exactly AL10-08 and AL10-BETA-4");
  if (!Array.isArray(packet.scope?.explicitlyOpen) || !packet.scope.explicitlyOpen.includes("AL10-09")) failures.push("scope.explicitlyOpen must keep AL10-09 open");

  inspectThresholds(packet.thresholds, failures);
  inspectSummary(packet.summary, failures);
  inspectMetrics(packet.metrics, failures);
  inspectFrozenDatasets(packet.frozenDatasets, failures);
  inspectNoLabel(packet.noLabel, failures);
  inspectSupport(packet.perPracticeSupport, packet.supportSummary, failures);
  inspectQualityViolations(packet.qualityViolations, failures);
  if (Array.isArray(packet.failedEvalGates) && packet.failedEvalGates.length > 0) failures.push(`failed eval gates present: ${packet.failedEvalGates.map((gate: any) => gate.target).join(",")}`);
  inspectAssertions(packet.assertions, failures);

  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? "verified" : "failed",
    failures,
    gates: Object.fromEntries(GATES.map((gate) => [gate, packet.assertions?.[gate] === true ? "verified" : "blocked"])),
    metrics: packet.metrics,
    supportSummary: packet.supportSummary,
    frozenDatasets: Array.isArray(packet.frozenDatasets) ? packet.frozenDatasets.length : 0
  };
}

function inspectThresholds(thresholds: any, failures: string[]): void {
  if (thresholds?.practiceTop3Recall !== THRESHOLDS.practiceTop3Recall) failures.push("practiceTop3Recall threshold mismatch");
  if (thresholds?.recommendationPrecisionAt3 !== THRESHOLDS.recommendationPrecisionAt3) failures.push("recommendationPrecisionAt3 threshold mismatch");
  if (thresholds?.noKeywordStructuralRecall !== THRESHOLDS.noKeywordStructuralRecall) failures.push("noKeywordStructuralRecall threshold mismatch");
  if (thresholds?.directPracticeReferenceRecall !== THRESHOLDS.directPracticeReferenceRecall) failures.push("directPracticeReferenceRecall threshold mismatch");
  if (thresholds?.evidenceShuffleContaminationRate !== THRESHOLDS.evidenceShuffleContaminationRate) failures.push("evidenceShuffleContaminationRate threshold mismatch");
  if (thresholds?.heuristicOnlyHardGateRate !== THRESHOLDS.heuristicOnlyHardGateRate) failures.push("heuristicOnlyHardGateRate threshold mismatch");
  if (thresholds?.dynamicDocHardGateRate !== THRESHOLDS.dynamicDocHardGateRate) failures.push("dynamicDocHardGateRate threshold mismatch");
}

function inspectSummary(summary: any, failures: string[]): void {
  if (summary?.noKeywordStructuralPositiveCases < THRESHOLDS.noKeywordStructuralPositiveCases) failures.push("summary.noKeywordStructuralPositiveCases below threshold");
  if (summary?.directPracticeReferenceCases < THRESHOLDS.directPracticeReferenceCases) failures.push("summary.directPracticeReferenceCases below threshold");
  if (summary?.negativeCases < THRESHOLDS.negativePracticeCases) failures.push("summary.negativeCases below threshold");
  if (summary?.enforcementWaiverAdversarialCases < THRESHOLDS.enforcementWaiverAdversarialCases) failures.push("summary.enforcementWaiverAdversarialCases below threshold");
}

function inspectMetrics(metrics: any, failures: string[]): void {
  if (metrics?.top3Recall < THRESHOLDS.practiceTop3Recall) failures.push("metrics.top3Recall below AL1 threshold");
  if (metrics?.recommendationPrecisionAt3 < THRESHOLDS.recommendationPrecisionAt3) failures.push("metrics.recommendationPrecisionAt3 below AL1 threshold");
  if (metrics?.benignPrecision < THRESHOLDS.benignPrecision) failures.push("metrics.benignPrecision below threshold");
  if (metrics?.noKeywordStructuralRecall < THRESHOLDS.noKeywordStructuralRecall) failures.push("metrics.noKeywordStructuralRecall below AL1 threshold");
  if (metrics?.directPracticeReferenceRecall < THRESHOLDS.directPracticeReferenceRecall) failures.push("metrics.directPracticeReferenceRecall below AL1 threshold");
  if (metrics?.evidenceShuffleContaminationRate !== THRESHOLDS.evidenceShuffleContaminationRate) failures.push("metrics.evidenceShuffleContaminationRate must be 0");
  if (metrics?.heuristicOnlyHardGateRate !== THRESHOLDS.heuristicOnlyHardGateRate) failures.push("metrics.heuristicOnlyHardGateRate must be 0");
  if (metrics?.dynamicDocHardGateRate !== THRESHOLDS.dynamicDocHardGateRate) failures.push("metrics.dynamicDocHardGateRate must be 0");
  if (metrics?.waiverRejectedRate < THRESHOLDS.waiverRejectedRate) failures.push("metrics.waiverRejectedRate below threshold");
}

function inspectFrozenDatasets(frozenDatasets: any, failures: string[]): void {
  if (!Array.isArray(frozenDatasets)) {
    failures.push("frozenDatasets must be an array");
    return;
  }
  const paths = frozenDatasets.map((dataset: any) => dataset.path).sort().join(",");
  const expectedPaths = DATASET_FILES.map((dataset) => dataset.path).sort().join(",");
  if (paths !== expectedPaths) failures.push("frozenDatasets must include all representative practice JSONL files");
  for (const dataset of frozenDatasets) {
    if (!(typeof dataset.sha256 === "string" && /^sha256:[a-f0-9]{64}$/.test(dataset.sha256))) failures.push(`${dataset.path}: sha256 digest missing`);
    if (!(dataset.lineCount > 0 && dataset.caseCount > 0)) failures.push(`${dataset.path}: lineCount and caseCount must be positive`);
  }
}

function inspectNoLabel(noLabel: any, failures: string[]): void {
  if (!noLabel || typeof noLabel !== "object" || Array.isArray(noLabel)) {
    failures.push("noLabel must be an object");
    return;
  }
  if (noLabel.path !== NO_LABEL_DATASET_PATH) failures.push("noLabel.path mismatch");
  if (noLabel.caseCount < THRESHOLDS.noKeywordStructuralPositiveCases) failures.push("noLabel.caseCount below threshold");
  if (noLabel.allNoLabelIds !== true) failures.push("noLabel IDs must stay in the no-label namespace");
  if (noLabel.allScenarioTypesNoKeywordStructural !== true) failures.push("noLabel scenarioType must be no-keyword-structural-positive");
  if (noLabel.noEvidence !== true) failures.push("noLabel evidence arrays must be empty");
  if (noLabel.noPracticeBindings !== true) failures.push("noLabel practiceBindings must be absent");
  if (Array.isArray(noLabel.practiceIdTaskHitCaseIds) && noLabel.practiceIdTaskHitCaseIds.length > 0) failures.push(`noLabel task label leakage present: ${noLabel.practiceIdTaskHitCaseIds.join(",")}`);
  if (noLabel.datasetMetadataViolationCount !== 0) failures.push("noLabel dataset metadata violations must be 0");
  if (noLabel.verified !== true) failures.push("noLabel.verified must be true");
}

function inspectSupport(perPracticeSupport: any, supportSummary: any, failures: string[]): void {
  if (!Array.isArray(perPracticeSupport) || perPracticeSupport.length === 0) {
    failures.push("perPracticeSupport must be a non-empty array");
    return;
  }
  for (const row of perPracticeSupport) {
    if (!(typeof row.practiceId === "string" && row.practiceId.length > 0)) failures.push("perPracticeSupport.practiceId missing");
    if (!(row.expected > 0)) failures.push(`${row.practiceId}: expected support must be positive`);
    if (row.matched < row.expected) failures.push(`${row.practiceId}: matched support below expected`);
  }
  if (!(supportSummary?.practiceCount === perPracticeSupport.length)) failures.push("supportSummary.practiceCount mismatch");
  if (Array.isArray(supportSummary?.incompletePracticeIds) && supportSummary.incompletePracticeIds.length > 0) failures.push(`incomplete practice support present: ${supportSummary.incompletePracticeIds.join(",")}`);
  if (!(supportSummary?.minRecall >= 1)) failures.push("supportSummary.minRecall must be 1");
}

function inspectQualityViolations(qualityViolations: any, failures: string[]): void {
  if (!qualityViolations || typeof qualityViolations !== "object" || Array.isArray(qualityViolations)) {
    failures.push("qualityViolations must be an object");
    return;
  }
  for (const [key, value] of Object.entries(qualityViolations)) {
    if (!Array.isArray(value)) failures.push(`qualityViolations.${key} must be an array`);
    else if (value.length > 0) failures.push(`qualityViolations.${key} must be empty`);
  }
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

function inspectFrozenDataset(root: string, dataset: typeof DATASET_FILES[number]) {
  const text = readFileSync(resolve(root, dataset.path), "utf8");
  const cases = parseJsonl(text);
  return {
    id: dataset.id,
    role: dataset.role,
    path: dataset.path,
    lineCount: text.split(/\r?\n/).filter((line) => line.trim().length > 0).length,
    caseCount: cases.length,
    sha256: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    firstCaseId: String(cases[0]?.id ?? ""),
    lastCaseId: String(cases.at(-1)?.id ?? ""),
    scenarioTypes: uniqueSorted(cases.map((item) => String(item.scenarioType ?? "unknown"))),
    languages: uniqueSorted(cases.map((item) => String(item.language ?? "unknown")))
  };
}

function inspectNoLabelDataset(root: string, result: RepresentativeEvalResult) {
  const text = readFileSync(resolve(root, NO_LABEL_DATASET_PATH), "utf8");
  const cases = parseJsonl(text);
  const evidenceCaseIds = cases
    .filter((item) => Array.isArray(item.evidence) && item.evidence.length > 0)
    .map((item) => String(item.id));
  const practiceBindingCaseIds = cases
    .filter((item) => (item.evidence ?? []).some((evidence: any) => Array.isArray(evidence.practiceBindings) && evidence.practiceBindings.length > 0))
    .map((item) => String(item.id));
  const practiceIdTaskHitCaseIds = cases
    .filter((item) => practiceIdTerms(item).some((term) => String(item.task ?? "").toLowerCase().includes(term)))
    .map((item) => String(item.id));
  const scenarioTypeMismatches = cases
    .filter((item) => item.scenarioType !== "no-keyword-structural-positive")
    .map((item) => String(item.id));
  const idMismatches = cases
    .filter((item) => !String(item.id ?? "").startsWith("practice-no-label-"))
    .map((item) => String(item.id));
  const noEvidence = evidenceCaseIds.length === 0;
  const noPracticeBindings = practiceBindingCaseIds.length === 0;
  const allNoLabelIds = idMismatches.length === 0;
  const allScenarioTypesNoKeywordStructural = scenarioTypeMismatches.length === 0;
  const datasetMetadataViolationCount = result.practices.datasetMetadataViolations.length;
  return {
    path: NO_LABEL_DATASET_PATH,
    sha256: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    caseCount: cases.length,
    threshold: THRESHOLDS.noKeywordStructuralPositiveCases,
    allNoLabelIds,
    idMismatches,
    allScenarioTypesNoKeywordStructural,
    scenarioTypeMismatches,
    noEvidence,
    evidenceCaseIds,
    noPracticeBindings,
    practiceBindingCaseIds,
    practiceIdTaskHitCaseIds,
    datasetMetadataViolationCount,
    recall: result.practices.noKeywordStructuralRecall,
    verified: cases.length >= THRESHOLDS.noKeywordStructuralPositiveCases
      && allNoLabelIds
      && allScenarioTypesNoKeywordStructural
      && noEvidence
      && noPracticeBindings
      && practiceIdTaskHitCaseIds.length === 0
      && datasetMetadataViolationCount === 0
      && result.practices.noKeywordStructuralRecall >= THRESHOLDS.noKeywordStructuralRecall
  };
}

function buildPerPracticeSupport(result: RepresentativeEvalResult): SupportRow[] {
  return result.practices.perPracticeSupport.map((row) => ({
    practiceId: row.practiceId,
    expected: row.expected,
    matched: row.matched,
    recall: round(row.matched / Math.max(1, row.expected)),
    highConfidence: row.highConfidence,
    mediumConfidence: row.mediumConfidence,
    lowConfidence: row.lowConfidence
  }));
}

function summarizeSupport(perPracticeSupport: SupportRow[]) {
  const expectedTotal = perPracticeSupport.reduce((sum, row) => sum + row.expected, 0);
  const matchedTotal = perPracticeSupport.reduce((sum, row) => sum + row.matched, 0);
  const incompletePracticeIds = perPracticeSupport
    .filter((row) => row.matched < row.expected)
    .map((row) => row.practiceId);
  return {
    practiceCount: perPracticeSupport.length,
    expectedTotal,
    matchedTotal,
    minRecall: perPracticeSupport.length === 0 ? 0 : Math.min(...perPracticeSupport.map((row) => row.recall)),
    incompletePracticeIds,
    highConfidenceMatches: perPracticeSupport.reduce((sum, row) => sum + row.highConfidence, 0),
    mediumConfidenceMatches: perPracticeSupport.reduce((sum, row) => sum + row.mediumConfidence, 0),
    lowConfidenceMatches: perPracticeSupport.reduce((sum, row) => sum + row.lowConfidence, 0)
  };
}

function parseJsonl(text: string): Record<string, any>[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function practiceIdTerms(item: Record<string, any>): string[] {
  const expected = Array.isArray(item.expectedPracticeIds) ? item.expectedPracticeIds : [];
  return expected.flatMap((practiceId) => {
    const id = String(practiceId).toLowerCase();
    return [id, id.replace(/[.-]/g, " ")];
  });
}

function renderReport(packet: any): string {
  const metricRows = [
    ["Practice Top-3 recall", percent(packet.metrics.top3Recall), `>= ${percent(THRESHOLDS.practiceTop3Recall)}`],
    ["Recommendation precision@3", percent(packet.metrics.recommendationPrecisionAt3), `>= ${percent(THRESHOLDS.recommendationPrecisionAt3)}`],
    ["No-keyword structural recall", percent(packet.metrics.noKeywordStructuralRecall), `>= ${percent(THRESHOLDS.noKeywordStructuralRecall)}`],
    ["Direct-reference recall", percent(packet.metrics.directPracticeReferenceRecall), `>= ${percent(THRESHOLDS.directPracticeReferenceRecall)}`],
    ["Evidence-shuffle contamination", percent(packet.metrics.evidenceShuffleContaminationRate), percent(THRESHOLDS.evidenceShuffleContaminationRate)],
    ["Heuristic-only hard-gate rate", percent(packet.metrics.heuristicOnlyHardGateRate), percent(THRESHOLDS.heuristicOnlyHardGateRate)],
    ["Dynamic-doc hard-gate rate", percent(packet.metrics.dynamicDocHardGateRate), percent(THRESHOLDS.dynamicDocHardGateRate)]
  ];
  return [
    "# Architecture Ledger AL10 Recommendation Quality Readback",
    "",
    "## Scope",
    "",
    "- Closes: AL10-08 and AL10-BETA-4.",
    "- Keeps open: AL10-09 deterministic-plus-agent comparison, release, runbook, telemetry, governance and GA gates.",
    "- Authority: `evals/run.ts` representative recommendation suite plus frozen JSONL dataset digests.",
    "",
    "## Metrics",
    "",
    "| Metric | Observed | Threshold |",
    "| --- | ---: | ---: |",
    ...metricRows.map(([label, observed, threshold]) => `| ${label} | ${observed} | ${threshold} |`),
    "",
    "## Frozen Datasets",
    "",
    "| Dataset | Cases | SHA-256 |",
    "| --- | ---: | --- |",
    ...packet.frozenDatasets.map((dataset: FrozenDataset) => `| \`${dataset.path}\` | ${dataset.caseCount} | \`${dataset.sha256}\` |`),
    "",
    "## Blind No-Label Set",
    "",
    `- Cases: ${packet.noLabel.caseCount}`,
    `- Evidence arrays empty: ${packet.noLabel.noEvidence}`,
    `- Practice bindings absent: ${packet.noLabel.noPracticeBindings}`,
    `- Task label leakage cases: ${packet.noLabel.practiceIdTaskHitCaseIds.length}`,
    `- Dataset metadata violations: ${packet.noLabel.datasetMetadataViolationCount}`,
    "",
    "## Per-Practice Support",
    "",
    "| Practice | Expected | Matched | Recall | High | Medium | Low |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...packet.perPracticeSupport.map((row: SupportRow) => `| \`${row.practiceId}\` | ${row.expected} | ${row.matched} | ${percent(row.recall)} | ${row.highConfidence} | ${row.mediumConfidence} | ${row.lowConfidence} |`),
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
  if (result.ok) {
    return `[architecture-ledger-al10-recommendation-quality-readback] OK datasets=${result.frozenDatasets} top3=${result.metrics?.top3Recall} precision=${result.metrics?.recommendationPrecisionAt3}`;
  }
  return `[architecture-ledger-al10-recommendation-quality-readback] FAILED\n${result.failures.map((failure: string) => `- ${failure}`).join("\n")}`;
}

function writeJson(path: string, value: unknown): void {
  const resolved = resolve(ROOT, path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(path: string, value: string): void {
  const resolved = resolve(ROOT, path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, value, "utf8");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function sameStringSet(actual: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(actual)) return false;
  return [...new Set(actual)].sort().join(",") === [...expected].sort().join(",");
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}
