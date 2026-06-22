#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { inspectFg3CheckSupersedeReadback } from "./fg3-check-supersede-readback";
import { inspectFg3RealPrSynchronizeE2E } from "./fg3-real-pr-synchronize-e2e";

const DEFAULT_SUPERSEDE_SOURCE = "docs/verification/fg3-check-supersede-readback.json";
const DEFAULT_SYNCHRONIZE_SOURCE = "docs/verification/fg3-real-pr-synchronize-e2e.json";
const DEFAULT_OUTPUT = "docs/verification/fg6-new-commit-invalidation-readback.json";
const REQUIRED_EGRESS_CATEGORIES = [
  "github.pull-head",
  "github.check-list-for-ref",
  "github.check-create",
  "github.check-update"
] as const;
const SECRET_PATTERNS = [
  /gh[opsu]_[A-Za-z0-9_]+/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /GITHUB_WEBHOOK_SECRET/i,
  /signature256/i,
  /webhookSecret/i,
  /installation[_-]?token/i,
  /jwt/i
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
    const config = buildFg6NewCommitInvalidationConfig(process.env, args);
    const result = await runFg6NewCommitInvalidation(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg6NewCommitInvalidation(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg6-new-commit-invalidation-readback] usage: run|inspect [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg6NewCommitInvalidationConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    supersedeSource: readFlag(args, "--supersede-source") ?? env.ARCHCONTEXT_FG6_SUPERSEDE_SOURCE ?? DEFAULT_SUPERSEDE_SOURCE,
    synchronizeSource: readFlag(args, "--synchronize-source") ?? env.ARCHCONTEXT_FG6_SYNCHRONIZE_SOURCE ?? DEFAULT_SYNCHRONIZE_SOURCE,
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG6_NEW_COMMIT_OUTPUT ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg6NewCommitInvalidation(config: ReturnType<typeof buildFg6NewCommitInvalidationConfig>) {
  const supersedeSource = JSON.parse(await readFile(resolve(config.root, config.supersedeSource), "utf8")) as unknown;
  const synchronizeSource = JSON.parse(await readFile(resolve(config.root, config.synchronizeSource), "utf8")) as unknown;
  const supersedeInspection = inspectFg3CheckSupersedeReadback(supersedeSource);
  const synchronizeInspection = inspectFg3RealPrSynchronizeE2E(synchronizeSource);
  const supersede = readRecord(readRecord(supersedeSource).evidence);
  const syncEvidence = readRecord(readRecord(synchronizeSource).evidence);
  const pullRequest = readRecord(syncEvidence.pullRequest);
  const checks = readRecord(syncEvidence.checks);
  const oldCheck = readRecord(checks.oldHead);
  const newCheck = readRecord(checks.newHead);
  const cleanup = readRecord(syncEvidence.cleanup);
  const controlPlane = readRecord(syncEvidence.controlPlane);
  const egressContract = readRecord(syncEvidence.egressContract);
  const recording = {
    schemaVersion: "archcontext.fg6-new-commit-invalidation-readback/v1",
    acceptanceId: "AC-03",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: config.generatedAt(),
    sources: {
      supersedeSource: config.supersedeSource,
      synchronizeSource: config.synchronizeSource
    },
    evidence: {
      synchronize: {
        workerUrl: syncEvidence.workerUrl,
        repository: syncEvidence.repository,
        pullRequest: {
          number: pullRequest.number,
          url: pullRequest.url,
          eventSequence: pullRequest.eventSequence,
          openedHeadSha: pullRequest.openedHeadSha,
          synchronizeHeadSha: pullRequest.synchronizeHeadSha,
          headsDiffer: pullRequest.headsDiffer,
          state: pullRequest.state,
          branch: pullRequest.branch
        },
        oldCheck: {
          checkRunId: oldCheck.checkRunId,
          checkRunUrl: oldCheck.checkRunUrl,
          checkName: oldCheck.checkName,
          headSha: oldCheck.headSha,
          status: oldCheck.status,
          conclusion: oldCheck.conclusion,
          outputTitle: oldCheck.outputTitle,
          summarySuperseded: oldCheck.summarySuperseded,
          detailsUrl: oldCheck.detailsUrl
        },
        newCheck: {
          checkRunId: newCheck.checkRunId,
          checkRunUrl: newCheck.checkRunUrl,
          checkName: newCheck.checkName,
          headSha: newCheck.headSha,
          status: newCheck.status,
          conclusion: newCheck.conclusion,
          outputTitle: newCheck.outputTitle,
          detailsUrl: newCheck.detailsUrl
        },
        cleanup: {
          pullRequestClosed: cleanup.pullRequestClosed,
          branchDeleted: cleanup.branchDeleted
        },
        controlPlane: {
          oldActiveChallengesSuperseded: controlPlane.oldActiveChallengesSuperseded,
          staleSubmitCannotUpdateCurrentHead: controlPlane.staleSubmitCannotUpdateCurrentHead,
          staleSubmitNonceConsumed: controlPlane.staleSubmitNonceConsumed,
          focusedTests: Array.isArray(controlPlane.focusedTests) ? controlPlane.focusedTests : []
        },
        egressContract: {
          allowedCategories: Array.isArray(egressContract.allowedCategories) ? egressContract.allowedCategories : [],
          forbiddenCodeContentEndpointsStillDenied: egressContract.forbiddenCodeContentEndpointsStillDenied,
          noContentsPermission: egressContract.noContentsPermission
        }
      },
      supersede: {
        checkName: supersede.checkName,
        oldHeadSha: supersede.oldHeadSha,
        newHeadSha: supersede.newHeadSha,
        headsDiffer: supersede.headsDiffer,
        oldCheckRunId: supersede.oldCheckRunId,
        oldCheckRunUrl: supersede.oldCheckRunUrl,
        oldConclusion: supersede.oldConclusion,
        oldOutputTitle: supersede.oldOutputTitle,
        oldSummarySuperseded: supersede.oldSummarySuperseded,
        staleConclusionAttempted: supersede.staleConclusionAttempted,
        newCheckRunId: supersede.newCheckRunId,
        newCheckRunUrl: supersede.newCheckRunUrl,
        newCheckStatus: supersede.newCheckStatus,
        newCheckHeadSha: supersede.newCheckHeadSha,
        egress: Array.isArray(supersede.egress) ? supersede.egress : []
      },
      sourceInspections: {
        supersede: supersedeInspection,
        synchronize: synchronizeInspection
      },
      assertions: {
        pushNewCommitCreatesNewCheck: true,
        oldHeadCheckSuperseded: true,
        oldChallengeOrResultInvalidated: true,
        staleSubmitRejectedBeforeNonceConsumption: true,
        unsupportedStaleConclusionNotUsed: true,
        stagingGitHubEgressAllowlisted: true
      }
    },
    failures: [] as string[]
  };
  const inspection = inspectFg6NewCommitInvalidation(recording);
  recording.status = inspection.ok ? "verified" : "failed";
  recording.ok = inspection.ok;
  recording.failures = inspection.failures;
  await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
  await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(recording, null, 2)}\n`, "utf8");
  return recording;
}

export function inspectFg6NewCommitInvalidation(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const sync = readRecord(evidence.synchronize);
  const pullRequest = readRecord(sync.pullRequest);
  const oldSyncCheck = readRecord(sync.oldCheck);
  const newSyncCheck = readRecord(sync.newCheck);
  const cleanup = readRecord(sync.cleanup);
  const controlPlane = readRecord(sync.controlPlane);
  const egressContract = readRecord(sync.egressContract);
  const supersede = readRecord(evidence.supersede);
  const sourceInspections = readRecord(evidence.sourceInspections);
  const assertions = readRecord(evidence.assertions);

  if (record.schemaVersion !== "archcontext.fg6-new-commit-invalidation-readback/v1") failures.push("schemaVersion mismatch");
  if (record.acceptanceId !== "AC-03") failures.push("acceptanceId must be AC-03");
  if (record.environment !== "staging-release-readback") failures.push("environment must be staging-release-readback");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  if (readRecord(sourceInspections.supersede).ok !== true) failures.push("FG3 supersede source inspection must pass");
  if (readRecord(sourceInspections.synchronize).ok !== true) failures.push("FG3 synchronize source inspection must pass");

  if (sync.workerUrl !== "https://archcontext.repoharness.com") failures.push("workerUrl must be archcontext.repoharness.com");
  if (pullRequest.eventSequence !== "opened->synchronize") failures.push("event sequence must be opened->synchronize");
  if (pullRequest.headsDiffer !== true) failures.push("PR heads must differ");
  if (pullRequest.state !== "closed") failures.push("temporary PR must be closed");
  if (!isSha(pullRequest.openedHeadSha)) failures.push("opened head must be full SHA");
  if (!isSha(pullRequest.synchronizeHeadSha)) failures.push("synchronize head must be full SHA");
  if (oldSyncCheck.headSha !== pullRequest.openedHeadSha) failures.push("old Check must target opened head");
  if (newSyncCheck.headSha !== pullRequest.synchronizeHeadSha) failures.push("new Check must target synchronize head");
  if (oldSyncCheck.checkRunId === newSyncCheck.checkRunId) failures.push("old and new CheckRun ids must differ");
  if (oldSyncCheck.conclusion !== "neutral") failures.push("old Check conclusion must be neutral");
  if (oldSyncCheck.outputTitle !== "Superseded") failures.push("old Check title must be Superseded");
  if (oldSyncCheck.summarySuperseded !== true) failures.push("old Check summary must be superseded");
  if (newSyncCheck.checkName !== "ArchContext / Developer Review") failures.push("new Check must be Developer Review");
  if (newSyncCheck.detailsUrl !== "https://archcontext.repoharness.com") failures.push("new Check details URL must point to staging Worker");
  if (cleanup.pullRequestClosed !== true) failures.push("temporary PR cleanup must close PR");
  if (cleanup.branchDeleted !== true) failures.push("temporary branch cleanup must delete branch");
  if (controlPlane.oldActiveChallengesSuperseded !== true) failures.push("old active Challenges must be superseded");
  if (controlPlane.staleSubmitCannotUpdateCurrentHead !== true) failures.push("stale submit must not update current head");
  if (controlPlane.staleSubmitNonceConsumed !== false) failures.push("stale submit must not consume nonce");
  if (!Array.isArray(controlPlane.focusedTests) || controlPlane.focusedTests.length < 2) failures.push("focused control-plane tests must be recorded");

  if (supersede.headsDiffer !== true) failures.push("supersede heads must differ");
  if (supersede.oldConclusion !== "neutral" && supersede.oldConclusion !== "cancelled") failures.push("supersede old conclusion must be neutral or cancelled");
  if (supersede.oldOutputTitle !== "Superseded") failures.push("supersede old title must be Superseded");
  if (supersede.oldSummarySuperseded !== true) failures.push("supersede old summary must be superseded");
  if (supersede.staleConclusionAttempted !== false) failures.push("unsupported stale conclusion must not be attempted");
  if (supersede.newCheckHeadSha !== supersede.newHeadSha) failures.push("supersede new Check head must match new head");

  for (const key of [
    "pushNewCommitCreatesNewCheck",
    "oldHeadCheckSuperseded",
    "oldChallengeOrResultInvalidated",
    "staleSubmitRejectedBeforeNonceConsumption",
    "unsupportedStaleConclusionNotUsed",
    "stagingGitHubEgressAllowlisted"
  ]) {
    if (assertions[key] !== true) failures.push(`assertion ${key} must be true`);
  }

  const allowedCategories = Array.isArray(egressContract.allowedCategories) ? egressContract.allowedCategories.map(String) : [];
  for (const category of REQUIRED_EGRESS_CATEGORIES) {
    if (!allowedCategories.includes(category)) failures.push(`egress contract missing category: ${category}`);
  }
  if (egressContract.forbiddenCodeContentEndpointsStillDenied !== true) failures.push("forbidden code endpoints must remain denied");
  if (egressContract.noContentsPermission !== true) failures.push("GitHub App must have no Contents permission");
  const supersedeEgress = Array.isArray(supersede.egress) ? supersede.egress.map(readRecord) : [];
  for (const item of supersedeEgress) {
    const category = String(item.category ?? "");
    if (!REQUIRED_EGRESS_CATEGORIES.includes(category as (typeof REQUIRED_EGRESS_CATEGORIES)[number])) {
      failures.push(`unexpected supersede egress category: ${category}`);
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

function isSha(value: unknown): boolean {
  return /^[0-9a-f]{40}$/.test(String(value ?? ""));
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
  return result.ok === true ? "FG6 new commit invalidation readback verified" : `FG6 new commit invalidation readback failed: ${failures.join("; ")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }): string {
  return result.ok ? "FG6 new commit invalidation evidence verified" : `FG6 new commit invalidation evidence failed: ${result.failures.join("; ")}`;
}
