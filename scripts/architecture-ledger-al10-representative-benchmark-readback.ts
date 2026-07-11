#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { digestJson, type Json } from "@archcontext/contracts";
import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import {
  emptyArchitectureLedgerEvidenceState,
  planYamlToArchitectureLedgerImport,
  projectArchitectureLedgerStateToYamlFiles,
  type ArchitectureLedgerScope
} from "@archcontext/core/architecture-ledger";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { createStartedDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { listModelFiles, rebuildGeneratedProjection } from "@archcontext/local-runtime/model-store-yaml";
import { runCli } from "@archcontext/surfaces/cli";

const ROOT = resolve(import.meta.dir, "..");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al10-representative-benchmark-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al10-representative-benchmark-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al10-representative-benchmark.md";
const GATES = ["AL10-03", "AL10-04", "AL10-BETA-1"] as const;
const WARM_QUERY_P95_THRESHOLD_MS = 300;
const HOOK_ENQUEUE_P95_THRESHOLD_MS = 150;
const CHECKPOINT_P95_THRESHOLD_MS = 3_000;
const DEFAULT_QUERY_SAMPLES = 8;
const FORBIDDEN_KEYS = new Set(["body", "sourceCode", "sourceBody", "rawSource", "rawDiff", "prompt", "completion"]);

type RepresentativeFixtureKind = "small-app" | "medium-monorepo" | "architecture-heavy-service";
type TimedEnvelope = {
  ok: boolean;
  elapsedMs: number;
  requestId?: string;
  schemaVersion?: string;
  reasonCode?: string;
  digest?: string;
  count?: number;
};

interface RepresentativeFixtureConfig {
  name: RepresentativeFixtureKind;
  label: string;
  entityCount: number;
  relationFanout: 1 | 2;
  constraintEvery: number;
  packageCount: number;
  sourcePrefix: string;
  query: string;
  task: string;
}

const FIXTURES: RepresentativeFixtureConfig[] = [
  {
    name: "small-app",
    label: "Small App",
    entityCount: 10,
    relationFanout: 1,
    constraintEvery: 5,
    packageCount: 1,
    sourcePrefix: "src/app",
    query: "checkout app architecture ledger projection drift",
    task: "Ship a small app checkout change with architecture ledger replay."
  },
  {
    name: "medium-monorepo",
    label: "Medium Monorepo",
    entityCount: 54,
    relationFanout: 2,
    constraintEvery: 9,
    packageCount: 6,
    sourcePrefix: "packages",
    query: "monorepo package boundary ledger recommendation benchmark",
    task: "Update a medium monorepo package boundary and keep Book queries stable."
  },
  {
    name: "architecture-heavy-service",
    label: "Architecture-Heavy Service",
    entityCount: 108,
    relationFanout: 2,
    constraintEvery: 6,
    packageCount: 9,
    sourcePrefix: "services/architecture-heavy",
    query: "service persistence boundary security architecture ledger replay",
    task: "Move a service persistence boundary through deterministic ledger projection."
  }
];

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[architecture-ledger-al10-representative-benchmark-readback] usage: run|inspect [--out path] [--report path] [--evidence path] [--json] [--samples n]");
    process.exit(2);
  }
  const result = command === "run"
    ? await runArchitectureLedgerAl10RepresentativeBenchmarkReadback({
        outPath: readFlag(args, "--out") ?? DEFAULT_OUT,
        reportPath: readFlag(args, "--report") ?? DEFAULT_REPORT,
        querySamples: Number(readFlag(args, "--samples") ?? DEFAULT_QUERY_SAMPLES)
      })
    : inspectArchitectureLedgerAl10RepresentativeBenchmarkReadback(
        JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
      );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export async function runArchitectureLedgerAl10RepresentativeBenchmarkReadback({
  outPath = DEFAULT_OUT,
  reportPath = DEFAULT_REPORT,
  querySamples = DEFAULT_QUERY_SAMPLES
} = {}) {
  const packet = await buildArchitectureLedgerAl10RepresentativeBenchmarkPacket({ querySamples });
  const inspected = inspectArchitectureLedgerAl10RepresentativeBenchmarkReadback(packet);
  const finalPacket = {
    ...packet,
    status: inspected.ok ? "verified" : "failed",
    failures: inspected.failures
  };
  writeJson(outPath, finalPacket);
  writeText(reportPath, renderReport(finalPacket));
  return inspectArchitectureLedgerAl10RepresentativeBenchmarkReadback(finalPacket);
}

export async function buildArchitectureLedgerAl10RepresentativeBenchmarkPacket({
  querySamples = DEFAULT_QUERY_SAMPLES
} = {}) {
  const fixtures = [];
  for (const fixture of FIXTURES) fixtures.push(await runRepresentativeFixture(fixture, querySamples));
  const benchmark = summarizeBenchmark(fixtures);
  const privacy = inspectPrivacy({ fixtures, benchmark });
  const assertions = {
    "AL10-03": fixtures.length === 3 && fixtures.every((fixture) => fixture.assertions.fullLoopComplete),
    "AL10-04": fixtures.every((fixture) => fixture.assertions.allRequiredMetricsMeasured),
    "AL10-BETA-1": fixtures.every((fixture) => fixture.assertions.dualModeDriftClean),
    warmQueryP95WithinBetaBudget: benchmark.warmQueryP95Ms <= WARM_QUERY_P95_THRESHOLD_MS,
    hookEnqueueP95WithinBetaBudget: benchmark.hookEnqueueP95Ms <= HOOK_ENQUEUE_P95_THRESHOLD_MS,
    checkpointP95WithinBetaBudget: benchmark.checkpointP95Ms <= CHECKPOINT_P95_THRESHOLD_MS,
    privacyClean: privacy.noRawSourceSentinel && privacy.noForbiddenKeys
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(0).toISOString(),
    gates: [...GATES],
    thresholds: {
      warmQueryP95Ms: WARM_QUERY_P95_THRESHOLD_MS,
      hookEnqueueP95Ms: HOOK_ENQUEUE_P95_THRESHOLD_MS,
      checkpointP95Ms: CHECKPOINT_P95_THRESHOLD_MS,
      querySamples
    },
    fixtures,
    benchmark,
    privacy,
    assertions,
    readback: {
      command: `bun scripts/architecture-ledger-al10-representative-benchmark-readback.ts inspect --evidence ${DEFAULT_OUT} --json`,
      reportPath: DEFAULT_REPORT
    },
    failures: [] as string[]
  };
}

export function inspectArchitectureLedgerAl10RepresentativeBenchmarkReadback(packet: any) {
  const failures: string[] = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return { ok: false, status: "failed", failures: ["packet must be an object"], gates: {} };
  }
  if (packet.schemaVersion !== SCHEMA_VERSION) failures.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (packet.status !== undefined && packet.status !== "verified") failures.push("status must be verified");
  if (packet.thresholds?.warmQueryP95Ms !== WARM_QUERY_P95_THRESHOLD_MS) failures.push("warm query threshold mismatch");
  if (packet.thresholds?.hookEnqueueP95Ms !== HOOK_ENQUEUE_P95_THRESHOLD_MS) failures.push("hook enqueue threshold mismatch");
  if (packet.thresholds?.checkpointP95Ms !== CHECKPOINT_P95_THRESHOLD_MS) failures.push("checkpoint threshold mismatch");
  if (!(Number.isInteger(packet.thresholds?.querySamples) && packet.thresholds.querySamples >= 5)) failures.push("querySamples must be >= 5");

  const fixtures = Array.isArray(packet.fixtures) ? packet.fixtures : [];
  const fixtureNames = fixtures.map((fixture: any) => fixture.name).sort().join(",");
  if (fixtureNames !== "architecture-heavy-service,medium-monorepo,small-app") {
    failures.push("fixtures must include small app, medium monorepo and architecture-heavy service");
  }
  for (const fixture of fixtures) {
    if (fixture.assertions?.fullLoopComplete !== true) failures.push(`${fixture.name}: full loop did not complete`);
    if (fixture.assertions?.allRequiredMetricsMeasured !== true) failures.push(`${fixture.name}: required metrics missing`);
    if (fixture.assertions?.dualModeDriftClean !== true) failures.push(`${fixture.name}: dual-mode drift not clean`);
    if (fixture.loop?.migration?.writeVerified !== true) failures.push(`${fixture.name}: migration write not verified`);
    if (fixture.loop?.rollback?.executable !== true) failures.push(`${fixture.name}: rollback not executable`);
    for (const phase of ["hookEnqueue", "sync", "query", "checkpoint", "complete", "projection", "replay"]) {
      if (!(fixture.metrics?.[phase]?.elapsedMs >= 0)) failures.push(`${fixture.name}: ${phase} elapsedMs missing`);
    }
  }

  const benchmark = packet.benchmark ?? {};
  if (!(benchmark.warmQueryP95Ms >= 0 && benchmark.warmQueryP95Ms <= WARM_QUERY_P95_THRESHOLD_MS)) failures.push("warm query p95 exceeds beta budget");
  if (!(benchmark.hookEnqueueP95Ms >= 0)) failures.push("hook enqueue p95 must be measured");
  if (!(benchmark.checkpointP95Ms >= 0 && benchmark.checkpointP95Ms <= CHECKPOINT_P95_THRESHOLD_MS)) failures.push("checkpoint p95 exceeds beta budget");

  if (packet.privacy?.noRawSourceSentinel !== true) failures.push("raw source sentinel leaked");
  if (packet.privacy?.noForbiddenKeys !== true) failures.push(`privacy forbidden keys present: ${packet.privacy?.forbiddenKeys?.join(",")}`);
  for (const gate of GATES) {
    if (packet.assertions?.[gate] !== true) failures.push(`${gate} assertion failed`);
  }
  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? "verified" : "failed",
    failures,
    gates: Object.fromEntries(GATES.map((gate) => [gate, packet.assertions?.[gate] === true ? "verified" : "blocked"])),
    benchmark,
    assertions: packet.assertions
  };
}

async function runRepresentativeFixture(config: RepresentativeFixtureConfig, querySamples: number) {
  const root = mkdtempSync(join(tmpdir(), `archctx-al10-${config.name}-`));
  let daemon: Awaited<ReturnType<typeof createStartedDaemon>> | undefined;
  try {
    createGitRepository(root, config);
    daemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: new TestLocalStore(),
      architectureLedger: { rolloutMode: "yaml" },
      clock: () => "2026-06-26T12:00:00.000Z"
    });
    const deps = { runtimeClient: daemon };
    const init = await measureEnvelope(() => runCli("init", ["--name", `AL10 ${config.label}`], root, deps));
    writeRepresentativeArchitectureModel(root, config);
    canonicalizeRepresentativeArchitectureModel(root, config);
    rebuildGeneratedProjection(root);
    git(root, "add", ".");
    git(root, "commit", "-m", "add representative architecture model");

    const dryRun = await measureEnvelope(() => runCli("ledger", ["migrate", "--from-yaml", "--dry-run"], root, deps));
    const preMigrateStatus = await daemon.runtimeStatus(root);
    const migrate = await measureEnvelope(() => runCli("ledger", [
      "migrate",
      "--from-yaml",
      "--write",
      "--expected-worktree-digest",
      String((preMigrateStatus.data as any).worktreeDigest)
    ], root, deps));
    const postMigrateState = await runCli("ledger", ["state"], root, deps);

    const prepare = await measureEnvelope(() => runCli("prepare", [
      "--task-session-id",
      taskSessionId(config),
      "--task",
      config.task,
      "--max-items",
      "16"
    ], root, deps));
    const query = await measureQuery(root, deps, config, querySamples);
    const changedPath = writeRepresentativeWorktreeChange(root, config);
    const changedDigest = computeWorktreeDigest(root);
    const hookEnqueue = await measureEnvelope(() => daemon!.jobsEnqueueGitHook(root, {
      source: "worktree",
      event: "post-edit",
      risk: "high",
      uncertainty: "high",
      maxQueuedJobs: 10
    }));
    const sync = await measureEnvelope(() => runCli("sync", ["--changed", changedPath], root, deps));
    const checkpoint = await measureEnvelope(() => runCli("checkpoint", [
      "--task-session-id",
      taskSessionId(config),
      "--task",
      config.task,
      "--event",
      "post-edit",
      "--path",
      changedPath,
      "--expected-worktree-digest",
      changedDigest,
      "--max-items",
      "16"
    ], root, deps));
    const projection = await measureEnvelope(() => runCli("docs", [
      "apply",
      "--approved",
      "--task-session-id",
      taskSessionId(config),
      "--expected-worktree-digest",
      computeWorktreeDigest(root)
    ], root, deps));
    const drift = await runCli("docs", ["drift"], root, deps);
    const complete = await measureEnvelope(() => runCli("complete", [
      "--task-session-id",
      taskSessionId(config),
      "--task",
      config.task
    ], root, deps));
    const replay = await measureEnvelope(() => runCli("ledger", [
      "rebuild",
      "--from-git",
      "--expected-worktree-digest",
      computeWorktreeDigest(root)
    ], root, deps));
    const postReplayState = await runCli("ledger", ["state"], root, deps);
    const rollbackStatus = await daemon.runtimeStatus(root);
    const rollback = await measureEnvelope(() => runCli("ledger", [
      "rollback",
      "--to-yaml",
      "--write",
      "--expected-worktree-digest",
      String((rollbackStatus.data as any).worktreeDigest)
    ], root, deps));

    const migrateData = (migrate.value as any).data ?? {};
    const replayData = (replay.value as any).data ?? {};
    const rollbackData = (rollback.value as any).data ?? {};
    const driftData = (drift as any).data ?? {};
    const postMigrateData = (postMigrateState as any).data ?? {};
    const postReplayData = (postReplayState as any).data ?? {};
    const sourceSentinel = sourceSentinelFor(config);
    const metrics = {
      init: init.summary,
      migrationDryRun: dryRun.summary,
      migrationWrite: migrate.summary,
      prepare: prepare.summary,
      hookEnqueue: hookEnqueue.summary,
      sync: sync.summary,
      query: query.summary,
      checkpoint: checkpoint.summary,
      projection: projection.summary,
      complete: complete.summary,
      replay: replay.summary,
      rollback: rollback.summary
    };
    const requiredMetricPhases = ["hookEnqueue", "sync", "query", "checkpoint", "complete", "projection", "replay"];
    const fullLoopComplete = [
      init.summary.ok,
      dryRun.summary.ok,
      migrate.summary.ok && migrateData.status === "verified",
      prepare.summary.ok,
      hookEnqueue.summary.ok && (hookEnqueue.value as any).data?.enqueued === true,
      sync.summary.ok,
      query.summary.ok,
      checkpoint.summary.ok,
      projection.summary.ok,
      complete.summary.ok && (complete.value as any).data?.result === "pass",
      replay.summary.ok && postReplayData.drift?.ok === true,
      rollback.summary.ok
    ].every(Boolean);
    return {
      name: config.name,
      label: config.label,
      kind: config.name,
      repositoryShape: {
        entityCount: config.entityCount,
        relationCount: relationCountFor(config),
        constraintCount: constraintCountFor(config),
        packageCount: config.packageCount,
        changedPath
      },
      loop: {
        migration: {
          dryRunPlanned: dryRun.summary.ok && ((dryRun.value as any).data?.status === "planned"),
          status: migrateData.status,
          writeVerified: migrate.summary.ok && migrateData.status === "verified",
          recommendedMode: migrateData.recommendedEnvironment?.ARCHCONTEXT_LEDGER_MODE,
          backupCreated: migrateData.backup?.status === "created",
          verificationStatus: migrateData.verification?.status,
          replayIntegrityVerified: migrateData.verification?.ok === true,
          appendedEventCount: migrateData.append?.appendedEventCount ?? 0,
          driftOk: migrateData.drift?.ok === true,
          driftReasonCodes: migrateData.drift?.reasonCodes ?? [],
          reconcileAction: migrateData.reconcile?.action,
          graphDigest: migrateData.graphDigest
        },
        drift: {
          afterMigrate: postMigrateData.drift?.ok === true,
          afterReplay: postReplayData.drift?.ok === true,
          docsAfterProjection: driftData.ok === true
        },
        rollback: {
          executable: rollback.summary.ok && rollbackData.targetAuthority === "yaml",
          targetAuthority: rollbackData.targetAuthority,
          recommendedMode: rollbackData.recommendedEnvironment?.ARCHCONTEXT_LEDGER_MODE
        },
        complete: {
          result: (complete.value as any).data?.result,
          pass: (complete.value as any).data?.result === "pass",
          findingIds: (((complete.value as any).data?.findings ?? []) as any[]).map((finding) => finding.id).sort()
        },
        hook: {
          enqueued: (hookEnqueue.value as any).data?.enqueued === true,
          failOpen: (hookEnqueue.value as any).data?.failOpen === false,
          reasonCode: (hookEnqueue.value as any).data?.reasonCode,
          pathCount: (hookEnqueue.value as any).data?.change?.pathCount
        },
        query: {
          returnsExpectedSubject: query.returnsExpectedSubject,
          coldMs: query.coldMs,
          warmP95Ms: query.summary.elapsedMs,
          sampleCount: query.samples.length,
          responseDigest: query.responseDigest
        }
      },
      metrics,
      privacy: inspectPrivacy({ metrics, loop: "metadata-only" }, [sourceSentinel]),
      assertions: {
        fullLoopComplete,
        allRequiredMetricsMeasured: requiredMetricPhases.every((phase) => (metrics as any)[phase]?.elapsedMs >= 0),
        dualModeDriftClean: postMigrateData.drift?.ok === true && postReplayData.drift?.ok === true,
        queryWithinBudget: query.summary.elapsedMs <= WARM_QUERY_P95_THRESHOLD_MS,
        hookWithinBudget: hookEnqueue.summary.elapsedMs <= HOOK_ENQUEUE_P95_THRESHOLD_MS,
        checkpointWithinBudget: checkpoint.summary.elapsedMs <= CHECKPOINT_P95_THRESHOLD_MS,
        noSourceLeak: inspectPrivacy({ metrics, loop: "metadata-only" }, [sourceSentinel]).noRawSourceSentinel
      }
    };
  } finally {
    await daemon?.stop().catch(() => undefined);
    rmSync(root, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
  }
}

async function measureQuery(root: string, deps: { runtimeClient: Awaited<ReturnType<typeof createStartedDaemon>> }, config: RepresentativeFixtureConfig, sampleCount: number) {
  const queryArgs = ["query", "--query", config.query, "--explain", "--max-items", "12", "--max-bytes", "32768"];
  const cold = await measureEnvelope(() => runCli("book", queryArgs, root, deps));
  const samples: number[] = [];
  let last = cold.value;
  for (let index = 0; index < sampleCount; index += 1) {
    const measured = await measureEnvelope(() => runCli("book", queryArgs, root, deps));
    samples.push(measured.summary.elapsedMs);
    last = measured.value;
  }
  const expectedSubject = moduleId(config, 0);
  const results = ((last as any).data?.results ?? []) as any[];
  return {
    summary: {
      ok: cold.summary.ok && samples.length === sampleCount,
      elapsedMs: p95(samples),
      requestId: "book.query",
      schemaVersion: (last as any).data?.schemaVersion,
      digest: digestJson(packetSafe((last as any).data) as Json),
      count: results.length
    },
    coldMs: cold.summary.elapsedMs,
    samples,
    returnsExpectedSubject: results.some((result) => result.id === expectedSubject),
    responseDigest: digestJson(packetSafe((last as any).data) as Json)
  };
}

async function measureEnvelope(run: () => Promise<any>): Promise<{ value: any; summary: TimedEnvelope }> {
  const started = performance.now();
  const value = await run();
  const elapsedMs = roundMs(performance.now() - started);
  return { value, summary: summarizeEnvelope(value, elapsedMs) };
}

function summarizeEnvelope(value: any, elapsedMs: number): TimedEnvelope {
  const data = value?.data ?? {};
  const digestInput = packetSafe({
    ok: value?.ok,
    requestId: value?.requestId,
    data: {
      schemaVersion: data.schemaVersion,
      status: data.status,
      result: data.result,
      reasonCode: data.reasonCode,
      graphDigest: data.graphDigest,
      projectionDigest: data.projectionDigest,
      modelDigest: data.modelDigest,
      codeFactsDigest: data.codeFactsDigest,
      recommendationCount: Array.isArray(data.recommendations) ? data.recommendations.length : undefined,
      resultCount: Array.isArray(data.results) ? data.results.length : undefined,
      eventCount: data.freshness?.ledgerCursor?.eventCount,
      pathCount: data.pathCount,
      driftOk: data.drift?.ok,
      appendedEventCount: data.append?.appendedEventCount,
      enqueued: data.enqueued,
      accepted: data.accepted
    }
  });
  return {
    ok: value?.ok === true,
    elapsedMs,
    requestId: value?.requestId,
    schemaVersion: data.schemaVersion,
    reasonCode: data.reasonCode,
    digest: digestJson(digestInput as Json),
    count: firstNumber(data.resultCount, data.pathCount, data.fileCount, data.targetCount, data.appendedEventCount)
  };
}

function createGitRepository(root: string, config: RepresentativeFixtureConfig): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "README.md"), `# AL10 ${config.label}\n`, "utf8");
  writeRepresentativeSourceFiles(root, config);
  git(root, "init");
  git(root, "config", "user.email", "archctx@example.invalid");
  git(root, "config", "user.name", "ArchContext");
  git(root, "add", ".");
  git(root, "commit", "-m", "initial representative repository");
}

function writeRepresentativeSourceFiles(root: string, config: RepresentativeFixtureConfig): void {
  for (let index = 0; index < config.packageCount; index += 1) {
    const filePath = sourcePath(config, index);
    const absolute = join(root, filePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, [
      `export const moduleName = "${moduleId(config, index)}";`,
      `export const sourceSentinel = "${sourceSentinelFor(config)}";`,
      "export function architectureBoundary() {",
      `  return "${config.label} boundary ${index}";`,
      "}",
      ""
    ].join("\n"), "utf8");
  }
}

function writeRepresentativeArchitectureModel(root: string, config: RepresentativeFixtureConfig): void {
  for (let index = 0; index < config.entityCount; index += 1) {
    writeModelFile(root, `.archcontext/model/nodes/${moduleId(config, index)}.yaml`, [
      'schemaVersion: "archcontext.node/v1"',
      `id: "${moduleId(config, index)}"`,
      'kind: "module"',
      `name: "${config.label} module ${index}"`,
      'status: "active"',
      `path: "${sourcePath(config, index % config.packageCount)}"`,
      `summary: "Owns ${config.label} architecture ledger lane ${index}."`,
      "metadata:",
      index === 0 ? "  importance: 1" : "  importance: 0.7",
      "  evidenceStrength: 0.8",
      ""
    ]);
  }
  for (let index = 0; index < config.entityCount - 1; index += 1) {
    for (let offset = 1; offset <= config.relationFanout; offset += 1) {
      if (index + offset >= config.entityCount) continue;
      writeModelFile(root, `.archcontext/model/relations/relation.${config.name}.${index}.${offset}.yaml`, [
        'schemaVersion: "archcontext.relation/v1"',
        `id: "relation.${config.name}.${index}.${offset}"`,
        'kind: "depends_on"',
        `source: "${moduleId(config, index)}"`,
        `target: "${moduleId(config, index + offset)}"`,
        'status: "active"',
        `summary: "${config.label} module ${index} depends on module ${index + offset} for representative replay."`,
        ""
      ]);
    }
  }
  for (let index = 0; index < config.entityCount; index += config.constraintEvery) {
    writeModelFile(root, `.archcontext/model/constraints/constraint.${config.name}.${index}.yaml`, [
      'schemaVersion: "archcontext.constraint/v1"',
      `id: "constraint.${config.name}.${index}"`,
      'kind: "owner-required"',
      `subject: "${moduleId(config, index)}"`,
      'status: "active"',
      'severity: "warning"',
      `summary: "${config.label} module ${index} must retain an owner before authority promotion."`,
      ""
    ]);
  }
}

function canonicalizeRepresentativeArchitectureModel(root: string, config: RepresentativeFixtureConfig): void {
  const plan = planYamlToArchitectureLedgerImport({
    ...fixtureScope(config),
    files: listModelFiles(root),
    previousEvidenceState: emptyArchitectureLedgerEvidenceState(),
    createdAt: "2026-06-26T12:00:00.000Z",
    command: "archctx ledger canonicalize representative fixture"
  });
  rmSync(resolve(root, ".archcontext/model"), { recursive: true, force: true });
  for (const file of projectArchitectureLedgerStateToYamlFiles(plan.state)) {
    const absolute = resolve(root, file.path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, file.body, "utf8");
  }
}

function writeRepresentativeWorktreeChange(root: string, config: RepresentativeFixtureConfig): string {
  const path = sourcePath(config, 0);
  const absolute = join(root, path);
  writeFileSync(absolute, [
    `export const moduleName = "${moduleId(config, 0)}";`,
    `export const sourceSentinel = "${sourceSentinelFor(config)}";`,
    "export function architectureBoundary() {",
    `  return "${config.label} boundary changed under AL10 representative replay";`,
    "}",
    ""
  ].join("\n"), "utf8");
  return path;
}

function writeModelFile(root: string, path: string, lines: string[]): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, lines.join("\n"), "utf8");
}

function summarizeBenchmark(fixtures: any[]) {
  const phase = (name: string) => fixtures.map((fixture) => fixture.metrics?.[name]?.elapsedMs).filter((value) => typeof value === "number");
  const allQuerySamples = fixtures.flatMap((fixture) => fixture.loop?.query?.sampleCount ? [fixture.loop.query.warmP95Ms] : []);
  return {
    fixtureCount: fixtures.length,
    totalEntities: fixtures.reduce((sum, fixture) => sum + Number(fixture.repositoryShape?.entityCount ?? 0), 0),
    totalRelations: fixtures.reduce((sum, fixture) => sum + Number(fixture.repositoryShape?.relationCount ?? 0), 0),
    totalConstraints: fixtures.reduce((sum, fixture) => sum + Number(fixture.repositoryShape?.constraintCount ?? 0), 0),
    hookEnqueueP95Ms: p95(phase("hookEnqueue")),
    syncP95Ms: p95(phase("sync")),
    warmQueryP95Ms: p95(allQuerySamples),
    checkpointP95Ms: p95(phase("checkpoint")),
    completeP95Ms: p95(phase("complete")),
    projectionP95Ms: p95(phase("projection")),
    replayP95Ms: p95(phase("replay")),
    rollbackP95Ms: p95(phase("rollback")),
    dualModeDriftCount: fixtures.filter((fixture) => fixture.assertions?.dualModeDriftClean !== true).length
  };
}

function inspectPrivacy(value: unknown, rawSourceSentinels: string[] = FIXTURES.map(sourceSentinelFor)) {
  const serialized = JSON.stringify(value);
  const forbiddenKeys: string[] = [];
  collectForbiddenKeys(value, "$", forbiddenKeys);
  return {
    noRawSourceSentinel: rawSourceSentinels.every((sentinel) => !serialized.includes(sentinel)),
    noForbiddenKeys: forbiddenKeys.length === 0,
    forbiddenKeys: forbiddenKeys.sort()
  };
}

function collectForbiddenKeys(value: unknown, path: string, hits: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeys(item, `${path}[${index}]`, hits));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) hits.push(`${path}.${key}`);
    collectForbiddenKeys(child, `${path}.${key}`, hits);
  }
}

function packetSafe(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function roundMs(value: number): number {
  return Number(value.toFixed(3));
}

function sourcePath(config: RepresentativeFixtureConfig, index: number): string {
  if (config.name === "medium-monorepo") {
    return `${config.sourcePrefix}/pkg-${index % config.packageCount}/src/module-${index}.ts`;
  }
  if (config.name === "architecture-heavy-service") {
    return `${config.sourcePrefix}/bounded-context-${index % config.packageCount}/module-${index}.ts`;
  }
  return `${config.sourcePrefix}/module-${index}.ts`;
}

function moduleId(config: RepresentativeFixtureConfig, index: number): string {
  return `module.al10-${config.name}-${index}`;
}

function taskSessionId(config: RepresentativeFixtureConfig): string {
  return `task_al10_${config.name.replaceAll("-", "_")}`;
}

function fixtureScope(config: RepresentativeFixtureConfig): ArchitectureLedgerScope {
  return {
    repository: {
      repositoryId: `repo.al10-${config.name}`,
      storageRepositoryId: `repo.storage.al10-${config.name}`
    },
    worktree: {
      workspaceId: `workspace.al10-${config.name}`,
      storageWorkspaceId: `workspace.storage.al10-${config.name}`,
      branch: "main",
      headSha: `al10-${config.name}`,
      worktreeDigest: digestJson({ fixture: config.name, purpose: "canonicalize" } as unknown as Json)
    }
  };
}

function sourceSentinelFor(config: RepresentativeFixtureConfig): string {
  return `AL10_RAW_SOURCE_SENTINEL_${config.name}`;
}

function relationCountFor(config: RepresentativeFixtureConfig): number {
  let count = 0;
  for (let index = 0; index < config.entityCount - 1; index += 1) {
    for (let offset = 1; offset <= config.relationFanout; offset += 1) {
      if (index + offset < config.entityCount) count += 1;
    }
  }
  return count;
}

function constraintCountFor(config: RepresentativeFixtureConfig): number {
  return Math.ceil(config.entityCount / config.constraintEvery);
}

function firstNumber(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === "number");
}

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function writeJson(path: string, value: unknown): void {
  const absolute = resolve(ROOT, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(path: string, value: string): void {
  const absolute = resolve(ROOT, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function renderHuman(result: ReturnType<typeof inspectArchitectureLedgerAl10RepresentativeBenchmarkReadback>): string {
  return result.ok
    ? "AL10 representative benchmark readback verified\n"
    : `AL10 representative benchmark readback failed:\n- ${result.failures.join("\n- ")}\n`;
}

function renderReport(packet: any): string {
  const inspected = inspectArchitectureLedgerAl10RepresentativeBenchmarkReadback(packet);
  const rows = (packet.fixtures ?? [])
    .map((fixture: any) => `| ${fixture.label} | ${fixture.repositoryShape.entityCount} | ${fixture.repositoryShape.relationCount} | ${fixture.metrics.hookEnqueue.elapsedMs} | ${fixture.metrics.sync.elapsedMs} | ${fixture.metrics.query.elapsedMs} | ${fixture.metrics.checkpoint.elapsedMs} | ${fixture.metrics.complete.elapsedMs} | ${fixture.metrics.projection.elapsedMs} | ${fixture.metrics.replay.elapsedMs} | ${fixture.assertions.dualModeDriftClean ? "0" : "1"} |`)
    .join("\n");
  return `# AL10 Representative Replay And Benchmark Readback

Date: 2026-06-26

## Scope

This closes AL10-03 and AL10-04, and provides AL10-BETA-1 evidence, for the architecture ledger sprint.

It runs the daemon-owned loop on three temporary Git repositories: small app, medium monorepo and architecture-heavy service. Each repository exercises YAML-to-ledger migration, Book query, prepare/checkpoint, hook enqueue, sync, documentation projection apply, complete-task projection validation, ledger replay and YAML rollback.

## P1 Map

The measured path stays inside Local Core. CLI commands call the runtime daemon. The daemon owns migration, ledger append, job enqueue, checkpoint, complete, ChangeSet apply, replay and rollback. The temporary Git repositories provide representative model size and shape; no user repository or SQLite database is committed.

## P2 Traced Path

\`\`\`text
temporary Git representative repo
  -> archctx init
  -> archctx ledger migrate --from-yaml --write
  -> archctx prepare / book query
  -> source worktree change
  -> archctx hook enqueue + sync + checkpoint
  -> archctx docs apply --approved
  -> archctx complete
  -> archctx ledger rebuild --from-git
  -> archctx ledger rollback --to-yaml --write
\`\`\`

## P3 Decision

This readback intentionally uses synthetic representative repositories rather than mutating sibling user repositories. The tradeoff is that it proves workflow mechanics, drift and performance shape, not beta-user adoption. That is sufficient for AL10-03/04 and AL10-BETA-1, while AL10-13 and AL10-14 remain separate telemetry/product gates.

## Benchmark

Thresholds: warm query p95 <= ${packet.thresholds?.warmQueryP95Ms} ms; hook enqueue p95 <= ${packet.thresholds?.hookEnqueueP95Ms} ms; checkpoint p95 <= ${packet.thresholds?.checkpointP95Ms} ms.

| Fixture | Entities | Relations | Hook ms | Sync ms | Warm query p95 ms | Checkpoint ms | Complete ms | Projection ms | Replay ms | Drift count |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${rows}

Aggregate warm query p95: ${packet.benchmark?.warmQueryP95Ms} ms.
Aggregate hook enqueue p95: ${packet.benchmark?.hookEnqueueP95Ms} ms.
Aggregate checkpoint p95: ${packet.benchmark?.checkpointP95Ms} ms.
Dual-mode drift count: ${packet.benchmark?.dualModeDriftCount}.

## Privacy

- Raw source sentinel leaked: ${packet.privacy?.noRawSourceSentinel ? "no" : "yes"}
- Forbidden response keys present: ${packet.privacy?.noForbiddenKeys ? "no" : "yes"}
- Packet stores only digests, counts, request metadata and latency summaries.

## Assertions

${Object.entries(packet.assertions ?? {}).map(([gate, ok]) => `- ${gate}: ${ok ? "PASS" : "FAIL"}`).join("\n")}

## Verification

\`\`\`bash
bun run record:al10:representative-benchmark
bun run readback:al10:representative-benchmark
bun test scripts/architecture-ledger-al10-representative-benchmark-readback.test.ts --timeout 120000
bun run typecheck
node scripts/sprint-status-check.mjs
git diff --check
\`\`\`

Readback status: ${inspected.status}
`;
}
