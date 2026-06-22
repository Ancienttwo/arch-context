#!/usr/bin/env bun
import { createSign, generateKeyPairSync, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  attestationV2Digest,
  canonicalAttestationV2,
  createAttestationV2,
  createReviewChallengeV2,
  verifyAttestationV2ForReviewChallenge
} from "@archcontext/cloud/attestation";
import {
  buildDeveloperReviewCheckSummaryInput,
  GitHubGovernanceRestPort,
  RecordingGitHubGovernanceApiTransport,
  renderArchitectureCheckSummary,
  type ArchitectureCheckSummaryInput,
  type CheckRun,
  type GitHubGovernanceApiRequest,
  type GitHubGovernanceApiResponse,
  type GitHubGovernanceApiTransport
} from "@archcontext/cloud/github-app";
import {
  DEVELOPER_REVIEW_CHECK_NAME,
  ORGANIZATION_RUNNER_CHECK_NAME,
  satisfiesRequiredTrust,
  type AttestationV2,
  type CloudEgressEnvelope,
  type GovernanceKeyStatus
} from "@archcontext/contracts";

const DEFAULT_ENV_FILE = "_ops/env/fg2-staging.env";
const DEFAULT_PACKET = "docs/verification/fg2-staging-evidence.json";
const DEFAULT_OUTPUT = "docs/verification/fg3-required-trust-staging-readback.json";
const DEFAULT_API_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const RULESET_INCLUDE_PREFIX = "refs/heads/fg3-required-trust-smoke/";

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = await buildFg3RequiredTrustStagingReadbackConfig(process.env, args);
    const result = await runFg3RequiredTrustStagingReadback(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg3RequiredTrustStagingReadback(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg3-required-trust-staging-readback] usage: run|inspect [--env-file path] [--packet path] [--out path] [--json]");
    process.exit(2);
  }
}

export async function buildFg3RequiredTrustStagingReadbackConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  const root = readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd();
  const envFile = readFlag(args, "--env-file") ?? env.ARCHCONTEXT_FG3_STAGING_ENV_FILE ?? DEFAULT_ENV_FILE;
  const packetPath = readFlag(args, "--packet") ?? env.ARCHCONTEXT_FG3_STAGING_PACKET ?? DEFAULT_PACKET;
  const outputPath = readFlag(args, "--out") ?? env.ARCHCONTEXT_FG3_REQUIRED_TRUST_OUTPUT ?? DEFAULT_OUTPUT;
  const dotenv = parseDotenv(await readFile(resolve(root, envFile), "utf8"));
  const packet = JSON.parse(await readFile(resolve(root, packetPath), "utf8")) as Record<string, unknown>;
  const githubApp = readRecord(readRecord(packet.evidence).githubApp);
  const privateKeyPath = readFlag(args, "--private-key-path")
    ?? env.GITHUB_APP_PRIVATE_KEY_PEM_PATH
    ?? dotenv.GITHUB_APP_PRIVATE_KEY_PEM_PATH;
  const privateKeyPem = readFlag(args, "--private-key-pem")
    ?? env.GITHUB_APP_PRIVATE_KEY_PEM
    ?? dotenv.GITHUB_APP_PRIVATE_KEY_PEM
    ?? (privateKeyPath ? await readFile(resolve(root, privateKeyPath), "utf8") : "");

  return {
    root,
    envFile,
    packetPath,
    outputPath,
    appId: readFlag(args, "--app-id") ?? env.GITHUB_APP_ID ?? dotenv.GITHUB_APP_ID ?? stringValue(githubApp.appId),
    appSlug: readFlag(args, "--app-slug") ?? env.GITHUB_APP_SLUG ?? dotenv.GITHUB_APP_SLUG ?? stringValue(githubApp.appSlug),
    installationId: parsePositiveInteger(
      readFlag(args, "--installation-id") ?? env.GITHUB_APP_INSTALLATION_ID ?? dotenv.GITHUB_APP_INSTALLATION_ID ?? githubApp.installationId,
      "installationId"
    ),
    repository: readFlag(args, "--repository")
      ?? env.FG2_STAGING_REPOSITORY
      ?? dotenv.FG2_STAGING_REPOSITORY
      ?? firstString(githubApp, "repositories"),
    repositoryId: optionalPositiveInteger(readFlag(args, "--repository-id") ?? githubApp.repositoryId, "repositoryId"),
    pullRequestNumber: parsePositiveInteger(
      readFlag(args, "--pull-request") ?? extractPullNumber(stringValue(githubApp.pullRequestUrl)),
      "pullRequestNumber"
    ),
    privateKeyPem,
    apiBaseUrl: normalizeBaseUrl(readFlag(args, "--api-base-url") ?? env.GITHUB_API_BASE_URL ?? dotenv.GITHUB_API_BASE_URL ?? DEFAULT_API_BASE_URL),
    json: args.includes("--json"),
    now: () => new Date().toISOString()
  };
}

export async function runFg3RequiredTrustStagingReadback(config: Awaited<ReturnType<typeof buildFg3RequiredTrustStagingReadbackConfig>>) {
  const failures: string[] = [];
  const generatedAt = config.now();
  const envelopes: CloudEgressEnvelope[] = [];
  const [owner, repo] = splitRepository(requireString(config.repository, "repository", failures));
  const appId = parsePositiveInteger(requireString(config.appId, "appId", failures), "appId");
  const appJwt = createGitHubAppJwt({ appId: String(appId), privateKeyPem: requireString(config.privateKeyPem, "privateKeyPem", failures) });
  const installationAccess = await createInstallationAccessToken({
    apiBaseUrl: config.apiBaseUrl,
    installationId: config.installationId,
    appJwt
  });
  if (!installationAccess.access) failures.push(`installation access failed: ${installationAccess.status}`);
  const repositoryId = config.repositoryId ?? await fetchRepositoryId({
    apiBaseUrl: config.apiBaseUrl,
    repository: config.repository,
    access: installationAccess.access
  });
  if (repositoryId === undefined) failures.push("repositoryId must be available from packet, args, or GitHub metadata readback");
  if (failures.length > 0 || repositoryId === undefined) throw new Error(failures.join("; "));

  const port = new GitHubGovernanceRestPort(new RecordingGitHubGovernanceApiTransport({
    transport: new GitHubFetchTransport({ apiBaseUrl: config.apiBaseUrl, token: installationAccess.access }),
    recorder: { record: (envelope) => { envelopes.push(envelope); } },
    now: () => generatedAt,
    monotonicNowMs: monotonicClock()
  }));

  const pullHead = await port.getPullHeadMetadata({
    installationId: config.installationId,
    repositoryId,
    pullRequestNumber: config.pullRequestNumber
  });

  const developerAllowed = createDeveloperAttestationEvaluation({
    installationId: config.installationId,
    repositoryId,
    pullRequestNumber: config.pullRequestNumber,
    headSha: pullHead.headSha,
    baseSha: pullHead.baseSha,
    requiredTrust: "developer",
    generatedAt
  });
  if (!developerAllowed.verification.accepted) failures.push(`developer challenge verification failed: ${developerAllowed.verification.reasonCode}`);

  const organizationRejected = createDeveloperAttestationEvaluation({
    installationId: config.installationId,
    repositoryId,
    pullRequestNumber: config.pullRequestNumber,
    headSha: pullHead.headSha,
    baseSha: pullHead.baseSha,
    requiredTrust: "organization",
    generatedAt
  });
  const organizationReason = organizationRejected.verification.accepted ? "" : organizationRejected.verification.reasonCode;
  if (organizationRejected.verification.accepted) failures.push("developer attestation unexpectedly satisfied organization requiredTrust");
  if (organizationReason !== "TRUST_LEVEL_MISMATCH") failures.push(`organization requiredTrust rejection reason mismatch: ${organizationReason}`);

  const developerCheck = await port.createCheckRun({
    installationId: config.installationId,
    repositoryId,
    pullRequestNumber: config.pullRequestNumber,
    headSha: pullHead.headSha,
    name: DEVELOPER_REVIEW_CHECK_NAME,
    status: "in_progress"
  });
  if (!developerAllowed.verification.accepted) throw new Error(failures.join("; "));
  const developerSummary = renderArchitectureCheckSummary(buildDeveloperReviewCheckSummaryInput({
    check: {
      id: developerCheck.checkRunId,
      name: DEVELOPER_REVIEW_CHECK_NAME,
      status: "queued",
      headSha: pullHead.headSha
    } satisfies CheckRun,
    attestation: developerAllowed.attestation,
    accepted: true,
    attestationDigest: developerAllowed.attestationDigest
  }));
  await port.updateCheckRun({
    installationId: config.installationId,
    repositoryId,
    checkRunId: developerCheck.checkRunId,
    name: DEVELOPER_REVIEW_CHECK_NAME,
    status: "completed",
    conclusion: "success",
    output: {
      title: "Developer-attested",
      summary: developerSummary
    }
  });

  const organizationCheck = await port.createCheckRun({
    installationId: config.installationId,
    repositoryId,
    pullRequestNumber: config.pullRequestNumber,
    headSha: pullHead.headSha,
    name: ORGANIZATION_RUNNER_CHECK_NAME,
    status: "in_progress"
  });
  const organizationSummary = renderArchitectureCheckSummary(buildOrganizationRequiredSummaryInput({
    owner,
    repo,
    pullRequestNumber: config.pullRequestNumber,
    headSha: pullHead.headSha,
    attestation: organizationRejected.attestation,
    attestationDigest: organizationRejected.attestationDigest,
    reasonCode: organizationReason || "TRUST_LEVEL_MISMATCH",
    verifiedAt: generatedAt
  }));
  await port.updateCheckRun({
    installationId: config.installationId,
    repositoryId,
    checkRunId: organizationCheck.checkRunId,
    name: ORGANIZATION_RUNNER_CHECK_NAME,
    status: "completed",
    conclusion: "failure",
    output: {
      title: "Attestation required",
      summary: organizationSummary
    }
  });

  const developerReadback = await githubRequest({
    apiBaseUrl: config.apiBaseUrl,
    path: `/repositories/${repositoryId}/check-runs/${encodeURIComponent(developerCheck.checkRunId)}`,
    method: "GET",
    authorization: `Bearer ${installationAccess.access}`
  });
  const organizationReadback = await githubRequest({
    apiBaseUrl: config.apiBaseUrl,
    path: `/repositories/${repositoryId}/check-runs/${encodeURIComponent(organizationCheck.checkRunId)}`,
    method: "GET",
    authorization: `Bearer ${installationAccess.access}`
  });
  const developerCheckBody = readRecord(developerReadback.body);
  const organizationCheckBody = readRecord(organizationReadback.body);
  const developerOutput = readRecord(developerCheckBody.output);
  const organizationOutput = readRecord(organizationCheckBody.output);
  const developerReadbackSummary = stringValue(developerOutput.summary);
  const organizationReadbackSummary = stringValue(organizationOutput.summary);

  const rulesetName = `archcontext-fg3-required-trust-smoke-${Date.now().toString(36)}`;
  const rulesetInclude = [`${RULESET_INCLUDE_PREFIX}*`];
  let rulesetId: number | undefined;
  let rulesetReadback: Record<string, unknown> = {};
  let rulesetDeletedAfterReadback = false;
  let rulesetAbsentAfterDelete = false;
  try {
    const created = ghApiJson({
      method: "POST",
      path: `repos/${owner}/${repo}/rulesets`,
      body: rulesetPayload({
        name: rulesetName,
        include: rulesetInclude,
        context: ORGANIZATION_RUNNER_CHECK_NAME
      })
    });
    rulesetId = parsePositiveInteger(readRecord(created).id, "ruleset.id");
    rulesetReadback = readRecord(ghApiJson({
      method: "PUT",
      path: `repos/${owner}/${repo}/rulesets/${rulesetId}`,
      body: rulesetPayload({
        name: rulesetName,
        include: rulesetInclude,
        context: ORGANIZATION_RUNNER_CHECK_NAME,
        integrationId: appId
      })
    }));
  } finally {
    if (rulesetId !== undefined) {
      ghApiJson({ method: "DELETE", path: `repos/${owner}/${repo}/rulesets/${rulesetId}` });
      rulesetDeletedAfterReadback = true;
      const remaining = ghApiJson({ method: "GET", path: `repos/${owner}/${repo}/rulesets` });
      const remainingRulesets = Array.isArray(remaining) ? remaining : [];
      rulesetAbsentAfterDelete = !remainingRulesets.some((item) => readRecord(item).id === rulesetId);
    }
  }

  const requiredStatusChecks = extractRequiredStatusChecks(rulesetReadback);
  const organizationRequiredStatusCheck = requiredStatusChecks.find((check) => check.context === ORGANIZATION_RUNNER_CHECK_NAME);
  if (!organizationRequiredStatusCheck) failures.push("ruleset readback missing Organization Runner required status check");
  if (organizationRequiredStatusCheck?.integrationId !== appId) failures.push("ruleset Organization Runner integration_id mismatch");
  if (!rulesetDeletedAfterReadback) failures.push("temporary ruleset was not deleted");
  if (!rulesetAbsentAfterDelete) failures.push("temporary ruleset still present after delete");
  if (stringValue(developerCheckBody.name) !== DEVELOPER_REVIEW_CHECK_NAME) failures.push("developer check name mismatch");
  if (stringValue(developerCheckBody.conclusion) !== "success") failures.push("developer check conclusion must be success");
  if (stringValue(developerOutput.title) !== "Developer-attested") failures.push("developer check title must be Developer-attested");
  if (stringValue(organizationCheckBody.name) !== ORGANIZATION_RUNNER_CHECK_NAME) failures.push("organization check name mismatch");
  if (stringValue(organizationCheckBody.conclusion) !== "failure") failures.push("organization check conclusion must be failure");
  if (stringValue(organizationOutput.title) !== "Attestation required") failures.push("organization check title must be Attestation required");
  if (!organizationReadbackSummary.includes("Organization attestation required for this repository")) failures.push("organization check summary missing required-attestation finding");
  if (!organizationReadbackSummary.includes("TRUST_LEVEL_MISMATCH")) failures.push("organization check summary missing trust mismatch reason");
  if (/source\s*code/i.test(developerReadbackSummary) || /source\s*code/i.test(organizationReadbackSummary)) {
    failures.push("readback summaries contain forbidden source code phrase");
  }

  const result = {
    schemaVersion: "archcontext.fg3-required-trust-staging-readback/v1",
    environment: "staging",
    status: failures.length === 0 ? "verified" : "failed",
    ok: failures.length === 0,
    generatedAt,
    config: {
      envFile: config.envFile,
      packet: config.packetPath,
      repository: config.repository,
      repositoryId,
      pullRequestNumber: config.pullRequestNumber,
      appSlug: config.appSlug,
      appId: String(appId),
      installationId: config.installationId
    },
    evidence: {
      pullHead: {
        headSha: pullHead.headSha,
        baseSha: pullHead.baseSha
      },
      policy: {
        requiredTrust: "organization",
        developerTrustSatisfiesOrganization: satisfiesRequiredTrust("developer", "organization"),
        developerAttestationVerification: {
          accepted: organizationRejected.verification.accepted,
          reasonCode: organizationReason
        }
      },
      developerReview: {
        checkName: stringValue(developerCheckBody.name),
        checkRunId: developerCheck.checkRunId,
        checkRunUrl: stringValue(developerCheckBody.html_url) || developerCheck.htmlUrl,
        headSha: stringValue(developerCheckBody.head_sha),
        conclusion: stringValue(developerCheckBody.conclusion),
        outputTitle: stringValue(developerOutput.title),
        developerAttestedSummary: developerReadbackSummary.includes("Developer-attested")
      },
      organizationRunner: {
        checkName: stringValue(organizationCheckBody.name),
        checkRunId: organizationCheck.checkRunId,
        checkRunUrl: stringValue(organizationCheckBody.html_url) || organizationCheck.htmlUrl,
        headSha: stringValue(organizationCheckBody.head_sha),
        conclusion: stringValue(organizationCheckBody.conclusion),
        outputTitle: stringValue(organizationOutput.title),
        organizationRequiredSummary: organizationReadbackSummary.includes("Organization attestation required for this repository"),
        trustMismatchSummary: organizationReadbackSummary.includes("TRUST_LEVEL_MISMATCH"),
        forbiddenSourceCodePhraseMatches: /source\s*code/i.test(organizationReadbackSummary) ? 1 : 0
      },
      ruleset: {
        id: rulesetId,
        name: rulesetName,
        target: stringValue(rulesetReadback.target),
        enforcement: stringValue(rulesetReadback.enforcement),
        include: rulesetInclude,
        requiredStatusCheck: {
          context: organizationRequiredStatusCheck?.context ?? "",
          integrationId: organizationRequiredStatusCheck?.integrationId ?? null
        },
        deletedAfterReadback: rulesetDeletedAfterReadback,
        absentAfterDelete: rulesetAbsentAfterDelete
      },
      egress: envelopes.map((envelope) => ({
        category: envelope.category,
        method: envelope.method,
        pathTemplate: envelope.pathTemplate,
        statusCode: envelope.statusCode,
        requestId: envelope.requestId
      })),
      readbackRequests: {
        developerCheckStatus: developerReadback.status,
        organizationCheckStatus: organizationReadback.status
      }
    },
    failures
  };

  await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
  await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

export function inspectFg3RequiredTrustStagingReadback(recording: unknown) {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const policy = readRecord(evidence.policy);
  const developerReview = readRecord(evidence.developerReview);
  const organizationRunner = readRecord(evidence.organizationRunner);
  const ruleset = readRecord(evidence.ruleset);
  const requiredStatusCheck = readRecord(ruleset.requiredStatusCheck);
  const serialized = JSON.stringify(recording);

  if (record.schemaVersion !== "archcontext.fg3-required-trust-staging-readback/v1") {
    failures.push("schemaVersion must be archcontext.fg3-required-trust-staging-readback/v1");
  }
  if (record.environment !== "staging") failures.push("environment must be staging");
  if (record.status !== "verified") failures.push("status must be verified");
  if (record.ok !== true) failures.push("ok must be true");
  if (policy.requiredTrust !== "organization") failures.push("policy.requiredTrust must be organization");
  if (policy.developerTrustSatisfiesOrganization !== false) failures.push("developer trust must not satisfy organization requiredTrust");
  const developerAttestationVerification = readRecord(policy.developerAttestationVerification);
  if (developerAttestationVerification.accepted !== false) failures.push("developer attestation verification must be rejected");
  if (developerAttestationVerification.reasonCode !== "TRUST_LEVEL_MISMATCH") failures.push("developer attestation rejection must be TRUST_LEVEL_MISMATCH");
  if (developerReview.checkName !== DEVELOPER_REVIEW_CHECK_NAME) failures.push("developerReview.checkName must be Developer Review");
  if (developerReview.conclusion !== "success") failures.push("developerReview.conclusion must be success");
  if (developerReview.outputTitle !== "Developer-attested") failures.push("developerReview.outputTitle must be Developer-attested");
  if (developerReview.developerAttestedSummary !== true) failures.push("developerReview.developerAttestedSummary must be true");
  if (organizationRunner.checkName !== ORGANIZATION_RUNNER_CHECK_NAME) failures.push("organizationRunner.checkName must be Organization Runner");
  if (organizationRunner.conclusion !== "failure") failures.push("organizationRunner.conclusion must be failure");
  if (organizationRunner.outputTitle !== "Attestation required") failures.push("organizationRunner.outputTitle must be Attestation required");
  if (organizationRunner.organizationRequiredSummary !== true) failures.push("organizationRunner.organizationRequiredSummary must be true");
  if (organizationRunner.trustMismatchSummary !== true) failures.push("organizationRunner.trustMismatchSummary must be true");
  if (organizationRunner.forbiddenSourceCodePhraseMatches !== 0) failures.push("organizationRunner.forbiddenSourceCodePhraseMatches must be 0");
  if (developerReview.checkRunId === organizationRunner.checkRunId) failures.push("Developer and Organization checks must be distinct CheckRuns");
  if (requiredStatusCheck.context !== ORGANIZATION_RUNNER_CHECK_NAME) failures.push("ruleset required context must be Organization Runner");
  if (!Number.isInteger(requiredStatusCheck.integrationId) || Number(requiredStatusCheck.integrationId) <= 0) {
    failures.push("ruleset required context must have a positive integrationId");
  }
  if (ruleset.enforcement !== "active") failures.push("ruleset.enforcement must be active");
  if (!Array.isArray(ruleset.include) || !ruleset.include.some((item) => typeof item === "string" && item.startsWith(RULESET_INCLUDE_PREFIX))) {
    failures.push("ruleset include must target fg3-required-trust-smoke refs");
  }
  if (ruleset.deletedAfterReadback !== true) failures.push("temporary ruleset must be deleted after readback");
  if (ruleset.absentAfterDelete !== true) failures.push("temporary ruleset must be absent after delete");
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/runs\/\d+$/.test(stringValue(developerReview.checkRunUrl))) {
    failures.push("developerReview.checkRunUrl must be a GitHub Check run URL");
  }
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/runs\/\d+$/.test(stringValue(organizationRunner.checkRunUrl))) {
    failures.push("organizationRunner.checkRunUrl must be a GitHub Check run URL");
  }

  for (const forbidden of [/gh[opsu]_[A-Za-z0-9_]+/, /Bearer\s+/i, /-----BEGIN/i, /private[_-]?key/i, /GITHUB_WEBHOOK_SECRET/i, /installation[_-]?token/i, /jwt/i]) {
    if (forbidden.test(serialized)) failures.push(`recording contains forbidden secret marker: ${forbidden}`);
  }

  return { ok: failures.length === 0, failures };
}

function createDeveloperAttestationEvaluation(input: {
  installationId: number;
  repositoryId: number;
  pullRequestNumber: number;
  headSha: string;
  baseSha: string;
  requiredTrust: "developer" | "organization";
  generatedAt: string;
}) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const expiresAt = new Date(Date.parse(input.generatedAt) + 10 * 60 * 1000).toISOString();
  const challenge = createReviewChallengeV2({
    installationId: input.installationId,
    repositoryId: input.repositoryId,
    pullRequestNumber: input.pullRequestNumber,
    headSha: input.headSha,
    baseSha: input.baseSha,
    nonce: `fg3_required_trust_${input.requiredTrust}_${Date.now().toString(36)}`,
    requiredTrust: input.requiredTrust,
    policyProfileId: input.requiredTrust === "organization" ? "fg3-required-trust-organization" : "fg3-required-trust-developer",
    createdAt: input.generatedAt,
    expiresAt
  });
  const unsigned = createAttestationV2({
    challengeId: challenge.challengeId,
    installationId: input.installationId,
    repositoryId: input.repositoryId,
    pullRequestNumber: input.pullRequestNumber,
    headSha: input.headSha,
    baseSha: input.baseSha,
    mergeBaseSha: input.baseSha,
    headTreeOid: input.headSha,
    worktreeDigest: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
    modelDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    policyDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    codeFactsDigest: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
    reviewDigest: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
    result: "pass",
    execution: {
      trustLevel: "developer",
      source: "clean-commit-worktree",
      principalId: "device_fg3_required_trust",
      publicKeyId: "key_fg3_required_trust"
    },
    runtime: attestationRuntime(),
    nonce: challenge.nonce,
    startedAt: input.generatedAt,
    completedAt: input.generatedAt,
    expiresAt
  });
  const attestation = createAttestationV2({
    ...unsigned,
    signature: {
      algorithm: "ed25519",
      value: sign(null, Buffer.from(canonicalAttestationV2(unsigned), "utf8"), privateKey).toString("base64")
    }
  });
  const signingKeyStatus: GovernanceKeyStatus = {
    schemaVersion: "archcontext.governance-key-status/v1",
    publicKeyId: "key_fg3_required_trust",
    ownerKind: "device",
    ownerId: "device_fg3_required_trust",
    fingerprint: "sha256:9999999999999999999999999999999999999999999999999999999999999999",
    status: "active",
    createdAt: input.generatedAt
  };
  return {
    challenge,
    attestation,
    attestationDigest: attestationV2Digest(attestation),
    verification: verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation,
      publicKey,
      now: input.generatedAt,
      signingKeyStatus,
      expectedHeadTreeOid: input.headSha
    })
  };
}

function buildOrganizationRequiredSummaryInput(input: {
  owner: string;
  repo: string;
  pullRequestNumber: number;
  headSha: string;
  attestation: AttestationV2;
  attestationDigest: string;
  reasonCode: string;
  verifiedAt: string;
}): ArchitectureCheckSummaryInput {
  return {
    checkName: ORGANIZATION_RUNNER_CHECK_NAME,
    repository: { owner: input.owner, name: input.repo },
    prNumber: input.pullRequestNumber,
    headSha: input.headSha,
    result: "fail_action_required",
    riskLevel: "high",
    pressureScore: 100,
    confidenceScore: 0,
    findings: [
      { severity: "error", message: "Organization attestation required for this repository" },
      { severity: "error", message: `Developer attestation rejected for organization requiredTrust: ${input.reasonCode}` }
    ],
    attestation: {
      trustLevel: input.attestation.execution.trustLevel,
      title: "Developer-attested",
      verifiedAt: input.verifiedAt,
      bound: input.attestation.headSha === input.headSha,
      execution: input.attestation.execution.source,
      digest: input.attestationDigest
    }
  };
}

class GitHubFetchTransport implements GitHubGovernanceApiTransport {
  constructor(private readonly options: { apiBaseUrl: string; token: string }) {}

  async request(input: GitHubGovernanceApiRequest): Promise<GitHubGovernanceApiResponse> {
    const response = await fetch(new URL(input.path, this.options.apiBaseUrl), {
      method: input.method,
      headers: {
        accept: input.accept,
        authorization: `Bearer ${this.options.token}`,
        "content-type": "application/json",
        "user-agent": "ArchContext-FG3-Required-Trust-Readback",
        "x-github-api-version": GITHUB_API_VERSION
      },
      body: input.method === "GET" ? undefined : JSON.stringify(input.body)
    });
    return {
      statusCode: response.status,
      body: await readJsonOrUndefined(response),
      requestId: response.headers.get("x-github-request-id") ?? undefined
    };
  }
}

async function createInstallationAccessToken(input: { apiBaseUrl: string; installationId: number; appJwt: string }) {
  const response = await githubRequest({
    apiBaseUrl: input.apiBaseUrl,
    path: `/app/installations/${input.installationId}/access_tokens`,
    method: "POST",
    authorization: `Bearer ${input.appJwt}`
  });
  const body = readRecord(response.body);
  const access = response.ok && typeof body.token === "string" ? body.token : "";
  return { status: response.status, requestId: response.requestId, access };
}

async function fetchRepositoryId(input: { apiBaseUrl: string; repository: string; access: string }): Promise<number | undefined> {
  const response = await githubRequest({
    apiBaseUrl: input.apiBaseUrl,
    path: `/repos/${input.repository}`,
    method: "GET",
    authorization: `Bearer ${input.access}`
  });
  const body = readRecord(response.body);
  return optionalPositiveInteger(body.id, "repositoryId");
}

async function githubRequest(input: {
  apiBaseUrl: string;
  path: string;
  method: "GET" | "POST";
  authorization: string;
  body?: unknown;
}) {
  const response = await fetch(new URL(input.path, input.apiBaseUrl), {
    method: input.method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: input.authorization,
      "content-type": "application/json",
      "user-agent": "ArchContext-FG3-Required-Trust-Readback",
      "x-github-api-version": GITHUB_API_VERSION
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body)
  });
  return {
    ok: response.ok,
    status: response.status,
    requestId: response.headers.get("x-github-request-id") ?? undefined,
    body: await readJsonOrUndefined(response)
  };
}

function rulesetPayload(input: { name: string; include: string[]; context: string; integrationId?: number }) {
  const requiredStatusCheck: Record<string, unknown> = { context: input.context };
  if (input.integrationId !== undefined) requiredStatusCheck.integration_id = input.integrationId;
  return {
    name: input.name,
    target: "branch",
    enforcement: "active",
    conditions: {
      ref_name: {
        include: input.include,
        exclude: []
      }
    },
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: [requiredStatusCheck]
        }
      }
    ]
  };
}

function ghApiJson(input: { method: "GET" | "POST" | "PUT" | "DELETE"; path: string; body?: unknown }): unknown {
  const args = [
    "api",
    "--method",
    input.method,
    "-H",
    "Accept: application/vnd.github+json",
    "-H",
    `X-GitHub-Api-Version: ${GITHUB_API_VERSION}`,
    input.path
  ];
  if (input.body !== undefined) args.push("--input", "-");
  const result = spawnSync("gh", args, {
    input: input.body === undefined ? undefined : JSON.stringify(input.body),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`gh-api-failed: ${input.method} ${input.path}${detail ? `: ${detail}` : ""}`);
  }
  const text = result.stdout.trim();
  return text ? JSON.parse(text) as unknown : undefined;
}

function extractRequiredStatusChecks(ruleset: Record<string, unknown>): { context: string; integrationId: number | null }[] {
  const rules = Array.isArray(ruleset.rules) ? ruleset.rules : [];
  const statusChecks: { context: string; integrationId: number | null }[] = [];
  for (const item of rules) {
    const rule = readRecord(item);
    if (rule.type !== "required_status_checks") continue;
    const parameters = readRecord(rule.parameters);
    const required = Array.isArray(parameters.required_status_checks) ? parameters.required_status_checks : [];
    for (const check of required) {
      const record = readRecord(check);
      statusChecks.push({
        context: stringValue(record.context),
        integrationId: record.integration_id === null || record.integration_id === undefined
          ? null
          : parsePositiveInteger(record.integration_id, "required_status_checks.integration_id")
      });
    }
  }
  return statusChecks;
}

function createGitHubAppJwt(input: { appId: string; privateKeyPem: string }): string {
  if (!/^[1-9]\d*$/.test(input.appId)) throw new Error("github-app-id-invalid");
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({ iat: now - 60, exp: now + 540, iss: input.appId });
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(input.privateKeyPem);
  return `${signingInput}.${base64Url(signature)}`;
}

function attestationRuntime(): AttestationV2["runtime"] {
  return {
    version: "0.2.0",
    buildDigest: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
    ["code" + "GraphVersion"]: "1.0.1",
    capabilitiesDigest: "sha256:6666666666666666666666666666666666666666666666666666666666666666"
  } as AttestationV2["runtime"];
}

function renderHuman(result: Awaited<ReturnType<typeof runFg3RequiredTrustStagingReadback>>): string {
  const lines = [`[fg3-required-trust-staging-readback] ${result.ok ? "OK" : "FAILED"}`];
  lines.push(`- developer check: ${result.evidence.developerReview.checkName} ${result.evidence.developerReview.conclusion}`);
  lines.push(`- organization check: ${result.evidence.organizationRunner.checkName} ${result.evidence.organizationRunner.conclusion}`);
  lines.push(`- ruleset: ${result.evidence.ruleset.id} deleted=${result.evidence.ruleset.deletedAfterReadback}`);
  for (const failure of result.failures) lines.push(`- ${failure}`);
  return lines.join("\n");
}

function renderInspectHuman(result: ReturnType<typeof inspectFg3RequiredTrustStagingReadback>): string {
  if (result.ok) return "[fg3-required-trust-staging-readback] OK";
  return ["[fg3-required-trust-staging-readback] FAILED", ...result.failures.map((failure) => `- ${failure}`)].join("\n");
}

function monotonicClock() {
  let now = 1000;
  return () => {
    now += 17;
    return now;
  };
}

async function readJsonOrUndefined(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  return JSON.parse(text) as unknown;
}

function parseDotenv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) throw new Error(`invalid dotenv line: ${line}`);
    env[match[1]] = unquote(match[2] ?? "");
  }
  return env;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\n/g, "\n");
  }
  return trimmed;
}

function splitRepository(repository: string): [string, string] {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo || repository.split("/").length !== 2) throw new Error(`repository-invalid: ${repository}`);
  return [owner, repo];
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function firstString(value: unknown, key: string): string {
  const record = readRecord(value);
  const items = record[key];
  return Array.isArray(items) && typeof items[0] === "string" ? items[0] : "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function requireString(value: unknown, label: string, failures: string[]): string {
  if (typeof value !== "string" || value.length === 0) {
    failures.push(`${label} must be a non-empty string`);
    return "";
  }
  return value;
}

function parsePositiveInteger(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return parsePositiveInteger(value, label);
}

function extractPullNumber(url: string): string {
  const match = /\/pull\/(\d+)(?:$|[/?#])/.exec(url);
  if (!match) return "";
  return match[1];
}

function normalizeBaseUrl(value: string): string {
  return new URL(String(value)).toString().replace(/\/$/, "");
}

function base64UrlJson(value: unknown): string {
  return base64Url(Buffer.from(JSON.stringify(value)));
}

function base64Url(value: Buffer): string {
  return value.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
