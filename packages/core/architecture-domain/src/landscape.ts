import { canonicalize, digestJson, stableYaml, type Json } from "@archcontext/contracts";
import { dedupeStrings, normalizeDottedId, type GitTrackedTreeEntry } from "./worktree-digest";
import { assertObject, parseJsonOrStableYaml } from "./yaml-codec";

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

export const ARCHITECTURE_DIRECTION_VIOLATION_KINDS = [
  "boundary-violation",
  "cross-boundary-import",
  "cross-boundary-import-added",
  "declared-layer-violation",
  "declared-layer-violation-observed",
  "dependency-direction-violation",
  "layer-violation"
] as const;

export type ArchitectureDirectionViolationKind = typeof ARCHITECTURE_DIRECTION_VIOLATION_KINDS[number];

export interface ArchitectureDirectionViolationSubject {
  kind: ArchitectureDirectionViolationKind;
  subject: string;
  source: string;
  target?: string;
}

export const ARCHITECTURE_DIRECTION_VIOLATION_PREFIXES = ARCHITECTURE_DIRECTION_VIOLATION_KINDS.map((kind) => `${kind}:`);

export function parseArchitectureDirectionViolationSubject(subject: string): ArchitectureDirectionViolationSubject | undefined {
  const prefix = ARCHITECTURE_DIRECTION_VIOLATION_PREFIXES.find((candidate) => subject.startsWith(candidate));
  if (!prefix) return undefined;
  const body = subject.slice(prefix.length).trim();
  if (!body) return undefined;
  const kind = prefix.slice(0, -1) as ArchitectureDirectionViolationKind;
  const separator = body.indexOf("->");
  if (separator < 0) return { kind, subject: body, source: body };

  const source = body.slice(0, separator).trim();
  const target = body.slice(separator + 2).trim();
  if (!source || !target || target.includes("->")) return undefined;
  return { kind, subject: body, source, target };
}

export function isArchitectureDirectionViolationSubject(subject: string): boolean {
  return parseArchitectureDirectionViolationSubject(subject) !== undefined;
}

export function isArchitectureDirectionalEdgeViolationSubject(subject: string): boolean {
  return parseArchitectureDirectionViolationSubject(subject)?.target !== undefined;
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

export function canonicalArchitectureJson(value: Json): Json {
  return JSON.parse(canonicalize(value)) as Json;
}

export function canonicalArchitectureYaml(value: Json): string {
  return stableYaml(canonicalArchitectureJson(value));
}

export function parseLandscapeFile(body: string, path = LANDSCAPE_FILE): Landscape {
  const value = parseJsonOrStableYaml(body, path);
  assertObject(value, path);
  if (value.schemaVersion !== "archcontext.landscape/v1") {
    throw new Error(`${path}: expected archcontext.landscape/v1`);
  }
  return value as unknown as Landscape;
}

export function parseCrossRepoRelationFile(body: string, path: string): CrossRepoRelation {
  const value = parseJsonOrStableYaml(body, path);
  assertObject(value, path);
  if (value.schemaVersion !== "archcontext.cross-repo-relation/v1") {
    throw new Error(`${path}: expected archcontext.cross-repo-relation/v1`);
  }
  return value as unknown as CrossRepoRelation;
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

function dedupeRepositories(repositories: RepositoryRegistration[]): RepositoryRegistration[] {
  return [...new Map(repositories.map((repo) => [repo.repositoryId, repo])).values()].sort((a, b) =>
    a.repositoryId.localeCompare(b.repositoryId)
  );
}
