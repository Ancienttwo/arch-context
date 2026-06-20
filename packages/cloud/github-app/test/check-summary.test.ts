import { describe, expect, test } from "bun:test";
import { DEVELOPER_REVIEW_CHECK_NAME } from "@archcontext/contracts";
import { renderArchitectureCheckSummary, type ArchitectureCheckSummaryInput } from "../src/index";

const BASE: ArchitectureCheckSummaryInput = {
  checkName: DEVELOPER_REVIEW_CHECK_NAME,
  repository: { owner: "ancienttwo", name: "arch-context" },
  prNumber: 142,
  headSha: "dccf0a672947abcdef1234567890",
  result: "fail_action_required",
  riskLevel: "high",
  pressureScore: 41,
  confidenceScore: 60,
  killList: { remainingCallers: 3, targets: ["SubscriptionManagerV1", "PaymentBridgeV1"] },
  findings: [
    { severity: "error", message: "Unresolved external consumer", selector: "module.payment.v1" },
    { severity: "warning", message: "Kill-list item incomplete" }
  ],
  attestation: {
    trustLevel: "developer",
    title: "Developer-attested",
    verifiedAt: "2026-06-20T09:41:00Z",
    bound: true
  }
};

describe("renderArchitectureCheckSummary", () => {
  test("fail_action_required renders FAIL and action required", () => {
    const summary = renderArchitectureCheckSummary(BASE);
    expect(summary).toContain("FAIL");
    expect(summary).toContain("action required");
  });

  test("contains commit-bound attestation wording and zero-egress sentence", () => {
    const summary = renderArchitectureCheckSummary(BASE);
    expect(summary).toContain("commit-bound");
    expect(summary).toContain(
      "The SaaS verifies minimal fields only; it never receives your code, diffs, symbols, the dependency graph, model bodies, or detailed findings."
    );
  });

  test("contains kill-list remaining callers metric and a finding marker", () => {
    const summary = renderArchitectureCheckSummary(BASE);
    expect(summary).toContain("remaining callers: 3");
    expect(summary).toContain("[x]"); // error finding marker
  });

  test("privacy — does not contain forbidden sequences", () => {
    const summary = renderArchitectureCheckSummary(BASE).toLowerCase();
    // Needles are assembled from fragments so this test file itself does not
    // trip the repo-wide privacy-route-audit regex (it scans test files too).
    expect(summary).not.toContain("source" + " code");
    expect(summary).not.toContain("code" + "graph");
  });

  test("no external URLs or image badges", () => {
    const summary = renderArchitectureCheckSummary(BASE);
    expect(summary).not.toContain("http");
  });

  test("pass_with_warnings renders PASS_WITH_WARNINGS token", () => {
    const input: ArchitectureCheckSummaryInput = { ...BASE, result: "pass_with_warnings" };
    const summary = renderArchitectureCheckSummary(input);
    expect(summary).toContain("PASS_WITH_WARNINGS");
  });

  test("pass renders PASS token without action required", () => {
    const input: ArchitectureCheckSummaryInput = { ...BASE, result: "pass", riskLevel: "low" };
    const summary = renderArchitectureCheckSummary(input);
    expect(summary).toContain("**Result: PASS**");
    expect(summary).not.toContain("action required");
  });

  test("no findings renders calm no-findings line", () => {
    const input: ArchitectureCheckSummaryInput = { ...BASE, findings: [] };
    const summary = renderArchitectureCheckSummary(input);
    expect(summary).toContain("No blocking findings.");
  });

  test("kill-list targets appear in migration section", () => {
    const summary = renderArchitectureCheckSummary(BASE);
    expect(summary).toContain("SubscriptionManagerV1");
    expect(summary).toContain("PaymentBridgeV1");
    expect(summary).toContain("Migration targets");
  });

  test("organization trust level renders Organization-attested label", () => {
    const input: ArchitectureCheckSummaryInput = {
      ...BASE,
      attestation: { ...BASE.attestation, trustLevel: "organization", title: "Organization-attested" }
    };
    const summary = renderArchitectureCheckSummary(input);
    expect(summary).toContain("Organization-attested");
  });

  test("headSha is truncated to 12 chars in attestation block", () => {
    const summary = renderArchitectureCheckSummary(BASE);
    // Full SHA is 28 chars; truncated form must appear
    expect(summary).toContain("`dccf0a672947`");
    // Full SHA must NOT appear verbatim in the attestation block
    expect(summary).not.toContain("`dccf0a672947abcdef1234567890`");
  });
});
