import { describe, expect, test } from "bun:test";
import {
  buildPracticeAssetsS6CatalogReadbackPacket,
  inspectPracticeAssetsS6CatalogReadback
} from "./practice-assets-s6-catalog-readback";

describe("practice-assets-s6-catalog-readback", () => {
  test("accepts the built-in S6 catalog scale packet", () => {
    expect(inspectPracticeAssetsS6CatalogReadback(buildPracticeAssetsS6CatalogReadbackPacket())).toMatchObject({
      ok: true,
      practiceCount: 41,
      activePracticeCount: 40,
      profileCount: 8,
      sourceCount: 19,
      failures: []
    });
  });

  test("rejects an undersized catalog packet", () => {
    const packet = buildPracticeAssetsS6CatalogReadbackPacket();
    packet.status = "failed";
    packet.summary.practiceCount = 39;
    packet.assertions.practiceCountInRange = false;

    const result = inspectPracticeAssetsS6CatalogReadback(packet);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("status must be verified");
    expect(result.failures).toContain("summary.practiceCount must be between 40 and 60");
    expect(result.failures).toContain("assertions.practiceCountInRange must be true");
  });

  test("rejects reference-only source use", () => {
    const packet = buildPracticeAssetsS6CatalogReadbackPacket();
    const owasp = packet.summary.referenceOnlySources.find((source) => source.id === "owasp.cheat-sheet-series");
    expect(owasp).toBeDefined();
    owasp!.usedByPracticeIds = ["security.example"];
    packet.assertions.referenceOnlySourcesUnused = false;
    packet.assertions.shareAlikeSourcesReferenceOnly = false;

    const result = inspectPracticeAssetsS6CatalogReadback(packet);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("reference-only source owasp.cheat-sheet-series is used by practices: security.example");
    expect(result.failures).toContain("assertions.referenceOnlySourcesUnused must be true");
    expect(result.failures).toContain("assertions.shareAlikeSourcesReferenceOnly must be true");
  });

  test("rejects a stale static manifest readback", () => {
    const packet = buildPracticeAssetsS6CatalogReadbackPacket();
    packet.staticManifestDigest = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    packet.assertions.manifestMatchesStaticCatalog = false;

    const result = inspectPracticeAssetsS6CatalogReadback(packet);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("manifestDigest must match staticManifestDigest");
    expect(result.failures).toContain("assertions.manifestMatchesStaticCatalog must be true");
  });
});
