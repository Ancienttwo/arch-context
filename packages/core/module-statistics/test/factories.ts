import { createHash } from "node:crypto";
import type { NativeModel } from "../../projection-engine/src/index";
import type { ModuleStatisticsInputV1 } from "../src/index";

export function digestOf(seed: string): string {
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

export const WORKTREE_DIGEST = digestOf("worktree.main");

/**
 * Three-level model with the two overlaps the PRD rule has to separate:
 * `component.pressure` is a descendant of `module.core` (ancestor overlap, deepest wins), while
 * `component.shared` sits under `module.runtime` yet also claims a path inside `module.core`
 * (non-ancestor overlap, contested). `node.undeclared` declares no footprint at all.
 */
export const MODEL: NativeModel = {
  nodes: [
    { id: "module.core", kind: "module", name: "Core", source: { include: ["packages/core/**"], exclude: ["packages/core/**/test/**"] } },
    { id: "component.pressure", kind: "component", name: "Pressure", parent: "module.core", source: { include: ["packages/core/pressure-engine/**"] } },
    { id: "module.runtime", kind: "module", name: "Runtime", source: { include: ["packages/runtime/**"] } },
    { id: "component.shared", kind: "component", name: "Shared", parent: "module.runtime", source: { include: ["packages/core/shared/**"] } },
    { id: "node.undeclared", kind: "component", name: "Undeclared", parent: "module.runtime" }
  ],
  relations: []
};

export const TRACKED_FILES = [
  { path: "docs/readme.md", lineCount: 1 },
  { path: "packages/core/index.ts", lineCount: 5 },
  { path: "packages/core/pressure-engine/engine.ts", lineCount: 10 },
  { path: "packages/core/shared/util.ts", lineCount: 7 },
  { path: "packages/core/test/core.test.ts", lineCount: 4 },
  { path: "packages/runtime/main.ts", lineCount: 3 }
];

export function makeInput(overrides: Partial<ModuleStatisticsInputV1> = {}): ModuleStatisticsInputV1 {
  return {
    model: MODEL,
    repository: { repositoryId: "repo.archcontext", storageRepositoryId: "storage.repo.archcontext" },
    worktree: {
      workspaceId: "workspace.main",
      storageWorkspaceId: "storage.workspace.main",
      branch: "main",
      headSha: "83636c7c1f6a4a0b9d2e5f7081a3b4c6d8e9f012",
      worktreeDigest: WORKTREE_DIGEST
    },
    trackedFiles: TRACKED_FILES,
    importEdges: [
      { from: "packages/core/index.ts", to: "packages/core/pressure-engine/engine.ts" },
      { from: "packages/core/pressure-engine/engine.ts", to: "packages/core/shared/util.ts" },
      { from: "packages/runtime/main.ts", to: "packages/core/index.ts" },
      { from: "packages/runtime/main.ts", to: "packages/core/shared/util.ts" },
      { from: "packages/core/index.ts", to: null }
    ],
    truncated: false,
    edgeLimit: 20000,
    codeFacts: {
      version: "0.9.1",
      binaryDigest: digestOf("codegraph-binary"),
      availability: "ready",
      indexFreshForWorktreeDigest: WORKTREE_DIGEST
    },
    createdAt: "2026-09-03T04:11:00.000Z",
    ...overrides
  };
}
