import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { digestJson, isRepoRelativePosixPath, stableId, stableYaml, type Json } from "@archcontext/contracts";

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

function parseJsonOrStableYaml(body: string, path: string): Json {
  const trimmed = body.trim();
  if (!trimmed) throw new Error(`${path}: empty model file`);
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed) as Json;
  return new StableYamlParser(body, path).parse();
}

function assertObject(value: Json, path: string): asserts value is { [key: string]: Json } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path}: expected object`);
  }
}

class StableYamlParser {
  private readonly lines: { indent: number; text: string }[];
  private index = 0;

  constructor(body: string, private readonly path: string) {
    this.lines = body
      .split(/\r?\n/)
      .map((line) => ({ indent: line.match(/^ */)?.[0].length ?? 0, text: line.trimEnd() }))
      .filter((line) => line.text.trim().length > 0);
  }

  parse(): Json {
    const value = this.parseBlock(this.lines[0]?.indent ?? 0);
    if (this.index !== this.lines.length) throw new Error(`${this.path}: unexpected trailing YAML`);
    return value;
  }

  private parseBlock(indent: number): Json {
    const current = this.lines[this.index];
    if (!current || current.indent < indent) return {};
    if (current.indent !== indent) throw new Error(`${this.path}: invalid indentation`);
    return current.text.trimStart().startsWith("- ") ? this.parseArray(indent) : this.parseObject(indent);
  }

  private parseArray(indent: number): Json[] {
    const values: Json[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (!line || line.indent !== indent || !line.text.trimStart().startsWith("- ")) break;
      const item = line.text.trimStart().slice(2).trim();
      this.index += 1;
      if (!item) {
        values.push(this.parseBlock(indent + 2));
        continue;
      }
      if (this.isKeyValue(item)) {
        values.push(this.parseObject(indent + 2, item));
        continue;
      }
      values.push(parseScalar(item));
    }
    return values;
  }

  private parseObject(indent: number, firstEntry?: string): Json {
    const object: Record<string, Json> = {};
    if (firstEntry) this.assignEntry(object, firstEntry, indent);
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (!line || line.indent !== indent || line.text.trimStart().startsWith("- ")) break;
      this.index += 1;
      this.assignEntry(object, line.text.trimStart(), indent);
    }
    return object;
  }

  private assignEntry(object: Record<string, Json>, entry: string, indent: number): void {
    const separator = entry.indexOf(":");
    if (separator <= 0) throw new Error(`${this.path}: expected key/value entry`);
    const key = entry.slice(0, separator).trim();
    const rest = entry.slice(separator + 1).trim();
    object[key] = rest ? parseScalar(rest) : this.parseBlock(indent + 2);
  }

  private isKeyValue(value: string): boolean {
    return /^[A-Za-z0-9_-]+:/.test(value);
  }
}

function parseScalar(value: string): Json {
  if (value === "[]") return [];
  if (value === "{}") return {};
  return JSON.parse(value) as Json;
}
