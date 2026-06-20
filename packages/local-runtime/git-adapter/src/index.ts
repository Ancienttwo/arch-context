import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { bindRepository, type RepositoryBinding } from "@archcontext/core/architecture-domain";

export function findRepositoryRoot(start: string): string {
  try {
    return resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: start,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim());
  } catch {
    let cursor = resolve(start);
    while (cursor !== "/") {
      if (existsSync(resolve(cursor, ".git"))) return cursor;
      cursor = resolve(cursor, "..");
    }
    throw new Error(`Repository root not found from ${start}`);
  }
}

export function readHeadSha(root: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "unborn";
  }
}

export function readRepositoryBinding(start: string): RepositoryBinding {
  const root = findRepositoryRoot(start);
  return bindRepository(root, readHeadSha(root));
}
