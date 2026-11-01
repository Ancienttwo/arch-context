#!/usr/bin/env bun
// Inspect-only readback for the closed AL10-15/AL10-16 beta decision gates.
//
// The gates were closed once and their evidence is recorded under docs/verification/. The
// policy input of the recorded run (the promotion-review document) no longer exists, so the
// run/record mode was retired (#434): a re-record could only fail deterministically against
// the recorded packet. inspect validates the recorded evidence packet as it stands.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al10-beta-decision-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al10-beta-decision-readback.json";
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

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command !== "inspect") {
    console.error("[architecture-ledger-al10-beta-decision-readback] usage: inspect [--evidence path] [--json]; run mode was retired (#434)");
    process.exit(2);
  }
  const result = inspectArchitectureLedgerAl10BetaDecisionReadback(
    JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
  );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
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

function renderHuman(result: any): string {
  if (result.ok) {
    return `[architecture-ledger-al10-beta-decision-readback] OK decision=${result.decision.decision} gates=AL10-15,AL10-16`;
  }
  return `[architecture-ledger-al10-beta-decision-readback] FAILED\n${result.failures.map((failure: string) => `- ${failure}`).join("\n")}`;
}

function sameStringSet(actual: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(actual)) return false;
  return [...new Set(actual)].sort().join(",") === [...expected].sort().join(",");
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}
