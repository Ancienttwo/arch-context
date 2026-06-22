#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_INPUT = "_ops/env/fg6-rollout-evidence.json";
const DEFAULT_OUTPUT = "docs/verification/fg6-rollout-readback.json";
const DEFAULT_REPORT = "docs/verification/fg6-rollout-evidence-intake.md";
const HOME_URL = "https://archcontext.repoharness.com";
const EXPECTED_PHASES = ["internal", "design-partners", "opt-in-beta"] as const;
const MISSING_P95_MS = 9_999_999_999;
const SECRET_PATTERNS = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /secret:\/\//i,
  /privateKey/i,
  /webhookSecret/i
] as const;
const CODE_CONTENT_PATTERNS = [
  /diff\s+--git/i,
  /^@@\s/m,
  /"patch"\s*:/i,
  /"sourceBody"\s*:/i,
  /"diffBody"\s*:/i,
  /"fileName"\s*:/i,
  /"sourcePath"\s*:/i,
  /\/contents(?:\/|\b)/i,
  /\/git\/blobs(?:\/|\b)/i,
  /\/git\/trees(?:\/|\b)/i,
  /\/pulls\/\d+\/files/i,
  /application\/vnd\.github\.(?:v3\.)?(?:diff|patch)/i
] as const;

type PhaseId = (typeof EXPECTED_PHASES)[number];

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildFg6RolloutReadbackConfig(process.env, args);
    const result = await runFg6RolloutReadback(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg6RolloutReadback(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "template") {
    process.stdout.write(`${JSON.stringify(rolloutEvidenceTemplate(), null, 2)}\n`);
  } else {
    console.error("[fg6-rollout-readback] usage: run|inspect|template [--input path] [--out path] [--report path] [--json]");
    process.exit(2);
  }
}

export function buildFg6RolloutReadbackConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    inputPath: readFlag(args, "--input") ?? env.ARCHCONTEXT_FG6_ROLLOUT_INPUT ?? DEFAULT_INPUT,
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG6_ROLLOUT_OUTPUT ?? DEFAULT_OUTPUT,
    reportPath: readFlag(args, "--report") ?? env.ARCHCONTEXT_FG6_ROLLOUT_REPORT ?? DEFAULT_REPORT,
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg6RolloutReadback(config: ReturnType<typeof buildFg6RolloutReadbackConfig>) {
  let recording: ReturnType<typeof buildRolloutReadback>;
  try {
    const packet = JSON.parse(await readFile(resolve(config.root, config.inputPath), "utf8")) as unknown;
    recording = buildRolloutReadback(packet, config);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    recording = buildMissingRolloutReadback(config);
  }
  await writeText(config.root, config.reportPath, renderReport(recording));
  await writeJson(config.root, config.outputPath, recording);
  return recording;
}

export function buildMissingRolloutReadback(
  config: Pick<ReturnType<typeof buildFg6RolloutReadbackConfig>, "inputPath" | "reportPath" | "generatedAt">
) {
  const recording = {
    schemaVersion: "archcontext.fg6-rollout-readback/v1",
    taskId: "FG6-18",
    environment: "production-rollout",
    status: "verified",
    ok: true,
    generatedAt: config.generatedAt(),
    sources: {
      inputPath: config.inputPath,
      reportPath: config.reportPath,
      homeUrl: HOME_URL
    },
    evidence: {
      phases: [] as ReturnType<typeof summarizePhase>[],
      metrics: summarizeMetrics({}),
      controls: summarizeControls({}),
      assertions: {
        productionEvidence: false,
        homeUrlCorrect: true,
        phaseSequenceComplete: false,
        phaseTimelineOrdered: false,
        cohortsNonEmpty: false,
        designPartnerEvidencePresent: false,
        optInBetaEvidencePresent: false,
        zeroP0P1Incidents: false,
        noPrivacyOrWrongPassIncidents: false,
        sloWithinBudget: false,
        controlsPreserveSecurity: false,
        noPrivateContent: true
      }
    },
    failures: [] as string[]
  };
  const inspection = inspectFg6RolloutReadback(recording);
  recording.status = "blocked";
  recording.ok = false;
  recording.failures = [`source packet missing: ${config.inputPath}`, ...inspection.failures];
  return recording;
}

export function buildRolloutReadback(
  packet: unknown,
  config: Pick<ReturnType<typeof buildFg6RolloutReadbackConfig>, "inputPath" | "reportPath" | "generatedAt">
) {
  const source = readRecord(packet);
  const phases = readArray(source.phases).map(summarizePhase);
  const metrics = summarizeMetrics(readRecord(source.metrics));
  const controls = summarizeControls(readRecord(source.controls));
  const assertions = {
    productionEvidence: source.evidenceClass === "E4" && source.environment === "production-rollout",
    homeUrlCorrect: source.homeUrl === HOME_URL,
    phaseSequenceComplete: hasExpectedPhaseSequence(phases),
    phaseTimelineOrdered: hasOrderedTimeline(phases),
    cohortsNonEmpty: phases.every((phase) => phase.installations >= 1),
    designPartnerEvidencePresent: metrics.designPartnerInstallations >= 1 && metrics.designPartnerObservationDays >= 1,
    optInBetaEvidencePresent: metrics.optInBetaInstallations >= 1,
    zeroP0P1Incidents: metrics.p0Incidents === 0 && metrics.p1Incidents === 0,
    noPrivacyOrWrongPassIncidents: metrics.privacyIncidents === 0
      && metrics.sourceContentLeaks === 0
      && metrics.wrongTrustPasses === 0,
    sloWithinBudget: metrics.requiredCheckSuccessRate >= 0.995
      && metrics.checkDeliveryP95Ms <= 60000
      && metrics.webhookP95Ms <= 2000,
    controlsPreserveSecurity: Object.values(controls).every((value) => value === true),
    noPrivateContent: scanPatterns(JSON.stringify(packet), SECRET_PATTERNS) === 0
      && scanPatterns(JSON.stringify(packet), CODE_CONTENT_PATTERNS) === 0
  };
  const recording = {
    schemaVersion: "archcontext.fg6-rollout-readback/v1",
    taskId: "FG6-18",
    environment: "production-rollout",
    status: "verified",
    ok: true,
    generatedAt: config.generatedAt(),
    sources: {
      inputPath: config.inputPath,
      reportPath: config.reportPath,
      homeUrl: HOME_URL
    },
    evidence: {
      phases,
      metrics,
      controls,
      assertions
    },
    failures: [] as string[]
  };
  const inspection = inspectFg6RolloutReadback(recording);
  recording.status = inspection.ok ? "verified" : "blocked";
  recording.ok = inspection.ok;
  recording.failures = inspection.failures;
  return recording;
}

export function inspectFg6RolloutReadback(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const phases = readArray(evidence.phases).map(readRecord);
  const metrics = summarizeMetrics(readRecord(evidence.metrics));
  const controls = summarizeControls(readRecord(evidence.controls));
  const assertions = readRecord(evidence.assertions);

  if (record.schemaVersion !== "archcontext.fg6-rollout-readback/v1") failures.push("schemaVersion mismatch");
  if (record.taskId !== "FG6-18") failures.push("taskId must be FG6-18");
  if (record.environment !== "production-rollout") failures.push("environment must be production-rollout");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  if (readRecord(record.sources).homeUrl !== HOME_URL) failures.push("homeUrl must be archcontext.repoharness.com");
  if (!hasExpectedPhaseSequence(phases)) failures.push("rollout phases must be internal -> design-partners -> opt-in-beta");
  if (!hasOrderedTimeline(phases)) failures.push("rollout phase timestamps must be ordered");
  if (!phases.every((phase) => phase.status === "completed")) failures.push("all rollout phases must be completed");
  if (!phases.every((phase) => typeof phase.installations === "number" && phase.installations >= 1)) {
    failures.push("all rollout cohorts must have at least one installation");
  }
  if (metrics.designPartnerInstallations < 1 || metrics.designPartnerObservationDays < 1) {
    failures.push("design partner rollout evidence is missing");
  }
  if (metrics.optInBetaInstallations < 1) failures.push("opt-in beta rollout evidence is missing");
  if (metrics.p0Incidents !== 0 || metrics.p1Incidents !== 0) failures.push("P0/P1 incidents must be zero");
  if (metrics.privacyIncidents !== 0 || metrics.sourceContentLeaks !== 0) failures.push("privacy incidents and source leaks must be zero");
  if (metrics.wrongTrustPasses !== 0) failures.push("wrong-trust passes must be zero");
  if (metrics.requiredCheckSuccessRate < 0.995) failures.push("required check success rate below target");
  if (metrics.checkDeliveryP95Ms > 60000) failures.push("Check delivery p95 exceeds PRD budget");
  if (metrics.webhookP95Ms > 2000) failures.push("webhook p95 exceeds PRD budget");
  for (const [key, value] of Object.entries(controls)) {
    if (value !== true) failures.push(`rollout control missing: ${key}`);
  }
  for (const [key, value] of Object.entries(assertions)) {
    if (value !== true) failures.push(`assertion ${key} must be true`);
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

export function rolloutEvidenceTemplate() {
  return {
    schemaVersion: "archcontext.fg6-rollout-source/v1",
    taskId: "FG6-18",
    evidenceClass: "DRAFT",
    environment: "production-rollout",
    homeUrl: HOME_URL,
    phases: EXPECTED_PHASES.map((id) => ({
      id,
      status: "pending",
      startedAt: "",
      endedAt: "",
      installations: 0,
      enabledFlags: {
        developerCheck: true,
        organizationCheck: true,
        requiredTrust: true
      }
    })),
    metrics: {
      designPartnerInstallations: 0,
      designPartnerObservationDays: 0,
      optInBetaInstallations: 0,
      p0Incidents: 0,
      p1Incidents: 0,
      privacyIncidents: 0,
      sourceContentLeaks: 0,
      wrongTrustPasses: 0,
      requiredCheckSuccessRate: 0,
      checkDeliveryP95Ms: MISSING_P95_MS,
      webhookP95Ms: MISSING_P95_MS
    },
    controls: {
      featureFlagsDoNotBypassPrivacy: false,
      featureFlagsDoNotBypassSignature: false,
      privacyContractGreen: false,
      signatureVerificationGreen: false,
      rollbackPlanReady: false,
      supportRunbookReady: false
    }
  };
}

export function verifiedRolloutEvidenceFixture() {
  return {
    schemaVersion: "archcontext.fg6-rollout-source/v1",
    taskId: "FG6-18",
    evidenceClass: "E4",
    environment: "production-rollout",
    homeUrl: HOME_URL,
    phases: EXPECTED_PHASES.map((id, index) => ({
      id,
      status: "completed",
      startedAt: `2026-06-2${index}T00:00:00.000Z`,
      endedAt: `2026-06-2${index}T01:00:00.000Z`,
      installations: 1,
      enabledFlags: {
        developerCheck: true,
        organizationCheck: true,
        requiredTrust: true
      }
    })),
    metrics: {
      designPartnerInstallations: 1,
      designPartnerObservationDays: 1,
      optInBetaInstallations: 1,
      p0Incidents: 0,
      p1Incidents: 0,
      privacyIncidents: 0,
      sourceContentLeaks: 0,
      wrongTrustPasses: 0,
      requiredCheckSuccessRate: 1,
      checkDeliveryP95Ms: 40000,
      webhookP95Ms: 1000
    },
    controls: {
      featureFlagsDoNotBypassPrivacy: true,
      featureFlagsDoNotBypassSignature: true,
      privacyContractGreen: true,
      signatureVerificationGreen: true,
      rollbackPlanReady: true,
      supportRunbookReady: true
    }
  };
}

function summarizePhase(value: unknown) {
  const phase = readRecord(value);
  return {
    id: String(phase.id ?? ""),
    status: String(phase.status ?? ""),
    startedAt: String(phase.startedAt ?? ""),
    endedAt: String(phase.endedAt ?? ""),
    installations: Number(phase.installations ?? 0),
    enabledFlags: {
      developerCheck: readRecord(phase.enabledFlags).developerCheck === true,
      organizationCheck: readRecord(phase.enabledFlags).organizationCheck === true,
      requiredTrust: readRecord(phase.enabledFlags).requiredTrust === true
    }
  };
}

function summarizeMetrics(metrics: Record<string, unknown>) {
  return {
    designPartnerInstallations: Number(metrics.designPartnerInstallations ?? 0),
    designPartnerObservationDays: Number(metrics.designPartnerObservationDays ?? 0),
    optInBetaInstallations: Number(metrics.optInBetaInstallations ?? 0),
    p0Incidents: Number(metrics.p0Incidents ?? 0),
    p1Incidents: Number(metrics.p1Incidents ?? 0),
    privacyIncidents: Number(metrics.privacyIncidents ?? 0),
    sourceContentLeaks: Number(metrics.sourceContentLeaks ?? 0),
    wrongTrustPasses: Number(metrics.wrongTrustPasses ?? 0),
    requiredCheckSuccessRate: Number(metrics.requiredCheckSuccessRate ?? 0),
    checkDeliveryP95Ms: Number(metrics.checkDeliveryP95Ms ?? MISSING_P95_MS),
    webhookP95Ms: Number(metrics.webhookP95Ms ?? MISSING_P95_MS)
  };
}

function summarizeControls(controls: Record<string, unknown>) {
  return {
    featureFlagsDoNotBypassPrivacy: controls.featureFlagsDoNotBypassPrivacy === true,
    featureFlagsDoNotBypassSignature: controls.featureFlagsDoNotBypassSignature === true,
    privacyContractGreen: controls.privacyContractGreen === true,
    signatureVerificationGreen: controls.signatureVerificationGreen === true,
    rollbackPlanReady: controls.rollbackPlanReady === true,
    supportRunbookReady: controls.supportRunbookReady === true
  };
}

function hasExpectedPhaseSequence(phases: Array<Record<string, unknown>>) {
  return phases.length === EXPECTED_PHASES.length
    && EXPECTED_PHASES.every((phase, index) => phases[index]?.id === phase)
    && phases.every((phase) => phase.status === "completed")
    && phases.every((phase) => readRecord(phase.enabledFlags).developerCheck === true
      && readRecord(phase.enabledFlags).organizationCheck === true
      && readRecord(phase.enabledFlags).requiredTrust === true);
}

function hasOrderedTimeline(phases: Array<Record<string, unknown>>) {
  if (phases.length !== EXPECTED_PHASES.length) return false;
  let previousEnd = 0;
  for (const phase of phases) {
    const started = Date.parse(String(phase.startedAt ?? ""));
    const ended = Date.parse(String(phase.endedAt ?? ""));
    if (!Number.isFinite(started) || !Number.isFinite(ended)) return false;
    if (started > ended || started < previousEnd) return false;
    previousEnd = ended;
  }
  return true;
}

function renderHuman(recording: ReturnType<typeof buildRolloutReadback>) {
  return recording.ok
    ? `FG6-18 rollout readback verified: phases=${recording.evidence.phases.length}`
    : `FG6-18 rollout readback blocked:\n- ${recording.failures.join("\n- ")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }) {
  return result.ok ? "FG6-18 rollout readback verified" : `FG6-18 rollout readback failed:\n- ${result.failures.join("\n- ")}`;
}

function renderReport(recording: ReturnType<typeof buildRolloutReadback>) {
  return `# FG6-18 Rollout Evidence Intake

- Task: FG6-18
- Environment: production-rollout
- Home URL: ${HOME_URL}
- Generated At: ${recording.generatedAt}
- Status: ${recording.status}

## Required Source Packet

Place the no-secret production rollout packet at \`${DEFAULT_INPUT}\`, then run:

\`\`\`bash
bun run readback:fg6:rollout
\`\`\`

The packet must prove the ordered rollout path \`internal -> design-partners -> opt-in-beta\`, at least one design partner installation, at least one opt-in beta installation, zero P0/P1 incidents, zero privacy incidents, zero source-content leaks, zero wrong-trust passes, and SLO observations within PRD budgets.

## Current Decision

${recording.ok ? "PASS for FG6-18 rollout readback." : `BLOCKED for FG6-18 rollout readback.\n\n${recording.failures.map((failure) => `- ${failure}`).join("\n")}`}
`;
}

function readFlag(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function scanPatterns(text: string, patterns: readonly RegExp[]) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function isMissingFileError(error: unknown) {
  return readRecord(error).code === "ENOENT";
}

async function writeText(root: string, path: string, content: string) {
  const absolutePath = resolve(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

async function writeJson(root: string, path: string, value: unknown) {
  await writeText(root, path, `${JSON.stringify(value, null, 2)}\n`);
}
