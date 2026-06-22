#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { REVIEW_ACTION_NO_LLM_MODEL_DIGEST } from "@archcontext/cloud/runner";
import { inspectFg4DeterministicConclusionReadback } from "./fg4-deterministic-conclusion-readback";
import { inspectFg4GithubHostedRunnerReadback } from "./fg4-github-hosted-runner-readback";
import { inspectFg6LocalNoCloud } from "./fg6-local-no-cloud-readback";
import { inspectFg6OrganizationRunnerNoLlm } from "./fg6-organization-runner-no-llm-readback";

const DEFAULT_LOCAL_NO_CLOUD_SOURCE = "docs/verification/fg6-local-no-cloud-readback.json";
const DEFAULT_RUNNER_SOURCE = "docs/verification/fg4-github-hosted-runner-readback.json";
const DEFAULT_DETERMINISTIC_SOURCE = "docs/verification/fg4-deterministic-conclusion-readback.json";
const DEFAULT_ORG_NO_LLM_SOURCE = "docs/verification/fg6-organization-runner-no-llm-readback.json";
const DEFAULT_OUTPUT = "docs/verification/fg6-no-provider-deterministic-readback.json";
const PROVIDER_ENV_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "MISTRAL_API_KEY"] as const;
const SECRET_PATTERNS = [
  /gh[opsu]_[A-Za-z0-9_]+/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /installation[_-]?token/i,
  /keychain:\/\//i,
  /sk-[A-Za-z0-9_-]{16,}/i
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildFg6NoProviderDeterministicConfig(process.env, args);
    const result = await runFg6NoProviderDeterministic(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg6NoProviderDeterministic(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg6-no-provider-deterministic-readback] usage: run|inspect [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg6NoProviderDeterministicConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    localNoCloudSource: readFlag(args, "--local-no-cloud-source") ?? env.ARCHCONTEXT_FG6_LOCAL_NO_CLOUD_SOURCE ?? DEFAULT_LOCAL_NO_CLOUD_SOURCE,
    runnerSource: readFlag(args, "--runner-source") ?? env.ARCHCONTEXT_FG6_RUNNER_SOURCE ?? DEFAULT_RUNNER_SOURCE,
    deterministicSource: readFlag(args, "--deterministic-source") ?? env.ARCHCONTEXT_FG6_DETERMINISTIC_SOURCE ?? DEFAULT_DETERMINISTIC_SOURCE,
    orgNoLlmSource: readFlag(args, "--org-no-llm-source") ?? env.ARCHCONTEXT_FG6_ORG_NO_LLM_SOURCE ?? DEFAULT_ORG_NO_LLM_SOURCE,
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG6_NO_PROVIDER_DETERMINISTIC_OUTPUT ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg6NoProviderDeterministic(config: ReturnType<typeof buildFg6NoProviderDeterministicConfig>) {
  const [localNoCloudSource, runnerSource, deterministicSource, orgNoLlmSource] = await Promise.all([
    readJson(resolve(config.root, config.localNoCloudSource)),
    readJson(resolve(config.root, config.runnerSource)),
    readJson(resolve(config.root, config.deterministicSource)),
    readJson(resolve(config.root, config.orgNoLlmSource))
  ]);
  const localInspection = inspectFg6LocalNoCloud(localNoCloudSource);
  const runnerInspection = inspectFg4GithubHostedRunnerReadback(runnerSource);
  const deterministicInspection = inspectFg4DeterministicConclusionReadback(deterministicSource);
  const orgNoLlmInspection = inspectFg6OrganizationRunnerNoLlm(orgNoLlmSource);
  const deterministicEvidence = readRecord(readRecord(deterministicSource).evidence);
  const recording = {
    schemaVersion: "archcontext.fg6-no-provider-deterministic-readback/v1",
    acceptanceId: "AC-06",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: config.generatedAt(),
    sources: {
      localNoCloudSource: config.localNoCloudSource,
      runnerSource: config.runnerSource,
      deterministicSource: config.deterministicSource,
      orgNoLlmSource: config.orgNoLlmSource
    },
    evidence: {
      localCore: summarizeLocalNoCloud(localNoCloudSource),
      officialReviewAction: summarizeRunner(runnerSource),
      deterministicGate: {
        providerEnvCleared: readRecord(deterministicEvidence.providerEnvCleared),
        deterministicGate: readRecord(deterministicEvidence.deterministicGate),
        attestation: readRecord(deterministicEvidence.attestation),
        advisory: readRecord(deterministicEvidence.advisory),
        upload: readRecord(deterministicEvidence.upload),
        leakCounters: readRecord(deterministicEvidence.leakCounters)
      },
      releaseAssertions: summarizeOrgNoLlm(orgNoLlmSource),
      sourceInspections: {
        localNoCloud: localInspection,
        runner: runnerInspection,
        deterministic: deterministicInspection,
        orgNoLlm: orgNoLlmInspection
      },
      assertions: {
        localGateNoProviderRequired: localInspection.ok === true,
        officialReviewActionNoProviderRequired: runnerInspection.ok === true,
        deterministicConclusionUnchangedWithoutProvider: deterministicInspection.ok === true,
        organizationRunnerNoProviderReleasePathVerified: orgNoLlmInspection.ok === true,
        attestationSubmittedFromDeterministicGate: readRecord(deterministicEvidence.attestation).conclusionSource === "deterministic-gate",
        advisoryCannotInfluenceConclusion: readRecord(deterministicEvidence.advisory).injectedAdvisoryRejected === true,
        uploadPayloadProviderFree: readRecord(deterministicEvidence.upload).containsProviderCredential === false
      }
    },
    failures: [] as string[]
  };
  const inspection = inspectFg6NoProviderDeterministic(recording);
  recording.status = inspection.ok ? "verified" : "failed";
  recording.ok = inspection.ok;
  recording.failures = inspection.failures;
  await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
  await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(recording, null, 2)}\n`, "utf8");
  return recording;
}

export function inspectFg6NoProviderDeterministic(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const localCore = readRecord(evidence.localCore);
  const officialReviewAction = readRecord(evidence.officialReviewAction);
  const deterministic = readRecord(evidence.deterministicGate);
  const releaseAssertions = readRecord(evidence.releaseAssertions);
  const sourceInspections = readRecord(evidence.sourceInspections);
  const assertions = readRecord(evidence.assertions);

  if (record.schemaVersion !== "archcontext.fg6-no-provider-deterministic-readback/v1") failures.push("schemaVersion mismatch");
  if (record.acceptanceId !== "AC-06") failures.push("acceptanceId must be AC-06");
  if (record.environment !== "staging-release-readback") failures.push("environment must be staging-release-readback");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  for (const [name, inspection] of Object.entries(sourceInspections)) {
    if (readRecord(inspection).ok !== true) failures.push(`${name} source inspection must pass`);
  }

  inspectLocalCore(localCore, failures);
  inspectOfficialReviewAction(officialReviewAction, failures);
  inspectDeterministicGate(deterministic, failures);
  inspectReleaseAssertions(releaseAssertions, failures);

  for (const key of [
    "localGateNoProviderRequired",
    "officialReviewActionNoProviderRequired",
    "deterministicConclusionUnchangedWithoutProvider",
    "organizationRunnerNoProviderReleasePathVerified",
    "attestationSubmittedFromDeterministicGate",
    "advisoryCannotInfluenceConclusion",
    "uploadPayloadProviderFree"
  ]) {
    if (assertions[key] !== true) failures.push(`assertion ${key} must be true`);
  }

  const serialized = JSON.stringify(recording);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden secret marker: ${pattern}`);
  }
  return { ok: failures.length === 0, failures };
}

function summarizeLocalNoCloud(recording: unknown) {
  const evidence = readRecord(readRecord(recording).evidence);
  const localEvidence = readRecord(evidence.localEvidence);
  const assertions = readRecord(evidence.assertions);
  const taskLifecycle = readRecord(localEvidence.taskLifecycle);
  const review = readRecord(localEvidence.review);
  return {
    commandCount: Array.isArray(localEvidence.commands) ? localEvidence.commands.length : 0,
    providerEnvRemoved: Array.isArray(localEvidence.providerEnvRemoved) ? localEvidence.providerEnvRemoved : [],
    noLlmProviderRequired: assertions.noLlmProviderRequired === true,
    localReviewComplete: assertions.localReviewComplete === true,
    completeResult: taskLifecycle.completeResult,
    reviewResult: review.result,
    reviewErrors: Number(review.errors ?? 0)
  };
}

function summarizeRunner(recording: unknown) {
  const evidence = readRecord(readRecord(recording).evidence);
  const workflow = readRecord(evidence.workflow);
  const artifact = readRecord(evidence.artifact);
  const organizationRunner = readRecord(evidence.organizationRunner);
  return {
    workflow: {
      event: workflow.event,
      conclusion: workflow.conclusion,
      runUrl: workflow.runUrl
    },
    artifact: {
      ok: artifact.ok === true,
      environment: artifact.environment,
      llmProviderConfigured: artifact.llmProviderConfigured,
      attestationTrustLevel: artifact.attestationTrustLevel,
      attestationResult: artifact.attestationResult,
      privacyAuditOk: artifact.privacyAuditOk,
      verificationAccepted: artifact.verificationAccepted
    },
    organizationRunner: {
      checkName: organizationRunner.checkName,
      conclusion: organizationRunner.conclusion,
      outputTitle: organizationRunner.outputTitle
    }
  };
}

function summarizeOrgNoLlm(recording: unknown) {
  const assertions = readRecord(readRecord(readRecord(recording).evidence).assertions);
  return {
    organizationRunnerRequiredCheckPassed: assertions.organizationRunnerRequiredCheckPassed === true,
    noLlmProviderConfigured: assertions.noLlmProviderConfigured === true,
    organizationAttestationAccepted: assertions.organizationAttestationAccepted === true,
    developerAttestationCannotSatisfyOrganization: assertions.developerAttestationCannotSatisfyOrganization === true,
    requiredContextBoundToArchContextApp: assertions.requiredContextBoundToArchContextApp === true
  };
}

function inspectLocalCore(localCore: Record<string, unknown>, failures: string[]): void {
  if (Number(localCore.commandCount ?? 0) < 10) failures.push("localCore commandCount must cover the first-experience flow");
  if (localCore.noLlmProviderRequired !== true) failures.push("localCore noLlmProviderRequired must be true");
  if (localCore.localReviewComplete !== true) failures.push("localCore localReviewComplete must be true");
  if (localCore.completeResult !== "pass") failures.push("localCore completeResult must be pass");
  if (localCore.reviewResult !== "pass") failures.push("localCore reviewResult must be pass");
  if (Number(localCore.reviewErrors ?? 1) !== 0) failures.push("localCore reviewErrors must be 0");
  const providerEnvRemoved = Array.isArray(localCore.providerEnvRemoved) ? localCore.providerEnvRemoved.map(String) : [];
  if (!providerEnvRemoved.every((key) => /^[A-Z0-9_]+$/.test(key))) failures.push("localCore providerEnvRemoved must contain variable names only");
}

function inspectOfficialReviewAction(officialReviewAction: Record<string, unknown>, failures: string[]): void {
  const workflow = readRecord(officialReviewAction.workflow);
  const artifact = readRecord(officialReviewAction.artifact);
  const organizationRunner = readRecord(officialReviewAction.organizationRunner);
  if (workflow.event !== "pull_request") failures.push("officialReviewAction workflow event must be pull_request");
  if (workflow.conclusion !== "success") failures.push("officialReviewAction workflow conclusion must be success");
  if (!String(workflow.runUrl ?? "").startsWith("https://github.com/")) failures.push("officialReviewAction workflow runUrl must be GitHub");
  if (artifact.ok !== true) failures.push("officialReviewAction artifact.ok must be true");
  if (artifact.environment !== "github-actions") failures.push("officialReviewAction artifact environment must be github-actions");
  if (artifact.llmProviderConfigured !== false) failures.push("officialReviewAction artifact must have llmProviderConfigured=false");
  if (artifact.attestationTrustLevel !== "organization") failures.push("officialReviewAction attestation trust must be organization");
  if (artifact.attestationResult !== "pass") failures.push("officialReviewAction attestation result must be pass");
  if (artifact.privacyAuditOk !== true) failures.push("officialReviewAction privacy audit must pass");
  if (artifact.verificationAccepted !== true) failures.push("officialReviewAction attestation verification must be accepted");
  if (organizationRunner.checkName !== "ArchContext / Organization Runner") failures.push("officialReviewAction checkName mismatch");
  if (organizationRunner.conclusion !== "success") failures.push("officialReviewAction check conclusion must be success");
  if (organizationRunner.outputTitle !== "Organization-attested") failures.push("officialReviewAction check title must be Organization-attested");
}

function inspectDeterministicGate(deterministic: Record<string, unknown>, failures: string[]): void {
  const providerEnvCleared = readRecord(deterministic.providerEnvCleared);
  const gate = readRecord(deterministic.deterministicGate);
  const attestation = readRecord(deterministic.attestation);
  const advisory = readRecord(deterministic.advisory);
  const upload = readRecord(deterministic.upload);
  const leakCounters = readRecord(deterministic.leakCounters);
  for (const key of PROVIDER_ENV_KEYS) {
    if (providerEnvCleared[key] !== true) failures.push(`${key} must be cleared`);
  }
  if (gate.llmProviderConfigured !== false) failures.push("deterministic gate must not configure an LLM provider");
  if (gate.modelDigest !== REVIEW_ACTION_NO_LLM_MODEL_DIGEST) failures.push("deterministic gate modelDigest must be no-provider digest");
  if (gate.result !== "pass") failures.push("deterministic gate result must be pass");
  if (gate.reviewDigestMatchesAttestation !== true) failures.push("deterministic review digest must match Attestation");
  if (attestation.accepted !== true) failures.push("deterministic Attestation must be accepted");
  if (attestation.result !== "pass") failures.push("deterministic Attestation result must be pass");
  if (attestation.conclusionSource !== "deterministic-gate") failures.push("conclusion source must be deterministic gate");
  if (advisory.allowedAdvisoryCreated !== true) failures.push("allowed advisory must be isolated");
  if (advisory.deterministicReviewDigestMatches !== true) failures.push("advisory must bind to deterministic review digest");
  if (advisory.injectedAdvisoryRejected !== true) failures.push("injected advisory must be rejected");
  if (!String(advisory.injectedAdvisoryReason ?? "").includes("llm-advisory-conclusion-field-forbidden")) {
    failures.push("injected advisory rejection reason mismatch");
  }
  if (upload.privacyAuditOk !== true) failures.push("deterministic upload privacy audit must pass");
  if (upload.containsAdvisory !== false) failures.push("deterministic upload must not contain advisory");
  if (upload.containsProviderCredential !== false) failures.push("deterministic upload must not contain provider credentials");
  for (const key of ["plaintextNonceLeaks", "privateKeyLeaks", "tokenLeaks"]) {
    if (Number(leakCounters[key] ?? 0) !== 0) failures.push(`${key} must be 0`);
  }
}

function inspectReleaseAssertions(releaseAssertions: Record<string, unknown>, failures: string[]): void {
  for (const key of [
    "organizationRunnerRequiredCheckPassed",
    "noLlmProviderConfigured",
    "organizationAttestationAccepted",
    "developerAttestationCannotSatisfyOrganization",
    "requiredContextBoundToArchContextApp"
  ]) {
    if (releaseAssertions[key] !== true) failures.push(`release assertion ${key} must be true`);
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function renderHuman(result: { ok?: unknown; failures?: unknown }): string {
  const failures = Array.isArray(result.failures) ? result.failures.map(String) : [];
  return result.ok === true ? "FG6 no-provider deterministic readback verified" : `FG6 no-provider deterministic readback failed: ${failures.join("; ")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }): string {
  return result.ok ? "FG6 no-provider deterministic evidence verified" : `FG6 no-provider deterministic evidence failed: ${result.failures.join("; ")}`;
}
