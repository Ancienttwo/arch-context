import { digestJson, type Json, type ProjectionTargetV1 } from "@archcontext/contracts";
import { REPO_HARNESS_PROJECTION_PROFILE } from "./layout";

export interface ArchitectureAdoptionCandidate {
  path: string;
  existingBody: string;
  renderedBody: string;
  target: ProjectionTargetV1;
}

export interface ArchitectureAdoptionPreservedRegion {
  kind: "prefix" | "suffix";
  start: number;
  end: number;
  digest: string;
}

export interface ArchitectureAdoptionFilePlan {
  path: string;
  targetId: string;
  targetRange: { start: number; end: number };
  preimageDigest: string;
  outputDigest: string;
  preservedRegions: ArchitectureAdoptionPreservedRegion[];
  body: string;
}

export interface ArchitectureDocumentationAdoptionPlan {
  schemaVersion: "archcontext.architecture-docs-adoption-plan/v1";
  profile: typeof REPO_HARNESS_PROJECTION_PROFILE;
  adoptionPlanId: string;
  changeSetId: string;
  expectedWorktreeDigest: string;
  allowed: boolean;
  issues: string[];
  files: ArchitectureAdoptionFilePlan[];
}

export function buildArchitectureDocumentationAdoptionPlan(input: {
  profile: typeof REPO_HARNESS_PROJECTION_PROFILE;
  expectedWorktreeDigest: string;
  candidates: ArchitectureAdoptionCandidate[];
}): ArchitectureDocumentationAdoptionPlan {
  const issues: string[] = [];
  const files: ArchitectureAdoptionFilePlan[] = [];
  for (const candidate of [...input.candidates].sort((left, right) => left.path.localeCompare(right.path))) {
    try {
      files.push(planCandidate(candidate));
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (input.candidates.length === 0) issues.push("projection-adoption-no-candidates");
  const identity = {
    profile: input.profile,
    expectedWorktreeDigest: input.expectedWorktreeDigest,
    files: files.map(({ path, targetId, targetRange, preimageDigest, outputDigest, preservedRegions }) => ({
      path,
      targetId,
      targetRange,
      preimageDigest,
      outputDigest,
      preservedRegions
    }))
  };
  const digest = digestJson(identity as unknown as Json).replace(/^sha256:/, "");
  return {
    schemaVersion: "archcontext.architecture-docs-adoption-plan/v1",
    profile: input.profile,
    adoptionPlanId: `adoption_plan.${digest}`,
    changeSetId: `changeset.docs-adoption-${digest.slice(0, 16)}`,
    expectedWorktreeDigest: input.expectedWorktreeDigest,
    allowed: issues.length === 0,
    issues,
    files
  };
}

export function architectureAdoptionReceipt(plan: ArchitectureDocumentationAdoptionPlan) {
  return {
    schemaVersion: "archcontext.architecture-docs-adoption-receipt/v1",
    profile: plan.profile,
    adoptionPlanId: plan.adoptionPlanId,
    changeSetId: plan.changeSetId,
    expectedWorktreeDigest: plan.expectedWorktreeDigest,
    files: plan.files.map(({ body: _body, ...file }) => file),
    receiptDigest: digestJson({
      profile: plan.profile,
      adoptionPlanId: plan.adoptionPlanId,
      changeSetId: plan.changeSetId,
      expectedWorktreeDigest: plan.expectedWorktreeDigest,
      files: plan.files.map(({ body: _body, ...file }) => file)
    } as unknown as Json)
  };
}

function planCandidate(candidate: ArchitectureAdoptionCandidate): ArchitectureAdoptionFilePlan {
  if (candidate.target.ownership !== "mixed") {
    throw new Error(`projection-adoption-target-not-mixed: ${candidate.path}`);
  }
  const wrapped = extractRenderedRegion(candidate);
  const targetRange = candidate.target.type === "entity-summary"
    ? entityAdoptionRange(candidate.path, candidate.existingBody)
    : { start: candidate.existingBody.length, end: candidate.existingBody.length };
  const prefix = candidate.existingBody.slice(0, targetRange.start);
  const suffix = candidate.existingBody.slice(targetRange.end);
  const separator = targetRange.start === candidate.existingBody.length && prefix.length > 0 && !prefix.endsWith("\n\n")
    ? (prefix.endsWith("\n") ? "\n" : "\n\n")
    : "";
  const body = `${prefix}${separator}${wrapped}${suffix}`;
  return {
    path: candidate.path,
    targetId: candidate.target.targetId,
    targetRange,
    preimageDigest: bodyDigest(candidate.existingBody),
    outputDigest: bodyDigest(body),
    preservedRegions: [
      { kind: "prefix", start: 0, end: prefix.length, digest: bytesDigest(prefix) },
      { kind: "suffix", start: targetRange.end, end: candidate.existingBody.length, digest: bytesDigest(suffix) }
    ],
    body
  };
}

function entityAdoptionRange(path: string, body: string): { start: number; end: number } {
  const title = matches(body, /^#\s+.+$/gm);
  const p1 = matches(body, /^##\s+1(?:[.：:]|\s).+$/gm);
  const p2 = matches(body, /^##\s+2(?:[.：:]|\s).+$/gm);
  const p3 = matches(body, /^##\s+3(?:[.：:]|\s).+$/gm);
  if (title.length !== 1 || p1.length !== 1 || p2.length !== 1 || p3.length !== 1) {
    throw new Error(`projection-adoption-heading-ambiguous: ${path}`);
  }
  const firstLineEnd = body.indexOf("\n", title[0].index);
  const start = firstLineEnd < 0 ? body.length : firstLineEnd + 1;
  const end = p3[0].index;
  if (!(title[0].index === 0 && start <= p1[0].index && p1[0].index < p2[0].index && p2[0].index < end)) {
    throw new Error(`projection-adoption-heading-order-invalid: ${path}`);
  }
  return { start, end };
}

function extractRenderedRegion(candidate: ArchitectureAdoptionCandidate): string {
  const start = candidate.renderedBody.lastIndexOf(candidate.target.generatedRegion.startMarker);
  if (start < 0) throw new Error(`projection-adoption-rendered-region-missing: ${candidate.path}`);
  const endMarkerStart = candidate.renderedBody.indexOf(candidate.target.generatedRegion.endMarker, start);
  if (endMarkerStart < 0) throw new Error(`projection-adoption-rendered-region-missing: ${candidate.path}`);
  const end = endMarkerStart + candidate.target.generatedRegion.endMarker.length;
  return `${candidate.renderedBody.slice(start, end).trimEnd()}\n`;
}

function matches(body: string, pattern: RegExp): { index: number; value: string }[] {
  return [...body.matchAll(pattern)].map((match) => ({ index: match.index ?? -1, value: match[0] }));
}

function bodyDigest(body: string): string {
  return digestJson({ body } as unknown as Json);
}

function bytesDigest(body: string): string {
  return digestJson({ bytes: body } as unknown as Json);
}
