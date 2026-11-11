import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GOVERNANCE_COMMANDS, runGovernanceCommands } from "./verify-governance.mjs";
import { readConfig, RECEIPT_GATE_STEPS } from "./verify-ci.mjs";

const PACKAGE_JSON = readFileSync("package.json", "utf8");
const WORKFLOW = readFileSync(".github/workflows/verify.yml", "utf8");
const VERIFY_GOVERNANCE = readFileSync("scripts/verify-governance.mjs", "utf8");
const ADR_INDEX = readFileSync("docs/adr/README.md", "utf8");
const ADR_SUPERSEDED = readFileSync("docs/adr/ADR-0052-governance-composite-verification-receipt.md", "utf8");
const ADR_0055 = readFileSync("docs/adr/ADR-0055-governance-receipt-spans-run-attempts.md", "utf8");
const SCRIPT_SURFACE_POLICY = readFileSync("docs/adr/ADR-0051-script-surface-policy.md", "utf8");
const ROOT_PACKAGE = JSON.parse(PACKAGE_JSON) as { scripts?: Record<string, string> };
const LINUX_SPLIT_JOBS = ["verify-linux-pre", "verify-linux-shards", "verify-linux-post"];

interface ScriptOwnerCorpus {
  packageJson: string;
  workflow: string;
  docsVerification: string;
  docsRunbooks: string;
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
    expect(workflow.jobs.verify.if).toBe("github.event_name != 'workflow_dispatch' && needs.verify-topology.outputs.lane == 'matrix'");
    expect(workflow.jobs["governance-verify"].if).toBe("${{ always() }}");
    expect(workflow.jobs["governance-verify"].needs).toEqual(LINUX_SPLIT_JOBS);
    expect(workflow.jobs["governance-verify"].steps.at(-1).run).toBe("bun run verify:governance --ci-inspect");
    expect(workflow.jobs["governance-verify"]["timeout-minutes"]).toBe(15);
    for (const id of LINUX_SPLIT_JOBS) {
      expect(workflow.jobs[id]["timeout-minutes"]).toBe(20);
      expect(workflow.jobs[id].if).toBeUndefined();
    }
    for (const [id, job] of Object.entries(workflow.jobs) as [string, any][]) {
      if (![...LINUX_SPLIT_JOBS, "governance-verify"].includes(id)) expect(job.if).toContain("github.event_name != 'workflow_dispatch'");
    }
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency.group).toBe("verify-${{ github.workflow }}-${{ github.event_name }}-${{ github.ref }}");
    expect(workflow.jobs.verify.strategy.matrix).toBe("${{ fromJSON(needs.verify-topology.outputs.compat) }}");
  });

  test("keeps governance verify local and runs only full verify", () => {
    expect(VERIFY_GOVERNANCE).toContain('"run", "verify"');
    expect(VERIFY_GOVERNANCE).not.toContain("_ops/env");
    expect(VERIFY_GOVERNANCE).not.toContain("wrangler deploy");
  });

  test("preserves the full-verify command and an empty CI inspection list", () => {
    expect(GOVERNANCE_COMMANDS).toEqual([{ command: "bun", args: ["run", "verify"] }]);
    const calls: { command: string; args: string[] }[] = [];
    const env = { VERIFY_TEST_SENTINEL: "preserved" };
    const options = { env,
      spawn: ((command: string, args: string[], spawnOptions: any) => {
        expect(spawnOptions).toEqual({ stdio: "inherit", env, shell: false });
        calls.push({ command, args }); return { status: 0 };
      }) as any,
      logger: { ...console, log() {}, error() {} } };
    expect(runGovernanceCommands(GOVERNANCE_COMMANDS, options)).toMatchObject({ commandCount: 1, ok: true });
    expect(calls).toEqual(GOVERNANCE_COMMANDS.map(({ command, args }: any) => ({ command, args })));
    calls.length = 0;
    expect(runGovernanceCommands(GOVERNANCE_COMMANDS.slice(1), options)).toMatchObject({ commandCount: 0, ok: true });
    expect(calls).toEqual(GOVERNANCE_COMMANDS.slice(1).map(({ command, args }: any) => ({ command, args })));
  });

  test("a failed full verify or inspection stops the real runner before later commands", () => {
    for (const failedIndex of [0, 1]) {
      const calls: string[] = [];
      const commands = [
        { command: "bun", args: ["run", "verify"] },
        { command: "bun", args: ["run", "first"] },
        { command: "bun", args: ["run", "second"] }
      ];
      const run = () => runGovernanceCommands(commands, {
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

  test("the Linux split jobs keep the Linux readbacks, run every gate step in order and expose only the post job's verified checkout", () => {
    const workflow: any = Bun.YAML.parse(WORKFLOW);
    const [pre, shards, post] = LINUX_SPLIT_JOBS.map(id => workflow.jobs[id]);
    const linux = { matrix: { include: [{ os: "ubuntu-latest", "node-version": "22.22.x" }] } };
    expect(pre.strategy).toEqual(linux);
    expect(post.strategy).toEqual(linux);
    expect(shards.strategy.matrix).toBe("${{ fromJSON(needs.verify-linux-pre.outputs.shards) }}");
    expect(pre.outputs.shards).toBe("${{ steps.plan.outputs.shards }}");
    expect(shards.needs).toBe("verify-linux-pre");
    expect(post.needs).toEqual(["verify-linux-pre", "verify-linux-shards"]);
    const bind = 'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"\necho "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"\n';
    const runs = (job: any) => job.steps.filter((step: any) => step.run).map((step: any) => step.run);
    expect(runs(pre)).toEqual(["bun install --frozen-lockfile", "node scripts/local-no-cloud-e2e.mjs > local-no-cloud-network-readback.json",
      "node scripts/platform-ipc-permission-readback.mjs > platform-ipc-permission-readback.json", "bun run verify:pre", "bun run verify:ci plan", bind]);
    expect(runs(shards)).toEqual(["bun install --frozen-lockfile", "bun run verify:ci shard", bind]);
    expect(runs(post)).toEqual(["bun install --frozen-lockfile", "bun run verify:ci coverage", "bun run verify:post", bind]);
    for (const [job, gates] of [[pre, RECEIPT_GATE_STEPS.pre], [shards, RECEIPT_GATE_STEPS.shard], [post, RECEIPT_GATE_STEPS.post]] as [any, string[]][]) {
      expect(job["runs-on"]).toBe("ubuntu-latest");
      expect(job.steps.find((step: any) => step.name === "Setup Node").with["node-version"]).toBe("${{ matrix.node-version }}");
      expect(job.steps.map((step: any) => step.name).filter((name: string) => gates.includes(name))).toEqual(gates);
      for (const gate of gates) expect(job.steps.find((step: any) => step.name === gate).if).toBeUndefined();
      expect(job.steps.at(-1)).toMatchObject({ name: "Bind verified checkout", id: "verified_checkout", run: bind });
    }
    expect(pre.steps.find((step: any) => step.name === "Upload network isolation readback").with.name).toBe("local-no-cloud-network-linux-node-22");
    expect(post.outputs.checkout_sha).toBe("${{ steps.verified_checkout.outputs.sha }}");
    const gov = workflow.jobs["governance-verify"];
    expect(gov.env.VERIFY_PREREQUISITE_RESULT).toBe("${{ needs.verify-linux-post.result }}");
    expect(gov.env.VERIFY_PREREQUISITE_CHECKOUT_SHA).toBe("${{ needs.verify-linux-post.outputs.checkout_sha }}");
    expect(gov.env.GITHUB_TOKEN).toBe("${{ github.token }}");
    const manualJobs = Object.entries(workflow.jobs).filter(([, job]: any) => job.if === undefined || job.if === "${{ always() }}");
    expect(manualJobs.map(([id]) => id)).toEqual(["governance-verify", ...LINUX_SPLIT_JOBS]);
    expect(manualJobs.filter(([, job]: any) => job.steps.some((step: any) => step.name === "Install dependencies"))).toHaveLength(4);
    const shardCount = readConfig().splitTargets.find((row: any) => row.os === "ubuntu-latest" && row["node-version"] === "22.22.x").shards;
    expect(manualJobs.map(([id]) => id === "verify-linux-shards" ? shardCount : 1).reduce((sum, count) => sum + count, 0)).toBe(shardCount + 3);
  });

  test("ADR-0055 supersedes ADR-0052 and states the run-scoped receipt rule", () => {
    expect(ADR_INDEX).toContain("ADR-0055 | Governance Receipt Spans the Run Attempts of One SHA");
    expect(ADR_INDEX.indexOf("| ADR-0055 |")).toBeGreaterThan(ADR_INDEX.indexOf("| ADR-0054 |"));
    expect(ADR_SUPERSEDED).toContain("status: superseded");
    expect(ADR_SUPERSEDED).toContain("supersededBy: adr.0055.governance-receipt-spans-run-attempts");
    // This PR changes ADR-0052's frontmatter only. This assertion pins one representative sentence of
    // the body that would be rewritten if the old rule were restated here; it is not a byte-diff.
    expect(ADR_SUPERSEDED).toContain('Only "Re-run all jobs" can produce a Governance receipt.');
    expect(ADR_0055).toContain("status: accepted");
    expect(ADR_0055).toContain("  - adr.0052.governance-composite-verification-receipt");
    for (const statement of [
      "a receipt spans the attempts of one run on one SHA",
      "the **latest attempt that ran it**",
      "`receiptJobs` reads the jobs of every attempt",
      "run ID and `GITHUB_SHA`",
      "`overwrite: true`",
      "one report per planned shard"
    ]) expect(ADR_0055).toContain(statement);
    // ADR-0055 must not claim hostedJobs reads across attempts: it keeps its main behavior.
    expect(ADR_0055).not.toContain("`hostedJobs` reads the jobs of every attempt");
    expect(ADR_0055).not.toContain("one run attempt");
    // Section 4 says the revalidation runbook links this ADR for the receipt rule.
    expect(readFileSync("docs/runbooks/governance-revalidation.md", "utf8"))
      .toContain("ADR-0055-governance-receipt-spans-run-attempts.md");
  });

  test("ADR-0055: the Linux split plan and shard artifacts are run-scoped with overwrite, and the two evidence artifacts stay per attempt", () => {
    const workflow: any = Bun.YAML.parse(WORKFLOW);
    const upload = (id: string, name: string) => workflow.jobs[id].steps.find((step: any) => step.name === name).with;
    const preUpload = upload("verify-linux-pre", "Upload run-bound discovery plan");
    const shardUpload = upload("verify-linux-shards", "Upload actual file inventory and JUnit");
    // Attempt-free names: the same artifact is reused by every attempt of the run.
    expect(preUpload.name).toBe("verify-plan-${{ matrix.os }}-node-${{ matrix.node-version }}");
    expect(shardUpload.name).toBe("verify-shard-${{ matrix.os }}-node-${{ matrix.node-version }}-${{ matrix.shard }}");
    expect([preUpload.overwrite, shardUpload.overwrite]).toEqual([true, true]);
    expect(preUpload.name).not.toContain("attempt");
    expect(shardUpload.name).not.toContain("attempt");
    // A rerun shard reuses the run's plan and replaces only its own report, so the downloads carry
    // no attempt either and the post job still collects exactly one report per planned shard.
    expect(upload("verify-linux-shards", "Download run-bound discovery plan").name).toBe(preUpload.name);
    expect(upload("verify-linux-post", "Download run-bound discovery plan").name).toBe(preUpload.name);
    const reports = upload("verify-linux-post", "Download every shard inventory").pattern;
    expect(reports).toBe("verify-shard-${{ matrix.os }}-node-${{ matrix.node-version }}-*");
    expect(reports).not.toContain("attempt");
    // The three Linux jobs read no run attempt at all; only the receipt in verify-ci.mjs does.
    for (const id of LINUX_SPLIT_JOBS) expect(JSON.stringify(workflow.jobs[id])).not.toContain("github.run_attempt");
    // The job-evidence and runner-cost artifacts keep their attempt scope: they report one attempt.
    expect(upload("verify-collect", "Upload actual job conclusions and runner minutes").name).toBe("verify-job-evidence-attempt-${{ github.run_attempt }}");
    expect(upload("verify-cost", "Upload measured cost readback").name).toBe("verify-runner-cost-attempt-${{ github.run_attempt }}");
  });

  test("keeps the script surface policy discoverable and enforceable", () => {
    expect(ADR_INDEX).toContain("ADR-0051 | Script Surface Policy");
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
    const failures: string[] = [];

    for (const script of nonTestScripts) {
      const owners = scriptOwners(script, scripts, {
        packageJson: PACKAGE_JSON,
        workflow: WORKFLOW,
        docsVerification,
        docsRunbooks
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
