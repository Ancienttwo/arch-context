import { FailureError } from "@archcontext/contracts";
import { constants, copyFileSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { codeGraphIndexBuildInProgress, codeGraphIndexIdentity, measureCodeGraphIndexFreshness, pinnedCodeGraphProvider, withCodeGraphReadSession, type CodeGraphIndexHandle, type CodeGraphReadProvider, type CodeGraphReadSession } from "./read-session";
import {
  codeFactsUnavailableError,
  inspectRepositoryCodeFactsReadiness,
  movingCodeFacts,
  openSessionCodeFacts,
  type RepositoryCodeFactsInspectionOptions,
  type RepositoryCodeFactsV1
} from "./repository-code-facts";

type CodeFactsReadiness = { facts: RepositoryCodeFactsV1; retryable: boolean };

/**
 * The step after every read of a ready index (ADR-0058, design G4). A session measures freshness
 * once, and its revision moves only with the index, so a source edit during the read shows up
 * only in a fresh change test: a fresh inspection in its own session must find the index ready,
 * then `session` must be unchanged since it opened. Returns the refusal, `moved` when only the
 * second test failed, or `undefined` when the read stands.
 */
export function codeFactsReadinessAfterRead(root: string, session: CodeGraphReadSession, provider: CodeGraphReadProvider): (CodeFactsReadiness & { moved: boolean }) | undefined {
  const fresh = inspectRepositoryCodeFactsReadiness(root, { provider });
  if (fresh.facts.state !== "ready") return { ...fresh, moved: false };
  if (!session.unchangedSinceOpen()) return { ...movingCodeFacts(provider.version), moved: true };
  return undefined;
}

/**
 * Runs `read` against the repository's own index through one read-only session (ADR-0058), and
 * returns its result only while that index attests to the worktree: it is compatible before the
 * read, and after it a fresh change test finds no pending source change and the revision has not
 * moved. Compatibility and `read` use the same handle. Nothing syncs, copies or
 * writes the index; `flows check --no-sync` and ref impact read through here.
 *
 * - no `.codegraph/codegraph.db`: `AC_CODE_FACTS_UNAVAILABLE` / `index-missing`
 * - a linked `.codegraph`, or an index that cannot be opened and read: `index-open-failed`
 * - an incompatible or stale index, a live build, a source edit during the read, or an index that
 *   moved during the read: `code-facts-read-not-ready` with the readiness issues; retryable for a
 *   live build or a move
 * - any other failure, such as a provider that cannot load: `code-facts-unavailable`
 */
export function withReadyCodeGraphIndex<T>(root: string, read: (graph: CodeGraphIndexHandle) => T, options: RepositoryCodeFactsInspectionOptions = {}): T {
  try {
    const provider = options.provider ?? pinnedCodeGraphProvider();
    return withCodeGraphReadSession(root, (opened) => {
      switch (opened.state) {
        case "index-missing":
          throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-missing");
        case "index-open-failed":
          throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-open-failed");
        case "build-in-progress":
          throw notReady(movingCodeFacts(provider.version));
        case "open": {
          // Compatibility gates the read; freshness is proven once, by the step after it.
          let readiness: { facts: RepositoryCodeFactsV1; retryable: boolean };
          try { readiness = openSessionCodeFacts(opened.session, "compatibility"); }
          catch { throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-open-failed"); }
          if (readiness.facts.state !== "ready") throw notReady(readiness);
          const result = read(opened.session.graph);
          const after = codeFactsReadinessAfterRead(root, opened.session, provider);
          if (after) throw notReady(after);
          return result;
        }
      }
    }, { provider });
  } catch (error) {
    if (error instanceof FailureError) throw error;
    // No provider or SDK text crosses this boundary.
    throw codeFactsUnavailableError();
  }
}

/**
 * SQLite's read-only SDK open can write WAL sidecars. Stage the index outside the worktree and
 * have the SDK read that copy while measuring freshness against the real checkout. The copy is
 * usable only while the original DB and WAL metadata stay stable and no provider build is live.
 */
export function assertReadyCodeGraphIndexWithoutWorktreeWrites(root: string): void {
  let scratch: string | undefined;
  try {
    const indexDir = join(root, ".codegraph");
    const directory = lstatSync(indexDir, { throwIfNoEntry: false });
    if (!directory) throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-missing");
    if (!directory.isDirectory()) throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-open-failed");
    const files = ["codegraph.db", "codegraph.db-wal"];
    const state = () => files.map((name) => {
      const stat = lstatSync(join(indexDir, name), { bigint: true, throwIfNoEntry: false });
      if (!stat) return null;
      if (!stat.isFile()) throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-open-failed");
      return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
    });
    const original = state();
    if (!original[0]) throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-missing");
    if (!codeGraphIndexIdentity(root) || lstatSync(join(indexDir, "codegraph.db-journal"), { throwIfNoEntry: false })) {
      throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-open-failed");
    }
    const provider = pinnedCodeGraphProvider();
    const assertStable = () => {
      if (codeGraphIndexBuildInProgress(root) || state().some((stamp, index) => stamp !== original[index])) {
        throw notReady(movingCodeFacts(provider.version));
      }
    };
    assertStable();
    const tmp = realpathSync(tmpdir());
    const tmpFromRoot = relative(realpathSync(root), tmp);
    if (!isAbsolute(tmpFromRoot) && tmpFromRoot !== ".." && !tmpFromRoot.startsWith(`..${sep}`)) throw codeFactsUnavailableError();
    scratch = mkdtempSync(join(tmp, "archctx-code-facts-"));
    const copyDir = join(scratch, ".codegraph");
    mkdirSync(copyDir);
    for (const [index, name] of files.entries()) {
      if (original[index] !== null) copyFileSync(join(indexDir, name), join(copyDir, name), constants.COPYFILE_FICLONE);
    }
    assertStable();
    const readiness = withCodeGraphReadSession(scratch, (opened) => {
      if (opened.state !== "open") throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-open-failed");
      return openSessionCodeFacts(opened.session, "freshness", () => measureCodeGraphIndexFreshness(root, opened.session.graph, provider));
    }, { provider });
    assertStable();
    if (readiness.facts.state !== "ready") throw notReady(readiness);
  } catch (error) {
    if (error instanceof FailureError) throw error;
    throw codeFactsUnavailableError();
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function notReady({ facts, retryable }: CodeFactsReadiness): FailureError {
  // An index that disappeared or stopped opening after the read is refused by its own reason.
  if (facts.state === "index-missing") return new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-missing");
  if (facts.state === "unavailable") return facts.reasonCode === "index-open-failed" ? new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-open-failed") : codeFactsUnavailableError();
  const issues = facts.state === "not-ready" ? facts.issues : [];
  return new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-read-not-ready", { issues }, retryable ? { retryable: true } : {});
}
