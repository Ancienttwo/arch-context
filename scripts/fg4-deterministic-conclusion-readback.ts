#!/usr/bin/env bun
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createReviewChallengeV2,
  publicKeyFingerprint,
  verifyAttestationV2ForReviewChallenge
} from "@archcontext/cloud/attestation";
import {
  REVIEW_ACTION_DEFAULTS,
  REVIEW_ACTION_NO_LLM_MODEL_DIGEST,
  buildRunnerUploadPayload,
  createReviewActionAttestationRuntime,
  createReviewActionLlmAdvisory,
  createReviewActionPreflightPlan,
  createRunnerPrivateKeySource,
  runTrustedDeterministicGateWithoutLlm,
  runnerPrivateKeySecretRef,
  runnerPrivacyAudit
} from "@archcontext/cloud/runner";
import type { GovernanceKeyStatus, RunnerIdentity } from "@archcontext/contracts";

const DEFAULT_OUTPUT = "docs/verification/fg4-deterministic-conclusion-readback.json";
const WORKFLOW_REF = "ancienttwo/arch-context/.github/workflows/archcontext-review.yml@refs/heads/main";
const FORBIDDEN_NONCE_MARKER = "nonce_fg4_deterministic_conclusion_secret";
const DIGEST = `sha256:${"1".repeat(64)}`;
const POLICY_DIGEST = `sha256:${"2".repeat(64)}`;
const CODE_FACTS_DIGEST = `sha256:${"3".repeat(64)}`;
const CAPABILITIES_DIGEST = `sha256:${"6".repeat(64)}`;
const RUNTIME_ARTIFACT_DIGEST = `sha256:${"8".repeat(64)}`;
const PROVIDER_ENV_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "MISTRAL_API_KEY"];

if (import.meta.main) {
  const [command = "run", ...args] = process.argv.slice(2);
  if (command !== "run" && command !== "inspect") {
    console.error("[fg4-deterministic-conclusion-readback] usage: run|inspect [--out path] [--evidence path] [--json]");
    process.exit(2);
  }
  if (command === "run") {
    const config = buildFg4DeterministicConclusionConfig(args);
    const result = await runFg4DeterministicConclusionReadback(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await Bun.file(resolve(process.cwd(), evidencePath)).text()) as unknown;
    const result = inspectFg4DeterministicConclusionReadback(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  }
}

export function buildFg4DeterministicConclusionConfig(args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? process.cwd(),
    outputPath: readFlag(args, "--out") ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    now: () => new Date().toISOString()
  };
}

export async function runFg4DeterministicConclusionReadback(config: ReturnType<typeof buildFg4DeterministicConclusionConfig>) {
  const failures: string[] = [];
  const generatedAt = config.now();
  const restoredEnv = new Map(PROVIDER_ENV_KEYS.map((key) => [key, process.env[key]] as const));
  for (const key of PROVIDER_ENV_KEYS) delete process.env[key];
  try {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const runner = createRunnerIdentity(publicKey);
    const challenge = createReviewChallengeV2({
      challengeId: "chal_fg4_deterministic_conclusion",
      installationId: runner.installationId,
      repositoryId: runner.repositoryIds[0]!,
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
    const runtime = createRuntime();
    const keyRef = runnerPrivateKeySecretRef({ installationId: runner.installationId, publicKeyId: runner.publicKeyId });
    const signing = {
      privateKeySource: createRunnerPrivateKeySource({ keyRef, publicKeyId: runner.publicKeyId }),
      secretStore: new TestRunnerSecretStore([[keyRef, privateKey.export({ format: "pem", type: "pkcs8" }).toString()]])
    };
    const result = runTrustedDeterministicGateWithoutLlm({
      taskSessionId: "task.fg4.deterministic",
      posture: "normal",
      headSha: challenge.headSha,
      currentHeadSha: challenge.headSha,
      worktreeDigest: DIGEST,
      codeFactsDigest: CODE_FACTS_DIGEST,
      policyDigest: POLICY_DIGEST,
      challenge,
      runner,
      privateKeySource: signing.privateKeySource,
      secretStore: signing.secretStore,
      mergeBaseSha: challenge.baseSha,
      headTreeOid: "tree_fg4_deterministic",
      runtime,
      workflowRef: runner.workflowRef,
      runId: "27870884813",
      runAttempt: 2,
      startedAt: "2026-06-20T10:05:00Z",
      completedAt: "2026-06-20T10:05:30Z"
    });
    const verification = verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: result.attestation,
      publicKey,
      runnerIdentity: runner,
      signingKeyStatus: runnerKeyStatus(runner),
      now: "2026-06-20T10:06:00Z",
      expectedHeadTreeOid: result.attestation.headTreeOid
    });
    const advisory = createReviewActionLlmAdvisory({
      provider: "local-provider",
      generatedAt: "2026-06-20T10:06:00Z",
      deterministicGate: result.deterministicGate,
      advisory: {
        summary: "Human-readable explanation only.",
        repairSteps: ["Keep required check conclusion bound to deterministic evidence."]
      }
    });
    let injectedAdvisoryRejected = false;
    let injectedAdvisoryReason = "";
    try {
      createReviewActionLlmAdvisory({
        provider: "local-provider",
        generatedAt: "2026-06-20T10:06:01Z",
        deterministicGate: result.deterministicGate,
        advisory: {
          result: "fail_action_required",
          checkConclusion: "failure",
          nested: { signature: "attempted override" }
        }
      });
    } catch (error) {
      injectedAdvisoryRejected = true;
      injectedAdvisoryReason = error instanceof Error ? error.message : String(error);
    }
    const payload = buildRunnerUploadPayload(result.attestation);
    const payloadString = JSON.stringify(payload);
    const evidence = {
      processLevelFixture: true,
      providerEnvCleared: Object.fromEntries(PROVIDER_ENV_KEYS.map((key) => [key, process.env[key] === undefined])),
      deterministicGate: {
        llmProviderConfigured: result.deterministicGate.llmProviderConfigured,
        modelDigest: result.deterministicGate.modelDigest,
        result: result.deterministicGate.result,
        reviewDigestMatchesAttestation: result.deterministicGate.reviewDigest === result.attestation.reviewDigest
      },
      attestation: {
        accepted: verification.accepted === true,
        result: result.attestation.result,
        runtimeBuildDigest: result.attestation.runtime.buildDigest,
        conclusionSource: "deterministic-gate"
      },
      advisory: {
        allowedAdvisoryCreated: advisory.influencesConclusion === false && advisory.persistedToCloud === false,
        deterministicReviewDigestMatches: advisory.deterministicReviewDigest === result.deterministicGate.reviewDigest,
        injectedAdvisoryRejected,
        injectedAdvisoryReason
      },
      upload: {
        privacyAuditOk: runnerPrivacyAudit(payload).ok === true,
        containsAdvisory: payloadString.includes("llmAdvisory") || payloadString.includes(advisory.advisoryDigest),
        containsProviderCredential: PROVIDER_ENV_KEYS.some((key) => payloadString.includes(key))
      }
    };
    const serializedEvidence = JSON.stringify(evidence);
    const final = {
      schemaVersion: "archcontext.fg4-deterministic-conclusion-readback/v1",
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
    inspectFg4DeterministicConclusionReadback(final).failures.forEach((failure) => failures.push(failure));
    final.status = failures.length === 0 ? "verified" : "failed";
    final.ok = failures.length === 0;
    final.failures = failures;
    await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
    await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(final, null, 2)}\n`, "utf8");
    return final;
  } finally {
    for (const [key, value] of restoredEnv.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export function inspectFg4DeterministicConclusionReadback(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const root = readRecord(recording);
  const evidence = readRecord(root.evidence);
  const gate = readRecord(evidence.deterministicGate);
  const attestation = readRecord(evidence.attestation);
  const advisory = readRecord(evidence.advisory);
  const upload = readRecord(evidence.upload);
  if (root.schemaVersion !== "archcontext.fg4-deterministic-conclusion-readback/v1") failures.push("schemaVersion mismatch");
  if (root.environment !== "process-fixture") failures.push("environment must be process-fixture");
  if (root.status !== "verified" || root.ok !== true) failures.push("status must be verified ok");
  if (evidence.processLevelFixture !== true) failures.push("evidence.processLevelFixture must be true");
  const providerEnvCleared = readRecord(evidence.providerEnvCleared);
  for (const key of PROVIDER_ENV_KEYS) {
    if (providerEnvCleared[key] !== true) failures.push(`${key} must be cleared`);
  }
  if (gate.llmProviderConfigured !== false) failures.push("deterministic gate must not configure an LLM provider");
  if (gate.modelDigest !== REVIEW_ACTION_NO_LLM_MODEL_DIGEST) failures.push("model digest must be no-provider digest");
  if (gate.result !== "pass") failures.push("deterministic gate result must be pass");
  if (gate.reviewDigestMatchesAttestation !== true) failures.push("review digest must match attestation");
  if (attestation.accepted !== true) failures.push("attestation must be accepted");
  if (attestation.result !== gate.result) failures.push("attestation result must match deterministic result");
  if (attestation.conclusionSource !== "deterministic-gate") failures.push("conclusion source must be deterministic gate");
  if (advisory.allowedAdvisoryCreated !== true) failures.push("allowed advisory must be isolated");
  if (advisory.deterministicReviewDigestMatches !== true) failures.push("advisory must bind to deterministic review digest");
  if (advisory.injectedAdvisoryRejected !== true) failures.push("injected advisory must be rejected");
  if (!String(advisory.injectedAdvisoryReason ?? "").includes("llm-advisory-conclusion-field-forbidden")) {
    failures.push("injected advisory rejection reason mismatch");
  }
  if (upload.privacyAuditOk !== true) failures.push("upload privacy audit must pass");
  if (upload.containsAdvisory !== false) failures.push("upload must not contain advisory");
  if (upload.containsProviderCredential !== false) failures.push("upload must not contain provider credential marker");
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

function createRunnerIdentity(publicKey: KeyObject): RunnerIdentity {
  return {
    schemaVersion: "archcontext.runner-identity/v1",
    runnerId: "runner_fg4_deterministic",
    installationId: 10001,
    repositoryIds: [20002],
    scope: { kind: "repository", repositoryIds: [20002] },
    workflowRef: WORKFLOW_REF,
    publicKeyId: "key_runner_fg4_deterministic",
    publicKeyFingerprint: publicKeyFingerprint(publicKey),
    status: "active",
    createdAt: "2026-06-20T10:00:00Z",
    rotatedAt: null,
    revokedAt: null
  };
}

function createRuntime() {
  const preflight = createReviewActionPreflightPlan({
    runtimeVersion: REVIEW_ACTION_DEFAULTS.runtimeVersion,
    runtimeArtifactDigest: RUNTIME_ARTIFACT_DIGEST,
    runtimeArtifactUrl: "https://archcontext.repoharness.com/releases/archctx-0.1.1.tgz"
  });
  if (!preflight.ok) throw new Error(preflight.reason);
  return createReviewActionAttestationRuntime({
    plan: preflight.plan,
    codeGraphVersion: "1.0.1",
    capabilitiesDigest: CAPABILITIES_DIGEST
  });
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

class TestRunnerSecretStore {
  private readonly secrets: Map<string, string>;

  constructor(entries: [string, string][]) {
    this.secrets = new Map(entries);
  }

  readSecret(ref: string): string | undefined {
    return this.secrets.get(ref);
  }
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function readRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function renderHuman(result: { ok: boolean; evidence?: { deterministicGate?: { result?: string }; advisory?: { injectedAdvisoryRejected?: boolean } }; failures?: string[] }) {
  return result.ok
    ? `[fg4-deterministic-conclusion-readback] verified result=${result.evidence?.deterministicGate?.result} advisoryRejected=${result.evidence?.advisory?.injectedAdvisoryRejected === true}`
    : `[fg4-deterministic-conclusion-readback] failed\n${(result.failures ?? []).map((failure) => `- ${failure}`).join("\n")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }) {
  return result.ok
    ? "[fg4-deterministic-conclusion-readback] OK"
    : `[fg4-deterministic-conclusion-readback] FAILED\n${result.failures.map((failure) => `- ${failure}`).join("\n")}`;
}
