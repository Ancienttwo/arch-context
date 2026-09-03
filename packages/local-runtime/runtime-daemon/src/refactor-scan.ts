import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REFACTOR_REQUEST_SCHEMA_VERSION,
  digestJson,
  refactorRequestInvariantIssues,
  type ArchContextErrorCode,
  type ArchitectureRepositoryIdentityV1,
  type ArchitectureWorktreeIdentityV1,
  type Json,
  type ModuleStatisticsSnapshotV1,
  type RecommendationV3,
  type RefactorAssessmentV1,
  type RefactorProposalV1,
  type RefactorRequestV1
} from "@archcontext/contracts";
import type { RecommendationLedgerRecordV1 } from "@archcontext/core/architecture-ledger";
import { buildModuleStatisticsSnapshot, type ModuleStatisticsIndexAvailability } from "@archcontext/core/module-statistics";
import { loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import {
  planRefactorRecommendationRun,
  type RecommendationSuppression
} from "@archcontext/core/recommendation-engine";
import { assessRefactor } from "@archcontext/core/refactor-assessment";
import {
  CODEGRAPH_IMPORT_NODE_QUERY_LIMIT,
  codeGraphCliInvocation,
  codeGraphIndexAvailable,
  repositoryImportPairs
} from "@archcontext/local-runtime/codegraph-adapter";
import { readHeadCommitterDate, readTrackedSourceFiles, readWorkspacePackages } from "@archcontext/local-runtime/git-adapter";

/** The CodeGraph CLI name the adapter resolves package-locally when PATH has no answer. */
const CODEGRAPH_BINARY = "codegraph";
const CODEGRAPH_VERSION_TIMEOUT_MS = 15_000;

/** The default request: measure the whole repository and classify nothing beyond it. */
export const REPOSITORY_REFACTOR_REQUEST: RefactorRequestV1 = {
  schemaVersion: REFACTOR_REQUEST_SCHEMA_VERSION,
  scope: { kind: "repository" }
};

/**
 * A scan failure the caller can act on. The daemon maps `code` straight onto the envelope; any
 * other throw is a defect and surfaces as `AC_SCHEMA_INVALID`.
 */
export class RefactorScanError extends Error {
  constructor(readonly code: ArchContextErrorCode, message: string) {
    super(message);
    this.name = "RefactorScanError";
  }
}

export interface RefactorScanInputV1 {
  /** The repository root; every measurement below is taken against its `HEAD`. */
  root: string;
  request: RefactorRequestV1;
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  /**
   * Ledger-latest recommendations, so the proposed set already reflects what is open. A scan
   * never writes them; `refactor record` re-plans against the same ledger under its own clock.
   */
  previousRecommendations: readonly RecommendationLedgerRecordV1[];
  catalogDigest: string;
  edgeLimit?: number;
}

export interface RefactorScanResultV1 {
  requestId: string;
  snapshot: ModuleStatisticsSnapshotV1;
  assessment: RefactorAssessmentV1;
  /** Present exactly when the request carried one, with `unresolvedTargets` resolved. */
  proposal?: RefactorProposalV1;
  /** What `refactor record` would append at this HEAD. Not persisted by the scan. */
  proposedRecommendations: RecommendationV3[];
  suppressed: RecommendationSuppression[];
  trackedFileCount: number;
}

/**
 * `RefactorRequestV1` carries no identity of its own, so the request digest is the identity: two
 * scans of the same request agree, and two different requests can never collide into one
 * assessment. Deriving it from a counter or a clock would make `scan --json` differ across runs.
 */
export function refactorRequestId(request: RefactorRequestV1): string {
  return `refactor_request.${digestJson(request as unknown as Json).slice("sha256:".length, "sha256:".length + 16)}`;
}

/**
 * Measures one repository and classifies one refactor request against it.
 *
 * Deterministic by construction: no clock is read. Both `createdAt` fields are the `HEAD`
 * committer date, so the measurement is dated by the commit it measured and two runs at the same
 * `HEAD` produce byte-identical JSON. Git blobs, workspace manifests and the code index are read
 * here; every classification below is a pure `@archcontext/core` call over that materialized data.
 */
export function runRefactorScan(input: RefactorScanInputV1): RefactorScanResultV1 {
  const issues = refactorRequestInvariantIssues(input.request);
  if (issues.length > 0) throw new RefactorScanError("AC_SCHEMA_INVALID", issues.join("; "));
  assertRequestedStateIsCurrent(input.request, input.worktree);

  const model = loadModel(input.root);
  const createdAt = readHeadCommitterDate(input.root);
  const requestId = refactorRequestId(input.request);
  const edgeLimit = input.edgeLimit ?? CODEGRAPH_IMPORT_NODE_QUERY_LIMIT;

  // Read once, hand the same array to both consumers: the classifier's ownership resolution has
  // to run over exactly the file set the snapshot measured, or a `scopePath` it calls unowned may
  // simply be a file the snapshot never saw.
  const trackedFiles = readTrackedSourceFiles(input.root);
  const codeFacts = readCodeFacts(input.root, input.worktree.worktreeDigest, edgeLimit);

  const snapshot = buildModuleStatisticsSnapshot({
    model,
    repository: input.repository,
    worktree: input.worktree,
    trackedFiles,
    importEdges: codeFacts.pairs,
    workspacePackages: declaredWorkspacePackages(input.root),
    truncated: codeFacts.truncated,
    edgeLimit,
    codeFacts: {
      version: codeFacts.version,
      binaryDigest: codeFacts.binaryDigest,
      availability: codeFacts.availability,
      indexedWorktreeDigest: codeFacts.indexedWorktreeDigest
    },
    createdAt
  });

  let assessed: ReturnType<typeof assessRefactor>;
  try {
    assessed = assessRefactor({
      snapshot,
      model,
      trackedFiles: trackedFiles.map((file) => file.path),
      request: input.request,
      requestId,
      createdAt
    });
  } catch (error) {
    throw new RefactorScanError("AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }

  let plan: ReturnType<typeof planRefactorRecommendationRun>;
  try {
    plan = planRefactorRecommendationRun({
      repository: input.repository,
      worktree: input.worktree,
      snapshot,
      assessment: assessed.assessment,
      ...(assessed.proposal ? { proposal: assessed.proposal } : {}),
      previousRecommendations: input.previousRecommendations.map((recommendation) => ({
        recommendationId: recommendation.recommendationId,
        fingerprint: recommendation.fingerprint,
        status: recommendation.status,
        updatedAt: recommendation.updatedAt
      })),
      catalogDigest: input.catalogDigest,
      now: createdAt
    });
  } catch (error) {
    throw new RefactorScanError("AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }

  return {
    requestId,
    snapshot,
    assessment: assessed.assessment,
    ...(assessed.proposal ? { proposal: assessed.proposal } : {}),
    proposedRecommendations: plan.recommendations,
    suppressed: plan.suppressed,
    trackedFileCount: trackedFiles.length
  };
}

/**
 * A repository with no root manifest declares no workspaces, so there is no `exports` map for a
 * bare specifier to resolve through and nothing to read. This is the measured answer, not a
 * relaxed one: such a specifier stays unresolved and is counted as such by the snapshot.
 */
function declaredWorkspacePackages(root: string): ReturnType<typeof readWorkspacePackages> {
  return existsSync(join(root, "package.json")) ? readWorkspacePackages(root) : [];
}

/**
 * `expectedHeadSha` and `expectedWorktreeDigest` are both optional: their absence is a scan of
 * whatever is current, not an error. When present they are a caller's claim about the state it
 * measured earlier, and a claim that no longer holds must not be answered with fresh numbers
 * under the old identity.
 */
function assertRequestedStateIsCurrent(request: RefactorRequestV1, worktree: ArchitectureWorktreeIdentityV1): void {
  if (request.expectedHeadSha !== undefined && request.expectedHeadSha !== worktree.headSha) {
    throw new RefactorScanError(
      "AC_REFACTOR_STALE",
      `refactor scan expected HEAD ${request.expectedHeadSha}, current ${worktree.headSha}`
    );
  }
  if (request.expectedWorktreeDigest !== undefined && request.expectedWorktreeDigest !== worktree.worktreeDigest) {
    throw new RefactorScanError(
      "AC_REFACTOR_STALE",
      `refactor scan expected worktree digest ${request.expectedWorktreeDigest}, current ${worktree.worktreeDigest}`
    );
  }
}

/** A repository with no declared architecture has nothing to measure modules against. */
function loadModel(root: string): ReturnType<typeof loadNativeModelFromArchContext> {
  let model: ReturnType<typeof loadNativeModelFromArchContext>;
  try {
    model = loadNativeModelFromArchContext(root);
  } catch (error) {
    throw new RefactorScanError(
      "AC_MODEL_ADOPTION_REQUIRED",
      `architecture model is unreadable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (model.nodes.length === 0) {
    throw new RefactorScanError("AC_MODEL_ADOPTION_REQUIRED", "architecture model declares no nodes; run archctx init");
  }
  return model;
}

interface RefactorScanCodeFactsV1 {
  pairs: { from: string; specifier: string; to: string | null }[];
  truncated: boolean;
  availability: ModuleStatisticsIndexAvailability;
  indexedWorktreeDigest: string | null;
  version: string;
  binaryDigest: string;
}

/**
 * Import edges plus the attestation of whatever produced them. With no index on disk nothing
 * observed this tree, so no version and no binary are reported: the empty strings say "no
 * attestation", and the snapshot builder independently degrades that to `coverage: unknown`.
 */
function readCodeFacts(root: string, worktreeDigest: string, edgeLimit: number): RefactorScanCodeFactsV1 {
  const indexed = codeGraphIndexAvailable(root);
  const imports = repositoryImportPairs(root, CODEGRAPH_BINARY, edgeLimit, worktreeDigest);
  const attestation = indexed ? attestCodeGraphBinary(root) : { version: "", binaryDigest: "" };
  return {
    pairs: imports.pairs,
    truncated: imports.truncated,
    availability: imports.availability,
    indexedWorktreeDigest: imports.indexedWorktreeDigest,
    ...attestation
  };
}

/** The actual binary that answered, not the pinned constant: a pin is a requirement, not evidence. */
function attestCodeGraphBinary(root: string): { version: string; binaryDigest: string } {
  const invocation = codeGraphCliInvocation(CODEGRAPH_BINARY, root);
  const version = execFileSync(invocation.command, [...invocation.argsPrefix, "--version"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: CODEGRAPH_VERSION_TIMEOUT_MS
  }).trim();
  const binaryPath = invocation.argsPrefix[0] ?? invocation.command;
  return {
    version,
    binaryDigest: `sha256:${createHash("sha256").update(readFileSync(binaryPath)).digest("hex")}`
  };
}
