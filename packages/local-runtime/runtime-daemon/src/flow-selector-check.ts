import { FailureError, okEnvelope, type Json, type JsonEnvelope } from "@archcontext/contracts";
import { architectureDocumentationSourceTreeDigest, checkArchitectureFlowSelectors, loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { assertProjectionCodeFactsAvailable, loadCapabilityCodeGraphProjectionInputs, prepareProjectionCodeFacts, REQUIRED_CODEGRAPH_VERSION, withExistingCodeGraphSnapshot } from "@archcontext/local-runtime/codegraph-adapter";
import { findRepositoryRoot, listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { selectedProducerFailureEnvelope } from "./producer-failure";

/**
 * `archctx flows check`: the P2 flow proof of every capability and the proof status of every
 * declared selector, without rendering. It runs in-process like `projection run` in `check` mode:
 * no daemon, no local store, no runtime state, no task session, no ChangeSet. It takes the same
 * CodeGraph handshake as a projection (version, status, `codegraph sync`) and reads selector
 * evidence through the same producer, but skips the import-graph query and every renderer.
 * `noSync` instead requires a ready existing index and reads it through a private snapshot.
 */
export function runFlowSelectorCheckCommand(cwd: string, options: { binary?: string; noSync?: boolean } = {}): JsonEnvelope {
  try {
    let root: string;
    try { root = findRepositoryRoot(cwd); }
    catch { throw new FailureError("AC_REPO_NOT_FOUND", "git-worktree-required"); }
    const model = loadNativeModelFromArchContext(root);
    if (options.noSync) {
      const selectorEvidence = withExistingCodeGraphSnapshot(root, graph => loadCapabilityCodeGraphProjectionInputs(root, model, {
        readOnly: true, importGraphs: false,
        // The snapshot boundary owns handle lifetime, including the post-read stability check.
        selectorIndexFactory: () => ({
          getNodesByName: name => graph.getNodesByName(name),
          getNodesInFile: path => graph.getNodesInFile(path),
          getNode: id => graph.getNode(id),
          getOutgoingEdges: id => graph.getOutgoingEdges(id),
          close: () => undefined
        })
      }).selectorEvidence, { binary: options.binary });
      return okEnvelope("flows.check", checkArchitectureFlowSelectors({
        model, selectorEvidence, codeGraph: { availability: "ready", version: REQUIRED_CODEGRAPH_VERSION }
      }) as unknown as Json);
    }
    const sourceFiles = listGitVisibleFiles(root);
    const prepared = prepareProjectionCodeFacts(root, model, {
      sourceTreeDigest: architectureDocumentationSourceTreeDigest(root, model, sourceFiles),
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
    return selectedProducerFailureEnvelope("flows.check", error, "flows-check");
  }
}
