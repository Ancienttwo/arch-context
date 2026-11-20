import {
  ARCHCONTEXT_PRODUCT_VERSION, ARCHITECTURE_DEBT_CHECKS, ARCHITECTURE_DEBT_DELTA_SCHEMA_VERSION,
  architectureDebtReportIssues, FailureError, failureEnvelope, knownFailure, normalizeFailureResult, isRepoRelativePosixPath, okEnvelope,
  type ArchContextErrorCode, type StrictFailure, type ArchitectureDebtCheck, type ArchitectureDebtKind,
  type ArchitectureDebtDeltaReportV1, type ArchitectureDebtReportV1, type Json, type JsonEnvelope, type PracticeEnforcementEvaluationV1
} from "@archcontext/contracts";
import { resolveOwnership } from "@archcontext/core/module-statistics";
import { ancestorChain, loadNativeModelFromArchContext, nativeNodeSource, type NativeModel } from "@archcontext/core/projection-engine";
import { evaluateArchitectureDebt, type ArchitectureDebtEvidence } from "@archcontext/core/review-engine";
import { checkStateMachines, loadStateMachinesFromArchContext } from "@archcontext/core/state-machine-engine";
import { findRepositoryRoot, listGitVisibleFiles, readGitBlobTree, readNativeGitRoot, resolveNativeGitSnapshot, withDetachedGitWorktree } from "@archcontext/local-runtime/git-adapter";
import { assertRepositoryCodeFactsReady, codeGraphIndexAvailable, REQUIRED_CODEGRAPH_VERSION, seedCodeGraphIndexFromBase, type RepositoryCodeFactsInspectionOptions } from "@archcontext/local-runtime/codegraph-adapter";
import { runtimeStatePaths, SqliteLocalStore, type ArchitectureDebtBaseCacheKey } from "@archcontext/local-runtime/local-store-sqlite";
import { selectedProducerFailure, selectedProducerFailureEnvelope } from "./producer-failure";
export { selectedProducerFailure, selectedProducerFailureEnvelope } from "./producer-failure";
import { readArchitectureDebtCodeFacts } from "./architecture-debt-code-facts";
import { runDocsAnchorsCommand } from "./docs-anchors";
import { stateMachineAnchors } from "./state-machine-anchors";
import type { DocsAnchorsReportV1 } from "@archcontext/contracts";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface ArchitectureDebtReadInput { changedPaths?: string[] }

type DebtMeasurementProfile = ArchitectureDebtBaseCacheKey["measurementProfile"];
const ARCHITECTURE_DEBT_ENGINE_VERSION = `${ARCHCONTEXT_PRODUCT_VERSION}/1`;
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

/**
 * Edit-time debt (#328's measured >3s falsifier): ownership, human citation and state machine anchor checks only.
 * This function does not open a runtime session, sync CodeGraph, render or write any state.
 * Unmeasured dependency/flow/practice checks remain explicit gaps, never a clean full verdict.
 */
export function readArchitectureDebt(root: string, input: ArchitectureDebtReadInput = {}): ArchitectureDebtReportV1 {
  try {
    const { evidence } = readArchitectureDebtEvidence(root, input);
    return checkedDebt({ ...evidence,
      unavailable: { dependencies: ["deferred-to-complete"], flows: ["deferred-to-complete"], practices: ["deferred-to-complete"] }
    });
  } catch (error) { throw selectedProducerFailure(error, "debt"); }
}

/** Repository-wide completion measurement; practice evidence stays owned by the daemon. */
export function readCompleteTaskArchitectureDebt(root: string, practices?: PracticeEnforcementEvaluationV1): ArchitectureDebtReportV1 {
  try {
    if (!existsSync(join(root, ".archcontext/manifest.yaml"))) return unadoptedDebt();
    const { model, evidence } = readArchitectureDebtEvidence(root, {});
    const codeFacts = readArchitectureDebtCodeFacts(root, model);
    return checkedDebt({ ...evidence, ...codeFacts, practices,
      unavailable: { ...codeFacts.unavailable, ...(practices === undefined ? { practices: ["not-enabled"] } : {}) }
    });
  } catch (error) { throw selectedProducerFailure(error, "debt"); }
}

function unadoptedDebt(): ArchitectureDebtReportV1 {
  return checkedDebt({ scope: { kind: "repository", changedPaths: [], capabilityIds: [] },
    unavailable: Object.fromEntries(ARCHITECTURE_DEBT_CHECKS.map(check => [check, ["model-not-adopted"]])) });
}

function checkedDebt(evidence: ArchitectureDebtEvidence): ArchitectureDebtReportV1 {
  const report = evaluateArchitectureDebt(evidence);
  if (architectureDebtReportIssues(report).length > 0) {
    throw new ArchitectureDebtReadError("AC_SCHEMA_INVALID", "Architecture debt evidence violates its contract", "debt-report-invalid");
  }
  return report;
}

function readArchitectureDebtEvidence(root: string, input: ArchitectureDebtReadInput): { model: NativeModel; evidence: ArchitectureDebtEvidence } {
  if (input.changedPaths !== undefined && (!Array.isArray(input.changedPaths) || input.changedPaths.some(path => typeof path !== "string"))) {
    throw new ArchitectureDebtReadError("AC_SCHEMA_INVALID", "changedPaths must be an array of paths", "changed-path-invalid");
  }
  const changedPaths = [...new Set(input.changedPaths ?? [])].sort();
  if (changedPaths.some(path => !isRepoRelativePosixPath(path))) throw new ArchitectureDebtReadError("AC_SCHEMA_INVALID", "changedPaths must contain repository-relative POSIX paths", "changed-path-invalid");
  if (!existsSync(join(root, ".archcontext/manifest.yaml"))) throw new ArchitectureDebtReadError("AC_MODEL_ADOPTION_REQUIRED", "Architecture debt requires an adopted architecture model", "model-missing");
  const model = loadNativeModelFromArchContext(root);
  const files = listGitVisibleFiles(root);
  const visible = new Set(files);
  // Model/policy edits can change any capability's obligations. Source and human-doc edits stay scoped.
  const repository = changedPaths.length === 0 || changedPaths.some(path => path.startsWith(".archcontext/"));
  const measuredPaths = repository ? files : changedPaths.filter(path => visible.has(path));
  const owners = resolveOwnership(model.nodes, measuredPaths);
  const capabilityByNodeId = nodeCapabilities(model);
  const touchedNodeIds = new Set<string>();
  for (const entry of owners.byPath.values()) for (const id of entry.owners) touchedNodeIds.add(id);
  for (const node of model.nodes) {
    const entrypoints = nativeNodeSource(node)?.entrypoints ?? [];
    if (entrypoints.some(entry => changedPaths.includes(entry.path)
      || entry.symbols.some(symbol => symbol.sinks.some(sink => changedPaths.includes(sink.path))))) touchedNodeIds.add(node.id);
  }
  const capabilityIds = [...new Set((repository ? model.nodes.map(node => node.id) : [...touchedNodeIds])
    .flatMap(id => capabilityByNodeId.has(id) ? [capabilityByNodeId.get(id)!] : []))].sort();
  const scopedNodeIds = model.nodes.filter(node => touchedNodeIds.has(node.id)
    || capabilityIds.includes(capabilityByNodeId.get(node.id) ?? "")).map(node => node.id);
  const unowned = new Set(owners.unownedPaths);
  const ownership: NonNullable<ArchitectureDebtEvidence["ownership"]> = [...owners.byPath].flatMap(([path, entry]) => {
    if (!entry.ambiguous && !unowned.has(path)) return [];
    return [{ path, nodeIds: entry.owners, capabilityIds: entry.owners.flatMap(id => capabilityByNodeId.has(id) ? [capabilityByNodeId.get(id)!] : []),
      status: entry.ambiguous ? "ambiguous" as const : "unowned" as const }];
  });
  // Ownership and citations use the same call-local model/file discovery. A new
  // invocation still reads both again, so edits and repairs are never cached.
  const anchors = runDocsAnchorsCommand(root, {}, { model, files });
  if (!anchors.ok) {
    const normalized = normalizeFailureResult(anchors, "debt", "docs.anchors") as JsonEnvelope;
    const failure = normalized.error!;
    throw new ArchitectureDebtReadError(failure.code, failure.message, failure.reasonCode!, failure.details, failure);
  }
  return { model, evidence: {
    scope: { kind: repository ? "repository" : "changed-paths", changedPaths, capabilityIds },
    ownership, anchors: anchors.data as unknown as DocsAnchorsReportV1, stateMachines: stateMachineEvidence(root, model, visible, repository ? undefined : changedPaths),
    scopedNodeIds, capabilityByNodeId
  } };
}

/**
 * The repository read checks every rule and anchor without the protection run. A changed-paths
 * read checks no rule and only the anchors on changed paths or with a callee on them: a rule
 * result depends only on the model, and a changed model file already widens the read to the
 * repository.
 */
function stateMachineEvidence(root: string, model: NativeModel, files: ReadonlySet<string>, changedPaths: string[] | undefined): NonNullable<ArchitectureDebtEvidence["stateMachines"]> {
  const machines = loadStateMachinesFromArchContext(root, model.nodes);
  const anchors = stateMachineAnchors(root, machines, { files, ...(changedPaths === undefined ? {} : { paths: new Set(changedPaths) }) });
  if (changedPaths === undefined) {
    return { machines: checkStateMachines(machines, { protection: false }).map((machine, index) => ({ ...machine, anchors: anchors[index]! })) };
  }
  return { machines: machines.flatMap((machine, index) => anchors[index]!.length === 0 ? []
    : [{ id: machine.id, capabilityId: machine.capabilityId, rules: [], breaks: [], anchors: anchors[index]! }]) };
}

export function runArchitectureDebtCommand(cwd: string, input: ArchitectureDebtReadInput & { complete?: boolean } = {}, codeFactsOptions: RepositoryCodeFactsInspectionOptions = {}): JsonEnvelope {
  let root: string;
  try { root = findRepositoryRoot(cwd); }
  catch { return failureEnvelope("debt", knownFailure("AC_REPO_NOT_FOUND", "git-worktree-required", { checks: ["ownership", "anchors"] })); }
  try {
    if (input.complete) {
      // SAFETY: Debt reports contain only JSON fields, including their coverage metadata.
      return okEnvelope("debt", readCompleteTaskArchitectureDebt(root) as unknown as Json);
    }
    // Checkpoint can report partial ownership/anchor debt without an index. A present but
    // incompatible index must be repaired, rather than treated as usable code facts.
    if (codeGraphIndexAvailable(root)) assertRepositoryCodeFactsReady(root, codeFactsOptions);
    return okEnvelope("debt", readArchitectureDebt(root, input) as unknown as Json);
  }
  catch (error) { return selectedProducerFailureEnvelope("debt", error, "debt"); }
}

export async function runArchitectureDebtDeltaCommand(cwd: string, ref: string, complete: boolean, signal?: AbortSignal): Promise<JsonEnvelope> {
  try {
    const root = readNativeGitRoot(cwd);
    const { commitSha: baseSha, treeOid } = resolveNativeGitSnapshot(root, ref);
    const { commitSha: headSha } = resolveNativeGitSnapshot(root, "HEAD");
    signal?.throwIfAborted();
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

async function readBaseDebt(root: string, cachePath: string, key: ArchitectureDebtBaseCacheKey, signal?: AbortSignal): Promise<ArchitectureDebtReportV1> {
  const store = new SqliteLocalStore(cachePath);
  try {
    const cached = existsSync(cachePath) ? await store.readArchitectureDebtBase(key) : undefined;
    if (cached !== undefined) return cached;
    signal?.throwIfAborted();
    const report = await withDetachedGitWorktree(root, key.baseSha, worktree => {
      signal?.throwIfAborted();
      seedCodeGraphIndexFromBase(worktree);
      return readDebtForDelta(worktree, key.measurementProfile);
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

function nodeCapabilities(model: NativeModel): Map<string, string> {
  const parents = new Map(model.nodes.map(node => [node.id, node.parent]));
  const capabilities = new Set(model.nodes.filter(node => node.kind === "capability").map(node => node.id));
  return new Map(model.nodes.flatMap(node => {
    const owner = [...ancestorChain(node.id, parents)].find(id => capabilities.has(id));
    return owner ? [[node.id, owner] as const] : [];
  }));
}

export class ArchitectureDebtReadError extends FailureError<ArchContextErrorCode> {
  constructor(code: ArchContextErrorCode, _message: string, reasonCode: string, details: unknown = { checks: ["ownership", "anchors"] }, attributes: Partial<StrictFailure> = {}) {
    super(code, reasonCode, details, attributes);
    this.name = "ArchitectureDebtReadError";
  }
}
