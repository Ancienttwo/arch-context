import {
  projectionTargetChangeClassification,
  type ArchitectureCapabilitySemanticStateV1,
  type ArchitectureDocsProjectionManifestTargetV3,
  type ArchitectureDocsProjectionManifestV3,
  type ProjectionCoverageBlockedTargetV1,
  type ProjectionFileResultV1,
  type ProjectionTargetChangePlannedAction,
  type ProjectionTargetChangeReasonCode,
  type ProjectionTargetChangeV1
} from "@archcontext/contracts";

/** What one `check` or `plan` render knows, and the result's own write decision. */
export interface ProjectionTargetChangeInput {
  /** The committed current-format manifest the render classified against; undefined without one. */
  committed: ArchitectureDocsProjectionManifestV3 | undefined;
  /** Every current target's row as the complete render produced it, carried-forward targets included. */
  renderedTargets: Record<string, ArchitectureDocsProjectionManifestTargetV3>;
  /** The digest of the current model (`provenance.modelDigest`), which the committed `semanticBaseline.modelDigest` anchors. */
  modelDigest: string;
  /** The current semantic state of every capability. */
  capabilities: readonly ArchitectureCapabilitySemanticStateV1[];
  /** Per capability: the digest of the proof-relevant selector evidence this run measured. */
  selectorEvidenceDigests: Readonly<Record<string, string>>;
  /** The result's `files[]`: the one decision of what the write changes (`projectionWriteFileResults`). */
  files: readonly ProjectionFileResultV1[];
  /** Paths the render rejected for adoption or ownership repair; `files[]` reports them, no apply writes them. */
  rejected: readonly { path: string; reasonCode: string }[];
  orphans: readonly { path: string; targetId: string; disposition: "delete" | "human-review" }[];
  /** Phase 1 isolation's carried-forward targets (`coverage.blockedTargets`), the blocking authority. */
  blockedTargets: readonly ProjectionCoverageBlockedTargetV1[];
}

const REJECTION_REASONS: Readonly<Record<string, ProjectionTargetChangeReasonCode>> = {
  "projection-adoption-required": "adoption-required",
  "projection-ambiguous-ownership": "ambiguous-ownership"
};

/**
 * Classifies every target of a `check` or `plan` result (#327 finding 2): the union of the current
 * targets, the committed manifest's rows and the orphans, one entry per path, sorted by path. Each
 * comparison reads values the render already holds (row stamps and output digests, the model
 * digest, per-capability semantic and flow-proof fingerprints, selector-evidence digests);
 * `plannedAction` is the result's `files[]` action, never a second comparison, and `outputChanged`
 * reads the `files[]` action even where a rejection blocks the write. Nothing here changes what a
 * run writes or reports as its status.
 */
export function classifyProjectionTargetChanges(input: ProjectionTargetChangeInput): ProjectionTargetChangeV1[] {
  const committed = input.committed;
  const committedRows = committed?.targets ?? {};
  const baseById = new Map((committed?.semanticBaseline.capabilities ?? []).map((capability) => [capability.capabilityId, capability]));
  const currentById = new Map(input.capabilities.map((capability) => [capability.capabilityId, capability]));
  const capabilityIds = [...new Set([...baseById.keys(), ...currentById.keys()])].sort(compareStrings);
  const membersById = new Map(capabilityIds.map((id) => [id, new Set([...(baseById.get(id)?.memberNodeIds ?? []), ...(currentById.get(id)?.memberNodeIds ?? [])])]));
  // A target that describes the whole model also renders nodes no capability owns, so a model
  // change outside every capability still moves it (conservatively, even when its bytes do not).
  const modelChanged = committed !== undefined && committed.semanticBaseline.modelDigest !== input.modelDigest;
  const semanticChangedIds = new Set(committed === undefined ? [] : capabilityIds.filter((id) => {
    const before = baseById.get(id);
    const after = currentById.get(id);
    return before === undefined || after === undefined || before.semanticFingerprint !== after.semanticFingerprint;
  }));
  const proofReasonsById = new Map<string, ProjectionTargetChangeReasonCode[]>();
  for (const id of capabilityIds) {
    const before = baseById.get(id);
    const after = currentById.get(id);
    if (before === undefined || after === undefined) continue;
    const reasons: ProjectionTargetChangeReasonCode[] = [];
    if (before.flowProofFingerprint !== after.flowProofFingerprint) reasons.push("flow-proof-changed");
    if (before.selectorEvidenceDigest !== input.selectorEvidenceDigests[id]) reasons.push("selector-evidence-changed");
    if (reasons.length > 0) proofReasonsById.set(id, reasons);
  }
  const fileByPath = new Map(input.files.map((file) => [file.path, file]));
  const rejectedByPath = new Map(input.rejected.map((entry) => [entry.path, entry.reasonCode]));
  const orphanByPath = new Map(input.orphans.map((orphan) => [orphan.path, orphan]));
  const blockedByPath = new Map(input.blockedTargets.map((target) => [target.path, target]));

  // One entry per path. A committed row describes a current target only at the same path; a row
  // whose path no current target renders is a removed target, and an orphan no row records is a
  // removed target without a committed row.
  const entries: Array<{ targetId: string; path: string; current?: ArchitectureDocsProjectionManifestTargetV3; committed?: ArchitectureDocsProjectionManifestTargetV3 }> = [];
  for (const [targetId, row] of Object.entries(input.renderedTargets)) {
    const committedRow = committedRows[targetId];
    entries.push({ targetId, path: row.path, current: row, ...(committedRow?.path === row.path ? { committed: committedRow } : {}) });
  }
  const covered = new Set(entries.map((entry) => entry.path));
  for (const [targetId, row] of Object.entries(committedRows)) {
    if (covered.has(row.path)) continue;
    entries.push({ targetId, path: row.path, committed: row });
    covered.add(row.path);
  }
  for (const orphan of input.orphans) {
    if (covered.has(orphan.path)) continue;
    entries.push({ targetId: orphan.targetId, path: orphan.path });
    covered.add(orphan.path);
  }

  return entries.map((entry): ProjectionTargetChangeV1 => {
    const reasons = new Set<ProjectionTargetChangeReasonCode>();
    const affected = new Set<string>();
    const row = entry.current ?? entry.committed;
    let stampChanged: boolean | null = null;
    let semanticChanged: boolean | null = null;
    let proofChanged: boolean | null = null;
    if (committed === undefined) {
      reasons.add("baseline-missing");
    } else if (row === undefined) {
      reasons.add("target-row-missing");
    } else {
      // An entity summary documents the capabilities its node and its stamped nodes belong to; any
      // other target (index, decisions, changelog, diagrams, relation summaries) describes the
      // whole model and renders no flow proof.
      const entity = row.type === "entity-summary";
      const nodeIds = [row.scope.id, ...Object.keys(entry.current?.sourceStamps ?? {}), ...Object.keys(entry.committed?.sourceStamps ?? {})]
        .filter((nodeId): nodeId is string => typeof nodeId === "string");
      const documented = entity ? capabilityIds.filter((id) => nodeIds.some((nodeId) => membersById.get(id)!.has(nodeId))) : capabilityIds;
      const semanticIds = documented.filter((id) => semanticChangedIds.has(id));
      const proofIds = entity ? documented.filter((id) => proofReasonsById.has(id)) : [];
      const wholeModelChanged = !entity && modelChanged;
      semanticChanged = semanticIds.length > 0 || wholeModelChanged;
      proofChanged = proofIds.length > 0;
      if (semanticIds.length > 0) reasons.add("semantic-fingerprint-changed");
      if (wholeModelChanged) reasons.add("model-digest-changed");
      for (const id of proofIds) for (const reason of proofReasonsById.get(id)!) reasons.add(reason);
      for (const id of [...semanticIds, ...proofIds]) affected.add(id);
      if (entry.current !== undefined && entry.committed === undefined && !semanticChanged) {
        // No row and no semantic change to explain its absence: the baseline does not describe it.
        reasons.add("target-row-missing");
      } else {
        const changedStampNodes = changedStampNodeIds(entry.current?.sourceStamps, entry.committed?.sourceStamps);
        stampChanged = changedStampNodes.length > 0;
        if (stampChanged) reasons.add("source-stamp-changed");
        for (const id of documented) if (changedStampNodes.some((nodeId) => membersById.get(id)!.has(nodeId))) affected.add(id);
        if (entry.current !== undefined && entry.committed === undefined) reasons.add("target-added");
      }
    }
    if (entry.current === undefined) reasons.add("target-removed");
    if (entry.current !== undefined && entry.committed !== undefined && entry.current.outputDigest !== entry.committed.outputDigest) reasons.add("rendered-output-changed");

    const rejection = rejectedByPath.get(entry.path);
    if (rejection !== undefined) {
      const reason = REJECTION_REASONS[rejection];
      if (reason === undefined) throw new Error(`projection-target-change-rejection-unknown: ${entry.path} (${rejection})`);
      reasons.add(reason);
    }
    if (orphanByPath.get(entry.path)?.disposition === "human-review") reasons.add("orphan-review-required");
    const carried = blockedByPath.get(entry.path);
    if (carried !== undefined) {
      for (const reason of carried.reasonCodes) reasons.add(reason);
      for (const id of carried.capabilityIds) affected.add(id);
    }

    const file = fileByPath.get(entry.path);
    const plannedAction: ProjectionTargetChangePlannedAction = rejection !== undefined || file === undefined || file.action === "unchanged" ? "none" : file.action;
    if (plannedAction !== "none" && !reasons.has("rendered-output-changed") && !reasons.has("target-added") && !reasons.has("target-removed")) {
      reasons.add("file-bytes-changed");
    }
    const outputChanged = ["file-bytes-changed", "rendered-output-changed", "target-added", "target-removed"]
      .some((reason) => reasons.has(reason as ProjectionTargetChangeReasonCode));
    const reasonCodes = [...reasons].sort(compareStrings);
    const comparisons = { reasonCodes, stampChanged, outputChanged, semanticChanged, proofChanged };
    const classification = projectionTargetChangeClassification(comparisons);
    return {
      targetId: entry.targetId,
      path: entry.path,
      affectedCapabilityIds: [...affected].sort(compareStrings),
      stampChanged,
      outputChanged,
      semanticChanged,
      proofChanged,
      plannedAction,
      classification,
      reasonCodes
    };
  }).sort((left, right) => compareStrings(left.path, right.path));
}

/** The node ids whose stamp differs between the two rows, an absent row or stamp counting as none. */
function changedStampNodeIds(current: Record<string, string> | undefined, committed: Record<string, string> | undefined): string[] {
  const now = current ?? {};
  const before = committed ?? {};
  return [...new Set([...Object.keys(now), ...Object.keys(before)])].filter((nodeId) => now[nodeId] !== before[nodeId]).sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
