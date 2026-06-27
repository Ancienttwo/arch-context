#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  digestJson,
  type ArchitectureRepositoryIdentityV1,
  type ArchitectureWorktreeIdentityV1,
  type Json,
  type PracticeEnforcementPolicyV1,
  type PracticeMatchV1,
  type PracticeWaiverV1,
  type RecommendationV2
} from "@archcontext/contracts";
import { loadPracticeCatalog } from "@archcontext/core/practice-catalog";
import { evaluateInvestigationSpawn } from "@archcontext/core/agent-orchestrator";
import { evaluatePracticeEnforcement, practiceWaiverEvidenceDigest, validatePracticeWaiver } from "@archcontext/core/practice-engine";
import { completeTaskGate } from "@archcontext/core/review-engine";

const ROOT = resolve(import.meta.dir, "..");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al8-waiver-review-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al8-waiver-review-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al8-waiver-review.md";
const RAW_SOURCE_SENTINEL = "AL8_WAIVER_REVIEW_RAW_SOURCE_SENTINEL";
const GATES = ["AL8-09", "AL8-10", "AL8-EG2", "AL8-EG3", "AL8-EG4"] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[architecture-ledger-al8-waiver-review-readback] usage: run|inspect [--out path] [--report path] [--evidence path] [--json]");
    process.exit(2);
  }
  const result = command === "run"
    ? runArchitectureLedgerAl8WaiverReviewReadback({
        outPath: readFlag(args, "--out") ?? DEFAULT_OUT,
        reportPath: readFlag(args, "--report") ?? DEFAULT_REPORT
      })
    : inspectArchitectureLedgerAl8WaiverReviewReadback(
        JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
      );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export function runArchitectureLedgerAl8WaiverReviewReadback({
  outPath = DEFAULT_OUT,
  reportPath = DEFAULT_REPORT
} = {}) {
  const packet = buildArchitectureLedgerAl8WaiverReviewPacket();
  const inspected = inspectArchitectureLedgerAl8WaiverReviewReadback(packet);
  const finalPacket = {
    ...packet,
    status: inspected.ok ? "verified" : "blocked",
    failures: inspected.failures
  };
  const finalInspection = inspectArchitectureLedgerAl8WaiverReviewReadback(finalPacket);
  const absoluteOut = resolve(ROOT, outPath);
  const absoluteReport = resolve(ROOT, reportPath);
  mkdirSync(dirname(absoluteOut), { recursive: true });
  mkdirSync(dirname(absoluteReport), { recursive: true });
  writeFileSync(absoluteOut, `${JSON.stringify(finalPacket, null, 2)}\n`, "utf8");
  writeFileSync(absoluteReport, renderReport(finalPacket), "utf8");
  return finalInspection;
}

export function buildArchitectureLedgerAl8WaiverReviewPacket() {
  const waiver = waiverReadback();
  const recommendationGate = recommendationGateReadback();
  const agentThreshold = agentThresholdReadback();
  const packet = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status: "verified",
    gates: [...GATES],
    waiver,
    recommendationGate,
    agentThreshold
  };
  return {
    ...packet,
    dlp: dlpReadback(packet)
  };
}

export function inspectArchitectureLedgerAl8WaiverReviewReadback(packet: any) {
  const failures: string[] = [];
  if (packet?.schemaVersion !== SCHEMA_VERSION) failures.push("schema-version");
  for (const gate of GATES) {
    if (!packet?.gates?.includes(gate)) failures.push(`gate-missing:${gate}`);
  }
  if (packet?.waiver?.validReviewAt !== "2026-07-10T00:00:00.000Z") failures.push("waiver-review-at-missing");
  if (packet?.waiver?.invalidReviewWindowError !== "practice-waiver-review-window-invalid") failures.push("waiver-review-window-not-enforced");
  if (packet?.waiver?.waivedStatus !== "waived") failures.push("waiver-not-applied");
  if (packet?.waiver?.expiredViolationCount !== 1) failures.push("expired-waiver-not-blocked");
  if (packet?.waiver?.tamperedViolationCount !== 1) failures.push("tampered-waiver-not-blocked");
  if (packet?.waiver?.overscopedViolationCount !== 1) failures.push("overscoped-waiver-not-blocked");
  if (packet?.waiver?.waiverApplicationReviewAt !== "2026-07-10T00:00:00.000Z") failures.push("waiver-application-review-at-missing");
  if (packet?.recommendationGate?.plainAdvisoryResult !== "pass") failures.push("plain-advisory-hard-gated");
  if (packet?.recommendationGate?.advisoryGateResult !== "fail_action_required") failures.push("advisory-gate-not-rejected");
  if (packet?.recommendationGate?.completeMissingEligibilityResult !== "fail_action_required") failures.push("missing-complete-eligibility-not-rejected");
  if (packet?.recommendationGate?.completeEligibleResult !== "pass") failures.push("eligible-complete-recommendation-blocked");
  if (packet?.agentThreshold?.defaultRiskThreshold !== "high") failures.push("agent-risk-threshold-not-high");
  if (packet?.agentThreshold?.defaultUncertaintyThreshold !== "high") failures.push("agent-uncertainty-threshold-not-high");
  if (packet?.agentThreshold?.mediumRiskAllowed !== false) failures.push("medium-risk-agent-allowed");
  if (packet?.agentThreshold?.mediumUncertaintyAllowed !== false) failures.push("medium-uncertainty-agent-allowed");
  if (packet?.agentThreshold?.highRiskHighUncertaintyAllowed !== true) failures.push("high-risk-high-uncertainty-agent-blocked");
  if (packet?.agentThreshold?.policyRequestedMediumAllowed !== true) failures.push("policy-requested-agent-blocked");
  if (packet?.dlp?.containsRawSourceSentinel !== false) failures.push("dlp-raw-source-sentinel");
  if (packet?.dlp?.containsRawDiff !== false) failures.push("dlp-raw-diff");
  return {
    ok: failures.length === 0,
    schemaVersion: `${SCHEMA_VERSION}.inspection`,
    gates: [...GATES],
    failures
  };
}

function waiverReadback() {
  const catalog = loadPracticeCatalog({ root: ROOT });
  const asset = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "modularity.no-new-cycle");
  if (!asset) throw new Error("al8-waiver-readback-missing-practice");
  const policy: PracticeEnforcementPolicyV1 = {
    schemaVersion: "archcontext.practice-enforcement-policy/v1",
    mode: "fail-closed",
    rules: [{ practiceId: "modularity.no-new-cycle", enforcement: "complete", checkIds: ["no-new-cycle"] }]
  };
  const match = cycleMatch(asset.assetDigest, ["module.a->module.b"]);
  const failing = evaluatePracticeEnforcement({
    catalog,
    policy,
    matches: [match],
    previousMatches: [cycleMatch(asset.assetDigest, [])]
  }).violations[0];
  const waiver: PracticeWaiverV1 = {
    schemaVersion: "archcontext.practice-waiver/v1",
    practiceId: failing.practiceId,
    checkId: failing.checkId,
    scope: { subjects: failing.subjects },
    owner: "team-architecture",
    reason: "External migration window requires keeping this edge until the cutover date.",
    createdAt: "2026-06-24T00:00:00.000Z",
    reviewAt: "2026-07-10T00:00:00.000Z",
    expiresAt: "2026-07-24T00:00:00.000Z",
    evidenceDigest: practiceWaiverEvidenceDigest(failing)
  };
  validatePracticeWaiver(waiver);
  let invalidReviewWindowError = "";
  try {
    validatePracticeWaiver({ ...waiver, reviewAt: "2026-07-24T00:00:00.000Z" });
  } catch (error) {
    invalidReviewWindowError = error instanceof Error ? error.message.split(":")[0] : String(error);
  }
  const waived = evaluatePracticeEnforcement({
    catalog,
    policy,
    waivers: [waiver],
    matches: [match],
    previousMatches: [cycleMatch(asset.assetDigest, [])],
    now: "2026-06-25T00:00:00.000Z"
  });
  const expired = evaluatePracticeEnforcement({
    catalog,
    policy,
    waivers: [waiver],
    matches: [match],
    previousMatches: [cycleMatch(asset.assetDigest, [])],
    now: "2026-08-25T00:00:00.000Z"
  });
  const tampered = evaluatePracticeEnforcement({
    catalog,
    policy,
    waivers: [{ ...waiver, evidenceDigest: `sha256:${"0".repeat(64)}` }],
    matches: [match],
    previousMatches: [cycleMatch(asset.assetDigest, [])],
    now: "2026-06-25T00:00:00.000Z"
  });
  const overscoped = evaluatePracticeEnforcement({
    catalog,
    policy,
    waivers: [{ ...waiver, scope: { subjects: ["module.a->module.b", "module.extra->module.scope"] } }],
    matches: [match],
    previousMatches: [cycleMatch(asset.assetDigest, [])],
    now: "2026-06-25T00:00:00.000Z"
  });
  return {
    validReviewAt: waiver.reviewAt,
    invalidReviewWindowError,
    waivedStatus: waived.results[0]?.status,
    waiverApplicationReviewAt: waived.waiversApplied[0]?.reviewAt,
    expiredViolationCount: expired.violations.length,
    tamperedViolationCount: tampered.violations.length,
    overscopedViolationCount: overscoped.violations.length
  };
}

function recommendationGateReadback() {
  const base = completeInput();
  const recommendation = recommendationFixture();
  const plainAdvisory = completeTaskGate({ ...base, recommendations: [recommendation] });
  const advisoryGate = completeTaskGate({
    ...base,
    recommendations: [{ ...recommendation, extensions: { completeStageGate: true } }]
  });
  const completeMissingEligibility = completeTaskGate({
    ...base,
    recommendations: [{ ...recommendation, enforcement: "complete" }]
  });
  const completeEligible = completeTaskGate({
    ...base,
    recommendations: [{
      ...recommendation,
      enforcement: "complete",
      extensions: {
        completeStageEligibility: {
          eligible: true,
          policyDigest: digestJson({ policy: "al8-complete-stage-eligibility" } as unknown as Json)
        }
      }
    }]
  });
  return {
    plainAdvisoryResult: plainAdvisory.result,
    advisoryGateResult: advisoryGate.result,
    advisoryGateFinding: advisoryGate.findings[0]?.id,
    completeMissingEligibilityResult: completeMissingEligibility.result,
    completeMissingEligibilityFinding: completeMissingEligibility.findings[0]?.id,
    completeEligibleResult: completeEligible.result
  };
}

function agentThresholdReadback() {
  const mediumRisk = evaluateInvestigationSpawn({
    ...spawnInput(),
    risk: "medium",
    uncertainty: "high",
    policy: { adapterEnabled: true }
  });
  const mediumUncertainty = evaluateInvestigationSpawn({
    ...spawnInput(),
    risk: "high",
    uncertainty: "medium",
    policy: { adapterEnabled: true }
  });
  const highRiskHighUncertainty = evaluateInvestigationSpawn({
    ...spawnInput(),
    risk: "high",
    uncertainty: "high",
    policy: { adapterEnabled: true }
  });
  const policyRequestedMedium = evaluateInvestigationSpawn({
    ...spawnInput(),
    risk: "medium",
    uncertainty: "medium",
    policyRequestedInvestigation: true,
    policy: { adapterEnabled: true }
  });
  return {
    defaultRiskThreshold: mediumRisk.policy.minimumAutomaticInvestigationRisk,
    defaultUncertaintyThreshold: mediumRisk.policy.minimumAutomaticInvestigationUncertainty,
    mediumRiskAllowed: mediumRisk.allowed,
    mediumRiskReasonCodes: mediumRisk.reasonCodes,
    mediumUncertaintyAllowed: mediumUncertainty.allowed,
    mediumUncertaintyReasonCodes: mediumUncertainty.reasonCodes,
    highRiskHighUncertaintyAllowed: highRiskHighUncertainty.allowed,
    policyRequestedMediumAllowed: policyRequestedMedium.allowed
  };
}

function dlpReadback(packet: unknown) {
  const serialized = JSON.stringify(packet);
  return {
    containsRawSourceSentinel: serialized.includes(RAW_SOURCE_SENTINEL),
    containsRawDiff: serialized.includes("diff --git")
  };
}

function cycleMatch(assetDigest: string, subjects: string[]): PracticeMatchV1 {
  return {
    schemaVersion: "archcontext.practice-match/v1",
    practiceId: "modularity.no-new-cycle",
    assetRevision: 1,
    assetDigest,
    title: "Do not introduce new dependency cycles",
    category: "modularity",
    score: 90,
    confidence: "high",
    enforcement: "checkpoint",
    matchedBy: ["predicate"],
    evidence: subjects.map((subject) => ({
      kind: "import-edge",
      strength: "observed",
      subject,
      digest: digestJson({ subject } as unknown as Json),
      observedAt: "1970-01-01T00:00:00.000Z"
    })),
    explanation: ["cycle fixture"],
    sourceTrust: "curated-static"
  };
}

function completeInput() {
  const sha = `sha256:${"a".repeat(64)}`;
  return {
    taskSessionId: "task.al8-waiver-review",
    posture: "structural" as const,
    headSha: "abc",
    currentHeadSha: "abc",
    worktreeDigest: sha,
    modelDigest: sha,
    codeFactsDigest: sha
  };
}

function recommendationFixture(): RecommendationV2 {
  return {
    schemaVersion: "archcontext.recommendation/v2",
    recommendationId: "rec.al8-review-gate",
    runId: "rec_run.al8-review-gate",
    fingerprint: digestJson({ recommendation: "al8-review-gate" } as unknown as Json),
    subject: "module.checkout",
    practiceId: "runtime.queue-boundary",
    status: "open",
    confidence: "high",
    enforcement: "advisory",
    risk: "high",
    uncertainty: "high",
    evidenceBindingIds: [digestJson({ evidence: "al8-review-gate" } as unknown as Json)],
    explanation: ["High-risk uncertain recommendation fixture."],
    createdAt: "2026-06-26T12:00:00.000Z",
    updatedAt: "2026-06-26T12:00:00.000Z"
  };
}

function spawnInput() {
  const repository: ArchitectureRepositoryIdentityV1 = {
    repositoryId: "repo.al8",
    storageRepositoryId: "storage.repo.al8"
  };
  const worktree: ArchitectureWorktreeIdentityV1 = {
    workspaceId: "workspace.al8",
    storageWorkspaceId: "storage.workspace.al8",
    branch: "main",
    headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    worktreeDigest: digestJson({ worktree: "al8" } as unknown as Json)
  };
  return {
    repository,
    worktree,
    taskSessionId: "task.al8-waiver-review",
    fingerprint: digestJson({ fingerprint: "al8-waiver-review" } as unknown as Json),
    trigger: { source: "checkpoint" as const, reason: "AL8 threshold readback" },
    risk: "high" as const,
    uncertainty: "high" as const,
    deterministicAnalysisFound: true,
    budgetUsage: { taskRuns: 0, repositoryRunsToday: 0, totalRunsToday: 0 },
    now: "2026-06-26T12:00:00.000Z"
  };
}

function renderHuman(result: { ok: boolean; failures: string[] }) {
  if (result.ok) return "architecture-ledger-al8-waiver-review-readback: OK";
  return `architecture-ledger-al8-waiver-review-readback: BLOCKED\n${result.failures.map((failure) => `- ${failure}`).join("\n")}`;
}

function renderReport(packet: any) {
  return [
    "# Architecture Ledger AL8 Waiver Review Readback",
    "",
    `Generated: ${packet.generatedAt}`,
    `Status: ${packet.status}`,
    "",
    "## Gates",
    "",
    ...GATES.map((gate) => `- ${gate}`),
    "",
    "## Evidence",
    "",
    `- Waiver review date: ${packet.waiver.validReviewAt}; invalid window: ${packet.waiver.invalidReviewWindowError}.`,
    `- Waiver application: ${packet.waiver.waivedStatus}; expired/tampered/overscoped violations: ${packet.waiver.expiredViolationCount}/${packet.waiver.tamperedViolationCount}/${packet.waiver.overscopedViolationCount}.`,
    `- Recommendation gate: advisory=${packet.recommendationGate.plainAdvisoryResult}; advisory-hard-gate=${packet.recommendationGate.advisoryGateResult}; complete-without-eligibility=${packet.recommendationGate.completeMissingEligibilityResult}; complete-with-eligibility=${packet.recommendationGate.completeEligibleResult}.`,
    `- Agent threshold: default=${packet.agentThreshold.defaultRiskThreshold}/${packet.agentThreshold.defaultUncertaintyThreshold}; medium-risk=${packet.agentThreshold.mediumRiskAllowed}; medium-uncertainty=${packet.agentThreshold.mediumUncertaintyAllowed}; high/high=${packet.agentThreshold.highRiskHighUncertaintyAllowed}.`,
    `- DLP: raw-source-sentinel=${packet.dlp.containsRawSourceSentinel}; raw-diff=${packet.dlp.containsRawDiff}.`,
    "",
    "## P1 Map",
    "",
    "The module boundary spans practice waiver contracts, runtime/CLI waiver creation, review-engine complete gating, and runtime agent dispatch thresholds.",
    "",
    "## P2 Trace",
    "",
    "A waiver is validated with owner, exact scope, evidence digest, expiry, and review date before practice enforcement can suppress a complete violation. A recommendation reaches complete_task only as context; advisory recommendations remain non-gating, and complete recommendations require explicit policy eligibility. Runtime agent enqueue passes risk and uncertainty through the same context/job boundary before policy evaluation.",
    "",
    "## P3 Decision",
    "",
    "The change keeps durable exceptions and hard gates explicit. Waivers remain ChangeSet-governed files, recommendations do not silently upgrade advisory findings, and automatic L3 agent dispatch defaults to high-risk/high-uncertainty only.",
    ""
  ].join("\n");
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
