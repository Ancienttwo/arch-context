import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FailureError,
  REFACTOR_REQUEST_SCHEMA_VERSION,
  knownFailure,
  refactorNamespaceIssues,
  unclassifiedFailure,
  type ArchContextErrorCode,
  type DependencyConstraintEvaluationV1,
  type DependencyConstraintV1,
  type Json,
  type RefactorRequestV1
} from "@archcontext/contracts";
import { parseJsonOrStableYaml, readDependencyConstraints } from "@archcontext/core/architecture-domain";
import { evaluateDependencyConstraints } from "@archcontext/core/module-statistics";
import type { NativeNode } from "@archcontext/core/projection-engine";
import { CODEGRAPH_IMPORT_NODE_READ_LIMIT, repositoryImportPairs } from "@archcontext/local-runtime/codegraph-adapter";
import { normalizePackageExports, readWorkspacePackages } from "@archcontext/local-runtime/git-adapter";

/** The default request: measure the whole repository and classify nothing beyond it. */
export const REPOSITORY_REFACTOR_REQUEST: RefactorRequestV1 = {
  schemaVersion: REFACTOR_REQUEST_SCHEMA_VERSION,
  scope: { kind: "repository" }
};

export function repositoryRefactorRequest(importNodeLimit: number | undefined): RefactorRequestV1 {
  return importNodeLimit === undefined ? REPOSITORY_REFACTOR_REQUEST : { ...REPOSITORY_REFACTOR_REQUEST, importNodeLimit };
}

export class RefactorScanError extends FailureError {
  constructor(code: ArchContextErrorCode, _message: string, reasonCode?: string, details: Record<string, Json> = {}) {
    const sourceReason = reasonCode ?? (code === "AC_SCHEMA_INVALID" ? "refactor-scan-invalid" : code === "AC_MODEL_ADOPTION_REQUIRED" ? "refactor-model-unreadable" : undefined);
    const failure = sourceReason === undefined ? unclassifiedFailure("public-operation") : knownFailure(code, sourceReason, details);
    super(failure.code, failure.reasonCode, failure.details, failure);
    this.name = "RefactorScanError";
  }
}

export interface ReviewDependencyConstraintInputV1 {
  root: string;
  /** The digest the review attests to; import facts count only when the index attested to it too. */
  worktreeDigest: string;
  /** The Git-visible files (`listGitVisibleFiles`) that `worktreeDigest` was computed over. */
  sourceFiles: readonly string[];
  /** Model files as the model store port returned them, so ledger read mode is honored. */
  modelFiles: readonly { path: string; body: string }[];
  edgeLimit?: number;
}

/**
 * Evaluates the declared `forbid-dependency` constraints against the current worktree for review.
 */
export function evaluateReviewDependencyConstraints(input: ReviewDependencyConstraintInputV1): DependencyConstraintEvaluationV1 {
  const constraints: DependencyConstraintV1[] = readDependencyConstraints(input.modelFiles).constraints;
  return evaluateWorktreeDependencyConstraints({ ...input, nodes: modelNodes(input.modelFiles), constraints });
}

/** Shared evidence read for daemon review and the stateless constraint query. */
export function evaluateWorktreeDependencyConstraints(input: {
  root: string;
  worktreeDigest: string;
  sourceFiles: readonly string[];
  nodes: NativeNode[];
  constraints: DependencyConstraintV1[];
  edgeLimit?: number;
  readImports?: typeof repositoryImportPairs;
}): DependencyConstraintEvaluationV1 {
  const { constraints } = input;
  const base = { nodes: input.nodes, constraints, worktreeDigest: input.worktreeDigest };
  if (constraints.length === 0) {
    return evaluateDependencyConstraints({
      ...base,
      files: [],
      importEdges: [],
      workspacePackages: [],
      truncated: false,
      codeFacts: { availability: "unavailable", indexedWorktreeDigest: null }
    });
  }
  const edgeLimit = input.edgeLimit ?? CODEGRAPH_IMPORT_NODE_READ_LIMIT;
  let imports: ReturnType<typeof repositoryImportPairs>;
  try {
    imports = (input.readImports ?? repositoryImportPairs)(input.root, edgeLimit, input.worktreeDigest, input.sourceFiles);
  } catch {
    imports = {
      pairs: [],
      truncated: true,
      availability: "unavailable",
      indexedWorktreeDigest: null,
      importNodeCount: null,
      importNodeLimit: edgeLimit,
      importNodeLimitExceeded: false
    };
  }
  const workspaces = reviewWorkspacePackages(input.root);
  return evaluateDependencyConstraints({
    ...base,
    files: readWorktreeFiles(input.root),
    importEdges: imports.pairs,
    workspacePackages: workspaces.packages,
    workspacePackagesResolved: workspaces.resolved,
    truncated: imports.truncated,
    importNodeLimitExceeded: imports.importNodeLimitExceeded,
    codeFacts: { availability: imports.availability, indexedWorktreeDigest: imports.indexedWorktreeDigest }
  });
}

export type WorkspacePackage = ReturnType<typeof readWorkspacePackages>[number];

export function declaredWorkspacePackages(root: string): ReturnType<typeof readWorkspacePackages> {
  return existsSync(join(root, "package.json")) ? readWorkspacePackages(root) : [];
}

function reviewWorkspacePackages(root: string): { packages: WorkspacePackage[]; resolved: boolean } {
  if (!existsSync(join(root, "package.json"))) return { packages: [], resolved: true };
  try {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { workspaces?: unknown };
    const declared = Array.isArray(manifest.workspaces)
      ? manifest.workspaces
      : (manifest.workspaces as { packages?: unknown } | undefined)?.packages ?? [];
    if (!Array.isArray(declared)) throw new Error("workspaces must be a list");
    const directories = declared.flatMap((entry) => {
      if (typeof entry !== "string") throw new Error("workspace entry must be a string");
      const pattern = entry.replace(/^\.\//, "").replace(/\/+$/, "");
      if (!/[*?[\]{}!]/.test(pattern)) return [pattern];
      const parent = /^([^*?[\]{}!]+)\/\*$/.exec(pattern)?.[1];
      if (parent === undefined) throw new Error(`unsupported workspace pattern: ${entry}`);
      return readdirSync(join(root, parent), { withFileTypes: true })
        .filter((child) => child.isDirectory() && existsSync(join(root, parent, child.name, "package.json")))
        .map((child) => `${parent}/${child.name}`);
    });
    const packages = directories.flatMap((directory): WorkspacePackage[] => {
      const packageManifest = JSON.parse(readFileSync(join(root, ...directory.split("/"), "package.json"), "utf8")) as { name?: unknown; exports?: unknown };
      if (typeof packageManifest.name !== "string") return [];
      return [{ name: packageManifest.name, root: directory, exports: normalizePackageExports(packageManifest.exports, `${directory}/package.json`) }];
    });
    return { packages: packages.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)), resolved: true };
  } catch {
    return { packages: [], resolved: false };
  }
}

function modelNodes(files: readonly { path: string; body: string }[]): NativeNode[] {
  return files.flatMap((file) => {
    if (!file.path.startsWith(".archcontext/model/nodes/")) return [];
    try {
      const value = parseJsonOrStableYaml(file.body, file.path);
      return value && typeof value === "object" && !Array.isArray(value) && typeof value.id === "string" ? [value as unknown as NativeNode] : [];
    } catch {
      return [];
    }
  });
}

export function readWorktreeFiles(root: string): string[] {
  let output: string;
  try {
    output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024
    });
  } catch {
    return [];
  }
  return [...new Set(output.split("\0").filter(Boolean))].sort();
}

export const REFACTOR_NAMESPACE_MANIFEST_PATH = ".archcontext/manifest.yaml" as const;

export function readRefactorNamespace(root: string): string {
  const path = join(root, REFACTOR_NAMESPACE_MANIFEST_PATH);
  if (!existsSync(path)) {
    throw new RefactorScanError(
      "AC_MODEL_ADOPTION_REQUIRED",
      `${REFACTOR_NAMESPACE_MANIFEST_PATH} is missing; refactor recommendations are scoped by its product.id; run archctx init`,
      "product-id-missing"
    );
  }
  let manifest: Json;
  try {
    manifest = parseJsonOrStableYaml(readFileSync(path, "utf8"), REFACTOR_NAMESPACE_MANIFEST_PATH);
  } catch (error) {
    throw new RefactorScanError(
      "AC_SCHEMA_INVALID",
      `${REFACTOR_NAMESPACE_MANIFEST_PATH} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      "product-id-invalid"
    );
  }
  const product = manifest !== null && typeof manifest === "object" && !Array.isArray(manifest) ? manifest.product : undefined;
  const id = product !== null && typeof product === "object" && !Array.isArray(product) ? product.id : undefined;
  if (id === undefined || id === null) {
    throw new RefactorScanError(
      "AC_MODEL_ADOPTION_REQUIRED",
      `${REFACTOR_NAMESPACE_MANIFEST_PATH} declares no product.id; refactor recommendations are scoped by it; add it through a ChangeSet`,
      "product-id-missing"
    );
  }
  const issues = refactorNamespaceIssues(id, `${REFACTOR_NAMESPACE_MANIFEST_PATH} product.id`);
  if (issues.length > 0) throw new RefactorScanError("AC_SCHEMA_INVALID", issues.join("; "), "product-id-invalid");
  return id as string;
}
