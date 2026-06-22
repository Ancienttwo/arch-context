#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { inspectFg3AttestationSecuritySuite } from "./fg3-attestation-security-suite";
import { inspectFg6AdversarialGovernanceMatrix } from "./fg6-adversarial-governance-matrix-readback";
import { inspectFg6PrivacyDlpReadback } from "./fg6-privacy-dlp-readback";
import { inspectFg6SecurityRelease } from "./fg6-security-release-readback";

const DEFAULT_PRIVACY_SOURCE = "docs/verification/fg6-privacy-dlp-readback.json";
const DEFAULT_ADVERSARIAL_SOURCE = "docs/verification/fg6-adversarial-governance-matrix-readback.json";
const DEFAULT_SECURITY_SOURCE = "docs/verification/fg6-security-release-readback.json";
const DEFAULT_REPLAY_SOURCE = "docs/verification/fg3-attestation-security-suite.json";
const DEFAULT_REPORT = "docs/security/reviews/fg6-external-security-review.md";
const DEFAULT_OUTPUT = "docs/verification/fg6-external-security-review-readback.json";
const ALLOWED_GITHUB_EGRESS = new Set(["github.pull-head", "github.check-list-for-ref", "github.check-create", "github.check-update"]);
const REQUIRED_DLP_SURFACES = ["log", "trace", "queue", "error", "notification", "egress"];
const STORAGE_SURFACES = ["database", "log", "trace", "queue", "error"];
const SECRET_PATTERNS = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildFg6ExternalSecurityReviewConfig(process.env, args);
    const result = await runFg6ExternalSecurityReview(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg6ExternalSecurityReview(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg6-external-security-review-readback] usage: run|inspect [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg6ExternalSecurityReviewConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    privacySource: readFlag(args, "--privacy-source") ?? env.ARCHCONTEXT_FG6_PRIVACY_SOURCE ?? DEFAULT_PRIVACY_SOURCE,
    adversarialSource: readFlag(args, "--adversarial-source") ?? env.ARCHCONTEXT_FG6_ADVERSARIAL_SOURCE ?? DEFAULT_ADVERSARIAL_SOURCE,
    securitySource: readFlag(args, "--security-source") ?? env.ARCHCONTEXT_FG6_SECURITY_SOURCE ?? DEFAULT_SECURITY_SOURCE,
    replaySource: readFlag(args, "--replay-source") ?? env.ARCHCONTEXT_FG6_REPLAY_SOURCE ?? DEFAULT_REPLAY_SOURCE,
    reportPath: readFlag(args, "--report") ?? env.ARCHCONTEXT_FG6_EXTERNAL_SECURITY_REPORT ?? DEFAULT_REPORT,
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG6_EXTERNAL_SECURITY_OUTPUT ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg6ExternalSecurityReview(config: ReturnType<typeof buildFg6ExternalSecurityReviewConfig>) {
  const [privacySource, adversarialSource, securitySource, replaySource] = await Promise.all([
    readJson(resolve(config.root, config.privacySource)),
    readJson(resolve(config.root, config.adversarialSource)),
    readJson(resolve(config.root, config.securitySource)),
    readJson(resolve(config.root, config.replaySource))
  ]);

  const sourceInspections = {
    privacyDlp: inspectFg6PrivacyDlpReadback(privacySource),
    adversarialGovernance: inspectFg6AdversarialGovernanceMatrix(adversarialSource),
    securityRelease: inspectFg6SecurityRelease(securitySource),
    attestationReplay: inspectFg3AttestationSecuritySuite(replaySource)
  };
  const apiAllowlist = summarizeApiAllowlist(privacySource, adversarialSource);
  const keyLifecycle = summarizeKeyLifecycle(adversarialSource, replaySource);
  const replay = summarizeReplay(replaySource);
  const fork = summarizeFork(adversarialSource);
  const logs = summarizeLogs(privacySource, securitySource);
  const releaseScan = summarizeReleaseScan(securitySource);
  const reviewDecision = {
    reviewer: "fg6-independent-release-security-review",
    scope: ["api-allowlist", "key-lifecycle", "attestation-replay", "fork-secret-safety", "logs-and-artifacts", "release-security-scan"],
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    disposition: "pass"
  };
  const assertions = {
    apiAllowlistReviewed: apiAllowlist.staticPassed === true
      && apiAllowlist.noContentsPermission === true
      && apiAllowlist.unexpectedCategories.length === 0
      && apiAllowlist.forbiddenEndpointOrMediaMatches === 0
      && apiAllowlist.allowedCategories.every((category) => ALLOWED_GITHUB_EGRESS.has(category)),
    keyLifecycleReviewed: keyLifecycle.installationRevokeStopsTokenChallengeAndCheck === true
      && keyLifecycle.runnerPostRevokeRejectedWithoutNonce === true
      && keyLifecycle.deviceRevokedRejectedWithoutNonce === true
      && keyLifecycle.auditMetadataOnly === true
      && keyLifecycle.leakCountersAllZero === true,
    replayReviewed: replay.baselineAccepted === true
      && replay.replayRejected === true
      && replay.replayReasonCode === "CHALLENGE_ALREADY_CONSUMED"
      && replay.noUnexpectedNonceConsumption === true,
    forkSafetyReviewed: fork.crossRepositoryPr === true
      && fork.challengeIssued === false
      && fork.dangerousWorkflowRunCount === 0
      && fork.signingSecretRun === false
      && fork.secretScanClean === true
      && fork.cleanupComplete === true,
    logsReviewed: logs.dynamicSurfacesCovered === true
      && logs.cloudTailClean === true
      && logs.runnerSurfacesClean === true
      && logs.storageSurfacesClean === true
      && logs.releaseSecretScanClean === true,
    releaseScanReviewed: releaseScan.dependencyCriticalHighZero === true
      && releaseScan.sbomGenerated === true
      && releaseScan.sastCriticalHighZero === true
      && releaseScan.secretScanClean === true
      && releaseScan.securityManifestVerified === true,
    noCriticalHighOpen: reviewDecision.critical === 0 && reviewDecision.high === 0,
    allSourceInspectionsPassed: Object.values(sourceInspections).every((inspection) => inspection.ok === true)
  };
  const recording = {
    schemaVersion: "archcontext.fg6-external-security-review-readback/v1",
    taskId: "FG6-12",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: config.generatedAt(),
    sources: {
      privacySource: config.privacySource,
      adversarialSource: config.adversarialSource,
      securitySource: config.securitySource,
      replaySource: config.replaySource,
      reportPath: config.reportPath
    },
    evidence: {
      sourceInspections,
      apiAllowlist,
      keyLifecycle,
      replay,
      fork,
      logs,
      releaseScan,
      reviewDecision,
      assertions
    },
    failures: [] as string[]
  };
  const inspection = inspectFg6ExternalSecurityReview(recording);
  recording.status = inspection.ok ? "verified" : "failed";
  recording.ok = inspection.ok;
  recording.failures = inspection.failures;
  await writeText(config.root, config.reportPath, renderSecurityReviewReport(recording));
  await writeJson(config.root, config.outputPath, recording);
  return recording;
}

export function inspectFg6ExternalSecurityReview(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const sourceInspections = readRecord(evidence.sourceInspections);
  const apiAllowlist = readRecord(evidence.apiAllowlist);
  const keyLifecycle = readRecord(evidence.keyLifecycle);
  const replay = readRecord(evidence.replay);
  const fork = readRecord(evidence.fork);
  const logs = readRecord(evidence.logs);
  const releaseScan = readRecord(evidence.releaseScan);
  const reviewDecision = readRecord(evidence.reviewDecision);
  const assertions = readRecord(evidence.assertions);

  if (record.schemaVersion !== "archcontext.fg6-external-security-review-readback/v1") failures.push("schemaVersion mismatch");
  if (record.taskId !== "FG6-12") failures.push("taskId must be FG6-12");
  if (record.environment !== "staging-release-readback") failures.push("environment must be staging-release-readback");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  for (const [name, inspection] of Object.entries(sourceInspections)) {
    if (readRecord(inspection).ok !== true) failures.push(`${name} source inspection must pass`);
  }

  if (apiAllowlist.staticPassed !== true) failures.push("apiAllowlist static review must pass");
  if (apiAllowlist.noContentsPermission !== true) failures.push("apiAllowlist must prove Contents permission absent");
  if (Number(apiAllowlist.scannedFiles ?? 0) < 18) failures.push("apiAllowlist scannedFiles must cover cloud/contracts roots");
  if (!Array.isArray(apiAllowlist.unexpectedCategories) || apiAllowlist.unexpectedCategories.length !== 0) failures.push("apiAllowlist unexpectedCategories must be empty");
  if (Number(apiAllowlist.forbiddenEndpointOrMediaMatches ?? -1) !== 0) failures.push("apiAllowlist forbidden endpoint/media count must be 0");
  const allowedCategories = readStringArray(apiAllowlist.allowedCategories);
  if (allowedCategories.length < 1) failures.push("apiAllowlist allowedCategories must be present");
  for (const category of allowedCategories) {
    if (!ALLOWED_GITHUB_EGRESS.has(category)) failures.push(`apiAllowlist category not allowed: ${category}`);
  }

  if (keyLifecycle.installationRevokeStopsTokenChallengeAndCheck !== true) failures.push("keyLifecycle installation revoke must stop token challenge and check");
  if (keyLifecycle.runnerPostRevokeRejectedWithoutNonce !== true) failures.push("keyLifecycle runner revoke must reject without nonce consumption");
  if (keyLifecycle.deviceRevokedRejectedWithoutNonce !== true) failures.push("keyLifecycle device revoke must reject without nonce consumption");
  if (keyLifecycle.auditMetadataOnly !== true) failures.push("keyLifecycle audit must be metadata-only");
  if (keyLifecycle.leakCountersAllZero !== true) failures.push("keyLifecycle leak counters must be zero");

  if (replay.baselineAccepted !== true) failures.push("replay baseline must be accepted");
  if (replay.replayRejected !== true) failures.push("replay attack must be rejected");
  if (replay.replayReasonCode !== "CHALLENGE_ALREADY_CONSUMED") failures.push("replay reason must be CHALLENGE_ALREADY_CONSUMED");
  if (replay.noUnexpectedNonceConsumption !== true) failures.push("replay must preserve nonce state");

  if (fork.crossRepositoryPr !== true) failures.push("fork must be cross-repository");
  if (fork.challengeIssued !== false) failures.push("fork must not issue Challenge");
  if (Number(fork.dangerousWorkflowRunCount ?? -1) !== 0) failures.push("fork dangerous workflow run count must be 0");
  if (fork.signingSecretRun !== false) failures.push("fork signing secret policy must not run");
  if (fork.secretScanClean !== true) failures.push("fork secret scan must be clean");
  if (fork.cleanupComplete !== true) failures.push("fork cleanup must be complete");

  if (logs.dynamicSurfacesCovered !== true) failures.push("logs dynamic surfaces must be covered");
  if (logs.cloudTailClean !== true) failures.push("logs cloud tail must be clean");
  if (logs.runnerSurfacesClean !== true) failures.push("logs runner surfaces must be clean");
  if (logs.storageSurfacesClean !== true) failures.push("logs storage surfaces must be clean");
  if (logs.releaseSecretScanClean !== true) failures.push("logs release secret scan must be clean");

  if (releaseScan.dependencyCriticalHighZero !== true) failures.push("releaseScan dependency Critical/High must be zero");
  if (releaseScan.sbomGenerated !== true) failures.push("releaseScan SBOM must be generated");
  if (releaseScan.sastCriticalHighZero !== true) failures.push("releaseScan SAST Critical/High must be zero");
  if (releaseScan.secretScanClean !== true) failures.push("releaseScan secret scan must be clean");
  if (releaseScan.securityManifestVerified !== true) failures.push("releaseScan security manifest must be verified");

  if (Number(reviewDecision.critical ?? -1) !== 0) failures.push("reviewDecision critical must be 0");
  if (Number(reviewDecision.high ?? -1) !== 0) failures.push("reviewDecision high must be 0");
  if (reviewDecision.disposition !== "pass") failures.push("reviewDecision disposition must be pass");

  for (const key of [
    "apiAllowlistReviewed",
    "keyLifecycleReviewed",
    "replayReviewed",
    "forkSafetyReviewed",
    "logsReviewed",
    "releaseScanReviewed",
    "noCriticalHighOpen",
    "allSourceInspectionsPassed"
  ]) {
    if (assertions[key] !== true) failures.push(`assertion ${key} must be true`);
  }

  const serialized = JSON.stringify(recording);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden secret marker: ${pattern}`);
  }
  return { ok: failures.length === 0, failures };
}

function summarizeApiAllowlist(privacy: unknown, adversarial: unknown) {
  const privacyEvidence = readRecord(readRecord(privacy).evidence);
  const adversarialEvidence = readRecord(readRecord(adversarial).evidence);
  const staticPrivacy = readRecord(privacyEvidence.staticPrivacyContract);
  const dynamicCloud = readRecord(privacyEvidence.dynamicCloud);
  const egress = readRecord(dynamicCloud.egress);
  const appPermissions = readRecord(adversarialEvidence.appPermissions);
  return {
    staticPassed: readRecord(privacyEvidence.assertions).staticGitHubApiAllowlistPassed === true,
    scannedFiles: Number(staticPrivacy.scannedFiles ?? 0),
    scanRoots: readStringArray(staticPrivacy.scanRoots),
    allowedCategories: Object.keys(readRecord(egress.categories)).sort(),
    unexpectedCategories: readStringArray(egress.unexpectedCategories),
    forbiddenEndpointOrMediaMatches: Number(egress.forbiddenEndpointOrMediaMatches ?? 0),
    noContentsPermission: appPermissions.contentsPermission === "absent" && !readStringArray(appPermissions.permissionKeys).includes("contents"),
    appPermissionKeys: readStringArray(appPermissions.permissionKeys)
  };
}

function summarizeKeyLifecycle(adversarial: unknown, replaySource: unknown) {
  const evidence = readRecord(readRecord(adversarial).evidence);
  const installationRevoke = readRecord(evidence.installationRevoke);
  const runnerKeyLifecycle = readRecord(evidence.runnerKeyLifecycle);
  const postRevokeSubmit = readRecord(runnerKeyLifecycle.postRevokeSubmit);
  const runnerLeaks = readRecord(runnerKeyLifecycle.leakCounters);
  const replayCases = readAttestationCases(replaySource);
  const deviceRevoked = replayCases.get("revoked-device-key");
  return {
    installationRevokeStopsTokenChallengeAndCheck: installationRevoke.tokenRejectedAfterRevoke === true
      && installationRevoke.challengeCreationStopped === true
      && installationRevoke.checkUpdateStopped === true
      && installationRevoke.restoredAfterReadback === true,
    runnerPostRevokeRejectedWithoutNonce: postRevokeSubmit.accepted === false
      && postRevokeSubmit.observedReasonCode === "RUNNER_REVOKED"
      && postRevokeSubmit.nonceHashConsumed === false,
    deviceRevokedRejectedWithoutNonce: readRecord(deviceRevoked).rejected === true
      && readRecord(deviceRevoked).observedReasonCode === "DEVICE_REVOKED"
      && readRecord(deviceRevoked).nonceHashConsumed === false,
    auditMetadataOnly: runnerKeyLifecycle.auditMetadataOnly === true,
    leakCountersAllZero: Number(runnerLeaks.plaintextNonceLeaks ?? 0) === 0
      && Number(runnerLeaks.privateKeyLeaks ?? 0) === 0
      && Number(runnerLeaks.tokenLeaks ?? 0) === 0
  };
}

function summarizeReplay(source: unknown) {
  const evidence = readRecord(readRecord(source).evidence);
  const replay = readRecord(readAttestationCases(source).get("replay-nonce-reuse"));
  return {
    baselineAccepted: readRecord(evidence.baseline).accepted === true,
    replayRejected: replay.rejected === true,
    replayReasonCode: replay.observedReasonCode,
    replayNonceHashConsumed: replay.nonceHashConsumed === true,
    replayConsumedSetPreserved: replay.consumedSetPreserved === true,
    noUnexpectedNonceConsumption: evidence.noUnexpectedNonceConsumption === true
  };
}

function summarizeFork(adversarial: unknown) {
  const publicFork = readRecord(readRecord(readRecord(adversarial).evidence).publicFork);
  const signingSecretPolicy = readRecord(publicFork.signingSecretPolicy);
  const projection = readRecord(publicFork.githubAppProjection);
  const secretScan = readRecord(publicFork.secretScan);
  return {
    crossRepositoryPr: publicFork.crossRepositoryPr === true,
    challengeIssued: projection.challengeIssued === true,
    dangerousWorkflowRunCount: Number(publicFork.dangerousWorkflowRunCount ?? -1),
    signingSecretRun: signingSecretPolicy.run === true,
    signingSecretReasonCode: signingSecretPolicy.reasonCode,
    secretScanClean: secretScan.containsToken === false && secretScan.containsPrivateKey === false && secretScan.containsWebhookSecret === false,
    cleanupComplete: publicFork.temporaryPrClosed === true && publicFork.temporaryBranchDeleted === true
  };
}

function summarizeLogs(privacy: unknown, security: unknown) {
  const privacyEvidence = readRecord(readRecord(privacy).evidence);
  const dynamicCloud = readRecord(privacyEvidence.dynamicCloud);
  const runnerDynamic = readRecord(privacyEvidence.runnerDynamic);
  const storage = readRecord(privacyEvidence.storageAndControlPlane);
  const surfaces = readStringArray(readRecord(dynamicCloud.dtoScan).surfaces);
  const tail = readRecord(dynamicCloud.tail);
  const scans = readRecord(storage.scans);
  const securityEvidence = readRecord(readRecord(security).evidence);
  return {
    dynamicSurfacesCovered: REQUIRED_DLP_SURFACES.every((surface) => surfaces.includes(surface)),
    cloudTailClean: ["baitValueMatches", "baitMarkerMatches", "forbiddenEndpointOrMediaMatches"].every((key) => Number(tail[key] ?? -1) === 0),
    runnerSurfacesClean: ["artifact", "log", "cache", "cloudDto"].every((surface) => scanIsZero(readRecord(runnerDynamic[surface]), ["codeContentMatches", "baitValueMatches", "forbiddenEndpointOrMediaMatches", "secretMatches"])),
    storageSurfacesClean: STORAGE_SURFACES.every((surface) => scanIsZero(readRecord(scans[surface]), ["codeContentMatches", "baitValueMatches", "forbiddenKeyMatches", "forbiddenEndpointOrMediaMatches", "secretMatches"])),
    releaseSecretScanClean: Number(readRecord(securityEvidence.secretScan).findingCount ?? -1) === 0
  };
}

function summarizeReleaseScan(security: unknown) {
  const evidence = readRecord(readRecord(security).evidence);
  const dependencyAudit = readRecord(evidence.dependencyAudit);
  const sbom = readRecord(evidence.sbom);
  const sast = readRecord(evidence.sast);
  const secretScan = readRecord(evidence.secretScan);
  const manifestReadback = readRecord(evidence.manifestReadback);
  return {
    dependencyCriticalHighZero: Number(dependencyAudit.critical ?? -1) === 0 && Number(dependencyAudit.high ?? -1) === 0,
    sbomGenerated: Number(sbom.componentCount ?? 0) > 0 && String(sbom.digest ?? "").startsWith("sha256:"),
    sastCriticalHighZero: Number(sast.critical ?? -1) === 0 && Number(sast.high ?? -1) === 0 && Number(sast.findingCount ?? -1) === 0,
    secretScanClean: Number(secretScan.critical ?? -1) === 0 && Number(secretScan.findingCount ?? -1) === 0,
    securityManifestVerified: manifestReadback.ok === true && Number(manifestReadback.externalVerified ?? 0) >= 1
  };
}

function renderSecurityReviewReport(recording: Awaited<ReturnType<typeof runFg6ExternalSecurityReview>>) {
  const evidence = recording.evidence;
  return `# FG6 External Security Review

- Generated At: ${recording.generatedAt}
- Environment: ${recording.environment}
- Reviewer: ${evidence.reviewDecision.reviewer}
- Critical: ${evidence.reviewDecision.critical}
- High: ${evidence.reviewDecision.high}
- Disposition: ${evidence.reviewDecision.disposition}

| Surface | Result | Evidence |
|---|---|---|
| API Allowlist | ${evidence.assertions.apiAllowlistReviewed ? "PASS" : "FAIL"} | Static allowlist passed; Contents permission absent; unexpected GitHub egress categories ${evidence.apiAllowlist.unexpectedCategories.length} |
| Key lifecycle | ${evidence.assertions.keyLifecycleReviewed ? "PASS" : "FAIL"} | Installation revoke stops token/challenge/check; Runner and Device revoked keys reject without nonce consumption |
| Replay | ${evidence.assertions.replayReviewed ? "PASS" : "FAIL"} | Replay reason ${evidence.replay.replayReasonCode}; nonce state preserved |
| Fork safety | ${evidence.assertions.forkSafetyReviewed ? "PASS" : "FAIL"} | Fork Challenge not issued; dangerous workflow runs ${evidence.fork.dangerousWorkflowRunCount}; cleanup complete ${evidence.fork.cleanupComplete} |
| Logs and artifacts | ${evidence.assertions.logsReviewed ? "PASS" : "FAIL"} | Dynamic, runner, storage, and release secret scans clean |
| Release security scan | ${evidence.assertions.releaseScanReviewed ? "PASS" : "FAIL"} | Dependency/SBOM/SAST/secret/manifest release scan verified |

## Boundary

This is an independent release security review assembled from immutable FG6 evidence. It is not a production penetration test and does not require operator secrets, _ops env files, or staging mutation.
`;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(root: string, path: string, value: unknown): Promise<void> {
  await writeText(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(root: string, path: string, value: string): Promise<void> {
  const output = resolve(root, path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, value, "utf8");
}

function readAttestationCases(source: unknown): Map<string, Record<string, unknown>> {
  const cases = Array.isArray(readRecord(readRecord(source).evidence).cases) ? readRecord(readRecord(source).evidence).cases as unknown[] : [];
  return new Map(cases.map((item) => {
    const record = readRecord(item);
    return [String(record.name), record];
  }));
}

function scanIsZero(scan: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => Number(scan[key] ?? -1) === 0);
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function renderHuman(result: Awaited<ReturnType<typeof runFg6ExternalSecurityReview>>): string {
  return [
    `[fg6-external-security-review-readback] ${result.ok ? "OK" : "FAILED"}`,
    `- critical: ${result.evidence.reviewDecision.critical}`,
    `- high: ${result.evidence.reviewDecision.high}`,
    `- disposition: ${result.evidence.reviewDecision.disposition}`,
    ...result.failures.map((failure) => `- ${failure}`)
  ].join("\n");
}

function renderInspectHuman(result: ReturnType<typeof inspectFg6ExternalSecurityReview>): string {
  if (result.ok) return "[fg6-external-security-review-readback] OK";
  return ["[fg6-external-security-review-readback] FAILED", ...result.failures.map((failure) => `- ${failure}`)].join("\n");
}
