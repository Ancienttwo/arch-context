import { describe, expect, test } from "bun:test";
import { detectArchitecturePressure } from "../src/index";

describe("@archcontext/pressure-engine", () => {
  test("detects high architecture pressure from structural risk signals", () => {
    const pressure = detectArchitecturePressure({
      task: "Replace duplicate wrapper adapter while old v1 and new v2 paths still do direct db access",
      symbols: ["two lifecycle owners"],
      files: ["src/hotspot.ts"]
    });

    expect(pressure.level).toBe("high");
    expect(pressure.signals.map((signal) => signal.type)).toEqual(
      expect.arrayContaining([
        "duplicate-responsibility",
        "multiple-lifecycle-owner",
        "unjustified-wrapper-adapter",
        "dual-track-business-concept",
        "cross-boundary-data-access"
      ])
    );
    expect(pressure.signals.every((signal) => signal.evidenceKind === "heuristic")).toBe(true);
  });

  test("marks overdue migration evidence as observed", () => {
    const pressure = detectArchitecturePressure({
      task: "finish migration",
      migrationReviewDate: "2026-06-18",
      now: "2026-06-19"
    });

    expect(pressure.signals).toContainEqual({
      type: "overdue-migration-state",
      severity: "high",
      evidence: ["2026-06-18"],
      evidenceKind: "observed"
    });
  });

  test("keeps simple tasks low pressure", () => {
    expect(detectArchitecturePressure({ task: "rename button label" })).toEqual({
      level: "low",
      score: 0,
      signals: []
    });
  });
});
