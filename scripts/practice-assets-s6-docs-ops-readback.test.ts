import { describe, expect, test } from "bun:test";
import {
  inspectPracticeAssetsS6DocsOpsReadback,
  verifiedPracticeAssetsS6DocsOpsFixture
} from "./practice-assets-s6-docs-ops-readback";

describe("practice-assets-s6-docs-ops-readback", () => {
  test("accepts a complete S6 docs ops packet", () => {
    expect(inspectPracticeAssetsS6DocsOpsReadback(verifiedPracticeAssetsS6DocsOpsFixture())).toEqual({
      ok: true,
      failures: []
    });
  });

  test("rejects incomplete docs and operations gates", () => {
    const packet: any = verifiedPracticeAssetsS6DocsOpsFixture();
    packet.evidence.documentation.repoPracticeHowTo = false;
    packet.evidence.independentDisable.context7FailureMatrixLeavesLocalCoreUnchanged = false;
    packet.evidence.centralHook.hookZeroNetwork = false;
    packet.evidence.operations.staleCatalogDetected = false;
    packet.evidence.assertions.documentationComplete = false;
    packet.evidence.assertions.independentDisableComplete = false;
    packet.evidence.assertions.centralHookComplete = false;
    packet.evidence.assertions.operationsComplete = false;

    const result = inspectPracticeAssetsS6DocsOpsReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("documentation.repoPracticeHowTo must be true");
    expect(result.failures).toContain("independentDisable.context7FailureMatrixLeavesLocalCoreUnchanged must be true");
    expect(result.failures).toContain("centralHook.hookZeroNetwork must be true");
    expect(result.failures).toContain("operations.staleCatalogDetected must be true");
    expect(result.failures).toContain("assertion documentationComplete must be true");
  });
});
