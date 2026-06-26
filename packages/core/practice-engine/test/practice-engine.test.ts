import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson, type EffectivePracticeAssetV1, type Json, type NormalizedCodeContext, type PracticeAssetV1, type PracticeEnforcementPolicyV1, type PracticeMatchV1, type PracticeProfileV1, type PracticeWaiverV1 } from "@archcontext/contracts";
import { loadPracticeCatalog } from "@archcontext/core/practice-catalog";
import { detectArchitecturePressure } from "@archcontext/core/pressure-engine";
import { evaluatePracticeEnforcement, loadPracticeWaiverOwnerRegistry, loadPracticeWaivers, matchPracticesForTask, practiceWaiverEvidenceDigest, validatePracticeEnforcementPolicy, validatePracticeEngineCatalog, validatePracticeWaiver } from "../src/index";

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

function derivedPracticeEntry(base: EffectivePracticeAssetV1, asset: PracticeAssetV1): EffectivePracticeAssetV1 {
  return {
    asset,
    assetDigest: digestJson({ asset } as unknown as Json),
    sourceTrust: "curated-static",
    originPath: `test/${asset.id}.json`,
    overrideChain: []
  };
}

function practiceBinding(practiceId: string, triggerId: string, subject?: string) {
  return {
    practiceId,
    triggerId,
    subject,
    provenance: "checkpoint" as const,
    coverage: { level: "complete" as const, scope: "test-context" }
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

function testEvidenceMatch(assetDigest: string, evidence: Array<{ subject: string; kind?: "test" | "runtime-check" | "symbol" | "task-text"; strength?: "heuristic" | "observed" | "verified" }>): PracticeMatchV1 {
  return {
    schemaVersion: "archcontext.practice-match/v1",
    practiceId: "api.contract-before-implementation",
    assetRevision: 1,
    assetDigest,
    title: "API boundary changes should update the contract before implementation",
    category: "api",
    score: 90,
    confidence: "high",
    enforcement: "checkpoint",
    matchedBy: ["predicate"],
    evidence: evidence.map((item) => ({
      kind: item.kind ?? "test",
      strength: item.strength ?? "observed",
      subject: item.subject,
      digest: digestJson({ subject: item.subject }),
      observedAt: "1970-01-01T00:00:00.000Z"
    })),
    explanation: ["test evidence fixture"],
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

  test("filters practice scope by language and includes matching profile practices", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const base = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "compatibility.single-owner")!;
    const scopedAsset = (id: string, title: string, languages: string[] = []): EffectivePracticeAssetV1 => {
      const asset: PracticeAssetV1 = {
        ...base.asset,
        id,
        revision: 1,
        title,
        summary: title,
        category: "scope",
        tags: ["scope", ...languages],
        appliesTo: {
          ...base.asset.appliesTo,
          repositoryKinds: [],
          languages,
          frameworks: [],
          pathGlobs: ["**/*"],
          nodeKinds: ["module"]
        },
        triggers: {
          candidateTerms: [title, ...languages],
          pressureSignals: [],
          structuralPredicates: []
        },
        checks: [],
        enforcement: {
          default: "advisory",
          promotableTo: "advisory",
          repoOptInRequired: true
        }
      };
      return {
        asset,
        assetDigest: digestJson({ asset } as unknown as Json),
        sourceTrust: "curated-static",
        originPath: `test/${id}.yaml`,
        overrideChain: []
      };
    };
    const typescriptAsset = scopedAsset("scope.typescript-only", "TypeScript deployment practice", ["typescript"]);
    const javaAsset = scopedAsset("scope.java-only", "Java deployment practice", ["java"]);
    const profileAsset = scopedAsset("scope.kubernetes-profile", "Kubernetes profile practice");
    const profile: PracticeProfileV1 = {
      schemaVersion: "archcontext.practice-profile/v1",
      id: "profile.kubernetes-test",
      revision: 1,
      status: "active",
      title: "Kubernetes Test",
      repositoryKinds: [],
      languages: [],
      frameworks: ["kubernetes"],
      includePracticeIds: [profileAsset.asset.id],
      excludePracticeIds: [],
      provenance: {
        sourceKind: "archcontext-native",
        sourceRefs: [{ sourceId: "archcontext.spec" }],
        curator: "archcontext-maintainers",
        reviewedAt: "2026-06-24"
      }
    };
    const codeContext: NormalizedCodeContext = {
      task: "update TypeScript Kubernetes service deployment",
      symbols: [{ id: "symbol.service", name: "service", kind: "module", path: "src/service.ts" }],
      edges: [],
      evidence: [],
      digest: `sha256:${"f".repeat(64)}`
    };
    const pressure = detectArchitecturePressure({
      task: codeContext.task,
      symbols: codeContext.symbols.map((symbol) => `${symbol.id} ${symbol.name} ${symbol.kind} ${symbol.path}`),
      files: codeContext.symbols.map((symbol) => symbol.path)
    });

    const guidance = matchPracticesForTask({
      task: codeContext.task,
      catalog: {
        catalogDigest: catalog.catalogDigest,
        overlayDigest: catalog.overlayDigest,
        effectiveAssets: [typescriptAsset, javaAsset, profileAsset],
        profiles: [profile]
      },
      codeContext,
      pressure,
      maxMatches: 5
    });

    expect(guidance.matches.map((match) => match.practiceId)).toContain("scope.typescript-only");
    expect(guidance.matches.map((match) => match.practiceId)).toContain("scope.kubernetes-profile");
    expect(guidance.matches.map((match) => match.practiceId)).not.toContain("scope.java-only");
  });

  test("keeps exact observed practice evidence from being filtered by inferred scope", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const codeContext: NormalizedCodeContext = {
      task: "tighten token scope inside a package module without expanding permissions",
      symbols: [{ id: "symbol.secretModule", name: "secretModule", kind: "module", path: "src/security/token.ts" }],
      edges: [],
      evidence: [{
        id: "evidence.security.least-privilege",
        selector: { path: "src/security/token.ts", symbolId: "symbol.secretModule" },
        summary: "observed security.least-privilege scope expansion risk",
        confidence: "observed",
        practiceBindings: [practiceBinding("security.least-privilege", "permission-expanded")],
        snapshot: {
          repositoryId: "repo.test",
          headSha: "abc",
          worktreeDigest: `sha256:${"a".repeat(64)}`
        }
      }],
      digest: `sha256:${"a".repeat(64)}`
    };
    const pressure = detectArchitecturePressure({
      task: codeContext.task,
      symbols: codeContext.symbols.map((symbol) => `${symbol.id} ${symbol.name} ${symbol.kind} ${symbol.path}`),
      files: codeContext.symbols.map((symbol) => symbol.path),
      observedEvidence: codeContext.evidence
    });

    const guidance = matchPracticesForTask({ task: codeContext.task, catalog, codeContext, pressure, maxMatches: 3 });

    expect(guidance.matches.map((match) => match.practiceId)).toContain("security.least-privilege");
  });

  test("requires typed practice binding before observed context evidence can promote a candidate", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const base = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "compatibility.single-owner")!;
    const asset: PracticeAssetV1 = {
      ...base.asset,
      id: "test.bound-evidence-required",
      title: "Bound evidence required",
      summary: "Bound evidence required for checkpoint promotion",
      category: "test",
      tags: ["bound-evidence"],
      appliesTo: {
        ...base.asset.appliesTo,
        repositoryKinds: [],
        pathGlobs: ["src/**"],
        nodeKinds: ["module"],
        negativePathGlobs: []
      },
      triggers: {
        candidateTerms: ["bound-evidence"],
        pressureSignals: [],
        structuralPredicates: []
      },
      evidencePolicy: {
        ...base.asset.evidencePolicy,
        minimumStrengthForRecommendation: "observed",
        minimumStrengthForCheckpoint: "observed"
      },
      enforcement: {
        default: "advisory",
        promotableTo: "checkpoint",
        repoOptInRequired: true
      }
    };
    const entry = derivedPracticeEntry(base, asset);
    const codeContext: NormalizedCodeContext = {
      task: "apply bound-evidence practice",
      symbols: [{ id: "symbol.service", name: "service", kind: "module", path: "src/service.ts" }],
      edges: [],
      evidence: [{
        id: "evidence.test.bound-evidence-required",
        selector: { path: "src/service.ts", symbolId: "symbol.service" },
        summary: "observed test.bound-evidence-required applicability",
        confidence: "observed",
        snapshot: {
          repositoryId: "repo.test",
          headSha: "abc",
          worktreeDigest: `sha256:${"2".repeat(64)}`
        }
      }],
      digest: `sha256:${"2".repeat(64)}`
    };
    const pressure = detectArchitecturePressure({
      task: codeContext.task,
      symbols: codeContext.symbols.map((symbol) => `${symbol.id} ${symbol.name} ${symbol.kind} ${symbol.path}`),
      files: codeContext.symbols.map((symbol) => symbol.path),
      observedEvidence: codeContext.evidence
    });
    const unbound = matchPracticesForTask({
      task: codeContext.task,
      catalog: { catalogDigest: catalog.catalogDigest, overlayDigest: catalog.overlayDigest, effectiveAssets: [entry] },
      codeContext,
      pressure,
      maxMatches: 3
    });
    const incompleteBindingContext: NormalizedCodeContext = {
      ...codeContext,
      evidence: [{
        ...codeContext.evidence[0],
        practiceBindings: [{ practiceId: asset.id, triggerId: "legacy-binding" } as any]
      }]
    };
    const incomplete = matchPracticesForTask({
      task: incompleteBindingContext.task,
      catalog: { catalogDigest: catalog.catalogDigest, overlayDigest: catalog.overlayDigest, effectiveAssets: [entry] },
      codeContext: incompleteBindingContext,
      pressure,
      maxMatches: 3
    });
    const boundContext: NormalizedCodeContext = {
      ...codeContext,
      evidence: [{
        ...codeContext.evidence[0],
        practiceBindings: [practiceBinding(asset.id, "unit-test")]
      }]
    };
    const bound = matchPracticesForTask({
      task: boundContext.task,
      catalog: { catalogDigest: catalog.catalogDigest, overlayDigest: catalog.overlayDigest, effectiveAssets: [entry] },
      codeContext: boundContext,
      pressure,
      maxMatches: 3
    });

    expect(unbound.matches.map((match) => match.practiceId)).not.toContain(asset.id);
    expect(incomplete.matches.map((match) => match.practiceId)).not.toContain(asset.id);
    expect(bound.matches.find((match) => match.practiceId === asset.id)).toMatchObject({
      enforcement: "checkpoint"
    });
  });

  test("filters negative scopes per subject instead of suppressing mixed source and test changes", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const asset = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "compatibility.single-owner")!;
    const mixedContext: NormalizedCodeContext = {
      task: "remove legacy v1 wrapper and update matching test fixture",
      symbols: [
        { id: "symbol.billingLegacyV1", name: "billingLegacyV1", kind: "public-api", path: "src/billing/legacy-v1.ts" },
        { id: "symbol.billingLegacyTest", name: "billingLegacyTest", kind: "function", path: "test/billing/legacy-v1.test.ts" }
      ],
      edges: [],
      evidence: [],
      digest: `sha256:${"3".repeat(64)}`
    };
    const testOnlyContext: NormalizedCodeContext = {
      ...mixedContext,
      symbols: [{ id: "symbol.billingLegacyTest", name: "billingLegacyTest", kind: "function", path: "test/billing/legacy-v1.test.ts" }],
      digest: `sha256:${"4".repeat(64)}`
    };
    const match = (codeContext: NormalizedCodeContext) => {
      const pressure = detectArchitecturePressure({
        task: codeContext.task,
        symbols: codeContext.symbols.map((symbol) => `${symbol.id} ${symbol.name} ${symbol.kind} ${symbol.path}`),
        files: codeContext.symbols.map((symbol) => symbol.path)
      });
      return matchPracticesForTask({
        task: codeContext.task,
        catalog: { catalogDigest: catalog.catalogDigest, overlayDigest: catalog.overlayDigest, effectiveAssets: [asset] },
        codeContext,
        pressure,
        maxMatches: 3
      });
    };

    expect(match(mixedContext).matches.map((item) => item.practiceId)).toContain("compatibility.single-owner");
    expect(match(testOnlyContext).matches.map((item) => item.practiceId)).not.toContain("compatibility.single-owner");
  });

  test("plain import edges do not prove declared layer violations during recommendation", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const asset = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "modularity.respect-dependency-direction")!;
    const codeContext: NormalizedCodeContext = {
      task: "repair dependency direction after module import change",
      symbols: [
        { id: "symbol.domainModel", name: "domainModel", kind: "module", path: "packages/domain/model.ts" },
        { id: "symbol.adapterClient", name: "adapterClient", kind: "module", path: "packages/adapter/client.ts" }
      ],
      edges: [{ source: "symbol.domainModel", target: "symbol.adapterClient", kind: "imports", confidence: "high" }],
      evidence: [],
      digest: `sha256:${"5".repeat(64)}`
    };
    const pressure = detectArchitecturePressure({
      task: codeContext.task,
      symbols: codeContext.symbols.map((symbol) => `${symbol.id} ${symbol.name} ${symbol.kind} ${symbol.path}`),
      files: codeContext.symbols.map((symbol) => symbol.path),
      edges: codeContext.edges
    });

    const guidance = matchPracticesForTask({
      task: codeContext.task,
      catalog: { catalogDigest: catalog.catalogDigest, overlayDigest: catalog.overlayDigest, effectiveAssets: [asset] },
      codeContext,
      pressure,
      maxMatches: 3
    });

    expect(guidance.matches.map((match) => match.practiceId)).not.toContain("modularity.respect-dependency-direction");
  });

  test("unproved absence evidence keeps telemetry recommendations advisory", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const asset = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "observability.boundary-telemetry")!;
    const codeContext: NormalizedCodeContext = {
      task: "add worker queue runtime boundary",
      symbols: [{ id: "symbol.invoiceWorker", name: "invoiceWorker", kind: "service", path: "src/workers/invoice-worker.ts" }],
      edges: [],
      evidence: [],
      digest: `sha256:${"6".repeat(64)}`
    };
    const pressure = detectArchitecturePressure({
      task: codeContext.task,
      symbols: codeContext.symbols.map((symbol) => `${symbol.id} ${symbol.name} ${symbol.kind} ${symbol.path}`),
      files: codeContext.symbols.map((symbol) => symbol.path)
    });

    const guidance = matchPracticesForTask({
      task: codeContext.task,
      catalog: { catalogDigest: catalog.catalogDigest, overlayDigest: catalog.overlayDigest, effectiveAssets: [asset] },
      codeContext,
      pressure,
      maxMatches: 3
    });
    const match = guidance.matches.find((item) => item.practiceId === "observability.boundary-telemetry");

    expect(match?.enforcement).toBe("advisory");
    expect(match?.evidence).toContainEqual(expect.objectContaining({
      kind: "runtime-check",
      strength: "heuristic",
      subject: "unproven-absence:telemetry|trace|metric|log"
    }));
    expect(match?.evidence).not.toContainEqual(expect.objectContaining({
      kind: "runtime-check",
      strength: "observed",
      subject: "missing:telemetry|trace|metric|log"
    }));

    const typedAbsenceContext: NormalizedCodeContext = {
      ...codeContext,
      evidence: [{
        id: "evidence.telemetry-absence-complete",
        selector: { path: "src/workers/invoice-worker.ts", symbolId: "symbol.invoiceWorker" },
        summary: "complete telemetry absence probe for invoice worker",
        confidence: "observed",
        polarity: "absence",
        coverage: { level: "complete", scope: "src/workers/invoice-worker.ts" },
        supports: ["recommendation", "checkpoint"],
        practiceBindings: [practiceBinding("observability.boundary-telemetry", "telemetry-evidence-missing")],
        snapshot: {
          repositoryId: "repo.test",
          headSha: "abc",
          worktreeDigest: `sha256:${"6".repeat(64)}`
        }
      }]
    };
    const partialAbsenceContext: NormalizedCodeContext = {
      ...typedAbsenceContext,
      evidence: [{
        ...typedAbsenceContext.evidence[0],
        id: "evidence.telemetry-absence-partial",
        coverage: { level: "partial", scope: "src/workers/invoice-worker.ts" }
      }]
    };
    const matchWithContext = (context: NormalizedCodeContext) => matchPracticesForTask({
      task: context.task,
      catalog: { catalogDigest: catalog.catalogDigest, overlayDigest: catalog.overlayDigest, effectiveAssets: [asset] },
      codeContext: context,
      pressure,
      maxMatches: 3
    }).matches.find((item) => item.practiceId === "observability.boundary-telemetry");
    const completeAbsence = matchWithContext(typedAbsenceContext);
    const partialAbsence = matchWithContext(partialAbsenceContext);

    expect(completeAbsence?.enforcement).toBe("checkpoint");
    expect(completeAbsence?.evidence).toContainEqual(expect.objectContaining({
      kind: "runtime-check",
      strength: "observed",
      subject: "absence:telemetry-evidence-missing:symbol.invoiceWorker"
    }));
    expect(partialAbsence?.enforcement).toBe("advisory");
    expect(partialAbsence?.evidence).not.toContainEqual(expect.objectContaining({
      strength: "observed",
      subject: "absence:telemetry-evidence-missing:symbol.invoiceWorker"
    }));
  });

  test("detects import cycles longer than two nodes", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const asset = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "modularity.no-new-cycle")!;
    const codeContext: NormalizedCodeContext = {
      task: "stop dependency cycle in package graph",
      symbols: [
        { id: "symbol.cycleA", name: "cycleA", kind: "module", path: "packages/a/src/index.ts" },
        { id: "symbol.cycleB", name: "cycleB", kind: "module", path: "packages/b/src/index.ts" },
        { id: "symbol.cycleC", name: "cycleC", kind: "module", path: "packages/c/src/index.ts" }
      ],
      edges: [
        { source: "symbol.cycleA", target: "symbol.cycleB", kind: "imports", confidence: "high" },
        { source: "symbol.cycleB", target: "symbol.cycleC", kind: "imports", confidence: "high" },
        { source: "symbol.cycleC", target: "symbol.cycleA", kind: "imports", confidence: "high" }
      ],
      evidence: [],
      digest: `sha256:${"7".repeat(64)}`
    };
    const pressure = detectArchitecturePressure({
      task: codeContext.task,
      symbols: codeContext.symbols.map((symbol) => `${symbol.id} ${symbol.name} ${symbol.kind} ${symbol.path}`),
      files: codeContext.symbols.map((symbol) => symbol.path),
      edges: codeContext.edges
    });

    const guidance = matchPracticesForTask({
      task: codeContext.task,
      catalog: { catalogDigest: catalog.catalogDigest, overlayDigest: catalog.overlayDigest, effectiveAssets: [asset] },
      codeContext,
      pressure,
      maxMatches: 3
    });
    const match = guidance.matches.find((item) => item.practiceId === "modularity.no-new-cycle");

    expect(match?.evidence).toContainEqual(expect.objectContaining({
      kind: "import-edge",
      strength: "observed",
      subject: "cycle:symbol.cycleA->symbol.cycleB->symbol.cycleC->symbol.cycleA"
    }));
  });

  test("splits generic import-edge evidence from typed boundary violation predicates", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const base = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "modularity.no-new-cycle")!;
    const dependencyDirectionBase = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "modularity.respect-dependency-direction")!;
    const dependencyDirection = derivedPracticeEntry(dependencyDirectionBase, {
      ...dependencyDirectionBase.asset,
      triggers: {
        ...dependencyDirectionBase.asset.triggers,
        pressureSignals: []
      }
    });
    const importEdgeAsset = derivedPracticeEntry(base, {
      ...base.asset,
      id: "test.import-edge-added",
      title: "Import edge added",
      summary: "Import edge added",
      appliesTo: {
        ...base.asset.appliesTo,
        repositoryKinds: [],
        pathGlobs: ["src/**"],
        nodeKinds: ["module"],
        negativePathGlobs: []
      },
      triggers: {
        candidateTerms: ["import"],
        pressureSignals: [],
        structuralPredicates: ["import-edge-added"]
      },
      evidencePolicy: {
        ...base.asset.evidencePolicy,
        minimumStrengthForRecommendation: "observed",
        minimumStrengthForCheckpoint: "observed"
      }
    });
    const codeContext: NormalizedCodeContext = {
      task: "enforce declared layer import boundary",
      symbols: [
        { id: "symbol.ui", name: "ui", kind: "module", path: "src/ui.ts" },
        { id: "symbol.persistence", name: "persistence", kind: "module", path: "src/persistence.ts" }
      ],
      edges: [
        { source: "symbol.ui", target: "symbol.persistence", kind: "imports", confidence: "high" },
        { source: "declared-layer-violation:symbol.ui", target: "symbol.persistence", kind: "imports", confidence: "high" }
      ],
      evidence: [],
      digest: `sha256:${"8".repeat(64)}`
    };
    const pressure = detectArchitecturePressure({
      task: codeContext.task,
      symbols: codeContext.symbols.map((symbol) => `${symbol.id} ${symbol.name} ${symbol.kind} ${symbol.path}`),
      files: codeContext.symbols.map((symbol) => symbol.path),
      edges: codeContext.edges
    });

    const guidance = matchPracticesForTask({
      task: codeContext.task,
      catalog: {
        catalogDigest: catalog.catalogDigest,
        overlayDigest: catalog.overlayDigest,
        effectiveAssets: [dependencyDirection, importEdgeAsset]
      },
      codeContext,
      pressure,
      maxMatches: 5
    });
    const generic = guidance.matches.find((match) => match.practiceId === "test.import-edge-added");
    const typed = guidance.matches.find((match) => match.practiceId === "modularity.respect-dependency-direction");

    expect(generic?.evidence).toContainEqual(expect.objectContaining({
      kind: "import-edge",
      strength: "observed",
      subject: "symbol.ui->symbol.persistence"
    }));
    expect(typed?.evidence).toContainEqual(expect.objectContaining({
      kind: "import-edge",
      strength: "observed",
      subject: "declared-layer-violation:symbol.ui->symbol.persistence"
    }));
    expect(typed?.evidence).not.toContainEqual(expect.objectContaining({
      subject: "symbol.ui->symbol.persistence"
    }));
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
    expect(evaluation.nonBlockingViolations).toEqual([]);
    expect(evaluation.results).toEqual([]);
    expect(evaluation.policyMode).toBe("advisory");
    expect(evaluation.blocking).toBe(false);
    expect(evaluation.policyDigest).toMatch(/^sha256:/);
  });

  test("explicit fail-open evaluates complete checks without blocking completion", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const asset = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "modularity.no-new-cycle")!;
    const policy: PracticeEnforcementPolicyV1 = {
      ...completePolicy("modularity.no-new-cycle", "no-new-cycle"),
      mode: "fail-open"
    };
    const evaluation = evaluatePracticeEnforcement({
      catalog,
      policy,
      matches: [cycleMatch(asset.assetDigest, ["module.a->module.b", "module.b->module.a"])],
      previousMatches: [cycleMatch(asset.assetDigest, ["module.a->module.b"])]
    });

    expect(evaluation.policyMode).toBe("fail-open");
    expect(evaluation.blocking).toBe(false);
    expect(evaluation.results).toHaveLength(1);
    expect(evaluation.results[0].status).toBe("fail");
    expect(evaluation.violations).toEqual([]);
    expect(evaluation.nonBlockingViolations).toHaveLength(1);
    expect(evaluation.actionsRequired).toEqual([]);
  });

  test("explicit fail-closed blocks complete on deterministic violations", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const asset = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "modularity.no-new-cycle")!;
    const policy: PracticeEnforcementPolicyV1 = {
      ...completePolicy("modularity.no-new-cycle", "no-new-cycle"),
      mode: "fail-closed"
    };
    const evaluation = evaluatePracticeEnforcement({
      catalog,
      policy,
      matches: [cycleMatch(asset.assetDigest, ["module.a->module.b", "module.b->module.a"])],
      previousMatches: [cycleMatch(asset.assetDigest, ["module.a->module.b"])]
    });

    expect(evaluation.policyMode).toBe("fail-closed");
    expect(evaluation.blocking).toBe(true);
    expect(evaluation.violations).toHaveLength(1);
    expect(evaluation.nonBlockingViolations).toEqual([]);
    expect(evaluation.actionsRequired).toEqual(["remove-new-import-cycle-or-add-a-more-specific-boundary"]);
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

  test("required test evidence checker only enforces policy-declared test proof", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const asset = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "api.contract-before-implementation")!;
    const withoutTestEvidence = completePolicy("api.contract-before-implementation", "required-test-evidence");
    const withTestEvidence: PracticeEnforcementPolicyV1 = {
      schemaVersion: "archcontext.practice-enforcement-policy/v1",
      mode: "active",
      rules: [{
        practiceId: "api.contract-before-implementation",
        enforcement: "complete",
        checkIds: ["required-test-evidence"],
        testEvidence: {
          commands: ["bun test packages/api-contract.test.ts"],
          subjects: ["schema.public-api"]
        }
      }]
    };

    const noPolicyRequirement = evaluatePracticeEnforcement({
      catalog,
      policy: withoutTestEvidence,
      matches: [testEvidenceMatch(asset.assetDigest, [{ kind: "symbol", subject: "symbol.publicApiChanged" }])]
    });
    const missing = evaluatePracticeEnforcement({
      catalog,
      policy: withTestEvidence,
      matches: [testEvidenceMatch(asset.assetDigest, [
        { kind: "symbol", subject: "symbol.publicApiChanged" },
        { kind: "task-text", strength: "heuristic", subject: "ran bun test packages/api-contract.test.ts" }
      ])]
    });
    const partial = evaluatePracticeEnforcement({
      catalog,
      policy: withTestEvidence,
      matches: [testEvidenceMatch(asset.assetDigest, [
        { subject: "test-command:bun test packages/api-contract.test.ts" }
      ])]
    });
    const complete = evaluatePracticeEnforcement({
      catalog,
      policy: withTestEvidence,
      matches: [testEvidenceMatch(asset.assetDigest, [
        { subject: "test-command:bun test packages/api-contract.test.ts" },
        { kind: "runtime-check", strength: "verified", subject: "test-evidence:schema.public-api" }
      ])]
    });

    expect(noPolicyRequirement.violations).toEqual([]);
    expect(noPolicyRequirement.results[0]).toMatchObject({
      checkId: "required-test-evidence",
      status: "not_applicable"
    });
    expect(missing.violations[0].subjects).toEqual([
      "test-command:bun test packages/api-contract.test.ts",
      "test-evidence:schema.public-api"
    ]);
    expect(partial.violations[0].subjects).toEqual(["test-evidence:schema.public-api"]);
    expect(complete.violations).toEqual([]);
    expect(complete.results[0]).toMatchObject({
      checkId: "required-test-evidence",
      status: "pass"
    });
  });

  test("practice policy test evidence declaration is explicit and non-empty", () => {
    const policy: PracticeEnforcementPolicyV1 = {
      schemaVersion: "archcontext.practice-enforcement-policy/v1",
      mode: "active",
      rules: [{
        practiceId: "api.contract-before-implementation",
        enforcement: "complete",
        checkIds: ["required-test-evidence"],
        testEvidence: {
          commands: ["bun test packages/api-contract.test.ts"],
          subjects: ["schema.public-api"]
        }
      }]
    };
    expect(validatePracticeEnforcementPolicy(policy)).toBe(policy);
    for (const mode of ["advisory", "active", "fail-open", "fail-closed"] as const) {
      expect(validatePracticeEnforcementPolicy({ ...policy, mode } as PracticeEnforcementPolicyV1).mode).toBe(mode);
    }
    expect(() => validatePracticeEnforcementPolicy({
      ...policy,
      mode: "enforce" as any
    })).toThrow("practice-policy-mode-invalid");
    expect(() => validatePracticeEnforcementPolicy({
      ...policy,
      rules: [{ ...policy.rules[0], testEvidence: { commands: [], subjects: [] } }]
    })).toThrow("practice-policy-test-evidence-required");
    expect(() => validatePracticeEnforcementPolicy({
      ...policy,
      rules: [{ ...policy.rules[0], testEvidence: { commands: ["bun test\nrm -rf tmp"] } }]
    })).toThrow("practice-policy-test-command-invalid");
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
      reviewAt: "2026-07-10T00:00:00.000Z",
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
    expect(() => validatePracticeWaiver({ ...waiver, reviewAt: "2026-07-24T00:00:00.000Z" })).toThrow(
      "practice-waiver-review-window-invalid"
    );
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
        reviewAt: "2026-07-10T00:00:00.000Z",
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

  test("recommendations follow the typed practice binding, not stale label text in evidence", () => {
    const catalog = loadPracticeCatalog({ root: workspaceRoot });
    const base = catalog.effectiveAssets.find((candidate) => candidate.asset.id === "compatibility.single-owner")!;
    const derive = (id: string): EffectivePracticeAssetV1 => {
      const asset: PracticeAssetV1 = {
        ...base.asset,
        id,
        title: id,
        summary: id,
        category: "test",
        tags: [id],
        appliesTo: {
          ...base.asset.appliesTo,
          repositoryKinds: [],
          pathGlobs: ["src/**"],
          nodeKinds: ["module"],
          negativePathGlobs: []
        },
        triggers: {
          candidateTerms: ["governed", id],
          pressureSignals: [],
          structuralPredicates: []
        },
        evidencePolicy: {
          ...base.asset.evidencePolicy,
          minimumStrengthForRecommendation: "observed",
          minimumStrengthForCheckpoint: "observed"
        },
        enforcement: {
          default: "advisory",
          promotableTo: "checkpoint",
          repoOptInRequired: true
        }
      };
      return derivedPracticeEntry(base, asset);
    };
    // Both assets are retrieval candidates (shared "governed" term). The context evidence's
    // free-text summary/id names `labelled`, but its typed binding points at `bound-target`.
    // A string-match matcher would promote `labelled`; a binding-driven matcher must not.
    const labelled = derive("test.labelled-but-unbound");
    const boundTarget = derive("test.bound-target");
    const codeContext: NormalizedCodeContext = {
      task: "apply governed module change",
      symbols: [{ id: "symbol.service", name: "service", kind: "module", path: "src/service.ts" }],
      edges: [],
      evidence: [{
        id: "evidence.test.labelled-but-unbound",
        selector: { path: "src/service.ts", symbolId: "symbol.service" },
        summary: "observed test.labelled-but-unbound applicability",
        confidence: "observed",
        practiceBindings: [practiceBinding("test.bound-target", "unit-test")],
        snapshot: {
          repositoryId: "repo.test",
          headSha: "abc",
          worktreeDigest: `sha256:${"9".repeat(64)}`
        }
      }],
      digest: `sha256:${"9".repeat(64)}`
    };
    const pressure = detectArchitecturePressure({
      task: codeContext.task,
      symbols: codeContext.symbols.map((symbol) => `${symbol.id} ${symbol.name} ${symbol.kind} ${symbol.path}`),
      files: codeContext.symbols.map((symbol) => symbol.path),
      observedEvidence: codeContext.evidence
    });

    const guidance = matchPracticesForTask({
      task: codeContext.task,
      catalog: { catalogDigest: catalog.catalogDigest, overlayDigest: catalog.overlayDigest, effectiveAssets: [labelled, boundTarget] },
      codeContext,
      pressure,
      maxMatches: 5
    });
    const ids = guidance.matches.map((match) => match.practiceId);

    expect(ids).toContain("test.bound-target");
    expect(ids).not.toContain("test.labelled-but-unbound");
    expect(guidance.matches.find((match) => match.practiceId === "test.bound-target")?.enforcement).toBe("checkpoint");
    expect(guidance.matches.find((match) => match.practiceId === "test.bound-target")?.explanation).toContain(
      "Evidence binding: unit-test:symbol.service:checkpoint:complete"
    );
  });
});
