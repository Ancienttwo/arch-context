import { describe, expect, test } from "bun:test";
import { type EffectivePracticeAssetV1, type NormalizedCodeContext } from "@archcontext/contracts";
import { loadPracticeCatalog } from "@archcontext/core/practice-catalog";
import { detectArchitecturePressure } from "@archcontext/core/pressure-engine";
import { matchPracticesForTask, validatePracticeEngineCatalog } from "../src/index";

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
});
