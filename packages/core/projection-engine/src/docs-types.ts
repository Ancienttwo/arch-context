import {
  ARCHITECTURE_DOCS_RENDERER_VERSION as CONTRACT_ARCHITECTURE_DOCS_RENDERER_VERSION,
  type AcceptedArchitectureChangeReferenceV1,
  type ArchitectureDigestSetV2,
  type ArchitectureDocsProjectionManifestTargetV4,
  type ArchitectureDocsProjectionManifestV4,
  type ArchitectureDocumentationProjectionProvenanceV3,
  type ArchitectureHistory,
  type ArchitectureProjectionProofEvidenceV2,
  type ArchitectureRefreshSignalV2,
  type ArchitectureSemanticStateV1,
  type ProjectionCoverageV1,
  type ProjectionFreshnessReasonCode,
  type ProjectionFreshnessStaleTargetV2,
  type ProjectionTargetV1,
  type StateMachineV1
} from "@archcontext/contracts";
import type { NativeModel } from "@archcontext/core/architecture-domain";
import type { ArchitectureProjectionProfile } from "./layout";
import type { ArchitectureMajorChangeClassificationV1 } from "./major-change";


export interface ArchitectureDecisionRecord {
  id: string;
  title: string;
  path: string;
  status?: string;
}

export interface ArchitectureDocumentationExistingFile {
  path: string;
  body: string;
}

export interface ArchitectureDocumentationProjectionFile extends ArchitectureDocumentationExistingFile {
  target: ProjectionTargetV1;
  digest: string;
  generatedBodyDigest: string;
}

export type ArchitectureDocumentationDriftReason =
  | "projection-file-missing"
  | "projection-manifest-missing"
  | "projection-manifest-invalid"
  | "projection-manifest-stale"
  | "projection-adoption-required"
  | "projection-generated-region-missing"
  | "projection-generated-region-stale"
  | "projection-generated-region-manually-edited"
  | "projection-generated-file-stale"
  | "projection-generated-file-manually-edited"
  | "projection-ambiguous-ownership"
  | "projection-orphaned";

export interface ArchitectureDocumentationProjectionDrift {
  path: string;
  targetId?: string;
  reasonCode: ArchitectureDocumentationDriftReason;
  expectedDigest?: string;
  actualDigest?: string;
}

/**
 * A managed document whose generated region names a target the current model no longer renders.
 * `delete`: the file holds only an intact generated region, so removing it loses nothing a human
 * wrote and `apply` deletes it. `human-review`: text outside the region, or an edited region,
 * may carry human content, so only a human may remove or move it (#268).
 */
export interface ArchitectureDocumentationProjectionOrphan {
  path: string;
  targetId: string;
  actualDigest: string;
  disposition: "delete" | "human-review";
}

export interface ArchitectureDocumentationProjectionPlan {
  schemaVersion: "archcontext.architecture-docs-projection-plan/v1";
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  sourceDigest: string;
  projectionDigest: string;
  profile: ArchitectureProjectionProfile;
  provenance: ArchitectureDocumentationProjectionProvenanceV3;
  semanticState: ArchitectureSemanticStateV1;
  architectureDigests: ArchitectureDigestSetV2;
  majorChange: ArchitectureMajorChangeClassificationV1;
  refreshSignals: ArchitectureRefreshSignalV2[];
  receiptDigest: string;
  /** The non-model inputs the flow proofs were compiled from, per capability, as this run measured them. */
  proofEvidence: ArchitectureProjectionProofEvidenceV2;
  targets: ProjectionTargetV1[];
  files: ArchitectureDocumentationProjectionFile[];
  manifest: ArchitectureDocumentationExistingFile & { digest: string };
  drift: {
    ok: boolean;
    reasonCodes: ArchitectureDocumentationDriftReason[];
    diffs: ArchitectureDocumentationProjectionDrift[];
  };
  rejected: ArchitectureDocumentationProjectionDrift[];
  adoptionCandidates: ArchitectureDocumentationProjectionFile[];
  /** Every `projection-orphaned` drift entry, sorted by path, with what may remove it. */
  orphans: ArchitectureDocumentationProjectionOrphan[];
  /**
   * The committed current-format manifest this render classified against: its semantic baseline
   * and its target rows. Absent without one (no manifest, an unrecognized one, or a superseded one
   * a `docs apply` re-baselines).
   */
  committedManifest?: ArchitectureDocsProjectionManifestV4;
  /**
   * Every current target's manifest row as this render produced it, by targetId. An isolated plan
   * keeps the complete render's rows here, also for the targets whose committed rows its
   * `manifest` carries forward.
   */
  renderedTargets: ArchitectureDocsProjectionManifestV4["targets"];
  /**
   * Render-equivalent freshness of the committed projection (ADR-0056 §1), from the complete
   * render. An isolated plan keeps it, so `check`, `complete` and `projection freshness` read one
   * answer from one render.
   */
  freshness: ArchitectureProjectionFreshnessEvaluation;
  /**
   * Present only on a render that asked for `isolateBlockedCapabilities` and qualified for it
   * (Phase 1 capability isolation, #327). The plan then covers only the applied targets: `files`
   * omits the carried-forward documents, and `manifest` keeps their rows and their capabilities'
   * baseline entries byte for byte. Absent, the plan covers every target.
   */
  isolation?: ArchitectureProjectionIsolationV1;
}

/** What a partial plan covers; the result's `coverage` without its `complete: false`. */
export type ArchitectureProjectionIsolationV1 = Omit<ProjectionCoverageV1, "complete">;

export const ARCHITECTURE_DOCS_RENDERER_VERSION = CONTRACT_ARCHITECTURE_DOCS_RENDERER_VERSION;
export const ARCHITECTURE_DOCS_GENERATED_BEGIN_PREFIX = "<!-- BEGIN ARCHCONTEXT:generated";
export const ARCHITECTURE_DOCS_GENERATED_END_PREFIX = "<!-- END ARCHCONTEXT:generated";

/**
 * The repository and CodeGraph state one projection run read. Runtime-only — refresh signals and
 * protocol snapshots, receipts and recovery bindings bind it, the committed manifest does not,
 * because each value can differ between two machines projecting the same commit (#277).
 */
export interface ArchitectureDocumentationProjectionRuntimeSnapshot {
  headSha: string;
  worktreeDigest: string;
  /** Digest of the CodeGraph version and the code evidence (import graphs, selector evidence) this run read. */
  codeGraphDigest: string;
  /** Binds the index status (checkout path, index time) to the declared source tree; null without an index. */
  indexedWorktreeDigest: string | null;
  /** Whether this machine had a usable `.codegraph` index. */
  codeGraphStatus: "ready" | "unavailable";
}

/**
 * Content digest of one node's declared source footprint: the files `source.include` selects,
 * minus `source.exclude`, minus `projectionOwnedPaths`. Runtime provenance digests these into its
 * `sourceTreeDigest`; the committed manifest records none of them.
 */
export interface CapabilitySourceFootprintDigest {
  nodeId: string;
  digest: string;
  fileCount: number;
}

/**
 * Measured scale of one node's declared `source.include` (minus `source.exclude`) footprint.
 * Produced by `loadCapabilitySourceScaleSignals`; the renderer refuses to project a node that
 * declares `source.include` without a matching measurement rather than printing a guess.
 */
export interface CapabilitySourceScaleSignal {
  nodeId: string;
  fileCount: number;
  lineCount: number;
  includePatterns: string[];
  excludePatterns: string[];
}

/** One real `imports` edge between two repo-relative files, as resolved by the code index. */
export interface CapabilityImportEdge {
  from: string;
  to: string;
}

/**
 * One node's measured import footprint: the files `source.include` (minus `source.exclude`)
 * selects, plus the real `imports` edges the code index resolved out of those files. Produced
 * outside `@archcontext/core` because the index query needs a child process. This remains an
 * explicitly measured diagnostic surface; semantic P1 comes only from accepted nodes and
 * relations and never promotes these raw path edges into architecture truth.
 */
export interface CapabilityImportGraph {
  nodeId: string;
  /** Repo-relative files inside the node's declared footprint, sorted. */
  files: string[];
  /** Edges whose `from` is one of `files`; `to` may sit outside the footprint. */
  edges: CapabilityImportEdge[];
  /**
   * The index read returned a different number of import nodes than the index reported (the index
   * changed during the read), so `edges` may be incomplete. Printed, never hidden.
   */
  truncated: boolean;
  /**
   * Present only when the index holds more import nodes than the read limit. `edges` then come
   * from the first limit nodes. This is a configured limit, not an incomplete index, so
   * `truncated` stays false.
   */
  importNodeLimitExceeded?: true;
}

/** One node's declared source footprint, resolved to repo-relative files. */
export interface CapabilitySourceFootprint {
  nodeId: string;
  files: string[];
  includePatterns: string[];
  excludePatterns: string[];
}

/**
 * One 1–2–5 magnitude bucket: the half-open range `[lower, upper)` that contains a measured count.
 * `{ lower: 0, upper: 1 }` holds only zero; otherwise `lower` is `1`, `2` or `5` times a power of ten
 * and `upper` is the next step on that ladder.
 */
export interface ArchitectureScaleBucketV1 {
  lower: number;
  upper: number;
}

/** The measured size of a node's footprint, as buckets. The module document prints exactly these. */
export interface ArchitectureCapabilityScaleV1 {
  fileCountBucket: ArchitectureScaleBucketV1;
  lineCountBucket: ArchitectureScaleBucketV1;
}

/** Languages of the module-document skeleton headings (#302). */
export const ARCHITECTURE_DOCS_LANGUAGES = ["zh-Hant", "zh-Hans", "en"] as const;
export type ArchitectureDocsLanguage = typeof ARCHITECTURE_DOCS_LANGUAGES[number];

/** The contract's reason codes, so the `check` result's `freshness` field can carry them verbatim. */
export type ArchitectureProjectionFreshnessReasonCode = ProjectionFreshnessReasonCode;

export interface ArchitectureProjectionFreshnessEvaluation {
  schemaVersion: "archcontext.projection-freshness/v3";
  ok: boolean;
  reasonCodes: ArchitectureProjectionFreshnessReasonCode[];
  detail: string;
  /** Sorted by targetId. Non-empty exactly when `projection-output-changed` is reported. */
  staleTargets: ProjectionFreshnessStaleTargetV2[];
}
