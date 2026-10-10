import { execFileSync } from "node:child_process";
import { canonicalRepositoryRoot } from "@archcontext/core/architecture-domain";
import { digestJson, type Json } from "@archcontext/contracts";

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


export function projectionWorkspaceId(root: string): string {
  const canonicalRoot = canonicalRepositoryRoot(root);
  return `workspace.${digestJson({ root: canonicalRoot } as unknown as Json).replace(/^sha256:/, "").slice(0, 16)}`;
}

