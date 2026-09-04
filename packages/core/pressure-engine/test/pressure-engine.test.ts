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

  test("does not promote names, task text, summaries, or ordinary data edges into observed pressure", () => {
    const pressure = detectArchitecturePressure({
      task: "Refactor the legacy wrapper owner",
      symbols: ["legacyWrapperOwner"],
      files: ["src/legacy-wrapper-owner.ts"],
      edges: [
        { source: "legacyWrapperOwner", target: "recordStore", kind: "reads", confidence: "high" }
      ],
      observedEvidence: [
        {
          id: "evidence.verified-summary",
          selector: { path: "src/legacy-wrapper-owner.ts" },
          summary: "verified by test",
          confidence: "verified",
          snapshot: {
            repositoryId: "repo.test",
            headSha: "abc",
            worktreeDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
          }
        }
      ]
    });

    expect(pressure.level).toBe("low");
    expect(pressure.score).toBe(10);
    expect(pressure.signals.every((signal) => signal.evidenceKind === "heuristic")).toBe(true);
  });

  test("keeps a bidirectional import cycle as observed pressure", () => {
    const edges = [
      { source: "moduleA", target: "moduleB", kind: "imports" as const, confidence: "high" as const },
      { source: "moduleB", target: "moduleA", kind: "imports" as const, confidence: "high" as const }
    ];
    const pressure = detectArchitecturePressure({
      task: "refactor",
      edges
    });
    const namedPressure = detectArchitecturePressure({
      task: "refactor",
      symbols: ["legacyWrapperOwner"],
      files: ["src/legacy-wrapper-owner.ts"],
      edges
    });

    expect(pressure.signals).toEqual([
      expect.objectContaining({
        type: "dependency-cycle",
        severity: "high",
        evidenceKind: "observed",
        evidence: ["moduleA->moduleB", "moduleB->moduleA"]
      })
    ]);
    expect(namedPressure).toEqual(pressure);
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

  test("rejects invalid migration date inputs instead of deriving observed evidence", () => {
    expect(() => detectArchitecturePressure({
      task: "finish migration",
      migrationReviewDate: "2026-99-99",
      now: "2027-01-01"
    })).toThrow("Invalid migrationReviewDate: expected a valid YYYY-MM-DD date");
    expect(() => detectArchitecturePressure({
      task: "finish migration",
      migrationReviewDate: "2026-01-01",
      now: "2027-02-29"
    })).toThrow("Invalid now: expected a valid YYYY-MM-DD date");
  });

  test("keeps simple tasks low pressure", () => {
    expect(detectArchitecturePressure({ task: "rename button label" })).toEqual({
      level: "low",
      score: 0,
      signals: []
    });
  });

  test("does not let cross-repo task text inflate observed cycle pressure", () => {
    const pressure = detectCrossRepoPressure({
      task: "remove legacy v1/v2 contract",
      relations: [
        { id: "relation.web-calls-api", source: { repositoryId: "repo.web" }, target: { repositoryId: "repo.api" } },
        { id: "relation.api-calls-web", source: { repositoryId: "repo.api" }, target: { repositoryId: "repo.web" } }
      ]
    });
    expect(pressure.signals.map((signal) => signal.type)).toEqual(["cross-repo-cycle", "cross-repo-dual-track"]);
    expect(pressure.signals.find((signal) => signal.type === "cross-repo-dual-track")?.severity).toBe("medium");
    expect(pressure).toMatchObject({ level: "low", score: 25 });
  });
});
