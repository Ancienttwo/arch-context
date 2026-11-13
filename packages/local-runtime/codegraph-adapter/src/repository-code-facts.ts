import { CODE_FACTS_ISSUE_MESSAGES, FailureError } from "@archcontext/contracts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  REQUIRED_CODEGRAPH_VERSION,
  CodeGraphProviderUnavailableError,
  pinnedCodeGraphProvider,
  withCodeGraphReadSession,
  type CodeGraphReadProvider
} from "./read-session";
import {
  ProjectionCodeFactsUnavailableError,
  projectionCodeGraphStatusIssues,
  type CodeGraphProjectionStatusV1,
  type ProjectionCodeGraphStatusIssueV1
} from "./projection-handshake";

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
      issues: ProjectionCodeGraphStatusIssueV1[];
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
      issues: ProjectionCodeGraphStatusIssueV1[];
    };

const REPOSITORY_CODE_FACTS_SCHEMA = "archcontext.repository-code-facts/v1" as const;
const PENDING_SOURCE_CHANGES_ISSUE: ProjectionCodeGraphStatusIssueV1 = {
  code: "pending-source-changes",
  message: CODE_FACTS_ISSUE_MESSAGES["pending-source-changes"]
};
const INDEX_OPEN_FAILED_MESSAGE = "CodeGraph index could not be opened and read read-only";

/** Facts every repository-code-facts reader reports the same way, from one status snapshot. */
function repositoryCodeFactsFromStatus(
  root: string,
  codeGraphVersion: string,
  status: CodeGraphProjectionStatusV1,
  measuresFreshness: boolean
): RepositoryCodeFactsV1 {
  const issues = projectionCodeGraphStatusIssues(status, root, "repository");
  const pending = status.pendingChanges;
  // A projection runs `sync` first, so pending changes are not a projection-status issue; for a
  // read-only inspection they mean the index lags the worktree.
  if (measuresFreshness && (!pending || pending.added !== 0 || pending.modified !== 0 || pending.removed !== 0)) {
    issues.push(PENDING_SOURCE_CHANGES_ISSUE);
  }
  return {
    schemaVersion: REPOSITORY_CODE_FACTS_SCHEMA,
    state: issues.length === 0 ? "ready" : "not-ready",
    indexPresent: true,
    requiredVersion: REQUIRED_CODEGRAPH_VERSION,
    codeGraphVersion,
    indexBuiltWithVersion: status.index?.builtWithVersion ?? null,
    extractionVersion: {
      builtWith: status.index?.builtWithExtractionVersion ?? null,
      current: status.index?.currentExtractionVersion ?? null
    },
    indexState: status.index?.state ?? null,
    reindexRecommended: issues.some(issue => issue.code !== "pending-source-changes"),
    pendingRefs: status.index?.pendingRefs ?? null,
    pendingChanges: pending ? { added: pending.added, modified: pending.modified, removed: pending.removed } : null,
    issues
  };
}

function buildInProgressCodeFacts(codeGraphVersion: string, versionIssues: ProjectionCodeGraphStatusIssueV1[]): RepositoryCodeFactsV1 {
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
    issues: [...versionIssues, { code: "index-incomplete", message: CODE_FACTS_ISSUE_MESSAGES["index-incomplete"] }]
  };
}

function versionIssuesOf(codeGraphVersion: string): ProjectionCodeGraphStatusIssueV1[] {
  return codeGraphVersion === REQUIRED_CODEGRAPH_VERSION ? [] : [{ code: "version-mismatch", message: CODE_FACTS_ISSUE_MESSAGES["version-mismatch"] }];
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
  return inspectRepositoryCodeFactsTier(root, "freshness", options).facts;
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
  const moving = { facts: buildInProgressCodeFacts(codeGraphVersion, versionIssues), retryable: versionIssues.length === 0 };
  try {
    return withCodeGraphReadSession(root, (opened): { facts: RepositoryCodeFactsV1; retryable: boolean } => {
      switch (opened.state) {
        case "index-missing":
          return { facts: { schemaVersion: REPOSITORY_CODE_FACTS_SCHEMA, state: "index-missing", indexPresent: false, requiredVersion: REQUIRED_CODEGRAPH_VERSION, codeGraphVersion, issues: versionIssues }, retryable: false };
        case "index-open-failed":
          return { facts: unavailableCodeFacts("index-open-failed", INDEX_OPEN_FAILED_MESSAGE), retryable: false };
        case "build-in-progress":
          return moving;
        case "open": {
          const compatibility = opened.session.compatibility();
          const pendingChanges = tier === "freshness" ? opened.session.freshness() : undefined;
          // Facts read across a build or a sync are not one index state (design G4).
          if (!opened.session.unchangedSinceOpen()) return moving;
          const status: CodeGraphProjectionStatusV1 = {
            initialized: true,
            version: compatibility.version,
            projectPath: compatibility.projectPath,
            lastIndexed: compatibility.lastIndexed,
            ...(pendingChanges === undefined ? {} : { pendingChanges }),
            // `openSync(root)` never walks up to another worktree's index (ADR-0058).
            worktreeMismatch: null,
            index: {
              ...(compatibility.builtWithVersion === null ? {} : { builtWithVersion: compatibility.builtWithVersion }),
              ...(compatibility.builtWithExtractionVersion === null ? {} : { builtWithExtractionVersion: compatibility.builtWithExtractionVersion }),
              currentExtractionVersion: compatibility.currentExtractionVersion,
              reindexRecommended: compatibility.reindexRecommended,
              ...(compatibility.state === null ? {} : { state: compatibility.state }),
              pendingRefs: compatibility.pendingRefs
            }
          };
          return { facts: repositoryCodeFactsFromStatus(root, codeGraphVersion, status, tier === "freshness"), retryable: false };
        }
      }
    }, { provider });
  } catch {
    // The index opened but a read of it failed; no provider text crosses this boundary.
    return { facts: unavailableCodeFacts("index-open-failed", INDEX_OPEN_FAILED_MESSAGE), retryable: false };
  }
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
    throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-unavailable", {}, { action: "inspect-diagnostics", retryable: false });
  }
  // The compatibility tier never measures pending changes, so every not-ready answer refuses.
  if (facts.state === "not-ready") {
    const action = facts.codeGraphVersion !== REQUIRED_CODEGRAPH_VERSION ? "install-compatible-codegraph"
      : "codegraph-index";
    throw new FailureError("AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", { issues: facts.issues }, { action, ...(retryable ? { retryable: true } : {}) });
  }
}

/** True when this workspace carries a CodeGraph index the CLI can be pointed at. */
export function codeGraphIndexAvailable(workspaceRoot: string): boolean {
  return existsSync(join(workspaceRoot, ".codegraph"));
}
