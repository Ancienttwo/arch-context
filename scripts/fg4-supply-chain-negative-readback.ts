#!/usr/bin/env bun
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  attestationV2Digest,
  createReviewChallengeV2,
  publicKeyFingerprint,
  signOrganizationAttestationV2,
  verifyAttestationV2ForReviewChallenge
} from "@archcontext/cloud/attestation";
import {
  REVIEW_ACTION_DEFAULTS,
  buildRunnerUploadPayload,
  createReviewActionAttestationRuntime,
  createReviewActionPreflightPlan,
  runnerPrivacyAudit
} from "@archcontext/cloud/runner";
import type { AttestationV2, GovernanceReasonCode, GovernanceKeyStatus, RunnerIdentity } from "@archcontext/contracts";

const DEFAULT_OUTPUT = "docs/verification/fg4-supply-chain-negative-readback.json";
const RUNTIME_ARTIFACT_DIGEST = `sha256:${"8".repeat(64)}`;
const CAPABILITIES_DIGEST = `sha256:${"6".repeat(64)}`;
const WORKFLOW_REF = "ancienttwo/arch-context/.github/workflows/archcontext-review.yml@refs/heads/main";
const FORBIDDEN_NONCE_MARKER = "nonce_fg4_supply_chain_secret";

type PreflightCase = {
  name: string;
  expectedReason: string;
  observedReason: string;
  rejected: boolean;
};

type TamperCase = {
  name: string;
  expectedReasonCode: GovernanceReasonCode;
  observedReasonCode: GovernanceReasonCode | "";
  rejected: boolean;
};

if (import.meta.main) {
  const [command = "run", ...args] = process.argv.slice(2);
  if (command !== "run" && command !== "inspect") {
    console.error("[fg4-supply-chain-negative-readback] usage: run|inspect [--out path] [--evidence path] [--json]");
    process.exit(2);
  }
  if (command === "run") {
    const config = buildFg4SupplyChainNegativeConfig(args);
    const result = await runFg4SupplyChainNegativeReadback(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await Bun.file(resolve(process.cwd(), evidencePath)).text()) as unknown;
    const result = inspectFg4SupplyChainNegativeReadback(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  }
}

export function buildFg4SupplyChainNegativeConfig(args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? process.cwd(),
    outputPath: readFlag(args, "--out") ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    now: () => new Date().toISOString()
  };
}

export async function runFg4SupplyChainNegativeReadback(config: ReturnType<typeof buildFg4SupplyChainNegativeConfig>) {
  const failures: string[] = [];
  const generatedAt = config.now();
  const preflight = createReviewActionPreflightPlan({
    runtimeVersion: REVIEW_ACTION_DEFAULTS.runtimeVersion,
    runtimeArtifactDigest: RUNTIME_ARTIFACT_DIGEST,
    runtimeArtifactUrl: "https://archcontext.repoharness.com/releases/archctx-0.1.1.tgz"
  });
  if (!preflight.ok) throw new Error(preflight.reason);
  const preflightCases: PreflightCase[] = [
    recordPreflightCase("runtime-version-mismatch", "runtime-version-mismatch", {
      runtimeVersion: "0.0.0",
      runtimeArtifactDigest: RUNTIME_ARTIFACT_DIGEST,
      runtimeArtifactUrl: "https://archcontext.repoharness.com/releases/archctx-0.1.1.tgz"
    }),
    recordPreflightCase("runtime-artifact-digest-invalid", "runtime-artifact-digest-invalid", {
      runtimeVersion: REVIEW_ACTION_DEFAULTS.runtimeVersion,
      runtimeArtifactDigest: "sha256:bad",
      runtimeArtifactUrl: "https://archcontext.repoharness.com/releases/archctx-0.1.1.tgz"
    }),
    recordPreflightCase("runtime-artifact-url-invalid", "runtime-artifact-url-invalid", {
      runtimeVersion: REVIEW_ACTION_DEFAULTS.runtimeVersion,
      runtimeArtifactDigest: RUNTIME_ARTIFACT_DIGEST,
      runtimeArtifactUrl: "http://archcontext.repoharness.com/releases/archctx-0.1.1.tgz"
    })
  ];

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const challenge = createReviewChallengeV2({
    challengeId: "chal_fg4_supply_chain_negative",
    installationId: 10001,
    repositoryId: 20002,
    pullRequestNumber: 42,
    headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    nonce: FORBIDDEN_NONCE_MARKER,
    requiredTrust: "organization",
    policyProfileId: "policy.default",
    createdAt: "2026-06-20T10:00:00Z",
    expiresAt: "2026-06-20T10:30:00Z",
    status: "LEASED"
  });
  const runner: RunnerIdentity = {
    schemaVersion: "archcontext.runner-identity/v1",
    runnerId: "runner_fg4_supply_chain",
    installationId: challenge.installationId,
    repositoryIds: [challenge.repositoryId],
    scope: { kind: "repository", repositoryIds: [challenge.repositoryId] },
    workflowRef: WORKFLOW_REF,
    publicKeyId: "key_runner_fg4_supply_chain",
    publicKeyFingerprint: publicKeyFingerprint(publicKey),
    status: "active",
    createdAt: "2026-06-20T10:00:00Z",
    rotatedAt: null,
    revokedAt: null
  };
  const runtime = createReviewActionAttestationRuntime({
    plan: preflight.plan,
    codeGraphVersion: "1.0.1",
    capabilitiesDigest: CAPABILITIES_DIGEST
  });
  const attestation = signOrganizationAttestationV2({
    challenge,
    runner,
    privateKey,
    mergeBaseSha: challenge.baseSha,
    headTreeOid: "tree_fg4_supply_chain",
    worktreeDigest: `sha256:${"7".repeat(64)}`,
    modelDigest: `sha256:${"1".repeat(64)}`,
    policyDigest: `sha256:${"2".repeat(64)}`,
    codeFactsDigest: `sha256:${"3".repeat(64)}`,
    reviewDigest: `sha256:${"4".repeat(64)}`,
    result: "pass",
    runtime,
    workflowRef: WORKFLOW_REF,
    runId: "27870884813",
    runAttempt: 2,
    startedAt: "2026-06-20T10:05:00Z",
    completedAt: "2026-06-20T10:05:30Z"
  });
  const baseline = verifyAttestationV2ForReviewChallenge({
    challenge,
    attestation,
    publicKey,
    runnerIdentity: runner,
    signingKeyStatus: runnerKeyStatus(runner),
    now: "2026-06-20T10:06:00Z",
    expectedHeadTreeOid: attestation.headTreeOid
  });
  const uploadPayload = buildRunnerUploadPayload(attestation);
  const tamperCases: TamperCase[] = [
    recordTamperCase("runtime-build-digest-mismatch", "SIGNATURE_INVALID", {
      ...attestation,
      runtime: {
        ...attestation.runtime,
        buildDigest: `sha256:${"9".repeat(64)}`
      }
    }, { challenge, publicKey, runner }),
    recordTamperCase("run-attempt-mismatch", "SIGNATURE_INVALID", {
      ...attestation,
      execution: {
        trustLevel: "organization",
        source: "organization-runner-checkout",
        principalId: runner.runnerId,
        publicKeyId: runner.publicKeyId,
        runnerId: runner.runnerId,
        workflowRef: WORKFLOW_REF,
        runId: "27870884813",
        runAttempt: 3
      }
    }, { challenge, publicKey, runner })
  ];

  const evidence = {
    processLevelFixture: true,
    baseline: {
      preflightOk: true,
      attestationAccepted: baseline.accepted === true,
      runtimeBuildDigest: runtime.buildDigest,
      payloadDigestMatchesAttestation: uploadPayload.digest === attestationV2Digest(attestation),
      payloadPrivacyOk: runnerPrivacyAudit(uploadPayload).ok === true
    },
    preflightCases,
    tamperCases,
    allPreflightRejectionsObserved: preflightCases.every((entry) => entry.rejected),
    allTamperRejectionsObserved: tamperCases.every((entry) => entry.rejected)
  };
  const serializedEvidence = JSON.stringify(evidence);
  const result = {
    schemaVersion: "archcontext.fg4-supply-chain-negative-readback/v1",
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
  inspectFg4SupplyChainNegativeReadback(result).failures.forEach((failure) => failures.push(failure));
  result.status = failures.length === 0 ? "verified" : "failed";
  result.ok = failures.length === 0;
  result.failures = failures;
  await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
  await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

export function inspectFg4SupplyChainNegativeReadback(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const root = readRecord(recording);
  const evidence = readRecord(root.evidence);
  const baseline = readRecord(evidence.baseline);
  if (root.schemaVersion !== "archcontext.fg4-supply-chain-negative-readback/v1") failures.push("schemaVersion mismatch");
  if (root.environment !== "process-fixture") failures.push("environment must be process-fixture");
  if (root.status !== "verified" || root.ok !== true) failures.push("status must be verified ok");
  if (evidence.processLevelFixture !== true) failures.push("evidence.processLevelFixture must be true");
  if (baseline.preflightOk !== true) failures.push("baseline preflight must be ok");
  if (baseline.attestationAccepted !== true) failures.push("baseline attestation must be accepted");
  if (baseline.payloadDigestMatchesAttestation !== true) failures.push("payload digest must match attestation digest");
  if (baseline.payloadPrivacyOk !== true) failures.push("payload privacy audit must pass");
  const preflightCases = Array.isArray(evidence.preflightCases) ? evidence.preflightCases.map(readRecord) : [];
  const preflightByName = new Map(preflightCases.map((entry) => [String(entry.name), entry]));
  for (const [name, reason] of [
    ["runtime-version-mismatch", "runtime-version-mismatch"],
    ["runtime-artifact-digest-invalid", "runtime-artifact-digest-invalid"],
    ["runtime-artifact-url-invalid", "runtime-artifact-url-invalid"]
  ] as const) {
    const entry = preflightByName.get(name);
    if (!entry) failures.push(`missing preflight case: ${name}`);
    else if (entry.rejected !== true || entry.expectedReason !== reason || entry.observedReason !== reason) {
      failures.push(`${name} must reject with ${reason}`);
    }
  }
  const tamperCases = Array.isArray(evidence.tamperCases) ? evidence.tamperCases.map(readRecord) : [];
  const tamperByName = new Map(tamperCases.map((entry) => [String(entry.name), entry]));
  for (const [name, reasonCode] of [
    ["runtime-build-digest-mismatch", "SIGNATURE_INVALID"],
    ["run-attempt-mismatch", "SIGNATURE_INVALID"]
  ] as const) {
    const entry = tamperByName.get(name);
    if (!entry) failures.push(`missing tamper case: ${name}`);
    else if (entry.rejected !== true || entry.expectedReasonCode !== reasonCode || entry.observedReasonCode !== reasonCode) {
      failures.push(`${name} must reject with ${reasonCode}`);
    }
  }
  if (evidence.allPreflightRejectionsObserved !== true) failures.push("allPreflightRejectionsObserved must be true");
  if (evidence.allTamperRejectionsObserved !== true) failures.push("allTamperRejectionsObserved must be true");
  const leakCounters = readRecord(evidence.leakCounters);
  for (const key of ["plaintextNonceLeaks", "privateKeyLeaks", "tokenLeaks"]) {
    if (Number(leakCounters[key] ?? 0) !== 0) failures.push(`${key} must be 0`);
  }
  const serialized = JSON.stringify(recording);
  if (serialized.includes(FORBIDDEN_NONCE_MARKER)) failures.push("recording contains plaintext nonce marker");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|PRIVATE KEY/.test(serialized)) failures.push("recording contains private key material");
  if (/gh[opsu]_[A-Za-z0-9_]+|Bearer\s+/i.test(serialized)) failures.push("recording contains token material");
  return { ok: failures.length === 0, failures };
}

function recordPreflightCase(
  name: string,
  expectedReason: string,
  input: Parameters<typeof createReviewActionPreflightPlan>[0]
): PreflightCase {
  const result = createReviewActionPreflightPlan(input);
  return {
    name,
    expectedReason,
    observedReason: result.ok ? "" : result.reason,
    rejected: result.ok === false && result.reason === expectedReason
  };
}

function recordTamperCase(
  name: string,
  expectedReasonCode: GovernanceReasonCode,
  attestation: AttestationV2,
  context: { challenge: ReturnType<typeof createReviewChallengeV2>; publicKey: KeyObject; runner: RunnerIdentity }
): TamperCase {
  const result = verifyAttestationV2ForReviewChallenge({
    challenge: context.challenge,
    attestation,
    publicKey: context.publicKey,
    runnerIdentity: context.runner,
    signingKeyStatus: runnerKeyStatus(context.runner),
    now: "2026-06-20T10:06:00Z",
    expectedHeadTreeOid: attestation.headTreeOid
  });
  return {
    name,
    expectedReasonCode,
    observedReasonCode: result.accepted ? "" : result.reasonCode,
    rejected: result.accepted === false && result.reasonCode === expectedReasonCode
  };
}

function runnerKeyStatus(runner: RunnerIdentity): GovernanceKeyStatus {
  return {
    schemaVersion: "archcontext.governance-key-status/v1",
    publicKeyId: runner.publicKeyId,
    ownerKind: "runner",
    ownerId: runner.runnerId,
    fingerprint: runner.publicKeyFingerprint,
    status: runner.status,
    createdAt: runner.createdAt,
    rotatedAt: runner.rotatedAt,
    revokedAt: runner.revokedAt
  };
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function readRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function renderHuman(result: { ok: boolean; evidence?: { allPreflightRejectionsObserved?: boolean; allTamperRejectionsObserved?: boolean }; failures?: string[] }) {
  return result.ok
    ? `[fg4-supply-chain-negative-readback] verified preflight=${result.evidence?.allPreflightRejectionsObserved === true} tamper=${result.evidence?.allTamperRejectionsObserved === true}`
    : `[fg4-supply-chain-negative-readback] failed\n${(result.failures ?? []).map((failure) => `- ${failure}`).join("\n")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }) {
  return result.ok
    ? "[fg4-supply-chain-negative-readback] OK"
    : `[fg4-supply-chain-negative-readback] FAILED\n${result.failures.map((failure) => `- ${failure}`).join("\n")}`;
}
