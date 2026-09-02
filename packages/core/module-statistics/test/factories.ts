import { createHash } from "node:crypto";
import type { NativeModel } from "../../projection-engine/src/index";
import type { ModuleStatisticsInputV1, ModuleStatisticsWorkspacePackageV1 } from "../src/index";

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
  relations: [{ id: "relation.runtime-core", kind: "uses", source: "module.runtime", target: "module.core", intent: "reads the model" }]
};

export const TRACKED_FILES = [
  { path: "docs/readme.md", lineCount: 1 },
  { path: "packages/core/index.ts", lineCount: 5 },
  { path: "packages/core/pressure-engine/src/index.ts", lineCount: 9 },
  { path: "packages/core/pressure-engine/engine.ts", lineCount: 10 },
  { path: "packages/core/shared/util.ts", lineCount: 7 },
  { path: "packages/core/test/core.test.ts", lineCount: 4 },
  { path: "packages/runtime/main.ts", lineCount: 3 }
];

/** Mirrors the real repository shape: one manifest per workspace, subpaths under `exports`. */
export const WORKSPACE_PACKAGES: ModuleStatisticsWorkspacePackageV1[] = [
  {
    name: "@archcontext/core",
    root: "packages/core",
    exports: { ".": "./index.ts", "./pressure-engine": "./pressure-engine/src/index.ts" }
  },
  { name: "@archcontext/runtime", root: "packages/runtime", exports: { ".": "./main.ts" } }
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
      { from: "packages/core/index.ts", specifier: "./pressure-engine/engine", to: "packages/core/pressure-engine/engine.ts" },
      { from: "packages/core/pressure-engine/engine.ts", specifier: "../shared/util", to: "packages/core/shared/util.ts" },
      { from: "packages/runtime/main.ts", specifier: "@archcontext/core", to: null },
      { from: "packages/runtime/main.ts", specifier: "@archcontext/core/pressure-engine", to: null },
      { from: "packages/core/index.ts", specifier: "node:fs", to: null }
    ],
    workspacePackages: WORKSPACE_PACKAGES,
    truncated: false,
    edgeLimit: 20000,
    codeFacts: {
      version: "0.9.1",
      binaryDigest: digestOf("codegraph-binary"),
      availability: "ready",
      indexedWorktreeDigest: WORKTREE_DIGEST
    },
    createdAt: "2026-09-03T04:11:00.000Z",
    ...overrides
  };
}
