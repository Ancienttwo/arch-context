#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_RECORDING = "docs/verification/fg2-egress-recording.json";
const ALLOWED_CATEGORIES = new Set(["github.pull-head", "github.check-list-for-ref", "github.check-create", "github.check-update"]);
const FORBIDDEN_ENDPOINT_KEYS = ["prFiles", "contents", "blob", "tree"];
const FORBIDDEN_MEDIA_TYPE_KEYS = ["diff", "patch"];
const BAIT_SURFACE_KEYS = ["log", "trace", "queue"];

if (import.meta.main) {
  const [command = "readback", ...args] = process.argv.slice(2);
  if (command !== "readback") {
    console.error("[github-egress-recording-readback] usage: readback [--recording path] [--allow-pending]");
    process.exit(2);
  }
  const result = await readbackGitHubEgressRecording({
    recordingPath: readFlag(args, "--recording") ?? DEFAULT_RECORDING,
    allowPending: args.includes("--allow-pending")
  });
  if (!result.ok) {
    console.error("[github-egress-recording-readback] FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    for (const blocker of result.blockers) console.error(`- ${blocker}`);
    process.exit(1);
  }
  const status = result.pending ? "PENDING" : "OK";
  const requests = result.totalRequests === undefined ? "unavailable" : String(result.totalRequests);
  console.log(`[github-egress-recording-readback] ${status} totalRequests=${requests}`);
}

export async function readbackGitHubEgressRecording({
  recordingPath = DEFAULT_RECORDING,
  root = process.cwd(),
  allowPending = false
} = {}) {
  const recording = JSON.parse(await readFile(resolve(root, recordingPath), "utf8"));
  return inspectGitHubEgressRecording(recording, { allowPending });
}

export function inspectGitHubEgressRecording(recording, { allowPending = false } = {}) {
  const failures = [];
  const blockers = [];
  if (!recording || typeof recording !== "object") {
    return { ok: false, pending: false, failures: ["recording must be an object"], blockers };
  }
  if (recording.schemaVersion !== "archcontext.github-egress-recording/v1") {
    failures.push("schemaVersion must be archcontext.github-egress-recording/v1");
  }
  if (recording.environment !== "staging") failures.push("environment must be staging");
  if (recording.status === "pending") {
    blockers.push(recording.reason ?? "staging GitHub egress recording is pending");
    return { ok: allowPending && failures.length === 0, pending: true, failures, blockers };
  }
  if (recording.status !== "verified") failures.push("status must be pending or verified");

  const payload = recording.recording;
  if (!payload || typeof payload !== "object") {
    failures.push("verified recording requires recording object");
    return { ok: false, pending: false, failures, blockers };
  }

  const totalRequests = payload.githubEgress?.totalRequests;
  if (!Number.isInteger(totalRequests) || totalRequests <= 0) {
    failures.push("githubEgress.totalRequests must be a positive integer");
  }
  for (const category of Object.keys(payload.githubEgress?.categories ?? {})) {
    if (!ALLOWED_CATEGORIES.has(category)) failures.push(`unexpected GitHub egress category: ${category}`);
  }
  requireZeroCounts(payload.forbiddenEndpointCounts, FORBIDDEN_ENDPOINT_KEYS, "forbiddenEndpointCounts", failures);
  requireZeroCounts(payload.forbiddenMediaTypeCounts, FORBIDDEN_MEDIA_TYPE_KEYS, "forbiddenMediaTypeCounts", failures);
  requireZeroCounts(payload.baitHits, BAIT_SURFACE_KEYS, "baitHits", failures);

  return { ok: failures.length === 0, pending: false, totalRequests, failures, blockers };
}

function requireZeroCounts(value, keys, label, failures) {
  if (!value || typeof value !== "object") {
    failures.push(`${label} must be an object`);
    return;
  }
  for (const key of keys) {
    if (value[key] !== 0) failures.push(`${label}.${key} must be 0`);
  }
}

function readFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
