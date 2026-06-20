import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CrossRepoRelation } from "@archcontext/architecture-domain";
import type { ObservedEvidence } from "@archcontext/contracts";

export interface ProjectionRebuilderPort {
  rebuildGeneratedProjection(root: string): void;
}

export function reconcileGeneratedProjection(root: string, projection: ProjectionRebuilderPort): { rebuilt: boolean; preservedHumanSections: boolean } {
  assertNoHumanEditableGeneratedSection(root);
  projection.rebuildGeneratedProjection(root);
  return { rebuilt: true, preservedHumanSections: true };
}

export function assertNoHumanEditableGeneratedSection(root: string): void {
  const path = resolve(root, ".archcontext/generated/ARCHITECTURE.md");
  try {
    const content = readFileSync(path, "utf8");
    if (content.includes("<!-- BEGIN HUMAN -->")) {
      throw new Error("Generated projection contains human-editable section; refusing overwrite");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("human-editable")) throw error;
  }
}

export function reconcileCrossRepoEvidence(input: {
  declared: CrossRepoRelation[];
  observed: ObservedEvidence[];
}) {
  const observedRepositories = new Set(input.observed.map((item) => item.snapshot.repositoryId));
  const verified = input.declared.filter(
    (relation) => observedRepositories.has(relation.source.repositoryId) && observedRepositories.has(relation.target.repositoryId)
  );
  const missingEvidence = input.declared.filter((relation) => !verified.includes(relation));
  return {
    declared: input.declared.length,
    observedRepositories: [...observedRepositories].sort(),
    verified: verified.map((relation) => relation.id).sort(),
    missingEvidence: missingEvidence.map((relation) => relation.id).sort()
  };
}
