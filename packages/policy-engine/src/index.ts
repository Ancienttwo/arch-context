import { isAbsolute, relative, resolve, sep } from "node:path";
import { assertRepoRelativePath } from "../../architecture-domain/src/index";

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
const ALLOWLIST = [
  ".archcontext/model/",
  ".archcontext/policies/",
  ".archcontext/decisions/",
  ".archcontext/generated/"
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
