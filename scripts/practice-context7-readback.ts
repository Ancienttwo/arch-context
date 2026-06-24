#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  EXTERNAL_DOCUMENTATION_RESOURCE_SCHEMA_VERSION,
  digestJson,
  type CodeFactsPort,
  type ExternalDocumentationFetchInput,
  type ExternalDocumentationPort,
  type ExternalDocumentationResolveInput,
  type Json
} from "@archcontext/contracts";
import {
  Context7ExternalDocumentationAdapter,
  Context7ProviderError,
  assertSafeOutboundText,
  type Context7ContextRequest,
  type Context7ProviderTelemetryEvent,
  type Context7SearchRequest,
  type Context7Transport
} from "@archcontext/local-runtime/context7-adapter";
import { createStartedDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { McpLocalServer } from "@archcontext/surfaces/mcp-local";
import { auditPacketCapture } from "./privacy-capture-lib.mjs";

const DEFAULT_EVIDENCE = "docs/verification/practice-context7-readback.json";
const PACKET_SCHEMA_VERSION = "archcontext.practice-context7-readback/v1";
const NOW = "2026-06-24T00:00:00.000Z";
const LIBRARY_ID = "/facebook/react";
const VERSION = "18.2.0";
const INTENT = "state hooks";
const FAILURE_MATRIX_CASES = ["disabled", "no-key", "no-network", "429", "timeout", "malformed"] as const;
type FailureMatrixCase = typeof FAILURE_MATRIX_CASES[number];
const FAILURE_MATRIX_EXPECTED_STATUS: Record<FailureMatrixCase, string> = {
  disabled: "disabled",
  "no-key": "http-error",
  "no-network": "transport-error",
  "429": "rate-limited",
  timeout: "timeout",
  malformed: "malformed"
};

const PRIVATE_VALUE_CASES = [
  { label: "absolute-path", value: "/Users/alice/Projects/private/src/app.ts" },
  { label: "file-uri", value: "file:///Users/alice/Projects/private/src/app.ts" },
  { label: "code-fence", value: "```ts\nconst x = 1;\n```" },
  { label: "diff", value: "diff --git a/src/app.ts b/src/app.ts" },
  { label: "symbol-list", value: "symbols: OrdersService.create, BillingService.charge" },
  { label: "repository-name", value: "Ancienttwo/arch-context" },
  { label: "bearer-token", value: "Bearer abcdef123456" },
  { label: "secret-like-value", value: "access_token_abcdef123456" }
];

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[practice-context7-readback] usage: run|inspect [--out path] [--evidence path] [--json]");
    process.exit(2);
  }

  const result = command === "run"
    ? await runPracticeContext7Readback({
      root: process.cwd(),
      outPath: readFlag(args, "--out") ?? readFlag(args, "--evidence") ?? DEFAULT_EVIDENCE
    })
    : inspectPracticeContext7ReadbackFile({
      root: process.cwd(),
      evidencePath: readFlag(args, "--evidence") ?? readFlag(args, "--out") ?? DEFAULT_EVIDENCE
    });

  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`[practice-context7-readback] OK defaultEgress=${result.defaultPrepareEgress} dlpRejected=${result.dlpRejected}/${result.dlpCases}`);
  } else {
    console.error("[practice-context7-readback] FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
  }
  if (!result.ok) process.exit(1);
}

export async function runPracticeContext7Readback({
  root = process.cwd(),
  outPath = DEFAULT_EVIDENCE
}: {
  root?: string;
  outPath?: string;
} = {}) {
  const packet = await buildPracticeContext7ReadbackPacket(root);
  const resolvedOut = resolve(root, outPath);
  mkdirSync(dirname(resolvedOut), { recursive: true });
  writeFileSync(resolvedOut, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  return inspectPracticeContext7Readback(packet);
}

export function inspectPracticeContext7ReadbackFile({
  root = process.cwd(),
  evidencePath = DEFAULT_EVIDENCE
}: {
  root?: string;
  evidencePath?: string;
} = {}) {
  const packet = JSON.parse(readFileSync(resolve(root, evidencePath), "utf8"));
  return inspectPracticeContext7Readback(packet);
}

export function inspectPracticeContext7Readback(packet: any) {
  const failures: string[] = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return failureResult(["packet must be an object"]);
  }

  if (packet.schemaVersion !== PACKET_SCHEMA_VERSION) failures.push(`schemaVersion must be ${PACKET_SCHEMA_VERSION}`);
  if (packet.environment !== "local-fixture") failures.push("environment must be local-fixture");
  if (packet.status !== "verified") failures.push("status must be verified");

  inspectDefaultHealth(packet.defaultHealth, failures);
  inspectOutbound(packet.outbound, failures);
  inspectProviderTelemetry(packet.providerTelemetry, failures);
  inspectRuntime(packet.runtime, failures);
  inspectDlp(packet.dlp, failures);
  inspectHardGateScan(packet.hardGateScan, failures);
  inspectResourceSummary(packet.resourceSummary, failures);
  inspectAssertions(packet.assertions, failures);

  const dlpAudit = auditPacketCapture(packet);
  if (!dlpAudit.ok) {
    for (const finding of dlpAudit.findings) {
      failures.push(`DLP finding at ${finding.entry}${finding.path}: ${finding.pattern}`);
    }
  }

  return {
    ok: failures.length === 0,
    schemaVersion: PACKET_SCHEMA_VERSION,
    defaultPrepareEgress: packet.runtime?.defaultPrepareEgress,
    dlpCases: packet.dlp?.cases,
    dlpRejected: packet.dlp?.rejected,
    failures
  };
}

export function verifiedPracticeContext7Fixture(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: PACKET_SCHEMA_VERSION,
    environment: "local-fixture",
    status: "verified",
    generatedAt: NOW,
    defaultHealth: {
      provider: "context7",
      enabled: false,
      mode: "manual",
      egress: "none",
      cache: "sqlite",
      keySource: "none"
    },
    outbound: {
      resolveKeys: ["fast", "libraryName", "query", "timeoutMs"],
      fetchKeys: ["libraryId", "maxResults", "query", "timeoutMs"],
      resolve: {
        libraryName: "React",
        queryDigest: digestJson({ provider: "context7", libraryName: "React", query: INTENT }),
        fast: true
      },
      fetch: {
        libraryId: `${LIBRARY_ID}/${VERSION}`,
        queryDigest: digestJson({
          provider: "context7",
          query: `Document ${INTENT} for this exact version. Return documentation data only.`
        }),
        maxResults: 4
      },
      resolveApiKeyPresent: false,
      fetchApiKeyPresent: false
    },
    providerTelemetry: {
      eventCount: 2,
      statuses: ["success", "success"],
      operations: ["resolve", "fetch"],
      resolveKeys: ["byteCount", "latencyMs", "operation", "provider", "queryDigest", "status"],
      fetchKeys: ["byteCount", "latencyMs", "libraryId", "operation", "provider", "queryDigest", "status", "version"],
      fetchLibraryId: LIBRARY_ID,
      fetchVersion: VERSION,
      queryDigestsValid: true,
      byteCountsPositive: true,
      metadataOnly: true,
      rawQueryPresent: false,
      rawContentPresent: false,
      credentialPresent: false
    },
    runtime: {
      defaultPrepareEgress: "none",
      resolveWithoutNetworkOk: false,
      approvedLockfileWritten: true,
      firstFetchCacheStatus: "miss",
      secondFetchCacheStatus: "fresh",
      providerCallsAfterFirstFetch: 1,
      providerCallsAfterSecondFetch: 1,
      providerCallsAfterPrepareComplete: 1,
      cacheEntryCount: 1,
      cacheEntry: {
        provider: "context7",
        libraryId: LIBRARY_ID,
        version: VERSION,
        stale: false
      },
      prepareOk: true,
      prepareExternalResource: {
        provider: "context7",
        libraryId: LIBRARY_ID,
        packageName: "react",
        version: VERSION,
        trust: "external-unverified",
        enforcement: "advisory-only",
        cacheStatus: "fresh"
      },
      prepareExternalUnknown: true,
      prepareConstraintsExternalDocsAbsent: true,
      prepareRealConstraintsExternalDocsAbsent: true,
      completeOk: true,
      mcpResource: {
        listed: true,
        readOk: true,
        uriMatchesFetch: true,
        dataClassification: "external-unverified-documentation",
        genericHttpToolPresent: false
      },
      failureMatrix: verifiedFailureMatrixFixture()
    },
    dlp: {
      cases: PRIVATE_VALUE_CASES.length,
      rejected: PRIVATE_VALUE_CASES.length,
      rejectedLabels: PRIVATE_VALUE_CASES.map((item) => item.label),
      leakRoutes: 0
    },
    hardGateScan: {
      checkpointProviderReferences: 0,
      completeProviderReferences: 0
    },
    resourceSummary: {
      schemaVersion: EXTERNAL_DOCUMENTATION_RESOURCE_SCHEMA_VERSION,
      provider: "context7",
      libraryId: LIBRARY_ID,
      requestedVersion: VERSION,
      resolvedVersion: VERSION,
      trust: "external-unverified",
      enforcement: "advisory-only",
      warning: "untrusted-documentation-data",
      cacheStatus: "fresh",
      retrievedAt: NOW,
      expiresAt: "2026-07-24T00:00:00.000Z",
      uriPrefix: "archcontext://external-docs/context7/",
      snippetCount: 1,
      byteCount: 42,
      contentDigest: `sha256:${"5".repeat(64)}`,
      queryDigest: `sha256:${"4".repeat(64)}`
    },
    assertions: {
      defaultInstallEgressZero: true,
      outboundFieldsAllowlisted: true,
      providerTelemetryMetadataOnly: true,
      dlpInterceptsPrivateValues: true,
      providerContentAdvisoryOnly: true,
      hardGateProviderCallsZero: true,
      exactVersionCacheReplay: true,
      prepareUnknownsUsesPinnedCacheOnly: true,
      providerUnavailableLeavesLocalCoreUnchanged: true,
      failureMatrixKeepsLocalCoreUnchanged: true,
      mcpExternalResourceReadOnly: true
    },
    readback: {
      command: "bun scripts/practice-context7-readback.ts inspect --evidence docs/verification/practice-context7-readback.json --json"
    },
    ...overrides
  };
}

function verifiedFailureMatrixFixture() {
  const rows = FAILURE_MATRIX_CASES.map((label) => ({
    case: label,
    healthEgress: label === "disabled" ? "none" : "prepare-unknowns",
    healthKeySource: "none",
    providerFetchCalls: label === "disabled" ? 0 : 1,
    failureStatus: FAILURE_MATRIX_EXPECTED_STATUS[label],
    prepareOk: true,
    completeOk: true,
    externalResourceCount: 0,
    practiceIdsUnchanged: true,
    constraintsUnchanged: true,
    realConstraintsUnchanged: true,
    postureUnchanged: true,
    pressureUnchanged: true,
    completeResultUnchanged: true,
    localCoreUnchanged: true
  }));
  return {
    cases: [...FAILURE_MATRIX_CASES],
    rowCount: rows.length,
    localCoreUnchanged: true,
    rows
  };
}

async function buildPracticeContext7ReadbackPacket(root: string) {
  const adapter = await captureAdapterReadback();
  const runtime = {
    ...(await captureRuntimeReadback()),
    failureMatrix: await captureFailureMatrixReadback()
  };
  const dlp = captureDlpReadback();
  const hardGateScan = captureHardGateScan(root);
  const resourceSummary = runtime.resourceSummary ?? adapter.resourceSummary;

  return {
    schemaVersion: PACKET_SCHEMA_VERSION,
    environment: "local-fixture",
    status: "verified",
    generatedAt: new Date().toISOString(),
    defaultHealth: adapter.defaultHealth,
    outbound: adapter.outbound,
    providerTelemetry: adapter.providerTelemetry,
    runtime,
    dlp,
    hardGateScan,
    resourceSummary,
    assertions: {
      defaultInstallEgressZero: adapter.defaultHealth.egress === "none" && runtime.defaultPrepareEgress === "none",
      outboundFieldsAllowlisted: sameArray(adapter.outbound.resolveKeys, ["fast", "libraryName", "query", "timeoutMs"])
        && sameArray(adapter.outbound.fetchKeys, ["libraryId", "maxResults", "query", "timeoutMs"]),
      providerTelemetryMetadataOnly: adapter.providerTelemetry.metadataOnly === true
        && adapter.providerTelemetry.queryDigestsValid === true
        && adapter.providerTelemetry.byteCountsPositive === true,
      dlpInterceptsPrivateValues: dlp.rejected === dlp.cases && dlp.leakRoutes === 0,
      providerContentAdvisoryOnly: resourceSummary.trust === "external-unverified" && resourceSummary.enforcement === "advisory-only",
      hardGateProviderCallsZero: hardGateScan.checkpointProviderReferences === 0
        && hardGateScan.completeProviderReferences === 0
        && runtime.providerCallsAfterPrepareComplete === runtime.providerCallsAfterSecondFetch,
      exactVersionCacheReplay: runtime.firstFetchCacheStatus === "miss"
        && runtime.secondFetchCacheStatus === "fresh"
        && runtime.cacheEntry?.libraryId === LIBRARY_ID
        && runtime.cacheEntry?.version === VERSION,
      prepareUnknownsUsesPinnedCacheOnly: runtime.prepareExternalResource?.libraryId === LIBRARY_ID
        && runtime.prepareExternalResource?.version === VERSION
        && runtime.prepareExternalResource?.cacheStatus === "fresh"
        && runtime.prepareExternalUnknown === true
        && runtime.prepareConstraintsExternalDocsAbsent === true
        && runtime.prepareRealConstraintsExternalDocsAbsent === true
        && runtime.providerCallsAfterPrepareComplete === runtime.providerCallsAfterSecondFetch,
      providerUnavailableLeavesLocalCoreUnchanged: runtime.resolveWithoutNetworkOk === false
        && runtime.prepareOk === true
        && runtime.completeOk === true,
      failureMatrixKeepsLocalCoreUnchanged: runtime.failureMatrix?.localCoreUnchanged === true
        && Array.isArray(runtime.failureMatrix?.rows)
        && runtime.failureMatrix.rows.every((row: any) => row.localCoreUnchanged === true),
      mcpExternalResourceReadOnly: runtime.mcpResource?.listed === true
        && runtime.mcpResource?.readOk === true
        && runtime.mcpResource?.uriMatchesFetch === true
        && runtime.mcpResource?.dataClassification === "external-unverified-documentation"
        && runtime.mcpResource?.genericHttpToolPresent === false
    },
    readback: {
      command: "bun scripts/practice-context7-readback.ts inspect --evidence docs/verification/practice-context7-readback.json --json"
    }
  };
}

async function captureAdapterReadback() {
  const outbound: { resolve?: Record<string, unknown>; fetch?: Record<string, unknown> } = {};
  const telemetryEvents: Context7ProviderTelemetryEvent[] = [];
  let monotonicNowMs = 1_000;
  const transport: Context7Transport = {
    async search(input: Context7SearchRequest) {
      outbound.resolve = projectOutboundRequest(input);
      return {
        searchFilterApplied: true,
        results: [{
          id: LIBRARY_ID,
          title: "React",
          description: "Public fixture package.",
          versions: [VERSION]
        }]
      };
    },
    async getContext(input: Context7ContextRequest) {
      outbound.fetch = projectOutboundRequest(input);
      return [{
        title: "React useState",
        content: "External documentation data for useState.",
        source: "https://react.dev/reference/react/useState"
      }];
    }
  };

  const defaultHealth = new Context7ExternalDocumentationAdapter({ clock: () => NOW }).health();
  const adapter = new Context7ExternalDocumentationAdapter({
    enabled: true,
    mode: "manual",
    transport,
    clock: () => NOW,
    monotonicNowMs: () => {
      monotonicNowMs += 25;
      return monotonicNowMs;
    },
    telemetry: { record: (event) => { telemetryEvents.push(event); } },
    maxBytes: 1024
  });
  await adapter.resolve({ provider: "context7", libraryName: "React", query: INTENT, fast: true });
  const fetch = await adapter.fetch({
    provider: "context7",
    libraryId: LIBRARY_ID,
    version: VERSION,
    intent: INTENT,
    ttlSeconds: 86_400
  });

  return {
    defaultHealth,
    outbound: {
      resolveKeys: Object.keys(outbound.resolve ?? {}).filter((key) => key !== "apiKeyPresent").sort(),
      fetchKeys: Object.keys(outbound.fetch ?? {}).filter((key) => key !== "apiKeyPresent").sort(),
      resolve: outbound.resolve,
      fetch: outbound.fetch,
      resolveApiKeyPresent: outbound.resolve?.apiKeyPresent === true,
      fetchApiKeyPresent: outbound.fetch?.apiKeyPresent === true
    },
    providerTelemetry: summarizeProviderTelemetry(telemetryEvents),
    resourceSummary: summarizeExternalResource({ ...fetch.resource, cacheStatus: "fresh" })
  };
}

async function captureRuntimeReadback() {
  const tempRoot = mkdtempSync(join(tmpdir(), "archctx-context7-readback-"));
  let daemon: Awaited<ReturnType<typeof createStartedDaemon>> | undefined;
  const provider = fakeExternalDocumentation("prepare-unknowns");
  try {
    initGitRepo(tempRoot);
    const localStorePath = join(tempRoot, ".archcontext", "runtime.sqlite");
    daemon = await createStartedDaemon({
      codeFacts: fakeCodeFacts(),
      externalDocumentation: provider.port,
      localStorePath,
      clock: () => NOW
    });
    await daemon.init(tempRoot, "Context7 Readback");

    const statusBefore = await daemon.docs(tempRoot, { command: "status" });
    const blockedResolve = await daemon.docs(tempRoot, {
      command: "resolve",
      libraryName: "React",
      query: INTENT
    });
    const pin = await daemon.docs(tempRoot, {
      command: "pin",
      libraryId: LIBRARY_ID,
      version: VERSION,
      approved: true
    });
    const firstFetch = await daemon.docs(tempRoot, {
      command: "fetch",
      libraryId: LIBRARY_ID,
      intent: INTENT,
      allowNetwork: true
    });
    const providerCallsAfterFirstFetch = provider.fetchCalls;
    const secondFetch = await daemon.docs(tempRoot, {
      command: "fetch",
      libraryId: LIBRARY_ID,
      intent: INTENT,
      allowNetwork: true
    });
    const secondData = secondFetch.data as any;
    const mcp = new McpLocalServer(daemon);
    const mcpResources = await mcp.listResources(tempRoot);
    const mcpResourceRead = secondData?.resource?.uri
      ? await mcp.readResource(secondData.resource.uri, tempRoot)
      : undefined;
    const providerCallsAfterSecondFetch = provider.fetchCalls;
    const statusAfterFetch = await daemon.docs(tempRoot, { command: "status" });
    const prepare = await daemon.prepare(tempRoot, "Use React state hooks and confirm package version unknowns", 12_288, 12, "task_context7");
    const complete = await daemon.completeTask(tempRoot, {
      taskSessionId: "task_context7",
      task: "Use React state hooks and confirm package version unknowns",
      headSha: "abc123"
    });

    const prepareContext = (prepare.data as any)?.context;
    const prepareExternalResource = (prepareContext?.resources ?? []).find((resource: any) => resource.type === "external-docs");
    const cacheEntries = ((statusAfterFetch.data as any)?.cacheEntries ?? []) as Array<Record<string, unknown>>;
    const cacheEntry = cacheEntries[0];
    return {
      defaultPrepareEgress: (statusBefore.data as any)?.defaultPrepareEgress,
      resolveWithoutNetworkOk: blockedResolve.ok,
      approvedLockfileWritten: pin.ok === true && existsSync(join(tempRoot, ".archcontext", "integrations", "context7.lock.yaml")),
      firstFetchCacheStatus: (firstFetch.data as any)?.cacheStatus,
      secondFetchCacheStatus: secondData?.cacheStatus,
      providerCallsAfterFirstFetch,
      providerCallsAfterSecondFetch,
      providerCallsAfterPrepareComplete: provider.fetchCalls,
      cacheEntryCount: cacheEntries.length,
      cacheEntry: cacheEntry ? {
        provider: cacheEntry.provider,
        libraryId: cacheEntry.libraryId,
        version: cacheEntry.version,
        stale: cacheEntry.stale
      } : undefined,
      prepareOk: prepare.ok,
      prepareExternalResource,
      prepareExternalUnknown: (prepareContext?.unknowns ?? []).some((unknown: string) => unknown.includes("react@18.2.0")),
      prepareConstraintsExternalDocsAbsent: !JSON.stringify(prepareContext?.constraints ?? []).includes("External documentation"),
      prepareRealConstraintsExternalDocsAbsent: !JSON.stringify(prepareContext?.realConstraints ?? []).includes("External documentation"),
      completeOk: complete.ok,
      mcpResource: {
        listed: mcpResources.some((resource) => resource.uri === secondData?.resource?.uri),
        readOk: (mcpResourceRead as any)?.schemaVersion === "archcontext.resource-read/v1",
        uriMatchesFetch: (mcpResourceRead as any)?.uri === secondData?.resource?.uri,
        dataClassification: (mcpResourceRead as any)?.dataClassification,
        genericHttpToolPresent: mcp.listTools().some((tool) => /http|fetch|request/i.test(tool.name))
      },
      resourceSummary: secondData?.resource ? summarizeExternalResource(secondData.resource) : undefined
    };
  } finally {
    if (daemon) await daemon.stop();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function captureFailureMatrixReadback() {
  const tempRoot = mkdtempSync(join(tmpdir(), "archctx-context7-failure-matrix-"));
  try {
    initGitRepo(tempRoot);
    const baseline = await captureLocalCoreProjection(tempRoot, "static");
    const rows = [];
    for (const label of FAILURE_MATRIX_CASES) {
      const provider = context7FailureMatrixProvider(label);
      const actual = await captureLocalCoreProjection(tempRoot, label, provider.port);
      const comparison = compareLocalCoreProjection(actual, baseline);
      const localCoreUnchanged = actual.prepareOk === true
        && actual.completeOk === true
        && actual.externalResourceCount === 0
        && Object.values(comparison).every(Boolean);
      rows.push({
        case: label,
        healthEgress: actual.health?.egress,
        healthKeySource: actual.health?.keySource,
        providerFetchCalls: provider.fetchCalls,
        failureStatus: label === "disabled" ? "disabled" : provider.statuses.at(-1),
        prepareOk: actual.prepareOk,
        completeOk: actual.completeOk,
        externalResourceCount: actual.externalResourceCount,
        ...comparison,
        localCoreUnchanged
      });
    }
    return {
      cases: [...FAILURE_MATRIX_CASES],
      rowCount: rows.length,
      localCoreUnchanged: rows.every((row) => row.localCoreUnchanged === true),
      rows
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function captureLocalCoreProjection(root: string, label: string, externalDocumentation?: ExternalDocumentationPort) {
  let daemon: Awaited<ReturnType<typeof createStartedDaemon>> | undefined;
  try {
    daemon = await createStartedDaemon({
      codeFacts: fakeCodeFacts(),
      ...(externalDocumentation ? { externalDocumentation } : {}),
      localStorePath: join(root, ".archcontext", `runtime-${label.replace(/[^a-z0-9-]/gi, "-")}.sqlite`),
      clock: () => NOW
    });
    await daemon.init(root, `Context7 Failure Matrix ${label}`);
    if (externalDocumentation) {
      await daemon.docs(root, {
        command: "pin",
        libraryId: LIBRARY_ID,
        version: VERSION,
        approved: true
      });
    }
    const task = "Use React state hooks and confirm package version unknowns";
    const taskSessionId = `task_context7_matrix_${label.replace(/[^a-z0-9-]/gi, "_")}`;
    const prepare = await daemon.prepare(root, task, 12_288, 12, taskSessionId);
    const complete = await daemon.completeTask(root, { taskSessionId, task });
    const context = (prepare.data as any)?.context;
    return {
      health: externalDocumentation ? await externalDocumentation.health() : undefined,
      prepareOk: prepare.ok,
      completeOk: complete.ok,
      practiceIds: (context?.practiceGuidance?.matches ?? []).map((match: any) => match.practiceId),
      constraints: context?.constraints,
      realConstraints: context?.realConstraints,
      posture: (prepare.data as any)?.posture,
      pressure: (prepare.data as any)?.pressure,
      externalResourceCount: (context?.resources ?? []).filter((resource: any) => resource.type === "external-docs").length,
      completeResult: {
        result: (complete.data as any)?.result,
        summary: (complete.data as any)?.summary,
        findings: (complete.data as any)?.findings,
        practiceViolations: (complete.data as any)?.practiceViolations,
        actionsRequired: (complete.data as any)?.actionsRequired,
        cleanup: (complete.data as any)?.cleanup
      }
    };
  } finally {
    if (daemon) await daemon.stop();
  }
}

function compareLocalCoreProjection(actual: any, expected: any) {
  return {
    practiceIdsUnchanged: deepEqual(actual.practiceIds, expected.practiceIds),
    constraintsUnchanged: deepEqual(actual.constraints, expected.constraints),
    realConstraintsUnchanged: deepEqual(actual.realConstraints, expected.realConstraints),
    postureUnchanged: deepEqual(actual.posture, expected.posture),
    pressureUnchanged: deepEqual(actual.pressure, expected.pressure),
    completeResultUnchanged: deepEqual(actual.completeResult, expected.completeResult)
  };
}

function context7FailureMatrixProvider(label: FailureMatrixCase) {
  let fetchCalls = 0;
  const statuses: string[] = [];
  const adapter = new Context7ExternalDocumentationAdapter({
    enabled: label !== "disabled",
    mode: "prepare-unknowns",
    retryBudget: 0,
    rateLimit: false,
    circuitBreaker: false,
    clock: () => NOW,
    telemetry: { record: (event) => { statuses.push(event.status); } },
    transport: context7FailureMatrixTransport(label)
  });
  return {
    port: {
      health: () => adapter.health(),
      resolve: (input: ExternalDocumentationResolveInput) => adapter.resolve(input),
      async fetch(input: ExternalDocumentationFetchInput) {
        fetchCalls++;
        return adapter.fetch(input);
      }
    } satisfies ExternalDocumentationPort,
    get fetchCalls() {
      return fetchCalls;
    },
    get statuses() {
      return statuses;
    }
  };
}

function context7FailureMatrixTransport(label: FailureMatrixCase): Context7Transport {
  return {
    async search() {
      return {
        searchFilterApplied: true,
        results: [{
          id: LIBRARY_ID,
          title: "React",
          versions: [VERSION]
        }]
      };
    },
    async getContext(input) {
      if (label === "no-key" && !input.apiKey) {
        throw new Context7ProviderError("http-error", "Context7 provider rejected missing API key", { statusCode: 401, retryable: false });
      }
      if (label === "no-network") throw new TypeError("fetch failed");
      if (label === "429") {
        throw new Context7ProviderError("rate-limited", "Context7 provider rate limited request", { statusCode: 429, retryable: false });
      }
      if (label === "timeout") {
        throw new Context7ProviderError("timeout", "Context7 provider request timed out", { retryable: false });
      }
      if (label === "malformed") {
        throw new Context7ProviderError("malformed", "Context7 provider returned malformed response", { retryable: false });
      }
      throw new Error(`unexpected Context7 failure matrix case: ${label}`);
    }
  };
}

function captureDlpReadback() {
  const rejectedLabels: string[] = [];
  for (const item of PRIVATE_VALUE_CASES) {
    try {
      assertSafeOutboundText(item.value, "query");
    } catch {
      rejectedLabels.push(item.label);
    }
  }
  return {
    cases: PRIVATE_VALUE_CASES.length,
    rejected: rejectedLabels.length,
    rejectedLabels,
    leakRoutes: PRIVATE_VALUE_CASES.length - rejectedLabels.length
  };
}

function captureHardGateScan(root: string) {
  const source = readFileSync(resolve(root, "packages/local-runtime/runtime-daemon/src/index.ts"), "utf8");
  return {
    checkpointProviderReferences: countProviderReferences(methodBody(source, "checkpoint")),
    completeProviderReferences: countProviderReferences(methodBody(source, "completeTask"))
  };
}

function inspectDefaultHealth(health: any, failures: string[]) {
  if (!health || typeof health !== "object" || Array.isArray(health)) {
    failures.push("defaultHealth must be an object");
    return;
  }
  if (health.provider !== "context7") failures.push("defaultHealth.provider must be context7");
  if (health.enabled !== false) failures.push("defaultHealth.enabled must be false");
  if (health.mode !== "manual") failures.push("defaultHealth.mode must be manual");
  if (health.egress !== "none") failures.push("defaultHealth.egress must be none");
  if (health.keySource !== "none") failures.push("defaultHealth.keySource must be none");
}

function inspectOutbound(outbound: any, failures: string[]) {
  if (!outbound || typeof outbound !== "object" || Array.isArray(outbound)) {
    failures.push("outbound must be an object");
    return;
  }
  if (!sameArray(outbound.resolveKeys, ["fast", "libraryName", "query", "timeoutMs"])) {
    failures.push("outbound.resolveKeys must be fast,libraryName,query,timeoutMs");
  }
  if (!sameArray(outbound.fetchKeys, ["libraryId", "maxResults", "query", "timeoutMs"])) {
    failures.push("outbound.fetchKeys must be libraryId,maxResults,query,timeoutMs");
  }
  if (outbound.resolveApiKeyPresent !== false) failures.push("outbound.resolveApiKeyPresent must be false");
  if (outbound.fetchApiKeyPresent !== false) failures.push("outbound.fetchApiKeyPresent must be false");
  if (outbound.fetch?.libraryId !== `${LIBRARY_ID}/${VERSION}`) failures.push("outbound.fetch.libraryId must include exact pinned version");
}

function inspectProviderTelemetry(telemetry: any, failures: string[]) {
  if (!telemetry || typeof telemetry !== "object" || Array.isArray(telemetry)) {
    failures.push("providerTelemetry must be an object");
    return;
  }
  if (telemetry.eventCount !== 2) failures.push("providerTelemetry.eventCount must be 2");
  if (!sameArray(telemetry.statuses, ["success", "success"])) failures.push("providerTelemetry.statuses must be success,success");
  if (!sameArray(telemetry.operations, ["resolve", "fetch"])) failures.push("providerTelemetry.operations must be resolve,fetch");
  if (!sameArray(telemetry.resolveKeys, ["byteCount", "latencyMs", "operation", "provider", "queryDigest", "status"])) {
    failures.push("providerTelemetry.resolveKeys must be metadata-only");
  }
  if (!sameArray(telemetry.fetchKeys, ["byteCount", "latencyMs", "libraryId", "operation", "provider", "queryDigest", "status", "version"])) {
    failures.push("providerTelemetry.fetchKeys must be metadata-only with libraryId/version");
  }
  if (telemetry.fetchLibraryId !== LIBRARY_ID) failures.push("providerTelemetry.fetchLibraryId must be /facebook/react");
  if (telemetry.fetchVersion !== VERSION) failures.push("providerTelemetry.fetchVersion must be 18.2.0");
  if (telemetry.queryDigestsValid !== true) failures.push("providerTelemetry.queryDigestsValid must be true");
  if (telemetry.byteCountsPositive !== true) failures.push("providerTelemetry.byteCountsPositive must be true");
  if (telemetry.metadataOnly !== true) failures.push("providerTelemetry.metadataOnly must be true");
  if (telemetry.rawQueryPresent !== false) failures.push("providerTelemetry.rawQueryPresent must be false");
  if (telemetry.rawContentPresent !== false) failures.push("providerTelemetry.rawContentPresent must be false");
  if (telemetry.credentialPresent !== false) failures.push("providerTelemetry.credentialPresent must be false");
}

function inspectRuntime(runtime: any, failures: string[]) {
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
    failures.push("runtime must be an object");
    return;
  }
  if (runtime.defaultPrepareEgress !== "none") failures.push("runtime.defaultPrepareEgress must be none");
  if (runtime.resolveWithoutNetworkOk !== false) failures.push("runtime.resolveWithoutNetworkOk must be false");
  if (runtime.approvedLockfileWritten !== true) failures.push("runtime.approvedLockfileWritten must be true");
  if (runtime.firstFetchCacheStatus !== "miss") failures.push("runtime.firstFetchCacheStatus must be miss");
  if (runtime.secondFetchCacheStatus !== "fresh") failures.push("runtime.secondFetchCacheStatus must be fresh");
  if (runtime.providerCallsAfterFirstFetch !== 1) failures.push("runtime.providerCallsAfterFirstFetch must be 1");
  if (runtime.providerCallsAfterSecondFetch !== 1) failures.push("runtime.providerCallsAfterSecondFetch must be 1");
  if (runtime.providerCallsAfterPrepareComplete !== 1) failures.push("runtime.providerCallsAfterPrepareComplete must remain 1");
  if (runtime.cacheEntryCount !== 1) failures.push("runtime.cacheEntryCount must be 1");
  if (runtime.cacheEntry?.libraryId !== LIBRARY_ID) failures.push("runtime.cacheEntry.libraryId must be /facebook/react");
  if (runtime.cacheEntry?.version !== VERSION) failures.push("runtime.cacheEntry.version must be 18.2.0");
  if (runtime.cacheEntry?.stale !== false) failures.push("runtime.cacheEntry.stale must be false");
  if (runtime.prepareOk !== true) failures.push("runtime.prepareOk must be true");
  if (runtime.prepareExternalResource?.provider !== "context7") failures.push("runtime.prepareExternalResource.provider must be context7");
  if (runtime.prepareExternalResource?.libraryId !== LIBRARY_ID) failures.push("runtime.prepareExternalResource.libraryId must be /facebook/react");
  if (runtime.prepareExternalResource?.packageName !== "react") failures.push("runtime.prepareExternalResource.packageName must be react");
  if (runtime.prepareExternalResource?.version !== VERSION) failures.push("runtime.prepareExternalResource.version must be 18.2.0");
  if (runtime.prepareExternalResource?.trust !== "external-unverified") failures.push("runtime.prepareExternalResource.trust must be external-unverified");
  if (runtime.prepareExternalResource?.enforcement !== "advisory-only") failures.push("runtime.prepareExternalResource.enforcement must be advisory-only");
  if (runtime.prepareExternalResource?.cacheStatus !== "fresh") failures.push("runtime.prepareExternalResource.cacheStatus must be fresh");
  if (runtime.prepareExternalUnknown !== true) failures.push("runtime.prepareExternalUnknown must be true");
  if (runtime.prepareConstraintsExternalDocsAbsent !== true) failures.push("runtime.prepareConstraintsExternalDocsAbsent must be true");
  if (runtime.prepareRealConstraintsExternalDocsAbsent !== true) failures.push("runtime.prepareRealConstraintsExternalDocsAbsent must be true");
  if (runtime.completeOk !== true) failures.push("runtime.completeOk must be true");
  if (runtime.mcpResource?.listed !== true) failures.push("runtime.mcpResource.listed must be true");
  if (runtime.mcpResource?.readOk !== true) failures.push("runtime.mcpResource.readOk must be true");
  if (runtime.mcpResource?.uriMatchesFetch !== true) failures.push("runtime.mcpResource.uriMatchesFetch must be true");
  if (runtime.mcpResource?.dataClassification !== "external-unverified-documentation") {
    failures.push("runtime.mcpResource.dataClassification must be external-unverified-documentation");
  }
  if (runtime.mcpResource?.genericHttpToolPresent !== false) failures.push("runtime.mcpResource.genericHttpToolPresent must be false");
  inspectFailureMatrix(runtime.failureMatrix, failures);
}

function inspectFailureMatrix(matrix: any, failures: string[]) {
  if (!matrix || typeof matrix !== "object" || Array.isArray(matrix)) {
    failures.push("runtime.failureMatrix must be an object");
    return;
  }
  if (!sameArray(matrix.cases, [...FAILURE_MATRIX_CASES])) {
    failures.push(`runtime.failureMatrix.cases must be ${FAILURE_MATRIX_CASES.join(",")}`);
  }
  if (matrix.rowCount !== FAILURE_MATRIX_CASES.length) {
    failures.push(`runtime.failureMatrix.rowCount must be ${FAILURE_MATRIX_CASES.length}`);
  }
  if (matrix.localCoreUnchanged !== true) failures.push("runtime.failureMatrix.localCoreUnchanged must be true");
  if (!Array.isArray(matrix.rows)) {
    failures.push("runtime.failureMatrix.rows must be an array");
    return;
  }
  for (const label of FAILURE_MATRIX_CASES) {
    const row = matrix.rows.find((item: any) => item?.case === label);
    if (!row) {
      failures.push(`runtime.failureMatrix missing case ${label}`);
      continue;
    }
    if (row.healthEgress !== (label === "disabled" ? "none" : "prepare-unknowns")) {
      failures.push(`runtime.failureMatrix.${label}.healthEgress must be ${label === "disabled" ? "none" : "prepare-unknowns"}`);
    }
    if (row.healthKeySource !== "none") failures.push(`runtime.failureMatrix.${label}.healthKeySource must be none`);
    if (row.providerFetchCalls !== (label === "disabled" ? 0 : 1)) {
      failures.push(`runtime.failureMatrix.${label}.providerFetchCalls must be ${label === "disabled" ? 0 : 1}`);
    }
    if (row.failureStatus !== FAILURE_MATRIX_EXPECTED_STATUS[label]) {
      failures.push(`runtime.failureMatrix.${label}.failureStatus must be ${FAILURE_MATRIX_EXPECTED_STATUS[label]}`);
    }
    for (const key of [
      "prepareOk",
      "completeOk",
      "practiceIdsUnchanged",
      "constraintsUnchanged",
      "realConstraintsUnchanged",
      "postureUnchanged",
      "pressureUnchanged",
      "completeResultUnchanged",
      "localCoreUnchanged"
    ]) {
      if (row[key] !== true) failures.push(`runtime.failureMatrix.${label}.${key} must be true`);
    }
    if (row.externalResourceCount !== 0) failures.push(`runtime.failureMatrix.${label}.externalResourceCount must be 0`);
  }
}

function inspectDlp(dlp: any, failures: string[]) {
  if (!dlp || typeof dlp !== "object" || Array.isArray(dlp)) {
    failures.push("dlp must be an object");
    return;
  }
  if (dlp.cases !== PRIVATE_VALUE_CASES.length) failures.push(`dlp.cases must be ${PRIVATE_VALUE_CASES.length}`);
  if (dlp.rejected !== PRIVATE_VALUE_CASES.length) failures.push(`dlp.rejected must be ${PRIVATE_VALUE_CASES.length}`);
  if (dlp.leakRoutes !== 0) failures.push("dlp.leakRoutes must be 0");
}

function inspectHardGateScan(scan: any, failures: string[]) {
  if (!scan || typeof scan !== "object" || Array.isArray(scan)) {
    failures.push("hardGateScan must be an object");
    return;
  }
  if (scan.checkpointProviderReferences !== 0) failures.push("hardGateScan.checkpointProviderReferences must be 0");
  if (scan.completeProviderReferences !== 0) failures.push("hardGateScan.completeProviderReferences must be 0");
}

function inspectResourceSummary(resource: any, failures: string[]) {
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    failures.push("resourceSummary must be an object");
    return;
  }
  if (resource.schemaVersion !== EXTERNAL_DOCUMENTATION_RESOURCE_SCHEMA_VERSION) {
    failures.push(`resourceSummary.schemaVersion must be ${EXTERNAL_DOCUMENTATION_RESOURCE_SCHEMA_VERSION}`);
  }
  if (resource.provider !== "context7") failures.push("resourceSummary.provider must be context7");
  if (resource.libraryId !== LIBRARY_ID) failures.push("resourceSummary.libraryId must be /facebook/react");
  if (resource.requestedVersion !== VERSION) failures.push("resourceSummary.requestedVersion must be 18.2.0");
  if (resource.resolvedVersion !== VERSION) failures.push("resourceSummary.resolvedVersion must be 18.2.0");
  if (resource.trust !== "external-unverified") failures.push("resourceSummary.trust must be external-unverified");
  if (resource.enforcement !== "advisory-only") failures.push("resourceSummary.enforcement must be advisory-only");
  if (resource.warning !== "untrusted-documentation-data") failures.push("resourceSummary.warning must be untrusted-documentation-data");
  if (resource.cacheStatus !== "fresh") failures.push("resourceSummary.cacheStatus must be fresh");
  if (typeof resource.retrievedAt !== "string" || Number.isNaN(Date.parse(resource.retrievedAt))) {
    failures.push("resourceSummary.retrievedAt must be an ISO timestamp");
  }
  if (typeof resource.expiresAt !== "string" || Number.isNaN(Date.parse(resource.expiresAt))) {
    failures.push("resourceSummary.expiresAt must be an ISO timestamp");
  }
  if (resource.uriPrefix !== "archcontext://external-docs/context7/") failures.push("resourceSummary.uriPrefix must be archcontext external docs");
  if (!Number.isInteger(resource.snippetCount) || resource.snippetCount < 1) failures.push("resourceSummary.snippetCount must be positive");
  if (typeof resource.contentDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(resource.contentDigest)) {
    failures.push("resourceSummary.contentDigest must be a sha256 digest");
  }
  if (typeof resource.queryDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(resource.queryDigest)) {
    failures.push("resourceSummary.queryDigest must be a sha256 digest");
  }
}

function inspectAssertions(assertions: any, failures: string[]) {
  if (!assertions || typeof assertions !== "object" || Array.isArray(assertions)) {
    failures.push("assertions must be an object");
    return;
  }
  for (const key of [
    "defaultInstallEgressZero",
    "outboundFieldsAllowlisted",
    "providerTelemetryMetadataOnly",
    "dlpInterceptsPrivateValues",
    "providerContentAdvisoryOnly",
    "hardGateProviderCallsZero",
    "exactVersionCacheReplay",
    "prepareUnknownsUsesPinnedCacheOnly",
    "providerUnavailableLeavesLocalCoreUnchanged",
    "failureMatrixKeepsLocalCoreUnchanged",
    "mcpExternalResourceReadOnly"
  ]) {
    if (assertions[key] !== true) failures.push(`assertions.${key} must be true`);
  }
}

function projectOutboundRequest(input: Context7SearchRequest | Context7ContextRequest): Record<string, unknown> {
  return Object.fromEntries(Object.entries({
    ...(isSearchRequest(input) ? {
      libraryName: input.libraryName,
      query: input.query,
      fast: input.fast
    } : {
      libraryId: input.libraryId,
      query: input.query,
      maxResults: input.maxResults
    }),
    timeoutMs: input.timeoutMs,
    ...(input.apiKey ? { apiKeyPresent: true } : { apiKeyPresent: false })
  }).filter(([key]) => key !== "apiKeyPresent")) as Record<string, unknown>;
}

function summarizeExternalResource(resource: any) {
  return {
    schemaVersion: resource.schemaVersion,
    provider: resource.provider,
    libraryId: resource.libraryId,
    requestedVersion: resource.requestedVersion,
    resolvedVersion: resource.resolvedVersion,
    queryDigest: resource.queryDigest,
    contentDigest: resource.contentDigest,
    trust: resource.trust,
    enforcement: resource.enforcement,
    warning: resource.warning,
    cacheStatus: resource.cacheStatus,
    retrievedAt: resource.retrievedAt,
    expiresAt: resource.expiresAt,
    uriPrefix: typeof resource.uri === "string" ? resource.uri.replace(resource.contentDigest, "") : undefined,
    snippetCount: Array.isArray(resource.snippets) ? resource.snippets.length : 0,
    byteCount: resource.byteCount
  };
}

function summarizeProviderTelemetry(events: Context7ProviderTelemetryEvent[]) {
  const serialized = JSON.stringify(events);
  const resolve = events.find((event) => event.operation === "resolve");
  const fetch = events.find((event) => event.operation === "fetch");
  return {
    eventCount: events.length,
    statuses: events.map((event) => event.status),
    operations: events.map((event) => event.operation),
    resolveKeys: Object.keys(resolve ?? {}).sort(),
    fetchKeys: Object.keys(fetch ?? {}).sort(),
    fetchLibraryId: fetch?.libraryId,
    fetchVersion: fetch?.version,
    queryDigestsValid: events.every((event) => /^sha256:[0-9a-f]{64}$/.test(event.queryDigest)),
    byteCountsPositive: events.every((event) => Number.isInteger(event.byteCount) && event.byteCount > 0),
    metadataOnly: !serialized.includes(INTENT)
      && !serialized.includes("External documentation data")
      && !serialized.includes("React useState")
      && !serialized.includes("apiKey"),
    rawQueryPresent: serialized.includes(INTENT),
    rawContentPresent: serialized.includes("External documentation data") || serialized.includes("React useState"),
    credentialPresent: serialized.includes("Bearer") || serialized.includes("apiKey") || serialized.includes("CONTEXT7_API_KEY")
  };
}

function fakeExternalDocumentation(mode: "manual" | "prepare-unknowns" = "manual") {
  let fetchCalls = 0;
  let resolveCalls = 0;
  const port: ExternalDocumentationPort = {
    health() {
      return {
        provider: "context7",
        enabled: true,
        mode,
        egress: mode === "prepare-unknowns" ? "prepare-unknowns" : "manual-only",
        cache: "sqlite",
        keySource: "none"
      };
    },
    async resolve(input: ExternalDocumentationResolveInput) {
      resolveCalls++;
      return {
        schemaVersion: "archcontext.external-docs-resolve/v1",
        provider: "context7",
        queryDigest: digestJson({ provider: "context7", libraryName: input.libraryName, query: input.query }),
        searchFilterApplied: true,
        egress: "manual-only",
        candidates: [{
          id: LIBRARY_ID,
          title: "React",
          versions: [VERSION]
        }]
      };
    },
    async fetch(input: ExternalDocumentationFetchInput) {
      fetchCalls++;
      const queryDigest = digestJson({
        provider: "context7",
        libraryId: input.libraryId,
        version: input.version,
        query: input.intent
      });
      const contentDigest = digestJson({
        provider: "context7",
        libraryId: input.libraryId,
        version: input.version,
        snippet: "react-state-hooks"
      });
      return {
        schemaVersion: "archcontext.external-docs-fetch/v1",
        provider: "context7",
        cacheStatus: "miss",
        request: {
          libraryId: input.libraryId,
          version: input.version,
          queryDigest,
          intent: input.intent
        },
        resource: {
          schemaVersion: EXTERNAL_DOCUMENTATION_RESOURCE_SCHEMA_VERSION,
          provider: "context7",
          libraryId: input.libraryId,
          requestedVersion: input.version,
          resolvedVersion: input.version,
          queryDigest,
          contentDigest,
          retrievedAt: NOW,
          expiresAt: "2026-07-24T00:00:00.000Z",
          trust: "external-unverified",
          enforcement: "advisory-only",
          cacheStatus: "miss",
          uri: `archcontext://external-docs/context7/${contentDigest}`,
          byteCount: 42,
          snippets: [{
            title: "React useState",
            contentPreview: "External documentation data for useState.",
            contentDigest,
            sourceUri: "https://react.dev/reference/react/useState",
            byteCount: 42
          }],
          warning: "untrusted-documentation-data"
        }
      };
    }
  };
  return {
    port,
    get fetchCalls() {
      return fetchCalls;
    },
    get resolveCalls() {
      return resolveCalls;
    }
  };
}

function fakeCodeFacts(): CodeFactsPort {
  const snapshot = {
    provider: "codegraph" as const,
    version: "1.0.1",
    schemaDigest: `sha256:${"f".repeat(64)}`,
    indexedAt: NOW,
    workspaceDigest: `sha256:${"1".repeat(64)}`
  };
  return {
    async ensureReady() {
      return snapshot;
    },
    async sync() {
      return snapshot;
    },
    async buildTaskContext(input) {
      return {
        task: input.task,
        symbols: [],
        edges: [],
        evidence: [],
        digest: digestJson({ task: input.task, fixture: "context7-readback" })
      };
    },
    async findSymbols() {
      return [];
    },
    async getImpact(input) {
      return { symbolId: input.symbolId, callers: [], callees: [], affectedPaths: [] };
    },
    async getCallers() {
      return [];
    },
    async getCallees() {
      return [];
    },
    async resolveEvidence() {
      return [];
    }
  };
}

function initGitRepo(root: string) {
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "context7-readback", dependencies: { react: VERSION } }, null, 2)}\n`, "utf8");
  runGit(root, ["init", "-q"]);
  runGit(root, ["add", "package.json"]);
  runGit(root, ["-c", "user.email=context7-readback@example.invalid", "-c", "user.name=Context7 Readback", "commit", "-m", "init", "-q"]);
}

function methodBody(source: string, name: string): string {
  const start = source.indexOf(`async ${name}(`);
  if (start === -1) return "";
  const candidates = ["\n  async ", "\n  private ", "\n  public "]
    .map((marker) => source.indexOf(marker, start + 1))
    .filter((index) => index !== -1);
  const next = candidates.length > 0 ? Math.min(...candidates) : -1;
  return source.slice(start, next === -1 ? source.length : next);
}

function countProviderReferences(section: string): number {
  return (section.match(/\b(?:manualExternalDocumentation|externalDocumentation|Context7ExternalDocumentationAdapter)\b/g) ?? []).length;
}

function runGit(cwd: string, args: string[]) {
  const child = spawnSync("git", args, {
    cwd,
    stdio: "pipe",
    env: process.env
  });
  if (child.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${child.stderr.toString()}`);
  }
}

function isSearchRequest(input: Context7SearchRequest | Context7ContextRequest): input is Context7SearchRequest {
  return "libraryName" in input;
}

function sameArray(value: unknown, expected: string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function failureResult(failures: string[]) {
  return {
    ok: false,
    schemaVersion: PACKET_SCHEMA_VERSION,
    defaultPrepareEgress: undefined,
    dlpCases: undefined,
    dlpRejected: undefined,
    failures
  };
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
