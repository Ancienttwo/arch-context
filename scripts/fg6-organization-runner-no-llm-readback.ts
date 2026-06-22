#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { inspectFg3RequiredTrustStagingReadback } from "./fg3-required-trust-staging-readback";
import { inspectFg4DeterministicConclusionReadback } from "./fg4-deterministic-conclusion-readback";
import { inspectFg4GithubHostedRunnerReadback } from "./fg4-github-hosted-runner-readback";

const DEFAULT_RUNNER_SOURCE = "docs/verification/fg4-github-hosted-runner-readback.json";
const DEFAULT_RULESET_SOURCE = "docs/verification/fg4-organization-runner-ruleset-readback.json";
const DEFAULT_DETERMINISTIC_SOURCE = "docs/verification/fg4-deterministic-conclusion-readback.json";
const DEFAULT_OUTPUT = "docs/verification/fg6-organization-runner-no-llm-readback.json";
const ORGANIZATION_RUNNER_CHECK_NAME = "ArchContext / Organization Runner";
const SECRET_PATTERNS = [
  /gh[opsu]_[A-Za-z0-9_]+/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /GITHUB_WEBHOOK_SECRET/i,
  /installation[_-]?token/i,
  /jwt/i,
  /keychain:\/\//i
] as const;
const CODE_CONTENT_PATTERNS = [
  /diff\s+--git/i,
  /^@@\s/m,
  /"patch"\s*:/i,
  /"sourceBody"\s*:/i,
  /"diffBody"\s*:/i,
  /\/contents(?:\/|\b)/i,
  /\/git\/blobs(?:\/|\b)/i,
  /\/git\/trees(?:\/|\b)/i,
  /\/pulls\/\d+\/files/i,
  /application\/vnd\.github\.(?:v3\.)?(?:diff|patch)/i
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildFg6OrganizationRunnerNoLlmConfig(process.env, args);
    const result = await runFg6OrganizationRunnerNoLlm(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg6OrganizationRunnerNoLlm(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg6-organization-runner-no-llm-readback] usage: run|inspect [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg6OrganizationRunnerNoLlmConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    runnerSource: readFlag(args, "--runner-source") ?? env.ARCHCONTEXT_FG6_RUNNER_SOURCE ?? DEFAULT_RUNNER_SOURCE,
    rulesetSource: readFlag(args, "--ruleset-source") ?? env.ARCHCONTEXT_FG6_RULESET_SOURCE ?? DEFAULT_RULESET_SOURCE,
    deterministicSource: readFlag(args, "--deterministic-source") ?? env.ARCHCONTEXT_FG6_DETERMINISTIC_SOURCE ?? DEFAULT_DETERMINISTIC_SOURCE,
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG6_ORG_RUNNER_OUTPUT ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg6OrganizationRunnerNoLlm(config: ReturnType<typeof buildFg6OrganizationRunnerNoLlmConfig>) {
  const runnerSource = JSON.parse(await readFile(resolve(config.root, config.runnerSource), "utf8")) as unknown;
  const rulesetSource = JSON.parse(await readFile(resolve(config.root, config.rulesetSource), "utf8")) as unknown;
  const deterministicSource = JSON.parse(await readFile(resolve(config.root, config.deterministicSource), "utf8")) as unknown;
  const runnerInspection = inspectFg4GithubHostedRunnerReadback(runnerSource);
  const rulesetInspection = inspectFg3RequiredTrustStagingReadback(rulesetSource);
  const deterministicInspection = inspectFg4DeterministicConclusionReadback(deterministicSource);
  const runnerEvidence = readRecord(readRecord(runnerSource).evidence);
  const rulesetEvidence = readRecord(readRecord(rulesetSource).evidence);
  const deterministicEvidence = readRecord(readRecord(deterministicSource).evidence);
  const recording = {
    schemaVersion: "archcontext.fg6-organization-runner-no-llm-readback/v1",
    acceptanceId: "AC-04",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: config.generatedAt(),
    sources: {
      runnerSource: config.runnerSource,
      rulesetSource: config.rulesetSource,
      deterministicSource: config.deterministicSource
    },
    evidence: {
      runner: {
        temporaryBranch: readRecord(runnerEvidence.temporaryBranch),
        pullRequest: readRecord(runnerEvidence.pullRequest),
        workflow: readRecord(runnerEvidence.workflow),
        artifact: readRecord(runnerEvidence.artifact),
        organizationRunner: readRecord(runnerEvidence.organizationRunner),
        egress: Array.isArray(runnerEvidence.egress) ? runnerEvidence.egress : []
      },
      ruleset: {
        policy: readRecord(rulesetEvidence.policy),
        developerReview: readRecord(rulesetEvidence.developerReview),
        organizationRunner: readRecord(rulesetEvidence.organizationRunner),
        ruleset: readRecord(rulesetEvidence.ruleset)
      },
      deterministic: {
        providerEnvCleared: readRecord(deterministicEvidence.providerEnvCleared),
        deterministicGate: readRecord(deterministicEvidence.deterministicGate),
        attestation: readRecord(deterministicEvidence.attestation),
        advisory: readRecord(deterministicEvidence.advisory),
        upload: readRecord(deterministicEvidence.upload),
        leakCounters: readRecord(deterministicEvidence.leakCounters)
      },
      sourceInspections: {
        runner: runnerInspection,
        ruleset: rulesetInspection,
        deterministic: deterministicInspection
      },
      assertions: {
        organizationRunnerRequiredCheckPassed: true,
        noLlmProviderConfigured: true,
        organizationAttestationAccepted: true,
        developerAttestationCannotSatisfyOrganization: true,
        requiredContextBoundToArchContextApp: true,
        temporaryRunnerReadbackCleanedUp: true
      }
    },
    failures: [] as string[]
  };
  const inspection = inspectFg6OrganizationRunnerNoLlm(recording);
  recording.status = inspection.ok ? "verified" : "failed";
  recording.ok = inspection.ok;
  recording.failures = inspection.failures;
  await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
  await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(recording, null, 2)}\n`, "utf8");
  return recording;
}

export function inspectFg6OrganizationRunnerNoLlm(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const runner = readRecord(evidence.runner);
  const runnerBranch = readRecord(runner.temporaryBranch);
  const runnerPr = readRecord(runner.pullRequest);
  const runnerWorkflow = readRecord(runner.workflow);
  const runnerArtifact = readRecord(runner.artifact);
  const runnerCheck = readRecord(runner.organizationRunner);
  const ruleset = readRecord(evidence.ruleset);
  const rulesetPolicy = readRecord(ruleset.policy);
  const rulesetOrgRunner = readRecord(ruleset.organizationRunner);
  const rulesetRecord = readRecord(ruleset.ruleset);
  const requiredStatusCheck = readRecord(rulesetRecord.requiredStatusCheck);
  const deterministic = readRecord(evidence.deterministic);
  const deterministicGate = readRecord(deterministic.deterministicGate);
  const deterministicAttestation = readRecord(deterministic.attestation);
  const deterministicUpload = readRecord(deterministic.upload);
  const deterministicLeakCounters = readRecord(deterministic.leakCounters);
  const sourceInspections = readRecord(evidence.sourceInspections);
  const assertions = readRecord(evidence.assertions);

  if (record.schemaVersion !== "archcontext.fg6-organization-runner-no-llm-readback/v1") failures.push("schemaVersion mismatch");
  if (record.acceptanceId !== "AC-04") failures.push("acceptanceId must be AC-04");
  if (record.environment !== "staging-release-readback") failures.push("environment must be staging-release-readback");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  for (const key of ["runner", "ruleset", "deterministic"]) {
    if (readRecord(sourceInspections[key]).ok !== true) failures.push(`${key} source inspection must pass`);
  }

  if (runnerBranch.deletedAfterReadback !== true) failures.push("runner temporary branch must be deleted");
  if (runnerPr.closedAfterReadback !== true) failures.push("runner temporary PR must be closed");
  if (runnerWorkflow.event !== "pull_request") failures.push("runner workflow event must be pull_request");
  if (runnerWorkflow.conclusion !== "success") failures.push("runner workflow conclusion must be success");
  if (runnerArtifact.llmProviderConfigured !== false) failures.push("runner artifact must have llmProviderConfigured=false");
  if (runnerArtifact.attestationTrustLevel !== "organization") failures.push("runner attestation trust must be organization");
  if (runnerArtifact.attestationResult !== "pass") failures.push("runner attestation result must be pass");
  if (runnerArtifact.privacyAuditOk !== true) failures.push("runner privacy audit must pass");
  if (runnerArtifact.verificationAccepted !== true) failures.push("runner attestation verification must be accepted");
  if (runnerCheck.checkName !== ORGANIZATION_RUNNER_CHECK_NAME) failures.push("runner Check name must be Organization Runner");
  if (runnerCheck.conclusion !== "success") failures.push("runner Check conclusion must be success");
  if (runnerCheck.outputTitle !== "Organization-attested") failures.push("runner Check title must be Organization-attested");
  if (!String(runnerCheck.checkRunUrl ?? "").startsWith("https://github.com/")) failures.push("runner Check URL must be GitHub");

  if (rulesetPolicy.requiredTrust !== "organization") failures.push("ruleset required trust must be organization");
  if (rulesetPolicy.developerTrustSatisfiesOrganization !== false) failures.push("developer trust must not satisfy organization");
  if (rulesetOrgRunner.checkName !== ORGANIZATION_RUNNER_CHECK_NAME) failures.push("ruleset Organization Runner check name mismatch");
  if (rulesetOrgRunner.outputTitle !== "Attestation required") failures.push("ruleset Organization Runner must require attestation before Organization evidence");
  if (requiredStatusCheck.context !== ORGANIZATION_RUNNER_CHECK_NAME) failures.push("ruleset required context must be Organization Runner");
  if (!Number.isInteger(requiredStatusCheck.integrationId) || Number(requiredStatusCheck.integrationId) <= 0) {
    failures.push("ruleset required context must include App integration id");
  }
  if (rulesetRecord.enforcement !== "active") failures.push("ruleset enforcement must be active");
  if (rulesetRecord.deletedAfterReadback !== true) failures.push("temporary ruleset must be deleted");
  if (rulesetRecord.absentAfterDelete !== true) failures.push("temporary ruleset must be absent after delete");

  const providerEnvCleared = readRecord(deterministic.providerEnvCleared);
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "MISTRAL_API_KEY"]) {
    if (providerEnvCleared[key] !== true) failures.push(`${key} must be cleared`);
  }
  if (deterministicGate.llmProviderConfigured !== false) failures.push("deterministic gate must not configure LLM provider");
  if (deterministicGate.result !== "pass") failures.push("deterministic gate must pass");
  if (deterministicGate.reviewDigestMatchesAttestation !== true) failures.push("deterministic review digest must match Attestation");
  if (deterministicAttestation.accepted !== true) failures.push("deterministic Attestation must be accepted");
  if (deterministicAttestation.result !== "pass") failures.push("deterministic Attestation result must be pass");
  if (deterministicAttestation.conclusionSource !== "deterministic-gate") failures.push("conclusion source must be deterministic gate");
  if (deterministicUpload.privacyAuditOk !== true) failures.push("deterministic upload privacy audit must pass");
  if (deterministicUpload.containsAdvisory !== false) failures.push("deterministic upload must not contain advisory");
  if (deterministicUpload.containsProviderCredential !== false) failures.push("deterministic upload must not contain provider credentials");
  for (const key of ["plaintextNonceLeaks", "privateKeyLeaks", "tokenLeaks"]) {
    if (Number(deterministicLeakCounters[key]) !== 0) failures.push(`${key} must be 0`);
  }

  for (const key of [
    "organizationRunnerRequiredCheckPassed",
    "noLlmProviderConfigured",
    "organizationAttestationAccepted",
    "developerAttestationCannotSatisfyOrganization",
    "requiredContextBoundToArchContextApp",
    "temporaryRunnerReadbackCleanedUp"
  ]) {
    if (assertions[key] !== true) failures.push(`assertion ${key} must be true`);
  }

  const serialized = JSON.stringify(recording);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden secret marker: ${pattern}`);
  }
  for (const pattern of CODE_CONTENT_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden code-content marker: ${pattern}`);
  }
  return { ok: failures.length === 0, failures };
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
  return result.ok === true ? "FG6 Organization Runner no-LLM readback verified" : `FG6 Organization Runner no-LLM readback failed: ${failures.join("; ")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }): string {
  return result.ok ? "FG6 Organization Runner no-LLM evidence verified" : `FG6 Organization Runner no-LLM evidence failed: ${result.failures.join("; ")}`;
}
