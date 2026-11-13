import { CODE_FACTS_ISSUE_MESSAGES, FailureError } from "@archcontext/contracts";
import { withCodeGraphReadSession, type CodeGraphIndexHandle } from "./read-session";
import { inspectRepositoryCodeFacts } from "./repository-code-facts";

/**
 * Runs `read` against the repository's own index through one read-only session (ADR-0058), and
 * only while that index attests to the worktree: it is compatible and CodeGraph's change test finds
 * no pending source change. Nothing syncs, copies or writes the index; `flows check --no-sync` and
 * ref impact read through here.
 *
 * - no `.codegraph/codegraph.db`: `AC_CODE_FACTS_UNAVAILABLE` / `index-missing`
 * - a linked `.codegraph`, or an index that cannot be opened and read: `index-open-failed`
 * - an incompatible or stale index, a live build, or an index that moved during the read:
 *   `code-facts-read-not-ready` with the readiness issues
 * - any other failure, such as a provider that cannot load: `code-facts-unavailable`
 */
export function withReadyCodeGraphIndex<T>(root: string, read: (graph: CodeGraphIndexHandle) => T): T {
  try {
    return withCodeGraphReadSession(root, (opened) => {
      switch (opened.state) {
        case "index-missing":
          throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-missing");
        case "index-open-failed":
          throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-open-failed");
        case "build-in-progress":
          throw indexMoving();
        case "open": {
          // Readiness opens its own session inside this one. An unchanged revision after the read
          // (design G4) proves that both sessions read one index state.
          const facts = inspectRepositoryCodeFacts(root);
          if (facts.state === "index-missing") throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-missing");
          if (facts.state === "unavailable") {
            throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", facts.reasonCode === "index-open-failed" ? "index-open-failed" : "code-facts-unavailable");
          }
          if (facts.state === "not-ready") throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-read-not-ready", { issues: facts.issues });
          const result = read(opened.session.graph);
          if (!opened.session.unchangedSinceOpen()) throw indexMoving();
          return result;
        }
      }
    });
  } catch (error) {
    if (error instanceof FailureError) throw error;
    // No provider or SDK text crosses this boundary.
    throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-unavailable");
  }
}

/** A provider build holds the writer lock, or the index revision moved while it was read. */
function indexMoving(): FailureError {
  return new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-read-not-ready", {
    issues: [{ code: "index-incomplete", message: CODE_FACTS_ISSUE_MESSAGES["index-incomplete"] }]
  }, { retryable: true });
}
