#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const commands = [
  command("bun", ["run", "verify"]),
  command("bun", ["scripts/fg3-real-pr-synchronize-e2e.ts", "inspect", "--evidence", "docs/verification/fg3-real-pr-synchronize-e2e.json", "--json"]),
  command("bun", ["scripts/fg4-public-fork-adversarial-readback.ts", "inspect", "--evidence", "docs/verification/fg4-public-fork-adversarial-readback.json", "--json"]),
  command("bun", ["scripts/fg5-check-failure-readback.ts", "inspect", "--evidence", "docs/verification/fg5-check-failure-readback.json", "--json"]),
  command("bun", ["scripts/fg5-retention-staging-readback.ts", "inspect", "--evidence", "docs/verification/fg5-retention-staging-readback.json", "--json"]),
  command("bun", ["scripts/fg5-control-plane-incident-drill.ts", "inspect", "--evidence", "docs/verification/fg5-control-plane-incident-drill.json", "--json"]),
  command("bun", ["scripts/fg5-full-plane-dlp-readback.ts", "inspect", "--evidence", "docs/verification/fg5-full-plane-dlp-readback.json", "--json"]),
  command("bun", ["scripts/fg6-local-no-cloud-readback.ts", "inspect", "--evidence", "docs/verification/fg6-local-no-cloud-readback.json", "--json"]),
  command("bun", ["scripts/fg6-developer-review-provenance-readback.ts", "inspect", "--evidence", "docs/verification/fg6-developer-review-provenance-readback.json", "--json"]),
  command("bun", ["scripts/fg6-new-commit-invalidation-readback.ts", "inspect", "--evidence", "docs/verification/fg6-new-commit-invalidation-readback.json", "--json"]),
  command("bun", ["scripts/fg6-organization-runner-no-llm-readback.ts", "inspect", "--evidence", "docs/verification/fg6-organization-runner-no-llm-readback.json", "--json"]),
  command("bun", ["scripts/fg6-privacy-dlp-readback.ts", "inspect", "--evidence", "docs/verification/fg6-privacy-dlp-readback.json", "--json"]),
  command("bun", ["scripts/fg6-no-provider-deterministic-readback.ts", "inspect", "--evidence", "docs/verification/fg6-no-provider-deterministic-readback.json", "--json"]),
  command("bun", ["scripts/fg6-platform-workflow-matrix-readback.ts", "inspect", "--evidence", "docs/verification/fg6-platform-workflow-matrix-readback.json", "--json"], {
    requiresCompletedLedgerIds: ["FG6-EG2"]
  }),
  command("bun", ["scripts/fg6-adversarial-governance-matrix-readback.ts", "inspect", "--evidence", "docs/verification/fg6-adversarial-governance-matrix-readback.json", "--json"]),
  command("bun", ["scripts/fg6-chaos-fault-matrix-readback.ts", "inspect", "--evidence", "docs/verification/fg6-chaos-fault-matrix-readback.json", "--json"]),
  command("bun", ["scripts/fg6-security-release-readback.ts", "inspect", "--evidence", "docs/verification/fg6-security-release-readback.json", "--json"]),
  command("bun", ["scripts/fg6-external-security-review-readback.ts", "inspect", "--evidence", "docs/verification/fg6-external-security-review-readback.json", "--json"]),
  command("bun", ["scripts/fg6-representative-benchmark-readback.ts", "inspect", "--evidence", "docs/verification/fg6-representative-benchmark-readback.json", "--json"]),
  command("bun", ["scripts/fg6-slo-readback.ts", "inspect", "--evidence", "docs/verification/fg6-slo-readback.json", "--json"]),
  command("bun", ["scripts/fg6-retention-deletion-readback.ts", "inspect", "--evidence", "docs/verification/fg6-retention-deletion-readback.json", "--json"]),
  command("bun", ["scripts/fg6-ops-runbook-readback.ts", "inspect", "--evidence", "docs/verification/fg6-ops-runbook-readback.json", "--json"]),
  command("bun", ["scripts/fg6-feature-flag-readback.ts", "inspect", "--evidence", "docs/verification/fg6-feature-flag-readback.json", "--json"]),
  command("bun", ["scripts/fg6-rollback-compat-readback.ts", "inspect", "--evidence", "docs/verification/fg6-rollback-compat-readback.json", "--json"])
];

const results = [];
const ledgerStatuses = readLedgerStatuses();
for (const entry of commands) {
  const skipReason = skipReasonFor(entry, ledgerStatuses);
  if (skipReason) {
    const result = {
      command: [entry.command, ...entry.args].join(" "),
      exitCode: 0,
      durationMs: 0,
      skipped: true,
      reason: skipReason
    };
    results.push(result);
    console.log(`[verify-governance] skipped pending evidence: ${result.command} (${skipReason})`);
    continue;
  }

  const startedAt = Date.now();
  const child = spawnSync(entry.command, entry.args, {
    stdio: "inherit",
    env: process.env,
    shell: false
  });
  const result = {
    command: [entry.command, ...entry.args].join(" "),
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
  skippedCount: results.filter((result) => result.skipped === true).length,
  results
}, null, 2));

function command(command, args, options = {}) {
  return { command, args, ...options };
}

function readLedgerStatuses() {
  const ledger = JSON.parse(readFileSync("docs/verification/acceptance-ledger.json", "utf8"));
  return new Map((ledger.entries ?? []).map((entry) => [entry.id, entry.status]));
}

function skipReasonFor(entry, ledgerStatuses) {
  const pendingIds = (entry.requiresCompletedLedgerIds ?? []).filter((id) => ledgerStatuses.get(id) !== "completed");
  return pendingIds.length > 0 ? `waiting for completed acceptance ledger entries: ${pendingIds.join(", ")}` : "";
}
