import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import {
  ARCHITECTURE_DOCS_PROJECTION_PROVENANCE_SCHEMA_VERSION,
  FailureError,
  architectureDocsProjectionProvenanceIssues,
  architectureSourceTreeDigest,
  digestJson,
  isRuntimeTopologyNodeKind,
  type ArchitectureDocumentationProjectionProvenanceV3,
  type Json
} from "@archcontext/contracts";
import { assertRepoRelativePath, computeWorktreeDigest, matchesGlob, nativeNodeSource, type NativeModel, type NativeNode } from "@archcontext/core/architecture-domain";
import { assertPathHasNoSymlinkSegments } from "@archcontext/core/changeset-engine";
import { agentContextProjectionTargetPaths } from "./agent-context";
import {
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  agentContextTargetPaths,
  entitySummaryTargetNodes,
  RUNTIME_TOPOLOGY_SCOPE_ID,
  type ArchitectureProjectionProfile
} from "./layout";
import {
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  type ArchitectureCapabilityScaleV1,
  type ArchitectureScaleBucketV1,
  type CapabilitySourceFootprint,
  type CapabilitySourceFootprintDigest,
  type CapabilitySourceScaleSignal
} from "./docs-types";
import { compareStrings } from "./exports-dsl";
import { ProjectionFootprintUncoveredError } from "./freshness";

/**
 * The scope id of the targets that document each declared source footprint under `profile`. Keys
 * are every node that declares `source.include`. A runtime topology node's footprint (its
 * configuration files, ADR-0049) belongs to both topology targets, `RUNTIME_TOPOLOGY_SCOPE_ID`,
 * which the layout adds whenever such a node exists. Any other footprint belongs to the nearest
 * ancestor-or-self of the declaring node that has an entity-summary target, by node id. A declared
 * footprint with no such node throws `ProjectionFootprintUncoveredError`, naming every uncovered
 * node.
 */
export function architectureProjectionFootprintOwners(model: NativeModel, profile: ArchitectureProjectionProfile = "default"): Map<string, string> {
  const targetNodeIds = new Set(entitySummaryTargetNodes(model.nodes, profile).map((node) => node.id));
  const nodesById = new Map(model.nodes.map((node) => [node.id, node]));
  const owners = new Map<string, string>();
  const uncovered: string[] = [];
  for (const node of [...model.nodes].sort((left, right) => compareStrings(left.id, right.id))) {
    if ((nativeNodeSource(node)?.include ?? []).length === 0) continue;
    if (isRuntimeTopologyNodeKind(node.kind)) {
      owners.set(node.id, RUNTIME_TOPOLOGY_SCOPE_ID);
      continue;
    }
    const seen = new Set<string>();
    let current: NativeNode | undefined = node;
    while (current && !targetNodeIds.has(current.id) && !seen.has(current.id)) {
      seen.add(current.id);
      current = typeof current.parent === "string" ? nodesById.get(current.parent) : undefined;
    }
    if (current && targetNodeIds.has(current.id)) owners.set(node.id, current.id);
    else uncovered.push(node.id);
  }
  if (uncovered.length > 0) throw new ProjectionFootprintUncoveredError(uncovered, profile);
  return owners;
}

export function architectureDocumentationSourceTreeDigest(root: string, model: NativeModel, sourceFiles: readonly string[]): string {
  return digestArchitectureDocumentationSourceTree(root, model, loadCapabilitySourceFootprints(root, model, sourceFiles));
}

/**
 * The declared source tree digest over footprints the caller already resolved for this run
 * (`loadCapabilitySourceFootprints`), so one build matches the globs once (#324). It is the digest
 * of every node's footprint digest (`architectureSourceTreeDigest`). Runtime provenance only: it
 * binds the CodeGraph index and the expected snapshot to the measured tree and is never committed.
 */
export function digestArchitectureDocumentationSourceTree(root: string, model: NativeModel, footprints: readonly CapabilitySourceFootprint[]): string {
  return architectureSourceTreeDigest(Object.fromEntries(
    digestCapabilitySourceFootprints(root, model, footprints).map((footprint) => [footprint.nodeId, footprint.digest])
  ));
}

/**
 * Content digest of one declared source file with CRLF line endings normalized to LF. Checkouts
 * that apply `core.autocrlf` (Windows runners and developer machines) then measure the same
 * footprint as a Linux clone of the same commit, so footprint digests and the snapshot digest do not
 * depend on the platform that computed them. The latin1 round trip rewrites only `\r\n` pairs and
 * leaves every other byte as is.
 */
function sourceFileContentDigest(absolute: string): string {
  return sourceContentDigest(readFileSync(absolute));
}

/** The digest of `sourceFileContentDigest` over bytes the caller already read. */
export function sourceContentDigest(bytes: Buffer): string {
  const normalized = bytes.includes(0x0d) ? Buffer.from(bytes.toString("latin1").replaceAll("\r\n", "\n"), "latin1") : bytes;
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

/**
 * Fixed-point worktree digest: projection-owned outputs cannot hash the manifest that embeds it.
 * `files` is the repository's Git-visible universe (`listGitVisibleFiles`), the same one the source
 * footprints are measured over.
 */
export function architectureDocumentationProjectionWorktreeDigest(
  root: string,
  model: NativeModel,
  files: readonly string[]
): string {
  return computeWorktreeDigest(root, files, {
    ignore: [
      ".ai/harness",
      "docs/architecture",
      ...agentContextTargetPaths(model.nodes, "default").map((target) => target.path)
    ]
  });
}

export function architectureDocumentationProjectionInputDigest(
  input: Omit<ArchitectureDocumentationProjectionProvenanceV3, "schemaVersion" | "projectionInputDigest">
): string {
  return digestJson(input as unknown as Json);
}

export function architectureDocumentationProjectionProvenance(
  input: Omit<ArchitectureDocumentationProjectionProvenanceV3, "schemaVersion" | "projectionInputDigest">
): ArchitectureDocumentationProjectionProvenanceV3 {
  return {
    schemaVersion: ARCHITECTURE_DOCS_PROJECTION_PROVENANCE_SCHEMA_VERSION,
    ...input,
    projectionInputDigest: architectureDocumentationProjectionInputDigest(input)
  };
}

export function assertArchitectureDocumentationProjectionProvenance(
  provenance: ArchitectureDocumentationProjectionProvenanceV3,
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION
): void {
  const issues = architectureDocsProjectionProvenanceIssues(provenance);
  if (issues.length > 0) throw new Error(`architecture-docs-projection-provenance-schema-invalid: ${issues.join("; ")}`);
  if (provenance.rendererVersion !== rendererVersion || provenance.layoutVersion !== ARCHITECTURE_DOCS_LAYOUT_VERSION) {
    throw new Error("architecture-docs-projection-provenance-version-mismatch");
  }
  const { schemaVersion: _schemaVersion, projectionInputDigest: _projectionInputDigest, ...payload } = provenance;
  if (architectureDocumentationProjectionInputDigest(payload) !== provenance.projectionInputDigest) {
    throw new Error("architecture-docs-projection-input-digest-mismatch");
  }
}

/**
 * Measures the `source.include` minus `source.exclude` footprint of every node that declares one,
 * minus `projectionOwnedPaths`. Nodes without `source.include` are absent from the result on
 * purpose: the renderer prints an explicit "not derivable" note for them instead of a zero that
 * reads like a measurement.
 */
export function loadCapabilitySourceScaleSignals(root: string, model: NativeModel, sourceFiles: readonly string[]): CapabilitySourceScaleSignal[] {
  return measureCapabilitySourceScaleSignals(root, model, loadCapabilitySourceFootprints(root, model, sourceFiles));
}

/** `loadCapabilitySourceScaleSignals` over footprints the caller already resolved for this run. */
export function measureCapabilitySourceScaleSignals(root: string, model: NativeModel, footprints: readonly CapabilitySourceFootprint[]): CapabilitySourceScaleSignal[] {
  const ownedPathPatterns = projectionOwnedPaths(model);
  return footprints.map((footprint) => {
    const files = footprint.files.filter((path) => !ownedPathPatterns.some((pattern) => matchesGlob(path, pattern)));
    return {
      nodeId: footprint.nodeId,
      fileCount: files.length,
      lineCount: files.reduce((total, path) => total + countFileLines(resolve(root, path)), 0),
      includePatterns: footprint.includePatterns,
      excludePatterns: footprint.excludePatterns
    };
  });
}

/** Never capability source, even when tracked: Git metadata and vendored dependency trees. */
const FOOTPRINT_SKIPPED_SEGMENTS = new Set([".git", "node_modules"]);

/**
 * Resolves every node's `source.include` minus `source.exclude` to the repo-relative files it
 * selects. Shared by the scale signal loader, the footprint digests, the source tree digest and the
 * code-index adapter that measures import edges, so all of them answer "which files belong to this
 * capability" the same way.
 *
 * `sourceFiles` is the universe the globs are matched against: the repository's Git-visible files
 * (tracked plus untracked, non-ignored), listed by the local runtime's Git adapter
 * (`listGitVisibleFiles`). Core never walks the filesystem for it, so a gitignored file under
 * a declared include — a build artifact, a cache, a local secret — can never enter a footprint, a
 * digest or a scale signal. Every listed path must be a readable regular file under `root`.
 */
export function loadCapabilitySourceFootprints(root: string, model: NativeModel, sourceFiles: readonly string[]): CapabilitySourceFootprint[] {
  const nodes = model.nodes.filter((node) => (nativeNodeSource(node)?.include ?? []).length > 0);
  if (nodes.length === 0) return [];
  const scanned = [...new Set(sourceFiles)]
    .filter((path) => !path.split("/").some((segment) => FOOTPRINT_SKIPPED_SEGMENTS.has(segment)))
    .sort((left, right) => left.localeCompare(right));
  return nodes
    .map((node) => {
      const source = nativeNodeSource(node)!;
      const includePatterns = [...(source.include ?? [])];
      const excludePatterns = [...(source.exclude ?? [])];
      const files = scanned
        .filter((path) =>
          !excludePatterns.some((pattern) => matchesGlob(path, pattern))
          && includePatterns.some((pattern) => matchesGlob(path, pattern))
        )
        .sort((left, right) => left.localeCompare(right));
      return { nodeId: node.id, files, includePatterns, excludePatterns };
    })
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

function countFileLines(absolute: string): number {
  const content = readFileSync(absolute, "utf8");
  if (content === "") return 0;
  const newlines = content.split("\n").length - 1;
  return content.endsWith("\n") ? newlines : newlines + 1;
}

/**
 * The 1–2–5 magnitude bucket that contains a measured count (`537` → `{ lower: 500, upper: 1000 }`,
 * `172275` → `{ lower: 100000, upper: 200000 }`, `0` → `{ lower: 0, upper: 1 }`).
 *
 * The projection records the bucket, never the count. A capability's declared footprint is measured
 * against the working tree, so an exact count in a Git-tracked document rewrites that document on
 * every edit anywhere under the footprint — for a capability covering `tests/**` that is several
 * commits a day, and it drowns the diffs that mean an architecture assertion changed.
 * The bucket carries the whole decision the signal exists to support ("how big is this capability")
 * at a resolution ordinary edits cannot move.
 *
 * A bucket is a half-open range `[lower, upper)`; reporting both ends states the resolution instead
 * of implying a point estimate the renderer does not have.
 */
function scaleMagnitudeBucket(value: number): ArchitectureScaleBucketV1 {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`architecture-docs-projection-scale-signal-not-a-count: ${value}`);
  }
  if (value === 0) return { lower: 0, upper: 1 };
  const mantissas = [1, 2, 5];
  let index = 0;
  let magnitude = 1;
  let lower = 1;
  for (;;) {
    const nextIndex = (index + 1) % mantissas.length;
    const nextMagnitude = nextIndex === 0 ? magnitude * 10 : magnitude;
    const upper = mantissas[nextIndex] * nextMagnitude;
    if (upper > value) return { lower, upper };
    index = nextIndex;
    magnitude = nextMagnitude;
    lower = upper;
  }
}

/** The structured scale of one measured footprint; the module document prints exactly this value. */
export function architectureCapabilityScale(signal: CapabilitySourceScaleSignal): ArchitectureCapabilityScaleV1 {
  return {
    fileCountBucket: scaleMagnitudeBucket(signal.fileCount),
    lineCountBucket: scaleMagnitudeBucket(signal.lineCount)
  };
}

/** Prints a bucket as `500–1000` or `100k–200k`; both ends share the unit chosen from the lower bound. */
export function scaleMagnitudeBucketLabel(bucket: ArchitectureScaleBucketV1): string {
  if (bucket.lower === 0) return "0";
  const unit = bucket.lower >= 1_000_000 ? 1_000_000 : bucket.lower >= 10_000 ? 1_000 : 1;
  const suffix = unit === 1_000_000 ? "M" : unit === 1_000 ? "k" : "";
  return `${bucket.lower / unit}${suffix}–${bucket.upper / unit}${suffix}`;
}

/**
 * Repo-relative path patterns the projection itself writes: the architecture documentation tree
 * (including its manifest) and every agent-context contract file the model designates. The contract
 * files come from the `default` derivation, so under `repo-harness/v1` this is a superset: it also
 * lists the root contract files, which only the default-profile `archctx agent-context` writes.
 *
 * Footprint digests subtract these. An agent-context target lands inside its own capability's
 * declared `source.include` footprint, so counting the projection's own output as capability
 * source would make every projection report the capability stale, which would demand another
 * projection producing the same bytes — a loop with no fixed point.
 *
 * Scale signals subtract them too (ADR-0056 §6), so no render input reads a projection output and
 * an apply reaches its fixed point in one step. Single point of truth: every consumer that needs to
 * know "did the projection write this?" derives it here, so they can never disagree.
 */
export function projectionOwnedPaths(model: NativeModel): string[] {
  return [
    "docs/architecture/**",
    ...agentContextProjectionTargetPaths(model).map((target) => target.path)
  ].sort((left, right) => left.localeCompare(right));
}

/**
 * Per-node footprint digests: for every node that declares `source.include`, the content digest of
 * the files it selects (the same include/exclude predicate `loadCapabilitySourceFootprints` feeds
 * the renderer) minus `projectionOwnedPaths`. Paths and bytes both enter the digest, so adding,
 * removing, renaming or editing a covered file moves it and nothing outside the footprint can.
 * Only Git-visible files count (`sourceFiles`); the digest reads file contents, never Git history.
 */
export function loadCapabilitySourceFootprintDigests(root: string, model: NativeModel, sourceFiles: readonly string[]): CapabilitySourceFootprintDigest[] {
  return digestCapabilitySourceFootprints(root, model, loadCapabilitySourceFootprints(root, model, sourceFiles));
}

/** `loadCapabilitySourceFootprintDigests` over footprints the caller already resolved for this run. */
export function digestCapabilitySourceFootprints(root: string, model: NativeModel, footprints: readonly CapabilitySourceFootprint[]): CapabilitySourceFootprintDigest[] {
  const ownedPathPatterns = projectionOwnedPaths(model);
  // Footprints nest (a capability's include covers its components'), so one file is read once per call.
  const fileDigests = new Map<string, string>();
  const fileDigest = (path: string) => {
    let digest = fileDigests.get(path);
    if (digest === undefined) {
      digest = sourceFileContentDigest(resolve(root, path));
      fileDigests.set(path, digest);
    }
    return digest;
  };
  return footprints.map((footprint) => {
    const files = footprint.files.filter((path) => !ownedPathPatterns.some((pattern) => matchesGlob(path, pattern)));
    return {
      nodeId: footprint.nodeId,
      fileCount: files.length,
      digest: digestJson({
        schemaVersion: "archcontext.capability-source-footprint/v1",
        files: files.map((path) => ({
          path,
          digest: fileDigest(path)
        }))
      } as unknown as Json)
    };
  });
}
