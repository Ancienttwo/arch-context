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
 * The protocol's `generatedFrom`: the committed CodeGraph identity plus the digest of the runtime
 * that ran this projection. Protocol snapshots, apply receipts and recovery bindings are runtime
 * artifacts, so they keep binding the exact local CodeGraph runtime; the committed manifest does not.
 */
export function projectionProtocolGeneratedFrom(
  generatedFrom: ArchitectureDocumentationProjectionProvenanceV3["generatedFrom"],
  runtimeSnapshot: ArchitectureDocumentationProjectionRuntimeSnapshot
): ProjectionSnapshotV1["generatedFrom"] {
  return {
    codeGraphPackage: generatedFrom.codeGraphPackage,
    codeGraphVersion: generatedFrom.codeGraphVersion,
    codeGraphBinaryDigest: runtimeSnapshot.codeGraphBinaryDigest,
    codeGraphStatus: generatedFrom.codeGraphStatus
  } as ProjectionSnapshotV1["generatedFrom"];
}
