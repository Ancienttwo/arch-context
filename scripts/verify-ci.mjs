import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const OS_TARGETS = ["ubuntu-latest", "macos-15", "windows-latest"];
export const NODE_TARGETS = ["22.22.x", "24.x", "25.x"];
export const targetName = (os, node) => `${os} / Node ${node}`;
export const workerName = (os, node, part) => `Verify execution: ${targetName(os, node)} / ${part}`;
export const GOVERNANCE_TARGET = { os: "ubuntu-latest", "node-version": "22.22.x" };
// ADR-0055 section 2: renaming a Linux split job or one of these steps changes Governance's receipt.
export const RECEIPT_GATE_STEPS = {
  pre: ["Verify pre-gates in original order", "Bind verified checkout"],
  shard: ["Execute assigned full files with all real assertions", "Bind verified checkout"],
  post: ["Prove each discovered file executed exactly once", "Verify post-gates in original order with fresh local fixtures", "Bind verified checkout"]
};
const CONFIG_PATH = new URL("../.github/verify-sharding.json", import.meta.url);
const SCOPE_FILE = ".github/verify-scope.json";
const WORKSPACES_FILE = ".github/verify-workspaces.json";
const SCOPE_PATH = new URL(`../${SCOPE_FILE}`, import.meta.url);
const WORKSPACES_PATH = new URL(`../${WORKSPACES_FILE}`, import.meta.url);

/**
 * A provider snapshot can land while an expected job is still in flight: the Governance reader then
 * reads a nonterminal job and treats it as a final failed receipt (issue #492). Re-read a
 * bounded number of times before failing closed, and never treat nonterminal as success.
 */
export const RECEIPT_READ_ATTEMPTS = 6;
export const RECEIPT_READ_DELAY_MS = 10_000;

const TERMINAL_JOB_STATUSES = new Set(["completed"]);

export function validateConfig(config) {
  assert.equal(config.version, 1);
  for (const row of config.splitTargets) {
    assert(OS_TARGETS.includes(row.os) && NODE_TARGETS.includes(row["node-version"]));
    assert.equal(row["node-version"], GOVERNANCE_TARGET["node-version"], "full verification runs only at the engines-minimum Node; newer Node targets run node compat");
    assert(Number.isInteger(row.shards) && row.shards > 1);
  }
  assert.equal(new Set(config.splitTargets.map(row => targetName(row.os, row["node-version"]))).size, config.splitTargets.length);
  assert.deepEqual(config.splitTargets.map(row => row.os).sort(), [...OS_TARGETS].sort(), "every OS has exactly one splitTargets row at 22.22.x");
  return config;
}

export function readConfig() {
  return validateConfig(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
}

/** `**` spans zero or more whole segments, `*` stays inside one segment, everything else is literal. */
export function globToRegExp(pattern) {
  assert(typeof pattern === "string" && pattern.length > 0);
  const escape = text => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const segments = pattern.split("/");
  let source = "";
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === "**") source += last ? ".*" : "(?:[^/]+/)*";
    else source += segment.split("*").map(escape).join("[^/]*") + (last ? "" : "/");
  });
  return new RegExp(`^${source}$`);
}

const nonEmptyStrings = (value, label) => {
  assert(Array.isArray(value) && value.length > 0 && value.every(item => typeof item === "string" && item.length > 0), `${label} must be a non-empty string array`);
  return value;
};

/**
 * The reviewed selector map. Each platform family owns the paths whose change selects it; the
 * complete-suite family owns nothing, so only a release plan can select it.
 */
export function validateScope(scope) {
  assert.equal(scope.version, 2);
  const jobs = [...nonEmptyStrings(scope.alwaysJobs, "alwaysJobs")];
  assert(Array.isArray(scope.families) && scope.families.length > 0, "families must be a non-empty array");
  const families = scope.families.map(family => {
    assert.match(family.id ?? "", /^[a-z0-9-]+$/, "family id");
    jobs.push(...nonEmptyStrings(family.jobs, `${family.id}.jobs`));
    if (family.id === scope.completeSuiteFamily) {
      assert.equal(family.owners, undefined, "the complete-suite family owns no path");
      return { id: family.id, jobs: family.jobs, owners: [] };
    }
    return { id: family.id, jobs: family.jobs, owners: nonEmptyStrings(family.owners, `${family.id}.owners`).map(globToRegExp) };
  });
  const ids = families.map(family => family.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate family id");
  assert.equal(new Set(jobs).size, jobs.length, "a job belongs to exactly one family or to alwaysJobs");
  assert(ids.includes(scope.completeSuiteFamily), "completeSuiteFamily must name a family");
  const broadFamilies = nonEmptyStrings(scope.broadImpact?.families, "broadImpact.families");
  assert(broadFamilies.every(id => ids.includes(id) && id !== scope.completeSuiteFamily), "broadImpact selects known targeted families only");
  return {
    completeSuite: scope.completeSuiteFamily, alwaysJobs: scope.alwaysJobs, families,
    broad: { families: broadFamilies, paths: nonEmptyStrings(scope.broadImpact.paths, "broadImpact.paths").map(globToRegExp) },
    linuxOnly: nonEmptyStrings(scope.linuxOnly, "linuxOnly").map(globToRegExp)
  };
}

export function readScope() {
  return validateScope(JSON.parse(readFileSync(SCOPE_PATH, "utf8")));
}

/** The reviewed workspace graph. Its drift test keeps it equal to the workspace manifests. */
export function validateWorkspaces(graph) {
  assert.equal(graph.version, 1);
  assert(Array.isArray(graph.workspaces) && graph.workspaces.length > 0, "workspaces must be a non-empty array");
  const names = graph.workspaces.map(workspace => workspace.name);
  assert.equal(new Set(names).size, names.length, "duplicate workspace name");
  return graph.workspaces.map(workspace => {
    assert(typeof workspace.dir === "string" && workspace.dir.length > 0, "workspace dir");
    assert(Array.isArray(workspace.dependsOn) && workspace.dependsOn.every(name => names.includes(name) && name !== workspace.name), `${workspace.name}.dependsOn names other workspaces`);
    return { name: workspace.name, dir: workspace.dir, dependsOn: workspace.dependsOn,
      paths: nonEmptyStrings(workspace.paths, `${workspace.name}.paths`).map(globToRegExp),
      tests: nonEmptyStrings(workspace.tests, `${workspace.name}.tests`).map(globToRegExp) };
  });
}

export function readWorkspaces() {
  return validateWorkspaces(JSON.parse(readFileSync(WORKSPACES_PATH, "utf8")));
}

function reviewedMappingError(path, reason) {
  return new Error(`Verify impact plan: ${JSON.stringify(path)} ${reason}. Add a reviewed mapping for it to ${SCOPE_FILE} `
    + `(a family owner, broadImpact or linuxOnly) or to the workspace graph ${WORKSPACES_FILE}.`);
}

const isRepositoryPath = path => typeof path === "string" && path.length > 0 && !/[\\\0]/.test(path)
  && path.split("/").every(segment => segment !== "" && segment !== "." && segment !== "..");

/** The changed workspaces and every transitive dependent, in graph order. */
export function affectedWorkspaces(workspaces, changed) {
  const affected = new Set(changed);
  for (let grew = true; grew;) {
    grew = false;
    for (const workspace of workspaces) {
      if (!affected.has(workspace.name) && workspace.dependsOn.some(name => affected.has(name))) { affected.add(workspace.name); grew = true; }
    }
  }
  return workspaces.map(workspace => workspace.name).filter(name => affected.has(name));
}

/** Routine selection: owned paths select their families, broad-impact paths their reviewed families. Membership alone selects none. */
export function selectImpact(scope, workspaces, paths) {
  const families = new Set();
  const changed = new Set();
  for (const path of paths) {
    if (!isRepositoryPath(path)) throw reviewedMappingError(path, "is not a well-formed repository path");
    const owners = scope.families.filter(family => family.owners.some(re => re.test(path)));
    const broad = scope.broad.paths.some(re => re.test(path));
    const homes = workspaces.filter(workspace => workspace.paths.some(re => re.test(path)));
    if (homes.length > 1) throw reviewedMappingError(path, `belongs to more than one workspace (${homes.map(workspace => workspace.name).join(", ")})`);
    if (!owners.length && !broad && !homes.length && !scope.linuxOnly.some(re => re.test(path))) throw reviewedMappingError(path, "has no reviewed mapping");
    for (const family of owners) families.add(family.id);
    if (broad) for (const id of scope.broad.families) families.add(id);
    for (const workspace of homes) changed.add(workspace.name);
  }
  return { families: scope.families.map(family => family.id).filter(id => families.has(id)), workspaces: affectedWorkspaces(workspaces, changed) };
}

/** Release validation runs only from these refs; routine runs never check the ref (a PR ref is refs/pull/<n>/merge). */
export const RELEASE_REF = /^refs\/heads\/(?:main|release\/[A-Za-z0-9][A-Za-z0-9._-]*)$/;
export const EVENT_MODES = { pull_request: "routine", push: "routine", workflow_dispatch: "release" };

export function eventMode(event) {
  const mode = EVENT_MODES[event];
  if (!mode) throw new Error(`Verify has no mode for event ${JSON.stringify(event)}`);
  return mode;
}

function assertReleaseIdentity(context) {
  if (!RELEASE_REF.test(context.ref ?? "")) throw new Error(`Release validation runs only on refs/heads/main or refs/heads/release/<name>, not ${JSON.stringify(context.ref)}`);
  assert.match(context.dispatchSha ?? "", /^[a-f0-9]{40}$/, "release validation needs the exact full approved commit SHA");
  assert.equal(context.dispatchSha, context.sha, "the approved SHA differs from the dispatched checkout");
}

/**
 * The impact plan. A routine plan names the Linux affected-workspace scope and only the platform
 * families its changed paths select; a release plan selects every family, including the complete suite.
 */
export function planImpact(scope, workspaces, trackedFiles, context) {
  assert.match(context.sha ?? "", /^[a-f0-9]{40}$/, "missing/invalid checkout SHA");
  const mode = eventMode(context.event);
  let selection;
  if (mode === "release") {
    assertReleaseIdentity(context);
    assert.equal(context.base, null);
    assert.deepEqual(context.files, []);
    selection = { families: scope.families.map(family => family.id), workspaces: workspaces.map(workspace => workspace.name) };
  } else {
    assert.match(context.base ?? "", /^[a-f0-9]{40}$/, "missing/invalid comparison base");
    selection = selectImpact(scope, workspaces, context.files);
    if (selection.families.includes(scope.completeSuite)) throw new Error(`a targeted plan cannot contain the complete-suite family ${scope.completeSuite}`);
  }
  for (const name of selection.workspaces) {
    const workspace = workspaces.find(candidate => candidate.name === name);
    if (!trackedFiles.some(file => workspace.tests.some(re => re.test(file)))) {
      throw reviewedMappingError(name, "is a selected workspace without a check: no tracked file matches its tests");
    }
  }
  return { version: 1, mode, event: context.event, ref: context.ref, sha: context.sha, base: context.base, files: context.files, ...selection };
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed (${result.status}): ${result.stderr}`);
  return result.stdout;
}

/**
 * The comparison base: pull_request checks out the synthetic merge commit, whose first parent is the
 * base; a push compares with the event's `before`; release validation has no base.
 */
export function comparisonBase(cwd, event, payload) {
  if (eventMode(event) === "release") return null;
  if (event === "pull_request") {
    const parents = git(cwd, ["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(/\s+/).length - 1;
    if (parents !== 2) throw new Error(`pull_request checkout must be a merge commit with two parents, found ${parents}`);
    return git(cwd, ["rev-parse", "HEAD^1"]).trim();
  }
  const before = payload?.before;
  if (!/^[a-f0-9]{40}$/.test(before ?? "") || /^0+$/.test(before)) throw new Error(`push event has no comparable before commit: ${JSON.stringify(before)}`);
  return before;
}

export function changedFiles(cwd, base) {
  if (git(cwd, ["cat-file", "-t", base]).trim() !== "commit") throw new Error(`comparison base ${base} is not a commit`);
  return git(cwd, ["diff", "--name-only", "--no-renames", "-z", base, "HEAD"]).split("\0").filter(Boolean);
}

/**
 * The aggregate gate. It reports on every run (`if: always()`) and passes only when the plan belongs
 * to this run and every selected job succeeded while every unselected job was skipped.
 */
export function gateVerdict(scope, workspaces, plan, needs, context) {
  assert.equal(needs["verify-plan"]?.result, "success", "the Verify plan job did not succeed");
  assert(plan && typeof plan === "object" && !Array.isArray(plan), "missing or empty impact plan");
  assert.equal(plan.version, 1);
  assert.equal(plan.sha, context.sha, "the impact plan is for another SHA");
  assert.equal(plan.event, context.event, "the impact plan is for another event");
  assert.equal(plan.mode, eventMode(context.event), `the impact plan mode is not the ${context.event} mode`);
  if (plan.mode === "release") assertReleaseIdentity(context);
  assert.equal(plan.ref, context.ref, "the impact plan is for another ref");
  assert.equal(plan.base, context.base, "the impact plan compared against another base");
  assert(Array.isArray(plan.files), "the impact plan has no file list");
  const expected = plan.mode === "release"
    ? { families: scope.families.map(family => family.id), workspaces: workspaces.map(workspace => workspace.name) }
    : selectImpact(scope, workspaces, plan.files);
  if (plan.mode !== "release") assert(!expected.families.includes(scope.completeSuite), "a targeted plan cannot contain the complete-suite family");
  assert.deepEqual(plan.families, expected.families, "the impact plan's families differ from the selection of its file list");
  assert.deepEqual(plan.workspaces, expected.workspaces, "the impact plan's workspaces differ from the selection of its file list");
  /** @type {Record<string, "success" | "skipped">} */
  const results = { "verify-plan": "success", ...Object.fromEntries(scope.alwaysJobs.map(job => [job, "success"])) };
  for (const family of scope.families) for (const job of family.jobs) results[job] = plan.families.includes(family.id) ? "success" : "skipped";
  assert.deepEqual(Object.keys(needs).sort(), Object.keys(results).sort(), "the gate's job inventory differs from the known family list");
  const wrong = Object.entries(results).filter(([job, result]) => needs[job].result !== result)
    .map(([job, result]) => `${job}: expected ${result}, got ${needs[job].result}`);
  if (wrong.length) throw new Error(`Verify gate: ${wrong.join("; ")}`);
  return results;
}

/** ADR-0055: the subject is run-scoped, so a rerun attempt reuses the plan of the same run and SHA. */
export function subject(env = process.env) {
  const value = { runId: Number(env.GITHUB_RUN_ID), checkoutSha: env.GITHUB_SHA };
  assert(Number.isSafeInteger(value.runId) && value.runId > 0);
  assert.match(value.checkoutSha ?? "", /^[a-f0-9]{40}$/);
  return value;
}

function jsonWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function timingFiles(path) {
  const timing = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(timing.version, 1);
  assert(timing.files && typeof timing.files === "object" && !Array.isArray(timing.files));
  for (const [file, ms] of Object.entries(timing.files)) {
    assert(typeof ms === "number" && Number.isFinite(ms) && ms >= 0);
    assert(file && !file.startsWith("/") && !file.split(/[\\/]/).includes(".."));
  }
  return Object.keys(timing.files).map(file => file.replaceAll("\\", "/")).sort();
}

/** Bun is the discovery authority. The impossible pattern inventories files without running test bodies. */
export function discoverTestFiles(root, bun = "bun") {
  const scratch = mkdtempSync(join(tmpdir(), "archctx-bun-discovery-"));
  try {
    const timingPath = join(scratch, "inventory.json");
    const result = spawnSync(bun, ["test", "--test-name-pattern", "a^", `--timings=${timingPath}`, "--update-timings"], {
      cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, ARCHCONTEXT_STATE_DIR: join(scratch, "state") }
    });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (result.error) throw result.error;
    // Bun 1.4.4 deliberately exits 1 when a name pattern matches no tests. Other failures are refused.
    const inventoryOnly = /error: regex "a\^" matched 0 tests\. Searched (\d+) files?\b/.exec(output);
    if (!inventoryOnly || result.status !== 1 || /\(fail\)|\n\s*[1-9]\d* fail\b/.test(output)
      || (output.match(/\berror:/g) ?? []).length !== 1) {
      throw new Error(`Bun discovery failed (exit ${result.status}): ${output}`);
    }
    const files = timingFiles(timingPath);
    assert.equal(files.length, Number(inventoryOnly[1]), "Bun discovery and timing inventory disagree");
    return files;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

export function partitionFiles(files, weights, count) {
  assert(Number.isInteger(count) && count > 0);
  assert.equal(new Set(files).size, files.length);
  const buckets = Array.from({ length: count }, () => ({ files: [], weight: 0 }));
  const weight = file => weights[file] ?? 1_000;
  for (const file of [...files].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0))) {
    assert(Number.isFinite(weight(file)) && weight(file) >= 0);
    const bucket = buckets.reduce((best, next) => next.weight < best.weight ? next : best);
    bucket.files.push(file);
    bucket.weight += weight(file);
  }
  return buckets.map(bucket => bucket.files.sort());
}

export function validateCoverage(plan, reports, expectedSubject) {
  assert.deepEqual(plan.subject, expectedSubject);
  assert.equal(plan.version, 1);
  assert.equal(new Set(plan.files).size, plan.files.length);
  assert.deepEqual(plan.groups.flat().sort(), [...plan.files].sort(), "partition must cover discovery exactly once");
  assert.equal(reports.length, plan.groups.length, "every shard must report, including an empty shard");
  const seen = [];
  for (let index = 0; index < plan.groups.length; index++) {
    const matches = reports.filter(report => report.index === index);
    assert.equal(matches.length, 1, `missing/duplicate shard ${index + 1}`);
    const report = matches[0];
    assert.equal(report.version, 1);
    assert.deepEqual(report.subject, expectedSubject);
    assert.equal(report.target, plan.target);
    assert.equal(report.exitCode, 0, `shard ${index + 1} did not succeed`);
    assert.deepEqual([...report.files].sort(), plan.groups[index], `shard ${index + 1} did not execute its exact files`);
    seen.push(...report.files);
  }
  assert.deepEqual(seen.sort(), [...plan.files].sort(), "real Bun runs must cover every file exactly once");
}

export async function executeShard(root, plan, index, evidenceDir, bun = "bun") {
  assert(Number.isInteger(index) && index >= 0 && index < plan.groups.length);
  mkdirSync(evidenceDir, { recursive: true });
  const files = plan.groups[index];
  const timingPath = join(evidenceDir, "actual-timings.json");
  assert(!existsSync(timingPath), "actual timing inventory must be fresh, never seeded by the budget weights");
  let exitCode = 0;
  let actual = [];
  if (files.length) {
    const args = ["test", "--timeout", "60000", ...files.map(file => `./${file}`),
      `--timings=${timingPath}`, "--update-timings", "--reporter=junit", `--reporter-outfile=${join(evidenceDir, "junit.xml")}`];
    exitCode = await new Promise((accept, reject) => {
      const child = spawn(bun, args, { cwd: root, stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", (code, signal) => accept(signal ? 1 : code ?? 1));
    });
    if (existsSync(timingPath)) actual = timingFiles(timingPath);
  }
  const report = { version: 1, subject: plan.subject, target: plan.target, index, exitCode, files: actual };
  jsonWrite(join(evidenceDir, "report.json"), report);
  assert.equal(exitCode, 0, `Bun shard ${index + 1} failed`);
  assert.deepEqual(actual, files, "Bun must execute precisely the assigned files (an empty shard runs no Bun discovery)");
  return report;
}

export function shardMatrix(rows) {
  return rows.flatMap(row => Array.from({ length: row.shards }, (_, index) => ({ ...row, index, shard: index + 1 })));
}

export function expectedWorkers(config, os, node) {
  const row = config.splitTargets.find(row => row.os === os && row["node-version"] === node);
  if (row) return [workerName(os, node, "pre"), ...Array.from({ length: row.shards }, (_, i) => workerName(os, node, `shard ${i + 1}`)), workerName(os, node, "post")];
  return [workerName(os, node, "node compat")];
}

/** Everything a receipt needs to be attributable to one workflow run on one source head. */
function assertReceiptIdentity(run, identity, context) {
  assert.equal(run.id, identity.runId, "different prerequisite run");
  assert.equal(run.path, ".github/workflows/verify.yml", "different prerequisite workflow");
  assert.equal(run.event, context.eventName, "different prerequisite event");
  assert.match(context.sourceHeadSha ?? "", /^[a-f0-9]{40}$/);
  assert.equal(run.head_sha, context.sourceHeadSha, "different prerequisite source HEAD");
}

/**
 * ADR-0055: a receipt spans the attempts of one run on one SHA, so a job name is represented by the
 * record of the highest attempt that ran it. A name that no attempt ran, or that two jobs of one
 * attempt claim, has no single record and stays absent here so the receipt fails closed by name.
 */
export function latestAttemptPerName(jobs, names) {
  const latest = new Map();
  for (const name of names) {
    const matches = jobs.filter(job => job.name === name);
    const attempts = matches.map(job => job.run_attempt);
    if (matches.length === 0 || new Set(attempts).size !== attempts.length) continue;
    latest.set(name, matches.reduce((best, next) => next.run_attempt > best.run_attempt ? next : best));
  }
  return latest;
}

/**
 * The expected gate jobs that this snapshot does not yet show as a settled success. Only `incomplete`
 * is retryable: every other outcome is a final receipt and must never be re-read into a pass. Job and
 * step names are the only identity recorded, so the evidence stays non-sensitive.
 */
export function governanceReceiptPending(config, jobs) {
  const names = expectedWorkers(config, GOVERNANCE_TARGET.os, GOVERNANCE_TARGET["node-version"]);
  const latest = latestAttemptPerName(jobs, names);
  const pending = [];
  names.forEach((name, index) => {
    const job = latest.get(name);
    if (!job) return;
    if (!TERMINAL_JOB_STATUSES.has(job.status)) {
      pending.push({ job: name, reason: "incomplete", status: job.status ?? null, conclusion: job.conclusion ?? null });
      return;
    }
    if (job.conclusion !== "success") return;
    const gates = RECEIPT_GATE_STEPS[index === 0 ? "pre" : index === names.length - 1 ? "post" : "shard"];
    for (const gate of gates) {
      const steps = (job.steps ?? []).filter(step => step.name === gate);
      if (steps.length !== 1 || !TERMINAL_JOB_STATUSES.has(steps[0].status)) {
        pending.push({ job: name, reason: "incomplete", status: steps[0]?.status ?? null, conclusion: steps[0]?.conclusion ?? null, step: gate });
        return;
      }
      if (steps[0].conclusion !== "success") return;
    }
  });
  return pending;
}

export function runnerMinutes(jobs, sampledAt = Date.now()) {
  let completedMinutes = 0, roundedCompletedMinutes = 0, elapsedMinutes = 0, installMinutes = 0, installJobs = 0;
  const byOs = {};
  for (const job of jobs) {
    if (!job.started_at || job.runner_id === 0 || job.status === "queued" || job.status === "waiting") continue;
    const minutes = Math.max(0, ((job.completed_at ? Date.parse(job.completed_at) : sampledAt) - Date.parse(job.started_at)) / 60_000);
    elapsedMinutes += minutes;
    if (job.completed_at) { completedMinutes += minutes; roundedCompletedMinutes += Math.ceil(minutes); }
    const labels = job.labels ?? [];
    const os = labels.some(label => label.startsWith("windows-")) ? "windows"
      : labels.some(label => label.startsWith("macos-")) ? "macos"
      : labels.some(label => label.startsWith("ubuntu-")) ? "linux" : "unknown";
    byOs[os] = (byOs[os] ?? 0) + minutes;
    for (const step of job.steps ?? []) if (step.name === "Install dependencies" && step.completed_at && step.started_at) {
      installJobs++;
      installMinutes += (Date.parse(step.completed_at) - Date.parse(step.started_at)) / 60_000;
    }
  }
  return { completedMinutes, roundedCompletedMinutes, elapsedMinutesAtSample: elapsedMinutes, installMinutes, installJobs, byOs,
    note: "Runner time is summed across jobs, not workflow wall clock. Per-job rounding is a model, not a billing statement; OS rates and account allowances are not queried. The reporting job's remaining time is not yet measured." };
}

async function githubRead(path, env = process.env) {
  // Public repository read API; keep the workflow's existing contents:read permission unchanged.
  const response = await fetch(`https://api.github.com/${path}`, { signal: AbortSignal.timeout(30_000), headers: {
    Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "archcontext-verify-ci",
    Authorization: `Bearer ${env.GITHUB_TOKEN}`
  } });
  if (!response.ok) throw new Error(`GitHub read API ${response.status}: ${path}`);
  return response.json();
}

async function readAttemptJobs(repository, runId, attempt, env, read) {
  const jobs = [];
  for (let page = 1; ; page++) {
    const response = await read(`repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100&page=${page}`, env);
    assert(Number.isSafeInteger(response.total_count) && response.total_count >= 0 && Array.isArray(response.jobs), "invalid GitHub jobs response");
    jobs.push(...response.jobs);
    if (jobs.length >= response.total_count) { assert.equal(jobs.length, response.total_count); break; }
    assert(response.jobs.length, "GitHub jobs pagination is incomplete");
  }
  assert.equal(new Set(jobs.map(job => job.id)).size, jobs.length, "GitHub jobs pagination contains duplicates");
  // The latest-attempt rule compares `run_attempt` with `>`, so a record whose attempt is not the
  // endpoint's own would silently lose to an older green one. Check that provider fact once, here.
  for (const job of jobs) assert.equal(job.run_attempt, attempt, `job ${job.id} is not from attempt ${attempt}`);
  return jobs;
}

export async function hostedJobs(env = process.env, read = githubRead) {
  const repository = env.GITHUB_REPOSITORY;
  assert.match(repository ?? "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  // ADR-0055 keeps this function's main behavior: it reads the current attempt only, so the
  // collector path behind the required check is untouched by the run-scoped receipt.
  const identity = { ...subject(env), attempt: Number(env.GITHUB_RUN_ATTEMPT) };
  assert(Number.isSafeInteger(identity.attempt) && identity.attempt > 0);
  const run = await read(`repos/${repository}/actions/runs/${identity.runId}`, env);
  assert.equal(run.id, identity.runId);
  assert.equal(run.run_attempt, identity.attempt);
  return { run, jobs: await readAttemptJobs(repository, identity.runId, identity.attempt, env, read) };
}

/**
 * ADR-0055: the Governance receipt spans every attempt of the run, so it reads the jobs of each
 * attempt from the first up to the current one. The provider's run-scoped `/jobs` endpoint returns
 * only the current attempt's jobs, so a partial rerun would otherwise hide the earlier attempts.
 */
export async function receiptJobs(env = process.env, read = githubRead) {
  const repository = env.GITHUB_REPOSITORY;
  assert.match(repository ?? "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  const identity = subject(env);
  const run = await read(`repos/${repository}/actions/runs/${identity.runId}`, env);
  assert.equal(run.id, identity.runId);
  assert(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0, "invalid provider run attempt");
  const jobs = [];
  for (let attempt = 1; attempt <= run.run_attempt; attempt++) jobs.push(...await readAttemptJobs(repository, identity.runId, attempt, env, read));
  assert.equal(new Set(jobs.map(job => job.id)).size, jobs.length, "GitHub jobs across attempts contain duplicate ids");
  return { run, jobs };
}

export function governanceSourceHead(env = process.env) {
  assert(["pull_request", "push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME), "unsupported Governance event");
  // pull_request checks out a synthetic merge commit; the API's run/job head is the source head.
  const head = env.GITHUB_EVENT_NAME === "pull_request"
    ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")).pull_request?.head?.sha
    : env.GITHUB_SHA;
  assert.match(head ?? "", /^[a-f0-9]{40}$/, "missing/invalid source HEAD");
  return head;
}

/** ADR-0055 composite receipt: the latest attempt of every Linux split job, and each of its gate steps, succeeded in this run on this checkout. */
export function validateGovernancePrerequisite(config, identity, run, jobs, context) {
  assert(["pull_request", "push", "workflow_dispatch"].includes(context.eventName));
  assert.equal(context.prerequisiteResult, "success", "Linux post prerequisite did not succeed");
  assert.match(context.prerequisiteCheckoutSha ?? "", /^[a-f0-9]{40}$/, "missing/invalid prerequisite checkout");
  assert.equal(context.actualCheckoutSha, identity.checkoutSha, "Governance checkout differs from this event");
  assert.equal(context.prerequisiteCheckoutSha, identity.checkoutSha, "Linux post verified a different checkout");
  assertReceiptIdentity(run, identity, context);
  const names = expectedWorkers(config, GOVERNANCE_TARGET.os, GOVERNANCE_TARGET["node-version"]);
  const latest = latestAttemptPerName(jobs, names);
  return names.map((name, index) => {
    const job = latest.get(name);
    assert(job, `missing/duplicate prerequisite job: ${name}`);
    assert(Number.isSafeInteger(job.id) && job.id > 0, `missing/invalid prerequisite job id: ${name}`);
    assert.equal(job.status, "completed", `prerequisite job is incomplete: ${name}`);
    assert.equal(job.conclusion, "success", `prerequisite job was not successful: ${name}`);
    assert.equal(job.run_id, run.id, `prerequisite job ran in a different run: ${name}`);
    assert.equal(job.head_sha, run.head_sha, `prerequisite job ran on a different head: ${name}`);
    const gates = RECEIPT_GATE_STEPS[index === 0 ? "pre" : index === names.length - 1 ? "post" : "shard"];
    for (const gate of gates) {
      const steps = (job.steps ?? []).filter(step => step.name === gate);
      assert.equal(steps.length, 1, `missing/duplicate gate step "${gate}": ${name}`);
      assert.equal(steps[0].status, "completed", `gate step "${gate}" is incomplete: ${name}`);
      assert.equal(steps[0].conclusion, "success", `gate step "${gate}" was not successful: ${name}`);
    }
    return job;
  });
}

/**
 * Read the prerequisite receipt, re-reading only while an expected job or gate step is nonterminal.
 * A settled failure, a missing/duplicate job, or a different run/head fails immediately: only a job
 * still in flight is worth another read, and the budget is finite so a stuck job still fails closed
 * with its last observed state (issue #492).
 */
export async function readGovernanceReceipt(config, env, identity, context, options = {}) {
  const read = options.read ?? githubRead;
  const attempts = options.attempts ?? RECEIPT_READ_ATTEMPTS;
  const wait = options.wait ?? (ms => new Promise(done => setTimeout(done, ms)));
  const delayMs = options.delayMs ?? RECEIPT_READ_DELAY_MS;
  assert(Number.isSafeInteger(attempts) && attempts > 0, "receipt read budget must be positive");
  for (let attempt = 1; ; attempt += 1) {
    const snapshot = await receiptJobs(env, read);
    assertReceiptIdentity(snapshot.run, identity, context);
    const pending = governanceReceiptPending(config, snapshot.jobs);
    if (pending.length === 0) return { ...snapshot, pending, attempts: attempt };
    if (attempt >= attempts) {
      assert.fail(`prerequisite receipt still nonterminal after ${attempts} reads: ${JSON.stringify(pending)}`);
    }
    await wait(delayMs);
  }
}

export async function verifyGovernancePrerequisite(env = process.env, options = {}) {
  assert.equal(env.GITHUB_ACTIONS, "true", "hosted inspections require the current GitHub Actions run");
  const identity = subject(env);
  const sourceHeadSha = governanceSourceHead(env);
  const checkout = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", shell: false });
  assert.equal(checkout.status, 0, "cannot read Governance checkout");
  const { run, jobs } = await readGovernanceReceipt(readConfig(), env, identity, {
    eventName: env.GITHUB_EVENT_NAME, sourceHeadSha, actualCheckoutSha: checkout.stdout.trim()
  }, options);
  const receipt = validateGovernancePrerequisite(readConfig(), identity, run, jobs, {
    eventName: env.GITHUB_EVENT_NAME, sourceHeadSha, actualCheckoutSha: checkout.stdout.trim(),
    prerequisiteResult: env.VERIFY_PREREQUISITE_RESULT,
    prerequisiteCheckoutSha: env.VERIFY_PREREQUISITE_CHECKOUT_SHA
  });
  return { runId: run.id, attempt: run.run_attempt, sourceHeadSha: run.head_sha, checkoutSha: identity.checkoutSha, jobIds: receipt.map(job => job.id) };
}

export async function main(command, env = process.env) {
  const config = readConfig();
  const temporaryPath = (key, ...parts) => {
    if (env[key]) return env[key];
    assert(env.RUNNER_TEMP, `${key} requires the runner's temporary directory`);
    return join(env.RUNNER_TEMP, ...parts);
  };
  const eventContext = () => {
    const payload = env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")) : undefined;
    return { event: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF, sha: env.GITHUB_SHA, dispatchSha: env.VERIFY_DISPATCH_SHA,
      base: comparisonBase(process.cwd(), env.GITHUB_EVENT_NAME, payload) };
  };
  if (command === "impact") {
    const context = eventContext();
    assert.equal(git(process.cwd(), ["rev-parse", "HEAD"]).trim(), context.sha, "the planner checkout differs from GITHUB_SHA");
    if (context.event === "push") git(process.cwd(), ["fetch", "--no-tags", "--depth=1", "origin", context.base]);
    const files = context.base === null ? [] : changedFiles(process.cwd(), context.base);
    const tracked = git(process.cwd(), ["ls-files", "-z"]).split("\0").filter(Boolean);
    const plan = planImpact(readScope(), readWorkspaces(), tracked, { ...context, files });
    const sameTarget = (a, b) => a.os === b.os && a["node-version"] === b["node-version"];
    // The Governance target's split runs as dedicated Linux jobs on every event (ADR-0055).
    const split = config.splitTargets.filter(row => !sameTarget(row, GOVERNANCE_TARGET));
    const compat = OS_TARGETS.flatMap(os => NODE_TARGETS.map(node => ({ os, "node-version": node })))
      .filter(target => !config.splitTargets.some(row => sameTarget(row, target)));
    for (const [key, value] of Object.entries({ plan, families: plan.families, split: { include: split }, shards: { include: shardMatrix(split) }, compat: { include: compat } })) {
      appendFileSync(env.GITHUB_OUTPUT, `${key}=${JSON.stringify(value)}\n`);
    }
    if (env.GITHUB_STEP_SUMMARY) {
      appendFileSync(env.GITHUB_STEP_SUMMARY, `### Verify impact plan\n\nMode: \`${plan.mode}\` (${plan.event}, base \`${plan.base ?? "none"}\`, ${plan.files.length} changed paths)\n\n`
        + `Platform families: ${plan.families.map(id => `\`${id}\``).join(", ") || "none"}\n\nAffected workspaces (the Linux job runs the complete suite): ${plan.workspaces.map(name => `\`${name}\``).join(", ")}\n`);
    }
  } else if (command === "gate") {
    assert(env.VERIFY_PLAN, "missing or empty impact plan");
    const results = gateVerdict(readScope(), readWorkspaces(), JSON.parse(env.VERIFY_PLAN), JSON.parse(env.VERIFY_NEEDS), eventContext());
    console.log(`Verify gate passed: ${JSON.stringify(results)}`);
  } else if (command === "plan") {
    const files = discoverTestFiles(process.cwd());
    assert(files.length, "CI discovery cannot be empty");
    const row = config.splitTargets.find(row => targetName(row.os, row["node-version"]) === env.VERIFY_TARGET);
    assert(row, "target is not authorized for sharding");
    jsonWrite(temporaryPath("VERIFY_PLAN", "verify-plan", "plan.json"), { version: 1, subject: subject(env), target: env.VERIFY_TARGET, files,
      groups: partitionFiles(files, config.fileWeightsMs, row.shards) });
    // The dedicated Linux shard matrix comes from the same config row as the plan's groups.
    appendFileSync(env.GITHUB_OUTPUT, `shards=${JSON.stringify({ include: shardMatrix([row]) })}\n`);
  } else if (command === "shard") {
    const plan = JSON.parse(readFileSync(temporaryPath("VERIFY_PLAN", "verify-plan", "plan.json"), "utf8"));
    assert.deepEqual(plan.subject, subject(env));
    assert.equal(plan.target, env.VERIFY_TARGET);
    await executeShard(process.cwd(), plan, Number(env.VERIFY_SHARD_INDEX), temporaryPath("VERIFY_EVIDENCE", "verify-evidence"));
  } else if (command === "coverage") {
    const plan = JSON.parse(readFileSync(temporaryPath("VERIFY_PLAN", "verify-plan", "plan.json"), "utf8"));
    const directory = temporaryPath("VERIFY_REPORTS", "verify-reports");
    const reports = readdirSync(directory).map(dir => JSON.parse(readFileSync(join(directory, dir, "report.json"), "utf8")));
    validateCoverage(plan, reports, subject(env));
    console.log(`Verified ${plan.files.length} Bun-discovered files exactly once across ${plan.groups.length} isolated shards`);
  } else if (command === "cost") {
    // `cost` only measures the current attempt's runner minutes, so it reads the snapshot once.
    const { run, jobs } = await hostedJobs(env);
    const metrics = runnerMinutes(jobs);
    const evidence = temporaryPath("VERIFY_EVIDENCE", "verify-evidence");
    jsonWrite(join(evidence, "runner-minutes.json"), { runId: run.id, attempt: run.run_attempt, headSha: run.head_sha, ...metrics });
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Measured runner time (current attempt)\n\nCompleted jobs: ${metrics.completedMinutes.toFixed(2)} raw runner minutes; per-job rounded model ${metrics.roundedCompletedMinutes}. Completed installs: ${metrics.installJobs}, ${metrics.installMinutes.toFixed(2)} runner minutes. ${metrics.note}\n`);
  } else throw new Error(`Unknown verify-ci command: ${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
}
