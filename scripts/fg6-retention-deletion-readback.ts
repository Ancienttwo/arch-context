#!/usr/bin/env bun
import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ControlPlane } from "@archcontext/cloud/control-plane";
import { inspectFg2InstallRevokeReadback } from "./fg2-install-revoke-readback.mjs";
import { inspectFg5RetentionStagingReadback } from "./fg5-retention-staging-readback";

const DEFAULT_RETENTION_SOURCE = "docs/verification/fg5-retention-staging-readback.json";
const DEFAULT_INSTALL_REVOKE_SOURCE = "docs/verification/fg2-install-revoke-readback.json";
const DEFAULT_CONTROL_PLANE_SOURCE = "packages/cloud/control-plane/src/index.ts";
const DEFAULT_CONTROL_PLANE_TEST = "packages/cloud/control-plane/test/control-plane.test.ts";
const DEFAULT_FG5_GATE = "docs/verification/fg5-control-plane-gate.md";
const DEFAULT_OUTPUT = "docs/verification/fg6-retention-deletion-readback.json";
const DEFAULT_REPORT = "docs/verification/fg6-retention-deletion.md";
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
    const config = buildFg6RetentionDeletionConfig(process.env, args);
    const result = await runFg6RetentionDeletion(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg6RetentionDeletion(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg6-retention-deletion-readback] usage: run|inspect [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg6RetentionDeletionConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    retentionSource: readFlag(args, "--retention-source") ?? env.ARCHCONTEXT_FG6_RETENTION_SOURCE ?? DEFAULT_RETENTION_SOURCE,
    installRevokeSource: readFlag(args, "--install-revoke-source") ?? env.ARCHCONTEXT_FG6_INSTALL_REVOKE_SOURCE ?? DEFAULT_INSTALL_REVOKE_SOURCE,
    controlPlaneSource: readFlag(args, "--control-plane-source") ?? env.ARCHCONTEXT_FG6_CONTROL_PLANE_SOURCE ?? DEFAULT_CONTROL_PLANE_SOURCE,
    controlPlaneTest: readFlag(args, "--control-plane-test") ?? env.ARCHCONTEXT_FG6_CONTROL_PLANE_TEST ?? DEFAULT_CONTROL_PLANE_TEST,
    fg5Gate: readFlag(args, "--fg5-gate") ?? env.ARCHCONTEXT_FG6_FG5_GATE ?? DEFAULT_FG5_GATE,
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG6_RETENTION_DELETION_OUTPUT ?? DEFAULT_OUTPUT,
    reportPath: readFlag(args, "--report") ?? env.ARCHCONTEXT_FG6_RETENTION_DELETION_REPORT ?? DEFAULT_REPORT,
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg6RetentionDeletion(config: ReturnType<typeof buildFg6RetentionDeletionConfig>) {
  const [retentionSource, installRevokeSource, controlPlaneSource, controlPlaneTest, fg5Gate] = await Promise.all([
    readJson(resolve(config.root, config.retentionSource)),
    readJson(resolve(config.root, config.installRevokeSource)),
    readFile(resolve(config.root, config.controlPlaneSource), "utf8"),
    readFile(resolve(config.root, config.controlPlaneTest), "utf8"),
    readFile(resolve(config.root, config.fg5Gate), "utf8")
  ]);
  const sourceInspections = {
    retention: inspectFg5RetentionStagingReadback(retentionSource),
    installRevoke: inspectFg2InstallRevokeReadback(installRevokeSource)
  };
  const retention = summarizeRetention(retentionSource);
  const installRevoke = summarizeInstallRevoke(installRevokeSource);
  const accountDelete = runAccountDeleteProbe();
  const sourceCoverage = summarizeSourceCoverage(controlPlaneSource, controlPlaneTest, fg5Gate);
  const assertions = {
    retentionSourceInspectionPassed: sourceInspections.retention.ok === true,
    installRevokeSourceInspectionPassed: sourceInspections.installRevoke.ok === true,
    retentionDeletesExpiredRows: retention.expiredRowsRemaining === 0
      && retention.recentRowsPreserved >= 6
      && retention.retentionPurgeAuthorizations === 0
      && retention.ordinaryDeleteRejected === true,
    installRevokeStopsTokenChallengeCheck: installRevoke.installationRevoked === true
      && installRevoke.tokenRejectedAfterRevoke === true
      && installRevoke.challengeCreationStopped === true
      && installRevoke.checkUpdateStopped === true
      && installRevoke.restoredAfterReadback === true,
    accountDeleteClearsScopedState: accountDelete.accountDeleted === true
      && accountDelete.devicesAfterDelete === 0
      && accountDelete.revokedDeviceMarkerAfterDelete === false
      && accountDelete.accountScopedNotificationProviderAfterDelete === false,
    accountDeleteSourceCovered: sourceCoverage.deleteAccountCollectsDeviceIds === true
      && sourceCoverage.deleteAccountClearsNotificationProviders === true
      && sourceCoverage.controlPlaneTestCoversAccountDelete === true,
    noPrivateContent: retention.privacy.privateContentHits === 0
      && retention.privacy.secretMarkerHits === 0
      && retention.privacy.codeContentMarkerHits === 0
      && installRevoke.secretValuesPersisted === false
      && installRevoke.privateContentPersisted === false
  };
  const recording = {
    schemaVersion: "archcontext.fg6-retention-deletion-readback/v1",
    taskId: "FG6-15",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: config.generatedAt(),
    sources: {
      retentionSource: config.retentionSource,
      installRevokeSource: config.installRevokeSource,
      controlPlaneSource: config.controlPlaneSource,
      controlPlaneTest: config.controlPlaneTest,
      fg5Gate: config.fg5Gate,
      reportPath: config.reportPath
    },
    evidence: {
      sourceInspections,
      retention,
      installRevoke,
      accountDelete,
      sourceCoverage,
      assertions
    },
    failures: [] as string[]
  };
  const inspection = inspectFg6RetentionDeletion(recording);
  recording.status = inspection.ok ? "verified" : "failed";
  recording.ok = inspection.ok;
  recording.failures = inspection.failures;
  await writeText(config.root, config.reportPath, renderReport(recording));
  await writeJson(config.root, config.outputPath, recording);
  return recording;
}

export function inspectFg6RetentionDeletion(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const sourceInspections = readRecord(evidence.sourceInspections);
  const retention = readRecord(evidence.retention);
  const retentionPrivacy = readRecord(retention.privacy);
  const installRevoke = readRecord(evidence.installRevoke);
  const accountDelete = readRecord(evidence.accountDelete);
  const sourceCoverage = readRecord(evidence.sourceCoverage);
  const assertions = readRecord(evidence.assertions);

  if (record.schemaVersion !== "archcontext.fg6-retention-deletion-readback/v1") failures.push("schemaVersion mismatch");
  if (record.taskId !== "FG6-15") failures.push("taskId must be FG6-15");
  if (record.environment !== "staging-release-readback") failures.push("environment must be staging-release-readback");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  if (readRecord(sourceInspections.retention).ok !== true) failures.push("retention source inspection must pass");
  if (readRecord(sourceInspections.installRevoke).ok !== true) failures.push("install revoke source inspection must pass");
  if (Number(retention.expiredRowsRemaining ?? -1) !== 0) failures.push("retention expiredRowsRemaining must be 0");
  if (Number(retention.recentRowsPreserved ?? 0) < 6) failures.push("retention recent rows must be preserved");
  if (Number(retention.retentionPurgeAuthorizations ?? -1) !== 0) failures.push("retention authorization table must be empty");
  if (retention.ordinaryDeleteRejected !== true) failures.push("ordinary Attestation delete must be rejected");
  if (Number(retentionPrivacy.privateContentHits ?? -1) !== 0) failures.push("retention private content hits must be 0");
  if (Number(retentionPrivacy.secretMarkerHits ?? -1) !== 0) failures.push("retention secret hits must be 0");
  if (Number(retentionPrivacy.codeContentMarkerHits ?? -1) !== 0) failures.push("retention code content hits must be 0");
  for (const key of ["installationRevoked", "tokenRejectedAfterRevoke", "challengeCreationStopped", "checkUpdateStopped", "restoredAfterReadback"]) {
    if (installRevoke[key] !== true) failures.push(`install revoke ${key} must be true`);
  }
  if (installRevoke.secretValuesPersisted !== false) failures.push("install revoke must not persist secret values");
  if (installRevoke.privateContentPersisted !== false) failures.push("install revoke must not persist private content");
  if (accountDelete.accountBeforeDelete !== true) failures.push("account delete probe must create account first");
  if (Number(accountDelete.devicesBeforeDelete ?? 0) < 1) failures.push("account delete probe must create devices first");
  if (accountDelete.revokedDeviceMarkerBeforeDelete !== true) failures.push("account delete probe must create revoked marker first");
  if (accountDelete.accountScopedNotificationProviderBeforeDelete !== true) failures.push("account delete probe must create scoped notification provider first");
  if (accountDelete.accountDeleted !== true) failures.push("account must be deleted");
  if (Number(accountDelete.devicesAfterDelete ?? -1) !== 0) failures.push("account devices must be deleted");
  if (accountDelete.revokedDeviceMarkerAfterDelete !== false) failures.push("revoked device marker must be deleted");
  if (accountDelete.accountScopedNotificationProviderAfterDelete !== false) failures.push("account-scoped notification provider must be deleted");
  for (const key of ["deleteAccountCollectsDeviceIds", "deleteAccountClearsNotificationProviders", "controlPlaneTestCoversAccountDelete", "fg5RetentionGateCovered"]) {
    if (sourceCoverage[key] !== true) failures.push(`source coverage ${key} must be true`);
  }
  for (const key of [
    "retentionSourceInspectionPassed",
    "installRevokeSourceInspectionPassed",
    "retentionDeletesExpiredRows",
    "installRevokeStopsTokenChallengeCheck",
    "accountDeleteClearsScopedState",
    "accountDeleteSourceCovered",
    "noPrivateContent"
  ]) {
    if (assertions[key] !== true) failures.push(`assertion ${key} must be true`);
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

function summarizeRetention(source: unknown) {
  const record = readRecord(source);
  const evidence = readRecord(record.evidence);
  const counts = readRecord(evidence.counts);
  const privacy = readRecord(record.privacy);
  const expiredKeys = [
    "webhookExpired",
    "unfinishedChallengeExpired",
    "verifiedAttestationExpired",
    "rejectedAttestationExpired",
    "legacyExpired",
    "checkExpired",
    "revokedRunnerExpired",
    "revokedRunnerExpiredRepositories",
    "revokedRunnerExpiredRotationWindows"
  ];
  const recentKeys = [
    "webhookRecent",
    "unfinishedChallengeRecent",
    "terminalChallengeOld",
    "verifiedAttestationRecent",
    "rejectedAttestationRecent",
    "legacyRecent",
    "checkRecent",
    "revokedRunnerRecent"
  ];
  return {
    database: evidence.database,
    ordinaryDeleteRejected: evidence.ordinaryDeleteRejected,
    policyDays: readRecord(record.policy).days,
    expiredRowsRemaining: sumCounts(counts, expiredKeys),
    recentRowsPreserved: sumCounts(counts, recentKeys),
    retentionPurgeAuthorizations: Number(counts.retentionPurgeAuthorizations ?? -1),
    counts,
    privacy: {
      privateContentHits: Number(privacy.privateContentHits ?? -1),
      secretMarkerHits: Number(privacy.secretMarkerHits ?? -1),
      codeContentMarkerHits: Number(privacy.codeContentMarkerHits ?? -1)
    }
  };
}

function summarizeInstallRevoke(source: unknown) {
  const record = readRecord(source);
  const evidence = readRecord(record.evidence);
  const operations = readRecord(record.operations);
  const revoke = readRecord(operations.revoke);
  const syntheticWebhook = readRecord(operations.syntheticWebhook);
  const restore = readRecord(operations.restore);
  return {
    appSlug: readRecord(record.app).appSlug,
    mode: readRecord(record.app).mode,
    installationRevoked: evidence.installationRevoked,
    tokenRejectedAfterRevoke: evidence.tokenRejectedAfterRevoke,
    challengeCreationStopped: evidence.challengeCreationStopped,
    checkUpdateStopped: evidence.checkUpdateStopped,
    restoredAfterReadback: evidence.restoredAfterReadback,
    installationAccessAfterRevokeStatus: readRecord(revoke.installationAccessAfterRevoke).status,
    existingInstallationAccessProbeStatus: readRecord(revoke.existingInstallationAccessProbe).status,
    syntheticWebhookStatus: syntheticWebhook.status,
    expectedStopPoint: syntheticWebhook.expectedStopPoint,
    installationAccessAfterRestoreStatus: readRecord(restore.installationAccessAfterRestore).status,
    checkRunsUnchanged: restore.checkRunsUnchanged,
    secretValuesPersisted: record.secretValuesPersisted,
    privateContentPersisted: record.privateContentPersisted
  };
}

function runAccountDeleteProbe() {
  const cp = new ControlPlane();
  const { publicKey } = generateKeyPairSync("ed25519");
  const account = cp.loginWithGitHub("fg6_delete");
  const device = cp.registerDeviceKey({
    accountId: account.id,
    publicKeyId: "key_fg6_delete",
    publicKey,
    createdAt: "2026-06-22T12:00:00.000Z"
  });
  cp.revokeDeviceKey(device.deviceId, "2026-06-22T12:05:00.000Z");
  cp.setNotificationProvider({
    schemaVersion: "archcontext.notification-provider/v1",
    id: "notification-provider.fg6-delete",
    provider: "webhook",
    enabled: true,
    target: "https://notify.example",
    secretRef: "secret://fg6-delete",
    retry: { maxAttempts: 3, backoffSeconds: 30 }
  }, { accountId: account.id });
  const providerIdsBefore = cp.listNotificationProviders({ accountId: account.id }).map((provider) => provider.id);
  const accountBefore = cp.exportAccount(account.id);
  cp.deleteAccount(account.id);
  const accountAfter = cp.exportAccount(account.id);
  const providerIdsAfter = cp.listNotificationProviders({ accountId: account.id }).map((provider) => provider.id);
  return {
    accountId: account.id,
    deviceId: device.deviceId,
    accountBeforeDelete: accountBefore.account?.id === account.id,
    devicesBeforeDelete: accountBefore.devices.length,
    revokedDeviceMarkerBeforeDelete: accountBefore.revokedDevices.includes(device.deviceId),
    accountScopedNotificationProviderBeforeDelete: providerIdsBefore.includes("notification-provider.fg6-delete"),
    accountDeleted: accountAfter.account === undefined,
    devicesAfterDelete: accountAfter.devices.length,
    revokedDeviceMarkerAfterDelete: accountAfter.revokedDevices.includes(device.deviceId),
    accountScopedNotificationProviderAfterDelete: providerIdsAfter.includes("notification-provider.fg6-delete")
  };
}

function summarizeSourceCoverage(controlPlaneSource: string, controlPlaneTest: string, fg5Gate: string) {
  return {
    deleteAccountCollectsDeviceIds: controlPlaneSource.includes("const deviceIds = [...this.deviceIdentities.values()]")
      && controlPlaneSource.includes("this.revokedDevices.delete(deviceId)"),
    deleteAccountClearsNotificationProviders: controlPlaneSource.includes("notificationProviderScopes")
      && controlPlaneSource.includes("this.notificationProviders.delete(providerId)"),
    controlPlaneTestCoversAccountDelete: controlPlaneTest.includes("notification-provider.account-delete")
      && controlPlaneTest.includes("cp.deleteAccount(account.id)")
      && controlPlaneTest.includes("revokedDevices.has(device.deviceId)).toBe(false)"),
    fg5RetentionGateCovered: fg5Gate.includes("FG5-EG5")
      && fg5Gate.includes("retention_purge_authorizations")
      && fg5Gate.includes("ordinary Attestation DELETE")
  };
}

function renderReport(recording: any): string {
  const evidence = recording.evidence;
  return `# FG6-15 Retention and Deletion Readback

- Task: FG6-15
- Environment: ${recording.environment}
- Generated At: ${recording.generatedAt}
- Status: ${recording.status}

## Coverage

| Surface | Evidence | Result |
|---|---|---|
| Remote D1 retention purge | ${recording.sources.retentionSource} | expired rows remaining ${evidence.retention.expiredRowsRemaining}; recent rows preserved ${evidence.retention.recentRowsPreserved}; authorization rows ${evidence.retention.retentionPurgeAuthorizations} |
| Installation revoke | ${recording.sources.installRevokeSource} | token rejected ${evidence.installRevoke.tokenRejectedAfterRevoke}; Challenge stopped ${evidence.installRevoke.challengeCreationStopped}; Check stopped ${evidence.installRevoke.checkUpdateStopped}; restored ${evidence.installRevoke.restoredAfterReadback} |
| Account delete | in-memory Control Plane probe | account deleted ${evidence.accountDelete.accountDeleted}; devices after delete ${evidence.accountDelete.devicesAfterDelete}; revoked marker after delete ${evidence.accountDelete.revokedDeviceMarkerAfterDelete}; scoped notification provider after delete ${evidence.accountDelete.accountScopedNotificationProviderAfterDelete} |

## Decision

${recording.ok ? "PASS" : "FAIL"} for FG6-15 retention, installation revoke, and account-delete release drill.
`;
}

function renderHuman(recording: any): string {
  return `[fg6-retention-deletion-readback] ${recording.status} expiredRowsRemaining=${recording.evidence.retention.expiredRowsRemaining} accountDeleted=${recording.evidence.accountDelete.accountDeleted}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }): string {
  return result.ok ? "[fg6-retention-deletion-readback] ok" : `[fg6-retention-deletion-readback] failed\n${result.failures.map((failure) => `- ${failure}`).join("\n")}`;
}

function sumCounts(counts: Record<string, any>, keys: string[]): number {
  return keys.reduce((sum, key) => sum + Number(counts[key] ?? 0), 0);
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function writeJson(root: string, path: string, value: unknown): Promise<void> {
  await writeText(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(root: string, path: string, value: string): Promise<void> {
  const absolutePath = resolve(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, value);
}

function readRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}
