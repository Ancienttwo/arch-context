#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const defaultOut = resolve(root, "docs/verification/data-engine-de3-readback.json");
const defaultReport = resolve(root, "docs/verification/data-engine-de3-readback.md");
const mode = process.argv[2] ?? "inspect";
const out = argumentPath("--out", defaultOut);
const report = argumentPath("--report", defaultReport);

const verificationCommands = [
  ["bun", "run", "typecheck"],
  ["bun", "run", "check:package-boundaries"],
  ["bun", "test", "packages/contracts/test/contracts.test.ts", "packages/local-runtime/local-store-sqlite", "packages/local-runtime/runtime-daemon", "packages/surfaces/cli/test/cli.test.ts", "scripts/architecture-ledger-al10-release-packaging-readback.test.ts"],
  ["bun", "run", "verify:explorer"],
  ["node", "scripts/packaged-cli-smoke.mjs"]
] as const;

if (mode === "run") {
  const commands = verificationCommands.map((command) => execute(command));
  const contractPreflight = execute([
    "repo-harness", "run", "contract-run", "preflight",
    "--contract", "tasks/contracts/20260711-1749-data-engine-de3-manifest-cache.contract.md",
    "--json"
  ]);
  const contractsSource = await source("packages/contracts/src/ports.ts");
  const compilerSource = await source("packages/local-runtime/runtime-daemon/src/explorer-projection.ts");
  const daemonSource = await source("packages/local-runtime/runtime-daemon/src/index.ts");
  const storeSource = await source("packages/local-runtime/local-store-sqlite/src/index.ts");
  const compilerTest = await source("packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts");
  const daemonTest = await source("packages/local-runtime/runtime-daemon/test/local-runtime.test.ts");
  const storeTest = await source("packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts");
  const artifact = {
    schemaVersion: "archcontext.data-engine-de3-readback/v1",
    generatedAt: new Date().toISOString(),
    gitCommit: textCommand(["git", "rev-parse", "HEAD"]),
    branch: textCommand(["git", "branch", "--show-current"]),
    contracts: {
      manifest: "archcontext.projection-input-manifest/v1",
      migration: "0016_manifest_addressed_projection_cache",
      cacheKey: "repository-worktree-manifest-digest",
      deltaCompatibility: "manifest-compatibility-digest"
    },
    invariants: {
      typedViewDomainPolicy: contractsSource.includes("ProjectionInputDomainStateV1")
        && contractsSource.includes("EXPLORER_VIEW_INPUT_REQUIREMENTS")
        && compilerSource.includes("EXPLORER_VIEW_INPUT_REQUIREMENTS")
        && storeSource.includes("EXPLORER_VIEW_INPUT_REQUIREMENTS")
        && contractsSource.includes('"task-session": "required"'),
      requiredDomainsFailClosed: compilerSource.includes("required-input-unavailable")
        && compilerSource.includes("required-input-digest-mismatch:graph")
        && !daemonSource.includes("observed = { task, symbols: [], edges: [], evidence: []"),
      explicitAuthorityBinding: compilerSource.includes('authoritySource: "git" | "ledger"')
        && compilerSource.includes("required-input-unavailable:authority:ledger-cursor-not-provided")
        && compilerSource.includes("cursor.evidenceStateDigest !== input.evidenceStateDigest")
        && daemonSource.includes('authoritySource: authorityCursor ? "ledger" as const : "git" as const'),
      optionalMissingDiffersFromEmpty: compilerSource.includes('reasonCode: "not-provided"')
        && compilerTest.includes("distinguishes an unavailable optional domain from a known-empty domain"),
      exactManifestCacheLookup: storeSource.includes("readExplorerProjectionByManifest")
        && storeSource.includes("idx_explorer_projection_scope_manifest")
        && daemonSource.includes("inputManifest.manifestDigest"),
      storedBodyAndRowIntegrity: storeSource.includes("assertExplorerProjectionCacheIntegrity")
        && storeSource.includes("explorer-projection-cache-row-mismatch")
        && storeSource.includes("explorer-projection-cache-manifest-conflict")
        && storeSource.includes("explorer-projection-cache-schema-invalid")
        && storeSource.includes("explorer-projection-cache-privacy-invalid")
        && storeSource.includes("projection.cursor.authorityCursor")
        && storeSource.includes("explorer-projection-cache-domain-policy-invalid"),
      viewPolicyChangesIdentity: compilerSource.includes("requirements, compilerVersion")
        && compilerTest.includes("binds view-definition identity to the typed domain policy"),
      productionTestStoreParity: storeTest.includes("TestLocalStore enforces production cache scope and body integrity")
        && storeSource.includes("export function assertExplorerProjectionCacheIntegrity"),
      invalidationPrecedesExactHit: daemonSource.indexOf("processArchitectureChangeFeed(root, scope)")
        < daemonSource.indexOf("readExplorerProjectionByManifest"),
      exactHitAndNegativeCoverage: daemonTest.includes("explorerManifestCacheHits")
        && daemonTest.includes("Explorer system-map fails closed when required observed facts are unavailable")
        && storeTest.includes("manifest-addressed cache rejects corrupted rows and nondeterministic output"),
      compatibilityAllowsStateChange: compilerSource.includes("base.cursor.compatibilityDigest !== head.cursor.compatibilityDigest")
        && compilerTest.includes("budget displacement is a projection change, not an architecture-fact removal"),
      migrationIsOneWay: storeSource.includes('id: "0016_manifest_addressed_projection_cache"')
        && storeSource.includes("DELETE FROM explorer_projection_cache")
        && storeTest.includes("manifest cache migration removes pre-manifest rows")
    },
    commands: [...commands, contractPreflight],
    verdict: "FAIL"
  };
  artifact.verdict = commands.every((command) => command.ok)
    && contractPreflight.ok
    && Object.values(artifact.invariants).every(Boolean)
    ? "PASS"
    : "FAIL";
  await Bun.write(out, `${JSON.stringify(artifact, null, 2)}\n`);
  await Bun.write(report, markdownReport(artifact));
  console.log(JSON.stringify(artifact, null, 2));
  process.exit(artifact.verdict === "PASS" ? 0 : 1);
}

if (mode !== "inspect") throw new Error("usage: bun scripts/data-engine-de3-readback.ts run|inspect [--out <path>] [--report <path>]");
if (!existsSync(out)) throw new Error(`DE3 readback not found: ${out}`);
const artifact = await Bun.file(out).json() as any;
const failures: string[] = [];
if (artifact.schemaVersion !== "archcontext.data-engine-de3-readback/v1") failures.push("schemaVersion");
if (artifact.verdict !== "PASS") failures.push("verdict");
for (const [key, value] of Object.entries(artifact.invariants ?? {})) if (value !== true) failures.push(`invariant:${key}`);
for (const command of artifact.commands ?? []) if (command.ok !== true) failures.push(`command:${command.command}`);
if (failures.length > 0) throw new Error(`DE3 readback failed: ${failures.join(", ")}`);
console.log(JSON.stringify({ schemaVersion: artifact.schemaVersion, verdict: artifact.verdict, generatedAt: artifact.generatedAt, inspected: true }, null, 2));

function argumentPath(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return resolve(root, index >= 0 ? process.argv[index + 1]! : fallback);
}

function execute(command: readonly string[]) {
  const startedAt = Date.now();
  const result = Bun.spawnSync([...command], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return {
    command: command.join(" "),
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    durationMs: Date.now() - startedAt,
    stdoutDigest: digest(new TextDecoder().decode(result.stdout)),
    stderrDigest: digest(new TextDecoder().decode(result.stderr))
  };
}

function textCommand(command: string[]): string {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`command failed: ${command.join(" ")}`);
  return new TextDecoder().decode(result.stdout).trim();
}

async function source(path: string): Promise<string> {
  return Bun.file(resolve(root, path)).text();
}

function digest(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return `sha256:${hasher.digest("hex")}`;
}

function markdownReport(artifact: any): string {
  const commands = artifact.commands.map((command: any) => `| \`${command.command}\` | ${command.ok ? "PASS" : "FAIL"} | ${command.durationMs} |`).join("\n");
  const invariants = Object.entries(artifact.invariants).map(([key, value]) => `| ${key} | ${value ? "PASS" : "FAIL"} |`).join("\n");
  return `# Data Engine DE3 Readback\n\n- Verdict: **${artifact.verdict}**\n- Generated: ${artifact.generatedAt}\n- Commit: \`${artifact.gitCommit}\`\n- Branch: \`${artifact.branch}\`\n\n## Invariants\n\n| Invariant | Status |\n|---|---|\n${invariants}\n\n## Commands\n\n| Command | Status | Duration ms |\n|---|---|---:|\n${commands}\n`;
}
