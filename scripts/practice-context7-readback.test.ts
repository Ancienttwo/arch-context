import { describe, expect, test } from "bun:test";
import {
  inspectLivePracticeContext7Readback,
  inspectPracticeContext7Readback,
  verifiedLivePracticeContext7Fixture,
  verifiedPracticeContext7Fixture
} from "./practice-context7-readback";

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
        providerCallsAfterPrepareComplete: 3,
        prepareExternalResource: {
          ...(verifiedPracticeContext7Fixture().runtime as any).prepareExternalResource,
          cacheStatus: "miss"
        }
      },
      hardGateScan: {
        checkpointProviderReferences: 0,
        completeProviderReferences: 1
      },
      assertions: {
        ...verifiedPracticeContext7Fixture().assertions,
        hardGateProviderCallsZero: false,
        exactVersionCacheReplay: false,
        prepareUnknownsUsesPinnedCacheOnly: false
      }
    });

    const result = inspectPracticeContext7Readback(packet);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("runtime.secondFetchCacheStatus must be fresh");
    expect(result.failures).toContain("runtime.providerCallsAfterSecondFetch must be 1");
    expect(result.failures).toContain("runtime.providerCallsAfterPrepareComplete must remain 1");
    expect(result.failures).toContain("runtime.prepareExternalResource.cacheStatus must be fresh");
    expect(result.failures).toContain("hardGateScan.completeProviderReferences must be 0");
    expect(result.failures).toContain("assertions.hardGateProviderCallsZero must be true");
    expect(result.failures).toContain("assertions.exactVersionCacheReplay must be true");
    expect(result.failures).toContain("assertions.prepareUnknownsUsesPinnedCacheOnly must be true");
  });

  test("rejects incomplete Context7 failure matrix", () => {
    const packet = verifiedPracticeContext7Fixture({
      runtime: {
        ...verifiedPracticeContext7Fixture().runtime,
        failureMatrix: {
          ...(verifiedPracticeContext7Fixture().runtime as any).failureMatrix,
          rowCount: 5,
          localCoreUnchanged: false,
          rows: [
            ...(verifiedPracticeContext7Fixture().runtime as any).failureMatrix.rows.slice(0, 5),
            {
              ...(verifiedPracticeContext7Fixture().runtime as any).failureMatrix.rows[5],
              localCoreUnchanged: false,
              externalResourceCount: 1
            }
          ]
        }
      },
      assertions: {
        ...verifiedPracticeContext7Fixture().assertions,
        failureMatrixKeepsLocalCoreUnchanged: false
      }
    });

    const result = inspectPracticeContext7Readback(packet);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("runtime.failureMatrix.rowCount must be 6");
    expect(result.failures).toContain("runtime.failureMatrix.localCoreUnchanged must be true");
    expect(result.failures).toContain("runtime.failureMatrix.malformed.localCoreUnchanged must be true");
    expect(result.failures).toContain("runtime.failureMatrix.malformed.externalResourceCount must be 0");
    expect(result.failures).toContain("assertions.failureMatrixKeepsLocalCoreUnchanged must be true");
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

  test("accepts verified live Context7 packet with public fixture and community disclaimer", () => {
    expect(inspectLivePracticeContext7Readback(verifiedLivePracticeContext7Fixture())).toMatchObject({
      ok: true,
      schemaVersion: "archcontext.practice-context7-live-readback/v1",
      libraryId: "/vercel/next.js",
      version: "v15.1.8",
      snippetCount: 2,
      failures: []
    });
  });

  test("rejects live Context7 packet without exact version or disclaimer", () => {
    const result = inspectLivePracticeContext7Readback(verifiedLivePracticeContext7Fixture({
      fixture: {
        ...(verifiedLivePracticeContext7Fixture().fixture as any),
        version: "latest"
      },
      resolve: {
        ...(verifiedLivePracticeContext7Fixture().resolve as any),
        selectedVersionPresent: false
      },
      disclaimer: {
        ...(verifiedLivePracticeContext7Fixture().disclaimer as any),
        accuracyNotGuaranteed: false,
        notEndToEndAuditable: false,
        statement: "Context7 community documentation is advisory."
      },
      assertions: {
        ...(verifiedLivePracticeContext7Fixture().assertions as any),
        exactVersionRecorded: false,
        accuracyNotGuaranteed: false,
        doesNotClaimEndToEndAuditable: false
      }
    }));

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("fixture.version must be v15.1.8");
    expect(result.failures).toContain("resolve.selectedVersionPresent must be true");
    expect(result.failures).toContain("disclaimer.accuracyNotGuaranteed must be true");
    expect(result.failures).toContain("disclaimer.notEndToEndAuditable must be true");
    expect(result.failures).toContain("disclaimer.statement must record accuracy is not guaranteed");
    expect(result.failures).toContain("disclaimer.statement must record the readback is not end-to-end auditable");
    expect(result.failures).toContain("assertions.exactVersionRecorded must be true");
    expect(result.failures).toContain("assertions.accuracyNotGuaranteed must be true");
    expect(result.failures).toContain("assertions.doesNotClaimEndToEndAuditable must be true");
  });
});
