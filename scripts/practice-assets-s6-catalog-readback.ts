#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { digestJson, type Json } from "@archcontext/contracts";
import { loadPracticeCatalog } from "@archcontext/core/practice-catalog";

const DEFAULT_EVIDENCE = "docs/verification/practice-assets-s6-catalog-readback.json";
const PACKET_SCHEMA_VERSION = "archcontext.practice-assets-s6-catalog-readback/v1";
const STATIC_MANIFEST_PATH = "packages/core/practice-catalog/assets/catalog.yaml";
const REQUIRED_SOURCE_IDS = [
  "madr",
  "backstage",
  "archunit",
  "structurizr.dsl",
  "twelve-factor",
  "opentelemetry",
  "kubernetes.docs",
  "openssf.scorecard"
];
const SHAREALIKE_REFERENCE_ONLY_SOURCE_IDS = ["owasp.cheat-sheet-series", "arc42"];

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[practice-assets-s6-catalog-readback] usage: run|inspect [--out path] [--evidence path] [--json]");
    process.exit(2);
  }

  const result = command === "run"
    ? runPracticeAssetsS6CatalogReadback({
      root: process.cwd(),
      outPath: readFlag(args, "--out") ?? readFlag(args, "--evidence") ?? DEFAULT_EVIDENCE
    })
    : inspectPracticeAssetsS6CatalogReadbackFile({
      root: process.cwd(),
      evidencePath: readFlag(args, "--evidence") ?? readFlag(args, "--out") ?? DEFAULT_EVIDENCE
    });

  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`[practice-assets-s6-catalog-readback] OK practices=${result.practiceCount} active=${result.activePracticeCount} profiles=${result.profileCount}`);
  } else {
    console.error("[practice-assets-s6-catalog-readback] FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
  }
  if (!result.ok) process.exit(1);
}

export function runPracticeAssetsS6CatalogReadback({
  root = process.cwd(),
  outPath = DEFAULT_EVIDENCE
}: {
  root?: string;
  outPath?: string;
} = {}) {
  const packet = buildPracticeAssetsS6CatalogReadbackPacket(root);
  const resolvedOut = resolve(root, outPath);
  mkdirSync(dirname(resolvedOut), { recursive: true });
  writeFileSync(resolvedOut, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  return inspectPracticeAssetsS6CatalogReadback(packet);
}

export function inspectPracticeAssetsS6CatalogReadbackFile({
  root = process.cwd(),
  evidencePath = DEFAULT_EVIDENCE
}: {
  root?: string;
  evidencePath?: string;
} = {}) {
  const packet = JSON.parse(readFileSync(resolve(root, evidencePath), "utf8"));
  return inspectPracticeAssetsS6CatalogReadback(packet);
}

export function buildPracticeAssetsS6CatalogReadbackPacket(root = process.cwd()) {
  const catalog = loadPracticeCatalog({ root, includeRepoOverlay: false });
  const staticManifest = JSON.parse(readFileSync(resolve(root, STATIC_MANIFEST_PATH), "utf8"));
  const activeAssets = catalog.effectiveAssets.filter((entry) => entry.asset.status === "active");
  const categoryCounts = countBy(activeAssets.map((entry) => entry.asset.category));
  const categories = Object.keys(categoryCounts).sort();
  const categoryNegativeScope = Object.fromEntries(categories.map((category) => [
    category,
    activeAssets
      .filter((entry) => entry.asset.category === category)
      .some((entry) => (entry.asset.appliesTo.negativePathGlobs ?? []).length > 0)
  ]));
  const sourceIds = new Set(catalog.sources.map((source) => source.id));
  const sourceUsage = sourceUsageByPractice(catalog.effectiveAssets);
  const requiredSourceIdsPresent = REQUIRED_SOURCE_IDS.filter((sourceId) => sourceIds.has(sourceId));
  const missingRequiredSourceIds = REQUIRED_SOURCE_IDS.filter((sourceId) => !sourceIds.has(sourceId));
  const referenceOnlySources = catalog.sources
    .filter((source) => source.usagePolicy === "reference-only" || source.review.status === "reference-only")
    .map((source) => ({
      id: source.id,
      licenseSpdx: source.licenseSpdx,
      licenseLevel: source.licenseLevel,
      usagePolicy: source.usagePolicy,
      reviewStatus: source.review.status,
      usedByPracticeIds: sourceUsage[source.id] ?? []
    }));
  const deprecatedAssets = catalog.effectiveAssets
    .filter((entry) => entry.asset.status === "deprecated")
    .map((entry) => entry.asset.id)
    .sort();
  const supersededDeprecatedAssets = deprecatedAssets.filter((practiceId) =>
    activeAssets.some((entry) => entry.asset.lifecycle.supersedes.includes(practiceId))
  );
  const provenanceGaps = findProvenanceGaps(catalog);
  const manifestMatchesStatic = JSON.stringify(catalog.manifest) === JSON.stringify(staticManifest);
  const assertions = {
    catalogClean: catalog.errors.length === 0 && catalog.warnings.length === 0,
    practiceCountInRange: catalog.effectiveAssets.length >= 40 && catalog.effectiveAssets.length <= 60,
    activePracticeCountAtLeast40: activeAssets.length >= 40,
    categoryMinimumSatisfied: categories.length >= 10 && Object.values(categoryCounts).every((count) => count >= 3),
    negativeScopePerCategory: Object.values(categoryNegativeScope).every((present) => present === true),
    profileCountInRange: catalog.profiles.length >= 6 && catalog.profiles.length <= 10,
    profileReferencesValid: catalog.errors.every((issue) => !issue.code.startsWith("practice-profile-")),
    requiredSourcesPresent: missingRequiredSourceIds.length === 0,
    referenceOnlySourcesUnused: referenceOnlySources.every((source) => source.usedByPracticeIds.length === 0),
    shareAlikeSourcesReferenceOnly: SHAREALIKE_REFERENCE_ONLY_SOURCE_IDS.every((sourceId) => {
      const source = catalog.sources.find((candidate) => candidate.id === sourceId);
      return source?.usagePolicy === "reference-only"
        && source.review.status === "reference-only"
        && (sourceUsage[sourceId] ?? []).length === 0;
    }),
    provenanceCompleteness: provenanceGaps.length === 0,
    deprecatedAssetsRetainedAndSuperseded: deprecatedAssets.length > 0 && deprecatedAssets.length === supersededDeprecatedAssets.length,
    manifestMatchesStaticCatalog: manifestMatchesStatic
  };

  return {
    schemaVersion: PACKET_SCHEMA_VERSION,
    status: Object.values(assertions).every(Boolean) ? "verified" : "failed",
    generatedAt: new Date().toISOString(),
    catalogDigest: catalog.catalogDigest,
    manifestDigest: digestJson(catalog.manifest as unknown as Json),
    staticManifestDigest: digestJson(staticManifest as unknown as Json),
    summary: {
      practiceCount: catalog.effectiveAssets.length,
      activePracticeCount: activeAssets.length,
      profileCount: catalog.profiles.length,
      sourceCount: catalog.sources.length,
      categoryCounts,
      categoryNegativeScope,
      requiredSourceIdsPresent,
      missingRequiredSourceIds,
      referenceOnlySources,
      deprecatedAssets,
      supersededDeprecatedAssets,
      provenanceGapCount: provenanceGaps.length
    },
    catalogErrors: catalog.errors,
    catalogWarnings: catalog.warnings,
    sourceUsage,
    provenanceGaps,
    assertions,
    readback: {
      command: `bun scripts/practice-assets-s6-catalog-readback.ts inspect --evidence ${DEFAULT_EVIDENCE} --json`
    }
  };
}

export function inspectPracticeAssetsS6CatalogReadback(packet: any) {
  const failures: string[] = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return failureResult(["packet must be an object"]);
  }

  if (packet.schemaVersion !== PACKET_SCHEMA_VERSION) failures.push(`schemaVersion must be ${PACKET_SCHEMA_VERSION}`);
  if (packet.status !== "verified") failures.push("status must be verified");
  if (!packet.catalogDigest || typeof packet.catalogDigest !== "string") failures.push("catalogDigest must be present");
  if (!packet.manifestDigest || packet.manifestDigest !== packet.staticManifestDigest) failures.push("manifestDigest must match staticManifestDigest");

  const summary = packet.summary ?? {};
  if (summary.practiceCount < 40 || summary.practiceCount > 60) failures.push("summary.practiceCount must be between 40 and 60");
  if (summary.activePracticeCount < 40) failures.push("summary.activePracticeCount must be at least 40");
  if (summary.profileCount < 6 || summary.profileCount > 10) failures.push("summary.profileCount must be between 6 and 10");
  if (Array.isArray(summary.missingRequiredSourceIds) && summary.missingRequiredSourceIds.length > 0) {
    failures.push(`missing required sources: ${summary.missingRequiredSourceIds.join(", ")}`);
  }
  for (const sourceId of REQUIRED_SOURCE_IDS) {
    if (!Array.isArray(summary.requiredSourceIdsPresent) || !summary.requiredSourceIdsPresent.includes(sourceId)) {
      failures.push(`required source missing from readback: ${sourceId}`);
    }
  }
  const categoryCounts = asRecord(summary.categoryCounts);
  if (Object.keys(categoryCounts).length < 10) failures.push("summary.categoryCounts must cover at least 10 categories");
  for (const [category, count] of Object.entries(categoryCounts)) {
    if (typeof count !== "number" || count < 3) failures.push(`summary.categoryCounts.${category} must be at least 3`);
  }
  const categoryNegativeScope = asRecord(summary.categoryNegativeScope);
  for (const category of Object.keys(categoryCounts)) {
    if (categoryNegativeScope[category] !== true) failures.push(`summary.categoryNegativeScope.${category} must be true`);
  }
  const referenceOnlySources = Array.isArray(summary.referenceOnlySources) ? summary.referenceOnlySources : [];
  for (const source of referenceOnlySources) {
    if (!source || typeof source !== "object") continue;
    const usedBy = Array.isArray(source.usedByPracticeIds) ? source.usedByPracticeIds : [];
    if (usedBy.length > 0) failures.push(`reference-only source ${String(source.id)} is used by practices: ${usedBy.join(", ")}`);
  }
  for (const sourceId of SHAREALIKE_REFERENCE_ONLY_SOURCE_IDS) {
    const source = referenceOnlySources.find((candidate: any) => candidate?.id === sourceId);
    if (!source) {
      failures.push(`ShareAlike source missing from reference-only readback: ${sourceId}`);
      continue;
    }
    if (source.usagePolicy !== "reference-only" || source.reviewStatus !== "reference-only") {
      failures.push(`ShareAlike source must remain reference-only: ${sourceId}`);
    }
  }
  if (!Array.isArray(summary.deprecatedAssets) || summary.deprecatedAssets.length === 0) failures.push("summary.deprecatedAssets must retain at least one deprecated asset");
  if (!sameSet(summary.deprecatedAssets, summary.supersededDeprecatedAssets)) failures.push("deprecated assets must be superseded by active assets");
  if (summary.provenanceGapCount !== 0) failures.push("summary.provenanceGapCount must be 0");
  if (Array.isArray(packet.provenanceGaps) && packet.provenanceGaps.length > 0) failures.push("provenanceGaps must be empty");
  inspectAssertions(packet.assertions, failures);

  return {
    ok: failures.length === 0,
    schemaVersion: PACKET_SCHEMA_VERSION,
    practiceCount: summary.practiceCount,
    activePracticeCount: summary.activePracticeCount,
    profileCount: summary.profileCount,
    sourceCount: summary.sourceCount,
    failures
  };
}

function findProvenanceGaps(catalog: ReturnType<typeof loadPracticeCatalog>): string[] {
  const gaps: string[] = [];
  for (const entry of catalog.effectiveAssets) {
    const asset = entry.asset;
    if (!Number.isInteger(asset.revision) || asset.revision < 1) gaps.push(`${asset.id}:revision`);
    if (!entry.assetDigest || !/^sha256:[a-f0-9]{64}$/.test(entry.assetDigest)) gaps.push(`${asset.id}:digest`);
    if (!asset.provenance?.curator) gaps.push(`${asset.id}:curator`);
    if (!asset.provenance?.reviewedAt) gaps.push(`${asset.id}:reviewedAt`);
    if (!Array.isArray(asset.provenance?.sourceRefs) || asset.provenance.sourceRefs.length === 0) gaps.push(`${asset.id}:sourceRefs`);
  }
  for (const profile of catalog.profiles) {
    if (!Number.isInteger(profile.revision) || profile.revision < 1) gaps.push(`${profile.id}:revision`);
    if (!profile.provenance?.curator) gaps.push(`${profile.id}:curator`);
    if (!profile.provenance?.reviewedAt) gaps.push(`${profile.id}:reviewedAt`);
    if (!Array.isArray(profile.provenance?.sourceRefs) || profile.provenance.sourceRefs.length === 0) gaps.push(`${profile.id}:sourceRefs`);
  }
  for (const source of catalog.sources) {
    if (!source.revision) gaps.push(`${source.id}:revision`);
    if (!source.licenseSpdx || !source.licenseLevel || !source.usagePolicy) gaps.push(`${source.id}:license`);
    if (!source.contentDigest || !/^sha256:[a-f0-9]{64}$/.test(source.contentDigest)) gaps.push(`${source.id}:digest`);
    if (!source.review?.status || !source.review?.reviewer || !source.review?.reviewedAt) gaps.push(`${source.id}:review`);
  }
  return gaps.sort();
}

function sourceUsageByPractice(assets: ReturnType<typeof loadPracticeCatalog>["effectiveAssets"]): Record<string, string[]> {
  const usage = new Map<string, string[]>();
  for (const entry of assets) {
    for (const ref of entry.asset.provenance.sourceRefs) {
      const ids = usage.get(ref.sourceId) ?? [];
      ids.push(entry.asset.id);
      usage.set(ref.sourceId, ids.sort());
    }
  }
  return Object.fromEntries([...usage.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function countBy(values: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function inspectAssertions(assertions: Record<string, unknown> | undefined, failures: string[]): void {
  if (!assertions || typeof assertions !== "object" || Array.isArray(assertions)) {
    failures.push("assertions must be an object");
    return;
  }
  for (const [name, value] of Object.entries(assertions)) {
    if (value !== true) failures.push(`assertions.${name} must be true`);
  }
}

function sameSet(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function failureResult(failures: string[]) {
  return {
    ok: false,
    schemaVersion: PACKET_SCHEMA_VERSION,
    practiceCount: undefined,
    activePracticeCount: undefined,
    profileCount: undefined,
    sourceCount: undefined,
    failures
  };
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}
