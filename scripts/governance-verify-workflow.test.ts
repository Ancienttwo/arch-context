import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

const PACKAGE_JSON = readFileSync("package.json", "utf8");
const WORKFLOW = readFileSync(".github/workflows/verify.yml", "utf8");
const VERIFY_GOVERNANCE = readFileSync("scripts/verify-governance.mjs", "utf8");
const ARCHITECTURE_INDEX = readFileSync("docs/architecture/index.md", "utf8");
const SCRIPT_SURFACE_POLICY = readFileSync("docs/architecture/script-surface-policy.md", "utf8");
const ROOT_PACKAGE = JSON.parse(PACKAGE_JSON) as { scripts?: Record<string, string> };

interface ScriptOwnerCorpus {
  packageJson: string;
  workflow: string;
  docsVerification: string;
  docsRunbooks: string;
  acceptanceLedger: string;
}

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

  test("keeps the script surface policy discoverable and enforceable", () => {
    expect(ARCHITECTURE_INDEX).toContain("[`script-surface-policy.md`](script-surface-policy.md)");
    expect(SCRIPT_SURFACE_POLICY).toContain("Every non-test file under `scripts/` must be owned");
    expect(SCRIPT_SURFACE_POLICY).toContain("Tests alone are not an ownership surface");
    expect(SCRIPT_SURFACE_POLICY).toContain("Root `record:*` and `readback:*` aliases must be referenced outside `package.json`");
    expect(SCRIPT_SURFACE_POLICY).toContain("Deletion Gate");
    expect(SCRIPT_SURFACE_POLICY).toContain("bun test scripts/governance-verify-workflow.test.ts");
  });

  test("keeps root record and readback aliases externally referenced", () => {
    const repoText = readRepoTextFilesExcludingPackageJson();
    const unreferencedAliases = Object.keys(ROOT_PACKAGE.scripts ?? {})
      .filter((alias) => alias.startsWith("record:") || alias.startsWith("readback:"))
      .filter((alias) => !repoText.includes(alias));

    expect(unreferencedAliases).toEqual([]);
  });

  test("requires every non-test script to have a live ownership surface", () => {
    const scripts = listScriptFiles();
    const nonTestScripts = scripts.filter((script) => !isTestScript(script));
    const docsVerification = readTextFiles("docs/verification");
    const docsRunbooks = readTextFiles("docs/runbooks");
    const acceptanceLedger = readFileSync("docs/verification/acceptance-ledger.json", "utf8");
    const failures: string[] = [];

    for (const script of nonTestScripts) {
      const owners = scriptOwners(script, scripts, {
        packageJson: PACKAGE_JSON,
        workflow: WORKFLOW,
        docsVerification,
        docsRunbooks,
        acceptanceLedger
      });
      if (owners.length === 0) {
        failures.push(script);
      }
    }

    expect(failures).toEqual([]);
  });
});

function listScriptFiles(): string[] {
  return readdirSync("scripts")
    .map((name) => join("scripts", name).replaceAll("\\", "/"))
    .filter((path) => statSync(path).isFile())
    .sort();
}

function isTestScript(path: string): boolean {
  return /\.test\.(?:ts|mjs|js)$/.test(path);
}

function readTextFiles(root: string): string {
  const texts = [];
  for (const path of listFiles(root)) {
    texts.push(readFileSync(path, "utf8"));
  }
  return texts.join("\n");
}

function listFiles(root: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) {
      files.push(...listFiles(path));
    } else {
      files.push(path);
    }
  }
  return files.sort();
}

function readRepoTextFilesExcludingPackageJson(): string {
  return listRepoTextFiles(".")
    .filter((path) => path !== "package.json")
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

function listRepoTextFiles(root: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(root)) {
    if ([".git", ".codegraph", "node_modules", "_ops", "_ref"].includes(name)) continue;
    const path = join(root, name);
    if (statSync(path).isDirectory()) {
      files.push(...listRepoTextFiles(path));
    } else if (isTextFile(path)) {
      files.push(path.startsWith("./") ? path.slice(2) : path);
    }
  }
  return files.sort();
}

function isTextFile(path: string): boolean {
  return /\.(?:css|html|js|json|jsonc|md|mjs|sql|toml|ts|txt|yaml|yml)$/.test(path);
}

function scriptOwners(script: string, scripts: string[], corpus: ScriptOwnerCorpus): string[] {
  const owners: string[] = [];
  if (corpus.packageJson.includes(script)) owners.push("package.json");
  if (corpus.workflow.includes(script)) owners.push("workflow");
  if (scriptIsImported(script, scripts)) owners.push("script-import");
  if (corpus.docsVerification.includes(script)) owners.push("docs/verification");
  if (corpus.docsRunbooks.includes(script)) owners.push("docs/runbooks");
  if (corpus.acceptanceLedger.includes(script)) owners.push("acceptance-ledger");
  return owners;
}

function scriptIsImported(script: string, scripts: string[]): boolean {
  const extension = extname(script);
  const importTarget = `./${basename(script, extension)}`;
  const importPattern = new RegExp(
    String.raw`(?:from\s+|import\(\s*|require\(\s*)["']${escapeRegExp(importTarget)}(?:${escapeRegExp(extension)})?["']`
  );
  return scripts
    .filter((candidate) => candidate !== script && !isTestScript(candidate))
    .some((candidate) => importPattern.test(readFileSync(candidate, "utf8")));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
