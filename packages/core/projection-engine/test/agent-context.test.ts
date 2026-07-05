import { describe, expect, test } from "bun:test";
import {
  AGENT_CONTEXT_BEGIN_PREFIX,
  AGENT_CONTEXT_END_PREFIX,
  AGENT_CONTEXT_RENDERER_VERSION,
  primarySourceDirectoryFromInclude,
  renderAgentContextProjection,
  type NativeModel
} from "../src/index";

const sourceDigest = "sha256:1111111111111111111111111111111111111111111111111111111111111111";

const model: NativeModel = {
  nodes: [
    {
      id: "capability.workflow-engine.inspection-migration",
      kind: "capability",
      name: "Inspection Migration",
      status: "active",
      summary: "Runs project-state inspection and template migration.",
      source: {
        include: ["scripts/inspect-project-state.ts"]
      },
      extensions: {
        lspProfile: "typescript-lsp",
        verification: ["bun test", "bash scripts/check-task-sync.sh"]
      }
    },
    {
      id: "capability.projection.agent-context",
      kind: "capability",
      name: "Agent Context Projection",
      status: "active",
      summary: "Projects capability facts into CLAUDE.md and AGENTS.md.",
      source: {
        include: ["packages/core/projection-engine/**"],
        exclude: ["packages/core/projection-engine/test/**"]
      }
    },
    {
      id: "module.no-source",
      kind: "module",
      name: "No Source Module",
      summary: "A module with no declared source paths."
    }
  ],
  relations: []
};

describe("renderAgentContextProjection (ADR-0043)", () => {
  test("primarySourceDirectoryFromInclude derives the directory root of an include glob", () => {
    expect(primarySourceDirectoryFromInclude("packages/core/projection-engine/**")).toBe("packages/core/projection-engine");
    expect(primarySourceDirectoryFromInclude("src/subscription/generated/**")).toBe("src/subscription/generated");
    expect(primarySourceDirectoryFromInclude("scripts/inspect-project-state.ts")).toBe("scripts");
    expect(primarySourceDirectoryFromInclude("README.md")).toBe(".");
  });

  test("constructs one agent-context target per CLAUDE.md/AGENTS.md for every capability node with a declared source", () => {
    const plan = renderAgentContextProjection({ model, sourceDigest });

    expect(plan.schemaVersion).toBe("archcontext.agent-context-projection-plan/v1");
    expect(plan.rendererVersion).toBe(AGENT_CONTEXT_RENDERER_VERSION);
    // Two capability nodes declare `source.include`; the module node does not, so it is skipped.
    expect(plan.targets).toHaveLength(4);
    expect(plan.targets.every((target) => target.type === "agent-context")).toBe(true);
    expect(plan.targets.every((target) => target.ownership === "mixed")).toBe(true);
    expect(plan.targets.every((target) => target.format === "markdown")).toBe(true);
    expect(plan.targets.every((target) => target.scope.kind === "entity" && target.scope.entityKind === "capability")).toBe(true);

    const inspectionTargets = plan.files.filter((file) => file.target.scope.id === "capability.workflow-engine.inspection-migration");
    expect(inspectionTargets.map((file) => file.path).sort()).toEqual(["scripts/AGENTS.md", "scripts/CLAUDE.md"]);

    const projectionTargets = plan.files.filter((file) => file.target.scope.id === "capability.projection.agent-context");
    expect(projectionTargets.map((file) => file.path).sort()).toEqual([
      "packages/core/projection-engine/AGENTS.md",
      "packages/core/projection-engine/CLAUDE.md"
    ]);

    // The module without a declared source produces no agent-context target at all.
    expect(plan.targets.some((target) => target.scope.id === "module.no-source")).toBe(false);
  });

  test("renders a marker-delimited body carrying id/name/summary/source/extensions", () => {
    const plan = renderAgentContextProjection({ model, sourceDigest });
    const claudeFile = plan.files.find((file) => file.path === "scripts/CLAUDE.md")!;

    expect(claudeFile.body).toContain(AGENT_CONTEXT_BEGIN_PREFIX);
    expect(claudeFile.body).toContain(AGENT_CONTEXT_END_PREFIX);
    expect(claudeFile.body).toContain('id="capability.workflow-engine.inspection-migration"');
    expect(claudeFile.body).toContain("Inspection Migration");
    expect(claudeFile.body).toContain("Runs project-state inspection and template migration.");
    expect(claudeFile.body).toContain("scripts/inspect-project-state.ts");
    expect(claudeFile.body).toContain("extensions.lspProfile: `typescript-lsp`");
    expect(claudeFile.body).toContain("extensions.verification:");
    expect(claudeFile.body).toContain("extensions digest:");

    const projectionFile = plan.files.find((file) => file.path === "packages/core/projection-engine/CLAUDE.md")!;
    expect(projectionFile.body).toContain("source.include:");
    expect(projectionFile.body).toContain("source.exclude:");
  });

  test("rendering is deterministic: identical input yields identical output digests", () => {
    const first = renderAgentContextProjection({ model, sourceDigest });
    const second = renderAgentContextProjection({ model: { nodes: [...model.nodes].reverse(), relations: [] }, sourceDigest });

    const firstDigests = first.targets.map((target) => target.outputDigest).sort();
    const secondDigests = second.targets.map((target) => target.outputDigest).sort();
    expect(firstDigests).toEqual(secondDigests);
  });

  test("preserves surrounding human-authored content and replaces only its own marker region", () => {
    const initial = renderAgentContextProjection({
      model,
      sourceDigest,
      existingFiles: [{ path: "scripts/CLAUDE.md", body: "# Scripts\n\nHuman-written context for this directory.\n" }]
    });
    const claudeFile = initial.files.find((file) => file.path === "scripts/CLAUDE.md")!;
    expect(claudeFile.body).toContain("Human-written context for this directory.");
    expect(claudeFile.body).toContain(AGENT_CONTEXT_BEGIN_PREFIX);

    // Re-rendering against the previous output (same facts) must not duplicate the region
    // or disturb the human-authored heading above it.
    const again = renderAgentContextProjection({
      model,
      sourceDigest,
      existingFiles: initial.files.map(({ path, body }) => ({ path, body }))
    });
    const claudeAgain = again.files.find((file) => file.path === "scripts/CLAUDE.md")!;
    expect(claudeAgain.body).toBe(claudeFile.body);
    expect(claudeAgain.body.match(new RegExp(AGENT_CONTEXT_BEGIN_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length).toBe(1);
    expect(claudeAgain.body).toContain("Human-written context for this directory.");

    // A change to the underlying facts (new sourceDigest) must replace only the marker
    // region in place, leaving the human-authored heading untouched.
    const changed = renderAgentContextProjection({
      model,
      sourceDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      existingFiles: initial.files.map(({ path, body }) => ({ path, body }))
    });
    const claudeChanged = changed.files.find((file) => file.path === "scripts/CLAUDE.md")!;
    expect(claudeChanged.body).toContain("Human-written context for this directory.");
    expect(claudeChanged.body.match(new RegExp(AGENT_CONTEXT_BEGIN_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length).toBe(1);
    expect(claudeChanged.target.sourceDigest).toBe("sha256:2222222222222222222222222222222222222222222222222222222222222222");
  });

  test("does not project non-capability nodes even when they declare a source", () => {
    const plan = renderAgentContextProjection({
      model: {
        nodes: [
          { id: "module.with-source", kind: "module", name: "Module With Source", source: { include: ["src/module/**"] } }
        ],
        relations: []
      },
      sourceDigest
    });
    expect(plan.targets).toHaveLength(0);
    expect(plan.files).toHaveLength(0);
  });
});
