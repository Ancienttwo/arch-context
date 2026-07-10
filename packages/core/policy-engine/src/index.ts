import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { assertRepoRelativePath } from "@archcontext/core/architecture-domain";
import {
  ARCHITECTURE_CANDIDATE_DELTA_POLICY_SCHEMA_VERSION,
  architectureCandidateDeltaPolicyDecisionDigest,
  architectureCandidateDeltaPolicyEvaluationDigest,
  type ArchitectureCandidateChangeV1,
  type ArchitectureCandidateDeltaPolicyAction,
  type ArchitectureCandidateDeltaPolicyDecisionV1,
  type ArchitectureCandidateDeltaPolicyEvaluationV1,
  type ArchitectureCandidateDeltaPolicyReasonCode,
  type ArchitectureCandidateDeltaV1,
  type EvidenceItemV2
} from "@archcontext/contracts";

export interface CompatibilityContractInput {
  kind?: string;
  reason?: string;
  owner?: string;
  consumers?: string[];
  removalConditions?: string[];
  reviewAt?: string;
}

export interface PolicyFinding {
  id: string;
  type: string;
  severity: "notice" | "warning" | "error";
  message: string;
}

const INVALID_COMPAT_REASONS = new Set(["just in case", "safer to keep", "many internal callers", "large diff", "old code already exists"]);
const DEFAULT_CANDIDATE_DELTA_POLICY_VERSION = "architecture-candidate-delta-policy/v1";
const PLACEHOLDER_DIGEST = `sha256:${"0".repeat(64)}`;
const ALLOWLIST = [
  ".archcontext/model/",
  ".archcontext/policies/",
  ".archcontext/practices/",
  ".archcontext/waivers/",
  ".archcontext/decisions/",
  ".archcontext/backups/",
  ".archcontext/generated/",
  "docs/architecture/"
];

export function validateCompatibilityContract(contract?: CompatibilityContractInput): PolicyFinding[] {
  if (!contract) {
    return [{ id: "compatibility-contract-required", type: "unjustified-compatibility-path", severity: "error", message: "Compatibility code requires a contract." }];
  }
  const findings: PolicyFinding[] = [];
  if (!contract.kind || !["external-contract", "persisted-data-migration", "rolling-deployment", "temporary-feature-transition"].includes(contract.kind)) {
    findings.push({ id: "compatibility-kind", type: "invalid-compatibility-contract", severity: "error", message: "Compatibility kind must be a real contract type." });
  }
  if (!contract.reason || INVALID_COMPAT_REASONS.has(contract.reason.toLowerCase())) {
    findings.push({ id: "compatibility-reason", type: "unjustified-compatibility-path", severity: "error", message: "Compatibility reason is not a durable external or migration constraint." });
  }
  if (!contract.owner) findings.push({ id: "compatibility-owner", type: "invalid-compatibility-contract", severity: "error", message: "Compatibility owner is required." });
  if ((contract.consumers?.length ?? 0) === 0) findings.push({ id: "compatibility-consumers", type: "invalid-compatibility-contract", severity: "error", message: "Compatibility consumers are required." });
  if ((contract.removalConditions?.length ?? 0) === 0) findings.push({ id: "compatibility-removal", type: "invalid-compatibility-contract", severity: "error", message: "Removal conditions are required." });
  if (!contract.reviewAt) findings.push({ id: "compatibility-review", type: "invalid-compatibility-contract", severity: "error", message: "Review date is required." });
  return findings;
}

export interface ArchitectureCandidateDeltaPolicyInput {
  delta: ArchitectureCandidateDeltaV1;
  policyVersion?: string;
  evaluatedAt?: string;
}

export function evaluateArchitectureCandidateDeltaPolicy(input: ArchitectureCandidateDeltaPolicyInput): ArchitectureCandidateDeltaPolicyEvaluationV1 {
  const policyVersion = input.policyVersion ?? DEFAULT_CANDIDATE_DELTA_POLICY_VERSION;
  const decisions = input.delta.candidateChanges
    .map((change) => evaluateCandidateChange(input.delta, change))
    .sort((left, right) => left.candidateChangeId.localeCompare(right.candidateChangeId));
  const draft: ArchitectureCandidateDeltaPolicyEvaluationV1 = {
    schemaVersion: ARCHITECTURE_CANDIDATE_DELTA_POLICY_SCHEMA_VERSION,
    evaluationId: "candidate_delta_policy.pending",
    deltaId: input.delta.deltaId,
    repository: input.delta.repository,
    worktree: input.delta.worktree,
    deltaDigest: input.delta.deltaDigest,
    policyVersion,
    evaluatedAt: input.evaluatedAt ?? new Date().toISOString(),
    decisions,
    summary: summarizeCandidateDeltaPolicy(input.delta, decisions),
    evaluationDigest: PLACEHOLDER_DIGEST
  };
  const evaluationDigest = architectureCandidateDeltaPolicyEvaluationDigest(draft);
  return {
    ...draft,
    evaluationId: `candidate_delta_policy.${shortDigest(evaluationDigest)}`,
    evaluationDigest
  };
}

function evaluateCandidateChange(delta: ArchitectureCandidateDeltaV1, change: ArchitectureCandidateChangeV1): ArchitectureCandidateDeltaPolicyDecisionV1 {
  const reasonCodes = candidatePolicyReasonCodes(delta, change);
  const draft: ArchitectureCandidateDeltaPolicyDecisionV1 = {
    decisionId: `candidate_delta_policy_decision.${change.candidateChangeId.replace(/^candidate_change\./, "")}`,
    candidateChangeId: change.candidateChangeId,
    target: change.target,
    stateDimension: change.stateDimension,
    changeKind: change.changeKind,
    confidence: change.confidence,
    action: actionForCandidatePolicyReasons(reasonCodes),
    reasonCodes,
    evidenceIds: [...change.evidenceIds].sort(),
    digest: PLACEHOLDER_DIGEST
  };
  return {
    ...draft,
    digest: architectureCandidateDeltaPolicyDecisionDigest(draft)
  };
}

function candidatePolicyReasonCodes(
  delta: ArchitectureCandidateDeltaV1,
  change: ArchitectureCandidateChangeV1
): ArchitectureCandidateDeltaPolicyReasonCode[] {
  const evidenceById = new Map(delta.evidenceItems.map((item) => [item.evidenceId, item]));
  const evidence = change.evidenceIds.map((id) => evidenceById.get(id));
  const reasonCodes: ArchitectureCandidateDeltaPolicyReasonCode[] = [];
  const missingEvidence = change.evidenceIds.length === 0 || evidence.some((item) => item === undefined);
  if (missingEvidence) reasonCodes.push("missing-evidence");
  if (change.ambiguityIds.length > 0) reasonCodes.push("mapping-ambiguity");
  if (change.confidence === "low") reasonCodes.push("low-confidence");
  if (change.confidence === "medium") reasonCodes.push("medium-confidence");
  if (change.stateDimension === "migration-state") reasonCodes.push("migration-state-progress");
  if (change.stateDimension === "target-state" && change.changeKind === "removed") reasonCodes.push("target-state-removal");
  if (change.target.kind === "relation" && change.changeKind === "removed") reasonCodes.push("relation-removal");
  if (change.target.kind === "constraint" && change.changeKind === "removed") reasonCodes.push("constraint-relaxation");
  if (change.target.kind === "owner") reasonCodes.push("owner-authority-change");
  if (!missingEvidence && evidence.some((item) => item !== undefined && !isCompleteCheckpointEvidence(item))) {
    reasonCodes.push("partial-evidence");
  }
  if (reasonCodes.length === 0) reasonCodes.push("high-confidence-complete-evidence");
  return uniqueReasonCodes(reasonCodes);
}

function isCompleteCheckpointEvidence(evidence: EvidenceItemV2): boolean {
  return evidence.coverage.level === "complete" && evidence.supports.includes("checkpoint") && evidence.strength !== "heuristic";
}

function actionForCandidatePolicyReasons(reasonCodes: ArchitectureCandidateDeltaPolicyReasonCode[]): ArchitectureCandidateDeltaPolicyAction {
  if (
    reasonCodes.some((reasonCode) =>
      ["target-state-removal", "relation-removal", "constraint-relaxation", "owner-authority-change"].includes(reasonCode)
    )
  ) {
    return "require-human-approval";
  }
  if (reasonCodes.some((reasonCode) => ["missing-evidence", "mapping-ambiguity", "low-confidence"].includes(reasonCode))) {
    return "require-proof";
  }
  if (
    reasonCodes.some((reasonCode) =>
      ["medium-confidence", "partial-evidence", "migration-state-progress"].includes(reasonCode)
    )
  ) {
    return "require-checkpoint";
  }
  return "auto-accept";
}

function summarizeCandidateDeltaPolicy(
  delta: ArchitectureCandidateDeltaV1,
  decisions: ArchitectureCandidateDeltaPolicyDecisionV1[]
): ArchitectureCandidateDeltaPolicyEvaluationV1["summary"] {
  return {
    candidateChanges: delta.candidateChanges.length,
    autoAccept: decisions.filter((decision) => decision.action === "auto-accept").length,
    requireCheckpoint: decisions.filter((decision) => decision.action === "require-checkpoint").length,
    requireProof: decisions.filter((decision) => decision.action === "require-proof").length,
    requireHumanApproval: decisions.filter((decision) => decision.action === "require-human-approval").length,
    mappingAmbiguities: delta.mappingAmbiguities.length
  };
}

function uniqueReasonCodes(reasonCodes: ArchitectureCandidateDeltaPolicyReasonCode[]): ArchitectureCandidateDeltaPolicyReasonCode[] {
  return [...new Set(reasonCodes)];
}

function shortDigest(digest: string): string {
  return digest.replace(/^sha256:/, "").slice(0, 16);
}

export function assertAllowedArchContextPath(root: string, relativePath: string): void {
  assertRepoRelativePath(relativePath);
  const normalized = relativePath.endsWith("/") ? relativePath : relativePath;
  if (!ALLOWLIST.some((prefix) => normalized.startsWith(prefix))) {
    throw new Error(`Path is outside ArchContext write allowlist: ${relativePath}`);
  }
  const absoluteRoot = resolve(root);
  const absoluteTarget = resolve(root, relativePath);
  const targetFromRoot = relative(absoluteRoot, absoluteTarget);
  if (targetFromRoot === "" || targetFromRoot === ".." || targetFromRoot.startsWith(`..${sep}`) || isAbsolute(targetFromRoot)) {
    throw new Error(`Path escapes repository: ${relativePath}`);
  }
  if (!existsSync(absoluteRoot)) return;
  const canonicalRoot = realpathSync.native(absoluteRoot);
  let existingAncestor = absoluteTarget;
  while (!existsSync(existingAncestor)) {
    const parent = resolve(existingAncestor, "..");
    if (parent === existingAncestor) throw new Error(`Path has no existing repository ancestor: ${relativePath}`);
    existingAncestor = parent;
  }
  const canonicalAncestor = realpathSync.native(existingAncestor);
  const ancestorFromRoot = relative(canonicalRoot, canonicalAncestor);
  if (ancestorFromRoot === ".." || ancestorFromRoot.startsWith(`..${sep}`) || isAbsolute(ancestorFromRoot)) {
    throw new Error(`Path escapes repository through symlink: ${relativePath}`);
  }
}

export function evaluateChangeSetPaths(root: string, paths: string[]): PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  for (const path of paths) {
    try {
      assertAllowedArchContextPath(root, path);
    } catch (error) {
      findings.push({
        id: `path-denied:${path}`,
        type: "path-denied",
        severity: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return findings;
}
