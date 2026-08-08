import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REPO_HARNESS_PROJECTION_PROFILE,
  agentContextTargetPaths,
  loadArchitectureFilesForLayout,
  resolveArchitectureDocumentationLayout,
  type NativeModel
} from "../src/index";

const model: NativeModel = {
  nodes: [
    capability("capability.runtime-harness.hook-adapters", "packages/runtime-harness/AGENTS.md", "packages/runtime-harness/CLAUDE.md"),
    capability("capability.source-tree.core-index", "packages/source-tree/AGENTS.md", "packages/source-tree/CLAUDE.md")
  ],
  relations: []
};

describe("repo-harness projection layout", () => {
  test("resolves one canonical nested module/index/contract target map", () => {
    const layout = resolveArchitectureDocumentationLayout({ ...model, profile: REPO_HARNESS_PROJECTION_PROFILE });
    expect(layout.entityPathByNodeId.get("capability.runtime-harness.hook-adapters"))
      .toBe("docs/architecture/modules/runtime-harness/hook-adapters.md");
    expect(layout.entityPathByNodeId.get("capability.source-tree.core-index"))
      .toBe("docs/architecture/modules/source-tree/core-index.md");
    expect(layout.targets.find((target) => target.type === "architecture-index")?.path)
      .toBe("docs/architecture/index.md");
    expect(agentContextTargetPaths(model.nodes)).toEqual([
      { nodeId: "capability.runtime-harness.hook-adapters", path: "packages/runtime-harness/AGENTS.md" },
      { nodeId: "capability.runtime-harness.hook-adapters", path: "packages/runtime-harness/CLAUDE.md" },
      { nodeId: "capability.source-tree.core-index", path: "packages/source-tree/AGENTS.md" },
      { nodeId: "capability.source-tree.core-index", path: "packages/source-tree/CLAUDE.md" }
    ]);
  });

  test("rejects malformed explicit identity and contract paths", () => {
    expect(() => resolveArchitectureDocumentationLayout({
      nodes: [capability("capability.Bad.name", "a/AGENTS.md", "a/CLAUDE.md")], relations: [], profile: REPO_HARNESS_PROJECTION_PROFILE
    })).toThrow("repo-harness-profile-node-identity-invalid");
    expect(() => agentContextTargetPaths([
      capability("capability.runtime-harness.hook-adapters", "a/AGENTS.md", "a/AGENTS.md")
    ])).toThrow("repo-harness-profile-contract-file-invalid");
    expect(() => agentContextTargetPaths([
      capability("capability.runtime-harness.hook-adapters", "a/context.md", "a/CLAUDE.md")
    ])).toThrow("repo-harness-profile-contract-file-invalid");
  });

  test("exact-reads targets and recursively discovers nested orphan markdown", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-layout-"));
    try {
      const layout = resolveArchitectureDocumentationLayout({ ...model, profile: REPO_HARNESS_PROJECTION_PROFILE });
      write(root, "docs/architecture/index.md", "# index\n");
      write(root, "docs/architecture/modules/runtime-harness/hook-adapters.md", "# hook\n");
      write(root, "docs/architecture/modules/retired/deep/orphan.md", "# orphan\n");
      expect(loadArchitectureFilesForLayout(root, layout).map((file) => file.path)).toEqual([
        "docs/architecture/index.md",
        "docs/architecture/modules/retired/deep/orphan.md",
        "docs/architecture/modules/runtime-harness/hook-adapters.md"
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("recursive discovery rejects symlinks instead of following them", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-layout-link-"));
    const outside = mkdtempSync(join(tmpdir(), "archctx-layout-outside-"));
    try {
      const layout = resolveArchitectureDocumentationLayout({ ...model, profile: REPO_HARNESS_PROJECTION_PROFILE });
      write(outside, "secret.md", "secret\n");
      mkdirSync(join(root, "docs/architecture/modules"), { recursive: true });
      symlinkSync(outside, join(root, "docs/architecture/modules/outside"));
      expect(() => loadArchitectureFilesForLayout(root, layout)).toThrow("projection-layout-symlink-rejected");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

function capability(id: string, agents: string, claude: string): NativeModel["nodes"][number] {
  return {
    id,
    kind: "capability",
    name: id,
    extensions: { contractFiles: { agents, claude } }
  };
}

function write(root: string, path: string, body: string): void {
  const absolute = join(root, path);
  mkdirSync(absolute.slice(0, absolute.lastIndexOf("/")), { recursive: true });
  writeFileSync(absolute, body, "utf8");
}
