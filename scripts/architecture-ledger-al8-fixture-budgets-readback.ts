#!/usr/bin/env bun
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  digestJson,
  type EffectivePracticeAssetV1,
  type Json,
  type PracticeEnforcementPolicyV1,
  type PracticeMatchV1
} from "@archcontext/contracts";
import { loadPracticeCatalog } from "@archcontext/core/practice-catalog";
import {
  evaluatePracticeEnforcement,
  loadPracticeEnforcementPolicy,
  practiceHasCompleteEnforcementFixtureGate
} from "@archcontext/core/practice-engine";
import {
  normalizeRecommendationSchedulerPolicy,
  planRecommendationRun,
  type PlanRecommendationRunInput,
  type RecommendationSchedulerCandidate
} from "@archcontext/core/recommendation-engine";

const ROOT = resolve(import.meta.dir, "..");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al8-fixture-budgets-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al8-fixture-budgets-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al8-fixture-budgets.md";
const GATES = ["AL8-15", "AL8-16"] as const;
const FORBIDDEN_KEYS = new Set(["body", "sourceCode", "sourceBody", "rawSource", "rawDiff", "prompt", "completion"]);

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[architecture-ledger-al8-fixture-budgets-readback] usage: run|inspect [--out path] [--report path] [--evidence path] [--json]");
    process.exit(2);
  }
  const result = command === "run"
    ? await runArchitectureLedgerAl8FixtureBudgetsReadback({
        outPath: readFlag(args, "--out") ?? DEFAULT_OUT,
        reportPath: readFlag(args, "--report") ?? DEFAULT_REPORT
      })
    : inspectArchitectureLedgerAl8FixtureBudgetsReadback(
        JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
      );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export async function runArchitectureLedgerAl8FixtureBudgetsReadback({
  outPath = DEFAULT_OUT,
  reportPath = DEFAULT_REPORT
} = {}) {
  const packet = buildArchitectureLedgerAl8FixtureBudgetsPacket();
  const inspected = inspectArchitectureLedgerAl8FixtureBudgetsReadback(packet);
  const finalPacket = {
    ...packet,
    status: inspected.ok ? "verified" : "blocked",
    failures: inspected.failures
  };
  const finalInspection = inspectArchitectureLedgerAl8FixtureBudgetsReadback(finalPacket);
  const absoluteOut = resolve(ROOT, outPath);
  const absoluteReport = resolve(ROOT, reportPath);
  mkdirSync(dirname(absoluteOut), { recursive: true });
  mkdirSync(dirname(absoluteReport), { recursive: true });
  writeFileSync(absoluteOut, `${JSON.stringify(finalPacket, null, 2)}\n`, "utf8");
  writeFileSync(absoluteReport, renderReport(finalPacket), "utf8");
  return finalInspection;
}

export function buildArchitectureLedgerAl8FixtureBudgetsPacket() {
  const catalog = loadPracticeCatalog({ root: ROOT, includeRepoOverlay: false });
  const completeEligible = catalog.effectiveAssets.filter((entry) => entry.asset.enforcement.promotableTo === "complete");
  const fixtureGateEntries = completeEligible.map((entry) => ({
    practiceId: entry.asset.id,
    assetDigest: entry.assetDigest,
    ready: practiceHasCompleteEnforcementFixtureGate(entry.asset.enforcement.fixtureGate),
    fixtureKinds: Object.fromEntries(
      (["positive", "nearNegative", "mixedChange", "baseline"] as const).map((kind) => [
        kind,
        (entry.asset.enforcement.fixtureGate?.[kind] ?? []).map((fixture) => ({
          id: fixture.id,
          path: fixture.path,
          exists: existsSync(resolve(ROOT, fixture.path))
        }))
      ])
    )
  }));
  const fixtureGate = {
    completeEligibleCount: completeEligible.length,
    readyCount: fixtureGateEntries.filter((entry) => entry.ready).length,
    missingPracticeIds: fixtureGateEntries.filter((entry) => !entry.ready).map((entry) => entry.practiceId),
    missingFixturePaths: fixtureGateEntries.flatMap((entry) =>
      Object.values(entry.fixtureKinds).flatMap((fixtures: any) =>
        fixtures.filter((fixture: any) => fixture.exists !== true).map((fixture: any) => `${entry.practiceId}:${fixture.path}`)
      )
    ),
    entries: fixtureGateEntries
  };
  const enforcementGate = evaluateFixtureGateEnforcement(catalog.effectiveAssets);
  const repoPolicy = loadRepoLocalPolicyFixture();
  const schedulerPlan = planRecommendationRun(schedulerInput({
    policyMode: undefined,
    schedulerPolicy: repoPolicy.recommendations,
    candidates: [
      schedulerCandidate("module.checkout-runtime", 91),
      schedulerCandidate("module.payment-runtime", 88),
      schedulerCandidate("module.reporting-runtime", 52, "medium")
    ]
  }));
  const schedulerBudget = {
    loadedFromRepoPolicy: repoPolicy.recommendations?.budgets?.maxRecommendationsPerRun === 2,
    defaults: normalizeRecommendationSchedulerPolicy(),
    effective: normalizeRecommendationSchedulerPolicy(repoPolicy.recommendations),
    policyMode: schedulerPlan.run.policyMode,
    recommendationCount: schedulerPlan.recommendations.length,
    inputMatchCount: schedulerPlan.run.metrics.matchCount,
    omittedCandidateCount: (schedulerPlan.run.extensions?.schedulerBudget as any)?.omittedCandidateCount,
    l3EligibleCount: schedulerPlan.investigationEligibleRecommendationIds.length,
    l3SuppressedByBudget: schedulerPlan.recommendations.filter((recommendation) => recommendation.extensions?.l3InvestigationSuppressedByBudget === true).length,
    cooldownMs: schedulerPlan.run.extensions?.cooldownMs
  };
  const packet = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status: "verified",
    gates: [...GATES],
    catalog: {
      catalogDigest: catalog.catalogDigest,
      errors: catalog.errors,
      warnings: catalog.warnings
    },
    fixtureGate,
    enforcementGate,
    schedulerBudget,
    privacy: inspectPrivacy({ fixtureGate, enforcementGate, schedulerBudget }),
    assertions: {
      "AL8-15": catalog.errors.length === 0
        && fixtureGate.completeEligibleCount === 8
        && fixtureGate.readyCount === fixtureGate.completeEligibleCount
        && fixtureGate.missingFixturePaths.length === 0
        && enforcementGate.missingGateBlocked === true
        && enforcementGate.readyGateAllowsCheck === true,
      "AL8-16": schedulerBudget.loadedFromRepoPolicy === true
        && schedulerBudget.policyMode === "checkpoint"
        && schedulerBudget.recommendationCount === 2
        && schedulerBudget.inputMatchCount === 3
        && schedulerBudget.omittedCandidateCount === 1
        && schedulerBudget.l3EligibleCount === 1
        && schedulerBudget.l3SuppressedByBudget === 1
        && schedulerBudget.cooldownMs === 1000
    },
    failures: [] as string[]
  };
  return {
    ...packet,
    status: inspectArchitectureLedgerAl8FixtureBudgetsReadback(packet).ok ? "verified" : "blocked"
  };
}

export function inspectArchitectureLedgerAl8FixtureBudgetsReadback(packet: any) {
  const failures: string[] = [];
  if (packet?.schemaVersion !== SCHEMA_VERSION) failures.push("schema-version");
  if (packet?.status !== "verified") failures.push("status-not-verified");
  for (const gate of GATES) {
    if (!packet?.gates?.includes(gate)) failures.push(`gate-missing:${gate}`);
    if (packet?.assertions?.[gate] !== true) failures.push(`${gate} assertion must be true`);
  }
  if (packet?.fixtureGate?.completeEligibleCount !== 8) failures.push("complete-eligible-count");
  if (packet?.fixtureGate?.readyCount !== packet?.fixtureGate?.completeEligibleCount) failures.push("fixture-gate-ready-count");
  if ((packet?.fixtureGate?.missingFixturePaths ?? []).length !== 0) failures.push("fixture-path-missing");
  if (packet?.enforcementGate?.missingGateBlocked !== true) failures.push("missing-fixture-gate-not-blocked");
  if (packet?.enforcementGate?.readyGateAllowsCheck !== true) failures.push("ready-fixture-gate-did-not-run-check");
  if (packet?.schedulerBudget?.loadedFromRepoPolicy !== true) failures.push("repo-local-policy-not-loaded");
  if (packet?.schedulerBudget?.recommendationCount !== 2) failures.push("scheduler-recommendation-budget");
  if (packet?.schedulerBudget?.l3EligibleCount !== 1) failures.push("scheduler-l3-budget");
  if (packet?.privacy?.noForbiddenKeys !== true) failures.push("privacy-forbidden-key");
  return {
    ok: failures.length === 0,
    schemaVersion: `${SCHEMA_VERSION}.inspection`,
    gates: [...GATES],
    failures
  };
}

function evaluateFixtureGateEnforcement(effectiveAssets: EffectivePracticeAssetV1[]) {
  const readyAsset = effectiveAssets.find((entry) => entry.asset.id === "modularity.no-new-cycle")!;
  const assetWithoutGate: EffectivePracticeAssetV1 = {
    ...readyAsset,
    asset: {
      ...readyAsset.asset,
      enforcement: {
        default: "advisory",
        promotableTo: "complete",
        repoOptInRequired: true
      }
    },
    assetDigest: digestJson({ asset: "without-fixture-gate" } as unknown as Json)
  };
  const policy: PracticeEnforcementPolicyV1 = {
    schemaVersion: "archcontext.practice-enforcement-policy/v1",
    mode: "fail-closed",
    rules: [{ practiceId: "modularity.no-new-cycle", enforcement: "complete", checkIds: ["no-new-cycle"] }]
  };
  const previous = cycleMatch(readyAsset.assetDigest, ["module.a->module.b"]);
  const current = cycleMatch(readyAsset.assetDigest, ["module.a->module.b", "module.b->module.a"]);
  const missingGate = evaluatePracticeEnforcement({
    catalog: { catalogDigest: digestJson({ catalog: "missing-gate" } as unknown as Json), effectiveAssets: [assetWithoutGate] },
    policy,
    matches: [cycleMatch(assetWithoutGate.assetDigest, ["module.a->module.b", "module.b->module.a"])],
    previousMatches: [cycleMatch(assetWithoutGate.assetDigest, ["module.a->module.b"])]
  });
  const readyGate = evaluatePracticeEnforcement({
    catalog: { catalogDigest: digestJson({ catalog: "ready-gate" } as unknown as Json), effectiveAssets: [readyAsset] },
    policy,
    matches: [current],
    previousMatches: [previous]
  });
  return {
    missingGateBlocked: missingGate.violations.length === 0
      && missingGate.results[0]?.status === "not_applicable"
      && missingGate.results[0]?.reasonCode === "fixture-gate-missing",
    missingGateReasonCode: missingGate.results[0]?.reasonCode,
    readyGateAllowsCheck: readyGate.violations.length === 1
      && readyGate.violations[0].checkId === "no-new-cycle"
      && readyGate.violations[0].status === "fail",
    readyGateViolationSubjects: readyGate.violations[0]?.subjects ?? []
  };
}

function loadRepoLocalPolicyFixture(): PracticeEnforcementPolicyV1 {
  const root = mkdtempSync(join(tmpdir(), "archctx-al8-fixture-budgets-policy-"));
  try {
    mkdirSync(join(root, ".archcontext/policies"), { recursive: true });
    const policy: PracticeEnforcementPolicyV1 = {
      schemaVersion: "archcontext.practice-enforcement-policy/v1",
      mode: "active",
      recommendations: {
        enabled: true,
        policyMode: "checkpoint",
        frequency: { minIntervalMs: 0, cooldownMs: 1000 },
        budgets: {
          maxRecommendationsPerRun: 2,
          maxL3InvestigationsPerRun: 1,
          maxRunsPerTask: 1,
          maxRunsPerRepositoryPerDay: 2,
          maxRunsPerDay: 4
        }
      },
      rules: []
    };
    writeFileSync(join(root, ".archcontext/policies/practices.yaml"), `${JSON.stringify(policy, null, 2)}\n`, "utf8");
    return loadPracticeEnforcementPolicy(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function schedulerInput(overrides: Partial<PlanRecommendationRunInput> = {}): PlanRecommendationRunInput {
  return {
    repository: {
      repositoryId: "repo.arch-context.al8.fixture-budgets",
      storageRepositoryId: "repo.storage.arch-context.al8.fixture-budgets"
    },
    worktree: {
      workspaceId: "workspace.arch-context.al8.fixture-budgets",
      storageWorkspaceId: "workspace.storage.arch-context.al8.fixture-budgets",
      branch: "codex/architecture-ledger-al8-fixture-budgets",
      headSha: "0123456789abcdef0123456789abcdef01234567",
      worktreeDigest: digestJson({ fixture: "al8-fixture-budgets" } as unknown as Json)
    },
    triggerSource: "checkpoint",
    policyMode: "advisory",
    catalogDigest: digestJson({ fixture: "al8-fixture-budgets-catalog" } as unknown as Json),
    inputCursor: {
      source: "practice-match",
      baseDigest: digestJson({ base: "al8-fixture-budgets" } as unknown as Json),
      headDigest: digestJson({ head: "al8-fixture-budgets" } as unknown as Json),
      headSha: "0123456789abcdef0123456789abcdef01234567",
      changedPathDigest: digestJson({ paths: ["packages/core/practice-catalog/assets/practices"] } as unknown as Json)
    },
    candidates: [],
    now: "2026-06-26T12:00:00.000Z",
    ...overrides
  };
}

function schedulerCandidate(subject: string, score: number, risk: "high" | "medium" = "high"): RecommendationSchedulerCandidate {
  return {
    practiceId: "practice.runtime-boundary",
    subject,
    confidence: risk === "high" ? "low" : "medium",
    enforcement: risk === "high" ? "checkpoint" : "advisory",
    evidenceBindingIds: [`binding.${subject.replace(/[^a-z0-9_.-]/gi, "-")}`],
    explanation: [`${subject} fixture budget candidate.`],
    baselineDigest: digestJson({ baseline: subject } as unknown as Json),
    riskSignals: risk === "high" ? ["persistence-change", "payment-domain-change"] : ["boundary-change"],
    uncertaintySignals: risk === "high" ? ["mapping-ambiguity"] : [],
    score
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

function inspectPrivacy(value: unknown) {
  const hits: string[] = [];
  collectForbiddenKeys(value, "$", hits);
  return {
    noForbiddenKeys: hits.length === 0,
    forbiddenKeyHits: hits
  };
}

function collectForbiddenKeys(value: unknown, path: string, hits: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeys(item, `${path}[${index}]`, hits));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) hits.push(`${path}.${key}`);
    collectForbiddenKeys(entry, `${path}.${key}`, hits);
  }
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function renderHuman(result: { ok: boolean; failures: string[] }) {
  if (result.ok) return "[architecture-ledger-al8-fixture-budgets-readback] OK";
  return ["[architecture-ledger-al8-fixture-budgets-readback] FAILED", ...result.failures.map((failure) => `- ${failure}`)].join("\n");
}

function renderReport(packet: any): string {
  const gateRows = GATES
    .map((gate) => `| ${gate} | ${packet.assertions?.[gate] ? "pass" : "fail"} |`)
    .join("\n");
  return `# AL8 Fixture Gates and Repository Budgets Readback

Date: 2026-06-26

## Scope

This closes AL8-15 and AL8-16: complete-enforcement practices must declare positive, near-negative, mixed-change and baseline fixtures, and repository-local recommendation scheduler frequency/budget configuration is loaded from \`.archcontext/policies/practices.yaml\` with safe defaults.

## P1 Map

The authority boundary stays local. Practice fixture readiness lives on \`PracticeAssetV1.enforcement.fixtureGate\`; repo-local scheduler configuration lives on \`PracticeEnforcementPolicyV1.recommendations\`; complete enforcement is still evaluated by \`@archcontext/core/practice-engine\`; recommendation budget decisions are deterministic in \`@archcontext/core/recommendation-engine\`.

## P2 Traced Path

\`\`\`text
.archcontext/policies/practices.yaml
  -> loadPracticeEnforcementPolicy()
  -> policy.recommendations
  -> planRecommendationRun({ schedulerPolicy })
  -> schedulerBudget readback + capped L3 investigation eligibility

PracticeAssetV1.enforcement.fixtureGate
  -> loadPracticeCatalog()
  -> evaluatePracticeEnforcement()
  -> fixture-gate-missing when complete policy targets an ungated practice
\`\`\`

## P3 Decision

This keeps advisory/repo opt-in semantics intact. Fixture gates do not make a practice complete-gating by themselves; they are a prerequisite before an explicit repo policy can promote the deterministic check. Scheduler budgets only constrain local recommendation volume and L3 eligibility; they do not add a new daemon, database or mutation path.

## Gates

| Gate | Status |
|---|---|
${gateRows}

## Readback

- Complete-eligible practices: ${packet.fixtureGate?.completeEligibleCount}
- Fixture-gate ready practices: ${packet.fixtureGate?.readyCount}
- Missing fixture paths: ${(packet.fixtureGate?.missingFixturePaths ?? []).length}
- Missing gate reason: ${packet.enforcementGate?.missingGateReasonCode}
- Scheduler recommendations emitted: ${packet.schedulerBudget?.recommendationCount}
- Scheduler omitted candidates: ${packet.schedulerBudget?.omittedCandidateCount}
- L3 eligible after budget: ${packet.schedulerBudget?.l3EligibleCount}

## Verification

\`\`\`bash
bun run record:al8:fixture-budgets
bun run readback:al8:fixture-budgets
bun test scripts/architecture-ledger-al8-fixture-budgets-readback.test.ts
bun test packages/core/practice-catalog/test/practice-catalog.test.ts packages/core/practice-engine/test/practice-engine.test.ts packages/core/recommendation-engine/test/recommendation-engine.test.ts packages/contracts/test/contracts.test.ts
bun run typecheck
node scripts/package-boundary-audit.mjs
node scripts/sprint-status-check.mjs
git diff --check
\`\`\`

Readback status: ${packet.status}
`;
}
