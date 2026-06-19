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
