#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyGovernancePrerequisite } from "./verify-ci.mjs";

export const GOVERNANCE_COMMANDS = [
  command("bun", ["run", "verify"])
];

export function runGovernanceCommands(commands, { spawn = spawnSync, env = process.env, logger = console } = {}) {
  const results = [];
  for (const entry of commands) {
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

function command(command, args) {
  return { command, args };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = error.exitCode ?? 1; });
}
