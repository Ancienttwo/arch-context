import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { assertRepoRelativePath } from "@archcontext/core/architecture-domain";
import {
  REFACTOR_DECISION_FILE_PATTERN
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

/**
 * Per-ChangeSet widening of the write allowlist, supplied by the caller that owns the operation.
 *
 * The base `ALLOWLIST` is unconditional and unchanged. The agent-context projection reaches
 * outside it — ADR-0043 puts a capability's contract file inside that
 * capability's own source directory — so instead of loosening the allowlist by file name (which
 * would put every `CLAUDE.md` anywhere in the repository on the write surface forever), the caller
 * passes the exact path set it derived from the model for this operation, and only that set is
 * widened, only for `render_agent_context` operations. The manifest scope grants exactly
 * `.archcontext/manifest.yaml`; ChangeSetEngine restricts it to the typed field-update operation.
 * The refactor-decision scope grants exactly `.archcontext/refactor-decisions/<recommendationId>.json`
 * and only to the daemon-built `write_refactor_decision` operation (ADR-0046); that directory is
 * never on the default allowlist.
 */
export interface ArchContextPathScope {
  operation: "default" | "agent-context" | "manifest" | "adr-reference" | "refactor-decision";
  /** The exact repo-relative paths the model's agent-context derivation produced. */
  agentContextPaths: ReadonlySet<string>;
}

/**
 * Re-asserted here rather than imported from the projection engine: this is a write boundary, so it
 * must hold even if the derivation that produced the path set is wrong. A scoped path still has to
 * be an agent-context contract file. Root contracts additionally require canonical marker-only
 * validation and an existing-file hash in ChangeSetEngine; generic writes remain forbidden.
 */
const AGENT_CONTEXT_FILE_NAMES = new Set(["CLAUDE.md", "AGENTS.md"]);

function isAgentContextScopedPath(relativePath: string, scope?: ArchContextPathScope): boolean {
  if (!scope || scope.operation !== "agent-context") return false;
  if (!scope.agentContextPaths.has(relativePath)) return false;
  const lastSlash = relativePath.lastIndexOf("/");
  if (lastSlash < 0) return AGENT_CONTEXT_FILE_NAMES.has(relativePath);
  if (lastSlash === 0) return false;
  return AGENT_CONTEXT_FILE_NAMES.has(relativePath.slice(lastSlash + 1));
}

export function assertAllowedArchContextPath(root: string, relativePath: string, scope?: ArchContextPathScope): void {
  assertRepoRelativePath(relativePath);
  const normalized = relativePath.endsWith("/") ? relativePath : relativePath;
  if (!ALLOWLIST.some((prefix) => normalized.startsWith(prefix)) && !isAgentContextScopedPath(relativePath, scope)
      && !(scope?.operation === "manifest" && relativePath === ".archcontext/manifest.yaml")
      && !(scope?.operation === "adr-reference" && /^docs\/adr\/ADR-[0-9]{4}-[a-z0-9][a-z0-9-]*\.md$/.test(relativePath))
      && !(scope?.operation === "refactor-decision" && REFACTOR_DECISION_FILE_PATTERN.test(relativePath))) {
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

export function evaluateChangeSetPaths(root: string, paths: string[], scope?: ArchContextPathScope): PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  for (const path of paths) {
    try {
      assertAllowedArchContextPath(root, path, scope);
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
