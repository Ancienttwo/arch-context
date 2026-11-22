import {
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_MIGRATION_GUIDE,
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH,
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION,
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_UPGRADE_COMMAND,
  PROJECTION_FOOTPRINT_UNCOVERED,
  PROJECTION_MANIFEST_INVALID,
  FailureError,
  PROJECTION_MANIFEST_UPGRADE_REQUIRED,
  architectureDocsProjectionCompatibilityIssues,
  architectureDocsProjectionManifestIssues,
  architectureDocsProjectionManifestSchemaVersion,
  isSupersededArchitectureDocsProjectionManifestSchemaVersion,
  type ArchitectureDocsProjectionManifestTargetV4,
  type ArchitectureDocsProjectionManifestV4,
  type ProjectionFreshnessStaleTargetV2
} from "@archcontext/contracts";
import type { ArchitectureProjectionProfile } from "./layout";
import type { ArchitectureProjectionFreshnessEvaluation, ArchitectureProjectionFreshnessReasonCode } from "./docs-types";
import { compareStrings } from "./exports-dsl";

/**
 * A projection precondition with its own reason code: the committed manifest or the model is in a
 * state the projection refuses, and the operator, not the runtime, resolves it (#327).
 */
export abstract class ProjectionPreconditionError extends Error {
  abstract readonly reasonCode: string;
}

/**
 * A committed manifest whose `schemaVersion` names a format an earlier release wrote. Only that
 * field was read; the manifest's baseline and rows are not translated. The operator
 * re-baselines once with `archctx docs apply --approved` (#327).
 */
export class ProjectionManifestUpgradeRequiredError extends ProjectionPreconditionError {
  readonly reasonCode = PROJECTION_MANIFEST_UPGRADE_REQUIRED;
  /**
   * The structured failure details every public surface registers with this reason: the committed
   * manifest, the superseded format it names, the format this release reads, and the one-time
   * re-baseline plus its runbook. Populated only for a schemaVersion this release recognizes as
   * superseded, because that is the only value the public fact vocabulary accepts; a forged value
   * keeps the typed refusal without widening the diagnostic.
   */
  readonly details: Readonly<Record<string, string>>;
  constructor(readonly schemaVersion: string) {
    super(`${PROJECTION_MANIFEST_UPGRADE_REQUIRED}: ${ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH} is ${schemaVersion}, and this archctx reads only ${ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION}; reach a clean projection on the earlier release first, then re-baseline once with ${ARCHITECTURE_DOCS_PROJECTION_MANIFEST_UPGRADE_COMMAND}; if that apply names whole-file outputs the earlier release wrote, remove them with git rm and run it again; ${ARCHITECTURE_DOCS_PROJECTION_MANIFEST_MIGRATION_GUIDE} lists the model and release preconditions`);
    this.details = isSupersededArchitectureDocsProjectionManifestSchemaVersion(schemaVersion) ? {
      manifestPath: ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH,
      foundSchemaVersion: schemaVersion,
      supportedSchemaVersion: ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION,
      upgradeCommand: ARCHITECTURE_DOCS_PROJECTION_MANIFEST_UPGRADE_COMMAND,
      migrationGuide: ARCHITECTURE_DOCS_PROJECTION_MANIFEST_MIGRATION_GUIDE
    } : {};
  }
}

/** Declared source footprints that no entity-summary or topology target documents. */
export class ProjectionFootprintUncoveredError extends ProjectionPreconditionError {
  readonly reasonCode = PROJECTION_FOOTPRINT_UNCOVERED;
  constructor(readonly nodeIds: string[], profile: ArchitectureProjectionProfile) {
    super(`${PROJECTION_FOOTPRINT_UNCOVERED}: ${nodeIds.join(", ")} declare source.include, but neither the node nor an ancestor has an entity-summary target under profile ${profile}`);
  }
}

/**
 * A committed manifest that names the current `schemaVersion` but fails its contract. Nothing in it
 * is read; the operator restores the committed file from Git.
 */
export class ProjectionManifestInvalidError extends ProjectionPreconditionError {
  readonly reasonCode = PROJECTION_MANIFEST_INVALID;
  constructor(readonly issues: string[]) {
    super(`${PROJECTION_MANIFEST_INVALID}: ${issues.join("; ")}; restore ${ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH} from Git`);
  }
}

/**
 * Reads a committed manifest strictly. A superseded `schemaVersion` is refused with
 * `projection-manifest-upgrade-required`; any other manifest that is not a valid current-format
 * manifest is refused with `projection-manifest-invalid`.
 */
export function parseArchitectureDocsProjectionManifest(body: string): ArchitectureDocsProjectionManifestV4 {
  const schemaVersion = architectureDocsProjectionManifestSchemaVersion(body);
  if (isSupersededArchitectureDocsProjectionManifestSchemaVersion(schemaVersion)) throw new ProjectionManifestUpgradeRequiredError(schemaVersion!);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new ProjectionManifestInvalidError([error instanceof Error ? error.message : String(error)]);
  }
  const issues = architectureDocsProjectionManifestIssues(parsed);
  if (issues.length > 0) throw new ProjectionManifestInvalidError(issues);
  return parsed as ArchitectureDocsProjectionManifestV4;
}

/**
 * The manifest the previous projection committed, which carries the semantic baseline this run is
 * classified against. No manifest, or one that is not JSON or declares no
 * `schemaVersion` and no floors, carries no baseline: the drift check reports it and `apply` rewrites it. A
 * superseded manifest is refused unless `docs apply` re-baselines; a current-format manifest that
 * fails its contract is refused. An unrecognized declared schema or unsupported floor is refused.
 */
export function previousArchitectureDocsProjectionManifest(body: string | undefined, rebaselineSuperseded: boolean): ArchitectureDocsProjectionManifestV4 | undefined {
  if (body === undefined) return undefined;
  let candidate: unknown;
  try { candidate = JSON.parse(body); } catch { /* Existing malformed/missing-baseline handling remains below. */ }
  if (architectureDocsProjectionCompatibilityIssues(candidate).length) throw new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-incompatible");
  const schemaVersion = architectureDocsProjectionManifestSchemaVersion(body);
  if (isSupersededArchitectureDocsProjectionManifestSchemaVersion(schemaVersion)) {
    if (rebaselineSuperseded) return undefined;
    throw new ProjectionManifestUpgradeRequiredError(schemaVersion!);
  }
  if (schemaVersion !== ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION) return undefined;
  return parseArchitectureDocsProjectionManifest(body);
}

/**
 * Reads a committed manifest exactly as a projection render reads it, without rendering: a
 * superseded one throws `projection-manifest-upgrade-required` and a current-format one that fails
 * its contract throws `projection-manifest-invalid`. A manifest that is not JSON or names no
 * declared `schemaVersion` or floors carries no baseline and reads as undefined, as for a render.
 * `projection freshness` reads the committed profile through it.
 */
export function readCommittedArchitectureDocsProjectionManifest(body: string): ArchitectureDocsProjectionManifestV4 | undefined {
  return previousArchitectureDocsProjectionManifest(body, false);
}

/**
 * The one freshness evaluator. It compares the complete render's rows with the committed manifest
 * the render classified against, so a hand-edited document stays a drift finding and is not a
 * freshness one. A committed body that names no current-format manifest is unreadable; a superseded
 * or invalid one never reaches here, because the render refuses it first.
 */
export function evaluateArchitectureProjectionFreshness(input: {
  committedManifestBody: string | undefined;
  committedManifest: ArchitectureDocsProjectionManifestV4 | undefined;
  renderedTargets: ArchitectureDocsProjectionManifestV4["targets"];
  renderedManifestBody: string;
}): ArchitectureProjectionFreshnessEvaluation {
  if (input.committedManifest === undefined) return architectureProjectionFreshnessWithoutBaseline(input.committedManifestBody);
  const committed = input.committedManifest.targets;
  const staleTargets: ProjectionFreshnessStaleTargetV2[] = [];
  for (const targetId of [...new Set([...Object.keys(committed), ...Object.keys(input.renderedTargets)])].sort(compareStrings)) {
    const before = committed[targetId];
    const after = input.renderedTargets[targetId];
    if (before?.outputDigest === after?.outputDigest) continue;
    staleTargets.push({
      targetId,
      path: (after ?? before)!.path,
      committedOutputDigest: (before?.outputDigest ?? null) as ProjectionFreshnessStaleTargetV2["committedOutputDigest"],
      renderedOutputDigest: (after?.outputDigest ?? null) as ProjectionFreshnessStaleTargetV2["renderedOutputDigest"]
    });
  }
  if (staleTargets.length > 0) {
    return freshnessEvaluation(["projection-output-changed"], `${staleTargets.length} target(s) render differently from the committed manifest: ${staleTargets.map((target) => target.targetId).join(", ")}`, staleTargets);
  }
  if (input.committedManifestBody !== input.renderedManifestBody) {
    return freshnessEvaluation(["projection-manifest-changed"], "every output matches its committed row, but the manifest this render writes differs from the committed bytes", []);
  }
  return freshnessEvaluation([], "every target renders the output its committed row records", []);
}

/**
 * Freshness when no current-format committed manifest exists, so nothing can be compared and no
 * render is needed to answer: the manifest is absent, or its body names no current-format manifest.
 */
export function architectureProjectionFreshnessWithoutBaseline(committedManifestBody: string | undefined): ArchitectureProjectionFreshnessEvaluation {
  return committedManifestBody === undefined
    ? freshnessEvaluation(["projection-manifest-missing"], `${ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH} is absent; nothing records what the projection rendered`, [])
    : freshnessEvaluation(["projection-manifest-unreadable"], `${ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH} is not a ${ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION} manifest`, []);
}

function freshnessEvaluation(
  reasonCodes: ArchitectureProjectionFreshnessReasonCode[],
  detail: string,
  staleTargets: ProjectionFreshnessStaleTargetV2[]
): ArchitectureProjectionFreshnessEvaluation {
  return { schemaVersion: "archcontext.projection-freshness/v3", ok: reasonCodes.length === 0, reasonCodes, detail, staleTargets };
}
