import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import { checkArchitectureFlowSelectors, loadCapabilitySourceFootprints, type NativeModel } from "@archcontext/core/projection-engine";
import type { ArchitectureDebtEvidence } from "@archcontext/core/review-engine";
import {
  inspectRepositoryCodeFacts, loadCapabilityCodeGraphProjectionInputs,
  type RepositoryCodeFactsV1
} from "@archcontext/local-runtime/codegraph-adapter";
import { listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { projectionArchitectureDebt } from "./projection-architecture-debt";

type CodeFactsDebtEvidence = Pick<ArchitectureDebtEvidence, "dependencies" | "flows" | "unavailable">;
type ReadOptions = Pick<NonNullable<Parameters<typeof loadCapabilityCodeGraphProjectionInputs>[2]>,
  "binary" | "selectorIndexFactory" | "importNodeLimit">;

/**
 * Full dependency/flow evidence for the completion consumer. Deliberately separate from the
 * edit-time reader: no sync, renderer, daemon or baseline writes, but repository-scale reads.
 * S2 owns readiness; an unavailable producer yields coverage gaps, never invented clean facts.
 */
export function readArchitectureDebtCodeFacts(root: string, model: NativeModel, options: ReadOptions = {}): CodeFactsDebtEvidence {
  const sourceFiles = listGitVisibleFiles(root);
  const worktreeDigest = computeWorktreeDigest(root, sourceFiles);
  const before = inspectRepositoryCodeFacts(root, { binary: options.binary });
  if (before.state !== "ready") return unavailable(inspectionReasons(before));
  let inputs: ReturnType<typeof loadCapabilityCodeGraphProjectionInputs>;
  try {
    inputs = loadCapabilityCodeGraphProjectionInputs(root, model, {
      ...options, readOnly: true,
      footprints: loadCapabilitySourceFootprints(root, model, sourceFiles)
    });
  } catch {
    // Read-only open/query refusal is observable. Never retry with a writable handle or sync.
    return unavailable(["codegraph-read-failed"]);
  }
  const after = inspectRepositoryCodeFacts(root, { binary: options.binary });
  if (after.state !== "ready") return unavailable(inspectionReasons(after));
  if (worktreeDigest !== computeWorktreeDigest(root, listGitVisibleFiles(root))) {
    return unavailable(["worktree-changed-during-read"]);
  }
  return {
    dependencies: projectionArchitectureDebt(model, {
      root, sourceFiles, population: inputs.importPopulation, codeGraphStatus: "ready", worktreeDigest
    }),
    flows: checkArchitectureFlowSelectors({
      model, selectorEvidence: inputs.selectorEvidence,
      codeGraph: { availability: "ready", version: after.codeGraphVersion }
    })
  };
}

function inspectionReasons(facts: RepositoryCodeFactsV1): string[] {
  if (facts.state === "unavailable") return [facts.reasonCode];
  return [...new Set([
    ...(facts.state === "index-missing" ? ["index-missing"] : []),
    ...facts.issues.map(issue => issue.code)
  ])].sort();
}

function unavailable(reasons: string[]): CodeFactsDebtEvidence {
  return { unavailable: { dependencies: reasons, flows: reasons } };
}
