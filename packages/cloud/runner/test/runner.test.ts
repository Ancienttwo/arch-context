import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  attestationV2Digest,
  createReviewChallengeV2,
  publicKeyFingerprint,
  verifyAttestationV2ForReviewChallenge
} from "@archcontext/cloud/attestation";
import {
  REVIEW_ACTION_DEFAULTS,
  REVIEW_ACTION_GITHUB_HOSTED_WORKFLOW_TEMPLATE_PATH,
  REVIEW_ACTION_METADATA_PATH,
  REVIEW_ACTION_MINIMUM_PERMISSIONS,
  REVIEW_ACTION_NO_LLM_MODEL_DIGEST,
  REVIEW_ACTION_REUSABLE_WORKFLOW_CALLER_TEMPLATE_PATH,
  REVIEW_ACTION_REUSABLE_WORKFLOW_PATH,
  assertNoRunnerPrivateKeyMaterial,
  createReviewActionAttestationRuntime,
  createRunnerPrivateKeySource,
  createReviewActionPreflightPlan,
  createReviewActionLlmAdvisory,
  evaluateReviewActionForkPolicy,
  runnerPrivateKeySecretRef,
  verifyReviewActionCheckout,
  verifyReviewActionWorkflowPermissions,
  verifyReviewActionWorkflowTriggerPolicy,
  buildRunnerUploadPayload,
  runTrustedDeterministicGateWithoutLlm,
  runTrustedReview,
  runnerPrivacyAudit
} from "../src/index";

const digest = `sha256:${"1".repeat(64)}`;
const headSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const baseSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const mergeBaseSha = "cccccccccccccccccccccccccccccccccccccccc";
const headTreeOid = "tree_aaaaaaaa";
const policyDigest = `sha256:${"2".repeat(64)}`;
const runtimeBuildDigest = `sha256:${"8".repeat(64)}`;
const capabilitiesDigest = `sha256:${"6".repeat(64)}`;
const workflowRef = "ancienttwo/arch-context/.github/workflows/archcontext-review.yml@refs/heads/main";
const root = fileURLToPath(new URL("../../../../", import.meta.url));

describe("@archcontext/cloud/runner", () => {
  test("runs organization-attested review and uploads only attestation metadata", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const runner = createTestRunnerIdentity({ publicKey, runnerId: "runner_1", publicKeyId: "org_pk_1" });
    const signing = createTestRunnerSigning({
      installationId: runner.installationId,
      publicKeyId: runner.publicKeyId,
      privateKey
    });
    const challenge = createTestReviewChallenge();
    const runtime = createTestAttestationRuntime();
    const result = runTrustedReview({
      taskSessionId: "task.runner",
      posture: "normal",
      headSha: challenge.headSha,
      currentHeadSha: challenge.headSha,
      worktreeDigest: digest,
      modelDigest: digest,
      codeFactsDigest: digest,
      policyDigest,
      challenge,
      runner,
      privateKeySource: signing.privateKeySource,
      secretStore: signing.secretStore,
      mergeBaseSha,
      headTreeOid,
      runtime,
      workflowRef: runner.workflowRef,
      runId: "27870884813",
      runAttempt: 2,
      startedAt: "2026-06-19T00:00:00Z",
      completedAt: "2026-06-19T00:01:00Z"
    });
    expect(result.review.result).toBe("pass");
    expect(result.attestation).toMatchObject({
      schemaVersion: "archcontext.attestation/v2",
      challengeId: challenge.challengeId,
      installationId: challenge.installationId,
      repositoryId: challenge.repositoryId,
      pullRequestNumber: challenge.pullRequestNumber,
      headSha: challenge.headSha,
      baseSha: challenge.baseSha,
      mergeBaseSha,
      headTreeOid,
      worktreeDigest: digest,
      modelDigest: digest,
      policyDigest,
      codeFactsDigest: digest,
      reviewDigest: result.review.extensions.digest,
      result: "pass",
      execution: {
        trustLevel: "organization",
        source: "organization-runner-checkout",
        principalId: runner.runnerId,
        publicKeyId: runner.publicKeyId,
        runnerId: runner.runnerId,
        workflowRef: runner.workflowRef,
        runId: "27870884813",
        runAttempt: 2
      },
      runtime
    });
    expect(
      verifyAttestationV2ForReviewChallenge({
        challenge,
        attestation: result.attestation,
        publicKey,
        runnerIdentity: runner,
        signingKeyStatus: runnerKeyStatus(runner),
        now: "2026-06-19T00:02:00Z",
        expectedHeadTreeOid: headTreeOid
      }).accepted
    ).toBe(true);
    if (result.attestation.execution.trustLevel !== "organization") throw new Error("organization execution expected");
    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: {
        ...result.attestation,
        execution: {
          ...result.attestation.execution,
          workflowRef: "ancienttwo/arch-context/.github/workflows/archcontext-review.yml@refs/tags/v1"
        }
      },
      publicKey,
      runnerIdentity: runner,
      signingKeyStatus: runnerKeyStatus(runner),
      now: "2026-06-19T00:02:00Z",
      expectedHeadTreeOid: headTreeOid
    })).toEqual({ accepted: false, reasonCode: "RUNNER_SCOPE_MISMATCH" });
    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: {
        ...result.attestation,
        execution: {
          ...result.attestation.execution,
          runAttempt: 3
        }
      },
      publicKey,
      runnerIdentity: runner,
      signingKeyStatus: runnerKeyStatus(runner),
      now: "2026-06-19T00:02:00Z",
      expectedHeadTreeOid: headTreeOid
    })).toEqual({ accepted: false, reasonCode: "SIGNATURE_INVALID" });
    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: {
        ...result.attestation,
        runtime: {
          ...result.attestation.runtime,
          buildDigest: `sha256:${"9".repeat(64)}`
        }
      },
      publicKey,
      runnerIdentity: runner,
      signingKeyStatus: runnerKeyStatus(runner),
      now: "2026-06-19T00:02:00Z",
      expectedHeadTreeOid: headTreeOid
    })).toEqual({ accepted: false, reasonCode: "SIGNATURE_INVALID" });

    const payload = buildRunnerUploadPayload(result.attestation);
    expect(payload.digest).toBe(attestationV2Digest(result.attestation));
    expect(payload.runtime.buildDigest).toBe(runtimeBuildDigest);
    expect(payload.execution).toMatchObject({
      workflowRef: runner.workflowRef,
      runId: "27870884813",
      runAttempt: 2
    });
    expect(runnerPrivacyAudit(payload)).toEqual({ ok: true, forbiddenKeys: [] });
    expect(JSON.stringify(payload)).not.toContain("findings");
    expect(JSON.stringify(payload)).not.toContain("pass_with_warnings");
    expect(JSON.stringify(payload)).not.toContain(signing.keyRef);
    expect(JSON.stringify(result)).not.toContain(signing.keyRef);
  });

  test("runner private key source accepts only customer Secret Store refs and rejects leak surfaces", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const signing = createTestRunnerSigning({ installationId: 12345, publicKeyId: "org_pk_secret", privateKey });

    expect(signing.keyRef).toBe("keychain://archcontext/runner/12345/org_pk_secret");
    expect(signing.privateKeySource).toEqual({
      schemaVersion: "archcontext.runner-private-key-source/v1",
      keyRef: signing.keyRef,
      publicKeyId: "org_pk_secret"
    });
    expect(JSON.stringify(signing.privateKeySource)).not.toContain("PRIVATE KEY");
    expect(() => assertNoRunnerPrivateKeyMaterial(signing.privateKeySource)).not.toThrow();
    expect(() => createRunnerPrivateKeySource({
      keyRef: "file:///Users/chris/Projects/arch-context/.archcontext/runner-private-key.pem",
      publicKeyId: "org_pk_secret"
    })).toThrow("runner-private-key-secret-ref-required");
    expect(() => assertNoRunnerPrivateKeyMaterial({ log: { privateKeyPem: signing.privateKeyPem } })).toThrow("runner-private-key-material-forbidden");
    expect(() => assertNoRunnerPrivateKeyMaterial({ artifact: { keyPath: "./runner-private-key.pem" } })).toThrow("runner-private-key-file-ref-forbidden");
    expect(() => assertNoRunnerPrivateKeyMaterial({ cache: { secretValue: "[REDACTED]" } })).toThrow("runner-private-key-surface-field-forbidden: secretValue");
  });

  test("runs a complete organization deterministic gate without any LLM provider", () => {
    const originalProviderEnv = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY
    };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      const runner = createTestRunnerIdentity({ publicKey, runnerId: "runner_no_llm", publicKeyId: "org_pk_no_llm" });
      const signing = createTestRunnerSigning({
        installationId: runner.installationId,
        publicKeyId: runner.publicKeyId,
        privateKey
      });
      const challenge = createTestReviewChallenge({ challengeId: "chal_no_llm", nonce: "nonce_no_llm" });
      const result = runTrustedDeterministicGateWithoutLlm({
        taskSessionId: "task.runner.no-llm",
        posture: "normal",
        headSha: challenge.headSha,
        currentHeadSha: challenge.headSha,
        worktreeDigest: digest,
        codeFactsDigest: digest,
        policyDigest,
        challenge,
        runner,
        privateKeySource: signing.privateKeySource,
        secretStore: signing.secretStore,
        mergeBaseSha,
        headTreeOid,
        runtime: createTestAttestationRuntime(),
        workflowRef: runner.workflowRef,
        runId: "27870884814",
        runAttempt: 1,
        startedAt: "2026-06-19T00:00:00Z",
        completedAt: "2026-06-19T00:01:00Z"
      });

      expect(result.deterministicGate).toEqual({
        schemaVersion: "archcontext.review-action-deterministic-gate/v1",
        llmProviderConfigured: false,
        modelDigest: REVIEW_ACTION_NO_LLM_MODEL_DIGEST,
        result: "pass",
        reviewDigest: result.review.extensions.digest
      });
      expect(result.review.snapshot.modelDigest).toBe(REVIEW_ACTION_NO_LLM_MODEL_DIGEST);
      expect(result.review.result).toBe("pass");
      expect(result.attestation.execution).toMatchObject({
        trustLevel: "organization",
        workflowRef: runner.workflowRef,
        runId: "27870884814",
        runAttempt: 1
      });
      expect(result.attestation.runtime.buildDigest).toBe(runtimeBuildDigest);
      expect(
        verifyAttestationV2ForReviewChallenge({
          challenge,
          attestation: result.attestation,
          publicKey,
          runnerIdentity: runner,
          signingKeyStatus: runnerKeyStatus(runner),
          now: "2026-06-19T00:02:00Z",
          expectedHeadTreeOid: headTreeOid
        }).accepted
      ).toBe(true);
      expect(runnerPrivacyAudit(buildRunnerUploadPayload(result.attestation))).toEqual({ ok: true, forbiddenKeys: [] });
    } finally {
      restoreEnv("ANTHROPIC_API_KEY", originalProviderEnv.ANTHROPIC_API_KEY);
      restoreEnv("OPENAI_API_KEY", originalProviderEnv.OPENAI_API_KEY);
    }
  });

  test("keeps optional LLM Advisory separate from Attestation conclusion", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const runner = createTestRunnerIdentity({ publicKey, runnerId: "runner_advisory", publicKeyId: "org_pk_advisory" });
    const signing = createTestRunnerSigning({
      installationId: runner.installationId,
      publicKeyId: runner.publicKeyId,
      privateKey
    });
    const challenge = createTestReviewChallenge({ challengeId: "chal_advisory", nonce: "nonce_advisory" });
    const result = runTrustedDeterministicGateWithoutLlm({
      taskSessionId: "task.runner.advisory",
      posture: "normal",
      headSha: challenge.headSha,
      currentHeadSha: challenge.headSha,
      worktreeDigest: digest,
      codeFactsDigest: digest,
      policyDigest,
      challenge,
      runner,
      privateKeySource: signing.privateKeySource,
      secretStore: signing.secretStore,
      mergeBaseSha,
      headTreeOid,
      runtime: createTestAttestationRuntime(),
      workflowRef: runner.workflowRef,
      runId: "27870884815",
      runAttempt: 1,
      startedAt: "2026-06-19T00:00:00Z",
      completedAt: "2026-06-19T00:01:00Z"
    });
    const attestationBefore = result.attestation;
    const advisory = createReviewActionLlmAdvisory({
      provider: "local-provider",
      generatedAt: "2026-06-19T00:02:00Z",
      deterministicGate: result.deterministicGate,
      advisory: {
        architectureThesis: "The required gate passed; keep the migration boundary explicit.",
        refactorExplanation: "Move callers in one direction and delete the compatibility bridge after cleanup.",
        proofPointSuggestions: ["Attach the deterministic gate digest to the PR summary."],
        repairSteps: ["Run the cleanup verifier before merging."]
      }
    });

    expect(advisory).toMatchObject({
      schemaVersion: "archcontext.review-action-llm-advisory/v1",
      allowedUses: [
        "architecture-thesis",
        "refactor-explanation",
        "proof-point-suggestions",
        "human-readable-repair-steps"
      ],
      deterministicResult: "pass",
      deterministicReviewDigest: result.review.extensions.digest,
      influencesConclusion: false,
      persistedToCloud: false,
      provider: "local-provider"
    });
    expect(advisory.advisoryDigest).toMatch(/^sha256:/);
    expect(result.attestation).toBe(attestationBefore);
    expect(result.attestation.reviewDigest).toBe(result.review.extensions.digest);
    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: result.attestation,
      publicKey,
      runnerIdentity: runner,
      signingKeyStatus: runnerKeyStatus(runner),
      now: "2026-06-19T00:02:00Z",
      expectedHeadTreeOid: headTreeOid
    }).accepted).toBe(true);
    expect(buildRunnerUploadPayload(result.attestation)).not.toHaveProperty("llmAdvisory");
    expect(JSON.stringify(buildRunnerUploadPayload(result.attestation))).not.toContain(advisory.advisoryDigest);
    expect(runnerPrivacyAudit(advisory)).toEqual({ ok: true, forbiddenKeys: [] });

    expect(() => createReviewActionLlmAdvisory({
      provider: "local-provider",
      generatedAt: "2026-06-19T00:03:00Z",
      deterministicGate: result.deterministicGate,
      advisory: {
        result: "fail_action_required",
        checkConclusion: "failure",
        repairSteps: ["Try to override the required check."]
      }
    })).toThrow("llm-advisory-conclusion-field-forbidden");
    expect(result.review.result).toBe("pass");
    expect(result.attestation.reviewDigest).toBe(result.review.extensions.digest);
  });

  test("defines official review-action metadata with pinned runtime inputs", () => {
    const action = readFileSync(join(root, REVIEW_ACTION_METADATA_PATH), "utf8");

    expect(action).toContain("name: ArchContext Review");
    expect(action).toContain("main: dist/review-action.mjs");
    expect(action).toContain("using: node20");
    expect(action).toContain(`default: "${REVIEW_ACTION_DEFAULTS.runtimeVersion}"`);
    expect(action).toContain("runtime-artifact-digest:");
    expect(action).toContain("expected-repository:");
    expect(action).toContain("expected-head-sha:");
    expect(action).toContain("expected-head-tree-oid:");
    expect(action).toContain("fork-pr-mode:");
    expect(action).toContain("required: true");
    expect(action).toContain("checkout-verification:");
    expect(action).toContain("fork-policy:");
    expect(action).not.toContain("github-token");
    expect(action).not.toContain("GITHUB_TOKEN");
    expect(action).toContain("default: organization");
    expect(action).toContain("default: blocking");
    expect(action).toContain("default: https://archcontext.repoharness.com");
  });

  test("provides GitHub-hosted runner workflow template aligned with the review-action contract", () => {
    const workflow = readFileSync(join(root, REVIEW_ACTION_GITHUB_HOSTED_WORKFLOW_TEMPLATE_PATH), "utf8");

    expect(workflow).toContain("name: ArchContext Review");
    expect(workflow).toContain("pull_request:");
    expect(workflow).not.toContain("pull_request_target");
    expect(workflow).toContain("runs-on: ubuntu-latest");
    expect(workflow).toContain("timeout-minutes: 15");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("checks: read");
    expect(workflow).toContain("pull-requests: read");
    expect(workflow).not.toContain("contents: write");
    expect(workflow).not.toContain("write-all");
    expect(workflow).not.toContain("GITHUB_TOKEN");
    expect(workflow).not.toContain("OPENAI_API_KEY");
    expect(workflow).not.toContain("ANTHROPIC_API_KEY");
    expect(workflow).toContain("uses: actions/checkout@v4");
    expect(workflow).toContain("ref: ${{ github.event.pull_request.head.sha }}");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("uses: archcontext/review-action@v1");
    expect(workflow).toContain("challenge: auto");
    expect(workflow).toContain("trust-level: organization");
    expect(workflow).toContain("fail-on: blocking");
    expect(workflow).toContain("fork-pr-mode: unsupported");
    expect(workflow).toContain("runtime-version: \"0.1.0\"");
    expect(workflow).toContain("runtime-artifact-url: https://archcontext.repoharness.com/releases/archctx-0.1.0.tgz");
    expect(workflow).toContain("runtime-artifact-digest: sha256:<release-digest>");
    expect(workflow).toContain("expected-repository: <owner/name from Challenge>");
    expect(workflow).toContain("expected-head-sha: ${{ github.event.pull_request.head.sha }}");
    expect(workflow).toContain("expected-head-tree-oid: <head tree OID from Challenge>");
    expect(verifyReviewActionWorkflowTriggerPolicy({ pullRequest: true })).toMatchObject({
      ok: true,
      acceptedTrigger: "pull_request"
    });
    expect(verifyReviewActionWorkflowPermissions({
      contents: "read",
      checks: "read",
      "pull-requests": "read"
    })).toMatchObject({
      ok: true,
      permissions: REVIEW_ACTION_MINIMUM_PERMISSIONS
    });
  });

  test("provides reusable Organization Runner workflow with commit SHA pinned caller", () => {
    const workflow = readFileSync(join(root, REVIEW_ACTION_REUSABLE_WORKFLOW_PATH), "utf8");
    const caller = readFileSync(join(root, REVIEW_ACTION_REUSABLE_WORKFLOW_CALLER_TEMPLATE_PATH), "utf8");

    expect(workflow).toContain("workflow_call:");
    expect(workflow).not.toContain("pull_request_target");
    expect(workflow).toContain("expected_repository:");
    expect(workflow).toContain("expected_head_sha:");
    expect(workflow).toContain("expected_head_tree_oid:");
    expect(workflow).toContain("runtime_artifact_url:");
    expect(workflow).toContain("runtime_artifact_digest:");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("checks: read");
    expect(workflow).toContain("pull-requests: read");
    expect(workflow).not.toContain("contents: write");
    expect(workflow).not.toContain("write-all");
    expect(workflow).not.toContain("GITHUB_TOKEN");
    expect(workflow).toContain("runs-on: ${{ inputs.runs_on }}");
    expect(workflow).toContain("ref: ${{ inputs.expected_head_sha }}");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("uses: archcontext/review-action@v1");
    expect(workflow).toContain("expected-head-tree-oid: ${{ inputs.expected_head_tree_oid }}");
    expect(caller).toContain("pull_request:");
    expect(caller).toContain(".github/workflows/archcontext-organization-runner.yml@0123456789abcdef0123456789abcdef01234567");
    expect(caller).toMatch(/uses: <archcontext-workflows-owner>\/<archcontext-workflows-repo>\/\.github\/workflows\/archcontext-organization-runner\.yml@[0-9a-f]{40}/);
    expect(caller).not.toContain("@main");
    expect(caller).not.toContain("@v1");
    expect(caller).toContain("expected_head_sha: ${{ github.event.pull_request.head.sha }}");
    expect(caller).toContain("expected_head_tree_oid: <head tree OID from Challenge>");
    expect(caller).toContain("runtime_artifact_url: https://archcontext.repoharness.com/releases/archctx-0.1.0.tgz");
    expect(caller).toContain("runtime_artifact_digest: sha256:<release-digest>");
    expect(verifyReviewActionWorkflowPermissions({
      contents: "read",
      checks: "read",
      "pull-requests": "read"
    })).toMatchObject({
      ok: true,
      permissions: REVIEW_ACTION_MINIMUM_PERMISSIONS
    });
  });

  test("review-action workflow permissions stay minimum read-only", () => {
    const runbook = readFileSync(join(root, "docs/runbooks/trusted-runner.md"), "utf8");

    expect(REVIEW_ACTION_MINIMUM_PERMISSIONS).toEqual({
      contents: "read",
      checks: "read",
      "pull-requests": "read"
    });
    expect(runbook).toContain("contents: read");
    expect(runbook).toContain("checks: read");
    expect(runbook).toContain("pull-requests: read");
    expect(runbook).not.toContain("contents: write");
    expect(runbook).not.toContain("write-all");
    expect(verifyReviewActionWorkflowPermissions({
      contents: "read",
      checks: "read",
      "pull-requests": "read"
    })).toEqual({
      ok: true,
      schemaVersion: "archcontext.review-action-permissions/v1",
      permissions: REVIEW_ACTION_MINIMUM_PERMISSIONS
    });
    expect(verifyReviewActionWorkflowPermissions("write-all")).toMatchObject({
      ok: false,
      reasonCode: "WORKFLOW_PERMISSION_BROAD_TOKEN"
    });
    expect(verifyReviewActionWorkflowPermissions({
      contents: "write",
      checks: "read",
      "pull-requests": "read"
    })).toMatchObject({
      ok: false,
      reasonCode: "WORKFLOW_PERMISSION_WRITE_FORBIDDEN",
      permission: "contents"
    });
    expect(verifyReviewActionWorkflowPermissions({
      contents: "read",
      checks: "read"
    })).toMatchObject({
      ok: false,
      reasonCode: "WORKFLOW_PERMISSION_MISSING",
      permission: "pull-requests"
    });
    expect(verifyReviewActionWorkflowPermissions({
      contents: "read",
      checks: "read",
      "pull-requests": "read",
      actions: "read"
    })).toMatchObject({
      ok: false,
      reasonCode: "WORKFLOW_PERMISSION_EXTRA",
      permission: "actions"
    });
  });

  test("review-action trigger policy forbids pull_request_target by default", () => {
    const runbook = readFileSync(join(root, "docs/runbooks/trusted-runner.md"), "utf8");
    const workflowYaml = runbook.match(/```yaml\n([\s\S]*?)\n```/)![1];

    expect(workflowYaml).toContain("pull_request:");
    expect(workflowYaml).not.toContain("pull_request_target");
    expect(verifyReviewActionWorkflowTriggerPolicy({ pullRequest: true })).toEqual({
      ok: true,
      schemaVersion: "archcontext.review-action-trigger-policy/v1",
      acceptedTrigger: "pull_request"
    });
    expect(verifyReviewActionWorkflowTriggerPolicy({ pullRequestTarget: true })).toEqual({
      ok: false,
      schemaVersion: "archcontext.review-action-trigger-policy/v1",
      reasonCode: "PULL_REQUEST_TARGET_FORBIDDEN"
    });
    expect(verifyReviewActionWorkflowTriggerPolicy({})).toEqual({
      ok: false,
      schemaVersion: "archcontext.review-action-trigger-policy/v1",
      reasonCode: "TRUSTED_TRIGGER_MISSING"
    });
    expect(verifyReviewActionWorkflowTriggerPolicy({ workflowDispatch: { protectedExactHead: false } })).toEqual({
      ok: false,
      schemaVersion: "archcontext.review-action-trigger-policy/v1",
      reasonCode: "WORKFLOW_DISPATCH_EXACT_HEAD_REQUIRED"
    });
    expect(verifyReviewActionWorkflowTriggerPolicy({ workflowDispatch: { protectedExactHead: true } })).toEqual({
      ok: true,
      schemaVersion: "archcontext.review-action-trigger-policy/v1",
      acceptedTrigger: "protected_workflow_dispatch"
    });
  });

  test("review-action fork policy defaults to neutral unsupported unless no-secret mode is explicit", () => {
    expect(evaluateReviewActionForkPolicy({
      eventName: "pull_request",
      repository: "ancienttwo/arch-context",
      pullRequestHeadRepository: "forker/arch-context",
      pullRequestHeadFork: true
    })).toEqual({
      run: false,
      schemaVersion: "archcontext.review-action-fork-policy/v1",
      mode: "unsupported",
      fork: true,
      repository: "ancienttwo/arch-context",
      pullRequestHeadRepository: "forker/arch-context",
      outputConclusion: "neutral",
      reasonCode: "FORK_PR_UNSUPPORTED",
      requiresSigningSecret: false,
      signingSecretConfigured: false
    });
    expect(evaluateReviewActionForkPolicy({
      eventName: "pull_request",
      repository: "ancienttwo/arch-context",
      pullRequestHeadRepository: "forker/arch-context",
      forkPullRequestMode: "safe-no-secret"
    })).toEqual({
      run: true,
      schemaVersion: "archcontext.review-action-fork-policy/v1",
      mode: "safe-no-secret",
      fork: true,
      repository: "ancienttwo/arch-context",
      pullRequestHeadRepository: "forker/arch-context",
      requiresSigningSecret: false,
      signingSecretConfigured: false
    });
    expect(evaluateReviewActionForkPolicy({
      eventName: "pull_request",
      repository: "ancienttwo/arch-context",
      pullRequestHeadRepository: "forker/arch-context",
      forkPullRequestMode: "safe-no-secret",
      signingSecretConfigured: true
    })).toMatchObject({
      run: false,
      outputConclusion: "neutral",
      reasonCode: "FORK_PR_SECRET_EXPOSURE_FORBIDDEN",
      requiresSigningSecret: false
    });
    expect(evaluateReviewActionForkPolicy({
      eventName: "pull_request",
      repository: "ancienttwo/arch-context",
      pullRequestHeadRepository: "ancienttwo/arch-context"
    })).toMatchObject({
      run: true,
      mode: "trusted",
      fork: false,
      requiresSigningSecret: true
    });
  });

  test("review-action preflight verifies runtime version and artifact digest", () => {
    const artifactDigest = `sha256:${"a".repeat(64)}`;
    const plan = createReviewActionPreflightPlan({
      runtimeVersion: REVIEW_ACTION_DEFAULTS.runtimeVersion,
      runtimeArtifactDigest: artifactDigest,
      runtimeArtifactUrl: "https://archcontext.repoharness.com/releases/archctx-0.1.0.tgz"
    });

    expect(plan).toEqual({
      ok: true,
      plan: {
        schemaVersion: "archcontext.review-action-plan/v1",
        actionName: "archcontext/review-action",
        apiEndpoint: "https://archcontext.repoharness.com",
        challenge: "auto",
        failOn: "blocking",
        runtimeArtifactDigest: artifactDigest,
        runtimeArtifactUrl: "https://archcontext.repoharness.com/releases/archctx-0.1.0.tgz",
        runtimeVersion: REVIEW_ACTION_DEFAULTS.runtimeVersion,
        trustLevel: "organization"
      }
    });
    expect(createReviewActionPreflightPlan({
      runtimeVersion: "0.0.0",
      runtimeArtifactDigest: artifactDigest,
      runtimeArtifactUrl: "https://archcontext.repoharness.com/releases/archctx-0.1.0.tgz"
    })).toEqual({ ok: false, reason: "runtime-version-mismatch" });
    expect(createReviewActionPreflightPlan({
      runtimeVersion: REVIEW_ACTION_DEFAULTS.runtimeVersion,
      runtimeArtifactDigest: "sha256:bad",
      runtimeArtifactUrl: "https://archcontext.repoharness.com/releases/archctx-0.1.0.tgz"
    })).toEqual({ ok: false, reason: "runtime-artifact-digest-invalid" });
  });

  test("review-action verifies exact repository, head, tree, detached checkout, and cleanliness", () => {
    const fixture = createGitFixture();
    try {
      const expected = checkoutExpected(fixture);
      expect(verifyReviewActionCheckout({
        checkoutRoot: fixture,
        expectedRepository: "ancienttwo/arch-context",
        expectedHeadSha: expected.headSha,
        expectedHeadTreeOid: expected.headTreeOid,
        githubRepository: "ancienttwo/arch-context"
      })).toMatchObject({
        ok: true,
        expected: {
          repository: "ancienttwo/arch-context",
          headSha: expected.headSha,
          headTreeOid: expected.headTreeOid
        },
        observed: {
          repository: "ancienttwo/arch-context",
          githubRepository: "ancienttwo/arch-context",
          headSha: expected.headSha,
          headTreeOid: expected.headTreeOid,
          detached: true,
          clean: true
        }
      });
      expect(verifyReviewActionCheckout({
        checkoutRoot: fixture,
        expectedRepository: "ancienttwo/other",
        expectedHeadSha: expected.headSha,
        expectedHeadTreeOid: expected.headTreeOid,
        githubRepository: "ancienttwo/arch-context"
      })).toMatchObject({ ok: false, reasonCode: "REPOSITORY_MISMATCH" });
      expect(verifyReviewActionCheckout({
        checkoutRoot: fixture,
        expectedRepository: "ancienttwo/arch-context",
        expectedHeadSha: "f".repeat(40),
        expectedHeadTreeOid: expected.headTreeOid,
        githubRepository: "ancienttwo/arch-context"
      })).toMatchObject({ ok: false, reasonCode: "HEAD_SHA_MISMATCH" });
      expect(verifyReviewActionCheckout({
        checkoutRoot: fixture,
        expectedRepository: "ancienttwo/arch-context",
        expectedHeadSha: expected.headSha,
        expectedHeadTreeOid: "0".repeat(40),
        githubRepository: "ancienttwo/arch-context"
      })).toMatchObject({ ok: false, reasonCode: "TREE_OID_MISMATCH" });
      writeFileSync(join(fixture, "tracked.txt"), "dirty\n");
      expect(verifyReviewActionCheckout({
        checkoutRoot: fixture,
        expectedRepository: "ancienttwo/arch-context",
        expectedHeadSha: expected.headSha,
        expectedHeadTreeOid: expected.headTreeOid,
        githubRepository: "ancienttwo/arch-context"
      })).toMatchObject({ ok: false, reasonCode: "WORKTREE_NOT_CLEAN" });
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("review-action entrypoint emits only metadata preflight outputs", () => {
    const tmp = mkdtempSync(join(tmpdir(), "archctx-review-action-"));
    const outputPath = join(tmp, "output");
    const summaryPath = join(tmp, "summary.md");
    const artifactDigest = `sha256:${"b".repeat(64)}`;
    const fixture = createGitFixture();
    const expected = checkoutExpected(fixture);
    const result = runAction({
      GITHUB_OUTPUT: outputPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_REPOSITORY: "ancienttwo/arch-context",
      INPUT_CHECKOUT_ROOT: fixture,
      INPUT_EXPECTED_REPOSITORY: "ancienttwo/arch-context",
      INPUT_EXPECTED_HEAD_SHA: expected.headSha,
      INPUT_EXPECTED_HEAD_TREE_OID: expected.headTreeOid,
      INPUT_RUNTIME_VERSION: REVIEW_ACTION_DEFAULTS.runtimeVersion,
      INPUT_RUNTIME_ARTIFACT_DIGEST: artifactDigest,
      INPUT_RUNTIME_ARTIFACT_URL: "https://archcontext.repoharness.com/releases/archctx-0.1.0.tgz"
    });

    expect(result.status).toBe(0);
    const output = readFileSync(outputPath, "utf8");
    const summary = readFileSync(summaryPath, "utf8");
    expect(output).toContain(`runtime-version<<`);
    expect(output).toContain(artifactDigest);
    expect(output).toContain("\"schemaVersion\":\"archcontext.review-action-checkout/v1\"");
    expect(output).toContain("\"schemaVersion\":\"archcontext.review-action-plan/v1\"");
    expect(output).toContain("\"schemaVersion\":\"archcontext.review-action-fork-policy/v1\"");
    expect(summary).toContain("Runtime version: 0.1.0");
    expect(summary).toContain(`Head: ${expected.headSha}`);
    expect(runnerPrivacyAudit(JSON.parse(output.match(/action-plan<<[^\n]+\n([\s\S]*?)\narchcontext_action_plan/)![1]))).toEqual({
      ok: true,
      forbiddenKeys: []
    });
    expect(runnerPrivacyAudit(JSON.parse(output.match(/checkout-verification<<[^\n]+\n([\s\S]*?)\narchcontext_checkout_verification/)![1]))).toEqual({
      ok: true,
      forbiddenKeys: []
    });
    expect(runnerPrivacyAudit(JSON.parse(output.match(/fork-policy<<[^\n]+\n([\s\S]*?)\narchcontext_fork_policy/)![1]))).toEqual({
      ok: true,
      forbiddenKeys: []
    });

    const githubEnvOutputPath = join(tmp, "github-env-output");
    const githubEnvSummaryPath = join(tmp, "github-env-summary.md");
    const githubEnvResult = runAction({
      GITHUB_OUTPUT: githubEnvOutputPath,
      GITHUB_STEP_SUMMARY: githubEnvSummaryPath,
      GITHUB_REPOSITORY: "ancienttwo/arch-context",
      "INPUT_CHECKOUT-ROOT": fixture,
      "INPUT_EXPECTED-REPOSITORY": "ancienttwo/arch-context",
      "INPUT_EXPECTED-HEAD-SHA": expected.headSha,
      "INPUT_EXPECTED-HEAD-TREE-OID": expected.headTreeOid,
      "INPUT_RUNTIME-VERSION": REVIEW_ACTION_DEFAULTS.runtimeVersion,
      "INPUT_RUNTIME-ARTIFACT-DIGEST": artifactDigest,
      "INPUT_RUNTIME-ARTIFACT-URL": "https://archcontext.repoharness.com/releases/archctx-0.1.0.tgz"
    });
    expect(githubEnvResult.status).toBe(0);
    expect(readFileSync(githubEnvOutputPath, "utf8")).toContain(artifactDigest);

    const forkOutputPath = join(tmp, "fork-output");
    const forkSummaryPath = join(tmp, "fork-summary.md");
    const forkEventPath = join(tmp, "event.json");
    writeFileSync(forkEventPath, JSON.stringify({
      repository: { full_name: "ancienttwo/arch-context" },
      pull_request: {
        head: {
          repo: { full_name: "forker/arch-context", fork: true }
        }
      }
    }));
    const forkResult = runAction({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: forkEventPath,
      GITHUB_OUTPUT: forkOutputPath,
      GITHUB_STEP_SUMMARY: forkSummaryPath,
      GITHUB_REPOSITORY: "ancienttwo/arch-context"
    });
    expect(forkResult.status).toBe(0);
    const forkOutput = readFileSync(forkOutputPath, "utf8");
    const forkPolicy = JSON.parse(forkOutput.match(/fork-policy<<[^\n]+\n([\s\S]*?)\narchcontext_fork_policy/)![1]);
    expect(forkPolicy).toMatchObject({
      schemaVersion: "archcontext.review-action-fork-policy/v1",
      run: false,
      mode: "unsupported",
      fork: true,
      outputConclusion: "neutral",
      reasonCode: "FORK_PR_UNSUPPORTED"
    });
    expect(forkOutput).not.toContain("runtime-artifact-digest");
    expect(readFileSync(forkSummaryPath, "utf8")).toContain("Fork PR: unsupported");

    const rejected = runAction({
      INPUT_RUNTIME_VERSION: REVIEW_ACTION_DEFAULTS.runtimeVersion,
      INPUT_RUNTIME_ARTIFACT_DIGEST: "sha256:bad",
      INPUT_RUNTIME_ARTIFACT_URL: "https://archcontext.repoharness.com/releases/archctx-0.1.0.tgz"
    });
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("runtime-artifact-digest-invalid");

    const badCheckout = runAction({
      GITHUB_REPOSITORY: "ancienttwo/arch-context",
      INPUT_CHECKOUT_ROOT: fixture,
      INPUT_EXPECTED_REPOSITORY: "ancienttwo/arch-context",
      INPUT_EXPECTED_HEAD_SHA: "e".repeat(40),
      INPUT_EXPECTED_HEAD_TREE_OID: expected.headTreeOid,
      INPUT_RUNTIME_VERSION: REVIEW_ACTION_DEFAULTS.runtimeVersion,
      INPUT_RUNTIME_ARTIFACT_DIGEST: artifactDigest,
      INPUT_RUNTIME_ARTIFACT_URL: "https://archcontext.repoharness.com/releases/archctx-0.1.0.tgz"
    });
    expect(badCheckout.status).not.toBe(0);
    expect(badCheckout.stderr).toContain("HEAD_SHA_MISMATCH");
    rmSync(fixture, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
  });
});

function runAction(env: Record<string, string>) {
  return spawnSync(process.execPath, [join(root, "actions/review-action/dist/review-action.mjs")], {
    env: {
      ...process.env,
      ...env
    },
    encoding: "utf8"
  });
}

function createGitFixture(): string {
  const fixture = mkdtempSync(join(tmpdir(), "archctx-runner-action-"));
  writeFileSync(join(fixture, "tracked.txt"), "committed\n");
  git(fixture, "init");
  git(fixture, "remote", "add", "origin", "https://github.com/ancienttwo/arch-context.git");
  git(fixture, "add", ".");
  git(fixture, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture");
  git(fixture, "checkout", "--detach", "HEAD");
  return fixture;
}

function checkoutExpected(fixture: string): { headSha: string; headTreeOid: string } {
  return {
    headSha: gitOut(fixture, "rev-parse", "HEAD"),
    headTreeOid: gitOut(fixture, "rev-parse", "HEAD^{tree}")
  };
}

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function gitOut(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function createTestReviewChallenge(overrides: Partial<Parameters<typeof createReviewChallengeV2>[0]> = {}) {
  return createReviewChallengeV2({
    challengeId: "chal_runner_v2",
    installationId: 12345,
    repositoryId: 1001,
    pullRequestNumber: 42,
    headSha,
    baseSha,
    nonce: "nonce_runner_v2",
    requiredTrust: "organization",
    policyProfileId: "policy.default",
    createdAt: "2026-06-19T00:00:00Z",
    expiresAt: "2026-06-19T00:10:00Z",
    status: "LEASED",
    ...overrides
  });
}

function createTestRunnerIdentity(input: { publicKey: KeyObject; publicKeyId: string; runnerId: string; workflowRef?: string }) {
  return {
    schemaVersion: "archcontext.runner-identity/v1" as const,
    runnerId: input.runnerId,
    installationId: 12345,
    repositoryIds: [1001],
    scope: { kind: "repository" as const, repositoryIds: [1001] },
    workflowRef: input.workflowRef ?? workflowRef,
    publicKeyId: input.publicKeyId,
    publicKeyFingerprint: publicKeyFingerprint(input.publicKey),
    status: "active" as const,
    createdAt: "2026-06-19T00:00:00Z",
    rotatedAt: null,
    revokedAt: null
  };
}

function runnerKeyStatus(runner: ReturnType<typeof createTestRunnerIdentity>) {
  return {
    schemaVersion: "archcontext.governance-key-status/v1" as const,
    publicKeyId: runner.publicKeyId,
    ownerKind: "runner" as const,
    ownerId: runner.runnerId,
    fingerprint: runner.publicKeyFingerprint,
    status: runner.status,
    createdAt: runner.createdAt,
    rotatedAt: runner.rotatedAt,
    revokedAt: runner.revokedAt
  };
}

function createTestAttestationRuntime() {
  const pin = createReviewActionPreflightPlan({
    runtimeVersion: REVIEW_ACTION_DEFAULTS.runtimeVersion,
    runtimeArtifactDigest: runtimeBuildDigest,
    runtimeArtifactUrl: "https://archcontext.repoharness.com/releases/archctx-0.1.0.tgz"
  });
  if (!pin.ok) throw new Error(pin.reason);
  return createReviewActionAttestationRuntime({
    plan: pin.plan,
    codeGraphVersion: "1.0.1",
    capabilitiesDigest
  });
}

function createTestRunnerSigning(input: { installationId: number; privateKey: KeyObject; publicKeyId: string }) {
  const keyRef = runnerPrivateKeySecretRef({ installationId: input.installationId, publicKeyId: input.publicKeyId });
  const privateKeyPem = input.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const secretStore = new TestRunnerSecretStore([[keyRef, privateKeyPem]]);
  return {
    keyRef,
    privateKeyPem,
    privateKeySource: createRunnerPrivateKeySource({ keyRef, publicKeyId: input.publicKeyId }),
    secretStore
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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
