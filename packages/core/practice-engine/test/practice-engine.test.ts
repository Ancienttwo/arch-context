import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson, type EffectivePracticeAssetV1, type NormalizedCodeContext, type PracticeEnforcementPolicyV1, type PracticeMatchV1, type PracticeWaiverV1 } from "@archcontext/contracts";
import { loadPracticeCatalog } from "@archcontext/core/practice-catalog";
import { detectArchitecturePressure } from "@archcontext/core/pressure-engine";
import { evaluatePracticeEnforcement, loadPracticeWaiverOwnerRegistry, loadPracticeWaivers, matchPracticesForTask, practiceWaiverEvidenceDigest, validatePracticeEngineCatalog, validatePracticeWaiver } from "../src/index";

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

function dependencyDirectionMatch(assetDigest: string, evidence: Array<{ subject: string; kind?: "architecture-model" | "import-edge" }>): PracticeMatchV1 {
  return {
    schemaVersion: "archcontext.practice-match/v1",
    practiceId: "modularity.respect-dependency-direction",
    assetRevision: 1,
    assetDigest,
    title: "Dependency direction must follow declared layers",
    category: "modularity",
    score: 90,
    confidence: "high",
    enforcement: "checkpoint",
    matchedBy: ["predicate"],
    evidence: evidence.map((item) => ({
      kind: item.kind ?? "import-edge",
      strength: "observed",
      subject: item.subject,
      digest: digestJson({ subject: item.subject }),
      observedAt: "1970-01-01T00:00:00.000Z"
    })),
    explanation: ["dependency direction fixture"],
    sourceTrust: "curated-static"
  };
}

function ownerMatch(assetDigest: string, evidence: Array<{ subject: string; kind?: "architecture-model" | "diff" | "symbol" }>): PracticeMatchV1 {
  return {
    schemaVersion: "archcontext.practice-match/v1",
    practiceId: "ownership.explicit-lifecycle-owner",
    assetRevision: 1,
    assetDigest,
    title: "Governed architecture elements need one lifecycle owner",
    category: "ownership",
    score: 90,
    confidence: "high",
    enforcement: "checkpoint",
    matchedBy: ["predicate"],
    evidence: evidence.map((item) => ({
      kind: item.kind ?? "architecture-model",
      strength: "observed",
      subject: item.subject,
      digest: digestJson({ subject: item.subject }),
      observedAt: "1970-01-01T00:00:00.000Z"
    })),
    explanation: ["ownership fixture"],
    sourceTrust: "curated-static"
  };
}

function migrationMatch(assetDigest: string, evidence: Array<{ subject: string; kind?: "architecture-model" | "diff" | "symbol" }>): PracticeMatchV1 {
  return {
    schemaVersion: "archcontext.practice-match/v1",
    practiceId: "migration.target-and-removal-state",
    assetRevision: 1,
    assetDigest,
    title: "Migration work needs both target state and removal state",
    category: "migration",
    score: 90,
    confidence: "high",
    enforcement: "checkpoint",
    matchedBy: ["predicate"],
    evidence: evidence.map((item) => ({
      kind: item.kind ?? "architecture-model",
      strength: "observed",
      subject: item.subject,
      digest: digestJson({ subject: item.subject }),
      observedAt: "1970-01-01T00:00:00.000Z"
    })),
    explanation: ["migration fixture"],
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

  test("dependency direction checker blocks only explicit new profile-derived violations", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const asset = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "modularity.respect-dependency-direction")!;
    const policy = completePolicy("modularity.respect-dependency-direction", "dependency-direction");
    const historicalSubject = "declared-layer-violation:packages/core->packages/surfaces";
    const newSubject = "boundary-violation:packages/contracts->packages/local-runtime";

    const plainImport = evaluatePracticeEnforcement({
      catalog,
      policy,
      matches: [dependencyDirectionMatch(asset.assetDigest, [{ subject: "symbol.ui->symbol.domain" }])],
      previousMatches: [dependencyDirectionMatch(asset.assetDigest, [])]
    });
    const historical = evaluatePracticeEnforcement({
      catalog,
      policy,
      matches: [dependencyDirectionMatch(asset.assetDigest, [{ subject: historicalSubject, kind: "architecture-model" }])],
      previousMatches: [dependencyDirectionMatch(asset.assetDigest, [{ subject: historicalSubject, kind: "architecture-model" }])]
    });
    const newlyIntroduced = evaluatePracticeEnforcement({
      catalog,
      policy,
      matches: [dependencyDirectionMatch(asset.assetDigest, [
        { subject: historicalSubject, kind: "architecture-model" },
        { subject: newSubject }
      ])],
      previousMatches: [dependencyDirectionMatch(asset.assetDigest, [{ subject: historicalSubject, kind: "architecture-model" }])]
    });
    const noBaseline = evaluatePracticeEnforcement({
      catalog,
      policy,
      matches: [dependencyDirectionMatch(asset.assetDigest, [{ subject: newSubject }])]
    });

    expect(plainImport.violations).toEqual([]);
    expect(plainImport.results[0]).toMatchObject({
      status: "not_applicable",
      reasonCode: "no-violation",
      subjects: []
    });
    expect(historical.violations).toEqual([]);
    expect(historical.results[0]).toMatchObject({
      status: "pass",
      subjects: [historicalSubject]
    });
    expect(newlyIntroduced.violations).toHaveLength(1);
    expect(newlyIntroduced.violations[0]).toMatchObject({
      practiceId: "modularity.respect-dependency-direction",
      checkId: "dependency-direction",
      status: "fail",
      subjects: [newSubject]
    });
    expect(noBaseline.violations).toEqual([]);
    expect(noBaseline.results[0]).toMatchObject({ status: "not_applicable", reasonCode: "no-baseline" });
  });

  test("owner required checker applies only to explicitly governed subjects", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-practice-owner-"));
    try {
      mkdirSync(join(root, ".archcontext/model/nodes"), { recursive: true });
      writeFileSync(join(root, ".archcontext/model/nodes/component.checkout.yaml"), [
        "schemaVersion: archcontext.node/v1",
        "id: component.checkout",
        "kind: component",
        "name: Checkout",
        "status: active",
        "summary: Checkout component.",
        "ownership:",
        "  lifecycle: [\"team-architecture\"]",
        ""
      ].join("\n"), "utf8");
      writeFileSync(join(root, ".archcontext/model/nodes/module.billing.yaml"), [
        "schemaVersion: archcontext.node/v1",
        "id: module.billing",
        "kind: module",
        "name: Billing",
        "status: active",
        "summary: Billing module.",
        ""
      ].join("\n"), "utf8");
      writeFileSync(join(root, ".archcontext/model/nodes/component.split.yaml"), [
        "schemaVersion: archcontext.node/v1",
        "id: component.split",
        "kind: component",
        "name: Split",
        "status: active",
        "summary: Split-owned component.",
        "ownership:",
        "  lifecycle: [\"team-architecture\", \"team-platform\"]",
        ""
      ].join("\n"), "utf8");
      const catalog = loadPracticeCatalog({ root: workspaceRoot });
      const asset = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "ownership.explicit-lifecycle-owner")!;
      const policy = completePolicy("ownership.explicit-lifecycle-owner", "owner-required");
      const ownerRegistry = loadPracticeWaiverOwnerRegistry(root);

      const plainSymbol = evaluatePracticeEnforcement({
        catalog,
        policy,
        ownerRegistry,
        matches: [ownerMatch(asset.assetDigest, [{ kind: "symbol", subject: "symbol.componentCheckout" }])]
      });
      const owned = evaluatePracticeEnforcement({
        catalog,
        policy,
        ownerRegistry,
        matches: [ownerMatch(asset.assetDigest, [{ subject: "governed:component.checkout" }])]
      });
      const missing = evaluatePracticeEnforcement({
        catalog,
        policy,
        ownerRegistry,
        matches: [ownerMatch(asset.assetDigest, [{ subject: "governed:module.billing" }])]
      });
      const split = evaluatePracticeEnforcement({
        catalog,
        policy,
        ownerRegistry,
        matches: [ownerMatch(asset.assetDigest, [{ subject: "governed:component.split" }])]
      });
      const unknownOwner = evaluatePracticeEnforcement({
        catalog,
        policy,
        ownerRegistry,
        matches: [ownerMatch(asset.assetDigest, [
          { subject: "governed:component.reporting" },
          { subject: "lifecycle-owner:component.reporting=unknown-team" }
        ])]
      });
      const selfAttestedOwner = evaluatePracticeEnforcement({
        catalog,
        policy,
        ownerRegistry: { owners: [] },
        matches: [ownerMatch(asset.assetDigest, [
          { subject: "governed:component.reporting" },
          { subject: "lifecycle-owner:component.reporting=team-reporting" }
        ])]
      });

      expect(plainSymbol.violations).toEqual([]);
      expect(plainSymbol.results[0]).toMatchObject({
        status: "not_applicable",
        reasonCode: "no-violation"
      });
      expect(owned.violations).toEqual([]);
      expect(owned.results[0]).toMatchObject({
        status: "pass",
        subjects: ["component.checkout"]
      });
      expect(missing.violations[0]).toMatchObject({
        practiceId: "ownership.explicit-lifecycle-owner",
        checkId: "owner-required",
        status: "fail",
        subjects: ["module.billing"]
      });
      expect(split.violations[0].subjects).toEqual(["component.split"]);
      expect(unknownOwner.violations[0].subjects).toEqual(["component.reporting"]);
      expect(selfAttestedOwner.violations[0].subjects).toEqual(["component.reporting"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("migration checkers require explicit review date and removal condition evidence", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const asset = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "migration.target-and-removal-state")!;
    const policy: PracticeEnforcementPolicyV1 = {
      schemaVersion: "archcontext.practice-enforcement-policy/v1",
      mode: "active",
      rules: [{
        practiceId: "migration.target-and-removal-state",
        enforcement: "complete",
        checkIds: ["migration-review-date", "migration-removal-condition"]
      }]
    };

    const plainSymbol = evaluatePracticeEnforcement({
      catalog,
      policy,
      matches: [migrationMatch(asset.assetDigest, [{ kind: "symbol", subject: "symbol.legacyMigrationAdapter" }])]
    });
    const missingBoth = evaluatePracticeEnforcement({
      catalog,
      policy,
      matches: [migrationMatch(asset.assetDigest, [{ subject: "migration:module.billing-v1-removal" }])]
    });
    const missingRemoval = evaluatePracticeEnforcement({
      catalog,
      policy,
      matches: [migrationMatch(asset.assetDigest, [
        { subject: "migration:module.billing-v1-removal" },
        { subject: "migration-review-date:module.billing-v1-removal=2026-07-31" }
      ])]
    });
    const invalidReviewDate = evaluatePracticeEnforcement({
      catalog,
      policy,
      matches: [migrationMatch(asset.assetDigest, [
        { subject: "migration:module.billing-v1-removal" },
        { subject: "migration-review-date:module.billing-v1-removal=2026-02-31" },
        { subject: "migration-removal-condition:module.billing-v1-removal=all-callers-use-billing-v2" }
      ])]
    });
    const vagueRemoval = evaluatePracticeEnforcement({
      catalog,
      policy,
      matches: [migrationMatch(asset.assetDigest, [
        { subject: "migration:module.billing-v1-removal" },
        { subject: "migration-review-date:module.billing-v1-removal=2026-07-31" },
        { subject: "migration-removal-condition:module.billing-v1-removal=cleanup later" }
      ])]
    });
    const complete = evaluatePracticeEnforcement({
      catalog,
      policy,
      matches: [migrationMatch(asset.assetDigest, [
        { subject: "migration:module.billing-v1-removal" },
        { subject: "migration-review-date:module.billing-v1-removal=2026-07-31" },
        { subject: "migration-removal-condition:module.billing-v1-removal=all-callers-use-billing-v2" }
      ])]
    });

    expect(plainSymbol.violations).toEqual([]);
    expect(plainSymbol.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ checkId: "migration-review-date", status: "not_applicable" }),
      expect.objectContaining({ checkId: "migration-removal-condition", status: "not_applicable" })
    ]));
    expect(missingBoth.violations.map((violation) => violation.checkId)).toEqual(["migration-removal-condition", "migration-review-date"]);
    expect(missingBoth.violations.every((violation) => violation.subjects[0] === "module.billing-v1-removal")).toBe(true);
    expect(missingRemoval.violations.map((violation) => violation.checkId)).toEqual(["migration-removal-condition"]);
    expect(invalidReviewDate.violations.map((violation) => violation.checkId)).toEqual(["migration-review-date"]);
    expect(vagueRemoval.violations.map((violation) => violation.checkId)).toEqual(["migration-removal-condition"]);
    expect(complete.violations).toEqual([]);
    expect(complete.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ checkId: "migration-review-date", status: "pass" }),
      expect.objectContaining({ checkId: "migration-removal-condition", status: "pass" })
    ]));
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

  test("waiver owners must resolve from model ownership registry", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-practice-waiver-"));
    try {
      mkdirSync(join(root, ".archcontext/model/nodes"), { recursive: true });
      mkdirSync(join(root, ".archcontext/waivers"), { recursive: true });
      writeFileSync(join(root, ".archcontext/model/nodes/module.billing.yaml"), [
        "schemaVersion: archcontext.node/v1",
        "id: module.billing",
        "kind: module",
        "name: Billing",
        "status: active",
        "summary: Billing module.",
        "ownership:",
        "  lifecycle:",
        "    - team-architecture",
        "  data: [\"data-platform\"]",
        ""
      ].join("\n"), "utf8");
      const waiver: PracticeWaiverV1 = {
        schemaVersion: "archcontext.practice-waiver/v1",
        practiceId: "modularity.no-new-cycle",
        checkId: "no-new-cycle",
        scope: { subjects: ["module.a->module.b"] },
        owner: "team-architecture",
        reason: "External migration window requires keeping this edge until the upstream cutover is complete.",
        createdAt: "2026-06-24T00:00:00.000Z",
        expiresAt: "2026-07-24T00:00:00.000Z",
        evidenceDigest: `sha256:${"1".repeat(64)}`
      };
      writeFileSync(join(root, ".archcontext/waivers/cycle-waiver.json"), `${JSON.stringify(waiver, null, 2)}\n`, "utf8");

      const registry = loadPracticeWaiverOwnerRegistry(root);

      expect(registry.owners).toEqual(["data-platform", "team-architecture"]);
      expect(registry.subjects).toEqual([{
        subject: "module.billing",
        path: ".archcontext/model/nodes/module.billing.yaml",
        kind: "module",
        lifecycleOwners: ["team-architecture"],
        dataOwners: ["data-platform"]
      }]);
      expect(registry.digest).toMatch(/^sha256:/);
      expect(loadPracticeWaivers(root)).toHaveLength(1);
      expect(() => validatePracticeWaiver({ ...waiver, owner: "unknown-team" }, "cycle-waiver", { allowedOwners: registry.owners })).toThrow("practice-waiver-owner-unknown");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
