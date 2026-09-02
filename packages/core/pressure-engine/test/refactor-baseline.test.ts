/**
 * RF0 characterization freeze for `detectArchitecturePressure`.
 *
 * Each case commits the full observed `{ level, score, signals }` payload plus its
 * `digestJson` — including every `evidenceDetails` entry, whose `observedAt` the engine pins to
 * the epoch so the payload is machine-independent. There is no regeneration path: a scoring,
 * severity, threshold, or cap change fails here instead of silently redefining "pressure".
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { digestJson, type Json } from "@archcontext/contracts";
import { detectArchitecturePressure, type ArchitecturePressure, type PressureInput } from "../src/index";

interface BaselineFixture {
  id: string;
  description: string;
  input: PressureInput;
  expected: ArchitecturePressure;
  digest: string;
}

function loadFixtures(name: string): BaselineFixture[] {
  const path = new URL(`./fixtures/refactor-baseline/${name}.json`, import.meta.url);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as BaselineFixture[];
  if (parsed.length === 0) throw new Error(`refactor-baseline fixture is empty: ${name}`);
  return parsed;
}

const fixtures = loadFixtures("architecture-pressure");

describe("RF0 baseline: detectArchitecturePressure payloads", () => {
  for (const fixture of fixtures) {
    test(`${fixture.id} — ${fixture.description}`, () => {
      const actual = detectArchitecturePressure(fixture.input);
      expect(actual).toEqual(fixture.expected);
      expect(digestJson(actual as unknown as Json)).toBe(fixture.digest);
    });
  }
});

/**
 * The three invariants the fixture table exists to protect, restated so a future reader sees
 * them without diffing seventeen JSON payloads: the heuristic-only cap, the two level cuts, and
 * the fact that a bidirectional import pair alone is enough for `dependency-cycle`.
 */
describe("RF0 baseline: pressure invariants restated from the frozen table", () => {
  function byId(id: string): BaselineFixture {
    const found = fixtures.find((fixture) => fixture.id === id);
    if (!found) throw new Error(`missing refactor-baseline fixture: ${id}`);
    return found;
  }

  test("heuristic-only signals cannot score above 25 however many of them fire", () => {
    const capped = byId("heuristic-only-cap-25").expected;
    expect(capped.signals).toHaveLength(11);
    expect(capped.signals.every((signal) => signal.evidenceKind === "heuristic")).toBe(true);
    const uncapped = capped.signals.reduce((sum, signal) => sum + (signal.severity === "high" ? 25 : signal.severity === "medium" ? 15 : 5), 0);
    expect(uncapped).toBeGreaterThan(25);
    expect(capped.score).toBe(25);
    expect(capped.level).toBe("low");
    // One observed signal removes the cap, so the same heuristics can then exceed 25.
    expect(byId("heuristic-plus-one-observed-escapes-cap").expected.score).toBe(35);
  });

  test("level cuts sit at 30 and 60", () => {
    expect(byId("level-threshold-below-medium-25").expected).toMatchObject({ score: 25, level: "low" });
    expect(byId("level-threshold-medium-boundary-30").expected).toMatchObject({ score: 30, level: "medium" });
    expect(byId("observed-wrapper-and-dual-track").expected).toMatchObject({ score: 50, level: "medium" });
    expect(byId("level-threshold-high-boundary-60").expected).toMatchObject({ score: 60, level: "high" });
  });

  test("a bidirectional import pair alone raises dependency-cycle at high severity", () => {
    const cycle = byId("bidirectional-import-dependency-cycle").expected;
    const oneWay = byId("unidirectional-import-no-dependency-cycle").expected;
    expect(cycle.signals.map((signal) => signal.type)).toContain("dependency-cycle");
    expect(cycle.signals.find((signal) => signal.type === "dependency-cycle")?.severity).toBe("high");
    expect(oneWay.signals.map((signal) => signal.type)).not.toContain("dependency-cycle");
  });
});
