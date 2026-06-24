#!/usr/bin/env bun
import { performance } from "node:perf_hooks";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { practiceCatalogEnvelope, loadPracticeCatalog } from "@archcontext/core/practice-catalog";
import { matchPracticesForTask } from "@archcontext/core/practice-engine";
import { detectArchitecturePressure } from "@archcontext/core/pressure-engine";
import { digestJson, type Json, type NormalizedCodeContext } from "@archcontext/contracts";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import {
  inspectLegacyLocalStoreMigration,
  migrateLegacyLocalStoreIfNeeded,
  runtimeStatePaths,
  SqliteLocalStore
} from "@archcontext/local-runtime/local-store-sqlite";
import { createStartedDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";

const DEFAULT_EVIDENCE = "docs/verification/practice-assets-s6-runtime-readback.json";
const PACKET_SCHEMA_VERSION = "archcontext.practice-assets-s6-runtime-readback/v1";
const SYNTHETIC_PRACTICE_COUNT = 100;
const DEFAULT_SAMPLES = 12;
const THRESHOLDS = {
  catalogWarmP95Ms: 50,
  matchingWarmP95Ms: 150,
  checkpointWarmP95Ms: 250
} as const;
const RUNTIME_TASK = "remove legacy v1 wrapper and preserve API compatibility";

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[practice-assets-s6-runtime-readback] usage: run|inspect [--out path] [--evidence path] [--json] [--samples n]");
    process.exit(2);
  }

  const result = command === "run"
    ? await runPracticeAssetsS6RuntimeReadback({
      root: process.cwd(),
      outPath: readFlag(args, "--out") ?? readFlag(args, "--evidence") ?? DEFAULT_EVIDENCE,
      samples: Number(readFlag(args, "--samples") ?? DEFAULT_SAMPLES)
    })
    : inspectPracticeAssetsS6RuntimeReadbackFile({
      root: process.cwd(),
      evidencePath: readFlag(args, "--evidence") ?? readFlag(args, "--out") ?? DEFAULT_EVIDENCE
    });

  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`[practice-assets-s6-runtime-readback] OK catalog=${result.catalogWarmP95Ms}ms matching=${result.matchingWarmP95Ms}ms checkpoint=${result.checkpointWarmP95Ms}ms`);
  } else {
    console.error("[practice-assets-s6-runtime-readback] FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
  }
  if (!result.ok) process.exit(1);
}

export async function runPracticeAssetsS6RuntimeReadback({
  root = process.cwd(),
  outPath = DEFAULT_EVIDENCE,
  samples = DEFAULT_SAMPLES
}: {
  root?: string;
  outPath?: string;
  samples?: number;
} = {}) {
  const packet = await buildPracticeAssetsS6RuntimeReadbackPacket({ samples });
  const resolvedOut = resolve(root, outPath);
  mkdirSync(dirname(resolvedOut), { recursive: true });
  writeFileSync(resolvedOut, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  return inspectPracticeAssetsS6RuntimeReadback(packet);
}

export function inspectPracticeAssetsS6RuntimeReadbackFile({
  root = process.cwd(),
  evidencePath = DEFAULT_EVIDENCE
}: {
  root?: string;
  evidencePath?: string;
} = {}) {
  const packet = JSON.parse(readFileSync(resolve(root, evidencePath), "utf8"));
  return inspectPracticeAssetsS6RuntimeReadback(packet);
}

export async function buildPracticeAssetsS6RuntimeReadbackPacket({
  samples = DEFAULT_SAMPLES
}: {
  samples?: number;
} = {}) {
  const perfRoot = mkdtempSync(join(tmpdir(), "archctx-s6-runtime-perf-"));
  try {
    writeFixtureRepo(perfRoot);
    writeSyntheticPracticeOverlays(perfRoot, SYNTHETIC_PRACTICE_COUNT);
    const performanceReadback = await measureRuntimePerformance(perfRoot, samples);
    const catalogCorruption = buildCatalogCorruptionReadback();
    const sqliteCorruption = buildSqliteCorruptionReadback();
    const migration = await buildMigrationReadback();
    const staleCatalog = await buildStaleCatalogReadback();
    const assertions = {
      catalogWarmP95WithinLimit: performanceReadback.p95.catalogWarmMs <= THRESHOLDS.catalogWarmP95Ms,
      matchingWarmP95WithinLimit: performanceReadback.p95.matchingWarmMs <= THRESHOLDS.matchingWarmP95Ms,
      checkpointWarmP95WithinLimit: performanceReadback.p95.checkpointWarmMs <= THRESHOLDS.checkpointWarmP95Ms,
      checkpointNoNetwork: performanceReadback.checkpointNoNetwork === true,
      catalogCorruptionTypedRecovery: catalogCorruption.typed === true && catalogCorruption.recovered === true,
      sqliteCorruptionTypedRecovery: sqliteCorruption.typed === true && sqliteCorruption.silentDataError === false,
      sqliteMigrationForwardAndBackwardCompatible: migration.forwardStatus === "migrated" && migration.unknownTableIgnored === true,
      staleCatalogDetected: staleCatalog.reasonCode === "stale-catalog" && staleCatalog.fresh === false
    };
    return {
      schemaVersion: PACKET_SCHEMA_VERSION,
      status: Object.values(assertions).every(Boolean) ? "verified" : "failed",
      generatedAt: new Date().toISOString(),
      thresholds: THRESHOLDS,
      summary: {
        syntheticPracticeCount: SYNTHETIC_PRACTICE_COUNT,
        effectivePracticeCount: performanceReadback.effectivePracticeCount,
        samples,
        catalogDigest: performanceReadback.catalogDigest
      },
      performance: performanceReadback,
      reliability: {
        catalogCorruption,
        sqliteCorruption,
        migration,
        staleCatalog
      },
      assertions,
      readback: {
        command: `bun scripts/practice-assets-s6-runtime-readback.ts inspect --evidence ${DEFAULT_EVIDENCE} --json`
      }
    };
  } finally {
    removeTempDir(perfRoot);
  }
}

export function inspectPracticeAssetsS6RuntimeReadback(packet: any) {
  const failures: string[] = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return failureResult(["packet must be an object"]);
  }

  if (packet.schemaVersion !== PACKET_SCHEMA_VERSION) failures.push(`schemaVersion must be ${PACKET_SCHEMA_VERSION}`);
  if (packet.status !== "verified") failures.push("status must be verified");

  const summary = packet.summary ?? {};
  if (summary.syntheticPracticeCount < 100) failures.push("summary.syntheticPracticeCount must be at least 100");
  if (summary.effectivePracticeCount < 100) failures.push("summary.effectivePracticeCount must be at least 100");
  if (!String(summary.catalogDigest ?? "").startsWith("sha256:")) failures.push("summary.catalogDigest must be present");

  const thresholds = packet.thresholds ?? {};
  const performanceReadback = packet.performance ?? {};
  const p95 = performanceReadback.p95 ?? {};
  inspectP95("catalogWarmMs", p95.catalogWarmMs, thresholds.catalogWarmP95Ms, failures);
  inspectP95("matchingWarmMs", p95.matchingWarmMs, thresholds.matchingWarmP95Ms, failures);
  inspectP95("checkpointWarmMs", p95.checkpointWarmMs, thresholds.checkpointWarmP95Ms, failures);
  if (performanceReadback.checkpointNoNetwork !== true) failures.push("performance.checkpointNoNetwork must be true");

  const reliability = packet.reliability ?? {};
  if (reliability.catalogCorruption?.typed !== true) failures.push("reliability.catalogCorruption.typed must be true");
  if (reliability.catalogCorruption?.recovered !== true) failures.push("reliability.catalogCorruption.recovered must be true");
  if (reliability.sqliteCorruption?.typed !== true) failures.push("reliability.sqliteCorruption.typed must be true");
  if (reliability.sqliteCorruption?.silentDataError !== false) failures.push("reliability.sqliteCorruption.silentDataError must be false");
  if (reliability.migration?.forwardStatus !== "migrated") failures.push("reliability.migration.forwardStatus must be migrated");
  if (reliability.migration?.postInspectStatus !== "target-current") failures.push("reliability.migration.postInspectStatus must be target-current");
  if (reliability.migration?.unknownTableIgnored !== true) failures.push("reliability.migration.unknownTableIgnored must be true");
  if (reliability.staleCatalog?.reasonCode !== "stale-catalog") failures.push("reliability.staleCatalog.reasonCode must be stale-catalog");
  if (reliability.staleCatalog?.fresh !== false) failures.push("reliability.staleCatalog.fresh must be false");
  if (reliability.staleCatalog?.previousCatalogDigest === reliability.staleCatalog?.catalogDigest) {
    failures.push("reliability.staleCatalog previous/current digest must differ");
  }
  inspectAssertions(packet.assertions, failures);

  return {
    ok: failures.length === 0,
    schemaVersion: PACKET_SCHEMA_VERSION,
    catalogWarmP95Ms: p95.catalogWarmMs,
    matchingWarmP95Ms: p95.matchingWarmMs,
    checkpointWarmP95Ms: p95.checkpointWarmMs,
    failures
  };
}

async function measureRuntimePerformance(root: string, samples: number) {
  loadPracticeCatalog({ root });
  const catalogWarmMs: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    catalogWarmMs.push(await measure(() => loadPracticeCatalog({ root })));
  }
  const catalog = loadPracticeCatalog({ root });
  const codeContext = syntheticCodeContext();
  const pressure = detectArchitecturePressure({
    task: RUNTIME_TASK,
    symbols: codeContext.symbols.map((symbol) => `${symbol.id} ${symbol.name} ${symbol.kind} ${symbol.path}`),
    files: [...new Set(codeContext.symbols.map((symbol) => symbol.path))],
    edges: codeContext.edges,
    observedEvidence: codeContext.evidence
  });
  matchPracticesForTask({ task: RUNTIME_TASK, catalog, codeContext, pressure, maxMatches: 5 });
  const matchingWarmMs: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    matchingWarmMs.push(await measure(() => matchPracticesForTask({ task: RUNTIME_TASK, catalog, codeContext, pressure, maxMatches: 5 })));
  }

  const daemon = await createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
  const checkpointWarmMs: number[] = [];
  const checkpointHooks: Array<{ egress?: unknown; network?: unknown; coalesced?: unknown }> = [];
  try {
    await daemon.init(root, "S6 Runtime Performance");
    await daemon.prepare(root, RUNTIME_TASK, 12_288, 5, "task_s6_runtime_perf");
    for (let index = 0; index < samples; index += 1) {
      const elapsed = await measure(async () => {
        const result = await daemon.checkpoint(root, {
          taskSessionId: "task_s6_runtime_perf",
          event: "post-edit",
          changedPaths: ["src/billing/legacy-wrapper-v1.ts"],
          toolCallId: `perf_${index}`,
          maxItems: 5
        });
        checkpointHooks.push((result.data as any).hook ?? {});
      });
      checkpointWarmMs.push(elapsed);
    }
  } finally {
    await daemon.stop();
  }

  return {
    catalogDigest: catalog.catalogDigest,
    effectivePracticeCount: catalog.effectiveAssets.length,
    samples: {
      catalogWarmMs,
      matchingWarmMs,
      checkpointWarmMs
    },
    p95: {
      catalogWarmMs: p95(catalogWarmMs),
      matchingWarmMs: p95(matchingWarmMs),
      checkpointWarmMs: p95(checkpointWarmMs)
    },
    checkpointNoNetwork: checkpointHooks.length === samples
      && checkpointHooks.every((hook) => hook.egress === "none" && hook.network === "forbidden"),
    checkpointCoalescedCount: checkpointHooks.filter((hook) => hook.coalesced === true).length
  };
}

function buildCatalogCorruptionReadback() {
  const root = mkdtempSync(join(tmpdir(), "archctx-s6-catalog-corrupt-"));
  try {
    writeFixtureRepo(root);
    const overlayPath = join(root, ".archcontext/practices/corrupt.json");
    mkdirSync(dirname(overlayPath), { recursive: true });
    writeFileSync(overlayPath, "{", "utf8");
    const corrupted = practiceCatalogEnvelope(root, { action: "validate", strict: true });
    const data = corrupted.data as any;
    unlinkSync(overlayPath);
    const recovered = loadPracticeCatalog({ root });
    const issueCodes = [...(data?.errors ?? []), ...(data?.warnings ?? [])].map((issue: any) => String(issue.code ?? ""));
    return {
      typed: corrupted.ok === true && data?.valid === false && issueCodes.includes("practice-yaml-parse-failed"),
      issueCodes,
      recovered: recovered.errors.length === 0,
      silentDataError: data?.valid === true
    };
  } finally {
    removeTempDir(root);
  }
}

function buildSqliteCorruptionReadback() {
  const root = mkdtempSync(join(tmpdir(), "archctx-s6-sqlite-corrupt-"));
  const env = stateEnv(mkdtempSync(join(tmpdir(), "archctx-s6-sqlite-state-")));
  try {
    writeFixtureRepo(root);
    const paths = runtimeStatePaths(root, env);
    mkdirSync(dirname(paths.localStorePath), { recursive: true });
    writeFileSync(paths.localStorePath, "not sqlite", "utf8");
    const inspected = inspectLegacyLocalStoreMigration(root, env);
    let migrateError = "";
    try {
      migrateLegacyLocalStoreIfNeeded(root, env);
    } catch (error) {
      migrateError = error instanceof Error ? error.message : String(error);
    }
    return {
      status: inspected.status,
      typed: inspected.status === "target-incomplete" && inspected.integrityCheck.target === "failed",
      recoveryAction: migrateError.includes("not a valid SQLite database") ? "repair-or-delete-corrupt-target" : "unknown",
      migrateError: sanitizeRuntimePath(migrateError),
      silentDataError: inspected.status === "target-current" || migrateError.length === 0
    };
  } finally {
    removeTempDir(root);
    removeTempDir(env.ARCHCONTEXT_STATE_DIR ?? "");
  }
}

async function buildMigrationReadback() {
  const root = mkdtempSync(join(tmpdir(), "archctx-s6-migration-"));
  const env = stateEnv(mkdtempSync(join(tmpdir(), "archctx-s6-migration-state-")));
  try {
    writeFixtureRepo(root);
    const paths = runtimeStatePaths(root, env);
    mkdirSync(dirname(paths.legacyLocalStorePath), { recursive: true });
    await createLegacySqlite(paths.legacyLocalStorePath);
    const preInspect = inspectLegacyLocalStoreMigration(root, env);
    const migrated = migrateLegacyLocalStoreIfNeeded(root, env);
    await createUnknownFutureTable(paths.localStorePath);
    const store = new SqliteLocalStore(paths.localStorePath);
    await store.migrate();
    store.close();
    const postInspect = inspectLegacyLocalStoreMigration(root, env);
    return {
      preInspectStatus: preInspect.status,
      forwardStatus: migrated.status,
      migrated: migrated.migrated,
      postInspectStatus: postInspect.status,
      targetIntegrity: postInspect.integrityCheck.target,
      unknownTableIgnored: postInspect.status === "target-current",
      markerWritten: migrated.markerPath.endsWith("runtime.sqlite.migration.json"),
      markerFile: "runtime.sqlite.migration.json"
    };
  } finally {
    removeTempDir(root);
    removeTempDir(env.ARCHCONTEXT_STATE_DIR ?? "");
  }
}

async function buildStaleCatalogReadback() {
  const root = mkdtempSync(join(tmpdir(), "archctx-s6-stale-catalog-"));
  const store = new TestLocalStore();
  let first: Awaited<ReturnType<typeof createStartedDaemon>> | undefined;
  let second: Awaited<ReturnType<typeof createStartedDaemon>> | undefined;
  try {
    writeFixtureRepo(root);
    first = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: store
    });
    await first.init(root, "S6 Stale Catalog");
    await first.prepare(root, RUNTIME_TASK, 12_288, 5, "task_s6_stale_catalog");
    await first.stop();
    first = undefined;

    const key = `practice-checkpoint:${repositoryFingerprint(root)}:task_s6_stale_catalog`;
    const state = store.taskStates.get(key) as any;
    const previousCatalogDigest = `sha256:${"9".repeat(64)}`;
    store.taskStates.set(key, {
      ...state,
      snapshot: {
        ...state.snapshot,
        catalogDigest: previousCatalogDigest
      }
    });

    second = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: store
    });
    const checkpoint = await second.checkpoint(root, {
      taskSessionId: "task_s6_stale_catalog",
      event: "post-edit",
      changedPaths: ["src/billing/legacy-wrapper-v1.ts"],
      maxItems: 5
    });
    const data = checkpoint.data as any;
    return {
      ok: checkpoint.ok === true,
      fresh: data.fresh,
      reasonCode: data.reasonCode,
      staleReasons: data.staleReasons,
      previousCatalogDigest: data.previousCatalogDigest,
      catalogDigest: data.catalogDigest,
      worktreeDigest: data.worktreeDigest,
      expectedWorktreeDigest: data.expectedWorktreeDigest,
      persistedBaselineKey: key
    };
  } finally {
    await first?.stop();
    await second?.stop();
    removeTempDir(root);
  }
}

function syntheticCodeContext(): NormalizedCodeContext {
  const symbols = [
    { id: "symbol.legacyWrapperV1", name: "legacyWrapperV1", kind: "public-api", path: "src/billing/legacy-wrapper-v1.ts" },
    { id: "symbol.fallbackMapperV2", name: "fallbackMapperV2", kind: "public-api", path: "src/billing/fallback-mapper-v2.ts" },
    { id: "symbol.billingApiContract", name: "billingApiContract", kind: "schema", path: "schemas/billing/api-contract.json" },
    { id: "symbol.auditLogger", name: "auditLogger", kind: "service", path: "src/observability/audit-logger.ts" }
  ];
  const edges = [
    { source: "symbol.legacyWrapperV1", target: "symbol.fallbackMapperV2", kind: "imports" as const, confidence: "high" as const },
    { source: "symbol.fallbackMapperV2", target: "symbol.billingApiContract", kind: "reads" as const, confidence: "high" as const }
  ];
  const evidence = [
    {
      id: "evidence.s6-runtime-contract",
      selector: { path: "src/billing/legacy-wrapper-v1.ts", symbolId: "symbol.legacyWrapperV1" },
      summary: "verified compatibility path",
      confidence: "verified" as const,
      snapshot: {
        repositoryId: "repo.s6-runtime",
        headSha: "abc",
        worktreeDigest: `sha256:${"8".repeat(64)}`
      }
    }
  ];
  return {
    task: RUNTIME_TASK,
    symbols,
    edges,
    evidence,
    digest: digestJson({ task: RUNTIME_TASK, symbols, edges } as unknown as Json)
  };
}

function writeFixtureRepo(root: string): void {
  mkdirSync(join(root, "src/billing"), { recursive: true });
  mkdirSync(join(root, "schemas/billing"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# S6 runtime fixture\n", "utf8");
  writeFileSync(join(root, "package.json"), "{\"name\":\"s6-runtime-fixture\"}\n", "utf8");
  writeFileSync(join(root, "src/billing/legacy-wrapper-v1.ts"), "export const legacyWrapperV1 = true;\n", "utf8");
  writeFileSync(join(root, "src/billing/fallback-mapper-v2.ts"), "export const fallbackMapperV2 = true;\n", "utf8");
  writeFileSync(join(root, "schemas/billing/api-contract.json"), "{\"version\":\"v1\"}\n", "utf8");
}

function writeSyntheticPracticeOverlays(root: string, count: number): void {
  const dir = join(root, ".archcontext/practices/s6-runtime");
  mkdirSync(dir, { recursive: true });
  const categories = ["api", "compatibility", "modularity", "data", "observability", "security", "migration", "ownership", "supply-chain", "decisions"];
  const predicates = ["public-api-changed", "runtime-boundary-added", "policy-or-contract-changed", "parallel-public-api-observed"] as const;
  for (let index = 0; index < count; index += 1) {
    const category = categories[index % categories.length];
    const predicate = predicates[index % predicates.length];
    const asset = {
      schemaVersion: "archcontext.practice/v1",
      id: `s6-runtime.synthetic-${String(index + 1).padStart(3, "0")}`,
      revision: 1,
      status: "active",
      title: `S6 synthetic runtime practice ${index + 1}`,
      summary: `Synthetic ${category} practice used to prove 100 asset catalog and matching runtime gates.`,
      category,
      tags: ["s6", "runtime", category],
      appliesTo: {
        repositoryKinds: ["application", "service", "library"],
        languages: [],
        frameworks: [],
        pathGlobs: ["src/**", "packages/**", "schemas/**"],
        nodeKinds: ["public-api", "service", "module", "schema"],
        negativePathGlobs: ["docs/**", "test/**", "tests/**"]
      },
      triggers: {
        candidateTerms: ["legacy", "wrapper", "api", "contract", category],
        pressureSignals: ["contract-after-implementation", "compatibility-path"],
        structuralPredicates: [predicate]
      },
      evidencePolicy: {
        minimumStrengthForRecommendation: "declared",
        minimumStrengthForCheckpoint: "observed",
        minimumStrengthForEnforcement: "observed",
        requiredKindsForEnforcement: ["path", "symbol", "test"],
        maxEnforcementWhenOnlyHeuristic: "advisory"
      },
      guidance: {
        questions: ["Which boundary changed?", "What evidence proves compatibility?"],
        preferred: ["Keep the contract and implementation in the same reviewable slice."],
        avoid: ["Relying on keyword-only guidance."]
      },
      checks: [{
        checkId: "required-test-evidence",
        mode: "deterministic",
        parameters: { scope: "s6-runtime" }
      }],
      enforcement: {
        default: "advisory",
        promotableTo: "checkpoint",
        repoOptInRequired: true
      },
      provenance: {
        sourceKind: "archcontext-native",
        sourceRefs: [{ sourceId: "archcontext.adr.0012" }],
        curator: "archcontext-maintainers",
        reviewedAt: "2026-06-24"
      },
      lifecycle: {
        introducedAt: "2026-06-24",
        reviewAfter: "2027-06-24",
        supersedes: []
      }
    };
    writeFileSync(join(dir, `${asset.id}.json`), `${JSON.stringify(asset, null, 2)}\n`, "utf8");
  }
}

async function createLegacySqlite(path: string): Promise<void> {
  const { Database } = await import("bun:sqlite");
  const db = new Database(path);
  try {
    db.exec("CREATE TABLE legacy_sessions (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL)");
    db.query("INSERT INTO legacy_sessions (id, payload_json) VALUES (?, ?)").run("legacy", "{}");
  } finally {
    db.close();
  }
}

async function createUnknownFutureTable(path: string): Promise<void> {
  const { Database } = await import("bun:sqlite");
  const db = new Database(path);
  try {
    db.exec("CREATE TABLE IF NOT EXISTS future_daemon_table (id TEXT PRIMARY KEY)");
    db.query("INSERT OR IGNORE INTO future_daemon_table (id) VALUES (?)").run("future");
  } finally {
    db.close();
  }
}

async function measure(operation: () => unknown): Promise<number> {
  const started = performance.now();
  await operation();
  return Number((performance.now() - started).toFixed(3));
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function stateEnv(stateRoot: string): Record<string, string | undefined> {
  return { ...process.env, ARCHCONTEXT_STATE_DIR: stateRoot, ARCHCONTEXT_LOCAL_STORE_PATH: undefined };
}

function sanitizeRuntimePath(message: string): string {
  return message.replace(/: .*[\\/]runtime\.sqlite/g, ": <runtime.sqlite>");
}

function inspectP95(name: string, value: unknown, threshold: unknown, failures: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    failures.push(`performance.p95.${name} must be a number`);
    return;
  }
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
    failures.push(`thresholds.${name.replace(/Ms$/, "P95Ms")} must be a number`);
    return;
  }
  if (value > threshold) failures.push(`performance.p95.${name} ${value}ms exceeds ${threshold}ms`);
}

function inspectAssertions(assertions: any, failures: string[]): void {
  if (!assertions || typeof assertions !== "object") {
    failures.push("assertions must be an object");
    return;
  }
  for (const [key, value] of Object.entries(assertions)) {
    if (value !== true) failures.push(`assertions.${key} must be true`);
  }
}

function failureResult(failures: string[]) {
  return {
    ok: false,
    schemaVersion: PACKET_SCHEMA_VERSION,
    catalogWarmP95Ms: undefined,
    matchingWarmP95Ms: undefined,
    checkpointWarmP95Ms: undefined,
    failures
  };
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function removeTempDir(path: string): void {
  if (!path) return;
  rmSync(path, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
}
