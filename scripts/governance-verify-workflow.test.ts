import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const PACKAGE_JSON = readFileSync("package.json", "utf8");
const WORKFLOW = readFileSync(".github/workflows/verify.yml", "utf8");
const VERIFY_GOVERNANCE = readFileSync("scripts/verify-governance.mjs", "utf8");

describe("governance verify workflow", () => {
  test("exposes a root verify:governance command and CI job", () => {
    expect(PACKAGE_JSON).toContain('"verify:governance": "node scripts/verify-governance.mjs"');
    expect(WORKFLOW).toContain("governance-verify:");
    expect(WORKFLOW).toContain("name: Governance Verify");
    expect(WORKFLOW).toContain("run: bun run verify:governance");
    expect(WORKFLOW).toContain("node-version: 24.x");
  });

  test("keeps governance verify local and evidence-inspection only after full verify", () => {
    expect(VERIFY_GOVERNANCE).toContain('"run", "verify"');
    expect(VERIFY_GOVERNANCE).toContain("requiresCompletedLedgerIds");
    expect(VERIFY_GOVERNANCE).toContain("FG6-EG2");
    expect(VERIFY_GOVERNANCE).toContain("skipped pending evidence");
    for (const evidence of [
      "docs/verification/fg3-real-pr-synchronize-e2e.json",
      "docs/verification/fg4-public-fork-adversarial-readback.json",
      "docs/verification/fg5-check-failure-readback.json",
      "docs/verification/fg5-retention-staging-readback.json",
      "docs/verification/fg5-control-plane-incident-drill.json",
      "docs/verification/fg5-full-plane-dlp-readback.json",
      "docs/verification/fg6-local-no-cloud-readback.json",
      "docs/verification/fg6-developer-review-provenance-readback.json",
      "docs/verification/fg6-new-commit-invalidation-readback.json",
      "docs/verification/fg6-organization-runner-no-llm-readback.json",
      "docs/verification/fg6-privacy-dlp-readback.json",
      "docs/verification/fg6-no-provider-deterministic-readback.json",
      "docs/verification/fg6-platform-workflow-matrix-readback.json",
      "docs/verification/fg6-adversarial-governance-matrix-readback.json",
      "docs/verification/fg6-chaos-fault-matrix-readback.json",
      "docs/verification/fg6-security-release-readback.json",
      "docs/verification/fg6-external-security-review-readback.json",
      "docs/verification/fg6-representative-benchmark-readback.json",
      "docs/verification/fg6-slo-readback.json",
      "docs/verification/fg6-retention-deletion-readback.json",
      "docs/verification/fg6-ops-runbook-readback.json",
      "docs/verification/fg6-feature-flag-readback.json",
      "docs/verification/fg6-rollback-compat-readback.json"
    ]) {
      expect(VERIFY_GOVERNANCE).toContain(evidence);
    }
    expect(VERIFY_GOVERNANCE).not.toContain("_ops/env");
    expect(VERIFY_GOVERNANCE).not.toContain("wrangler deploy");
  });
});
