import { describe, expect, test } from "bun:test";
import { digestJson, type EffectivePracticeAssetV1, type NormalizedCodeContext, type PracticeEnforcementPolicyV1, type PracticeMatchV1, type PracticeWaiverV1 } from "@archcontext/contracts";
import { loadPracticeCatalog } from "@archcontext/core/practice-catalog";
import { detectArchitecturePressure } from "@archcontext/core/pressure-engine";
import { evaluatePracticeEnforcement, matchPracticesForTask, practiceWaiverEvidenceDigest, validatePracticeEngineCatalog } from "../src/index";

const workspaceRoot = process.cwd();

function structuralCompatibilityContext(): NormalizedCodeContext {
  return {
    task: "remove old compatibility path",
    symbols: [
      { id: "symbol.billingLegacyV1", name: "billingLegacyV1", kind: "public-api", path: "src/billing/legacy-v1.ts" },
      { id: "symbol.billingV2Mapper", name: "billingV2Mapper", kind: "public-api", path: "src/billing/billing-v2-mapper.ts" },
      { id: "symbol.paymentRepository", name: "paymentRepository", kind: "service", path: "src/billing/payment-repository.ts" }
    ],
    edges: [
      { source: "symbol.billingLegacyV1", target: "symbol.billingV2Mapper", kind: "imports", confidence: "high" },
      { source: "symbol.billingV2Mapper", target: "symbol.paymentRepository", kind: "reads", confidence: "high" }
    ],
    evidence: [
      {
        id: "evidence.billing-contract-test",
        selector: { path: "src/billing/legacy-v1.ts", symbolId: "symbol.billingLegacyV1" },
        summary: "verified compatibility caller path",
        confidence: "verified",
        snapshot: {
          repositoryId: "repo.test",
          headSha: "abc",
          worktreeDigest: `sha256:${"c".repeat(64)}`
        }
      }
    ],
    digest: `sha256:${"d".repeat(64)}`
  };
}

function heuristicOnlyContext(): NormalizedCodeContext {
  return {
    task: "update README text mentioning legacy adapter examples",
    symbols: [
      { id: "symbol.docs", name: "legacyAdapterExample", kind: "function", path: "docs/README.md" }
    ],
    edges: [],
    evidence: [],
    digest: `sha256:${"e".repeat(64)}`
  };
}

function completePolicy(practiceId: string, checkId: string): PracticeEnforcementPolicyV1 {
  return {
    schemaVersion: "archcontext.practice-enforcement-policy/v1",
    mode: "active",
    rules: [{ practiceId, enforcement: "complete", checkIds: [checkId] }]
  };
}

function cycleMatch(assetDigest: string, subjects: string[], strength: "heuristic" | "observed" = "observed"): PracticeMatchV1 {
  return {
    schemaVersion: "archcontext.practice-match/v1",
    practiceId: "modularity.no-new-cycle",
    assetRevision: 1,
    assetDigest,
    title: "Do not introduce new dependency cycles",
    category: "modularity",
    score: 90,
    confidence: strength === "heuristic" ? "low" : "high",
    enforcement: strength === "heuristic" ? "advisory" : "checkpoint",
    matchedBy: strength === "heuristic" ? ["retrieval"] : ["predicate"],
    evidence: subjects.map((subject) => ({
      kind: strength === "heuristic" ? "task-text" : "import-edge",
      strength,
      subject,
      digest: digestJson({ subject }),
      observedAt: "1970-01-01T00:00:00.000Z"
    })),
    explanation: ["cycle fixture"],
    sourceTrust: "curated-static"
  };
}

function compatibilityMatch(assetDigest: string): PracticeMatchV1 {
  return {
    schemaVersion: "archcontext.practice-match/v1",
    practiceId: "compatibility.single-owner",
    assetRevision: 1,
    assetDigest,
    title: "Compatibility paths require one lifecycle owner",
    category: "compatibility",
    score: 90,
    confidence: "high",
    enforcement: "checkpoint",
    matchedBy: ["predicate"],
    evidence: [{
      kind: "symbol",
      strength: "observed",
      subject: "symbol.legacyAdapter",
      digest: digestJson({ subject: "symbol.legacyAdapter" }),
      observedAt: "1970-01-01T00:00:00.000Z"
    }],
    explanation: ["compatibility fixture"],
    sourceTrust: "curated-static"
  };
}

describe("@archcontext/core/practice-engine", () => {
  test("matches practices with observed structural evidence and digestable explanations", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const codeContext = structuralCompatibilityContext();
    const pressure = detectArchitecturePressure({
      task: "remove legacy v1 wrapper and fallback mapper with direct db access",
      symbols: codeContext.symbols.flatMap((symbol) => [symbol.id, symbol.name, symbol.kind]),
      files: codeContext.symbols.map((symbol) => symbol.path),
      edges: codeContext.edges,
      observedEvidence: codeContext.evidence
    });

    const guidance = matchPracticesForTask({ task: codeContext.task, catalog, codeContext, pressure, maxMatches: 5 });
    const compatibility = guidance.matches.find((match) => match.practiceId === "compatibility.single-owner");

    expect(guidance.schemaVersion).toBe("archcontext.practice-guidance/v1");
    expect(guidance.catalogDigest).toMatch(/^sha256:/);
    expect(compatibility?.matchedBy).toEqual(expect.arrayContaining(["predicate", "signal"]));
    expect(compatibility?.evidence.some((evidence) => evidence.strength === "observed" || evidence.strength === "verified")).toBe(true);
    expect(compatibility?.enforcement).toBe("checkpoint");
    expect(guidance.resources.some((resource) => resource.uri === "archcontext://practice/compatibility.single-owner@1")).toBe(true);
    expect(guidance.constraints.length).toBeGreaterThan(0);
  });

  test("keeps heuristic-only practice guidance advisory", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const codeContext = heuristicOnlyContext();
    const pressure = detectArchitecturePressure({
      task: codeContext.task,
      symbols: codeContext.symbols.map((symbol) => `${symbol.id} ${symbol.name} ${symbol.kind} ${symbol.path}`),
      files: codeContext.symbols.map((symbol) => symbol.path)
    });

    const guidance = matchPracticesForTask({ task: codeContext.task, catalog, codeContext, pressure, maxMatches: 3 });

    expect(pressure.level).toBe("low");
    expect(pressure.signals.every((signal) => signal.severity !== "high")).toBe(true);
    expect(guidance.matches.every((match) => match.enforcement === "advisory")).toBe(true);
  });

  test("rejects unknown structural predicates instead of silently ignoring them", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const [first] = catalog.effectiveAssets;
    const invalid: EffectivePracticeAssetV1 = {
      ...first,
      asset: {
        ...first.asset,
        triggers: {
          ...first.asset.triggers,
          structuralPredicates: ["unsupported-new-predicate"]
        }
      }
    };

    expect(() => validatePracticeEngineCatalog([invalid])).toThrow("unsupported-new-predicate");
  });

  test("complete enforcement is repo opt-in and advisory when policy is disabled", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const asset = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "modularity.no-new-cycle")!;
    const evaluation = evaluatePracticeEnforcement({
      catalog,
      policy: { schemaVersion: "archcontext.practice-enforcement-policy/v1", mode: "advisory", rules: [] },
      matches: [cycleMatch(asset.assetDigest, ["module.a->module.b"])],
      previousMatches: [cycleMatch(asset.assetDigest, [])]
    });

    expect(evaluation.violations).toEqual([]);
    expect(evaluation.results).toEqual([]);
    expect(evaluation.policyDigest).toMatch(/^sha256:/);
  });

  test("registered complete checker blocks only new cycle evidence", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const asset = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "modularity.no-new-cycle")!;
    const policy = completePolicy("modularity.no-new-cycle", "no-new-cycle");

    const historical = evaluatePracticeEnforcement({
      catalog,
      policy,
      matches: [cycleMatch(asset.assetDigest, ["module.a->module.b"])],
      previousMatches: [cycleMatch(asset.assetDigest, ["module.a->module.b"])]
    });
    const newlyIntroduced = evaluatePracticeEnforcement({
      catalog,
      policy,
      matches: [cycleMatch(asset.assetDigest, ["module.a->module.b", "module.b->module.a"])],
      previousMatches: [cycleMatch(asset.assetDigest, ["module.a->module.b"])]
    });
    const repeated = evaluatePracticeEnforcement({
      catalog,
      policy,
      matches: [cycleMatch(asset.assetDigest, ["module.a->module.b", "module.b->module.a"])],
      previousMatches: [cycleMatch(asset.assetDigest, ["module.a->module.b"])]
    });

    expect(historical.violations).toEqual([]);
    expect(historical.results[0].status).toBe("pass");
    expect(newlyIntroduced.violations).toHaveLength(1);
    expect(newlyIntroduced.violations[0]).toMatchObject({
      practiceId: "modularity.no-new-cycle",
      checkId: "no-new-cycle",
      enforcement: "complete",
      status: "fail",
      deterministic: true,
      subjects: ["module.b->module.a"]
    });
    expect(newlyIntroduced.checkResultDigest).toMatch(/^sha256:/);
    expect(repeated.checkResultDigest).toBe(newlyIntroduced.checkResultDigest);
  });

  test("compatibility contract checker blocks missing durable contract", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const asset = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "compatibility.single-owner")!;
    const evaluation = evaluatePracticeEnforcement({
      catalog,
      policy: completePolicy("compatibility.single-owner", "compatibility-contract-required"),
      matches: [compatibilityMatch(asset.assetDigest)],
      previousMatches: [compatibilityMatch(asset.assetDigest)],
      compatibilityPathIntroduced: true
    });

    expect(evaluation.violations).toHaveLength(1);
    expect(evaluation.violations[0]).toMatchObject({
      practiceId: "compatibility.single-owner",
      checkId: "compatibility-contract-required",
      status: "fail"
    });
  });

  test("heuristic-only matches cannot become complete violations", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const asset = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "modularity.no-new-cycle")!;
    const evaluation = evaluatePracticeEnforcement({
      catalog,
      policy: completePolicy("modularity.no-new-cycle", "no-new-cycle"),
      matches: [cycleMatch(asset.assetDigest, ["legacy cycle wording only"], "heuristic")],
      previousMatches: []
    });

    expect(evaluation.violations).toEqual([]);
    expect(evaluation.results[0]).toMatchObject({ status: "not_applicable", reasonCode: "heuristic-only" });
  });

  test("waivers require exact unexpired evidence digest", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const asset = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "modularity.no-new-cycle")!;
    const policy = completePolicy("modularity.no-new-cycle", "no-new-cycle");
    const failing = evaluatePracticeEnforcement({
      catalog,
      policy,
      matches: [cycleMatch(asset.assetDigest, ["module.a->module.b"])],
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
      expiresAt: "2026-07-24T00:00:00.000Z",
      evidenceDigest: practiceWaiverEvidenceDigest(failing)
    };

    const waived = evaluatePracticeEnforcement({
      catalog,
      policy,
      waivers: [waiver],
      matches: [cycleMatch(asset.assetDigest, ["module.a->module.b"])],
      previousMatches: [cycleMatch(asset.assetDigest, [])],
      now: "2026-06-25T00:00:00.000Z"
    });
    const expired = evaluatePracticeEnforcement({
      catalog,
      policy,
      waivers: [waiver],
      matches: [cycleMatch(asset.assetDigest, ["module.a->module.b"])],
      previousMatches: [cycleMatch(asset.assetDigest, [])],
      now: "2026-08-25T00:00:00.000Z"
    });
    const tampered = evaluatePracticeEnforcement({
      catalog,
      policy,
      waivers: [{ ...waiver, evidenceDigest: `sha256:${"0".repeat(64)}` }],
      matches: [cycleMatch(asset.assetDigest, ["module.a->module.b"])],
      previousMatches: [cycleMatch(asset.assetDigest, [])],
      now: "2026-06-25T00:00:00.000Z"
    });
    const overscoped = evaluatePracticeEnforcement({
      catalog,
      policy,
      waivers: [{ ...waiver, scope: { subjects: [...waiver.scope.subjects!, "module.extra->module.scope"] } }],
      matches: [cycleMatch(asset.assetDigest, ["module.a->module.b"])],
      previousMatches: [cycleMatch(asset.assetDigest, [])],
      now: "2026-06-25T00:00:00.000Z"
    });

    expect(waived.violations).toEqual([]);
    expect(waived.waiversApplied).toHaveLength(1);
    expect(waived.results[0].status).toBe("waived");
    expect(expired.violations).toHaveLength(1);
    expect(tampered.violations).toHaveLength(1);
    expect(overscoped.violations).toHaveLength(1);
  });
});
