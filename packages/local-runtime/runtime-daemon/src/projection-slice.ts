import { FailureError, PROJECTION_SLICE_SCHEMA_VERSION, isRepoRelativePosixPath, okEnvelope, type Json, type JsonEnvelope, type ProjectionSliceV1 } from "@archcontext/contracts";
import { isSemanticModelPath, loadNativeModelFromModelFiles, parseArchitectureDocumentationProfile, renderArchitectureProjectionSlice } from "@archcontext/core/projection-engine";
import { assertReadyCodeGraphIndexWithoutWorktreeWrites } from "@archcontext/local-runtime/codegraph-adapter";
import { decodeUtf8, isGitRevisionArgument, localGitEnv, readGitBlobTree, readGitBlobs, readNativeGitRoot, readOnlyGit, resolveNativeGitSnapshot } from "@archcontext/local-runtime/git-adapter";
import { execFileSync, spawnSync } from "node:child_process";
import { ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH } from "@archcontext/contracts";
import { publicFailureEnvelope, publicOperationErrorEnvelope } from "./public-operation-failure";

/** Git model snapshots are read directly from objects. CodeGraph is a read-only readiness gate. */
export function runProjectionSliceCommand(options: { cwd: string; base: string; changedPaths: string[] }): JsonEnvelope {
  const requestId = "projection.slice";
  if (!isGitRevisionArgument(options.base) || options.changedPaths.some((path) => !isRepoRelativePosixPath(path))) {
    return publicFailureEnvelope(requestId, "AC_SCHEMA_INVALID", "projection-input-invalid");
  }
  let root: string;
  try { root = readNativeGitRoot(options.cwd); }
  catch { return publicFailureEnvelope(requestId, "AC_REPO_NOT_FOUND", "git-worktree-required"); }
  try {
    const gitArgs = ["-c", "core.fsmonitor=false"];
    const gitOptions = { cwd: root, env: localGitEnv(), encoding: "utf8" as const, timeout: 10_000 };
    const git = (...args: string[]) => execFileSync("git", [...gitArgs, ...args], { ...gitOptions, stdio: ["ignore", "pipe", "pipe"] });
    let head: ReturnType<typeof resolveNativeGitSnapshot>;
    let baseSha: string;
    let mergeBase: string;
    try {
      head = resolveNativeGitSnapshot(root, "HEAD");
      baseSha = resolveNativeGitSnapshot(root, options.base).commitSha;
      mergeBase = git("merge-base", baseSha, head.commitSha).trim();
    } catch {
      return publicFailureEnvelope(requestId, "AC_PRECONDITION_FAILED", "projection-slice-base-unresolved");
    }
    const headSha = head.commitSha;
    const assertClean = () => {
      const diff = ["diff", "--quiet", "--no-ext-diff", "--no-textconv", "--ignore-submodules=none"];
      for (const args of [["--"], ["--cached", headSha, "--"]]) {
        const result = spawnSync("git", [...gitArgs, ...diff, ...args], { ...gitOptions, stdio: "ignore" });
        if (result.status !== 0) throw new FailureError("AC_PRECONDITION_FAILED", "projection-slice-worktree-dirty");
      }
      if (decodeUtf8(readOnlyGit(root, "rev-parse", ["--verify", "--end-of-options", "HEAD^{commit}"])).trim() !== headSha) {
        throw new FailureError("AC_PRECONDITION_FAILED", "projection-inputs-changed-during-run", { field: "headSha" });
      }
    };
    assertClean();
    const diffPaths = git("diff", "--name-only", "-z", "--no-renames", `${mergeBase}..${headSha}`, "--").split("\0").filter(Boolean);
    const changedPaths = [...new Set([...diffPaths, ...options.changedPaths])].sort();
    assertReadyCodeGraphIndexWithoutWorktreeWrites(root);
    assertClean();
    const after = readProjectionSliceModel(root, head.treeOid);
    const before = mergeBase === headSha ? after : readProjectionSliceModel(root, mergeBase);
    const data: ProjectionSliceV1 = {
      schemaVersion: PROJECTION_SLICE_SCHEMA_VERSION,
      base: options.base,
      baseSha,
      mergeBase,
      headSha,
      changedPaths,
      ...renderArchitectureProjectionSlice({ before, after, changedPaths })
    };
    return okEnvelope(requestId, data as unknown as Json);
  } catch (error) {
    return publicOperationErrorEnvelope(requestId, error);
  }
}

export function readProjectionSliceModel(root: string, tree: string) {
  const entries = readGitBlobTree(root, tree).filter(({ path }) => isSemanticModelPath(path)
    || path === ".archcontext/manifest.yaml" || path === ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH);
  if (entries.some(({ utf8Valid, mode }) => !utf8Valid || (mode !== "100644" && mode !== "100755"))) {
    throw new FailureError("AC_PRECONDITION_FAILED", "projection-slice-model-entry-invalid");
  }
  const blobs = readGitBlobs(root, entries);
  const files = new Map(entries.map((entry, index) => [entry.path, decodeUtf8(blobs[index]!)]));
  const manifest = files.get(ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH);
  return {
    model: loadNativeModelFromModelFiles(files),
    profile: manifest === undefined ? "default" as const : parseArchitectureDocumentationProfile(manifest)
  };
}
