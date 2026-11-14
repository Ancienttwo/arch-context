import { CODE_FACTS_ISSUE_MESSAGES, FailureError } from "@archcontext/contracts";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
  REQUIRED_CODEGRAPH_VERSION,
  CodeGraphProviderUnavailableError,
  pinnedCodeGraphProvider,
  withCodeGraphReadSession,
  type CodeGraphIndexCompatibilityV1,
  type CodeGraphIndexFreshnessV1,
  type CodeGraphReadProvider,
  type CodeGraphReadSession
} from "./read-session";
import { ProjectionCodeFactsUnavailableError } from "./projection-handshake";

/** One reason an index is not ready, in the closed contracts vocabulary. */
export interface RepositoryCodeFactsIssueV1 {
  code: keyof typeof CODE_FACTS_ISSUE_MESSAGES;
  message: string;
}

export interface RepositoryCodeFactsPendingChangesV1 {
  added: number;
  modified: number;
  removed: number;
}

/**
 * Read-only state of this repository's CodeGraph index (ADR-0058). `unavailable` means the pinned
 * CodeGraph provider could not load (`codegraph-unavailable`) or the index exists but could not be
 * opened and read read-only (`index-open-failed`); no other field is then reported. `index-missing`
 * means the provider loaded but the repository has no `.codegraph` index. `ready` and `not-ready`
 * carry the index facts, and `issues` lists why `not-ready` is not ready.
 */
export type RepositoryCodeFactsV1 =
  | {
      schemaVersion: "archcontext.repository-code-facts/v1";
      state: "unavailable";
      requiredVersion: typeof REQUIRED_CODEGRAPH_VERSION;
      reasonCode: "codegraph-unavailable" | "index-open-failed";
      message: string;
    }
  | {
      schemaVersion: "archcontext.repository-code-facts/v1";
      state: "index-missing";
      indexPresent: false;
      requiredVersion: typeof REQUIRED_CODEGRAPH_VERSION;
      codeGraphVersion: string;
      issues: RepositoryCodeFactsIssueV1[];
    }
  | {
      schemaVersion: "archcontext.repository-code-facts/v1";
      state: "ready" | "not-ready";
      indexPresent: true;
      requiredVersion: typeof REQUIRED_CODEGRAPH_VERSION;
      codeGraphVersion: string;
      indexBuiltWithVersion: string | null;
      extractionVersion: { builtWith: number | null; current: number | null };
      indexState: string | null;
      reindexRecommended: boolean | null;
      pendingRefs: number | null;
      /** Source changes the index has not synced yet; `null` when they were not measured. */
      pendingChanges: RepositoryCodeFactsPendingChangesV1 | null;
      issues: RepositoryCodeFactsIssueV1[];
    };

const REPOSITORY_CODE_FACTS_SCHEMA = "archcontext.repository-code-facts/v1" as const;
const PENDING_SOURCE_CHANGES_ISSUE = issue("pending-source-changes");
const INDEX_OPEN_FAILED_MESSAGE = "CodeGraph index could not be opened and read read-only";

function issue(code: RepositoryCodeFactsIssueV1["code"]): RepositoryCodeFactsIssueV1 {
  return { code, message: CODE_FACTS_ISSUE_MESSAGES[code] };
}

/**
 * The compatibility issues of an open index, in evaluation order: the loaded and the building
 * CodeGraph version, the project the index belongs to, a complete build with no pending
 * references, and the extraction version.
 */
function compatibilityIssues(root: string, compatibility: CodeGraphIndexCompatibilityV1): RepositoryCodeFactsIssueV1[] {
  const issues: RepositoryCodeFactsIssueV1[] = [];
  if (compatibility.version !== REQUIRED_CODEGRAPH_VERSION || compatibility.builtWithVersion !== REQUIRED_CODEGRAPH_VERSION) issues.push(issue("version-mismatch"));
  if (!sameRealPath(compatibility.projectPath, root)) issues.push(issue("project-path-mismatch"));
  if (compatibility.state !== "complete" || compatibility.reindexRecommended || compatibility.pendingRefs !== 0) issues.push(issue("index-incomplete"));
  else if (compatibility.builtWithExtractionVersion !== compatibility.currentExtractionVersion) issues.push(issue("extraction-version-mismatch"));
  return issues;
}

function sameRealPath(left: string, right: string): boolean {
  try {
    return realpathSync.native(left) === realpathSync.native(right);
  } catch {
    return false;
  }
}

/** Facts every repository-code-facts reader reports the same way, from one open session's reads. */
function repositoryCodeFactsFromSession(
  root: string,
  codeGraphVersion: string,
  compatibility: CodeGraphIndexCompatibilityV1,
  pending: CodeGraphIndexFreshnessV1 | undefined
): RepositoryCodeFactsV1 {
  const issues = compatibilityIssues(root, compatibility);
  // Pending changes mean the index lags the worktree; the compatibility tier does not measure them.
  if (pending && (pending.added !== 0 || pending.modified !== 0 || pending.removed !== 0)) issues.push(PENDING_SOURCE_CHANGES_ISSUE);
  return {
    schemaVersion: REPOSITORY_CODE_FACTS_SCHEMA,
    state: issues.length === 0 ? "ready" : "not-ready",
    indexPresent: true,
    requiredVersion: REQUIRED_CODEGRAPH_VERSION,
    codeGraphVersion,
    indexBuiltWithVersion: compatibility.builtWithVersion,
    extractionVersion: { builtWith: compatibility.builtWithExtractionVersion, current: compatibility.currentExtractionVersion },
    indexState: compatibility.state,
    reindexRecommended: issues.some(issue => issue.code !== "pending-source-changes"),
    pendingRefs: compatibility.pendingRefs,
    pendingChanges: pending ? { added: pending.added, modified: pending.modified, removed: pending.removed } : null,
    issues
  };
}

function buildInProgressCodeFacts(codeGraphVersion: string, versionIssues: RepositoryCodeFactsIssueV1[]): RepositoryCodeFactsV1 {
  // Every index field would be a mid-build guess. `null` is the contract's unknown value.
  return {
    schemaVersion: REPOSITORY_CODE_FACTS_SCHEMA,
    state: "not-ready",
    indexPresent: true,
    requiredVersion: REQUIRED_CODEGRAPH_VERSION,
    codeGraphVersion,
    indexBuiltWithVersion: null,
    extractionVersion: { builtWith: null, current: null },
    indexState: null,
    reindexRecommended: null,
    pendingRefs: null,
    pendingChanges: null,
    issues: [...versionIssues, issue("index-incomplete")]
  };
}

function versionIssuesOf(codeGraphVersion: string): RepositoryCodeFactsIssueV1[] {
  return codeGraphVersion === REQUIRED_CODEGRAPH_VERSION ? [] : [issue("version-mismatch")];
}

function unavailableCodeFacts(reasonCode: "codegraph-unavailable" | "index-open-failed", message: string): RepositoryCodeFactsV1 {
  return { schemaVersion: REPOSITORY_CODE_FACTS_SCHEMA, state: "unavailable", requiredVersion: REQUIRED_CODEGRAPH_VERSION, reasonCode, message };
}

export interface RepositoryCodeFactsInspectionOptions {
  /** The pinned provider of this installation unless a test injects one. */
  provider?: CodeGraphReadProvider;
}

/**
 * Inspects the repository's code-facts state through one read-only session (ADR-0058): no CodeGraph
 * command, no `git status`, no writable open. It measures freshness with CodeGraph's own change
 * test and never throws for an unavailable provider or index. While a provider build holds the
 * writer lock it does not open the index (#426).
 */
export function inspectRepositoryCodeFacts(root: string, options: RepositoryCodeFactsInspectionOptions = {}): RepositoryCodeFactsV1 {
  return inspectRepositoryCodeFactsReadiness(root, options).facts;
}

/** `inspectRepositoryCodeFacts` with whether a not-ready answer is worth retrying. */
export function inspectRepositoryCodeFactsReadiness(root: string, options: RepositoryCodeFactsInspectionOptions = {}): { facts: RepositoryCodeFactsV1; retryable: boolean } {
  return inspectRepositoryCodeFactsTier(root, "freshness", options);
}

/**
 * When a provider build held the writer lock, at open or after the reads, or the index revision
 * changed while the session read it (design G4), the facts are the not-ready build-in-progress
 * answer and nothing read is reported. `retryable` is true then, unless the loaded provider has the
 * wrong version: a retry after the build cannot fix that.
 */
function inspectRepositoryCodeFactsTier(root: string, tier: "compatibility" | "freshness", options: RepositoryCodeFactsInspectionOptions): { facts: RepositoryCodeFactsV1; retryable: boolean } {
  let provider: CodeGraphReadProvider;
  let codeGraphVersion: string;
  try {
    provider = options.provider ?? pinnedCodeGraphProvider();
    codeGraphVersion = provider.version;
  } catch (error) {
    return { facts: unavailableCodeFacts("codegraph-unavailable", error instanceof CodeGraphProviderUnavailableError ? error.message : "CodeGraph provider could not be loaded"), retryable: false };
  }
  const versionIssues = versionIssuesOf(codeGraphVersion);
  try {
    return withCodeGraphReadSession(root, (opened): { facts: RepositoryCodeFactsV1; retryable: boolean } => {
      switch (opened.state) {
        case "index-missing":
          return { facts: { schemaVersion: REPOSITORY_CODE_FACTS_SCHEMA, state: "index-missing", indexPresent: false, requiredVersion: REQUIRED_CODEGRAPH_VERSION, codeGraphVersion, issues: versionIssues }, retryable: false };
        case "index-open-failed":
          return { facts: unavailableCodeFacts("index-open-failed", INDEX_OPEN_FAILED_MESSAGE), retryable: false };
        case "build-in-progress":
          return movingCodeFacts(codeGraphVersion);
        case "open":
          return openSessionCodeFacts(opened.session, tier);
      }
    }, { provider });
  } catch {
    // The index opened but a read of it failed; no provider text crosses this boundary.
    return { facts: unavailableCodeFacts("index-open-failed", INDEX_OPEN_FAILED_MESSAGE), retryable: false };
  }
}

/**
 * The `ready` or `not-ready` facts of an index already open in `session`, read on that handle. A
 * provider build that holds the writer lock, or a revision that moved during the reads, gives the
 * build-in-progress answer; `retryable` follows `inspectRepositoryCodeFactsTier`. Throws when a
 * read of the handle fails.
 */
export function openSessionCodeFacts(session: CodeGraphReadSession, tier: "compatibility" | "freshness"): { facts: RepositoryCodeFactsV1; retryable: boolean } {
  const codeGraphVersion = session.version();
  const compatibility = session.compatibility();
  const pendingChanges = tier === "freshness" ? session.freshness() : undefined;
  // Facts read across a build or a sync are not one index state (design G4).
  if (!session.unchangedSinceOpen()) return movingCodeFacts(codeGraphVersion);
  return { facts: repositoryCodeFactsFromSession(session.root, codeGraphVersion, compatibility, pendingChanges), retryable: false };
}

/** The build-in-progress answer; a retry cannot fix a provider of the wrong version. */
export function movingCodeFacts(codeGraphVersion: string): { facts: RepositoryCodeFactsV1; retryable: boolean } {
  const versionIssues = versionIssuesOf(codeGraphVersion);
  return { facts: buildInProgressCodeFacts(codeGraphVersion, versionIssues), retryable: versionIssues.length === 0 };
}

/**
 * Read-only usability gate (ADR-0058): compatibility facts only. Pending edits affect freshness, not
 * index compatibility, so the gate reads no source file.
 */
export function assertRepositoryCodeFactsReady(root: string, options: RepositoryCodeFactsInspectionOptions = {}): void {
  const { facts, retryable } = inspectRepositoryCodeFactsTier(root, "compatibility", options);
  if (facts.state === "index-missing") throw new ProjectionCodeFactsUnavailableError("index-missing");
  if (facts.state === "unavailable") {
    if (facts.reasonCode === "index-open-failed") throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-open-failed");
    throw codeFactsUnavailableError();
  }
  // The compatibility tier never measures pending changes, so every not-ready answer refuses.
  if (facts.state === "not-ready") {
    const action = facts.codeGraphVersion !== REQUIRED_CODEGRAPH_VERSION ? "install-compatible-codegraph"
      : "codegraph-index";
    throw new FailureError("AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", { issues: facts.issues }, { action, ...(retryable ? { retryable: true } : {}) });
  }
}

/** The pinned CodeGraph provider could not load, or a read failed for no index-specific reason. */
export function codeFactsUnavailableError(): FailureError {
  return new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-unavailable", {}, { action: "inspect-diagnostics", retryable: false });
}

/** True when this workspace carries a CodeGraph index the CLI can be pointed at. */
export function codeGraphIndexAvailable(workspaceRoot: string): boolean {
  return existsSync(join(workspaceRoot, ".codegraph"));
}
