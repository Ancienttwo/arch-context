import { FailureError, knownFailure, unclassifiedFailure } from "@archcontext/contracts";
import { publicFailureEnvelope, publicOperationErrorEnvelope, publicOperationFailure, publicOperationResult } from "./public-operation-failure";
import type { ArchContextErrorCode, CapabilityDependenciesV1 } from "@archcontext/contracts";
import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import { measureCapabilityDependencies } from "@archcontext/core/module-statistics";
import { loadNativeModelFromArchContext, type NativeModel } from "@archcontext/core/projection-engine";
import { CODEGRAPH_IMPORT_NODE_READ_LIMIT, repositoryImportPairs } from "@archcontext/local-runtime/codegraph-adapter";
import { readHeadSha, readTrackedTreeEntries, listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { declaredWorkspacePackages } from "./refactor-scan";

/** The CodeGraph CLI name the adapter resolves package-locally when PATH has no answer. */
const CODEGRAPH_BINARY = "codegraph";

export interface CapabilityDependenciesRequestV1 {
  from?: string;
  into?: string;
  importNodeLimit?: number;
  edgeLimit?: number;
}

export interface CapabilityDependenciesResultV1 extends CapabilityDependenciesV1 {
  worktree: { headSha: string; worktreeDigest: string };
  privacy: { writes: "none" };
}

export class CapabilityDependenciesError extends FailureError {
  constructor(code: ArchContextErrorCode, _message: string, reasonCode?: string) {
    const sourceReason = reasonCode ?? (code === "AC_SCHEMA_INVALID" ? "deps-input-invalid" : code === "AC_MODEL_ADOPTION_REQUIRED" ? "deps-model-unreadable" : code === "AC_CODE_FACTS_UNAVAILABLE" ? "code-facts-unavailable" : undefined);
    const failure = sourceReason === undefined ? unclassifiedFailure("public-operation") : knownFailure(code, sourceReason);
    super(failure.code, failure.reasonCode, failure.details, failure);
    this.name = "CapabilityDependenciesError";
  }
}

/**
 * The capability dependency matrix of the repository at `root`, for `archctx deps`.
 *
 * Read-only: it reads the model files, the `HEAD` tree and the CodeGraph index, and writes
 * nothing, so it needs no daemon and no runtime state. Ownership is resolved over the files the
 * `HEAD` tree carries, like `refactor scan`. Each cell says whether a model relation declares it.
 * An index that is missing, fails to answer or has pending changes is `AC_CODE_FACTS_UNAVAILABLE`,
 * never an empty matrix: an empty matrix would read as "no dependencies".
 */
export function readCapabilityDependencies(root: string, request: CapabilityDependenciesRequestV1 = {}): CapabilityDependenciesResultV1 {
  try { return readCapabilityDependenciesUnchecked(root, request); }
  catch (error) {
    let typed: CapabilityDependenciesError | undefined;
    try { if (error instanceof CapabilityDependenciesError) typed = error; } catch { /* Uninspectable throws remain unknown. */ }
    if (typed) throw typed;
    throw publicOperationFailure(error);
  }
}

function readCapabilityDependenciesUnchecked(root: string, request: CapabilityDependenciesRequestV1 = {}): CapabilityDependenciesResultV1 {
  const importNodeLimit = request.importNodeLimit ?? CODEGRAPH_IMPORT_NODE_READ_LIMIT;
  for (const [name, value] of [["importNodeLimit", request.importNodeLimit], ["edgeLimit", request.edgeLimit]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < (name === "edgeLimit" ? 0 : 1))) {
      throw new CapabilityDependenciesError("AC_SCHEMA_INVALID", `${name} must be a ${name === "edgeLimit" ? "non-negative" : "positive"} integer, got ${value}`, "deps-input-invalid");
    }
  }
  const model = loadModel(root);
  const nodeIds = new Set(model.nodes.map((node) => node.id));
  for (const [flag, nodeId] of [["--from", request.from], ["--into", request.into]] as const) {
    if (nodeId !== undefined && !nodeIds.has(nodeId)) {
      throw new CapabilityDependenciesError("AC_SCHEMA_INVALID", `deps ${flag} names no node in the model: ${nodeId}`, "deps-input-invalid");
    }
  }
  const headSha = readHeadSha(root);
  const worktreeDigest = computeWorktreeDigest(root, listGitVisibleFiles(root));
  const files = readTrackedTreeEntries(root).filter((entry) => entry.type === "blob").map((entry) => entry.path);
  const imports = readImports(root, importNodeLimit, worktreeDigest);
  const matrix = measureCapabilityDependencies({
    nodes: model.nodes,
    relations: model.relations,
    worktreeDigest,
    files,
    importEdges: imports.pairs,
    workspacePackages: readWorkspaces(root),
    truncated: imports.truncated,
    importNodeCount: imports.importNodeCount,
    importNodeLimit: imports.importNodeLimit,
    importNodeLimitExceeded: imports.importNodeLimitExceeded,
    codeFacts: { availability: imports.availability, indexedWorktreeDigest: imports.indexedWorktreeDigest },
    ...(request.from === undefined ? {} : { from: request.from }),
    ...(request.into === undefined ? {} : { into: request.into }),
    ...(request.edgeLimit === undefined ? {} : { edgeLimit: request.edgeLimit })
  });
  if (matrix.imports.coverage === "unknown") {
    // `repositoryImportPairs` reports a missing index and pending changes alike as unavailable, so
    // the one cause here is `code-facts-unavailable`.
    const [reasonCode] = matrix.imports.reasonCodes;
    throw new CapabilityDependenciesError(
      "AC_CODE_FACTS_UNAVAILABLE",
      `deps needs a CodeGraph index that attests to this worktree (${reasonCode}); run \`codegraph init\` or \`codegraph sync\` and retry`,
      reasonCode
    );
  }
  return { ...matrix, worktree: { headSha, worktreeDigest }, privacy: { writes: "none" } };
}

function readWorkspaces(root: string): ReturnType<typeof declaredWorkspacePackages> {
  try {
    return declaredWorkspacePackages(root);
  } catch (error) {
    throw new CapabilityDependenciesError(
      "AC_SCHEMA_INVALID",
      `workspace packages are unreadable: ${error instanceof Error ? error.message : String(error)}`,
      "deps-workspace-invalid"
    );
  }
}

function loadModel(root: string): NativeModel {
  try {
    return loadNativeModelFromArchContext(root);
  } catch (error) {
    throw new CapabilityDependenciesError(
      "AC_MODEL_ADOPTION_REQUIRED",
      `architecture model is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      "deps-model-unreadable"
    );
  }
}

/** A failed index read is the `unavailable` answer, never a guessed edge set. */
function readImports(root: string, limit: number, worktreeDigest: string): ReturnType<typeof repositoryImportPairs> {
  try {
    return repositoryImportPairs(root, CODEGRAPH_BINARY, limit, worktreeDigest);
  } catch {
    return {
      pairs: [],
      truncated: true,
      availability: "unavailable",
      indexedWorktreeDigest: null,
      importNodeCount: null,
      importNodeLimit: limit,
      importNodeLimitExceeded: false
    };
  }
}
