#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

const DEFAULT_SOURCE_REPO = "/Users/chris/Projects/aiphabee";
const DEFAULT_OUTPUT = "docs/verification/fg6-representative-benchmark-readback.json";
const DEFAULT_REPORT = "docs/verification/fg6-representative-benchmark.md";
const BIN_DIR = resolve(process.cwd(), "node_modules", ".bin");
const ARCHCTX_BIN = resolveBin("archctx");
const CODEGRAPH_BIN = resolveCodeGraphBin();
const MIN_REPRESENTATIVE_FILES = 1000;
const INITIAL_INDEX_BUDGET_MS = 300_000;
const REPRESENTATIVE_E2E_BUDGET_MS = 300_000;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildFg6RepresentativeBenchmarkConfig(process.env, args);
    const result = await runFg6RepresentativeBenchmark(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg6RepresentativeBenchmark(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg6-representative-benchmark-readback] usage: run|inspect [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg6RepresentativeBenchmarkConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    sourceRepo: readFlag(args, "--source-repo") ?? env.ARCHCONTEXT_FG6_BENCHMARK_REPO ?? DEFAULT_SOURCE_REPO,
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG6_BENCHMARK_OUTPUT ?? DEFAULT_OUTPUT,
    reportPath: readFlag(args, "--report") ?? env.ARCHCONTEXT_FG6_BENCHMARK_REPORT ?? DEFAULT_REPORT,
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg6RepresentativeBenchmark(config: ReturnType<typeof buildFg6RepresentativeBenchmarkConfig>) {
  const sourceRepo = resolve(config.sourceRepo);
  if (!existsSync(sourceRepo)) throw new Error(`benchmark source repo missing: ${sourceRepo}`);
  if (!existsSync(ARCHCTX_BIN)) throw new Error(`missing archctx bin: ${ARCHCTX_BIN}`);
  if (!existsSync(CODEGRAPH_BIN)) throw new Error(`missing codegraph bin: ${CODEGRAPH_BIN}`);

  const env = benchmarkEnv();
  const sourceClean = gitLines(sourceRepo, "status", "--porcelain").length === 0;
  const sourceHeadSha = gitOut(sourceRepo, "rev-parse", "HEAD");
  const sourceTrackedFiles = gitLines(sourceRepo, "ls-files").length;
  const workspace = mkdtempSync(join(tmpdir(), "archctx-fg6-benchmark-"));
  const repo = join(workspace, "repo");
  const measurements: Array<CommandMeasurement & { phase: string }> = [];
  try {
    const clone = measureCommand("git", ["clone", "--no-hardlinks", "--quiet", sourceRepo, repo], { cwd: workspace, env, timeoutMs: 120_000 });
    measurements.push({ phase: "clean-worktree-clone", ...clone });
    const cloneClean = gitLines(repo, "status", "--porcelain").length === 0;
    const cloneHeadSha = gitOut(repo, "rev-parse", "HEAD");
    const trackedFiles = gitLines(repo, "ls-files").length;
    const changedPath = chooseRepresentativeFile(repo);

    const codeGraphInit = measureCommand(process.execPath, [CODEGRAPH_BIN, "init", repo], { cwd: repo, env, timeoutMs: 180_000 });
    measurements.push({ phase: "codegraph-init", ...codeGraphInit });
    const doctor = parseJsonCommand(measureCommand(ARCHCTX_BIN, ["doctor"], { cwd: repo, env, timeoutMs: 60_000 }), "doctor");
    measurements.push({ phase: "doctor", ...doctor.measurement });
    const init = parseJsonCommand(measureCommand(ARCHCTX_BIN, ["init", "--name", "FG6 Representative Benchmark"], { cwd: repo, env, timeoutMs: 60_000 }), "init");
    measurements.push({ phase: "archctx-init", ...init.measurement });
    const sync = parseJsonCommand(measureCommand(ARCHCTX_BIN, ["sync", "--changed", changedPath], { cwd: repo, env, timeoutMs: 180_000 }), "sync");
    measurements.push({ phase: "archctx-sync", ...sync.measurement });
    const prepare = parseJsonCommand(measureCommand(ARCHCTX_BIN, ["prepare", "--task", "representative governance benchmark", "--max-items", "8"], { cwd: repo, env, timeoutMs: 120_000 }), "prepare");
    measurements.push({ phase: "archctx-prepare", ...prepare.measurement });
    const status = parseJsonCommand(measureCommand(ARCHCTX_BIN, ["status"], { cwd: repo, env, timeoutMs: 60_000 }), "status");
    measurements.push({ phase: "archctx-status", ...status.measurement });
    const checkpoint = parseJsonCommand(measureCommand(ARCHCTX_BIN, ["checkpoint", "--expected-worktree-digest", String(readRecord(status.data.data).worktreeDigest ?? "")], { cwd: repo, env, timeoutMs: 60_000 }), "checkpoint");
    measurements.push({ phase: "archctx-checkpoint", ...checkpoint.measurement });
    const complete = parseJsonCommand(measureCommand(ARCHCTX_BIN, ["complete", "--task-session-id", "fg6_representative_complete", "--head-sha", cloneHeadSha], { cwd: repo, env, timeoutMs: 120_000 }), "complete");
    measurements.push({ phase: "archctx-complete", ...complete.measurement });
    const review = parseJsonCommand(measureCommand(ARCHCTX_BIN, ["review", "--task-session-id", "fg6_representative_review", "--head-sha", cloneHeadSha], { cwd: repo, env, timeoutMs: 120_000 }), "review");
    measurements.push({ phase: "archctx-review", ...review.measurement });

    const peakRssBytes = Math.max(...measurements.map((item) => Number(item.peakRssBytes ?? 0)));
    const e2eLatencyMs = sumDurations(measurements, [
      "clean-worktree-clone",
      "codegraph-init",
      "archctx-init",
      "archctx-sync",
      "archctx-prepare",
      "archctx-checkpoint",
      "archctx-complete",
      "archctx-review"
    ]);
    const recording = {
      schemaVersion: "archcontext.fg6-representative-benchmark-readback/v1",
      taskId: "FG6-13",
      environment: "local-representative-benchmark",
      status: "verified",
      ok: true,
      generatedAt: config.generatedAt(),
      sources: {
        sourceRepo: displayPath(sourceRepo),
        reportPath: config.reportPath
      },
      budgets: {
        minRepresentativeFiles: MIN_REPRESENTATIVE_FILES,
        initialIndexBudgetMs: INITIAL_INDEX_BUDGET_MS,
        representativeE2eBudgetMs: REPRESENTATIVE_E2E_BUDGET_MS,
        memoryBudgetBytes: null
      },
      evidence: {
        targetRepository: {
          name: sourceRepo.split("/").at(-1) ?? "repo",
          sourceClean,
          sourceHeadSha,
          sourceTrackedFiles,
          benchmarkCloneClean: cloneClean,
          cloneHeadSha,
          trackedFiles,
          changedPath
        },
        cleanWorktree: {
          cloneDurationMs: clone.durationMs,
          dirtyLines: cloneClean ? 0 : gitLines(repo, "status", "--porcelain").length,
          headMatchesSource: cloneHeadSha === sourceHeadSha,
          checkpointFresh: readRecord(checkpoint.data.data).fresh === true
        },
        codeGraph: {
          initDurationMs: codeGraphInit.durationMs,
          initPeakRssBytes: codeGraphInit.peakRssBytes,
          syncDurationMs: sync.measurement.durationMs,
          syncPeakRssBytes: sync.measurement.peakRssBytes,
          codeFactsDigestPrefix: String(readRecord(sync.data.data).codeFactsDigest ?? "").slice(0, 19)
        },
        review: {
          prepareDurationMs: prepare.measurement.durationMs,
          completeDurationMs: complete.measurement.durationMs,
          reviewDurationMs: review.measurement.durationMs,
          completeResult: readRecord(complete.data.data).result,
          reviewResult: readRecord(review.data.data).result,
          reviewErrors: Number(readRecord(readRecord(review.data.data).summary).errors ?? 0),
          reviewWarnings: Number(readRecord(readRecord(review.data.data).summary).warnings ?? 0)
        },
        latencyAndMemory: {
          e2eLatencyMs,
          peakRssBytes,
          measurements: measurements.map(({ phase, durationMs, peakRssBytes }) => ({ phase, durationMs, peakRssBytes }))
        },
        doctor: {
          ok: doctor.data.ok === true,
          defaultOutbound: readRecord(readRecord(doctor.data.data).egress).defaultOutbound,
          codeGraphRequiredVersion: readRecord(readRecord(doctor.data.data).codeGraph).requiredVersion
        },
        assertions: {
          representativeRepoLargeEnough: trackedFiles >= MIN_REPRESENTATIVE_FILES,
          sourceAndCloneClean: sourceClean === true && cloneClean === true,
          cleanWorktreeMeasured: clone.durationMs > 0 && cloneHeadSha === sourceHeadSha && readRecord(checkpoint.data.data).fresh === true,
          codeGraphMeasured: codeGraphInit.durationMs > 0 && sync.measurement.durationMs > 0 && String(readRecord(sync.data.data).codeFactsDigest ?? "").startsWith("sha256:"),
          reviewMeasured: readRecord(complete.data.data).result === "pass" && readRecord(review.data.data).result === "pass" && Number(readRecord(readRecord(review.data.data).summary).errors ?? -1) === 0,
          e2eLatencyMeasured: e2eLatencyMs > 0 && e2eLatencyMs < REPRESENTATIVE_E2E_BUDGET_MS,
          memoryMeasured: peakRssBytes > 0,
          withinPrdInitialIndexBudget: codeGraphInit.durationMs < INITIAL_INDEX_BUDGET_MS,
          noProviderRequired: readRecord(readRecord(doctor.data.data).egress).defaultOutbound === "local-only"
        }
      },
      failures: [] as string[]
    };
    const inspection = inspectFg6RepresentativeBenchmark(recording);
    recording.status = inspection.ok ? "verified" : "failed";
    recording.ok = inspection.ok;
    recording.failures = inspection.failures;
    await writeText(config.root, config.reportPath, renderBenchmarkReport(recording));
    await writeJson(config.root, config.outputPath, recording);
    return recording;
  } finally {
    measureCommand(ARCHCTX_BIN, ["daemon", "stop"], { cwd: existsSync(repo) ? repo : workspace, env, timeoutMs: 30_000, allowFailure: true });
    rmSync(workspace, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
  }
}

export function inspectFg6RepresentativeBenchmark(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const budgets = readRecord(record.budgets);
  const evidence = readRecord(record.evidence);
  const target = readRecord(evidence.targetRepository);
  const cleanWorktree = readRecord(evidence.cleanWorktree);
  const codeGraph = readRecord(evidence.codeGraph);
  const review = readRecord(evidence.review);
  const latencyAndMemory = readRecord(evidence.latencyAndMemory);
  const doctor = readRecord(evidence.doctor);
  const assertions = readRecord(evidence.assertions);

  if (record.schemaVersion !== "archcontext.fg6-representative-benchmark-readback/v1") failures.push("schemaVersion mismatch");
  if (record.taskId !== "FG6-13") failures.push("taskId must be FG6-13");
  if (record.environment !== "local-representative-benchmark") failures.push("environment must be local-representative-benchmark");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  if (Number(target.trackedFiles ?? 0) < Number(budgets.minRepresentativeFiles ?? MIN_REPRESENTATIVE_FILES)) failures.push("target trackedFiles must meet representative threshold");
  if (target.sourceClean !== true || target.benchmarkCloneClean !== true) failures.push("source and benchmark clone must be clean");
  if (!/^[a-f0-9]{40}$/i.test(String(target.sourceHeadSha ?? ""))) failures.push("sourceHeadSha must be a full SHA");
  if (target.headMatchesSource === false) failures.push("target head must match source");
  if (cleanWorktree.headMatchesSource !== true) failures.push("clean worktree head must match source");
  if (Number(cleanWorktree.dirtyLines ?? -1) !== 0) failures.push("clean worktree dirtyLines must be 0");
  if (cleanWorktree.checkpointFresh !== true) failures.push("checkpoint must be fresh");
  if (Number(codeGraph.initDurationMs ?? 0) <= 0) failures.push("CodeGraph initDurationMs must be positive");
  if (Number(codeGraph.syncDurationMs ?? 0) <= 0) failures.push("CodeGraph syncDurationMs must be positive");
  if (Number(codeGraph.initDurationMs ?? Infinity) >= Number(budgets.initialIndexBudgetMs ?? INITIAL_INDEX_BUDGET_MS)) failures.push("CodeGraph initDurationMs exceeds PRD initial index budget");
  if (!String(codeGraph.codeFactsDigestPrefix ?? "").startsWith("sha256:")) failures.push("CodeGraph codeFactsDigestPrefix must be sha256");
  if (Number(codeGraph.initPeakRssBytes ?? 0) <= 0 || Number(codeGraph.syncPeakRssBytes ?? 0) <= 0) failures.push("CodeGraph peak RSS must be positive");
  if (Number(review.prepareDurationMs ?? 0) <= 0 || Number(review.completeDurationMs ?? 0) <= 0 || Number(review.reviewDurationMs ?? 0) <= 0) failures.push("review phase durations must be positive");
  if (review.completeResult !== "pass" || review.reviewResult !== "pass") failures.push("complete and review results must pass");
  if (Number(review.reviewErrors ?? -1) !== 0) failures.push("reviewErrors must be 0");
  if (Number(latencyAndMemory.e2eLatencyMs ?? 0) <= 0) failures.push("e2eLatencyMs must be positive");
  if (Number(latencyAndMemory.e2eLatencyMs ?? Infinity) >= Number(budgets.representativeE2eBudgetMs ?? REPRESENTATIVE_E2E_BUDGET_MS)) failures.push("e2eLatencyMs exceeds representative budget");
  if (Number(latencyAndMemory.peakRssBytes ?? 0) <= 0) failures.push("peakRssBytes must be positive");
  if (!Array.isArray(latencyAndMemory.measurements) || latencyAndMemory.measurements.length < 8) failures.push("latency measurements must include benchmark phases");
  if (doctor.ok !== true) failures.push("doctor must pass");
  if (doctor.defaultOutbound !== "local-only") failures.push("doctor defaultOutbound must be local-only");

  for (const key of [
    "representativeRepoLargeEnough",
    "sourceAndCloneClean",
    "cleanWorktreeMeasured",
    "codeGraphMeasured",
    "reviewMeasured",
    "e2eLatencyMeasured",
    "memoryMeasured",
    "withinPrdInitialIndexBudget",
    "noProviderRequired"
  ]) {
    if (assertions[key] !== true) failures.push(`assertion ${key} must be true`);
  }
  return { ok: failures.length === 0, failures };
}

type CommandMeasurement = {
  command: string;
  durationMs: number;
  peakRssBytes: number;
  stdout: string;
  stderrDigest: string;
};

function measureCommand(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; allowFailure?: boolean }): CommandMeasurement {
  const started = performance.now();
  const timeArgs = supportsUsrBinTime() ? ["-l", command, ...args] : [];
  const child = timeArgs.length > 0
    ? spawnSync("/usr/bin/time", timeArgs, { cwd: options.cwd, env: options.env, encoding: "utf8", timeout: options.timeoutMs })
    : spawnSync(command, args, { cwd: options.cwd, env: options.env, encoding: "utf8", timeout: options.timeoutMs });
  const wallDurationMs = Math.round(performance.now() - started);
  const stdout = child.stdout ?? "";
  const stderr = child.stderr ?? "";
  if ((child.status ?? 1) !== 0 && options.allowFailure !== true) {
    throw new Error(`${command} ${args.join(" ")} failed (${child.status}): ${stderr || stdout}`);
  }
  const parsed = parseTimeOutput(stderr);
  return {
    command: [command, ...args].join(" "),
    durationMs: parsed.realMs > 0 ? parsed.realMs : wallDurationMs,
    peakRssBytes: parsed.peakRssBytes,
    stdout,
    stderrDigest: digestText(stderr)
  };
}

function parseJsonCommand(measurement: CommandMeasurement, label: string) {
  try {
    return { measurement, data: JSON.parse(measurement.stdout) as Record<string, unknown> };
  } catch {
    throw new Error(`${label} did not return JSON`);
  }
}

function parseTimeOutput(stderr: string): { realMs: number; peakRssBytes: number } {
  const realMatch = stderr.match(/([\d.]+)\s+real/);
  const maxRssMatch = stderr.match(/(\d+)\s+maximum resident set size/);
  const peakFootprintMatch = stderr.match(/(\d+)\s+peak memory footprint/);
  const rssValues = [maxRssMatch?.[1], peakFootprintMatch?.[1]].filter(Boolean).map((value) => Number(value));
  return {
    realMs: realMatch ? Math.round(Number(realMatch[1]) * 1000) : 0,
    peakRssBytes: rssValues.length > 0 ? Math.max(...rssValues) : 0
  };
}

function supportsUsrBinTime(): boolean {
  return process.platform === "darwin" && existsSync("/usr/bin/time");
}

function chooseRepresentativeFile(repo: string): string {
  const files = gitLines(repo, "ls-files");
  return files.find((file) => /\.(ts|tsx|js|jsx|md|json|yaml|yml)$/.test(file)) ?? files[0] ?? "README.md";
}

function sumDurations(measurements: Array<{ phase: string; durationMs: number }>, phases: string[]): number {
  return measurements.filter((item) => phases.includes(item.phase)).reduce((sum, item) => sum + item.durationMs, 0);
}

function benchmarkEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, DO_NOT_TRACK: "1", PATH: `${BIN_DIR}${delimiter}${process.env.PATH ?? ""}` };
  for (const key of Object.keys(env)) {
    if (/^(GITHUB|GH|OPENAI|ANTHROPIC|ARCHCONTEXT_CLOUD|CLOUDFLARE|STRIPE|SLACK)_/.test(key)
      || key.endsWith("_API_KEY")
      || key.endsWith("_ACCESS_TOKEN")) {
      delete env[key];
    }
  }
  return env;
}

function gitOut(repo: string, ...args: string[]): string {
  return spawnSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).stdout.trim();
}

function gitLines(repo: string, ...args: string[]): string[] {
  return gitOut(repo, ...args).split(/\r?\n/).filter(Boolean);
}

function resolveBin(name: string): string {
  const candidates = process.platform === "win32"
    ? [join(BIN_DIR, `${name}.cmd`), join(BIN_DIR, `${name}.exe`), join(BIN_DIR, name)]
    : [join(BIN_DIR, name)];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function resolveCodeGraphBin(): string {
  const packageShim = resolve(process.cwd(), "node_modules", "@colbymchenry", "codegraph", "npm-shim.js");
  const candidates = process.platform === "win32"
    ? [packageShim, join(BIN_DIR, "codegraph.cmd"), join(BIN_DIR, "codegraph.exe"), join(BIN_DIR, "codegraph")]
    : [packageShim, join(BIN_DIR, "codegraph")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function displayPath(path: string): string {
  const home = process.env.HOME;
  const real = realpathSync.native(path);
  return home && real.startsWith(`${home}/`) ? `~/${real.slice(home.length + 1)}` : real;
}

async function writeJson(root: string, path: string, value: unknown): Promise<void> {
  await writeText(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(root: string, path: string, value: string): Promise<void> {
  const output = resolve(root, path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, value, "utf8");
}

function renderBenchmarkReport(recording: Awaited<ReturnType<typeof runFg6RepresentativeBenchmark>>): string {
  const evidence = recording.evidence;
  const measurements = evidence.latencyAndMemory.measurements
    .map((item) => `| ${item.phase} | ${item.durationMs} | ${item.peakRssBytes} |`)
    .join("\n");
  return `# FG6 Representative Benchmark

- Generated At: ${recording.generatedAt}
- Environment: ${recording.environment}
- Source Repo: ${recording.sources.sourceRepo}
- Tracked Files: ${evidence.targetRepository.trackedFiles}
- E2E Latency Ms: ${evidence.latencyAndMemory.e2eLatencyMs}
- Peak RSS Bytes: ${evidence.latencyAndMemory.peakRssBytes}

| Phase | Duration Ms | Peak RSS Bytes |
|---|---:|---:|
${measurements}

## Result

- Clean worktree: ${evidence.assertions.cleanWorktreeMeasured ? "PASS" : "FAIL"}
- CodeGraph measured: ${evidence.assertions.codeGraphMeasured ? "PASS" : "FAIL"}
- Review measured: ${evidence.assertions.reviewMeasured ? "PASS" : "FAIL"}
- Initial index budget: ${evidence.assertions.withinPrdInitialIndexBudget ? "PASS" : "FAIL"}
- Memory observed: ${evidence.assertions.memoryMeasured ? "PASS" : "FAIL"}
`;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function digestText(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function renderHuman(result: Awaited<ReturnType<typeof runFg6RepresentativeBenchmark>>): string {
  return [
    `[fg6-representative-benchmark-readback] ${result.ok ? "OK" : "FAILED"}`,
    `- tracked files: ${result.evidence.targetRepository.trackedFiles}`,
    `- e2e latency ms: ${result.evidence.latencyAndMemory.e2eLatencyMs}`,
    `- peak rss bytes: ${result.evidence.latencyAndMemory.peakRssBytes}`,
    ...result.failures.map((failure) => `- ${failure}`)
  ].join("\n");
}

function renderInspectHuman(result: ReturnType<typeof inspectFg6RepresentativeBenchmark>): string {
  if (result.ok) return "[fg6-representative-benchmark-readback] OK";
  return ["[fg6-representative-benchmark-readback] FAILED", ...result.failures.map((failure) => `- ${failure}`)].join("\n");
}
