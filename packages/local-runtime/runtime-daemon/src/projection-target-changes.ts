import {
  projectionTargetChangeClassification,
  type ArchitectureCapabilitySemanticStateV1,
  type ArchitectureDocsProjectionManifestTargetV4,
  type ArchitectureDocsProjectionManifestV4,
  type ProjectionCoverageBlockedTargetV1,
  type ProjectionFileResultV1,
  type ProjectionTargetChangePlannedAction,
  type ProjectionTargetChangeReasonCode,
  type ProjectionTargetChangeV2
} from "@archcontext/contracts";

/** What one `check` or `plan` render knows, and the result's own write decision. */
export interface ProjectionTargetChangeInput {
  /** The committed current-format manifest the render classified against; undefined without one. */
  committed: ArchitectureDocsProjectionManifestV4 | undefined;
  /** Every current target's row as the complete render produced it, carried-forward targets included. */
  renderedTargets: Record<string, ArchitectureDocsProjectionManifestTargetV4>;
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
  /** `architectureProjectionFootprintOwners`: each declared node's documenting target scope id. */
  footprintOwners: ReadonlyMap<string, string>;
}

const REJECTION_REASONS: Readonly<Record<string, ProjectionTargetChangeReasonCode>> = {
  "projection-adoption-required": "adoption-required",
  "projection-ambiguous-ownership": "ambiguous-ownership"
};

/**
 * Classifies every target of a `check` or `plan` result (#327 finding 2): the union of the current
 * targets, the committed manifest's rows and the orphans, one entry per target, sorted by path,
 * then targetId. Each comparison reads values the render already holds (row output digests, the
 * model digest, per-capability semantic and flow-proof fingerprints, selector-evidence digests);
 * `plannedAction` is the result's `files[]` action, never a second comparison, and `outputChanged`
 * reads the `files[]` action even where a rejection blocks the write. Nothing here changes what a
 * run writes or reports as its status.
 */
export function classifyProjectionTargetChanges(input: ProjectionTargetChangeInput): ProjectionTargetChangeV2[] {
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
  const blockedByTargetId = new Map(input.blockedTargets.map((target) => [target.targetId, target]));

  // One entry per target. A committed row describes a current target only at the same path; a row
  // whose target no current layout renders is a removed target, and an orphan no row records is a
  // removed target without a committed row. Only agent-context targets share a path (ADR-0056 §9).
  // A targetId has one entry: an agent-context row whose designation moved keeps its current
  // entry, and the region left at the old path is blocked through that path's orphan.
  const entries: Array<{ targetId: string; path: string; current?: ArchitectureDocsProjectionManifestTargetV4; committed?: ArchitectureDocsProjectionManifestTargetV4 }> = [];
  const coveredTargetIds = new Set<string>();
  const coveredPaths = new Set<string>();
  const add = (entry: (typeof entries)[number]) => {
    entries.push(entry);
    coveredTargetIds.add(entry.targetId);
    coveredPaths.add(entry.path);
  };
  for (const [targetId, row] of Object.entries(input.renderedTargets)) {
    const committedRow = committedRows[targetId];
    add({ targetId, path: row.path, current: row, ...(committedRow?.path === row.path ? { committed: committedRow } : {}) });
  }
  for (const [targetId, row] of Object.entries(committedRows)) {
    if (coveredTargetIds.has(targetId) || (row.type !== "agent-context" && coveredPaths.has(row.path))) continue;
    add({ targetId, path: row.path, committed: row });
  }
  for (const orphan of input.orphans) {
    if (coveredTargetIds.has(orphan.targetId) || (committedRows[orphan.targetId]?.type !== "agent-context" && coveredPaths.has(orphan.path))) continue;
    add({ targetId: orphan.targetId, path: orphan.path });
  }

  return entries.map((entry): ProjectionTargetChangeV2 => {
    const reasons = new Set<ProjectionTargetChangeReasonCode>();
    const affected = new Set<string>();
    const row = entry.current ?? entry.committed;
    let semanticChanged: boolean | null = null;
    let proofChanged: boolean | null = null;
    let documentedByEntity: string[] = [];
    if (committed === undefined) {
      reasons.add("baseline-missing");
    } else if (row === undefined) {
      reasons.add("target-row-missing");
    } else {
      // An entity summary documents the capabilities its node, and the nodes whose footprint it
      // documents, belong to. An agent-context region documents the capabilities its node belongs
      // to and renders no flow proof (ADR-0056 §4). Any other target (index, decisions, changelog,
      // diagrams, relation summaries) describes the whole model and renders no flow proof.
      const entity = row.type === "entity-summary";
      const agentContext = row.type === "agent-context";
      const scopeId = row.scope.id;
      const nodeIds = scopeId === undefined ? [] : entity ? [scopeId, ...[...input.footprintOwners].filter(([, owner]) => owner === scopeId).map(([nodeId]) => nodeId)] : [scopeId];
      const documented = entity || agentContext ? capabilityIds.filter((id) => nodeIds.some((nodeId) => membersById.get(id)!.has(nodeId))) : capabilityIds;
      const semanticIds = documented.filter((id) => semanticChangedIds.has(id));
      const proofIds = entity ? documented.filter((id) => proofReasonsById.has(id)) : [];
      if (entity || agentContext) documentedByEntity = documented;
      const wholeModelChanged = !entity && !agentContext && modelChanged;
      semanticChanged = semanticIds.length > 0 || wholeModelChanged;
      proofChanged = proofIds.length > 0;
      if (semanticIds.length > 0) reasons.add("semantic-fingerprint-changed");
      if (wholeModelChanged) reasons.add("model-digest-changed");
      for (const id of proofIds) for (const reason of proofReasonsById.get(id)!) reasons.add(reason);
      for (const id of [...semanticIds, ...proofIds]) affected.add(id);
      if (entry.current !== undefined && entry.committed === undefined && !semanticChanged) {
        // No row and no semantic change to explain its absence: the baseline does not describe it,
        // so its semantic comparison is unknown.
        semanticChanged = null;
        reasons.add("target-row-missing");
      } else if (entry.current !== undefined && entry.committed === undefined) {
        reasons.add("target-added");
      }
    }
    if (entry.current === undefined) reasons.add("target-removed");
    if (entry.current !== undefined && entry.committed !== undefined && entry.current.outputDigest !== entry.committed.outputDigest) {
      reasons.add("rendered-output-changed");
      // A module document renders differently because something it documents changed, so the change
      // is attributed to the capabilities it documents through the footprint owners (ADR-0056 §4).
      for (const id of documentedByEntity) affected.add(id);
    }

    const rejection = rejectedByPath.get(entry.path);
    if (rejection !== undefined) {
      const reason = REJECTION_REASONS[rejection];
      if (reason === undefined) throw new Error(`projection-target-change-rejection-unknown: ${entry.path} (${rejection})`);
      reasons.add(reason);
    }
    if (orphanByPath.get(entry.path)?.disposition === "human-review") reasons.add("orphan-review-required");
    const carried = blockedByTargetId.get(entry.targetId);
    if (carried !== undefined) {
      for (const reason of carried.reasonCodes) reasons.add(reason);
      for (const id of carried.capabilityIds) affected.add(id);
    }

    const file = fileByPath.get(entry.path);
    const fileAction: ProjectionTargetChangePlannedAction = file === undefined || file.action === "unchanged" ? "none" : file.action;
    // A rejected path is never written, but its file result still proves the bytes differ.
    const plannedAction: ProjectionTargetChangePlannedAction = rejection !== undefined ? "none" : fileAction;
    if (fileAction !== "none" && !reasons.has("rendered-output-changed") && !reasons.has("target-added") && !reasons.has("target-removed")) {
      reasons.add("file-bytes-changed");
    }
    const outputChanged = ["file-bytes-changed", "rendered-output-changed", "target-added", "target-removed"]
      .some((reason) => reasons.has(reason as ProjectionTargetChangeReasonCode));
    const reasonCodes = [...reasons].sort(compareStrings);
    const comparisons = { reasonCodes, outputChanged, semanticChanged, proofChanged };
    const classification = projectionTargetChangeClassification(comparisons);
    return {
      targetId: entry.targetId,
      path: entry.path,
      affectedCapabilityIds: [...affected].sort(compareStrings),
      outputChanged,
      semanticChanged,
      proofChanged,
      plannedAction,
      classification,
      reasonCodes
    };
  }).sort((left, right) => compareStrings(left.path, right.path) || compareStrings(left.targetId, right.targetId));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
