import { describe, expect, test } from "bun:test";
import { detectArchitecturePressure, detectCrossRepoPressure } from "../src/index";

describe("@archcontext/core/pressure-engine", () => {
  test("keeps heuristic-only task text below high pressure", () => {
    const pressure = detectArchitecturePressure({
      task: "Replace duplicate wrapper adapter while old v1 and new v2 paths still do direct db access",
      symbols: ["docs legacy adapter example"],
      files: ["docs/README.md"]
    });

    expect(pressure.level).toBe("low");
    expect(pressure.signals.map((signal) => signal.type)).toEqual(
      expect.arrayContaining([
        "duplicate-responsibility",
        "unjustified-wrapper-adapter",
        "dual-track-business-concept",
        "cross-boundary-data-access"
      ])
    );
    expect(pressure.signals.every((signal) => signal.evidenceKind === "heuristic")).toBe(true);
    expect(pressure.signals.every((signal) => signal.severity !== "high")).toBe(true);
  });

  test("detects high architecture pressure from observed structural risk signals", () => {
    const pressure = detectArchitecturePressure({
      task: "Replace compatibility path",
      symbols: ["billingLegacyV1", "billingV2Mapper", "two lifecycle owners"],
      files: ["src/billing/legacy-v1.ts", "src/billing/billing-v2-mapper.ts"],
      edges: [
        { source: "billingLegacyV1", target: "billingV2Mapper", kind: "imports", confidence: "high" },
        { source: "billingV2Mapper", target: "paymentRepository", kind: "reads", confidence: "high" }
      ]
    });

    expect(pressure.level).toBe("high");
    expect(pressure.signals.map((signal) => signal.type)).toEqual(
      expect.arrayContaining([
        "unjustified-wrapper-adapter",
        "dual-track-business-concept",
        "multiple-lifecycle-owner",
        "cross-boundary-data-access"
      ])
    );
    expect(pressure.signals.some((signal) => signal.evidenceKind === "observed")).toBe(true);
    expect(pressure.signals.flatMap((signal) => signal.evidenceDetails).some((evidence) => evidence.kind === "symbol")).toBe(true);
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
      evidenceKind: "observed",
      evidenceDetails: [
        {
          kind: "runtime-check",
          strength: "observed",
          subject: "2026-06-18",
          digest: expect.stringMatching(/^sha256:/),
          observedAt: "1970-01-01T00:00:00.000Z"
        }
      ]
    });
  });

  test("keeps simple tasks low pressure", () => {
    expect(detectArchitecturePressure({ task: "rename button label" })).toEqual({
      level: "low",
      score: 0,
      signals: []
    });
  });

  test("detects cross-repo cycle and dual-track pressure", () => {
    const pressure = detectCrossRepoPressure({
      task: "remove legacy v1/v2 contract",
      relations: [
        { id: "relation.web-calls-api", source: { repositoryId: "repo.web" }, target: { repositoryId: "repo.api" } },
        { id: "relation.api-calls-web", source: { repositoryId: "repo.api" }, target: { repositoryId: "repo.web" } }
      ]
    });
    expect(pressure.signals.map((signal) => signal.type)).toEqual(["cross-repo-cycle", "cross-repo-dual-track"]);
    expect(pressure.signals.find((signal) => signal.type === "cross-repo-dual-track")?.severity).toBe("medium");
  });
});
