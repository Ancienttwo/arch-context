import { execFileSync } from "node:child_process";
import { canonicalRepositoryRoot } from "@archcontext/core/architecture-domain";
import { digestJson, type Json, type ProjectionSnapshotV1 } from "@archcontext/contracts";
import type { ArchitectureDocumentationProjectionProvenanceV3, ArchitectureDocumentationProjectionRuntimeSnapshot } from "@archcontext/core/projection-engine";

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


/**
 * The CodeGraph identity a protocol snapshot, receipt and recovery binding carry: the committed
 * package and version plus this run's runtime status. The committed provenance has no status,
 * because whether `codegraph init` ran is a fact about one machine (#277).
 */
export function projectionProtocolGeneratedFrom(
  provenance: ArchitectureDocumentationProjectionProvenanceV3,
  runtimeSnapshot: ArchitectureDocumentationProjectionRuntimeSnapshot
): ProjectionSnapshotV1["generatedFrom"] {
  return {
    ...provenance.generatedFrom,
    codeGraphStatus: runtimeSnapshot.codeGraphStatus
  } as ProjectionSnapshotV1["generatedFrom"];
}
