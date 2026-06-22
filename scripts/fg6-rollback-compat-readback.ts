#!/usr/bin/env bun
import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createReviewChallenge,
  createReviewChallengeV2,
  migrateLocalAttestationV1ToAuditRecord,
  signLocalAttestation
} from "@archcontext/cloud/attestation";
import {
  CHALLENGE_API_REQUEST_SCHEMA_VERSIONS,
  ControlPlane,
  KEY_API_REQUEST_SCHEMA_VERSIONS
} from "@archcontext/cloud/control-plane";
import { GitHubAppState } from "@archcontext/cloud/github-app";
import {
  createReviewActionPreflightPlan,
  REVIEW_ACTION_DEFAULTS
} from "@archcontext/cloud/runner";
import {
  ARCHCONTEXT_PRODUCT_VERSION,
  attestationV2Digest,
  checkNameForRequiredTrust,
  createAttestationV2,
  DEVELOPER_REVIEW_CHECK_NAME,
  ORGANIZATION_RUNNER_CHECK_NAME,
  requiredTrustForCheckName,
  type AttestationV2,
  type CheckDelivery,
  type ReviewChallengeV2
} from "@archcontext/contracts";

const DEFAULT_OUTPUT = "docs/verification/fg6-rollback-compat-readback.json";
const DEFAULT_REPORT = "docs/verification/fg6-rollback-compat.md";
const CONTRACT_SOURCE = "packages/contracts/src/github-governance.ts";
const CONTROL_PLANE_SOURCE = "packages/cloud/control-plane/src/index.ts";
const GITHUB_APP_SOURCE = "packages/cloud/github-app/src/index.ts";
const RUNNER_SOURCE = "packages/cloud/runner/src/index.ts";
const CONTRACT_TEST = "packages/contracts/test/contracts.test.ts";
const CONTROL_PLANE_TEST = "packages/cloud/control-plane/test/control-plane.test.ts";
const GITHUB_APP_TEST = "packages/cloud/github-app/test/github-app.test.ts";
const RUNNER_TEST = "packages/cloud/runner/test/runner.test.ts";
const OPENAPI_DOC = "docs/api/control-plane-openapi.yaml";
const COMPAT_POLICY = "docs/api/control-plane-compatibility-policy.md";
const REVIEW_ACTION_METADATA = "actions/review-action/action.yml";
const ORG_RUNNER_WORKFLOW = ".github/workflows/archcontext-organization-runner.yml";
const ORG_RUNNER_CALLER = "docs/examples/reusable-organization-runner-caller.yml";

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
    const config = buildFg6RollbackCompatReadbackConfig(process.env, args);
    const result = await runFg6RollbackCompatReadback(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg6RollbackCompatReadback(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg6-rollback-compat-readback] usage: run|inspect [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg6RollbackCompatReadbackConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG6_ROLLBACK_COMPAT_OUTPUT ?? DEFAULT_OUTPUT,
    reportPath: readFlag(args, "--report") ?? env.ARCHCONTEXT_FG6_ROLLBACK_COMPAT_REPORT ?? DEFAULT_REPORT,
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg6RollbackCompatReadback(config: ReturnType<typeof buildFg6RollbackCompatReadbackConfig>) {
  const [
    contractSource,
    controlPlaneSource,
    githubAppSource,
    runnerSource,
    contractTest,
    controlPlaneTest,
    githubAppTest,
    runnerTest,
    openApi,
    compatPolicy,
    actionMetadata,
    orgRunnerWorkflow,
    orgRunnerCaller
  ] = await Promise.all([
    readText(config.root, CONTRACT_SOURCE),
    readText(config.root, CONTROL_PLANE_SOURCE),
    readText(config.root, GITHUB_APP_SOURCE),
    readText(config.root, RUNNER_SOURCE),
    readText(config.root, CONTRACT_TEST),
    readText(config.root, CONTROL_PLANE_TEST),
    readText(config.root, GITHUB_APP_TEST),
    readText(config.root, RUNNER_TEST),
    readText(config.root, OPENAPI_DOC),
    readText(config.root, COMPAT_POLICY),
    readText(config.root, REVIEW_ACTION_METADATA),
    readText(config.root, ORG_RUNNER_WORKFLOW),
    readText(config.root, ORG_RUNNER_CALLER)
  ]);

  const schemaProbe = runSchemaVersionProbe({ openApi, compatPolicy });
  const rollbackProbe = runRollbackProbe();
  const checkContextProbe = runCheckContextProbe();
  const actionProbe = runActionVersionProbe({ actionMetadata, orgRunnerWorkflow, orgRunnerCaller });
  const sourceCoverage = summarizeSourceCoverage({
    contractSource,
    controlPlaneSource,
    githubAppSource,
    runnerSource,
    contractTest,
    controlPlaneTest,
    githubAppTest,
    runnerTest,
    openApi,
    compatPolicy,
    actionMetadata,
    orgRunnerWorkflow,
    orgRunnerCaller
  });

  const assertions = {
    schemaVersionsStrictAndDocumented: String(schemaProbe.invalidChallengeSchemaError ?? "").startsWith("challenge-api-schemaVersion-invalid")
      && String(schemaProbe.invalidKeySchemaError ?? "").startsWith("key-api-schemaVersion-invalid")
      && schemaProbe.openApiCoversAllRequestVersions === true
      && schemaProbe.policyCoversAllRequestVersions === true
      && schemaProbe.currentChallengeSchema === "archcontext.review-challenge/v2"
      && schemaProbe.currentAttestationSchema === "archcontext.attestation/v2",
    rollbackKeepsLegacyAttestationAuditOnly: rollbackProbe.migrationStatus === "legacy-audit-only"
      && rollbackProbe.requiredCheckEligible === false
      && rollbackProbe.submitAccepted === false
      && rollbackProbe.submitReasonCode === "ATTESTATION_SCHEMA_UNSUPPORTED"
      && rollbackProbe.nonceConsumed === false
      && rollbackProbe.challengeStatusAfter === "LEASED",
    checkContextsStaySeparated: checkContextProbe.developerCheckName === DEVELOPER_REVIEW_CHECK_NAME
      && checkContextProbe.organizationCheckName === ORGANIZATION_RUNNER_CHECK_NAME
      && checkContextProbe.developerCheckSuccess === true
      && checkContextProbe.organizationCheckSuccess === true
      && checkContextProbe.organizationRejectsDeveloperEvidence === true
      && checkContextProbe.developerRejectsOrganizationEvidence === true
      && checkContextProbe.controlPlaneRejectsCheckNameMismatch === true,
    actionVersionPinningBlocksUnsafeRollback: actionProbe.currentRuntimeAccepted === true
      && actionProbe.oldRuntimeRejectedReason === "runtime-version-mismatch"
      && actionProbe.actionMajorPinned === true
      && actionProbe.workflowRuntimeInputPresent === true
      && actionProbe.reusableCallerPinnedBySha === true,
    sourceCoverageComplete: Object.values(sourceCoverage).every((value) => value === true),
    noPrivateContent: scanPatterns(JSON.stringify({ schemaProbe, rollbackProbe, checkContextProbe, actionProbe, sourceCoverage }), SECRET_PATTERNS) === 0
      && scanPatterns(JSON.stringify({ schemaProbe, rollbackProbe, checkContextProbe, actionProbe, sourceCoverage }), CODE_CONTENT_PATTERNS) === 0
  };

  const recording = {
    schemaVersion: "archcontext.fg6-rollback-compat-readback/v1",
    taskId: "FG6-19",
    environment: "local-release-readback",
    status: "verified",
    ok: true,
    generatedAt: config.generatedAt(),
    sources: {
      contractSource: CONTRACT_SOURCE,
      controlPlaneSource: CONTROL_PLANE_SOURCE,
      githubAppSource: GITHUB_APP_SOURCE,
      runnerSource: RUNNER_SOURCE,
      contractTest: CONTRACT_TEST,
      controlPlaneTest: CONTROL_PLANE_TEST,
      githubAppTest: GITHUB_APP_TEST,
      runnerTest: RUNNER_TEST,
      openApi: OPENAPI_DOC,
      compatibilityPolicy: COMPAT_POLICY,
      actionMetadata: REVIEW_ACTION_METADATA,
      organizationRunnerWorkflow: ORG_RUNNER_WORKFLOW,
      organizationRunnerCaller: ORG_RUNNER_CALLER,
      reportPath: config.reportPath
    },
    evidence: {
      schemaProbe,
      rollbackProbe,
      checkContextProbe,
      actionProbe,
      sourceCoverage,
      assertions
    },
    failures: [] as string[]
  };
  const inspection = inspectFg6RollbackCompatReadback(recording);
  recording.status = inspection.ok ? "verified" : "failed";
  recording.ok = inspection.ok;
  recording.failures = inspection.failures;
  await writeText(config.root, config.reportPath, renderReport(recording));
  await writeJson(config.root, config.outputPath, recording);
  return recording;
}

export function inspectFg6RollbackCompatReadback(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const schema = readRecord(evidence.schemaProbe);
  const rollback = readRecord(evidence.rollbackProbe);
  const context = readRecord(evidence.checkContextProbe);
  const action = readRecord(evidence.actionProbe);
  const coverage = readRecord(evidence.sourceCoverage);
  const assertions = readRecord(evidence.assertions);

  if (record.schemaVersion !== "archcontext.fg6-rollback-compat-readback/v1") failures.push("schemaVersion mismatch");
  if (record.taskId !== "FG6-19") failures.push("taskId must be FG6-19");
  if (record.environment !== "local-release-readback") failures.push("environment must be local-release-readback");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  if (schema.currentChallengeSchema !== "archcontext.review-challenge/v2") failures.push("ReviewChallenge schema must stay v2");
  if (schema.currentAttestationSchema !== "archcontext.attestation/v2") failures.push("Attestation schema must stay v2");
  if (!String(schema.invalidChallengeSchemaError ?? "").startsWith("challenge-api-schemaVersion-invalid")) failures.push("Challenge API must reject old schemaVersion");
  if (!String(schema.invalidKeySchemaError ?? "").startsWith("key-api-schemaVersion-invalid")) failures.push("Key API must reject old schemaVersion");
  if (schema.openApiCoversAllRequestVersions !== true) failures.push("OpenAPI must cover current request schema versions");
  if (schema.policyCoversAllRequestVersions !== true) failures.push("compatibility policy must cover current request schema versions");
  if (rollback.migrationStatus !== "legacy-audit-only") failures.push("legacy Attestation migration must be audit-only");
  if (rollback.requiredCheckEligible !== false) failures.push("legacy Attestation must not be required-check eligible");
  if (rollback.submitAccepted !== false || rollback.submitReasonCode !== "ATTESTATION_SCHEMA_UNSUPPORTED") {
    failures.push("Control Plane must reject legacy Attestation for required checks");
  }
  if (rollback.nonceConsumed !== false) failures.push("legacy Attestation rejection must not consume nonce");
  if (rollback.challengeStatusAfter !== "LEASED") failures.push("legacy Attestation rejection must leave Challenge leased");
  if (rollback.auditRecordContainsRepositoryName !== false) failures.push("legacy audit migration must omit repository name");
  if (context.developerCheckName !== DEVELOPER_REVIEW_CHECK_NAME) failures.push("Developer Check context drifted");
  if (context.organizationCheckName !== ORGANIZATION_RUNNER_CHECK_NAME) failures.push("Organization Runner Check context drifted");
  if (context.developerCheckSuccess !== true) failures.push("Developer Check v2 success path missing");
  if (context.organizationCheckSuccess !== true) failures.push("Organization Runner v2 success path missing");
  if (context.organizationRejectsDeveloperEvidence !== true) failures.push("Organization Runner must reject developer evidence");
  if (context.developerRejectsOrganizationEvidence !== true) failures.push("Developer Review must reject organization evidence");
  if (context.controlPlaneRejectsCheckNameMismatch !== true) failures.push("Control Plane must reject check context mismatch");
  if (action.currentRuntimeAccepted !== true) failures.push("Review Action must accept current runtime version");
  if (action.oldRuntimeRejectedReason !== "runtime-version-mismatch") failures.push("Review Action must reject old runtime version");
  if (action.actionMajorPinned !== true) failures.push("Review Action major version must be pinned");
  if (action.workflowRuntimeInputPresent !== true) failures.push("Organization Runner workflow must expose runtime_version input");
  if (action.reusableCallerPinnedBySha !== true) failures.push("Reusable workflow caller must be pinned by commit SHA");
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

function runSchemaVersionProbe(input: { openApi: string; compatPolicy: string }) {
  const challenge = reviewChallengeV2({
    challengeId: "chal_fg6_rollback_schema",
    status: "LEASED"
  });
  const attestation = attestationFor({
    trustLevel: "developer",
    challenge,
    principalId: "device_fg6_schema",
    publicKeyId: "key_fg6_schema"
  });
  const allRequestVersions = [
    ...Object.values(CHALLENGE_API_REQUEST_SCHEMA_VERSIONS),
    ...Object.values(KEY_API_REQUEST_SCHEMA_VERSIONS)
  ];
  return {
    currentChallengeSchema: challenge.schemaVersion,
    currentAttestationSchema: attestation.schemaVersion,
    currentCheckDeliverySchema: "archcontext.check-delivery/v1",
    challengeRequestVersions: Object.values(CHALLENGE_API_REQUEST_SCHEMA_VERSIONS),
    keyRequestVersions: Object.values(KEY_API_REQUEST_SCHEMA_VERSIONS),
    invalidChallengeSchemaError: captureError(() => {
      new ControlPlane().createReviewChallengeApi({
        ...challengeCreateRequest("schema-v0"),
        schemaVersion: "archcontext.challenge-create-request/v0" as typeof CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.create
      });
    }),
    invalidKeySchemaError: captureError(() => {
      new ControlPlane().registerDeviceKeyApi({
        schemaVersion: "archcontext.device-key-register-request/v0" as typeof KEY_API_REQUEST_SCHEMA_VERSIONS.deviceRegister,
        accountId: "acct_fg6_schema",
        publicKeyId: "key_fg6_schema",
        publicKeyFingerprint: `sha256:${"1".repeat(64)}`,
        authorization: deviceAuthorization()
      });
    }),
    openApiCoversAllRequestVersions: allRequestVersions.every((version) => input.openApi.includes(version)),
    policyCoversAllRequestVersions: allRequestVersions.every((version) => input.compatPolicy.includes(version))
  };
}

function runRollbackProbe() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const challenge = reviewChallengeV2({
    challengeId: "chal_fg6_rollback_v1",
    nonce: "nonce_fg6_rollback_v1",
    requiredTrust: "organization",
    status: "LEASED"
  });
  const legacyChallenge = createReviewChallenge({
    repository: { provider: "github", owner: "ancienttwo", name: "arch-context", visibility: "private" },
    headSha: challenge.headSha,
    expiresAt: challenge.expiresAt
  });
  const legacyAttestation = signLocalAttestation({
    challenge: { ...legacyChallenge, challengeId: challenge.challengeId, nonce: challenge.nonce },
    worktreeDigest: `sha256:${"0".repeat(64)}`,
    reviewDigest: `sha256:${"1".repeat(64)}`,
    deviceId: "device_legacy_fg6",
    publicKeyId: "key_legacy_fg6",
    privateKey,
    issuedAt: "2026-06-20T09:00:00Z"
  });
  const migration = migrateLocalAttestationV1ToAuditRecord({
    attestation: legacyAttestation,
    migratedAt: "2026-06-20T09:20:00Z"
  });
  const result = new ControlPlane().submitReviewChallengeAttestation({
    challenge,
    attestation: legacyAttestation,
    currentPullHead: pullHeadForChallenge(challenge),
    publicKey,
    now: "2026-06-20T09:05:00Z",
    consumedNonceHashes: new Set()
  });
  const migrationText = JSON.stringify(migration);
  return {
    legacySchemaVersion: legacyAttestation.schemaVersion,
    targetSchemaVersion: migration.targetSchemaVersion,
    migrationStatus: migration.migrationStatus,
    requiredCheckEligible: migration.requiredCheckEligible,
    rejectionReasonCode: migration.rejectionReasonCode,
    submitAccepted: result.accepted,
    submitReasonCode: result.accepted ? null : result.reasonCode,
    nonceConsumed: result.consumedNonceHashes.has(result.nonceHash),
    challengeStatusAfter: result.challenge.status,
    auditRecordContainsRepositoryName: migrationText.includes("ancienttwo") || migrationText.includes("arch-context")
  };
}

function runCheckContextProbe() {
  const developerState = new GitHubAppState();
  developerState.install(["ancienttwo/arch-context"]);
  const developerCheck = developerState.handlePullRequest({
    deliveryId: "fg6-context-developer",
    action: "opened",
    repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
    pullRequest: { number: 61, headSha: "a".repeat(40) }
  }).checkRun!;
  const developerAttestation = attestationFor({
    trustLevel: "developer",
    challenge: reviewChallengeV2({ challengeId: "chal_fg6_context_dev", pullRequestNumber: 61, headSha: "a".repeat(40) }),
    principalId: "device_fg6_context",
    publicKeyId: "key_device_fg6_context"
  });
  const developerUpdated = developerState.updateDeveloperReviewCheckFromAttestation({
    checkRunId: developerCheck.id,
    accepted: true,
    attestation: developerAttestation,
    attestationDigest: attestationV2Digest(developerAttestation)
  });

  const developerRejectState = new GitHubAppState();
  developerRejectState.install(["ancienttwo/arch-context"]);
  const developerRejectCheck = developerRejectState.handlePullRequest({
    deliveryId: "fg6-context-dev-reject",
    action: "opened",
    repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
    pullRequest: { number: 62, headSha: "b".repeat(40) }
  }).checkRun!;
  const organizationForDeveloperCheck = attestationFor({
    trustLevel: "organization",
    challenge: reviewChallengeV2({ challengeId: "chal_fg6_context_dev_reject", pullRequestNumber: 62, headSha: "b".repeat(40), requiredTrust: "organization" }),
    principalId: "runner_fg6_context",
    publicKeyId: "key_runner_fg6_context"
  });
  const developerRejectUpdated = developerRejectState.updateDeveloperReviewCheckFromAttestation({
    checkRunId: developerRejectCheck.id,
    accepted: true,
    attestation: organizationForDeveloperCheck,
    attestationDigest: attestationV2Digest(organizationForDeveloperCheck)
  });

  const organizationState = new GitHubAppState();
  organizationState.install(["ancienttwo/arch-context"]);
  organizationState.requireOrganizationAttestation("ancienttwo/arch-context");
  const organizationCheck = organizationState.handlePullRequest({
    deliveryId: "fg6-context-organization",
    action: "opened",
    repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
    pullRequest: { number: 63, headSha: "c".repeat(40) }
  }).checkRun!;
  const organizationAttestation = attestationFor({
    trustLevel: "organization",
    challenge: reviewChallengeV2({ challengeId: "chal_fg6_context_org", pullRequestNumber: 63, headSha: "c".repeat(40), requiredTrust: "organization" }),
    principalId: "runner_fg6_context",
    publicKeyId: "key_runner_fg6_context"
  });
  const organizationUpdated = organizationState.updateOrganizationRunnerCheckFromAttestation({
    checkRunId: organizationCheck.id,
    accepted: true,
    attestation: organizationAttestation,
    attestationDigest: attestationV2Digest(organizationAttestation)
  });

  const organizationRejectState = new GitHubAppState();
  organizationRejectState.install(["ancienttwo/arch-context"]);
  organizationRejectState.requireOrganizationAttestation("ancienttwo/arch-context");
  const organizationRejectCheck = organizationRejectState.handlePullRequest({
    deliveryId: "fg6-context-org-reject",
    action: "opened",
    repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
    pullRequest: { number: 64, headSha: "d".repeat(40) }
  }).checkRun!;
  const developerForOrganizationCheck = attestationFor({
    trustLevel: "developer",
    challenge: reviewChallengeV2({ challengeId: "chal_fg6_context_org_reject", pullRequestNumber: 64, headSha: "d".repeat(40) }),
    principalId: "device_fg6_context",
    publicKeyId: "key_device_fg6_context"
  });
  const organizationRejectUpdated = organizationRejectState.updateOrganizationRunnerCheckFromAttestation({
    checkRunId: organizationRejectCheck.id,
    accepted: true,
    attestation: developerForOrganizationCheck,
    attestationDigest: attestationV2Digest(developerForOrganizationCheck)
  });

  const cpMismatch = new ControlPlane().publishCurrentCheckDeliverySuccess({
    challenge: reviewChallengeV2({
      challengeId: "chal_fg6_context_cp",
      requiredTrust: "developer",
      status: "SUBMITTED"
    }),
    checkDelivery: checkDeliveryForMismatch(),
    currentPullHead: pullHeadForChallenge(reviewChallengeV2({
      challengeId: "chal_fg6_context_cp",
      requiredTrust: "developer",
      status: "SUBMITTED"
    })),
    checkRunId: "check_fg6_context_cp",
    publishedAt: "2026-06-20T09:10:00Z"
  });

  return {
    developerCheckName: developerCheck.name,
    organizationCheckName: organizationCheck.name,
    developerRequiredTrust: requiredTrustForCheckName(DEVELOPER_REVIEW_CHECK_NAME),
    organizationRequiredTrust: requiredTrustForCheckName(ORGANIZATION_RUNNER_CHECK_NAME),
    developerCheckSuccess: developerUpdated.conclusion === "success" && developerUpdated.output?.title === "Developer-attested",
    organizationCheckSuccess: organizationUpdated.conclusion === "success" && organizationUpdated.output?.title === "Organization-attested",
    organizationRejectsDeveloperEvidence: organizationRejectUpdated.conclusion === "failure"
      && organizationRejectUpdated.output?.title === "Attestation required",
    developerRejectsOrganizationEvidence: developerRejectUpdated.conclusion === "failure"
      && developerRejectUpdated.output?.title === "Attestation required",
    controlPlanePublicationReason: cpMismatch.reason,
    controlPlanePublicationReasonCode: cpMismatch.reasonCode,
    controlPlaneRejectsCheckNameMismatch: cpMismatch.published === false
      && cpMismatch.reason === "check-delivery-name-mismatch"
      && cpMismatch.reasonCode === "TRUST_LEVEL_MISMATCH"
  };
}

function runActionVersionProbe(input: { actionMetadata: string; orgRunnerWorkflow: string; orgRunnerCaller: string }) {
  const artifactDigest = `sha256:${"a".repeat(64)}`;
  const runtimeArtifactUrl = `https://archcontext.repoharness.com/releases/archctx-${ARCHCONTEXT_PRODUCT_VERSION}.tgz`;
  const current = createReviewActionPreflightPlan({
    runtimeVersion: REVIEW_ACTION_DEFAULTS.runtimeVersion,
    runtimeArtifactDigest: artifactDigest,
    runtimeArtifactUrl
  });
  const old = createReviewActionPreflightPlan({
    runtimeVersion: "0.0.0",
    runtimeArtifactDigest: artifactDigest,
    runtimeArtifactUrl
  });
  return {
    currentRuntimeVersion: REVIEW_ACTION_DEFAULTS.runtimeVersion,
    currentRuntimeAccepted: current.ok === true,
    oldRuntimeRejectedReason: old.ok ? null : old.reason,
    actionPlanSchemaVersion: current.ok ? current.plan.schemaVersion : null,
    actionMajorPinned: input.actionMetadata.includes("name: ArchContext Review")
      && input.orgRunnerWorkflow.includes("uses: archcontext/review-action@v1"),
    workflowRuntimeInputPresent: input.orgRunnerWorkflow.includes("runtime_version:")
      && input.orgRunnerWorkflow.includes("runtime-version: ${{ inputs.runtime_version }}"),
    reusableCallerPinnedBySha: /\.github\/workflows\/archcontext-organization-runner\.yml@[0-9a-f]{40}/.test(input.orgRunnerCaller)
      && !input.orgRunnerCaller.includes("@main")
  };
}

function summarizeSourceCoverage(input: Record<string, string>) {
  return {
    contractCheckNamesFrozen: input.contractSource.includes('DEVELOPER_REVIEW_CHECK_NAME = "ArchContext / Developer Review"')
      && input.contractSource.includes('ORGANIZATION_RUNNER_CHECK_NAME = "ArchContext / Organization Runner"'),
    contractSchemaVersionsFrozen: input.contractSource.includes('schemaVersion: "archcontext.review-challenge/v2"')
      && input.contractSource.includes('schemaVersion: "archcontext.attestation/v2"'),
    contractTrustMappingTested: input.contractTest.includes("requiredTrustForCheckName(DEVELOPER_REVIEW_CHECK_NAME)")
      && input.contractTest.includes("requiredTrustForCheckName(ORGANIZATION_RUNNER_CHECK_NAME)"),
    controlPlaneSchemaGuards: input.controlPlaneSource.includes("assertChallengeApiRequestSchema")
      && input.controlPlaneSource.includes("assertKeyApiRequestSchema"),
    controlPlaneLegacyV1RejectTested: input.controlPlaneTest.includes("rejects Attestation v1 submissions for new required checks")
      && input.controlPlaneTest.includes("ATTESTATION_SCHEMA_UNSUPPORTED"),
    controlPlaneCheckNameMismatchTested: input.controlPlaneTest.includes("check-delivery-name-mismatch")
      && input.controlPlaneTest.includes("TRUST_LEVEL_MISMATCH"),
    githubAppContextSeparationTested: input.githubAppTest.includes("Organization Runner Check rejects developer Attestation v2 provenance")
      && input.githubAppTest.includes("Developer Review Check rejects non-developer Attestation v2 provenance"),
    runnerRuntimeVersionPinned: input.runnerSource.includes("runtime-version-mismatch")
      && input.runnerTest.includes("review-action preflight verifies runtime version and artifact digest"),
    openApiSchemaVersionsDocumented: Object.values(CHALLENGE_API_REQUEST_SCHEMA_VERSIONS).every((version) => input.openApi.includes(version))
      && Object.values(KEY_API_REQUEST_SCHEMA_VERSIONS).every((version) => input.openApi.includes(version)),
    compatibilityPolicyRollbackDocumented: input.compatPolicy.includes("rollback behavior")
      && input.compatPolicy.includes("new `schemaVersion`"),
    actionWorkflowPinned: input.actionMetadata.includes("using: node20")
      && input.orgRunnerWorkflow.includes("uses: archcontext/review-action@v1")
      && /\.github\/workflows\/archcontext-organization-runner\.yml@[0-9a-f]{40}/.test(input.orgRunnerCaller)
  };
}

function reviewChallengeV2(overrides: Partial<ReviewChallengeV2> = {}): ReviewChallengeV2 {
  return createReviewChallengeV2({
    installationId: 141544438,
    repositoryId: 987,
    pullRequestNumber: 77,
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    nonce: "nonce_fg6_rollback_compat",
    requiredTrust: "developer",
    policyProfileId: "policy.release",
    createdAt: "2026-06-20T09:00:00Z",
    expiresAt: "2026-06-20T09:15:00Z",
    status: "LEASED",
    ...overrides
  });
}

function attestationFor(input: {
  trustLevel: "developer" | "organization";
  challenge: ReviewChallengeV2;
  principalId: string;
  publicKeyId: string;
}): AttestationV2 {
  return createAttestationV2({
    challengeId: input.challenge.challengeId,
    installationId: input.challenge.installationId,
    repositoryId: input.challenge.repositoryId,
    pullRequestNumber: input.challenge.pullRequestNumber,
    headSha: input.challenge.headSha,
    baseSha: input.challenge.baseSha,
    mergeBaseSha: "c".repeat(40),
    headTreeOid: "d".repeat(40),
    worktreeDigest: `sha256:${"7".repeat(64)}`,
    modelDigest: `sha256:${"1".repeat(64)}`,
    policyDigest: `sha256:${"2".repeat(64)}`,
    codeFactsDigest: `sha256:${"3".repeat(64)}`,
    reviewDigest: `sha256:${"4".repeat(64)}`,
    result: "pass",
    execution: input.trustLevel === "organization"
      ? {
          trustLevel: "organization",
          source: "organization-runner-checkout",
          principalId: input.principalId,
          publicKeyId: input.publicKeyId,
          runnerId: "runner_fg6_context",
          workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main",
          runId: "1234567890",
          runAttempt: 1
        }
      : {
          trustLevel: "developer",
          source: "clean-commit-worktree",
          principalId: input.principalId,
          publicKeyId: input.publicKeyId
        },
    runtime: {
      version: ARCHCONTEXT_PRODUCT_VERSION,
      buildDigest: `sha256:${"5".repeat(64)}`,
      codeGraphVersion: "1.0.1",
      capabilitiesDigest: `sha256:${"6".repeat(64)}`
    },
    nonce: input.challenge.nonce,
    startedAt: "2026-06-20T09:03:00Z",
    completedAt: "2026-06-20T09:04:00Z",
    expiresAt: input.challenge.expiresAt
  });
}

function checkDeliveryForMismatch(): CheckDelivery {
  const challenge = reviewChallengeV2({
    challengeId: "chal_fg6_context_cp",
    requiredTrust: "developer",
    status: "SUBMITTED"
  });
  return {
    schemaVersion: "archcontext.check-delivery/v1",
    deliveryId: "delivery_fg6_context_cp",
    challengeId: challenge.challengeId,
    checkRunId: null,
    checkName: ORGANIZATION_RUNNER_CHECK_NAME,
    headSha: challenge.headSha,
    status: "PENDING",
    attemptCount: 1,
    createdAt: "2026-06-20T09:05:00Z",
    updatedAt: "2026-06-20T09:05:00Z"
  };
}

function pullHeadForChallenge(challenge: ReviewChallengeV2) {
  return {
    installationId: challenge.installationId,
    repositoryId: challenge.repositoryId,
    pullRequestNumber: challenge.pullRequestNumber,
    headSha: challenge.headSha,
    baseSha: challenge.baseSha
  };
}

function challengeCreateRequest(idempotencyKey: string) {
  return {
    schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.create,
    idempotencyKey,
    installationId: 141544438,
    repositoryId: 987,
    pullRequestNumber: 77,
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    nonce: "nonce_fg6_schema_request",
    requiredTrust: "developer" as const,
    policyProfileId: "policy.release",
    createdAt: "2026-06-20T09:00:00Z",
    expiresAt: "2026-06-20T09:15:00Z"
  };
}

function deviceAuthorization() {
  return {
    actorId: "actor_fg6_schema",
    accountId: "acct_fg6_schema",
    permissionSource: "test-fixture" as const,
    verifiedAt: "2026-06-20T09:00:00Z",
    reason: "fg6 rollback compatibility schema probe"
  };
}

function captureError(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function renderReport(recording: Awaited<ReturnType<typeof runFg6RollbackCompatReadback>>) {
  const evidence = recording.evidence;
  const decision = recording.ok ? "VERIFIED: rollback and compatibility gates pass." : `FAILED:\n- ${recording.failures.join("\n- ")}`;
  return [
    "# FG6 Rollback Compatibility Readback",
    "",
    `- Task: ${recording.taskId}`,
    `- Environment: ${recording.environment}`,
    `- Generated At: ${recording.generatedAt}`,
    `- Status: ${recording.status}`,
    "",
    "## Decision",
    "",
    decision,
    "",
    "## Schema Versions",
    "",
    `- ReviewChallenge: \`${evidence.schemaProbe.currentChallengeSchema}\``,
    `- Attestation: \`${evidence.schemaProbe.currentAttestationSchema}\``,
    `- Challenge API old schema rejection: \`${evidence.schemaProbe.invalidChallengeSchemaError}\``,
    `- Key API old schema rejection: \`${evidence.schemaProbe.invalidKeySchemaError}\``,
    "",
    "## Rollback Drill",
    "",
    `- Legacy migration: \`${evidence.rollbackProbe.migrationStatus}\``,
    `- Required-check eligible: \`${String(evidence.rollbackProbe.requiredCheckEligible)}\``,
    `- Submit result: accepted=\`${String(evidence.rollbackProbe.submitAccepted)}\`, reason=\`${String(evidence.rollbackProbe.submitReasonCode)}\``,
    `- Nonce consumed: \`${String(evidence.rollbackProbe.nonceConsumed)}\``,
    "",
    "## Check Contexts",
    "",
    `- Developer Check: \`${evidence.checkContextProbe.developerCheckName}\``,
    `- Organization Check: \`${evidence.checkContextProbe.organizationCheckName}\``,
    `- Mismatch rejection: \`${evidence.checkContextProbe.controlPlanePublicationReasonCode}\``,
    "",
    "## Action Version",
    "",
    `- Current runtime accepted: \`${String(evidence.actionProbe.currentRuntimeAccepted)}\``,
    `- Old runtime rejection: \`${String(evidence.actionProbe.oldRuntimeRejectedReason)}\``,
    `- Action major pinned: \`${String(evidence.actionProbe.actionMajorPinned)}\``,
    `- Reusable caller pinned by SHA: \`${String(evidence.actionProbe.reusableCallerPinnedBySha)}\``,
    ""
  ].join("\n");
}

function renderHuman(recording: Awaited<ReturnType<typeof runFg6RollbackCompatReadback>>) {
  return recording.ok
    ? "FG6 rollback compatibility readback verified"
    : `FG6 rollback compatibility readback failed:\n- ${recording.failures.join("\n- ")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }) {
  return result.ok ? "FG6 rollback compatibility readback verified" : `FG6 rollback compatibility readback invalid:\n- ${result.failures.join("\n- ")}`;
}

async function readText(root: string, path: string) {
  return readFile(resolve(root, path), "utf8");
}

async function writeJson(root: string, path: string, value: unknown) {
  await writeText(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(root: string, path: string, value: string) {
  const absolute = resolve(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, value, "utf8");
}

function readFlag(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function scanPatterns(text: string, patterns: readonly RegExp[]) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}
