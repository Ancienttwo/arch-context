import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import {
  REVIEW_FAIL_ON_CATEGORIES,
  orderedLayerIssues,
  canonicalize,
  digestJson,
  isRepoRelativePosixPath,
  stableId,
  stableYaml,
  type DependencyConstraintV1,
  type Json,
  type ReviewFailOnCategory,
  type ReviewPolicyV1
} from "@archcontext/contracts";

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

export interface GitTrackedTreeEntry {
  mode: string;
  type: "blob" | "tree" | "commit";
  objectId: string;
  path: string;
}

export interface ReviewWorktreeDigestInput {
  repositoryNumericId: number;
  headSha: string;
  headTreeOid: string;
  trackedTree: GitTrackedTreeEntry[];
  sparseScope?: string[];
}

const DEFAULT_IGNORES = new Set([
  ".git",
  ".codegraph",
  "node_modules",
  "coverage",
  "artifacts",
  "_ops",
  "_ref",
  ".archcontext/.local",
  ".claude/.session-id",
  ".claude/.trace.jsonl",
  ".DS_Store"
]);

export function repositoryFingerprint(root: string): string {
  const normalized = canonicalRepositoryRoot(root);
  return `repo.${createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`;
}

export function canonicalRepositoryRoot(root: string): string {
  const resolved = resolve(root);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export function normalizeDottedId(value: string): string {
  return value
    .split(".")
    .map((part) => stableId(part))
    .filter(Boolean)
    .join(".");
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

/**
 * Digest of the worktree files a precondition binds. `files` is the repository's Git-visible
 * universe (tracked plus untracked, non-ignored regular files), listed by the local runtime's Git
 * adapter (`listGitVisibleFiles`); core never walks the filesystem for it, so a gitignored tree — a
 * nested `node_modules`, build output, a desktop worktree — can never move the digest. The fixed
 * ignores and `options.ignore` exclude further paths from that universe. A tracked file deleted
 * locally is absent from the listing, so the deletion still changes the digest.
 */
export function computeWorktreeDigest(root: string, files: readonly string[], options: WorktreeDigestOptions = {}): string {
  // An untyped caller that omits the listing must fail, never digest an empty universe.
  if (!Array.isArray(files)) throw new TypeError("computeWorktreeDigest requires the Git-visible file list");
  // Hook output changes between preview and apply; harness policy remains part of the binding.
  const ignore = [
    ...DEFAULT_IGNORES,
    ".ai/harness/checks",
    ".ai/harness/evidence",
    ".ai/harness/runs",
    ...(options.ignore ?? [])
  ];
  const payload: Json = [...new Set(files)]
    .filter((path) => !ignore.some((pattern) => path === pattern || path.startsWith(`${pattern}/`)))
    .sort()
    .map((path) => {
      const absolute = resolve(root, path);
      return {
        path,
        size: statSync(absolute).size,
        digest: createHash("sha256").update(readFileSync(absolute)).digest("hex")
      };
    });
  return digestJson(payload);
}

export function computeReviewWorktreeDigest(input: ReviewWorktreeDigestInput): string {
  const trackedTree = input.trackedTree
    .map((entry) => ({
      mode: entry.mode,
      type: entry.type,
      objectId: entry.objectId,
      path: entry.path
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return digestJson({
    schemaVersion: "archcontext.review-worktree-digest/v1",
    repositoryNumericId: input.repositoryNumericId,
    headSha: input.headSha,
    headTreeOid: input.headTreeOid,
    sparseScope: [...(input.sparseScope ?? [])].sort(),
    trackedTree
  } as unknown as Json);
}

/** `files` is the Git-visible universe of `root`, as `computeWorktreeDigest` takes it. */
export function bindRepository(root: string, headSha: string, files: readonly string[]): RepositoryBinding {
  const canonicalRoot = canonicalRepositoryRoot(root);
  return {
    repositoryId: repositoryFingerprint(canonicalRoot),
    root: canonicalRoot,
    headSha,
    worktreeDigest: computeWorktreeDigest(canonicalRoot, files)
  };
}

export function assertRepoRelativePath(path: string): void {
  if (!isRepoRelativePosixPath(path)) {
    throw new Error(`Repository path must be relative POSIX path: ${path}`);
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

export function parseJsonOrStableYaml(body: string, path: string): Json {
  const trimmed = body.trim();
  if (!trimmed) throw new Error(`${path}: empty model file`);
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return checkedJsonOrFlowYaml(trimmed, path, "json-document");
  return new StableYamlParser(body, path).parse();
}

export const ADR_FILE_PATH = /^docs\/adr\/ADR-\d{4}-.+\.md$/;
const MODEL_NODE_PATH_PREFIX = ".archcontext/model/nodes/";

export interface AdrAppliesToValidation {
  /** Every problem found: malformed `appliesTo` values and unknown node ids. */
  errors: string[];
  /** The subset of `errors` that are well-formed ids resolving to no node. */
  referenceErrors: string[];
}

/**
 * ADR frontmatter `appliesTo` holds architecture node ids. Checks every `docs/adr/ADR-NNNN-*.md`
 * in `files` against the ids of `.archcontext/model/nodes/*`; files are repo-relative model files
 * as loaded by a ModelStore. Only the top-level `appliesTo` key is read, so other frontmatter
 * never fails this check. No ADR files, or ADRs without `appliesTo`, produce no errors.
 */
export function validateAdrAppliesTo(files: readonly { path: string; body: string }[]): AdrAppliesToValidation {
  const nodeIds = modelNodeIds(files);
  const errors: string[] = [];
  const referenceErrors: string[] = [];
  for (const file of files) {
    if (!ADR_FILE_PATH.test(file.path)) continue;
    const appliesTo = readAdrAppliesTo(file.body);
    if (appliesTo.kind === "absent") continue;
    if (appliesTo.kind === "malformed") {
      errors.push(`${file.path}: ADR ${appliesTo.reason.startsWith("frontmatter") ? "" : "appliesTo "}${appliesTo.reason}`);
      continue;
    }
    for (const id of appliesTo.ids) {
      if (nodeIds.has(id)) continue;
      const error = `${file.path}: ADR appliesTo references unknown node ${id}`;
      errors.push(error);
      referenceErrors.push(error);
    }
  }
  return { errors, referenceErrors };
}

/** Shared frontmatter boundary and appliesTo reader for validation and native export. */
export function readAdrAppliesTo(body: string): AdrAppliesToExtraction {
  const frontmatter = adrFrontmatter(body);
  if (frontmatter === null) return /^---[ \t]*\r?\n/.test(body.replace(/^\uFEFF/, ""))
    ? { kind: "malformed", reason: "frontmatter has no closing --- delimiter" } : { kind: "absent" };
  return extractAdrAppliesTo(frontmatter);
}
function adrFrontmatter(body: string): string | null {
  const match = body.replace(/^\uFEFF/, "").match(/^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/);
  return match ? match[1] ?? "" : null;
}
export interface ArchitectureDecisionMetadata {
  id: string; title: string; status: string | null; decidedAt: string | null;
  appliesTo: string[]; supersedes: string[]; path: string;
}
/** Pure ADR parser. Projection and native readers supply bytes from their own source boundary. */
export function parseArchitectureDecisionRecord(path: string, body: string): ArchitectureDecisionMetadata {
  const frontmatter = adrFrontmatter(body);
  if (frontmatter === null) throw new Error(`${path}: ADR frontmatter is required`);
  const document = parseDocument(frontmatter);
  if (document.errors.length) throw new Error(`${path}: ADR frontmatter is invalid`);
  const metadata: unknown = document.toJS();
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error(`${path}: ADR frontmatter must be an object`);
  const fields = metadata as Record<string, unknown>;
  const singleLine = (key: string, required = false): string | null => {
    const value = fields[key];
    if (value === undefined && !required) return null;
    if (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value)) throw new Error(`${path}: ADR frontmatter ${key} must be a non-empty single-line string`);
    return value.trim();
  };
  const appliesTo = readAdrAppliesTo(body);
  if (appliesTo.kind === "malformed") throw new Error(`${path}: ADR appliesTo ${appliesTo.reason}`);
  const supersedes = fields.supersedes ?? [];
  if (!Array.isArray(supersedes) || supersedes.some(id => typeof id !== "string" || !id.trim() || /[\r\n]/.test(id))) throw new Error(`${path}: ADR supersedes must be a list of ids`);
  return { id: singleLine("id") ?? path.slice("docs/adr/".length, -3), title: singleLine("title", true)!, status: singleLine("status"), decidedAt: singleLine("decidedAt"), appliesTo: appliesTo.kind === "ids" ? appliesTo.ids : [], supersedes: supersedes as string[], path };
}

export function manifestDecisionDiagnostics(files: readonly { path: string; body: string }[]): string[] {
  const file = files.find(file => file.path === ".archcontext/manifest.yaml");
  if (!file) return [];
  let manifest: Json;
  try { manifest = parseJsonOrStableYaml(file.body, file.path); } catch { return []; }
  const content = manifest && typeof manifest === "object" && !Array.isArray(manifest) ? manifest.content : undefined;
  const decisions = content && typeof content === "object" && !Array.isArray(content) ? content.decisions : undefined;
  if (decisions === undefined || decisions === "docs/adr") return [];
  return ["manifest-decisions-unsupported: .archcontext/manifest.yaml content.decisions supports only docs/adr; run archctx manifest plan --id <changeset.id> --decisions docs/adr"];
}

/** Ids of `.archcontext/model/nodes/*`. Malformed node files are schema validation's to report. */
function modelNodeIds(files: readonly { path: string; body: string }[]): Set<string> {
  const nodeIds = new Set<string>();
  for (const file of files) {
    if (!file.path.startsWith(MODEL_NODE_PATH_PREFIX)) continue;
    try {
      const value = parseJsonOrStableYaml(file.body, file.path);
      if (value && typeof value === "object" && !Array.isArray(value) && typeof value.id === "string") nodeIds.add(value.id);
    } catch {
      // Malformed node files are reported by schema validation, not by this reference check.
    }
  }
  return nodeIds;
}

const MODEL_CONSTRAINT_PATH_PREFIX = ".archcontext/model/constraints/";
export const REVIEW_POLICY_PATH = ".archcontext/policies/review.yaml";
const MANIFEST_PATH = ".archcontext/manifest.yaml";

/** `constraint.schema.json` severity -> the dependency gate's two finding levels. */
const CONSTRAINT_GATE_SEVERITY: Readonly<Record<string, DependencyConstraintV1["severity"]>> = {
  critical: "error",
  error: "error",
  notice: "warning",
  warning: "warning"
};

/**
 * `rule.type` values `schemas/repo/constraint.schema.json` allows, mirrored exactly (a test
 * asserts both lists match). `forbid-dependency` and `layer-direction` are evaluated by the dependency gate; the
 * other known types produce warnings, and anything else is a validate error.
 */
export const CONSTRAINT_RULE_TYPES = [
  "forbid-dependency",
  "layer-direction",
  "require-interface",
  "forbid-data-access",
  "require-owner",
  "require-adr",
  "require-compatibility-contract",
  "forbid-cycle",
  "require-cleanup-by",
  "require-review"
] as const;

export interface DependencyConstraintRead {
  layerOrderErrors: string[];
  /** Well-formed dependency constraints; unsupported rule types emit warnings. */
  constraints: DependencyConstraintV1[];
  errors: string[];
  /** The subset of `errors` that are node ids resolving to no node. */
  referenceErrors: string[];
  /** Declarations the gate accepts but does not fully enforce, such as `allowedVia`. */
  warnings: string[];
}

/**
 * Reads `forbid-dependency` constraints from `.archcontext/model/constraints/*` model files and
 * checks their integrity: constraint ids are unique across every constraint file, `rule.type` is
 * one the schema allows, scope and targets are non-empty and resolve to nodes, and severity is one
 * of the schema's four levels. The gate has two levels: `critical` blocks like `error` and `notice`
 * reports like `warning`. `allowedVia` is not enforced yet: the constraint is evaluated as if it
 * were absent, which can only report more violations, and a warning says so. A constraint with a
 * structural error is not returned; one whose ids merely dangle still is, and simply never matches
 * those ids.
 */
export function readDependencyConstraints(files: readonly { path: string; body: string }[]): DependencyConstraintRead {
  const nodeIds = modelNodeIds(files);
  const constraints: DependencyConstraintV1[] = [];
  const errors: string[] = [];
  const referenceErrors: string[] = [];
  const warnings: string[] = [];
  const layerOrderErrors: string[] = [];
  let layers: unknown;
  const manifest = files.find(file => file.path === ".archcontext/manifest.yaml");
  if (manifest) {
    try {
      const document = parseDocument(manifest.body, { uniqueKeys: true });
      if (document.errors.length || document.warnings.length) throw new Error("manifest YAML must be valid and unambiguous");
      const value = document.toJSON() as Json;
      if (isJsonRecord(value) && isJsonRecord(value.model)) layers = value.model.layers;
    } catch (error) { errors.push(`${manifest.path}: ${String(error)}`); }
  }
  const layerNodes = files.filter(file => file.path.startsWith(".archcontext/model/nodes/")).flatMap(file => {
    try { const value = parseJsonOrStableYaml(file.body, file.path); return isJsonRecord(value) ? [value] : []; } catch { return []; }
  });
  layerOrderErrors.push(...orderedLayerIssues(layers, layerNodes).map(issue => `.archcontext/manifest.yaml: ${issue}`));
  errors.push(...layerOrderErrors);
  const declaredIn = new Map<string, string>();
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    if (!file.path.startsWith(MODEL_CONSTRAINT_PATH_PREFIX)) continue;
    let value: Json;
    try {
      value = parseJsonOrStableYaml(file.body, file.path);
    } catch (error) {
      errors.push(`${file.path}: constraint is unreadable: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!isJsonRecord(value) || value.schemaVersion !== "archcontext.constraint/v1") {
      errors.push(`${file.path}: expected archcontext.constraint/v1`);
      continue;
    }
    // The ledger keys constraints by id, so a repeated id silently replaces the earlier declaration.
    const duplicateOf = typeof value.id === "string" ? declaredIn.get(value.id) : undefined;
    if (duplicateOf !== undefined) {
      errors.push(`${file.path}: duplicate constraint id ${String(value.id)} (also declared in ${duplicateOf})`);
      continue;
    }
    if (typeof value.id === "string" && value.id) declaredIn.set(value.id, file.path);
    const rule = isJsonRecord(value.rule) ? value.rule : undefined;
    if (typeof rule?.type !== "string" || !(CONSTRAINT_RULE_TYPES as readonly string[]).includes(rule.type)) {
      errors.push(`${file.path}: rule.type must be one of ${CONSTRAINT_RULE_TYPES.join(", ")}${rule?.type === undefined ? "" : ` (got ${JSON.stringify(rule.type)})`}`);
      continue;
    }
    if (rule.type !== "forbid-dependency" && rule.type !== "layer-direction") {
      warnings.push(`${file.path}: constraint ${String(value.id)} rule ${rule.type} is not evaluated yet`);
      continue;
    }
    const scope = isJsonRecord(value.scope) ? value.scope : undefined;
    const fileErrors: string[] = [];
    if (typeof value.id !== "string" || !value.id) fileErrors.push("id is required");
    const severity = typeof value.severity === "string" && Object.hasOwn(CONSTRAINT_GATE_SEVERITY, value.severity)
      ? CONSTRAINT_GATE_SEVERITY[value.severity]
      : undefined;
    if (severity === undefined) fileErrors.push("severity must be one of notice, warning, error, critical");
    const scopeNodes = nonEmptyStrings(scope?.nodes);
    if (rule.type === "forbid-dependency" && !scopeNodes) fileErrors.push("scope.nodes must be a non-empty list of node ids");
    const targets = nonEmptyStrings(rule.targets);
    if (rule.type === "forbid-dependency" && !targets) fileErrors.push("rule.targets must be a non-empty list of node ids");
    if (rule.type === "layer-direction" && (layers === undefined || orderedLayerIssues(layers, layerNodes).length > 0)) {
      const error = "layer-direction requires valid model.layers";
      fileErrors.push(error);
      layerOrderErrors.push(`${file.path}: ${error}`);
    }
    if (rule.type === "layer-direction" && (!scope || Object.keys(scope).length > 0)) fileErrors.push("layer-direction scope must be empty; model.layers is the only scope authority");
    if (rule.type === "layer-direction" && Object.keys(rule).some(key => key !== "type")) fileErrors.push("layer-direction rule accepts only type; order comes from model.layers");
    if (value.allowedVia !== undefined) {
      warnings.push(`${file.path}: constraint ${String(value.id)} allowedVia is not enforced yet; the constraint is evaluated as if it were absent`);
    }
    errors.push(...fileErrors.map((error) => `${file.path}: ${error}`));
    for (const [field, ids] of [["scope.nodes", scopeNodes ?? []], ["rule.targets", targets ?? []]] as const) {
      for (const id of ids) {
        if (nodeIds.has(id)) continue;
        const error = `${file.path}: constraint ${field} references unknown node ${id}`;
        errors.push(error);
        referenceErrors.push(error);
      }
    }
    if (fileErrors.length > 0) continue;
    constraints.push({
      id: value.id as string,
      severity: severity!,
      scope: { nodes: scopeNodes ?? [] },
      rule: rule.type === "layer-direction" ? { type: "layer-direction", layers: [...layers as string[]] } : { type: "forbid-dependency", targets: targets! },
      rationale: typeof value.rationale === "string" ? value.rationale : ""
    });
  }
  return { constraints: constraints.sort((left, right) => left.id.localeCompare(right.id)), errors, referenceErrors, warnings, layerOrderErrors };
}

export interface ReviewPolicyRead {
  /** The effective policy. Missing, unreadable or invalid policy files fail closed: every category. */
  policy: ReviewPolicyV1;
  errors: string[];
  warnings: string[];
}

/**
 * Reads the review policy from `.archcontext/policies/review.yaml`, the single `failOn` source.
 * The file must identify itself (`schemaVersion: archcontext.policy/v1`, `id: policy.review`) and
 * carry a non-empty `failOn` of known categories. Any error means the file is not the policy: the
 * effective policy falls back to every category and the error is reported, so a malformed policy
 * can never downgrade the `invalid-schema` finding it causes. The manifest's legacy
 * `review.failOn` is never read as policy; while it is still present it is reported as a warning
 * naming any entry the effective policy does not enforce.
 */
export function readReviewPolicy(files: readonly { path: string; body: string }[]): ReviewPolicyRead {
  const errors: string[] = [];
  const warnings: string[] = [];
  let policy: ReviewPolicyV1 = { failOn: [...REVIEW_FAIL_ON_CATEGORIES], source: "default" };
  const policyFile = files.find((file) => file.path === REVIEW_POLICY_PATH);
  if (policyFile) {
    let value: Json | undefined;
    try {
      value = parseJsonOrStableYaml(policyFile.body, policyFile.path);
    } catch (error) {
      errors.push(`${REVIEW_POLICY_PATH}: review policy is unreadable: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (value !== undefined) {
      const failOn = reviewPolicyFailOn(value, errors);
      if (failOn !== undefined) policy = { failOn, source: "policy-file" };
    }
  }
  const manifestFailOn = readManifestFailOn(files);
  if (manifestFailOn !== undefined) {
    const missing = manifestFailOn.filter((entry) => !(policy.failOn as string[]).includes(entry));
    warnings.push(
      `${MANIFEST_PATH}: review.failOn is ignored; ${REVIEW_POLICY_PATH} failOn is the single review policy source`
      + (missing.length === 0 ? "" : `; not enforced by the policy: ${missing.join(", ")}`)
    );
  }
  return { policy, errors, warnings };
}

/** The declared `failOn` when the policy's identity and shape are valid; otherwise errors and `undefined`. */
function reviewPolicyFailOn(value: Json, errors: string[]): ReviewFailOnCategory[] | undefined {
  const before = errors.length;
  if (!isJsonRecord(value)) {
    errors.push(`${REVIEW_POLICY_PATH}: review policy must be a mapping`);
    return undefined;
  }
  if (value.schemaVersion !== "archcontext.policy/v1") {
    errors.push(`${REVIEW_POLICY_PATH}: schemaVersion must be archcontext.policy/v1${value.schemaVersion === undefined ? "" : ` (got ${JSON.stringify(value.schemaVersion)})`}`);
  }
  if (value.id !== "policy.review") {
    errors.push(`${REVIEW_POLICY_PATH}: id must be policy.review${value.id === undefined ? "" : ` (got ${JSON.stringify(value.id)})`}`);
  }
  const failOn = value.failOn;
  if (!Array.isArray(failOn) || failOn.length === 0 || !failOn.every((entry) => typeof entry === "string")) {
    errors.push(`${REVIEW_POLICY_PATH}: failOn must be a non-empty list of categories (${REVIEW_FAIL_ON_CATEGORIES.join(", ")})`);
  } else {
    for (const entry of failOn as string[]) {
      if ((REVIEW_FAIL_ON_CATEGORIES as readonly string[]).includes(entry)) continue;
      errors.push(`${REVIEW_POLICY_PATH}: unknown failOn category ${entry} (expected one of ${REVIEW_FAIL_ON_CATEGORIES.join(", ")})`);
    }
  }
  return errors.length === before ? [...new Set(failOn as ReviewFailOnCategory[])] : undefined;
}

/** The legacy manifest `review.failOn`, or `undefined` when absent or unreadable. */
function readManifestFailOn(files: readonly { path: string; body: string }[]): string[] | undefined {
  const manifest = files.find((file) => file.path === MANIFEST_PATH);
  if (!manifest) return undefined;
  try {
    const value = parseJsonOrStableYaml(manifest.body, manifest.path);
    const review = isJsonRecord(value) && isJsonRecord(value.review) ? value.review : undefined;
    const failOn = review?.failOn;
    return Array.isArray(failOn) ? failOn.filter((entry): entry is string => typeof entry === "string") : undefined;
  } catch {
    // Manifest shape is validated elsewhere; this check only looks for the legacy key.
    return undefined;
  }
}

function isJsonRecord(value: Json | undefined): value is { [key: string]: Json } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyStrings(value: Json | undefined): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.every((entry) => typeof entry === "string" && entry.length > 0) ? value as string[] : undefined;
}

type AdrAppliesToExtraction =
  | { kind: "absent" }
  | { kind: "ids"; ids: string[] }
  | { kind: "malformed"; reason: string };

/**
 * Reads the top-level `appliesTo` of ADR frontmatter without parsing the rest of it, which is
 * hand-written YAML. Accepts an inline list (`appliesTo: [a, 'b']`) or a block list at any indent,
 * with `#` comments and single or double quotes around ids.
 */
function extractAdrAppliesTo(frontmatter: string): AdrAppliesToExtraction {
  const lines = frontmatter.split(/\r?\n/);
  const keyIndexes = lines.flatMap((line, index) => /^(["']?)appliesTo\1[ \t]*:(?:[ \t]|$)/.test(line) ? [index] : []);
  if (keyIndexes.length === 0) return { kind: "absent" };
  if (keyIndexes.length > 1) return { kind: "malformed", reason: "is declared more than once" };
  const keyIndex = keyIndexes[0]!;
  const inline = stripYamlComment(lines[keyIndex]!.slice(lines[keyIndex]!.indexOf(":") + 1)).trim();
  if (inline) {
    if (!inline.startsWith("[") || !inline.endsWith("]")) return { kind: "malformed", reason: "must be a list of node ids" };
    const body = inline.slice(1, -1).trim();
    if (!body) return { kind: "ids", ids: [] };
    const ids: string[] = [];
    for (const item of body.split(",")) {
      const id = yamlBareId(item);
      if (id === undefined) return { kind: "malformed", reason: `entry ${JSON.stringify(item.trim())} is not a node id` };
      ids.push(id);
    }
    return { kind: "ids", ids };
  }
  const ids: string[] = [];
  let itemIndent: number | undefined;
  for (const line of lines.slice(keyIndex + 1)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const item = line.match(/^( *)-(?:[ \t]+(.*))?$/);
    const indent = line.match(/^ */)![0].length;
    if (!item) {
      if (indent === 0) break;
      return { kind: "malformed", reason: "must be a list of node ids" };
    }
    if (itemIndent === undefined) itemIndent = indent;
    if (indent !== itemIndent) return { kind: "malformed", reason: "list items must share one indent" };
    const id = yamlBareId(item[2] ?? "");
    if (id === undefined) return { kind: "malformed", reason: `entry ${JSON.stringify((item[2] ?? "").trim())} is not a node id` };
    ids.push(id);
  }
  return { kind: "ids", ids };
}

function stripYamlComment(value: string): string {
  let quote: string | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === "\"") quote = char;
    else if (char === "#" && (index === 0 || /\s/.test(value[index - 1]!))) return value.slice(0, index);
  }
  return value;
}

function yamlBareId(raw: string): string | undefined {
  let value = stripYamlComment(raw).trim();
  const quote = value[0];
  if ((quote === "'" || quote === "\"") && value.length >= 2 && value.endsWith(quote)) value = value.slice(1, -1).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(value)) return undefined;
  return value;
}

function assertObject(value: Json, path: string): asserts value is { [key: string]: Json } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path}: expected object`);
  }
}

class StableYamlParser {
  private readonly lines: { indent: number; text: string }[];
  private index = 0;
  private readonly mappingKeys = new WeakMap<object, Set<string>>();

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
      values.push(parseScalar(item, this.path));
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
    const keys = this.mappingKeys.get(object) ?? new Set<string>();
    if (keys.has(key)) throw new DuplicateModelKeyError(this.path, "yaml-mapping", key, this.index);
    keys.add(key);
    this.mappingKeys.set(object, keys);
    const rest = entry.slice(separator + 1).trim();
    object[key] = rest ? parseScalar(rest, this.path) : this.parseNestedValue(indent);
  }

  private isKeyValue(value: string): boolean {
    return /^[A-Za-z0-9_-]+:/.test(value);
  }

  private parseNestedValue(parentIndent: number): Json {
    const next = this.lines[this.index];
    if (next && next.indent <= parentIndent && (next.text.trim() === "[]" || next.text.trim() === "{}")) {
      this.index += 1;
      return parseScalar(next.text.trim(), this.path);
    }
    return this.parseBlock(parentIndent + 2);
  }
}

function parseScalar(value: string, path: string): Json {
  if (value === "[]") return [];
  if (value === "{}") return {};
  if (value === "true" || value === "false" || value === "null") return JSON.parse(value) as Json;
  if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) return Number(value);
  if (/^["[{]/.test(value)) return checkedJsonOrFlowYaml(value, path, "json-scalar");
  return value;
}

/** Duplicate keys are rejected before a decoder can discard object members. */
export class DuplicateModelKeyError extends Error {
  constructor(readonly path: string, readonly branch: "yaml-mapping" | "yaml-flow" | "json-document" | "json-scalar", readonly key: string, readonly offset: number) {
    super(`${path}: duplicate object key (${branch})`);
    this.name = "DuplicateModelKeyError";
  }
}

function checkedJsonOrFlowYaml(source: string, path: string, branch: "json-document" | "json-scalar"): Json {
  try { return checkedJsonDecode(source, path, branch); }
  catch (error) {
    if (!(error instanceof SyntaxError) || !(source.startsWith("{") || source.startsWith("["))) throw error;
  }
  return checkedFlowYamlDecode(source, path);
}

function checkedFlowYamlDecode(source: string, path: string): Json {
  // Keep duplicate members in the AST so JSON key coercion cannot hide a collision.
  const document = parseDocument(source, { version: "1.2", schema: "core", uniqueKeys: false, prettyErrors: false });
  const invalid = (reason: string): never => { throw new SyntaxError(`${path}: invalid YAML flow collection (${reason})`); };
  if (document.errors.length || document.warnings.length) invalid("parse error or warning");
  if ((!isMap(document.contents) && !isSeq(document.contents)) || !document.contents.flow) invalid("expected flow collection");

  const decode = (node: unknown): Json => {
    if (node === null) return null;
    if (!isScalar(node) && !isMap(node) && !isSeq(node)) return invalid("unsupported node or alias");
    if (node.anchor || node.tag) return invalid("anchor or explicit tag");
    if (isScalar(node)) {
      const value: unknown = node.value;
      if (value === null || typeof value === "string" || typeof value === "boolean") return value;
      if (typeof value === "number" && Number.isFinite(value)) return value;
      return invalid("non-JSON scalar");
    }
    if (isSeq(node)) return node.items.map(decode);
    const keys = new Set<string>();
    return Object.fromEntries(node.items.map(pair => {
      if (!isScalar(pair.key)) return invalid("non-scalar key");
      const key = String(decode(pair.key));
      if (keys.has(key)) throw new DuplicateModelKeyError(path, "yaml-flow", key, pair.key.range![0]);
      keys.add(key);
      return [key, decode(pair.value)];
    }));
  };
  return decode(document.contents);
}

function checkedJsonDecode(source: string, path: string, branch: "json-document" | "json-scalar"): Json {
  let offset = 0;
  const whitespace = () => { while (/\s/.test(source[offset] ?? "") && offset < source.length) offset += 1; };
  const invalid = (): never => { throw new SyntaxError(`${path}: invalid JSON`); };
  const string = (): string => {
    const start = offset;
    if (source[offset++] !== '"') invalid();
    while (offset < source.length) {
      const char = source[offset++];
      if (char === "\\") { offset += 1; continue; }
      if (char === '"') return JSON.parse(source.slice(start, offset)) as string;
    }
    return invalid();
  };
  const value = (): void => {
    whitespace();
    if (source[offset] === '"') { string(); return; }
    if (source[offset] === "{") {
      offset += 1; whitespace();
      const keys = new Set<string>();
      if (source[offset] === "}") { offset += 1; return; }
      while (offset < source.length) {
        whitespace(); const keyOffset = offset; const key = string();
        if (keys.has(key)) throw new DuplicateModelKeyError(path, branch, key, keyOffset);
        keys.add(key); whitespace();
        if (source[offset++] !== ":") invalid();
        value(); whitespace();
        const end = source[offset++];
        if (end === "}") return;
        if (end !== ",") invalid();
      }
      invalid();
    }
    if (source[offset] === "[") {
      offset += 1; whitespace();
      if (source[offset] === "]") { offset += 1; return; }
      while (offset < source.length) {
        value(); whitespace(); const end = source[offset++];
        if (end === "]") return;
        if (end !== ",") invalid();
      }
      invalid();
    }
    const primitive = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(offset));
    if (!primitive) invalid();
    offset += primitive![0].length;
  };
  value(); whitespace();
  if (offset !== source.length) invalid();
  return JSON.parse(source) as Json;
}
