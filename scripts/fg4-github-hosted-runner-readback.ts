#!/usr/bin/env bun
import { createSign } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  verifyAttestationV2ForReviewChallenge
} from "@archcontext/cloud/attestation";
import {
  buildOrganizationRunnerCheckSummaryInput,
  GitHubGovernanceRestPort,
  RecordingGitHubGovernanceApiTransport,
  renderArchitectureCheckSummary,
  type CheckRun,
  type GitHubGovernanceApiRequest,
  type GitHubGovernanceApiResponse,
  type GitHubGovernanceApiTransport
} from "@archcontext/cloud/github-app";
import {
  ORGANIZATION_RUNNER_CHECK_NAME,
  type AttestationV2,
  type CloudEgressEnvelope,
  type GovernanceKeyStatus,
  type ReviewChallengeV2,
  type RunnerIdentity
} from "@archcontext/contracts";
import { publicKeyFromJwk } from "./fg4-github-hosted-runner-attestation";

const DEFAULT_ENV_FILE = "_ops/env/fg2-staging.env";
const DEFAULT_PACKET = "docs/verification/fg2-staging-evidence.json";
const DEFAULT_OUTPUT = "docs/verification/fg4-github-hosted-runner-readback.json";
const DEFAULT_API_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const WORKFLOW_FILENAME = "fg4-eg1-github-hosted-runner.yml";
const WORKFLOW_PATH = `.github/workflows/${WORKFLOW_FILENAME}`;
const WORKFLOW_NAME = "FG4 EG1 GitHub-hosted Organization Runner";
const ARTIFACT_NAME = "archcontext-fg4-eg1-attestation";
const ATTESTATION_FILE_NAME = "fg4-eg1-organization-attestation.json";
const SELF_HOSTED_OUTPUT = "docs/verification/fg4-self-hosted-runner-execution-readback.json";
const SELF_HOSTED_WORKFLOW_FILENAME = "fg4-eg2-self-hosted-runner.yml";
const SELF_HOSTED_WORKFLOW_NAME = "FG4 EG2 Self-hosted Organization Runner";
const SELF_HOSTED_ARTIFACT_NAME = "archcontext-fg4-eg2-attestation";
const SELF_HOSTED_ATTESTATION_FILE_NAME = "fg4-eg2-organization-attestation.json";
const SELF_HOSTED_DEFAULT_RUNNER_LABELS = ["self-hosted", "macOS", "ARM64", "archcontext-fg4-eg2"];
const RUNTIME_ARTIFACT_URL = "https://archcontext.repoharness.com/releases/archctx-0.1.0.tgz";
const RUNTIME_ARTIFACT_DIGEST = `sha256:${"a".repeat(64)}`;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = await buildFg4GithubHostedRunnerReadbackConfig(process.env, args);
    const result = await runFg4GithubHostedRunnerReadback(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg4GithubHostedRunnerReadback(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg4-github-hosted-runner-readback] usage: run|inspect [--env-file path] [--packet path] [--out path] [--self-hosted] [--runner-labels csv] [--json]");
    process.exit(2);
  }
}

export async function buildFg4GithubHostedRunnerReadbackConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  const root = readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd();
  const envFile = readFlag(args, "--env-file") ?? DEFAULT_ENV_FILE;
  const packetPath = readFlag(args, "--packet") ?? DEFAULT_PACKET;
  const selfHosted = args.includes("--self-hosted");
  const outputPath = readFlag(args, "--out") ?? (selfHosted ? SELF_HOSTED_OUTPUT : DEFAULT_OUTPUT);
  const runnerLabels = selfHosted
    ? parseCsv(readFlag(args, "--runner-labels") ?? SELF_HOSTED_DEFAULT_RUNNER_LABELS.join(","))
    : ["ubuntu-latest"];
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
    repository: readFlag(args, "--repository")
      ?? env.FG2_STAGING_REPOSITORY
      ?? dotenv.FG2_STAGING_REPOSITORY
      ?? firstString(githubApp, "repositories"),
    repositoryId: optionalPositiveInteger(readFlag(args, "--repository-id") ?? githubApp.repositoryId, "repositoryId"),
    appId: readFlag(args, "--app-id") ?? env.GITHUB_APP_ID ?? dotenv.GITHUB_APP_ID ?? stringValue(githubApp.appId),
    appSlug: readFlag(args, "--app-slug") ?? env.GITHUB_APP_SLUG ?? dotenv.GITHUB_APP_SLUG ?? stringValue(githubApp.appSlug),
    installationId: parsePositiveInteger(
      readFlag(args, "--installation-id") ?? env.GITHUB_APP_INSTALLATION_ID ?? dotenv.GITHUB_APP_INSTALLATION_ID ?? githubApp.installationId,
      "installationId"
    ),
    privateKeyPem,
    apiBaseUrl: normalizeBaseUrl(readFlag(args, "--api-base-url") ?? env.GITHUB_API_BASE_URL ?? dotenv.GITHUB_API_BASE_URL ?? DEFAULT_API_BASE_URL),
    baseBranch: readFlag(args, "--base") ?? "main",
    branchName: readFlag(args, "--branch") ?? `codex/${selfHosted ? "fg4-eg2-self-hosted" : "fg4-eg1-github-hosted"}-readback-${Date.now().toString(36)}`,
    readback: {
      kind: selfHosted ? "self-hosted" : "github-hosted",
      schemaVersion: selfHosted ? "archcontext.fg4-self-hosted-runner-readback/v1" : "archcontext.fg4-github-hosted-runner-readback/v1",
      workflowFilename: selfHosted ? SELF_HOSTED_WORKFLOW_FILENAME : WORKFLOW_FILENAME,
      workflowPath: `.github/workflows/${selfHosted ? SELF_HOSTED_WORKFLOW_FILENAME : WORKFLOW_FILENAME}`,
      workflowName: selfHosted ? SELF_HOSTED_WORKFLOW_NAME : WORKFLOW_NAME,
      artifactName: selfHosted ? SELF_HOSTED_ARTIFACT_NAME : ARTIFACT_NAME,
      attestationFileName: selfHosted ? SELF_HOSTED_ATTESTATION_FILE_NAME : ATTESTATION_FILE_NAME,
      attestationSchemaVersion: selfHosted ? "archcontext.fg4-self-hosted-runner-attestation/v1" : "archcontext.fg4-github-hosted-runner-attestation/v1",
      readbackId: selfHosted ? "fg4-eg2-self-hosted-runner" : "fg4-eg1-github-hosted-runner",
      jobName: selfHosted ? "Self-hosted Organization Runner" : "GitHub-hosted Organization Runner",
      expectedRunnerOs: selfHosted ? "macOS" : "Linux",
      runnerLabels
    },
    keepRemote: args.includes("--keep-remote"),
    timeoutMs: Number(readFlag(args, "--timeout-ms") ?? 12 * 60 * 1000),
    pollMs: Number(readFlag(args, "--poll-ms") ?? 10 * 1000),
    json: args.includes("--json"),
    now: () => new Date().toISOString()
  };
}

export async function runFg4GithubHostedRunnerReadback(config: Awaited<ReturnType<typeof buildFg4GithubHostedRunnerReadbackConfig>>) {
  const failures: string[] = [];
  const generatedAt = config.now();
  const envelopes: CloudEgressEnvelope[] = [];
  const [owner, repo] = splitRepository(config.repository);
  const appId = parsePositiveInteger(config.appId, "appId");
  const repositoryId = config.repositoryId ?? parsePositiveInteger(readRecord(ghApiJson({
    method: "GET",
    path: `repos/${owner}/${repo}`
  })).id, "repositoryId");
  const temp = mkdtempSync(join(tmpdir(), "archctx-fg4-eg1-"));
  const workflowLocalPath = resolve(config.root, config.readback.workflowPath);
  const priorWorkflow = existsSync(workflowLocalPath) ? readFileSync(workflowLocalPath, "utf8") : undefined;
  let tempCommit = "";
  let pullRequestNumber = 0;
  let pullRequestUrl = "";
  let workflowRun: WorkflowRun | undefined;
  let checkRunId = "";
  let checkRunUrl = "";
  let prClosedAfterReadback = false;
  let branchDeletedAfterReadback = false;

  try {
    writeFileSync(workflowLocalPath, stagingWorkflowYaml({
      installationId: config.installationId,
        repositoryId,
        runtimeArtifactUrl: RUNTIME_ARTIFACT_URL,
        runtimeArtifactDigest: RUNTIME_ARTIFACT_DIGEST,
        workflowName: config.readback.workflowName,
        workflowFilename: config.readback.workflowFilename,
        jobName: config.readback.jobName,
        runsOn: config.readback.runnerLabels,
        artifactName: config.readback.artifactName,
        attestationFileName: config.readback.attestationFileName,
        attestationSchemaVersion: config.readback.attestationSchemaVersion,
        readbackId: config.readback.readbackId
      }), "utf8");
    tempCommit = createTemporaryReadbackCommit({
      root: config.root,
      indexPath: join(temp, "index"),
      baseBranch: `origin/${config.baseBranch}`,
      branchName: config.branchName
    });
    execFileSync("git", ["push", "origin", `${tempCommit}:refs/heads/${config.branchName}`], {
      cwd: config.root,
      stdio: ["ignore", "pipe", "pipe"]
    });
    pullRequestUrl = createPullRequest({
      repository: config.repository,
      branchName: config.branchName,
      baseBranch: config.baseBranch,
      title: `${config.readback.workflowName} readback`,
      body: `Temporary PR created by ArchContext ${config.readback.kind} readback. It is closed and deleted after evidence capture.`
    });
    pullRequestNumber = parsePullNumber(pullRequestUrl);
    workflowRun = await waitForWorkflowRun({
      repository: config.repository,
      branchName: config.branchName,
      headSha: tempCommit,
      workflowName: config.readback.workflowName,
      timeoutMs: config.timeoutMs,
      pollMs: config.pollMs
    });
    if (workflowRun.conclusion !== "success") failures.push(`workflow conclusion must be success: ${workflowRun.conclusion}`);

    const artifactPath = downloadAttestationArtifact({
      repository: config.repository,
      runId: workflowRun.databaseId,
      outputDir: join(temp, "artifact"),
      artifactName: config.readback.artifactName,
      attestationFileName: config.readback.attestationFileName
    });
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as Record<string, unknown>;
    const artifactEvidence = readRecord(artifact.evidence);
    const challenge = readRecord(artifactEvidence.challenge) as unknown as ReviewChallengeV2;
    const attestation = readRecord(artifactEvidence.attestation) as unknown as AttestationV2;
    const runnerIdentity = readRecord(artifactEvidence.runnerIdentity) as unknown as RunnerIdentity;
    const runnerKeyStatus = readRecord(artifactEvidence.runnerKeyStatus) as unknown as GovernanceKeyStatus;
    const publicKey = publicKeyFromJwk(readRecord(artifactEvidence.publicKeyJwk) as JsonWebKey);
    const verification = verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation,
      publicKey,
      runnerIdentity,
      signingKeyStatus: runnerKeyStatus,
      now: stringValue(artifact.generatedAt),
      expectedHeadTreeOid: attestation.headTreeOid
    });
    if (!verification.accepted) failures.push(`attestation verification failed: ${verification.reasonCode}`);
    if (readRecord(artifactEvidence.deterministicGate).llmProviderConfigured !== false) failures.push("deterministic gate must have llmProviderConfigured=false");
    if (attestation.execution?.trustLevel !== "organization") failures.push("attestation trust level must be organization");
    if (attestation.result !== "pass") failures.push("attestation result must be pass");
    if (stringValue(readRecord(artifact.workflow).runnerOs) !== config.readback.expectedRunnerOs) {
      failures.push(`workflow artifact runner OS must be ${config.readback.expectedRunnerOs}`);
    }

    const appJwt = createGitHubAppJwt({ appId: String(appId), privateKeyPem: config.privateKeyPem });
    const installationAccess = await createInstallationAccessToken({
      apiBaseUrl: config.apiBaseUrl,
      installationId: config.installationId,
      appJwt
    });
    if (!installationAccess.access) failures.push(`installation access failed: ${installationAccess.status}`);
    if (failures.length > 0 || !installationAccess.access) throw new Error(failures.join("; "));

    const port = new GitHubGovernanceRestPort(new RecordingGitHubGovernanceApiTransport({
      transport: new GitHubFetchTransport({ apiBaseUrl: config.apiBaseUrl, token: installationAccess.access }),
      recorder: { record: (envelope) => { envelopes.push(envelope); } },
      now: () => generatedAt,
      monotonicNowMs: monotonicClock()
    }));
    const pullHead = await port.getPullHeadMetadata({
      installationId: config.installationId,
      repositoryId,
      pullRequestNumber
    });
    if (pullHead.headSha !== tempCommit) failures.push("pull head sha must match temporary readback commit");
    if (challenge.pullRequestNumber !== pullRequestNumber) failures.push("challenge pull request number must match temporary PR");
    if (challenge.headSha !== pullHead.headSha) failures.push("challenge head must match temporary PR head");
    const check = await port.createCheckRun({
      installationId: config.installationId,
      repositoryId,
      pullRequestNumber,
      headSha: pullHead.headSha,
      name: ORGANIZATION_RUNNER_CHECK_NAME,
      status: "in_progress"
    });
    checkRunId = check.checkRunId;
    const summary = renderArchitectureCheckSummary(buildOrganizationRunnerCheckSummaryInput({
      check: {
        id: check.checkRunId,
        name: ORGANIZATION_RUNNER_CHECK_NAME,
        status: "queued",
        headSha: pullHead.headSha
      } satisfies CheckRun,
      attestation,
      accepted: verification.accepted,
      attestationDigest: verification.accepted ? verification.attestationDigest : stringValue(artifactEvidence.attestationDigest)
    }));
    await port.updateCheckRun({
      installationId: config.installationId,
      repositoryId,
      checkRunId,
      name: ORGANIZATION_RUNNER_CHECK_NAME,
      status: "completed",
      conclusion: "success",
      output: {
        title: "Organization-attested",
        summary
      }
    });
    const checkReadback = await githubRequest({
      apiBaseUrl: config.apiBaseUrl,
      path: `/repositories/${repositoryId}/check-runs/${encodeURIComponent(checkRunId)}`,
      method: "GET",
      authorization: `Bearer ${installationAccess.access}`
    });
    const checkBody = readRecord(checkReadback.body);
    const checkOutput = readRecord(checkBody.output);
    checkRunUrl = stringValue(checkBody.html_url) || check.htmlUrl || "";
    if (stringValue(checkBody.name) !== ORGANIZATION_RUNNER_CHECK_NAME) failures.push("organization check name mismatch");
    if (stringValue(checkBody.conclusion) !== "success") failures.push("organization check conclusion must be success");
    if (stringValue(checkOutput.title) !== "Organization-attested") failures.push("organization check title must be Organization-attested");
    if (!stringValue(checkOutput.summary).includes("Organization-attested")) failures.push("organization check summary must include Organization-attested");

    if (!config.keepRemote) {
      closePullRequest({ repository: config.repository, pullRequestNumber });
      prClosedAfterReadback = true;
      deleteBranch({ repository: config.repository, branchName: config.branchName });
      branchDeletedAfterReadback = true;
    }

    const result = {
      schemaVersion: config.readback.schemaVersion,
      environment: "staging",
      status: failures.length === 0 ? "verified" : "failed",
      ok: failures.length === 0,
      generatedAt,
      config: {
        envFile: config.envFile,
        packet: config.packetPath,
        repository: config.repository,
        repositoryId,
        appSlug: config.appSlug,
        appId: String(appId),
        installationId: config.installationId
      },
      evidence: {
        temporaryBranch: {
          name: config.branchName,
          commit: tempCommit,
          deletedAfterReadback: branchDeletedAfterReadback
        },
        pullRequest: {
          number: pullRequestNumber,
          url: pullRequestUrl,
          closedAfterReadback: prClosedAfterReadback
        },
        workflow: {
          name: config.readback.workflowName,
          kind: config.readback.kind,
          runnerLabels: config.readback.runnerLabels,
          runId: workflowRun.databaseId,
          runUrl: workflowRun.url,
          event: workflowRun.event,
          status: workflowRun.status,
          conclusion: workflowRun.conclusion,
          headSha: workflowRun.headSha
        },
        artifact: {
          schemaVersion: stringValue(artifact.schemaVersion),
          ok: artifact.ok === true,
          environment: stringValue(artifact.environment),
          runnerOs: stringValue(readRecord(artifact.workflow).runnerOs),
          runnerName: stringValue(readRecord(artifact.workflow).runnerName),
          llmProviderConfigured: readRecord(artifactEvidence.deterministicGate).llmProviderConfigured,
          attestationTrustLevel: attestation.execution.trustLevel,
          attestationResult: attestation.result,
          attestationDigest: verification.accepted ? verification.attestationDigest : stringValue(artifactEvidence.attestationDigest),
          privacyAuditOk: readRecord(artifactEvidence.privacyAudit).ok === true,
          verificationAccepted: verification.accepted
        },
        organizationRunner: {
          checkName: ORGANIZATION_RUNNER_CHECK_NAME,
          checkRunId,
          checkRunUrl,
          conclusion: "success",
          outputTitle: "Organization-attested"
        },
        egress: envelopes.map((envelope) => ({
          category: envelope.category,
          method: envelope.method,
          pathTemplate: envelope.pathTemplate,
          statusCode: envelope.statusCode,
          requestId: envelope.requestId
        }))
      },
      failures
    };
    await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
    await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    return result;
  } finally {
    if (priorWorkflow === undefined) {
      if (existsSync(workflowLocalPath)) unlinkSync(workflowLocalPath);
    } else {
      writeFileSync(workflowLocalPath, priorWorkflow, "utf8");
    }
    rmSync(temp, { recursive: true, force: true });
    if (!config.keepRemote) {
      if (pullRequestNumber > 0 && !prClosedAfterReadback) {
        try { closePullRequest({ repository: config.repository, pullRequestNumber }); } catch {}
      }
      if (!branchDeletedAfterReadback) {
        try { deleteBranch({ repository: config.repository, branchName: config.branchName }); } catch {}
      }
    }
  }
}

export function inspectFg4GithubHostedRunnerReadback(recording: unknown) {
  const failures: string[] = [];
  const record = readRecord(recording);
  const target = readbackTargetForSchema(stringValue(record.schemaVersion));
  const evidence = readRecord(record.evidence);
  const temporaryBranch = readRecord(evidence.temporaryBranch);
  const pullRequest = readRecord(evidence.pullRequest);
  const workflow = readRecord(evidence.workflow);
  const artifact = readRecord(evidence.artifact);
  const organizationRunner = readRecord(evidence.organizationRunner);
  const serialized = JSON.stringify(recording);

  if (!target) failures.push("schemaVersion mismatch");
  if (record.environment !== "staging") failures.push("environment must be staging");
  if (record.status !== "verified" || record.ok !== true) failures.push("record must be verified");
  if (temporaryBranch.deletedAfterReadback !== true) failures.push("temporary branch must be deleted");
  if (pullRequest.closedAfterReadback !== true) failures.push("temporary PR must be closed");
  if (target && workflow.name !== target.workflowName) failures.push("workflow name mismatch");
  if (workflow.event !== "pull_request") failures.push("workflow event must be pull_request");
  if (workflow.conclusion !== "success") failures.push("workflow conclusion must be success");
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+/.test(stringValue(workflow.runUrl))) failures.push("workflow runUrl must be a GitHub Actions URL");
  if (artifact.ok !== true) failures.push("artifact.ok must be true");
  if (artifact.environment !== "github-actions") failures.push("artifact environment must be github-actions");
  if (target && artifact.runnerOs !== target.expectedRunnerOs) failures.push(`artifact runnerOs must be ${target.expectedRunnerOs}`);
  if (target?.kind === "self-hosted" && !artifact.runnerName) failures.push("self-hosted artifact runnerName must be present");
  if (artifact.llmProviderConfigured !== false) failures.push("llmProviderConfigured must be false");
  if (artifact.attestationTrustLevel !== "organization") failures.push("attestation trust level must be organization");
  if (artifact.attestationResult !== "pass") failures.push("attestation result must be pass");
  if (artifact.privacyAuditOk !== true) failures.push("privacy audit must pass");
  if (artifact.verificationAccepted !== true) failures.push("attestation verification must be accepted");
  if (organizationRunner.checkName !== ORGANIZATION_RUNNER_CHECK_NAME) failures.push("organization check name mismatch");
  if (organizationRunner.conclusion !== "success") failures.push("organization check conclusion must be success");
  if (organizationRunner.outputTitle !== "Organization-attested") failures.push("organization check title mismatch");
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/runs\/\d+$/.test(stringValue(organizationRunner.checkRunUrl))) failures.push("organization checkRunUrl must be a GitHub Check URL");
  for (const forbidden of [/gh[opsu]_[A-Za-z0-9_]+/, /Bearer\s+/i, /-----BEGIN/i, /private[_-]?key/i, /GITHUB_WEBHOOK_SECRET/i, /installation[_-]?token/i, /jwt/i, /keychain:\/\//i]) {
    if (forbidden.test(serialized)) failures.push(`recording contains forbidden secret marker: ${forbidden}`);
  }
  return { ok: failures.length === 0, failures };
}

function createTemporaryReadbackCommit(input: { root: string; indexPath: string; baseBranch: string; branchName: string }): string {
  const env = { ...process.env, GIT_INDEX_FILE: input.indexPath };
  execFileSync("git", ["read-tree", "HEAD"], { cwd: input.root, env, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["add", "-A", "--", "."], { cwd: input.root, env, stdio: ["ignore", "pipe", "pipe"] });
  const tree = execFileSync("git", ["write-tree"], { cwd: input.root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const parent = execFileSync("git", ["rev-parse", input.baseBranch], { cwd: input.root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  return execFileSync("git", [
    "-c", "user.name=ArchContext Readback",
    "-c", "user.email=archcontext@example.test",
    "commit-tree", tree,
    "-p", parent,
    "-m", `FG4 EG1 GitHub-hosted runner readback ${input.branchName}`
  ], { cwd: input.root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function stagingWorkflowYaml(input: {
  installationId: number;
  repositoryId: number;
  runtimeArtifactUrl: string;
  runtimeArtifactDigest: string;
  workflowName: string;
  workflowFilename: string;
  jobName: string;
  runsOn: string[];
  artifactName: string;
  attestationFileName: string;
  attestationSchemaVersion: string;
  readbackId: string;
}): string {
  return `name: ${input.workflowName}

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  checks: read
  pull-requests: read

jobs:
  organization-runner:
    name: ${input.jobName}
    runs-on: ${formatRunsOnYaml(input.runsOn)}
    timeout-minutes: 15
    env:
      FG4_EG1_INSTALLATION_ID: "${input.installationId}"
      FG4_EG1_REPOSITORY_ID: "${input.repositoryId}"
      FG4_EG1_RUNTIME_ARTIFACT_URL: "${input.runtimeArtifactUrl}"
      FG4_EG1_RUNTIME_ARTIFACT_DIGEST: "${input.runtimeArtifactDigest}"
      FG4_READBACK_ID: "${input.readbackId}"
      FG4_ATTESTATION_SCHEMA_VERSION: "${input.attestationSchemaVersion}"
    steps:
      - name: Checkout exact pull request head
        uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
          persist-credentials: false

      - name: Compute Challenge metadata
        shell: bash
        run: |
          echo "FG4_EG1_PULL_REQUEST_NUMBER=\${{ github.event.pull_request.number }}" >> "$GITHUB_ENV"
          echo "FG4_EG1_HEAD_SHA=\${{ github.event.pull_request.head.sha }}" >> "$GITHUB_ENV"
          echo "FG4_EG1_BASE_SHA=\${{ github.event.pull_request.base.sha }}" >> "$GITHUB_ENV"
          echo "FG4_EG1_HEAD_TREE_OID=$(git rev-parse HEAD^{tree})" >> "$GITHUB_ENV"
          echo "FG4_EG1_WORKFLOW_REF=\${{ github.repository }}/.github/workflows/${input.workflowFilename}@refs/heads/\${{ github.head_ref }}" >> "$GITHUB_ENV"

      - name: Run local review-action preflight
        uses: ./actions/review-action
        with:
          challenge: auto
          trust-level: organization
          fail-on: blocking
          fork-pr-mode: unsupported
          runtime-version: "0.1.0"
          runtime-artifact-url: \${{ env.FG4_EG1_RUNTIME_ARTIFACT_URL }}
          runtime-artifact-digest: ${RUNTIME_ARTIFACT_DIGEST}
          expected-repository: \${{ github.repository }}
          expected-head-sha: \${{ env.FG4_EG1_HEAD_SHA }}
          expected-head-tree-oid: \${{ env.FG4_EG1_HEAD_TREE_OID }}

      - name: Install runtime dependencies
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.10

      - name: Install workspace
        run: bun install --frozen-lockfile

      - name: Create Organization Attestation
        run: bun scripts/fg4-github-hosted-runner-attestation.ts create --out "$RUNNER_TEMP/${input.attestationFileName}"

      - name: Upload metadata-only Organization Attestation
        uses: actions/upload-artifact@v4
        with:
          name: ${input.artifactName}
          path: \${{ runner.temp }}/${input.attestationFileName}
          if-no-files-found: error
`;
}

async function waitForWorkflowRun(input: { repository: string; branchName: string; headSha: string; workflowName: string; timeoutMs: number; pollMs: number }): Promise<WorkflowRun> {
  const deadline = Date.now() + input.timeoutMs;
  let latest: WorkflowRun | undefined;
  while (Date.now() < deadline) {
    const runs = ghJson<WorkflowRun[] | null>([
      "run", "list",
      "--repo", input.repository,
      "--branch", input.branchName,
      "--limit", "10",
      "--json", "databaseId,status,conclusion,headSha,event,url,createdAt,workflowName,name"
    ]) ?? [];
    latest = runs.find((run) => run.headSha === input.headSha && run.event === "pull_request" && (run.workflowName === input.workflowName || run.name === input.workflowName))
      ?? runs.find((run) => run.headSha === input.headSha && run.event === "pull_request")
      ?? runs[0];
    if (latest && latest.headSha === input.headSha && latest.status === "completed") return latest;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, input.pollMs);
  }
  throw new Error(`workflow-run-timeout${latest ? `: latest=${latest.status}/${latest.conclusion ?? "none"}` : ""}`);
}

function downloadAttestationArtifact(input: { repository: string; runId: number; outputDir: string; artifactName: string; attestationFileName: string }): string {
  execFileSync("gh", [
    "run", "download", String(input.runId),
    "--repo", input.repository,
    "--name", input.artifactName,
    "--dir", input.outputDir
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const artifactPath = join(input.outputDir, input.attestationFileName);
  if (!existsSync(artifactPath)) throw new Error("attestation-artifact-not-downloaded");
  return artifactPath;
}

function createPullRequest(input: { repository: string; branchName: string; baseBranch: string; title: string; body: string }): string {
  return execFileSync("gh", [
    "pr", "create",
    "--repo", input.repository,
    "--head", input.branchName,
    "--base", input.baseBranch,
    "--title", input.title,
    "--body", input.body
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function closePullRequest(input: { repository: string; pullRequestNumber: number }): void {
  ghApiJson({
    method: "PATCH",
    path: `repos/${input.repository}/pulls/${input.pullRequestNumber}`,
    body: { state: "closed" }
  });
}

function deleteBranch(input: { repository: string; branchName: string }): void {
  ghApiJson({
    method: "DELETE",
    path: `repos/${input.repository}/git/refs/heads/${input.branchName}`
  });
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

async function githubRequest(input: {
  apiBaseUrl: string;
  path: string;
  method: "GET" | "POST" | "PATCH";
  authorization: string;
  body?: unknown;
}) {
  const response = await fetch(new URL(input.path, input.apiBaseUrl), {
    method: input.method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: input.authorization,
      "content-type": "application/json",
      "user-agent": "ArchContext-FG4-GitHub-Hosted-Runner-Readback",
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

class GitHubFetchTransport implements GitHubGovernanceApiTransport {
  constructor(private readonly options: { apiBaseUrl: string; token: string }) {}

  async request(input: GitHubGovernanceApiRequest): Promise<GitHubGovernanceApiResponse> {
    const response = await fetch(new URL(input.path, this.options.apiBaseUrl), {
      method: input.method,
      headers: {
        accept: input.accept,
        authorization: `Bearer ${this.options.token}`,
        "content-type": "application/json",
        "user-agent": "ArchContext-FG4-GitHub-Hosted-Runner-Readback",
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

function createGitHubAppJwt(input: { appId: string; privateKeyPem: string }): string {
  if (!/^[1-9]\d*$/.test(input.appId)) throw new Error("github-app-id-invalid");
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({ iat: now - 60, exp: now + 540, iss: input.appId });
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(input.privateKeyPem);
  return `${signingInput}.${base64Url(signature)}`;
}

function ghApiJson(input: { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; body?: unknown }): unknown {
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

function ghJson<T>(args: string[]): T {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`gh-failed: ${args.join(" ")}: ${(result.stderr || result.stdout).trim()}`);
  return JSON.parse(result.stdout) as T;
}

function renderHuman(result: Awaited<ReturnType<typeof runFg4GithubHostedRunnerReadback>>): string {
  return [
    `[fg4-github-hosted-runner-readback] ${result.ok ? "OK" : "FAILED"}`,
    `- workflow: ${result.evidence.workflow.runId} ${result.evidence.workflow.conclusion}`,
    `- organization check: ${result.evidence.organizationRunner.checkRunId} ${result.evidence.organizationRunner.conclusion}`,
    `- temp PR: #${result.evidence.pullRequest.number} closed=${result.evidence.pullRequest.closedAfterReadback}`,
    ...result.failures.map((failure) => `- ${failure}`)
  ].join("\n");
}

function renderInspectHuman(result: ReturnType<typeof inspectFg4GithubHostedRunnerReadback>): string {
  if (result.ok) return "[fg4-github-hosted-runner-readback] OK";
  return ["[fg4-github-hosted-runner-readback] FAILED", ...result.failures.map((failure) => `- ${failure}`)].join("\n");
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

function firstString(value: unknown, key: string): string {
  const record = readRecord(value);
  const items = record[key];
  return Array.isArray(items) && typeof items[0] === "string" ? items[0] : "";
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
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

function parsePullNumber(url: string): number {
  const match = /\/pull\/(\d+)(?:$|[/?#])/.exec(url);
  if (!match) throw new Error(`pull-request-url-invalid: ${url}`);
  return Number(match[1]);
}

function normalizeBaseUrl(value: string): string {
  return new URL(String(value)).toString().replace(/\/$/, "");
}

function parseCsv(value: string): string[] {
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (items.length === 0) throw new Error("runner-labels-required");
  return items;
}

function formatRunsOnYaml(labels: string[]): string {
  if (labels.length === 1) return labels[0]!;
  return `[${labels.map((label) => JSON.stringify(label)).join(", ")}]`;
}

function readbackTargetForSchema(schemaVersion: string): { kind: "github-hosted" | "self-hosted"; workflowName: string; expectedRunnerOs: string } | undefined {
  if (schemaVersion === "archcontext.fg4-github-hosted-runner-readback/v1") {
    return { kind: "github-hosted", workflowName: WORKFLOW_NAME, expectedRunnerOs: "Linux" };
  }
  if (schemaVersion === "archcontext.fg4-self-hosted-runner-readback/v1") {
    return { kind: "self-hosted", workflowName: SELF_HOSTED_WORKFLOW_NAME, expectedRunnerOs: "macOS" };
  }
  return undefined;
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

interface WorkflowRun {
  databaseId: number;
  name?: string;
  workflowName?: string;
  status: string;
  conclusion: string | null;
  headSha: string;
  event: string;
  url: string;
  createdAt: string;
}
