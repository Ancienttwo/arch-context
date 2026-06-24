#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { auditPacketCapture } from "./privacy-capture-lib.mjs";

const DEFAULT_EVIDENCE = "docs/verification/practice-hook-egress-readback.json";
const PACKET_SCHEMA_VERSION = "archcontext.practice-hook-egress-readback/v1";
const EGRESS_CAPTURE_SCHEMA_VERSION = "archcontext.local-egress-capture/v1";
const ENVELOPE_SCHEMA_VERSION = "archcontext.envelope/v1";
const CHECKPOINT_SCHEMA_VERSION = "archcontext.practice-checkpoint/v1";
const FAIL_OPEN_SCHEMA_VERSION = "archcontext.hook-checkpoint-fail-open/v1";
const HOOK_LOG_SCHEMA_VERSION = "archcontext.hook-log/v1";
const HOOK_ADAPTER_SCHEMA_VERSION = "archcontext.hook-adapter/v1";

const RAW_CHANGED_PATH_PATTERNS = [
  /\bsrc\/[A-Za-z0-9._/-]+/,
  /\bpackages\/[A-Za-z0-9._/-]+/,
  /\bapps\/[A-Za-z0-9._/-]+/,
  /\bservices\/[A-Za-z0-9._/-]+/,
  /\/Users\/[^/\s]+\/Projects\//
];

const NETWORK_PATTERNS = [
  /https?:\/\//i,
  /\bfetch\s*\(/i,
  /\bXMLHttpRequest\b/i
];

if (import.meta.main) {
  const [command = "readback", ...args] = process.argv.slice(2);
  if (!["inspect", "readback"].includes(command)) {
    console.error("[practice-hook-egress-readback] usage: readback|inspect [--evidence path] [--json]");
    process.exit(2);
  }

  const result = await readbackPracticeHookEgress({
    evidencePath: readFlag(args, "--evidence") ?? readFlag(args, "--packet") ?? DEFAULT_EVIDENCE,
    root: process.cwd()
  });
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`[practice-hook-egress-readback] OK totalRequests=${result.totalRequests} checkedValues=${result.dlp.checkedValues}`);
  } else {
    console.error("[practice-hook-egress-readback] FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
  }
  if (!result.ok) process.exit(1);
}

export async function readbackPracticeHookEgress({
  evidencePath = DEFAULT_EVIDENCE,
  root = process.cwd()
} = {}) {
  const packet = JSON.parse(await readFile(resolve(root, evidencePath), "utf8"));
  return inspectPracticeHookEgress(packet);
}

export function inspectPracticeHookEgress(packet) {
  const failures = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return failureResult(["packet must be an object"]);
  }

  if (packet.schemaVersion !== PACKET_SCHEMA_VERSION) {
    failures.push(`schemaVersion must be ${PACKET_SCHEMA_VERSION}`);
  }
  if (packet.environment !== "fixture") failures.push("environment must be fixture");
  if (packet.status !== "verified") failures.push("status must be verified");

  inspectCapture(packet.capture, failures);
  inspectHookCheckpoint(packet.hookCheckpoint, failures);
  inspectFailOpenHook(packet.failOpenHook, failures);
  inspectHookAdapter(packet.hookAdapter, failures);
  inspectAssertions(packet.assertions, failures);
  inspectSerializedPacket(packet, failures);

  const dlp = auditPacketCapture(packet);
  if (!dlp.ok) {
    for (const finding of dlp.findings) {
      failures.push(`DLP finding at ${finding.entry}${finding.path}: ${finding.pattern}`);
    }
  }

  return {
    ok: failures.length === 0,
    schemaVersion: PACKET_SCHEMA_VERSION,
    totalRequests: packet.capture?.totalRequests,
    dlp: {
      ok: dlp.ok,
      entries: dlp.entries,
      checkedValues: dlp.checkedValues
    },
    failures
  };
}

function inspectCapture(capture, failures) {
  if (!capture || typeof capture !== "object" || Array.isArray(capture)) {
    failures.push("capture must be an object");
    return;
  }
  if (capture.schemaVersion !== EGRESS_CAPTURE_SCHEMA_VERSION) {
    failures.push(`capture.schemaVersion must be ${EGRESS_CAPTURE_SCHEMA_VERSION}`);
  }
  if (capture.totalRequests !== 0) failures.push("capture.totalRequests must be 0");
  if (!Array.isArray(capture.entries)) {
    failures.push("capture.entries must be an array");
  } else if (capture.entries.length !== 0) {
    failures.push("capture.entries must be empty");
  }
}

function inspectHookCheckpoint(envelope, failures) {
  const data = requireEnvelope(envelope, "hookCheckpoint", failures);
  if (!data) return;
  if (data.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
    failures.push(`hookCheckpoint.data.schemaVersion must be ${CHECKPOINT_SCHEMA_VERSION}`);
  }
  if (data.hook?.egress !== "none") failures.push("hookCheckpoint.data.hook.egress must be none");
  if (data.hook?.network !== "forbidden") failures.push("hookCheckpoint.data.hook.network must be forbidden");
  inspectHookLog(data.hookLog, "hookCheckpoint.data.hookLog", false, failures);
}

function inspectFailOpenHook(envelope, failures) {
  const data = requireEnvelope(envelope, "failOpenHook", failures);
  if (!data) return;
  if (data.schemaVersion !== FAIL_OPEN_SCHEMA_VERSION) {
    failures.push(`failOpenHook.data.schemaVersion must be ${FAIL_OPEN_SCHEMA_VERSION}`);
  }
  if (data.failOpen !== true) failures.push("failOpenHook.data.failOpen must be true");
  if (data.egress !== "none") failures.push("failOpenHook.data.egress must be none");
  if (data.network !== "forbidden") failures.push("failOpenHook.data.network must be forbidden");
  inspectHookLog(data.hookLog, "failOpenHook.data.hookLog", true, failures);
}

function inspectHookAdapter(envelope, failures) {
  const data = requireEnvelope(envelope, "hookAdapter", failures);
  if (!data) return;
  if (data.schemaVersion !== HOOK_ADAPTER_SCHEMA_VERSION) {
    failures.push(`hookAdapter.data.schemaVersion must be ${HOOK_ADAPTER_SCHEMA_VERSION}`);
  }
  if (data.adapterName !== "repo-harness-hook") failures.push("hookAdapter.data.adapterName must be repo-harness-hook");
  if (data.repoLocalRuntime !== "not-vendored") failures.push("hookAdapter.data.repoLocalRuntime must be not-vendored");
  if (data.writes !== "manual-host-config") failures.push("hookAdapter.data.writes must be manual-host-config");
  if (data.entrypoint?.command !== "archctx") failures.push("hookAdapter.data.entrypoint.command must be archctx");
  if (!sameArray(data.entrypoint?.args, ["hook", "checkpoint"])) {
    failures.push("hookAdapter.data.entrypoint.args must be hook checkpoint");
  }
  if (data.entrypoint?.egress !== "none") failures.push("hookAdapter.data.entrypoint.egress must be none");
  if (data.entrypoint?.network !== "forbidden") failures.push("hookAdapter.data.entrypoint.network must be forbidden");
  if (data.logContract?.schemaVersion !== HOOK_LOG_SCHEMA_VERSION) {
    failures.push(`hookAdapter.data.logContract.schemaVersion must be ${HOOK_LOG_SCHEMA_VERSION}`);
  }
}

function inspectHookLog(log, label, expectedFailOpen, failures) {
  if (!log || typeof log !== "object" || Array.isArray(log)) {
    failures.push(`${label} must be an object`);
    return;
  }
  if (log.schemaVersion !== HOOK_LOG_SCHEMA_VERSION) failures.push(`${label}.schemaVersion must be ${HOOK_LOG_SCHEMA_VERSION}`);
  if (log.failOpen !== expectedFailOpen) failures.push(`${label}.failOpen must be ${expectedFailOpen}`);
  if (log.egress !== "none") failures.push(`${label}.egress must be none`);
  if (log.network !== "forbidden") failures.push(`${label}.network must be forbidden`);
  if (!Number.isInteger(log.pathCount)) failures.push(`${label}.pathCount must be an integer`);
  if (typeof log.changedPathDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(log.changedPathDigest)) {
    failures.push(`${label}.changedPathDigest must be a sha256 digest`);
  }
}

function inspectAssertions(assertions, failures) {
  if (!assertions || typeof assertions !== "object" || Array.isArray(assertions)) {
    failures.push("assertions must be an object");
    return;
  }
  for (const key of [
    "zeroNetworkEntries",
    "hookCheckpointDeclaresNoEgress",
    "failOpenDeclaresNoEgress",
    "adapterDeclaresNoEgress",
    "rawChangedPathBodyAbsent",
    "sourceBodyAbsent"
  ]) {
    if (assertions[key] !== true) failures.push(`assertions.${key} must be true`);
  }
}

function inspectSerializedPacket(packet, failures) {
  const serialized = JSON.stringify(packet);
  for (const pattern of RAW_CHANGED_PATH_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`packet must not contain raw changed path body matching ${pattern}`);
  }
  for (const pattern of NETWORK_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`packet must not contain network surface matching ${pattern}`);
  }
}

function requireEnvelope(envelope, label, failures) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    failures.push(`${label} must be an envelope object`);
    return undefined;
  }
  if (envelope.schemaVersion !== ENVELOPE_SCHEMA_VERSION) failures.push(`${label}.schemaVersion must be ${ENVELOPE_SCHEMA_VERSION}`);
  if (envelope.ok !== true) failures.push(`${label}.ok must be true`);
  if (typeof envelope.requestId !== "string" || envelope.requestId.length === 0) failures.push(`${label}.requestId must be a non-empty string`);
  if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
    failures.push(`${label}.data must be an object`);
    return undefined;
  }
  return envelope.data;
}

function sameArray(value, expected) {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

function failureResult(failures) {
  return {
    ok: false,
    schemaVersion: PACKET_SCHEMA_VERSION,
    totalRequests: undefined,
    dlp: { ok: false, entries: 0, checkedValues: 0 },
    failures
  };
}

function readFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
