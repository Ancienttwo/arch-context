#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DEVELOPER_REVIEW_CHECK_NAME } from "@archcontext/contracts";

const DEFAULT_EVIDENCE = "docs/verification/fg3-real-pr-synchronize-e2e.json";
const SUPERSEDED_TEXT = "Superseded by a newer PR head";

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command !== "inspect") {
    console.error("[fg3-real-pr-synchronize-e2e] usage: inspect [--evidence path] [--json]");
    process.exit(2);
  }
  const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_EVIDENCE;
  const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
  const result = inspectFg3RealPrSynchronizeE2E(recording);
  process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
  if (!result.ok) process.exit(1);
}

export function inspectFg3RealPrSynchronizeE2E(recording: unknown) {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const pullRequest = readRecord(evidence.pullRequest);
  const checks = readRecord(evidence.checks);
  const oldCheck = readRecord(checks.oldHead);
  const newCheck = readRecord(checks.newHead);
  const cleanup = readRecord(evidence.cleanup);
  const controlPlane = readRecord(evidence.controlPlane);
  const serialized = JSON.stringify(recording);

  if (record.schemaVersion !== "archcontext.fg3-real-pr-synchronize-e2e/v1") {
    failures.push("schemaVersion must be archcontext.fg3-real-pr-synchronize-e2e/v1");
  }
  if (record.environment !== "staging") failures.push("environment must be staging");
  if (record.status !== "verified") failures.push("status must be verified");
  if (record.ok !== true) failures.push("ok must be true");
  if (evidence.workerUrl !== "https://archcontext.repoharness.com") failures.push("workerUrl must be archcontext.repoharness.com");
  if (pullRequest.eventSequence !== "opened->synchronize") failures.push("pullRequest.eventSequence must be opened->synchronize");
  if (pullRequest.state !== "closed") failures.push("temporary PR must be closed");
  if (pullRequest.headsDiffer !== true) failures.push("pullRequest.headsDiffer must be true");
  if (cleanup.branchDeleted !== true) failures.push("temporary branch must be deleted");
  if (oldCheck.checkName !== DEVELOPER_REVIEW_CHECK_NAME) failures.push("old check name must be Developer Review");
  if (newCheck.checkName !== DEVELOPER_REVIEW_CHECK_NAME) failures.push("new check name must be Developer Review");
  if (oldCheck.headSha !== pullRequest.openedHeadSha) failures.push("old check head must match opened head");
  if (newCheck.headSha !== pullRequest.synchronizeHeadSha) failures.push("new check head must match synchronize head");
  if (oldCheck.checkRunId === newCheck.checkRunId) failures.push("old and new check run ids must differ");
  if (oldCheck.conclusion !== "neutral") failures.push("old check conclusion must be neutral");
  if (oldCheck.outputTitle !== "Superseded") failures.push("old check title must be Superseded");
  if (oldCheck.summarySuperseded !== true) failures.push("old check summary must be superseded");
  if (!String(oldCheck.summaryPreview ?? "").includes(SUPERSEDED_TEXT)) failures.push("old check summary preview must include superseded text");
  if (newCheck.status !== "completed") failures.push("new check status must be completed");
  if (newCheck.detailsUrl !== "https://archcontext.repoharness.com") failures.push("new check details URL must point to staging Worker");
  if (controlPlane.oldActiveChallengesSuperseded !== true) failures.push("controlPlane.oldActiveChallengesSuperseded must be true");
  if (controlPlane.staleSubmitCannotUpdateCurrentHead !== true) failures.push("controlPlane.staleSubmitCannotUpdateCurrentHead must be true");
  if (controlPlane.staleSubmitNonceConsumed !== false) failures.push("controlPlane.staleSubmitNonceConsumed must be false");
  if (!Array.isArray(controlPlane.focusedTests) || controlPlane.focusedTests.length < 2) failures.push("controlPlane.focusedTests must name supersede and stale-submit tests");

  for (const forbidden of [/gh[opsu]_[A-Za-z0-9_]+/, /Bearer\s+/i, /-----BEGIN/i, /private[_-]?key/i, /GITHUB_WEBHOOK_SECRET/i, /signature256/i, /webhookSecret/i]) {
    if (forbidden.test(serialized)) failures.push(`recording contains forbidden secret marker: ${forbidden}`);
  }

  return { ok: failures.length === 0, failures };
}

function renderHuman(result: ReturnType<typeof inspectFg3RealPrSynchronizeE2E>): string {
  if (result.ok) return "[fg3-real-pr-synchronize-e2e] OK";
  return ["[fg3-real-pr-synchronize-e2e] FAILED", ...result.failures.map((failure) => `- ${failure}`)].join("\n");
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
