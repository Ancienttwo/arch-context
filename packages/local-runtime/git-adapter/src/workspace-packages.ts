import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { digestJson, FailureError, type Json } from "@archcontext/contracts";

export type GitChangeSource = "commit" | "staged" | "worktree";
export type GitPathChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "typechanged" | "unmerged" | "unknown";

export interface GitPathChange {
  path: string;
  previousPath?: string;
  status: GitPathChangeStatus;
  rawStatus: string;
}

export interface GitChangeFingerprintInput {
  schemaVersion?: "archcontext.git-change-fingerprint-input/v1";
  repositoryId: string;
  baseSha: string;
  headSha: string;
  paths: Array<string | GitPathChange>;
  codeFactsDigest: string;
  analysisKind?: string;
}

export function computeGitChangeFingerprint(input: GitChangeFingerprintInput): string {
  const paths = input.paths
    .map((item) => typeof item === "string" ? item : item.path)
    .filter(Boolean)
    .sort();
  return digestJson({
    schemaVersion: "archcontext.git-change-fingerprint-input/v1",
    repositoryId: input.repositoryId,
    baseSha: input.baseSha,
    headSha: input.headSha,
    paths: [...new Set(paths)],
    codeFactsDigest: input.codeFactsDigest,
    analysisKind: input.analysisKind ?? "architecture-change"
  } as unknown as Json);
}

export interface WorkspacePackageV1 {
  name: string;
  /** Repo-relative package directory. */
  root: string;
  /** The manifest `exports` field normalized by `normalizePackageExports`: subpath -> package-relative target. */
  exports: Record<string, string>;
}

/** Conditions a static reader can follow, in precedence order; every other condition is ignored. */
const EXPORT_CONDITIONS = ["types", "import", "default", "require"] as const;

/**
 * Workspace manifests as declared by the root `package.json`, so a consumer can resolve a bare
 * workspace specifier through the owning package's `exports` map. An entry is a literal directory
 * or `dir/*`, which names every direct subdirectory of `dir` that has a `package.json`. Any other
 * glob shape fails loudly here rather than silently measure nothing.
 */
export function readWorkspacePackages(root: string): WorkspacePackageV1[] {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { workspaces?: string[] };
  return (manifest.workspaces ?? [])
    .flatMap((entry) => expandWorkspaceEntry(root, entry))
    .map((directory) => {
      const path = join(root, ...directory.split("/"), "package.json");
      const packageManifest = JSON.parse(readFileSync(path, "utf8")) as { name: string; exports?: unknown };
      return { name: packageManifest.name, root: directory, exports: normalizePackageExports(packageManifest.exports, `${directory}/package.json`) };
    })
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

/**
 * A manifest `exports` field as subpath -> package-relative target. A string or a root condition
 * object is the `"."` target; a subpath map resolves each value. A condition object takes the first
 * of `EXPORT_CONDITIONS` that resolves, an array its first entry that resolves. A subpath with no
 * resolvable target is left out, so its specifier stays unresolved. Any other shape fails closed
 * with `workspace-exports-unsupported` naming `manifestPath` and the subpath.
 */
export function normalizePackageExports(exportsField: unknown, manifestPath: string): Record<string, string> {
  if (exportsField === undefined) return {};
  const unsupported = (subpath: string) => new FailureError("AC_SCHEMA_INVALID", "workspace-exports-unsupported", { manifestPath, subpath });
  const target = (value: unknown, subpath: string): string | undefined => {
    if (typeof value === "string") return value;
    if (value === null) return undefined;
    if (typeof value !== "object") throw unsupported(subpath);
    const candidates = Array.isArray(value)
      ? value
      : EXPORT_CONDITIONS.filter((condition) => Object.hasOwn(value, condition)).map((condition) => (value as Record<string, unknown>)[condition]);
    for (const candidate of candidates) {
      const resolved = target(candidate, subpath);
      if (resolved !== undefined) return resolved;
    }
    return undefined;
  };
  const keys = exportsField !== null && typeof exportsField === "object" && !Array.isArray(exportsField) ? Object.keys(exportsField) : [];
  const subpathKeys = keys.filter((key) => key.startsWith("."));
  if (subpathKeys.length === 0) {
    const root = target(exportsField, ".");
    return root === undefined ? {} : { ".": root };
  }
  if (subpathKeys.length !== keys.length) throw unsupported(".");
  const entries = subpathKeys.flatMap((subpath) => {
    const resolved = target((exportsField as Record<string, unknown>)[subpath], subpath);
    return resolved === undefined ? [] : [[subpath, resolved] as const];
  });
  return Object.fromEntries(entries);
}

function expandWorkspaceEntry(root: string, entry: string): string[] {
  if (!entry.includes("*")) return [entry];
  const base = entry.slice(0, -2);
  if (!entry.endsWith("/*") || base.includes("*")) throw new Error(`workspace-glob-unsupported: ${entry}`);
  const directory = join(root, ...base.split("/"));
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((child) => child.isDirectory() && existsSync(join(directory, child.name, "package.json")))
    .map((child) => `${base}/${child.name}`)
    .sort();
}
