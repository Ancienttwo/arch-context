#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { inspectFg2InstallRevokeReadback } from "./fg2-install-revoke-readback.mjs";
import { readbackGitHubEgressRecording } from "./github-egress-recording-readback.mjs";

const DEFAULT_PACKET = "docs/verification/fg2-staging-evidence.json";
const FORBIDDEN_KEYS = new Set([
  "source",
  "sourceCode",
  "diff",
  "patch",
  "fileName",
  "filePath",
  "symbol",
  "finding",
  "rawBody",
  "requestBody",
  "responseBody"
]);

if (import.meta.main) {
  const [command = "readback", ...args] = process.argv.slice(2);
  if (command !== "readback") {
    console.error("[fg2-staging-evidence-readback] usage: readback [--packet path] [--allow-pending] [--json]");
    process.exit(2);
  }
  const result = await readbackFg2StagingEvidence({
    packetPath: readFlag(args, "--packet") ?? DEFAULT_PACKET,
    allowPending: args.includes("--allow-pending")
  });
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const status = result.pending ? "PENDING" : result.ok ? "OK" : "FAILED";
    console.log(`[fg2-staging-evidence-readback] ${status}`);
    for (const failure of result.failures) console.log(`- ${failure}`);
    for (const blocker of result.blockers) console.log(`- ${blocker}`);
  }
  if (!result.ok) process.exit(1);
}

export async function readbackFg2StagingEvidence({
  packetPath = DEFAULT_PACKET,
  root = process.cwd(),
  allowPending = false
} = {}) {
  const absolutePacketPath = resolve(root, packetPath);
  const packet = JSON.parse(await readFile(absolutePacketPath, "utf8"));
  const relativeRoot = dirname(packetPath);
  return inspectFg2StagingEvidence(packet, {
    root,
    packetDir: relativeRoot,
    allowPending
  });
}

export async function inspectFg2StagingEvidence(packet, {
  root = process.cwd(),
  packetDir = dirname(DEFAULT_PACKET),
  allowPending = false
} = {}) {
  const failures = [];
  const blockers = [];

  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return { ok: false, pending: false, failures: ["packet must be an object"], blockers };
  }
  if (packet.schemaVersion !== "archcontext.fg2-staging-evidence/v1") {
    failures.push("schemaVersion must be archcontext.fg2-staging-evidence/v1");
  }
  if (packet.environment !== "staging") failures.push("environment must be staging");
  collectForbiddenKeys(packet, failures);

  if (packet.status === "pending") {
    const pendingBlockers = Array.isArray(packet.blockers) && packet.blockers.length > 0
      ? packet.blockers.map(String)
      : [packet.reason ?? "FG2 staging evidence packet is pending"];
    blockers.push(...pendingBlockers);
    return { ok: allowPending && failures.length === 0, pending: true, gates: gateStatuses(packet), failures, blockers };
  }
  if (packet.status !== "verified") failures.push("status must be pending or verified");

  const evidence = packet.evidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    failures.push("verified packet requires evidence object");
    return { ok: false, pending: false, gates: gateStatuses(packet), failures, blockers };
  }

  requireTrue(evidence.githubApp?.webhookReceived, "githubApp.webhookReceived", failures);
  requireTrue(evidence.githubApp?.checkCreated, "githubApp.checkCreated", failures);
  requireTrue(evidence.githubApp?.checkUpdated, "githubApp.checkUpdated", failures);
  requireTrue(evidence.githubApp?.deliveryIdsRedacted, "githubApp.deliveryIdsRedacted", failures);

  const egressRecordingPath = requireString(evidence.egressAndDlp?.recordingPath, "egressAndDlp.recordingPath", failures);
  if (egressRecordingPath) {
    const resolvedRecordingPath = egressRecordingPath.startsWith("/")
      ? egressRecordingPath
      : resolve(root, packetDir, egressRecordingPath);
    const egress = await readbackGitHubEgressRecording({
      root,
      recordingPath: resolvedRecordingPath,
      allowPending: false
    });
    if (!egress.ok) {
      for (const failure of egress.failures) failures.push(`egressAndDlp.${failure}`);
      for (const blocker of egress.blockers) failures.push(`egressAndDlp.${blocker}`);
    }
  }

  const decision = evidence.rulesetExpectedSource?.commitStatusesPermission;
  if (decision !== "not-required" && decision !== "required-and-implemented") {
    failures.push("rulesetExpectedSource.commitStatusesPermission must be not-required or required-and-implemented");
  }
  requireString(evidence.rulesetExpectedSource?.decisionRecord, "rulesetExpectedSource.decisionRecord", failures);
  requireTrue(evidence.rulesetExpectedSource?.rulesetVerified, "rulesetExpectedSource.rulesetVerified", failures);
  if (decision === "required-and-implemented") {
    requireString(evidence.rulesetExpectedSource?.permissionManifestCommit, "rulesetExpectedSource.permissionManifestCommit", failures);
    requireString(evidence.rulesetExpectedSource?.adrCommit, "rulesetExpectedSource.adrCommit", failures);
    requireString(evidence.rulesetExpectedSource?.installDisclosureCommit, "rulesetExpectedSource.installDisclosureCommit", failures);
  }

  requireTrue(evidence.installRevoke?.installationRevoked, "installRevoke.installationRevoked", failures);
  requireTrue(evidence.installRevoke?.tokenRejectedAfterRevoke, "installRevoke.tokenRejectedAfterRevoke", failures);
  requireTrue(evidence.installRevoke?.challengeCreationStopped, "installRevoke.challengeCreationStopped", failures);
  requireTrue(evidence.installRevoke?.checkUpdateStopped, "installRevoke.checkUpdateStopped", failures);
  const installRevokeRecordingPath = requireString(evidence.installRevoke?.recordingPath, "installRevoke.recordingPath", failures);
  if (installRevokeRecordingPath) {
    const resolvedRecordingPath = installRevokeRecordingPath.startsWith("/")
      ? installRevokeRecordingPath
      : resolve(root, packetDir, installRevokeRecordingPath);
    const recording = JSON.parse(await readFile(resolvedRecordingPath, "utf8"));
    const revoke = inspectFg2InstallRevokeReadback(recording);
    if (!revoke.ok) {
      for (const failure of revoke.failures) failures.push(`installRevoke.${failure}`);
    }
  }

  return {
    ok: failures.length === 0,
    pending: false,
    gates: gateStatuses(packet),
    failures,
    blockers
  };
}

function gateStatuses(packet) {
  const gates = packet?.gates;
  if (!gates || typeof gates !== "object" || Array.isArray(gates)) return {};
  return Object.fromEntries(Object.entries(gates).map(([id, value]) => [id, String(value)]));
}

function requireTrue(value, label, failures) {
  if (value !== true) failures.push(`${label} must be true`);
}

function requireString(value, label, failures) {
  if (typeof value !== "string" || value.length === 0) {
    failures.push(`${label} must be a non-empty string`);
    return "";
  }
  return value;
}

function collectForbiddenKeys(value, failures, path = "$") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeys(item, failures, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) failures.push(`forbidden private-content key at ${path}.${key}`);
    collectForbiddenKeys(child, failures, `${path}.${key}`);
  }
}

function readFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
