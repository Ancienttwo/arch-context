import { describe, expect, test } from "bun:test";
import {
  buildPracticeAssetsS6EvalReadbackPacket,
  inspectPracticeAssetsS6EvalReadback
} from "./practice-assets-s6-eval-readback";

describe("practice-assets-s6-eval-readback", () => {
  test("accepts the built S6 eval packet", () => {
    expect(inspectPracticeAssetsS6EvalReadback(buildPracticeAssetsS6EvalReadbackPacket())).toMatchObject({
      ok: true,
      positiveCases: 60,
      negativeCases: 80,
      adversarialCases: 20,
      failures: []
    });
  });

  test("rejects an undersized practice dataset packet", () => {
    const packet = buildPracticeAssetsS6EvalReadbackPacket();
    packet.status = "failed";
    packet.summary.positiveCases = 59;
    packet.assertions.positiveCaseMinimum = false;

    const result = inspectPracticeAssetsS6EvalReadback(packet);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("status must be verified");
    expect(result.failures).toContain("summary.positiveCases below S6 minimum");
    expect(result.failures).toContain("assertions.positiveCaseMinimum must be true");
  });

  test("rejects failed gate evidence", () => {
    const packet = buildPracticeAssetsS6EvalReadbackPacket();
    packet.status = "failed";
    packet.failedGates = [{
      target: "Practice Top-3 recall",
      metric: "recall @ top-k 3",
      threshold: ">= 92.0%",
      observed: "0.0%",
      pass: false
    }];
    packet.assertions.noFailedGates = false;

    const result = inspectPracticeAssetsS6EvalReadback(packet);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("failed gates present: Practice Top-3 recall");
    expect(result.failures).toContain("assertions.noFailedGates must be true");
  });
});
