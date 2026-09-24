import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import {
  REVIEW_FAIL_ON_CATEGORIES,
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

export function bindRepository(root: string, headSha: string): RepositoryBinding {
  const canonicalRoot = canonicalRepositoryRoot(root);
  return {
    repositoryId: repositoryFingerprint(canonicalRoot),
    root: canonicalRoot,
    headSha,
    worktreeDigest: computeWorktreeDigest(canonicalRoot)
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
      const absolute = resolve(dir, entry.name);
      const rel = relative(root, absolute).split(sep).join("/");
      if (!rel || shouldIgnorePath(entry.name, rel, ignore)) continue;
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      out.push(rel);
    }
  }
}

function shouldIgnorePath(_entryName: string, relativePath: string, ignore: Set<string>): boolean {
  const rootSegment = relativePath.split("/")[0];
  if (ignore.has(relativePath) || ignore.has(rootSegment)) return true;
  for (const pattern of ignore) {
    if (relativePath.startsWith(`${pattern}/`)) return true;
  }
  return false;
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
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed) as Json;
  return new StableYamlParser(body, path).parse();
}

const ADR_FILE_PATH = /^docs\/adr\/ADR-\d{4}-.+\.md$/;
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
    const body = file.body.replace(/^\uFEFF/, "");
    const frontmatter = body.match(/^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/);
    if (!frontmatter) {
      // An opening delimiter without a closing one would otherwise hide `appliesTo` from this check.
      if (/^---[ \t]*\r?\n/.test(body)) errors.push(`${file.path}: ADR frontmatter has no closing --- delimiter`);
      continue;
    }
    const appliesTo = extractAdrAppliesTo(frontmatter[1] ?? "");
    if (appliesTo.kind === "absent") continue;
    if (appliesTo.kind === "malformed") {
      errors.push(`${file.path}: ADR appliesTo ${appliesTo.reason}`);
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

export interface DependencyConstraintRead {
  /** Well-formed `forbid-dependency` constraints; other rule types are not evaluated here. */
  constraints: DependencyConstraintV1[];
  errors: string[];
  /** The subset of `errors` that are node ids resolving to no node. */
  referenceErrors: string[];
}

/**
 * Reads `forbid-dependency` constraints from `.archcontext/model/constraints/*` model files and
 * checks their integrity: scope and targets are non-empty and resolve to nodes, severity is
 * `error` or `warning`, and v1 has no `allowedVia` escape. A constraint with a structural error
 * is not returned; one whose ids merely dangle still is, and simply never matches those ids.
 */
export function readDependencyConstraints(files: readonly { path: string; body: string }[]): DependencyConstraintRead {
  const nodeIds = modelNodeIds(files);
  const constraints: DependencyConstraintV1[] = [];
  const errors: string[] = [];
  const referenceErrors: string[] = [];
  for (const file of files) {
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
    const rule = isJsonRecord(value.rule) ? value.rule : undefined;
    if (rule?.type !== "forbid-dependency") continue;
    const scope = isJsonRecord(value.scope) ? value.scope : undefined;
    const fileErrors: string[] = [];
    if (typeof value.id !== "string" || !value.id) fileErrors.push("id is required");
    if (value.severity !== "error" && value.severity !== "warning") fileErrors.push("forbid-dependency severity must be error or warning");
    const scopeNodes = nonEmptyStrings(scope?.nodes);
    if (!scopeNodes) fileErrors.push("scope.nodes must be a non-empty list of node ids");
    const targets = nonEmptyStrings(rule.targets);
    if (!targets) fileErrors.push("rule.targets must be a non-empty list of node ids");
    if (value.allowedVia !== undefined) fileErrors.push("allowedVia is not supported by forbid-dependency v1");
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
      severity: value.severity as DependencyConstraintV1["severity"],
      scope: { nodes: scopeNodes! },
      rule: { type: "forbid-dependency", targets: targets! },
      rationale: typeof value.rationale === "string" ? value.rationale : ""
    });
  }
  return { constraints: constraints.sort((left, right) => left.id.localeCompare(right.id)), errors, referenceErrors };
}

export interface ReviewPolicyRead {
  /** The effective policy. Missing, unreadable or invalid policy files fail closed: every category. */
  policy: ReviewPolicyV1;
  errors: string[];
  warnings: string[];
}

/**
 * Reads the review policy from `.archcontext/policies/review.yaml`, the single `failOn` source. A
 * `failOn` entry outside the closed vocabulary is an error. The manifest's legacy `review.failOn`
 * is never read as policy; while it is still present it is reported as a warning naming any entry
 * the effective policy does not enforce.
 */
export function readReviewPolicy(files: readonly { path: string; body: string }[]): ReviewPolicyRead {
  const errors: string[] = [];
  const warnings: string[] = [];
  let policy: ReviewPolicyV1 = { failOn: [...REVIEW_FAIL_ON_CATEGORIES], source: "default" };
  const policyFile = files.find((file) => file.path === REVIEW_POLICY_PATH);
  if (policyFile) {
    try {
      const value = parseJsonOrStableYaml(policyFile.body, policyFile.path);
      const failOn = isJsonRecord(value) ? value.failOn : undefined;
      if (failOn !== undefined) {
        if (!Array.isArray(failOn) || !failOn.every((entry) => typeof entry === "string")) {
          errors.push(`${REVIEW_POLICY_PATH}: failOn must be a list of categories`);
        } else {
          const unknown = (failOn as string[]).filter((entry) => !(REVIEW_FAIL_ON_CATEGORIES as readonly string[]).includes(entry));
          for (const entry of unknown) {
            errors.push(`${REVIEW_POLICY_PATH}: unknown failOn category ${entry} (expected one of ${REVIEW_FAIL_ON_CATEGORIES.join(", ")})`);
          }
          if (unknown.length === 0) policy = { failOn: [...new Set(failOn as ReviewFailOnCategory[])], source: "policy-file" };
        }
      }
    } catch (error) {
      errors.push(`${REVIEW_POLICY_PATH}: review policy is unreadable: ${error instanceof Error ? error.message : String(error)}`);
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
    object[key] = rest ? parseScalar(rest) : this.parseNestedValue(indent);
  }

  private isKeyValue(value: string): boolean {
    return /^[A-Za-z0-9_-]+:/.test(value);
  }

  private parseNestedValue(parentIndent: number): Json {
    const next = this.lines[this.index];
    if (next && next.indent <= parentIndent && (next.text.trim() === "[]" || next.text.trim() === "{}")) {
      this.index += 1;
      return parseScalar(next.text.trim());
    }
    return this.parseBlock(parentIndent + 2);
  }
}

function parseScalar(value: string): Json {
  if (value === "[]") return [];
  if (value === "{}") return {};
  if (value === "true" || value === "false" || value === "null") return JSON.parse(value) as Json;
  if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) return Number(value);
  if (/^["[{]/.test(value)) return JSON.parse(value) as Json;
  return value;
}
