import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CrossRepoRelation } from "@archcontext/core/architecture-domain";
import type { ArchitectureLedgerDriftReport, ArchitectureLedgerProjectionDiff } from "../../architecture-ledger/src/index";
import type { ObservedEvidence } from "@archcontext/contracts";

export interface ProjectionRebuilderPort {
  rebuildGeneratedProjection(root: string): void;
}

export type ArchitectureLedgerReconcileDirection = "ledger-to-git-projection" | "git-to-ledger-state";
export type ArchitectureLedgerReconcileStatus = "clean" | "drift";
export type ArchitectureLedgerReconcileActionKind = "fix-unsupported-yaml" | "rebuild-ledger-from-git" | "project-ledger-to-git";
export type ArchitectureLedgerReconcileAuthority = "manual" | "git-yaml" | "ledger";

export interface ArchitectureLedgerReconcileAction {
  kind: ArchitectureLedgerReconcileActionKind;
  authority: ArchitectureLedgerReconcileAuthority;
  reasonCodes: string[];
  description: string;
  command?: string;
}

export interface ArchitectureLedgerProjectionReconcileDirection {
  direction: "ledger-to-git-projection";
  ok: boolean;
  status: ArchitectureLedgerReconcileStatus;
  sourceGraphDigest: string;
  expectedProjectionDigest: string;
  reasonCodes: string[];
  diffCount: number;
  projectionDiffs: ArchitectureLedgerProjectionDiff[];
}

export interface ArchitectureLedgerSemanticReconcileDirection {
  direction: "git-to-ledger-state";
  ok: boolean;
  status: ArchitectureLedgerReconcileStatus;
  sourceGraphDigest: string;
  targetGraphDigest: string;
  reasonCodes: string[];
  unsupportedFileCount: number;
}

export interface ArchitectureLedgerReconcileReport {
  schemaVersion: "archcontext.architecture-ledger-reconcile/v1";
  ok: boolean;
  reconcileRequired: boolean;
  reasonCodes: string[];
  ledgerToGit: ArchitectureLedgerProjectionReconcileDirection;
  gitToLedger: ArchitectureLedgerSemanticReconcileDirection;
  reconcileActions: ArchitectureLedgerReconcileAction[];
}

export function reconcileGeneratedProjection(root: string, projection: ProjectionRebuilderPort): { rebuilt: boolean; preservedHumanSections: boolean } {
  assertNoHumanEditableGeneratedSection(root);
  projection.rebuildGeneratedProjection(root);
  return { rebuilt: true, preservedHumanSections: true };
}

export function reconcileArchitectureLedgerDrift(input: {
  drift: ArchitectureLedgerDriftReport;
  projectToGitCommand?: string;
  rebuildFromGitCommand?: string;
}): ArchitectureLedgerReconcileReport {
  const projectionDiffs = input.drift.projectionDiffs ?? [];
  const projectionReasonCodes = uniqueSorted(projectionDiffs.map((diff) => diff.reasonCode));
  const gitReasonCodes = uniqueSorted([
    ...(input.drift.semanticDrift ? ["semantic-drift"] : []),
    ...(input.drift.unsupportedFiles.length > 0 ? ["unsupported-yaml-file"] : [])
  ]);
  const ledgerToGitOk = projectionReasonCodes.length === 0;
  const gitToLedgerOk = gitReasonCodes.length === 0;
  const reasonCodes = uniqueSorted([...input.drift.reasonCodes, ...projectionReasonCodes, ...gitReasonCodes]);
  const reconcileActions: ArchitectureLedgerReconcileAction[] = [];
  if (input.drift.unsupportedFiles.length > 0) {
    reconcileActions.push({
      kind: "fix-unsupported-yaml",
      authority: "manual",
      reasonCodes: ["unsupported-yaml-file"],
      description: "Fix unsupported .archcontext YAML before accepting Git YAML as ledger input."
    });
  }
  if (input.drift.semanticDrift) {
    reconcileActions.push({
      kind: "rebuild-ledger-from-git",
      authority: "git-yaml",
      reasonCodes: ["semantic-drift"],
      description: "Accept Git-tracked YAML as the ledger source of truth.",
      command: input.rebuildFromGitCommand ?? "archctx ledger rebuild --from-git --expected-worktree-digest <current>"
    });
  }
  if (!ledgerToGitOk) {
    reconcileActions.push({
      kind: "project-ledger-to-git",
      authority: "ledger",
      reasonCodes: projectionReasonCodes,
      description: "Project the current ledger state back to Git-tracked YAML.",
      command: input.projectToGitCommand ?? "archctx ledger project --to-git --write --expected-worktree-digest <current>"
    });
  }
  const ok = input.drift.ok && ledgerToGitOk && gitToLedgerOk;
  return {
    schemaVersion: "archcontext.architecture-ledger-reconcile/v1",
    ok,
    reconcileRequired: !ok,
    reasonCodes,
    ledgerToGit: {
      direction: "ledger-to-git-projection",
      ok: ledgerToGitOk,
      status: ledgerToGitOk ? "clean" : "drift",
      sourceGraphDigest: input.drift.sourceGraphDigest,
      expectedProjectionDigest: input.drift.projectionDigest,
      reasonCodes: projectionReasonCodes,
      diffCount: projectionDiffs.length,
      projectionDiffs
    },
    gitToLedger: {
      direction: "git-to-ledger-state",
      ok: gitToLedgerOk,
      status: gitToLedgerOk ? "clean" : "drift",
      sourceGraphDigest: input.drift.projectedGraphDigest,
      targetGraphDigest: input.drift.sourceGraphDigest,
      reasonCodes: gitReasonCodes,
      unsupportedFileCount: input.drift.unsupportedFiles.length
    },
    reconcileActions
  };
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

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}
