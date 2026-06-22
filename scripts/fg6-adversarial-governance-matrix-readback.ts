#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { inspectFg2InstallRevokeReadback } from "./fg2-install-revoke-readback.mjs";
import { inspectFg2StagingEvidence } from "./fg2-staging-evidence-readback.mjs";
import { inspectFg3RequiredTrustStagingReadback } from "./fg3-required-trust-staging-readback";
import { inspectFg4DeveloperCannotSatisfyOrganizationReadback } from "./fg4-developer-cannot-satisfy-organization-readback";
import { inspectFg4PublicForkAdversarialReadback } from "./fg4-public-fork-adversarial-readback";
import { inspectFg4RunnerKeyLifecycleE2e } from "./fg4-runner-key-lifecycle-e2e";

const DEFAULT_FG2_STAGING_SOURCE = "docs/verification/fg2-staging-evidence.json";
const DEFAULT_PUBLIC_FORK_SOURCE = "docs/verification/fg4-public-fork-adversarial-readback.json";
const DEFAULT_INSTALL_REVOKE_SOURCE = "docs/verification/fg2-install-revoke-readback.json";
const DEFAULT_RULESET_SOURCE = "docs/verification/fg4-organization-runner-ruleset-readback.json";
const DEFAULT_DEVELOPER_DOWNGRADE_SOURCE = "docs/verification/fg4-developer-cannot-satisfy-organization-readback.json";
const DEFAULT_RUNNER_KEY_LIFECYCLE_SOURCE = "docs/verification/fg4-runner-key-lifecycle-e2e.json";
const DEFAULT_OUTPUT = "docs/verification/fg6-adversarial-governance-matrix-readback.json";
const ORGANIZATION_RUNNER_CHECK_NAME = "ArchContext / Organization Runner";
const DEVELOPER_REVIEW_CHECK_NAME = "ArchContext / Developer Review";
const EXPECTED_APP_PERMISSIONS = {
  checks: "write",
  metadata: "read",
  pull_requests: "read",
  statuses: "write"
} as const;
const FORBIDDEN_APP_PERMISSIONS = [
  "contents",
  "issues",
  "actions",
  "administration",
  "deployments",
  "members",
  "secrets",
  "workflows"
] as const;
const SECRET_PATTERNS = [
  /gh[opsu]_[A-Za-z0-9_]+/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /GITHUB_WEBHOOK_SECRET/i,
  /sha256=[a-f0-9]{64}/i,
  /keychain:\/\//i,
  /sk-[A-Za-z0-9_-]{16,}/i
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildFg6AdversarialGovernanceMatrixConfig(process.env, args);
    const result = await runFg6AdversarialGovernanceMatrix(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg6AdversarialGovernanceMatrix(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg6-adversarial-governance-matrix-readback] usage: run|inspect [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg6AdversarialGovernanceMatrixConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    fg2StagingSource: readFlag(args, "--fg2-staging-source") ?? env.ARCHCONTEXT_FG6_FG2_STAGING_SOURCE ?? DEFAULT_FG2_STAGING_SOURCE,
    publicForkSource: readFlag(args, "--public-fork-source") ?? env.ARCHCONTEXT_FG6_PUBLIC_FORK_SOURCE ?? DEFAULT_PUBLIC_FORK_SOURCE,
    installRevokeSource: readFlag(args, "--install-revoke-source") ?? env.ARCHCONTEXT_FG6_INSTALL_REVOKE_SOURCE ?? DEFAULT_INSTALL_REVOKE_SOURCE,
    rulesetSource: readFlag(args, "--ruleset-source") ?? env.ARCHCONTEXT_FG6_RULESET_SOURCE ?? DEFAULT_RULESET_SOURCE,
    developerDowngradeSource: readFlag(args, "--developer-downgrade-source") ?? env.ARCHCONTEXT_FG6_DEVELOPER_DOWNGRADE_SOURCE ?? DEFAULT_DEVELOPER_DOWNGRADE_SOURCE,
    runnerKeyLifecycleSource: readFlag(args, "--runner-key-lifecycle-source") ?? env.ARCHCONTEXT_FG6_RUNNER_KEY_LIFECYCLE_SOURCE ?? DEFAULT_RUNNER_KEY_LIFECYCLE_SOURCE,
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG6_ADVERSARIAL_GOVERNANCE_MATRIX_OUTPUT ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg6AdversarialGovernanceMatrix(config: ReturnType<typeof buildFg6AdversarialGovernanceMatrixConfig>) {
  const [
    fg2StagingSource,
    publicForkSource,
    installRevokeSource,
    rulesetSource,
    developerDowngradeSource,
    runnerKeyLifecycleSource
  ] = await Promise.all([
    readJson(resolve(config.root, config.fg2StagingSource)),
    readJson(resolve(config.root, config.publicForkSource)),
    readJson(resolve(config.root, config.installRevokeSource)),
    readJson(resolve(config.root, config.rulesetSource)),
    readJson(resolve(config.root, config.developerDowngradeSource)),
    readJson(resolve(config.root, config.runnerKeyLifecycleSource))
  ]);
  const fg2StagingInspection = await inspectFg2StagingEvidence(fg2StagingSource, {
    root: config.root,
    packetDir: dirname(config.fg2StagingSource),
    allowPending: false
  });
  const publicForkInspection = inspectFg4PublicForkAdversarialReadback(publicForkSource);
  const installRevokeInspection = inspectFg2InstallRevokeReadback(installRevokeSource);
  const rulesetInspection = inspectFg3RequiredTrustStagingReadback(rulesetSource);
  const developerDowngradeInspection = inspectFg4DeveloperCannotSatisfyOrganizationReadback(developerDowngradeSource);
  const runnerKeyLifecycleInspection = inspectFg4RunnerKeyLifecycleE2e(runnerKeyLifecycleSource);
  const appPermissions = summarizeGithubAppPermissions(fg2StagingSource);
  const publicFork = summarizePublicFork(publicForkSource);
  const installationRevoke = summarizeInstallRevoke(installRevokeSource);
  const rulesetExpectedSource = summarizeRulesetExpectedSource(rulesetSource);
  const developerPermissionDowngrade = summarizeDeveloperPermissionDowngrade(developerDowngradeSource);
  const runnerKeyLifecycle = summarizeRunnerKeyLifecycle(runnerKeyLifecycleSource);
  const recording = {
    schemaVersion: "archcontext.fg6-adversarial-governance-matrix-readback/v1",
    taskId: "FG6-09",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: config.generatedAt(),
    sources: {
      fg2StagingSource: config.fg2StagingSource,
      publicForkSource: config.publicForkSource,
      installRevokeSource: config.installRevokeSource,
      rulesetSource: config.rulesetSource,
      developerDowngradeSource: config.developerDowngradeSource,
      runnerKeyLifecycleSource: config.runnerKeyLifecycleSource
    },
    evidence: {
      appPermissions,
      publicFork,
      installationRevoke,
      rulesetExpectedSource,
      developerPermissionDowngrade,
      runnerKeyLifecycle,
      sourceInspections: {
        fg2Staging: normalizeInspection(fg2StagingInspection),
        publicFork: publicForkInspection,
        installRevoke: installRevokeInspection,
        ruleset: rulesetInspection,
        developerDowngrade: developerDowngradeInspection,
        runnerKeyLifecycle: runnerKeyLifecycleInspection
      },
      assertions: {
        minimalGithubAppPermissions: appPermissions.permissionValuesMatch === true
          && appPermissions.noExtraPermissionKeys === true
          && appPermissions.contentsPermission === "absent"
          && appPermissions.forbiddenPermissionKeys.length === 0,
        forkSecretBlocked: publicFork.githubAppProjection.challengeIssued === false
          && publicFork.githubAppProjection.challengeCount === 0
          && publicFork.signingSecretPolicy.run === false
          && publicFork.signingSecretPolicy.reasonCode === "FORK_PR_SECRET_EXPOSURE_FORBIDDEN",
        pullRequestTargetBlocked: publicFork.adversarialWorkflowPresent === true
          && publicFork.dangerousWorkflowRunCount === 0
          && publicFork.dangerousMarkerLogMatches === 0,
        installationRevokeStopsTokenChallengeAndCheck: installationRevoke.installationRevoked === true
          && installationRevoke.tokenRejectedAfterRevoke === true
          && installationRevoke.challengeCreationStopped === true
          && installationRevoke.checkUpdateStopped === true
          && installationRevoke.restoredAfterReadback === true,
        rulesetExpectedSourceBoundToApp: rulesetExpectedSource.requiredContext === ORGANIZATION_RUNNER_CHECK_NAME
          && rulesetExpectedSource.integrationIdMatchesApp === true
          && rulesetExpectedSource.enforcement === "active"
          && rulesetExpectedSource.deletedAfterReadback === true
          && rulesetExpectedSource.absentAfterDelete === true,
        developerCheckCannotSatisfyOrganizationGate: developerPermissionDowngrade.developerCheckConclusion === "success"
          && developerPermissionDowngrade.organizationCheckConclusion === "failure"
          && developerPermissionDowngrade.sameHead === true
          && developerPermissionDowngrade.distinctCheckRuns === true
          && developerPermissionDowngrade.rejectionReasonCode === "TRUST_LEVEL_MISMATCH",
        revokedRunnerKeyRejectedWithoutNonceConsumption: runnerKeyLifecycle.revokedStatus === "revoked"
          && runnerKeyLifecycle.postRevokePreflightAccepted === false
          && runnerKeyLifecycle.postRevokeSubmit.accepted === false
          && runnerKeyLifecycle.postRevokeSubmit.observedReasonCode === "RUNNER_REVOKED"
          && runnerKeyLifecycle.postRevokeSubmit.nonceHashConsumed === false
      }
    },
    failures: [] as string[]
  };
  const inspection = inspectFg6AdversarialGovernanceMatrix(recording);
  recording.status = inspection.ok ? "verified" : "failed";
  recording.ok = inspection.ok;
  recording.failures = inspection.failures;
  await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
  await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(recording, null, 2)}\n`, "utf8");
  return recording;
}

export function inspectFg6AdversarialGovernanceMatrix(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const appPermissions = readRecord(evidence.appPermissions);
  const publicFork = readRecord(evidence.publicFork);
  const installationRevoke = readRecord(evidence.installationRevoke);
  const rulesetExpectedSource = readRecord(evidence.rulesetExpectedSource);
  const developerPermissionDowngrade = readRecord(evidence.developerPermissionDowngrade);
  const runnerKeyLifecycle = readRecord(evidence.runnerKeyLifecycle);
  const sourceInspections = readRecord(evidence.sourceInspections);
  const assertions = readRecord(evidence.assertions);

  if (record.schemaVersion !== "archcontext.fg6-adversarial-governance-matrix-readback/v1") failures.push("schemaVersion mismatch");
  if (record.taskId !== "FG6-09") failures.push("taskId must be FG6-09");
  if (record.environment !== "staging-release-readback") failures.push("environment must be staging-release-readback");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  for (const [name, inspection] of Object.entries(sourceInspections)) {
    if (readRecord(inspection).ok !== true) failures.push(`${name} source inspection must pass`);
  }

  inspectGithubAppPermissions(appPermissions, failures);
  inspectPublicFork(publicFork, failures);
  inspectInstallationRevoke(installationRevoke, failures);
  inspectRulesetExpectedSource(rulesetExpectedSource, failures);
  inspectDeveloperPermissionDowngrade(developerPermissionDowngrade, failures);
  inspectRunnerKeyLifecycle(runnerKeyLifecycle, failures);
  for (const key of [
    "minimalGithubAppPermissions",
    "forkSecretBlocked",
    "pullRequestTargetBlocked",
    "installationRevokeStopsTokenChallengeAndCheck",
    "rulesetExpectedSourceBoundToApp",
    "developerCheckCannotSatisfyOrganizationGate",
    "revokedRunnerKeyRejectedWithoutNonceConsumption"
  ]) {
    if (assertions[key] !== true) failures.push(`assertion ${key} must be true`);
  }

  const serialized = JSON.stringify(recording);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden secret marker: ${pattern}`);
  }
  return { ok: failures.length === 0, failures };
}

function summarizeGithubAppPermissions(source: unknown) {
  const evidence = readRecord(readRecord(source).evidence);
  const githubApp = readRecord(evidence.githubApp);
  const permissions = readRecord(githubApp.permissions);
  const permissionKeys = Object.keys(permissions).sort();
  const expectedKeys = Object.keys(EXPECTED_APP_PERMISSIONS).sort();
  const forbiddenPermissionKeys = FORBIDDEN_APP_PERMISSIONS.filter((key) => Object.hasOwn(permissions, key));
  const rulesetExpectedSource = readRecord(evidence.rulesetExpectedSource);
  return {
    appId: githubApp.appId,
    appSlug: githubApp.appSlug,
    repositorySelection: githubApp.repositorySelection,
    repositoryCount: Array.isArray(githubApp.repositories) ? githubApp.repositories.length : 0,
    permissions: {
      checks: permissions.checks,
      metadata: permissions.metadata,
      pull_requests: permissions.pull_requests,
      statuses: permissions.statuses
    },
    permissionKeys,
    expectedKeys,
    contentsPermission: Object.hasOwn(permissions, "contents") ? permissions.contents : "absent",
    forbiddenPermissionKeys,
    noExtraPermissionKeys: sameStringSet(permissionKeys, expectedKeys),
    permissionValuesMatch: Object.entries(EXPECTED_APP_PERMISSIONS).every(([key, value]) => permissions[key] === value),
    events: Array.isArray(githubApp.events) ? githubApp.events.map(String).sort() : [],
    rulesetExpectedSource: {
      commitStatusesPermission: rulesetExpectedSource.commitStatusesPermission,
      rulesetVerified: rulesetExpectedSource.rulesetVerified,
      permissionManifestCommit: rulesetExpectedSource.permissionManifestCommit,
      adrCommit: rulesetExpectedSource.adrCommit,
      installDisclosureCommit: rulesetExpectedSource.installDisclosureCommit
    }
  };
}

function summarizePublicFork(source: unknown) {
  const record = readRecord(source);
  const repository = readRecord(record.repository);
  const secretScan = readRecord(record.secretScan);
  const forkAttempt = readRecord(record.forkAttempt);
  const pullRequest = readRecord(record.pullRequest);
  const branch = readRecord(record.adversarialBranch);
  const dangerousWorkflow = readRecord(record.dangerousWorkflow);
  const localPolicy = readRecord(record.localPolicy);
  const defaultPolicy = readRecord(localPolicy.defaultPolicy);
  const signingSecretPolicy = readRecord(localPolicy.signingSecretPolicy);
  const githubAppProjection = readRecord(localPolicy.githubAppProjection);
  const organizationRunner = readRecord(record.organizationRunner);
  return {
    baseRepository: repository.fullName,
    repositoryPrivate: repository.private,
    repositoryAllowForking: repository.allowForking,
    forkAttempted: forkAttempt.attempted,
    selectedForkOwner: forkAttempt.selectedForkOwner,
    forkRepository: forkAttempt.forkRepository,
    forkCreatedByReadback: forkAttempt.forkCreatedByReadback,
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.url,
    crossRepositoryPr: pullRequest.isCrossRepository,
    headRepository: pullRequest.headRepository,
    headRepositoryDiffers: pullRequest.headRepository !== repository.fullName,
    headSha: pullRequest.headSha,
    temporaryPrClosed: pullRequest.closedAfterReadback,
    temporaryBranchDeleted: branch.deletedAfterReadback,
    adversarialWorkflowPresent: branch.pullRequestTargetWorkflowPresentInForkCommit,
    dangerousWorkflowRunCount: Number(dangerousWorkflow.runCount ?? -1),
    dangerousMarkerLogMatches: Number(dangerousWorkflow.markerLogMatches ?? -1),
    defaultPolicy: {
      run: defaultPolicy.run,
      mode: defaultPolicy.mode,
      outputConclusion: defaultPolicy.outputConclusion,
      reasonCode: defaultPolicy.reasonCode,
      requiresSigningSecret: defaultPolicy.requiresSigningSecret
    },
    signingSecretPolicy: {
      run: signingSecretPolicy.run,
      mode: signingSecretPolicy.mode,
      outputConclusion: signingSecretPolicy.outputConclusion,
      reasonCode: signingSecretPolicy.reasonCode,
      signingSecretConfigured: signingSecretPolicy.signingSecretConfigured,
      requiresSigningSecret: signingSecretPolicy.requiresSigningSecret
    },
    githubAppProjection: {
      challengeIssued: githubAppProjection.challengeIssued,
      challengeCount: Number(githubAppProjection.challengeCount ?? -1),
      checkName: githubAppProjection.checkName,
      conclusion: githubAppProjection.conclusion,
      outputTitle: githubAppProjection.outputTitle,
      unsupportedSummary: githubAppProjection.unsupportedSummary
    },
    organizationRunner: {
      checkName: organizationRunner.checkName,
      checkRunId: organizationRunner.checkRunId,
      conclusion: organizationRunner.conclusion,
      outputTitle: organizationRunner.outputTitle
    },
    secretScan: {
      containsToken: secretScan.containsToken,
      containsPrivateKey: secretScan.containsPrivateKey,
      containsWebhookSecret: secretScan.containsWebhookSecret
    }
  };
}

function summarizeInstallRevoke(source: unknown) {
  const record = readRecord(source);
  const app = readRecord(record.app);
  const evidence = readRecord(record.evidence);
  const operations = readRecord(record.operations);
  const revoke = readRecord(operations.revoke);
  const syntheticWebhook = readRecord(operations.syntheticWebhook);
  const restore = readRecord(operations.restore);
  return {
    appId: app.appId,
    appSlug: app.appSlug,
    installationId: app.installationId,
    repository: app.repository,
    mode: app.mode,
    installationRevoked: evidence.installationRevoked,
    tokenRejectedAfterRevoke: evidence.tokenRejectedAfterRevoke,
    challengeCreationStopped: evidence.challengeCreationStopped,
    checkUpdateStopped: evidence.checkUpdateStopped,
    restoredAfterReadback: evidence.restoredAfterReadback,
    suspendStatus: readRecord(revoke.suspend).status,
    installationAccessAfterRevokeStatus: readRecord(revoke.installationAccessAfterRevoke).status,
    existingInstallationAccessProbeStatus: readRecord(revoke.existingInstallationAccessProbe).status,
    syntheticWebhookStatus: syntheticWebhook.status,
    syntheticWebhookStopPoint: syntheticWebhook.expectedStopPoint,
    installationAccessAfterRestoreStatus: readRecord(restore.installationAccessAfterRestore).status,
    checkRunsUnchanged: restore.checkRunsUnchanged,
    secretValuesPersisted: record.secretValuesPersisted,
    privateContentPersisted: record.privateContentPersisted
  };
}

function summarizeRulesetExpectedSource(source: unknown) {
  const record = readRecord(source);
  const config = readRecord(record.config);
  const evidence = readRecord(record.evidence);
  const policy = readRecord(evidence.policy);
  const verification = readRecord(policy.developerAttestationVerification);
  const developerReview = readRecord(evidence.developerReview);
  const organizationRunner = readRecord(evidence.organizationRunner);
  const ruleset = readRecord(evidence.ruleset);
  const requiredStatusCheck = readRecord(ruleset.requiredStatusCheck);
  return {
    appId: config.appId,
    repository: config.repository,
    requiredTrust: policy.requiredTrust,
    developerTrustSatisfiesOrganization: policy.developerTrustSatisfiesOrganization,
    developerAttestationAcceptedForOrganization: verification.accepted,
    rejectionReasonCode: verification.reasonCode,
    developerCheckConclusion: developerReview.conclusion,
    organizationCheckConclusion: organizationRunner.conclusion,
    requiredContext: requiredStatusCheck.context,
    integrationId: requiredStatusCheck.integrationId,
    integrationIdMatchesApp: requiredStatusCheck.integrationId === Number(config.appId),
    enforcement: ruleset.enforcement,
    target: ruleset.target,
    deletedAfterReadback: ruleset.deletedAfterReadback,
    absentAfterDelete: ruleset.absentAfterDelete
  };
}

function summarizeDeveloperPermissionDowngrade(source: unknown) {
  const record = readRecord(source);
  const config = readRecord(record.config);
  const evidence = readRecord(record.evidence);
  const policy = readRecord(evidence.policy);
  const developerReview = readRecord(evidence.developerReview);
  const organizationRunner = readRecord(evidence.organizationRunner);
  const ruleset = readRecord(evidence.ruleset);
  return {
    appId: config.appId,
    requiredTrust: policy.requiredTrust,
    developerTrustSatisfiesOrganization: policy.developerTrustSatisfiesOrganization,
    developerAttestationAcceptedForOrganization: policy.developerAttestationAcceptedForOrganization,
    rejectionReasonCode: policy.rejectionReasonCode,
    developerCheckName: developerReview.checkName,
    developerCheckRunId: developerReview.checkRunId,
    developerCheckConclusion: developerReview.conclusion,
    developerCheckTitle: developerReview.outputTitle,
    organizationCheckName: organizationRunner.checkName,
    organizationCheckRunId: organizationRunner.checkRunId,
    organizationCheckConclusion: organizationRunner.conclusion,
    organizationCheckTitle: organizationRunner.outputTitle,
    sameHead: developerReview.headSha === organizationRunner.headSha,
    distinctCheckRuns: developerReview.checkRunId !== organizationRunner.checkRunId,
    requiredContext: ruleset.requiredContext,
    integrationId: ruleset.integrationId,
    integrationIdMatchesApp: ruleset.integrationId === Number(config.appId),
    deletedAfterReadback: ruleset.deletedAfterReadback,
    absentAfterDelete: ruleset.absentAfterDelete
  };
}

function summarizeRunnerKeyLifecycle(source: unknown) {
  const evidence = readRecord(readRecord(source).evidence);
  const policy = readRecord(evidence.lifecyclePolicy);
  const rotation = readRecord(evidence.rotation);
  const previousSubmit = readRecord(rotation.previousSubmit);
  const nextSubmit = readRecord(rotation.nextSubmit);
  const revoke = readRecord(evidence.revoke);
  const postRevokeSubmit = readRecord(revoke.postRevokeSubmit);
  const audit = readRecord(evidence.audit);
  const leakCounters = readRecord(evidence.leakCounters);
  return {
    requiredCheckSubmitIdentityStatus: policy.requiredCheckSubmitIdentityStatus,
    rotatingPreviousKeyPreflightGrace: policy.rotatingPreviousKeyPreflightGrace,
    rotatingPreviousKeySubmitAllowed: policy.rotatingPreviousKeySubmitAllowed,
    previousStatus: rotation.previousStatus,
    nextStatus: rotation.nextStatus,
    previousPreflightAcceptedDuringOverlap: rotation.previousPreflightAcceptedDuringOverlap,
    previousPreflightAcceptedAfterOverlap: rotation.previousPreflightAcceptedAfterOverlap,
    previousSubmit: {
      accepted: previousSubmit.accepted,
      observedReasonCode: previousSubmit.observedReasonCode,
      nonceHashConsumed: previousSubmit.nonceHashConsumed
    },
    nextSubmit: {
      accepted: nextSubmit.accepted,
      nonceHashConsumed: nextSubmit.nonceHashConsumed
    },
    revokedStatus: revoke.status,
    postRevokePreflightAccepted: revoke.postRevokePreflightAccepted,
    postRevokeSubmit: {
      accepted: postRevokeSubmit.accepted,
      observedReasonCode: postRevokeSubmit.observedReasonCode,
      nonceHashConsumed: postRevokeSubmit.nonceHashConsumed
    },
    recoveryAction: revoke.recoveryAction,
    replacementRequired: revoke.replacementRequired,
    auditActions: Array.isArray(audit.actions) ? audit.actions.map(String) : [],
    auditMetadataOnly: audit.metadataOnly,
    leakCounters
  };
}

function inspectGithubAppPermissions(appPermissions: Record<string, unknown>, failures: string[]): void {
  const permissions = readRecord(appPermissions.permissions);
  const permissionKeys = readStringArray(appPermissions.permissionKeys);
  const expectedKeys = Object.keys(EXPECTED_APP_PERMISSIONS).sort();
  if (appPermissions.repositorySelection !== "selected") failures.push("appPermissions repositorySelection must be selected");
  if (Number(appPermissions.repositoryCount ?? 0) < 1) failures.push("appPermissions repositoryCount must be positive");
  if (!sameStringSet(permissionKeys, expectedKeys)) failures.push("appPermissions must expose only the expected permission keys");
  for (const [key, value] of Object.entries(EXPECTED_APP_PERMISSIONS)) {
    if (permissions[key] !== value) failures.push(`appPermissions.${key} must be ${value}`);
  }
  if (appPermissions.contentsPermission !== "absent") failures.push("appPermissions contents permission must be absent");
  if (readStringArray(appPermissions.forbiddenPermissionKeys).length !== 0) failures.push("appPermissions forbiddenPermissionKeys must be empty");
  if (appPermissions.noExtraPermissionKeys !== true) failures.push("appPermissions noExtraPermissionKeys must be true");
  if (appPermissions.permissionValuesMatch !== true) failures.push("appPermissions permissionValuesMatch must be true");
  const events = readStringArray(appPermissions.events);
  for (const event of ["check_run", "pull_request"]) {
    if (!events.includes(event)) failures.push(`appPermissions events missing ${event}`);
  }
  const ruleset = readRecord(appPermissions.rulesetExpectedSource);
  if (ruleset.commitStatusesPermission !== "required-and-implemented") failures.push("rulesetExpectedSource commitStatusesPermission must be required-and-implemented");
  if (ruleset.rulesetVerified !== true) failures.push("rulesetExpectedSource rulesetVerified must be true");
  for (const key of ["permissionManifestCommit", "adrCommit", "installDisclosureCommit"]) {
    if (!/^[a-f0-9]{40}$/.test(String(ruleset[key] ?? ""))) failures.push(`rulesetExpectedSource ${key} must be a commit SHA`);
  }
}

function inspectPublicFork(publicFork: Record<string, unknown>, failures: string[]): void {
  const defaultPolicy = readRecord(publicFork.defaultPolicy);
  const signingSecretPolicy = readRecord(publicFork.signingSecretPolicy);
  const projection = readRecord(publicFork.githubAppProjection);
  const runner = readRecord(publicFork.organizationRunner);
  const secretScan = readRecord(publicFork.secretScan);
  if (publicFork.repositoryPrivate !== false) failures.push("publicFork repository must be public");
  if (publicFork.repositoryAllowForking !== true) failures.push("publicFork repository must allow forking");
  if (publicFork.forkAttempted !== true) failures.push("publicFork must attempt a fork");
  if (publicFork.crossRepositoryPr !== true) failures.push("publicFork PR must be cross-repository");
  if (publicFork.headRepositoryDiffers !== true) failures.push("publicFork head repository must differ from base");
  if (publicFork.temporaryPrClosed !== true) failures.push("publicFork temporary PR must be closed");
  if (publicFork.temporaryBranchDeleted !== true) failures.push("publicFork temporary branch must be deleted");
  if (publicFork.adversarialWorkflowPresent !== true) failures.push("publicFork adversarial workflow must be present");
  if (Number(publicFork.dangerousWorkflowRunCount ?? -1) !== 0) failures.push("publicFork dangerous workflow run count must be 0");
  if (Number(publicFork.dangerousMarkerLogMatches ?? -1) !== 0) failures.push("publicFork dangerous marker matches must be 0");
  if (defaultPolicy.run !== false) failures.push("publicFork default policy must not run");
  if (defaultPolicy.outputConclusion !== "neutral") failures.push("publicFork default policy must be neutral");
  if (defaultPolicy.reasonCode !== "FORK_PR_UNSUPPORTED") failures.push("publicFork default reason must be FORK_PR_UNSUPPORTED");
  if (signingSecretPolicy.run !== false) failures.push("publicFork signing secret policy must not run");
  if (signingSecretPolicy.reasonCode !== "FORK_PR_SECRET_EXPOSURE_FORBIDDEN") failures.push("publicFork signing secret reason mismatch");
  if (signingSecretPolicy.signingSecretConfigured !== true) failures.push("publicFork signing secret scenario must be configured");
  if (signingSecretPolicy.requiresSigningSecret !== false) failures.push("publicFork signing secret policy must not require exposing secret");
  if (projection.challengeIssued !== false) failures.push("publicFork projection must not issue Challenge");
  if (Number(projection.challengeCount ?? -1) !== 0) failures.push("publicFork projection challengeCount must be 0");
  if (projection.checkName !== ORGANIZATION_RUNNER_CHECK_NAME) failures.push("publicFork projection Check name mismatch");
  if (projection.conclusion !== "neutral") failures.push("publicFork projection conclusion must be neutral");
  if (projection.outputTitle !== "Unsupported") failures.push("publicFork projection title must be Unsupported");
  if (projection.unsupportedSummary !== true) failures.push("publicFork projection must explain unsupported fork");
  if (runner.checkName !== ORGANIZATION_RUNNER_CHECK_NAME) failures.push("publicFork Organization Runner name mismatch");
  if (runner.conclusion !== "neutral") failures.push("publicFork Organization Runner must be neutral");
  if (runner.outputTitle !== "Unsupported") failures.push("publicFork Organization Runner title must be Unsupported");
  if (secretScan.containsToken !== false) failures.push("publicFork secret scan token must be false");
  if (secretScan.containsPrivateKey !== false) failures.push("publicFork secret scan private key must be false");
  if (secretScan.containsWebhookSecret !== false) failures.push("publicFork secret scan webhook secret must be false");
}

function inspectInstallationRevoke(installationRevoke: Record<string, unknown>, failures: string[]): void {
  for (const key of [
    "installationRevoked",
    "tokenRejectedAfterRevoke",
    "challengeCreationStopped",
    "checkUpdateStopped",
    "restoredAfterReadback"
  ]) {
    if (installationRevoke[key] !== true) failures.push(`installationRevoke ${key} must be true`);
  }
  if (Number(installationRevoke.suspendStatus ?? 0) !== 204) failures.push("installationRevoke suspendStatus must be 204");
  if (Number(installationRevoke.installationAccessAfterRevokeStatus ?? 0) !== 403) failures.push("installationRevoke access after revoke must be 403");
  if (Number(installationRevoke.existingInstallationAccessProbeStatus ?? 0) !== 403) failures.push("installationRevoke existing token probe must be 403");
  if (installationRevoke.syntheticWebhookStopPoint !== "github-installation-token-before-pull-head-or-check") failures.push("installationRevoke synthetic webhook stop point mismatch");
  if (Number(installationRevoke.installationAccessAfterRestoreStatus ?? 0) !== 201) failures.push("installationRevoke restore access must be 201");
  if (installationRevoke.checkRunsUnchanged !== true) failures.push("installationRevoke checkRunsUnchanged must be true");
  if (installationRevoke.secretValuesPersisted !== false) failures.push("installationRevoke secretValuesPersisted must be false");
  if (installationRevoke.privateContentPersisted !== false) failures.push("installationRevoke privateContentPersisted must be false");
}

function inspectRulesetExpectedSource(ruleset: Record<string, unknown>, failures: string[]): void {
  if (ruleset.requiredTrust !== "organization") failures.push("ruleset requiredTrust must be organization");
  if (ruleset.developerTrustSatisfiesOrganization !== false) failures.push("ruleset Developer trust must not satisfy Organization");
  if (ruleset.developerAttestationAcceptedForOrganization !== false) failures.push("ruleset Developer Attestation must be rejected for Organization");
  if (ruleset.rejectionReasonCode !== "TRUST_LEVEL_MISMATCH") failures.push("ruleset rejection reason must be TRUST_LEVEL_MISMATCH");
  if (ruleset.developerCheckConclusion !== "success") failures.push("ruleset Developer Check must be success");
  if (ruleset.organizationCheckConclusion !== "failure") failures.push("ruleset Organization Check must be failure before Organization proof");
  if (ruleset.requiredContext !== ORGANIZATION_RUNNER_CHECK_NAME) failures.push("ruleset required context must be Organization Runner");
  if (!Number.isInteger(Number(ruleset.integrationId)) || Number(ruleset.integrationId) <= 0) failures.push("ruleset integrationId must be positive");
  if (ruleset.integrationIdMatchesApp !== true) failures.push("ruleset integrationId must match App ID");
  if (ruleset.enforcement !== "active") failures.push("ruleset enforcement must be active");
  if (ruleset.target !== "branch") failures.push("ruleset target must be branch");
  if (ruleset.deletedAfterReadback !== true) failures.push("ruleset temporary rule must be deleted");
  if (ruleset.absentAfterDelete !== true) failures.push("ruleset temporary rule must be absent after delete");
}

function inspectDeveloperPermissionDowngrade(developer: Record<string, unknown>, failures: string[]): void {
  if (developer.requiredTrust !== "organization") failures.push("developer downgrade requiredTrust must be organization");
  if (developer.developerTrustSatisfiesOrganization !== false) failures.push("developer downgrade must not satisfy Organization");
  if (developer.developerAttestationAcceptedForOrganization !== false) failures.push("developer downgrade Attestation must be rejected for Organization");
  if (developer.rejectionReasonCode !== "TRUST_LEVEL_MISMATCH") failures.push("developer downgrade rejection reason must be TRUST_LEVEL_MISMATCH");
  if (developer.developerCheckName !== DEVELOPER_REVIEW_CHECK_NAME) failures.push("developer downgrade Developer Check name mismatch");
  if (developer.developerCheckConclusion !== "success") failures.push("developer downgrade Developer Check must be success");
  if (developer.developerCheckTitle !== "Developer-attested") failures.push("developer downgrade Developer Check title mismatch");
  if (developer.organizationCheckName !== ORGANIZATION_RUNNER_CHECK_NAME) failures.push("developer downgrade Organization Check name mismatch");
  if (developer.organizationCheckConclusion !== "failure") failures.push("developer downgrade Organization Check must fail");
  if (developer.organizationCheckTitle !== "Attestation required") failures.push("developer downgrade Organization Check title mismatch");
  if (developer.sameHead !== true) failures.push("developer downgrade Checks must target same head");
  if (developer.distinctCheckRuns !== true) failures.push("developer downgrade Checks must be distinct");
  if (developer.requiredContext !== ORGANIZATION_RUNNER_CHECK_NAME) failures.push("developer downgrade required context must be Organization Runner");
  if (developer.integrationIdMatchesApp !== true) failures.push("developer downgrade integrationId must match App");
  if (developer.deletedAfterReadback !== true) failures.push("developer downgrade temporary ruleset must be deleted");
  if (developer.absentAfterDelete !== true) failures.push("developer downgrade temporary ruleset must be absent after delete");
}

function inspectRunnerKeyLifecycle(lifecycle: Record<string, unknown>, failures: string[]): void {
  const previousSubmit = readRecord(lifecycle.previousSubmit);
  const nextSubmit = readRecord(lifecycle.nextSubmit);
  const postRevokeSubmit = readRecord(lifecycle.postRevokeSubmit);
  const leakCounters = readRecord(lifecycle.leakCounters);
  if (lifecycle.requiredCheckSubmitIdentityStatus !== "active-only") failures.push("runner lifecycle required submit identity must be active-only");
  if (lifecycle.rotatingPreviousKeyPreflightGrace !== true) failures.push("runner lifecycle previous key preflight grace must be true");
  if (lifecycle.rotatingPreviousKeySubmitAllowed !== false) failures.push("runner lifecycle previous key submit must be disallowed");
  if (lifecycle.previousStatus !== "rotating") failures.push("runner lifecycle previousStatus must be rotating");
  if (lifecycle.nextStatus !== "active") failures.push("runner lifecycle nextStatus must be active");
  if (lifecycle.previousPreflightAcceptedDuringOverlap !== true) failures.push("runner lifecycle previous preflight must pass during overlap");
  if (lifecycle.previousPreflightAcceptedAfterOverlap !== false) failures.push("runner lifecycle previous preflight must fail after overlap");
  if (previousSubmit.accepted !== false) failures.push("runner lifecycle previous submit must be rejected");
  if (previousSubmit.observedReasonCode !== "RUNNER_REVOKED") failures.push("runner lifecycle previous submit reason must be RUNNER_REVOKED");
  if (previousSubmit.nonceHashConsumed !== false) failures.push("runner lifecycle previous submit must not consume nonce");
  if (nextSubmit.accepted !== true) failures.push("runner lifecycle next submit must be accepted");
  if (nextSubmit.nonceHashConsumed !== true) failures.push("runner lifecycle next submit must consume nonce");
  if (lifecycle.revokedStatus !== "revoked") failures.push("runner lifecycle revoked status must be revoked");
  if (lifecycle.postRevokePreflightAccepted !== false) failures.push("runner lifecycle revoked preflight must fail");
  if (postRevokeSubmit.accepted !== false) failures.push("runner lifecycle revoked submit must be rejected");
  if (postRevokeSubmit.observedReasonCode !== "RUNNER_REVOKED") failures.push("runner lifecycle revoked submit reason must be RUNNER_REVOKED");
  if (postRevokeSubmit.nonceHashConsumed !== false) failures.push("runner lifecycle revoked submit must not consume nonce");
  if (lifecycle.recoveryAction !== "register-replacement-runner-key") failures.push("runner lifecycle recovery action mismatch");
  if (lifecycle.replacementRequired !== true) failures.push("runner lifecycle replacementRequired must be true");
  const auditActions = readStringArray(lifecycle.auditActions);
  for (const action of ["runner_key.register", "runner_key.rotate", "runner_key.revoke"]) {
    if (!auditActions.includes(action)) failures.push(`runner lifecycle audit missing ${action}`);
  }
  if (lifecycle.auditMetadataOnly !== true) failures.push("runner lifecycle audit must be metadata-only");
  for (const key of ["plaintextNonceLeaks", "privateKeyLeaks", "tokenLeaks"]) {
    if (Number(leakCounters[key] ?? 0) !== 0) failures.push(`runner lifecycle ${key} must be 0`);
  }
}

function normalizeInspection(value: unknown): { ok: boolean; failures: string[] } {
  const record = readRecord(value);
  return {
    ok: record.ok === true,
    failures: Array.isArray(record.failures) ? record.failures.map(String) : []
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function renderHuman(result: Awaited<ReturnType<typeof runFg6AdversarialGovernanceMatrix>>): string {
  return [
    `[fg6-adversarial-governance-matrix-readback] ${result.ok ? "OK" : "FAILED"}`,
    `- permissions: ${result.evidence.appPermissions.permissionKeys.join(",")}`,
    `- fork: dangerousRuns=${result.evidence.publicFork.dangerousWorkflowRunCount} challengeIssued=${result.evidence.publicFork.githubAppProjection.challengeIssued}`,
    `- revoke: tokenRejected=${result.evidence.installationRevoke.tokenRejectedAfterRevoke}`,
    `- ruleset: ${result.evidence.rulesetExpectedSource.requiredContext}`,
    ...result.failures.map((failure) => `- ${failure}`)
  ].join("\n");
}

function renderInspectHuman(result: ReturnType<typeof inspectFg6AdversarialGovernanceMatrix>): string {
  if (result.ok) return "[fg6-adversarial-governance-matrix-readback] OK";
  return ["[fg6-adversarial-governance-matrix-readback] FAILED", ...result.failures.map((failure) => `- ${failure}`)].join("\n");
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
