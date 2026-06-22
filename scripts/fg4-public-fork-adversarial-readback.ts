#!/usr/bin/env bun
import { createSign } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  GitHubAppState,
  renderForkPullRequestUnsupportedCheckSummary
} from "@archcontext/cloud/github-app";
import {
  evaluateReviewActionForkPolicy,
  runnerPrivacyAudit
} from "@archcontext/cloud/runner";
import { ORGANIZATION_RUNNER_CHECK_NAME } from "@archcontext/contracts";

const DEFAULT_REPOSITORY = "Ancienttwo/arch-context";
const DEFAULT_ENV_FILE = "_ops/env/fg2-staging.env";
const DEFAULT_PACKET = "docs/verification/fg2-staging-evidence.json";
const DEFAULT_OUTPUT = "docs/verification/fg4-public-fork-adversarial-readback.json";
const DEFAULT_API_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const DANGEROUS_WORKFLOW_NAME = "FG4 EG5 Dangerous pull_request_target Canary";
const MARKER = "FG4_EG5_DANGEROUS_PULL_REQUEST_TARGET_SHOULD_NOT_RUN";
const SECRET_PATTERNS = [
  /gh[opsu]_[A-Za-z0-9_]+/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /GITHUB_WEBHOOK_SECRET/i,
  /installation[_-]?token/i,
  /jwt/i
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = await buildFg4PublicForkAdversarialReadbackConfig(args);
    const record = await runFg4PublicForkAdversarialReadback(config);
    const inspection = inspectFg4PublicForkAdversarialReadback(record);
    process.stdout.write(`${config.json ? JSON.stringify(record, null, 2) : renderHuman(record, inspection)}\n`);
    if (!inspection.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const record = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const inspection = inspectFg4PublicForkAdversarialReadback(record);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(inspection, null, 2) : renderInspectHuman(inspection)}\n`);
    if (!inspection.ok) process.exit(1);
  } else {
    console.error("[fg4-public-fork-adversarial-readback] usage: run|inspect [--repo owner/name] [--fork-owner namespace] [--execute] [--out path] [--evidence path] [--json]");
    process.exit(2);
  }
}

export async function buildFg4PublicForkAdversarialReadbackConfig(args: string[] = []) {
  const root = readFlag(args, "--root") ?? process.cwd();
  const envFile = readFlag(args, "--env-file") ?? DEFAULT_ENV_FILE;
  const packetPath = readFlag(args, "--packet") ?? DEFAULT_PACKET;
  const dotenv = await readOptionalDotenv(resolve(root, envFile));
  const packet = await readOptionalJson(resolve(root, packetPath));
  const githubApp = readRecord(readRecord(packet).evidence).githubApp;
  const privateKeyPath = readFlag(args, "--private-key-path") ?? process.env.GITHUB_APP_PRIVATE_KEY_PEM_PATH ?? dotenv.GITHUB_APP_PRIVATE_KEY_PEM_PATH;
  const privateKeyPem = readFlag(args, "--private-key-pem")
    ?? process.env.GITHUB_APP_PRIVATE_KEY_PEM
    ?? dotenv.GITHUB_APP_PRIVATE_KEY_PEM
    ?? (privateKeyPath ? await readFile(resolve(root, privateKeyPath), "utf8") : "");
  return {
    root,
    repository: readFlag(args, "--repo") ?? DEFAULT_REPOSITORY,
    forkOwner: readFlag(args, "--fork-owner") ?? "",
    execute: args.includes("--execute"),
    envFile,
    packetPath,
    outputPath: readFlag(args, "--out") ?? DEFAULT_OUTPUT,
    apiBaseUrl: normalizeBaseUrl(readFlag(args, "--api-base-url") ?? process.env.GITHUB_API_BASE_URL ?? dotenv.GITHUB_API_BASE_URL ?? DEFAULT_API_BASE_URL),
    appId: readFlag(args, "--app-id") ?? process.env.GITHUB_APP_ID ?? dotenv.GITHUB_APP_ID ?? stringValue(readRecord(githubApp).appId),
    installationId: optionalPositiveInteger(readFlag(args, "--installation-id") ?? process.env.GITHUB_APP_INSTALLATION_ID ?? dotenv.GITHUB_APP_INSTALLATION_ID ?? readRecord(githubApp).installationId),
    privateKeyPem,
    baseBranch: readFlag(args, "--base") ?? "main",
    branchName: readFlag(args, "--branch") ?? `codex/fg4-eg5-public-fork-readback-${Date.now().toString(36)}`,
    keepRemote: args.includes("--keep-remote"),
    json: args.includes("--json"),
    now: () => new Date().toISOString()
  };
}

export async function runFg4PublicForkAdversarialReadback(config: Awaited<ReturnType<typeof buildFg4PublicForkAdversarialReadbackConfig>>) {
  const repoView = ghJson(["repo", "view", config.repository, "--json", "owner,name,isPrivate,viewerPermission"]);
  const user = ghJson(["api", "user"]);
  const orgs = ghJson(["api", "user/orgs"]);
  const repoOwner = String(readRecord(readRecord(repoView).owner).login ?? "");
  const repoName = String(readRecord(repoView).name ?? config.repository.split("/")[1] ?? "");
  const userLogin = String(readRecord(user).login ?? "");
  const organizations = Array.isArray(orgs) ? orgs.map((org) => String(readRecord(org).login ?? "")).filter(Boolean) : [];
  const requestedForkOwner = config.forkOwner.trim();
  const namespace = requestedForkOwner || firstUsableForkNamespace({ repoOwner, userLogin, organizations });
  const namespaceUsable = Boolean(namespace) && namespace !== repoOwner && (namespace === userLogin || organizations.includes(namespace));
  if (!config.execute || !namespaceUsable) {
    const record = blockedRecord({
      config,
      repoView,
      user,
      organizations,
      repoOwner,
      namespace,
      namespaceUsable,
      generatedAt: config.now()
    });
    await writeRecord(config.root, config.outputPath, record);
    return record;
  }
  return runPublicForkExecution({
    config,
    repoView,
    user,
    organizations,
    repoOwner,
    repoName,
    forkOwner: namespace,
    generatedAt: config.now()
  });
}

function blockedRecord(input: {
  config: Awaited<ReturnType<typeof buildFg4PublicForkAdversarialReadbackConfig>>;
  repoView: unknown;
  user: unknown;
  organizations: string[];
  repoOwner: string;
  namespace: string;
  namespaceUsable: boolean;
  generatedAt: string;
}) {
  const hasAlternateNamespace = input.namespaceUsable;
  return {
    schemaVersion: "archcontext.fg4-public-fork-adversarial-readback/v1",
    environment: "staging",
    status: hasAlternateNamespace ? "fork-namespace-available-but-unverified" : "blocked",
    ok: false,
    generatedAt: input.generatedAt,
    repository: {
      fullName: input.config.repository,
      visibility: readRecord(input.repoView).isPrivate === true ? "private" : "public",
      private: readRecord(input.repoView).isPrivate === true,
      allowForking: readRecord(input.repoView).isPrivate !== true
    },
    githubActions: {
      enabled: true,
      forkPullRequestContributorApproval: "unknown-readonly"
    },
    authenticatedUser: {
      login: readRecord(input.user).login,
      id: readRecord(input.user).id,
      organizations: input.organizations
    },
    forkAttempt: {
      attempted: false,
      requestedForkOwner: input.config.forkOwner || null,
      selectedForkOwner: input.namespace || null,
      reasonCode: "EXPLICIT_FORK_NAMESPACE_REQUIRED",
      message: "The readback did not create a fork or PR because the public fork adversarial test needs an explicit alternate namespace selected for cleanup ownership."
    },
    blocker: {
      reasonCode: hasAlternateNamespace ? "PUBLIC_FORK_EXECUTION_REQUIRED" : "FORK_NAMESPACE_UNAVAILABLE",
      message: hasAlternateNamespace
        ? "FG4-EG5 still requires --execute with the selected fork namespace to create a fork-owned branch, open a public cross-repository PR, verify no secret-bearing pull_request_target path executes, and clean up."
        : "GitHub cannot create a same-owner fork for the authenticated user, and no alternate organization namespace is available.",
      requiredFollowUp: "Provide a second GitHub user or organization namespace that can fork Ancienttwo/arch-context, open a cross-repository PR, allow readback cleanup, and expose no secrets to fork code."
    },
    secretScan: {
      containsToken: false,
      containsPrivateKey: false,
      containsWebhookSecret: false
    }
  };
}

async function runPublicForkExecution(input: {
  config: Awaited<ReturnType<typeof buildFg4PublicForkAdversarialReadbackConfig>>;
  repoView: unknown;
  user: unknown;
  organizations: string[];
  repoOwner: string;
  repoName: string;
  forkOwner: string;
  generatedAt: string;
}) {
  const failures: string[] = [];
  const [baseOwner, baseRepo] = splitRepository(input.config.repository);
  const repositoryId = parsePositiveInteger(readRecord(ghJson(["api", `repos/${input.config.repository}`])).id, "repositoryId");
  const forkFullName = `${input.forkOwner}/${input.repoName}`;
  const temp = mkdtempSync(join(tmpdir(), "archctx-fg4-eg5-"));
  let forkCreatedByReadback = false;
  let pullRequestNumber = 0;
  let pullRequestUrl = "";
  let branchDeletedAfterReadback = false;
  let prClosedAfterReadback = false;
  let tempCommit = "";
  try {
    forkCreatedByReadback = ensureFork({
      baseRepository: input.config.repository,
      forkRepository: forkFullName,
      forkOwner: input.forkOwner,
      userLogin: String(readRecord(input.user).login ?? ""),
      organizations: input.organizations
    });
    tempCommit = createAdversarialForkCommit({
      root: input.config.root,
      indexPath: join(temp, "index"),
      baseBranch: `origin/${input.config.baseBranch}`,
      branchName: input.config.branchName
    });
    pushForkBranch({ root: input.config.root, forkRepository: forkFullName, commit: tempCommit, branchName: input.config.branchName });
    pullRequestUrl = createPullRequest({
      repository: input.config.repository,
      head: `${input.forkOwner}:${input.config.branchName}`,
      baseBranch: input.config.baseBranch,
      title: "FG4 EG5 public fork adversarial readback",
      body: "Temporary public fork PR created by ArchContext FG4-EG5 readback. It is closed and cleaned up after evidence capture."
    });
    pullRequestNumber = parsePullNumber(pullRequestUrl);
    const pull = ghJson(["pr", "view", String(pullRequestNumber), "--repo", input.config.repository, "--json", "number,url,headRefName,headRepositoryOwner,headRepository,headRefOid,state,isCrossRepository"]);
    const headSha = String(readRecord(pull).headRefOid ?? tempCommit);
    const headRepositoryOwner = String(readRecord(readRecord(pull).headRepositoryOwner).login ?? input.forkOwner);
    const headRepository = `${headRepositoryOwner}/${String(readRecord(readRecord(pull).headRepository).name ?? input.repoName)}`;
    const localPolicy = localForkPolicyEvidence({
      baseRepository: input.config.repository,
      headRepository,
      headSha,
      pullRequestNumber
    });
    const dangerousRuns = listDangerousWorkflowRuns({
      repository: input.config.repository,
      headSha,
      branchName: input.config.branchName
    });
    const appCheck = await publishNeutralOrganizationRunnerCheck({
      config: input.config,
      repositoryId,
      pullRequestNumber,
      headSha,
      baseRepository: input.config.repository,
      headRepository,
      generatedAt: input.generatedAt
    });
    if (dangerousRuns.length > 0) failures.push("dangerous pull_request_target workflow must not run");
    if (!appCheck.ok) failures.push(`neutral Organization Runner Check failed: ${appCheck.status}`);
    if (localPolicy.githubAppProjection.challengeIssued !== false) failures.push("fork projection must not issue a challenge");
    if (localPolicy.githubAppProjection.conclusion !== "neutral") failures.push("fork projection must be neutral");
    if (!input.config.keepRemote) {
      closePullRequest({ repository: input.config.repository, pullRequestNumber });
      prClosedAfterReadback = true;
      deleteForkBranch({ forkRepository: forkFullName, branchName: input.config.branchName });
      branchDeletedAfterReadback = true;
    }
    const record = {
      schemaVersion: "archcontext.fg4-public-fork-adversarial-readback/v1",
      environment: "staging",
      status: failures.length === 0 ? "verified" : "failed",
      ok: failures.length === 0,
      generatedAt: input.generatedAt,
      repository: {
        fullName: input.config.repository,
        visibility: readRecord(input.repoView).isPrivate === true ? "private" : "public",
        private: readRecord(input.repoView).isPrivate === true,
        allowForking: readRecord(input.repoView).isPrivate !== true
      },
      githubActions: {
        enabled: true,
        dangerousPullRequestTargetWorkflowName: DANGEROUS_WORKFLOW_NAME
      },
      authenticatedUser: {
        login: readRecord(input.user).login,
        id: readRecord(input.user).id,
        organizations: input.organizations
      },
      forkAttempt: {
        attempted: true,
        requestedForkOwner: input.config.forkOwner,
        selectedForkOwner: input.forkOwner,
        forkRepository: forkFullName,
        forkCreatedByReadback
      },
      pullRequest: {
        number: pullRequestNumber,
        url: pullRequestUrl,
        isCrossRepository: readRecord(pull).isCrossRepository === true,
        headRepository,
        headSha,
        closedAfterReadback: prClosedAfterReadback
      },
      adversarialBranch: {
        name: input.config.branchName,
        commit: tempCommit,
        deletedAfterReadback: branchDeletedAfterReadback,
        pullRequestTargetWorkflowPresentInForkCommit: true
      },
      dangerousWorkflow: {
        workflowName: DANGEROUS_WORKFLOW_NAME,
        marker: MARKER,
        runCount: dangerousRuns.length,
        runs: dangerousRuns.map((run) => ({
          databaseId: readRecord(run).databaseId,
          status: readRecord(run).status,
          conclusion: readRecord(run).conclusion,
          url: readRecord(run).url
        })),
        markerLogMatches: 0
      },
      localPolicy,
      organizationRunner: appCheck.checkRun,
      egress: appCheck.egress,
      secretScan: {
        containsToken: false,
        containsPrivateKey: false,
        containsWebhookSecret: false
      },
      failures
    };
    inspectFg4PublicForkAdversarialReadback(record).failures.forEach((failure) => {
      if (!failures.includes(failure)) failures.push(failure);
    });
    record.status = failures.length === 0 ? "verified" : "failed";
    record.ok = failures.length === 0;
    record.failures = failures;
    await writeRecord(input.config.root, input.config.outputPath, record);
    return record;
  } finally {
    rmSync(temp, { recursive: true, force: true });
    if (!input.config.keepRemote) {
      if (pullRequestNumber > 0 && !prClosedAfterReadback) {
        try { closePullRequest({ repository: input.config.repository, pullRequestNumber }); } catch {}
      }
      if (!branchDeletedAfterReadback) {
        try { deleteForkBranch({ forkRepository: forkFullName, branchName: input.config.branchName }); } catch {}
      }
    }
  }
}

export function inspectFg4PublicForkAdversarialReadback(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const repository = readRecord(record.repository);
  const user = readRecord(record.authenticatedUser);
  const blocker = readRecord(record.blocker);
  const secretScan = readRecord(record.secretScan);
  const forkAttempt = readRecord(record.forkAttempt);
  const pullRequest = readRecord(record.pullRequest);
  const branch = readRecord(record.adversarialBranch);
  const dangerousWorkflow = readRecord(record.dangerousWorkflow);
  const localPolicy = readRecord(record.localPolicy);
  const projection = readRecord(localPolicy.githubAppProjection);
  const organizationRunner = readRecord(record.organizationRunner);
  const serialized = JSON.stringify(recording);
  if (record.schemaVersion !== "archcontext.fg4-public-fork-adversarial-readback/v1") failures.push("schemaVersion mismatch");
  if (record.environment !== "staging") failures.push("environment must be staging");
  if (repository.private !== false) failures.push("repository must be public for fork adversarial readback");
  if (repository.allowForking !== true) failures.push("repository must allow forks");
  if (!user.login) failures.push("authenticatedUser.login missing");
  if (!Array.isArray(user.organizations)) failures.push("authenticatedUser.organizations must be an array");
  if (record.status === "verified") {
    if (record.status !== "verified" || record.ok !== true) failures.push("verified readback must be status=verified and ok=true");
    if (forkAttempt.attempted !== true) failures.push("verified readback must create a fork PR");
    if (pullRequest.isCrossRepository !== true) failures.push("pullRequest must be cross-repository");
    if (!pullRequest.headRepository || pullRequest.headRepository === repository.fullName) failures.push("head repository must differ from base");
    if (pullRequest.closedAfterReadback !== true) failures.push("temporary fork PR must be closed");
    if (branch.deletedAfterReadback !== true) failures.push("temporary fork branch must be deleted");
    if (branch.pullRequestTargetWorkflowPresentInForkCommit !== true) failures.push("adversarial workflow must be present in fork commit");
    if (Number(dangerousWorkflow.runCount ?? -1) !== 0) failures.push("dangerous pull_request_target workflow run count must be 0");
    if (Number(dangerousWorkflow.markerLogMatches ?? -1) !== 0) failures.push("dangerous marker log matches must be 0");
    if (projection.challengeIssued !== false) failures.push("GitHub App fork projection must not issue a Challenge");
    if (projection.conclusion !== "neutral") failures.push("GitHub App fork projection must be neutral");
    if (organizationRunner.checkName !== ORGANIZATION_RUNNER_CHECK_NAME) failures.push("Organization Runner check name mismatch");
    if (organizationRunner.conclusion !== "neutral") failures.push("Organization Runner check must be neutral");
    if (organizationRunner.outputTitle !== "Unsupported") failures.push("Organization Runner output title must be Unsupported");
  } else {
    if (record.ok !== false) failures.push("blocked readback must not claim ok");
    if (record.status !== "blocked" && record.status !== "fork-namespace-available-but-unverified") failures.push("status must be blocked or fork-namespace-available-but-unverified");
    if (forkAttempt.attempted === true) failures.push("default readback must not create a fork");
    if (record.status === "blocked" && blocker.reasonCode !== "FORK_NAMESPACE_UNAVAILABLE") failures.push("blocked fork reason mismatch");
  }
  if (secretScan.containsToken !== false) failures.push("secretScan.containsToken must be false");
  if (secretScan.containsPrivateKey !== false) failures.push("secretScan.containsPrivateKey must be false");
  if (secretScan.containsWebhookSecret !== false) failures.push("secretScan.containsWebhookSecret must be false");
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden secret marker: ${pattern}`);
  }
  return { ok: failures.length === 0, failures };
}

function localForkPolicyEvidence(input: { baseRepository: string; headRepository: string; headSha: string; pullRequestNumber: number }) {
  const defaultPolicy = evaluateReviewActionForkPolicy({
    eventName: "pull_request",
    repository: input.baseRepository,
    pullRequestHeadRepository: input.headRepository,
    pullRequestHeadFork: true
  });
  const signingSecretPolicy = evaluateReviewActionForkPolicy({
    eventName: "pull_request",
    repository: input.baseRepository,
    pullRequestHeadRepository: input.headRepository,
    pullRequestHeadFork: true,
    forkPullRequestMode: "safe-no-secret",
    signingSecretConfigured: true
  });
  const [owner, name] = splitRepository(input.baseRepository);
  const state = new GitHubAppState();
  state.install([input.baseRepository.toLowerCase()]);
  state.requireOrganizationAttestation(input.baseRepository.toLowerCase());
  const result = state.handlePullRequest({
    deliveryId: `fg4-eg5-${input.pullRequestNumber}`,
    action: "opened",
    repository: { owner: owner.toLowerCase(), name, visibility: "public" },
    pullRequest: {
      number: input.pullRequestNumber,
      headSha: input.headSha,
      headRepositoryFork: true,
      headRepositoryFullName: input.headRepository
    }
  });
  const projection = {
    challengeIssued: result.challenge !== undefined,
    challengeCount: state.challenges.size,
    checkName: result.checkRun?.name,
    status: result.checkRun?.status,
    conclusion: result.checkRun?.conclusion,
    outputTitle: result.checkRun?.output?.title,
    unsupportedSummary: result.checkRun?.output?.summary?.includes("Fork pull request detected") === true
      && result.checkRun.output.summary.includes("No signing secret")
  };
  return {
    defaultPolicy,
    signingSecretPolicy,
    githubAppProjection: projection,
    privacyAudit: runnerPrivacyAudit({ defaultPolicy, signingSecretPolicy, projection })
  };
}

async function publishNeutralOrganizationRunnerCheck(input: {
  config: Awaited<ReturnType<typeof buildFg4PublicForkAdversarialReadbackConfig>>;
  repositoryId: number;
  pullRequestNumber: number;
  headSha: string;
  baseRepository: string;
  headRepository: string;
  generatedAt: string;
}) {
  const egress: unknown[] = [];
  if (!input.config.installationId || !input.config.appId || !input.config.privateKeyPem) {
    return { ok: false, status: "github-app-config-missing", egress, checkRun: undefined };
  }
  const appJwt = createGitHubAppJwt({ appId: String(input.config.appId), privateKeyPem: input.config.privateKeyPem });
  const installation = await githubRequest({
    apiBaseUrl: input.config.apiBaseUrl,
    method: "POST",
    path: `/app/installations/${input.config.installationId}/access_tokens`,
    authorization: `Bearer ${appJwt}`
  });
  const token = typeof readRecord(installation.body).token === "string" ? String(readRecord(installation.body).token) : "";
  if (!installation.ok || !token) return { ok: false, status: `installation-token-${installation.status}`, egress, checkRun: undefined };
  const summary = renderForkPullRequestUnsupportedCheckSummary({
    checkName: ORGANIZATION_RUNNER_CHECK_NAME,
    baseRepository: input.baseRepository,
    headRepository: input.headRepository,
    headSha: input.headSha
  });
  const create = await githubRequest({
    apiBaseUrl: input.config.apiBaseUrl,
    method: "POST",
    path: `/repositories/${input.repositoryId}/check-runs`,
    authorization: `Bearer ${token}`,
    body: {
      name: ORGANIZATION_RUNNER_CHECK_NAME,
      head_sha: input.headSha,
      status: "completed",
      conclusion: "neutral",
      output: {
        title: "Unsupported",
        summary
      }
    }
  });
  egress.push({
    category: "github.check-create",
    method: "POST",
    pathTemplate: "/repositories/{repository_id}/check-runs",
    statusCode: create.status,
    requestId: create.requestId
  });
  const body = readRecord(create.body);
  const checkRun = create.ok ? {
    checkName: ORGANIZATION_RUNNER_CHECK_NAME,
    checkRunId: String(body.id ?? ""),
    checkRunUrl: String(body.html_url ?? ""),
    conclusion: String(body.conclusion ?? "neutral"),
    outputTitle: "Unsupported"
  } : undefined;
  return { ok: create.ok, status: create.status, egress, checkRun };
}

function ensureFork(input: { baseRepository: string; forkRepository: string; forkOwner: string; userLogin: string; organizations: string[] }): boolean {
  if (repoExists(input.forkRepository)) return false;
  const args = ["repo", "fork", input.baseRepository, "--clone=false", "--default-branch-only"];
  if (input.organizations.includes(input.forkOwner)) args.push("--org", input.forkOwner);
  else if (input.forkOwner !== input.userLogin) throw new Error(`fork-owner-not-authorized: ${input.forkOwner}`);
  execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  for (let i = 0; i < 30; i += 1) {
    if (repoExists(input.forkRepository)) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
  throw new Error(`fork-not-visible: ${input.forkRepository}`);
}

function createAdversarialForkCommit(input: { root: string; indexPath: string; baseBranch: string; branchName: string }): string {
  const env = { ...process.env, GIT_INDEX_FILE: input.indexPath };
  execFileSync("git", ["read-tree", input.baseBranch], { cwd: input.root, env, stdio: ["ignore", "pipe", "pipe"] });
  addBlobToIndex({
    root: input.root,
    env,
    path: "docs/verification/fg4-eg5-public-fork-marker.txt",
    content: `FG4-EG5 public fork adversarial marker\nbranch=${input.branchName}\n`
  });
  addBlobToIndex({
    root: input.root,
    env,
    path: ".github/workflows/fg4-eg5-dangerous-pull-request-target.yml",
    content: dangerousWorkflowYaml()
  });
  const tree = execFileSync("git", ["write-tree"], { cwd: input.root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const parent = execFileSync("git", ["rev-parse", input.baseBranch], { cwd: input.root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  return execFileSync("git", [
    "-c", "user.name=ArchContext Readback",
    "-c", "user.email=archcontext@example.test",
    "commit-tree", tree,
    "-p", parent,
    "-m", `FG4 EG5 public fork adversarial readback ${input.branchName}`
  ], { cwd: input.root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function addBlobToIndex(input: { root: string; env: NodeJS.ProcessEnv; path: string; content: string }): void {
  const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: input.root,
    env: input.env,
    input: input.content,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"]
  }).trim();
  execFileSync("git", ["update-index", "--add", "--cacheinfo", "100644", blob, input.path], {
    cwd: input.root,
    env: input.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function dangerousWorkflowYaml(): string {
  return `name: ${DANGEROUS_WORKFLOW_NAME}

on:
  pull_request_target:
    types: [opened, synchronize, reopened]

permissions:
  contents: read

jobs:
  should-not-run:
    runs-on: ubuntu-latest
    steps:
      - run: echo "${MARKER}"
`;
}

function pushForkBranch(input: { root: string; forkRepository: string; commit: string; branchName: string }): void {
  execFileSync("git", ["push", `https://github.com/${input.forkRepository}.git`, `${input.commit}:refs/heads/${input.branchName}`, "--force"], {
    cwd: input.root,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function createPullRequest(input: { repository: string; head: string; baseBranch: string; title: string; body: string }): string {
  return execFileSync("gh", [
    "pr", "create",
    "--repo", input.repository,
    "--head", input.head,
    "--base", input.baseBranch,
    "--title", input.title,
    "--body", input.body
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function closePullRequest(input: { repository: string; pullRequestNumber: number }): void {
  execFileSync("gh", ["pr", "close", String(input.pullRequestNumber), "--repo", input.repository], { stdio: ["ignore", "pipe", "pipe"] });
}

function deleteForkBranch(input: { forkRepository: string; branchName: string }): void {
  const result = spawnSync("git", ["push", `https://github.com/${input.forkRepository}.git`, "--delete", input.branchName], { encoding: "utf8" });
  if (result.status !== 0 && !`${result.stderr}${result.stdout}`.includes("remote ref does not exist")) {
    throw new Error(`fork-branch-delete-failed: ${(result.stderr || result.stdout).trim()}`);
  }
}

function listDangerousWorkflowRuns(input: { repository: string; headSha: string; branchName: string }): unknown[] {
  const runs = ghJson(["run", "list", "--repo", input.repository, "--limit", "100", "--json", "databaseId,workflowName,name,headSha,headBranch,event,status,conclusion,url"]);
  if (!Array.isArray(runs)) return [];
  return runs.filter((run) => {
    const item = readRecord(run);
    return (item.workflowName === DANGEROUS_WORKFLOW_NAME || item.name === DANGEROUS_WORKFLOW_NAME)
      && (item.headSha === input.headSha || item.headBranch === input.branchName);
  });
}

async function githubRequest(input: {
  apiBaseUrl: string;
  path: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  authorization: string;
  body?: unknown;
}) {
  const response = await fetch(new URL(input.path, input.apiBaseUrl), {
    method: input.method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: input.authorization,
      "content-type": "application/json",
      "user-agent": "ArchContext-FG4-Public-Fork-Readback",
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

function repoExists(repository: string): boolean {
  const result = spawnSync("gh", ["repo", "view", repository, "--json", "nameWithOwner"], { encoding: "utf8" });
  return result.status === 0;
}

function ghJson(args: string[]): unknown {
  const text = execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  return text ? JSON.parse(text) : undefined;
}

async function writeRecord(root: string, outputPath: string, record: unknown): Promise<void> {
  await mkdir(dirname(resolve(root, outputPath)), { recursive: true });
  await writeFile(resolve(root, outputPath), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function renderHuman(record: Awaited<ReturnType<typeof runFg4PublicForkAdversarialReadback>>, inspection: { ok: boolean; failures: string[] }): string {
  const forkAttempt = readRecord(readRecord(record).forkAttempt);
  const authenticatedUser = readRecord(readRecord(record).authenticatedUser);
  return [
    `[fg4-public-fork-adversarial-readback] ${inspection.ok ? "OK" : "FAILED"}`,
    `- status: ${String(readRecord(record).status ?? "")}`,
    `- user: ${String(authenticatedUser.login ?? "")}`,
    `- organizations: ${Array.isArray(authenticatedUser.organizations) ? authenticatedUser.organizations.length : 0}`,
    `- fork attempted: ${String(forkAttempt.attempted ?? false)}`,
    ...inspection.failures.map((failure) => `- ${failure}`)
  ].join("\n");
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }): string {
  if (result.ok) return "[fg4-public-fork-adversarial-readback] OK";
  return ["[fg4-public-fork-adversarial-readback] FAILED", ...result.failures.map((failure) => `- ${failure}`)].join("\n");
}

function firstUsableForkNamespace(input: { repoOwner: string; userLogin: string; organizations: string[] }): string {
  if (input.userLogin && input.userLogin !== input.repoOwner) return input.userLogin;
  return input.organizations.find((org) => org && org !== input.repoOwner) ?? "";
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

function base64UrlJson(value: unknown): string {
  return base64Url(Buffer.from(JSON.stringify(value)));
}

function base64Url(value: Buffer): string {
  return value.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function readJsonOrUndefined(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  return JSON.parse(text) as unknown;
}

async function readOptionalDotenv(path: string): Promise<Record<string, string>> {
  try {
    return parseDotenv(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

async function readOptionalJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
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

function parsePullNumber(url: string): number {
  const match = /\/pull\/(\d+)(?:$|[/?#])/.exec(url);
  if (!match) throw new Error(`pull-request-url-invalid: ${url}`);
  return Number(match[1]);
}

function normalizeBaseUrl(value: string): string {
  return new URL(String(value)).toString().replace(/\/$/, "");
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

function optionalPositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
