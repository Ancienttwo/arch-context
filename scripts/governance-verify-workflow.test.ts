import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GOVERNANCE_COMMANDS, runGovernanceCommands } from "./verify-governance.mjs";

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
    expect(WORKFLOW).toContain("run: bun run verify:governance --ci-inspect");
    expect(WORKFLOW).toContain("node-version: 22.22.x");
  });

  test("isolates manual Governance revalidation without bypassing automatic matrix coverage", () => {
    const workflow: any = Bun.YAML.parse(WORKFLOW);
    expect(Object.keys(workflow.on).sort()).toEqual(["pull_request", "push", "workflow_dispatch"]);
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.jobs.verify.if).toBe("github.event_name != 'workflow_dispatch'");
    expect(workflow.jobs["governance-verify"].if).toBe("${{ always() }}");
    expect(workflow.jobs["governance-verify"].needs).toEqual(["verify-linux-full"]);
    expect(workflow.jobs["governance-verify"].steps.at(-1).run).toBe("bun run verify:governance --ci-inspect");
    expect(workflow.jobs["governance-verify"]["timeout-minutes"]).toBe(15);
    expect(workflow.jobs["verify-linux-full"]["timeout-minutes"]).toBe(20);
    expect(workflow.jobs["verify-linux-full"].if).toBeUndefined();
    for (const [id, job] of Object.entries(workflow.jobs) as [string, any][]) {
      if (!["verify-linux-full", "governance-verify"].includes(id)) expect(job.if).toContain("github.event_name != 'workflow_dispatch'");
    }
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency.group).toBe("verify-${{ github.workflow }}-${{ github.event_name }}-${{ github.ref }}");
    expect(workflow.jobs.verify.strategy.matrix.os).toEqual(["ubuntu-latest", "macos-15", "windows-latest"]);
    expect(workflow.jobs.verify.strategy.matrix["node-version"]).toEqual(["22.22.x", "24.x", "25.x"]);
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

  test("preserves the exact full-plus-23 command order, arguments and sole ledger condition", () => {
    const inspections = [
      "fg3-real-pr-synchronize-e2e", "fg4-public-fork-adversarial-readback", "fg5-check-failure-readback",
      "fg5-retention-staging-readback", "fg5-control-plane-incident-drill", "fg5-full-plane-dlp-readback",
      "fg6-local-no-cloud-readback", "fg6-developer-review-provenance-readback", "fg6-new-commit-invalidation-readback",
      "fg6-organization-runner-no-llm-readback", "fg6-privacy-dlp-readback", "fg6-no-provider-deterministic-readback",
      "fg6-platform-workflow-matrix-readback", "fg6-adversarial-governance-matrix-readback", "fg6-chaos-fault-matrix-readback",
      "fg6-security-release-readback", "fg6-external-security-review-readback", "fg6-representative-benchmark-readback",
      "fg6-slo-readback", "fg6-retention-deletion-readback", "fg6-ops-runbook-readback", "fg6-feature-flag-readback", "fg6-rollback-compat-readback"
    ];
    expect(GOVERNANCE_COMMANDS).toEqual([
      { command: "bun", args: ["run", "verify"] },
      ...inspections.map(name => ({ command: "bun", args: [`scripts/${name}.ts`, "inspect", "--evidence", `docs/verification/${name}.json`, "--json"],
        ...(name === "fg6-platform-workflow-matrix-readback" ? { requiresCompletedLedgerIds: ["FG6-EG2"] } : {}) }))
    ]);
    const calls: { command: string; args: string[] }[] = [];
    const env = { VERIFY_TEST_SENTINEL: "preserved" };
    const options = { ledgerStatuses: new Map([["FG6-EG2", "completed"]]), env,
      spawn: ((command: string, args: string[], spawnOptions: any) => {
        expect(spawnOptions).toEqual({ stdio: "inherit", env, shell: false });
        calls.push({ command, args }); return { status: 0 };
      }) as any,
      logger: { ...console, log() {}, error() {} } };
    expect(runGovernanceCommands(GOVERNANCE_COMMANDS, options)).toMatchObject({ commandCount: 24, skippedCount: 0, ok: true });
    expect(calls).toEqual(GOVERNANCE_COMMANDS.map(({ command, args }: any) => ({ command, args })));
    calls.length = 0;
    expect(runGovernanceCommands(GOVERNANCE_COMMANDS.slice(1), options)).toMatchObject({ commandCount: 23, skippedCount: 0, ok: true });
    expect(calls).toEqual(GOVERNANCE_COMMANDS.slice(1).map(({ command, args }: any) => ({ command, args })));
    calls.length = 0;
    expect(runGovernanceCommands(GOVERNANCE_COMMANDS.slice(1), { ...options, ledgerStatuses: new Map() })).toMatchObject({ commandCount: 23, skippedCount: 1 });
    expect(calls).toHaveLength(22);
    expect(calls.some(call => call.args[0] === "scripts/fg6-platform-workflow-matrix-readback.ts")).toBe(false);
  });

  test("a failed full verify or inspection stops the real runner before later commands", () => {
    for (const start of [0, 1]) for (const failedIndex of [0, 3]) {
      const calls: string[] = [];
      const commands = GOVERNANCE_COMMANDS.slice(start);
      const run = () => runGovernanceCommands(commands, {
        ledgerStatuses: new Map([["FG6-EG2", "completed"]]),
        spawn: ((command: string, args: string[]) => { calls.push([command, ...args].join(" ")); return { status: calls.length - 1 === failedIndex ? 37 : 0 }; }) as any,
        logger: { ...console, log() {}, error() {} }
      });
      let error: any;
      try { run(); } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain("Governance command failed");
      expect(error.exitCode).toBe(37);
      expect(calls).toEqual(commands.slice(0, failedIndex + 1).map((entry: any) => [entry.command, ...entry.args].join(" ")));
    }
  });

  test("CLI keeps local full verify first and rejects hosted booleans/unknown flags before any command", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-governance-cli-"));
    const entry = fileURLToPath(new URL("./verify-governance.mjs", import.meta.url));
    try {
      mkdirSync(join(root, "docs/verification"), { recursive: true });
      writeFileSync(join(root, "docs/verification/acceptance-ledger.json"), JSON.stringify({ entries: [] }));
      writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { verify: "node full-verify-fixture.mjs" } }));
      writeFileSync(join(root, "full-verify-fixture.mjs"), 'import {writeFileSync} from "node:fs";writeFileSync("full-verify-ran","yes");process.exit(37);');
      const execute = (args: string[]) => spawnSync("node", [entry, ...args], { cwd: root, encoding: "utf8", timeout: 10_000,
        env: { ...process.env, GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "", GITHUB_RUN_ATTEMPT: "", VERIFY_PREREQUISITE_RESULT: "success", VERIFY_FULL_SUCCESS: "true" } });
      for (const args of [["--ci-inspect"], ["--inspect-only"], ["--ci-inspect", "--skip-verify"]]) {
        const result = execute(args);
        expect(result.status).toBe(1);
        expect(existsSync(join(root, "full-verify-ran"))).toBe(false);
        expect(result.stdout).not.toContain('"status": "verified"');
      }
      const local = execute([]);
      expect(local.status).toBe(37);
      expect(readFileSync(join(root, "full-verify-ran"), "utf8")).toBe("yes");
      expect(local.stdout).not.toContain('"status": "verified"');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("the shared full worker retains Linux readbacks and exposes only its actually verified checkout", () => {
    const workflow: any = Bun.YAML.parse(WORKFLOW);
    const full = workflow.jobs["verify-linux-full"];
    expect(full["runs-on"]).toBe("ubuntu-latest");
    expect(full.steps.find((step: any) => step.name === "Setup Node").with["node-version"]).toBe("22.22.x");
    expect(full.steps.filter((step: any) => step.run).map((step: any) => step.run).slice(0, 4)).toEqual([
      "bun install --frozen-lockfile", "node scripts/local-no-cloud-e2e.mjs > local-no-cloud-network-readback.json",
      "node scripts/platform-ipc-permission-readback.mjs > platform-ipc-permission-readback.json", "bun run verify"
    ]);
    expect(full.steps.find((step: any) => step.name === "Verify").if).toBeUndefined();
    expect(full.steps.at(-1).run).toContain('test "$(git rev-parse HEAD)" = "$GITHUB_SHA"');
    expect(full.outputs.checkout_sha).toBe("${{ steps.verified_checkout.outputs.sha }}");
    const gov = workflow.jobs["governance-verify"];
    expect(gov.env.VERIFY_PREREQUISITE_RESULT).toBe("${{ needs.verify-linux-full.result }}");
    expect(gov.env.VERIFY_PREREQUISITE_CHECKOUT_SHA).toBe("${{ needs.verify-linux-full.outputs.checkout_sha }}");
    expect(gov.env.GITHUB_TOKEN).toBe("${{ github.token }}");
    const manualJobs = Object.entries(workflow.jobs).filter(([, job]: any) => job.if === undefined || job.if === "${{ always() }}");
    expect(manualJobs.map(([id]) => id)).toEqual(["verify-linux-full", "governance-verify"]);
    expect(manualJobs.filter(([, job]: any) => job.steps.some((step: any) => step.name === "Install dependencies"))).toHaveLength(2);
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
