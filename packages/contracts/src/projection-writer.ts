import type { ProjectionHumanActionReasonCode } from "./projection";
import type { Json } from "./schema";

/**
 * Projection writer mode (issue #379, ADR-0048): `archctx projection publish` keeps one rolling
 * pull request branch (`archctx/...`) equal to the base tip plus exactly one commit that touches
 * generated projection outputs only, and `archctx projection verify-pr` lets downstream CI check
 * such a pull request without trusting its author.
 */
export const PROJECTION_PUBLISH_RUN_SCHEMA_VERSION = "archcontext.projection-publish-run/v1" as const;
export const PROJECTION_PUBLISH_STATUS_SCHEMA_VERSION = "archcontext.projection-publish-status/v1" as const;
export const PROJECTION_PR_VERIFICATION_SCHEMA_VERSION = "archcontext.projection-pr-verification/v1" as const;

/** The only ref namespace the writer ever pushes to. */
export const PROJECTION_WRITER_BRANCH_PREFIX = "archctx/";
export const PROJECTION_WRITER_DEFAULT_BRANCH = "archctx/projection";

export const PROJECTION_PUBLISH_RESULTS = [
  "already-processed",
  "busy",
  "failed",
  "human-action-required",
  "published",
  "up-to-date"
] as const;
export const PROJECTION_PUBLISHERS = ["command", "gh", "none"] as const;
export const PROJECTION_PR_VERDICTS = [
  "generated-only-not-render-equivalent",
  "generated-only-render-equivalent",
  "no-changes",
  "touches-non-generated"
] as const;

export type ProjectionPublishResult = (typeof PROJECTION_PUBLISH_RESULTS)[number];
export type ProjectionPublisherKind = (typeof PROJECTION_PUBLISHERS)[number];
export type ProjectionPrVerdict = (typeof PROJECTION_PR_VERDICTS)[number];

export interface ProjectionPublishPullRequestV1 {
  url?: string;
  number?: number;
}

export interface ProjectionPublishHumanActionV1 {
  reasonCode: ProjectionHumanActionReasonCode;
  path?: string;
}

/** The `data` of `projection.publish`, and the writer state's `lastRun`. */
export interface ProjectionPublishRunV1 {
  schemaVersion: typeof PROJECTION_PUBLISH_RUN_SCHEMA_VERSION;
  result: ProjectionPublishResult;
  remote: string;
  base: string;
  branch: string;
  /** The base tip this run evaluated; null when the run stopped before resolving one. */
  baseSha: string | null;
  /** The rolling branch tip that carries this base's projection, pushed by this run or an earlier one. */
  publishedCommit: string | null;
  /** True only when this run moved the remote rolling branch. */
  pushed: boolean;
  pullRequest: ProjectionPublishPullRequestV1 | null;
  publisher: ProjectionPublisherKind;
  /** Repository-relative generated paths the published commit changes, sorted. */
  files: string[];
  /** `ProjectionResultV2.status` of the apply this run made, or null without one. */
  projectionStatus: string | null;
  humanActions: ProjectionPublishHumanActionV1[];
  error: { code: string; reasonCode?: string; message: string; details?: { [key: string]: Json } } | null;
  startedAt: string;
  finishedAt: string;
  /** Base tips evaluated in this run; above 1 when the base moved while the run worked. */
  iterations: number;
  /** Present on `busy`: the pid of the live writer that holds the lock. */
  holderPid?: number;
}

/** The `data` of `projection.publish-status`. Read-only. */
export interface ProjectionPublishStatusV1 {
  schemaVersion: typeof PROJECTION_PUBLISH_STATUS_SCHEMA_VERSION;
  remote: string;
  base: string;
  branch: string | null;
  worktreePath: string;
  running: { pid: number; startedAt: string } | null;
  lastProcessedSha: string | null;
  lastSuccessfulSha: string | null;
  lastRun: ProjectionPublishRunV1 | null;
}

/** The `data` of `projection.verify-pr`. */
export interface ProjectionPrVerificationV1 {
  schemaVersion: typeof PROJECTION_PR_VERIFICATION_SCHEMA_VERSION;
  base: string;
  baseSha: string;
  headSha: string;
  mergeBase: string;
  changedPaths: string[];
  /**
   * Changed paths that are not generated: not the projection manifest, not a manifest target path
   * and not an agent-context target path (at HEAD or at the merge base), plus every
   * `humanEditedPaths` entry.
   */
  nonGeneratedPaths: string[];
  /**
   * Mixed-ownership targets (manifest `ownership: "mixed"` and every agent-context target) whose
   * text outside the generated regions differs between the merge base and HEAD, whose regions
   * cannot be delimited, or which are added or deleted. Never rendered.
   */
  humanEditedPaths: string[];
  /** True when the diff is non-empty and every changed path is a generated output. */
  generatedOnly: boolean;
  /** Null when no render ran (an empty diff, or a diff that touches a non-generated path). */
  renderEquivalent: boolean | null;
  differingPaths: string[];
  projectionStatus: string | null;
  verdict: ProjectionPrVerdict;
}
