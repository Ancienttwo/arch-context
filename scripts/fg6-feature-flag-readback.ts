#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { checkDeliveryIdempotencyKey } from "@archcontext/cloud/cloud-db";
import { CHALLENGE_API_REQUEST_SCHEMA_VERSIONS, ControlPlane } from "@archcontext/cloud/control-plane";
import { GitHubAppState } from "@archcontext/cloud/github-app";
import {
  DEVELOPER_REVIEW_CHECK_NAME,
  ORGANIZATION_RUNNER_CHECK_NAME,
  checkNameForRequiredTrust,
  evaluateGovernanceFeatureFlags,
  requiredTrustForCheckName,
  type CheckDelivery
} from "@archcontext/contracts";

const DEFAULT_OUTPUT = "docs/verification/fg6-feature-flag-readback.json";
const DEFAULT_REPORT = "docs/verification/fg6-feature-flag.md";
const CONTRACT_SOURCE = "packages/contracts/src/github-governance.ts";
const CONTROL_PLANE_SOURCE = "packages/cloud/control-plane/src/index.ts";
const GITHUB_APP_SOURCE = "packages/cloud/github-app/src/index.ts";
const CONTRACT_TEST = "packages/contracts/test/contracts.test.ts";
const CONTROL_PLANE_TEST = "packages/cloud/control-plane/test/control-plane.test.ts";
const GITHUB_APP_TEST = "packages/cloud/github-app/test/github-app.test.ts";
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

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildFg6FeatureFlagReadbackConfig(process.env, args);
    const result = await runFg6FeatureFlagReadback(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg6FeatureFlagReadback(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg6-feature-flag-readback] usage: run|inspect [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg6FeatureFlagReadbackConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG6_FEATURE_FLAG_OUTPUT ?? DEFAULT_OUTPUT,
    reportPath: readFlag(args, "--report") ?? env.ARCHCONTEXT_FG6_FEATURE_FLAG_REPORT ?? DEFAULT_REPORT,
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg6FeatureFlagReadback(config: ReturnType<typeof buildFg6FeatureFlagReadbackConfig>) {
  const [contractSource, controlPlaneSource, githubAppSource, contractTest, controlPlaneTest, githubAppTest] = await Promise.all([
    readText(config.root, CONTRACT_SOURCE),
    readText(config.root, CONTROL_PLANE_SOURCE),
    readText(config.root, GITHUB_APP_SOURCE),
    readText(config.root, CONTRACT_TEST),
    readText(config.root, CONTROL_PLANE_TEST),
    readText(config.root, GITHUB_APP_TEST)
  ]);
  const contractDecisions = summarizeContractDecisions();
  const githubAppProbe = runGithubAppFeatureFlagProbe();
  const controlPlaneProbe = runControlPlaneFeatureFlagProbe();
  const sourceCoverage = summarizeSourceCoverage({
    contractSource,
    controlPlaneSource,
    githubAppSource,
    contractTest,
    controlPlaneTest,
    githubAppTest
  });
  const assertions = {
    contractFlagsComplete: contractDecisions.defaultDeveloperCheck === true
      && contractDecisions.defaultOrganizationCheck === true
      && contractDecisions.defaultRequiredTrust === true
      && contractDecisions.developerDisabledReason === "developer-check-disabled"
      && contractDecisions.organizationDisabledReason === "organization-check-disabled"
      && contractDecisions.requiredTrustDisabledReason === "required-trust-disabled",
    githubAppDeveloperCheckFlagBlocksSideEffects: githubAppProbe.developerCheckDisabled.checkCreated === false
      && githubAppProbe.developerCheckDisabled.challengeCreated === false,
    githubAppOrganizationCheckFlagBlocksSideEffects: githubAppProbe.organizationCheckDisabled.checkCreated === false
      && githubAppProbe.organizationCheckDisabled.challengeCreated === false,
    githubAppRequiredTrustFlagFallsBackToDeveloperCheck: githubAppProbe.requiredTrustDisabled.checkName === DEVELOPER_REVIEW_CHECK_NAME
      && githubAppProbe.requiredTrustDisabled.challengeCreated === true
      && githubAppProbe.requiredTrustDisabled.organizationDecisionReason === "required-trust-disabled",
    controlPlaneFeatureFlagsRejectNewSideEffects: controlPlaneProbe.developerCreateError === "governance-feature-disabled: developer-check-disabled"
      && controlPlaneProbe.organizationCreateError === "governance-feature-disabled: organization-check-disabled"
      && controlPlaneProbe.requiredTrustCreateError === "governance-feature-disabled: required-trust-disabled"
      && controlPlaneProbe.queueRejectError === "governance-feature-disabled: developer-check-disabled",
    checkNameMappingStable: contractDecisions.developerCheckName === DEVELOPER_REVIEW_CHECK_NAME
      && contractDecisions.organizationCheckName === ORGANIZATION_RUNNER_CHECK_NAME
      && contractDecisions.developerRequiredTrust === "developer"
      && contractDecisions.organizationRequiredTrust === "organization",
    sourceCoverageComplete: Object.values(sourceCoverage).every((value) => value === true),
    noPrivateContent: scanPatterns(JSON.stringify({ contractDecisions, githubAppProbe, controlPlaneProbe, sourceCoverage }), SECRET_PATTERNS) === 0
      && scanPatterns(JSON.stringify({ contractDecisions, githubAppProbe, controlPlaneProbe, sourceCoverage }), CODE_CONTENT_PATTERNS) === 0
  };
  const recording = {
    schemaVersion: "archcontext.fg6-feature-flag-readback/v1",
    taskId: "FG6-17",
    environment: "local-release-readback",
    status: "verified",
    ok: true,
    generatedAt: config.generatedAt(),
    sources: {
      contractSource: CONTRACT_SOURCE,
      controlPlaneSource: CONTROL_PLANE_SOURCE,
      githubAppSource: GITHUB_APP_SOURCE,
      contractTest: CONTRACT_TEST,
      controlPlaneTest: CONTROL_PLANE_TEST,
      githubAppTest: GITHUB_APP_TEST,
      reportPath: config.reportPath
    },
    evidence: {
      contractDecisions,
      githubAppProbe,
      controlPlaneProbe,
      sourceCoverage,
      assertions
    },
    failures: [] as string[]
  };
  const inspection = inspectFg6FeatureFlagReadback(recording);
  recording.status = inspection.ok ? "verified" : "failed";
  recording.ok = inspection.ok;
  recording.failures = inspection.failures;
  await writeText(config.root, config.reportPath, renderReport(recording));
  await writeJson(config.root, config.outputPath, recording);
  return recording;
}

export function inspectFg6FeatureFlagReadback(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const contract = readRecord(evidence.contractDecisions);
  const github = readRecord(evidence.githubAppProbe);
  const control = readRecord(evidence.controlPlaneProbe);
  const coverage = readRecord(evidence.sourceCoverage);
  const assertions = readRecord(evidence.assertions);

  if (record.schemaVersion !== "archcontext.fg6-feature-flag-readback/v1") failures.push("schemaVersion mismatch");
  if (record.taskId !== "FG6-17") failures.push("taskId must be FG6-17");
  if (record.environment !== "local-release-readback") failures.push("environment must be local-release-readback");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  if (contract.developerDisabledReason !== "developer-check-disabled") failures.push("Developer Check disabled reason missing");
  if (contract.organizationDisabledReason !== "organization-check-disabled") failures.push("Organization Check disabled reason missing");
  if (contract.requiredTrustDisabledReason !== "required-trust-disabled") failures.push("requiredTrust disabled reason missing");
  if (contract.developerCheckName !== DEVELOPER_REVIEW_CHECK_NAME) failures.push("Developer Check mapping drifted");
  if (contract.organizationCheckName !== ORGANIZATION_RUNNER_CHECK_NAME) failures.push("Organization Check mapping drifted");
  const githubDeveloper = readRecord(github.developerCheckDisabled);
  const githubOrganization = readRecord(github.organizationCheckDisabled);
  const githubRequiredTrust = readRecord(github.requiredTrustDisabled);
  if (githubDeveloper.checkCreated !== false || githubDeveloper.challengeCreated !== false) failures.push("Developer Check flag must block GitHub side effects");
  if (githubOrganization.checkCreated !== false || githubOrganization.challengeCreated !== false) failures.push("Organization Check flag must block GitHub side effects");
  if (githubRequiredTrust.checkName !== DEVELOPER_REVIEW_CHECK_NAME || githubRequiredTrust.challengeCreated !== true) {
    failures.push("requiredTrust disabled must fall back to Developer Check");
  }
  if (githubRequiredTrust.organizationDecisionReason !== "required-trust-disabled") failures.push("requiredTrust disabled decision missing");
  if (control.developerCreateError !== "governance-feature-disabled: developer-check-disabled") failures.push("Control Plane must reject disabled Developer Check challenge");
  if (control.organizationCreateError !== "governance-feature-disabled: organization-check-disabled") failures.push("Control Plane must reject disabled Organization Check challenge");
  if (control.requiredTrustCreateError !== "governance-feature-disabled: required-trust-disabled") failures.push("Control Plane must reject disabled requiredTrust challenge");
  if (control.queueAllowedCheckName !== DEVELOPER_REVIEW_CHECK_NAME) failures.push("Control Plane queue allow path must keep Developer Check name");
  if (control.queueRejectError !== "governance-feature-disabled: developer-check-disabled") failures.push("Control Plane queue must reject disabled Developer Check");
  for (const [key, value] of Object.entries(coverage)) {
    if (value !== true) failures.push(`source coverage missing: ${key}`);
  }
  for (const [key, value] of Object.entries(assertions)) {
    if (value !== true) failures.push(`assertion ${key} must be true`);
  }
  const serialized = JSON.stringify(recording);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden secret marker: ${pattern}`);
  }
  for (const pattern of CODE_CONTENT_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden code-content marker: ${pattern}`);
  }
  return { ok: failures.length === 0, failures };
}

function summarizeContractDecisions() {
  const defaultDeveloper = evaluateGovernanceFeatureFlags({ requiredTrust: "developer" });
  const defaultOrganization = evaluateGovernanceFeatureFlags({ requiredTrust: "organization" });
  const developerDisabled = evaluateGovernanceFeatureFlags({
    requiredTrust: "developer",
    flags: { developerCheck: false }
  });
  const organizationDisabled = evaluateGovernanceFeatureFlags({
    requiredTrust: "organization",
    flags: { organizationCheck: false }
  });
  const requiredTrustDisabled = evaluateGovernanceFeatureFlags({
    requiredTrust: "organization",
    flags: { requiredTrust: false }
  });
  return {
    defaultDeveloperCheck: defaultDeveloper.flags.developerCheck,
    defaultOrganizationCheck: defaultOrganization.flags.organizationCheck,
    defaultRequiredTrust: defaultOrganization.flags.requiredTrust,
    developerDisabledReason: developerDisabled.reason,
    organizationDisabledReason: organizationDisabled.reason,
    requiredTrustDisabledReason: requiredTrustDisabled.reason,
    developerCheckName: checkNameForRequiredTrust("developer"),
    organizationCheckName: checkNameForRequiredTrust("organization"),
    developerRequiredTrust: requiredTrustForCheckName(DEVELOPER_REVIEW_CHECK_NAME),
    organizationRequiredTrust: requiredTrustForCheckName(ORGANIZATION_RUNNER_CHECK_NAME),
    metadataDigests: [
      defaultDeveloper.metadataDigest,
      defaultOrganization.metadataDigest,
      developerDisabled.metadataDigest,
      organizationDisabled.metadataDigest,
      requiredTrustDisabled.metadataDigest
    ]
  };
}

function runGithubAppFeatureFlagProbe() {
  const developerOff = new GitHubAppState(undefined, { developerCheck: false });
  developerOff.install(["ancienttwo/arch-context"]);
  const developer = developerOff.handlePullRequest({
    deliveryId: "fg6-feature-dev-off",
    action: "opened",
    repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
    pullRequest: { number: 71, headSha: "a".repeat(40) }
  });

  const organizationOff = new GitHubAppState(undefined, { organizationCheck: false });
  organizationOff.install(["ancienttwo/arch-context"]);
  organizationOff.requireOrganizationAttestation("ancienttwo/arch-context");
  const organization = organizationOff.handlePullRequest({
    deliveryId: "fg6-feature-org-off",
    action: "opened",
    repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
    pullRequest: { number: 72, headSha: "b".repeat(40) }
  });

  const requiredTrustOff = new GitHubAppState(undefined, { requiredTrust: false });
  requiredTrustOff.install(["ancienttwo/arch-context"]);
  requiredTrustOff.requireOrganizationAttestation("ancienttwo/arch-context");
  const requiredTrust = requiredTrustOff.handlePullRequest({
    deliveryId: "fg6-feature-required-trust-off",
    action: "opened",
    repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
    pullRequest: { number: 73, headSha: "c".repeat(40) }
  });
  const organizationDecision = requiredTrustOff.evaluateGovernanceFeatureFlags({ requiredTrust: "organization" });

  return {
    developerCheckDisabled: {
      checkCreated: Boolean(developer.checkRun),
      challengeCreated: Boolean(developer.challenge),
      checkCount: developerOff.checks.size,
      challengeCount: developerOff.challenges.size
    },
    organizationCheckDisabled: {
      checkCreated: Boolean(organization.checkRun),
      challengeCreated: Boolean(organization.challenge),
      checkCount: organizationOff.checks.size,
      challengeCount: organizationOff.challenges.size
    },
    requiredTrustDisabled: {
      checkName: requiredTrust.checkRun?.name ?? null,
      challengeCreated: Boolean(requiredTrust.challenge),
      checkCount: requiredTrustOff.checks.size,
      challengeCount: requiredTrustOff.challenges.size,
      organizationDecisionAllowed: organizationDecision.allowed,
      organizationDecisionReason: organizationDecision.reason
    }
  };
}

function runControlPlaneFeatureFlagProbe() {
  const cp = new ControlPlane();
  cp.setGovernanceFeatureFlags({ developerCheck: false });
  const developerCreateError = captureError(() => cp.createReviewChallengeApi(challengeRequest("fg6_feature_developer_off", "developer")));
  cp.setGovernanceFeatureFlags({ organizationCheck: false });
  const organizationCreateError = captureError(() => cp.createReviewChallengeApi(challengeRequest("fg6_feature_organization_off", "organization")));
  cp.setGovernanceFeatureFlags({ requiredTrust: false });
  const requiredTrustCreateError = captureError(() => cp.createReviewChallengeApi(challengeRequest("fg6_feature_required_trust_off", "organization")));
  cp.setGovernanceFeatureFlags({ developerCheck: true, organizationCheck: true, requiredTrust: true });
  const challenge = cp.createReviewChallengeApi(challengeRequest("fg6_feature_developer_on", "developer"));
  const checkDelivery: CheckDelivery = {
    schemaVersion: "archcontext.check-delivery/v1",
    deliveryId: checkDeliveryIdempotencyKey({
      challengeId: challenge.challengeId,
      checkName: DEVELOPER_REVIEW_CHECK_NAME,
      headSha: challenge.headSha
    }),
    challengeId: challenge.challengeId,
    checkRunId: null,
    checkName: DEVELOPER_REVIEW_CHECK_NAME,
    headSha: challenge.headSha,
    status: "PENDING",
    attemptCount: 0,
    nextAttemptAt: null,
    lastErrorCode: null,
    createdAt: "2026-06-20T09:05:00.000Z",
    updatedAt: "2026-06-20T09:05:00.000Z"
  };
  const queueAllowed = cp.buildCheckDeliveryQueueMessage({
    checkDelivery,
    payloadDigest: "sha256:9999999999999999999999999999999999999999999999999999999999999999"
  });
  cp.setGovernanceFeatureFlags({ developerCheck: false });
  const queueRejectError = captureError(() => cp.buildCheckDeliveryQueueMessage({
    checkDelivery,
    payloadDigest: "sha256:9999999999999999999999999999999999999999999999999999999999999999"
  }));

  return {
    developerCreateError,
    organizationCreateError,
    requiredTrustCreateError,
    queueAllowedCheckName: queueAllowed.checkName,
    queueRejectError
  };
}

function challengeRequest(label: string, requiredTrust: "developer" | "organization") {
  const suffix = label.replace(/[^a-z0-9_]/gi, "_");
  return {
    schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.create,
    idempotencyKey: `idempotency_${suffix}`,
    installationId: 10001,
    repositoryId: 20002,
    pullRequestNumber: 42,
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    nonce: `nonce_${suffix}`,
    requiredTrust,
    policyProfileId: "policy.default",
    challengeId: `chal_${suffix}`,
    createdAt: "2026-06-20T09:00:00Z",
    expiresAt: "2026-06-20T09:15:00Z"
  };
}

function summarizeSourceCoverage(input: {
  contractSource: string;
  controlPlaneSource: string;
  githubAppSource: string;
  contractTest: string;
  controlPlaneTest: string;
  githubAppTest: string;
}) {
  return {
    contractsDefaultFlags: input.contractSource.includes("DEFAULT_GOVERNANCE_FEATURE_FLAGS"),
    contractsDecisionHelper: input.contractSource.includes("evaluateGovernanceFeatureFlags"),
    contractsRequiredTrustMapping: input.contractSource.includes("checkNameForRequiredTrust") && input.contractSource.includes("requiredTrustForCheckName"),
    controlPlaneCreateGate: input.controlPlaneSource.includes("this.assertGovernanceFeatureEnabled(request.requiredTrust)"),
    controlPlaneQueueGate: input.controlPlaneSource.includes("requiredTrustForCheckName(input.checkDelivery.checkName)"),
    controlPlanePublishGate: input.controlPlaneSource.includes("this.assertGovernanceFeatureEnabled(input.challenge.requiredTrust)"),
    githubAppPrDecision: input.githubAppSource.includes("this.requiredTrustForRepository(repositoryKey)") && input.githubAppSource.includes("decision.allowed"),
    githubAppPublicationGate: input.githubAppSource.includes("this.assertGovernanceFeatureEnabled(\"developer\")")
      && input.githubAppSource.includes("this.assertGovernanceFeatureEnabled(\"organization\")"),
    contractFocusedTest: input.contractTest.includes("feature flags gate Developer Check Organization Check and requiredTrust separately"),
    controlPlaneFocusedTest: input.controlPlaneTest.includes("gates governance feature flags across Challenge and Check delivery side effects"),
    githubAppFocusedTest: input.githubAppTest.includes("feature flags gate Developer Check Organization Check and requiredTrust rollout")
  };
}

function renderReport(recording: any): string {
  const evidence = recording.evidence;
  return [
    "# FG6-17 Feature Flag Readback",
    "",
    "- Task: FG6-17",
    "- Environment: local-release-readback",
    `- Generated At: ${recording.generatedAt}`,
    `- Status: ${recording.status}`,
    "",
    "## Feature Decisions",
    "",
    "| Flag path | Result |",
    "|---|---|",
    `| Developer Check disabled | ${evidence.contractDecisions.developerDisabledReason}; GitHub checkCreated=${evidence.githubAppProbe.developerCheckDisabled.checkCreated}; Control Plane=${evidence.controlPlaneProbe.developerCreateError} |`,
    `| Organization Check disabled | ${evidence.contractDecisions.organizationDisabledReason}; GitHub checkCreated=${evidence.githubAppProbe.organizationCheckDisabled.checkCreated}; Control Plane=${evidence.controlPlaneProbe.organizationCreateError} |`,
    `| requiredTrust disabled | ${evidence.contractDecisions.requiredTrustDisabledReason}; GitHub fallback=${evidence.githubAppProbe.requiredTrustDisabled.checkName}; Control Plane=${evidence.controlPlaneProbe.requiredTrustCreateError} |`,
    `| Queue gate | allowed=${evidence.controlPlaneProbe.queueAllowedCheckName}; disabled=${evidence.controlPlaneProbe.queueRejectError} |`,
    "",
    "## Decision",
    "",
    recording.ok ? "PASS for FG6-17 release feature flag coverage." : `FAIL: ${recording.failures.join("; ")}`
  ].join("\n");
}

function renderHuman(recording: any): string {
  return recording.ok
    ? `[fg6-feature-flag-readback] ok developer=${recording.evidence.contractDecisions.developerDisabledReason} organization=${recording.evidence.contractDecisions.organizationDisabledReason} requiredTrust=${recording.evidence.contractDecisions.requiredTrustDisabledReason}`
    : `[fg6-feature-flag-readback] failed ${recording.failures.join("; ")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }): string {
  return result.ok ? "[fg6-feature-flag-readback] evidence ok" : `[fg6-feature-flag-readback] evidence failed ${result.failures.join("; ")}`;
}

async function readText(root: string, path: string): Promise<string> {
  return readFile(resolve(root, path), "utf8");
}

async function writeJson(root: string, path: string, value: unknown): Promise<void> {
  await writeText(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(root: string, path: string, value: string): Promise<void> {
  const target = resolve(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function readRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function captureError(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function scanPatterns(text: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}
