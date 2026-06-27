import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl9DocProjectionsReadback } from "./architecture-ledger-al9-doc-projections-readback";

describe("architecture-ledger-al9-doc-projections-readback", () => {
  test("accepts a complete AL9 docs projection packet", () => {
    const result = inspectArchitectureLedgerAl9DocProjectionsReadback(packet());
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  test("rejects missing drift, digest, CLI, and privacy evidence", () => {
    const result = inspectArchitectureLedgerAl9DocProjectionsReadback(packet({
      current: {
        driftOk: false,
        projectionManifestTracksDigests: false
      },
      integration: {
        postApplyDriftOk: false,
        cliCommands: [{ command: "docs plan", ok: false }]
      },
      privacy: {
        rawSourcePersisted: true,
        forbiddenKeys: ["rawDiff"]
      },
      assertions: {
        "AL9-06": false,
        "AL9-13": false
      }
    }));

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("current repo docs projection drift must be clean");
    expect(result.failures).toContain("temp repo docs projection drift must be clean after apply");
    expect(result.failures).toContain("AL9-06 assertion failed");
    expect(result.failures).toContain("AL9-13 assertion failed");
    expect(result.failures.some((failure) => failure.includes("privacy forbidden keys"))).toBe(true);
  });
});

function packet(overrides: Record<string, any> = {}) {
  const base = {
    schemaVersion: "archcontext.architecture-ledger-al9-doc-projections-readback/v1",
    current: {
      projectionTargetSchemaPresent: true,
      repoProjectionManifestPresent: true,
      placementRuleCount: 8,
      placementRuleScopes: ["repository", "entity:*", "relation", "decision", "changelog", "diagram"],
      driftOk: true,
      projectionManifestTracksDigests: true,
      docs: {
        indexPresent: true,
        entitySummaryPresent: true,
        decisionIndexPresent: true,
        changelogPresent: true,
        mermaidPresent: true,
        structurizrPresent: true,
        likec4Present: true
      }
    },
    integration: {
      postApplyDriftOk: true,
      humanTextPreserved: true,
      ambiguousOwnershipRejected: true,
      manualEditDetected: true,
      orphanDetected: true,
      missingDetected: true,
      changeSetPreviewAllowed: true,
      changeSetApplySucceeded: true,
      cleanReportsOrphan: true,
      deterministicProjectionDigest: true,
      cliCommands: [
        { command: "docs plan", ok: true },
        { command: "docs preview", ok: true },
        { command: "docs apply", ok: true },
        { command: "docs drift", ok: true },
        { command: "docs clean", ok: true }
      ]
    },
    privacy: {
      rawSourcePersisted: false,
      forbiddenKeys: []
    },
    assertions: {
      "AL9-01": true,
      "AL9-02": true,
      "AL9-03": true,
      "AL9-04": true,
      "AL9-05": true,
      "AL9-06": true,
      "AL9-07": true,
      "AL9-08": true,
      "AL9-11": true,
      "AL9-12": true,
      "AL9-13": true,
      "AL9-15": true
    }
  };
  return merge(base, overrides);
}

function merge(left: any, right: any): any {
  if (Array.isArray(left) || Array.isArray(right) || left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return right === undefined ? left : right;
  }
  return Object.fromEntries([...new Set([...Object.keys(left), ...Object.keys(right)])].map((key) => [key, merge(left[key], right[key])]));
}
