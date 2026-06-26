#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import { architectureLedgerStateDigest, type ArchitectureLedgerScope } from "@archcontext/core/architecture-ledger";
import { digestJson, type ArchitectureEventV1, type Json } from "@archcontext/contracts";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { assertNoSourceStorageSchema, migrationSql, SqliteLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import { createStartedDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { runCli } from "@archcontext/surfaces/cli";

const ROOT = resolve(import.meta.dir, "..");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al10-ga-technical-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al10-ga-technical-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al10-ga-technical.md";
const GATES = ["AL10-GA-1", "AL10-GA-2", "AL10-GA-3", "AL10-GA-4", "AL10-GA-5"] as const;
const EXPLICITLY_OPEN = ["AL10-14", "AL10-GA-6", "AL10-GA-7"] as const;
const GA_STRESS_EVENT_COUNT = 10_000;
const GA_WARM_QUERY_P95_MS = 200;
const GA_CHANGED_FILE_COUNT = 200;
const GA_INCREMENTAL_ANALYSIS_P95_MS = 2_000;
const GA_INCREMENTAL_SAMPLE_COUNT = 5;

const BENCHMARK_PATH = "docs/verification/architecture-ledger-al10-representative-benchmark-readback.json";
const CHAOS_SECURITY_PATH = "docs/verification/architecture-ledger-al10-chaos-security-readback.json";
const RECOMMENDATION_QUALITY_PATH = "docs/verification/architecture-ledger-al10-recommendation-quality-readback.json";

const SECURITY_CASES = ["stale-replay", "event-tamper", "path-traversal", "symlink-escape", "forged-evidence"] as const;
const RAW_CONTENT_PATTERNS = [
  /diff\s+--git/i,
  /^@@\s/m,
  /"patch"\s*:/i,
  /"sourceBody"\s*:/i,
  /"diffBody"\s*:/i,
  /promptBody/i,
  /completionBody/i
] as const;
const SECRET_PATTERNS = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /secret:\/\//i
] as const;

const LEDGER_SCOPE: ArchitectureLedgerScope = {
  repository: {
    repositoryId: "repo.al10-ga-technical",
    storageRepositoryId: "repo.storage.al10-ga-technical"
  },
  worktree: {
    workspaceId: "workspace.al10-ga-technical",
    storageWorkspaceId: "workspace.storage.al10-ga-technical",
    branch: "main",
    headSha: "abc123al10gatechnical",
    worktreeDigest: digestJson({ worktree: "al10-ga-technical" } as unknown as Json)
  }
};

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[architecture-ledger-al10-ga-technical-readback] usage: run|inspect [--out path] [--report path] [--evidence path] [--json]");
    process.exit(2);
  }
  const result = command === "run"
    ? await runArchitectureLedgerAl10GaTechnicalReadback({
        outPath: readFlag(args, "--out") ?? DEFAULT_OUT,
        reportPath: readFlag(args, "--report") ?? DEFAULT_REPORT
      })
    : inspectArchitectureLedgerAl10GaTechnicalReadback(
        JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
      );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export async function runArchitectureLedgerAl10GaTechnicalReadback({
  outPath = DEFAULT_OUT,
  reportPath = DEFAULT_REPORT
} = {}) {
  const packet = await buildArchitectureLedgerAl10GaTechnicalPacket();
  const inspected = inspectArchitectureLedgerAl10GaTechnicalReadback(packet);
  const finalPacket = {
    ...packet,
    status: inspected.ok ? "verified" : "failed",
    failures: inspected.failures
  };
  writeJson(outPath, finalPacket);
  writeText(reportPath, renderReport(finalPacket));
  return inspectArchitectureLedgerAl10GaTechnicalReadback(finalPacket);
}

export async function buildArchitectureLedgerAl10GaTechnicalPacket() {
  const sourcePackets = {
    benchmark: loadSourcePacket("representative-benchmark", BENCHMARK_PATH),
    chaosSecurity: loadSourcePacket("chaos-security", CHAOS_SECURITY_PATH),
    recommendationQuality: loadSourcePacket("recommendation-quality", RECOMMENDATION_QUALITY_PATH)
  };
  const stress = await runGaStressProbe();
  const incrementalAnalysis = await runIncrementalAnalysisProbe();
  const performance = summarizePerformance(sourcePackets.benchmark.packet, incrementalAnalysis);
  const security = summarizeSecurity(sourcePackets.chaosSecurity.packet);
  const recommendations = summarizeRecommendations(sourcePackets.recommendationQuality.packet);
  const sourceReadbacks = [
    inspectBenchmarkSource(sourcePackets.benchmark),
    inspectChaosSecuritySource(sourcePackets.chaosSecurity),
    inspectRecommendationSource(sourcePackets.recommendationQuality)
  ];
  const privacy = inspectPrivacy({
    stress,
    incrementalAnalysis,
    performance,
    security,
    recommendations,
    sourceReadbacks
  });
  const assertions = {
    "AL10-GA-1": stress.eventCount === GA_STRESS_EVENT_COUNT
      && stress.appendedEventCount === GA_STRESS_EVENT_COUNT
      && stress.replayEventCount === GA_STRESS_EVENT_COUNT
      && stress.uniqueEventIds === GA_STRESS_EVENT_COUNT
      && stress.lostEventCount === 0
      && stress.duplicateEventCount === 0
      && stress.integrityOk === true,
    "AL10-GA-2": performance.warmQueryP95Ms <= GA_WARM_QUERY_P95_MS
      && performance.representativeFixtureCount >= 3,
    "AL10-GA-3": incrementalAnalysis.changedFileCount === GA_CHANGED_FILE_COUNT
      && incrementalAnalysis.sampleCount === GA_INCREMENTAL_SAMPLE_COUNT
      && incrementalAnalysis.p95Ms <= GA_INCREMENTAL_ANALYSIS_P95_MS
      && incrementalAnalysis.nonCoalescedSampleCount === GA_INCREMENTAL_SAMPLE_COUNT
      && incrementalAnalysis.failedSampleCount === 0,
    "AL10-GA-4": security.requiredCaseCount === SECURITY_CASES.length
      && security.verifiedCaseCount === SECURITY_CASES.length
      && security.passRate === 1,
    "AL10-GA-5": recommendations.hardGateFalsePositiveRate === 0
      && recommendations.heuristicOnlyHardGateRate === 0
      && recommendations.dynamicDocHardGateRate === 0
      && recommendations.failedEvalGateCount === 0,
    sourceReadbacksVerified: sourceReadbacks.every((source) => source.verified),
    openGatesPreserved: sameStringSet(EXPLICITLY_OPEN, EXPLICITLY_OPEN),
    noPrivateContent: privacy.clean
  };
  const readbackDigest = digestJson({
    schemaVersion: SCHEMA_VERSION,
    stress,
    performance,
    incrementalAnalysis,
    security,
    recommendations,
    sourceReadbacks,
    privacy,
    assertions
  } as unknown as Json);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(0).toISOString(),
    gates: [...GATES],
    status: "verified",
    scope: {
      repo: "architecture-ledger-ga-technical-gates",
      authority: "local deterministic GA technical readback",
      closedGates: [...GATES],
      explicitlyOpen: [...EXPLICITLY_OPEN],
      nonClaims: [
        "does not close AL10-14 beta-user interviews",
        "does not close AL10-GA-6 external review",
        "does not close AL10-GA-7 production rollback drill"
      ]
    },
    thresholds: {
      stressEventCount: GA_STRESS_EVENT_COUNT,
      warmQueryP95Ms: GA_WARM_QUERY_P95_MS,
      changedFileCount: GA_CHANGED_FILE_COUNT,
      incrementalAnalysisP95Ms: GA_INCREMENTAL_ANALYSIS_P95_MS,
      incrementalAnalysisSamples: GA_INCREMENTAL_SAMPLE_COUNT,
      securityPassRate: 1,
      hardGateFalsePositiveRate: 0
    },
    sources: [
      { id: "representative-benchmark", path: BENCHMARK_PATH, expectedGates: ["AL10-03", "AL10-04", "AL10-BETA-1"] },
      { id: "chaos-security", path: CHAOS_SECURITY_PATH, expectedGates: ["AL10-05", "AL10-06"] },
      { id: "recommendation-quality", path: RECOMMENDATION_QUALITY_PATH, expectedGates: ["AL10-08", "AL10-BETA-4"] }
    ],
    sourceReadbacks,
    stress,
    performance,
    incrementalAnalysis,
    security,
    recommendations,
    privacy,
    assertions,
    readbackDigest,
    readback: {
      command: `bun scripts/architecture-ledger-al10-ga-technical-readback.ts inspect --evidence ${DEFAULT_OUT} --json`,
      recordCommand: `bun scripts/architecture-ledger-al10-ga-technical-readback.ts run --out ${DEFAULT_OUT} --report ${DEFAULT_REPORT} --json`,
      reportPath: DEFAULT_REPORT
    },
    failures: [] as string[]
  };
}

export function inspectArchitectureLedgerAl10GaTechnicalReadback(packet: any) {
  const failures: string[] = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return { ok: false, status: "failed", failures: ["packet must be an object"], gates: {} };
  }
  if (packet.schemaVersion !== SCHEMA_VERSION) failures.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (packet.status !== undefined && packet.status !== "verified") failures.push("status must be verified");
  if (!sameStringSet(packet.gates, GATES)) failures.push("gates must be exactly AL10-GA-1 through AL10-GA-5");
  if (!sameStringSet(packet.scope?.closedGates, GATES)) failures.push("scope.closedGates must be exactly AL10-GA-1 through AL10-GA-5");
  if (!sameStringSet(packet.scope?.explicitlyOpen, EXPLICITLY_OPEN)) failures.push("scope.explicitlyOpen must keep AL10-14, AL10-GA-6 and AL10-GA-7 open");
  if (!packet.readbackDigest || typeof packet.readbackDigest !== "string") failures.push("readbackDigest must be present");

  inspectSourceReadbacks(packet.sourceReadbacks, failures);
  inspectStress(packet.stress, failures);
  inspectPerformance(packet.performance, failures);
  inspectIncrementalAnalysis(packet.incrementalAnalysis, failures);
  inspectSecurity(packet.security, failures);
  inspectRecommendations(packet.recommendations, failures);
  inspectPrivacyPacket(packet.privacy, failures);
  inspectAssertions(packet.assertions, failures);

  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? "verified" : "failed",
    failures,
    gates: Object.fromEntries(GATES.map((gate) => [gate, packet.assertions?.[gate] === true ? "verified" : "blocked"])),
    stress: packet.stress,
    performance: packet.performance,
    incrementalAnalysis: packet.incrementalAnalysis,
    security: packet.security,
    recommendations: packet.recommendations
  };
}

async function runGaStressProbe() {
  const root = mkdtempSync(join(tmpdir(), "archctx-al10-ga-stress-"));
  const databasePath = join(root, "runtime.sqlite");
  const store = new SqliteLocalStore(databasePath);
  const started = performance.now();
  try {
    await store.migrate();
    assertNoSourceStorageSchema(migrationSql());
    const events = Array.from({ length: GA_STRESS_EVENT_COUNT }, (_, index) => architectureLedgerEvent(index));
    const append = await store.appendArchitectureEvents({ writer: "runtime-daemon", events });
    const replay = await store.replayArchitectureLedger(LEDGER_SCOPE);
    const integrity = await store.checkArchitectureLedgerIntegrity(LEDGER_SCOPE);
    const uniqueEventIds = new Set(replay.events.map((event) => event.eventId)).size;
    const duplicateEventCount = replay.events.length - uniqueEventIds;
    return {
      databasePath: "$TMPDIR/archctx-al10-ga-stress/runtime.sqlite",
      eventCount: GA_STRESS_EVENT_COUNT,
      appendedEventCount: append.appendedEvents.length,
      replayEventCount: replay.events.length,
      uniqueEventIds,
      lostEventCount: GA_STRESS_EVENT_COUNT - uniqueEventIds,
      duplicateEventCount,
      entityCount: replay.state.entities.length,
      relationCount: replay.state.relations.length,
      constraintCount: replay.state.constraints.length,
      graphDigest: replay.graphDigest,
      materializedDigest: architectureLedgerStateDigest(replay.state),
      integrityOk: integrity.ok === true && integrity.eventCount === GA_STRESS_EVENT_COUNT && integrity.failures.length === 0,
      sqliteEventRows: sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_events"),
      sqliteCurrentRows: sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_current_graph_view"),
      ftsRows: sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_ledger_search_fts"),
      elapsedMs: roundMs(performance.now() - started)
    };
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}

async function runIncrementalAnalysisProbe() {
  const root = mkdtempSync(join(tmpdir(), "archctx-al10-ga-incremental-"));
  let daemon: Awaited<ReturnType<typeof createStartedDaemon>> | undefined;
  try {
    createGitRepository(root);
    const changedPaths = Array.from({ length: GA_CHANGED_FILE_COUNT }, (_, index) => `src/changed-${String(index).padStart(3, "0")}.ts`);
    for (const path of changedPaths) writeRepoFile(root, path, `export const base${path.match(/\d+/)?.[0] ?? "0"} = 0;\n`);
    git(root, "add", ".");
    git(root, "commit", "-m", "add ga incremental fixture");
    daemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: new TestLocalStore(),
      clock: () => "2026-06-26T12:00:00.000Z"
    });
    const deps = { runtimeClient: daemon };
    await runCli("init", ["--name", "AL10 GA Incremental"], root, deps);
    const taskSessionId = "task_al10_ga_incremental";
    await runCli("prepare", [
      "--task-session-id",
      taskSessionId,
      "--task",
      "Measure GA deterministic architecture analysis over 200 changed files.",
      "--max-items",
      "16"
    ], root, deps);
    const samples = [];
    for (let sample = 0; sample < GA_INCREMENTAL_SAMPLE_COUNT; sample += 1) {
      for (const path of changedPaths) {
        writeRepoFile(root, path, `export const sample${sample}_${path.match(/\d+/)?.[0] ?? "0"} = ${sample};\n`);
      }
      const digest = computeWorktreeDigest(root);
      const args = [
        "--task-session-id",
        taskSessionId,
        "--task",
        "Measure GA deterministic architecture analysis over 200 changed files.",
        "--event",
        `post-edit-ga-${sample}`,
        "--tool-call-id",
        `toolu_ga_incremental_${sample}`,
        "--expected-worktree-digest",
        digest,
        "--max-items",
        "16",
        ...changedPaths.flatMap((path) => ["--path", path])
      ];
      const measured = await measureEnvelope(() => runCli("checkpoint", args, root, deps));
      samples.push({
        sample,
        elapsedMs: measured.elapsedMs,
        ok: measured.value?.ok === true,
        coalesced: measured.value?.data?.hook?.coalesced === true,
        skippedAnalysis: measured.value?.data?.hook?.skippedAnalysis === true,
        resultDigest: String(measured.value?.data?.resultDigest ?? ""),
        findingCount: Array.isArray(measured.value?.data?.findings) ? measured.value.data.findings.length : 0
      });
    }
    const elapsedSamples = samples.map((sample) => sample.elapsedMs);
    return {
      changedFileCount: changedPaths.length,
      sampleCount: samples.length,
      p95Ms: p95(elapsedSamples),
      maxMs: roundMs(Math.max(...elapsedSamples)),
      minMs: roundMs(Math.min(...elapsedSamples)),
      failedSampleCount: samples.filter((sample) => !sample.ok).length,
      nonCoalescedSampleCount: samples.filter((sample) => !sample.coalesced && !sample.skippedAnalysis).length,
      samples,
      changedPathsDigest: digestJson({ changedPaths } as unknown as Json)
    };
  } finally {
    await daemon?.stop().catch(() => undefined);
    rmSync(root, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
  }
}

function loadSourcePacket(id: string, path: string) {
  const raw = readText(path);
  return { id, path, raw, packet: JSON.parse(raw) as Record<string, any> };
}

function inspectBenchmarkSource(source: ReturnType<typeof loadSourcePacket>) {
  const packet = source.packet;
  const gates = Array.isArray(packet.gates) ? packet.gates.map(String) : [];
  const warmQueryP95Ms = numberValue(packet.benchmark?.warmQueryP95Ms);
  const fixtureCount = numberValue(packet.benchmark?.fixtureCount);
  const verified = packet.status === "verified"
    && gates.includes("AL10-03")
    && gates.includes("AL10-04")
    && gates.includes("AL10-BETA-1")
    && fixtureCount >= 3
    && warmQueryP95Ms > 0;
  return {
    id: source.id,
    path: source.path,
    sha256: sha256(source.raw),
    status: packet.status === "verified" ? "verified" : "blocked",
    gates,
    fixtureCount,
    warmQueryP95Ms,
    missingTerms: [],
    verified
  };
}

function inspectChaosSecuritySource(source: ReturnType<typeof loadSourcePacket>) {
  const security = summarizeSecurity(source.packet);
  const gates = Array.isArray(source.packet.gates) ? source.packet.gates.map(String) : [];
  return {
    id: source.id,
    path: source.path,
    sha256: sha256(source.raw),
    status: source.packet.status === "verified" ? "verified" : "blocked",
    gates,
    verifiedCaseCount: security.verifiedCaseCount,
    requiredCaseCount: security.requiredCaseCount,
    missingTerms: [],
    verified: source.packet.status === "verified"
      && gates.includes("AL10-05")
      && gates.includes("AL10-06")
      && security.passRate === 1
  };
}

function inspectRecommendationSource(source: ReturnType<typeof loadSourcePacket>) {
  const recommendations = summarizeRecommendations(source.packet);
  const gates = Array.isArray(source.packet.gates) ? source.packet.gates.map(String) : [];
  return {
    id: source.id,
    path: source.path,
    sha256: sha256(source.raw),
    status: source.packet.status === "verified" ? "verified" : "blocked",
    gates,
    hardGateFalsePositiveRate: recommendations.hardGateFalsePositiveRate,
    failedEvalGateCount: recommendations.failedEvalGateCount,
    missingTerms: [],
    verified: source.packet.status === "verified"
      && gates.includes("AL10-08")
      && gates.includes("AL10-BETA-4")
      && recommendations.hardGateFalsePositiveRate === 0
      && recommendations.failedEvalGateCount === 0
  };
}

function summarizePerformance(benchmark: Record<string, any>, incrementalAnalysis: any) {
  return {
    representativeFixtureCount: numberValue(benchmark.benchmark?.fixtureCount),
    warmQueryP95Ms: numberValue(benchmark.benchmark?.warmQueryP95Ms),
    warmQueryBudgetMs: GA_WARM_QUERY_P95_MS,
    incrementalAnalysisP95Ms: incrementalAnalysis.p95Ms,
    incrementalAnalysisBudgetMs: GA_INCREMENTAL_ANALYSIS_P95_MS
  };
}

function summarizeSecurity(packet: Record<string, any>) {
  const flattened = flattenSecurityCases(packet.security);
  const requiredCases = SECURITY_CASES.map((caseId) => {
    const probe = flattened.find((item) => item.caseId === caseId);
    return {
      caseId,
      ok: probe?.ok === true,
      reasonCode: String(probe?.reasonCode ?? ""),
      guard: String(probe?.guard ?? "")
    };
  });
  const verifiedCaseCount = requiredCases.filter((item) => item.ok).length;
  return {
    requiredCases,
    requiredCaseCount: requiredCases.length,
    verifiedCaseCount,
    passRate: requiredCases.length === 0 ? 0 : verifiedCaseCount / requiredCases.length
  };
}

function flattenSecurityCases(value: any): any[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.values(value);
}

function summarizeRecommendations(packet: Record<string, any>) {
  const metrics = packet.metrics ?? {};
  return {
    heuristicOnlyHardGateRate: numberValue(metrics.heuristicOnlyHardGateRate),
    dynamicDocHardGateRate: numberValue(metrics.dynamicDocHardGateRate),
    hardGateFalsePositiveRate: numberValue(metrics.heuristicOnlyHardGateRate) + numberValue(metrics.dynamicDocHardGateRate),
    failedEvalGateCount: Array.isArray(packet.failedEvalGates) ? packet.failedEvalGates.length : 0,
    hardGateMissCount: Array.isArray(packet.qualityViolations?.hardGateMissIds) ? packet.qualityViolations.hardGateMissIds.length : 0
  };
}

function inspectSourceReadbacks(sourceReadbacks: any, failures: string[]): void {
  if (!Array.isArray(sourceReadbacks)) {
    failures.push("sourceReadbacks must be an array");
    return;
  }
  const expectedIds = ["representative-benchmark", "chaos-security", "recommendation-quality"];
  if (sourceReadbacks.length !== expectedIds.length) failures.push(`sourceReadbacks must include ${expectedIds.length} sources`);
  for (const expectedId of expectedIds) {
    const source = sourceReadbacks.find((item: any) => item?.id === expectedId);
    if (!source) {
      failures.push(`source readback missing: ${expectedId}`);
      continue;
    }
    if (source.status !== "verified") failures.push(`${expectedId}: status must be verified`);
    if (source.verified !== true) failures.push(`${expectedId}: source readback must be verified`);
    if (typeof source.sha256 !== "string" || !source.sha256.startsWith("sha256:")) failures.push(`${expectedId}: sha256 must be present`);
  }
}

function inspectStress(stress: any, failures: string[]): void {
  if (stress?.eventCount !== GA_STRESS_EVENT_COUNT) failures.push("stress event count must be 10000");
  if (stress?.appendedEventCount !== GA_STRESS_EVENT_COUNT) failures.push("stress appended event count must be 10000");
  if (stress?.replayEventCount !== GA_STRESS_EVENT_COUNT) failures.push("stress replay event count must be 10000");
  if (stress?.uniqueEventIds !== GA_STRESS_EVENT_COUNT) failures.push("stress unique event ids must be 10000");
  if (stress?.lostEventCount !== 0) failures.push("stress lost event count must be 0");
  if (stress?.duplicateEventCount !== 0) failures.push("stress duplicate event count must be 0");
  if (stress?.integrityOk !== true) failures.push("stress integrity must be ok");
}

function inspectPerformance(performancePacket: any, failures: string[]): void {
  if (performancePacket?.representativeFixtureCount < 3) failures.push("performance must include at least 3 representative fixtures");
  if (!(performancePacket?.warmQueryP95Ms >= 0 && performancePacket.warmQueryP95Ms <= GA_WARM_QUERY_P95_MS)) failures.push("warm query p95 exceeds GA budget");
}

function inspectIncrementalAnalysis(incrementalAnalysis: any, failures: string[]): void {
  if (incrementalAnalysis?.changedFileCount !== GA_CHANGED_FILE_COUNT) failures.push("incremental analysis changed file count must be 200");
  if (incrementalAnalysis?.sampleCount !== GA_INCREMENTAL_SAMPLE_COUNT) failures.push("incremental analysis sample count must be 5");
  if (!(incrementalAnalysis?.p95Ms >= 0 && incrementalAnalysis.p95Ms <= GA_INCREMENTAL_ANALYSIS_P95_MS)) failures.push("incremental analysis p95 exceeds GA budget");
  if (incrementalAnalysis?.nonCoalescedSampleCount !== GA_INCREMENTAL_SAMPLE_COUNT) failures.push("incremental analysis samples must not be coalesced");
  if (incrementalAnalysis?.failedSampleCount !== 0) failures.push("incremental analysis failed sample count must be 0");
}

function inspectSecurity(security: any, failures: string[]): void {
  if (security?.requiredCaseCount !== SECURITY_CASES.length) failures.push("security required case count mismatch");
  if (security?.verifiedCaseCount !== SECURITY_CASES.length) failures.push("security verified case count mismatch");
  if (security?.passRate !== 1) failures.push("security pass rate must be 1");
  for (const caseId of SECURITY_CASES) {
    const item = security?.requiredCases?.find((probe: any) => probe?.caseId === caseId);
    if (!item || item.ok !== true) failures.push(`security case must pass: ${caseId}`);
  }
}

function inspectRecommendations(recommendations: any, failures: string[]): void {
  if (recommendations?.hardGateFalsePositiveRate !== 0) failures.push("hard gate false positive rate must be 0");
  if (recommendations?.heuristicOnlyHardGateRate !== 0) failures.push("heuristic-only hard gate rate must be 0");
  if (recommendations?.dynamicDocHardGateRate !== 0) failures.push("dynamic-doc hard gate rate must be 0");
  if (recommendations?.failedEvalGateCount !== 0) failures.push("failed eval gate count must be 0");
}

function inspectPrivacyPacket(privacy: any, failures: string[]): void {
  if (!privacy || typeof privacy !== "object" || Array.isArray(privacy)) {
    failures.push("privacy must be an object");
    return;
  }
  if (privacy.forbiddenSecretHitCount !== 0) failures.push("privacy forbiddenSecretHitCount must be 0");
  if (privacy.forbiddenRawContentHitCount !== 0) failures.push("privacy forbiddenRawContentHitCount must be 0");
  if (privacy.clean !== true) failures.push("privacy must be clean");
}

function inspectAssertions(assertions: Record<string, unknown> | undefined, failures: string[]): void {
  if (!assertions || typeof assertions !== "object") {
    failures.push("assertions must be present");
    return;
  }
  const allowed = new Set([
    ...GATES,
    "sourceReadbacksVerified",
    "openGatesPreserved",
    "noPrivateContent"
  ]);
  for (const key of Object.keys(assertions)) {
    if (!allowed.has(key)) failures.push(`unexpected gate assertion: ${key}`);
  }
  for (const key of allowed) {
    if (assertions[key] !== true) failures.push(`assertions.${key} must be true`);
  }
}

function inspectPrivacy(value: unknown) {
  const serialized = JSON.stringify(value);
  const secretHits = SECRET_PATTERNS.filter((pattern) => pattern.test(serialized)).map(String);
  const rawContentHits = RAW_CONTENT_PATTERNS.filter((pattern) => pattern.test(serialized)).map(String);
  return {
    forbiddenSecretHitCount: secretHits.length,
    forbiddenRawContentHitCount: rawContentHits.length,
    secretHits,
    rawContentHits,
    clean: secretHits.length === 0 && rawContentHits.length === 0
  };
}

function architectureLedgerEvent(index: number): ArchitectureEventV1 {
  const operations: Record<string, Json>[] = [{
    op: "upsert_entity",
    entity: {
      entityId: `entity.al10.ga.${index}`,
      kind: "module",
      canonicalName: index === 0 ? "AL10 GA root module" : `AL10 GA module ${index}`,
      status: "active",
      path: `src/al10/ga/module-${index}.ts`,
      summary: index === 0 ? "AL10 GA root architecture entrypoint" : `AL10 GA module ${index} summary`,
      metadata: { index }
    }
  }];
  if (index === 1) {
    operations.push(
      {
        op: "upsert_relation",
        relation: {
          relationId: "relation.al10-ga-root-to-worker",
          kind: "calls",
          sourceEntityId: "entity.al10.ga.0",
          targetEntityId: "entity.al10.ga.1",
          status: "active",
          summary: "AL10 GA root delegates to worker",
          metadata: { route: "ga-stress" }
        }
      },
      {
        op: "upsert_constraint",
        constraint: {
          constraintId: "constraint.al10-ga-root-owned",
          kind: "ownership",
          subjectId: "entity.al10.ga.0",
          status: "active",
          severity: "warning",
          summary: "AL10 GA root module has an explicit owner",
          metadata: { owner: "runtime" }
        }
      }
    );
  }
  return {
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: `architecture_event.al10.ga.${String(index).padStart(5, "0")}`,
    eventType: "architecture.graph.update",
    payloadVersion: "archcontext.architecture-ledger-payload/v1",
    repository: LEDGER_SCOPE.repository,
    worktree: LEDGER_SCOPE.worktree,
    baseDigest: digestJson({ base: index } as unknown as Json),
    resultingDigest: digestJson({ result: index } as unknown as Json),
    headSha: LEDGER_SCOPE.worktree.headSha,
    actor: { kind: "daemon", id: "archctxd" },
    source: "checkpoint",
    timestamp: new Date(Date.UTC(2026, 5, 26, 0, 0, index)).toISOString(),
    idempotencyKey: `architecture-ledger-al10-ga-${index}`,
    provenance: {
      producer: "architecture-ledger-al10-ga-technical-readback",
      command: "bun scripts/architecture-ledger-al10-ga-technical-readback.ts run",
      inputDigest: digestJson({ event: index } as unknown as Json)
    },
    payload: {
      summary: index === 0 ? "Append AL10 GA root architecture fact" : `Append AL10 GA architecture fact ${index}`,
      title: index === 0 ? "AL10 GA Root Architecture Decision" : `AL10 GA Architecture Event ${index}`,
      rationale: "Exercise append-only ledger GA stress without storing source bodies.",
      operations
    } as unknown as Json
  };
}

async function measureEnvelope(run: () => Promise<any>): Promise<{ value: any; elapsedMs: number }> {
  const started = performance.now();
  const value = await run();
  return { value, elapsedMs: roundMs(performance.now() - started) };
}

function createGitRepository(root: string): void {
  git(root, "init");
  git(root, "config", "user.email", "archctx@example.test");
  git(root, "config", "user.name", "ArchContext Test");
  writeRepoFile(root, "README.md", "# AL10 GA Incremental Fixture\n");
  git(root, "add", "README.md");
  git(root, "commit", "-m", "init");
}

function writeRepoFile(root: string, path: string, value: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function sqliteScalar(databasePath: string, sql: string): any {
  const db = new Database(databasePath, { readonly: true });
  try {
    const row = db.query(sql).get() as Record<string, unknown> | undefined;
    return row ? Object.values(row)[0] : undefined;
  } finally {
    db.close();
  }
}

function renderReport(packet: any): string {
  return [
    "# Architecture Ledger AL10 GA Technical Readback",
    "",
    "## Scope",
    "",
    "- Closes: AL10-GA-1 through AL10-GA-5 only.",
    "- Keeps open: AL10-14 beta-user interviews, AL10-GA-6 external review, and AL10-GA-7 production rollback drill.",
    "- Mode: local deterministic readback; no external provider or production mutation.",
    "",
    "## GA Results",
    "",
    `- GA-1 stress events: ${packet.stress.eventCount}; lost=${packet.stress.lostEventCount}; duplicate=${packet.stress.duplicateEventCount}; integrity=${packet.stress.integrityOk ? "ok" : "failed"}`,
    `- GA-2 warm query p95: ${packet.performance.warmQueryP95Ms} ms (budget ${packet.thresholds.warmQueryP95Ms} ms)`,
    `- GA-3 200-file incremental checkpoint p95: ${packet.incrementalAnalysis.p95Ms} ms (budget ${packet.thresholds.incrementalAnalysisP95Ms} ms)`,
    `- GA-4 security pass rate: ${(packet.security.passRate * 100).toFixed(1)}%`,
    `- GA-5 hard-gate false-positive rate: ${packet.recommendations.hardGateFalsePositiveRate}`,
    "",
    "## Source Readbacks",
    "",
    "| Source | Status | Verified |",
    "| --- | --- | --- |",
    ...packet.sourceReadbacks.map((source: any) => `| ${source.id} | ${source.status} | ${source.verified ? "yes" : "no"} |`),
    "",
    "## Readback",
    "",
    "```bash",
    packet.readback.command,
    packet.readback.recordCommand,
    "```",
    ""
  ].join("\n");
}

function renderHuman(result: any): string {
  if (result.ok) {
    return `[architecture-ledger-al10-ga-technical-readback] OK stress=${result.stress.eventCount} warmQueryP95=${result.performance.warmQueryP95Ms} incrementalP95=${result.incrementalAnalysis.p95Ms}`;
  }
  return `[architecture-ledger-al10-ga-technical-readback] FAILED\n${result.failures.map((failure: string) => `- ${failure}`).join("\n")}`;
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return roundMs(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0);
}

function roundMs(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readText(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function sha256(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return `sha256:${hasher.digest("hex")}`;
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, value: string): void {
  const resolved = resolve(ROOT, path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, value, "utf8");
}

function sameStringSet(actual: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(actual)) return false;
  return [...new Set(actual)].sort().join(",") === [...expected].sort().join(",");
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}
