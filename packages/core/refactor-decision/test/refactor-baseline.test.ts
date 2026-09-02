/**
 * RF0 characterization freeze for the refactor-decision engine.
 *
 * Every case below is committed literal data: `expected` is the full observed return value and
 * `digest` is `digestJson(expected)` captured once, by hand, from the implementation as it stood
 * at the RF0 freeze. Nothing here regenerates: there is no update flag and no mismatch-tolerant
 * branch, so RF1–RF4 cannot quietly redefine the scoring table, the posture matrix, or the
 * proposal strings — a behavior change fails these tests and has to be argued for.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { digestJson, type Json } from "@archcontext/contracts";
import type { ArchitecturePressure } from "@archcontext/core/pressure-engine";
import { computeRefactorConfidence, createInterventionProposal, createProofPoint, decidePosture } from "../src/index";

interface BaselineFixture<TInput> {
  id: string;
  description: string;
  input: TInput;
  expected: unknown;
  digest: string;
}

function loadFixtures<TInput>(name: string): BaselineFixture<TInput>[] {
  const path = new URL(`./fixtures/refactor-baseline/${name}.json`, import.meta.url);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as BaselineFixture<TInput>[];
  if (parsed.length === 0) throw new Error(`refactor-baseline fixture is empty: ${name}`);
  return parsed;
}

/** Asserts the observed payload against both committed forms; neither alone is a freeze. */
function expectFrozen(actual: unknown, fixture: BaselineFixture<unknown>): void {
  expect(actual).toEqual(fixture.expected);
  expect(digestJson(actual as Json)).toBe(fixture.digest);
}

type ConfidenceInput = Parameters<typeof computeRefactorConfidence>[0];

describe("RF0 baseline: computeRefactorConfidence score table", () => {
  for (const fixture of loadFixtures<ConfidenceInput>("refactor-confidence")) {
    test(`${fixture.id} — ${fixture.description}`, () => {
      expectFrozen(computeRefactorConfidence(fixture.input), fixture);
    });
  }
});

describe("RF0 baseline: decidePosture pressure x confidence matrix", () => {
  for (const fixture of loadFixtures<{ pressure: ArchitecturePressure; confidenceInput: ConfidenceInput }>("decide-posture")) {
    test(`${fixture.id} — ${fixture.description}`, () => {
      const confidence = computeRefactorConfidence(fixture.input.confidenceInput);
      expectFrozen(
        {
          posture: decidePosture(fixture.input.pressure, confidence),
          confidenceLevel: confidence.level,
          confidenceScore: confidence.score
        },
        fixture
      );
    });
  }
});

describe("RF0 baseline: createProofPoint strings", () => {
  for (const fixture of loadFixtures<{ task: string }>("proof-point")) {
    test(`${fixture.id} — ${fixture.description}`, () => {
      expectFrozen(createProofPoint(fixture.input.task), fixture);
    });
  }
});

describe("RF0 baseline: createInterventionProposal payload", () => {
  for (const fixture of loadFixtures<{ task: string; pressure: ArchitecturePressure; confidenceInput: ConfidenceInput }>("intervention-proposal")) {
    test(`${fixture.id} — ${fixture.description}`, () => {
      expectFrozen(
        createInterventionProposal({
          task: fixture.input.task,
          pressure: fixture.input.pressure,
          confidence: computeRefactorConfidence(fixture.input.confidenceInput)
        }),
        fixture
      );
    });
  }
});

/**
 * The placeholder target strings are frozen deliberately: today `createInterventionProposal`
 * emits fixed `module.target-owner` / `relation.target-calls-boundary` / `symbol.legacyWrapper` /
 * `symbol.fallbackMapper` regardless of input. RF1–RF4 may replace them with real bindings, but
 * that is a behavior change this assertion forces into the open rather than a silent upgrade.
 */
test("RF0 baseline: intervention placeholder targets are input-independent", () => {
  const pressure: ArchitecturePressure = { level: "high", score: 80, signals: [] };
  const confidence = computeRefactorConfidence({ callerCoverage: 1, testsAvailable: true, rollbackAvailable: true });
  const first = createInterventionProposal({ task: "alpha task", pressure, confidence });
  const second = createInterventionProposal({ task: "completely unrelated beta task", pressure, confidence });
  expect(first.targetState.owners.primaryLifecycle).toBe("module.target-owner");
  expect(first.targetState.requiredRelations).toEqual(["relation.target-calls-boundary"]);
  expect(first.killList.map((item) => item.target)).toEqual(["symbol.legacyWrapper", "symbol.fallbackMapper"]);
  expect(second.targetState).toEqual(first.targetState);
  expect(second.killList).toEqual(first.killList);
});
