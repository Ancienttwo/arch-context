#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runCli } from "@archcontext/surfaces/cli";

const DEFAULT_OUTPUT = "docs/verification/practice-assets-s6-docs-ops-readback.json";
const DEFAULT_REPORT = "docs/verification/practice-assets-s6-docs-ops-readback.md";

const PATHS = {
  readme: "README.md",
  practiceRunbook: "docs/runbooks/practice-assets-v1.md",
  upgradeRollbackRunbook: "docs/runbooks/upgrade-rollback.md",
  hookReadme: ".ai/hooks/README.md",
  s4EnforcementGate: "docs/verification/practice-assets-s4-enforcement-gate.md",
  s5Context7Gate: "docs/verification/practice-assets-s5-context7-gate.md",
  s6ReleaseGate: "docs/verification/practice-assets-s6-release-gate.md",
  runtimeDaemonSource: "packages/local-runtime/runtime-daemon/src/index.ts",
  externalDocumentationSource: "packages/local-runtime/runtime-daemon/src/external-documentation.ts",
  hookReadback: "docs/verification/practice-hook-egress-readback.json",
  context7Readback: "docs/verification/practice-context7-readback.json",
  catalogReadback: "docs/verification/practice-assets-s6-catalog-readback.json",
  runtimeReadback: "docs/verification/practice-assets-s6-runtime-readback.json",
  npmDryRunReadback: "docs/verification/fg6-npm-release-dry-run.json",
  localTarballReadback: "docs/verification/fg6-local-product-tarball-smoke.json",
  rollbackCompatReadback: "docs/verification/fg6-rollback-compat-readback.json"
} as const;

const SECRET_PATTERNS = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /secret:\/\//i
] as const;

const CODE_CONTENT_PATTERNS = [
  /diff\s+--git/i,
  /^@@\s/m,
  /"patch"\s*:/i,
  /"sourceBody"\s*:/i,
  /"diffBody"\s*:/i,
  /\/contents(?:\/|\b)/i,
  /\/git\/blobs(?:\/|\b)/i,
  /\/git\/trees(?:\/|\b)/i,
  /\/pulls\/\d+\/files/i,
  /application\/vnd\.github\.(?:v3\.)?(?:diff|patch)/i
] as const;

const EVIDENCE_FIELDS = {
  documentation: [
        "readmeStaticDynamicBoundary",
        "readmeNoDataSentBoundary",
        "repoPracticeHowTo",
        "enforcementPromotionHowTo",
        "waiverHowTo",
        "centralHookHowTo",
        "context7PinPrivacyHowTo",
        "sourceUpdateRunbook",
        "licenseIncidentRunbook",
        "falsePositiveRollbackRunbook",
        "quarterlyReviewOwner",
        "featureFlagsRolloutReadback",
        "releaseGateUpdated"
      ],
  independentDisable: [
        "enforcementAdvisoryModeDocumented",
        "enforcementAdvisoryModeVerified",
        "context7DefaultDisabled",
        "context7FailureMatrixComplete",
        "context7FailureMatrixLeavesLocalCoreUnchanged",
        "context7AdvisoryOnly",
        "context7ManualNetworkOnly"
      ],
  centralHook: [
        "hookReadbackVerified",
        "codexHostCentralFirst",
        "adapterIsRepoHarnessHook",
        "hookEntrypointArchctxEnqueue",
        "checkpointFallbackLocalOnly",
        "currentAdapterVerified",
        "hookZeroNetwork",
        "hookNoRawChangedPathBody",
        "hookReadmeCentralFirst"
      ],
  operations: [
        "catalogRevisionManifestVerified",
        "releasePackageManifestVerified",
        "localTarballLifecycleVerified",
        "rollbackCompatibilityVerified",
        "staleCatalogDetected",
        "context7PurgeCommandImplemented",
        "cachePurgeRunbookDocumented",
        "upgradeRollbackRunbookCoversPracticeAssets"
      ],
  assertions: [
        "documentationComplete",
        "independentDisableComplete",
        "centralHookComplete",
        "operationsComplete",
        "noPrivateContent"
      ]
} as const;

type ReadbackConfig = ReturnType<typeof buildPracticeAssetsS6DocsOpsReadbackConfig>;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildPracticeAssetsS6DocsOpsReadbackConfig(process.env, args);
    const result = await runPracticeAssetsS6DocsOpsReadback(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const packet = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectPracticeAssetsS6DocsOpsReadback(packet);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[practice-assets-s6-docs-ops-readback] usage: run|inspect [--out path] [--report path] [--json]");
    process.exit(2);
  }
}

export function buildPracticeAssetsS6DocsOpsReadbackConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_S6_DOCS_OPS_OUTPUT ?? DEFAULT_OUTPUT,
    reportPath: readFlag(args, "--report") ?? env.ARCHCONTEXT_S6_DOCS_OPS_REPORT ?? DEFAULT_REPORT,
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runPracticeAssetsS6DocsOpsReadback(config: ReadbackConfig) {
  const texts = {
    readme: await readText(config.root, PATHS.readme),
    practiceRunbook: await readText(config.root, PATHS.practiceRunbook),
    upgradeRollbackRunbook: await readText(config.root, PATHS.upgradeRollbackRunbook),
    hookReadme: await readText(config.root, PATHS.hookReadme),
    s4EnforcementGate: await readText(config.root, PATHS.s4EnforcementGate),
    s5Context7Gate: await readText(config.root, PATHS.s5Context7Gate),
    s6ReleaseGate: await readText(config.root, PATHS.s6ReleaseGate),
    runtimeDaemonSource: [
      await readText(config.root, PATHS.runtimeDaemonSource),
      await readText(config.root, PATHS.externalDocumentationSource)
    ].join("\n")
  };
  const json = {
    hook: await readJson(config.root, PATHS.hookReadback),
    currentHookAdapter: await runCli("hooks", ["status", "--host", "codex"], config.root),
    context7: await readJson(config.root, PATHS.context7Readback),
    catalog: await readJson(config.root, PATHS.catalogReadback),
    runtime: await readJson(config.root, PATHS.runtimeReadback),
    npmDryRun: await readJson(config.root, PATHS.npmDryRunReadback),
    localTarball: await readJson(config.root, PATHS.localTarballReadback),
    rollbackCompat: await readJson(config.root, PATHS.rollbackCompatReadback)
  };

  const evidence = buildEvidence(texts, json);
  const packet = {
    schemaVersion: "archcontext.practice-assets-s6-docs-ops-readback/v2",
    taskIds: ["S6-34", "S6-35", "S6-36", "S6-37", "S6-38", "S6-39", "S6-40", "S6-EG5", "S6-EG6", "S6-EG7"],
    environment: "local-release-readback",
    evidenceScope: "current-docs-and-cli-contract-with-historical-fixtures",
    status: "verified",
    ok: true,
    generatedAt: config.generatedAt(),
    sources: {
      ...PATHS,
      reportPath: config.reportPath
    },
    evidence,
    currentHookAdapter: json.currentHookAdapter,
    failures: [] as string[]
  };
  const inspection = inspectPracticeAssetsS6DocsOpsReadback(packet);
  packet.status = inspection.ok ? "verified" : "failed";
  packet.ok = inspection.ok;
  packet.failures = inspection.failures;
  await writeText(config.root, config.reportPath, renderReport(packet));
  await writeJson(config.root, config.outputPath, packet);
  return packet;
}

export function inspectPracticeAssetsS6DocsOpsReadback(packet: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(packet);
  const evidence = readRecord(record.evidence);

  if (record.schemaVersion !== "archcontext.practice-assets-s6-docs-ops-readback/v2") failures.push("schemaVersion mismatch");
  if (record.environment !== "local-release-readback") failures.push("environment must be local-release-readback");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  for (const taskId of ["S6-34", "S6-35", "S6-36", "S6-37", "S6-38", "S6-39", "S6-40", "S6-EG5", "S6-EG6", "S6-EG7"]) {
    if (!Array.isArray(record.taskIds) || !record.taskIds.includes(taskId)) failures.push(`missing taskId ${taskId}`);
  }
  for (const [groupName, keys] of Object.entries(EVIDENCE_FIELDS)) {
    const group = readRecord(evidence[groupName]);
    for (const key of keys) {
      if (group[key] !== true) failures.push(groupName === "assertions"
        ? `assertion ${key} must be true` : `${groupName}.${key} must be true`);
    }
  }
  for (const [key, value] of Object.entries(currentHookContractChecks(record.currentHookAdapter))) {
    if (!value) failures.push(`currentHookAdapter.${key} must be true`);
  }
  const serialized = JSON.stringify(packet);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden secret marker: ${pattern}`);
  }
  for (const pattern of CODE_CONTENT_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden code-content marker: ${pattern}`);
  }
  return { ok: failures.length === 0, failures };
}

export function verifiedPracticeAssetsS6DocsOpsFixture() {
  return {
    schemaVersion: "archcontext.practice-assets-s6-docs-ops-readback/v2",
    taskIds: ["S6-34", "S6-35", "S6-36", "S6-37", "S6-38", "S6-39", "S6-40", "S6-EG5", "S6-EG6", "S6-EG7"],
    environment: "local-release-readback",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-24T00:00:00.000Z",
    sources: {},
    currentHookAdapter: {
      ok: true, requestId: "hooks.status", data: {
        schemaVersion: "archcontext.hook-adapter/v1", host: "codex", adapterName: "repo-harness-hook",
        ownership: "central-first", hookRuntime: "external-user-level", repoLocalRuntime: "not-vendored",
        entrypoint: { command: "archctx", args: ["hook", "enqueue"], egress: "none", network: "forbidden", failOpen: true },
        fallbackEntrypoint: { command: "archctx", args: ["hook", "checkpoint"], egress: "none", network: "forbidden", failOpen: true }
      }
    },
    evidence: {
      documentation: allTrue(EVIDENCE_FIELDS.documentation),
      independentDisable: allTrue(EVIDENCE_FIELDS.independentDisable),
      centralHook: allTrue(EVIDENCE_FIELDS.centralHook),
      operations: allTrue(EVIDENCE_FIELDS.operations),
      assertions: allTrue(EVIDENCE_FIELDS.assertions)
    },
    failures: []
  };
}

function currentHookContractChecks(envelope: unknown) {
  const record = readRecord(envelope);
  const data = readRecord(record.data);
  const entrypoint = readRecord(data.entrypoint);
  const checkpoint = readRecord(data.fallbackEntrypoint);
  const exactArgs = (args: unknown, expected: string[]) => Array.isArray(args)
    && args.length === expected.length && expected.every((arg, index) => args[index] === arg);
  return {
    envelope: record.ok === true && record.requestId === "hooks.status" && data.schemaVersion === "archcontext.hook-adapter/v1",
    ownership: data.host === "codex" && data.adapterName === "repo-harness-hook"
      && data.ownership === "central-first" && data.hookRuntime === "external-user-level" && data.repoLocalRuntime === "not-vendored",
    enqueueEntrypoint: entrypoint.command === "archctx" && exactArgs(entrypoint.args, ["hook", "enqueue"])
      && entrypoint.egress === "none" && entrypoint.network === "forbidden" && entrypoint.failOpen === true,
    checkpointFallback: checkpoint.command === "archctx" && exactArgs(checkpoint.args, ["hook", "checkpoint"])
      && checkpoint.egress === "none" && checkpoint.network === "forbidden" && checkpoint.failOpen === true
  };
}

function buildEvidence(texts: Record<string, string>, json: Record<string, any>) {
  const documentation = {
    readmeStaticDynamicBoundary: includesAll(texts.readme, ["Static Practice Assets", "Dynamic Documentation References", ".archcontext/practices/"]),
    readmeNoDataSentBoundary: includesAll(texts.readme, ["no source body", "diff", "prompt", "Context7"]),
    repoPracticeHowTo: includesAll(texts.practiceRunbook, ["Write A Repo Practice", ".archcontext/practices/", "overlay.mode"]),
    enforcementPromotionHowTo: includesAll(texts.practiceRunbook, ["Promote Enforcement", ".archcontext/policies/practices.yaml", "mode: advisory", "mode: active"]),
    waiverHowTo: includesAll(texts.practiceRunbook, ["Add A Waiver", "archctx practices waive", ".archcontext/waivers/"]),
    centralHookHowTo: includesAll(texts.practiceRunbook, ["Connect A Central Hook", "repo-harness-hook", "archctx hook enqueue", "archctx hook checkpoint"]),
    context7PinPrivacyHowTo: includesAll(texts.practiceRunbook, ["Pin Context7", "archctx docs pin", "archctx docs purge --all", "advisory-only"]),
    sourceUpdateRunbook: includesAll(texts.practiceRunbook, ["Source Update Runbook", "bun run record:s6:catalog", "bun run readback:s6:catalog"]),
    licenseIncidentRunbook: includesAll(texts.practiceRunbook, ["License Incident Runbook", "reference-only", "NOTICE.md"]),
    falsePositiveRollbackRunbook: includesAll(texts.practiceRunbook, ["False-Positive Rollback Runbook", "mode: advisory", "archctx docs purge --all"]),
    quarterlyReviewOwner: includesAll(texts.practiceRunbook, ["Quarterly Asset Review", "Owner: `team-architecture`", "90 days"]),
    featureFlagsRolloutReadback: includesAll(texts.practiceRunbook, ["Feature Flags And Rollout Readback", "Catalog only", "Repo opt-in enforcement", "bun run readback:fg6:rollback-compat"]),
    releaseGateUpdated: includesAll(texts.s6ReleaseGate, ["Documentation, operations, rollout", "S6-34"])
  };

  const context7FailureCases = json.context7?.runtime?.failureMatrix?.cases ?? [];
  const independentDisable = {
    enforcementAdvisoryModeDocumented: includesAll(texts.practiceRunbook, ["Enforcement off", "practices.enforcement.mode: advisory"]),
    enforcementAdvisoryModeVerified: includesAll(texts.s4EnforcementGate, ["S4-EG5", "Policy mode `advisory`"]),
    context7DefaultDisabled: json.context7?.defaultHealth?.enabled === false && json.context7?.runtime?.defaultPrepareEgress === "none",
    context7FailureMatrixComplete: sameSet(context7FailureCases, ["disabled", "no-key", "no-network", "429", "timeout", "malformed"]),
    context7FailureMatrixLeavesLocalCoreUnchanged: json.context7?.runtime?.failureMatrix?.localCoreUnchanged === true,
    context7AdvisoryOnly: json.context7?.runtime?.prepareExternalResource?.enforcement === "advisory-only",
    context7ManualNetworkOnly: includesAll(texts.s5Context7Gate, ["docs resolve --allow-network", "docs fetch", "advisory-only"])
  };

  const hookData = json.currentHookAdapter?.data ?? {};
  const currentChecks = currentHookContractChecks(json.currentHookAdapter);
  const centralHook = {
    hookReadbackVerified: json.hook?.status === "verified",
    codexHostCentralFirst: hookData.host === "codex" && hookData.ownership === "central-first",
    adapterIsRepoHarnessHook: hookData.adapterName === "repo-harness-hook",
    hookEntrypointArchctxEnqueue: currentChecks.enqueueEntrypoint,
    checkpointFallbackLocalOnly: currentChecks.checkpointFallback,
    currentAdapterVerified: Object.values(currentChecks).every(Boolean),
    hookZeroNetwork: json.hook?.capture?.totalRequests === 0
      && hookData.entrypoint?.egress === "none"
      && hookData.entrypoint?.network === "forbidden",
    hookNoRawChangedPathBody: json.hook?.assertions?.rawChangedPathBodyAbsent === true && json.hook?.assertions?.sourceBodyAbsent === true,
    // Harness-owned helper docs describe runtime ownership; product evidence lives in the runbook.
    hookReadmeCentralFirst: includesAll(texts.hookReadme, [
      "user-level", "repo-harness-hook", "operator helper libraries only",
      "no repo-local host-event dispatcher or route script is supported"
    ]) && includesAll(texts.practiceRunbook, [PATHS.hookReadback])
  };

  const operations = {
    catalogRevisionManifestVerified: json.catalog?.assertions?.manifestMatchesStaticCatalog === true
      && json.catalog?.assertions?.deprecatedAssetsRetainedAndSuperseded === true,
    releasePackageManifestVerified: json.npmDryRun?.assertions?.packageContentsIncludePracticeCatalog === true
      && json.npmDryRun?.assertions?.packageContentsIncludePracticeSchemas === true
      && json.npmDryRun?.assertions?.packageContentsIncludeAttributionNotice === true,
    localTarballLifecycleVerified: json.localTarball?.runtime?.practices?.valid === true
      && json.localTarball?.lifecycle?.upgrade === "reinstall-retained-state"
      && json.localTarball?.lifecycle?.uninstall === "package-removed-state-retained",
    rollbackCompatibilityVerified: json.rollbackCompat?.status === "verified"
      && json.rollbackCompat?.evidence?.assertions?.rollbackKeepsLegacyAttestationAuditOnly === true
      && json.rollbackCompat?.evidence?.assertions?.actionVersionPinningBlocksUnsafeRollback === true,
    staleCatalogDetected: json.runtime?.assertions?.staleCatalogDetected === true,
    context7PurgeCommandImplemented: includesAll(texts.runtimeDaemonSource, ["input.command === \"purge\"", "purgeExternalDocumentation"]),
    cachePurgeRunbookDocumented: includesAll(texts.practiceRunbook, ["archctx docs purge --all", "cache purge"]) ||
      includesAll(texts.upgradeRollbackRunbook, ["archctx docs purge --all", "Catalog Revision And Session Stale Drill"]),
    upgradeRollbackRunbookCoversPracticeAssets: includesAll(texts.upgradeRollbackRunbook, ["Practice Assets v1 Release Drill", "False-Positive Rollback", "Catalog Revision And Session Stale Drill"])
  };

  const assertions = {
    documentationComplete: Object.values(documentation).every(Boolean),
    independentDisableComplete: Object.values(independentDisable).every(Boolean),
    centralHookComplete: Object.values(centralHook).every(Boolean),
    operationsComplete: Object.values(operations).every(Boolean),
    noPrivateContent: scanPatterns(JSON.stringify({ documentation, independentDisable, centralHook, operations }), SECRET_PATTERNS) === 0
      && scanPatterns(JSON.stringify({ documentation, independentDisable, centralHook, operations }), CODE_CONTENT_PATTERNS) === 0
  };

  return { documentation, independentDisable, centralHook, operations, assertions };
}

function renderReport(packet: any) {
  const status = packet.ok ? "verified" : "failed";
  return `# Practice Assets S6 Docs Ops Readback

- Task: S6-34 through S6-40 and S6-EG5 through S6-EG7
- Environment: local-release-readback
- Scope: current documentation and CLI adapter contract; referenced runtime/network packets are historical fixtures, not a fresh installed-host capture.
- Generated At: ${packet.generatedAt}
- Status: ${status}

## Decision

${packet.ok ? "PASS: documentation, operations, rollout controls, central Hook readback, independent disable controls, and rollback/cache/stale drills are verified." : "FAIL: one or more docs/ops gates are incomplete."}

## Evidence Groups

| Group | Result |
|---|---|
| Documentation | ${passFail(packet.evidence.assertions.documentationComplete)} |
| Independent disable | ${passFail(packet.evidence.assertions.independentDisableComplete)} |
| Central Hook | ${passFail(packet.evidence.assertions.centralHookComplete)} |
| Operations | ${passFail(packet.evidence.assertions.operationsComplete)} |
| DLP | ${passFail(packet.evidence.assertions.noPrivateContent)} |

## Sources

- README trust boundary: \`${PATHS.readme}\`
- Operations runbook: \`${PATHS.practiceRunbook}\`
- Upgrade/rollback runbook: \`${PATHS.upgradeRollbackRunbook}\`
- Hook policy: \`${PATHS.hookReadme}\`
- Evidence JSON: \`${DEFAULT_OUTPUT}\`
`;
}

function renderHuman(packet: any) {
  return `[practice-assets-s6-docs-ops-readback] ${packet.ok ? "PASS" : "FAIL"} documentation=${packet.evidence.assertions.documentationComplete} disable=${packet.evidence.assertions.independentDisableComplete} hook=${packet.evidence.assertions.centralHookComplete} operations=${packet.evidence.assertions.operationsComplete}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }) {
  return result.ok
    ? "[practice-assets-s6-docs-ops-readback] OK"
    : `[practice-assets-s6-docs-ops-readback] FAILED\n${result.failures.map((failure) => `- ${failure}`).join("\n")}`;
}

function passFail(value: boolean) {
  return value ? "PASS" : "FAIL";
}

function allTrue(keys: readonly string[]) {
  return Object.fromEntries(keys.map((key) => [key, true]));
}

function includesAll(text: string, terms: string[]) {
  return terms.every((term) => text.includes(term));
}

function sameSet(value: unknown, expected: string[]) {
  return Array.isArray(value)
    && value.length === expected.length
    && expected.every((item) => value.includes(item));
}

function readRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

async function readText(root: string, path: string) {
  return readFile(resolve(root, path), "utf8");
}

async function readJson(root: string, path: string) {
  return JSON.parse(await readText(root, path));
}

async function writeJson(root: string, path: string, value: unknown) {
  await writeText(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(root: string, path: string, value: string) {
  const absolute = resolve(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, value, "utf8");
}

function scanPatterns(text: string, patterns: readonly RegExp[]) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function readFlag(args: string[], flag: string) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}
