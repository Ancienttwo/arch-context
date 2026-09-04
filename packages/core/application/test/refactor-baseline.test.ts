/**
 * Characterization freeze for `prepareTask`'s evidence-integrity cutover.
 *
 * Missing readiness inputs remain explicit unknowns. Explicit zero/false evidence stays distinct,
 * and this legacy path never authors an intervention target.
 *
 * Normalization is an explicit allow-list, not a wildcard: only confidence, posture, the pressure
 * level/score/signal shape, and the proof-point/intervention branch are frozen. The compiled
 * context is excluded because it carries worktree- and tmpdir-dependent digests.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson, type CodeFactsPort, type Json, type NormalizedCodeContext } from "@archcontext/contracts";
import { initializeArchContextModel, YamlModelStore } from "../../../local-runtime/model-store-yaml/src/index";
import { prepareTask } from "../src/index";

interface PrepareTaskFixtureInput {
  task: string;
  facts: "structuralCompatibility" | "quiet";
  callerCoverage?: number;
  testsAvailable?: boolean;
  rollbackAvailable?: boolean;
}

interface BaselineFixture {
  id: string;
  description: string;
  input: PrepareTaskFixtureInput;
  expected: unknown;
}

function loadFixtures(name: string): BaselineFixture[] {
  const path = new URL(`./fixtures/refactor-baseline/${name}.json`, import.meta.url);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as BaselineFixture[];
  if (parsed.length === 0) throw new Error(`refactor-baseline fixture is empty: ${name}`);
  return parsed;
}

/**
 * Same `CodeFactsPort` object-literal fake shape the control-loop suite uses: a compatibility
 * surface with legacy/fallback symbols plus one imports edge and one reads edge.
 */
function structuralCompatibilityFacts(): CodeFactsPort {
  const snapshot = { provider: "codegraph", version: "1.0.1", schemaDigest: `sha256:${"a".repeat(64)}`, indexedAt: "2026-06-19T00:00:00.000Z", workspaceDigest: `sha256:${"b".repeat(64)}` } as const;
  return {
    async ensureReady() { return { ...snapshot }; },
    async sync() { return { ...snapshot }; },
    async buildTaskContext(input) {
      const symbols = [
        { id: "symbol.legacyWrapperV1", name: "legacyWrapperV1", kind: "public-api", path: "src/billing/legacy-wrapper-v1.ts" },
        { id: "symbol.fallbackMapperV2", name: "fallbackMapperV2", kind: "public-api", path: "src/billing/fallback-mapper-v2.ts" },
        { id: "symbol.paymentRepository", name: "paymentRepository", kind: "service", path: "src/billing/payment-repository.ts" }
      ].slice(0, input.maxSymbols);
      return {
        task: input.task,
        symbols,
        edges: [
          { source: "symbol.legacyWrapperV1", target: "symbol.fallbackMapperV2", kind: "imports", confidence: "high" },
          { source: "symbol.fallbackMapperV2", target: "symbol.paymentRepository", kind: "reads", confidence: "high" }
        ],
        evidence: [],
        digest: digestJson({ task: input.task, symbols } as unknown as Json)
      } satisfies NormalizedCodeContext;
    },
    async findSymbols() { return []; },
    async getImpact() { return { symbolId: "symbol.none", callers: [], callees: [], affectedPaths: [] }; },
    async getCallers() { return []; },
    async getCallees() { return []; },
    async resolveEvidence() { return []; }
  };
}

/** A code context with nothing structural in it, so pressure stays low and posture stays normal. */
function quietFacts(): CodeFactsPort {
  const snapshot = { provider: "codegraph", version: "1.0.1", schemaDigest: `sha256:${"d".repeat(64)}`, indexedAt: "2026-06-19T00:00:00.000Z", workspaceDigest: `sha256:${"e".repeat(64)}` } as const;
  return {
    async ensureReady() { return { ...snapshot }; },
    async sync() { return { ...snapshot }; },
    async buildTaskContext(input) {
      return { task: input.task, symbols: [], edges: [], evidence: [], digest: digestJson({ task: input.task } as unknown as Json) } satisfies NormalizedCodeContext;
    },
    async findSymbols() { return []; },
    async getImpact() { return { symbolId: "symbol.none", callers: [], callees: [], affectedPaths: [] }; },
    async getCallers() { return []; },
    async getCallees() { return []; },
    async resolveEvidence() { return []; }
  };
}

const codeFactsByName: Record<PrepareTaskFixtureInput["facts"], () => CodeFactsPort> = {
  structuralCompatibility: structuralCompatibilityFacts,
  quiet: quietFacts
};

/** Explicit allow-list. Everything not named here is deliberately out of the freeze. */
function normalize(result: Awaited<ReturnType<typeof prepareTask>>): Json {
  return {
    confidence: result.confidence,
    posture: result.posture,
    pressure: {
      level: result.pressure.level,
      score: result.pressure.score,
      signalTypes: result.pressure.signals.map((signal) => `${signal.type}/${signal.severity}/${signal.evidenceKind}`).sort()
    },
    proofPoint: result.proofPoint ?? null,
    intervention: result.intervention ?? null
  } as unknown as Json;
}

async function runFixture(input: PrepareTaskFixtureInput): Promise<Json> {
  const root = mkdtempSync(join(tmpdir(), "archctx-rf0-application-"));
  try {
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    initializeArchContextModel(root, "M2 App");
    return normalize(await prepareTask({
      workspace: { root, repositoryId: "repo.test", headSha: "abc" },
      task: input.task,
      codeFacts: codeFactsByName[input.facts](),
      modelStore: new YamlModelStore(),
      ...(input.callerCoverage === undefined ? {} : { callerCoverage: input.callerCoverage }),
      ...(input.testsAvailable === undefined ? {} : { testsAvailable: input.testsAvailable }),
      ...(input.rollbackAvailable === undefined ? {} : { rollbackAvailable: input.rollbackAvailable })
    }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const fixtures = loadFixtures("prepare-task");

describe("prepareTask evidence-integrity characterization", () => {
  for (const fixture of fixtures) {
    test(`${fixture.id} — ${fixture.description}`, async () => {
      const actual = await runFixture(fixture.input);
      expect(actual).toEqual(fixture.expected as Json);
    });
  }
});

describe("prepareTask unknown evidence boundary", () => {
  function byId(id: string): BaselineFixture {
    const found = fixtures.find((fixture) => fixture.id === id);
    if (!found) throw new Error(`missing refactor-baseline fixture: ${id}`);
    return found;
  }

  test("omitting readiness inputs stays unknown and cannot create high confidence", () => {
    expect(byId("all-readiness-unknown").expected).toMatchObject({
      confidence: {
        score: 0,
        level: "low",
        coverage: [],
        rollbackPoints: [],
        evidence: { callerCoverage: null, testsAvailable: null, rollbackAvailable: null }
      },
      intervention: null
    });
  });

  test("explicit zero and false values remain observed rather than unknown", () => {
    expect(byId("explicit-zero-coverage").expected)
      .toMatchObject({ confidence: { score: 0, coverage: ["caller-coverage:0"], evidence: { callerCoverage: 0 } } });
    expect(byId("explicit-tests-unavailable").expected)
      .toMatchObject({ confidence: { score: 0, evidence: { testsAvailable: false } } });
    expect(byId("explicit-rollback-unavailable").expected)
      .toMatchObject({ confidence: { score: 0, rollbackPoints: [], evidence: { rollbackAvailable: false } } });
  });

  test("explicit high readiness still does not author an intervention", () => {
    expect(byId("explicit-readiness").expected).toMatchObject({
      confidence: { level: "high", score: 86, rollbackPoints: [], evidence: { rollbackAvailable: true } },
      intervention: null
    });
  });
});
