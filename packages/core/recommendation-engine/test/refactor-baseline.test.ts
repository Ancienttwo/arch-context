/**
 * RF0 characterization freeze for the recommendation scheduler.
 *
 * RF3 migrates recommendations v2 → v3. These fixtures commit the exact v2 payloads the current
 * engine emits at a fixed `now`, so the migration has to state which fields it changes instead of
 * absorbing a drift. Everything here is deterministic by construction: `now` is literal, every
 * digest input is a literal, and no wall clock or filesystem is read.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { digestJson, type Json } from "@archcontext/contracts";
import {
  planRecommendationRun,
  recommendationFingerprint,
  type PlanRecommendationRunInput,
  type RecommendationRunPlan
} from "../src/index";

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

function expectFrozen(actual: unknown, fixture: BaselineFixture<unknown>): void {
  expect(actual).toEqual(fixture.expected);
  expect(digestJson(actual as Json)).toBe(fixture.digest);
}

const fingerprintFixtures = loadFixtures<Parameters<typeof recommendationFingerprint>[0]>("recommendation-fingerprint");
const planFixtures = loadFixtures<PlanRecommendationRunInput>("plan-recommendation-run");

describe("RF0 baseline: recommendationFingerprint digests", () => {
  for (const fixture of fingerprintFixtures) {
    test(`${fixture.id} — ${fixture.description}`, () => {
      expectFrozen({ fingerprint: recommendationFingerprint(fixture.input) }, fixture);
    });
  }

  test("evidence binding order is not part of the fingerprint identity", () => {
    const sorted = fingerprintFixtures.find((fixture) => fixture.id === "with-practice-id");
    const unsorted = fingerprintFixtures.find((fixture) => fixture.id === "evidence-binding-ids-unsorted");
    if (!sorted || !unsorted) throw new Error("missing fingerprint ordering fixtures");
    expect(unsorted.input.evidenceBindingIds).not.toEqual(sorted.input.evidenceBindingIds);
    expect(unsorted.digest).toBe(sorted.digest);
  });

  test("subject and practiceId are part of the fingerprint identity", () => {
    const ids = ["with-practice-id", "without-practice-id", "different-subject", "without-baseline-digest"];
    const digests = ids.map((id) => {
      const fixture = fingerprintFixtures.find((entry) => entry.id === id);
      if (!fixture) throw new Error(`missing fingerprint fixture: ${id}`);
      return fixture.digest;
    });
    expect(new Set(digests).size).toBe(ids.length);
  });
});

describe("RF0 baseline: planRecommendationRun payloads at a fixed now", () => {
  for (const fixture of planFixtures) {
    test(`${fixture.id} — ${fixture.description}`, () => {
      expectFrozen(planRecommendationRun(fixture.input), fixture);
    });
  }
});

describe("RF0 baseline: suppression and id derivation restated from the frozen table", () => {
  function expectedPlan(id: string): RecommendationRunPlan {
    const fixture = planFixtures.find((entry) => entry.id === id);
    if (!fixture) throw new Error(`missing plan fixture: ${id}`);
    return fixture.expected as RecommendationRunPlan;
  }

  test("run and recommendation ids are the first 16 hex characters of their digest", () => {
    const plan = expectedPlan("single-medium-risk-candidate");
    expect(plan.run.runId).toBe(`recommendation_run.${plan.inputDigest.replace(/^sha256:/, "").slice(0, 16)}`);
    const recommendation = plan.recommendations[0];
    expect(recommendation.recommendationId).toBe(`recommendation.${recommendation.fingerprint.replace(/^sha256:/, "").slice(0, 16)}`);
    expect(recommendation.runId).toBe(plan.run.runId);
  });

  test("an active previous fingerprint suppresses; a terminal one does not", () => {
    const suppressedPlan = expectedPlan("duplicate-active-fingerprint-suppressed");
    const reemittedPlan = expectedPlan("resolved-previous-fingerprint-not-suppressed");
    expect(suppressedPlan.recommendations).toHaveLength(0);
    expect(suppressedPlan.suppressed).toHaveLength(1);
    expect(suppressedPlan.suppressed[0].reasonCode).toBe("duplicate-active-fingerprint");
    expect(suppressedPlan.suppressed[0].previousRecommendationId).toBe(reemittedPlan.recommendations[0].recommendationId);
    expect(reemittedPlan.suppressed).toEqual([]);
  });

  /**
   * The default cooldown window is exclusive at its far end: `lastRecommendedAt + cooldownMs`
   * equal to `now` releases the candidate, one millisecond later still suppresses it.
   */
  test("the default cooldown window is exclusive at exactly cooldownMs", () => {
    const released = expectedPlan("cooldown-boundary-exactly-elapsed-not-suppressed");
    const held = expectedPlan("cooldown-boundary-one-ms-short-suppressed");
    expect(released.suppressed).toEqual([]);
    expect(released.recommendations).toHaveLength(1);
    expect(held.recommendations).toHaveLength(0);
    expect(held.suppressed[0].reasonCode).toBe("cooldown-active");
    expect(held.suppressed[0].cooldownUntil).toBe("2026-06-26T12:00:00.001Z");
    expect(held.run.extensions?.cooldownMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(expectedPlan("cooldown-for-other-subject-does-not-match").suppressed).toEqual([]);
  });
});
