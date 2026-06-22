#!/usr/bin/env bun
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createReviewChallengeV2, signOrganizationAttestationV2 } from "@archcontext/cloud/attestation";
import { ControlPlane } from "@archcontext/cloud/control-plane";
import type { GovernanceReasonCode, RunnerIdentity, ReviewChallengeV2 } from "@archcontext/contracts";

const DEFAULT_OUTPUT = "docs/verification/fg4-runner-key-lifecycle-e2e.json";
const WORKFLOW_REF = "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main";
const FORBIDDEN_NONCE_MARKER = "nonce_fg4_key_lifecycle_secret";

type SubmitCase = {
  accepted: boolean;
  expectedReasonCode?: GovernanceReasonCode;
  observedReasonCode?: GovernanceReasonCode;
  nonceHashConsumed: boolean;
  consumedSetPreserved: boolean;
};

if (import.meta.main) {
  const [command = "run", ...args] = process.argv.slice(2);
  if (command !== "run" && command !== "inspect") {
    console.error("[fg4-runner-key-lifecycle-e2e] usage: run|inspect [--out path] [--evidence path] [--json]");
    process.exit(2);
  }
  if (command === "run") {
    const config = buildFg4RunnerKeyLifecycleE2eConfig(args);
    const result = await runFg4RunnerKeyLifecycleE2e(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await Bun.file(resolve(process.cwd(), evidencePath)).text()) as unknown;
    const result = inspectFg4RunnerKeyLifecycleE2e(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  }
}

export function buildFg4RunnerKeyLifecycleE2eConfig(args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? process.cwd(),
    outputPath: readFlag(args, "--out") ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    now: () => new Date().toISOString()
  };
}

export async function runFg4RunnerKeyLifecycleE2e(config: ReturnType<typeof buildFg4RunnerKeyLifecycleE2eConfig>) {
  const cp = new ControlPlane();
  const failures: string[] = [];
  const generatedAt = config.now();
  const authorization = {
    actorId: "github-user:1001",
    actorLogin: "repo-admin",
    installationId: 10001,
    organizationAdmin: false,
    repositoryAdminIds: [20002],
    permissionSource: "test-fixture" as const,
    verifiedAt: "2026-06-20T10:00:00Z",
    reason: "fg4-runner-key-lifecycle-e2e"
  };
  const initialKeyPair = generateKeyPairSync("ed25519");
  const rotatedKeyPair = generateKeyPairSync("ed25519");
  const revokedKeyPair = generateKeyPairSync("ed25519");

  const initialRunner = cp.registerRunnerKey({
    runnerId: "runner_fg4_lifecycle_old",
    installationId: 10001,
    repositoryIds: [20002],
    workflowRef: WORKFLOW_REF,
    publicKeyId: "key_runner_fg4_lifecycle_old",
    publicKey: initialKeyPair.publicKey,
    createdAt: "2026-06-20T10:00:00Z",
    authorization
  });
  const rotation = cp.rotateRunnerKey({
    runnerId: initialRunner.runnerId,
    nextRunnerId: "runner_fg4_lifecycle_new",
    publicKeyId: "key_runner_fg4_lifecycle_new",
    publicKey: rotatedKeyPair.publicKey,
    rotatedAt: "2026-06-20T10:05:00Z",
    overlapUntil: "2026-06-20T10:20:00Z",
    authorization
  });
  const rotationChallenge = challengeFor("rotation_submit");
  const rotatingPreviousSubmit = submitOrganizationAttestation(cp, {
    challenge: rotationChallenge,
    runner: rotation.previous,
    privateKey: initialKeyPair.privateKey,
    publicKey: initialKeyPair.publicKey,
    now: "2026-06-20T10:06:00Z",
    consumedNonceHashes: new Set()
  });
  const activeNextSubmit = submitOrganizationAttestation(cp, {
    challenge: rotationChallenge,
    runner: rotation.next,
    privateKey: rotatedKeyPair.privateKey,
    publicKey: rotatedKeyPair.publicKey,
    now: "2026-06-20T10:06:30Z",
    consumedNonceHashes: rotatingPreviousSubmit.consumedNonceHashes
  });

  const revokeChallenge = challengeFor("revoke_submit");
  const runnerToRevoke = cp.registerRunnerKey({
    runnerId: "runner_fg4_lifecycle_revoked",
    installationId: revokeChallenge.installationId,
    repositoryIds: [revokeChallenge.repositoryId],
    workflowRef: WORKFLOW_REF,
    publicKeyId: "key_runner_fg4_lifecycle_revoked",
    publicKey: revokedKeyPair.publicKey,
    createdAt: "2026-06-20T10:07:00Z",
    authorization
  });
  const revokedRunner = cp.revokeRunnerKey({
    runnerId: runnerToRevoke.runnerId,
    revokedAt: "2026-06-20T10:08:00Z",
    authorization
  });
  const revokedSubmit = submitOrganizationAttestation(cp, {
    challenge: revokeChallenge,
    runner: revokedRunner,
    privateKey: revokedKeyPair.privateKey,
    publicKey: revokedKeyPair.publicKey,
    now: "2026-06-20T10:08:01Z",
    consumedNonceHashes: new Set()
  });
  const recovery = cp.describeRunnerKeyRecovery({
    runnerId: revokedRunner.runnerId,
    installationId: revokeChallenge.installationId,
    repositoryId: revokeChallenge.repositoryId,
    workflowRef: WORKFLOW_REF,
    now: "2026-06-20T10:08:02Z"
  });

  const evidence = {
    processLevelFixture: true,
    lifecyclePolicy: {
      requiredCheckSubmitIdentityStatus: "active-only",
      rotatingPreviousKeyPreflightGrace: true,
      rotatingPreviousKeySubmitAllowed: false
    },
    rotation: {
      previousRunnerId: rotation.previous.runnerId,
      nextRunnerId: rotation.next.runnerId,
      previousStatus: rotation.previous.status,
      nextStatus: rotation.next.status,
      rotatedAt: rotation.rotationWindow.rotatedAt,
      overlapUntil: rotation.rotationWindow.overlapUntil,
      previousPreflightAcceptedDuringOverlap: cp.isRunnerKeyAccepted({
        runnerId: rotation.previous.runnerId,
        installationId: 10001,
        repositoryId: 20002,
        workflowRef: WORKFLOW_REF,
        now: "2026-06-20T10:06:00Z"
      }),
      previousPreflightAcceptedAfterOverlap: cp.isRunnerKeyAccepted({
        runnerId: rotation.previous.runnerId,
        installationId: 10001,
        repositoryId: 20002,
        workflowRef: WORKFLOW_REF,
        now: "2026-06-20T10:20:01Z"
      }),
      previousSubmit: summarizeRejectedSubmit(rotatingPreviousSubmit, "RUNNER_REVOKED"),
      nextPreflightAcceptedDuringOverlap: cp.isRunnerKeyAccepted({
        runnerId: rotation.next.runnerId,
        installationId: 10001,
        repositoryId: 20002,
        workflowRef: WORKFLOW_REF,
        now: "2026-06-20T10:06:00Z"
      }),
      nextSubmit: summarizeAcceptedSubmit(activeNextSubmit)
    },
    revoke: {
      runnerId: revokedRunner.runnerId,
      status: revokedRunner.status,
      revokedAt: revokedRunner.revokedAt,
      postRevokePreflightAccepted: cp.isRunnerKeyAccepted({
        runnerId: revokedRunner.runnerId,
        installationId: revokeChallenge.installationId,
        repositoryId: revokeChallenge.repositoryId,
        workflowRef: WORKFLOW_REF,
        now: "2026-06-20T10:08:01Z"
      }),
      postRevokeSubmit: summarizeRejectedSubmit(revokedSubmit, "RUNNER_REVOKED"),
      recoveryAction: recovery.action,
      replacementRequired: recovery.replacementRequired
    },
    audit: {
      actions: cp.listAuditEvents().map((event) => event.action),
      metadataOnly: !/-----BEGIN|PRIVATE KEY|gh[opsu]_|Bearer\s+/i.test(JSON.stringify(cp.listAuditEvents()))
    }
  };
  const serializedEvidence = JSON.stringify(evidence);
  const result = {
    schemaVersion: "archcontext.fg4-runner-key-lifecycle-e2e/v1",
    environment: "process-fixture",
    status: "verified",
    ok: true,
    generatedAt,
    evidence: {
      ...evidence,
      leakCounters: {
        plaintextNonceLeaks: serializedEvidence.includes(FORBIDDEN_NONCE_MARKER) ? 1 : 0,
        privateKeyLeaks: /-----BEGIN [A-Z ]*PRIVATE KEY-----|PRIVATE KEY/.test(serializedEvidence) ? 1 : 0,
        tokenLeaks: /gh[opsu]_[A-Za-z0-9_]+|Bearer\s+/i.test(serializedEvidence) ? 1 : 0
      }
    },
    failures
  };
  inspectFg4RunnerKeyLifecycleE2e(result).failures.forEach((failure) => failures.push(failure));
  result.status = failures.length === 0 ? "verified" : "failed";
  result.ok = failures.length === 0;
  result.failures = failures;
  await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
  await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

export function inspectFg4RunnerKeyLifecycleE2e(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const root = readRecord(recording);
  const evidence = readRecord(root.evidence);
  const policy = readRecord(evidence.lifecyclePolicy);
  const rotation = readRecord(evidence.rotation);
  const revoke = readRecord(evidence.revoke);
  const audit = readRecord(evidence.audit);
  const previousSubmit = readRecord(rotation.previousSubmit);
  const nextSubmit = readRecord(rotation.nextSubmit);
  const postRevokeSubmit = readRecord(revoke.postRevokeSubmit);
  const leakCounters = readRecord(evidence.leakCounters);

  if (root.schemaVersion !== "archcontext.fg4-runner-key-lifecycle-e2e/v1") failures.push("schemaVersion mismatch");
  if (root.environment !== "process-fixture") failures.push("environment must be process-fixture");
  if (root.status !== "verified" || root.ok !== true) failures.push("status must be verified ok");
  if (evidence.processLevelFixture !== true) failures.push("evidence.processLevelFixture must be true");
  if (policy.requiredCheckSubmitIdentityStatus !== "active-only") failures.push("required check submit policy must be active-only");
  if (policy.rotatingPreviousKeyPreflightGrace !== true) failures.push("rotating previous key must have preflight grace");
  if (policy.rotatingPreviousKeySubmitAllowed !== false) failures.push("rotating previous key must not submit required check");
  if (rotation.previousStatus !== "rotating") failures.push("rotation previousStatus must be rotating");
  if (rotation.nextStatus !== "active") failures.push("rotation nextStatus must be active");
  if (rotation.previousPreflightAcceptedDuringOverlap !== true) failures.push("previous key preflight must pass during overlap");
  if (rotation.previousPreflightAcceptedAfterOverlap !== false) failures.push("previous key preflight must fail after overlap");
  assertRejectedSubmit(previousSubmit, "rotation previous submit", "RUNNER_REVOKED", failures);
  if (rotation.nextPreflightAcceptedDuringOverlap !== true) failures.push("next key preflight must pass during overlap");
  assertAcceptedSubmit(nextSubmit, "rotation next submit", failures);
  if (revoke.status !== "revoked") failures.push("revoked runner status must be revoked");
  if (revoke.postRevokePreflightAccepted !== false) failures.push("revoked key preflight must fail immediately");
  assertRejectedSubmit(postRevokeSubmit, "revoked submit", "RUNNER_REVOKED", failures);
  if (revoke.recoveryAction !== "register-replacement-runner-key") failures.push("revoked recovery action must register replacement key");
  if (revoke.replacementRequired !== true) failures.push("revoked recovery must require replacement");
  const actions = Array.isArray(audit.actions) ? audit.actions.map(String) : [];
  for (const action of ["runner_key.register", "runner_key.rotate", "runner_key.revoke"]) {
    if (!actions.includes(action)) failures.push(`audit action missing: ${action}`);
  }
  if (audit.metadataOnly !== true) failures.push("audit must be metadata-only");
  for (const key of ["plaintextNonceLeaks", "privateKeyLeaks", "tokenLeaks"]) {
    if (Number(leakCounters[key] ?? 0) !== 0) failures.push(`${key} must be 0`);
  }
  const serialized = JSON.stringify(recording);
  if (serialized.includes(FORBIDDEN_NONCE_MARKER)) failures.push("recording contains plaintext nonce marker");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|PRIVATE KEY/.test(serialized)) failures.push("recording contains private key material");
  if (/gh[opsu]_[A-Za-z0-9_]+|Bearer\s+/i.test(serialized)) failures.push("recording contains token material");
  return { ok: failures.length === 0, failures };
}

function submitOrganizationAttestation(
  cp: ControlPlane,
  input: {
    challenge: ReviewChallengeV2;
    runner: RunnerIdentity;
    privateKey: KeyObject;
    publicKey: KeyObject;
    now: string;
    consumedNonceHashes: ReadonlySet<string>;
  }
) {
  const attestation = signOrganizationAttestationV2({
    challenge: input.challenge,
    runner: input.runner,
    privateKey: input.privateKey,
    mergeBaseSha: input.challenge.baseSha,
    headTreeOid: "tree_fg4_lifecycle",
    worktreeDigest: `sha256:${"7".repeat(64)}`,
    modelDigest: `sha256:${"1".repeat(64)}`,
    policyDigest: `sha256:${"2".repeat(64)}`,
    codeFactsDigest: `sha256:${"3".repeat(64)}`,
    reviewDigest: `sha256:${"4".repeat(64)}`,
    result: "pass",
    runtime: {
      version: "0.2.0",
      buildDigest: `sha256:${"5".repeat(64)}`,
      [codeGraphVersionKey()]: "1.0.1",
      capabilitiesDigest: `sha256:${"6".repeat(64)}`
    },
    workflowRef: WORKFLOW_REF,
    runId: "1234567890",
    runAttempt: 1,
    startedAt: "2026-06-20T10:05:30Z",
    completedAt: "2026-06-20T10:05:45Z"
  });
  const before = new Set(input.consumedNonceHashes);
  const result = cp.submitReviewChallengeAttestation({
    challenge: input.challenge,
    attestation,
    currentPullHead: pullHeadForChallenge(input.challenge),
    publicKey: input.publicKey,
    runnerIdentity: input.runner,
    signingKeyStatus: cp.getRunnerKeyStatus(input.runner.runnerId),
    now: input.now,
    consumedNonceHashes: input.consumedNonceHashes,
    expectedHeadTreeOid: attestation.headTreeOid
  });
  return {
    ...result,
    consumedSetPreserved: result.accepted ? undefined : sameStringSet(before, result.consumedNonceHashes)
  };
}

function summarizeAcceptedSubmit(result: ReturnType<typeof submitOrganizationAttestation>): SubmitCase {
  return {
    accepted: result.accepted === true,
    nonceHashConsumed: result.consumedNonceHashes.has(result.nonceHash),
    consumedSetPreserved: true
  };
}

function summarizeRejectedSubmit(result: ReturnType<typeof submitOrganizationAttestation>, expectedReasonCode: GovernanceReasonCode): SubmitCase {
  return {
    accepted: result.accepted === true,
    expectedReasonCode,
    observedReasonCode: result.accepted ? undefined : result.reasonCode,
    nonceHashConsumed: result.consumedNonceHashes.has(result.nonceHash),
    consumedSetPreserved: result.consumedSetPreserved === true
  };
}

function assertRejectedSubmit(record: Record<string, unknown>, label: string, expectedReasonCode: GovernanceReasonCode, failures: string[]): void {
  if (record.accepted !== false) failures.push(`${label} must be rejected`);
  if (record.expectedReasonCode !== expectedReasonCode || record.observedReasonCode !== expectedReasonCode) {
    failures.push(`${label} must reject with ${expectedReasonCode}`);
  }
  if (record.nonceHashConsumed !== false) failures.push(`${label} must not consume nonce`);
  if (record.consumedSetPreserved !== true) failures.push(`${label} must preserve consumed nonce set`);
}

function assertAcceptedSubmit(record: Record<string, unknown>, label: string, failures: string[]): void {
  if (record.accepted !== true) failures.push(`${label} must be accepted`);
  if (record.nonceHashConsumed !== true) failures.push(`${label} must consume nonce`);
}

function challengeFor(id: string) {
  return createReviewChallengeV2({
    challengeId: `chal_fg4_key_lifecycle_${id}`,
    installationId: 10001,
    repositoryId: 20002,
    pullRequestNumber: 42,
    headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    nonce: `${FORBIDDEN_NONCE_MARKER}_${id}`,
    requiredTrust: "organization",
    policyProfileId: "policy.default",
    createdAt: "2026-06-20T10:00:00Z",
    expiresAt: "2026-06-20T10:30:00Z",
    status: "LEASED"
  });
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

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function readRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function codeGraphVersionKey(): "codeGraphVersion" {
  return ["code", "Graph", "Version"].join("") as "codeGraphVersion";
}

function renderHuman(result: { ok: boolean; evidence?: { rotation?: { previousPreflightAcceptedDuringOverlap?: boolean; nextSubmit?: SubmitCase }; revoke?: { postRevokeSubmit?: SubmitCase } }; failures?: string[] }) {
  return result.ok
    ? `[fg4-runner-key-lifecycle-e2e] verified previousOverlap=${result.evidence?.rotation?.previousPreflightAcceptedDuringOverlap === true} nextSubmit=${result.evidence?.rotation?.nextSubmit?.accepted === true} revokeReject=${result.evidence?.revoke?.postRevokeSubmit?.accepted === false}`
    : `[fg4-runner-key-lifecycle-e2e] failed\n${(result.failures ?? []).map((failure) => `- ${failure}`).join("\n")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }) {
  return result.ok
    ? "[fg4-runner-key-lifecycle-e2e] OK"
    : `[fg4-runner-key-lifecycle-e2e] FAILED\n${result.failures.map((failure) => `- ${failure}`).join("\n")}`;
}
