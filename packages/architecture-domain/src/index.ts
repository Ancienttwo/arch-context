import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { digestJson, isRepoRelativePosixPath, type Json } from "../../contracts/src/index";

export interface RepositoryBinding {
  repositoryId: string;
  root: string;
  headSha: string;
  worktreeDigest: string;
}

export type ArchitecturePosture = "normal" | "structural" | "intervention" | "proof-required";

export interface TargetState {
  owners: Record<string, string>;
  requiredRelations: string[];
  removedConcepts: string[];
}

export interface MigrationState {
  active: boolean;
  compatibilityContracts: string[];
  cleanupBy?: string;
  temporaryRelations: string[];
}

export interface KillListItem {
  id: string;
  target: string;
  required: boolean;
  completed?: boolean;
}

export interface ProofPoint {
  description: string;
  successCriteria: string[];
  falsifiers: string[];
}

export interface BenefitLedger {
  benefits: string[];
  costs: string[];
  rollbackPoint: string;
}

export interface ConstraintClassification {
  real: string[];
  inherited: string[];
}

export interface ArchitectureInterventionModel {
  id: string;
  status: "proposed" | "approved" | "in-progress" | "complete" | "rejected";
  thesis: string;
  targetState: TargetState;
  migrationState: MigrationState;
  constraints: ConstraintClassification;
  proofPoint?: ProofPoint;
  killList: KillListItem[];
  benefitLedger: BenefitLedger;
}

export function createInterventionId(task: string): string {
  return `intervention.${task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "architecture-change"}`;
}

export interface WorktreeDigestOptions {
  ignore?: string[];
}

const DEFAULT_IGNORES = new Set([
  ".git",
  ".codegraph",
  "node_modules",
  "coverage",
  "artifacts",
  "_ops",
  "_ref",
  ".DS_Store"
]);

export function repositoryFingerprint(root: string): string {
  const normalized = resolve(root);
  return `repo.${createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`;
}

export function computeWorktreeDigest(root: string, options: WorktreeDigestOptions = {}): string {
  const ignore = new Set([...DEFAULT_IGNORES, ...(options.ignore ?? [])]);
  const files = listRepoFiles(root, ignore);
  const payload: Json = files.map((path) => {
    const absolute = resolve(root, path);
    return {
      path,
      size: statSync(absolute).size,
      digest: createHash("sha256").update(readFileSync(absolute)).digest("hex")
    };
  });
  return digestJson(payload);
}

export function bindRepository(root: string, headSha: string): RepositoryBinding {
  return {
    repositoryId: repositoryFingerprint(root),
    root: resolve(root),
    headSha,
    worktreeDigest: computeWorktreeDigest(root)
  };
}

export function assertRepoRelativePath(path: string): void {
  if (!isRepoRelativePosixPath(path)) {
    throw new Error(`Repository path must be relative POSIX path: ${path}`);
  }
}

export function listRepoFiles(root: string, ignore: Set<string> = DEFAULT_IGNORES): string[] {
  const out: string[] = [];
  walk(resolve(root));
  return out.sort();

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (ignore.has(entry.name)) continue;
      const absolute = resolve(dir, entry.name);
      const rel = relative(root, absolute).split(sep).join("/");
      if (!rel || ignore.has(rel.split("/")[0])) continue;
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      out.push(rel);
    }
  }
}
