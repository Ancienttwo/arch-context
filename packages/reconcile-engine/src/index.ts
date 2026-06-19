import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rebuildGeneratedProjection } from "../../model-store-yaml/src/index";

export function reconcileGeneratedProjection(root: string): { rebuilt: boolean; preservedHumanSections: boolean } {
  assertNoHumanEditableGeneratedSection(root);
  rebuildGeneratedProjection(root);
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
