import { parseDocument } from "yaml";
import {
  REVIEW_FAIL_ON_CATEGORIES,
  orderedLayerIssues,
  type DependencyConstraintV1,
  type Json,
  type ReviewFailOnCategory,
  type ReviewPolicyV1
} from "@archcontext/contracts";
import { MODEL_NODE_PATH_PREFIX, modelNodeIds, readModelNodeRecords } from "./adr-parsers";
import { isJsonRecord, nonEmptyStrings, parseJsonOrStableYaml } from "./yaml-codec";

const NODE_ID_PATTERN = /^([a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)*::)?[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/;

function dependencyNodeParents(records: ReturnType<typeof readModelNodeRecords>): Map<string, string | undefined> {
  const parents = new Map<string, string | undefined>();
  for (const { path, node } of records) {
    // Only direct YAML children are loaded as nodes by the runtime evaluator.
    if (!/^[^/]*\.ya?ml$/.test(path.slice(MODEL_NODE_PATH_PREFIX.length)) || node.schemaVersion !== "archcontext.node/v2") continue;
    if (typeof node.id !== "string" || !NODE_ID_PATTERN.test(node.id)) continue;
    parents.set(node.id, typeof node.parent === "string" ? node.parent : undefined);
  }
  return parents;
}

function readAllowedTargets(
  value: Json, targets: string[], parents: ReadonlyMap<string, string | undefined>, path: string
): { ids?: string[]; errors: string[]; referenceErrors: string[] } {
  const ids = nonEmptyStrings(value);
  if (!ids || new Set(ids).size !== ids.length || !ids.every(id => NODE_ID_PATTERN.test(id))) {
    return { errors: [`${path}: rule.allowedTargets must be a non-empty list of unique node ids`], referenceErrors: [] };
  }
  const errors: string[] = [];
  const referenceErrors: string[] = [];
  for (const id of ids) {
    if (!parents.has(id)) {
      const error = `${path}: constraint rule.allowedTargets references unknown node ${id}`;
      errors.push(error);
      referenceErrors.push(error);
    } else if (!isStrictDescendantOf(id, targets, parents)) {
      errors.push(`${path}: rule.allowedTargets node ${id} must be a strict descendant of a rule.targets node`);
    }
  }
  return { ids, errors, referenceErrors };
}

function isStrictDescendantOf(id: string, targets: string[], parents: ReadonlyMap<string, string | undefined>): boolean {
  const visited = new Set([id]);
  let matchesTarget = false;
  let parent = parents.get(id);
  while (parent !== undefined && parents.has(parent)) {
    if (visited.has(parent)) return false;
    visited.add(parent);
    if (targets.includes(parent)) matchesTarget = true;
    parent = parents.get(parent);
  }
  return matchesTarget;
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
  allowedTargetErrors: string[];
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
 * structural error or an invalid `allowedTargets` exemption is omitted. A dangling scope or target
 * reference still produces an error and cannot match.
 */
export function readDependencyConstraints(files: readonly { path: string; body: string }[]): DependencyConstraintRead {
  const nodeRecords = readModelNodeRecords(files);
  const nodeIds = modelNodeIds(nodeRecords);
  const nodeParents = dependencyNodeParents(nodeRecords);
  const constraints: DependencyConstraintV1[] = [];
  const errors: string[] = [];
  const referenceErrors: string[] = [];
  const warnings: string[] = [];
  const layerOrderErrors: string[] = [];
  const allowedTargetErrors: string[] = [];
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
  const layerNodes = nodeRecords.map(({ node }) => node);
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
    if (rule.type !== "forbid-dependency" && rule.allowedTargets !== undefined) {
      const error = `${file.path}: rule.allowedTargets is only valid for forbid-dependency`;
      errors.push(error);
      allowedTargetErrors.push(error);
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
    let allowedTargets: string[] | undefined;
    if (rule.allowedTargets !== undefined) {
      const exemption = readAllowedTargets(rule.allowedTargets, targets ?? [], nodeParents, file.path);
      errors.push(...exemption.errors);
      allowedTargetErrors.push(...exemption.errors);
      referenceErrors.push(...exemption.referenceErrors);
      if (exemption.errors.length > 0) continue;
      allowedTargets = exemption.ids;
    }
    if (fileErrors.length > 0) continue;
    constraints.push({
      id: value.id as string,
      severity: severity!,
      scope: { nodes: scopeNodes ?? [] },
      rule: rule.type === "layer-direction"
        ? { type: "layer-direction", layers: [...layers as string[]] }
        : { type: "forbid-dependency", targets: targets!, ...(allowedTargets === undefined ? {} : { allowedTargets }) },
      rationale: typeof value.rationale === "string" ? value.rationale : ""
    });
  }
  return { constraints: constraints.sort((left, right) => left.id.localeCompare(right.id)), errors, referenceErrors, warnings, layerOrderErrors, allowedTargetErrors };
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
