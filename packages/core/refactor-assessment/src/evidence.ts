import {
  REFACTOR_OBSERVATION_EVIDENCE_LIMIT,
  compareRefactorEvidenceDirectionViolations,
  compareRefactorEvidenceImportEdges,
  compareRefactorEvidenceUnresolvedImports,
  type ModuleStatisticsSnapshotV1,
  type RefactorEvidenceDirectionViolationV1,
  type RefactorEvidenceImportEdgeV1,
  type RefactorEvidencePathV1,
  type RefactorEvidenceUnresolvedImportV1,
  type RefactorObservationEvidenceV1
} from "@archcontext/contracts";
import type { ModuleStatisticsImportEdgeV1, ModuleStructureV1 } from "@archcontext/core/module-statistics";
import { nativeNodeSource, type NativeModel } from "@archcontext/core/projection-engine";

/**
 * Builds each observation kind's evidence from the structure the snapshot counted.
 *
 * Every list is the population the observation's metric is about, sorted by the contract's one
 * comparator, then cut to `REFACTOR_OBSERVATION_EVIDENCE_LIMIT` with the true size beside it. The
 * entries are paths, lines, specifiers and node ids: bounded metadata, never a source body.
 */
export class ObservationEvidenceBuilder {
  private readonly resolvedEdges: ModuleStatisticsImportEdgeV1[];

  constructor(
    private readonly snapshot: ModuleStatisticsSnapshotV1,
    private readonly structure: ModuleStructureV1,
    private readonly model: NativeModel
  ) {
    this.resolvedEdges = structure.importEdges.filter((edge) => edge.to !== null);
  }

  /** File edges whose two owners are distinct members of one strongly connected component. */
  cycle(memberNodeIds: readonly string[]): RefactorObservationEvidenceV1 {
    const members = new Set(memberNodeIds);
    const edges: RefactorEvidenceImportEdgeV1[] = [];
    for (const edge of this.resolvedEdges) {
      // Same attribution rule as the module graph: a contested file speaks for each claimant.
      for (const fromNodeId of this.owners(edge.from).filter((id) => members.has(id))) {
        for (const toNodeId of this.owners(edge.to!).filter((id) => members.has(id))) {
          if (fromNodeId === toNodeId) continue;
          edges.push(importEdge(edge, fromNodeId, toNodeId));
        }
      }
    }
    const sample = boundedSample(edges, compareRefactorEvidenceImportEdges);
    return { kind: "cycle", memberNodeIds: [...members].sort(compareText), edges: sample.entries, totalCount: sample.totalCount, truncated: sample.truncated };
  }

  /** The `forbid-dependency` violations this module's own files commit. */
  directionViolation(nodeId: string): RefactorObservationEvidenceV1 {
    const violations: RefactorEvidenceDirectionViolationV1[] = this.structure.directionViolations
      .filter((violation) => violation.fromNode === nodeId)
      .map((violation) => {
        // The evaluator keys a violation by (constraint, from, to); the first observed edge
        // between the two files names the specifier and line that realize it.
        const edge = this.resolvedEdges.find((candidate) => candidate.from === violation.fromPath && candidate.to === violation.toPath);
        // The evaluator found the violation on exactly these edges; a violation with no edge means
        // the structure and the snapshot were measured apart, and nothing honest can be reported.
        if (!edge) {
          throw new Error(`AC_SCHEMA_INVALID: direction violation ${violation.constraintId} ${violation.fromPath} -> ${violation.toPath} has no observed import edge`);
        }
        return {
          constraintId: violation.constraintId,
          fromPath: violation.fromPath,
          fromLine: edge.line ?? null,
          toPath: violation.toPath,
          specifier: edge.specifier,
          fromNodeId: violation.fromNode,
          toNodeId: violation.toNode
        };
      });
    const sample = boundedSample(violations, compareRefactorEvidenceDirectionViolations);
    return {
      kind: "direction-violation",
      constraintIds: [...new Set(violations.map((violation) => violation.constraintId))].sort(compareText),
      violations: sample.entries,
      totalCount: sample.totalCount,
      truncated: sample.truncated
    };
  }

  /** This module's files that another, non-ancestral node also claims, with every claimant. */
  ownershipAmbiguous(nodeId: string): RefactorObservationEvidenceV1 {
    const paths = (this.structure.ownership.filesByNode.get(nodeId) ?? []).flatMap((path): RefactorEvidencePathV1[] => {
      const resolution = this.structure.ownership.byPath.get(path);
      return resolution?.ambiguous ? [{ path, candidateOwnerNodeIds: [...resolution.owners].sort(compareText) }] : [];
    });
    return pathEvidence("ownership-ambiguous", paths);
  }

  /** The entrypoint paths an undeclared node names, with whichever nodes own them today. */
  undeclaredFootprint(nodeId: string): RefactorObservationEvidenceV1 {
    const node = this.model.nodes.find((candidate) => candidate.id === nodeId);
    const declared = [...new Set((node ? nativeNodeSource(node)?.entrypoints ?? [] : []).map((entrypoint) => entrypoint.path))];
    return pathEvidence("undeclared-footprint", declared.map((path) => ({ path, candidateOwnerNodeIds: this.owners(path) })));
  }

  /**
   * The actionable unowned paths. A candidate owner is a node that owns another tracked file in
   * the same directory: an observed neighbourhood, reported as such, not an inferred owner.
   */
  unownedPaths(): RefactorObservationEvidenceV1 {
    const ownersByDirectory = new Map<string, Set<string>>();
    for (const [path, resolution] of this.structure.ownership.byPath) {
      if (resolution.owners.length === 0) continue;
      const directory = directoryOf(path);
      const owners = ownersByDirectory.get(directory) ?? new Set<string>();
      for (const owner of resolution.owners) owners.add(owner);
      ownersByDirectory.set(directory, owners);
    }
    return pathEvidence("unowned-paths", this.structure.ownership.unownedPaths.map((path) => ({
      path,
      candidateOwnerNodeIds: [...(ownersByDirectory.get(directoryOf(path)) ?? [])].sort(compareText)
    })));
  }

  /** What the index could not certify: the coverage verdict and the specifiers left unresolved. */
  evidenceGap(): RefactorObservationEvidenceV1 {
    const unresolved = new Map<string, RefactorEvidenceUnresolvedImportV1>();
    for (const edge of this.structure.importEdges) {
      if (edge.to !== null) continue;
      const entry = { fromPath: edge.from, fromLine: edge.line ?? null, specifier: edge.specifier };
      unresolved.set(JSON.stringify([entry.fromPath, entry.fromLine, entry.specifier]), entry);
    }
    const sample = boundedSample([...unresolved.values()], compareRefactorEvidenceUnresolvedImports);
    return {
      kind: "evidence-gap",
      coverage: this.snapshot.codeFacts.coverage,
      reasonCodes: [...this.snapshot.codeFacts.reasonCodes],
      unresolvedImports: sample.entries,
      totalCount: sample.totalCount,
      truncated: sample.truncated
    };
  }

  private owners(path: string): string[] {
    return [...(this.structure.ownership.byPath.get(path)?.owners ?? [])].sort(compareText);
  }
}

function pathEvidence(
  kind: "ownership-ambiguous" | "undeclared-footprint" | "unowned-paths",
  paths: RefactorEvidencePathV1[]
): RefactorObservationEvidenceV1 {
  const sample = boundedSample(paths, (left, right) => compareText(left.path, right.path));
  return { kind, paths: sample.entries, totalCount: sample.totalCount, truncated: sample.truncated };
}

function importEdge(edge: ModuleStatisticsImportEdgeV1, fromNodeId: string, toNodeId: string): RefactorEvidenceImportEdgeV1 {
  return { fromPath: edge.from, fromLine: edge.line ?? null, toPath: edge.to!, specifier: edge.specifier, fromNodeId, toNodeId };
}

/** Sorts, drops exact duplicates under the comparator, and keeps the first `limit` entries. */
function boundedSample<T>(entries: readonly T[], compare: (left: T, right: T) => number): { entries: T[]; totalCount: number; truncated: boolean } {
  const unique = [...entries].sort(compare).filter((entry, index, sorted) => index === 0 || compare(sorted[index - 1]!, entry) !== 0);
  return {
    entries: unique.slice(0, REFACTOR_OBSERVATION_EVIDENCE_LIMIT),
    totalCount: unique.length,
    truncated: unique.length > REFACTOR_OBSERVATION_EVIDENCE_LIMIT
  };
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
