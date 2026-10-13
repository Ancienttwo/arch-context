import { okEnvelope, type Json, type JsonEnvelope } from "@archcontext/contracts";
import { architectureDocumentationSourceTreeDigest, checkArchitectureFlowSelectors, loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { assertProjectionCodeFactsAvailable, prepareProjectionCodeFacts } from "@archcontext/local-runtime/codegraph-adapter";
import { findRepositoryRoot, listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { projectionFailureEnvelope } from "./projection-service";

/**
 * `archctx flows check`: the P2 flow proof of every capability and the proof status of every
 * declared selector, without rendering. It runs in-process like `projection run` in `check` mode:
 * no daemon, no local store, no runtime state, no task session, no ChangeSet. It takes the same
 * CodeGraph handshake as a projection (version, status, `codegraph sync`) and reads selector
 * evidence through the same producer, but skips the import-graph query and every renderer.
 */
export function runFlowSelectorCheckCommand(cwd: string, options: { binary?: string } = {}): JsonEnvelope {
  try {
    const root = findRepositoryRoot(cwd);
    const model = loadNativeModelFromArchContext(root);
    const sourceFiles = listGitVisibleFiles(root);
    const prepared = prepareProjectionCodeFacts(root, model, {
      sourceTreeDigest: architectureDocumentationSourceTreeDigest(root, model, sourceFiles),
      sourceFiles,
      importGraphs: false,
      ...(options.binary ? { binary: options.binary } : {})
    });
    assertProjectionCodeFactsAvailable(root, prepared);
    return okEnvelope("flows.check", checkArchitectureFlowSelectors({
      model,
      selectorEvidence: prepared.selectorEvidence,
      codeGraph: { availability: prepared.handshake.availability, version: prepared.handshake.actualVersion }
    }) as unknown as Json);
  } catch (error) {
    return projectionFailureEnvelope("flows.check", error);
  }
}
