#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readbackManifest } from "../../scripts/privacy-capture-manifest.mjs";
import { readbackSecurityScanManifest } from "../../scripts/security-scan-manifest.mjs";

export const OFFICIAL_OPENAI_APP_REVIEW_DOCS = [
  "https://developers.openai.com/apps-sdk/deploy/submission",
  "https://developers.openai.com/apps-sdk/app-submission-guidelines",
  "https://developers.openai.com/apps-sdk/build/auth"
];

const DEFAULT_ENDPOINTS = [
  { id: "privacy", method: "GET", path: "/privacy", expect: { statusMax: 399, bodyIncludes: "privacy" } },
  { id: "chatgpt-directory-metadata", method: "GET", path: "/chatgpt/directory", expect: { statusMax: 399, json: { slug: "archcontext", repositoryContent: "local-runtime-only" } } },
  { id: "oauth-discovery", method: "GET", path: "/.well-known/oauth-authorization-server", expect: { statusMax: 399 } }
];

const SAMPLE_NOTIFICATION_EVENT = {
  eventId: "notification.production-readback",
  prUrl: "https://github.com/ancienttwo/arch-context/pull/0",
  result: "pass",
  riskLevel: "low",
  commitSha: "abc1234",
  runtimeVersion: "archctx/1.1.0",
  occurredAt: "2026-06-20T00:00:00Z"
};

if (import.meta.main) {
  const [command = "preflight", ...args] = process.argv.slice(2);
  const config = buildReadbackConfig(process.env, args);
  const result = command === "run"
    ? await runExternalReadback(config)
    : command === "preflight"
      ? await preflightExternalReadback(config)
      : usage(command);
  const text = config.json ? JSON.stringify(result, null, 2) : renderHuman(result);
  process.stdout.write(`${text}\n`);
  if (command === "run" && result.status === "failed") process.exit(1);
  if (command === "run" && result.status === "blocked") process.exit(2);
}

export function buildReadbackConfig(env = process.env, args = []) {
  const environment = readArg(args, "--environment") ?? env.ARCHCONTEXT_READBACK_ENV ?? "production";
  const prefix = environment.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const baseUrl = trimSlash(
    readArg(args, "--base-url") ??
      env[`ARCHCONTEXT_${prefix}_BASE_URL`] ??
      env.ARCHCONTEXT_READBACK_BASE_URL ??
      ""
  );
  return {
    environment,
    baseUrl,
    bearerToken: readArg(args, "--bearer-token") ?? env[`ARCHCONTEXT_${prefix}_BEARER_TOKEN`] ?? env.ARCHCONTEXT_READBACK_BEARER_TOKEN,
    openaiDirectoryUrl: readArg(args, "--openai-directory-url") ?? env.ARCHCONTEXT_OPENAI_DIRECTORY_URL,
    openaiDirectoryEvidencePath: readArg(args, "--openai-directory-evidence") ?? env.ARCHCONTEXT_OPENAI_DIRECTORY_EVIDENCE_PATH,
    providerEvidencePath: readArg(args, "--provider-evidence") ?? env.ARCHCONTEXT_PROVIDER_DELIVERY_EVIDENCE_PATH,
    providerWebhookUrl: readArg(args, "--provider-webhook-url") ?? env.ARCHCONTEXT_READBACK_PROVIDER_WEBHOOK_URL,
    sendProviderProbe: args.includes("--send-provider-probe") || env.ARCHCONTEXT_READBACK_SEND_PROVIDER_PROBE === "1",
    capturePath: readArg(args, "--capture") ?? env.ARCHCONTEXT_READBACK_CAPTURE_PATH ?? `artifacts/readback/${environment}-redacted.har.json`,
    captureManifestPath: readArg(args, "--capture-manifest") ?? env.ARCHCONTEXT_CAPTURE_MANIFEST_PATH ?? "docs/security/captures/manifest.json",
    securityScanManifestPath: readArg(args, "--security-scan-manifest") ?? env.ARCHCONTEXT_SECURITY_SCAN_MANIFEST_PATH ?? "docs/security/scans/manifest.json",
    root: readArg(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    json: args.includes("--json"),
    requireProductionEvidence: environment === "production" && !args.includes("--allow-partial")
  };
}

export async function preflightExternalReadback(config) {
  return preflightReadback(config, await collectExternalEvidence(config));
}

export function preflightReadback(config, externalEvidence = {}) {
  const blockers = [];
  if (!config.baseUrl) blockers.push("missing ARCHCONTEXT_PRODUCTION_BASE_URL or ARCHCONTEXT_READBACK_BASE_URL");
  if (config.requireProductionEvidence && !config.openaiDirectoryUrl && !config.openaiDirectoryEvidencePath) {
    blockers.push("missing GPT App Directory evidence: set ARCHCONTEXT_OPENAI_DIRECTORY_URL or ARCHCONTEXT_OPENAI_DIRECTORY_EVIDENCE_PATH");
  }
  if (config.requireProductionEvidence && !config.providerWebhookUrl && !config.providerEvidencePath) {
    blockers.push("missing real provider delivery evidence: set ARCHCONTEXT_READBACK_PROVIDER_WEBHOOK_URL or ARCHCONTEXT_PROVIDER_DELIVERY_EVIDENCE_PATH");
  }
  const captureEvidence = externalEvidence.capture ?? externalEvidenceStatus(config.requireProductionEvidence, "packet capture");
  const securityScanEvidence = externalEvidence.securityScan ?? externalEvidenceStatus(config.requireProductionEvidence, "security scan");
  if (config.requireProductionEvidence && !captureEvidence.ok) blockers.push(formatExternalEvidenceBlocker("packet capture", captureEvidence));
  if (config.requireProductionEvidence && !securityScanEvidence.ok) blockers.push(formatExternalEvidenceBlocker("security scan", securityScanEvidence));
  return {
    schemaVersion: "archcontext.production-ga-readback/v1",
    environment: config.environment,
    status: blockers.length === 0 ? "ready" : "blocked",
    blockers,
    checks: {
      archcontextBaseUrl: Boolean(config.baseUrl),
      gptAppDirectoryEvidence: Boolean(config.openaiDirectoryUrl || config.openaiDirectoryEvidencePath),
      providerDeliveryEvidence: Boolean(config.providerWebhookUrl || config.providerEvidencePath),
      packetCaptureExternalEvidence: projectExternalEvidence(captureEvidence),
      securityScanExternalEvidence: projectExternalEvidence(securityScanEvidence),
      captureManifestPath: config.captureManifestPath,
      securityScanManifestPath: config.securityScanManifestPath,
      capturePath: config.capturePath
    },
    officialOpenAiDocs: OFFICIAL_OPENAI_APP_REVIEW_DOCS
  };
}

export async function collectExternalEvidence(config) {
  if (!config.requireProductionEvidence) {
    return {
      capture: externalEvidenceStatus(false, "packet capture"),
      securityScan: externalEvidenceStatus(false, "security scan")
    };
  }
  const [capture, securityScan] = await Promise.all([
    readStrictCaptureEvidence(config),
    readStrictSecurityScanEvidence(config)
  ]);
  return { capture, securityScan };
}

export async function runExternalReadback(config, fetchImpl = fetch) {
  const preflight = await preflightExternalReadback(config);
  if (preflight.status === "blocked") return preflight;

  const entries = [];
  const checks = [];
  for (const endpoint of DEFAULT_ENDPOINTS) {
    const result = await fetchEndpoint(config, endpoint, fetchImpl);
    entries.push(result.harEntry);
    checks.push(projectEndpointCheck(result));
  }
  if (config.openaiDirectoryUrl) {
    const result = await fetchAbsoluteUrl(config, "openai-directory-listing", config.openaiDirectoryUrl, fetchImpl);
    entries.push(result.harEntry);
    checks.push(projectEndpointCheck(result));
  }
  if (config.providerWebhookUrl && config.sendProviderProbe) {
    const result = await postProviderProbe(config, fetchImpl);
    entries.push(result.harEntry);
    checks.push(projectEndpointCheck(result));
  }
  if (config.providerEvidencePath) checks.push(await readEvidenceFile("provider-delivery-evidence", config.providerEvidencePath, config.root));
  if (config.openaiDirectoryEvidencePath) checks.push(await readEvidenceFile("openai-directory-evidence", config.openaiDirectoryEvidencePath, config.root));

  const capture = { log: { version: "1.2", creator: { name: "ArchContext production-ga-readback", version: "1.0.0" }, entries } };
  await writeJson(config.capturePath, capture, config.root);
  const failed = checks.filter((check) => check.status !== "pass");
  return {
    schemaVersion: "archcontext.production-ga-readback/v1",
    environment: config.environment,
    status: failed.length === 0 ? "verified" : "failed",
    capturePath: config.capturePath,
    checks,
    officialOpenAiDocs: OFFICIAL_OPENAI_APP_REVIEW_DOCS
  };
}

async function fetchEndpoint(config, endpoint, fetchImpl) {
  return fetchAbsoluteUrl(config, endpoint.id, `${config.baseUrl}${endpoint.path}`, fetchImpl, endpoint);
}

async function fetchAbsoluteUrl(config, id, url, fetchImpl, endpoint = { id, method: "GET", expect: { statusMax: 399 } }) {
  const headers = config.bearerToken ? { authorization: `Bearer ${config.bearerToken}` } : {};
  const response = await fetchImpl(url, { method: endpoint.method ?? "GET", headers });
  const text = await response.text();
  return {
    id,
    status: response.status,
    body: text,
    expect: endpoint.expect ?? { statusMax: 399 },
    harEntry: toHarEntry({ id, method: endpoint.method ?? "GET", url, requestHeaders: headers, response, text })
  };
}

async function postProviderProbe(config, fetchImpl) {
  const headers = { "content-type": "application/json" };
  const response = await fetchImpl(config.providerWebhookUrl, { method: "POST", headers, body: JSON.stringify(SAMPLE_NOTIFICATION_EVENT) });
  const text = await response.text();
  return {
    id: "provider-webhook-delivery",
    status: response.status,
    body: text,
    expect: { statusMax: 299 },
    harEntry: toHarEntry({ id: "provider-webhook-delivery", method: "POST", url: config.providerWebhookUrl, requestHeaders: headers, requestBody: SAMPLE_NOTIFICATION_EVENT, response, text })
  };
}

function projectEndpointCheck(result) {
  const failures = [];
  if (result.status > (result.expect.statusMax ?? 399)) failures.push(`status ${result.status} > ${result.expect.statusMax}`);
  if (result.expect.bodyIncludes && !result.body.toLowerCase().includes(result.expect.bodyIncludes.toLowerCase())) {
    failures.push(`body does not include ${result.expect.bodyIncludes}`);
  }
  if (result.expect.json) {
    try {
      const parsed = JSON.parse(result.body);
      for (const [key, expected] of Object.entries(result.expect.json)) {
        if (parsed[key] !== expected) failures.push(`json.${key} expected ${expected}`);
      }
    } catch {
      failures.push("body is not JSON");
    }
  }
  return { id: result.id, status: failures.length === 0 ? "pass" : "fail", failures };
}

async function readEvidenceFile(id, path, root) {
  const body = await readFile(resolve(root, path), "utf8");
  return { id, status: body.trim().length > 0 ? "pass" : "fail", evidencePath: path, failures: body.trim().length > 0 ? [] : ["empty evidence file"] };
}

async function readStrictCaptureEvidence(config) {
  try {
    return await readbackManifest({
      manifestPath: config.captureManifestPath,
      root: config.root,
      requireExternal: true
    });
  } catch (error) {
    return { ok: false, verified: 0, pending: 0, externalVerified: 0, failures: [error.message] };
  }
}

async function readStrictSecurityScanEvidence(config) {
  try {
    return await readbackSecurityScanManifest({
      manifestPath: config.securityScanManifestPath,
      root: config.root,
      requireExternal: true
    });
  } catch (error) {
    return { ok: false, verified: 0, pending: 0, externalVerified: 0, failures: [error.message] };
  }
}

function externalEvidenceStatus(required, kind) {
  return required
    ? { ok: false, verified: 0, pending: 0, externalVerified: 0, failures: [`${kind} external readback was not checked`] }
    : { ok: true, verified: 0, pending: 0, externalVerified: 0, failures: [], notRequired: true };
}

function projectExternalEvidence(evidence) {
  return {
    ok: evidence.ok,
    verified: evidence.verified,
    pending: evidence.pending,
    externalVerified: evidence.externalVerified,
    failures: evidence.failures ?? [],
    notRequired: Boolean(evidence.notRequired)
  };
}

function formatExternalEvidenceBlocker(kind, evidence) {
  const suffix = evidence.failures?.length ? `: ${evidence.failures.join("; ")}` : "";
  return `missing verified staging or production ${kind}${suffix}`;
}

function toHarEntry(input) {
  return {
    request: {
      method: input.method,
      url: redactUrl(input.url),
      headers: Object.entries(input.requestHeaders ?? {}).map(([name, value]) => ({ name, value: redactHeader(name, value) })),
      postData: input.requestBody ? { mimeType: "application/json", text: JSON.stringify(input.requestBody) } : undefined
    },
    response: {
      status: input.response.status,
      headers: [...input.response.headers.entries()].map(([name, value]) => ({ name, value: redactHeader(name, value) })),
      content: { mimeType: input.response.headers.get("content-type") ?? "text/plain", text: truncate(input.text) }
    }
  };
}

async function writeJson(path, value, root) {
  const absolute = resolve(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function renderHuman(result) {
  const lines = [`[production-ga-readback] ${result.status} environment=${result.environment}`];
  for (const blocker of result.blockers ?? []) lines.push(`- blocker: ${blocker}`);
  for (const check of result.checks ?? []) lines.push(`- ${check.id}: ${check.status}${check.failures?.length ? ` (${check.failures.join("; ")})` : ""}`);
  if (result.capturePath) lines.push(`capture: ${result.capturePath}`);
  return lines.join("\n");
}

function usage(command) {
  return { schemaVersion: "archcontext.production-ga-readback/v1", status: "failed", environment: "unknown", blockers: [`unknown command: ${command}`] };
}

function readArg(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function trimSlash(value) {
  return value.replace(/\/+$/, "");
}

function redactHeader(name, value) {
  return /authorization|cookie|secret|token/i.test(name) ? "[REDACTED]" : String(value);
}

function redactUrl(url) {
  return String(url).replace(/([?&](access_token|token|secret|key)=)[^&]+/gi, "$1[REDACTED]");
}

function truncate(value) {
  return String(value).slice(0, 4096);
}
