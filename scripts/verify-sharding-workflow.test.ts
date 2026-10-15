import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  discoverTestFiles, executeShard, expectedWorkers, jobVerdicts, NODE_TARGETS, OS_TARGETS,
  partitionFiles, readConfig, runnerMinutes, targetName, validateCoverage
} from "./verify-ci.mjs";

const identity = { runId: 123, attempt: 1, checkoutSha: "a".repeat(40) };

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
  const baseEnv = { ...process.env, RUNNER_TEMP: runner, GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: identity.checkoutSha, VERIFY_TARGET: "macos-15 / Node 24.x" };
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
  expect(Object.values(jobVerdicts(config, run, jobs)).every(Boolean)).toBe(true);
  for (let index = 0; index < jobs.length; index++) {
    for (const conclusion of ["failure", "skipped", "cancelled", "timed_out", null]) {
      const changed = structuredClone(jobs) as any[]; changed[index].conclusion = conclusion;
      expect(Object.values(jobVerdicts(config, run, changed)).every(Boolean)).toBe(false);
    }
    const missing = [...jobs]; missing.splice(index, 1);
    expect(Object.values(jobVerdicts(config, run, missing)).every(Boolean)).toBe(false);
    expect(Object.values(jobVerdicts(config, run, [...jobs, jobs[index]])).every(Boolean)).toBe(false);
  }
  for (const field of ["run_id", "run_attempt", "head_sha", "status"] as const) {
    const changed = structuredClone(jobs) as any[]; changed[0][field] = field === "status" ? "in_progress" : "foreign";
    expect(Object.values(jobVerdicts(config, run, changed)).every(Boolean)).toBe(false);
  }
});

test("runner cost sums parallel jobs and counts install time separately from wall clock", () => {
  const jobs = ["macos-15", "windows-latest"].map(os => ({ name: os, labels: [os], runner_id: 1, started_at: "2026-10-14T10:00:00Z", completed_at: "2026-10-14T10:01:30Z",
    steps: [{ name: "Install dependencies", started_at: "2026-10-14T10:00:00Z", completed_at: "2026-10-14T10:00:30Z" }] }));
  expect(runnerMinutes(jobs)).toMatchObject({ completedMinutes: 3, roundedCompletedMinutes: 4, installMinutes: 1, installJobs: 2, byOs: { macos: 1.5, windows: 1.5 } });
  expect(runnerMinutes([{ ...jobs[0], name: "macos-15 / Node 24.x", labels: ["ubuntu-latest"] }]).byOs).toEqual({ linux: 1.5 });
  expect(runnerMinutes([{ ...jobs[0], runner_id: 0, status: "skipped" }]).completedMinutes).toBe(0);
});

test("five-target topology emits fifteen shards, four full workers, twenty-nine execution jobs and thirty-one installs in forty-three jobs", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-five-target-topology-test-"));
  try {
    const outputPath = join(root, "github-output");
    const cli = fileURLToPath(new URL("./verify-ci.mjs", import.meta.url));
    const result = spawnSync("node", [cli, "topology"], {
      encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: outputPath }
    });
    expect(result.status).toBe(0);
    const outputs = Object.fromEntries(readFileSync(outputPath, "utf8").trim().split("\n").map(line => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), JSON.parse(line.slice(separator + 1))];
    }));
    const config = readConfig();
    expect(outputs.split.include).toEqual(config.splitTargets);
    expect(outputs.split.include).toHaveLength(5);
    expect(outputs.shards.include).toHaveLength(15);
    expect(outputs.excluded).toEqual(config.splitTargets.map(({ os, "node-version": node }: { os: string; "node-version": string }) => ({ os, "node-version": node })));
    for (const row of config.splitTargets) {
      expect(outputs.shards.include.filter((shard: any) => shard.os === row.os && shard["node-version"] === row["node-version"]))
        .toEqual(Array.from({ length: 3 }, (_, index) => ({ ...row, index, shard: index + 1 })));
    }
    const fullTargets = OS_TARGETS.flatMap(os => NODE_TARGETS.map(node => ({ os, "node-version": node })))
      .filter(row => !outputs.excluded.some((excluded: any) => excluded.os === row.os && excluded["node-version"] === row["node-version"]));
    expect(fullTargets).toHaveLength(4);
    expect(fullTargets.every(row => expectedWorkers(config, row.os, row["node-version"]).length === 1)).toBe(true);
    expect(OS_TARGETS.flatMap(os => NODE_TARGETS.flatMap(node => expectedWorkers(config, os, node)))).toHaveLength(29);
    const workflow: any = Bun.YAML.parse(readFileSync(".github/workflows/verify.yml", "utf8"));
    const counts: Record<string, number> = {
      verify: fullTargets.length,
      "verify-split-pre": outputs.split.include.length,
      "verify-split-tests": outputs.shards.include.length,
      "verify-split-post": outputs.split.include.length,
      "verify-summary": OS_TARGETS.length * NODE_TARGETS.length
    };
    const jobs = Object.entries(workflow.jobs).flatMap(([id, job]) => Array.from({ length: counts[id] ?? 1 }, () => job as any));
    expect(jobs).toHaveLength(43);
    expect(jobs.filter(job => job.steps.some((step: any) => step.name === "Install dependencies"))).toHaveLength(31);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("workflow targets only measured slow legs, keeps gate order, original nine names, timeouts and permissions", () => {
  const workflow: any = Bun.YAML.parse(readFileSync(".github/workflows/verify.yml", "utf8"));
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const config = readConfig();
  expect(config.splitTargets).toEqual([
    { os: "macos-15", "node-version": "22.22.x", shards: 3 },
    { os: "macos-15", "node-version": "24.x", shards: 3 },
    { os: "macos-15", "node-version": "25.x", shards: 3 },
    { os: "windows-latest", "node-version": "22.22.x", shards: 3 },
    { os: "windows-latest", "node-version": "25.x", shards: 3 }
  ]);
  expect(pkg.scripts.verify).toBe(`${pkg.scripts["verify:pre"]} && bun test --timeout 60000 && ${pkg.scripts["verify:post"]}`);
  expect(workflow.jobs["verify-split-tests"].needs).toContain("verify-split-pre");
  expect(workflow.jobs["verify-split-post"].needs).toContain("verify-split-tests");
  const steps = workflow.jobs["verify-split-post"].steps;
  expect(steps.findIndex((step: any) => step.run === "bun run verify:ci coverage")).toBeLessThan(steps.findIndex((step: any) => step.run === "bun run verify:post"));
  expect(workflow.jobs["verify-summary"].if).toContain("always()");
  expect(workflow.jobs["verify-collect"].if).toContain("always()");
  expect(workflow.jobs["verify-summary"].name).toBe("${{ matrix.os }} / Node ${{ matrix.node-version }}");
  expect(workflow.jobs["verify-summary"].strategy.matrix.os).toEqual(OS_TARGETS);
  expect(workflow.jobs["verify-summary"].strategy.matrix["node-version"]).toEqual(NODE_TARGETS);
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
});
