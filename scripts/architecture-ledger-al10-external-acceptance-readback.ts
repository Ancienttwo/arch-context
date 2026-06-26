#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { digestJson, type Json } from "@archcontext/contracts";

const ROOT = resolve(import.meta.dir, "..");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al10-external-acceptance-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al10-external-acceptance-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al10-external-acceptance.md";

const REQUIRED_GATES = ["AL10-14", "AL10-GA-6", "AL10-GA-7"] as const;

const REQUIRED_ARTIFACTS = [
  {
    id: "beta-user-interviews",
    gate: "AL10-14",
    path: "docs/verification/architecture-ledger-al10-beta-user-interviews.md",
    requiredStatus: "Verified",
    requiredTerms: [
      "Status",
      "Verified",
      "beta user",
      "interview",
      "Book answers",
      "manual filesystem browsing",
      "replace",
      "verdict"
    ]
  },
  {
    id: "independent-architecture-security-review",
    gate: "AL10-GA-6",
    path: "docs/approvals/architecture-ledger-al10-independent-review.md",
    requiredStatus: "Approved",
    requiredTerms: [
      "Status",
      "Approved",
      "independent reviewer",
      "architecture review",
      "security review",
      "ledger-authoritative",
      "enforcement enablement",
      "unresolved risk"
    ]
  },
  {
    id: "production-rollback-drill",
    gate: "AL10-GA-7",
    path: "docs/verification/architecture-ledger-al10-production-rollback-drill.md",
    requiredStatus: "Verified",
    requiredTerms: [
      "Status",
      "Verified",
      "production rollback drill",
      "ledger-authoritative",
      "YAML authority",
      "rollback",
      "operator",
      "verification"
    ]
  }
] as const;

const LEGACY_ARTIFACTS = [
  {
    id: "fg6-external-security-review",
    path: "docs/security/reviews/fg6-external-security-review.md",
    rejectionReason: "FG6 security-only release review; not AL10 architecture-ledger authority promotion approval.",
    rejectionTerms: ["not a production penetration test", "FG6"]
  },
  {
    id: "m6-independent-threat-review",
    path: "docs/security/reviews/m6-independent-threat-review.md",
    rejectionReason: "M6 deterministic MVP threat review; not AL10 external architecture and security acceptance.",
    rejectionTerms: ["deterministic MVP", "Developer Attestation"]
  },
  {
    id: "fg6-personal-beta-launch",
    path: "docs/approvals/fg6-personal-beta-launch.md",
    rejectionReason: "Personal-user beta launch approval; explicitly not production GA or design-partner rollout.",
    rejectionTerms: ["does not approve", "production GA"]
  },
  {
    id: "production-ga-external-readback",
    path: "docs/verification/production-ga-external-readback.md",
    rejectionReason: "Production GA external readback is blocked and explicitly not a production launch approval.",
    rejectionTerms: ["Status: blocked", "not a production launch approval"]
  }
] as const;

const SOURCE_PATHS = [
  "docs/architecture/architecture-ledger-authority-promotion-review.md",
  "docs/runbooks/architecture-ledger-rollout.md",
  "docs/verification/architecture-ledger-al10-beta-decision.md",
  "docs/verification/architecture-ledger-al10-ga-technical.md"
] as const;

const SECRET_PATTERNS = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /secret:\/\//i
] as const;

const RAW_CONTENT_PATTERNS = [
  /diff\s+--git/i,
  /^@@\s/m,
  /"patch"\s*:/i,
  /"sourceBody"\s*:/i,
  /"diffBody"\s*:/i,
  /promptBody/i,
  /completionBody/i
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[architecture-ledger-al10-external-acceptance-readback] usage: run|inspect [--out path] [--report path] [--evidence path] [--json]");
    process.exit(2);
  }
  const result = command === "run"
    ? runArchitectureLedgerAl10ExternalAcceptanceReadback({
        outPath: readFlag(args, "--out") ?? DEFAULT_OUT,
        reportPath: readFlag(args, "--report") ?? DEFAULT_REPORT
      })
    : inspectArchitectureLedgerAl10ExternalAcceptanceReadback(
        JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
      );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export function runArchitectureLedgerAl10ExternalAcceptanceReadback({
  outPath = DEFAULT_OUT,
  reportPath = DEFAULT_REPORT
} = {}) {
  const packet = buildArchitectureLedgerAl10ExternalAcceptancePacket();
  const inspected = inspectArchitectureLedgerAl10ExternalAcceptanceReadback(packet);
  const finalPacket = {
    ...packet,
    integrityStatus: inspected.ok ? "verified" : "failed",
    failures: inspected.failures
  };
  writeJson(outPath, finalPacket);
  writeText(reportPath, renderReport(finalPacket));
  return inspectArchitectureLedgerAl10ExternalAcceptanceReadback(finalPacket);
}

export function buildArchitectureLedgerAl10ExternalAcceptancePacket() {
  const requiredArtifacts = REQUIRED_ARTIFACTS.map(inspectRequiredArtifact);
  const gateResults = REQUIRED_GATES.map((gate) => {
    const artifact = requiredArtifacts.find((item) => item.gate === gate);
    const verified = artifact?.verified === true;
    return {
      gate,
      status: verified ? "verified" : "blocked",
      artifactId: artifact?.id ?? "",
      artifactPath: artifact?.path ?? "",
      blocker: verified ? "" : artifact?.blockedReasons.join("; ")
    };
  });
  const verifiedGates = gateResults.filter((gate) => gate.status === "verified").map((gate) => gate.gate);
  const blockedGates = gateResults.filter((gate) => gate.status !== "verified").map((gate) => gate.gate);
  const status = blockedGates.length === 0 ? "verified" : "blocked";
  const legacyArtifacts = LEGACY_ARTIFACTS.map(inspectLegacyArtifact);
  const sourceReadbacks = SOURCE_PATHS.map(inspectSourcePath);
  const privacy = inspectPrivacy({
    requiredArtifacts,
    gateResults,
    legacyArtifacts,
    sourceReadbacks
  });
  const scope = {
    auditedGates: [...REQUIRED_GATES],
    closedGates: status === "verified" ? [...REQUIRED_GATES] : verifiedGates,
    remainingGates: blockedGates,
    nonClaims: [
      "does not use FG6/M6 carry-over artifacts to close AL10 gates",
      "does not self-approve independent review",
      "does not claim production rollback drill without canonical verified drill artifact"
    ]
  };
  const assertions = {
    canonicalArtifactsPresent: requiredArtifacts.every((artifact) => artifact.exists),
    canonicalSourcesOnly: requiredArtifacts.every((artifact) =>
      REQUIRED_ARTIFACTS.some((spec) => spec.id === artifact.id && spec.path === artifact.path && spec.gate === artifact.gate)
    ),
    externalEvidenceComplete: status === "verified",
    externalEvidenceBlocked: status === "blocked" && blockedGates.length > 0,
    legacyArtifactsRejected: legacyArtifacts.every((artifact) => artifact.rejected),
    noGateOverclaim: status === "verified"
      ? sameStringSet(scope.closedGates, REQUIRED_GATES) && scope.remainingGates.length === 0
      : scope.closedGates.length < REQUIRED_GATES.length && sameStringSet(scope.remainingGates, blockedGates),
    privacyClean: privacy.clean,
    sourceReadbacksPresent: sourceReadbacks.every((source) => source.exists)
  };
  const readbackDigest = digestJson({
    schemaVersion: SCHEMA_VERSION,
    status,
    scope,
    requiredArtifacts,
    gateResults,
    legacyArtifacts,
    sourceReadbacks,
    privacy,
    assertions
  } as unknown as Json);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(0).toISOString(),
    status,
    gates: [...REQUIRED_GATES],
    scope,
    requiredArtifacts,
    gateResults,
    legacyArtifacts,
    sourceReadbacks,
    privacy,
    assertions,
    readbackDigest,
    readback: {
      command: `bun scripts/architecture-ledger-al10-external-acceptance-readback.ts inspect --evidence ${DEFAULT_OUT} --json`,
      recordCommand: `bun scripts/architecture-ledger-al10-external-acceptance-readback.ts run --out ${DEFAULT_OUT} --report ${DEFAULT_REPORT} --json`,
      reportPath: DEFAULT_REPORT
    },
    failures: [] as string[]
  };
}

export function inspectArchitectureLedgerAl10ExternalAcceptanceReadback(packet: any) {
  const failures: string[] = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return { ok: false, status: "failed", failures: ["packet must be an object"], gates: {} };
  }
  if (packet.schemaVersion !== SCHEMA_VERSION) failures.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (!["blocked", "verified"].includes(packet.status)) failures.push("status must be blocked or verified");
  if (!sameStringSet(packet.gates, REQUIRED_GATES)) failures.push("gates must be exactly AL10-14, AL10-GA-6 and AL10-GA-7");
  if (!packet.readbackDigest || typeof packet.readbackDigest !== "string") failures.push("readbackDigest must be present");

  inspectScope(packet.scope, packet.status, failures);
  inspectRequiredArtifacts(packet.requiredArtifacts, failures);
  inspectGateResults(packet.gateResults, packet.status, failures);
  inspectLegacyArtifacts(packet.legacyArtifacts, failures);
  inspectSourceReadbacks(packet.sourceReadbacks, failures);
  inspectPrivacyPacket(packet.privacy, failures);
  inspectAssertions(packet.assertions, packet.status, failures);

  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? packet.status : "failed",
    failures,
    gates: Object.fromEntries(REQUIRED_GATES.map((gate) => {
      const result = Array.isArray(packet.gateResults)
        ? packet.gateResults.find((item: any) => item?.gate === gate)
        : undefined;
      return [gate, result?.status === "verified" ? "verified" : "blocked"];
    })),
    requiredArtifacts: packet.requiredArtifacts,
    legacyArtifacts: packet.legacyArtifacts
  };
}

function inspectScope(scope: any, status: string, failures: string[]): void {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    failures.push("scope must be an object");
    return;
  }
  if (!sameStringSet(scope.auditedGates, REQUIRED_GATES)) failures.push("scope.auditedGates must list the three remaining gates");
  if (status === "verified") {
    if (!sameStringSet(scope.closedGates, REQUIRED_GATES)) failures.push("verified scope.closedGates must close all three remaining gates");
    if (Array.isArray(scope.remainingGates) && scope.remainingGates.length > 0) failures.push("verified scope.remainingGates must be empty");
  } else {
    if (!Array.isArray(scope.remainingGates) || scope.remainingGates.length === 0) failures.push("blocked scope.remainingGates must name blockers");
    if (!Array.isArray(scope.closedGates)) failures.push("blocked scope.closedGates must be an array");
    if (Array.isArray(scope.closedGates) && scope.closedGates.some((gate: string) => !REQUIRED_GATES.includes(gate as any))) {
      failures.push("scope.closedGates includes an unexpected gate");
    }
  }
}

function inspectRequiredArtifacts(requiredArtifacts: any, failures: string[]): void {
  if (!Array.isArray(requiredArtifacts)) {
    failures.push("requiredArtifacts must be an array");
    return;
  }
  if (requiredArtifacts.length !== REQUIRED_ARTIFACTS.length) failures.push(`requiredArtifacts must include ${REQUIRED_ARTIFACTS.length} artifacts`);
  for (const spec of REQUIRED_ARTIFACTS) {
    const artifact = requiredArtifacts.find((item: any) => item?.id === spec.id);
    if (!artifact) {
      failures.push(`required artifact missing: ${spec.id}`);
      continue;
    }
    if (artifact.gate !== spec.gate) failures.push(`${spec.id}: gate must be ${spec.gate}`);
    if (artifact.path !== spec.path) failures.push(`${spec.id}: artifact path must use canonical path ${spec.path}`);
    if (artifact.requiredStatus !== spec.requiredStatus) failures.push(`${spec.id}: requiredStatus must be ${spec.requiredStatus}`);
    if (!["missing", "blocked", "verified"].includes(artifact.status)) failures.push(`${spec.id}: status must be missing, blocked or verified`);
    if (artifact.verified === true && artifact.status !== "verified") failures.push(`${spec.id}: verified artifact must have status verified`);
    if (artifact.status === "verified") {
      if (artifact.verified !== true) failures.push(`${spec.id}: verified status requires verified=true`);
      if (!Array.isArray(artifact.missingTerms) || artifact.missingTerms.length !== 0) failures.push(`${spec.id}: verified artifact cannot have missing terms`);
      if (artifact.statusMarkerPresent !== true) failures.push(`${spec.id}: verified artifact must include required status marker`);
    }
    if (artifact.status !== "verified" && artifact.verified === true) failures.push(`${spec.id}: non-verified artifact cannot set verified=true`);
  }
}

function inspectGateResults(gateResults: any, status: string, failures: string[]): void {
  if (!Array.isArray(gateResults)) {
    failures.push("gateResults must be an array");
    return;
  }
  if (gateResults.length !== REQUIRED_GATES.length) failures.push(`gateResults must include ${REQUIRED_GATES.length} gates`);
  const blocked = [];
  for (const gate of REQUIRED_GATES) {
    const result = gateResults.find((item: any) => item?.gate === gate);
    if (!result) {
      failures.push(`gate result missing: ${gate}`);
      continue;
    }
    if (!["blocked", "verified"].includes(result.status)) failures.push(`${gate}: gate status must be blocked or verified`);
    const spec = REQUIRED_ARTIFACTS.find((item) => item.gate === gate);
    if (result.artifactId !== spec?.id) failures.push(`${gate}: artifactId must be ${spec?.id}`);
    if (result.artifactPath !== spec?.path) failures.push(`${gate}: artifactPath must be ${spec?.path}`);
    if (result.status !== "verified") blocked.push(gate);
  }
  if (status === "verified" && blocked.length > 0) failures.push(`verified packet cannot have blocked gates: ${blocked.join(",")}`);
  if (status === "blocked" && blocked.length === 0) failures.push("blocked packet must have at least one blocked gate");
}

function inspectLegacyArtifacts(legacyArtifacts: any, failures: string[]): void {
  if (!Array.isArray(legacyArtifacts)) {
    failures.push("legacyArtifacts must be an array");
    return;
  }
  for (const spec of LEGACY_ARTIFACTS) {
    const artifact = legacyArtifacts.find((item: any) => item?.id === spec.id);
    if (!artifact) {
      failures.push(`legacy artifact readback missing: ${spec.id}`);
      continue;
    }
    if (artifact.path !== spec.path) failures.push(`${spec.id}: legacy artifact path must remain ${spec.path}`);
    if (artifact.rejected !== true) failures.push(`${spec.id}: legacy artifact must be rejected for AL10 external acceptance`);
    if (artifact.rejectionReason !== spec.rejectionReason) failures.push(`${spec.id}: rejectionReason must be stable`);
  }
}

function inspectSourceReadbacks(sourceReadbacks: any, failures: string[]): void {
  if (!Array.isArray(sourceReadbacks)) {
    failures.push("sourceReadbacks must be an array");
    return;
  }
  for (const path of SOURCE_PATHS) {
    const source = sourceReadbacks.find((item: any) => item?.path === path);
    if (!source) {
      failures.push(`source readback missing: ${path}`);
      continue;
    }
    if (source.exists !== true) failures.push(`${path}: source must exist`);
    if (typeof source.sha256 !== "string" || !source.sha256.startsWith("sha256:")) failures.push(`${path}: sha256 must be present`);
  }
}

function inspectPrivacyPacket(privacy: any, failures: string[]): void {
  if (!privacy || typeof privacy !== "object" || Array.isArray(privacy)) {
    failures.push("privacy must be an object");
    return;
  }
  if (privacy.forbiddenSecretHitCount !== 0) failures.push("privacy forbiddenSecretHitCount must be 0");
  if (privacy.forbiddenRawContentHitCount !== 0) failures.push("privacy forbiddenRawContentHitCount must be 0");
  if (privacy.clean !== true) failures.push("privacy must be clean");
}

function inspectAssertions(assertions: Record<string, unknown> | undefined, status: string, failures: string[]): void {
  if (!assertions || typeof assertions !== "object") {
    failures.push("assertions must be present");
    return;
  }
  const allowed = new Set([
    "canonicalArtifactsPresent",
    "canonicalSourcesOnly",
    "externalEvidenceComplete",
    "externalEvidenceBlocked",
    "legacyArtifactsRejected",
    "noGateOverclaim",
    "privacyClean",
    "sourceReadbacksPresent"
  ]);
  for (const key of Object.keys(assertions)) {
    if (!allowed.has(key)) failures.push(`unexpected assertion: ${key}`);
  }
  if (assertions.canonicalSourcesOnly !== true) failures.push("assertions.canonicalSourcesOnly must be true");
  if (assertions.legacyArtifactsRejected !== true) failures.push("assertions.legacyArtifactsRejected must be true");
  if (assertions.noGateOverclaim !== true) failures.push("assertions.noGateOverclaim must be true");
  if (assertions.privacyClean !== true) failures.push("assertions.privacyClean must be true");
  if (assertions.sourceReadbacksPresent !== true) failures.push("assertions.sourceReadbacksPresent must be true");
  if (status === "verified") {
    if (assertions.externalEvidenceComplete !== true) failures.push("verified packet requires externalEvidenceComplete=true");
    if (assertions.externalEvidenceBlocked !== false) failures.push("verified packet requires externalEvidenceBlocked=false");
    if (assertions.canonicalArtifactsPresent !== true) failures.push("verified packet requires canonicalArtifactsPresent=true");
  } else {
    if (assertions.externalEvidenceBlocked !== true) failures.push("blocked packet requires externalEvidenceBlocked=true");
  }
}

function inspectRequiredArtifact(spec: typeof REQUIRED_ARTIFACTS[number]) {
  const absolutePath = resolve(ROOT, spec.path);
  if (!existsSync(absolutePath)) {
    return {
      id: spec.id,
      gate: spec.gate,
      path: spec.path,
      exists: false,
      sha256: "",
      requiredStatus: spec.requiredStatus,
      status: "missing",
      verified: false,
      statusMarkerPresent: false,
      requiredTermsPresent: [],
      missingTerms: [...spec.requiredTerms],
      blockedReasons: ["artifact missing"]
    };
  }
  const raw = readFileSync(absolutePath, "utf8");
  const statusMarkerPresent = includesLoose(raw, `Status**: ${spec.requiredStatus}`)
    || includesLoose(raw, `Status: ${spec.requiredStatus}`);
  const requiredTermsPresent = spec.requiredTerms.filter((term) => includesLoose(raw, term));
  const missingTerms = spec.requiredTerms.filter((term) => !includesLoose(raw, term));
  const blockedReasons = [
    ...(statusMarkerPresent ? [] : [`status marker must be ${spec.requiredStatus}`]),
    ...missingTerms.map((term) => `missing term: ${term}`)
  ];
  const verified = blockedReasons.length === 0;
  return {
    id: spec.id,
    gate: spec.gate,
    path: spec.path,
    exists: true,
    sha256: sha256(raw),
    requiredStatus: spec.requiredStatus,
    status: verified ? "verified" : "blocked",
    verified,
    statusMarkerPresent,
    requiredTermsPresent,
    missingTerms,
    blockedReasons
  };
}

function inspectLegacyArtifact(spec: typeof LEGACY_ARTIFACTS[number]) {
  const absolutePath = resolve(ROOT, spec.path);
  if (!existsSync(absolutePath)) {
    return {
      id: spec.id,
      path: spec.path,
      exists: false,
      sha256: "",
      rejected: true,
      rejectionReason: spec.rejectionReason,
      rejectionTermsPresent: []
    };
  }
  const raw = readFileSync(absolutePath, "utf8");
  return {
    id: spec.id,
    path: spec.path,
    exists: true,
    sha256: sha256(raw),
    rejected: true,
    rejectionReason: spec.rejectionReason,
    rejectionTermsPresent: spec.rejectionTerms.filter((term) => includesLoose(raw, term))
  };
}

function inspectSourcePath(path: string) {
  const absolutePath = resolve(ROOT, path);
  if (!existsSync(absolutePath)) {
    return { path, exists: false, sha256: "" };
  }
  return { path, exists: true, sha256: sha256(readFileSync(absolutePath, "utf8")) };
}

function inspectPrivacy(value: unknown) {
  const serialized = JSON.stringify(value);
  const secretHits = SECRET_PATTERNS.filter((pattern) => pattern.test(serialized)).map(String);
  const rawContentHits = RAW_CONTENT_PATTERNS.filter((pattern) => pattern.test(serialized)).map(String);
  return {
    forbiddenSecretHitCount: secretHits.length,
    forbiddenRawContentHitCount: rawContentHits.length,
    secretHits,
    rawContentHits,
    clean: secretHits.length === 0 && rawContentHits.length === 0
  };
}

function renderReport(packet: any): string {
  return [
    "# Architecture Ledger AL10 External Acceptance Readback",
    "",
    "## Scope",
    "",
    "- Audits: AL10-14, AL10-GA-6 and AL10-GA-7.",
    `- Status: ${packet.status}.`,
    `- Closed gates: ${packet.scope.closedGates.length === 0 ? "none" : packet.scope.closedGates.join(", ")}.`,
    `- Remaining gates: ${packet.scope.remainingGates.length === 0 ? "none" : packet.scope.remainingGates.join(", ")}.`,
    "- This readback rejects FG6/M6 carry-over artifacts for AL10 external acceptance.",
    "",
    "## Required Canonical Artifacts",
    "",
    "| Gate | Artifact | Status | Blocker |",
    "| --- | --- | --- | --- |",
    ...packet.gateResults.map((gate: any) => `| ${gate.gate} | ${gate.artifactPath} | ${gate.status} | ${gate.blocker || "none"} |`),
    "",
    "## Rejected Carry-Over Artifacts",
    "",
    "| Artifact | Rejected | Reason |",
    "| --- | --- | --- |",
    ...packet.legacyArtifacts.map((artifact: any) => `| ${artifact.path} | ${artifact.rejected ? "yes" : "no"} | ${artifact.rejectionReason} |`),
    "",
    "## Readback",
    "",
    "```bash",
    packet.readback.command,
    packet.readback.recordCommand,
    "```",
    ""
  ].join("\n");
}

function renderHuman(result: any): string {
  if (result.ok) {
    const gates = Object.entries(result.gates).map(([gate, status]) => `${gate}=${status}`).join(" ");
    return `[architecture-ledger-al10-external-acceptance-readback] OK status=${result.status} ${gates}`;
  }
  return `[architecture-ledger-al10-external-acceptance-readback] FAILED\n${result.failures.map((failure: string) => `- ${failure}`).join("\n")}`;
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function includesLoose(raw: string, term: string): boolean {
  return raw.toLocaleLowerCase("en-US").includes(term.toLocaleLowerCase("en-US"));
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, value: string): void {
  const resolved = resolve(ROOT, path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, value, "utf8");
}

function sameStringSet(actual: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(actual)) return false;
  return [...new Set(actual)].sort().join(",") === [...expected].sort().join(",");
}
