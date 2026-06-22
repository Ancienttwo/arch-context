import { describe, expect, test } from "bun:test";
import {
  buildMissingRolloutReadback,
  buildRolloutReadback,
  inspectFg6RolloutReadback,
  rolloutEvidenceTemplate,
  verifiedRolloutEvidenceFixture
} from "./fg6-rollout-readback";

describe("fg6 rollout readback evidence", () => {
  test("accepts ordered production rollout evidence", () => {
    const recording = buildRolloutReadback(verifiedRolloutEvidenceFixture(), config());

    expect(recording.ok).toBe(true);
    expect(recording.status).toBe("verified");
    expect(inspectFg6RolloutReadback(recording)).toEqual({ ok: true, failures: [] });
  });

  test("template is a blocked draft rather than fabricated production evidence", () => {
    const recording = buildRolloutReadback(rolloutEvidenceTemplate(), config());

    expect(recording.ok).toBe(false);
    expect(recording.status).toBe("blocked");
    expect(recording.failures).toContain("all rollout phases must be completed");
    expect(recording.failures).toContain("design partner rollout evidence is missing");
  });

  test("rejects missing design partner evidence and unsafe rollout signals", () => {
    const packet: any = verifiedRolloutEvidenceFixture();
    packet.evidenceClass = "E3";
    packet.homeUrl = "https://wrong.example.com";
    packet.phases[1].id = "opt-in-beta";
    packet.phases[1].startedAt = "2026-06-19T00:00:00.000Z";
    packet.phases[2].enabledFlags.requiredTrust = false;
    packet.metrics.designPartnerInstallations = 0;
    packet.metrics.optInBetaInstallations = 0;
    packet.metrics.p0Incidents = 1;
    packet.metrics.privacyIncidents = 1;
    packet.metrics.wrongTrustPasses = 1;
    packet.metrics.requiredCheckSuccessRate = 0.9;
    packet.metrics.checkDeliveryP95Ms = 70000;
    packet.metrics.webhookP95Ms = 2500;
    packet.controls.featureFlagsDoNotBypassPrivacy = false;
    packet.leak = "Bearer abcdefghijklmnopqrstuvwxyz123456";
    packet.sourceBody = "private source";

    const recording = buildRolloutReadback(packet, config());
    const result = inspectFg6RolloutReadback(recording);

    expect(recording.ok).toBe(false);
    expect(recording.status).toBe("blocked");
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("status must be verified ok");
    expect(result.failures).toContain("rollout phases must be internal -> design-partners -> opt-in-beta");
    expect(result.failures).toContain("rollout phase timestamps must be ordered");
    expect(result.failures).toContain("design partner rollout evidence is missing");
    expect(result.failures).toContain("opt-in beta rollout evidence is missing");
    expect(result.failures).toContain("P0/P1 incidents must be zero");
    expect(result.failures).toContain("privacy incidents and source leaks must be zero");
    expect(result.failures).toContain("wrong-trust passes must be zero");
    expect(result.failures).toContain("required check success rate below target");
    expect(result.failures).toContain("Check delivery p95 exceeds PRD budget");
    expect(result.failures).toContain("webhook p95 exceeds PRD budget");
    expect(result.failures).toContain("rollout control missing: featureFlagsDoNotBypassPrivacy");
    expect(result.failures).toContain("assertion productionEvidence must be true");
    expect(result.failures).toContain("assertion homeUrlCorrect must be true");
    expect(result.failures).toContain("assertion noPrivateContent must be true");
  });

  test("records a blocked state when the source packet is missing", () => {
    const recording = buildMissingRolloutReadback(config());
    const result = inspectFg6RolloutReadback(recording);

    expect(recording.ok).toBe(false);
    expect(recording.status).toBe("blocked");
    expect(recording.failures).toContain("source packet missing: _ops/env/fg6-rollout-evidence.json");
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("status must be verified ok");
    expect(result.failures).toContain("design partner rollout evidence is missing");
    expect(result.failures).toContain("opt-in beta rollout evidence is missing");
  });
});

function config() {
  return {
    inputPath: "_ops/env/fg6-rollout-evidence.json",
    reportPath: "docs/verification/fg6-rollout-evidence-intake.md",
    generatedAt: () => "2026-06-22T12:00:00.000Z"
  };
}
