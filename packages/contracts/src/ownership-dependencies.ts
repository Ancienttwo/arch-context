import type { EvidenceCoverageLevelV2 } from "./ledger";

// --- ChangeSet ownership delta (plan preview) ---
//
// `archctx plan` and `archcontext_plan_update` add `preview.ownershipDelta` when a planned
// ChangeSet writes a node file. It compares file ownership before and after the planned model over
// the files the HEAD tree carries, with the parent-chain rule `refactor scan` uses
// (module-statistics `resolveOwnership`). It is read-only: nothing is written to compute it.

export const CHANGESET_OWNERSHIP_DELTA_SCHEMA_VERSION = "archcontext.changeset-ownership-delta/v1" as const;
/** Upper bound on the paths one ownership delta category lists. `count` always holds the full total. */
export const CHANGESET_OWNERSHIP_DELTA_PATH_LIMIT = 50;

export interface OwnershipDeltaSummaryV1 {
  ownedFileCount: number;
  /** Owned files whose claimants do not sit on one `parent` chain. */
  multiplyOwnedFileCount: number;
  /** Unclaimed files under a declared source root that no node excludes. */
  unownedFileCount: number;
}

export interface OwnershipDeltaFileV1 {
  path: string;
  /** Owning node ids before the plan, sorted. More than one id means the claim is contested. */
  before: string[];
  /** Owning node ids after the plan, sorted. */
  after: string[];
}

export interface OwnershipDeltaCategoryV1 {
  /** Every file in this category. */
  count: number;
  /** The first `pathLimit` files, sorted by path. */
  files: OwnershipDeltaFileV1[];
  /** `count - files.length`. */
  omittedCount: number;
}

export interface ChangeSetOwnershipDeltaComputedV1 {
  schemaVersion: typeof CHANGESET_OWNERSHIP_DELTA_SCHEMA_VERSION;
  status: "computed";
  ownershipRule: "parent-chain";
  fileUniverse: "head-tracked-files";
  trackedFileCount: number;
  /** Node ids whose `source.include`, `source.exclude` or `parent` differ, or that the plan creates or deletes. */
  changedNodeIds: string[];
  pathLimit: number;
  before: OwnershipDeltaSummaryV1;
  after: OwnershipDeltaSummaryV1;
  /** Unowned before, owned by exactly one node after. */
  becameOwned: OwnershipDeltaCategoryV1;
  /** Not contested before, contested (multiply owned) after. */
  becameContested: OwnershipDeltaCategoryV1;
  /** Owned before, owned by a different node set after, and not newly contested. */
  ownerChanged: OwnershipDeltaCategoryV1;
  /** Owned before, unowned after. */
  becameUnowned: OwnershipDeltaCategoryV1;
}

export interface ChangeSetOwnershipDeltaUnavailableV1 {
  schemaVersion: typeof CHANGESET_OWNERSHIP_DELTA_SCHEMA_VERSION;
  status: "unavailable";
  /** Why no delta was computed, for example a planned node body that does not parse. */
  reason: string;
}

export type ChangeSetOwnershipDeltaV1 = ChangeSetOwnershipDeltaComputedV1 | ChangeSetOwnershipDeltaUnavailableV1;

// --- Capability dependency matrix (`archctx deps`) ---

export const CAPABILITY_DEPENDENCIES_SCHEMA_VERSION = "archcontext.capability-dependencies/v1" as const;
/** Default number of file-level edges `archctx deps` lists. `edges.count` always holds the full total. */
export const CAPABILITY_DEPENDENCIES_EDGE_LIMIT = 200;
/** The CodeGraph adapter has no bounded repository-wide call-edge read, so calls are not counted. */
export const CAPABILITY_DEPENDENCIES_CALLS_UNAVAILABLE_REASON = "call-edges-not-exposed" as const;
/**
 * The relation kinds that declare an import dependency: every `archcontext.relation/v1` kind in
 * which the source uses the target. `deployed-on` places a node on infrastructure and declares no
 * code dependency. A kind added to the relation schema later declares nothing until it is listed.
 *
 * The rule: an import from a file owned by capability A into a file owned by capability B, A != B,
 * is declared when the model has a relation of one of these kinds whose `source` rolls up to A and
 * whose `target` rolls up to B. A node rolls up to itself when it is a capability, else to the
 * nearest `kind: capability` ancestor on its `parent` chain, exactly like a file owner. Direction
 * matters: a relation B -> A does not declare an import A -> B. A relation endpoint that rolls up
 * to no capability declares nothing.
 */
export const CAPABILITY_DEPENDENCY_DECLARING_RELATION_KINDS = [
  "calls",
  "depends-on",
  "implements",
  "publishes",
  "reads",
  "subscribes",
  "writes"
] as const;

export interface CapabilityDependencyCellV1 {
  /** Owning capability of the importing file. */
  from: string;
  /** Owning capability of the imported file. */
  to: string;
  /** Distinct file-to-file import edges from `from` into `to`. */
  imports: number;
  /** Always `null` in v1: call edges are not read (see `calls`). */
  calls: null;
  /**
   * Whether the model declares this dependency (rule: CAPABILITY_DEPENDENCY_DECLARING_RELATION_KINDS).
   * A cell with `from === to` stays inside one capability and needs no relation: it is always
   * declared, with no relation ids. A cross-capability cell is declared exactly when
   * `relationIds` is non-empty.
   */
  declared: boolean;
  /** Ids of the relations that declare a cross-capability cell, sorted. Always empty when `from === to`. */
  relationIds: string[];
}

export interface CapabilityDependencyEdgeV1 {
  fromPath: string;
  toPath: string;
  fromCapability: string;
  toCapability: string;
}

export interface CapabilityDependenciesV1 {
  schemaVersion: typeof CAPABILITY_DEPENDENCIES_SCHEMA_VERSION;
  ownershipRule: "parent-chain";
  /** `--from` / `--into` node ids, or `null`. A node matches a file when it or a descendant owns it. */
  filter: { from: string | null; into: string | null };
  /** Every `kind: capability` node id in the model, sorted. */
  capabilities: string[];
  /** Non-zero cells only, sorted by `from` then `to`. A cell with `from === to` counts edges inside one capability. */
  matrix: CapabilityDependencyCellV1[];
  imports: {
    /**
     * `archctx deps` never answers `unknown`: without code facts that attest to the measured tree it
     * refuses with `AC_CODE_FACTS_UNAVAILABLE`, so an empty matrix always means no attributed edge.
     */
    coverage: EvidenceCoverageLevelV2;
    /**
     * `code-facts-import-limit` or `code-facts-truncated` on `archctx deps` output. An index that
     * is missing or has pending changes measures as `code-facts-unavailable`, which `deps` turns
     * into the `AC_CODE_FACTS_UNAVAILABLE` refusal.
     */
    reasonCodes: string[];
    /** True when the index read is not the whole population for a reason other than the limit. */
    truncated: boolean;
    importNodeCount: number | null;
    importNodeLimit: number;
    importNodeLimitExceeded: boolean;
    /** Distinct file-to-file edges that passed the filters, attributed or not. */
    edgeCount: number;
    /**
     * Repository-local import specifiers (relative, or naming a workspace package) from filtered
     * files that resolved to no repository file. Always 0 with `--into`: such an edge has no target.
     */
    unresolvedCount: number;
    /** Edges left out of `matrix` because one endpoint has no single owning capability. */
    unattributed: { unownedEndpoint: number; contestedEndpoint: number; noCapabilityEndpoint: number };
  };
  calls: {
    coverage: "unknown";
    reasonCodes: [typeof CAPABILITY_DEPENDENCIES_CALLS_UNAVAILABLE_REASON];
  };
  /** Attributed file-level edges behind `matrix`, sorted by path. */
  edges: { limit: number; count: number; omittedCount: number; items: CapabilityDependencyEdgeV1[] };
}
