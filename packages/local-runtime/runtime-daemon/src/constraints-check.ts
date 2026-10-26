import { FailureError, okEnvelope, type Json, type JsonEnvelope } from "@archcontext/contracts";
import { computeWorktreeDigest, readDependencyConstraints } from "@archcontext/core/architecture-domain";
import { loadNativeModelFromModelFiles } from "@archcontext/core/projection-engine";
import { findRepositoryRoot, listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { listModelFiles } from "@archcontext/local-runtime/model-store-yaml";
import { evaluateWorktreeDependencyConstraints } from "./refactor-scan";
import { selectedProducerFailureEnvelope } from "./producer-failure";

/** Uses Git-visible model authority and reads existing code facts without starting a runtime. */
export function runConstraintCheckCommand(cwd: string): JsonEnvelope {
  try {
    let root: string;
    try { root = findRepositoryRoot(cwd); }
    catch { throw new FailureError("AC_REPO_NOT_FOUND", "git-worktree-required"); }
    const modelFiles = listModelFiles(root);
    const declarations = readDependencyConstraints(modelFiles);
    if (declarations.errors.length) {
      throw new FailureError("AC_SCHEMA_INVALID", "constraint-model-invalid", { issueCount: declarations.errors.length });
    }
    const model = loadNativeModelFromModelFiles(new Map(modelFiles.map(file => [file.path, file.body])));
    const worktreeDigest = computeWorktreeDigest(root, listGitVisibleFiles(root));
    const result = evaluateWorktreeDependencyConstraints({ root, worktreeDigest, nodes: model.nodes, constraints: declarations.constraints });
    return okEnvelope("constraints.check", { ...result, warnings: declarations.warnings } as unknown as Json);
  } catch (error) {
    return selectedProducerFailureEnvelope("constraints.check", error, "cli");
  }
}
