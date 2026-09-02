/**
 * RF0 characterization freeze for `prepareTask`'s confidence defaults and posture branch.
 *
 * `prepareTask` supplies `callerCoverage ?? 0.8`, `testsAvailable ?? true`,
 * `rollbackAvailable ?? true` (`src/index.ts`). Nothing asserted those three constants directly
 * before RF0: they were only visible through the posture a control-loop test happened to expect.
 * These fixtures pin the resulting confidence payload (score 86, level high) and the posture each
 * branch produces, so RF1–RF4 cannot move the defaults without saying so.
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
  digest: string;
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

describe("RF0 baseline: prepareTask confidence defaults and posture branch", () => {
  for (const fixture of fixtures) {
    test(`${fixture.id} — ${fixture.description}`, async () => {
      const actual = await runFixture(fixture.input);
      expect(actual).toEqual(fixture.expected as Json);
      expect(digestJson(actual)).toBe(fixture.digest);
    });
  }
});

describe("RF0 baseline: the three default constants restated from the frozen table", () => {
  function byId(id: string): BaselineFixture {
    const found = fixtures.find((fixture) => fixture.id === id);
    if (!found) throw new Error(`missing refactor-baseline fixture: ${id}`);
    return found;
  }

  test("omitting all three inputs is exactly 0.8 / true / true", () => {
    const defaults = byId("all-defaults-high-pressure");
    const explicit = byId("explicit-defaults-are-identical");
    expect(explicit.input).toMatchObject({ callerCoverage: 0.8, testsAvailable: true, rollbackAvailable: true });
    // Identical payloads prove the defaults are those three values, not merely "some high value".
    expect(defaults.expected).toEqual(explicit.expected);
    expect(defaults.digest).toBe(explicit.digest);
    expect(defaults.expected).toMatchObject({
      confidence: { score: 86, level: "high", coverage: ["caller-coverage:0.8"], rollbackPoints: ["git-worktree"] }
    });
  });

  test("each default is nullish-coalesced, so an explicit falsy value still wins", () => {
    expect(byId("explicit-zero-coverage-is-not-the-default").expected)
      .toMatchObject({ confidence: { score: 30, coverage: ["caller-coverage:0"] } });
    expect(byId("explicit-tests-unavailable").expected)
      .toMatchObject({ confidence: { score: 71, rollbackPoints: ["git-worktree"] } });
    expect(byId("explicit-rollback-unavailable").expected)
      .toMatchObject({ confidence: { score: 71, rollbackPoints: [] } });
  });

  test("the frozen table covers all three posture branches", () => {
    expect(new Set(fixtures.map((fixture) => (fixture.expected as { posture: string }).posture)))
      .toEqual(new Set(["intervention", "proof-required", "normal"]));
    expect((byId("all-defaults-high-pressure").expected as { intervention: unknown }).intervention).not.toBeNull();
    expect((byId("all-defaults-high-pressure").expected as { proofPoint: unknown }).proofPoint).toBeNull();
    expect((byId("explicit-zero-coverage-is-not-the-default").expected as { proofPoint: unknown }).proofPoint).not.toBeNull();
    expect((byId("low-pressure-defaults-stay-normal").expected as { intervention: unknown }).intervention).toBeNull();
  });
});
