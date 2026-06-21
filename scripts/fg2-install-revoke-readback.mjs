#!/usr/bin/env node
import { createHmac, createSign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_ENV_FILE = "_ops/env/fg2-staging.env";
const DEFAULT_PACKET = "docs/verification/fg2-staging-evidence.json";
const DEFAULT_OUTPUT = "docs/verification/fg2-install-revoke-readback.json";
const DEFAULT_API_BASE_URL = "https://api.github.com";
const DEFAULT_CHECK_NAME = "ArchContext / Developer Review";
const GITHUB_API_VERSION = "2022-11-28";

if (import.meta.main) {
  const [command = "run", ...args] = process.argv.slice(2);
  if (command !== "run") {
    console.error("[fg2-install-revoke-readback] usage: run [--env-file path] [--packet path] [--out path] [--confirm-suspend] [--json]");
    process.exit(2);
  }
  const config = await buildFg2InstallRevokeReadbackConfig(process.env, args);
  const result = await runFg2InstallRevokeReadback(config);
  process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
  if (!result.ok) process.exit(1);
}

export async function buildFg2InstallRevokeReadbackConfig(env = process.env, args = []) {
  const root = readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd();
  const envFile = readFlag(args, "--env-file") ?? env.ARCHCONTEXT_FG2_STAGING_ENV_FILE ?? DEFAULT_ENV_FILE;
  const packetPath = readFlag(args, "--packet") ?? env.ARCHCONTEXT_FG2_STAGING_PACKET ?? DEFAULT_PACKET;
  const outputPath = readFlag(args, "--out") ?? env.ARCHCONTEXT_FG2_INSTALL_REVOKE_OUTPUT ?? DEFAULT_OUTPUT;
  const dotenv = parseDotenv(await readFile(resolve(root, envFile), "utf8"));
  const packet = JSON.parse(await readFile(resolve(root, packetPath), "utf8"));
  const evidence = packet.evidence ?? packet.partialEvidence ?? {};
  const githubApp = evidence.githubApp ?? {};
  const repository = readFlag(args, "--repository")
    ?? env.FG2_STAGING_REPOSITORY
    ?? dotenv.FG2_STAGING_REPOSITORY
    ?? githubApp.repositories?.[0];
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
    appId: readFlag(args, "--app-id") ?? env.GITHUB_APP_ID ?? dotenv.GITHUB_APP_ID ?? githubApp.appId,
    appSlug: readFlag(args, "--app-slug") ?? env.GITHUB_APP_SLUG ?? dotenv.GITHUB_APP_SLUG ?? githubApp.appSlug,
    installationId: parsePositiveInteger(
      readFlag(args, "--installation-id") ?? env.GITHUB_APP_INSTALLATION_ID ?? dotenv.GITHUB_APP_INSTALLATION_ID ?? githubApp.installationId,
      "installationId"
    ),
    repository,
    pullRequestNumber: parsePositiveInteger(readFlag(args, "--pull-request") ?? extractPullNumber(githubApp.pullRequestUrl), "pullRequestNumber"),
    repositoryId: optionalPositiveInteger(readFlag(args, "--repository-id") ?? githubApp.repositoryId, "repositoryId"),
    headSha: readFlag(args, "--head-sha") ?? githubApp.headCommit,
    webhookSecret: readFlag(args, "--webhook-secret") ?? env.GITHUB_WEBHOOK_SECRET ?? dotenv.GITHUB_WEBHOOK_SECRET,
    privateKeyPem,
    apiBaseUrl: normalizeBaseUrl(readFlag(args, "--api-base-url") ?? env.GITHUB_API_BASE_URL ?? DEFAULT_API_BASE_URL),
    stagingUrl: normalizeBaseUrl(readFlag(args, "--staging-url") ?? env.ARCHCONTEXT_STAGING_URL ?? dotenv.ARCHCONTEXT_STAGING_URL ?? "https://archcontext.repoharness.com"),
    checkName: readFlag(args, "--check-name") ?? DEFAULT_CHECK_NAME,
    confirmSuspend: args.includes("--confirm-suspend"),
    json: args.includes("--json"),
    now: () => new Date().toISOString()
  };
}

export async function runFg2InstallRevokeReadback(config = {}) {
  const normalized = normalizeConfig(config);
  const generatedAt = normalized.now();
  const failures = [];
  const operations = {
    preflight: {},
    revoke: {},
    syntheticWebhook: {},
    restore: {}
  };
  const inputs = {
    envFile: normalized.envFile,
    packet: normalized.packetPath,
    output: normalized.outputPath
  };
  const app = {
    appId: String(normalized.appId),
    appSlug: normalized.appSlug ?? null,
    installationId: normalized.installationId,
    repository: normalized.repository,
    pullRequestNumber: normalized.pullRequestNumber,
    mode: "suspend-unsuspend"
  };

  let appJwt = "";
  let accessBeforeRevoke = "";
  let accessAfterRestore = "";
  let suspendedByThisRun = false;
  let repositoryId = normalized.repositoryId;
  let checkRunsBefore;
  let checkRunsAfter;

  try {
    appJwt = createGitHubAppJwt({ appId: normalized.appId, privateKeyPem: normalized.privateKeyPem });

    const installationBefore = await githubRequest({
      apiBaseUrl: normalized.apiBaseUrl,
      path: `/app/installations/${normalized.installationId}`,
      method: "GET",
      authorization: `Bearer ${appJwt}`
    });
    operations.preflight.installationRead = summarizeHttp(installationBefore);
    const suspendedAtBefore = readRecord(installationBefore.body).suspended_at;
    operations.preflight.suspendedBeforeRevoke = suspendedAtBefore === null || suspendedAtBefore === undefined ? false : true;
    if (!installationBefore.ok) failures.push(`installation preflight failed: ${installationBefore.status}`);
    if (operations.preflight.suspendedBeforeRevoke) failures.push("installation was already suspended before this readback");

    const createdBefore = await createInstallationAccess({
      apiBaseUrl: normalized.apiBaseUrl,
      installationId: normalized.installationId,
      appJwt
    });
    operations.preflight.installationAccessBeforeRevoke = summarizeInstallationAccess(createdBefore);
    accessBeforeRevoke = createdBefore.access;
    if (!createdBefore.ok) failures.push(`installation access before revoke failed: ${createdBefore.status}`);

    if (accessBeforeRevoke) {
      const repositoriesBefore = await githubRequest({
        apiBaseUrl: normalized.apiBaseUrl,
        path: "/installation/repositories",
        method: "GET",
        authorization: `Bearer ${accessBeforeRevoke}`
      });
      const selected = selectRepository(repositoriesBefore.body, normalized.repository);
      if (selected.id) repositoryId = selected.id;
      operations.preflight.repositoriesBeforeRevoke = {
        ...summarizeHttp(repositoriesBefore),
        repositoryCount: selected.repositoryCount,
        selectedRepositoryVisible: selected.visible
      };
      if (!repositoriesBefore.ok) failures.push(`repositories preflight failed: ${repositoriesBefore.status}`);
      if (!selected.visible) failures.push(`selected repository not visible before revoke: ${normalized.repository}`);

      if (repositoryId && normalized.headSha) {
        const checkRuns = await listCheckRuns({
          apiBaseUrl: normalized.apiBaseUrl,
          repository: normalized.repository,
          headSha: normalized.headSha,
          checkName: normalized.checkName,
          access: accessBeforeRevoke
        });
        checkRunsBefore = summarizeCheckRuns(checkRuns);
        operations.preflight.checkRunsBeforeRevoke = checkRunsBefore;
      }
    }

    if (!normalized.confirmSuspend) {
      failures.push("refusing to suspend installation without --confirm-suspend");
    } else if (failures.length === 0) {
      const suspend = await githubRequest({
        apiBaseUrl: normalized.apiBaseUrl,
        path: `/app/installations/${normalized.installationId}/suspended`,
        method: "PUT",
        authorization: `Bearer ${appJwt}`
      });
      operations.revoke.suspend = summarizeHttp(suspend);
      if (suspend.status !== 204) failures.push(`installation suspend failed: ${suspend.status}`);
      suspendedByThisRun = suspend.status === 204;

      const installationAfterSuspend = await githubRequest({
        apiBaseUrl: normalized.apiBaseUrl,
        path: `/app/installations/${normalized.installationId}`,
        method: "GET",
        authorization: `Bearer ${appJwt}`
      });
      operations.revoke.installationAfterSuspend = {
        ...summarizeHttp(installationAfterSuspend),
        suspendedAtObserved: typeof readRecord(installationAfterSuspend.body).suspended_at === "string"
      };

      const accessAfterRevoke = await createInstallationAccess({
        apiBaseUrl: normalized.apiBaseUrl,
        installationId: normalized.installationId,
        appJwt
      });
      operations.revoke.installationAccessAfterRevoke = summarizeInstallationAccess(accessAfterRevoke);

      if (accessBeforeRevoke) {
        const oldAccessProbe = await githubRequest({
          apiBaseUrl: normalized.apiBaseUrl,
          path: "/installation/repositories",
          method: "GET",
          authorization: `Bearer ${accessBeforeRevoke}`
        });
        operations.revoke.existingInstallationAccessProbe = summarizeHttp(oldAccessProbe);
      }

      if (repositoryId && normalized.headSha) {
        const synthetic = await sendSyntheticPullRequestWebhook({
          stagingUrl: normalized.stagingUrl,
          webhookSecret: normalized.webhookSecret,
          installationId: normalized.installationId,
          repositoryId,
          repository: normalized.repository,
          pullRequestNumber: normalized.pullRequestNumber,
          headSha: normalized.headSha
        });
        operations.syntheticWebhook = synthetic;
      } else {
        failures.push("synthetic webhook probe missing repositoryId or headSha");
      }
    }
  } catch (error) {
    failures.push(safeError(error));
  } finally {
    if (suspendedByThisRun) {
      try {
        const unsuspend = await githubRequest({
          apiBaseUrl: normalized.apiBaseUrl,
          path: `/app/installations/${normalized.installationId}/suspended`,
          method: "DELETE",
          authorization: `Bearer ${appJwt}`
        });
        operations.restore.unsuspend = summarizeHttp(unsuspend);

        const installationAfterRestore = await githubRequest({
          apiBaseUrl: normalized.apiBaseUrl,
          path: `/app/installations/${normalized.installationId}`,
          method: "GET",
          authorization: `Bearer ${appJwt}`
        });
        operations.restore.installationAfterRestore = {
          ...summarizeHttp(installationAfterRestore),
          suspendedAfterRestore: typeof readRecord(installationAfterRestore.body).suspended_at === "string"
        };

        const restoredAccess = await createInstallationAccess({
          apiBaseUrl: normalized.apiBaseUrl,
          installationId: normalized.installationId,
          appJwt
        });
        operations.restore.installationAccessAfterRestore = summarizeInstallationAccess(restoredAccess);
        accessAfterRestore = restoredAccess.access;

        if (accessAfterRestore) {
          const repositoriesAfter = await githubRequest({
            apiBaseUrl: normalized.apiBaseUrl,
            path: "/installation/repositories",
            method: "GET",
            authorization: `Bearer ${accessAfterRestore}`
          });
          operations.restore.repositoriesAfterRestore = summarizeHttp(repositoriesAfter);

          if (repositoryId && normalized.headSha) {
            const checkRuns = await listCheckRuns({
              apiBaseUrl: normalized.apiBaseUrl,
              repository: normalized.repository,
              headSha: normalized.headSha,
              checkName: normalized.checkName,
              access: accessAfterRestore
            });
            checkRunsAfter = summarizeCheckRuns(checkRuns);
            operations.restore.checkRunsAfterRestore = checkRunsAfter;
          }
        }
      } catch (restoreError) {
        failures.push(`restore failed: ${safeError(restoreError)}`);
      }
    }
  }

  const checkRunsUnchanged = compareCheckRuns(checkRunsBefore, checkRunsAfter);
  if (checkRunsUnchanged !== undefined) operations.restore.checkRunsUnchanged = checkRunsUnchanged;
  const evidence = {
    installationRevoked: operations.revoke.suspend?.status === 204
      && operations.revoke.installationAfterSuspend?.suspendedAtObserved === true,
    tokenRejectedAfterRevoke: isRejected(operations.revoke.installationAccessAfterRevoke?.status)
      && isRejected(operations.revoke.existingInstallationAccessProbe?.status),
    challengeCreationStopped: isRejected(operations.syntheticWebhook?.status),
    checkUpdateStopped: isRejected(operations.syntheticWebhook?.status) && checkRunsUnchanged === true,
    restoredAfterReadback: operations.restore.unsuspend?.status === 204
      && operations.restore.installationAfterRestore?.suspendedAfterRestore === false
      && operations.restore.installationAccessAfterRestore?.created === true
  };

  if (!evidence.installationRevoked) failures.push("installation suspend was not observed");
  if (!evidence.tokenRejectedAfterRevoke) failures.push("installation access was not rejected after revoke");
  if (!evidence.challengeCreationStopped) failures.push("synthetic webhook did not stop after revoke");
  if (!evidence.checkUpdateStopped) failures.push("Check update stop was not verified");
  if (!evidence.restoredAfterReadback) failures.push("installation was not restored after readback");

  const result = {
    schemaVersion: "archcontext.fg2-install-revoke-readback/v1",
    environment: "staging",
    status: failures.length === 0 ? "verified" : "failed",
    ok: failures.length === 0,
    generatedAt,
    inputs,
    app,
    evidence,
    operations,
    secretValuesPersisted: false,
    privateContentPersisted: false,
    failures
  };

  const leakFailures = inspectFg2InstallRevokeReadback(result).failures;
  if (leakFailures.length > 0) {
    result.status = "failed";
    result.ok = false;
    result.failures.push(...leakFailures.map((failure) => `artifact inspection: ${failure}`));
  }

  if (normalized.outputPath) {
    const outputAbsolute = resolve(normalized.root, normalized.outputPath);
    await mkdir(dirname(outputAbsolute), { recursive: true });
    await writeFile(outputAbsolute, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }

  return result;
}

export function inspectFg2InstallRevokeReadback(recording) {
  const failures = [];
  if (!recording || typeof recording !== "object" || Array.isArray(recording)) {
    return { ok: false, failures: ["recording must be an object"] };
  }
  if (recording.schemaVersion !== "archcontext.fg2-install-revoke-readback/v1") {
    failures.push("schemaVersion must be archcontext.fg2-install-revoke-readback/v1");
  }
  if (recording.environment !== "staging") failures.push("environment must be staging");
  if (recording.status !== "verified") failures.push("status must be verified");
  requireTrue(recording.evidence?.installationRevoked, "evidence.installationRevoked", failures);
  requireTrue(recording.evidence?.tokenRejectedAfterRevoke, "evidence.tokenRejectedAfterRevoke", failures);
  requireTrue(recording.evidence?.challengeCreationStopped, "evidence.challengeCreationStopped", failures);
  requireTrue(recording.evidence?.checkUpdateStopped, "evidence.checkUpdateStopped", failures);
  requireTrue(recording.evidence?.restoredAfterReadback, "evidence.restoredAfterReadback", failures);
  if (recording.secretValuesPersisted !== false) failures.push("secretValuesPersisted must be false");
  if (recording.privateContentPersisted !== false) failures.push("privateContentPersisted must be false");

  const serialized = JSON.stringify(recording);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(serialized)) failures.push("private key material must not be persisted");
  if (/\b(?:ghs|ghp|github_pat)_[A-Za-z0-9_]{20,}\b/.test(serialized)) failures.push("GitHub token value must not be persisted");
  if (/\bBearer\s+[A-Za-z0-9._-]{20,}\b/i.test(serialized)) failures.push("Bearer token value must not be persisted");
  if (/sha256=[a-f0-9]{64}/i.test(serialized)) failures.push("webhook signature must not be persisted");
  return { ok: failures.length === 0, failures };
}

function normalizeConfig(config) {
  const failures = [];
  const normalized = {
    root: config.root ?? process.cwd(),
    envFile: config.envFile ?? DEFAULT_ENV_FILE,
    packetPath: config.packetPath ?? DEFAULT_PACKET,
    outputPath: config.outputPath ?? DEFAULT_OUTPUT,
    appId: requireString(config.appId, "appId", failures),
    appSlug: optionalString(config.appSlug),
    installationId: requirePositiveInteger(config.installationId, "installationId", failures),
    repository: requireRepository(config.repository, failures),
    pullRequestNumber: requirePositiveInteger(config.pullRequestNumber, "pullRequestNumber", failures),
    repositoryId: optionalPositiveInteger(config.repositoryId, "repositoryId"),
    headSha: requireString(config.headSha, "headSha", failures),
    webhookSecret: requireString(config.webhookSecret, "webhookSecret", failures),
    privateKeyPem: requireString(config.privateKeyPem, "privateKeyPem", failures),
    apiBaseUrl: normalizeBaseUrl(config.apiBaseUrl ?? DEFAULT_API_BASE_URL),
    stagingUrl: normalizeBaseUrl(config.stagingUrl ?? "https://archcontext.repoharness.com"),
    checkName: config.checkName ?? DEFAULT_CHECK_NAME,
    confirmSuspend: config.confirmSuspend === true,
    now: typeof config.now === "function" ? config.now : () => new Date().toISOString()
  };
  if (failures.length > 0) throw new Error(failures.join("; "));
  return normalized;
}

async function createInstallationAccess({ apiBaseUrl, installationId, appJwt }) {
  const response = await githubRequest({
    apiBaseUrl,
    path: `/app/installations/${installationId}/access_tokens`,
    method: "POST",
    authorization: `Bearer ${appJwt}`
  });
  const body = readRecord(response.body);
  const access = response.ok && typeof body.token === "string" ? body.token : "";
  return {
    ok: Boolean(access),
    status: response.status,
    requestId: response.requestId,
    access
  };
}

async function listCheckRuns({ apiBaseUrl, repository, headSha, checkName, access }) {
  const path = `/repos/${repository}/commits/${headSha}/check-runs?check_name=${encodeURIComponent(checkName)}`;
  return githubRequest({
    apiBaseUrl,
    path,
    method: "GET",
    authorization: `Bearer ${access}`
  });
}

async function sendSyntheticPullRequestWebhook(input) {
  const rawBody = JSON.stringify({
    action: "opened",
    installation: { id: input.installationId },
    repository: {
      id: input.repositoryId,
      name: input.repository.split("/")[1],
      full_name: input.repository,
      owner: { login: input.repository.split("/")[0] },
      private: true
    },
    pull_request: {
      number: input.pullRequestNumber,
      head: { sha: input.headSha }
    }
  });
  const deliveryId = `fg2-revoke-${Date.now().toString(36)}`;
  const response = await fetch(new URL("/v1/github/webhooks", input.stagingUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "ArchContext-FG2-Revoke-Readback",
      "x-github-delivery": deliveryId,
      "x-github-event": "pull_request",
      "x-hub-signature-256": signWebhook({ secret: input.webhookSecret, rawBody })
    },
    body: rawBody
  });
  await response.arrayBuffer();
  return {
    status: response.status,
    ok: response.ok,
    deliveryId,
    url: `${input.stagingUrl}/v1/github/webhooks`,
    event: "pull_request",
    payloadPersisted: false,
    expectedStopPoint: "github-installation-token-before-pull-head-or-check"
  };
}

async function githubRequest({ apiBaseUrl, path, method, authorization }) {
  const response = await fetch(new URL(path, apiBaseUrl), {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization,
      "content-type": "application/json",
      "user-agent": "ArchContext-FG2-Revoke-Readback",
      "x-github-api-version": GITHUB_API_VERSION
    }
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    requestId: response.headers.get("x-github-request-id") ?? undefined,
    body: text.length > 0 ? JSON.parse(text) : undefined
  };
}

function createGitHubAppJwt({ appId, privateKeyPem }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({ iat: now - 60, exp: now + 540, iss: String(appId) });
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKeyPem);
  return `${signingInput}.${base64Url(signature)}`;
}

function signWebhook({ secret, rawBody }) {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

function summarizeHttp(response) {
  return {
    status: response.status,
    ok: response.ok,
    requestId: response.requestId ?? null
  };
}

function summarizeInstallationAccess(result) {
  return {
    status: result.status,
    created: result.ok,
    requestId: result.requestId ?? null,
    valuePersisted: false
  };
}

function summarizeCheckRuns(response) {
  const body = readRecord(response.body);
  const checkRuns = Array.isArray(body.check_runs) ? body.check_runs : [];
  const latest = checkRuns
    .filter((item) => item && typeof item === "object")
    .map((item) => item)
    .sort((left, right) => String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? "")))[0];
  return {
    ...summarizeHttp(response),
    totalCount: Number.isInteger(body.total_count) ? body.total_count : checkRuns.length,
    latest: latest ? {
      id: latest.id,
      name: latest.name,
      status: latest.status,
      conclusion: latest.conclusion ?? null,
      headSha: latest.head_sha,
      updatedAt: latest.updated_at,
      htmlUrl: latest.html_url
    } : null
  };
}

function compareCheckRuns(before, after) {
  if (!before || !after || !before.ok || !after.ok) return undefined;
  return before.totalCount === after.totalCount
    && before.latest?.id === after.latest?.id
    && before.latest?.updatedAt === after.latest?.updatedAt;
}

function selectRepository(body, repository) {
  const record = readRecord(body);
  const repositories = Array.isArray(record.repositories) ? record.repositories : [];
  const selected = repositories.find((item) => readRecord(item).full_name === repository);
  return {
    repositoryCount: repositories.length,
    visible: Boolean(selected),
    id: optionalPositiveInteger(readRecord(selected).id, "repositoryId")
  };
}

function renderHuman(result) {
  const lines = [`[fg2-install-revoke-readback] ${result.ok ? "OK" : "FAILED"} mode=${result.app.mode}`];
  lines.push(`- installationRevoked: ${result.evidence.installationRevoked}`);
  lines.push(`- tokenRejectedAfterRevoke: ${result.evidence.tokenRejectedAfterRevoke}`);
  lines.push(`- challengeCreationStopped: ${result.evidence.challengeCreationStopped}`);
  lines.push(`- checkUpdateStopped: ${result.evidence.checkUpdateStopped}`);
  lines.push(`- restoredAfterReadback: ${result.evidence.restoredAfterReadback}`);
  for (const failure of result.failures) lines.push(`- failure: ${failure}`);
  return lines.join("\n");
}

function parseDotenv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) throw new Error(`invalid dotenv line: ${line}`);
    env[match[1]] = unquote(match[2] ?? "");
  }
  return env;
}

function unquote(value) {
  const trimmed = String(value).trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\n/g, "\n");
  }
  return trimmed;
}

function extractPullNumber(url) {
  if (typeof url !== "string") return undefined;
  return /\/pull\/([1-9]\d*)/.exec(url)?.[1];
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function optionalPositiveInteger(value, label) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function requirePositiveInteger(value, label, failures) {
  try {
    return parsePositiveInteger(value, label);
  } catch (error) {
    failures.push(safeError(error));
    return 0;
  }
}

function requireRepository(value, failures) {
  if (typeof value !== "string" || !/^[^/]+\/[^/]+$/.test(value)) {
    failures.push("repository must be owner/name");
    return "";
  }
  return value;
}

function requireString(value, label, failures) {
  if (typeof value !== "string" || value.length === 0) {
    failures.push(`${label} must be a non-empty string`);
    return "";
  }
  return value;
}

function optionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requireTrue(value, label, failures) {
  if (value !== true) failures.push(`${label} must be true`);
}

function readRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function isRejected(status) {
  return Number.isInteger(status) && status >= 400;
}

function normalizeBaseUrl(value) {
  return new URL(String(value)).toString().replace(/\/$/, "");
}

function base64UrlJson(value) {
  return base64Url(Buffer.from(JSON.stringify(value)));
}

function base64Url(value) {
  return value.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function readFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}
