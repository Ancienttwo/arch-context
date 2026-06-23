import { describe, expect, test } from "bun:test";
import { inspectPracticeContext7Readback, verifiedPracticeContext7Fixture } from "./practice-context7-readback";

describe("practice-context7-readback", () => {
  test("accepts verified Context7 packet with manual-only egress and advisory resources", () => {
    expect(inspectPracticeContext7Readback(verifiedPracticeContext7Fixture())).toMatchObject({
      ok: true,
      defaultPrepareEgress: "none",
      dlpCases: 8,
      dlpRejected: 8,
      failures: []
    });
  });

  test("rejects default provider egress or automatic prepare egress", () => {
    const result = inspectPracticeContext7Readback(verifiedPracticeContext7Fixture({
      defaultHealth: {
        provider: "context7",
        enabled: true,
        mode: "prepare-unknowns",
        egress: "prepare-unknowns",
        cache: "sqlite",
        keySource: "env"
      },
      runtime: {
        ...verifiedPracticeContext7Fixture().runtime,
        defaultPrepareEgress: "prepare-unknowns"
      }
    }));

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("defaultHealth.enabled must be false");
    expect(result.failures).toContain("defaultHealth.mode must be manual");
    expect(result.failures).toContain("defaultHealth.egress must be none");
    expect(result.failures).toContain("defaultHealth.keySource must be none");
    expect(result.failures).toContain("runtime.defaultPrepareEgress must be none");
  });

  test("rejects hard-gate provider calls and cache replay misses", () => {
    const packet = verifiedPracticeContext7Fixture({
      runtime: {
        ...verifiedPracticeContext7Fixture().runtime,
        secondFetchCacheStatus: "miss",
        providerCallsAfterSecondFetch: 2,
        providerCallsAfterPrepareComplete: 3
      },
      hardGateScan: {
        prepareProviderReferences: 1,
        checkpointProviderReferences: 0,
        completeProviderReferences: 1
      },
      assertions: {
        ...verifiedPracticeContext7Fixture().assertions,
        hardGateProviderCallsZero: false,
        exactVersionCacheReplay: false
      }
    });

    const result = inspectPracticeContext7Readback(packet);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("runtime.secondFetchCacheStatus must be fresh");
    expect(result.failures).toContain("runtime.providerCallsAfterSecondFetch must be 1");
    expect(result.failures).toContain("runtime.providerCallsAfterPrepareComplete must remain 1");
    expect(result.failures).toContain("hardGateScan.prepareProviderReferences must be 0");
    expect(result.failures).toContain("hardGateScan.completeProviderReferences must be 0");
    expect(result.failures).toContain("assertions.hardGateProviderCallsZero must be true");
    expect(result.failures).toContain("assertions.exactVersionCacheReplay must be true");
  });

  test("rejects packet-level private source, diff, path, and secret markers", () => {
    const packet = verifiedPracticeContext7Fixture({
      leaked: {
        sourceBody: "const hidden = true;",
        absolutePath: "/Users/alice/Projects/private/src/app.ts",
        tokenValue: "access_token_abcdef123456"
      }
    });

    const result = inspectPracticeContext7Readback(packet);
    expect(result.ok).toBe(false);
    expect(result.failures.some((failure: string) => failure.includes("DLP finding"))).toBe(true);
  });
});
