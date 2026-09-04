/**
 * RF0 characterization freeze for the refactor-decision engine.
 *
 * Every case below is committed literal data: `expected` is the full observed return value and
 * `digest` is `digestJson(expected)` captured once, by hand, from the implementation as it stood
 * at the RF0 freeze. Nothing here regenerates: there is no update flag and no mismatch-tolerant
 * branch, so later work cannot quietly redefine the scoring table or posture matrix. The legacy
 * proposal author was intentionally retired when its target identifiers proved synthetic.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { digestJson, type Json } from "@archcontext/contracts";
import type { ArchitecturePressure } from "@archcontext/core/pressure-engine";
import { computeRefactorConfidence, createProofPoint, decidePosture } from "../src/index";

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
      if (fixture.id === "reject-invalid-high") {
        expect(() => computeRefactorConfidence(fixture.input)).toThrow("callerCoverage must be a finite ratio between 0 and 1");
        return;
      }
      const { evidence: _evidence, ...scoring } = computeRefactorConfidence(fixture.input);
      expectFrozen(scoring, fixture);
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

test("RF0 cutover: legacy decision module no longer authors intervention targets", async () => {
  const module = await import("../src/index");
  expect("createInterventionProposal" in module).toBe(false);
});
