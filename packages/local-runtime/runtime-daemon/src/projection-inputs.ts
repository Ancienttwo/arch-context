import { execFileSync } from "node:child_process";
import { canonicalRepositoryRoot } from "@archcontext/core/architecture-domain";
import { digestJson, type Json } from "@archcontext/contracts";
import { readHeadSha } from "@archcontext/local-runtime/git-adapter";
import { assertArchitectureProjectionVerifiedAgainst, type ArchitectureProjectionVerifiedAgainst } from "@archcontext/core/projection-engine";

export function readCurrentBranch(root: string): string {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return branch === "HEAD" ? "detached" : branch;
  } catch {
    return "unknown";
  }
}


export function readHeadCommittedAt(root: string): string {
  try {
    return execFileSync("git", ["show", "-s", "--format=%cI", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}


export function readArchitectureProjectionVerifiedAgainst(root: string): ArchitectureProjectionVerifiedAgainst {
  return assertArchitectureProjectionVerifiedAgainst({
    branch: readCurrentBranch(root),
    commit: readHeadSha(root),
    committedAt: readHeadCommittedAt(root)
  });
}


export function projectionWorkspaceId(root: string): string {
  const canonicalRoot = canonicalRepositoryRoot(root);
  return `workspace.${digestJson({ root: canonicalRoot } as unknown as Json).replace(/^sha256:/, "").slice(0, 16)}`;
}

