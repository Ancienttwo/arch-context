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
export const GOVERNANCE_WORKER = workerName(GOVERNANCE_TARGET.os, GOVERNANCE_TARGET["node-version"], "full");
const CONFIG_PATH = new URL("../.github/verify-sharding.json", import.meta.url);
const SCOPE_PATH = new URL("../.github/verify-scope.json", import.meta.url);

export function readConfig() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  assert.equal(config.version, 1);
  for (const row of config.splitTargets) {
    assert(OS_TARGETS.includes(row.os) && NODE_TARGETS.includes(row["node-version"]));
    assert(Number.isInteger(row.shards) && row.shards > 1);
  }
  assert.equal(new Set(config.splitTargets.map(row => targetName(row.os, row["node-version"]))).size, config.splitTargets.length);
  assert(!config.splitTargets.some(row => row.os === GOVERNANCE_TARGET.os && row["node-version"] === GOVERNANCE_TARGET["node-version"]), "shared Governance prerequisite must remain a full worker");
  return config;
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

export function readScope() {
  const scope = JSON.parse(readFileSync(SCOPE_PATH, "utf8"));
  assert.equal(scope.version, 1);
  for (const key of ["matrixPaths", "linuxPaths"]) {
    assert(Array.isArray(scope[key]) && scope[key].length > 0, `${key} must be a non-empty array`);
    assert(scope[key].every(pattern => typeof pattern === "string" && pattern.length > 0), `${key} must contain non-empty strings`);
  }
  return { matrix: scope.matrixPaths.map(globToRegExp), linux: scope.linuxPaths.map(globToRegExp) };
}

/** Matrix globs win over linux globs; a path matching no linux glob is unclassified and forces the matrix. */
export function classifyPaths(scope, paths) {
  const matrixPaths = paths.filter(path => scope.matrix.some(re => re.test(path)) || !scope.linux.some(re => re.test(path)));
  return { lane: paths.length > 0 && matrixPaths.length === 0 ? "linux" : "matrix", matrixPaths };
}

/** pull_request checks out the synthetic merge commit; its first parent is the base. */
export function changedPaths(cwd) {
  const git = args => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false, maxBuffer: 64 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed (${result.status}): ${result.stderr}`);
    return result.stdout;
  };
  const parents = git(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(/\s+/).length - 1;
  if (parents !== 2) throw new Error(`pull_request checkout must be a merge commit with two parents, found ${parents}`);
  return git(["diff", "--name-only", "--no-renames", "-z", "HEAD^1", "HEAD"]).split("\0").filter(Boolean);
}

export function laneTargets(lane) {
  if (lane === "linux") return [GOVERNANCE_TARGET];
  if (lane === "matrix") return OS_TARGETS.flatMap(os => NODE_TARGETS.map(node => ({ os, "node-version": node })));
  throw new Error(`Unknown verify lane: ${lane}`);
}

export function subject(env = process.env) {
  const value = { runId: Number(env.GITHUB_RUN_ID), attempt: Number(env.GITHUB_RUN_ATTEMPT), checkoutSha: env.GITHUB_SHA };
  assert(Number.isSafeInteger(value.runId) && value.runId > 0);
  assert(Number.isSafeInteger(value.attempt) && value.attempt > 0);
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
    // Bun 1.4.3 deliberately exits 1 when a name pattern matches no tests. Other failures are refused.
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

export function expectedWorkers(config, os, node) {
  const row = config.splitTargets.find(row => row.os === os && row["node-version"] === node);
  return row
    ? [workerName(os, node, "pre"), ...Array.from({ length: row.shards }, (_, i) => workerName(os, node, `shard ${i + 1}`)), workerName(os, node, "post")]
    : [workerName(os, node, "full")];
}

export function jobVerdicts(config, run, jobs, targets) {
  const verdicts = {};
  for (const { os, "node-version": node } of targets) {
    verdicts[targetName(os, node)] = expectedWorkers(config, os, node).every(name => {
      const matches = jobs.filter(job => job.name === name);
      return matches.length === 1 && matches[0].status === "completed" && matches[0].conclusion === "success"
        && matches[0].run_id === run.id && matches[0].run_attempt === run.run_attempt && matches[0].head_sha === run.head_sha;
    });
  }
  return verdicts;
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

export async function hostedJobs(env = process.env, read = githubRead) {
  const repository = env.GITHUB_REPOSITORY;
  assert.match(repository ?? "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  const identity = subject(env);
  const run = await read(`repos/${repository}/actions/runs/${identity.runId}`, env);
  assert.equal(run.id, identity.runId);
  assert.equal(run.run_attempt, identity.attempt);
  const jobs = [];
  for (let page = 1; ; page++) {
    const response = await read(`repos/${repository}/actions/runs/${identity.runId}/attempts/${identity.attempt}/jobs?per_page=100&page=${page}`, env);
    assert(Number.isSafeInteger(response.total_count) && response.total_count >= 0 && Array.isArray(response.jobs), "invalid GitHub jobs response");
    jobs.push(...response.jobs);
    if (jobs.length >= response.total_count) { assert.equal(jobs.length, response.total_count); break; }
    assert(response.jobs.length, "GitHub jobs pagination is incomplete");
  }
  assert.equal(new Set(jobs.map(job => job.id)).size, jobs.length, "GitHub jobs pagination contains duplicates");
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

export function validateGovernancePrerequisite(identity, run, jobs, context) {
  assert(["pull_request", "push", "workflow_dispatch"].includes(context.eventName));
  assert.equal(context.prerequisiteResult, "success", "Linux full prerequisite did not succeed");
  assert.match(context.prerequisiteCheckoutSha ?? "", /^[a-f0-9]{40}$/, "missing/invalid prerequisite checkout");
  assert.equal(context.actualCheckoutSha, identity.checkoutSha, "Governance checkout differs from this event");
  assert.equal(context.prerequisiteCheckoutSha, identity.checkoutSha, "Linux full verified a different checkout");
  assert.equal(run.id, identity.runId, "different prerequisite run");
  assert.equal(run.run_attempt, identity.attempt, "different prerequisite attempt");
  assert.equal(run.path, ".github/workflows/verify.yml", "different prerequisite workflow");
  assert.equal(run.event, context.eventName, "different prerequisite event");
  assert.match(context.sourceHeadSha ?? "", /^[a-f0-9]{40}$/);
  assert.equal(run.head_sha, context.sourceHeadSha, "different prerequisite source HEAD");
  const matches = jobs.filter(job => job.name === GOVERNANCE_WORKER);
  assert.equal(matches.length, 1, "missing/duplicate Linux full prerequisite");
  const job = matches[0];
  assert(Number.isSafeInteger(job.id) && job.id > 0, "missing/invalid prerequisite job id");
  assert.equal(job.status, "completed", "Linux full prerequisite is incomplete");
  assert.equal(job.conclusion, "success", "Linux full prerequisite was not successful");
  assert.equal(job.run_id, run.id);
  assert.equal(job.run_attempt, run.run_attempt);
  assert.equal(job.head_sha, run.head_sha);
  const verifySteps = (job.steps ?? []).filter(step => step.name === "Verify");
  assert.equal(verifySteps.length, 1, "missing/duplicate full Verify step");
  assert.equal(verifySteps[0].status, "completed");
  assert.equal(verifySteps[0].conclusion, "success", "full Verify step was not successful");
  return job;
}

export async function verifyGovernancePrerequisite(env = process.env) {
  assert.equal(env.GITHUB_ACTIONS, "true", "hosted inspections require the current GitHub Actions run");
  const identity = subject(env);
  const sourceHeadSha = governanceSourceHead(env);
  const checkout = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", shell: false });
  assert.equal(checkout.status, 0, "cannot read Governance checkout");
  const { run, jobs } = await hostedJobs(env);
  const job = validateGovernancePrerequisite(identity, run, jobs, {
    eventName: env.GITHUB_EVENT_NAME, sourceHeadSha, actualCheckoutSha: checkout.stdout.trim(),
    prerequisiteResult: env.VERIFY_PREREQUISITE_RESULT,
    prerequisiteCheckoutSha: env.VERIFY_PREREQUISITE_CHECKOUT_SHA
  });
  return { runId: run.id, attempt: run.run_attempt, sourceHeadSha: run.head_sha, checkoutSha: identity.checkoutSha, jobId: job.id };
}

export async function main(command, env = process.env) {
  const config = readConfig();
  const temporaryPath = (key, ...parts) => {
    if (env[key]) return env[key];
    assert(env.RUNNER_TEMP, `${key} requires the runner's temporary directory`);
    return join(env.RUNNER_TEMP, ...parts);
  };
  if (command === "topology") {
    assert(["pull_request", "push"].includes(env.GITHUB_EVENT_NAME), "topology requires a pull_request or push event");
    const classification = env.GITHUB_EVENT_NAME === "pull_request" ? classifyPaths(readScope(), changedPaths(process.cwd())) : { lane: "matrix", matrixPaths: [] };
    const { lane } = classification;
    const split = config.splitTargets;
    const shards = split.flatMap(row => Array.from({ length: row.shards }, (_, index) => ({ ...row, index, shard: index + 1 })));
    for (const [key, value] of Object.entries({ split: { include: split }, shards: { include: shards }, excluded: [...split.map(({ os, "node-version": node }) => ({ os, "node-version": node })), GOVERNANCE_TARGET],
      targets: { include: laneTargets(lane) } })) {
      appendFileSync(env.GITHUB_OUTPUT, `${key}=${JSON.stringify(value)}\n`);
    }
    appendFileSync(env.GITHUB_OUTPUT, `lane=${lane}\n`);
    if (env.GITHUB_STEP_SUMMARY) {
      const forced = classification.matrixPaths.slice(0, 20).map(path => `- \`${path}\``).join("\n");
      appendFileSync(env.GITHUB_STEP_SUMMARY, `### Verify lane\n\nLane: \`${lane}\` (${env.GITHUB_EVENT_NAME})\n${forced ? `\nPaths that forced the matrix lane${classification.matrixPaths.length > 20 ? " (first 20)" : ""}:\n\n${forced}\n` : ""}`);
    }
  } else if (command === "plan") {
    const files = discoverTestFiles(process.cwd());
    assert(files.length, "CI discovery cannot be empty");
    const row = config.splitTargets.find(row => targetName(row.os, row["node-version"]) === env.VERIFY_TARGET);
    assert(row, "target is not authorized for sharding");
    jsonWrite(temporaryPath("VERIFY_PLAN", "verify-plan", "plan.json"), { version: 1, subject: subject(env), target: env.VERIFY_TARGET, files,
      groups: partitionFiles(files, config.fileWeightsMs, row.shards) });
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
  } else if (command === "collect" || command === "cost") {
    const { run, jobs } = await hostedJobs(env);
    const metrics = runnerMinutes(jobs);
    const evidence = temporaryPath("VERIFY_EVIDENCE", "verify-evidence");
    jsonWrite(join(evidence, "runner-minutes.json"), { runId: run.id, attempt: run.run_attempt, headSha: run.head_sha, ...metrics });
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Measured runner time (current attempt)\n\nCompleted jobs: ${metrics.completedMinutes.toFixed(2)} raw runner minutes; per-job rounded model ${metrics.roundedCompletedMinutes}. Completed installs: ${metrics.installJobs}, ${metrics.installMinutes.toFixed(2)} runner minutes. ${metrics.note}\n`);
    if (command === "collect") {
      const verdicts = jobVerdicts(config, run, jobs, laneTargets(env.VERIFY_LANE));
      appendFileSync(env.GITHUB_OUTPUT, `verdicts=${JSON.stringify(verdicts)}\n`);
      jsonWrite(join(evidence, "job-verdicts.json"), { runId: run.id, attempt: run.run_attempt, headSha: run.head_sha, verdicts });
    }
  } else throw new Error(`Unknown verify-ci command: ${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
}
