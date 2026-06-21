#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  DEVELOPER_REVIEW_CHECK_NAME,
  ORGANIZATION_RUNNER_CHECK_NAME
} from "@archcontext/contracts";

const DEFAULT_SOURCE = "docs/verification/fg4-organization-runner-ruleset-readback.json";
const DEFAULT_OUTPUT = "docs/verification/fg4-developer-cannot-satisfy-organization-readback.json";

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const sourcePath = readFlag(args, "--source") ?? DEFAULT_SOURCE;
    const outputPath = readFlag(args, "--out") ?? DEFAULT_OUTPUT;
    const source = JSON.parse(await readFile(resolve(process.cwd(), sourcePath), "utf8")) as unknown;
    const result = buildFg4DeveloperCannotSatisfyOrganizationReadback(source, {
      sourceEvidence: sourcePath,
      generatedAt: new Date().toISOString()
    });
    await mkdir(dirname(resolve(process.cwd(), outputPath)), { recursive: true });
    await writeFile(resolve(process.cwd(), outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const evidence = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg4DeveloperCannotSatisfyOrganizationReadback(evidence);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg4-developer-cannot-satisfy-organization-readback] usage: run|inspect [--source path] [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg4DeveloperCannotSatisfyOrganizationReadback(
  source: unknown,
  options: { sourceEvidence: string; generatedAt: string }
) {
  const failures = inspectSource(source).failures;
  const record = readRecord(source);
  const config = readRecord(record.config);
  const evidence = readRecord(record.evidence);
  const policy = readRecord(evidence.policy);
  const developerReview = readRecord(evidence.developerReview);
  const organizationRunner = readRecord(evidence.organizationRunner);
  const ruleset = readRecord(evidence.ruleset);
  const requiredStatusCheck = readRecord(ruleset.requiredStatusCheck);
  const result = {
    schemaVersion: "archcontext.fg4-developer-cannot-satisfy-organization-readback/v1",
    environment: "staging",
    status: failures.length === 0 ? "verified" : "failed",
    ok: failures.length === 0,
    generatedAt: options.generatedAt,
    sourceEvidence: options.sourceEvidence,
    config: {
      repository: stringValue(config.repository),
      repositoryId: config.repositoryId,
      pullRequestNumber: config.pullRequestNumber,
      appSlug: stringValue(config.appSlug),
      appId: stringValue(config.appId),
      installationId: config.installationId
    },
    evidence: {
      policy: {
        requiredTrust: policy.requiredTrust,
        developerTrustSatisfiesOrganization: policy.developerTrustSatisfiesOrganization,
        developerAttestationAcceptedForOrganization: readRecord(policy.developerAttestationVerification).accepted,
        rejectionReasonCode: readRecord(policy.developerAttestationVerification).reasonCode
      },
      developerReview: {
        checkName: developerReview.checkName,
        checkRunId: developerReview.checkRunId,
        checkRunUrl: developerReview.checkRunUrl,
        headSha: developerReview.headSha,
        conclusion: developerReview.conclusion,
        outputTitle: developerReview.outputTitle
      },
      organizationRunner: {
        checkName: organizationRunner.checkName,
        checkRunId: organizationRunner.checkRunId,
        checkRunUrl: organizationRunner.checkRunUrl,
        headSha: organizationRunner.headSha,
        conclusion: organizationRunner.conclusion,
        outputTitle: organizationRunner.outputTitle,
        requiredSummary: organizationRunner.organizationRequiredSummary,
        trustMismatchSummary: organizationRunner.trustMismatchSummary
      },
      ruleset: {
        id: ruleset.id,
        enforcement: ruleset.enforcement,
        target: ruleset.target,
        requiredContext: requiredStatusCheck.context,
        integrationId: requiredStatusCheck.integrationId,
        deletedAfterReadback: ruleset.deletedAfterReadback,
        absentAfterDelete: ruleset.absentAfterDelete
      }
    },
    failures
  };
  return result;
}

export function inspectFg4DeveloperCannotSatisfyOrganizationReadback(recording: unknown) {
  const failures: string[] = [];
  const record = readRecord(recording);
  const config = readRecord(record.config);
  const evidence = readRecord(record.evidence);
  const policy = readRecord(evidence.policy);
  const developerReview = readRecord(evidence.developerReview);
  const organizationRunner = readRecord(evidence.organizationRunner);
  const ruleset = readRecord(evidence.ruleset);
  const serialized = JSON.stringify(recording);

  if (record.schemaVersion !== "archcontext.fg4-developer-cannot-satisfy-organization-readback/v1") failures.push("schemaVersion mismatch");
  if (record.environment !== "staging") failures.push("environment must be staging");
  if (record.status !== "verified" || record.ok !== true) failures.push("record must be verified");
  if (policy.requiredTrust !== "organization") failures.push("policy.requiredTrust must be organization");
  if (policy.developerTrustSatisfiesOrganization !== false) failures.push("Developer trust must not satisfy Organization policy");
  if (policy.developerAttestationAcceptedForOrganization !== false) failures.push("Developer Attestation must be rejected for Organization policy");
  if (policy.rejectionReasonCode !== "TRUST_LEVEL_MISMATCH") failures.push("Developer Attestation rejection must be TRUST_LEVEL_MISMATCH");
  if (developerReview.checkName !== DEVELOPER_REVIEW_CHECK_NAME) failures.push("Developer Check name mismatch");
  if (developerReview.conclusion !== "success") failures.push("Developer Check must be success");
  if (developerReview.outputTitle !== "Developer-attested") failures.push("Developer Check title mismatch");
  if (organizationRunner.checkName !== ORGANIZATION_RUNNER_CHECK_NAME) failures.push("Organization Check name mismatch");
  if (organizationRunner.conclusion !== "failure") failures.push("Organization Check must remain failure");
  if (organizationRunner.outputTitle !== "Attestation required") failures.push("Organization Check title mismatch");
  if (organizationRunner.requiredSummary !== true) failures.push("Organization Check must explain Organization Attestation requirement");
  if (organizationRunner.trustMismatchSummary !== true) failures.push("Organization Check must include trust mismatch summary");
  if (developerReview.headSha !== organizationRunner.headSha) failures.push("Developer and Organization checks must target the same head");
  if (developerReview.checkRunId === organizationRunner.checkRunId) failures.push("Developer and Organization checks must be distinct CheckRuns");
  if (ruleset.enforcement !== "active") failures.push("ruleset enforcement must be active");
  if (ruleset.target !== "branch") failures.push("ruleset target must be branch");
  if (ruleset.requiredContext !== ORGANIZATION_RUNNER_CHECK_NAME) failures.push("ruleset required context must be Organization Runner");
  if (ruleset.integrationId !== Number(config.appId)) failures.push("ruleset integrationId must match staging App ID");
  if (ruleset.deletedAfterReadback !== true) failures.push("temporary ruleset must be deleted");
  if (ruleset.absentAfterDelete !== true) failures.push("temporary ruleset must be absent after delete");
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/runs\/\d+$/.test(stringValue(developerReview.checkRunUrl))) failures.push("Developer Check URL must be a GitHub run URL");
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/runs\/\d+$/.test(stringValue(organizationRunner.checkRunUrl))) failures.push("Organization Check URL must be a GitHub run URL");
  for (const forbidden of [/gh[opsu]_[A-Za-z0-9_]+/, /Bearer\s+/i, /-----BEGIN/i, /private[_-]?key/i, /GITHUB_WEBHOOK_SECRET/i, /installation[_-]?token/i, /jwt/i]) {
    if (forbidden.test(serialized)) failures.push(`recording contains forbidden secret marker: ${forbidden}`);
  }
  return { ok: failures.length === 0, failures };
}

function inspectSource(source: unknown) {
  const failures: string[] = [];
  const record = readRecord(source);
  const evidence = readRecord(record.evidence);
  const policy = readRecord(evidence.policy);
  const developerReview = readRecord(evidence.developerReview);
  const organizationRunner = readRecord(evidence.organizationRunner);
  const ruleset = readRecord(evidence.ruleset);
  const requiredStatusCheck = readRecord(ruleset.requiredStatusCheck);
  const config = readRecord(record.config);
  const serialized = JSON.stringify(source);

  if (record.schemaVersion !== "archcontext.fg3-required-trust-staging-readback/v1") failures.push("source schemaVersion mismatch");
  if (record.environment !== "staging") failures.push("source environment must be staging");
  if (record.status !== "verified" || record.ok !== true) failures.push("source must be verified");
  if (policy.requiredTrust !== "organization") failures.push("source requiredTrust must be organization");
  if (policy.developerTrustSatisfiesOrganization !== false) failures.push("source Developer trust must not satisfy Organization policy");
  const verification = readRecord(policy.developerAttestationVerification);
  if (verification.accepted !== false) failures.push("source Developer Attestation must be rejected");
  if (verification.reasonCode !== "TRUST_LEVEL_MISMATCH") failures.push("source rejection must be TRUST_LEVEL_MISMATCH");
  if (developerReview.checkName !== DEVELOPER_REVIEW_CHECK_NAME || developerReview.conclusion !== "success") failures.push("source Developer Check must be success");
  if (organizationRunner.checkName !== ORGANIZATION_RUNNER_CHECK_NAME || organizationRunner.conclusion !== "failure") failures.push("source Organization Check must remain failure");
  if (requiredStatusCheck.context !== ORGANIZATION_RUNNER_CHECK_NAME) failures.push("source ruleset must require Organization Runner");
  if (requiredStatusCheck.integrationId !== Number(config.appId)) failures.push("source ruleset integrationId must match App ID");
  if (ruleset.enforcement !== "active" || ruleset.target !== "branch") failures.push("source ruleset must be active branch rule");
  if (ruleset.deletedAfterReadback !== true || ruleset.absentAfterDelete !== true) failures.push("source temporary ruleset cleanup missing");
  if (developerReview.checkRunId === organizationRunner.checkRunId) failures.push("source CheckRuns must be distinct");
  if (developerReview.headSha !== organizationRunner.headSha) failures.push("source CheckRuns must share head");
  for (const forbidden of [/gh[opsu]_[A-Za-z0-9_]+/, /Bearer\s+/i, /-----BEGIN/i, /private[_-]?key/i, /GITHUB_WEBHOOK_SECRET/i, /installation[_-]?token/i, /jwt/i]) {
    if (forbidden.test(serialized)) failures.push(`source contains forbidden secret marker: ${forbidden}`);
  }
  return { ok: failures.length === 0, failures };
}

function renderHuman(result: ReturnType<typeof buildFg4DeveloperCannotSatisfyOrganizationReadback>): string {
  return [
    `[fg4-developer-cannot-satisfy-organization-readback] ${result.ok ? "OK" : "FAILED"}`,
    `- developer: ${result.evidence.developerReview.checkName} ${result.evidence.developerReview.conclusion}`,
    `- organization: ${result.evidence.organizationRunner.checkName} ${result.evidence.organizationRunner.conclusion}`,
    `- required context: ${result.evidence.ruleset.requiredContext}`,
    ...result.failures.map((failure) => `- ${failure}`)
  ].join("\n");
}

function renderInspectHuman(result: ReturnType<typeof inspectFg4DeveloperCannotSatisfyOrganizationReadback>): string {
  if (result.ok) return "[fg4-developer-cannot-satisfy-organization-readback] OK";
  return ["[fg4-developer-cannot-satisfy-organization-readback] FAILED", ...result.failures.map((failure) => `- ${failure}`)].join("\n");
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
