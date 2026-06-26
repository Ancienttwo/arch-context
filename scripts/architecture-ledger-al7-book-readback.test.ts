import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl7BookReadback } from "./architecture-ledger-al7-book-readback";

describe("architecture-ledger-al7-book-readback", () => {
  test("accepts verified AL7 Book benchmark and privacy evidence", () => {
    expect(inspectArchitectureLedgerAl7BookReadback(packet())).toMatchObject({
      ok: true,
      failures: []
    });
  });

  test("rejects slow warm p95, missing provenance, privacy leaks and CLI/MCP drift", () => {
    const base = packet();
    const result = inspectArchitectureLedgerAl7BookReadback(packet({
      benchmark: [
        { ...base.benchmark[0], warmQueryP95Ms: 301 },
        { ...base.benchmark[1], privacy: { ...base.benchmark[1].privacy, noRawSourceBody: false } },
        { ...base.benchmark[2], bookOutputAcceptance: { ...base.benchmark[2].bookOutputAcceptance, changedWhyDependsRiskAnswerable: false } }
      ],
      runtime: {
        ...base.runtime,
        freshnessProvenance: { ...base.runtime.freshnessProvenance, allRuntimeResponsesHaveFreshnessAndProvenance: false },
        cliMcpEquivalence: [{ ...base.runtime.cliMcpEquivalence[0], equivalent: false }],
        privacy: { ...base.runtime.privacy, noForbiddenKeys: false }
      },
      assertions: {
        ...base.assertions,
        "AL7-15": false,
        "AL7-EG1": false,
        "AL7-EG2": false,
        "AL7-EG3": false,
        "AL7-EG4": false
      }
    }));
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("small: warmQueryP95Ms must be <= 300");
    expect(result.failures).toContain("medium: raw source sentinel leaked");
    expect(result.failures).toContain("large: acceptance answer is not supported by Book output");
    expect(result.failures).toContain("runtime responses must carry freshness and provenance");
    expect(result.failures).toContain("archctx book status: CLI/MCP data must be equivalent");
    expect(result.failures).toContain("runtime forbidden response key present");
  });
});

function packet(overrides: Record<string, any> = {}) {
  return {
    schemaVersion: "archcontext.architecture-ledger-al7-book-readback/v1",
    status: "verified",
    thresholds: {
      warmQueryP95Ms: 300,
      sampleCount: 8
    },
    benchmark: ["small", "medium", "large"].map((name) => ({
      name,
      entityCount: name === "small" ? 12 : name === "medium" ? 120 : 360,
      relationCount: 1,
      constraintCount: 1,
      graphDigest: `sha256:${name.padEnd(64, "1").slice(0, 64)}`,
      sourceDigest: `sha256:${name.padEnd(64, "2").slice(0, 64)}`,
      coldQueryMs: 1,
      warmQueryP95Ms: 2,
      warmQuerySamplesMs: [1, 2, 2],
      responseDigests: {},
      bookOutputAcceptance: {
        changedWhyDependsRiskAnswerable: true,
        whatChanged: "entity:module.changed:changed",
        why: ["subject-summary-changed"],
        dependsOn: ["relation.one"],
        remainingRisk: [{ recommendationId: "recommendation.one", risk: "medium", uncertainty: "low" }]
      },
      privacy: {
        forbiddenStrings: ["AL7_RAW_SOURCE_SENTINEL_do_not_emit_source_body"],
        noRawSourceBody: true,
        noForbiddenKeys: true,
        forbiddenKeyHits: []
      },
      assertions: {
        coldMeasured: true,
        warmMeasured: true,
        warmP95WithinBudget: true,
        queryReturnsExpectedSubject: true,
        neighborsExposeDependency: true,
        timelineCarriesAffectedSubject: true,
        diffCarriesReasonCodes: true,
        recommendationsExposeRisk: true
      }
    })),
    runtime: {
      graphDigest: `sha256:${"3".repeat(64)}`,
      rebuildGraphDigest: `sha256:${"3".repeat(64)}`,
      freshnessProvenance: {
        checkedResponses: [],
        allRuntimeResponsesHaveFreshnessAndProvenance: true
      },
      cliMcpEquivalence: [
        {
          command: "archctx book status",
          uri: "archcontext://book/status",
          equivalent: true,
          cliDigest: `sha256:${"4".repeat(64)}`,
          mcpDigest: `sha256:${"4".repeat(64)}`
        },
        {
          command: "archctx book export --format json",
          uri: "archcontext://book/state",
          equivalent: true,
          cliDigest: `sha256:${"5".repeat(64)}`,
          mcpDigest: `sha256:${"5".repeat(64)}`
        },
        {
          command: "archctx book timeline",
          uri: "archcontext://book/timeline",
          equivalent: true,
          cliDigest: `sha256:${"6".repeat(64)}`,
          mcpDigest: `sha256:${"6".repeat(64)}`
        },
        {
          command: "archctx book diff --from empty --to current",
          uri: "archcontext://book/diff",
          equivalent: true,
          cliDigest: `sha256:${"7".repeat(64)}`,
          mcpDigest: `sha256:${"7".repeat(64)}`
        }
      ],
      privacy: {
        forbiddenStrings: ["AL7_RAW_SOURCE_SENTINEL_do_not_emit_source_body"],
        noRawSourceBody: true,
        noForbiddenKeys: true,
        forbiddenKeyHits: []
      }
    },
    privacy: {
      forbiddenStrings: ["AL7_RAW_SOURCE_SENTINEL_do_not_emit_source_body"],
      noRawSourceBody: true,
      noForbiddenKeys: true,
      allowedFields: ["id", "summary", "digest"]
    },
    assertions: {
      "AL7-14": true,
      "AL7-15": true,
      "AL7-EG1": true,
      "AL7-EG2": true,
      "AL7-EG3": true,
      "AL7-EG4": true
    },
    readback: {
      command: "bun scripts/architecture-ledger-al7-book-readback.ts inspect --evidence docs/verification/architecture-ledger-al7-book-readback.json --json"
    },
    failures: [],
    ...overrides
  };
}
