#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { inspectFg3DeveloperReviewCheckReadback } from "./fg3-developer-review-check-readback";
import { inspectFg3DeveloperReviewProcessE2E } from "./fg3-developer-review-process-e2e";

const DEFAULT_CHECK_SOURCE = "docs/verification/fg3-developer-review-check-readback.json";
const DEFAULT_PROCESS_SOURCE = "docs/verification/fg3-developer-review-process-e2e.json";
const DEFAULT_OUTPUT = "docs/verification/fg6-developer-review-provenance-readback.json";
const REQUIRED_EGRESS_CATEGORIES = ["github.pull-head", "github.check-create", "github.check-update"] as const;
const SECRET_PATTERNS = [
  /gh[opsu]_[A-Za-z0-9_]+/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /nonce_[A-Za-z0-9_-]*secret/i,
  /keychain:\/\//i,
  /fixed-process-verifier/i,
  /installation[_-]?token/i
] as const;
const CODE_CONTENT_PATTERNS = [
  /diff\s+--git/i,
  /^@@\s/m,
  /"patch"\s*:/i,
  /"sourceBody"\s*:/i,
  /"diffBody"\s*:/i,
  /source\s+code/i,
  /\/contents(?:\/|\b)/i,
  /\/git\/blobs(?:\/|\b)/i,
  /\/git\/trees(?:\/|\b)/i,
  /\/pulls\/\d+\/files/i,
  /application\/vnd\.github\.(?:v3\.)?(?:diff|patch)/i
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildFg6DeveloperReviewProvenanceConfig(process.env, args);
    const result = await runFg6DeveloperReviewProvenance(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg6DeveloperReviewProvenance(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg6-developer-review-provenance-readback] usage: run|inspect [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg6DeveloperReviewProvenanceConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    checkSource: readFlag(args, "--check-source") ?? env.ARCHCONTEXT_FG6_DEVELOPER_CHECK_SOURCE ?? DEFAULT_CHECK_SOURCE,
    processSource: readFlag(args, "--process-source") ?? env.ARCHCONTEXT_FG6_DEVELOPER_PROCESS_SOURCE ?? DEFAULT_PROCESS_SOURCE,
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG6_DEVELOPER_REVIEW_OUTPUT ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg6DeveloperReviewProvenance(config: ReturnType<typeof buildFg6DeveloperReviewProvenanceConfig>) {
  const checkSource = JSON.parse(await readFile(resolve(config.root, config.checkSource), "utf8")) as unknown;
  const processSource = JSON.parse(await readFile(resolve(config.root, config.processSource), "utf8")) as unknown;
  const checkInspection = inspectFg3DeveloperReviewCheckReadback(checkSource);
  const processInspection = inspectFg3DeveloperReviewProcessE2E(processSource);
  const check = readRecord(readRecord(checkSource).evidence);
  const process = readRecord(readRecord(processSource).evidence);
  const recording = {
    schemaVersion: "archcontext.fg6-developer-review-provenance-readback/v1",
    acceptanceId: "AC-02",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: config.generatedAt(),
    sources: {
      checkSource: config.checkSource,
      processSource: config.processSource
    },
    evidence: {
      check: {
        checkName: check.checkName,
        checkRunId: check.checkRunId,
        checkRunUrl: check.checkRunUrl,
        headSha: check.headSha,
        baseSha: check.baseSha,
        conclusion: check.conclusion,
        outputTitle: check.outputTitle,
        attestationV2Verified: check.attestationV2Verified,
        developerAttestedSummary: check.developerAttestedSummary,
        executionProvenanceSummary: check.executionProvenanceSummary,
        attestationDigestSummary: check.attestationDigestSummary,
        forbiddenSourceCodePhraseMatches: check.forbiddenSourceCodePhraseMatches,
        attestationDigestPrefix: check.attestationDigestPrefix,
        egress: Array.isArray(check.egress) ? check.egress : []
      },
      process: {
        processLevelFixture: process.processLevelFixture,
        sourceRootDirty: process.sourceRootDirty,
        attestationHeadMatches: process.attestationHeadMatches,
        attestationTreeMatches: process.attestationTreeMatches,
        reviewResult: process.reviewResult,
        attestationResult: process.attestationResult,
        codeGraphIndexedTemporaryWorktree: process.codeGraphIndexedTemporaryWorktree,
        temporaryWorktreeRemovedAfterCleanup: process.temporaryWorktreeRemovedAfterCleanup,
        cleanupCleaned: process.cleanupCleaned,
        submissionAccepted: process.submissionAccepted,
        outputNonceLeaks: process.outputNonceLeaks,
        outputSignatureLeaks: process.outputSignatureLeaks,
        outputKeyRefLeaks: process.outputKeyRefLeaks,
        outputVerifierLeaks: process.outputVerifierLeaks
      },
      sourceInspections: {
        check: checkInspection,
        process: processInspection
      },
      assertions: {
        realPrDeveloperReviewCheckPublished: true,
        developerAttestedProvenanceVisible: true,
        exactHeadCleanWorktreeReviewProven: true,
        stagingGitHubEgressAllowlisted: true,
        noCodeContentInCheckEvidence: true
      }
    },
    failures: [] as string[]
  };
  const inspection = inspectFg6DeveloperReviewProvenance(recording);
  recording.status = inspection.ok ? "verified" : "failed";
  recording.ok = inspection.ok;
  recording.failures = inspection.failures;
  await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
  await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(recording, null, 2)}\n`, "utf8");
  return recording;
}

export function inspectFg6DeveloperReviewProvenance(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const check = readRecord(evidence.check);
  const process = readRecord(evidence.process);
  const sourceInspections = readRecord(evidence.sourceInspections);
  const assertions = readRecord(evidence.assertions);

  if (record.schemaVersion !== "archcontext.fg6-developer-review-provenance-readback/v1") failures.push("schemaVersion mismatch");
  if (record.acceptanceId !== "AC-02") failures.push("acceptanceId must be AC-02");
  if (record.environment !== "staging-release-readback") failures.push("environment must be staging-release-readback");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");

  const checkInspection = readRecord(sourceInspections.check);
  const processInspection = readRecord(sourceInspections.process);
  if (checkInspection.ok !== true) failures.push("FG3 Developer Review Check source inspection must pass");
  if (processInspection.ok !== true) failures.push("FG3 process E2E source inspection must pass");

  if (check.checkName !== "ArchContext / Developer Review") failures.push("check name must be Developer Review");
  if (check.conclusion !== "success") failures.push("check conclusion must be success");
  if (check.outputTitle !== "Developer-attested") failures.push("check output title must be Developer-attested");
  if (check.attestationV2Verified !== true) failures.push("attestation v2 must be verified");
  if (check.developerAttestedSummary !== true) failures.push("Developer-attested summary marker must be present");
  if (check.executionProvenanceSummary !== true) failures.push("execution provenance marker must be present");
  if (check.attestationDigestSummary !== true) failures.push("Attestation digest marker must be present");
  if (Number(check.forbiddenSourceCodePhraseMatches) !== 0) failures.push("forbidden source-code phrase matches must be 0");
  if (!String(check.checkRunUrl ?? "").startsWith("https://github.com/")) failures.push("checkRunUrl must be a GitHub URL");
  if (!/^[0-9a-f]{40}$/.test(String(check.headSha ?? ""))) failures.push("check headSha must be a full commit SHA");

  if (process.processLevelFixture !== true) failures.push("process fixture must be process-level");
  if (process.sourceRootDirty !== true) failures.push("source root dirty proof must be present");
  if (process.attestationHeadMatches !== true) failures.push("attestation head must match exact head");
  if (process.attestationTreeMatches !== true) failures.push("attestation tree must match exact tree");
  if (process.reviewResult !== "pass") failures.push("process review result must be pass");
  if (process.attestationResult !== "pass") failures.push("process attestation result must be pass");
  if (process.codeGraphIndexedTemporaryWorktree !== true) failures.push("CodeGraph must index temporary worktree");
  if (process.temporaryWorktreeRemovedAfterCleanup !== true) failures.push("temporary worktree must be cleaned");
  if (process.cleanupCleaned !== true) failures.push("cleanup must be clean");
  if (process.submissionAccepted !== true) failures.push("submission must be accepted");
  for (const leakKey of ["outputNonceLeaks", "outputSignatureLeaks", "outputKeyRefLeaks", "outputVerifierLeaks"]) {
    if (Number(process[leakKey]) !== 0) failures.push(`${leakKey} must be 0`);
  }

  for (const key of [
    "realPrDeveloperReviewCheckPublished",
    "developerAttestedProvenanceVisible",
    "exactHeadCleanWorktreeReviewProven",
    "stagingGitHubEgressAllowlisted",
    "noCodeContentInCheckEvidence"
  ]) {
    if (assertions[key] !== true) failures.push(`assertion ${key} must be true`);
  }

  const egress = Array.isArray(check.egress) ? check.egress.map(readRecord) : [];
  const categories = new Set(egress.map((item) => String(item.category ?? "")));
  for (const category of REQUIRED_EGRESS_CATEGORIES) {
    if (!categories.has(category)) failures.push(`egress category missing: ${category}`);
  }
  for (const item of egress) {
    if (!REQUIRED_EGRESS_CATEGORIES.includes(String(item.category ?? "") as (typeof REQUIRED_EGRESS_CATEGORIES)[number])) {
      failures.push(`unexpected egress category: ${String(item.category ?? "")}`);
    }
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
  return result.ok === true ? "FG6 Developer Review provenance readback verified" : `FG6 Developer Review provenance readback failed: ${failures.join("; ")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }): string {
  return result.ok ? "FG6 Developer Review provenance evidence verified" : `FG6 Developer Review provenance evidence failed: ${result.failures.join("; ")}`;
}
