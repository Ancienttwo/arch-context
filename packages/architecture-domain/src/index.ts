import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { digestJson, isRepoRelativePosixPath, stableId, stableYaml, type Json } from "../../contracts/src/index";

export interface RepositoryBinding {
  repositoryId: string;
  root: string;
  headSha: string;
  worktreeDigest: string;
}

export interface RepositoryRegistration {
  repositoryId: string;
  numericRepositoryId: number;
  name: string;
  role: string;
  root?: string;
  owner?: string;
  defaultBranch?: string;
}

export interface CrossRepoEndpoint {
  repositoryId: string;
  nodeId: string;
}

export interface CrossRepoRelation {
  schemaVersion: "archcontext.cross-repo-relation/v1";
  id: string;
  kind: "depends-on" | "calls" | "publishes" | "subscribes" | "implements";
  source: CrossRepoEndpoint;
  target: CrossRepoEndpoint;
  via: { kind: "interface" | "event"; id: string };
  synchrony?: "synchronous" | "asynchronous" | "batch";
  intent: string;
  owner?: string;
  allowedData?: string[];
  forbiddenData?: string[];
  criticality?: "low" | "medium" | "high" | "critical";
  extensions?: Record<string, Json>;
}

export interface Landscape {
  schemaVersion: "archcontext.landscape/v1";
  id: string;
  name: string;
  repositories: RepositoryRegistration[];
  relations: string[];
  ownership?: Record<string, string[]>;
  scope?: {
    defaultActiveRepositories?: string[];
    maxActiveRepositories?: number;
  };
  syncPolicy: {
    mode: "git-worktree-only";
    archcontextSyncService: "forbidden";
  };
  extensions?: Record<string, Json>;
}

export interface LandscapeValidation {
  valid: boolean;
  errors: string[];
}

export const LANDSCAPE_FILE = ".archcontext/landscape.yaml";

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

export const ADAPTER_PROTECTED_NATIVE_FIELDS = ["evidence", "verification", "constraint", "intervention"] as const;

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

export function normalizeDottedId(value: string): string {
  return value
    .split(".")
    .map((part) => stableId(part))
    .filter(Boolean)
    .join(".");
}

export function repoScopedArchitectureId(repositoryId: string, nodeId: string): string {
  return `${normalizeDottedId(repositoryId)}::${normalizeDottedId(nodeId)}`;
}

export function parseRepoScopedArchitectureId(value: string): CrossRepoEndpoint {
  const [repositoryId, nodeId] = value.split("::");
  if (!repositoryId || !nodeId || value.split("::").length !== 2) {
    throw new Error(`Expected repo-scoped architecture id: ${value}`);
  }
  return { repositoryId, nodeId };
}

export function createLandscape(input: {
  id: string;
  name: string;
  repositories: RepositoryRegistration[];
  relations?: CrossRepoRelation[];
  maxActiveRepositories?: number;
}): Landscape {
  return {
    schemaVersion: "archcontext.landscape/v1",
    id: normalizeDottedId(input.id).startsWith("landscape.") ? normalizeDottedId(input.id) : `landscape.${normalizeDottedId(input.id)}`,
    name: input.name,
    repositories: dedupeRepositories(input.repositories),
    relations: (input.relations ?? []).map((relation) => relation.id).sort(),
    scope: {
      defaultActiveRepositories: input.repositories.slice(0, input.maxActiveRepositories ?? 3).map((repo) => repo.repositoryId),
      maxActiveRepositories: input.maxActiveRepositories ?? 3
    },
    syncPolicy: {
      mode: "git-worktree-only",
      archcontextSyncService: "forbidden"
    }
  };
}

export function validateLandscape(landscape: Landscape, relations: CrossRepoRelation[] = []): LandscapeValidation {
  const errors: string[] = [];
  const repositories = new Map<string, RepositoryRegistration>();
  const numericIds = new Set<number>();
  for (const repo of landscape.repositories) {
    if (repositories.has(repo.repositoryId)) errors.push(`duplicate repositoryId: ${repo.repositoryId}`);
    repositories.set(repo.repositoryId, repo);
    if (numericIds.has(repo.numericRepositoryId)) errors.push(`duplicate numericRepositoryId: ${repo.numericRepositoryId}`);
    numericIds.add(repo.numericRepositoryId);
  }
  if (landscape.syncPolicy.mode !== "git-worktree-only" || landscape.syncPolicy.archcontextSyncService !== "forbidden") {
    errors.push("landscape sync must be delegated to Git/worktree only");
  }
  for (const relation of relations) {
    if (!repositories.has(relation.source.repositoryId)) errors.push(`unknown source repository: ${relation.source.repositoryId}`);
    if (!repositories.has(relation.target.repositoryId)) errors.push(`unknown target repository: ${relation.target.repositoryId}`);
    if (relation.source.repositoryId === relation.target.repositoryId) errors.push(`cross-repo relation is intra-repo: ${relation.id}`);
  }
  for (const repoId of landscape.scope?.defaultActiveRepositories ?? []) {
    if (!repositories.has(repoId)) errors.push(`unknown default active repository: ${repoId}`);
  }
  return { valid: errors.length === 0, errors };
}

export function addRepositoryToLandscape(landscape: Landscape, repository: RepositoryRegistration): Landscape {
  return {
    ...landscape,
    repositories: dedupeRepositories([...landscape.repositories, repository]),
    scope: {
      ...landscape.scope,
      defaultActiveRepositories: dedupeStrings([...(landscape.scope?.defaultActiveRepositories ?? []), repository.repositoryId]).slice(
        0,
        landscape.scope?.maxActiveRepositories ?? 3
      )
    }
  };
}

export function addCrossRepoRelation(landscape: Landscape, relation: CrossRepoRelation): Landscape {
  return {
    ...landscape,
    relations: dedupeStrings([...landscape.relations, relation.id]).sort()
  };
}

export function crossRepoImpact(relations: CrossRepoRelation[], changedRepositoryId: string): CrossRepoRelation[] {
  return relations
    .filter((relation) => relation.source.repositoryId === changedRepositoryId || relation.target.repositoryId === changedRepositoryId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function activeRepositoriesForTask(landscape: Landscape, task: string): RepositoryRegistration[] {
  const max = landscape.scope?.maxActiveRepositories ?? 3;
  const taskText = task.toLowerCase();
  const explicit = landscape.repositories.filter((repo) => taskText.includes(repo.name.toLowerCase()) || taskText.includes(repo.repositoryId.toLowerCase()));
  const defaults = new Set(landscape.scope?.defaultActiveRepositories ?? []);
  const fallback = landscape.repositories.filter((repo) => defaults.has(repo.repositoryId));
  const selected = dedupeRepositories([...explicit, ...fallback, ...landscape.repositories]);
  return selected.slice(0, max);
}

export function landscapeDigest(landscape: Landscape, relations: CrossRepoRelation[] = []): string {
  return digestJson({ landscape, relations } as unknown as Json);
}

export function landscapeYaml(landscape: Landscape): string {
  return stableYaml(landscape as unknown as Json);
}

export function summarizeLandscapeForSaas(landscape: Landscape): { repositoryIds: number[] } {
  return {
    repositoryIds: landscape.repositories.map((repo) => repo.numericRepositoryId).sort((a, b) => a - b)
  };
}

export function stripAdapterProtectedNativeFields<T extends Record<string, Json | undefined>>(value: T): { clean: T; removedFields: string[] } {
  const clean = { ...value };
  const removedFields: string[] = [];
  for (const field of ADAPTER_PROTECTED_NATIVE_FIELDS) {
    if (field in clean) {
      delete clean[field];
      removedFields.push(field);
    }
  }
  return { clean, removedFields };
}

export function assertAdapterDoesNotOverwriteNativeCore(before: Record<string, Json>, after: Record<string, Json>): void {
  for (const field of ADAPTER_PROTECTED_NATIVE_FIELDS) {
    if (field in before && JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      throw new Error(`Adapter cannot overwrite Native source-of-truth field: ${field}`);
    }
  }
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

function dedupeRepositories(repositories: RepositoryRegistration[]): RepositoryRegistration[] {
  return [...new Map(repositories.map((repo) => [repo.repositoryId, repo])).values()].sort((a, b) =>
    a.repositoryId.localeCompare(b.repositoryId)
  );
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}
