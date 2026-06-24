#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { digestJson, type Json } from "@archcontext/contracts";
import { runRepresentativeEval, THRESHOLDS, type RepresentativeEvalResult } from "../evals/run";

const DEFAULT_EVIDENCE = "docs/verification/practice-assets-s6-eval-readback.json";
const PACKET_SCHEMA_VERSION = "archcontext.practice-assets-s6-eval-readback/v1";

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[practice-assets-s6-eval-readback] usage: run|inspect [--out path] [--evidence path] [--json]");
    process.exit(2);
  }

  const result = command === "run"
    ? runPracticeAssetsS6EvalReadback({
      root: process.cwd(),
      outPath: readFlag(args, "--out") ?? readFlag(args, "--evidence") ?? DEFAULT_EVIDENCE
    })
    : inspectPracticeAssetsS6EvalReadbackFile({
      root: process.cwd(),
      evidencePath: readFlag(args, "--evidence") ?? readFlag(args, "--out") ?? DEFAULT_EVIDENCE
    });

  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`[practice-assets-s6-eval-readback] OK positive=${result.positiveCases} negative=${result.negativeCases} adversarial=${result.adversarialCases}`);
  } else {
    console.error("[practice-assets-s6-eval-readback] FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
  }
  if (!result.ok) process.exit(1);
}

export function runPracticeAssetsS6EvalReadback({
  root = process.cwd(),
  outPath = DEFAULT_EVIDENCE
}: {
  root?: string;
  outPath?: string;
} = {}) {
  const packet = buildPracticeAssetsS6EvalReadbackPacket();
  const resolvedOut = resolve(root, outPath);
  mkdirSync(dirname(resolvedOut), { recursive: true });
  writeFileSync(resolvedOut, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  return inspectPracticeAssetsS6EvalReadback(packet);
}

export function inspectPracticeAssetsS6EvalReadbackFile({
  root = process.cwd(),
  evidencePath = DEFAULT_EVIDENCE
}: {
  root?: string;
  evidencePath?: string;
} = {}) {
  const packet = JSON.parse(readFileSync(resolve(root, evidencePath), "utf8"));
  return inspectPracticeAssetsS6EvalReadback(packet);
}

export function buildPracticeAssetsS6EvalReadbackPacket(result: RepresentativeEvalResult = runRepresentativeEval()) {
  const summary = {
    positiveCases: result.practices.positiveCases,
    negativeCases: result.practices.negativeCases,
    adversarialCases: result.practices.adversarialCases,
    totalScenarios: result.practices.totalScenarios,
    chineseCases: result.practices.chineseCases,
    chineseRatio: result.practices.chineseRatio,
    noKeywordStructuralPositiveCases: result.practices.noKeywordStructuralPositiveCases,
    directPracticeReferenceCases: result.practices.directPracticeReferenceCases,
    keywordHeavyBenignNegativeCases: result.practices.keywordHeavyBenignNegativeCases,
    enforcementWaiverAdversarialCases: result.practices.enforcementWaiverAdversarialCases,
    budgetIrrelevantResourceCases: result.practices.budgetIrrelevantResourceCases,
    contextBudgetQueries: result.retrieval.queries,
    top3Recall: result.practices.top3Recall,
    contextConstraintRecall: result.retrieval.constraintRecall,
    contextIrrelevantRatio: result.retrieval.irrelevantRatio,
    benignPrecision: result.practices.benignPrecision,
    noKeywordStructuralRecall: result.practices.noKeywordStructuralRecall,
    directPracticeReferenceRecall: result.practices.directPracticeReferenceRecall,
    heuristicOnlyHardGateRate: result.practices.heuristicOnlyHardGateRate,
    dynamicDocHardGateRate: result.practices.dynamicDocHardGateRate,
    waiverRejectedRate: result.practices.waiverRejectedRate,
    datasetMetadataViolations: result.practices.datasetMetadataViolations,
    prohibitedMatchIds: result.practices.prohibitedMatchIds,
    evidenceMinimumViolations: result.practices.evidenceMinimumViolations,
    enforcementCeilingViolations: result.practices.enforcementCeilingViolations,
    missedPositiveIds: result.practices.missedPositiveIds,
    missedDirectReferenceIds: result.practices.missedDirectReferenceIds,
    negativeNonAdvisoryCaseIds: result.practices.negativeNonAdvisoryCaseIds,
    waiverRejectionMissIds: result.practices.waiverRejectionMissIds,
    hardGateMissIds: result.practices.hardGateMissIds
  };
  const failedGates = result.gates.filter((gate) => !gate.pass);
  const assertions = {
    allEvalGatesPass: result.allPass,
    positiveCaseMinimum: summary.positiveCases >= THRESHOLDS.positivePracticeCases,
    negativeCaseMinimum: summary.negativeCases >= THRESHOLDS.negativePracticeCases,
    chineseScenarioRatio: summary.chineseRatio >= THRESHOLDS.chineseScenarioRatio,
    noKeywordStructuralCaseMinimum: summary.noKeywordStructuralPositiveCases >= THRESHOLDS.noKeywordStructuralPositiveCases,
    directPracticeReferenceCaseMinimum: summary.directPracticeReferenceCases >= THRESHOLDS.directPracticeReferenceCases,
    keywordHeavyBenignCaseMinimum: summary.keywordHeavyBenignNegativeCases >= THRESHOLDS.keywordHeavyBenignNegativeCases,
    enforcementWaiverAdversarialCaseMinimum: summary.enforcementWaiverAdversarialCases >= THRESHOLDS.enforcementWaiverAdversarialCases,
    budgetIrrelevantResourceCaseMinimum: summary.budgetIrrelevantResourceCases >= THRESHOLDS.budgetIrrelevantResourceCases,
    labelsComplete: summary.datasetMetadataViolations.length === 0 && summary.prohibitedMatchIds.length === 0 && summary.evidenceMinimumViolations.length === 0 && summary.enforcementCeilingViolations.length === 0,
    practiceTop3Recall: summary.top3Recall >= THRESHOLDS.practiceTop3Recall,
    contextConstraintRecall: summary.contextConstraintRecall >= THRESHOLDS.contextConstraintRecall,
    contextIrrelevantRatio: summary.contextIrrelevantRatio <= THRESHOLDS.contextIrrelevantRatio,
    benignPrecision: summary.benignPrecision >= THRESHOLDS.benignPrecision,
    noKeywordStructuralRecall: summary.noKeywordStructuralRecall >= THRESHOLDS.noKeywordStructuralRecall,
    directPracticeReferenceRecall: summary.directPracticeReferenceRecall >= THRESHOLDS.directPracticeReferenceRecall,
    heuristicOnlyHardGateRate: summary.heuristicOnlyHardGateRate === THRESHOLDS.heuristicOnlyHardGateRate,
    dynamicDocHardGateRate: summary.dynamicDocHardGateRate === THRESHOLDS.dynamicDocHardGateRate,
    waiverRejectedRate: summary.waiverRejectedRate >= THRESHOLDS.waiverRejectedRate,
    noFailedGates: failedGates.length === 0
  };

  return {
    schemaVersion: PACKET_SCHEMA_VERSION,
    status: Object.values(assertions).every(Boolean) ? "verified" : "failed",
    generatedAt: new Date().toISOString(),
    evalDigest: digestJson({ summary, gates: result.gates, invariant: result.invariant } as unknown as Json),
    summary,
    gates: result.gates,
    failedGates,
    assertions,
    thresholds: THRESHOLDS,
    readback: {
      command: `bun scripts/practice-assets-s6-eval-readback.ts inspect --evidence ${DEFAULT_EVIDENCE} --json`,
      evalCommand: "bun evals/run.ts --check"
    }
  };
}

export function inspectPracticeAssetsS6EvalReadback(packet: any) {
  const failures: string[] = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) return failureResult(["packet must be an object"]);
  if (packet.schemaVersion !== PACKET_SCHEMA_VERSION) failures.push(`schemaVersion must be ${PACKET_SCHEMA_VERSION}`);
  if (packet.status !== "verified") failures.push("status must be verified");
  if (!packet.evalDigest || typeof packet.evalDigest !== "string") failures.push("evalDigest must be present");

  const summary = packet.summary ?? {};
  if (summary.positiveCases < THRESHOLDS.positivePracticeCases) failures.push("summary.positiveCases below S6 minimum");
  if (summary.negativeCases < THRESHOLDS.negativePracticeCases) failures.push("summary.negativeCases below S6 minimum");
  if (summary.chineseRatio < THRESHOLDS.chineseScenarioRatio) failures.push("summary.chineseRatio below S6 minimum");
  if (summary.noKeywordStructuralPositiveCases < THRESHOLDS.noKeywordStructuralPositiveCases) failures.push("summary.noKeywordStructuralPositiveCases below S6 minimum");
  if (summary.directPracticeReferenceCases < THRESHOLDS.directPracticeReferenceCases) failures.push("summary.directPracticeReferenceCases below S6 minimum");
  if (summary.keywordHeavyBenignNegativeCases < THRESHOLDS.keywordHeavyBenignNegativeCases) failures.push("summary.keywordHeavyBenignNegativeCases below S6 minimum");
  if (summary.enforcementWaiverAdversarialCases < THRESHOLDS.enforcementWaiverAdversarialCases) failures.push("summary.enforcementWaiverAdversarialCases below S6 minimum");
  if (summary.budgetIrrelevantResourceCases < THRESHOLDS.budgetIrrelevantResourceCases) failures.push("summary.budgetIrrelevantResourceCases below S6 minimum");
  if (summary.top3Recall < THRESHOLDS.practiceTop3Recall) failures.push("summary.top3Recall below S6 threshold");
  if (summary.contextConstraintRecall < THRESHOLDS.contextConstraintRecall) failures.push("summary.contextConstraintRecall below threshold");
  if (summary.contextIrrelevantRatio > THRESHOLDS.contextIrrelevantRatio) failures.push("summary.contextIrrelevantRatio above threshold");
  if (summary.benignPrecision < THRESHOLDS.benignPrecision) failures.push("summary.benignPrecision below threshold");
  if (summary.noKeywordStructuralRecall < THRESHOLDS.noKeywordStructuralRecall) failures.push("summary.noKeywordStructuralRecall below threshold");
  if (summary.directPracticeReferenceRecall < THRESHOLDS.directPracticeReferenceRecall) failures.push("summary.directPracticeReferenceRecall below threshold");
  if (summary.heuristicOnlyHardGateRate !== THRESHOLDS.heuristicOnlyHardGateRate) failures.push("summary.heuristicOnlyHardGateRate must be 0");
  if (summary.dynamicDocHardGateRate !== THRESHOLDS.dynamicDocHardGateRate) failures.push("summary.dynamicDocHardGateRate must be 0");
  if (summary.waiverRejectedRate < THRESHOLDS.waiverRejectedRate) failures.push("summary.waiverRejectedRate below threshold");
  if (Array.isArray(packet.failedGates) && packet.failedGates.length > 0) failures.push(`failed gates present: ${packet.failedGates.map((gate: any) => gate.target).join(", ")}`);
  inspectAssertions(packet.assertions, failures);

  return {
    ok: failures.length === 0,
    schemaVersion: PACKET_SCHEMA_VERSION,
    positiveCases: summary.positiveCases,
    negativeCases: summary.negativeCases,
    adversarialCases: summary.adversarialCases,
    failures
  };
}

function inspectAssertions(assertions: Record<string, unknown> | undefined, failures: string[]): void {
  if (!assertions || typeof assertions !== "object" || Array.isArray(assertions)) {
    failures.push("assertions must be an object");
    return;
  }
  for (const [key, value] of Object.entries(assertions)) {
    if (value !== true) failures.push(`assertions.${key} must be true`);
  }
}

function failureResult(failures: string[]) {
  return {
    ok: false,
    schemaVersion: PACKET_SCHEMA_VERSION,
    positiveCases: undefined,
    negativeCases: undefined,
    adversarialCases: undefined,
    failures
  };
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}
