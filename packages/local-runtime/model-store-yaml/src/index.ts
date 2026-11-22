import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { digestJson, runtimeTopologyModelIssues, validateJsonSchema, type Json, type ModelStorePort, type ModelValidationResult, type WorkspaceRef } from "@archcontext/contracts";
import { manifestDecisionDiagnostics, parseJsonOrStableYaml, readDependencyConstraints, readReviewPolicy, validateAdrAppliesTo } from "@archcontext/core/architecture-domain";
import { isStateMachineModelPath, STATE_MACHINES_MODEL_DIRECTORY, stateMachinesFromModelFiles } from "@archcontext/core/state-machine-engine";
import nodeSchema from "../../../../schemas/repo/architecture-node.schema.json";

export * from "./architecture-history";
export * from "./init-model";
export * from "./native-context";
export { IMPACT_LIMITS, readRefImpact, readRefImpactBatch, type RefImpactOptions } from "./ref-impact";

export interface ModelFile {
  path: string;
  schemaVersion: string;
  digest: string;
  body: string;
}

export const ARCHCONTEXT_DIR = ".archcontext";

export class YamlModelStore implements ModelStorePort {
  async loadManifest(workspace: WorkspaceRef): Promise<unknown> {
    return readFileSync(resolve(workspace.root, ".archcontext/manifest.yaml"), "utf8");
  }

  async loadModel(workspace: WorkspaceRef): Promise<ModelFile[]> {
    return listModelFiles(workspace.root);
  }

  async validateModel(workspace: WorkspaceRef): Promise<ModelValidationResult> {
    return validateModelFiles(listModelFiles(workspace.root));
  }

  async writeChangeSetPreview(changeSet: unknown): Promise<{ digest: string; summary: string }> {
    return { digest: digestJson(changeSet as Json), summary: "ChangeSet preview generated" };
  }
}

/**
 * The one model validator (#576). It validates a set of model files, whatever their source: the
 * YAML store passes the files on disk, and the ledger read path passes the ledger projection merged
 * with the files the ledger does not own. Both read modes therefore apply the same checks. It
 * orders its input itself, so the error order and the model digest never depend on the caller.
 */
export function validateModelFiles(input: ModelFile[]): ModelValidationResult {
  const files = orderModelFiles(input);
  const errors: string[] = [];
  const diagnostics: NonNullable<ModelValidationResult["diagnostics"]> = [];
  const nodeSchemaErrors: NonNullable<ModelValidationResult["nodeSchemaErrors"]> = [];
  const paths = new Set(files.map((file) => file.path));
  for (const required of [".archcontext/manifest.yaml", ".archcontext/product.yaml"]) {
    if (paths.has(required)) continue;
    const error = `missing ${required}`;
    errors.push(error);
    diagnostics.push({ path: required, code: "missing-file", error });
  }
  const topologyRecords: { nodes: Record<string, Json>[]; relations: Record<string, Json>[] } = { nodes: [], relations: [] };
  const topologyRecordPaths = new Map<string, string>();
  const stateMachineFiles: { path: string; value: Json }[] = [];
  for (const file of files) {
    if (file.path.startsWith(".archcontext/model/") && /\.ya?ml$/.test(file.path)) {
      try {
        const value = parseJsonOrStableYaml(file.body, file.path);
        for (const [directory, records] of [["nodes", topologyRecords.nodes], ["relations", topologyRecords.relations]] as const) {
          if (!file.path.startsWith(`.archcontext/model/${directory}/`) || !isJsonRecord(value)) continue;
          records.push(value);
          if (typeof value.id === "string") topologyRecordPaths.set(value.id, file.path);
        }
        if (file.path.startsWith(".archcontext/model/nodes/")) {
          const { issues } = validateJsonSchema(nodeSchema, value);
          for (const issue of issues) {
            const error = `${file.path}: ${issue.path}: ${issue.message}`;
            errors.push(error);
            nodeSchemaErrors.push({ path: file.path, error });
          }
          continue;
        }
        if (isStateMachineModelPath(file.path)) {
          stateMachineFiles.push({ path: file.path, value });
          continue;
        }
        if (file.path.startsWith(`${STATE_MACHINES_MODEL_DIRECTORY}/`) && file.schemaVersion.startsWith("archcontext.")) {
          errors.push(`${file.path}: state-machine-path-nested: a state machine must be a direct child of ${STATE_MACHINES_MODEL_DIRECTORY}/`);
        }
      } catch (error) {
        errors.push(`${file.path}: invalid model YAML: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }
    if (!file.schemaVersion.startsWith("archcontext.")) {
      const error = `${file.path}: missing schemaVersion`;
      errors.push(error);
      diagnostics.push({ path: file.path, code: "schema-version-missing", error });
    }
    if (file.path.startsWith(".archcontext/model/flows/") && file.schemaVersion !== "archcontext.flow/v1") {
      errors.push(`${file.path}: expected archcontext.flow/v1, got ${file.schemaVersion || "missing"}`);
    }
  }
  for (const issue of runtimeTopologyModelIssues(topologyRecords)) {
    errors.push(`${topologyRecordPaths.get(issue.entityId) ?? issue.entityId}: ${issue.field}: ${issue.invariant}`);
  }
  errors.push(...stateMachinesFromModelFiles(stateMachineFiles, topologyRecords.nodes).issues);
  const adr = validateAdrAppliesTo(files);
  const constraints = readDependencyConstraints(files);
  const reviewPolicy = readReviewPolicy(files);
  errors.push(...adr.errors, ...constraints.errors, ...reviewPolicy.errors);
  const referenceErrors = [...adr.referenceErrors, ...constraints.referenceErrors];
  const warnings = [...constraints.warnings, ...reviewPolicy.warnings, ...manifestDecisionDiagnostics(files)];
  const modelDigest = digestJson(files.map((file) => ({ path: file.path, digest: file.digest })));
  return {
    valid: errors.length === 0,
    errors,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    ...(referenceErrors.length > 0 ? { referenceErrors } : {}),
    ...(nodeSchemaErrors.length > 0 ? { nodeSchemaErrors } : {}),
    ...(constraints.layerOrderErrors.length > 0 ? { layerOrderErrors: constraints.layerOrderErrors } : {}),
    ...(constraints.allowedTargetErrors.length > 0 ? { allowedTargetErrors: constraints.allowedTargetErrors } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    modelDigest
  };
}

/**
 * The architecture model authority that must be committed. A manifest digest and generated
 * documents cannot rebuild it, so an ignore rule over any of these paths leaves the model in one
 * checkout only. `generated` is a rebuildable projection and is not listed.
 */
export const ARCHITECTURE_MODEL_COMMITTED_PATHS = Object.freeze([
  ".archcontext/manifest.yaml",
  ".archcontext/product.yaml",
  ".archcontext/model/nodes/",
  ".archcontext/model/relations/",
  ".archcontext/model/flows/",
  ".archcontext/model/state-machines/",
  ".archcontext/decisions/",
  ".archcontext/policies/",
  ".archcontext/practices/",
  ".archcontext/projections/"
] as const);

export function architectureModelIgnoreProbePaths(root: string): string[] {
  const directories = ARCHITECTURE_MODEL_COMMITTED_PATHS.filter((path) => path.endsWith("/")).map((path) => path.slice(0, -1));
  return [...new Set([...ARCHITECTURE_MODEL_COMMITTED_PATHS, ...collectArchContextFiles(root, directories)])];
}

/** On-disk model inputs shared by the native refactor scan and its structural digest. */
export function listNativeModelPaths(root: string): string[] {
  return collectArchContextFiles(root, [".archcontext/manifest.yaml", ".archcontext/model"]);
}

export function listModelFiles(root: string): ModelFile[] {
  const paths = [...listNativeModelPaths(root), ...collectArchContextFiles(root, [
    ".archcontext/product.yaml",
    ".archcontext/decisions",
    ".archcontext/policies",
    ".archcontext/practices",
    ".archcontext/projections",
    ".archcontext/generated",
    "docs/adr"
  ])].sort(compareModelPaths);
  return paths.map((path) => {
    const body = readFileSync(resolve(root, path), "utf8");
    return {
      path,
      body,
      schemaVersion: extractSchemaVersion(body, path),
      digest: digestJson({ path, body })
    };
  });
}

/** The one model file order: by path in UTF-16 code unit order, as `Array.prototype.sort` orders strings. */
export function orderModelFiles(files: ModelFile[]): ModelFile[] {
  return [...files].sort((left, right) => compareModelPaths(left.path, right.path));
}

function compareModelPaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function collectArchContextFiles(root: string, entries: string[]): string[] {
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = resolve(root, entry);
    if (!existsSync(absolute)) continue;
    const stat = readdirOrFile(absolute);
    if (stat === "file") {
      files.push(entry);
      continue;
    }
    for (const child of walk(entry)) files.push(child);
  }
  return [...new Set(files)].sort(compareModelPaths);

  function walk(relativeDir: string): string[] {
    const out: string[] = [];
    const dir = resolve(root, relativeDir);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...walk(child));
      if (entry.isFile() && /\.(ya?ml|md)$/.test(entry.name) && isCollectableModelFile(child)) out.push(child);
    }
    return out;
  }
}

function isCollectableModelFile(path: string): boolean {
  if (path.startsWith("docs/adr/")) return /^docs\/adr\/ADR-\d{4}-.+\.md$/.test(path);
  return true;
}

function readdirOrFile(path: string): "directory" | "file" {
  try {
    readdirSync(path);
    return "directory";
  } catch {
    return "file";
  }
}

/** The schemaVersion of a model file body, as every ModelFile producer derives it for the validator. */
export function extractSchemaVersion(body: string, path: string): string {
  if (path.startsWith(".archcontext/model/") && /\.ya?ml$/.test(path)) {
    try {
      const parsed = parseJsonOrStableYaml(body, path) as { schemaVersion?: unknown } | null;
      return typeof parsed?.schemaVersion === "string" ? parsed.schemaVersion : "";
    } catch {
      return "";
    }
  }
  const match = body.match(/schemaVersion:\s*"?([^"\n]+)"?/);
  if (match) return match[1].trim();
  try {
    const parsed = JSON.parse(body) as { schemaVersion?: unknown };
    if (typeof parsed.schemaVersion === "string") return parsed.schemaVersion;
  } catch {
    // JSON-compatible YAML is optional; plain YAML remains supported above.
  }
  if (body.includes("Generated by ArchContext")) return "archcontext.generated/v1";
  return "";
}

function isJsonRecord(value: unknown): value is Record<string, Json> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
