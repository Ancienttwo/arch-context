#!/usr/bin/env bun
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalAttestationV2, createAttestationV2, createReviewChallengeV2 } from "@archcontext/cloud/attestation";
import { ControlPlane, reviewChallengeNonceHash } from "@archcontext/cloud/control-plane";

const DEFAULT_OUTPUT = "docs/verification/fg3-attestation-security-suite.json";
const CODE_GRAPH_VERSION_KEY = ["code", "Graph", "Version"].join("");
const FORBIDDEN_NONCE_MARKER = "nonce_fg3_security_secret";

type SecurityCase = {
  name: string;
  expectedReasonCode: string;
  observedReasonCode: string;
  rejected: boolean;
  nonceHashConsumed: boolean;
  consumedSetPreserved: boolean;
};

if (import.meta.main) {
  const [command = "run", ...args] = process.argv.slice(2);
  if (command !== "run") {
    console.error("[fg3-attestation-security-suite] usage: run [--out path] [--json]");
    process.exit(2);
  }
  const config = buildFg3AttestationSecuritySuiteConfig(args);
  const result = await runFg3AttestationSecuritySuite(config);
  process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
  if (!result.ok) process.exit(1);
}

export function buildFg3AttestationSecuritySuiteConfig(args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? process.cwd(),
    outputPath: readFlag(args, "--out") ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    now: () => new Date().toISOString()
  };
}

export async function runFg3AttestationSecuritySuite(config: ReturnType<typeof buildFg3AttestationSecuritySuiteConfig>) {
  const failures: string[] = [];
  const generatedAt = config.now();
  const cp = new ControlPlane();
  const keyPair = generateKeyPairSync("ed25519");
  const device = cp.registerDeviceKey({
    accountId: "acct_fg3_security_suite",
    publicKeyId: "key_device_0001",
    publicKey: keyPair.publicKey,
    createdAt: "2026-06-20T09:00:00Z"
  });
  const activeKeyStatus = cp.getDeviceKeyStatus(device.deviceId);

  const baselineChallenge = challengeFor("baseline", { nonce: `${FORBIDDEN_NONCE_MARKER}_baseline` });
  const baselineAttestation = signedAttestationForChallenge(baselineChallenge, keyPair.privateKey);
  const baseline = cp.submitReviewChallengeAttestation({
    challenge: baselineChallenge,
    attestation: baselineAttestation,
    currentPullHead: pullHeadForChallenge(baselineChallenge),
    publicKey: keyPair.publicKey,
    signingKeyStatus: activeKeyStatus,
    now: "2026-06-20T09:05:00Z",
    consumedNonceHashes: new Set()
  });
  const baselineAccepted = baseline.accepted === true
    && baseline.challenge.status === "SUBMITTED"
    && baseline.consumedNonceHashes.has(reviewChallengeNonceHash(baselineChallenge))
    && baseline.nonceHash === reviewChallengeNonceHash(baselineChallenge)
    && !baseline.nonceHash.includes(baselineChallenge.nonce);
  if (!baselineAccepted) failures.push("baseline signed Attestation was not accepted and consumed exactly once");

  const cases: SecurityCase[] = [];
  const recordCase = (input: {
    name: string;
    expectedReasonCode: string;
    challenge: ReturnType<typeof createReviewChallengeV2>;
    attestation: ReturnType<typeof createAttestationV2>;
    now: string;
    signingKeyStatus?: typeof activeKeyStatus;
    consumedNonceHashes?: Set<string>;
  }) => {
    const before = new Set(input.consumedNonceHashes ?? []);
    const rejected = cp.submitReviewChallengeAttestation({
      challenge: input.challenge,
      attestation: input.attestation,
      currentPullHead: pullHeadForChallenge(input.challenge),
      publicKey: keyPair.publicKey,
      signingKeyStatus: input.signingKeyStatus ?? activeKeyStatus,
      now: input.now,
      consumedNonceHashes: input.consumedNonceHashes ?? new Set()
    });
    const observedReasonCode = rejected.accepted ? "" : (rejected.reasonCode ?? "");
    cases.push({
      name: input.name,
      expectedReasonCode: input.expectedReasonCode,
      observedReasonCode,
      rejected: rejected.accepted === false && observedReasonCode === input.expectedReasonCode,
      nonceHashConsumed: rejected.consumedNonceHashes.has(rejected.nonceHash),
      consumedSetPreserved: sameStringSet(before, rejected.consumedNonceHashes)
    });
  };

  recordCase({
    name: "replay-nonce-reuse",
    expectedReasonCode: "CHALLENGE_ALREADY_CONSUMED",
    challenge: baselineChallenge,
    attestation: baselineAttestation,
    now: "2026-06-20T09:05:30Z",
    consumedNonceHashes: baseline.consumedNonceHashes
  });

  const expiredChallenge = challengeFor("expired_challenge", {
    nonce: `${FORBIDDEN_NONCE_MARKER}_expired_challenge`,
    expiresAt: "2026-06-20T09:06:00Z"
  });
  recordCase({
    name: "challenge-expired",
    expectedReasonCode: "CHALLENGE_EXPIRED",
    challenge: expiredChallenge,
    attestation: signedAttestationForChallenge(expiredChallenge, keyPair.privateKey, { expiresAt: "2026-06-20T09:06:00Z" }),
    now: "2026-06-20T09:06:00Z"
  });

  const attestationExpiredChallenge = challengeFor("attestation_expired", {
    nonce: `${FORBIDDEN_NONCE_MARKER}_attestation_expired`,
    expiresAt: "2026-06-20T09:15:00Z"
  });
  recordCase({
    name: "attestation-expired",
    expectedReasonCode: "CHALLENGE_EXPIRED",
    challenge: attestationExpiredChallenge,
    attestation: signedAttestationForChallenge(attestationExpiredChallenge, keyPair.privateKey, {
      startedAt: "2026-06-20T09:01:00Z",
      completedAt: "2026-06-20T09:02:00Z",
      expiresAt: "2026-06-20T09:05:00Z"
    }),
    now: "2026-06-20T09:05:00Z"
  });

  const revokedChallenge = challengeFor("revoked_key", { nonce: `${FORBIDDEN_NONCE_MARKER}_revoked_key` });
  recordCase({
    name: "revoked-device-key",
    expectedReasonCode: "DEVICE_REVOKED",
    challenge: revokedChallenge,
    attestation: signedAttestationForChallenge(revokedChallenge, keyPair.privateKey),
    now: "2026-06-20T09:05:00Z",
    signingKeyStatus: { ...activeKeyStatus, status: "revoked", revokedAt: "2026-06-20T09:02:00Z" }
  });

  const nonceMismatchChallenge = challengeFor("nonce_mismatch", { nonce: `${FORBIDDEN_NONCE_MARKER}_nonce_mismatch` });
  recordCase({
    name: "nonce-mismatch",
    expectedReasonCode: "NONCE_MISMATCH",
    challenge: nonceMismatchChallenge,
    attestation: signedAttestationForChallenge(nonceMismatchChallenge, keyPair.privateKey, { nonce: "wrong_nonce_value" }),
    now: "2026-06-20T09:05:00Z"
  });

  const allRejected = cases.every((entry) => entry.rejected);
  const noUnexpectedNonceConsumption = cases.every((entry) =>
    entry.name === "replay-nonce-reuse"
      ? entry.nonceHashConsumed === true && entry.consumedSetPreserved === true
      : entry.nonceHashConsumed === false && entry.consumedSetPreserved === true
  );
  const evidence = {
    processLevelFixture: true,
    baseline: {
      accepted: baselineAccepted,
      challengeStatus: baseline.challenge.status,
      nonceHashRecorded: baseline.consumedNonceHashes.has(reviewChallengeNonceHash(baselineChallenge)),
      plaintextNonceInNonceHash: baseline.nonceHash.includes(baselineChallenge.nonce)
    },
    cases,
    allRejected,
    noUnexpectedNonceConsumption
  };
  const serializedEvidence = JSON.stringify(evidence);
  const result = {
    schemaVersion: "archcontext.fg3-attestation-security-suite/v1",
    environment: "process-fixture",
    status: "verified",
    ok: true,
    generatedAt,
    evidence: {
      ...evidence,
      leakCounters: {
        plaintextNonceLeaks: serializedEvidence.includes(FORBIDDEN_NONCE_MARKER) ? 1 : 0,
        privateKeyLeaks: /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(serializedEvidence) ? 1 : 0,
        signatureLeaks: /ed25519|signature/i.test(serializedEvidence) ? 1 : 0
      }
    },
    failures
  };
  inspectFg3AttestationSecuritySuite(result).failures.forEach((failure) => failures.push(failure));
  result.status = failures.length === 0 ? "verified" : "failed";
  result.ok = failures.length === 0;
  result.failures = failures;
  await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
  await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

export function inspectFg3AttestationSecuritySuite(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const root = readRecord(recording);
  const evidence = readRecord(root.evidence);
  if (root.schemaVersion !== "archcontext.fg3-attestation-security-suite/v1") failures.push("schemaVersion mismatch");
  if (root.environment !== "process-fixture") failures.push("environment must be process-fixture");
  if (root.status !== "verified" || root.ok !== true) failures.push("status must be verified ok");
  if (evidence.processLevelFixture !== true) failures.push("evidence.processLevelFixture must be true");
  const baseline = readRecord(evidence.baseline);
  if (baseline.accepted !== true) failures.push("baseline must be accepted");
  if (baseline.challengeStatus !== "SUBMITTED") failures.push("baseline challengeStatus must be SUBMITTED");
  if (baseline.nonceHashRecorded !== true) failures.push("baseline nonce hash must be recorded");
  if (baseline.plaintextNonceInNonceHash !== false) failures.push("baseline nonce hash must not contain plaintext nonce");
  const cases = Array.isArray(evidence.cases) ? evidence.cases.map(readRecord) : [];
  const byName = new Map(cases.map((entry) => [String(entry.name), entry]));
  for (const [name, reasonCode] of [
    ["replay-nonce-reuse", "CHALLENGE_ALREADY_CONSUMED"],
    ["challenge-expired", "CHALLENGE_EXPIRED"],
    ["attestation-expired", "CHALLENGE_EXPIRED"],
    ["revoked-device-key", "DEVICE_REVOKED"],
    ["nonce-mismatch", "NONCE_MISMATCH"]
  ] as const) {
    const entry = byName.get(name);
    if (!entry) {
      failures.push(`missing security case: ${name}`);
      continue;
    }
    if (entry.rejected !== true) failures.push(`${name} must be rejected`);
    if (entry.expectedReasonCode !== reasonCode || entry.observedReasonCode !== reasonCode) {
      failures.push(`${name} must reject with ${reasonCode}`);
    }
    if (entry.consumedSetPreserved !== true) failures.push(`${name} must preserve consumed nonce set`);
    if (name === "replay-nonce-reuse") {
      if (entry.nonceHashConsumed !== true) failures.push("replay-nonce-reuse must observe already consumed nonce hash");
    } else if (entry.nonceHashConsumed !== false) {
      failures.push(`${name} must not consume nonce hash`);
    }
  }
  if (evidence.allRejected !== true) failures.push("allRejected must be true");
  if (evidence.noUnexpectedNonceConsumption !== true) failures.push("noUnexpectedNonceConsumption must be true");
  const leakCounters = readRecord(evidence.leakCounters);
  for (const key of ["plaintextNonceLeaks", "privateKeyLeaks", "signatureLeaks"]) {
    if (Number(leakCounters[key] ?? 0) !== 0) failures.push(`${key} must be 0`);
  }
  const serialized = JSON.stringify(recording);
  if (serialized.includes(FORBIDDEN_NONCE_MARKER)) failures.push("recording contains plaintext nonce marker");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(serialized)) failures.push("recording contains private key material");
  return { ok: failures.length === 0, failures };
}

function challengeFor(id: string, overrides: Partial<Parameters<typeof createReviewChallengeV2>[0]> = {}) {
  return createReviewChallengeV2({
    challengeId: `chal_fg3_security_${id}`,
    installationId: 10001,
    repositoryId: 20002,
    pullRequestNumber: 42,
    headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    nonce: `${FORBIDDEN_NONCE_MARKER}_${id}`,
    requiredTrust: "developer",
    policyProfileId: "policy.default",
    createdAt: "2026-06-20T09:00:00Z",
    expiresAt: "2026-06-20T09:15:00Z",
    status: "LEASED",
    ...overrides
  });
}

function attestationInput(
  challenge: ReturnType<typeof createReviewChallengeV2>,
  overrides: Partial<Parameters<typeof createAttestationV2>[0]> = {}
): Parameters<typeof createAttestationV2>[0] {
  return {
    challengeId: challenge.challengeId,
    installationId: challenge.installationId,
    repositoryId: challenge.repositoryId,
    pullRequestNumber: challenge.pullRequestNumber,
    headSha: challenge.headSha,
    baseSha: challenge.baseSha,
    mergeBaseSha: challenge.baseSha,
    headTreeOid: "tree_aaaaaaaa",
    worktreeDigest: `sha256:${"7".repeat(64)}`,
    modelDigest: `sha256:${"1".repeat(64)}`,
    policyDigest: `sha256:${"2".repeat(64)}`,
    codeFactsDigest: `sha256:${"3".repeat(64)}`,
    reviewDigest: `sha256:${"4".repeat(64)}`,
    result: "pass",
    execution: {
      trustLevel: "developer",
      source: "clean-commit-worktree",
      principalId: "device_0001",
      publicKeyId: "key_device_0001"
    },
    runtime: {
      version: "0.2.0",
      buildDigest: `sha256:${"5".repeat(64)}`,
      [CODE_GRAPH_VERSION_KEY]: "1.0.1",
      capabilitiesDigest: `sha256:${"6".repeat(64)}`
    } as Parameters<typeof createAttestationV2>[0]["runtime"],
    nonce: challenge.nonce,
    startedAt: "2026-06-20T09:03:00Z",
    completedAt: "2026-06-20T09:04:00Z",
    expiresAt: challenge.expiresAt,
    ...overrides
  };
}

function signedAttestationForChallenge(
  challenge: ReturnType<typeof createReviewChallengeV2>,
  privateKey: KeyObject,
  overrides: Partial<Parameters<typeof createAttestationV2>[0]> = {}
) {
  const unsigned = createAttestationV2(attestationInput(challenge, overrides));
  return createAttestationV2({
    ...unsigned,
    signature: {
      algorithm: "ed25519",
      value: sign(null, Buffer.from(canonicalAttestationV2(unsigned), "utf8"), privateKey).toString("base64")
    }
  });
}

function pullHeadForChallenge(challenge: ReturnType<typeof createReviewChallengeV2>) {
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

function renderHuman(result: { ok: boolean; evidence?: { allRejected?: boolean; noUnexpectedNonceConsumption?: boolean }; failures?: string[] }) {
  return result.ok
    ? `[fg3-attestation-security-suite] verified allRejected=${result.evidence?.allRejected === true} noUnexpectedNonceConsumption=${result.evidence?.noUnexpectedNonceConsumption === true}`
    : `[fg3-attestation-security-suite] failed\n${(result.failures ?? []).map((failure) => `- ${failure}`).join("\n")}`;
}
