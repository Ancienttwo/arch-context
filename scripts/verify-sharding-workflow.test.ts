import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  changedPaths, classifyPaths, discoverTestFiles, executeShard, expectedWorkers, globToRegExp, jobVerdicts, laneTargets,
  NODE_TARGETS, OS_TARGETS, partitionFiles, readConfig, readScope, runnerMinutes, targetName, validateConfig, validateCoverage,
  GOVERNANCE_WORKER, governanceSourceHead, hostedJobs, validateGovernancePrerequisite
} from "./verify-ci.mjs";

const identity = { runId: 123, attempt: 1, checkoutSha: "a".repeat(40) };

function governanceFixture(eventName = "pull_request") {
  const sourceHeadSha = eventName === "pull_request" ? "b".repeat(40) : identity.checkoutSha;
  const run = { id: identity.runId, run_attempt: identity.attempt, head_sha: sourceHeadSha, event: eventName, path: ".github/workflows/verify.yml" };
  const job = { id: 17, name: GOVERNANCE_WORKER, status: "completed", conclusion: "success", run_id: run.id, run_attempt: run.run_attempt,
    head_sha: sourceHeadSha, steps: [{ name: "Verify", status: "completed", conclusion: "success" }] };
  return { run, jobs: [job], context: { eventName, sourceHeadSha, actualCheckoutSha: identity.checkoutSha,
    prerequisiteResult: "success", prerequisiteCheckoutSha: identity.checkoutSha } };
}

test("Governance binds the provider's current full worker and both checkouts while distinguishing PR merge/source SHAs", () => {
  for (const event of ["pull_request", "push", "workflow_dispatch"]) {
    const { run, jobs, context } = governanceFixture(event);
    expect(validateGovernancePrerequisite(identity, run, jobs, context)).toBe(jobs[0]);
    expect(run.head_sha === identity.checkoutSha).toBe(event !== "pull_request");
  }
});

test("Governance rejects green booleans with missing, stale, duplicate, cancelled, skipped or mismatched provider evidence", () => {
  const mutations: ((fixture: any) => void)[] = [
    f => f.jobs = [], f => f.jobs.push(structuredClone(f.jobs[0])),
    f => f.jobs[0].id = undefined, f => f.jobs[0].name = "unrelated worker",
    f => f.run.id++, f => f.run.run_attempt++, f => f.run.head_sha = "c".repeat(40),
    f => f.run.path = ".github/workflows/other.yml", f => f.run.event = "push",
    f => f.context.eventName = "pull_request_target", f => f.context.sourceHeadSha = "",
    f => f.context.actualCheckoutSha = "b".repeat(40),
    f => f.context.prerequisiteCheckoutSha = "b".repeat(40), f => f.context.prerequisiteCheckoutSha = "",
    f => f.jobs[0].run_id++, f => f.jobs[0].run_attempt++, f => f.jobs[0].head_sha = "c".repeat(40),
    f => f.jobs[0].status = "in_progress", f => f.jobs[0].steps = [],
    f => f.jobs[0].steps.push(structuredClone(f.jobs[0].steps[0])), f => f.jobs[0].steps[0].status = "in_progress"
  ];
  for (const conclusion of ["failure", "skipped", "cancelled", "timed_out", "neutral", null]) {
    mutations.push(f => f.jobs[0].conclusion = conclusion, f => f.jobs[0].steps[0].conclusion = conclusion,
      f => f.context.prerequisiteResult = conclusion);
  }
  for (const mutate of mutations) {
    const fixture = governanceFixture(); mutate(fixture);
    expect(() => validateGovernancePrerequisite(identity, fixture.run, fixture.jobs, fixture.context)).toThrow();
  }
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

test("hosted readback uses only this attempt's provider jobs and refuses API/pagination failures without artifacts", async () => {
  const env = { GITHUB_REPOSITORY: "Ancienttwo/arch-context", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: identity.checkoutSha };
  const { run, jobs } = governanceFixture();
  const paths: string[] = [];
  const valid = await hostedJobs(env, async (path: string) => {
    paths.push(path); return path.includes("/jobs?") ? { total_count: jobs.length, jobs } : run;
  });
  expect(valid).toEqual({ run, jobs });
  expect(paths).toEqual(["repos/Ancienttwo/arch-context/actions/runs/123", "repos/Ancienttwo/arch-context/actions/runs/123/attempts/1/jobs?per_page=100&page=1"]);
  for (const changed of [{ ...run, id: 122 }, { ...run, run_attempt: 2 }]) {
    await expect(hostedJobs(env, async () => changed)).rejects.toThrow();
  }
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
  const baseEnv = { ...process.env, RUNNER_TEMP: runner, GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: identity.checkoutSha, VERIFY_TARGET: "macos-15 / Node 22.22.x" };
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
    for (let index = 0; index < 3; index++) {
      const evidence = join(runner, "verify-reports", `artifact-${index}`);
      command("shard", { ...baseEnv, VERIFY_SHARD_INDEX: String(index), VERIFY_EVIDENCE: evidence });
    }
    expect(command("coverage").stdout).toContain("1 Bun-discovered files exactly once across 3 isolated shards");
    expect(() => command("coverage", { ...baseEnv, GITHUB_RUN_ATTEMPT: "2" })).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("coverage rejects duplicates, omissions, failed runs and stale/cross-target report subjects", () => {
  const plan = { version: 1, subject: identity, target: "fixture", files: ["a.test.ts", "b.test.ts"], groups: [["a.test.ts"], ["b.test.ts"]] };
  const reports = plan.groups.map((files, index) => ({ version: 1, subject: identity, target: "fixture", index, exitCode: 0, files }));
  for (const mutate of [
    (r: any[]) => r.push(r[0]), (r: any[]) => r[1].files = ["a.test.ts"],
    (r: any[]) => r[0].files = [], (r: any[]) => r[0].exitCode = 1,
    (r: any[]) => r[0].subject.attempt++, (r: any[]) => r[0].subject.checkoutSha = "b".repeat(40),
    (r: any[]) => r[0].target = "foreign"
  ]) {
    const changed = structuredClone(reports); mutate(changed);
    expect(() => validateCoverage(plan, changed, identity)).toThrow();
  }
  expect(() => validateCoverage({ ...plan, groups: [["a.test.ts"], ["a.test.ts"]] }, reports, identity)).toThrow();
});

test("job summary requires each unique expected job's success and the exact run/attempt/head", () => {
  const config = readConfig();
  const run = { id: 123, run_attempt: 1, head_sha: "a".repeat(40) };
  const jobs = OS_TARGETS.flatMap(os => NODE_TARGETS.flatMap(node => expectedWorkers(config, os, node).map(name => ({
    name, status: "completed", conclusion: "success", run_id: run.id, run_attempt: run.run_attempt, head_sha: run.head_sha
  }))));
  const targets = laneTargets("matrix");
  expect(Object.values(jobVerdicts(config, run, jobs, targets)).every(Boolean)).toBe(true);
  for (let index = 0; index < jobs.length; index++) {
    for (const conclusion of ["failure", "skipped", "cancelled", "timed_out", null]) {
      const changed = structuredClone(jobs) as any[]; changed[index].conclusion = conclusion;
      expect(Object.values(jobVerdicts(config, run, changed, targets)).every(Boolean)).toBe(false);
    }
    const missing = [...jobs]; missing.splice(index, 1);
    expect(Object.values(jobVerdicts(config, run, missing, targets)).every(Boolean)).toBe(false);
    expect(Object.values(jobVerdicts(config, run, [...jobs, jobs[index]], targets)).every(Boolean)).toBe(false);
  }
  for (const field of ["run_id", "run_attempt", "head_sha", "status"] as const) {
    const changed = structuredClone(jobs) as any[]; changed[0][field] = field === "status" ? "in_progress" : "foreign";
    expect(Object.values(jobVerdicts(config, run, changed, targets)).every(Boolean)).toBe(false);
  }
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
    return [key, key === "lane" ? value : JSON.parse(value)];
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

test("classifyPaths keeps only linux-safe changes on the linux lane and fails closed otherwise", () => {
  const scope = readScope();
  const lane = (...paths: string[]) => classifyPaths(scope, paths);
  expect(lane("docs/runbooks/verify-sharding.md", "README.md")).toEqual({ lane: "linux", matrixPaths: [] });
  expect(lane("packages/core/policy-engine/src/x.ts", "packages/core/policy-engine/test/x.test.ts", "plans/plan-x.md").lane).toBe("linux");
  for (const path of [
    "packages/local-runtime/runtime-daemon/src/rpc-server.ts", "packages/core/changeset-engine/src/index.ts",
    "packages/surfaces/cli/test/hook-state-paths.test.ts", "packages/contracts/package.json", "bun.lock",
    ".github/workflows/verify.yml", "scripts/verify-ci.mjs", "evals/run.ts", "package.json"
  ]) expect(lane(path)).toEqual({ lane: "matrix", matrixPaths: [path] });
  expect(lane("docs/a.md", "packages/local-runtime/git-adapter/src/index.ts", "plans/p.md"))
    .toEqual({ lane: "matrix", matrixPaths: ["packages/local-runtime/git-adapter/src/index.ts"] });
  expect(lane()).toEqual({ lane: "matrix", matrixPaths: [] });
});

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

test("changedPaths reads the merge commit's first-parent diff and refuses a non-merge checkout", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-changed-paths-test-"));
  try {
    mergeRepo(root, ["docs/a.md", "packages/x/src/y.ts"], ["old/name.txt", "new/name.txt"]);
    expect(changedPaths(root).sort()).toEqual(["docs/a.md", "new/name.txt", "old/name.txt", "packages/x/src/y.ts"]);
    git(root, "checkout", "-q", "--detach", "HEAD^2");
    expect(() => changedPaths(root)).toThrow("two parents");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("laneTargets names exactly the targets a lane executes", () => {
  expect(laneTargets("linux")).toEqual([{ os: "ubuntu-latest", "node-version": "22.22.x" }]);
  const matrix = laneTargets("matrix");
  expect(matrix).toHaveLength(9);
  expect(matrix.map(row => targetName(row.os, row["node-version"]))).toEqual(OS_TARGETS.flatMap(os => NODE_TARGETS.map(node => targetName(os, node))));
  for (const lane of ["", "Linux", undefined, null]) expect(() => laneTargets(lane as any)).toThrow();
});

test("linux-lane verdicts name only the Linux full target", () => {
  const config = readConfig();
  const run = { id: 123, run_attempt: 1, head_sha: "a".repeat(40) };
  const job = { name: GOVERNANCE_WORKER, status: "completed", conclusion: "success", run_id: run.id, run_attempt: run.run_attempt, head_sha: run.head_sha };
  expect(jobVerdicts(config, run, [job], laneTargets("linux"))).toEqual({ "ubuntu-latest / Node 22.22.x": true });
  expect(jobVerdicts(config, run, [{ ...job, conclusion: "failure" }], laneTargets("linux"))).toEqual({ "ubuntu-latest / Node 22.22.x": false });
  expect(jobVerdicts(config, run, [], laneTargets("linux"))).toEqual({ "ubuntu-latest / Node 22.22.x": false });
});

test("the topology command selects the lane from the event and the merge commit's changed paths", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-topology-lane-test-"));
  const cli = fileURLToPath(new URL("./verify-ci.mjs", import.meta.url));
  const run = (cwd: string, event?: string) => {
    const output = join(cwd, `github-output-${event ?? "none"}`);
    const env: NodeJS.ProcessEnv = { ...process.env, GITHUB_OUTPUT: output };
    delete env.GITHUB_EVENT_NAME; delete env.GITHUB_STEP_SUMMARY;
    if (event) env.GITHUB_EVENT_NAME = event;
    const result = spawnSync("node", [cli, "topology"], { cwd, encoding: "utf8", env });
    return { result, outputs: result.status === 0 ? readOutputs(output) : undefined };
  };
  try {
    const docs = join(root, "docs-only"), platform = join(root, "platform");
    mkdirSync(docs); mkdirSync(platform);
    mergeRepo(docs, ["docs/a.md"]);
    mergeRepo(platform, ["docs/a.md", "packages/local-runtime/runtime-daemon/src/rpc-server.ts"]);
    const push = run(docs, "push");
    expect(push.outputs?.lane).toBe("matrix");
    expect(push.outputs?.targets.include).toHaveLength(9);
    const linux = run(docs, "pull_request");
    expect(linux.result.status).toBe(0);
    expect(linux.outputs?.lane).toBe("linux");
    expect(linux.outputs?.targets.include).toEqual([{ os: "ubuntu-latest", "node-version": "22.22.x" }]);
    const matrix = run(platform, "pull_request");
    expect(matrix.outputs?.lane).toBe("matrix");
    expect(matrix.outputs?.targets.include).toHaveLength(9);
    expect(run(docs).result.status).not.toBe(0);
    git(docs, "checkout", "-q", "--detach", "HEAD^2");
    expect(run(docs, "pull_request").result.status).not.toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("topology runs full verify at Node 22.22.x on each OS and node compat on the six Node 24/25 targets in thirty-one jobs", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-node-compat-topology-test-"));
  try {
    const outputPath = join(root, "github-output");
    const cli = fileURLToPath(new URL("./verify-ci.mjs", import.meta.url));
    const result = spawnSync("node", [cli, "topology"], {
      encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: outputPath, GITHUB_EVENT_NAME: "push" }
    });
    expect(result.status).toBe(0);
    const outputs = readOutputs(outputPath);
    expect(outputs.lane).toBe("matrix");
    expect(outputs.targets.include).toHaveLength(9);
    expect(outputs.excluded).toBeUndefined();
    const config = readConfig();
    expect(outputs.split.include).toEqual(config.splitTargets);
    expect(outputs.split.include).toHaveLength(2);
    expect(outputs.shards.include).toHaveLength(6);
    for (const row of config.splitTargets) {
      expect(row["node-version"]).toBe("22.22.x");
      expect(outputs.shards.include.filter((shard: any) => shard.os === row.os && shard["node-version"] === row["node-version"]))
        .toEqual(Array.from({ length: 3 }, (_, index) => ({ ...row, index, shard: index + 1 })));
    }
    const nodeCompat = OS_TARGETS.flatMap(os => ["24.x", "25.x"].map(node => ({ os, "node-version": node })));
    expect(outputs.compat.include).toEqual(nodeCompat);
    expect(outputs.compat.include).toHaveLength(6);
    const governance = { os: "ubuntu-latest", "node-version": "22.22.x" };
    const same = (a: any, b: any) => a.os === b.os && a["node-version"] === b["node-version"];
    for (const row of outputs.compat.include) {
      expect([...outputs.split.include, governance].some((other: any) => same(row, other))).toBe(false);
      expect(expectedWorkers(config, row.os, row["node-version"])).toEqual([`Verify execution: ${row.os} / Node ${row["node-version"]} / node compat`]);
    }
    expect(expectedWorkers(config, governance.os, governance["node-version"])).toEqual([GOVERNANCE_WORKER]);
    expect(OS_TARGETS.flatMap(os => NODE_TARGETS.flatMap(node => expectedWorkers(config, os, node)))).toHaveLength(17);
    const workflow: any = Bun.YAML.parse(readFileSync(".github/workflows/verify.yml", "utf8"));
    expect(workflow.jobs["verify-topology"].outputs.compat).toBe("${{ steps.topology.outputs.compat }}");
    expect(workflow.jobs["verify-topology"].outputs.excluded).toBeUndefined();
    const counts: Record<string, number> = {
      verify: outputs.compat.include.length,
      "verify-split-pre": outputs.split.include.length,
      "verify-split-tests": outputs.shards.include.length,
      "verify-split-post": outputs.split.include.length,
      "verify-summary": outputs.targets.include.length
    };
    const jobs = Object.entries(workflow.jobs).flatMap(([id, job]) => Array.from({ length: counts[id] ?? 1 }, () => job as any));
    expect(jobs).toHaveLength(31);
    expect(jobs.filter(job => job.steps.some((step: any) => step.name === "Install dependencies"))).toHaveLength(19);
    expect(workflow.jobs["verify-collect"].needs).toContain("verify-linux-full");
    expect(workflow.jobs["verify-linux-full"].name).toBe("Verify execution: ubuntu-latest / Node 22.22.x / full");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a split target outside the engines-minimum Node, or the Governance target, is refused", () => {
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
  expect(() => validateConfig(split("ubuntu-latest", "22.22.x"))).toThrow("Governance");
});

test("the compat job installs, uploads the IPC artifact and runs only the Node-runtime checks", () => {
  const workflow: any = Bun.YAML.parse(readFileSync(".github/workflows/verify.yml", "utf8"));
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const job = workflow.jobs.verify;
  expect(job.name).toBe("Verify execution: ${{ matrix.os }} / Node ${{ matrix.node-version }} / node compat");
  expect(job.strategy.matrix).toBe("${{ fromJSON(needs.verify-topology.outputs.compat) }}");
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

test("workflow targets only measured slow legs, keeps gate order, original nine names, timeouts and permissions", () => {
  const workflow: any = Bun.YAML.parse(readFileSync(".github/workflows/verify.yml", "utf8"));
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const config = readConfig();
  expect(config.splitTargets).toEqual([
    { os: "macos-15", "node-version": "22.22.x", shards: 3 },
    { os: "windows-latest", "node-version": "22.22.x", shards: 3 }
  ]);
  expect(pkg.scripts.verify).toBe(`${pkg.scripts["verify:pre"]} && bun test --timeout 60000 && ${pkg.scripts["verify:post"]}`);
  expect(workflow.jobs["verify-split-tests"].needs).toContain("verify-split-pre");
  expect(workflow.jobs["verify-split-post"].needs).toContain("verify-split-tests");
  const steps = workflow.jobs["verify-split-post"].steps;
  expect(steps.findIndex((step: any) => step.run === "bun run verify:ci coverage")).toBeLessThan(steps.findIndex((step: any) => step.run === "bun run verify:post"));
  expect(workflow.jobs["verify-summary"].if).toContain("always()");
  expect(workflow.jobs["verify-collect"].if).toContain("always()");
  expect(workflow.jobs["verify-summary"].name).toBe("${{ matrix.os }} / Node ${{ matrix.node-version }}");
  expect(workflow.jobs["verify-summary"].strategy.matrix).toBe("${{ fromJSON(needs.verify-topology.outputs.targets) }}");
  expect(workflow.jobs["verify-summary"].needs).toContain("verify-topology");
  const matrixOnly = "needs.verify-topology.outputs.lane == 'matrix'";
  for (const id of ["verify", "verify-split-pre", "verify-split-tests", "verify-split-post", "linux-arm64-descriptor-write"]) {
    expect(workflow.jobs[id].if).toContain(matrixOnly);
    expect(workflow.jobs[id].if).toContain("github.event_name != 'workflow_dispatch'");
    expect(workflow.jobs[id].needs).toContain("verify-topology");
  }
  for (const id of ["verify-linux-full", "governance-verify"]) expect(workflow.jobs[id].if ?? "").not.toContain("lane");
  expect(workflow.jobs["verify-topology"].steps[0].with["fetch-depth"]).toBe(2);
  expect(workflow.jobs["verify-topology"].outputs.lane).toBe("${{ steps.topology.outputs.lane }}");
  expect(workflow.jobs["verify-topology"].outputs.targets).toBe("${{ steps.topology.outputs.targets }}");
  expect(workflow.jobs["verify-collect"].env.VERIFY_LANE).toBe("${{ needs.verify-topology.outputs.lane }}");
  expect(workflow.permissions).toEqual({ contents: "read" });
  for (const id of ["verify", "verify-split-pre", "verify-split-tests", "verify-split-post"]) {
    expect(workflow.jobs[id]["timeout-minutes"]).toBe("${{ matrix.os == 'windows-latest' && 60 || 20 }}");
    expect(workflow.jobs[id].strategy["fail-fast"]).toBe(false);
  }
  for (const id of ["verify", "verify-split-pre"]) {
    const artifact = workflow.jobs[id].steps.find((step: any) => step.name === "Upload platform IPC permission readback");
    expect(artifact.with.name).toBe("platform-ipc-permission-${{ matrix.os }}-node-${{ matrix.node-version }}");
  }
  expect(workflow.jobs["verify-cost"].needs).toContain("verify-summary");
  for (const id of ["verify", "verify-split-pre", "verify-split-tests", "verify-split-post"]) {
    const jobSteps = workflow.jobs[id].steps;
    const temp = jobSteps.findIndex((step: any) => step.name === "Keep temporary files on the Windows runner work disk");
    expect(temp).toBeGreaterThan(-1);
    expect(jobSteps[temp].if).toBe("runner.os == 'Windows'");
    expect(jobSteps[temp].run).toContain('"TEMP=$env:RUNNER_TEMP" >> $env:GITHUB_ENV');
    expect(jobSteps[temp].run).toContain('"TMP=$env:RUNNER_TEMP" >> $env:GITHUB_ENV');
    expect(temp).toBeLessThan(jobSteps.findIndex((step: any) => step.name === "Install dependencies"));
  }
});
