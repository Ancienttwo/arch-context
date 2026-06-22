#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const commands = [
  ["bun", ["run", "verify"]],
  ["bun", ["scripts/fg3-real-pr-synchronize-e2e.ts", "inspect", "--evidence", "docs/verification/fg3-real-pr-synchronize-e2e.json", "--json"]],
  ["bun", ["scripts/fg4-public-fork-adversarial-readback.ts", "inspect", "--evidence", "docs/verification/fg4-public-fork-adversarial-readback.json", "--json"]],
  ["bun", ["scripts/fg5-check-failure-readback.ts", "inspect", "--evidence", "docs/verification/fg5-check-failure-readback.json", "--json"]],
  ["bun", ["scripts/fg5-retention-staging-readback.ts", "inspect", "--evidence", "docs/verification/fg5-retention-staging-readback.json", "--json"]],
  ["bun", ["scripts/fg5-control-plane-incident-drill.ts", "inspect", "--evidence", "docs/verification/fg5-control-plane-incident-drill.json", "--json"]],
  ["bun", ["scripts/fg5-full-plane-dlp-readback.ts", "inspect", "--evidence", "docs/verification/fg5-full-plane-dlp-readback.json", "--json"]],
  ["bun", ["scripts/fg6-local-no-cloud-readback.ts", "inspect", "--evidence", "docs/verification/fg6-local-no-cloud-readback.json", "--json"]],
  ["bun", ["scripts/fg6-developer-review-provenance-readback.ts", "inspect", "--evidence", "docs/verification/fg6-developer-review-provenance-readback.json", "--json"]],
  ["bun", ["scripts/fg6-new-commit-invalidation-readback.ts", "inspect", "--evidence", "docs/verification/fg6-new-commit-invalidation-readback.json", "--json"]],
  ["bun", ["scripts/fg6-organization-runner-no-llm-readback.ts", "inspect", "--evidence", "docs/verification/fg6-organization-runner-no-llm-readback.json", "--json"]],
  ["bun", ["scripts/fg6-privacy-dlp-readback.ts", "inspect", "--evidence", "docs/verification/fg6-privacy-dlp-readback.json", "--json"]],
  ["bun", ["scripts/fg6-no-provider-deterministic-readback.ts", "inspect", "--evidence", "docs/verification/fg6-no-provider-deterministic-readback.json", "--json"]],
  ["bun", ["scripts/fg6-platform-workflow-matrix-readback.ts", "inspect", "--evidence", "docs/verification/fg6-platform-workflow-matrix-readback.json", "--json"]],
  ["bun", ["scripts/fg6-adversarial-governance-matrix-readback.ts", "inspect", "--evidence", "docs/verification/fg6-adversarial-governance-matrix-readback.json", "--json"]],
  ["bun", ["scripts/fg6-chaos-fault-matrix-readback.ts", "inspect", "--evidence", "docs/verification/fg6-chaos-fault-matrix-readback.json", "--json"]],
  ["bun", ["scripts/fg6-security-release-readback.ts", "inspect", "--evidence", "docs/verification/fg6-security-release-readback.json", "--json"]],
  ["bun", ["scripts/fg6-external-security-review-readback.ts", "inspect", "--evidence", "docs/verification/fg6-external-security-review-readback.json", "--json"]],
  ["bun", ["scripts/fg6-representative-benchmark-readback.ts", "inspect", "--evidence", "docs/verification/fg6-representative-benchmark-readback.json", "--json"]],
  ["bun", ["scripts/fg6-slo-readback.ts", "inspect", "--evidence", "docs/verification/fg6-slo-readback.json", "--json"]],
  ["bun", ["scripts/fg6-retention-deletion-readback.ts", "inspect", "--evidence", "docs/verification/fg6-retention-deletion-readback.json", "--json"]],
  ["bun", ["scripts/fg6-ops-runbook-readback.ts", "inspect", "--evidence", "docs/verification/fg6-ops-runbook-readback.json", "--json"]],
  ["bun", ["scripts/fg6-feature-flag-readback.ts", "inspect", "--evidence", "docs/verification/fg6-feature-flag-readback.json", "--json"]],
  ["bun", ["scripts/fg6-rollback-compat-readback.ts", "inspect", "--evidence", "docs/verification/fg6-rollback-compat-readback.json", "--json"]]
];

const results = [];
for (const [command, args] of commands) {
  const startedAt = Date.now();
  const child = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    shell: false
  });
  const result = {
    command: [command, ...args].join(" "),
    exitCode: child.status ?? 1,
    durationMs: Date.now() - startedAt
  };
  results.push(result);
  if (result.exitCode !== 0) {
    console.error(`[verify-governance] failed: ${result.command}`);
    process.exit(result.exitCode);
  }
}

console.log(JSON.stringify({
  schemaVersion: "archcontext.verify-governance/v1",
  status: "verified",
  ok: true,
  commandCount: results.length,
  results
}, null, 2));
