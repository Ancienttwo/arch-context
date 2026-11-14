import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  discoverTestFiles, executeShard, expectedWorkers, globToRegExp,
  NODE_TARGETS, OS_TARGETS, partitionFiles, readConfig, readScope, runnerMinutes, validateConfig, validateCoverage,
  governanceReceiptPending, governanceSourceHead, hostedJobs,
  readGovernanceReceipt, RECEIPT_GATE_STEPS, RECEIPT_READ_ATTEMPTS, receiptJobs, validateGovernancePrerequisite, latestAttemptPerName,
  readWorkspaces, selectImpact, planImpact, gateVerdict, comparisonBase, changedFiles, RELEASE_REF
} from "./verify-ci.mjs";

const identity = { runId: 123, checkoutSha: "a".repeat(40) };

/** The hosted-read identity environment a Governance receipt read needs. */
const governedEnv = (context: { sourceHeadSha: string }) => ({ GITHUB_REPOSITORY: "Ancienttwo/arch-context",
  GITHUB_RUN_ID: String(identity.runId), GITHUB_RUN_ATTEMPT: "1",
  GITHUB_SHA: context.sourceHeadSha });
const LINUX_PRE = "Verify execution: ubuntu-latest / Node 22.22.x / pre";
const LINUX_POST = "Verify execution: ubuntu-latest / Node 22.22.x / post";
const linuxShard = (shard: number) => `Verify execution: ubuntu-latest / Node 22.22.x / shard ${shard}`;

function governanceFixture(eventName = "pull_request") {
  const config = readConfig();
  const sourceHeadSha = eventName === "pull_request" ? "b".repeat(40) : identity.checkoutSha;
  const run = { id: identity.runId, run_attempt: 1, head_sha: sourceHeadSha, event: eventName, path: ".github/workflows/verify.yml" };
  const names = expectedWorkers(config, "ubuntu-latest", "22.22.x");
  const jobs = names.map((name, index) => ({ id: 17 + index, name, status: "completed", conclusion: "success", run_id: run.id,
    run_attempt: run.run_attempt, head_sha: sourceHeadSha,
    steps: RECEIPT_GATE_STEPS[index === 0 ? "pre" : index === names.length - 1 ? "post" : "shard"]
      .map(step => ({ name: step, status: "completed", conclusion: "success" })) }));
  return { config, run, jobs, context: { eventName, sourceHeadSha, actualCheckoutSha: identity.checkoutSha,
    prerequisiteResult: "success", prerequisiteCheckoutSha: identity.checkoutSha } };
}

/** The same receipt after a "Re-run failed jobs" of `rerun` put those jobs, and their dependents, in attempt 2. */
function rerunFixture(rerun: (name: string) => boolean) {
  const fixture: any = governanceFixture("push");
  const second = fixture.jobs.filter((job: any) => rerun(job.name)).map((job: any, index: number) => ({ ...structuredClone(job), id: 90 + index, run_attempt: 2 }));
  return { ...fixture, run: { ...fixture.run, run_attempt: 2 }, jobs: [...fixture.jobs, ...second] };
}

test("Governance binds every Linux split job of the run across its attempts and both checkouts while distinguishing PR merge/source SHAs", () => {
  for (const event of ["pull_request", "push", "workflow_dispatch"]) {
    const { config, run, jobs, context } = governanceFixture(event);
    expect(jobs.map(job => job.name)).toEqual([LINUX_PRE, linuxShard(1), linuxShard(2), linuxShard(3), LINUX_POST]);
    expect(validateGovernancePrerequisite(config, identity, run, jobs, context)).toEqual(jobs);
    expect(run.head_sha === identity.checkoutSha).toBe(event !== "pull_request");
  }
});

test("Governance rejects green booleans with missing, stale, duplicate, cancelled, skipped or mismatched provider evidence", () => {
  const mutations: ((fixture: any) => void)[] = [
    f => f.jobs = [],
    f => f.run.id++, f => f.run.head_sha = "c".repeat(40),
    f => f.run.path = ".github/workflows/other.yml", f => f.run.event = "push",
    f => f.context.eventName = "pull_request_target", f => f.context.sourceHeadSha = "",
    f => f.context.actualCheckoutSha = "b".repeat(40),
    f => f.context.prerequisiteCheckoutSha = "b".repeat(40), f => f.context.prerequisiteCheckoutSha = ""
  ];
  for (const conclusion of ["failure", "skipped", "cancelled", "timed_out", "neutral", null]) mutations.push(f => f.context.prerequisiteResult = conclusion);
  for (let job = 0; job < governanceFixture().jobs.length; job++) {
    mutations.push(f => f.jobs.push(structuredClone(f.jobs[job])), f => f.jobs[job].id = undefined, f => f.jobs[job].name = "unrelated worker",
      f => f.jobs[job].run_id++, f => f.jobs[job].head_sha = "c".repeat(40),
      f => f.jobs[job].status = "in_progress", f => f.jobs[job].steps = []);
    for (const conclusion of ["failure", "skipped", "cancelled", "timed_out", "neutral", null]) mutations.push(f => f.jobs[job].conclusion = conclusion);
    for (let step = 0; step < governanceFixture().jobs[job].steps.length; step++) {
      mutations.push(f => f.jobs[job].steps.splice(step, 1), f => f.jobs[job].steps.push(structuredClone(f.jobs[job].steps[step])),
        f => f.jobs[job].steps[step].status = "in_progress");
      for (const conclusion of ["failure", "skipped", "cancelled", null]) mutations.push(f => f.jobs[job].steps[step].conclusion = conclusion);
    }
  }
  for (const mutate of mutations) {
    const fixture = governanceFixture(); mutate(fixture);
    expect(() => validateGovernancePrerequisite(fixture.config, identity, fixture.run, fixture.jobs, fixture.context)).toThrow();
  }
});

test("Governance fails closed by name for each invalid composite receipt branch", () => {
  const reject = (mutate: (fixture: any) => void, message: string) => {
    const fixture = governanceFixture(); mutate(fixture);
    expect(() => validateGovernancePrerequisite(fixture.config, identity, fixture.run, fixture.jobs, fixture.context)).toThrow(message);
  };
  const job = (fixture: any, name: string) => fixture.jobs.find((candidate: any) => candidate.name === name);
  reject(f => f.jobs = f.jobs.filter((candidate: any) => candidate.name !== linuxShard(2)), `missing/duplicate prerequisite job: ${linuxShard(2)}`);
  reject(f => job(f, linuxShard(3)).conclusion = "skipped", `prerequisite job was not successful: ${linuxShard(3)}`);
  reject(f => job(f, LINUX_PRE).conclusion = "cancelled", `prerequisite job was not successful: ${LINUX_PRE}`);
  reject(f => job(f, linuxShard(1)).head_sha = "c".repeat(40), `prerequisite job ran on a different head: ${linuxShard(1)}`);
  reject(f => f.context.prerequisiteCheckoutSha = "c".repeat(40), "Linux post verified a different checkout");
  reject(f => job(f, LINUX_POST).steps = job(f, LINUX_POST).steps.filter((step: any) => step.name !== "Prove each discovered file executed exactly once"),
    `missing/duplicate gate step "Prove each discovered file executed exactly once": ${LINUX_POST}`);
  reject(f => f.config.splitTargets.find((row: any) => row.os === "ubuntu-latest").shards = 4, `missing/duplicate prerequisite job: ${linuxShard(4)}`);
});

test("ADR-0055: a partial rerun keeps the receipt when its rerun jobs pass in the new attempt", () => {
  // "Re-run failed jobs" on shard 1 reruns that job and its dependent post job, so those two names
  // carry an attempt-2 record and the other three keep their attempt-1 record.
  const rerun = (name: string) => name === linuxShard(1) || name === LINUX_POST;
  const { config, run, jobs, context } = rerunFixture(rerun);
  expect(run.run_attempt).toBe(2);
  for (const name of [linuxShard(1), LINUX_POST]) {
    expect(jobs.filter((job: any) => job.name === name).map((job: any) => job.run_attempt).sort()).toEqual([1, 2]);
  }
  expect(latestAttemptPerName(jobs, [LINUX_PRE, linuxShard(1), linuxShard(2), linuxShard(3), LINUX_POST]).get(linuxShard(1))?.run_attempt).toBe(2);
  expect(validateGovernancePrerequisite(config, identity, run, jobs, context).map(job => job.run_attempt)).toEqual([1, 2, 1, 1, 2]);
});

test("ADR-0055: the latest attempt per job name wins, so a failed or unsettled rerun still fails the receipt", () => {
  const rerun = (name: string) => name === linuxShard(2);
  // The rerun shard 2 fails while its attempt-1 record succeeded: the later attempt is the one that counts.
  const failedRerun = rerunFixture(rerun);
  failedRerun.jobs.find((job: any) => job.name === linuxShard(2) && job.run_attempt === 2).conclusion = "failure";
  expect(() => validateGovernancePrerequisite(failedRerun.config, identity, failedRerun.run, failedRerun.jobs, failedRerun.context))
    .toThrow(`prerequisite job was not successful: ${linuxShard(2)}`);

  // A rerun that has not settled yet is nonterminal, never the earlier green attempt.
  const inFlightRerun = rerunFixture(rerun);
  const runningJob = inFlightRerun.jobs.find((job: any) => job.name === linuxShard(2) && job.run_attempt === 2);
  runningJob.status = "in_progress";
  runningJob.conclusion = null;
  expect(governanceReceiptPending(inFlightRerun.config, inFlightRerun.jobs)).toEqual([{ job: linuxShard(2), reason: "incomplete", status: "in_progress", conclusion: null }]);
  expect(() => validateGovernancePrerequisite(inFlightRerun.config, identity, inFlightRerun.run, inFlightRerun.jobs, inFlightRerun.context))
    .toThrow(`prerequisite job is incomplete: ${linuxShard(2)}`);

  // A name that two jobs of one attempt claim has no single latest record and fails closed by name.
  const duplicated = rerunFixture(name => name === linuxShard(3));
  duplicated.jobs.push({ ...structuredClone(duplicated.jobs.find((job: any) => job.name === linuxShard(3) && job.run_attempt === 2)), id: 500 });
  expect(() => validateGovernancePrerequisite(duplicated.config, identity, duplicated.run, duplicated.jobs, duplicated.context))
    .toThrow(`missing/duplicate prerequisite job: ${linuxShard(3)}`);
});

test("ADR-0055: the live rerun shape, where the new attempt relists every job with a new id, also passes", () => {
  // Live run 42973691799 attempt 2 relists all 35 jobs: carried jobs are not dropped, they reappear
  // under attempt 2 with new ids. The receipt must read that shape the same way as a partial one.
  const fixture: any = governanceFixture("push");
  const carried = fixture.jobs.map((job: any, index: number) => ({ ...structuredClone(job), id: 300 + index, run_attempt: 2 }));
  const live = { ...fixture, run: { ...fixture.run, run_attempt: 2 }, jobs: carried };
  expect(validateGovernancePrerequisite(live.config, identity, live.run, live.jobs, live.context).map((job: any) => job.run_attempt)).toEqual([2, 2, 2, 2, 2]);
  expect(governanceReceiptPending(live.config, live.jobs)).toEqual([]);
  // Job ids are disjoint across the two attempts, so the cross-attempt duplicate-id guard stays quiet.
  expect(governanceReceiptPending(live.config, [...fixture.jobs, ...carried])).toEqual([]);
  expect(() => validateGovernancePrerequisite(live.config, identity, live.run, [...live.jobs, { ...carried[1], id: 900 }], live.context))
    .toThrow(`missing/duplicate prerequisite job: ${linuxShard(1)}`);
});

test("ADR-0055: the receipt readback spans every attempt of the run and refuses a run-level mismatch", async () => {
  const env = { GITHUB_REPOSITORY: "Ancienttwo/arch-context", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2", GITHUB_SHA: identity.checkoutSha };
  const { run, jobs } = rerunFixture(name => name === linuxShard(1));
  const firstAttempt = jobs.filter((job: any) => job.run_attempt === 1);
  const secondAttempt = jobs.filter((job: any) => job.run_attempt === 2);
  const paths: string[] = [];
  const read = async (path: string) => {
    paths.push(path);
    if (!path.includes("/jobs?")) return run;
    const batch = path.includes("/attempts/1/") ? firstAttempt : secondAttempt;
    return { total_count: batch.length, jobs: batch };
  };
  expect(await receiptJobs(env, read)).toEqual({ run, jobs: [...firstAttempt, ...secondAttempt] });
  expect(paths.filter(path => path.includes("/jobs?"))).toEqual([
    "repos/Ancienttwo/arch-context/actions/runs/123/attempts/1/jobs?per_page=100&page=1",
    "repos/Ancienttwo/arch-context/actions/runs/123/attempts/2/jobs?per_page=100&page=1"
  ]);
  await expect(receiptJobs(env, async () => ({ ...run, id: 124 }))).rejects.toThrow();
  await expect(receiptJobs({ ...env, GITHUB_RUN_ID: "not-a-run" }, read)).rejects.toThrow();

  // ADR-0055: the latest-attempt rule compares `run_attempt` with `>`, so a record read under
  // attempt n that claims another attempt must be refused at the boundary, never ranked.
  const foreign = async (path: string) => {
    if (!path.includes("/jobs?")) return run;
    const batch = (path.includes("/attempts/1/") ? firstAttempt : secondAttempt).map((job: any) => ({ ...job, run_attempt: 1 }));
    return { total_count: batch.length, jobs: batch };
  };
  await expect(receiptJobs(env, foreign)).rejects.toThrow("is not from attempt");
});

test("Governance reads the immutable PR event source head and rejects missing or malformed authority", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-governance-event-"));
  const path = join(root, "event.json");
  const env = { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: path, GITHUB_SHA: identity.checkoutSha };
  try {
    writeFileSync(path, JSON.stringify({ pull_request: { head: { sha: "b".repeat(40) } } }));
    expect(governanceSourceHead(env)).toBe("b".repeat(40));
    for (const body of ["{", "{}", JSON.stringify({ pull_request: { head: { sha: "invalid" } } })]) {
      writeFileSync(path, body); expect(() => governanceSourceHead(env)).toThrow();
    }
    rmSync(path);
    expect(() => governanceSourceHead(env)).toThrow();
    for (const event of ["push", "workflow_dispatch"]) expect(governanceSourceHead({ ...env, GITHUB_EVENT_NAME: event })).toBe(identity.checkoutSha);
    expect(() => governanceSourceHead({ ...env, GITHUB_EVENT_NAME: "pull_request_target" })).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("hosted readback uses the current attempt's provider jobs and refuses API/pagination failures without artifacts", async () => {
  const env = { GITHUB_REPOSITORY: "Ancienttwo/arch-context", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: identity.checkoutSha };
  const { run, jobs } = governanceFixture();
  const paths: string[] = [];
  const valid = await hostedJobs(env, async (path: string) => {
    paths.push(path); return path.includes("/jobs?") ? { total_count: jobs.length, jobs } : run;
  });
  expect(valid).toEqual({ run, jobs });
  expect(paths).toEqual(["repos/Ancienttwo/arch-context/actions/runs/123", "repos/Ancienttwo/arch-context/actions/runs/123/attempts/1/jobs?per_page=100&page=1"]);
  await expect(hostedJobs(env, async () => ({ ...run, id: 122 }))).rejects.toThrow();
  // ADR-0055: hostedJobs keeps its main behavior and still requires this attempt, so the collector
  // behind `ubuntu-latest / Node 22.22.x` is unchanged by the run-scoped receipt.
  await expect(hostedJobs(env, async () => ({ ...run, run_attempt: 2 }))).rejects.toThrow();
  await expect(hostedJobs(env, async () => { throw new Error("provider read failed"); })).rejects.toThrow("provider read failed");
  for (const mode of ["missing-page", "duplicate-id", "overcount", "invalid-count"]) {
    await expect(hostedJobs(env, async (path: string) => {
      if (!path.includes("/jobs?")) return run;
      if (mode === "invalid-count") return { total_count: -1, jobs: [] };
      if (mode === "overcount") return { total_count: 0, jobs };
      if (path.endsWith("page=1")) return { total_count: 2, jobs };
      return { total_count: 2, jobs: mode === "missing-page" ? [] : jobs };
    })).rejects.toThrow();
  }
});

test("native Bun discovery, additions/deletions, spaces and empty files agree with a real unfiltered run", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-shard-discovery-test-"));
  const marker = join(root, "bodies-ran");
  const body = `import {test,expect} from "bun:test"; import {appendFileSync} from "node:fs"; test("body",()=>{appendFileSync(${JSON.stringify(marker)},"ran\\n");expect(1).toBe(1)});`;
  const put = (file: string, value = body) => { mkdirSync(join(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), value); };
  try {
    put("a.test.ts"); put("space folder/b.spec.ts"); put("nested/a.test.ts");
    put("empty.test.ts", "export const empty = true;");
    put("nested/test-not-bun.ts"); put("node_modules/ignored.test.ts");
    const files = discoverTestFiles(root, process.execPath);
    expect(existsSync(marker)).toBe(false);
    expect(files).toEqual(["a.test.ts", "empty.test.ts", "nested/a.test.ts", "space folder/b.spec.ts"]);
    const reference = join(root, "reference.json");
    const native = spawnSync(process.execPath, ["test", `--timings=${reference}`, "--update-timings"], { cwd: root, encoding: "utf8" });
    expect(native.status).toBe(0);
    expect(Object.keys(JSON.parse(readFileSync(reference, "utf8")).files).sort()).toEqual(files);
    rmSync(marker);
    put("added.spec.ts"); rmSync(join(root, "nested/a.test.ts"));
    const changed = discoverTestFiles(root, process.execPath);
    expect(changed).toEqual(["a.test.ts", "added.spec.ts", "empty.test.ts", "space folder/b.spec.ts"]);
    const groups = partitionFiles(changed, { "nested/a.test.ts": 1_000_000, "a.test.ts": 5_000 }, 3);
    const plan = { version: 1, subject: identity, target: "fixture", files: changed, groups };
    const reports: Awaited<ReturnType<typeof executeShard>>[] = [];
    for (let index = 0; index < groups.length; index++) reports.push(await executeShard(root, plan, index, join(root, `evidence-${index}`), process.execPath));
    validateCoverage(plan, reports, identity);
    expect(readFileSync(marker, "utf8").trim().split("\n")).toHaveLength(3);
    expect(reports.flatMap(report => report.files).sort()).toEqual(changed);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an empty shard is explicitly accounted for, never accidentally runs the entire suite", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-empty-shard-test-"));
  try {
    writeFileSync(join(root, "one.test.ts"), 'import {test,expect} from "bun:test"; test("one",()=>expect(1).toBe(1));');
    const files = discoverTestFiles(root, process.execPath);
    const plan = { version: 1, subject: identity, target: "fixture", files, groups: partitionFiles(files, {}, 3) };
    const reports: Awaited<ReturnType<typeof executeShard>>[] = [];
    for (let index = 0; index < 3; index++) reports.push(await executeShard(root, plan, index, join(root, `evidence-${index}`), process.execPath));
    expect(reports.map(report => report.files.length)).toEqual([1, 0, 0]);
    validateCoverage(plan, reports, identity);
    expect(() => validateCoverage(plan, reports.slice(0, 2), identity)).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("discovery refuses module evaluation failures instead of treating them as a filtered inventory", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-bad-discovery-test-"));
  try {
    writeFileSync(join(root, "broken.test.ts"), 'throw new Error("fixture module failure");');
    expect(() => discoverTestFiles(root, process.execPath)).toThrow("Bun discovery failed");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the actual plan/shard/coverage commands transfer only run-bound metadata between fresh stages", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-ci-command-test-"));
  const entry = fileURLToPath(new URL("./verify-ci.mjs", import.meta.url));
  const runner = join(root, "runner");
  const baseEnv = { ...process.env, RUNNER_TEMP: runner, GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: identity.checkoutSha,
    VERIFY_TARGET: "macos-15 / Node 22.22.x", GITHUB_OUTPUT: join(root, "github-output") };
  const command = (name: string, env: NodeJS.ProcessEnv = baseEnv) => {
    const result = spawnSync("node", [entry, name], { cwd: root, env, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    return result;
  };
  try {
    mkdirSync(runner);
    writeFileSync(join(root, "one.test.ts"), 'import {test,expect} from "bun:test";test("one",()=>expect(1).toBe(1));');
    command("plan");
    const plan = JSON.parse(readFileSync(join(runner, "verify-plan/plan.json"), "utf8"));
    expect(plan.subject).toEqual(identity);
    expect(readOutputs(join(root, "github-output")).shards.include)
      .toEqual([1, 2, 3].map(shard => ({ os: "macos-15", "node-version": "22.22.x", shards: 3, index: shard - 1, shard })));
    for (let index = 0; index < 3; index++) {
      const evidence = join(runner, "verify-reports", `artifact-${index}`);
      command("shard", { ...baseEnv, VERIFY_SHARD_INDEX: String(index), VERIFY_EVIDENCE: evidence });
    }
    expect(command("coverage").stdout).toContain("1 Bun-discovered files exactly once across 3 isolated shards");
    // ADR-0055: a rerun shard runs in a new attempt on a fresh runner, reusing the run's plan and
    // replacing its own report (the artifact name carries no attempt and its upload overwrites).
    for (let index = 0; index < 3; index++) {
      const evidence = join(runner, "verify-reports", `artifact-${index}`);
      rmSync(evidence, { recursive: true, force: true });
      command("shard", { ...baseEnv, GITHUB_RUN_ATTEMPT: "2", VERIFY_SHARD_INDEX: String(index), VERIFY_EVIDENCE: evidence });
    }
    expect(command("coverage", { ...baseEnv, GITHUB_RUN_ATTEMPT: "2" }).stdout).toContain("1 Bun-discovered files exactly once across 3 isolated shards");
    expect(() => command("coverage", { ...baseEnv, GITHUB_RUN_ID: "124" })).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("coverage rejects duplicates, omissions, failed runs and stale/cross-target report subjects", () => {
  const plan = { version: 1, subject: identity, target: "fixture", files: ["a.test.ts", "b.test.ts"], groups: [["a.test.ts"], ["b.test.ts"]] };
  const reports = plan.groups.map((files, index) => ({ version: 1, subject: identity, target: "fixture", index, exitCode: 0, files }));
  for (const mutate of [
    (r: any[]) => r.push(r[0]), (r: any[]) => r[1].files = ["a.test.ts"],
    (r: any[]) => r[0].files = [], (r: any[]) => r[0].exitCode = 1,
    (r: any[]) => r[0].subject.runId++, (r: any[]) => r[0].subject.checkoutSha = "b".repeat(40),
    (r: any[]) => r[0].target = "foreign"
  ]) {
    const changed = structuredClone(reports); mutate(changed);
    expect(() => validateCoverage(plan, changed, identity)).toThrow();
  }
  expect(() => validateCoverage({ ...plan, groups: [["a.test.ts"], ["a.test.ts"]] }, reports, identity)).toThrow();
});

test("runner cost sums parallel jobs and counts install time separately from wall clock", () => {
  const jobs = ["macos-15", "windows-latest"].map(os => ({ name: os, labels: [os], runner_id: 1, started_at: "2026-10-14T10:00:00Z", completed_at: "2026-10-14T10:01:30Z",
    steps: [{ name: "Install dependencies", started_at: "2026-10-14T10:00:00Z", completed_at: "2026-10-14T10:00:30Z" }] }));
  expect(runnerMinutes(jobs)).toMatchObject({ completedMinutes: 3, roundedCompletedMinutes: 4, installMinutes: 1, installJobs: 2, byOs: { macos: 1.5, windows: 1.5 } });
  expect(runnerMinutes([{ ...jobs[0], name: "macos-15 / Node 24.x", labels: ["ubuntu-latest"] }]).byOs).toEqual({ linux: 1.5 });
  expect(runnerMinutes([{ ...jobs[0], runner_id: 0, status: "skipped" }]).completedMinutes).toBe(0);
});

function readOutputs(path: string): Record<string, any> {
  return Object.fromEntries(readFileSync(path, "utf8").trim().split("\n").map(line => {
    const separator = line.indexOf("=");
    const key = line.slice(0, separator), value = line.slice(separator + 1);
    return [key, JSON.parse(value)];
  }));
}

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}

/** Base commit, a branch commit that edits `edits` and renames `renamed`, then a --no-ff merge so HEAD has two parents. */
function mergeRepo(root: string, edits: string[], renamed?: [string, string]) {
  const put = (file: string, body: string) => { mkdirSync(join(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), body); };
  git(root, "init", "-q", "-b", "main");
  for (const file of edits) put(file, "base\n");
  if (renamed) put(renamed[0], "rename me with enough content to be detected\n");
  put("seed.txt", "seed\n");
  git(root, "add", "-A"); git(root, "commit", "-q", "-m", "base");
  git(root, "checkout", "-q", "-b", "topic");
  for (const file of edits) put(file, "topic\n");
  if (renamed) { mkdirSync(join(root, renamed[1], ".."), { recursive: true }); git(root, "mv", renamed[0], renamed[1]); }
  git(root, "add", "-A"); git(root, "commit", "-q", "-m", "topic");
  git(root, "checkout", "-q", "main");
  put("main-only.txt", "main\n"); git(root, "add", "-A"); git(root, "commit", "-q", "-m", "main moves");
  git(root, "merge", "-q", "--no-ff", "-m", "merge", "topic");
}

test("globToRegExp treats ** as whole segments, * as one segment and everything else literally", () => {
  const matches = (pattern: string, path: string) => globToRegExp(pattern).test(path);
  expect(matches("**/package.json", "package.json")).toBe(true);
  expect(matches("**/package.json", "packages/a/b/package.json")).toBe(true);
  expect(matches("**/package.json", "packages/a/xpackage.json")).toBe(false);
  expect(matches("docs/**", "docs/a/b.md")).toBe(true);
  expect(matches("docs/**", "docsx/a.md")).toBe(false);
  expect(matches("a/**/b.ts", "a/b.ts")).toBe(true);
  expect(matches("a/**/b.ts", "a/x/y/b.ts")).toBe(true);
  expect(matches("*.md", "README.md")).toBe(true);
  expect(matches("*.md", "docs/a.md")).toBe(false);
  expect(matches("pkg/src/rpc-*.ts", "pkg/src/rpc-server.ts")).toBe(true);
  expect(matches("pkg/src/rpc-*.ts", "pkg/src/rpc-a/b.ts")).toBe(false);
  expect(matches("a.b", "a.b")).toBe(true);
  expect(matches("a.b", "axb")).toBe(false);
  expect(matches("a+(b)[c]$", "a+(b)[c]$")).toBe(true);
});

const SCOPE: any = readScope();
const WORKSPACES: any[] = readWorkspaces();
const ALL_WORKSPACES = WORKSPACES.map(workspace => workspace.name);
const TRACKED = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" }).stdout.split("\0").filter(Boolean);
const SHA = "a".repeat(40), BASE = "b".repeat(40);
const PLATFORM_PATH = "packages/local-runtime/git-adapter/src/index.ts";

/** The gate's `needs` for a plan whose selected jobs succeeded and whose other family jobs were skipped. */
function needsFor(plan: any) {
  const needs: Record<string, any> = { "verify-plan": { result: "success", outputs: {} } };
  for (const job of SCOPE.alwaysJobs) needs[job] = { result: "success", outputs: {} };
  for (const family of SCOPE.families) for (const job of family.jobs) needs[job] = { result: plan.families.includes(family.id) ? "success" : "skipped", outputs: {} };
  return needs;
}

function gateFixture(event: string) {
  const context = event === "workflow_dispatch"
    ? { event, ref: "refs/heads/main", sha: SHA, dispatchSha: SHA, base: null, files: [] as string[] }
    : { event, ref: event === "push" ? "refs/heads/main" : "refs/pull/603/merge", sha: SHA, dispatchSha: "", base: BASE, files: [PLATFORM_PATH] };
  const plan: any = planImpact(SCOPE, WORKSPACES, TRACKED, context);
  return { plan, needs: needsFor(plan), context };
}

test("each platform family is selected by a path it owns; shared-core and package-only paths select none", () => {
  const families = (...paths: string[]) => selectImpact(SCOPE, WORKSPACES, paths).families;
  expect(families(PLATFORM_PATH)).toEqual(["platform"]);
  expect(families("scripts/packaged-cli-smoke.mjs")).toEqual(["node-compat"]);
  expect(families("packages/core/changeset-engine/src/index.ts")).toEqual(["platform", "linux-arm64"]);
  // A shared-core path that no family owns selects no family; the Linux job covers it and every dependent.
  expect(selectImpact(SCOPE, WORKSPACES, ["packages/contracts/src/failure.ts"])).toEqual({ families: [], workspaces: ALL_WORKSPACES });
  // Workspace membership alone selects no family.
  expect(selectImpact(SCOPE, WORKSPACES, ["packages/core/policy-engine/src/index.ts"])).toEqual({ families: [],
    workspaces: ["archcontext", "@archcontext/core", "@archcontext/local-runtime", "@archcontext/cloud", "@archcontext/surfaces"] });
  expect(selectImpact(SCOPE, WORKSPACES, ["docs/runbooks/verify-sharding.md", "README.md"])).toEqual({ families: [], workspaces: [] });
  for (const path of ["bun.lock", "package.json", "packages/core/package.json", ".github/workflows/verify.yml", "scripts/verify-ci.mjs"]) {
    expect(families(path)).toEqual(["platform", "node-compat", "linux-arm64"]);
  }
});

test("every tracked path has a reviewed mapping and no routine selection contains the complete-suite family", () => {
  expect(TRACKED.length).toBeGreaterThan(1000);
  const union = new Set<string>();
  for (const path of TRACKED) for (const id of selectImpact(SCOPE, WORKSPACES, [path]).families) union.add(id);
  expect(union.has(SCOPE.completeSuite)).toBe(false);
  expect([...union].sort()).toEqual(SCOPE.families.map((family: any) => family.id).filter((id: string) => id !== SCOPE.completeSuite).sort());
  expect(selectImpact(SCOPE, WORKSPACES, TRACKED).families).not.toContain(SCOPE.completeSuite);
});

test("unmapped and malformed paths fail the plan with the reviewed-mapping error and no release hint", () => {
  for (const path of ["unmapped/file.ts", "Makefile", "", "/abs/file.ts", "docs/../x.md", "docs//a.md", "docs\\a.md", "./docs/a.md", "docs/a.md\0"]) {
    let message = "";
    try { selectImpact(SCOPE, WORKSPACES, ["docs/ok.md", path]); } catch (error: any) { message = error.message; }
    expect(message).toContain("Add a reviewed mapping for it to .github/verify-scope.json");
    expect(message).not.toMatch(/release|dispatch/i);
  }
});

test("release plans need an allowed ref and the exact approved SHA; routine plans never check the ref", () => {
  const release = (ref: any, dispatchSha = SHA) => planImpact(SCOPE, WORKSPACES, TRACKED, { event: "workflow_dispatch", ref, sha: SHA, dispatchSha, base: null, files: [] });
  for (const ref of ["refs/heads/main", "refs/heads/release/0.15", "refs/heads/release/archctx-0.15.0"]) {
    expect(RELEASE_REF.test(ref)).toBe(true);
    expect(release(ref)).toMatchObject({ mode: "release", families: SCOPE.families.map((family: any) => family.id), workspaces: ALL_WORKSPACES });
  }
  for (const ref of ["refs/heads/feat/603-x", "refs/heads/fix/603", "refs/tags/v0.15.0", "refs/heads/release/", "refs/heads/main2", "main", "refs/pull/603/merge", "", undefined]) {
    expect(() => release(ref)).toThrow("Release validation runs only on");
  }
  for (const dispatchSha of ["", "c".repeat(40), SHA.slice(0, 7), SHA.toUpperCase()]) expect(() => release("refs/heads/main", dispatchSha)).toThrow();
  for (const [event, ref] of [["pull_request", "refs/pull/603/merge"], ["push", "refs/heads/main"]]) {
    expect(planImpact(SCOPE, WORKSPACES, TRACKED, { event, ref, sha: SHA, base: BASE, files: [PLATFORM_PATH] }))
      .toMatchObject({ mode: "routine", ref, base: BASE, families: ["platform"] });
  }
  expect(() => planImpact(SCOPE, WORKSPACES, TRACKED, { event: "schedule", ref: "refs/heads/main", sha: SHA, base: BASE, files: [] })).toThrow("no mode");
  // A targeted plan never carries the complete-suite family, and a selected workspace needs a check.
  const leaky = { ...SCOPE, families: SCOPE.families.map((family: any) => family.id === SCOPE.completeSuite ? { ...family, owners: [globToRegExp("docs/**")] } : family) };
  expect(() => planImpact(leaky, WORKSPACES, TRACKED, { event: "pull_request", ref: "refs/pull/1/merge", sha: SHA, base: BASE, files: ["docs/a.md"] }))
    .toThrow("complete-suite family");
  expect(() => planImpact(SCOPE, WORKSPACES, TRACKED.filter(file => !file.startsWith("packages/cloud/")),
    { event: "pull_request", ref: "refs/pull/1/merge", sha: SHA, base: BASE, files: ["packages/cloud/hardening/src/index.ts"] })).toThrow("selected workspace without a check");
});

test("the gate passes only this run's plan with every selected job succeeded and every other job skipped", () => {
  for (const event of ["pull_request", "push", "workflow_dispatch"]) {
    const { plan, needs, context } = gateFixture(event);
    expect(gateVerdict(SCOPE, WORKSPACES, plan, needs, context)["verify-platform"]).toBe("success");
  }
  const reject = (mutate: (fixture: any) => void, message: string, event = "pull_request") => {
    const fixture: any = gateFixture(event); mutate(fixture);
    expect(() => gateVerdict(SCOPE, WORKSPACES, fixture.plan, fixture.needs, fixture.context)).toThrow(message);
  };
  for (const result of ["failure", "skipped", "cancelled"]) reject(f => f.needs["verify-plan"].result = result, "the Verify plan job did not succeed");
  reject(f => f.plan = undefined, "missing or empty impact plan");
  reject(f => f.plan.sha = "c".repeat(40), "another SHA");
  reject(f => f.context.event = "push", "another event");
  reject(f => f.plan.mode = "release", "mode");
  reject(f => f.context.base = "c".repeat(40), "another base");
  reject(f => f.plan.families = [], "families differ");
  reject(f => f.plan.families = [...f.plan.families, SCOPE.completeSuite], "families differ");
  reject(f => f.plan.files = ["docs/a.md"], "families differ");
  reject(f => delete f.needs.verify, "job inventory");
  reject(f => f.needs["verify-extra"] = { result: "success" }, "job inventory");
  for (const result of ["failure", "skipped", "cancelled", null]) {
    reject(f => f.needs["verify-platform"].result = result, "verify-platform: expected success");
    reject(f => f.needs["governance-verify"].result = result, "governance-verify: expected success");
  }
  for (const result of ["success", "failure", "cancelled"]) reject(f => f.needs["verify-split-pre"].result = result, "verify-split-pre: expected skipped");
  reject(f => f.context.ref = "refs/heads/feat/603-x", "Release validation runs only on", "workflow_dispatch");
  reject(f => f.context.dispatchSha = "c".repeat(40), "approved SHA", "workflow_dispatch");
  reject(f => f.needs["verify-split-tests"].result = "skipped", "verify-split-tests: expected success", "workflow_dispatch");
});

test("the impact and gate commands plan each event from its base and gate the same run", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-impact-command-test-"));
  const cli = fileURLToPath(new URL("./verify-ci.mjs", import.meta.url));
  const run = (cwd: string, command: string, env: Record<string, string>) => {
    const output = join(cwd, `github-output-${command}`);
    rmSync(output, { force: true });
    const childEnv: NodeJS.ProcessEnv = { ...process.env, GITHUB_OUTPUT: output, ...env };
    delete childEnv.GITHUB_STEP_SUMMARY;
    const result = spawnSync("node", [cli, command], { cwd, encoding: "utf8", env: childEnv });
    return { result, outputs: result.status === 0 && existsSync(output) ? readOutputs(output) : undefined };
  };
  const head = (cwd: string, rev = "HEAD") => git(cwd, "rev-parse", rev).trim();
  const gate = (cwd: string, env: Record<string, string>, plan: any) =>
    run(cwd, "gate", { ...env, VERIFY_PLAN: JSON.stringify(plan), VERIFY_NEEDS: JSON.stringify(needsFor(plan)) }).result.status;
  try {
    const docs = join(root, "docs-only"), platform = join(root, "platform");
    mkdirSync(docs); mkdirSync(platform);
    mergeRepo(docs, ["docs/a.md"], ["docs/old.md", "docs/new.md"]);
    // Every workspace has a check in this fixture, so a release plan may select them all.
    mergeRepo(platform, ["packages/local-runtime/runtime-daemon/src/rpc-server.ts", ...["contracts", "core", "local-runtime", "cloud", "surfaces"].map(name => `packages/${name}/a.test.ts`), "scripts/a.test.ts"]);
    const pr = (cwd: string) => ({ GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/pull/7/merge", GITHUB_SHA: head(cwd), VERIFY_DISPATCH_SHA: "" });
    const docsPlan = run(docs, "impact", pr(docs)).outputs!;
    // Renames count both sides, as `--no-renames` lists them.
    expect(docsPlan.plan).toMatchObject({ mode: "routine", base: head(docs, "HEAD^1"), files: ["docs/a.md", "docs/new.md", "docs/old.md"], families: [], workspaces: [] });
    expect(docsPlan.families).toEqual([]);
    const platformPlan = run(platform, "impact", pr(platform)).outputs!;
    expect(platformPlan.plan.families).toEqual(["platform"]);
    expect(gate(platform, pr(platform), platformPlan.plan)).toBe(0);
    expect(gate(docs, pr(docs), docsPlan.plan)).toBe(0);
    expect(gate(docs, pr(docs), platformPlan.plan)).not.toBe(0);
    expect(run(docs, "gate", { ...pr(docs), VERIFY_PLAN: "", VERIFY_NEEDS: "{}" }).result.status).not.toBe(0);
    // A pull_request checkout that is not the two-parent merge commit fails the plan rather than guessing a base.
    const topic = join(root, "topic");
    git(docs, "worktree", "add", "-q", "--detach", topic, "HEAD^2");
    expect(run(topic, "impact", pr(topic)).result.stderr).toContain("two parents");

    // A push compares with the event's `before`, fetched from origin.
    git(docs, "remote", "add", "origin", docs);
    git(docs, "config", "uploadpack.allowAnySHA1InWant", "true");
    const event = join(root, "push-event.json");
    const push = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main", GITHUB_SHA: head(docs), GITHUB_EVENT_PATH: event, VERIFY_DISPATCH_SHA: "" };
    writeFileSync(event, JSON.stringify({ before: head(docs, "HEAD^1") }));
    const pushPlan = run(docs, "impact", push).outputs!;
    expect(pushPlan.plan).toMatchObject({ mode: "routine", event: "push", base: head(docs, "HEAD^1"), files: ["docs/a.md", "docs/new.md", "docs/old.md"], families: [] });
    expect(gate(docs, push, pushPlan.plan)).toBe(0);
    writeFileSync(event, JSON.stringify({ before: "0".repeat(40) }));
    expect(run(docs, "impact", push).result.status).not.toBe(0);

    // Release validation: every family on an allowed ref with the approved SHA; anything else fails the plan.
    const dispatch = { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_SHA: head(platform), VERIFY_DISPATCH_SHA: head(platform) };
    const release = run(platform, "impact", dispatch).outputs!;
    expect(release.plan).toMatchObject({ mode: "release", base: null, files: [], families: SCOPE.families.map((family: any) => family.id), workspaces: ALL_WORKSPACES });
    expect(gate(platform, dispatch, release.plan)).toBe(0);
    expect(run(platform, "impact", { ...dispatch, GITHUB_REF: "refs/heads/feat/x" }).result.status).not.toBe(0);
    expect(run(platform, "impact", { ...dispatch, VERIFY_DISPATCH_SHA: head(platform, "HEAD^1") }).result.status).not.toBe(0);
    // The docs fixture has no workspace tests, so a release plan there names workspaces without a check.
    expect(run(docs, "impact", { ...dispatch, GITHUB_SHA: head(docs), VERIFY_DISPATCH_SHA: head(docs) }).result.stderr).toContain("selected workspace without a check");

    // Job counts: a docs-only routine run executes the plan, the Linux split, Governance, the gate and the
    // cost reporter; release validation adds the targeted families and the complete matrix.
    const config = readConfig();
    expect(release.split.include).toEqual(config.splitTargets.filter((row: any) => row.os !== "ubuntu-latest"));
    expect(release.shards.include).toHaveLength(6);
    expect(release.compat.include).toEqual(OS_TARGETS.flatMap(os => ["24.x", "25.x"].map(node => ({ os, "node-version": node }))));
    const workflow: any = Bun.YAML.parse(readFileSync(".github/workflows/verify.yml", "utf8"));
    const linuxShards = config.splitTargets.find((row: any) => row.os === "ubuntu-latest").shards;
    const width: Record<string, number> = { "verify-linux-shards": linuxShards, verify: release.compat.include.length, "verify-platform": 2,
      "verify-split-pre": release.split.include.length, "verify-split-tests": release.shards.include.length, "verify-split-post": release.split.include.length };
    const count = (families: string[]) => Object.keys(workflow.jobs).filter(id => {
      const family = SCOPE.families.find((candidate: any) => candidate.jobs.includes(id));
      return !family || families.includes(family.id);
    }).reduce((sum, id) => sum + (width[id] ?? 1), 0);
    expect(count(docsPlan.families)).toBe(9);
    expect(count(release.families)).toBe(28);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** Resolve a family job's commands to the tracked files that it runs. A command it cannot resolve throws. */
function resolveJobInputs(job: any, scripts: Record<string, string>, tracked: Set<string>): string[] {
  const files: string[] = [];
  const isTest = (path: string) => /[._](?:test|spec)\.[cm]?[jt]sx?$/.test(path);
  const resolveCommand = (command: string) => {
    const words = command.trim().split(/\s+/);
    if (words.join(" ") === "bun install --frozen-lockfile") return;
    if (words[0] === "node" && words[1] === "-e") return; // inline runner guard: runs no repository file
    if (words[0] === "bun" && words[1] === "run" && words.length === 3 && scripts[words[2]]) return scripts[words[2]].split("&&").forEach(resolveCommand);
    if (words[0] === "bun" && words[1] === "test") {
      for (let index = 2; index < words.length; index++) {
        if (words[index] === "--timeout") { index++; continue; }
        const path = words[index].replace(/^\.\//, "");
        const matched = tracked.has(path) ? [path] : [...tracked].filter(file => file.startsWith(`${path}/`) && isTest(file));
        if (words[index].startsWith("-") || matched.length === 0) throw new Error(`cannot resolve ${words[index]} in ${command}`);
        files.push(...matched);
      }
      return;
    }
    if (words[0] === "node" && tracked.has(words[1]) && (words.length === 2 || (words.length === 4 && words[2] === ">"))) return void files.push(words[1]);
    throw new Error(`cannot resolve ${command}`);
  };
  for (const step of job.steps) {
    if (step.uses) continue;
    const lines = step.run.split("\n").filter((line: string) => line.trim());
    if (step.shell === "pwsh") {
      for (const line of lines) if (!/^"(?:TEMP|TMP)=\$env:RUNNER_TEMP" >> \$env:GITHUB_ENV$/.test(line)) throw new Error(`cannot resolve ${line}`);
      continue;
    }
    for (const line of lines) for (const command of line.split("&&")) resolveCommand(command);
  }
  return files;
}

test("owner drift contract: each targeted family owns every test file and script that its jobs run", () => {
  const workflow: any = Bun.YAML.parse(readFileSync(".github/workflows/verify.yml", "utf8"));
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  const tracked = new Set(TRACKED);
  const failures: string[] = [];
  let checked = 0;
  for (const family of SCOPE.families.filter((candidate: any) => candidate.id !== SCOPE.completeSuite)) {
    for (const id of family.jobs) {
      for (const path of resolveJobInputs(workflow.jobs[id], scripts, tracked)) {
        checked++;
        if (!family.owners.some((re: RegExp) => re.test(path))) failures.push(`${family.id} runs ${path} but does not own it`);
      }
    }
  }
  expect(failures).toEqual([]);
  expect(checked).toBeGreaterThanOrEqual(45);
  for (const run of ["bun x unknown", "bun test ./missing/dir", "bun test --bail ./scripts", "bun run no-such-script", "node scripts/missing.mjs"]) {
    expect(() => resolveJobInputs({ steps: [{ run }] }, scripts, tracked)).toThrow("cannot resolve");
  }
});

test("the reviewed workspace graph equals the workspace manifests: every workspace and local dependency edge", () => {
  const root = JSON.parse(readFileSync("package.json", "utf8"));
  const localEdges = (manifest: any) => Object.entries({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies })
    .filter(([, spec]) => String(spec).startsWith("workspace:")).map(([name]) => name).sort();
  const byName = (a: any, b: any) => a.name.localeCompare(b.name);
  const manifests = [{ dir: ".", manifest: root }, ...root.workspaces.map((dir: string) => ({ dir, manifest: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) }))];
  expect(manifests).toHaveLength(6);
  expect(WORKSPACES.map(workspace => ({ name: workspace.name, dir: workspace.dir, dependsOn: [...workspace.dependsOn].sort() })).sort(byName))
    .toEqual(manifests.map(({ dir, manifest }) => ({ name: manifest.name, dir, dependsOn: localEdges(manifest) })).sort(byName));
  for (const workspace of WORKSPACES.filter(candidate => candidate.dir !== ".")) {
    expect(workspace.paths.map(String)).toEqual([String(globToRegExp(`${workspace.dir}/**`))]);
  }
});

test("every event reports through one always() gate over the known job inventory", () => {
  const workflow: any = Bun.YAML.parse(readFileSync(".github/workflows/verify.yml", "utf8"));
  expect(Object.keys(workflow.on).sort()).toEqual(["pull_request", "push", "workflow_dispatch"]);
  for (const trigger of Object.values(workflow.on) as any[]) {
    expect(trigger?.paths).toBeUndefined();
    expect(trigger?.["paths-ignore"]).toBeUndefined();
  }
  expect(workflow.on.workflow_dispatch.inputs.sha).toMatchObject({ required: true, type: "string" });
  const gate = workflow.jobs["verify-gate"];
  expect(gate).toMatchObject({ name: "Verify gate", if: "${{ always() }}" });
  const inventory = ["verify-plan", ...SCOPE.alwaysJobs, ...SCOPE.families.flatMap((family: any) => family.jobs)];
  expect([...gate.needs].sort()).toEqual([...inventory].sort());
  expect(Object.keys(workflow.jobs).sort()).toEqual([...inventory, "verify-gate", "verify-cost"].sort());
  expect(Object.values(workflow.jobs).some((job: any) => job.name?.endsWith("/ full"))).toBe(false);
  expect(gate.env).toEqual({ VERIFY_NEEDS: "${{ toJSON(needs) }}", VERIFY_PLAN: "${{ needs.verify-plan.outputs.plan }}", VERIFY_DISPATCH_SHA: "${{ inputs.sha }}" });
  expect(gate.steps.at(-1).run).toBe("node scripts/verify-ci.mjs gate");
  expect(workflow.jobs["verify-plan"].steps.at(-1).run).toBe("node scripts/verify-ci.mjs impact");
  expect(workflow.jobs["verify-plan"].env).toEqual({ VERIFY_DISPATCH_SHA: "${{ inputs.sha }}" });
  for (const family of SCOPE.families) for (const id of family.jobs) {
    expect(workflow.jobs[id].if).toBe(`contains(fromJSON(needs.verify-plan.outputs.families), '${family.id}')`);
    expect([workflow.jobs[id].needs].flat()).toContain("verify-plan");
  }
});

test("a split target outside the engines-minimum Node, or an OS without exactly one split row, is refused", () => {
  const split = (os: string, node: string) => {
    const config = structuredClone(readConfig());
    config.splitTargets[0] = { os, "node-version": node, shards: 3 };
    return config;
  };
  const withoutWindows = structuredClone(readConfig());
  withoutWindows.splitTargets = withoutWindows.splitTargets.filter((row: any) => row.os !== "windows-latest");
  expect(() => validateConfig(withoutWindows)).toThrow("every OS");
  expect(() => validateConfig(split("macos-15", "22.22.x"))).not.toThrow();
  expect(() => validateConfig(split("macos-15", "24.x"))).toThrow("node compat");
  expect(() => validateConfig(split("windows-latest", "25.x"))).toThrow("node compat");
  const withoutLinux = structuredClone(readConfig());
  withoutLinux.splitTargets = withoutLinux.splitTargets.filter((row: any) => row.os !== "ubuntu-latest");
  expect(() => validateConfig(withoutLinux)).toThrow("every OS");
});

test("the compat job installs, uploads the IPC artifact and runs only the Node-runtime checks", () => {
  const workflow: any = Bun.YAML.parse(readFileSync(".github/workflows/verify.yml", "utf8"));
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const job = workflow.jobs.verify;
  expect(job.name).toBe("Verify execution: ${{ matrix.os }} / Node ${{ matrix.node-version }} / node compat");
  expect(job.strategy.matrix).toBe("${{ fromJSON(needs.verify-plan.outputs.compat) }}");
  expect(job.steps.map((step: any) => step.run).filter(Boolean)).not.toContain("bun run verify");
  expect(job.steps.some((step: any) => step.name === "Windows control-file ACL regression")).toBe(false);
  expect(job.steps.at(-1)).toEqual({ name: "Node compatibility", run: "bun run verify:node-compat" });
  expect(job.steps.find((step: any) => step.name === "Setup Node").with["node-version"]).toBe("${{ matrix.node-version }}");
  expect(job.steps.find((step: any) => step.name === "Upload platform IPC permission readback").with.name)
    .toBe("platform-ipc-permission-${{ matrix.os }}-node-${{ matrix.node-version }}");
  const compat: string = pkg.scripts["verify:node-compat"];
  expect(compat.startsWith("bun run test:codegraph-selector-node && node scripts/packaged-cli-smoke.mjs && bun test --timeout 60000 ")).toBe(true);
  const files = compat.split(" ").filter(part => part.endsWith(".test.ts"));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    expect(existsSync(file)).toBe(true);
    // Each file runs the Node toolchain from PATH: node itself, or the npm bundled with that Node.
    expect(readFileSync(file, "utf8")).toMatch(/(?:spawn|spawnSync|execFile|execFileSync)\(\s*"(?:node|npm)"/);
  }
});

test("workflow targets only measured slow legs, keeps gate order, timeouts and permissions", () => {
  const workflow: any = Bun.YAML.parse(readFileSync(".github/workflows/verify.yml", "utf8"));
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const config = readConfig();
  expect(config.splitTargets).toEqual([
    { os: "macos-15", "node-version": "22.22.x", shards: 3 },
    { os: "windows-latest", "node-version": "22.22.x", shards: 3 },
    { os: "ubuntu-latest", "node-version": "22.22.x", shards: 3 }
  ]);
  expect(pkg.scripts.verify).toBe(`${pkg.scripts["verify:pre"]} && bun test --timeout 60000 && ${pkg.scripts["verify:post"]}`);
  expect(workflow.jobs["verify-split-tests"].needs).toContain("verify-split-pre");
  expect(workflow.jobs["verify-split-post"].needs).toContain("verify-split-tests");
  const steps = workflow.jobs["verify-split-post"].steps;
  expect(steps.findIndex((step: any) => step.run === "bun run verify:ci coverage")).toBeLessThan(steps.findIndex((step: any) => step.run === "bun run verify:post"));
  for (const id of ["verify-linux-pre", "verify-linux-shards", "verify-linux-post", "governance-verify"]) expect(workflow.jobs[id].if ?? "").not.toContain("verify-plan");
  expect(workflow.jobs["verify-plan"].steps[0].with["fetch-depth"]).toBe(2);
  expect(workflow.jobs["verify-gate"].steps[0].with["fetch-depth"]).toBe(2);
  expect(workflow.permissions).toEqual({ contents: "read" });
  for (const id of ["verify", "verify-platform", "verify-split-pre", "verify-split-tests", "verify-split-post"]) {
    expect(workflow.jobs[id]["timeout-minutes"]).toBe("${{ matrix.os == 'windows-latest' && 60 || 20 }}");
    expect(workflow.jobs[id].strategy["fail-fast"]).toBe(false);
  }
  for (const id of ["verify", "verify-split-pre"]) {
    const artifact = workflow.jobs[id].steps.find((step: any) => step.name === "Upload platform IPC permission readback");
    expect(artifact.with.name).toBe("platform-ipc-permission-${{ matrix.os }}-node-${{ matrix.node-version }}");
  }
  // The impact job's readback shares a release run with the full matrix's, so its artifact name differs.
  expect(workflow.jobs["verify-platform"].steps.find((step: any) => step.name === "Upload platform IPC permission readback").with.name)
    .toBe("platform-ipc-permission-${{ matrix.os }}-node-${{ matrix.node-version }}-impact");
  expect(workflow.jobs["verify-cost"]).toMatchObject({ if: "${{ always() }}", needs: "verify-gate" });
  for (const id of ["verify", "verify-platform", "verify-split-pre", "verify-split-tests", "verify-split-post"]) {
    const jobSteps = workflow.jobs[id].steps;
    const temp = jobSteps.findIndex((step: any) => step.name === "Keep temporary files on the Windows runner work disk");
    expect(temp).toBeGreaterThan(-1);
    expect(jobSteps[temp].if).toBe("runner.os == 'Windows'");
    expect(jobSteps[temp].run).toContain('"TEMP=$env:RUNNER_TEMP" >> $env:GITHUB_ENV');
    expect(jobSteps[temp].run).toContain('"TMP=$env:RUNNER_TEMP" >> $env:GITHUB_ENV');
    expect(temp).toBeLessThan(jobSteps.findIndex((step: any) => step.name === "Install dependencies"));
  }
});

test("#492: a nonterminal prerequisite job is re-read instead of being read as a final failure", async () => {
  const { config, run, jobs, context } = governanceFixture("push");
  const post = jobs[jobs.length - 1];
  const inFlight = jobs.map(job => job === post ? { ...job, status: "in_progress", conclusion: null,
    steps: job.steps.map(step => ({ ...step, status: "in_progress", conclusion: null })) } : job);
  // Every expected job except the in-flight one is already a settled success, which is the snapshot
  // the old one-shot consumer kept: it must be retried, never accepted as a final failed receipt.
  expect(governanceReceiptPending(config, inFlight)).toEqual([{ job: post.name, reason: "incomplete", status: "in_progress", conclusion: null }]);
  expect(governanceReceiptPending(config, jobs)).toEqual([]);

  const snapshots: any[] = [inFlight];
  const waits: number[] = [];
  let jobsReads = 0;
  const read = async (path: string) => {
    if (!path.includes("/jobs?")) return run;
    jobsReads += 1;
    const batch = (snapshots.length > 0 ? snapshots.shift() : jobs)!;
    return { total_count: batch.length, jobs: batch };
  };
  const receipt = await readGovernanceReceipt(config, governedEnv(context), identity, context,
    { read, attempts: 3, wait: async (ms: number) => { waits.push(ms); } });
  expect(receipt.attempts).toBe(2);
  expect(receipt.pending).toEqual([]);
  expect(waits).toHaveLength(1);
  expect(jobsReads).toBe(2);
});

test("#492: a prerequisite job that never settles fails closed with its observed state, and settled failures never retry", async () => {
  const { config, run, jobs, context } = governanceFixture("push");
  const post = jobs[jobs.length - 1];
  const stuck = jobs.map(job => job === post ? { ...job, status: "in_progress", conclusion: null } : job);
  const responder = (batch: any[]) => async (path: string) => path.includes("/jobs?") ? { total_count: batch.length, jobs: batch } : run;

  let waits = 0;
  await expect(readGovernanceReceipt(config, governedEnv(context), identity, context, {
    read: responder(stuck), attempts: 2, wait: async () => { waits += 1; }
  })).rejects.toThrow(/nonterminal after 2 reads/);
  expect(waits).toBe(1);

  // A settled non-success is a final receipt: the read settles at once with no retry, and the
  // existing validator is what rejects it. Waiting must never turn a failure into a pass.
  const failed = jobs.map(job => job === post ? { ...job, conclusion: "failure" } : job);
  waits = 0;
  const settled = await readGovernanceReceipt(config, governedEnv(context), identity, context, {
    read: responder(failed), attempts: 3, wait: async () => { waits += 1; }
  });
  expect(settled.attempts).toBe(1);
  expect(waits).toBe(0);
  expect(() => validateGovernancePrerequisite(config, identity, settled.run, settled.jobs, context)).toThrow(/not successful/);
  expect(RECEIPT_READ_ATTEMPTS).toBeGreaterThan(1);

  // A mismatched run is still refused outright, with no retry.
  waits = 0;
  await expect(readGovernanceReceipt(config, governedEnv(context), identity, { ...context, sourceHeadSha: "c".repeat(40) }, {
    read: responder(stuck), attempts: 3, wait: async () => { waits += 1; }
  })).rejects.toThrow(/different prerequisite source HEAD/);
  expect(waits).toBe(0);
});

test("#492: the cost job reads the current attempt's snapshot once and resolves no verdicts", async () => {
  const workflow: any = Bun.YAML.parse(readFileSync(".github/workflows/verify.yml", "utf8"));
  expect(workflow.jobs["verify-cost"].steps.find((step: any) => step.run).run).toBe("node scripts/verify-ci.mjs cost");
  expect(workflow.jobs["verify-cost"].env).toEqual({ GITHUB_TOKEN: "${{ github.token }}" });
  const run = { id: identity.runId, run_attempt: 1, head_sha: identity.checkoutSha };
  const env = { GITHUB_REPOSITORY: "Ancienttwo/arch-context", GITHUB_RUN_ID: String(identity.runId),
    GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: identity.checkoutSha };
  let reads = 0;
  const read = async (path: string) => { reads += 1; return path.includes("/jobs?") ? { total_count: 0, jobs: [] } : run; };
  expect((await hostedJobs(env, read)).jobs).toEqual([]);
  expect(reads).toBe(2);
});
