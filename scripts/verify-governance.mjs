#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyGovernancePrerequisite } from "./verify-ci.mjs";

export const GOVERNANCE_COMMANDS = [
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

export function runGovernanceCommands(commands, { ledgerStatuses = readLedgerStatuses(), spawn = spawnSync, env = process.env, logger = console } = {}) {
  const results = [];
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
      logger.log(`[verify-governance] skipped pending evidence: ${result.command} (${skipReason})`);
      continue;
    }

    const startedAt = Date.now();
    const child = spawn(entry.command, entry.args, {
      stdio: "inherit",
      env,
      shell: false
    });
    const result = {
      command: [entry.command, ...entry.args].join(" "),
      exitCode: child.status ?? 1,
      durationMs: Date.now() - startedAt
    };
    results.push(result);
    if (result.exitCode !== 0) {
      logger.error(`[verify-governance] failed: ${result.command}`);
      throw Object.assign(new Error(`Governance command failed: ${result.command}`), { exitCode: result.exitCode });
    }
  }

  const report = {
    schemaVersion: "archcontext.verify-governance/v1",
    status: "verified",
    ok: true,
    commandCount: results.length,
    skippedCount: results.filter((result) => result.skipped === true).length,
    results
  };
  logger.log(JSON.stringify(report, null, 2));
  return report;
}

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 0 && (args.length !== 1 || args[0] !== "--ci-inspect")) throw new Error("Expected no arguments or --ci-inspect");
  if (args.length === 1) {
    // No boolean, cached artifact or local flag can stand in for this provider readback.
    const prerequisite = await verifyGovernancePrerequisite();
    console.log(`[verify-governance] current prerequisite: ${JSON.stringify(prerequisite)}`);
    return runGovernanceCommands(GOVERNANCE_COMMANDS.slice(1));
  }
  return runGovernanceCommands(GOVERNANCE_COMMANDS);
}

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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = error.exitCode ?? 1; });
}
