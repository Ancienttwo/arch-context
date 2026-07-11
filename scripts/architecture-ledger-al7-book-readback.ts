#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { digestJson, type Json } from "@archcontext/contracts";
import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import {
  diffArchitectureLedgerBookStates,
  emptyArchitectureLedgerEvidenceState,
  planYamlToArchitectureLedgerImport,
  queryArchitectureLedgerBook,
  queryArchitectureLedgerBookEvidence,
  queryArchitectureLedgerBookNeighbors,
  queryArchitectureLedgerBookRecommendations,
  queryArchitectureLedgerBookTimeline,
  replayArchitectureLedgerEvidenceState,
  type ArchitectureLedgerModelFile,
  type ArchitectureLedgerScope
} from "@archcontext/core/architecture-ledger";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { createStartedDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { runCli } from "@archcontext/surfaces/cli";
import { McpLocalServer } from "@archcontext/surfaces/mcp-local";

const ROOT = resolve(import.meta.dir, "..");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al7-book-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al7-book-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al7-benchmark-privacy.md";
const DEFAULT_SAMPLE_COUNT = 24;
const WARM_QUERY_P95_THRESHOLD_MS = 300;
const RAW_SOURCE_SENTINEL = "AL7_RAW_SOURCE_SENTINEL_do_not_emit_source_body";
const FORBIDDEN_KEYS = new Set(["body", "sourceCode", "sourceBody", "rawSource", "rawDiff", "prompt", "completion"]);

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[architecture-ledger-al7-book-readback] usage: run|inspect [--out path] [--report path] [--evidence path] [--json] [--samples n]");
    process.exit(2);
  }
  const result = command === "run"
    ? await runArchitectureLedgerAl7BookReadback({
        outPath: readFlag(args, "--out") ?? DEFAULT_OUT,
        reportPath: readFlag(args, "--report") ?? DEFAULT_REPORT,
        sampleCount: Number(readFlag(args, "--samples") ?? DEFAULT_SAMPLE_COUNT)
      })
    : inspectArchitectureLedgerAl7BookReadback(
        JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
      );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export async function runArchitectureLedgerAl7BookReadback({
  outPath = DEFAULT_OUT,
  reportPath = DEFAULT_REPORT,
  sampleCount = DEFAULT_SAMPLE_COUNT
} = {}) {
  const packet = await buildArchitectureLedgerAl7BookReadbackPacket({ sampleCount });
  const inspected = inspectArchitectureLedgerAl7BookReadback(packet);
  const finalPacket = {
    ...packet,
    status: inspected.ok ? "verified" : "blocked",
    failures: inspected.failures
  };
  const finalInspection = inspectArchitectureLedgerAl7BookReadback(finalPacket);
  const absoluteOut = resolve(ROOT, outPath);
  const absoluteReport = resolve(ROOT, reportPath);
  mkdirSync(dirname(absoluteOut), { recursive: true });
  mkdirSync(dirname(absoluteReport), { recursive: true });
  writeFileSync(absoluteOut, `${JSON.stringify(finalPacket, null, 2)}\n`, "utf8");
  writeFileSync(absoluteReport, renderReport(finalPacket), "utf8");
  return finalInspection;
}

export async function buildArchitectureLedgerAl7BookReadbackPacket({
  sampleCount = DEFAULT_SAMPLE_COUNT
} = {}) {
  const benchmark = ["small", "medium", "large"].map((size) => buildBenchmarkFixture(size as FixtureSize, sampleCount));
  const runtime = await buildRuntimeReadback();
  const privacyStrings = [
    ...benchmark.flatMap((fixture) => fixture.privacy.forbiddenStrings),
    ...runtime.privacy.forbiddenStrings
  ];
  const assertions = {
    "AL7-14": benchmark.length === 3 && benchmark.every((fixture) => fixture.assertions.coldMeasured && fixture.assertions.warmMeasured),
    "AL7-15": benchmark.every((fixture) => fixture.privacy.noRawSourceBody && fixture.privacy.noForbiddenKeys)
      && runtime.privacy.noRawSourceBody
      && runtime.privacy.noForbiddenKeys,
    "AL7-EG1": benchmark.every((fixture) => fixture.warmQueryP95Ms <= WARM_QUERY_P95_THRESHOLD_MS),
    "AL7-EG2": runtime.freshnessProvenance.allRuntimeResponsesHaveFreshnessAndProvenance,
    "AL7-EG3": benchmark.every((fixture) => fixture.bookOutputAcceptance.changedWhyDependsRiskAnswerable),
    "AL7-EG4": runtime.cliMcpEquivalence.every((entry) => entry.equivalent)
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status: Object.values(assertions).every(Boolean) ? "verified" : "blocked",
    thresholds: {
      warmQueryP95Ms: WARM_QUERY_P95_THRESHOLD_MS,
      sampleCount
    },
    benchmark,
    runtime,
    privacy: {
      forbiddenStrings: [...new Set(privacyStrings)].sort(),
      noRawSourceBody: benchmark.every((fixture) => fixture.privacy.noRawSourceBody) && runtime.privacy.noRawSourceBody,
      noForbiddenKeys: benchmark.every((fixture) => fixture.privacy.noForbiddenKeys) && runtime.privacy.noForbiddenKeys,
      allowedFields: ["id", "kind", "summary", "selector", "digest", "freshness", "provenance", "reasonCodes"]
    },
    assertions,
    readback: {
      command: `bun scripts/architecture-ledger-al7-book-readback.ts inspect --evidence ${DEFAULT_OUT} --json`,
      reportPath: DEFAULT_REPORT
    },
    failures: [] as string[]
  };
}

export function inspectArchitectureLedgerAl7BookReadback(packet: any) {
  const failures: string[] = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return { ok: false, schemaVersion: SCHEMA_VERSION, failures: ["packet must be an object"], gates: {} };
  }
  if (packet.schemaVersion !== SCHEMA_VERSION) failures.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (packet.status !== "verified") failures.push("status must be verified");
  if (packet.thresholds?.warmQueryP95Ms !== WARM_QUERY_P95_THRESHOLD_MS) failures.push("warm query p95 threshold must be 300 ms");
  if (!(Number.isInteger(packet.thresholds?.sampleCount) && packet.thresholds.sampleCount >= 5)) failures.push("sampleCount must be >= 5");

  const fixtures = Array.isArray(packet.benchmark) ? packet.benchmark : [];
  const fixtureNames = fixtures.map((fixture: any) => fixture.name).sort();
  if (fixtureNames.join(",") !== "large,medium,small") failures.push("benchmark must include small, medium and large fixtures");
  for (const fixture of fixtures) {
    if (!(fixture.coldQueryMs >= 0)) failures.push(`${fixture.name}: coldQueryMs must be measured`);
    if (!(fixture.warmQueryP95Ms >= 0 && fixture.warmQueryP95Ms <= WARM_QUERY_P95_THRESHOLD_MS)) failures.push(`${fixture.name}: warmQueryP95Ms must be <= 300`);
    if (fixture.assertions?.queryReturnsExpectedSubject !== true) failures.push(`${fixture.name}: query must return expected subject`);
    if (fixture.assertions?.diffCarriesReasonCodes !== true) failures.push(`${fixture.name}: diff must carry reason codes`);
    if (fixture.privacy?.noRawSourceBody !== true) failures.push(`${fixture.name}: raw source sentinel leaked`);
    if (fixture.privacy?.noForbiddenKeys !== true) failures.push(`${fixture.name}: forbidden response key present`);
    if (fixture.bookOutputAcceptance?.changedWhyDependsRiskAnswerable !== true) failures.push(`${fixture.name}: acceptance answer is not supported by Book output`);
  }

  const runtime = packet.runtime ?? {};
  if (runtime.freshnessProvenance?.allRuntimeResponsesHaveFreshnessAndProvenance !== true) failures.push("runtime responses must carry freshness and provenance");
  if (!Array.isArray(runtime.cliMcpEquivalence) || runtime.cliMcpEquivalence.length < 4) failures.push("CLI/MCP equivalence must compare at least four Book resources");
  for (const entry of runtime.cliMcpEquivalence ?? []) {
    if (entry.equivalent !== true) failures.push(`${entry.command ?? entry.uri}: CLI/MCP data must be equivalent`);
  }
  if (runtime.privacy?.noRawSourceBody !== true) failures.push("runtime raw source sentinel leaked");
  if (runtime.privacy?.noForbiddenKeys !== true) failures.push("runtime forbidden response key present");

  for (const gate of ["AL7-14", "AL7-15", "AL7-EG1", "AL7-EG2", "AL7-EG3", "AL7-EG4"]) {
    if (packet.assertions?.[gate] !== true) failures.push(`${gate} assertion must be true`);
  }
  return {
    ok: failures.length === 0,
    schemaVersion: SCHEMA_VERSION,
    gates: Object.fromEntries(["AL7-14", "AL7-15", "AL7-EG1", "AL7-EG2", "AL7-EG3", "AL7-EG4"].map((gate) => [gate, packet.assertions?.[gate] === true ? "verified" : "blocked"])),
    failures
  };
}

type FixtureSize = "small" | "medium" | "large";

function buildBenchmarkFixture(name: FixtureSize, sampleCount: number) {
  const entityCount = name === "small" ? 12 : name === "medium" ? 120 : 360;
  const scope = fixtureScope(name);
  const files = fixtureFiles(name, entityCount);
  const changedFiles = files.map((file) => file.path.endsWith(`module.al7-${name}-0.yaml`)
    ? { ...file, body: file.body.replace("Owns checkout architecture ledger query lane 0.", "Owns checkout architecture ledger query lane 0, risk readback, and MCP parity.") }
    : file);
  const plan = planYamlToArchitectureLedgerImport({
    ...scope,
    files,
    previousEvidenceState: emptyArchitectureLedgerEvidenceState(),
    createdAt: "2026-06-26T10:00:00.000Z",
    command: "archctx ledger rebuild --from-git"
  });
  const changed = planYamlToArchitectureLedgerImport({
    ...scope,
    files: changedFiles,
    previousEvidenceState: replayArchitectureLedgerEvidenceState([plan.event]),
    createdAt: "2026-06-26T10:05:00.000Z",
    command: "archctx ledger rebuild --from-git"
  });
  const recommendationEvent = {
    ...changed.event,
    eventId: `architecture_event.al7_recommendation.${name}`,
    eventType: "architecture.recommendation.run",
    timestamp: "2026-06-26T10:06:00.000Z",
    payload: {
      recommendations: [{
        schemaVersion: "archcontext.recommendation/v1",
        recommendationId: `recommendation.al7-${name}-risk`,
        runId: `recommendation_run.al7-${name}`,
        fingerprint: digestJson({ name, risk: "query-latency" } as unknown as Json),
        subject: `module.al7-${name}-0`,
        status: "open",
        confidence: "medium",
        enforcement: "advisory",
        risk: "medium",
        uncertainty: "low",
        evidenceBindingIds: [],
        explanation: ["Book benchmark and privacy readback must remain below beta latency budget."],
        createdAt: "2026-06-26T10:06:00.000Z",
        updatedAt: "2026-06-26T10:06:00.000Z"
      }]
    }
  };
  const queryText = "checkout architecture ledger query parity risk";
  const cold = measure(() => queryArchitectureLedgerBook({
    state: plan.state,
    events: [plan.event],
    query: queryText,
    explain: true,
    maxItems: 12,
    maxBytes: 32_768
  }));
  const warmSamples: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    warmSamples.push(measure(() => queryArchitectureLedgerBook({
      state: plan.state,
      events: [plan.event],
      query: queryText,
      explain: true,
      maxItems: 12,
      maxBytes: 32_768
    })).elapsedMs);
  }
  const neighbors = queryArchitectureLedgerBookNeighbors({
    state: plan.state,
    id: `module.al7-${name}-0`,
    depth: 1,
    maxItems: 20,
    maxBytes: 32_768
  });
  const timeline = queryArchitectureLedgerBookTimeline({
    events: [plan.event, changed.event],
    subjectId: `module.al7-${name}-0`,
    maxItems: 10,
    maxBytes: 32_768
  });
  const diff = diffArchitectureLedgerBookStates({
    previousState: plan.state,
    nextState: changed.state,
    fromRef: plan.event.eventId,
    toRef: changed.event.eventId,
    events: [changed.event],
    maxItems: 20,
    maxBytes: 32_768
  });
  const evidence = queryArchitectureLedgerBookEvidence({
    events: [plan.event],
    id: `module.al7-${name}-0`,
    maxItems: 20,
    maxBytes: 32_768
  });
  const recommendations = queryArchitectureLedgerBookRecommendations({
    events: [recommendationEvent as any],
    openOnly: true,
    explain: true,
    maxItems: 10,
    maxBytes: 32_768
  });
  const responseBundle = {
    query: cold.value,
    neighbors,
    timeline,
    diff,
    evidence,
    recommendations
  };
  const privacy = inspectPrivacy(responseBundle, [RAW_SOURCE_SENTINEL, "function rawPrivateArchitectureBody"]);
  const firstChange = diff.changes[0];
  return {
    name,
    entityCount,
    relationCount: plan.state.relations.length,
    constraintCount: plan.state.constraints.length,
    graphDigest: plan.graphDigest,
    sourceDigest: plan.sourceDigest,
    coldQueryMs: cold.elapsedMs,
    warmQueryP95Ms: p95(warmSamples),
    warmQuerySamplesMs: warmSamples,
    responseDigests: {
      query: digestJson(toJson(cold.value)),
      neighbors: digestJson(toJson(neighbors)),
      diff: digestJson(toJson(diff)),
      recommendations: digestJson(toJson(recommendations))
    },
    bookOutputAcceptance: {
      changedWhyDependsRiskAnswerable: Boolean(
        firstChange
        && firstChange.reasonCodes.length > 0
        && timeline.events.some((event) => event.affectedSubjects.includes(`module.al7-${name}-0`))
        && neighbors.relations.length > 0
        && recommendations.recommendations.some((recommendation: any) => recommendation.risk === "medium")
      ),
      whatChanged: firstChange ? `${firstChange.kind}:${firstChange.id}:${firstChange.changeKind}` : "",
      why: firstChange?.reasonCodes ?? [],
      dependsOn: neighbors.relations.map((relation) => relation.id).slice(0, 5),
      remainingRisk: recommendations.recommendations.map((recommendation: any) => ({
        recommendationId: recommendation.recommendationId,
        risk: recommendation.risk,
        uncertainty: recommendation.uncertainty
      }))
    },
    privacy,
    assertions: {
      coldMeasured: cold.elapsedMs >= 0,
      warmMeasured: warmSamples.length === sampleCount,
      warmP95WithinBudget: p95(warmSamples) <= WARM_QUERY_P95_THRESHOLD_MS,
      queryReturnsExpectedSubject: cold.value.results.some((result) => result.id === `module.al7-${name}-0`),
      neighborsExposeDependency: neighbors.relations.length > 0,
      timelineCarriesAffectedSubject: timeline.events.some((event) => event.affectedSubjects.includes(`module.al7-${name}-0`)),
      diffCarriesReasonCodes: diff.changes.some((change) => change.reasonCodes.length > 0),
      recommendationsExposeRisk: recommendations.recommendations.some((recommendation: any) => typeof recommendation.risk === "string")
    }
  };
}

async function buildRuntimeReadback() {
  const root = mkdtempSync(join(tmpdir(), "archctx-al7-book-runtime-"));
  const daemon = await createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore(),
    clock: () => "2026-06-26T12:00:00.000Z"
  });
  try {
    createRuntimeFixtureRepo(root);
    const deps = { runtimeClient: daemon };
    const init = await runCli("init", ["--name", "AL7 Book Runtime"], root, deps);
    if (!init.ok) throw new Error(`runtime init failed: ${JSON.stringify((init as any).error)}`);
    const rebuild = await runCli("ledger", ["rebuild", "--from-git", "--expected-worktree-digest", computeWorktreeDigest(root)], root, deps);
    if (!rebuild.ok) throw new Error(`runtime rebuild failed: ${JSON.stringify((rebuild as any).error)}`);
    const server = new McpLocalServer(daemon);
    const pairs = [
      { command: "archctx book status", cli: await runCli("book", ["status"], root, deps), uri: "archcontext://book/status", mcp: await server.readResource("archcontext://book/status", root) },
      { command: "archctx book export --format json", cli: await runCli("book", ["export", "--format", "json"], root, deps), uri: "archcontext://book/state", mcp: await server.readResource("archcontext://book/state", root) },
      { command: "archctx book timeline --max-items 100", cli: await runCli("book", ["timeline", "--max-items", "100"], root, deps), uri: "archcontext://book/timeline", mcp: await server.readResource("archcontext://book/timeline", root) },
      { command: "archctx book diff --from empty --to current --max-items 100", cli: await runCli("book", ["diff", "--from", "empty", "--to", "current", "--max-items", "100"], root, deps), uri: "archcontext://book/diff", mcp: await server.readResource("archcontext://book/diff", root) },
      { command: "archctx book recommendations --max-items 100", cli: await runCli("book", ["recommendations", "--max-items", "100"], root, deps), uri: "archcontext://book/recommendations", mcp: await server.readResource("archcontext://book/recommendations", root) }
    ];
    const runtimeResponses = pairs.flatMap((pair) => [pair.cli, pair.mcp]);
    const privacy = inspectPrivacy(runtimeResponses, [RAW_SOURCE_SENTINEL, "function rawPrivateArchitectureBody"]);
    return {
      graphDigest: (pairs[0]!.cli.data as any).freshness.graphDigest,
      rebuildGraphDigest: (rebuild.data as any).graphDigest,
      freshnessProvenance: {
        checkedResponses: runtimeResponses.map((response: any) => ({
          requestId: response?.requestId,
          schemaVersion: response?.data?.schemaVersion,
          freshness: response?.data?.freshness?.schemaVersion,
          provenance: response?.data?.provenance?.schemaVersion,
          graphDigest: response?.data?.freshness?.graphDigest,
          ledgerEvents: response?.data?.freshness?.ledgerCursor?.eventCount
        })),
        allRuntimeResponsesHaveFreshnessAndProvenance: runtimeResponses.every((response: any) =>
          response?.ok === true
          && response?.data?.freshness?.schemaVersion === "archcontext.book-freshness/v1"
          && response?.data?.provenance?.schemaVersion === "archcontext.book-provenance/v1"
          && response?.data?.provenance?.graphDigest === response?.data?.freshness?.graphDigest
          && response?.data?.provenance?.ledgerCursor?.eventCount === response?.data?.freshness?.ledgerCursor?.eventCount
        )
      },
      cliMcpEquivalence: pairs.map((pair) => ({
        command: pair.command,
        uri: pair.uri,
        equivalent: digestJson(toJson((pair.cli as any).data)) === digestJson(toJson((pair.mcp as any).data)),
        cliDigest: digestJson(toJson((pair.cli as any).data)),
        mcpDigest: digestJson(toJson((pair.mcp as any).data))
      })),
      privacy
    };
  } finally {
    await daemon.stop().catch(() => undefined);
    rmSync(root, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
  }
}

function fixtureScope(size: FixtureSize): ArchitectureLedgerScope {
  return {
    repository: {
      repositoryId: `repo.al7-${size}`,
      storageRepositoryId: `repo.storage.al7-${size}`
    },
    worktree: {
      workspaceId: `workspace.al7-${size}`,
      storageWorkspaceId: `workspace.storage.al7-${size}`,
      branch: "main",
      headSha: `al7${size}`,
      worktreeDigest: digestJson({ size, sentinel: "metadata-only" } as unknown as Json)
    }
  };
}

function fixtureFiles(size: FixtureSize, entityCount: number): ArchitectureLedgerModelFile[] {
  const files: ArchitectureLedgerModelFile[] = [];
  for (let index = 0; index < entityCount; index += 1) {
    const id = `module.al7-${size}-${index}`;
    files.push(modelFile(`.archcontext/model/nodes/${id}.yaml`, [
      'schemaVersion: "archcontext.node/v1"',
      `id: "${id}"`,
      'kind: "module"',
      `name: "AL7 ${size} module ${index}"`,
      'status: "active"',
      `path: "src/al7/${size}/module-${index}.ts"`,
      `summary: "Owns checkout architecture ledger query lane ${index}."`,
      "metadata:",
      index === 0 ? "  importance: 1" : "  importance: 0.6",
      "  evidenceStrength: 0.8",
      ""
    ]));
  }
  for (let index = 0; index < entityCount - 1; index += 1) {
    files.push(modelFile(`.archcontext/model/relations/relation.al7-${size}-${index}.yaml`, [
      'schemaVersion: "archcontext.relation/v1"',
      `id: "relation.al7-${size}-${index}"`,
      'kind: "depends_on"',
      `source: "module.al7-${size}-${index}"`,
      `target: "module.al7-${size}-${index + 1}"`,
      'status: "active"',
      `summary: "Lane ${index} depends on lane ${index + 1} for Book dependency readback."`,
      ""
    ]));
  }
  for (let index = 0; index < entityCount; index += 10) {
    files.push(modelFile(`.archcontext/model/constraints/constraint.al7-${size}-${index}.yaml`, [
      'schemaVersion: "archcontext.constraint/v1"',
      `id: "constraint.al7-${size}-${index}"`,
      'kind: "owner-required"',
      `subject: "module.al7-${size}-${index}"`,
      'status: "active"',
      'severity: "warning"',
      `summary: "Module ${index} must preserve metadata-only Book responses."`,
      ""
    ]));
  }
  files.push(modelFile(".archcontext/manifest.yaml", [
    'schemaVersion: "archcontext.manifest/v1"',
    "product:",
    `  id: "product.al7-${size}"`,
    `  name: "AL7 ${size} fixture"`,
    ""
  ]));
  files.push(modelFile(".archcontext/generated/private-source.ts", [
    `export function rawPrivateArchitectureBody() { return "${RAW_SOURCE_SENTINEL}"; }`,
    ""
  ]));
  return files;
}

function createRuntimeFixtureRepo(root: string): void {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# AL7 Book runtime fixture\n", "utf8");
  writeFileSync(join(root, "src", "private.ts"), `export const sentinel = "${RAW_SOURCE_SENTINEL}";\nfunction rawPrivateArchitectureBody() { return sentinel; }\n`, "utf8");
  initializeArchContextModel(root, "AL7 Book Runtime");
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["config", "user.email", "archcontext@example.test"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["config", "user.name", "ArchContext Test"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["add", "."], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function inspectPrivacy(value: unknown, forbiddenStrings: string[]) {
  const serialized = JSON.stringify(value);
  const forbiddenKeyHits: string[] = [];
  collectForbiddenKeys(value, "$", forbiddenKeyHits);
  return {
    forbiddenStrings,
    noRawSourceBody: forbiddenStrings.every((item) => !serialized.includes(item)),
    noForbiddenKeys: forbiddenKeyHits.length === 0,
    forbiddenKeyHits
  };
}

function collectForbiddenKeys(value: unknown, path: string, hits: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeys(item, `${path}[${index}]`, hits));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) hits.push(`${path}.${key}`);
    collectForbiddenKeys(entry, `${path}.${key}`, hits);
  }
}

function measure<T>(run: () => T): { value: T; elapsedMs: number } {
  const started = performance.now();
  const value = run();
  return { value, elapsedMs: roundMs(performance.now() - started) };
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function roundMs(value: number): number {
  return Number(value.toFixed(3));
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function modelFile(path: string, lines: string[] | string): ArchitectureLedgerModelFile {
  return { path, body: Array.isArray(lines) ? lines.join("\n") : lines };
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function renderHuman(result: { ok: boolean; failures: string[]; gates?: Record<string, string> }) {
  if (result.ok) return "[architecture-ledger-al7-book-readback] OK";
  return ["[architecture-ledger-al7-book-readback] FAILED", ...result.failures.map((failure) => `- ${failure}`)].join("\n");
}

function renderReport(packet: any): string {
  const fixtureRows = (packet.benchmark ?? [])
    .map((fixture: any) => `| ${fixture.name} | ${fixture.entityCount} | ${fixture.relationCount} | ${fixture.constraintCount} | ${fixture.coldQueryMs} | ${fixture.warmQueryP95Ms} | ${fixture.assertions.warmP95WithinBudget ? "pass" : "fail"} |`)
    .join("\n");
  const equivalenceRows = (packet.runtime?.cliMcpEquivalence ?? [])
    .map((entry: any) => `| \`${entry.command}\` | \`${entry.uri}\` | ${entry.equivalent ? "pass" : "fail"} |`)
    .join("\n");
  return `# AL7 Book Benchmark And Privacy Readback

Date: 2026-06-26

## Scope

This closes AL7-14, AL7-15 and AL7-EG1 through AL7-EG4 for the architecture ledger sprint.

## P1 Map

The Book read path remains daemon-owned. Core architecture-ledger helpers own deterministic query, neighborhood, timeline, diff, evidence and recommendation shaping. Runtime daemon owns ledger replay, freshness and provenance envelopes. CLI forwards Book commands to the daemon. MCP exposes fixed read-only Book resources that also call the same daemon Book RPC.

Out of scope: AL8 scheduler policy, documentation projection placement and SQLite authority promotion.

## P2 Traced Path

\`\`\`text
AL7 readback fixture
  -> core Book query/diff/evidence/recommendations over small/medium/large YAML import plans
  -> runtime daemon ledger rebuild from Git fixture
  -> archctx book status/export/timeline/diff/recommendations
  -> MCP archcontext://book/* resources
  -> semantic digest comparison and privacy scan
\`\`\`

## P3 Decision

The smallest coherent change is a readback packet plus an explicit Book provenance envelope. The provenance field preserves the existing freshness contract and makes EG2 observable without giving CLI or MCP new write authority. At 10x graph size, ranking latency is the first pressure point; this packet tracks warm query p95 on representative synthetic fixture sizes before AL8 depends on Book output.

## Benchmark

Threshold: warm query p95 <= ${packet.thresholds?.warmQueryP95Ms} ms.

| Fixture | Entities | Relations | Constraints | Cold query ms | Warm p95 ms | Gate |
|---|---:|---:|---:|---:|---:|---|
${fixtureRows}

## Runtime Equivalence

| CLI command | MCP resource | Equivalent |
|---|---|---|
${equivalenceRows}

## Privacy

- Raw source sentinel leaked: ${packet.privacy?.noRawSourceBody ? "no" : "yes"}
- Forbidden response keys present: ${packet.privacy?.noForbiddenKeys ? "no" : "yes"}
- Allowed Book evidence surface remains selectors, summaries, digests, freshness, provenance and reason codes.

## Verification

\`\`\`bash
bun run record:al7:book
bun run readback:al7:book
bun test scripts/architecture-ledger-al7-book-readback.test.ts
bun test packages/surfaces/cli/test/cli.test.ts -t "CLI Book commands" --timeout 120000
bun test packages/surfaces/mcp-local/test/mcp-local.test.ts -t "Book readbacks" --timeout 120000
bun run typecheck
node scripts/package-boundary-audit.mjs
node scripts/sprint-status-check.mjs
git diff --check
ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-al7-benchmark-privacy-verify-state-XXXXXX) bun run verify
bun scripts/architecture-ledger-al7-book-readback.ts inspect --evidence docs/verification/architecture-ledger-al7-book-readback.json --json
\`\`\`

Readback status: ${packet.status}
`;
}
