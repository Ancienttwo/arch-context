import {
  ARCHCONTEXT_PRODUCT_VERSION, ARCHITECTURE_DEBT_DELTA_SCHEMA_VERSION, FailureError, okEnvelope,
  type ArchitectureDebtCheck, type ArchitectureDebtDeltaReportV1, type ArchitectureDebtKind,
  type ArchitectureDebtReportV1, type Json, type JsonEnvelope
} from "@archcontext/contracts";
import {
  readArchitectureDebt, readCompleteTaskArchitectureDebt, selectedProducerFailureEnvelope, unadoptedDebt
} from "@archcontext/local-runtime/architecture-debt";
import { REQUIRED_CODEGRAPH_VERSION, initCodeGraphIndex, seedCodeGraphIndexFromBase } from "@archcontext/local-runtime/codegraph-adapter";
import { hasSkippedWorktreePaths, readGitBlobTree, readNativeGitRoot, resolveNativeGitSnapshot, withDetachedGitWorktree } from "@archcontext/local-runtime/git-adapter";
import { runtimeStatePaths, SqliteLocalStore, type ArchitectureDebtBaseCacheKey } from "@archcontext/local-runtime/local-store-sqlite";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type DebtMeasurementProfile = ArchitectureDebtBaseCacheKey["measurementProfile"];
// Supersedes cache entries measured before the full base checkout was enforced.
const ARCHITECTURE_DEBT_ENGINE_VERSION = `${ARCHCONTEXT_PRODUCT_VERSION}/2`;
const CHECK_BY_DEBT_KIND: Record<ArchitectureDebtKind, ArchitectureDebtCheck> = {
  "unowned-path": "ownership",
  "ambiguous-owner": "ownership",
  "undeclared-dependency": "dependencies",
  "flow-proof-failed": "flows",
  "stale-anchor": "anchors",
  "practice-regression": "practices",
  "state-machine-rule": "state-machines",
  "state-machine-stale": "state-machines"
};

export async function runArchitectureDebtDeltaCommand(cwd: string, ref: string, complete: boolean, signal?: AbortSignal): Promise<JsonEnvelope> {
  try {
    const root = readNativeGitRoot(cwd);
    const { commitSha: baseSha, treeOid } = resolveNativeGitSnapshot(root, ref);
    const { commitSha: headSha } = resolveNativeGitSnapshot(root, "HEAD");
    signal?.throwIfAborted();
    if (hasSkippedWorktreePaths(root)) throw new FailureError("AC_PRECONDITION_FAILED", "debt-head-sparse-checkout");
    const measurementProfile = complete ? "complete" : "edit-time";
    const head = readDebtForDelta(root, measurementProfile);
    const archcontext = readGitBlobTree(root, treeOid, { recursive: false, trees: false, sizes: false })
      .find(entry => entry.path === ".archcontext" && entry.type === "tree");
    const paths = runtimeStatePaths(root);
    const key: ArchitectureDebtBaseCacheKey = {
      repositoryId: paths.storageRepositoryId,
      baseSha,
      archcontextTreeOid: archcontext?.objectId ?? null,
      codeGraphVersion: REQUIRED_CODEGRAPH_VERSION,
      engineVersion: ARCHITECTURE_DEBT_ENGINE_VERSION,
      measurementProfile
    };
    const base = await readBaseDebt(root, join(paths.sharedCacheDir, "architecture-debt.sqlite"), key, signal);
    signal?.throwIfAborted();
    const report: ArchitectureDebtDeltaReportV1 = {
      schemaVersion: ARCHITECTURE_DEBT_DELTA_SCHEMA_VERSION,
      head: { sha: headSha, debt: head },
      base: { ref, sha: baseSha, debtDigest: base.digest, coverage: base.coverage, coverageReasonCodes: base.coverageReasonCodes },
      introduced: debtAbsentFrom(head, base),
      resolvedIds: debtAbsentFrom(base, head).map(item => item.id)
    };
    // SAFETY: The delta and its checked debt report contain only JSON fields.
    return okEnvelope("debt", report as unknown as Json);
  } catch (error) {
    return selectedProducerFailureEnvelope("debt", error, "debt");
  }
}

function readDebtForDelta(root: string, profile: DebtMeasurementProfile): ArchitectureDebtReportV1 {
  if (profile === "complete") return readCompleteTaskArchitectureDebt(root);
  if (!existsSync(join(root, ".archcontext/manifest.yaml"))) return unadoptedDebt();
  return readArchitectureDebt(root);
}

const CODEGRAPH_MISSING_REASONS = new Set(["index-missing", "codegraph-unavailable"]);

function hasCodeGraphMissingGap(report: ArchitectureDebtReportV1): boolean {
  return report.checks.some(check => check.reasonCodes.some(reason => CODEGRAPH_MISSING_REASONS.has(reason)));
}

async function coldIndexDetachedWorktree(worktree: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const indexDir = join(worktree, ".codegraph");
  // Pre-seed a self-ignoring `.gitignore` before `codegraph init` so `.codegraph/.gitignore`
  // never becomes Git-visible in repositories whose root `.gitignore` does not exclude `.codegraph/`.
  if (!existsSync(indexDir)) {
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(join(indexDir, ".gitignore"), "*\n", "utf8");
  }
  try {
    await initCodeGraphIndex(worktree, { signal });
  } catch {
    if (signal?.aborted) signal.throwIfAborted();
    // Discard any partial index inside this private detached worktree so the debt reader
    // reports a clean missing-index coverage gap instead of a half-written database.
    rmSync(indexDir, { recursive: true, force: true });
  }
}

async function readBaseDebt(root: string, cachePath: string, key: ArchitectureDebtBaseCacheKey, signal?: AbortSignal): Promise<ArchitectureDebtReportV1> {
  const store = new SqliteLocalStore(cachePath);
  try {
    const cached = existsSync(cachePath) ? await store.readArchitectureDebtBase(key) : undefined;
    if (cached !== undefined) return cached;
    signal?.throwIfAborted();
    const report = await withDetachedGitWorktree(root, key.baseSha, async worktree => {
      signal?.throwIfAborted();
      if (!existsSync(join(worktree, ".archcontext/manifest.yaml"))) {
        return readDebtForDelta(worktree, key.measurementProfile);
      }
      const seeded = seedCodeGraphIndexFromBase(worktree);
      const indexReady = seeded === "seeded" || seeded === "present";
      if (key.measurementProfile === "complete") {
        if (!indexReady) await coldIndexDetachedWorktree(worktree, signal);
        signal?.throwIfAborted();
        return readDebtForDelta(worktree, "complete");
      }
      const editTime = readDebtForDelta(worktree, "edit-time");
      if (!indexReady && hasCodeGraphMissingGap(editTime)) {
        await coldIndexDetachedWorktree(worktree, signal);
        signal?.throwIfAborted();
        return readDebtForDelta(worktree, "edit-time");
      }
      return editTime;
    });
    signal?.throwIfAborted();
    // CodeGraph and other evidence can become available later. Cache only coverage gaps
    // intrinsic to this commit or to the requested profile.
    if (report.checks.every(check => check.coverage === "complete" || check.reasonCodes.every(reason =>
      ["not-evaluated", "deferred-to-complete", "not-enabled", "model-not-adopted"].includes(reason)))) {
      await store.saveArchitectureDebtBase(key, report);
    }
    return report;
  } finally {
    store.close();
  }
}

/** Reports are already sorted. Only an opposing check with complete coverage proves absence. */
function debtAbsentFrom(observed: ArchitectureDebtReportV1, compared: ArchitectureDebtReportV1) {
  const otherIds = new Set(compared.items.map(item => item.id));
  const complete = new Set(compared.checks.filter(check => check.coverage === "complete").map(check => check.check));
  return observed.items.filter(item => !otherIds.has(item.id) && complete.has(CHECK_BY_DEBT_KIND[item.kind]));
}
