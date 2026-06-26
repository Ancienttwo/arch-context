#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { digestJson, type Json } from "@archcontext/contracts";

const ROOT = resolve(import.meta.dir, "..");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al10-runbooks-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al10-runbooks-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al10-runbooks.md";
const RUNBOOK_PATH = "docs/runbooks/architecture-ledger-operations.md";
const GATES = ["AL10-12"] as const;
const EXPLICITLY_OPEN = [
  "AL10-13",
  "AL10-14",
  "AL10-15",
  "AL10-16",
  "AL10-GA-1",
  "AL10-GA-2",
  "AL10-GA-3",
  "AL10-GA-4",
  "AL10-GA-5",
  "AL10-GA-6",
  "AL10-GA-7"
] as const;

const SOURCE_EVIDENCE = [
  {
    id: "rollout-workflow",
    path: "docs/verification/architecture-ledger-al10-rollout-workflow-readback.json",
    requiredTerms: ["writeVerified", "rollbackCommand", "safeDowngradeEnvironmentYaml"]
  },
  {
    id: "hardening",
    path: "docs/verification/architecture-ledger-al10-hardening-readback.json",
    requiredTerms: ["privacy", "rollback", "stress"]
  },
  {
    id: "chaos-security",
    path: "docs/verification/architecture-ledger-al10-chaos-security-readback.json",
    requiredTerms: ["chaos", "security", "stale"]
  },
  {
    id: "release-packaging",
    path: "docs/verification/architecture-ledger-al10-release-packaging-readback.json",
    requiredTerms: ["releasePackage", "migrationMatrix", "AL10-11"]
  },
  {
    id: "agent-comparison",
    path: "docs/verification/architecture-ledger-al10-agent-comparison-readback.json",
    requiredTerms: ["deterministicPlusAgent", "advisoryOnly", "costComparison"]
  }
] as const;

const RUNBOOK_SECTIONS = [
  {
    id: "incident",
    title: "Incident",
    requiredTerms: [
      "Signal:",
      "Triage:",
      "Containment:",
      "Remediation:",
      "Verification:",
      "archctx doctor --json",
      "archctx ledger drift --json",
      "bun run readback:al10:chaos-security",
      "archctx privacy-audit",
      "source bodies"
    ]
  },
  {
    id: "corruption-recovery",
    title: "Corruption Recovery",
    requiredTerms: [
      "Signal:",
      "Triage:",
      "Containment:",
      "Remediation:",
      "Verification:",
      "runtime.sqlite",
      "Do not edit SQLite",
      "archctx ledger rebuild --from-git --expected-worktree-digest <current>",
      "archctx ledger rebuild --from-git --accept-external-projection --expected-worktree-digest <current>",
      "bun run readback:al10:release-packaging"
    ]
  },
  {
    id: "drift-recovery",
    title: "Drift Recovery",
    requiredTerms: [
      "Signal:",
      "Triage:",
      "Decision:",
      "Remediation from reviewed Git:",
      "Remediation from reviewed ledger:",
      "Verification:",
      "archctx ledger project --to-git --dry-run",
      "archctx ledger project --to-git --write --expected-worktree-digest <current>",
      "archctx docs apply --approved",
      "archctx complete"
    ]
  },
  {
    id: "provider-disable",
    title: "Provider Disable",
    requiredTerms: [
      "Signal:",
      "Triage:",
      "Containment:",
      "Remediation:",
      "Verification:",
      "ARCHCONTEXT_CONTEXT7_ENABLED=0",
      "archctx docs purge --all",
      "unset OPENAI_API_KEY",
      "archctx investigate --runner-port fake-provider",
      "advisory-only"
    ]
  },
  {
    id: "full-rollback",
    title: "Full Rollback",
    requiredTerms: [
      "Signal:",
      "Triage:",
      "Rollback:",
      "Post-rollback rebuild:",
      "Verification:",
      "ARCHCONTEXT_LEDGER_MODE=yaml",
      "ARCHCONTEXT_LEDGER_READ_MODE=yaml",
      "ARCHCONTEXT_LEDGER_WRITE_MODE=yaml",
      "archctx ledger rollback --to-yaml --write --expected-worktree-digest <current>",
      ".archcontext/backups/ledger-rollback/"
    ]
  }
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
    console.error("[architecture-ledger-al10-runbooks-readback] usage: run|inspect [--out path] [--report path] [--evidence path] [--json]");
    process.exit(2);
  }
  const result = command === "run"
    ? runArchitectureLedgerAl10RunbooksReadback({
        outPath: readFlag(args, "--out") ?? DEFAULT_OUT,
        reportPath: readFlag(args, "--report") ?? DEFAULT_REPORT
      })
    : inspectArchitectureLedgerAl10RunbooksReadback(
        JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
      );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export function runArchitectureLedgerAl10RunbooksReadback({
  outPath = DEFAULT_OUT,
  reportPath = DEFAULT_REPORT
} = {}) {
  const packet = buildArchitectureLedgerAl10RunbooksPacket();
  const inspected = inspectArchitectureLedgerAl10RunbooksReadback(packet);
  const finalPacket = {
    ...packet,
    status: inspected.ok ? "verified" : "failed",
    failures: inspected.failures
  };
  writeJson(outPath, finalPacket);
  writeText(reportPath, renderReport(finalPacket));
  return inspectArchitectureLedgerAl10RunbooksReadback(finalPacket);
}

export function buildArchitectureLedgerAl10RunbooksPacket() {
  const runbook = readText(RUNBOOK_PATH);
  const sectionCoverage = RUNBOOK_SECTIONS.map((section) => inspectRunbookSection(runbook, section));
  const sourceReadbacks = SOURCE_EVIDENCE.map((source) => inspectSourceEvidence(source));
  const privacy = inspectPrivacy(runbook);
  const assertions = {
    "AL10-12": sectionCoverage.every((section) => section.complete)
      && sourceReadbacks.every((source) => source.verified)
      && privacy.clean,
    allRunbookSectionsPresent: sectionCoverage.every((section) => section.present),
    allRunbookSectionsActionable: sectionCoverage.every((section) => section.complete),
    sourceEvidenceVerified: sourceReadbacks.every((source) => source.verified),
    incidentCoversPrivacyStop: sectionCoverage.find((section) => section.id === "incident")?.requiredTermsPresent.includes("archctx privacy-audit") === true,
    corruptionKeepsGitAsRebuildBoundary: sectionCoverage.find((section) => section.id === "corruption-recovery")?.requiredTermsPresent.includes("archctx ledger rebuild --from-git --expected-worktree-digest <current>") === true,
    driftHasBothDirections: sectionCoverage.find((section) => section.id === "drift-recovery")?.requiredTermsPresent.includes("archctx ledger project --to-git --write --expected-worktree-digest <current>") === true,
    providerDisableKeepsLocalCore: sectionCoverage.find((section) => section.id === "provider-disable")?.requiredTermsPresent.includes("ARCHCONTEXT_CONTEXT7_ENABLED=0") === true,
    fullRollbackReturnsYaml: sectionCoverage.find((section) => section.id === "full-rollback")?.requiredTermsPresent.includes("ARCHCONTEXT_LEDGER_MODE=yaml") === true,
    noPrivateContent: privacy.clean
  };
  const runbookDigest = sha256(runbook);
  const readbackDigest = digestJson({
    schemaVersion: SCHEMA_VERSION,
    runbookDigest,
    sectionCoverage,
    sourceReadbacks,
    privacy,
    assertions
  } as unknown as Json);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(0).toISOString(),
    gates: [...GATES],
    status: "verified",
    scope: {
      repo: "architecture-ledger-operations-runbooks",
      authority: "docs/runbooks plus prior AL10 readback evidence",
      closedGates: [...GATES],
      explicitlyOpen: [...EXPLICITLY_OPEN]
    },
    sources: {
      runbookPath: RUNBOOK_PATH,
      sourceEvidence: SOURCE_EVIDENCE.map(({ id, path }) => ({ id, path }))
    },
    runbook: {
      path: RUNBOOK_PATH,
      sha256: runbookDigest,
      bytes: Buffer.byteLength(runbook, "utf8")
    },
    sectionCoverage,
    sourceReadbacks,
    privacy,
    readbackDigest,
    assertions,
    readback: {
      command: `bun scripts/architecture-ledger-al10-runbooks-readback.ts inspect --evidence ${DEFAULT_OUT} --json`,
      recordCommand: `bun scripts/architecture-ledger-al10-runbooks-readback.ts run --out ${DEFAULT_OUT} --report ${DEFAULT_REPORT} --json`,
      reportPath: DEFAULT_REPORT
    },
    failures: [] as string[]
  };
}

export function inspectArchitectureLedgerAl10RunbooksReadback(packet: any) {
  const failures: string[] = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return { ok: false, status: "failed", failures: ["packet must be an object"], gates: {} };
  }
  if (packet.schemaVersion !== SCHEMA_VERSION) failures.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (packet.status !== undefined && packet.status !== "verified") failures.push("status must be verified");
  if (!sameStringSet(packet.gates, GATES)) failures.push("gates must be exactly AL10-12");
  if (!sameStringSet(packet.scope?.closedGates, GATES)) failures.push("scope.closedGates must be exactly AL10-12");
  if (!Array.isArray(packet.scope?.explicitlyOpen) || !packet.scope.explicitlyOpen.includes("AL10-13")) failures.push("scope.explicitlyOpen must keep AL10-13 open");
  if (!packet.readbackDigest || typeof packet.readbackDigest !== "string") failures.push("readbackDigest must be present");

  inspectSections(packet.sectionCoverage, failures);
  inspectSources(packet.sourceReadbacks, failures);
  inspectPrivacyPacket(packet.privacy, failures);
  inspectAssertions(packet.assertions, failures);

  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? "verified" : "failed",
    failures,
    gates: Object.fromEntries(GATES.map((gate) => [gate, packet.assertions?.[gate] === true ? "verified" : "blocked"])),
    runbookSections: Array.isArray(packet.sectionCoverage) ? packet.sectionCoverage.length : 0,
    sourceReadbacks: Array.isArray(packet.sourceReadbacks) ? packet.sourceReadbacks.length : 0
  };
}

function inspectRunbookSection(runbook: string, section: typeof RUNBOOK_SECTIONS[number]) {
  const body = sectionBody(runbook, section.id);
  const requiredTermsPresent = section.requiredTerms.filter((term) => body.includes(term));
  const missingTerms = section.requiredTerms.filter((term) => !body.includes(term));
  const hasCommandBlock = /```bash\n[\s\S]*?\n```/.test(body);
  return {
    id: section.id,
    title: section.title,
    present: body.length > 0,
    hasSignal: body.includes("Signal:"),
    hasTriage: body.includes("Triage:"),
    hasVerification: body.includes("Verification:"),
    hasCommandBlock,
    requiredTermsPresent,
    missingTerms,
    complete: body.length > 0
      && body.includes("Signal:")
      && body.includes("Triage:")
      && body.includes("Verification:")
      && hasCommandBlock
      && missingTerms.length === 0
  };
}

function inspectSourceEvidence(source: typeof SOURCE_EVIDENCE[number]) {
  const parsed = readJson(source.path);
  const serialized = JSON.stringify(parsed);
  const status = String(parsed.status ?? "");
  const ok = parsed.ok === undefined ? status === "verified" : parsed.ok === true;
  return {
    id: source.id,
    path: source.path,
    schemaVersion: String(parsed.schemaVersion ?? ""),
    status,
    ok,
    requiredTermsPresent: source.requiredTerms.filter((term) => serialized.includes(term)),
    missingTerms: source.requiredTerms.filter((term) => !serialized.includes(term)),
    verified: status === "verified" && ok && source.requiredTerms.every((term) => serialized.includes(term))
  };
}

function inspectPrivacy(runbook: string) {
  const secretHits = SECRET_PATTERNS.filter((pattern) => pattern.test(runbook)).map(String);
  const rawContentHits = RAW_CONTENT_PATTERNS.filter((pattern) => pattern.test(runbook)).map(String);
  return {
    forbiddenSecretHitCount: secretHits.length,
    forbiddenRawContentHitCount: rawContentHits.length,
    secretHits,
    rawContentHits,
    clean: secretHits.length === 0 && rawContentHits.length === 0
  };
}

function inspectSections(sections: any, failures: string[]): void {
  if (!Array.isArray(sections)) {
    failures.push("sectionCoverage must be an array");
    return;
  }
  if (sections.length !== RUNBOOK_SECTIONS.length) failures.push(`sectionCoverage must include ${RUNBOOK_SECTIONS.length} runbooks`);
  for (const expected of RUNBOOK_SECTIONS) {
    const actual = sections.find((section: any) => section?.id === expected.id);
    if (!actual) {
      failures.push(`runbook section missing: ${expected.id}`);
      continue;
    }
    if (actual.present !== true) failures.push(`${expected.id}: section must be present`);
    if (actual.hasSignal !== true) failures.push(`${expected.id}: Signal is required`);
    if (actual.hasTriage !== true) failures.push(`${expected.id}: Triage is required`);
    if (actual.hasVerification !== true) failures.push(`${expected.id}: Verification is required`);
    if (actual.hasCommandBlock !== true) failures.push(`${expected.id}: bash command block is required`);
    if (Array.isArray(actual.missingTerms) && actual.missingTerms.length > 0) failures.push(`${expected.id}: missing terms ${actual.missingTerms.join(",")}`);
    if (actual.complete !== true) failures.push(`${expected.id}: runbook section must be complete`);
  }
}

function inspectSources(sources: any, failures: string[]): void {
  if (!Array.isArray(sources)) {
    failures.push("sourceReadbacks must be an array");
    return;
  }
  if (sources.length !== SOURCE_EVIDENCE.length) failures.push(`sourceReadbacks must include ${SOURCE_EVIDENCE.length} evidence sources`);
  for (const expected of SOURCE_EVIDENCE) {
    const actual = sources.find((source: any) => source?.id === expected.id);
    if (!actual) {
      failures.push(`source readback missing: ${expected.id}`);
      continue;
    }
    if (actual.status !== "verified") failures.push(`${expected.id}: source status must be verified`);
    if (actual.ok !== true) failures.push(`${expected.id}: source ok must be true`);
    if (Array.isArray(actual.missingTerms) && actual.missingTerms.length > 0) failures.push(`${expected.id}: missing evidence terms ${actual.missingTerms.join(",")}`);
    if (actual.verified !== true) failures.push(`${expected.id}: source readback must be verified`);
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

function inspectAssertions(assertions: Record<string, unknown> | undefined, failures: string[]): void {
  if (!assertions || typeof assertions !== "object") {
    failures.push("assertions must be present");
    return;
  }
  const allowed = new Set([
    ...GATES,
    "allRunbookSectionsPresent",
    "allRunbookSectionsActionable",
    "sourceEvidenceVerified",
    "incidentCoversPrivacyStop",
    "corruptionKeepsGitAsRebuildBoundary",
    "driftHasBothDirections",
    "providerDisableKeepsLocalCore",
    "fullRollbackReturnsYaml",
    "noPrivateContent"
  ]);
  for (const key of Object.keys(assertions)) {
    if (!allowed.has(key)) failures.push(`unexpected gate assertion: ${key}`);
  }
  for (const key of allowed) {
    if (assertions[key] !== true) failures.push(`assertions.${key} must be true`);
  }
}

function sectionBody(markdown: string, id: string): string {
  const heading = `## ${id}`;
  const start = markdown.indexOf(heading);
  if (start === -1) return "";
  const next = markdown.indexOf("\n## ", start + heading.length);
  return markdown.slice(start, next === -1 ? undefined : next);
}

function renderReport(packet: any): string {
  return [
    "# Architecture Ledger AL10 Runbooks Readback",
    "",
    "## Scope",
    "",
    "- Closes: AL10-12 only.",
    "- Keeps open: telemetry, product interviews, governance, Go/No-Go and GA gates.",
    "- Authority: `docs/runbooks/architecture-ledger-operations.md` plus prior AL10 readback evidence.",
    "",
    "## Runbook Coverage",
    "",
    "| Runbook | Complete | Missing terms |",
    "| --- | --- | --- |",
    ...packet.sectionCoverage.map((section: any) => `| ${section.id} | ${section.complete ? "yes" : "no"} | ${section.missingTerms.join(", ") || "-"} |`),
    "",
    "## Source Evidence",
    "",
    "| Evidence | Status | Verified | Missing terms |",
    "| --- | --- | --- | --- |",
    ...packet.sourceReadbacks.map((source: any) => `| ${source.id} | ${source.status} | ${source.verified ? "yes" : "no"} | ${source.missingTerms.join(", ") || "-"} |`),
    "",
    "## Privacy",
    "",
    `- Secret marker hits: ${packet.privacy.forbiddenSecretHitCount}`,
    `- Raw source/diff marker hits: ${packet.privacy.forbiddenRawContentHitCount}`,
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
  if (result.ok) return `[architecture-ledger-al10-runbooks-readback] OK runbookSections=${result.runbookSections} sourceReadbacks=${result.sourceReadbacks}`;
  return `[architecture-ledger-al10-runbooks-readback] FAILED\n${result.failures.map((failure: string) => `- ${failure}`).join("\n")}`;
}

function readText(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function readJson(path: string): Record<string, any> {
  return JSON.parse(readText(path)) as Record<string, any>;
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
