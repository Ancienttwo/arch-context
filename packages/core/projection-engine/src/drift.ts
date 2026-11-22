import {
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH,
  digestJson,
  type ArchitectureDocsProjectionManifestV4,
  type Json,
  type ProjectionTargetV1
} from "@archcontext/contracts";
import { generatedMarkerAttributes, scanDocumentRegions } from "./document-regions";
import { committedAgentContextOutputs, committedGeneratedOutputs, RETIRED_ARCHITECTURE_CHANGELOG, type CommittedGeneratedOutput } from "./layout";
import { agentContextRegionBodyDigest, findAgentContextRegion, type AgentContextProjectionTarget } from "./agent-context";
import type {
  ArchitectureDocumentationDriftReason,
  ArchitectureDocumentationExistingFile,
  ArchitectureDocumentationProjectionDrift,
  ArchitectureDocumentationProjectionFile,
  ArchitectureDocumentationProjectionOrphan
} from "./docs-types";
import {
  committedEntitySummaryTargets,
  findAnyGeneratedRegion,
  findGeneratedRegion,
  generatedOutputDigest,
  isManagedArchitectureDocumentationMarkdownPath,
  orphanHoldsOnlyIntactGeneratedRegion,
  orphanSkeletons,
  parseGeneratedRegionMetadata,
  retiredChangelogHoldsOnlyPlaceholder
} from "./regions";

export function architectureDocumentationProjectionDrift(input: {
  targets: ProjectionTargetV1[];
  expectedFiles: ArchitectureDocumentationProjectionFile[];
  expectedManifest: ArchitectureDocumentationExistingFile & { digest: string };
  /** The committed manifest the render classified against, when it is a current-format manifest. */
  previousManifest: ArchitectureDocsProjectionManifestV4 | undefined;
  existingFiles: ArchitectureDocumentationExistingFile[];
}): {
  ok: boolean;
  reasonCodes: ArchitectureDocumentationDriftReason[];
  diffs: ArchitectureDocumentationProjectionDrift[];
  orphans: ArchitectureDocumentationProjectionOrphan[];
} {
  const existingByPath = new Map(input.existingFiles.map((file) => [file.path, file]));
  const expectedByPath = new Map(input.expectedFiles.map((file) => [file.path, file]));
  const targetIds = new Set(input.targets.map((target) => target.targetId));
  const diffs: ArchitectureDocumentationProjectionDrift[] = [];
  const orphans: ArchitectureDocumentationProjectionOrphan[] = [];

  const existingManifest = existingByPath.get(input.expectedManifest.path);
  const committedEntityTargets = committedEntitySummaryTargets(input.previousManifest);
  const committedGenerated = committedGeneratedOutputs(input.previousManifest);
  const committedGeneratedByTargetId = new Map(committedGenerated.map((output) => [output.targetId, output]));
  if (!existingManifest) {
    diffs.push({
      path: input.expectedManifest.path,
      reasonCode: "projection-manifest-missing",
      expectedDigest: input.expectedManifest.digest
    });
  } else {
    try {
      const parsed = JSON.parse(existingManifest.body) as Json;
      const actualDigest = digestJson(parsed);
      // Bytes, not parsed values: the line layout is what keeps two capabilities' changes on
      // disjoint lines (`serializeArchitectureDocsProjectionManifest`), so a reformatted manifest is stale.
      if (existingManifest.body !== input.expectedManifest.body) {
        diffs.push({
          path: input.expectedManifest.path,
          reasonCode: "projection-manifest-stale",
          expectedDigest: input.expectedManifest.digest,
          actualDigest
        });
      }
    } catch {
      diffs.push({
        path: input.expectedManifest.path,
        reasonCode: "projection-manifest-invalid",
        expectedDigest: input.expectedManifest.digest,
        actualDigest: digestJson({ path: existingManifest.path, body: existingManifest.body } as unknown as Json)
      });
    }
  }

  for (const expected of input.expectedFiles) {
    const existing = existingByPath.get(expected.path);
    if (!existing) {
      diffs.push({ path: expected.path, targetId: expected.target.targetId, reasonCode: "projection-file-missing", expectedDigest: expected.digest });
      continue;
    }
    if (expected.target.ownership === "generated") {
      const diff = generatedFileDrift(expected, existing, committedGeneratedByTargetId.get(expected.target.targetId));
      if (diff) diffs.push(diff);
      continue;
    }
    if (expected.target.type === "agent-context") {
      const diff = agentContextRegionDrift(expected, existing);
      if (diff) diffs.push(diff);
      continue;
    }
    const region = findGeneratedRegion(existing.body, expected.target.targetId);
    if (!region) {
      diffs.push({
        path: expected.path,
        targetId: expected.target.targetId,
        reasonCode: "projection-adoption-required",
        expectedDigest: expected.digest,
        actualDigest: digestJson({ path: existing.path, body: existing.body } as unknown as Json)
      });
      continue;
    }
    // Integrity first: a region whose body no longer digests to the output its own marker records
    // holds machine text someone edited, whatever this run renders.
    const metadata = parseGeneratedRegionMetadata(region.startMarker);
    const actualGeneratedBodyDigest = digestJson({
      targetId: expected.target.targetId,
      body: `${region.body.trimEnd()}\n`
    } as unknown as Json);
    if (actualGeneratedBodyDigest !== metadata.outputDigest) {
      diffs.push({
        path: expected.path,
        targetId: expected.target.targetId,
        reasonCode: "projection-generated-region-manually-edited",
        expectedDigest: expected.generatedBodyDigest,
        actualDigest: actualGeneratedBodyDigest
      });
      continue;
    }
    // Intact, but not the marker this run writes: another renderer version, or an output this run
    // no longer renders. A document awaiting re-verification, not a hand edit.
    if (region.startMarker !== expected.target.generatedRegion.startMarker) {
      diffs.push({
        path: expected.path,
        targetId: expected.target.targetId,
        reasonCode: "projection-generated-region-stale",
        expectedDigest: expected.generatedBodyDigest,
        actualDigest: actualGeneratedBodyDigest
      });
    }
  }

  const currentPathByTargetId = new Map(input.targets.map((target) => [target.targetId, target.path]));
  const committedGeneratedByPath = new Map(committedGenerated.map((output) => [output.path, output]));
  for (const existing of input.existingFiles) {
    if (existing.path === input.expectedManifest.path || expectedByPath.has(existing.path)) continue;
    // A whole-file output is an orphan when the committed manifest records it and the current
    // layout no longer renders that target at that path. Its manifest row, not a marker, says so.
    const generated = committedGeneratedByPath.get(existing.path);
    if (generated && currentPathByTargetId.get(generated.targetId) !== generated.path) {
      const actualDigest = digestJson({ path: existing.path, body: existing.body } as unknown as Json);
      diffs.push({ path: existing.path, targetId: generated.targetId, reasonCode: "projection-orphaned", actualDigest });
      orphans.push({
        path: existing.path,
        targetId: generated.targetId,
        actualDigest,
        disposition: generatedOutputDigest(generated.targetId, existing.body) === generated.outputDigest ? "delete" : "human-review"
      });
      continue;
    }
    // Only the re-baseline of a superseded manifest loads the retired changelog (ADR-0057).
    if (existing.path === RETIRED_ARCHITECTURE_CHANGELOG.path) {
      const actualDigest = digestJson({ path: existing.path, body: existing.body } as unknown as Json);
      diffs.push({ path: existing.path, targetId: RETIRED_ARCHITECTURE_CHANGELOG.targetId, reasonCode: "projection-orphaned", actualDigest });
      orphans.push({
        path: existing.path,
        targetId: RETIRED_ARCHITECTURE_CHANGELOG.targetId,
        actualDigest,
        disposition: retiredChangelogHoldsOnlyPlaceholder(existing.body) ? "delete" : "human-review"
      });
      continue;
    }
    if (!isManagedArchitectureDocumentationMarkdownPath(existing.path)) continue;
    const region = findAnyGeneratedRegion(existing.body);
    if (region && !targetIds.has(region.targetId)) {
      const actualDigest = digestJson({ path: existing.path, body: existing.body } as unknown as Json);
      diffs.push({ path: existing.path, targetId: region.targetId, reasonCode: "projection-orphaned", actualDigest });
      orphans.push({
        path: existing.path,
        targetId: region.targetId,
        actualDigest,
        disposition: orphanHoldsOnlyIntactGeneratedRegion(existing.body, region.targetId, orphanSkeletons(committedEntityTargets, existing.path, region.targetId)) ? "delete" : "human-review"
      });
    }
  }

  // A committed agent-context row the current layout no longer renders leaves its region behind in
  // a contract file outside `docs/architecture/`. The projection writes only paths the model
  // designates, so only a human removes that region; the next apply then drops the row.
  for (const output of committedAgentContextOutputs(input.previousManifest)) {
    if (currentPathByTargetId.get(output.targetId) === output.path) continue;
    const existing = existingByPath.get(output.path);
    if (existing === undefined || findAgentContextRegion(existing.body, output.nodeId) === undefined) continue;
    const actualDigest = digestJson({ path: existing.path, body: existing.body } as unknown as Json);
    diffs.push({ path: existing.path, targetId: output.targetId, reasonCode: "projection-orphaned", actualDigest });
    orphans.push({ path: existing.path, targetId: output.targetId, actualDigest, disposition: "human-review" });
  }

  const reasonCodes = [...new Set(diffs.map((diff) => diff.reasonCode))].sort() as ArchitectureDocumentationDriftReason[];
  return {
    ok: diffs.length === 0,
    reasonCodes,
    diffs: diffs.sort((left, right) => left.path.localeCompare(right.path) || (left.targetId ?? "").localeCompare(right.targetId ?? "")),
    orphans: orphans.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  };
}

/**
 * The mixed-target rules of ADR-0047 for one node's region in a contract file, read with the
 * agent-context marker parser: a missing region is appended, an edited or stale one is rewritten.
 * A duplicate, overlapping or malformed marker throws.
 */
function agentContextRegionDrift(expected: ArchitectureDocumentationProjectionFile, existing: ArchitectureDocumentationExistingFile): ArchitectureDocumentationProjectionDrift | undefined {
  const target = expected.target as AgentContextProjectionTarget;
  const region = findAgentContextRegion(existing.body, target.scope.id);
  const base = { path: expected.path, targetId: target.targetId, expectedDigest: expected.generatedBodyDigest };
  if (region === undefined) return { ...base, reasonCode: "projection-generated-region-missing" };
  const actualDigest = agentContextRegionBodyDigest(existing.body, region, target.scope.id);
  if (actualDigest !== region.outputDigest) return { ...base, reasonCode: "projection-generated-region-manually-edited", actualDigest };
  if (region.startMarker !== target.generatedRegion.startMarker) return { ...base, reasonCode: "projection-generated-region-stale", actualDigest };
  return undefined;
}

/**
 * Drift of one `generated` (whole-file) target. The file carries no marker, so ownership and state
 * come from the bytes and the committed manifest row: bytes equal to this run's render are fresh;
 * bytes equal to the committed row are the projection's own earlier output, stale; any other bytes
 * under a committed row were edited by hand. Without a committed row for the target at this path,
 * nothing proves the projection wrote the file, so it is not overwritten.
 */
function generatedFileDrift(
  expected: ArchitectureDocumentationProjectionFile,
  existing: ArchitectureDocumentationExistingFile,
  committed: CommittedGeneratedOutput | undefined
): ArchitectureDocumentationProjectionDrift | undefined {
  if (existing.body === expected.body) return undefined;
  const targetId = expected.target.targetId;
  const actualOutputDigest = generatedOutputDigest(targetId, existing.body);
  if (!committed || committed.path !== expected.path) {
    return {
      path: expected.path,
      targetId,
      reasonCode: "projection-ambiguous-ownership",
      expectedDigest: expected.digest,
      actualDigest: digestJson({ path: existing.path, body: existing.body } as unknown as Json)
    };
  }
  return {
    path: expected.path,
    targetId,
    reasonCode: actualOutputDigest === committed.outputDigest ? "projection-generated-file-stale" : "projection-generated-file-manually-edited",
    expectedDigest: expected.generatedBodyDigest,
    actualDigest: actualOutputDigest
  };
}
