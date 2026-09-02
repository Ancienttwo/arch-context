import type { ArchitectureMajorChangeReasonCode, ArchitectureTargetDeltaV1 } from "@archcontext/contracts";
import type { NativeModel } from "../../projection-engine/src/index";

export interface TargetDeltaDerivationV1 {
  /** The subset of `ArchitectureMajorChangeReasonCode` v1 can derive from a declared model. */
  reasons: ArchitectureMajorChangeReasonCode[];
  /** Sorted unique target ids the declared model cannot resolve. */
  unresolvedTargets: string[];
  /** Sorted unique declared node ids the delta names, so the caller can widen `affectedNodeIds`. */
  resolvedNodeIds: string[];
}

export interface TargetDeltaContextV1 {
  model: NativeModel;
  /** Deepest owners of the proposal's `scopePaths`, i.e. who owns the surface today. */
  currentOwnerIds: string[];
}

/**
 * Compares an agent-authored `targetDelta` against the declared model.
 *
 * Three reason codes are derivable and no more. `node-added` is not: the PRD requires every id the
 * delta names to resolve, so an id the model does not carry is an unresolved target, and deriving
 * `node-added` from it would let a typo fail open as a deliberate new node. `lifecycle-changed` is
 * not: `targetState.owners` keys are free-form role labels (`{primaryLifecycle: ...}`) and node/v2
 * declares no role -> owner map, so the only way to derive it would be to pattern-match agent prose.
 * `migrationState` contributes nothing at all (PRD 0.3.10 excludes migration target state changes).
 *
 * `requiredRelations` entries the model does not declare are the point of the delta — a relation to
 * be created — so they raise `relation-changed` and are deliberately NOT unresolved targets.
 */
export function deriveTargetDelta(
  delta: ArchitectureTargetDeltaV1 | undefined,
  context: TargetDeltaContextV1
): TargetDeltaDerivationV1 {
  if (!delta) return { reasons: [], unresolvedTargets: [], resolvedNodeIds: [] };
  const nodeIds = new Set(context.model.nodes.map((node) => node.id));
  const relationIds = new Set(context.model.relations.map((relation) => relation.id));
  const reasons = new Set<ArchitectureMajorChangeReasonCode>();
  const unresolved = new Set<string>();
  const resolved = new Set<string>();

  // Only the values are resolved: the keys are role labels, not identifiers.
  const ownerValues = Object.values(delta.targetState.owners);
  const targetOwners = new Set<string>();
  for (const value of ownerValues) {
    if (!nodeIds.has(value)) {
      unresolved.add(value);
      continue;
    }
    targetOwners.add(value);
    resolved.add(value);
  }
  // A delta that names no owner says nothing about ownership, and one whose owners do not all
  // resolve says nothing comparable: the missing id would otherwise read as "ownership changed"
  // when the only fact established is that the target is unresolved.
  const ownersResolve = ownerValues.every((value) => nodeIds.has(value));
  if (ownerValues.length > 0 && ownersResolve && !sameMembers(targetOwners, new Set(context.currentOwnerIds))) {
    reasons.add("ownership-changed");
  }

  for (const relationId of delta.targetState.requiredRelations) {
    if (!relationIds.has(relationId)) reasons.add("relation-changed");
  }

  for (const concept of delta.targetState.removedConcepts) {
    if (relationIds.has(concept)) {
      reasons.add("relation-changed");
      continue;
    }
    if (nodeIds.has(concept)) {
      reasons.add("node-removed");
      resolved.add(concept);
      continue;
    }
    unresolved.add(concept);
  }

  for (const criterion of delta.completionCriteria) {
    if (criterion.nodeId === null) continue;
    if (nodeIds.has(criterion.nodeId)) resolved.add(criterion.nodeId);
    else unresolved.add(criterion.nodeId);
  }

  return {
    reasons: [...reasons].sort(),
    unresolvedTargets: [...unresolved].sort(),
    resolvedNodeIds: [...resolved].sort()
  };
}

/**
 * Fills the derived `unresolvedTargets` onto an authored proposal.
 *
 * Digest-safe by contract: `refactorProposalDigest` and `architectureTargetDeltaInterventionId`
 * both hash the delta with `unresolvedTargets` excluded, so the agent-authored identity survives.
 */
export function withUnresolvedTargets(
  delta: ArchitectureTargetDeltaV1,
  unresolvedTargets: string[]
): ArchitectureTargetDeltaV1 {
  return { ...delta, unresolvedTargets };
}

function sameMembers(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}
