#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { digestJson, type Json } from "@archcontext/contracts";

const ROOT = resolve(import.meta.dir, "..");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al10-beta-decision-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al10-beta-decision-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al10-beta-decision.md";
const POLICY_PATH = "docs/architecture/architecture-ledger-authority-promotion-review.md";
const TELEMETRY_PATH = "docs/verification/architecture-ledger-al10-telemetry-readback.json";
const AUTHORITY_MATRIX_PATH = "docs/architecture/architecture-ledger-authority-matrix.md";
const ADR_0040_PATH = "docs/adr/ADR-0040-hybrid-architecture-ledger.md";
const GATES = ["AL10-15", "AL10-16"] as const;
const EXPLICITLY_OPEN = [
  "AL10-14",
  "AL10-GA-1",
  "AL10-GA-2",
  "AL10-GA-3",
  "AL10-GA-4",
  "AL10-GA-5",
  "AL10-GA-6",
  "AL10-GA-7"
] as const;
const REQUIRED_RISK_IDS = [
  "missing-beta-user-interviews",
  "missing-independent-review-approval",
  "hook-enqueue-p95-beta-budget",
  "ga-gates-open"
] as const;

const POLICY_TERMS = [
  "independent reviewer",
  "authority promotion",
  "enforcement enablement",
  "docs/approvals/",
  "no self-attestation",
  "ADR-0040",
  "architecture-ledger-authority-matrix.md",
  "subagents",
  "ChangeSet",
  "daemon-owned",
  "raw source body",
  "raw diff or patch body",
  "AL10-14",
  "hook-enqueue-p95-beta-budget",
  "ledger-authoritative",
  "NO-GO"
] as const;

const AUTHORITY_MATRIX_TERMS = [
  "ChangeSet engine",
  "Runtime daemon",
  "Subagent runner",
  "ledger-authoritative",
  "EvidenceBinding/v1",
  "raw source body",
  "raw diff or patch body"
] as const;

const ADR_TERMS = [
  "ledger-authoritative",
  "ChangeSet",
  "evidence",
  "raw source bodies",
  "raw diffs"
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
    console.error("[architecture-ledger-al10-beta-decision-readback] usage: run|inspect [--out path] [--report path] [--evidence path] [--json]");
    process.exit(2);
  }
  const result = command === "run"
    ? runArchitectureLedgerAl10BetaDecisionReadback({
        outPath: readFlag(args, "--out") ?? DEFAULT_OUT,
        reportPath: readFlag(args, "--report") ?? DEFAULT_REPORT
      })
    : inspectArchitectureLedgerAl10BetaDecisionReadback(
        JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
      );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export function runArchitectureLedgerAl10BetaDecisionReadback({
  outPath = DEFAULT_OUT,
  reportPath = DEFAULT_REPORT
} = {}) {
  const packet = buildArchitectureLedgerAl10BetaDecisionPacket();
  const inspected = inspectArchitectureLedgerAl10BetaDecisionReadback(packet);
  const finalPacket = {
    ...packet,
    status: inspected.ok ? "verified" : "failed",
    failures: inspected.failures
  };
  writeJson(outPath, finalPacket);
  writeText(reportPath, renderReport(finalPacket));
  return inspectArchitectureLedgerAl10BetaDecisionReadback(finalPacket);
}

export function buildArchitectureLedgerAl10BetaDecisionPacket() {
  const policyRaw = readText(POLICY_PATH);
  const telemetryRaw = readText(TELEMETRY_PATH);
  const authorityMatrixRaw = readText(AUTHORITY_MATRIX_PATH);
  const adrRaw = readText(ADR_0040_PATH);
  const telemetry = JSON.parse(telemetryRaw) as Record<string, any>;
  const policy = inspectTermDocument("authority-promotion-review", POLICY_PATH, policyRaw, POLICY_TERMS);
  const sourceReadbacks = [
    policy,
    inspectTelemetry(telemetryRaw, telemetry),
    inspectTermDocument("authority-matrix", AUTHORITY_MATRIX_PATH, authorityMatrixRaw, AUTHORITY_MATRIX_TERMS),
    inspectTermDocument("adr-0040", ADR_0040_PATH, adrRaw, ADR_TERMS)
  ];
  const decision = buildDecision(telemetry);
  const gateBoundary = {
    closedGates: [...GATES],
    explicitlyOpen: [...EXPLICITLY_OPEN],
    noGateOverclaim: true
  };
  const privacy = inspectPrivacy({
    sourceReadbacks,
    decision,
    gateBoundary
  });
  const assertions = {
    "AL10-15": policy.verified
      && policy.requiredTermsPresent.includes("independent reviewer")
      && policy.requiredTermsPresent.includes("docs/approvals/")
      && policy.requiredTermsPresent.includes("no self-attestation")
      && policy.requiredTermsPresent.includes("authority promotion")
      && policy.requiredTermsPresent.includes("enforcement enablement")
      && policy.requiredTermsPresent.includes("ChangeSet")
      && policy.requiredTermsPresent.includes("daemon-owned"),
    "AL10-16": decision.decision === "NO-GO"
      && decision.promotionAllowed === false
      && decision.enforcementEnablementAllowed === false
      && decision.productInterviewEvidenceStatus === "missing"
      && decision.independentReviewStatus === "required-not-yet-approved"
      && REQUIRED_RISK_IDS.every((id) => decision.unresolvedRisks.some((risk) => risk.id === id))
      && gateBoundary.explicitlyOpen.includes("AL10-14")
      && gateBoundary.explicitlyOpen.includes("AL10-GA-1")
      && sourceReadbacks.every((source) => source.verified)
      && privacy.clean,
    sourceReadbacksVerified: sourceReadbacks.every((source) => source.verified),
    independentReviewerRequired: policy.verified
      && policy.requiredTermsPresent.includes("independent reviewer")
      && policy.requiredTermsPresent.includes("no self-attestation"),
    decisionRecorded: decision.decision === "NO-GO"
      && decision.reasonCount >= REQUIRED_RISK_IDS.length
      && decision.unresolvedRisks.length >= REQUIRED_RISK_IDS.length,
    advisoryOnlyBoundary: decision.advisoryLocalOptInAllowed === true
      && decision.promotionAllowed === false
      && decision.enforcementEnablementAllowed === false,
    activeRiskCarriedForward: decision.unresolvedRisks.some((risk) => risk.id === "hook-enqueue-p95-beta-budget"),
    openGatesPreserved: sameStringSet(gateBoundary.explicitlyOpen, EXPLICITLY_OPEN),
    noPrivateContent: privacy.clean
  };
  const readbackDigest = digestJson({
    schemaVersion: SCHEMA_VERSION,
    sourceReadbacks,
    decision,
    gateBoundary,
    privacy,
    assertions
  } as unknown as Json);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(0).toISOString(),
    gates: [...GATES],
    status: "verified",
    scope: {
      repo: "architecture-ledger-local-beta-decision",
      authority: "policy and final decision readback for promotion/enforcement",
      closedGates: [...GATES],
      explicitlyOpen: [...EXPLICITLY_OPEN],
      reportMode: "go-no-go-readback",
      nonClaims: [
        "does not close AL10-14 beta-user interviews",
        "does not close any GA gate",
        "does not approve ledger-authoritative promotion",
        "does not enable hard enforcement"
      ]
    },
    sources: [
      { id: "authority-promotion-review", path: POLICY_PATH },
      { id: "al10-telemetry", path: TELEMETRY_PATH },
      { id: "authority-matrix", path: AUTHORITY_MATRIX_PATH },
      { id: "adr-0040", path: ADR_0040_PATH }
    ],
    sourceReadbacks,
    decision,
    gateBoundary,
    privacy,
    readbackDigest,
    assertions,
    readback: {
      command: `bun scripts/architecture-ledger-al10-beta-decision-readback.ts inspect --evidence ${DEFAULT_OUT} --json`,
      recordCommand: `bun scripts/architecture-ledger-al10-beta-decision-readback.ts run --out ${DEFAULT_OUT} --report ${DEFAULT_REPORT} --json`,
      reportPath: DEFAULT_REPORT
    },
    failures: [] as string[]
  };
}

export function inspectArchitectureLedgerAl10BetaDecisionReadback(packet: any) {
  const failures: string[] = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return { ok: false, status: "failed", failures: ["packet must be an object"], gates: {} };
  }
  if (packet.schemaVersion !== SCHEMA_VERSION) failures.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (packet.status !== undefined && packet.status !== "verified") failures.push("status must be verified");
  if (!sameStringSet(packet.gates, GATES)) failures.push("gates must be exactly AL10-15 and AL10-16");
  if (!sameStringSet(packet.scope?.closedGates, GATES)) failures.push("scope.closedGates must be exactly AL10-15 and AL10-16");
  if (!sameStringSet(packet.scope?.explicitlyOpen, EXPLICITLY_OPEN)) failures.push("scope.explicitlyOpen must keep AL10-14 and all GA gates open");
  if (!packet.readbackDigest || typeof packet.readbackDigest !== "string") failures.push("readbackDigest must be present");

  inspectSourceReadbacks(packet.sourceReadbacks, failures);
  inspectDecision(packet.decision, failures);
  inspectGateBoundary(packet.gateBoundary, failures);
  inspectPrivacyPacket(packet.privacy, failures);
  inspectAssertions(packet.assertions, failures);

  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? "verified" : "failed",
    failures,
    gates: Object.fromEntries(GATES.map((gate) => [gate, packet.assertions?.[gate] === true ? "verified" : "blocked"])),
    decision: packet.decision,
    sourceReadbacks: packet.sourceReadbacks
  };
}

function inspectSourceReadbacks(sourceReadbacks: any, failures: string[]): void {
  if (!Array.isArray(sourceReadbacks)) {
    failures.push("sourceReadbacks must be an array");
    return;
  }
  const expectedIds = ["authority-promotion-review", "al10-telemetry", "authority-matrix", "adr-0040"];
  if (sourceReadbacks.length !== expectedIds.length) failures.push(`sourceReadbacks must include ${expectedIds.length} sources`);
  for (const expectedId of expectedIds) {
    const source = sourceReadbacks.find((item: any) => item?.id === expectedId);
    if (!source) {
      failures.push(`source readback missing: ${expectedId}`);
      continue;
    }
    if (source.status !== "verified") failures.push(`${expectedId}: status must be verified`);
    if (source.verified !== true) failures.push(`${expectedId}: source readback must be verified`);
    if (typeof source.sha256 !== "string" || !source.sha256.startsWith("sha256:")) failures.push(`${expectedId}: sha256 must be present`);
    if (Array.isArray(source.missingTerms) && source.missingTerms.length > 0) failures.push(`${expectedId}: missing terms ${source.missingTerms.join(",")}`);
  }
  const telemetry = sourceReadbacks.find((item: any) => item?.id === "al10-telemetry");
  if (telemetry) {
    if (!Array.isArray(telemetry.gates) || !telemetry.gates.includes("AL10-13")) failures.push("al10-telemetry: must include AL10-13 evidence");
    if (!Array.isArray(telemetry.explicitlyOpen) || !telemetry.explicitlyOpen.includes("AL10-14")) failures.push("al10-telemetry: must keep AL10-14 open");
    if (telemetry.hookEnqueueP95AboveBetaBudget !== true) failures.push("al10-telemetry: must carry hook enqueue p95 beta risk");
  }
}

function inspectDecision(decision: any, failures: string[]): void {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    failures.push("decision must be an object");
    return;
  }
  if (decision.decision !== "NO-GO") failures.push("decision must be NO-GO");
  if (decision.scope !== "ledger-authoritative-promotion-and-enforcement-enablement") failures.push("decision.scope must cover promotion and enforcement");
  if (decision.advisoryLocalOptInAllowed !== true) failures.push("decision.advisoryLocalOptInAllowed must remain true");
  if (decision.promotionAllowed !== false) failures.push("decision.promotionAllowed must be false");
  if (decision.enforcementEnablementAllowed !== false) failures.push("decision.enforcementEnablementAllowed must be false");
  if (decision.productInterviewEvidenceStatus !== "missing") failures.push("decision must keep product interview evidence missing");
  if (decision.independentReviewStatus !== "required-not-yet-approved") failures.push("decision must require independent review approval");
  if (!Array.isArray(decision.unresolvedRisks) || decision.unresolvedRisks.length < REQUIRED_RISK_IDS.length) failures.push("decision.unresolvedRisks must record the blocking risks");
  for (const id of REQUIRED_RISK_IDS) {
    if (!decision.unresolvedRisks?.some((risk: any) => risk?.id === id)) failures.push(`decision unresolved risk missing: ${id}`);
  }
}

function inspectGateBoundary(gateBoundary: any, failures: string[]): void {
  if (!sameStringSet(gateBoundary?.closedGates, GATES)) failures.push("gateBoundary.closedGates must be exactly AL10-15 and AL10-16");
  if (!sameStringSet(gateBoundary?.explicitlyOpen, EXPLICITLY_OPEN)) failures.push("gateBoundary.explicitlyOpen must keep AL10-14 and all GA gates open");
  if (gateBoundary?.noGateOverclaim !== true) failures.push("gateBoundary.noGateOverclaim must be true");
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

function inspectAssertions(assertions: Record<string, unknown> | undefined, failures: string[]): void {
  if (!assertions || typeof assertions !== "object") {
    failures.push("assertions must be present");
    return;
  }
  const allowed = new Set([
    ...GATES,
    "sourceReadbacksVerified",
    "independentReviewerRequired",
    "decisionRecorded",
    "advisoryOnlyBoundary",
    "activeRiskCarriedForward",
    "openGatesPreserved",
    "noPrivateContent"
  ]);
  for (const key of Object.keys(assertions)) {
    if (!allowed.has(key)) failures.push(`unexpected gate assertion: ${key}`);
  }
  for (const key of allowed) {
    if (assertions[key] !== true) failures.push(`assertions.${key} must be true`);
  }
}

function inspectTermDocument(id: string, path: string, raw: string, requiredTerms: readonly string[]) {
  const requiredTermsPresent = requiredTerms.filter((term) => raw.includes(term));
  const missingTerms = requiredTerms.filter((term) => !raw.includes(term));
  return {
    id,
    path,
    sha256: sha256(raw),
    status: missingTerms.length === 0 ? "verified" : "blocked",
    requiredTermsPresent,
    missingTerms,
    verified: missingTerms.length === 0
  };
}

function inspectTelemetry(raw: string, telemetry: Record<string, any>) {
  const activeBetaRisks = Array.isArray(telemetry.failureTelemetry?.activeBetaRisks) ? telemetry.failureTelemetry.activeBetaRisks : [];
  const explicitlyOpen = Array.isArray(telemetry.scope?.explicitlyOpen) ? telemetry.scope.explicitlyOpen.map(String) : [];
  const gates = Array.isArray(telemetry.gates) ? telemetry.gates.map(String) : [];
  const status = telemetry.status === "verified"
    && gates.includes("AL10-13")
    && explicitlyOpen.includes("AL10-14")
    && explicitlyOpen.includes("AL10-15")
    && explicitlyOpen.includes("AL10-16")
    && explicitlyOpen.includes("AL10-GA-1")
    && telemetry.failureTelemetry?.hookEnqueueP95AboveBetaBudget === true
    && activeBetaRisks.some((risk: any) => risk?.id === "hook-enqueue-p95-beta-budget")
    ? "verified"
    : "blocked";
  return {
    id: "al10-telemetry",
    path: TELEMETRY_PATH,
    sha256: sha256(raw),
    schemaVersion: String(telemetry.schemaVersion ?? ""),
    status,
    gates,
    explicitlyOpen,
    hookEnqueueP95AboveBetaBudget: telemetry.failureTelemetry?.hookEnqueueP95AboveBetaBudget === true,
    activeBetaRisks: activeBetaRisks.map((risk: any) => ({
      id: String(risk?.id ?? ""),
      severity: String(risk?.severity ?? ""),
      metric: String(risk?.metric ?? ""),
      actualMs: numberValue(risk?.actualMs),
      budgetMs: numberValue(risk?.budgetMs)
    })),
    missingTerms: [],
    verified: status === "verified"
  };
}

function buildDecision(telemetry: Record<string, any>) {
  const telemetryRisks = Array.isArray(telemetry.failureTelemetry?.activeBetaRisks) ? telemetry.failureTelemetry.activeBetaRisks : [];
  const hookRisk = telemetryRisks.find((risk: any) => risk?.id === "hook-enqueue-p95-beta-budget");
  const unresolvedRisks = [
    {
      id: "missing-beta-user-interviews",
      severity: "promotion-blocker",
      sourceGate: "AL10-14",
      detail: "No real beta-user interview evidence is present for whether Book answers replace manual filesystem browsing."
    },
    {
      id: "missing-independent-review-approval",
      severity: "promotion-blocker",
      sourceGate: "AL10-15",
      detail: "The policy now requires an independent reviewer, but no approval artifact is recorded under docs/approvals/."
    },
    {
      id: "hook-enqueue-p95-beta-budget",
      severity: "tracked-beta-risk",
      sourceGate: "AL10-13",
      metric: "hookEnqueueP95Ms",
      actualMs: numberValue(hookRisk?.actualMs),
      budgetMs: numberValue(hookRisk?.budgetMs),
      detail: "Telemetry carries forward the hook enqueue p95 over-budget risk."
    },
    {
      id: "ga-gates-open",
      severity: "promotion-blocker",
      sourceGate: "AL10-GA",
      detail: "AL10-GA-1 through AL10-GA-7 remain explicitly open."
    }
  ];
  return {
    decision: "NO-GO",
    scope: "ledger-authoritative-promotion-and-enforcement-enablement",
    advisoryLocalOptInAllowed: true,
    promotionAllowed: false,
    enforcementEnablementAllowed: false,
    productInterviewEvidenceStatus: "missing",
    independentReviewStatus: "required-not-yet-approved",
    reasonCount: unresolvedRisks.length,
    unresolvedRisks,
    openGates: [...EXPLICITLY_OPEN],
    evidence: {
      telemetryPath: TELEMETRY_PATH,
      policyPath: POLICY_PATH,
      authorityMatrixPath: AUTHORITY_MATRIX_PATH,
      adrPath: ADR_0040_PATH
    }
  };
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
    "# Architecture Ledger AL10 Beta Decision Readback",
    "",
    "## Scope",
    "",
    "- Closes: AL10-15 and AL10-16 only.",
    "- Keeps open: AL10-14 beta-user interviews and AL10-GA-1 through AL10-GA-7.",
    "- Decision: NO-GO for ledger-authoritative promotion and enforcement enablement.",
    "- Allowed boundary: local opt-in advisory beta/readback may continue.",
    "",
    "## Source Readbacks",
    "",
    "| Source | Status | Verified |",
    "| --- | --- | --- |",
    ...packet.sourceReadbacks.map((source: any) => `| ${source.id} | ${source.status} | ${source.verified ? "yes" : "no"} |`),
    "",
    "## Independent Reviewer Requirement",
    "",
    `- Policy path: ${POLICY_PATH}`,
    "- Requires a human independent reviewer before authority promotion or enforcement enablement.",
    "- Approval must be recorded under `docs/approvals/` and cannot be self-attested by automation, subagents, or the patch author.",
    "",
    "## Final Decision",
    "",
    `- Decision: ${packet.decision.decision}`,
    `- Advisory local opt-in allowed: ${packet.decision.advisoryLocalOptInAllowed ? "yes" : "no"}`,
    `- Ledger-authoritative promotion allowed: ${packet.decision.promotionAllowed ? "yes" : "no"}`,
    `- Enforcement enablement allowed: ${packet.decision.enforcementEnablementAllowed ? "yes" : "no"}`,
    "",
    "## Unresolved Risks",
    "",
    ...packet.decision.unresolvedRisks.map((risk: any) => `- ${risk.id}: ${risk.detail}`),
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
    return `[architecture-ledger-al10-beta-decision-readback] OK decision=${result.decision.decision} gates=AL10-15,AL10-16`;
  }
  return `[architecture-ledger-al10-beta-decision-readback] FAILED\n${result.failures.map((failure: string) => `- ${failure}`).join("\n")}`;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readText(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
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

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}
