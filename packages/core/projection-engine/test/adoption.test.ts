import { describe, expect, test } from "bun:test";
import { digestJson, type Json, type ProjectionTargetV1 } from "@archcontext/contracts";
import {
  REPO_HARNESS_PROJECTION_PROFILE,
  architectureAdoptionReceipt,
  buildArchitectureDocumentationAdoptionPlan
} from "../src/index";

const expectedWorktreeDigest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("architecture documentation adoption", () => {
  test("replaces only the machine range and records preserved byte hashes", () => {
    const existingBody = "# runtime-harness/hook-adapters\n\n## 1. Old P1\nold p1\n\n## 2. Old P2\nold p2\n\n## 3. P3 Decisions\nkeep  two spaces  \n\n## 4. History\nkeep history\n";
    const target = entityTarget();
    const wrapped = `${target.generatedRegion.startMarker}\nnew P1 and P2\n${target.generatedRegion.endMarker}\n`;
    const plan = buildArchitectureDocumentationAdoptionPlan({
      profile: REPO_HARNESS_PROJECTION_PROFILE,
      expectedWorktreeDigest,
      candidates: [{ path: target.path, existingBody, renderedBody: `${existingBody}\n${wrapped}`, target }]
    });
    expect(plan.allowed).toBe(true);
    expect(plan.adoptionPlanId).toStartWith("adoption_plan.");
    expect(plan.files).toHaveLength(1);
    const file = plan.files[0]!;
    expect(file.body).toBe(`# runtime-harness/hook-adapters\n${wrapped}## 3. P3 Decisions\nkeep  two spaces  \n\n## 4. History\nkeep history\n`);
    expect(file.preservedRegions).toEqual([
      { kind: "prefix", start: 0, end: 32, digest: digestJson({ bytes: "# runtime-harness/hook-adapters\n" } as unknown as Json) },
      {
        kind: "suffix",
        start: existingBody.indexOf("## 3."),
        end: existingBody.length,
        digest: digestJson({ bytes: existingBody.slice(existingBody.indexOf("## 3.")) } as unknown as Json)
      }
    ]);
    expect(buildArchitectureDocumentationAdoptionPlan({
      profile: REPO_HARNESS_PROJECTION_PROFILE,
      expectedWorktreeDigest,
      candidates: [{ path: target.path, existingBody, renderedBody: `${existingBody}\n${wrapped}`, target }]
    }).adoptionPlanId).toBe(plan.adoptionPlanId);
    expect(JSON.stringify(architectureAdoptionReceipt(plan))).not.toContain("new P1 and P2");
  });

  test("fails closed on ambiguous headings and on an empty candidate set", () => {
    const target = entityTarget();
    const ambiguous = "# title\n## 1. one\n## 1. duplicate\n## 2. two\n## 3. three\n";
    const renderedBody = `${ambiguous}${target.generatedRegion.startMarker}\nnew\n${target.generatedRegion.endMarker}\n`;
    const plan = buildArchitectureDocumentationAdoptionPlan({
      profile: REPO_HARNESS_PROJECTION_PROFILE,
      expectedWorktreeDigest,
      candidates: [{ path: target.path, existingBody: ambiguous, renderedBody, target }]
    });
    expect(plan.allowed).toBe(false);
    expect(plan.issues).toEqual([`projection-adoption-heading-ambiguous: ${target.path}`]);
    expect(buildArchitectureDocumentationAdoptionPlan({
      profile: REPO_HARNESS_PROJECTION_PROFILE,
      expectedWorktreeDigest,
      candidates: []
    }).issues).toEqual(["projection-adoption-no-candidates"]);
  });

  test("adopts a non-entity mixed target only by appending after every human byte", () => {
    const target = { ...entityTarget(), type: "architecture-index" as const, targetId: "projection_target.architecture.index", path: "docs/architecture/index.md" };
    const existingBody = "# Human architecture index\n\nKeep this paragraph.\n";
    const wrapped = `${target.generatedRegion.startMarker}\n# Generated index\n${target.generatedRegion.endMarker}\n`;
    const plan = buildArchitectureDocumentationAdoptionPlan({
      profile: REPO_HARNESS_PROJECTION_PROFILE,
      expectedWorktreeDigest,
      candidates: [{ path: target.path, existingBody, renderedBody: `${existingBody}\n${wrapped}`, target }]
    });
    expect(plan.allowed).toBe(true);
    expect(plan.files[0]!.body).toBe(`${existingBody}\n${wrapped}`);
    expect(plan.files[0]!.preservedRegions[0]).toEqual({
      kind: "prefix",
      start: 0,
      end: existingBody.length,
      digest: digestJson({ bytes: existingBody } as unknown as Json)
    });
  });

  test("preserves a legacy H1 appendix after P3 instead of treating it as a range collision", () => {
    const target = entityTarget();
    const existingBody = "# title\n\n## 1. P1\nold\n\n## 2. P2\nold\n\n## 3. P3\nkeep\n\n# Legacy appendix\nkeep legacy\n";
    const wrapped = `${target.generatedRegion.startMarker}\nnew\n${target.generatedRegion.endMarker}\n`;
    const plan = buildArchitectureDocumentationAdoptionPlan({
      profile: REPO_HARNESS_PROJECTION_PROFILE,
      expectedWorktreeDigest,
      candidates: [{ path: target.path, existingBody, renderedBody: wrapped, target }]
    });
    expect(plan.allowed).toBe(true);
    expect(plan.files[0]!.body).toEndWith("## 3. P3\nkeep\n\n# Legacy appendix\nkeep legacy\n");
  });
});

function entityTarget(): ProjectionTargetV1 {
  return {
    schemaVersion: "archcontext.projection-target/v1",
    targetId: "projection_target.entity.capability.runtime-harness.hook-adapters",
    type: "entity-summary",
    scope: { kind: "entity", id: "capability.runtime-harness.hook-adapters", entityKind: "capability" },
    path: "docs/architecture/modules/runtime-harness/hook-adapters.md",
    ownership: "mixed",
    generatedRegion: {
      startMarker: "<!-- BEGIN ARCHCONTEXT:generated target=hook -->",
      endMarker: "<!-- END ARCHCONTEXT:generated target=hook -->"
    },
    rendererVersion: "archcontext.docs-renderer/v4",
    format: "markdown",
    sourceDigest: "sha256:source",
    outputDigest: "sha256:output"
  };
}
