import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRACTICE_CATALOG_MANIFEST_SCHEMA_VERSION,
  PRACTICE_PROFILE_SCHEMA_VERSION,
  PRACTICE_SCHEMA_VERSION,
  PRACTICE_SOURCE_SCHEMA_VERSION,
  digestJson,
  errorEnvelope,
  okEnvelope,
  productVersionManifest,
  type EffectivePracticeAssetV1,
  type Json,
  type JsonEnvelope,
  type PracticeAssetV1,
  type PracticeCatalogManifestV1,
  type PracticeCatalogManifestEntryV1,
  type PracticeCheckV1,
  type PracticeProfileV1,
  type PracticeSourceRecordV1
} from "@archcontext/contracts";
import { assertRepoRelativePath } from "@archcontext/core/architecture-domain";

export const PRACTICE_CATALOG_VERSION = "2026.06.0";
export const BUILTIN_PRACTICE_ASSETS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../assets");

const ALLOWED_CHECK_IDS = new Set([
  "compatibility-contract-required",
  "no-new-cycle",
  "dependency-direction",
  "owner-required",
  "migration-review-date",
  "migration-removal-condition",
  "required-test-evidence",
  "single-authoritative-model",
  "boundary-telemetry-required",
  "least-privilege-required",
  "pinned-dependencies-required",
  "observed-before-enforced",
  "context-stale-completion"
]);

const FORBIDDEN_OVERLAY_KEYS = new Set([
  "command",
  "commands",
  "exec",
  "shell",
  "script",
  "network",
  "http",
  "https",
  "url",
  "webhook",
  "hook",
  "hooks",
  "provider",
  "llm"
]);

const PRACTICE_ROOT_KEYS = new Set([
  "schemaVersion",
  "id",
  "revision",
  "status",
  "title",
  "summary",
  "category",
  "tags",
  "appliesTo",
  "triggers",
  "evidencePolicy",
  "guidance",
  "checks",
  "enforcement",
  "provenance",
  "lifecycle",
  "overlay"
]);

export interface PracticeCatalogIssue {
  code: string;
  path?: string;
  practiceId?: string;
  message: string;
}

export interface PracticeCatalogLoadOptions {
  root?: string;
  builtInAssetsDir?: string;
  includeRepoOverlay?: boolean;
  now?: string;
}

export interface PracticeCatalog {
  schemaVersion: "archcontext.practice-catalog/v1";
  catalogVersion: string;
  productVersion: string;
  catalogDigest: string;
  overlayDigest: string;
  manifest: PracticeCatalogManifestV1;
  effectiveAssets: EffectivePracticeAssetV1[];
  profiles: PracticeProfileV1[];
  sources: PracticeSourceRecordV1[];
  errors: PracticeCatalogIssue[];
  warnings: PracticeCatalogIssue[];
}

export interface PracticeCatalogCommandInput {
  action: "list" | "show" | "validate" | "sources";
  id?: string;
  category?: string;
  source?: string;
  strict?: boolean;
}

interface LoadedAsset {
  asset: PracticeAssetV1;
  path: string;
  sourceTrust: EffectivePracticeAssetV1["sourceTrust"];
}

interface DisabledOverlay {
  id: string;
  path: string;
  reason: string;
}

export function loadPracticeCatalog(options: PracticeCatalogLoadOptions = {}): PracticeCatalog {
  const root = options.root ? resolve(options.root) : process.cwd();
  const builtInAssetsDir = options.builtInAssetsDir ?? BUILTIN_PRACTICE_ASSETS_DIR;
  const errors: PracticeCatalogIssue[] = [];
  const warnings: PracticeCatalogIssue[] = [];
  const builtIn = loadAssetFiles(resolve(builtInAssetsDir, "practices"), "curated-static", errors);
  const profiles = loadProfileFiles(resolve(builtInAssetsDir, "profiles"), errors);
  const sources = loadSourceFiles(resolve(builtInAssetsDir, "sources"), errors);
  const overlays = options.includeRepoOverlay === false
    ? []
    : loadRepoOverlayAssets(root, errors);
  const merged = mergeCatalogAssets(builtIn, overlays, errors, options.now ?? new Date().toISOString());
  const sourceIds = new Set(sources.map((source) => source.id));

  for (const effective of merged.assets) {
    for (const sourceRef of effective.asset.provenance.sourceRefs) {
      if (!sourceIds.has(sourceRef.sourceId)) {
        errors.push({
          code: "practice-source-missing",
          path: effective.originPath,
          practiceId: effective.asset.id,
          message: `Unknown practice source: ${sourceRef.sourceId}`
        });
      }
    }
  }
  const profileAssetIds = new Set(builtIn.map((loaded) => loaded.asset.id));
  for (const profile of profiles) {
    for (const practiceId of profile.includePracticeIds) {
      if (!profileAssetIds.has(practiceId)) {
        errors.push({
          code: "practice-profile-practice-missing",
          practiceId: profile.id,
          message: `Practice profile references unknown practice: ${practiceId}`
        });
      }
    }
    for (const sourceRef of profile.provenance.sourceRefs) {
      if (!sourceIds.has(sourceRef.sourceId)) {
        errors.push({
          code: "practice-profile-source-missing",
          practiceId: profile.id,
          message: `Unknown practice profile source: ${sourceRef.sourceId}`
        });
      }
    }
  }

  const overlayDigest = digestJson(merged.overlayDigestInput as unknown as Json);
  const entries = merged.assets.map((effective): PracticeCatalogManifestEntryV1 => ({
    id: effective.asset.id,
    revision: effective.asset.revision,
    digest: effective.assetDigest,
    sourceIds: effective.asset.provenance.sourceRefs.map((source) => source.sourceId).sort()
  })).sort((a, b) => a.id.localeCompare(b.id));
  const productVersion = productVersionManifest().product.version;
  const manifestWithoutDigest = {
    schemaVersion: PRACTICE_CATALOG_MANIFEST_SCHEMA_VERSION,
    catalogVersion: PRACTICE_CATALOG_VERSION,
    productVersion,
    generatedAt: "1970-01-01T00:00:00.000Z",
    entries,
    sourceIds: sources.map((source) => source.id).sort()
  };
  const catalogDigest = digestJson(manifestWithoutDigest as unknown as Json);
  const manifest: PracticeCatalogManifestV1 = {
    ...manifestWithoutDigest,
    catalogDigest
  };

  return {
    schemaVersion: "archcontext.practice-catalog/v1",
    catalogVersion: PRACTICE_CATALOG_VERSION,
    productVersion,
    catalogDigest,
    overlayDigest,
    manifest,
    effectiveAssets: merged.assets,
    profiles,
    sources,
    errors,
    warnings
  };
}

export function practiceCatalogEnvelope(root: string, input: PracticeCatalogCommandInput): JsonEnvelope {
  const catalog = loadPracticeCatalog({ root });
  if (input.action === "validate") {
    return okEnvelope("practices.validate", validationPayload(catalog, input.strict === true) as unknown as Json);
  }
  if (catalog.errors.length > 0) {
    return errorEnvelope("practices", "AC_SCHEMA_INVALID", catalog.errors.map((issue) => issue.message).join("; "));
  }
  if (input.action === "sources") {
    return okEnvelope("practices.sources", {
      schemaVersion: "archcontext.practice-sources/v1",
      catalogDigest: catalog.catalogDigest,
      sources: catalog.sources
    } as unknown as Json);
  }
  if (input.action === "show") {
    const effective = catalog.effectiveAssets.find((candidate) => candidate.asset.id === input.id);
    if (!effective) return errorEnvelope("practices.show", "AC_SCHEMA_INVALID", `Unknown practice: ${input.id ?? "<missing>"}`);
    return okEnvelope("practices.show", {
      schemaVersion: "archcontext.practice-show/v1",
      catalogDigest: catalog.catalogDigest,
      practice: effective.asset,
      assetDigest: effective.assetDigest,
      sourceTrust: effective.sourceTrust,
      originPath: effective.originPath,
      overrideChain: effective.overrideChain
    } as unknown as Json);
  }
  if (input.action === "list") {
    const summaries = catalog.effectiveAssets
      .filter((effective) => !input.category || effective.asset.category === input.category)
      .filter((effective) => !input.source || effective.asset.provenance.sourceRefs.some((source) => source.sourceId === input.source))
      .map((effective) => ({
        id: effective.asset.id,
        revision: effective.asset.revision,
        status: effective.asset.status,
        title: effective.asset.title,
        category: effective.asset.category,
        tags: effective.asset.tags,
        defaultEnforcement: effective.asset.enforcement.default,
        promotableTo: effective.asset.enforcement.promotableTo,
        sourceTrust: effective.sourceTrust,
        assetDigest: effective.assetDigest
      }));
    return okEnvelope("practices.list", {
      schemaVersion: "archcontext.practice-list/v1",
      catalogVersion: catalog.catalogVersion,
      productVersion: catalog.productVersion,
      catalogDigest: catalog.catalogDigest,
      overlayDigest: catalog.overlayDigest,
      count: summaries.length,
      practices: summaries
    } as unknown as Json);
  }
  return errorEnvelope("practices", "AC_SCHEMA_INVALID", `Unknown practices action: ${(input as { action?: string }).action ?? "<missing>"}`);
}

export function practiceAssetDigest(asset: PracticeAssetV1): string {
  return digestJson({
    schemaVersion: "archcontext.practice-asset-digest/v1",
    asset
  } as unknown as Json);
}

function validationPayload(catalog: PracticeCatalog, strict: boolean): Record<string, Json> {
  return {
    schemaVersion: "archcontext.practice-validation/v1",
    valid: catalog.errors.length === 0 && (!strict || catalog.warnings.length === 0),
    strict,
    errors: catalog.errors as unknown as Json,
    warnings: catalog.warnings as unknown as Json,
    catalogVersion: catalog.catalogVersion,
    productVersion: catalog.productVersion,
    catalogDigest: catalog.catalogDigest,
    overlayDigest: catalog.overlayDigest,
    manifest: catalog.manifest as unknown as Json,
    sourceCount: catalog.sources.length,
    profileCount: catalog.profiles.length,
    practiceCount: catalog.effectiveAssets.length
  };
}

function loadAssetFiles(dir: string, sourceTrust: EffectivePracticeAssetV1["sourceTrust"], errors: PracticeCatalogIssue[]): LoadedAsset[] {
  const files = listDataFiles(dir, dir, errors);
  return files
    .map((path) => ({ path, value: parseDataFile(path, errors) }))
    .flatMap(({ path, value }) => {
      const values = Array.isArray(value) ? value : [value];
      return values.flatMap((candidate) => {
        const asset = validatePracticeAsset(candidate, path, errors);
        return asset ? [{ asset, path: displayPath(path), sourceTrust }] : [];
      });
    });
}

function loadSourceFiles(dir: string, errors: PracticeCatalogIssue[]): PracticeSourceRecordV1[] {
  const sources: PracticeSourceRecordV1[] = [];
  for (const path of listDataFiles(dir, dir, errors)) {
    const value = parseDataFile(path, errors);
    const values = Array.isArray(value) ? value : [value];
    for (const candidate of values) {
      const source = validateSourceRecord(candidate, path, errors);
      if (source) sources.push(source);
    }
  }
  return sources.sort((a, b) => a.id.localeCompare(b.id));
}

function loadProfileFiles(dir: string, errors: PracticeCatalogIssue[]): PracticeProfileV1[] {
  const profiles: PracticeProfileV1[] = [];
  for (const path of listDataFiles(dir, dir, errors)) {
    const value = parseDataFile(path, errors);
    const values = Array.isArray(value) ? value : [value];
    for (const candidate of values) {
      const profile = validateProfile(candidate, path, errors);
      if (profile) profiles.push(profile);
    }
  }
  return profiles.sort((a, b) => a.id.localeCompare(b.id));
}

function loadRepoOverlayAssets(root: string, errors: PracticeCatalogIssue[]): LoadedAsset[] {
  const overlayRoot = resolve(root, ".archcontext/practices");
  if (!existsSync(overlayRoot)) return [];
  const out: LoadedAsset[] = [];
  for (const path of listDataFiles(overlayRoot, overlayRoot, errors)) {
    const relativePath = `.archcontext/practices/${relative(overlayRoot, path).split(sep).join("/")}`;
    try {
      assertRepoRelativePath(relativePath);
      assertRealChild(root, path);
    } catch (error) {
      errors.push({
        code: "practice-overlay-path-denied",
        path: relativePath,
        message: error instanceof Error ? error.message : String(error)
      });
      continue;
    }
    const value = parseDataFile(path, errors);
    const values = Array.isArray(value) ? value : [value];
    for (const candidate of values) {
      if (containsForbiddenOverlayKey(candidate)) {
        errors.push({
          code: "practice-overlay-forbidden-behavior",
          path: relativePath,
          message: "Repo practice overlays cannot define shell, network, hook, provider, or LLM behavior."
        });
        continue;
      }
      const asset = validatePracticeAsset(candidate, relativePath, errors);
      if (asset) out.push({ asset, path: relativePath, sourceTrust: "repo-authored" });
    }
  }
  return out;
}

function mergeCatalogAssets(builtIn: LoadedAsset[], overlays: LoadedAsset[], errors: PracticeCatalogIssue[], now: string): {
  assets: EffectivePracticeAssetV1[];
  disabled: DisabledOverlay[];
  overlayDigestInput: Json;
} {
  const byId = new Map<string, EffectivePracticeAssetV1>();
  const disabled: DisabledOverlay[] = [];
  for (const loaded of builtIn) {
    if (byId.has(loaded.asset.id)) {
      errors.push({ code: "practice-duplicate-id", path: loaded.path, practiceId: loaded.asset.id, message: `Duplicate built-in practice ID: ${loaded.asset.id}` });
      continue;
    }
    byId.set(loaded.asset.id, toEffective(loaded, []));
  }

  const overlayDigestInput: Json[] = [];
  for (const overlay of overlays.sort((a, b) => a.path.localeCompare(b.path))) {
    overlayDigestInput.push({ id: overlay.asset.id, path: overlay.path, digest: practiceAssetDigest(overlay.asset) } as unknown as Json);
    const existing = byId.get(overlay.asset.id);
    const mode = overlay.asset.overlay?.mode ?? (overlay.asset.status === "disabled" ? "disable" : "add");
    const expiresAt = overlay.asset.overlay?.expiresAt;
    if (expiresAt) {
      const expiresAtMs = Date.parse(expiresAt);
      const nowMs = Date.parse(now);
      if (Number.isNaN(expiresAtMs) || Number.isNaN(nowMs)) {
        errors.push({ code: "practice-overlay-expiry-invalid", path: overlay.path, practiceId: overlay.asset.id, message: `Invalid overlay expiry: ${expiresAt}` });
        continue;
      }
      if (expiresAtMs <= nowMs) {
        errors.push({ code: "practice-overlay-expired", path: overlay.path, practiceId: overlay.asset.id, message: `Repo overlay expired at ${expiresAt}: ${overlay.asset.id}` });
        continue;
      }
    }
    if (mode === "disable") {
      if (!existing) {
        errors.push({ code: "practice-disable-missing-target", path: overlay.path, practiceId: overlay.asset.id, message: `Cannot disable unknown practice: ${overlay.asset.id}` });
        continue;
      }
      disabled.push({ id: overlay.asset.id, path: overlay.path, reason: overlay.asset.lifecycle.disabledWithReason ?? "disabled by repo overlay" });
      byId.delete(overlay.asset.id);
      continue;
    }
    if (mode === "replace") {
      if (!existing) {
        errors.push({ code: "practice-replace-missing-target", path: overlay.path, practiceId: overlay.asset.id, message: `Cannot replace unknown practice: ${overlay.asset.id}` });
        continue;
      }
      if (overlay.asset.overlay?.extends && overlay.asset.overlay.extends !== overlay.asset.id) {
        errors.push({ code: "practice-replace-extends-mismatch", path: overlay.path, practiceId: overlay.asset.id, message: `Overlay extends ${overlay.asset.overlay.extends}, expected ${overlay.asset.id}` });
        continue;
      }
      if (overlay.asset.revision < existing.asset.revision) {
        errors.push({ code: "practice-revision-rollback", path: overlay.path, practiceId: overlay.asset.id, message: `Repo overlay revision ${overlay.asset.revision} is older than effective revision ${existing.asset.revision}.` });
        continue;
      }
      byId.set(overlay.asset.id, toEffective(overlay, [...existing.overrideChain, overlay.path]));
      continue;
    }
    if (existing) {
      errors.push({ code: "practice-silent-duplicate-id", path: overlay.path, practiceId: overlay.asset.id, message: `Repo overlay must use overlay.mode=replace or disable for existing ID: ${overlay.asset.id}` });
      continue;
    }
    byId.set(overlay.asset.id, toEffective(overlay, [overlay.path]));
  }

  return {
    assets: [...byId.values()].sort((a, b) => a.asset.id.localeCompare(b.asset.id)),
    disabled,
    overlayDigestInput
  };
}

function toEffective(loaded: LoadedAsset, overrideChain: string[]): EffectivePracticeAssetV1 {
  return {
    asset: loaded.asset,
    assetDigest: practiceAssetDigest(loaded.asset),
    sourceTrust: loaded.sourceTrust,
    originPath: loaded.path,
    overrideChain
  };
}

function validatePracticeAsset(value: unknown, path: string, errors: PracticeCatalogIssue[]): PracticeAssetV1 | undefined {
  if (!isRecord(value)) {
    errors.push({ code: "practice-invalid-shape", path: displayPath(path), message: "Practice asset must be an object." });
    return undefined;
  }
  let invalid = false;
  for (const key of Object.keys(value)) {
    if (!PRACTICE_ROOT_KEYS.has(key)) {
      errors.push({ code: "practice-unknown-field", path: displayPath(path), message: `Unknown practice field: ${key}` });
      invalid = true;
    }
  }
  const asset = value as unknown as PracticeAssetV1;
  const required: Array<keyof PracticeAssetV1> = [
    "schemaVersion",
    "id",
    "revision",
    "status",
    "title",
    "summary",
    "category",
    "tags",
    "appliesTo",
    "triggers",
    "evidencePolicy",
    "guidance",
    "checks",
    "enforcement",
    "provenance",
    "lifecycle"
  ];
  for (const key of required) {
    if (!(key in value)) {
      errors.push({ code: "practice-missing-field", path: displayPath(path), message: `Practice asset missing field: ${String(key)}` });
      invalid = true;
    }
  }
  if (asset.schemaVersion !== PRACTICE_SCHEMA_VERSION) {
    errors.push({ code: "practice-schema-version", path: displayPath(path), practiceId: maybeString(value.id), message: `Unsupported practice schemaVersion: ${String(asset.schemaVersion)}` });
    invalid = true;
  }
  if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(String(asset.id))) {
    errors.push({ code: "practice-id-invalid", path: displayPath(path), message: `Invalid practice ID: ${String(asset.id)}` });
    invalid = true;
  }
  if (!Number.isInteger(asset.revision) || asset.revision < 1) {
    errors.push({ code: "practice-revision-invalid", path: displayPath(path), practiceId: maybeString(value.id), message: "Practice revision must be a positive integer." });
    invalid = true;
  }
  invalid = validatePracticeGlobs(asset, path, errors) || invalid;
  invalid = validatePracticeEnforcementFixtureGate(asset, path, errors) || invalid;
  for (const check of Array.isArray(asset.checks) ? asset.checks : []) {
    invalid = validatePracticeCheck(check, path, asset.id, errors) || invalid;
  }
  if (!Array.isArray(asset.provenance?.sourceRefs) || asset.provenance.sourceRefs.length === 0) {
    errors.push({ code: "practice-provenance-missing", path: displayPath(path), practiceId: maybeString(value.id), message: "Practice asset requires at least one sourceRef." });
    invalid = true;
  }
  return invalid ? undefined : asset;
}

function validatePracticeGlobs(asset: PracticeAssetV1, path: string, errors: PracticeCatalogIssue[]): boolean {
  let invalid = false;
  const globs = [
    ...(Array.isArray(asset.appliesTo?.pathGlobs) ? asset.appliesTo.pathGlobs : []),
    ...(Array.isArray(asset.appliesTo?.negativePathGlobs) ? asset.appliesTo.negativePathGlobs ?? [] : [])
  ];
  for (const glob of globs) {
    if (glob.startsWith("/") || glob.includes("\\") || glob.split("/").includes("..")) {
      errors.push({
        code: "practice-glob-invalid",
        path: displayPath(path),
        practiceId: asset.id,
        message: `Practice glob must be repo-relative POSIX pattern: ${glob}`
      });
      invalid = true;
    }
  }
  return invalid;
}

function validatePracticeEnforcementFixtureGate(asset: PracticeAssetV1, path: string, errors: PracticeCatalogIssue[]): boolean {
  if (asset.enforcement?.promotableTo !== "complete") return false;
  const gate = asset.enforcement.fixtureGate;
  if (!gate) {
    errors.push({
      code: "practice-enforcement-fixture-gate-missing",
      path: displayPath(path),
      practiceId: asset.id,
      message: `Complete-enforcement practice requires positive, near-negative, mixed-change and baseline fixtures: ${asset.id}`
    });
    return true;
  }
  let invalid = false;
  for (const kind of ["positive", "nearNegative", "mixedChange", "baseline"] as const) {
    const refs = gate[kind];
    if (!Array.isArray(refs) || refs.length === 0) {
      errors.push({
        code: "practice-enforcement-fixture-kind-missing",
        path: displayPath(path),
        practiceId: asset.id,
        message: `Complete-enforcement practice ${asset.id} is missing ${kind} fixtures.`
      });
      invalid = true;
      continue;
    }
    for (const ref of refs) {
      if (!ref || typeof ref !== "object" || typeof ref.id !== "string" || typeof ref.path !== "string" || typeof ref.description !== "string") {
        errors.push({
          code: "practice-enforcement-fixture-invalid",
          path: displayPath(path),
          practiceId: asset.id,
          message: `Invalid ${kind} fixture declaration for ${asset.id}.`
        });
        invalid = true;
        continue;
      }
      if (ref.id.trim().length === 0 || ref.path.trim().length === 0 || ref.description.trim().length === 0) {
        errors.push({
          code: "practice-enforcement-fixture-empty",
          path: displayPath(path),
          practiceId: asset.id,
          message: `Empty ${kind} fixture declaration for ${asset.id}.`
        });
        invalid = true;
      }
      try {
        assertRepoRelativePath(ref.path);
      } catch (error) {
        errors.push({
          code: "practice-enforcement-fixture-path-invalid",
          path: displayPath(path),
          practiceId: asset.id,
          message: error instanceof Error ? error.message : String(error)
        });
        invalid = true;
      }
      if (ref.digest !== undefined && !/^sha256:[a-f0-9]{64}$/.test(ref.digest)) {
        errors.push({
          code: "practice-enforcement-fixture-digest-invalid",
          path: displayPath(path),
          practiceId: asset.id,
          message: `Invalid ${kind} fixture digest for ${asset.id}.`
        });
        invalid = true;
      }
    }
  }
  return invalid;
}

function validatePracticeCheck(check: PracticeCheckV1, path: string, practiceId: string, errors: PracticeCatalogIssue[]): boolean {
  let invalid = false;
  if (!check || typeof check !== "object") {
    errors.push({ code: "practice-check-invalid", path: displayPath(path), practiceId, message: "Practice check must be an object." });
    return true;
  }
  if (!ALLOWED_CHECK_IDS.has(check.checkId)) {
    errors.push({ code: "practice-check-unsupported", path: displayPath(path), practiceId, message: `Unsupported practice checkId: ${check.checkId}` });
    invalid = true;
  }
  if (check.mode !== "deterministic") {
    errors.push({ code: "practice-check-mode", path: displayPath(path), practiceId, message: `Practice check must be deterministic: ${check.checkId}` });
    invalid = true;
  }
  return invalid;
}

function validateSourceRecord(value: unknown, path: string, errors: PracticeCatalogIssue[]): PracticeSourceRecordV1 | undefined {
  if (!isRecord(value)) {
    errors.push({ code: "practice-source-invalid-shape", path: displayPath(path), message: "Practice source record must be an object." });
    return undefined;
  }
  const source = value as unknown as PracticeSourceRecordV1;
  if (source.schemaVersion !== PRACTICE_SOURCE_SCHEMA_VERSION) {
    errors.push({ code: "practice-source-schema-version", path: displayPath(path), message: `Unsupported practice source schemaVersion: ${String(source.schemaVersion)}` });
    return undefined;
  }
  if (!source.id || !source.name || !source.uri || !source.revision) {
    errors.push({ code: "practice-source-missing-field", path: displayPath(path), message: "Practice source record requires id, name, uri, and revision." });
    return undefined;
  }
  if (source.licenseLevel === "C" || source.licenseLevel === "D" || source.licenseLevel === "E") {
    if (source.usagePolicy === "builtin-with-attribution") {
      errors.push({ code: "practice-source-license-blocked", path: displayPath(path), message: `Source ${source.id} cannot enter the built-in catalog with license level ${source.licenseLevel}.` });
    }
  }
  return source;
}

function validateProfile(value: unknown, path: string, errors: PracticeCatalogIssue[]): PracticeProfileV1 | undefined {
  if (!isRecord(value)) {
    errors.push({ code: "practice-profile-invalid-shape", path: displayPath(path), message: "Practice profile must be an object." });
    return undefined;
  }
  const profile = value as unknown as PracticeProfileV1;
  const required: Array<keyof PracticeProfileV1> = [
    "schemaVersion",
    "id",
    "revision",
    "status",
    "title",
    "repositoryKinds",
    "languages",
    "frameworks",
    "includePracticeIds",
    "excludePracticeIds",
    "provenance"
  ];
  let invalid = false;
  for (const key of required) {
    if (!(key in value)) {
      errors.push({ code: "practice-profile-missing-field", path: displayPath(path), message: `Practice profile missing field: ${String(key)}` });
      invalid = true;
    }
  }
  if (profile.schemaVersion !== PRACTICE_PROFILE_SCHEMA_VERSION) {
    errors.push({ code: "practice-profile-schema-version", path: displayPath(path), practiceId: maybeString(value.id), message: `Unsupported practice profile schemaVersion: ${String(profile.schemaVersion)}` });
    invalid = true;
  }
  if (!/^profile\.[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(String(profile.id))) {
    errors.push({ code: "practice-profile-id-invalid", path: displayPath(path), message: `Invalid practice profile ID: ${String(profile.id)}` });
    invalid = true;
  }
  if (!Number.isInteger(profile.revision) || profile.revision < 1) {
    errors.push({ code: "practice-profile-revision-invalid", path: displayPath(path), practiceId: maybeString(value.id), message: "Practice profile revision must be a positive integer." });
    invalid = true;
  }
  if (!Array.isArray(profile.includePracticeIds) || profile.includePracticeIds.length === 0) {
    errors.push({ code: "practice-profile-empty", path: displayPath(path), practiceId: maybeString(value.id), message: "Practice profile requires at least one included practice." });
    invalid = true;
  }
  if (!Array.isArray(profile.provenance?.sourceRefs) || profile.provenance.sourceRefs.length === 0) {
    errors.push({ code: "practice-profile-provenance-missing", path: displayPath(path), practiceId: maybeString(value.id), message: "Practice profile requires at least one sourceRef." });
    invalid = true;
  }
  return invalid ? undefined : profile;
}

function listDataFiles(dir: string, allowedRoot: string, errors: PracticeCatalogIssue[]): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const rootReal = safeRealpath(allowedRoot);
  walk(dir);
  return out.sort();

  function walk(current: string): void {
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      errors.push({ code: "practice-file-stat-failed", path: displayPath(current), message: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (stat.isSymbolicLink()) {
      errors.push({ code: "practice-file-symlink-denied", path: displayPath(current), message: "Practice catalog files cannot be symlinks." });
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(current, { withFileTypes: true })) walk(resolve(current, entry.name));
      return;
    }
    if (!/\.(ya?ml|json)$/.test(current)) return;
    const real = safeRealpath(current);
    if (!isRealChild(rootReal, real)) {
      errors.push({ code: "practice-file-escape-denied", path: displayPath(current), message: "Practice catalog path escapes allowed root." });
      return;
    }
    out.push(current);
  }
}

function parseDataFile(path: string, errors: PracticeCatalogIssue[]): unknown {
  try {
    const body = readFileSync(path, "utf8").replace(/^\uFEFF/, "").trim();
    const withoutDocumentMarker = body.startsWith("---") ? body.replace(/^---\s*/, "").trim() : body;
    return JSON.parse(withoutDocumentMarker);
  } catch (error) {
    errors.push({
      code: "practice-yaml-parse-failed",
      path: displayPath(path),
      message: `Practice YAML must use the JSON-compatible subset in this release: ${error instanceof Error ? error.message : String(error)}`
    });
    return {};
  }
}

function containsForbiddenOverlayKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenOverlayKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_OVERLAY_KEYS.has(key.toLowerCase()) || containsForbiddenOverlayKey(child));
}

function assertRealChild(root: string, path: string): void {
  const rootReal = safeRealpath(root);
  const pathReal = safeRealpath(path);
  if (!isRealChild(rootReal, pathReal)) throw new Error(`Path escapes repository: ${path}`);
}

function safeRealpath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function isRealChild(rootReal: string, pathReal: string): boolean {
  const rel = relative(rootReal, pathReal);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`) && !resolve(rel).startsWith(".."));
}

function displayPath(path: string): string {
  return path.split(sep).join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function maybeString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
