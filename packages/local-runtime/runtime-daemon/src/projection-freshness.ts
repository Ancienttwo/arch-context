import { posix } from "node:path";
import type { ProjectionFreshnessV1, Sha256Digest } from "@archcontext/contracts";
import {
  architectureProjectionStampedNodeIds,
  digestArchitectureDocumentationSourceTree,
  digestCapabilitySourceFootprints,
  evaluateArchitectureProjectionFreshness,
  evaluateArchitectureProjectionSnapshotFreshness,
  loadArchitectureDocumentationProfile,
  loadArchitectureProjectionManifestStamps,
  loadCapabilitySourceFootprints,
  loadNativeModelFromArchContext,
  matchesGlob,
  nativeNodeSource,
  type ArchitectureProjectionFreshnessEvaluation,
  type ArchitectureProjectionManifestStampReadback,
  type ArchitectureProjectionProfile,
  type CapabilitySourceFootprintDigest,
  type NativeModel
} from "@archcontext/core/projection-engine";
import { listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";

/**
 * What the projection freshness evaluator compares the committed stamps against.
 *
 * - `tree`: every stamped node, plus the declared source tree digest against the manifest's
 *   snapshot provenance. `check`, the `complete` gate and an unscoped `projection freshness` use it.
 * - `nodes`: only the named stamped nodes (`projection freshness --changed-path`). The declared
 *   source tree digest needs every footprint hashed, so this scope does not compare it.
 */
export type ProjectionFreshnessScope =
  | { kind: "tree"; currentSourceTreeDigest: string }
  | { kind: "nodes"; nodeIds: readonly string[] };

/**
 * The one projection freshness evaluator (#259, #327). `projection run` in `check` mode, the
 * `complete` gate and `projection freshness` all answer "which stamped documents describe code that
 * moved?" here, so their `staleNodes` cannot disagree on the same tree. Callers measure the
 * footprint digests (`check` reuses the ones its run measured); the comparison is this function.
 */
export function evaluateProjectionFreshness(input: {
  model: NativeModel;
  /** The profile whose stamped nodes are probed. */
  profile: ArchitectureProjectionProfile | undefined;
  manifest: ArchitectureProjectionManifestStampReadback;
  sourceFootprints: CapabilitySourceFootprintDigest[];
  scope: ProjectionFreshnessScope;
}): ArchitectureProjectionFreshnessEvaluation {
  const { model, profile, manifest, sourceFootprints, scope } = input;
  return scope.kind === "tree"
    ? evaluateArchitectureProjectionSnapshotFreshness({ model, profile, manifest, sourceFootprints, currentSourceTreeDigest: scope.currentSourceTreeDigest })
    : evaluateArchitectureProjectionFreshness({ model, profile, manifest, sourceFootprints, nodeIds: scope.nodeIds });
}

/** The `ProjectionFreshnessV1` contract shape of an evaluation, as `check` and `projection freshness` report it. */
export function projectionFreshnessContract(evaluation: ArchitectureProjectionFreshnessEvaluation): ProjectionFreshnessV1 {
  return {
    ok: evaluation.ok,
    reasonCodes: [...evaluation.reasonCodes].sort(),
    staleNodes: evaluation.staleNodes.map((node) => ({
      nodeId: node.nodeId,
      stampedDigest: node.stampedDigest as Sha256Digest,
      currentDigest: node.currentDigest as Sha256Digest
    }))
  };
}

export interface ProjectionFreshnessMeasurement {
  manifestStatus: ArchitectureProjectionManifestStampReadback["status"];
  /** The committed manifest's profile; `null` when there is no readable manifest to name one. */
  profile: ArchitectureProjectionProfile | null;
  /** The `--changed-path` scope, sorted and unique; empty for the whole tree. */
  changedPaths: string[];
  /** The stamped nodes this evaluation probed, sorted; empty when the manifest is not readable. */
  evaluatedNodeIds: string[];
  /**
   * Present only when a `--changed-path` run was widened to the whole tree because a path is under
   * `.archcontext/`: `scope` is then `"tree"` and `scopeReason` names why. Absent for an unscoped
   * run and for a run that stayed on the changed paths' nodes.
   */
  scope?: "tree";
  scopeReason?: "model-path-changed";
  evaluation: ArchitectureProjectionFreshnessEvaluation;
}

/** The model directory: a path under it can change any node's stamp digest, whatever the footprint globs say. */
const PROJECTION_MODEL_ROOT = ".archcontext";

function isProjectionModelPath(path: string): boolean {
  return path === PROJECTION_MODEL_ROOT || path.startsWith(`${PROJECTION_MODEL_ROOT}/`);
}

/**
 * Measures freshness from repository files only: the committed manifest's stamps, the model and the
 * Git-visible files under each footprint. No code facts, no render, no daemon and no writes. The
 * committed manifest's profile selects the stamped nodes, as it selects the layout the `complete`
 * gate verifies.
 *
 * With `changedPaths`, only stamped nodes whose `source.include` matches one of the paths (and whose
 * `source.exclude` does not) are resolved, hashed and probed. Each path must be a normalized
 * repository-relative POSIX path (`assertProjectionFreshnessChangedPaths`).
 *
 * A node's stamp digest also depends on its own `source.include`/`exclude` and on the projection-owned
 * paths, both of which live in the model. A changed path under `.archcontext/` therefore matches no
 * footprint yet can make any node stale, so it fails closed: the run evaluates the whole tree exactly
 * as an unscoped run does and reports `scope: "tree"` with `scopeReason: "model-path-changed"`.
 */
export function measureProjectionFreshness(
  root: string,
  options: { manifest?: ArchitectureProjectionManifestStampReadback; changedPaths?: readonly string[] } = {}
): ProjectionFreshnessMeasurement {
  if (options.changedPaths !== undefined) assertProjectionFreshnessChangedPaths(options.changedPaths);
  const manifest = options.manifest ?? loadArchitectureProjectionManifestStamps(root);
  const model = loadNativeModelFromArchContext(root);
  const profile = manifest.status === "present" ? loadArchitectureDocumentationProfile(root) : undefined;
  const sourceFiles = listGitVisibleFiles(root);
  const stampedNodeIds = manifest.status === "present" ? architectureProjectionStampedNodeIds(model, profile) : [];
  const changedPaths = options.changedPaths === undefined ? [] : [...new Set(options.changedPaths)].sort((left, right) => left.localeCompare(right));
  const widened = options.changedPaths !== undefined && changedPaths.some(isProjectionModelPath);
  if (options.changedPaths === undefined || widened) {
    const footprints = loadCapabilitySourceFootprints(root, model, sourceFiles);
    return {
      manifestStatus: manifest.status,
      profile: profile ?? null,
      changedPaths,
      evaluatedNodeIds: stampedNodeIds,
      ...(widened ? { scope: "tree" as const, scopeReason: "model-path-changed" as const } : {}),
      evaluation: evaluateProjectionFreshness({
        model,
        profile,
        manifest,
        sourceFootprints: digestCapabilitySourceFootprints(root, model, footprints),
        scope: { kind: "tree", currentSourceTreeDigest: digestArchitectureDocumentationSourceTree(root, model, footprints) }
      })
    };
  }
  const stamped = new Set(stampedNodeIds);
  const selectedNodes = model.nodes.filter((node) => {
    if (!stamped.has(node.id)) return false;
    const source = nativeNodeSource(node);
    const include = source?.include ?? [];
    const exclude = source?.exclude ?? [];
    return changedPaths.some((path) =>
      include.some((pattern) => matchesGlob(path, pattern)) && !exclude.some((pattern) => matchesGlob(path, pattern)));
  });
  const evaluatedNodeIds = selectedNodes.map((node) => node.id).sort((left, right) => left.localeCompare(right));
  // Only the selected nodes' globs are matched and only their files are hashed. The owned-path
  // subtraction still reads the whole model, so a selected footprint loses exactly the paths it
  // loses in an unscoped run.
  const footprints = loadCapabilitySourceFootprints(root, { ...model, nodes: selectedNodes }, sourceFiles);
  return {
    manifestStatus: manifest.status,
    profile: profile ?? null,
    changedPaths,
    evaluatedNodeIds,
    evaluation: evaluateProjectionFreshness({
      model,
      profile,
      manifest,
      sourceFootprints: digestCapabilitySourceFootprints(root, model, footprints),
      scope: { kind: "nodes", nodeIds: evaluatedNodeIds }
    })
  };
}

/** Why a `--changed-path` value was refused. */
export type ProjectionFreshnessChangedPathReasonCode = "changed-path-outside-worktree" | "changed-path-not-normalized";

export class ProjectionFreshnessChangedPathError extends Error {
  readonly code = "AC_SCHEMA_INVALID" as const;
  constructor(readonly reasonCode: ProjectionFreshnessChangedPathReasonCode, readonly changedPath: string) {
    super(reasonCode === "changed-path-outside-worktree"
      ? `--changed-path must be a repository-relative path inside the worktree: ${JSON.stringify(changedPath)}`
      : `--changed-path must be a normalized repository-relative POSIX path: ${JSON.stringify(changedPath)}`);
    this.name = "ProjectionFreshnessChangedPathError";
  }
}

/**
 * A changed path is matched against footprint globs as written, so it must be the repository-relative
 * POSIX spelling Git lists. An absolute path, a backslash or a `..` segment can name a file outside
 * the worktree; `./a`, `a//b` or a trailing `/` cannot match a Git-visible file path.
 */
export function assertProjectionFreshnessChangedPaths(changedPaths: readonly string[]): void {
  for (const path of changedPaths) {
    if (path === "" || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("\\") || path.split("/").includes("..")) {
      throw new ProjectionFreshnessChangedPathError("changed-path-outside-worktree", path);
    }
    if (path === "." || path.endsWith("/") || posix.normalize(path) !== path) {
      throw new ProjectionFreshnessChangedPathError("changed-path-not-normalized", path);
    }
  }
}
